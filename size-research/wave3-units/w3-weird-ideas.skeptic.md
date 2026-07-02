# SKEPTIC — w3-weird-ideas

Unit report: `/tmp/wf3/out/w3-weird-ideas.report.md` (on disk; matches the fallback copy).
Every number below was RE-DERIVED from scratch by ADDRESS from `/tmp/canary/nm-dem.txt`
and by RE-EXTRACTING + RE-COMPRESSING the real bytes from the shipped canary's `.rodata`
(`llvm-readelf -S`: VA `0x211000`, size 21,623,360 B — both confirmed). Every "RUN on the
live canary" below is `/tmp/canary/bun-linux-x64/bun`, `--revision` = `1.4.0-canary.1+eba370b69`
(pre-#33224; repo HEAD `6f5ef8a632` IS #33224 — the report's "do not double-count" is right).

---

## VERDICTS

**VERDICT W1 (`embedded-js-zstd`, -1.306): CONFIRMED** — byte-for-byte re-derived. I attacked
the perf-neutrality argument with a WORKING oracle (the report's own oracle is broken — see
Methodology flaw M1) and it survives. Net-new over the banked inventory = **+0.995 MB
(MEASURED, not estimated)**. Two material corrections a PR author must carry (below).

**VERDICT W2 (`rootcerts-zstd`, -0.0745): CONFIRMED** — byte-exact on the real .rodata bytes;
the `std::call_once` is read from source. ONE FILE-PATH ERROR: the JS getter is in
`src/jsc/bindings/NodeTLS.cpp:19` (`getBundledRootCertificates`), NOT `BunObject.cpp`, and
there are TWO `root_certs[]` readers to redirect, not one.

**VERDICT W3 (`completions-zstd`, -0.0437): CONFIRMED** — exact. All three scripts found
byte-identical in .rodata at exactly the claimed offsets; the consumer set is even smaller
than the report claims (only `install_completions_command.rs:234,285,547`).

**VERDICT W4 (`bun-sections-nobits`, -0.018): CONFIRMED on the bytes, with the report's OWN
stated gate standing.** `.bun` = 16,384 B / 0 nonzero, `.bun_err` = 2,788 B / 0 nonzero
(re-measured). I supply the LLVM-source citation the report lacked for its mechanism claim.
The `.bun` half's `--compile`-writer dependency is real and MUST be gated as the report says.

**VERDICT W5 (`jsbuiltins-combined-zstd`, -0.321, A-GATED): CONFIRMED AS GATED.** Bytes exact
(`WebCore::combinedSourceCodeBuffer` 252,941 B, `JSC::s_JSCCombinedCode` 136,133 B). The gate
(decompress site is VM init, not a lazy branch) is HONEST and MUST stay — do not promote to
Tier A without the one `hyperfine 'bun -e null'`. Supersedes row 18 + B7 (declared).

**VERDICT W6 (`yarr-kstrings-lazy`, 0.085 ceiling, LOW): CONFIRMED AS A LEAD ONLY** (the
report banks 0 for it; correct). New supporting fact: I dumped the tables — they are 32-bit
code-point sequences (U+1F468 U+200D U+2764 U+FE0F U+1F3FB …) = the `\p{RGI_Emoji}`
ZWJ-SEQUENCE data for the `v`-flag `unicodeSets` string properties, an extremely rare
feature. Still needs the compile-vs-match-time classification before anyone banks it.

**VERDICT W7 (`react-compiler-out-of-band`, 1.05, Tier C): no verdict needed** — the report
itself does not recommend it. The by-address number re-derives to 1.0514 MB / 1,130 addrs.

---

## EVIDENCE — re-derivations (every number reproduced, by address)

### F1 / W1 sizing — EXACT

`grep 'InternalModuleRegistryConstants::.*CodeBytes' nm-dem.txt` → exactly **158** `r`
symbols at **158 unique addresses** (zero ICF aliases among them — by-name == by-address
here). By-address sum = **1,756,925 B**; span 1,758,159; padding 1,234. All byte-exact.
All 158 are pure-ASCII JS source + exactly ONE trailing NUL each (0 inner NULs, 0 high
bytes) — so the real SOURCE is 1,756,767 chars; the first bytes of the lowest-address one
read `(function (){"use strict";// build/release/tmp_modules/bun/ffi.ts\nvar $, FFIType =`.

### F2 / W1 compression — EXACT

Extracted all 158 at `(addr - 0x211000)` from the section dump and per-item zstd-19'd with
the canary's OWN `node:zlib.zstdCompressSync`:
**per-item zstd-19 = 387,811 B → saving 1,369,114 B = 1.3057 MB.** zstd-22 = 387,803
(report: 387,803 — exact). Whole-blob zstd-19 of my concatenation = 286,350 (report said
287,712 — a 1.3 KB difference from padding handling; immaterial, both ≈1.40 MB).

### F3 / W1 laziness — CONFIRMED, but with a BETTER oracle and a material gap closed

**The C++ `requireId` root set is CLOSED and every site is gated — all read from source:**
- `InternalModuleRegistry.cpp:162-173` `requireId`: `if (!value || value.isUndefined())`
  — the generate body runs exactly once per (module, VM). Verbatim.
- `src/jsc/VirtualMachine.rs:2296-2317`: `Bun__preExecutionBootstrap` is behind
  `fn is_bootstrap_flag(arg) = arg.starts_with("--trace-") || arg.starts_with("--stack-trace-limit")`
  scanned over argv + worker execArgv. The report's comment quote is verbatim AND the gate
  is real in the Rust caller, not just the comment.
- `ExposeNodeModuleGlobals.cpp:77-94` `Bun__ExposeNodeModuleGlobals` installs ONLY
  `CustomGetterSetter` lazy getters, and is only called under `bun -e`/`--print`
  (`run_command.rs:1334` `if !ro.eval.script.is_empty()`) + `bun repl`.
- `ZigGlobalObject.cpp:2468` `m_internalModuleRegistry.initLater(...)` — it IS a LazyProperty.
- `ZigGlobalObject.cpp:2189` — inside `m_utilInspectFunction.initLater` (a LazyProperty).
  I PROVED `console.log({deep object})` does NOT trigger it (see the oracle below).
- `BunProcess.cpp:3223-3226` — `processBindingUtil` = `process.binding("util")`. Lazy.
- `BunDebugger.cpp:628`, `BunObject.cpp:320,332`, `HTMLEntryPoint.cpp:16` — all as claimed.
- The generated constants header is `#include`d by exactly ONE TU (`InternalModuleRegistry.cpp:12`
  + the `createInternalModuleById.h` at `:175`). 158 unique addresses confirm no TU duplication.

**EMPIRICAL, with a WORKING oracle (the report's was broken — M1):** I parsed the canary's
V8 heap snapshot and counted the outgoing edges of the `InternalModuleRegistry` heap object
(internal fields of loaded modules are cells → edges; `jsUndefined()` fields are not):

| startup path | registry edges | heap node_count | loaded internal modules |
|---|---:|---:|---|
| `bun file.cjs` (empty) | 1 | 2,460 | **0** |
| `bun -e 'console.log("hi")'` (deep objects too) | 1 | 2,463 | **0** |
| **`bun test` (real `bun:test` run)** | 1 | 2,723 | **0** — even stronger than the report claimed |
| `throw` / `process.on('uncaughtException')` / sourcemapped stack | 1 | — | 0 |
| `import("node:os")` | 2 | — | 1 |
| `new Worker()` (parent VM) | 6 | — | 5 |
| **`process.stdout.write` / `process.stderr.write("")` / `process.stdout.isTTY`** | **34** | 8,295-8,342 | **33** |

So: **"ZERO modules are evaluated on any unconditional startup path" is TRUE** — and I
extend it to `bun test`. `bun --version` / `bun -e ''` / `bun hello.js` gain literally 0 ns.

### F4 / W1 perf-ratio — CONFIRMED, extended to the WORST realistic trigger

The report's F4 per-module source-byte column re-derives EXACTLY from nm: NodeHttp 3,610,
NodeCrypto 13,010, NodeAssert 21,553, NodeChildProcess 38,665, NodeWorkerThreads 14,144.
The 0.09% headline row IS a cherry-pick (node:http is a 3.6 KB stub whose require does
11 ms of work). So I measured the FAIR worst case — the one the report MISSED (G1 below):

- Cold first `process.stdout.isTTY` on the canary (best of 15 process runs):
  **11.41 ms** — that is the 33-module parse+evaluate cascade that ALREADY happens today.
- The added W1 cost on that path: decompressing the closure's zstd blobs (the 24 of 33 I
  could needle-identify: 328,544 B raw → 70,246 B zstd) is **~0.42 ms** through the
  pessimistic `node:zlib` JS wrapper (best of 300), so the whole 33-module closure is
  **≲ 0.5 ms added to an 11.4 ms one-time path = ~4%**, right at the top of F4's band.

**So F4's band [0.09%, 3.9%] is real, and the genuine worst case sits at ~4%. One-time,
cached forever, on an already-11-ms lazy path. The perf-neutrality argument SURVIVES.**

### F5 / zstd decoder already linked — CONFIRMED
`ZSTD_decodeFrameHeader` (508 B), `ZSTD_decompressContinue` (1,645 B),
`ZSTD_decompressMultiFrame` (2,346 B) all present as local `t` in nm-dem.txt.
`ZSTD_decompress`/`ZSTD_getFrameContentSize` themselves are LTO-internalized away; a fresh
link with a new C++ caller resolves them from the vendored `libzstd.a`. Zero new code.
Row 11 (zstd-null-cdict) only nulls `blockCompressor`/`rowBasedBlockCompressors`/
`getAllMatchesFns` in `zstd_compress.c`/`zstd_opt.c` — the decompress side is untouched;
COMPATIBLE, as the report says.

### F7 / lifetime model — CONFIRMED from source
`InternalModuleRegistry.cpp:36-53`: `generateModule(... const String& SOURCE ...)` →
`makeSource(SOURCE, origin, Untainted, moduleName)` → `createBuiltinExecutable(...)`.
Today SOURCE is a zero-copy, rodata-backed StringImpl; after W1 it is a heap-owned
StringImpl of the same refcounted type held by the same SourceProvider. `toString()` is
byte-identical by construction. The `#ifdef BUN_DYNAMIC_JS_LOAD_PATH` debug branch at
`:100-115` is the untouched `#else` sibling (and the debug codegen at
`bundle-modules.ts:392-405` already emits EMPTY arrays — the change is release-only).
`declareASCIILiteral` really is `helpers.ts:34`; the two emit sites really are
`bundle-modules.ts:384` (release) and `:401` (debug).

### F8 / root certs (W2) — CONFIRMED byte-for-byte
`rodata[848,844 .. 1,028,565]` = **179,721 B**, containing exactly **120** `BEGIN
CERTIFICATE` + **120** `END CERTIFICATE` markers with **119 interior NULs** (the 120 C
string literals' terminators), immediately followed by a NUL then unrelated data — a
contiguous blob. zstd-19 → **101,589 B**. Saving **78,132 B = 0.0745 MB**. EXACT.
Live canary: `require("node:tls").rootCertificates.length === 120`.
`root_certs.cpp:152-153` is verbatim `static std::once_flag root_cert_instances_once;
std::call_once(root_cert_instances_once, [&]() { ... root_certs[i] ... })`; two more
`call_once`s at :197-198, :264-265 as claimed. The nm `b` symbol
`us_internal_init_root_certs(...)::root_cert_instances_once` (4 B, addr 80,572,628) exists.

### F9 / completions (W3) — CONFIRMED byte-for-byte
`completions/bun.{bash,zsh,fish}` = 8,671 + 38,720 + 9,425 = **56,816 B**, each found
BYTE-IDENTICAL in the canary's .rodata at EXACTLY the claimed offsets (16,584,075 /
16,592,746 / 16,631,466). Per-item zstd-19 = 11,033 B. Saving **45,783 B = 0.0437 MB**.
EXACT. `shell_completions.rs` really is the three `include_bytes!` at the claimed lines,
and the ONLY readers of `.completions()` are `install_completions_command.rs:234,285,547`.

### F10 / `.bun`+`.bun_err` (W4) — CONFIRMED, mechanism now CITED
Re-measured: `.bun` 16,384 B / **0 nonzero**; `.bun_err` 2,788 B / **0 nonzero**.
`c-bindings.cpp:1058` `#define BLOB_HEADER_ALIGNMENT 16 * 1024`; `:1078`
`__attribute__((section(".bun"), aligned(BLOB_HEADER_ALIGNMENT), used)) BUN_COMPILED = {0}`.
`bun_core/lib.rs:1146` `link_section = ".bun_err"` on 2-byte `AtomicU16::new(0)` statics.
**The report's mechanism claim ("a zero-initialized global with an EXPLICIT section
attribute is emitted PROGBITS") is TRUE — here is the upstream citation it lacked:**
LLVM `llvm/lib/Target/TargetLoweringObjectFile.cpp`, `TargetLoweringObjectFile::getKindForGlobal()`,
inside `if (isSuitableForBSS(GVar))`: **`// If the global has an explicit section specified,
don't put it in BSS.` → `if (GVar->hasSection()) return SectionKind::getData();`** — that
one line is the entire 19,172 B. (So `link_section` alone can never fix it; the fixes are a
linker-script output-section TYPE, or dropping the explicit section, or the report's
BLOB_HEADER_ALIGNMENT shrink.)

### F11 / rodata symbol sweep — CONFIRMED to the byte, one miss
`WebCore::combinedSourceCodeBuffer` **252,941 B @ 21,629,312** (exact; the generator
`bundle-functions.ts:453` `static const Latin1Character combinedSourceCodeBuffer[...]` is
real). `JSC::s_JSCCombinedCode` **136,133 B** (exact). All 7 `JSC::Yarr::kStrings*Data`
present, by-address sum **89,568 B** (exact; 367=44,784, 373=35,508). `_wordcharData`/
`_spacesData` 65,536 each (B4, owned). The 5 ICU tries total 194,180 B (consistent).
`ecp_nistz256_precomputed` 151,552, `k25519Precomp` 24,576. `kGraphemeBreakStage2` 32,512.
**MISS: `bssl::kObjects` is NOT in nm-dem.txt** under any spelling — brainstorm item 13
(a dead_end/handoff, not a proposal) cites a symbol that does not exist. Zero ledger impact.
**F12's B5 correction is CONFIRMED:** `bmalloc_megapage_table` + `tagged_bmalloc_megapage_table`
are each 65,544 B `d` symbols (and `bmalloc_marge_page_header_table` is only 16 B) — B5's
0.125 number is right and its recipe is wrong, exactly as the report says.

---

## THE EJ1 INTERACTION — MEASURED (the single most load-bearing number)

The report's interaction section was an ESTIMATE. I MEASURED it. The shipped sources use
JSC `@privateName` builtin syntax (148/158 fail a naive `Bun.Transpiler` pass). A
length-preserving, syntax-valid `@`→`$` substitution (both 1 byte; `$name` is bun's own
pre-codegen src/js spelling) + `Bun.Transpiler({minifyWhitespace:true, deadCodeElimination:false})`
on all 158, then per-item zstd-19 of the minified output, all with the canary's own tools:

| | bytes | saving MB |
|---|---:|---:|
| raw (158 sources, no NULs) | 1,756,767 | — |
| **W1 alone** (per-item zstd-19 of raw) | 387,574 | **1.3058** |
| **EJ1 alone** (minify-whitespace) | 1,387,903 | **0.3518** ← independently reproduces SYNTHESIS2 row 3's MEASURED 0.349 to 0.8%, which validates the whole method |
| **COMBINED** (minify then per-item zstd-19) | 347,658 | **1.3438** |
| W1's incremental over EJ1 | | **+0.9921** |
| EJ1's incremental over W1 | | **+0.0381** |

**Every one of the report's interaction claims is CONFIRMED to 3 significant figures:**
combined "in [-1.33, -1.36]" → 1.344. "row 3's credit drops to ~0.03-0.05" → 0.038.
"W1's net-new = +0.99 to +1.01" → +0.99. The synthesizer MUST credit the pair at 1.344
total (not 1.306 + 0.349 = 1.655), i.e. W1 adds exactly **+0.995 MB** over the banked
inventory. (W1 and EJ1 are INDEPENDENT and STACK; landing both is strictly best.)

## DUPLICATION SWEEP vs SYNTHESIS2 — CLEAN

grep of SYNTHESIS2 for root-cert / certificate / completion / `.bun_err` / `.bun section` /
`combinedSource` / `s_JSCCombinedCode` / `kStrings` / `BlobHeader` / `BUN_COMPILED` /
`zstd.*158`: the ONLY hits are row 18 (EJ2 → W5's declared supersession) and row 23
(`internal-module-switch-to-table`, 0.018 of `.text` switch CODE — byte-disjoint from W1's
`.rodata`). **W2, W3, W4, W6 have ZERO prior-wave overlap. W1's sole overlap (row 3) and
W5's (row 18 + B7) are both declared and now quantified. Nothing re-opens the DISCARDED
list** — W1 is not section-compression/UPX (which is dead because it breaks `--compile`'s
by-name lookup); it is the exact shape size-facts' hard constraint EXPLICITLY allows
("lazy-decompress a COLD item on first use, cached forever … on paths that are already
lazy one-time initialization"), and `requireId`'s `if (!value || value.isUndefined())`
cached-field check IS a pre-existing lazy one-time init by construction.

---

## WHAT THE REPORT GOT WRONG OR MISSED (none fatal; carry into the PRs)

**M1 — The report's "empirical confirmation" oracle is VACUOUS.** Its in-process
`node:inspector` `Debugger.enable` replay returns **0** `scriptParsed` events on the canary
for EVERYTHING — including the `[eval]` script and `node:inspector` itself, which are
provably parsed. So "0 builtin:// sources" was true for the wrong reason (the oracle can't
see anything). The conclusion is nevertheless CORRECT — I re-proved it with a working
oracle (the registry's internal-field edge count in the V8 heap snapshot). An implementer
must not reuse the report's oracle. (The report DID honestly falsify its own pagemap probe;
it should also have falsified this one.)

**G1 — A hot trigger class the report never names: `process.stdout`/`process.stderr`.**
F3's requireId audit is C++-only. The far larger caller population is the `src/js` side
(`$getInternalField($internalModuleRegistry, N) || $createInternalModuleById(N)` — every
inter-module `require`, and the `process.stdout` lazy getter). The FIRST
`process.stdout.write(...)` / `process.stderr.write(...)` / `process.stdout.isTTY`
(i.e. the first thing chalk/picocolors/any logger does) loads **33 of the 158** — an
11.4 ms one-time cascade TODAY. W1 adds ~0.5 ms (~4%) to it. NOT a refutation (it is a
lazy cached one-time path, inside F4's band), but it MUST be in the PR description:
"the decompress cost is ≲4% of the already-lazy 11 ms module cascade it precedes, even
on the hottest real-world trigger (the first stdout/stderr write)." `console.log` is
native and loads 0.

**G2 — W1's RSS ledger understates the multi-VM case.** Today N workers share ONE
file-backed copy of a loaded module's source (rodata + page cache). After W1, each VM
allocates its OWN decompressed anon copy. 8 workers each loading the http closure ≈ 8× the
anon bytes vs 1× shared today. The report says "per (module, VM)" once but writes the RSS
ledger per-process. Same tradeoff class as the already-A-ranked brotli row 6 and the
already-SHIPPED `patches/lshpack/bss-huff-tables.patch`; the hard constraint is about
perf, not RSS, and the report's per-module exclusion-list escape hatch handles any outlier.
State it honestly in the PR.

**G3 — W2's JS-getter file is wrong.** `tls.rootCertificates` is
`src/jsc/bindings/NodeTLS.cpp:19` `getBundledRootCertificates`, which calls
`us_raw_root_certs()` → `root_certs.cpp:167-169` `us_internal_raw_root_certs` →
`*out = root_certs;` — a SECOND reader of the raw array, OUTSIDE the `call_once`. So W2
has exactly TWO sites to redirect to the decompressed buffer: `root_certs.cpp:156` (inside
the `call_once`) and `root_certs.cpp:168`. Not `BunObject.cpp`. Trivial, but an implementer
following the report's file list literally would miss `tls.rootCertificates`.

**G4 — Small factual errata.** (a) `bssl::kObjects` (brainstorm #13, a handoff) is not in
nm under any name. (b) F4's 0.09% row is a cherry-pick; quote the 4% worst case instead.
(c) The 158 arrays each carry a trailing NUL (the source is 1,756,767 chars). (d)
`c-bindings.cpp` lines are 1058/1078, not 1059/1078 (±1). All immaterial to the numbers.

---

## BOTTOM LINE

The report's headline is **REAL and now independently reproduced end-to-end on the shipped
binary.** Nobody in 29 prior units proposed compressing these bytes (grep-verified against
SYNTHESIS2), the load path's laziness is now proven by TWO independent working oracles
plus a complete source audit, and the F4 perf bound holds at the genuine worst case. W1 is
the largest single skeptic-surviving Tier-A find of any wave.

**credible NEW (non-duplicate) total MB for this unit:**

| proposal | MB | status |
|---|---:|---|
| W1 net-new over the banked inventory (= combined 1.344 − row 3's 0.349) | **0.995** | CONFIRMED, MEASURED |
| W2 root-certs | **0.075** | CONFIRMED |
| W3 completions | **0.044** | CONFIRMED |
| W4 `.bun`/`.bun_err` | **0.018** | CONFIRMED on bytes; gated on the report's own `--compile` round-trip test |
| W5 net-new (0.321 − row 18 − B7) | (0.26) | A-GATED — do NOT bank without one startup benchmark |
| W6 / W7 | 0 | lead / Tier C, correctly not banked |

**credible NEW (non-duplicate) total MB for this unit: 1.11 MB (Tier A, certain) — 1.13 MB
including the `--compile`-gated W4 — plus an A-GATED +0.26 from W5.**

That closes SYNTHESIS2's 0.65 MB linux A+B shortfall with ~0.46-0.48 MB of margin and zero
Tier-C asks, exactly as the report claims (its "~+1.13" and "~5.34 total" both reproduce).
On windows (need 2.00 MB), W1 alone at ~1.30 is 65% of the gap.
