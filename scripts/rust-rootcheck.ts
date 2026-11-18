#!/usr/bin/env bun
/**
 * Runs tools/rootcheck over `bun_engine_vm` and the crates that name it as a dependency. See tools/rootcheck/README.md.
 *
 *   bun run rust:rootcheck                        # exits 1 on a finding
 *   bun run rust:rootcheck -p bun_engine_vm --lib # other arguments go to `cargo check`
 *   bun run rust:rootcheck --lenders              # lists the functions that lend what a cell owns
 *   bun run rust:rootcheck --test                 # the tests of the tool
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const tool = join(repo, "tools/rootcheck");
const target = join(repo, "target/rootcheck");

function fail(message: string): never {
  console.error(`rootcheck: ${message}`);
  process.exit(1);
}

function capture(command: string, args: string[], env = process.env) {
  const result = spawnSync(command, args, { cwd: repo, env, encoding: "utf8", maxBuffer: 1 << 30 });
  if (result.error) fail(`cannot run ${command}: ${result.error.message}`);
  return result;
}

const sysroot = capture("rustc", ["--print", "sysroot"]).stdout.trim();
const host = /^host: (\S+)/m.exec(capture("rustc", ["-vV"]).stdout)?.[1] ?? fail("rustc -vV names no host");
if (!readdirSync(join(sysroot, "lib/rustlib", host, "lib")).some(name => name.startsWith("librustc_middle-"))) {
  fail("the compiler's crates are missing\nnote: run `rustup component add rustc-dev llvm-tools`");
}

const build = ["build", "--quiet", "--release", "--manifest-path", join(tool, "Cargo.toml"), "--target-dir", target];
if (spawnSync("cargo", build, { cwd: repo, stdio: "inherit" }).status !== 0) process.exit(1);
const driver = join(target, "release", process.platform === "win32" ? "rootcheck.exe" : "rootcheck");

for (const name of ["RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS"]) {
  if (process.env[name] !== undefined)
    fail(`${name} would take the place of the flags that this needs\nnote: unset it`);
}

const flags = new Set(["--lenders", "--test"]);
const args = process.argv.slice(2).filter(it => !flags.has(it));
const libraryPath = { darwin: "DYLD_FALLBACK_LIBRARY_PATH", win32: "PATH" }[process.platform] ?? "LD_LIBRARY_PATH";
const libraries = join(sysroot, process.platform === "win32" ? "bin" : "lib");
const env = {
  ...process.env,
  [libraryPath]: [libraries, process.env[libraryPath]].filter(Boolean).join(delimiter),
  RUSTC_WORKSPACE_WRAPPER: driver,
  RUSTC_ICE: "0",
  ROOTCHECK_LENDERS: process.argv.includes("--lenders") ? "1" : undefined,
};

type Diagnostic = {
  level: string;
  rendered: string;
  code: { code: string } | null;
  spans: { is_primary: boolean; line_start: number }[];
};
type Message =
  | { reason: "compiler-message"; message: Diagnostic }
  | { reason: "compiler-artifact"; target: { name: string; kind: string[] }; filenames: string[] };

const parseLines = (text: string) =>
  text
    .split("\n")
    .filter(line => line.startsWith("{"))
    .map(line => JSON.parse(line));
const ruleOf = (diagnostic: Diagnostic) => /^rootcheck::(.*)/.exec(diagnostic.code?.code ?? "")?.[1];

/** Findings are warnings, so that one run gets through all crates. */
function check(args: string[]): { messages: Message[]; ok: boolean } {
  const format = process.stderr.isTTY ? "json-diagnostic-rendered-ansi" : "json";
  // The driver follows calls into generic functions of other crates, those outside the workspace too.
  const rustflags = `target."cfg(all())".rustflags=["-Zalways-encode-mir", "-Zmir-opt-level=0"]`;
  const options = ["--quiet", "--keep-going", "--target-dir", target, "--config", rustflags];
  const result = capture("cargo", ["check", ...options, `--message-format=${format}`, ...args], env);
  if (result.status !== 0) process.stderr.write(result.stderr);
  return { messages: parseLines(result.stdout), ok: result.status === 0 };
}

function dependentsOfVm(): string[] {
  const metadata = capture("cargo", ["metadata", "--format-version=1", "--no-deps"]);
  if (metadata.status !== 0) fail(metadata.stderr);
  const packages: { name: string; dependencies: { name: string }[] }[] = JSON.parse(metadata.stdout).packages;
  const dependents = packages.filter(it => it.dependencies.some(dependency => dependency.name === "bun_engine_vm"));
  return ["bun_engine_vm", ...dependents.map(it => it.name)];
}

function lint(): boolean {
  const names = (pattern: RegExp) => args.some(it => pattern.test(it));
  const packages = names(/^(-p|--package|--workspace)/) ? [] : dependentsOfVm().flatMap(name => ["-p", name]);
  const targets = names(/^--(lib|bin|test|bench|example)/) ? [] : ["--all-targets"];
  const { messages, ok } = check([...packages, ...targets, ...args]);
  const diagnostics = messages.flatMap(it => (it.reason === "compiler-message" ? [it.message] : []));
  // A crate is checked as a library and as a test.
  const distinct = [
    ...new Map(diagnostics.map(it => [it.rendered.split("\n", 2).join().replace(/ +/g, " "), it])).values(),
  ];
  const wanted = (rule: string) => (rule === "lender") === process.argv.includes("--lenders");
  const findings = distinct.filter(it => ruleOf(it) && wanted(ruleOf(it)!));
  for (const it of [...findings, ...distinct.filter(it => it.level.startsWith("error"))]) {
    process.stderr.write(it.rendered);
  }
  console.error(`rootcheck: ${findings.length} finding(s)`);
  if (!ok) console.error("rootcheck: what does not compile has not been checked");
  return ok && (findings.length === 0 || process.argv.includes("--lenders"));
}

/** A line that ends in `//~ rule: text` has a finding of that rule which says that, and no other line has one. */
function test(): boolean {
  const { messages, ok } = check(["-p", "bun_engine_builtins"]);
  if (!ok) return false;
  const files = messages.flatMap(it =>
    it.reason === "compiler-artifact" && !it.target.kind.includes("custom-build")
      ? [{ name: it.target.name, path: it.filenames[0] }]
      : [],
  );
  const named = ["bun_alloc", "bun_engine_vm", "bun_engine_macros", "bun_engine_text", "hashbrown", "smallvec"];
  const options = [
    ...["--edition=2024", "--crate-type=lib", "--emit=metadata", "--error-format=json", "-Cpanic=abort", "-Aunused"],
    ...["--out-dir", join(target, "tests")],
    ...files.flatMap(it => ["-L", `dependency=${dirname(it.path)}`]),
    ...files.filter(it => named.includes(it.name)).flatMap(it => ["--extern", `${it.name}=${it.path}`]),
  ];
  let failures = 0;
  let expectations = 0;
  const names = readdirSync(join(tool, "tests")).filter(it => args.length === 0 || args.some(a => it.includes(a)));
  for (const name of names.sort()) {
    const path = join(tool, "tests", name);
    const expected = readFileSync(path, "utf8")
      .split("\n")
      .flatMap((text, index) =>
        [...text.matchAll(/\/\/~ (\w+): (.*?)(?= \/\/~|$)/g)].map(it => ({
          line: index + 1,
          rule: it[1],
          text: it[2],
        })),
      );
    expectations += expected.length;
    const lenders = name.startsWith("lenders") ? "1" : undefined;
    const result = capture(driver, ["rustc", path, ...options], { ...env, ROOTCHECK_LENDERS: lenders });
    const problems = result.status === 0 ? [] : [`exited with ${result.status ?? result.signal}\n${result.stderr}`];
    for (const diagnostic of parseLines(result.stderr) as Diagnostic[]) {
      const line = diagnostic.spans?.find(it => it.is_primary)?.line_start;
      if (line === undefined) continue;
      const index = expected.findIndex(
        it => it.line === line && it.rule === ruleOf(diagnostic) && says(diagnostic, it.text),
      );
      if (index === -1) problems.push(`unexpected:\n${diagnostic.rendered}`);
      else expected.splice(index, 1);
    }
    problems.push(...expected.map(it => `${name}:${it.line}: not reported: ${it.rule}: ${it.text}`));
    console.error(`${problems.length ? "FAIL" : "ok  "} ${name}`);
    for (const problem of problems) console.error(problem);
    failures += problems.length;
  }
  console.error(`rootcheck: ${names.length} files, ${expectations} expected findings, ${failures} failure(s)`);
  return failures === 0 && expectations > 0;
}

/** The rendered text quotes the source, and the expectation with it. */
function says(diagnostic: Diagnostic, text: string): boolean {
  return diagnostic.rendered.replace(/\/\/~.*/g, "").includes(text);
}

process.exit((process.argv.includes("--test") ? test() : lint()) ? 0 : 1);
