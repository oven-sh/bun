#!/usr/bin/env bun
/**
 * `cargo check --workspace` for every CI target triple.
 *
 * Replaces the old `zig:check-all` (which leaned on zig's bundled per-target
 * libc/SDK). cargo has no such bundle: each `--target` needs its std installed
 * via `rustup target add` (Tier 1/2) or built from source via `-Zbuild-std`
 * (Tier 3). This script does NOT auto-install — it skips a target if its std
 * is missing and tells you the `rustup target add` line, so a partial local
 * setup still checks what it can.
 *
 * Exit code is non-zero if any *checked* target fails.
 */

import { spawnSync } from "node:child_process";
import { allRustTargets } from "./build/rust.ts";

// Ban the fn-long `let this = unsafe { &mut *this };` reborrow. It asserts
// exclusive access for the whole function on objects that are re-entered
// through their own callbacks; the fix is `&self` + `Cell`/`JsCell` state or
// scoped raw place access, never this line.
const banned = /let\s+this\b[^=]*=\s*unsafe\s*\{\s*&mut\s+\*this\s*\}/;
const offenders: string[] = [];
for await (const path of new Bun.Glob("src/**/*.rs").scan({ cwd: import.meta.dir + "/.." })) {
  const text = await Bun.file(`${import.meta.dir}/../${path}`).text();
  text.split("\n").forEach((line, i) => {
    if (banned.test(line)) offenders.push(`${path}:${i + 1}: ${line.trim()}`);
  });
}
if (offenders.length > 0) {
  console.error("\x1b[31mfn-long `&mut *this` reborrow is banned:\x1b[0m");
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}

let failed = 0;
let skipped = 0;

for (const triple of allRustTargets) {
  // Probe: is std for this target installed? `rustc --print target-libdir
  // --target <t>` exits 0 even when the dir is empty, so check for the
  // sentinel `libcore-*.rlib` instead via `rustup target list --installed`.
  const installed = spawnSync("rustup", ["target", "list", "--installed"], { encoding: "utf8" });
  if (installed.status === 0 && !installed.stdout.split("\n").includes(triple)) {
    console.log(`\x1b[2m[skip]\x1b[0m ${triple}  (rustup target add ${triple})`);
    skipped++;
    continue;
  }

  console.log(`\x1b[36m[check]\x1b[0m ${triple}`);
  const r = spawnSync("cargo", ["check", "--workspace", "--keep-going", "--target", triple, "--message-format=short"], {
    stdio: "inherit",
  });
  if (r.status !== 0) failed++;
}

console.log(
  `\n${allRustTargets.length - skipped - failed} ok, ${failed} failed, ${skipped} skipped (of ${allRustTargets.length})`,
);
process.exit(failed > 0 ? 1 : 0);
