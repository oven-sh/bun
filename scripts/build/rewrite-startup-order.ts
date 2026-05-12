#!/usr/bin/env bun
/**
 * Resolve `src/startup.order` against the just-built object code so that
 * `-Wl,--symbol-ordering-file=` actually matches what lld is about to lay
 * out, then write the result to `${buildDir}/startup.order.resolved`.
 *
 * ## Why
 *
 * Every Rust symbol in the order file embeds one or more
 * `Cs<base62-hash>_<len><crate>` tokens (the v0 mangling "instantiating
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
 * The naive fix — regex-substitute each `Cs<hash>_` token — is what this
 * script originally shipped. It is *insufficient* on its own because three
 * other v0-mangling components also drift independently of call order:
 *
 *  - **`B<n>_` back-references** encode a *byte offset* into the symbol.
 *    `Cs<hash>` is a base62-encoded u64 with leading zeros stripped, so its
 *    length varies (1–12 bytes). Swapping a 11-char hash for a 12-char one
 *    shifts every subsequent `B<n>_` by one — the rewritten symbol is
 *    well-formed but matches nothing.
 *  - **`Ms<n>_` impl disambiguators** are the source-order index of an
 *    `impl` block within its module. Adding or reordering an `impl` (even a
 *    `#[cfg]`-gated one) renumbers every later block.
 *  - **`.llvm.<N>` ThinLTO suffixes** are appended at *link* time when
 *    ThinLTO promotes an internal-linkage symbol to cross-module. The
 *    staticlib's pre-LTO symtab has the bare name; the laid-out `.text`
 *    section has the suffixed one, which is what `--symbol-ordering-file`
 *    must match. The suffix is `hash(module-identifier)`, so it is stable
 *    across rebuilds while CGU partitioning is unchanged but cannot be
 *    derived from the staticlib alone.
 *
 * On the C++ side, ICF (`-Wl,-icf=safe`) folds Itanium-ABI ctor/dtor
 * variants (`C1`/`C2`, `D0`/`D1`/`D2`). The profiled binary may sample
 * `C1E` while the next link keeps `C2E` as the representative.
 *
 * ## Algorithm
 *
 * Rather than re-encode any of the above, we treat every drifting component
 * as a wildcard and do a **whole-symbol canonical lookup**:
 *
 *  1. `llvm-nm --defined-only -j <archives>` → flat live symbol set.
 *     Additionally, if `--map=<prev linker-map>` is given and exists, scan
 *     it for `.text._R…`/`.text._Z…` section names — this is the only
 *     source of post-LTO `.llvm.<N>` suffixes and post-ICF C++ names. The
 *     map is the *previous* link's output (chicken-and-egg: the order file
 *     is an input to the link that produces the map), but both the ThinLTO
 *     suffix and the ICF representative are content-hashed and survive
 *     rebuilds. First build in a clean dir degrades to staticlib-only.
 *  2. Index every harvested name by its **canonical form**: strip
 *     `Cs<hash>_` → `Cs_`, `Ms<n>_` → `Ms_`, `B<n>_` → `B_`,
 *     trailing `.llvm.<N>` → ∅. Multiple live names may share a canon
 *     (e.g. bare + `.llvm`-suffixed, or two hashbrown major versions).
 *  3. For each `_R…` template line, compute the same canonical form and
 *     emit *every* live name that maps to it, in harvest order. lld
 *     ignores any that turn out to be dead, so over-emitting is free.
 *     Unknown canon → fall back to per-token `Cs` substitution (still
 *     better than nothing for a renamed leaf).
 *  4. For each `_Z…` line not in the live set, retry with the Itanium
 *     ctor/dtor group permutations (`C1`↔`C2`, `D0`/`D1`/`D2`) and emit
 *     the first variant that *is* live.
 *  5. `writeIfChanged` so ninja's `restat` prunes the relink when nothing
 *     moved.
 *
 * Invoked as a ninja build step (see `emitStartupOrder` in rust.ts):
 *
 *   bun rewrite-startup-order.ts --nm=<llvm-nm> --in=<src> --out=<dst> \
 *       [--map=<prev.linker-map>] <archive>...
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
let mapPath: string | undefined;
const archives: string[] = [];
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--nm=")) nm = a.slice(5);
  else if (a.startsWith("--in=")) inPath = a.slice(5);
  else if (a.startsWith("--out=")) outPath = a.slice(6);
  else if (a.startsWith("--map=")) mapPath = a.slice(6);
  else if (a.startsWith("-")) die(`unknown flag ${a}`);
  else archives.push(a);
}
if (inPath === undefined || outPath === undefined || archives.length === 0) {
  die("usage: rewrite-startup-order.ts --nm=<nm> --in=<src> --out=<dst> [--map=<map>] <archive>...");
}
// llvm-nm is a sibling of llvm-ar in every LLVM install we support; if the
// derived path is wrong (custom toolchain layout), fall back to PATH `nm`.
if (nm.includes("/") && !existsSync(nm)) nm = "nm";

// ─── 1. harvest live symbols ───
// `-j` / `--just-symbol-name` keeps the output small (~40 MB of symbol text
// for a release staticlib otherwise). `--defined-only` so we don't pick up
// undefined refs to crates that were LTO'd away.
const r = spawnSync(nm, ["--defined-only", "-j", ...archives], {
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
});
if (r.status !== 0) die(`${nm} failed: ${r.stderr || r.error?.message}`);
const symtab = r.stdout;

/** Every defined symbol name we've seen, verbatim. */
const defined = new Set<string>();
/** canonical(_R sym) → [live names…] (insertion-ordered, deduped). */
const canon = new Map<string, string[]>();
/** `<len><ident>` → live `<hash>` (the bit between `Cs` and `_`). Fallback path. */
const liveCrate = new Map<string, string>();

/**
 * Reduce a v0-mangled name to a form invariant under the four drift sources
 * described above. Order matters: `Cs<h>_` must be stripped before `B<n>_`
 * so a `B` inside a hash isn't mistaken for a back-ref tag, and the `B`/`Ms`
 * patterns are bounded at ≤4 base-62 digits (back-ref offsets / impl indices
 * fit easily; longer runs are real identifiers like `13BSSStringList`).
 */
function canonicalise(sym: string): string {
  return sym
    .replace(/\.llvm\.\d+$/, "")
    .replace(/Cs[0-9A-Za-z]+_/g, "Cs_")
    .replace(/Ms[0-9A-Za-z]{0,4}_/g, "Ms_")
    .replace(/B[0-9A-Za-z]{1,3}_/g, "B_");
}

function indexRust(sym: string): void {
  defined.add(sym);
  const key = canonicalise(sym);
  const bucket = canon.get(key);
  if (bucket === undefined) canon.set(key, [sym]);
  else if (!bucket.includes(sym)) bucket.push(sym);
}

// Archive symtab: every `_R…` line for the canonical index, every `Cs<h>_`
// token for the per-crate fallback, every line for the verbatim set.
{
  const tok = /Cs([A-Za-z0-9]+)_(\d+)/g;
  let lineStart = 0;
  for (let i = 0; i <= symtab.length; i++) {
    if (i < symtab.length && symtab.charCodeAt(i) !== 10) continue;
    const line = symtab.slice(lineStart, i);
    lineStart = i + 1;
    if (line.length === 0) continue;
    defined.add(line);
    if (line.startsWith("_R")) {
      indexRust(line);
      // v0: `Cs<base62>_<decimal-len>` then exactly <len> ident bytes. We
      // can't capture the ident with a fixed regex (length is dynamic), so
      // match the prefix and slice the ident out by hand.
      tok.lastIndex = 0;
      for (let m; (m = tok.exec(line)); ) {
        const len = Number(m[2]);
        if (len === 0 || len > 64) continue;
        const ident = line.slice(m.index + m[0].length, m.index + m[0].length + len);
        if (ident.length !== len || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(ident)) continue;
        const key = m[2] + ident;
        if (!liveCrate.has(key)) liveCrate.set(key, m[1]);
      }
    }
  }
}

// Previous link's `-Wl,-Map=` output: the *only* place post-LTO `.llvm.<N>`
// suffixes and post-ICF `_Z` representatives are observable before the link
// we're about to feed. Best-effort — absent on a clean first build.
let mapLoaded = false;
if (mapPath !== undefined && existsSync(mapPath)) {
  mapLoaded = true;
  const map = readFileSync(mapPath, "utf8");
  // lld map: `<vma> <lma> <size> <align> <obj>:(.text.<sym>)` for input
  // sections. We only care about `.text.*` — that's what the order file
  // places.
  const sec = /\.text\.((?:_R|_Z)[A-Za-z0-9_$.]+)\)/g;
  for (let m; (m = sec.exec(map)); ) {
    const sym = m[1];
    defined.add(sym);
    if (sym.startsWith("_R")) indexRust(sym);
  }
}

// ─── 2. rewrite the template ───
const src = readFileSync(inPath, "utf8");
let exact = 0;
let resolved = 0;
let fallback = 0;
let cxxFolded = 0;
let misses = 0;
const seenOut = new Set<string>();
const outLines: string[] = [];
const emit = (s: string) => {
  // Dedupe across the whole output: the same live symbol can be reached via
  // several template lines once impl-indices/hashes collapse.
  if (seenOut.has(s)) return;
  seenOut.add(s);
  outLines.push(s);
};

// Itanium ctor/dtor groups: each variant is a distinct symbol but ICF folds
// byte-identical bodies, so the profiled name and the kept representative can
// differ. Try every group member. (`C3`/`D3` are the unified COMDAT alias on
// some ABIs — harmless to probe.)
const cxxGroups: ReadonlyArray<readonly string[]> = [
  ["C1E", "C2E", "C3E"],
  ["C1ER", "C2ER", "C3ER"],
  ["D0E", "D1E", "D2E", "D3E"],
  ["D0ER", "D1ER", "D2ER", "D3ER"],
];
function resolveCxx(line: string): string | undefined {
  for (const group of cxxGroups) {
    for (const from of group) {
      const at = line.indexOf(from);
      if (at < 0) continue;
      for (const to of group) {
        if (to === from) continue;
        const cand = line.slice(0, at) + to + line.slice(at + from.length);
        if (defined.has(cand)) return cand;
      }
    }
  }
  return undefined;
}

for (const raw of src.split("\n")) {
  const line = raw.trimEnd();
  // Comments / blanks pass through verbatim (they're not symbols, so no
  // dedupe — preserve the file's section structure for human readers).
  if (line.length === 0 || line.startsWith("#")) {
    outLines.push(line);
    continue;
  }

  if (line.startsWith("_R")) {
    // Always go through the canonical index even if the template line is
    // verbatim-live: ThinLTO may have *also* emitted a `.llvm.<N>`-suffixed
    // sibling, and the suffixed one is what `.text` actually contains.
    // Emitting both is free (lld drops the dead one).
    const bucket = canon.get(canonicalise(line));
    if (bucket !== undefined) {
      if (bucket.length === 1 && bucket[0] === line) exact++;
      else resolved++;
      for (const real of bucket) emit(real);
      continue;
    }
    // Canonical miss — fall back to per-token `Cs` substitution so a symbol
    // that merely moved file (new `Ms` index *and* new module path) still
    // gets its crate hashes freshened. lld ignores it if it's truly gone.
    fallback++;
    const tok = /Cs([A-Za-z0-9]+)_(\d+)/g;
    let i = 0;
    let rewritten = "";
    for (let m; (m = tok.exec(line)); ) {
      const lenStr = m[2];
      const len = Number(lenStr);
      const ident = line.slice(m.index + m[0].length, m.index + m[0].length + len);
      const fresh = liveCrate.get(lenStr + ident);
      rewritten += line.slice(i, m.index) + (fresh !== undefined ? `Cs${fresh}_${lenStr}` : m[0]);
      i = m.index + m[0].length;
    }
    rewritten += line.slice(i);
    emit(rewritten);
    continue;
  }

  if (line.startsWith("_Z")) {
    if (defined.has(line) || !mapLoaded) {
      // Without the map we have no C++ symbol set to probe against; pass
      // through and let lld's existing tolerance handle drift.
      if (defined.has(line)) exact++;
      emit(line);
      continue;
    }
    const alt = resolveCxx(line);
    if (alt !== undefined) {
      cxxFolded++;
      emit(alt);
    } else {
      misses++;
      emit(line);
    }
    continue;
  }

  // C symbols, `_GLOBAL__sub_I_*`, anchors — verbatim.
  emit(line);
}

// ─── 3. write (restat-friendly) ───
writeIfChanged(outPath, outLines.join("\n"));

// One-line summary so a future "why is startup slow again" has a breadcrumb
// in the build log without re-enabling --warn-symbol-ordering.
process.stderr.write(
  `rewrite-startup-order: ${liveCrate.size} crates indexed` +
    (mapLoaded ? ` + linker-map` : ` (no linker-map; first build?)`) +
    `; ${exact} exact, ${resolved} canon-resolved, ${cxxFolded} C++ variant, ` +
    `${fallback} Cs-fallback` +
    (misses > 0 ? `, ${misses} stale` : ``) +
    `\n`,
);
