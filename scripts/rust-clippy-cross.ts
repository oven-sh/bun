#!/usr/bin/env bun
/**
 * `cargo clippy` for targets other than the host.
 *
 * `bun run rust:clippy` (the CI Clippy job, ubuntu) only lints the code that is
 * compiled for x86_64-unknown-linux-gnu; everything behind `#[cfg(windows)]`,
 * `#[cfg(target_os = "freebsd")]`, ... is never seen by clippy unless someone
 * runs it on that OS. This runs the same workspace lint with `--target` for
 * the targets below (clippy only needs the target's prebuilt std, not a
 * linker or sysroot, so it works from any host).
 *
 * Each target lists the crates that still fail on it; they are `--exclude`d
 * so every other crate stays pinned. The lists are a ratchet: delete a crate
 * once it lints clean on that target, never add one (a listed-clean crate
 * that starts failing is a regression in the change that broke it). An empty
 * list lints the whole workspace, same as the host run.
 *
 * Usage:
 *   bun run rust:clippy-cross               # every target below
 *   bun run rust:clippy-cross -p bun_core   # extra args replace the package selection
 *
 * Needs the configure step (`bun run build --configure-only` +
 * `ninja -C build/debug clone-lolhtml`) and `rustup target add <triple>` for
 * each target; cargo names the missing one if it is not installed.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const CROSS_CLIPPY_TARGETS: Record<string, readonly string[]> = {
  // aarch64-pc-windows-msvc reports the identical set; one Windows triple is
  // enough to cover `cfg(windows)`.
  "x86_64-pc-windows-msvc": [
    "bun_bundler",
    "bun_bunfig",
    "bun_cares_sys",
    "bun_crash_handler",
    "bun_install",
    "bun_io",
    "bun_jsc",
    "bun_libuv_sys",
    "bun_md",
    "bun_patch",
    "bun_paths",
    "bun_resolver",
    "bun_router",
    "bun_runtime",
    "bun_spawn",
    "bun_spawn_sys",
    "bun_standalone_graph",
    "bun_sys",
    "bun_threading",
    "bun_uws_sys",
    "bun_watcher",
    "bun_which",
  ],
  "x86_64-unknown-freebsd": ["bun_crash_handler", "bun_glob", "bun_http", "bun_runtime", "bun_sys", "bun_threading"],
};

if (import.meta.main) {
  const repo = resolve(import.meta.dirname, "..");
  const codegenDir = process.env.BUN_CODEGEN_DIR ?? resolve(repo, "build/debug/codegen");
  for (const [path, hint] of [
    [resolve(codegenDir, "build_options.rs"), "bun run build --configure-only"],
    [resolve(repo, "vendor/lolhtml/Cargo.toml"), "ninja -C build/debug clone-lolhtml"],
  ] as const) {
    if (!existsSync(path)) {
      console.error(`\x1b[31m[error]\x1b[0m ${path} is missing; run: ${hint}`);
      process.exit(1);
    }
  }

  const extraArgs = process.argv.slice(2);
  let failed = 0;
  for (const [triple, excluded] of Object.entries(CROSS_CLIPPY_TARGETS)) {
    const selection = extraArgs.length > 0 ? extraArgs : ["--workspace", ...excluded.flatMap(c => ["--exclude", c])];
    const args = ["clippy", "--no-deps", "--keep-going", "--target", triple, ...selection];
    console.log(`\x1b[36m[clippy]\x1b[0m cargo ${args.join(" ")}`);
    if (spawnSync("cargo", args, { stdio: "inherit", cwd: repo }).status !== 0) failed++;
  }
  process.exit(failed > 0 ? 1 : 0);
}
