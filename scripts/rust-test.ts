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
 * TESTAOT=<testaot>: the engine reads what the front end writes in some tests of bun_aot. With it, and in CI, a test that
 * the engine did not see fails. Without it such a test leaves that part out.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

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

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  console.log(`\x1b[36m[test]\x1b[0m ${cmd} ${args.join(" ")}`);
  const { status } = spawnSync(cmd, args, { stdio: "inherit", cwd: repo, env });
  if (status !== 0) process.exit(status ?? 1);
}

// The crates `include!()` generated sources, cargo cannot resolve the workspace until the vendored path dependencies
// exist, and the build script of bun_sema_standalone compiles zstd's decoder. Of WebKit the code generators are enough.
run("bun", ["install", "--frozen-lockfile"]);
run(
  "bun",
  [
    "scripts/build.ts",
    ...["codegen", "clone-zstd", "clone-lolhtml", "clone-rust-argon2"].map(name => `--target=${name}`),
  ],
  { BUN_WEBKIT_GENERATORS_ONLY: "1", ...process.env },
);

// .cargo/config.toml has flags for the target, and cargo joins these to them. Flags for the build would be passed over.
const host = /^host: (.+)$/m.exec(spawnSync("rustc", ["-vV"], { encoding: "utf8", cwd: repo }).stdout)?.[1] ?? "";
const flagsOfHost = `CARGO_TARGET_${host.toUpperCase().replaceAll("-", "_")}_RUSTFLAGS`;

const requiresEngine = !!process.env.TESTAOT || !!process.env.CI;
if (requiresEngine && !process.env.TESTAOT) {
  console.error("TESTAOT is not set: in CI the step downloads testaot from the build (.buildkite/ci.ts)");
  process.exit(1);
}

const extraArgs = process.argv.slice(2);
// It asks for a path below `/` that a test cannot create.
const everyCrate = [
  ...crates.flatMap(crate => ["-p", crate]),
  "--",
  "--skip",
  "realpath_under_the_marked_root_stays_under_it",
];
run("cargo", ["test", "--no-fail-fast", ...(extraArgs.length ? extraArgs : everyCrate)], {
  ...process.env,
  BUN_CODEGEN_DIR: resolve(repo, "build/debug/codegen"),
  ...(requiresEngine && { AOT_IR_REQUIRES_ENGINE: "1" }),
  // Without optimization a frame is several times as large, and the tests of the nesting limits reach the end of the
  // stack before the limit.
  CARGO_PROFILE_DEV_OPT_LEVEL: "1",
  // With optimization the frame pointer goes unless it is forced, as scripts/build/rust.ts does:
  // `bun_core::return_address()` reads it.
  [flagsOfHost]: "-Cforce-frame-pointers=yes",
});
