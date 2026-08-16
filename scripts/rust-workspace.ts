/**
 * Shared by rust-miri.ts (`bun run rust:miri`) and rust-test.ts
 * (`bun run rust:test`): the crate set both run, and the configure step
 * cargo needs before it can resolve the workspace.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const repo = resolve(import.meta.dirname, "..");

// Crates that pass `cargo miri test` under Tree Borrows. To add one it must
// (a) have at least one `#[test]`, (b) compile under `--cfg test`, (c) at test
// runtime only call `extern "C"` functions Miri has shims for (libc's futex and
// thread APIs are; vendored C is not) — otherwise Miri reports
// `unsupported operation: can't call foreign function` — and (d) link and pass
// as a plain `cargo test` binary too (rust-test.ts), or be listed as pending
// there.
//
// Ordered longest-running-under-Miri first so rust-miri.ts's concurrent run
// starts the long poles immediately; everything after bun_hash takes seconds.
export const MIRI_CRATES = [
  "bun_collections",
  "bun_ast",
  "bun_paths",
  "bun_hash",
  "bun_base64",
  "bun_clap",
  "bun_dispatch",
  "bun_errno",
  "bun_http_types",
  "bun_md",
  "bun_ptr",
  "bun_resolve_builtins",
  "bun_shell_parser",
  "bun_threading",
  "bun_wyhash",
];

export function run(cmd: string, args: string[], opts: Parameters<typeof spawnSync>[2] = {}) {
  return spawnSync(cmd, args, { stdio: "inherit", cwd: repo, ...opts });
}

// `bun_core/build.rs` needs `build_options.rs`; cargo can't resolve the
// workspace until `vendor/lolhtml/` (a path dep) exists. Both come from the
// configure step, which is a no-op when already done.
export function ensureConfigured() {
  const buildOptionsRs = resolve(repo, "build/debug/codegen/build_options.rs");
  const lolhtmlCargo = resolve(repo, "vendor/lolhtml/Cargo.toml");
  if (existsSync(buildOptionsRs) && existsSync(lolhtmlCargo)) return;
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
