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
 *  - **path components** themselves drift on a fast-moving codebase: a
 *    module gets renamed (`fs` → `fs_full`), a porting scaffold module
 *    (`___phase_a_body`) is introduced or dissolved, a free fn becomes an
 *    inherent method. None of `Cs`/`Ms`/`B`/`.llvm` rewriting helps — the
 *    canonical form still differs. These are caught by a separate
 *    *demangled-suffix* index: the trailing identifiers of the definition
 *    path (and of the first generic type argument) survive a rename of
 *    something further up the path. See `definitionIdents` / `tailIdx`.
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
 *     Each `_R…` name is *also* run through a best-effort v0 walker
 *     (`definitionIdents`) and indexed by the trailing 2..5 identifiers of
 *     its definition path (and of its first generic type argument) — the
 *     `tailIdx` multimap.
 *  3. For each `_R…` template line, compute the same canonical form and
 *     emit *every* live name that maps to it, in harvest order. lld
 *     ignores any that turn out to be dead, so over-emitting is free.
 *     Canon miss → consult `tailIdx`: if the line's path drifted (a module
 *     renamed, a port-scaffold wrapper module came/went, an `impl` block
 *     moved) but its item identity is intact, the longest-suffix probe
 *     finds the live name(s). Still nothing → per-token `Cs` substitution
 *     (better than nothing for a renamed leaf; lld drops it if truly gone).
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
// When cross-language LTO is on, the staticlib contains LLVM-bitcode members
// alongside regular ELF object members. An older `llvm-nm` (e.g. clang 21)
// can't read newer bitcode (e.g. rustc-LLVM 22 — "Unknown attribute kind"),
// errors per-member, and exits 1 — but it STILL prints symbols for the
// readable members on stdout. We only need symbol names for matching against
// `startup.order`, and the bitcode-only members are precisely the codegen
// units the *linker's* LTO will recompile (so their symbol layout is decided
// at link time anyway). Tolerate the per-member errors as long as stdout has
// content; CI's `link-only` mode has no rustup, so the `--nm=` it gets is the
// system one (#53609, #53656, #53677).
if (r.status !== 0 && r.stdout.length === 0) die(`${nm} failed: ${r.stderr || r.error?.message}`);
if (r.status !== 0)
  process.stderr.write(
    `rewrite-startup-order: ${nm} exited ${r.status} (bitcode-major mismatch on LTO members — ignoring; got ${r.stdout.split("\n").length} symbols from readable members)\n`,
  );
const symtab = r.stdout;

/** Every defined symbol name we've seen, verbatim. */
const defined = new Set<string>();
/** canonical(_R sym) → [live names…] (insertion-ordered, deduped). */
const canon = new Map<string, string[]>();
/** `<len><ident>` → live `<hash>` (the bit between `Cs` and `_`). Fallback path. */
const liveCrate = new Map<string, string>();
/**
 * `<suffix-len>\0<last-N def-path identifiers, \0-joined>` → [live _R names…].
 * Built from `definitionIdents()` over every live `_R` symbol; consulted only
 * when the canonical lookup misses, to rescue an entry whose *path* drifted
 * (a module renamed, a `___phase_a_body`-style port-scaffold module came or
 * went, an `impl` block moved) but whose item identity — the type/module/
 * function names near the leaf, plus its first generic type argument — is
 * unchanged. See `definitionIdents` for why a suffix match is the right key.
 */
const tailIdx = new Map<string, string[]>();

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

/**
 * Best-effort Rust v0-mangling walker. Returns the ordered identifier
 * byte-strings that name a symbol's *definition path* (crate → module → … →
 * item) as `path`, and `path` concatenated with the identifiers of the
 * symbol's first generic type argument as `withArg` — the latter is what
 * distinguishes monomorphizations like `core::ptr::drop_in_place::<T>` whose
 * path alone is generic boilerplate. Impl-paths, trait paths, the trailing
 * `<instantiating-crate>` and back-references contribute nothing: those are
 * exactly the components that drift independently of the function's identity
 * (or are redundant), and the *leaf* of the chain — the part a suffix match
 * keys on — is always spelled out in full in v0, never back-referenced
 * (back-refs only ever abbreviate a repeated *prefix* such as a crate path).
 *
 * Returns `null` on any structure it doesn't recognise; the caller then
 * falls back to per-token `Cs` substitution exactly as before. This is a
 * fuzzy matcher of last resort, not a real demangler — over- or under-
 * collecting an identifier only ever widens or narrows a suffix match, never
 * makes it wrong: lld drops dead names under `--no-warn-symbol-ordering`.
 */
function definitionIdents(mangled: string): { path: string[]; withArg: string[] } | null {
  let s = mangled;
  if (!s.startsWith("_R")) return null;
  s = s.slice(2);
  // Drop trailing `.llvm.<N>` ThinLTO suffix / `.<N>` ICF-clone suffix /
  // any other `.`-introduced vendor suffix.
  const dot = s.indexOf(".");
  if (dot >= 0) s = s.slice(0, dot);
  const N = s.length;
  let i = 0;
  let budget = 8192; // structural-node ceiling — bail on pathological input
  let firstArgOut: string[] | null = null;
  let allowArgCapture = s[0] === "I"; // only the outermost instantiation counts

  const isLower = (c: string) => c >= "a" && c <= "z";
  const isB62 = (c: string) => (c >= "0" && c <= "9") || (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
  const isDigit = (c: string) => c >= "0" && c <= "9";
  const isHex = (c: string) => (c >= "0" && c <= "9") || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
  const bail = (): never => {
    throw new Error("v0-parse");
  };
  const tick = () => {
    if (--budget < 0) bail();
  };
  const eat = (c: string) => {
    if (s[i] !== c) bail();
    i++;
  };
  const base62 = () => {
    // `<base-62-number> ::= { <0-9a-zA-Z> } "_"`
    while (i < N && isB62(s[i]!)) i++;
    eat("_");
  };
  const maybeLifetime = () => {
    if (s[i] === "L") {
      i++;
      base62();
    }
  };
  const maybeDisambiguator = () => {
    // `<disambiguator> ::= "s" <base-62-number>` — optional before an
    // `<identifier>`, present after `C`. `s` cannot begin an identifier
    // (those start with a digit, or `u` for punycode), so this is
    // unambiguous.
    if (s[i] === "s") {
      i++;
      base62();
    }
  };
  const undisambiguatedIdent = (sink: string[] | null) => {
    if (s[i] === "u") i++; // punycode flag — keep the raw bytes, don't decode
    if (!isDigit(s[i] ?? "")) bail();
    let j = i;
    while (j < N && isDigit(s[j]!)) j++;
    const len = Number(s.slice(i, j));
    i = j;
    if (i < N && s[i] === "_") i++; // length↔bytes separator (only when needed)
    if (i + len > N) bail();
    const bytes = s.slice(i, i + len);
    i += len;
    if (len > 0 && sink) sink.push(bytes);
  };

  // `path` / `type` / `constArg` / `fnSig` / `dynBounds` are mutually
  // recursive (function declarations hoist within this function body).
  function path(sink: string[] | null): void {
    tick();
    switch (s[i]) {
      case "C": // crate root
        i++;
        maybeDisambiguator();
        undisambiguatedIdent(sink);
        return;
      case "N": // "N" <namespace-char> <path> <identifier>
        i++;
        if (i >= N) bail();
        i++; // the one-letter namespace
        path(sink);
        maybeDisambiguator();
        undisambiguatedIdent(sink);
        return;
      case "M": // "M" <impl-path> <type>  →  <T>; the name lives in <type>
        i++;
        maybeDisambiguator();
        path(null); // impl-path (where the impl block is written) — discard
        type(sink);
        return;
      case "X": // "X" <impl-path> <type> <path>  →  <T as Trait>; name in <type>
        i++;
        maybeDisambiguator();
        path(null);
        type(sink);
        path(null); // trait path — discard (keying on it would alias every impl)
        return;
      case "Y": // "Y" <type> <path>  →  <T as Trait> (trait def); name in <type>
        i++;
        type(sink);
        path(null);
        return;
      case "I": {
        // "I" <path> {<generic-arg>} "E"  →  instantiation
        i++;
        path(sink);
        const capture = allowArgCapture;
        allowArgCapture = false;
        const firstType: string[] = [];
        let captured = false;
        while (s[i] !== "E") {
          if (i >= N) bail();
          if (s[i] === "L") {
            i++;
            base62();
            continue;
          } // lifetime argument
          if (s[i] === "K") {
            i++;
            constArg();
            continue;
          } // const argument
          if (capture && !captured) {
            type(firstType);
            captured = true;
          } else {
            type(null);
          }
        }
        eat("E");
        if (capture && firstType.length) firstArgOut = firstType;
        return;
      }
      case "B": // back-reference — abbreviates a repeated prefix; nothing to add
        i++;
        base62();
        return;
      default:
        bail();
    }
  }
  function type(sink: string[] | null): void {
    tick();
    const c = s[i];
    if (c === undefined) bail();
    if (isLower(c)) {
      i++; // `<basic-type>` — a single lowercase letter (u8, bool, str, …)
      return;
    }
    switch (c) {
      case "C":
      case "N":
      case "M":
      case "X":
      case "Y":
      case "I":
      case "B":
        path(sink);
        return;
      case "A": // [T; N]
        i++;
        type(sink);
        constArg();
        return;
      case "S": // [T]
        i++;
        type(sink);
        return;
      case "T": // (T1, T2, …)
        i++;
        while (s[i] !== "E") {
          if (i >= N) bail();
          type(sink);
        }
        eat("E");
        return;
      case "R": // &T
      case "Q": // &mut T
        i++;
        maybeLifetime();
        type(sink);
        return;
      case "P": // *const T
      case "O": // *mut T
        i++;
        type(sink);
        return;
      case "F": // fn(…) -> …
        i++;
        fnSig();
        return;
      case "D": // dyn Trait + …
        i++;
        dynBounds();
        maybeLifetime();
        return;
      default:
        bail();
    }
  }
  function constArg(): void {
    // `<const> ::= <type> <const-data> | "p" | <backref>`
    tick();
    if (s[i] === "B") {
      i++;
      base62();
      return;
    }
    if (s[i] === "p") {
      i++;
      return;
    } // placeholder `_`
    type(null);
    // `<const-data>`: optional `n` (negative), base-16 digits, terminating `_`.
    if (s[i] === "n") i++;
    while (i < N && isHex(s[i]!)) i++;
    eat("_");
  }
  function fnSig(): void {
    if (s[i] === "G") {
      i++;
      base62();
    } // `<binder>` (for<…>)
    if (s[i] === "U") i++; // unsafe
    if (s[i] === "K") {
      i++;
      if (s[i] === "C")
        i++; // extern "C"
      else undisambiguatedIdent(null); // extern "<abi>"
    }
    while (s[i] !== "E") {
      if (i >= N) bail();
      type(null);
    }
    eat("E");
    type(null); // return type
  }
  function dynBounds(): void {
    if (s[i] === "G") {
      i++;
      base62();
    } // `<binder>`
    while (s[i] !== "E") {
      if (i >= N) bail();
      path(null); // `<dyn-trait>` path
      while (s[i] === "p") {
        // `<dyn-trait-assoc-binding> ::= "p" <undisambiguated-identifier> <type>`
        i++;
        undisambiguatedIdent(null);
        type(null);
      }
    }
    eat("E");
  }

  const pathChain: string[] = [];
  try {
    path(pathChain);
    // `<instantiating-crate>` (a `<path>`) may follow — discard it.
    if (i < N && s[i] !== ".") path(null);
  } catch {
    return null;
  }
  if (pathChain.length === 0) return null;
  const withArg = firstArgOut && (firstArgOut as string[]).length ? pathChain.concat(firstArgOut) : pathChain;
  return { path: pathChain, withArg };
}

/** Cap on how many live names accumulate under one `tailIdx` key. */
const TAIL_BUCKET_CAP = 64;
/** Suffix lengths we both index and probe (`min(len, …)` clamps the upper end). */
const TAIL_MAX_SUFFIX = 5;
/**
 * A suffix match is only *accepted* when it resolves to at most this many live
 * names. Generic-fn boilerplate paths (`core::ptr::drop_in_place`,
 * `hashbrown::raw::RawTable::reserve_rehash`, …) are shared by hundreds of
 * monomorphizations; matching one entry against all of them would drag a pile
 * of cold cleanup code into the hot window — worse than leaving the entry
 * de-clustered. A genuine `Type::method` rename resolves to a small handful.
 */
const TAIL_MATCH_CAP = 8;

function indexDefinitionTail(sym: string): void {
  const di = definitionIdents(sym);
  if (di === null) return;
  const chains = di.withArg === di.path ? [di.path] : [di.path, di.withArg];
  for (const chain of chains) {
    for (let L = 2; L <= Math.min(chain.length, TAIL_MAX_SUFFIX); L++) {
      const key = L + "\0" + chain.slice(chain.length - L).join("\0");
      let bucket = tailIdx.get(key);
      if (bucket === undefined) tailIdx.set(key, (bucket = []));
      else if (bucket.length >= TAIL_BUCKET_CAP || bucket.includes(sym)) continue;
      bucket.push(sym);
    }
    // A single, very distinctive leaf (≥8 bytes) is the last resort — keyed
    // separately so the L=2..5 probes always take precedence.
    const leaf = chain[chain.length - 1];
    if (leaf !== undefined && leaf.length >= 8) {
      const key = "1\0" + leaf;
      let bucket = tailIdx.get(key);
      if (bucket === undefined) tailIdx.set(key, (bucket = []));
      else if (bucket.length >= TAIL_BUCKET_CAP || bucket.includes(sym)) continue;
      bucket.push(sym);
    }
  }
}

/**
 * Live `_R` symbol whose path drifted but whose item identity survived: probe
 * `tailIdx` longest-suffix-first, then (only for a very distinctive leaf) the
 * single-identifier bucket. Returns the matching live names, or `undefined`.
 */
function suffixResolve(line: string): string[] | undefined {
  const di = definitionIdents(line);
  if (di === null) return undefined;
  const probe = (chain: string[]): string[] | undefined => {
    for (let L = Math.min(chain.length, TAIL_MAX_SUFFIX); L >= 2; L--) {
      const hit = tailIdx.get(L + "\0" + chain.slice(chain.length - L).join("\0"));
      // Reject crowds at *every* length: a short suffix that resolves to a
      // herd is generic boilerplate, not the renamed item we're after.
      if (hit !== undefined && hit.length > 0 && hit.length <= TAIL_MATCH_CAP) return hit;
    }
    // A single, very distinctive leaf (≥8 bytes) — accepted only for a
    // tiny result set, since one identifier is the weakest possible key.
    const leaf = chain[chain.length - 1];
    if (leaf !== undefined && leaf.length >= 8) {
      const hit = tailIdx.get("1\0" + leaf);
      if (hit !== undefined && hit.length > 0 && hit.length <= 4) return hit;
    }
    return undefined;
  };
  // `withArg` first: a generic monomorphization is identified by its type
  // argument, not by its boilerplate definition path.
  return (di.withArg !== di.path ? probe(di.withArg) : undefined) ?? probe(di.path);
}

function indexRust(sym: string): void {
  defined.add(sym);
  const key = canonicalise(sym);
  const bucket = canon.get(key);
  if (bucket === undefined) canon.set(key, [sym]);
  else if (!bucket.includes(sym)) bucket.push(sym);
  indexDefinitionTail(sym);
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
  // places. LLVM's hot/cold splitting and `-fno-reorder-functions` land
  // some bodies in `.text.unlikely.<sym>` / `.text.hot.<sym>` /
  // `.text.startup.<sym>` instead of bare `.text.<sym>`; the symbol name
  // (and thus the order-file key) is the same, so accept the optional
  // section-kind prefix and harvest those too. Every harvested name lands
  // in the canon multimap alongside the staticlib's pre-LTO bare name, so
  // the template emits *all* live variants (bare + `.llvm.<N>`-suffixed +
  // section-split) — lld silently drops whichever ones don't apply under
  // `--no-warn-symbol-ordering`, so over-emitting is free and a stale
  // suffix from last build's CGU partitioning never masks the fresh one.
  const sec = /\.text\.(?:unlikely\.|hot\.|startup\.)?((?:_R|_Z)[A-Za-z0-9_$.]+)\)/g;
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
let suffixMatched = 0;
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
    // Canonical miss. Before giving up, try a demangled-suffix match: the
    // entry's *path* may have drifted (a module renamed, a port-scaffold
    // wrapper module came/went, an `impl` block moved) while the item itself
    // — its type/module/function names near the leaf, plus its first generic
    // type argument — is unchanged. `tailIdx` is keyed on exactly that.
    const suffixHit = suffixResolve(line);
    if (suffixHit !== undefined) {
      suffixMatched++;
      // Cap the fan-out: a loose `Type::method` suffix can collect a handful
      // of monomorphizations — fine — but never a flood.
      for (const real of suffixHit.slice(0, 24)) emit(real);
      continue;
    }
    // Still nothing — fall back to per-token `Cs` substitution so a symbol
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
    `; ${exact} exact, ${resolved} canon-resolved, ${suffixMatched} suffix-matched, ` +
    `${cxxFolded} C++ variant, ${fallback} Cs-fallback` +
    (misses > 0 ? `, ${misses} stale` : ``) +
    `\n`,
);
