#!/usr/bin/env bun
/**
 * `cargo test` for the crates whose tests link without JavaScriptCore and
 * Bun's C++.
 *
 * A crate's test binary links everything the crate can reach, so a crate that
 * declares functions of the engine or of vendored C cannot be tested this way:
 * its tests run as part of Bun, from test/.
 *
 * Usage:
 *   bun run rust:test              # every crate of the list
 *   bun run rust:test -p bun_foo   # extra args go straight to `cargo test`
 *
 * `cargo test` runs one test program behind another. For the whole list each program starts when cargo has linked it,
 * beside those that still run and beside the rest of the build. What a program prints is shown when it ends.
 *
 * TESTAOT=<testaot>: the engine reads what the front end writes in some tests of bun_aot. With it, and in CI, a test that
 * the engine did not see fails. Without it such a test leaves that part out.
 *
 * BUN_UNDER_TEST=<bun>: beside the crates it builds and runs the programs of test/aot/library-sweeps, which compile all of
 * Bun's library, some in a checking mode. This step has the processors for them, and no shard of the tests waits for it.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readdirSync } from "node:fs";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { isBuildkite } from "./buildkite.ts";

const repo = resolve(import.meta.dirname, "..");

// To add a crate it must have at least one `#[test]` and link by itself.
const crates = [
  "bun_aot",
  "bun_base64",
  "bun_builtin_sources",
  "bun_bundler",
  "bun_collections",
  "bun_crash_handler",
  "bun_dispatch",
  "bun_errno",
  "bun_exe_format",
  "bun_hash",
  "bun_http_types",
  "bun_lint_react_compiler",
  "bun_md",
  "bun_options_types",
  "bun_paths",
  "bun_pod",
  "bun_removable_features",
  "bun_resolve_builtins",
  "bun_resolver",
  "bun_sema",
  "bun_sema_driver",
  "bun_sema_parser",
  "bun_sema_standalone",
  "bun_shell_parser",
  "bun_sql_jsc",
  "bun_threading",
  "bun_trim",
  "bun_wyhash",
];

// Not `spawnSync`: what runs beside it writes into pipes that this process empties.
async function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  console.log(`\x1b[36m[test]\x1b[0m ${cmd} ${args.join(" ")}`);
  const child = spawn(cmd, args, { stdio: "inherit", cwd: repo, env });
  const status = await new Promise<number | null>(done => child.on("close", done).on("error", () => done(1)));
  if (status === 0) return;
  // Asked to end, a program ends what it has started itself.
  for (const program of running) program.kill();
  await Promise.all(programs);
  process.exit(status ?? 1);
}

const requiresEngine = !!process.env.TESTAOT || !!process.env.CI;
if (requiresEngine && !process.env.TESTAOT) {
  console.error("TESTAOT is not set: in CI the step downloads testaot from the build (.buildkite/ci.ts)");
  process.exit(1);
}

const bunUnderTest = process.env.BUN_UNDER_TEST;
if (process.env.CI && !bunUnderTest) {
  console.error("BUN_UNDER_TEST is not set: in CI the step downloads Bun from the build (.buildkite/ci.ts)");
  process.exit(1);
}

interface TestProgram {
  name: string;
  status: number | NodeJS.Signals | null;
}

/** What it prints is shown when it ends. */
function start(name: string, command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) {
  const started = performance.now();
  const program = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  running.add(program);
  const output: Buffer[] = [];
  program.stdout.on("data", chunk => output.push(chunk));
  program.stderr.on("data", chunk => output.push(chunk));
  return new Promise<TestProgram>(done => {
    program.on("error", error => {
      running.delete(program);
      console.error(`\x1b[31m[test]\x1b[0m ${name}: ${error.message}`);
      done({ name, status: 1 });
    });
    program.on("close", (code, signal) => {
      running.delete(program);
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      console.log(`\x1b[36m[test]\x1b[0m ${name} (${seconds} s)`);
      process.stdout.write(Buffer.concat(output));
      done({ name, status: code ?? signal });
    });
  });
}

const extraArgs = process.argv.slice(2);
const programs: Promise<TestProgram>[] = [];
const running = new Set<ChildProcess>();

// The crates `include!()` generated sources, cargo cannot resolve the workspace until the vendored path dependencies
// exist, and the build script of bun_sema_standalone compiles zstd's decoder. Of WebKit the code generators are enough.
await run("bun", ["install", "--frozen-lockfile"]);
// They need nothing of what follows, which leaves most of the processors idle until cargo starts.
if (bunUnderTest && !extraArgs.length) {
  const sweeps = "test/aot/library-sweeps";
  const files = readdirSync(resolve(repo, sweeps)).filter(name => /\.[cm]?[jt]s$/.test(name));
  const args = ["test/aot/run-parallel.ts", `--root=${sweeps}`, ...files.map(name => join(sweeps, name))];
  programs.push(start(sweeps, bunUnderTest, args, { cwd: repo, env: process.env }));
}
await run(
  // A CI machine runs the build with the node of its image, and the build checks the version of what runs it.
  isBuildkite ? "node" : "bun",
  [
    "scripts/build.ts",
    ...["codegen", "clone-zstd", "clone-lolhtml", "clone-rust-argon2"].map(name => `--target=${name}`),
  ],
  { BUN_WEBKIT_GENERATORS_ONLY: "1", ...process.env },
);

// .cargo/config.toml has flags for the target, and cargo joins these to them. Flags for the build would be passed over.
const host = /^host: (.+)$/m.exec(spawnSync("rustc", ["-vV"], { encoding: "utf8", cwd: repo }).stdout)?.[1] ?? "";
const flagsOfHost = `CARGO_TARGET_${host.toUpperCase().replaceAll("-", "_")}_RUSTFLAGS`;

const env = {
  // A panic says its file and line without it, and a quarter of the build is writing it.
  CARGO_PROFILE_DEV_DEBUG: "0",
  // A CI machine builds once, from nothing: nobody reads what a later build would start from.
  ...(process.env.CI && { CARGO_INCREMENTAL: "0" }),
  ...process.env,
  BUN_CODEGEN_DIR: resolve(repo, "build/debug/codegen"),
  ...(requiresEngine && { AOT_IR_REQUIRES_ENGINE: "1" }),
  // Without optimization a frame is several times as large, and the tests of the nesting limits reach the end of the
  // stack before the limit.
  CARGO_PROFILE_DEV_OPT_LEVEL: "1",
  // With optimization the frame pointer goes unless it is forced, as scripts/build/rust.ts does:
  // `bun_core::return_address()` reads it. The two largest crates are compiled one behind the other, each with most of
  // the processors idle until it generates code: see `-Zthreads` there.
  [flagsOfHost]: "-Cforce-frame-pointers=yes -Zthreads=8",
};

if (extraArgs.length) {
  await run("cargo", ["test", "--no-fail-fast", ...extraArgs], env);
  process.exit(0);
}

// The crates of the list whose documentation has examples that run. `--no-run` builds none of them.
const cratesWithExamples = ["bun_pod"];

// It asks for a path below `/` that a test cannot create.
const programArgs = ["--skip", "realpath_under_the_marked_root_stays_under_it"];

// The test program of a crate of macros loads Rust's standard library when it starts.
const libraryPath =
  { win32: "PATH", darwin: "DYLD_FALLBACK_LIBRARY_PATH" }[process.platform as string] ?? "LD_LIBRARY_PATH";
const libraryFolders = [
  spawnSync("rustc", ["--print", "target-libdir"], { encoding: "utf8", cwd: repo }).stdout.trim(),
  // What the loader of macOS falls back to where the variable is not set.
  process.env[libraryPath] ?? (process.platform === "darwin" ? `${process.env.HOME}/lib:/usr/local/lib:/usr/lib` : ""),
];

/** As `cargo test` starts it: in the folder of its package, with the libraries of the toolchain in reach. */
function startProgram(executable: string, manifestPath: string, target: string) {
  const cwd = dirname(manifestPath);
  return start(`${relative(repo, cwd)} ${target}`, executable, programArgs, {
    cwd,
    env: {
      ...env,
      CARGO_MANIFEST_DIR: cwd,
      CARGO_MANIFEST_PATH: manifestPath,
      [libraryPath]: libraryFolders.filter(Boolean).join(delimiter),
    },
  });
}

const buildArgs = ["test", "--no-run", "--no-fail-fast", "--message-format=json-render-diagnostics"];
buildArgs.push(...crates.flatMap(crate => ["-p", crate]));
console.log(`\x1b[36m[test]\x1b[0m cargo ${buildArgs.join(" ")}`);
const build = spawn("cargo", buildArgs, { cwd: repo, env, stdio: ["ignore", "pipe", "inherit"] });
const built = new Promise<number | NodeJS.Signals | null>(done =>
  build.on("close", (code, signal) => done(code ?? signal)),
);
for await (const line of createInterface({ input: build.stdout })) {
  if (!line.startsWith("{")) continue;
  const message = JSON.parse(line);
  if (message.reason === "compiler-artifact" && message.profile.test && message.executable) {
    programs.push(startProgram(message.executable, message.manifest_path, message.target.name));
  }
}
const buildStatus = await built;
if (buildStatus === 0) {
  const args = ["test", "--doc", ...cratesWithExamples.flatMap(crate => ["-p", crate])];
  programs.push(start(`cargo ${args.join(" ")}`, "cargo", args, { cwd: repo, env }));
}
const failed = (await Promise.all(programs)).filter(program => program.status !== 0);
for (const { name, status } of failed) {
  console.error(`\x1b[31m[test]\x1b[0m ${name} ended with ${status}`);
}
if (buildStatus !== 0) {
  console.error(`\x1b[31m[test]\x1b[0m cargo ended with ${buildStatus}`);
}
console.log(`\x1b[36m[test]\x1b[0m ${programs.length - failed.length} of ${programs.length} test programs pass`);
process.exit(failed.length || buildStatus !== 0 ? 1 : 0);
