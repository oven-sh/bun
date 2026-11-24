#!/usr/bin/env bun
/**
 * `cargo check --workspace` for every CI target triple.
 *
 * Replaces the old `zig:check-all` (which leaned on zig's bundled per-target
 * libc/SDK). cargo has no such bundle: each `--target` needs its std installed
 * via `rustup target add`. This script does NOT auto-install — it skips a
 * target whose std is missing and tells you the `rustup` line that adds it, so
 * a partial local setup still checks what it can.
 *
 *   bun run rust:check-all                              # every triple in allRustTargets
 *   bun run rust:check-all aarch64-unknown-freebsd ...  # just these
 *
 * Exit code is non-zero if any *checked* target fails.
 */

import { spawnSync } from "node:child_process";
import { allRustTargets } from "./build/rust.ts";

const requested = process.argv.slice(2);
for (const triple of requested) {
  if (!(allRustTargets as readonly string[]).includes(triple)) {
    console.error(`unknown target '${triple}'; CI builds:\n  ${allRustTargets.join("\n  ")}`);
    process.exit(2);
  }
}
const triples = requested.length > 0 ? requested : allRustTargets;

/**
 * What `rustup target list --installed` prints for the toolchain in effect
 * here (rust-toolchain.toml / RUSTUP_TOOLCHAIN), one name per line. `rustc
 * --print target-libdir --target <t>` exits 0 even when the dir is empty, so
 * this is the reliable probe. `undefined` when rustup isn't the toolchain
 * manager (distro cargo): then nothing can be probed, and every target is
 * attempted.
 */
function rustupTargets(): Set<string> | undefined {
  const r = spawnSync("rustup", ["target", "list", "--installed"], { encoding: "utf8" });
  if (r.status !== 0) return undefined;
  return new Set(r.stdout.split("\n").map(line => line.trim()));
}
const installedTargets = rustupTargets();

let failed = 0;
let skipped = 0;

for (const triple of triples) {
  if (installedTargets?.has(triple) === false) {
    console.log(`\x1b[2m[skip]\x1b[0m ${triple}  (rustup target add ${triple})`);
    skipped++;
    continue;
  }

  const args = ["check", "--workspace", "--keep-going", "--target", triple, "--message-format=short"];
  console.log(`\x1b[36m[check]\x1b[0m ${triple}`);
  const r = spawnSync("cargo", args, { stdio: "inherit" });
  if (r.status !== 0) failed++;
}

console.log(`\n${triples.length - skipped - failed} ok, ${failed} failed, ${skipped} skipped (of ${triples.length})`);
process.exit(failed > 0 ? 1 : 0);
