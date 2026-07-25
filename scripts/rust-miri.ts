#!/usr/bin/env bun
/**
 * `cargo miri test` for the FFI-free crate set.
 *
 * Miri interprets MIR and catches UB (use-after-free, out-of-bounds,
 * uninit reads, data races, aliasing violations) at runtime. It cannot call
 * foreign functions, so this only covers the pure-Rust corner of the
 * workspace — which is also where `unsafe` density is highest.
 *
 * Aliasing model: `-Zmiri-tree-borrows`, not the default Stacked Borrows.
 * Stacked Borrows invalidates every raw pointer derived from `&mut self` the
 * moment a later `&mut self` is formed — which is the entire premise of
 * `HiveArray`, `MultiArrayList`, the slot pools, etc. (claim a stable
 * `*mut T`, mutate the container, deref the pointer afterward). Tree Borrows
 * is the candidate replacement spec, allows that pattern, and still catches
 * the bugs we care about.
 *
 * Usage:
 *   bun run rust:miri              # default safe crate set
 *   bun run rust:miri -p bun_foo   # extra args go straight to cargo miri test
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");

// Crates that pass `cargo miri test` under Tree Borrows. To add one it must
// (a) have at least one `#[test]`, (b) compile under `--cfg test`, (c) not
// call into `extern "C"` at test runtime — Miri reports
// `unsupported operation: can't call foreign function` if it does.
const MIRI_CRATES = [
  "bun_ast",
  "bun_base64",
  "bun_clap",
  "bun_collections",
  "bun_dispatch",
  "bun_errno",
  "bun_hash",
  "bun_http_types",
  "bun_md",
  "bun_paths",
  "bun_ptr",
  "bun_resolve_builtins",
  "bun_shell_parser",
  "bun_wyhash",
];

function run(cmd: string, args: string[], opts: Parameters<typeof spawnSync>[2] = {}) {
  return spawnSync(cmd, args, { stdio: "inherit", cwd: repo, ...opts });
}

// `bun_core/build.rs` needs `build_options.rs`; cargo can't resolve the
// workspace until `vendor/lolhtml/` (a path dep) exists. Both come from the
// configure step, which is a no-op when already done.
const buildOptionsRs = resolve(repo, "build/debug/codegen/build_options.rs");
const lolhtmlCargo = resolve(repo, "vendor/lolhtml/Cargo.toml");
if (!existsSync(buildOptionsRs) || !existsSync(lolhtmlCargo)) {
  console.log("\x1b[36m[setup]\x1b[0m bun run build --configure-only");
  if (run("bun", ["run", "build", "--configure-only"]).status !== 0) process.exit(1);
  if (!existsSync(lolhtmlCargo) && run("ninja", ["-C", "build/debug", "clone-lolhtml"]).status !== 0) {
    process.exit(1);
  }
  // Re-check: configure can succeed without producing these (e.g. partial
  // checkout, ninja target rename) — fail fast instead of letting cargo
  // produce a confusing workspace-resolution error.
  for (const [path, hint] of [
    [buildOptionsRs, "bun run build --configure-only"],
    [lolhtmlCargo, "ninja -C build/debug clone-lolhtml"],
  ] as const) {
    if (!existsSync(path)) {
      console.error(`\x1b[31m[error]\x1b[0m ${path} still missing after setup — try: ${hint}`);
      process.exit(1);
    }
  }
}

const extraArgs = process.argv.slice(2);
const crateArgs = extraArgs.length > 0 ? extraArgs : MIRI_CRATES.flatMap(c => ["-p", c]);

console.log(`\x1b[36m[miri]\x1b[0m cargo miri test ${crateArgs.join(" ")}`);
const r = run("cargo", ["miri", "test", ...crateArgs], {
  env: {
    ...process.env,
    MIRIFLAGS: ["-Zmiri-tree-borrows", process.env.MIRIFLAGS ?? ""].join(" ").trim(),
  },
});
process.exit(r.status ?? 1);
