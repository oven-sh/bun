#!/usr/bin/env bun
/**
 * Build-script executor for the direct-rustc ninja graph.
 *
 * Plays cargo's role for a single `run-custom-build` unit: sets the
 * documented build-script environment, runs the compiled `build.rs` exe,
 * captures its `cargo:` directive stream to a file, and emits a `.d`
 * depfile from the `rerun-if-changed` lines so ninja tracks the same
 * inputs cargo would.
 *
 * The captured output file is what `rustc-runner.ts` reads to inject
 * `--cfg` / `--env` / `-L` / `-l` into the consuming crate's rustc
 * invocation — that's how `cfg(libc_ctest)` or `env!("OUT_DIR")` reach
 * the lib without ninja knowing the values at configure time.
 *
 * Reference for the env contract:
 *   https://doc.rust-lang.org/cargo/reference/environment-variables.html#environment-variables-cargo-sets-for-build-scripts
 *
 * Invoked as:
 *   buildscript-runner.ts <json-spec> <script-exe>
 *
 * The spec is a JSON object (see `BuildScriptSpec` below) baked into
 * `build.ninja` at configure time; everything in it is known then. The
 * runner does the parts that aren't: making `OUT_DIR`, running the exe,
 * parsing stdout.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface BuildScriptSpec {
  /** Absolute path to write captured stdout (the `cargo:` directive stream). */
  output: string;
  /** Absolute `.d` depfile path. */
  depfile: string;
  /** Absolute OUT_DIR — created before the script runs. */
  outDir: string;
  /** `target.triple` for the unit being built. */
  target: string;
  /** Host triple (`rustc -vV` `host:` line). */
  host: string;
  /** Absolute manifest dir — `CARGO_MANIFEST_DIR`, also the script's cwd. */
  manifestDir: string;
  /** `links` key from the package manifest, if any. */
  links: string | undefined;
  pkgName: string;
  /** Full semver — split into MAJOR/MINOR/PATCH/PRE for the script. */
  pkgVersion: string;
  /** Enabled features (UPPER_SNAKE'd into `CARGO_FEATURE_*`). */
  features: string[];
  /** unit-graph profile fields the script may read. */
  optLevel: string;
  debug: boolean;
  /** rustc executable — exported as `RUSTC` so cc-rs/autocfg probe with the right toolchain. */
  rustc: string;
  /**
   * `key=value` cfg pairs from `rustc --print cfg --target <triple>`, computed
   * once at configure time. Cargo exposes these as `CARGO_CFG_<KEY>=<v1>,<v2>`.
   */
  targetCfg: Record<string, string>;
  /** Extra env (CC/CXX/AR, BUN_CODEGEN_DIR, RUSTUP_TOOLCHAIN, …) forwarded from Config. */
  extraEnv: Record<string, string>;
}

const [, , specJson, scriptExeArg] = process.argv;
if (!specJson || !scriptExeArg) {
  console.error("usage: buildscript-runner.ts <json-spec> <script-exe>");
  process.exit(2);
}
const spec: BuildScriptSpec = JSON.parse(specJson);
// ninja passes `$in` buildDir-relative; we run the script with cwd =
// manifestDir, so resolve before chdir.
const scriptExe = resolve(scriptExeArg);

mkdirSync(spec.outDir, { recursive: true });
mkdirSync(dirname(spec.output), { recursive: true });

// ─── Environment ───
const ver = spec.pkgVersion.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?/);
const env: NodeJS.ProcessEnv = {
  ...process.env,
  ...spec.extraEnv,
  OUT_DIR: spec.outDir,
  TARGET: spec.target,
  HOST: spec.host,
  NUM_JOBS: "1", // ninja owns parallelism; build scripts shouldn't fan out
  OPT_LEVEL: spec.optLevel,
  DEBUG: spec.debug ? "true" : "false",
  PROFILE: spec.debug ? "debug" : "release",
  RUSTC: spec.rustc,
  CARGO_MANIFEST_DIR: spec.manifestDir,
  CARGO_MANIFEST_PATH: resolve(spec.manifestDir, "Cargo.toml"),
  CARGO_PKG_NAME: spec.pkgName,
  CARGO_PKG_VERSION: spec.pkgVersion,
  CARGO_PKG_VERSION_MAJOR: ver?.[1] ?? "0",
  CARGO_PKG_VERSION_MINOR: ver?.[2] ?? "0",
  CARGO_PKG_VERSION_PATCH: ver?.[3] ?? "0",
  CARGO_PKG_VERSION_PRE: ver?.[4] ?? "",
  CARGO_PKG_AUTHORS: "",
  CARGO_PKG_DESCRIPTION: "",
  CARGO_PKG_HOMEPAGE: "",
  CARGO_PKG_REPOSITORY: "",
  CARGO_PKG_LICENSE: "",
  CARGO_PKG_LICENSE_FILE: "",
  CARGO_PKG_RUST_VERSION: "",
  CARGO_PKG_README: "",
  // Mirrors cargo's CARGO_ENCODED_RUSTFLAGS contract: present-but-empty so
  // build scripts that probe it (cc-rs reads it) don't get confused by
  // an inherited shell value.
  CARGO_ENCODED_RUSTFLAGS: "",
  CARGO_CFG_PANIC: "abort",
};
if (spec.links !== undefined) env.CARGO_MANIFEST_LINKS = spec.links;
for (const f of spec.features) {
  env[`CARGO_FEATURE_${f.toUpperCase().replace(/-/g, "_")}`] = "1";
}
for (const [k, v] of Object.entries(spec.targetCfg)) {
  env[`CARGO_CFG_${k.toUpperCase().replace(/-/g, "_")}`] = v;
}

// ─── Run ───
const r = spawnSync(scriptExe, [], {
  cwd: spec.manifestDir,
  env,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
if (r.error) {
  console.error(`buildscript-runner: failed to spawn ${scriptExe}: ${r.error.message}`);
  process.exit(1);
}
if (r.status !== 0) {
  console.error(`buildscript-runner: ${spec.pkgName} build script exited ${r.status}`);
  process.exit(r.status ?? 1);
}

// ─── Capture + depfile ───
// Directive lines are `cargo:KEY=VALUE` or (newer) `cargo::KEY=VALUE`.
// `rerun-if-changed` paths are relative to manifestDir; resolve them so the
// `.d` file holds absolute paths (ninja's depfile parser doesn't know our cwd).
// Everything else passes through verbatim for rustc-runner.ts to interpret.
const stdout = r.stdout ?? "";
const rerun: string[] = [];
for (const line of stdout.split("\n")) {
  const m = line.match(/^cargo::?rerun-if-changed=(.+)$/);
  if (m) rerun.push(resolve(spec.manifestDir, m[1]!));
  const w = line.match(/^cargo::?warning=(.+)$/);
  if (w) console.error(`warning: ${spec.pkgName}@build: ${w[1]}`);
}

writeFileSync(spec.output, stdout);
// gcc-style depfile: `<output>: <dep> <dep> ...`. Spaces in paths escaped per
// make rules (ninja's deps=gcc parser follows the same convention).
const esc = (p: string) => p.replace(/ /g, "\\ ");
writeFileSync(spec.depfile, `${esc(spec.output)}: ${rerun.map(esc).join(" ")}\n`);
process.exit(0);
