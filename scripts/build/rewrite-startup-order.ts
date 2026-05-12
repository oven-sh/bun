#!/usr/bin/env bun
/**
 * Rewrite Rust v0-mangled crate disambiguator hashes in `src/startup.order`
 * to match the just-built `libbun_rust.a`, then write the result to
 * `${buildDir}/startup.order.resolved` for `-Wl,--symbol-ordering-file=`.
 *
 * ## Why
 *
 * Every Rust symbol in the order file embeds one or more
 * `Cs<12-char-hash>_<len><crate>` tokens (the v0 mangling "instantiating
 * crate" path). The hash is `-Cmetadata`-derived: any edit to a crate's
 * source set, feature flags, dep graph, or rustc version reshuffles it for
 * that crate AND every downstream crate. The checked-in order file goes
 * stale on the next merge — and because flags.ts pairs the ordering flag
 * with `--no-warn-symbol-ordering`, lld silently ignores the dead entries
 * and the hot startup path drops back to fat-LTO crate-alphabetical order
 * (sharing 64 KB fault-around blocks with cold bun_css/bun_shell/bun_install
 * code → +1.3 MB .text RSS, `filemap_map_pages` becomes the #1 perf-diff
 * line on `bun .`).
 *
 * Rather than re-profile on every dep bump, we treat the disambiguator as
 * a wildcard: at link time, harvest the live `crate → hash` map from the
 * staticlib's symbol table and substitute it into the human-authored
 * ordering. C++/_Z* and hand-listed entries pass through untouched.
 *
 * ## Algorithm
 *
 *  1. `llvm-nm --defined-only -j <archives>` → flat symbol list.
 *  2. For every `Cs<H>_<N>` match, read the next `N` bytes as the crate
 *     identifier (v0 mangling length-prefix). map[`<N><ident>`] = `<H>`.
 *  3. Stream `src/startup.order`; for each `Cs<H>_<N><ident>` token, if
 *     `<N><ident>` is in the map, replace `<H>` with the live hash.
 *     Unknown crates (e.g. a removed dep) are left as-is — lld drops
 *     the line and the file degrades gracefully.
 *  4. `writeIfChanged` so ninja's `restat` prunes the relink when nothing
 *     moved.
 *
 * Invoked as a ninja build step (see `emitStartupOrder` in rust.ts):
 *
 *   bun rewrite-startup-order.ts --nm=<llvm-nm> --in=<src> --out=<dst> <archive>...
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { writeIfChanged } from "./fs.ts";

function die(msg: string): never {
  process.stderr.write(`rewrite-startup-order: ${msg}\n`);
  process.exit(1);
}

let nm = "nm";
let inPath: string | undefined;
let outPath: string | undefined;
const archives: string[] = [];
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--nm=")) nm = a.slice(5);
  else if (a.startsWith("--in=")) inPath = a.slice(5);
  else if (a.startsWith("--out=")) outPath = a.slice(6);
  else if (a.startsWith("-")) die(`unknown flag ${a}`);
  else archives.push(a);
}
if (inPath === undefined || outPath === undefined || archives.length === 0) {
  die("usage: rewrite-startup-order.ts --nm=<nm> --in=<src> --out=<dst> <archive>...");
}
// llvm-nm is a sibling of llvm-ar in every LLVM install we support; if the
// derived path is wrong (custom toolchain layout), fall back to PATH `nm`.
if (nm.includes("/") && !existsSync(nm)) nm = "nm";

// ─── 1. harvest live disambiguators ───
// `-j` / `--just-symbol-name` keeps the output small (~40 MB of symbol text
// for a release staticlib otherwise). `--defined-only` so we don't pick up
// undefined refs to crates that were LTO'd away.
const r = spawnSync(nm, ["--defined-only", "-j", ...archives], {
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
});
if (r.status !== 0) die(`${nm} failed: ${r.stderr || r.error?.message}`);
const symtab = r.stdout;

/** `<len><ident>` → live `<hash>` (the bit between `Cs` and `_`). */
const live = new Map<string, string>();

// v0 mangling: `Cs<base62-hash>_<decimal-len>` then exactly <len> ident
// bytes. We can't capture the ident with a fixed regex (length is dynamic),
// so match the prefix and slice the ident out by hand.
const tok = /Cs([A-Za-z0-9]+)_(\d+)/g;
for (let m; (m = tok.exec(symtab)); ) {
  const len = Number(m[2]);
  // Guard against the degenerate `Cs_` (no hash) and absurd lengths.
  if (len === 0 || len > 64) continue;
  const identStart = m.index + m[0].length;
  const ident = symtab.slice(identStart, identStart + len);
  if (ident.length !== len || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(ident)) continue;
  const key = m[2] + ident;
  // First-seen wins. A workspace crate has exactly one disambiguator in the
  // final staticlib; if we ever see two it's a host/target std mix-up and
  // either choice is equally wrong, so don't churn.
  if (!live.has(key)) live.set(key, m[1]);
}

// ─── 2. rewrite the template ───
const src = readFileSync(inPath, "utf8");
let hits = 0;
let misses = 0;
const out = src.replace(/Cs([A-Za-z0-9]+)_(\d+)/g, (whole, _oldHash, lenStr, off: number) => {
  const len = Number(lenStr);
  const ident = src.slice(off + whole.length, off + whole.length + len);
  const fresh = live.get(lenStr + ident);
  if (fresh === undefined) {
    misses++;
    return whole; // crate vanished — leave for lld to ignore
  }
  hits++;
  return `Cs${fresh}_${lenStr}`;
});

// ─── 3. write (restat-friendly) ───
writeIfChanged(outPath, out);

// One-line summary so a future "why is startup slow again" has a breadcrumb
// in the build log without re-enabling --warn-symbol-ordering.
process.stderr.write(
  `rewrite-startup-order: ${live.size} crates, ${hits} tokens rewritten` +
    (misses > 0 ? `, ${misses} left stale (crate gone)` : "") +
    "\n",
);
