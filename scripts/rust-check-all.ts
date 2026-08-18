#!/usr/bin/env bun
/**
 * `cargo check --workspace` for every CI target triple.
 *
 * Replaces the old `zig:check-all` (which leaned on zig's bundled per-target
 * libc/SDK). cargo has no such bundle: each `--target` needs its std installed
 * via `rustup target add` (Tier 1/2) or built from source via `-Zbuild-std`
 * (Tier 3, which needs the `rust-src` component instead). This script does
 * NOT auto-install — it skips a target whose std is missing and tells you the
 * `rustup` line that adds it, so a partial local setup still checks what it
 * can.
 *
 *   bun run rust:check-all                              # every triple in allRustTargets
 *   bun run rust:check-all aarch64-unknown-freebsd ...  # just these
 *
 * Exit code is non-zero if any *checked* target fails.
 */

import { spawnSync } from "node:child_process";
import { allRustTargets, cargoBuildStdArg, rustTargetIsTier3 } from "./build/rust.ts";

const requested = process.argv.slice(2);
for (const triple of requested) {
  if (!(allRustTargets as readonly string[]).includes(triple)) {
    console.error(`unknown target '${triple}'; CI builds:\n  ${allRustTargets.join("\n  ")}`);
    process.exit(2);
  }
}
const triples = requested.length > 0 ? requested : allRustTargets;

/**
 * What `rustup <kind> list --installed` prints for the toolchain in effect
 * here (rust-toolchain.toml / RUSTUP_TOOLCHAIN), one name per line. `rustc
 * --print target-libdir --target <t>` exits 0 even when the dir is empty, so
 * this is the reliable probe. `undefined` when rustup isn't the toolchain
 * manager (distro cargo): then nothing can be probed, and every target is
 * attempted.
 */
function rustupInstalled(kind: "target" | "component"): Set<string> | undefined {
  const r = spawnSync("rustup", [kind, "list", "--installed"], { encoding: "utf8" });
  if (r.status !== 0) return undefined;
  return new Set(r.stdout.split("\n").map(line => line.trim()));
}
const installedTargets = rustupInstalled("target");
const installedComponents = rustupInstalled("component");

let failed = 0;
let skipped = 0;

for (const triple of triples) {
  const tier3 = rustTargetIsTier3(triple);
  // A Tier 3 triple never shows up in `target list` (there's no rust-std to
  // install); `-Zbuild-std` wants rust-src instead. `component list` prints
  // host components with their triple suffix but rust-src bare.
  let installCommand: string | undefined;
  if (tier3) {
    if (installedComponents?.has("rust-src") === false) installCommand = "rustup component add rust-src";
  } else if (installedTargets?.has(triple) === false) {
    installCommand = `rustup target add ${triple}`;
  }
  if (installCommand !== undefined) {
    console.log(`\x1b[2m[skip]\x1b[0m ${triple}  (${installCommand})`);
    skipped++;
    continue;
  }

  const args = ["check", "--workspace", "--keep-going", "--target", triple, "--message-format=short"];
  if (tier3) args.push(cargoBuildStdArg);
  console.log(`\x1b[36m[check]\x1b[0m ${triple}${tier3 ? `  (${cargoBuildStdArg})` : ""}`);
  const r = spawnSync("cargo", args, { stdio: "inherit" });
  if (r.status !== 0) failed++;
}

console.log(`\n${triples.length - skipped - failed} ok, ${failed} failed, ${skipped} skipped (of ${triples.length})`);
process.exit(failed > 0 ? 1 : 0);
