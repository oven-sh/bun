# SYNTHESIS — bun binary size investigation (18 units, 36 skeptic passes)

Targets (authoritative, from `scripts/binary-size.ts` via size-facts.md):
`bun-linux-x64` 88.46 MB (1.3.14) -> 73.33 MB (main) -> need <= 68.46, **4.87 MB left**.
`bun-windows-x64` 93.92 -> 76.12 -> need <= 73.92, **2.20 MB left**.
Hard constraint: every item must be **performance-neutral or an improvement**.

## Evidence provenance (read this first — it bounds my confidence)

A container restart destroyed all 18 `*.report.md` files and 14 of the 36 skeptic files.
What this synthesis is built from, per unit:

| units | evidence that reached me | confidence in the row |
|---|---|---|
| 07, 08, 09, 11, 12, 13, 14, 15, 16, 17, 18 | **two independent skeptic files each**, every headline number re-derived from the binaries by both | HIGH |
| 10 | one skeptic file + the orchestrator's own relink measurement (Ground Truth #2) | HIGH |
| 07 | one skeptic file (skeptic2) — unusually thorough; its numbers are cross-confirmed by units 13, 17, 18 | HIGH |
| 01 (icu-data), 04 (rust-rodata-strings), 06 (embedded-js) | **Ground Truth only** (the orchestrator's own measured summary in size-facts.md). No skeptic file survived. | GT is orchestrator-measured; HIGH on the numbers, but no independent adversarial pass survived. |
| **02, 03, 05** | **NOTHING.** No report, no skeptic, no ground-truth line naming their avenue. | **ZERO. If these units found anything material, it is lost.** GT #5 ("the easy linker levers are all pulled") reads like one of them (a link-flags unit) concluding 0; unit 12 cross-references "unit 03" re: image-codec backends (a Tier-C determinism question it already answered). Check the orchestrator's journal. |

I independently re-ran three probes to close gaps the restart left (details inline): the ICU item
inventory, the rust-std-backtrace size on the shipped canary, and the two LTO-bloated startup
functions. Everything else is the skeptics' work, which I cross-checked for double-counting.

---

## A. RANKED PROPOSAL TABLE (survivors only; deduplicated; refuted rows removed)

saving_mb is the **linux-x64 delta** unless marked (W)=windows-only. All rows are
perf-neutral-or-better (the hard constraint); none is a -Os/-Oz trick.

### TIER A — zero perf cost, no user-visible regression, implementable in oven-sh/bun

| # | id | saving_mb | conf | risk | regression | windows | relink_only | effort | summary |
|--|----|-----------|------|------|------------|---------|-------------|--------|---------|
| 1 | **embedded-js/minify-whitespace** (unit 06, Ground Truth #3) | **0.39** | high | low | none | **yes** (158 modules confirmed in the real `bun.exe` by unit 12) | no (codegen + C++ rebuild) | small | The 158 built-in JS modules (1,756,999 B of source in .rodata) are not whitespace-minified. `--minify-whitespace` in `bundle-modules.ts`. **Perf IMPROVEMENT** (less source for JSC to lex on first require). Prior art: PR #31456 / commit `3ec6669844` used the same measure-and-diff method and got -0.80 MB from a sibling blob. |
| 2 | **pal-textcodecs/replace-pal-with-encoding-rs** (07) | **0.39** | **medium** | **medium** | none *if the WPT encoding suite passes* — this is the ONE Tier-A row whose zero-regression claim rests on a test gate, not a proof | yes | no | medium (days) | Bun links **two** complete WHATWG-Encoding implementations: `PAL::TextCodec*` (serves `TextDecoder`, 441,386 B, 0 refs from the WebKit prebuilts — 100% bun-local) and `encoding_rs` (211 KB, linked only because `lol_html` depends on it but hardcoded to UTF-8). Route `TextDecoder`'s legacy branch through `encoding_rs` (the WHATWG spec's **reference implementation**), delete the 15 PAL files. Add-side is ~29 KB of measured sibling symbols. Net 0.39. Skeptic reproduced the REMOVE side byte-for-byte and spot-checked gb18030 ptr-7457 / Big5-HKSCS / shift_jis 0x80 all spec-correct. **NOT refuted by the orchestrator's "PAL tables are load-bearing" broadcast** — that refutes removal-without-replacement; this is a replacement. One real bug the skeptic found in the report's optional step: `encoding_rs::Encoding::name()` is CASED; the `.encoding` getter must `to_ascii_lowercase()` it. **MUTUALLY EXCLUSIVE with row 2b** — see the fork box below. |
| 2b | *fork alternative:* **lolhtml-utf8-only** (17/18, same proposal in both) | 0.20 | high | low | **none, PROVEN** — two skeptics independently ran the shipped binary: `HTMLRewriter` fed real Shift-JIS bytes + `<meta charset>` + a charset header still decodes as UTF-8 | yes | no | medium | The conservative branch of the same fork: strip encoding_rs's legacy decoders (lol_html is hardcoded to `AsciiCompatibleEncoding::utf_8()` + `adjust_charset_on_meta_tag:false`, PROVEN on the canary), keep PAL. `vendor/lolhtml` is a **pinned upstream fetch, not a bun fork** (both the unit AND one skeptic got this wrong) — needs an oven-sh fork / upstream feature / post-fetch patch. The prescribed `from_utf8_lossy` shim is a **correctness bug** (lol_html streams a `Decoder` across chunks); must be a streaming UTF-8 decoder with a 0–3-byte carry. |
| 3 | **dead-features/libarchive-prune-bycode-switches** (11) | **0.254** | high | low | **none** (proven 3 independent ways: source roots, full 1,133-object reference sweep, and `new Bun.Archive(zipBuf)` already errors today) | yes (same `SOURCES`; only Win I/O shims differ) | near (2 tiny .c recompiles) | small | bun's Rust registers ONLY tar/gnutar/gzip (and `set_format(0x30000)` / `append_filter(1)` hardcoded). But libarchive's `archive_read_support_format_by_code.c` / `archive_read_append_filter.c` runtime switches reference EVERY format/filter, pinning zip/rar/rar5/7z/cab/lha/iso9660/mtree/cpio/... + ppmd7/8 + blake2 + all filter stubs. One `patches/libarchive/*.patch` editing the two switches; `--gc-sections` reclaims 265,870 B. Both skeptics found it slightly CONSERVATIVE (+561 B, `filter_fork_posix.c.o`). Also fix the stale comment at `deps/libarchive.ts:27`. |
| 4 | **icf-all-linker/icf-all-keep-unique** (10, Ground Truth #2) | **0.250** | high (MEASURED by the orchestrator's real relink) | low | none (smoke-tested: 1,282-constructor probe + `expect.test.js`'s 74 `expect.any()` sites + the intl suite) | **NO** — see note | **YES** (flag-only relink, minutes) | small | `--icf=all --keep-unique=<callHostFunctionAsConstructor>`. Bare `--icf=all` was reverted in `218430c731` (it folded `callBigIntConstructor` with `constructBigInt`, breaking `expect.any(Constructor)`); the root cause is the POINTER-IDENTITY sentinel at `InternalFunction.cpp:121`; `--keep-unique` is the surgical fix. Skeptic 10.2 CLOSED a gap the report had (the sentinel is `T`/GLOBAL in its input object so lld CAN find it) and found 8 more pointer-identity sites the report missed (all benign fast-path detectors). **PRE-SHIP CHECK (from unit 14's skeptic):** `--icf=all` also folds rodata; there are 48 byte-identical 248-B `*Constructor::s_info` `JSC::ClassInfo` objects on which `jsDynamicCast` does pointer identity. The smoke test passed (so lld respected their `.llvm_addrsig` significance), but verify with one `nm` count that the 48 remain at distinct addresses before merging. **WINDOWS: 0.** `lld-link` has **no `--keep-unique`** (unit 12's skeptic ran it). The Windows equivalent needs a SOURCE fix in oven-sh/WebKit (make the sentinel structurally unfoldable, e.g. a unique `asm volatile` no-op) — Tier B. |
| 5 | **boringssl/remove-post-quantum — Kyber + ML-KEM subset ONLY** (08) | **0.185** | high (byte-exact from the map, both skeptics) | low | **none** — proven: the TLS group list is hard-locked to `{X25519,P-256,P-384}`, there is no `SSL_set1_groups*` symbol in the binary, `crypto.encapsulate` does not exist | yes (~0.18, extrapolated; same C++/gc) | no | small | Delete X25519Kyber768Draft00 (43,966 B) + ML-KEM 768/1024 (150,286 B) from the boringssl build via a `patches/boringssl/*.patch` (the repo's established mechanism). **DO NOT include ML-DSA — it is Tier C** (see row C1). This split is the most important correction in the whole review: both skeptics independently refuted the report's "regression: practically none" for ML-DSA by demonstrating a working ML-DSA-44 TLS-1.3 server end-to-end on the shipped binary. |
| 6 | **duplicate-data/rust-std-backtrace-off** (18) | **0.17** | high (I re-measured: 182,648 B removable on the SHIPPED canary) | low | none user-visible (a Rust panic that fires *before* `crash_handler` installs its hook loses `RUST_BACKTRACE=1`; bun's own crash reporter uses `dladdr`, never `gimli`) | partial (~0.06 — Windows std symbolizes via dbghelp) | no (rust rebuild) | **small** | std's DWARF symbolizer (`gimli`+`addr2line`+`miniz_oxide`+`rustc_demangle`) is linked only because `std::panicking::default_hook` can reach it; bun never calls it (`panic = "abort"`, its own hook). `rust.ts:380` **already** passes `-Zbuild-std` for release; append `-Zbuild-std-features=panic-unwind` (= defaults minus `backtrace`). DOWNGRADED from the report's 0.27: that double-counted 54.7 KB (addr2line's gimli generics) and counted 39 KB of `__rust_begin_short_backtrace` thread-entry trampolines that are bun's own closures, not removable. Validate: `nm | grep gimli` goes empty. |
| 7 | **image-codecs** (09) — 4 sub-items, all confirmed | **0.165** | high | low | none (two skeptics: identical SHA256 output for every adversarial option combo) | yes | no | small | (a) `jpeg-clz-intrinsic` **0.0625**: `USE_CLZ_INTRINSIC` in `libjpeg-turbo.ts` `defines:` — drops the 64 KB `jpeg_nbits_table`. Orchestrator ground truth: perf **NEUTRAL** (upstream's own note), not "improvement"; scope to `!arm64` to avoid a `-Wmacro-redefined` warning. (b) `webp-reduce-csp` **0.040**: `WEBP_REDUCE_CSP` + `WEBP_NEAR_LOSSLESS=0` in `libwebp.ts`. (c) `jpeg-feature-narrow` **0.046**: undefine `QUANT_{1,2}PASS / C_LOSSLESS / DCT_{IFAST,FLOAT} / C_ARITH_CODING _SUPPORTED` via an ordered `headers.replace`. (d) `webp-reduce-size` **~0.018**: `WEBP_REDUCE_SIZE` (number right; the report's per-function derivation had 4 errors that cancel). |
| 8 | **cpp-unified/builtinnames-optnone** (13) | **0.055** (0.12 with the table variant) | high | low | none | yes (`#if COMPILER(CLANG)`) | no | small | `BunBuiltinNames.cpp:11` has `__attribute__((nodebug, optnone))` on the 425-name ctor — it is literally **-O0 code on a one-shot VM-init path** (104,485 B, 20,424-byte stack frame, a real `call` to a `constexpr`). Swap to `minsize`. **Perf IMPROVEMENT.** CORRECTION both skeptics made: the report's 0.062 wrongly included the 28,866-B dtor, which is `= default`, unattributed, and already tight -O2. The **table variant** (a `constexpr ASCIILiteral[]` + a loop over `std::array<Identifier,850>`) also collapses the dtor, gets ~0.12 MB, AND sidesteps the 90-s compile-time cost `optnone` was added for. Prefer the table. |
| 9 | **cpp-unified/zgc-lazy-init-helpers** (13), CORRECTED | **0.05** | med | med | none **only with the corrected design** | yes | no | medium | Outline the cold bodies of the 92 generated `subspaceForImpl<JS*>` + 139 `createStructure` instantiations in `ZigGeneratedClasses.cpp`. **The report's design is WRONG and both skeptics caught it:** `subspaceForImpl` is `ALWAYS_INLINE` and runs on **every cell allocation** (`JSFoo::create` -> `allocateCell` -> `subspaceFor`); only its interior slow branch is once-per-class. An implementer who follows the report adds a call to every generated-class allocation. Correct shape: keep the inline 4-instruction fast path; outline only the ~400-B cold body into ONE shared `NEVER_INLINE` non-template helper. `createStructure` (0.033) is clean and one-shot. Files: `src/codegen/generate-classes.ts` + a new `GeneratedClassSupport.{h,cpp}`. |
| 10 | **compression-packaging/strip-all-flag-order** (15 == 10's `post-strip-symtab-residual`) | **0.040** | high (4 independent byte-exact reproductions) | none | none (`.symtab` is a proven exact duplicate of `.dynsym`; byte-identical crash report; `--compile` works) | **no** (the Windows "strip" step is a `copy`; no PE symtab) | **YES — strip-only, ~0.1 s** | **trivial** | **ROOT CAUSE (the most elegant find in the swarm):** the build runs GNU `strip --strip-all --strip-debug --discard-all ...`. GNU strip's strip level is a **last-flag-wins** enum, so `--strip-debug` silently DOWNGRADES `--strip-all`. Delete the two extra tokens from `flags.ts:~1430`. Two units found the same 41 KB (unit 10 proposed a 2nd post-link pass; unit 15 found the flag bug — ship 15's). BONUS (unit 10's skeptic): every user `bun build --compile` output also shrinks 41 KB. **Do NOT switch to llvm-strip** — skeptic 15.1 measured it 851,968 B WORSE on the real input (it doesn't compact the file hole); the report's "the flags.ts comment is wrong" aside was backwards. |
| 11 | **duplicate-data/runtime-js-4x** (18) | **0.038** | high | low | none | yes | no | small | `ParseTask.rs`'s `get_runtime_source_comptime` has 4 `concatcp!(include_str!("../runtime.js"), ...)` arms -> 4 complete copies of the 12,216-B `runtime.js` in .rodata (present 4x in the SHIPPED canary; LTO does not dedup them; they are non-SHF_MERGE sections of different lengths so no linker can either). Build the 4 strings once at runtime into a `OnceLock` (the path is already lazy). The report's option (b) — "hoist a shared prefix for LLVM to unique" — is **impossible** (`concatcp!` materializes a flat array); only option (a) works. |
| 12 | **cpp-unified/zgc-per-class-this-cast — cold-throw-tail subset ONLY** (13) | **0.024** | high | none | none (the 39-B block sits AFTER `ret` and is never executed on the happy path) | yes | small-med | small-med | Each of the 889 generated method Callbacks carries ~39 B of identical cold `createInvalidThisError + throwException` tail. Outline it per-class. **This is the provably-zero-cost subset.** The report's bigger variant (also outlining the 42-B HOT type check, +~0.034) needs a microbenchmark first — the hard "neutral or better" bar is unmet until measured. Skeptic 13.2 REFUTED the getter/setter half outright (the 387 generated getters contain ZERO `createInvalidThisError` calls; the report never read the generated source). |
| 13 | **cpp-unified/internal-module-switch-to-table** (13) | **0.018** | high | low | none (one-shot per internal module per VM, result cached) | yes | no | small | `createInternalModuleById` is a 25,156-B (27,157 in the canary) 158-case jump-table switch, each case 3x `StringImpl::createWithoutCopying` + a `generateModule` call. Replace with a `constexpr` 48-B-per-entry table + one indexed call. Net 17.3 KB after netting out the new .rodata table. `bundle-modules.ts` only. |
| 14 | **icf-all-linker/hash-style-gnu** (10 == 16) | **0.016** | high (MEASURED relink) | none | none (glibc>=2.5 prefers `.gnu.hash`; bun's floor is 2.17) | no (ELF-only) | **YES** | **trivial** | `--hash-style=both` -> `gnu` at `flags.ts:1272`. **CRITICAL SCOPING (skeptic 16):** there is a SECOND `--hash-style=both` at `flags.ts:1359` gated `c.freebsd` — FreeBSD 13's `rtld-elf` reads ONLY the SysV `.hash` (GNU-hash landed in FreeBSD 14). **Do not touch :1359.** Perf is NEUTRAL, not "improvement" (both skeptics). |

**THE ENCODING FORK (the one mutual exclusion that matters).** Rows 2 and 2b are the two
opposite resolutions of the same duplication (bun ships two WHATWG-Encoding implementations).
Three units independently collided on these bytes (07, 17, 18) and every skeptic agreed on the
rule: **credit exactly ONE.** Branch A (row 2, replace PAL with encoding_rs) is bigger
(0.39) and architecturally right (one implementation, the spec's reference one); Branch B
(row 2b, strip encoding_rs's legacy decoders) is smaller (0.20) but regression-free by
running code. Doing BOTH would leave bun with NO legacy decoder — directly contradicted by the
orchestrator's canary probe. **Recommend A, gated on the WPT encoding suite; B is the drop-in
substitute if WPT finds a divergence.**

### TIER B — zero perf cost + no regression, but needs an oven-sh/WebKit change
(Per the Jarred directive: the orchestrator has write access; **this is a normal path, not a
blocker.** All of these batch into ONE WebKit prebuilt rebuild + one pin bump in
`scripts/build/deps/webkit.ts`.)

| # | id | saving_mb | conf | risk | regression | windows | relink_only | effort | summary |
|--|----|-----------|------|------|------------|---------|-------------|--------|---------|
| B1 | **wtf-yarr-misc/uws-iostream-purge, CORRECTED** (17) | **0.33** | high (both skeptics re-derived 343,390 B on the SHIPPED canary's map) | low | none (stderr text is byte-identical) | likely (unmeasured — the `.globl` mechanism is libstdc++-specific; MS STL pulls iostream differently) | no (WebKit rebuild + bun C++ rebuild) | **small** | 0.33 MB of libstdc++ locale/iostream (`locale-inst`, `wlocale-inst`, all 28 facets, 6 of the 12 `.init_array` ctors). **BOTH skeptics independently found the report's root cause WRONG and REFUTED its 5-line uWS fix (~5 KB, not 331 KB).** The real GC root: the unconditional `#include <iostream>` at `wtf/simdutf/simdutf_impl.h:9949` (provably unused — its only consumer is a never-defined `#ifdef SIMDUTF_LOGGING`). Via GCC-13+'s file-level `__asm(".globl _ZSt21ios_base_library_initv")` it plants an undefined symbol — **immune to `--gc-sections`** — into 78 bun `.o` files (through the PCH) and 5 extracted `libWTF.a` members. CORRECTED CHANGE: (1) delete that ONE `#include` in oven-sh/WebKit; (2) the 5 `std::cerr` -> `fputs` in uWS. **Perf IMPROVEMENT** (6 fewer global ctors; no `locale::classic()` at every process start). Verify: `.init_array` 12 -> 6; `nm | grep -c locale-inst` = 0. |
| B2 | **wtf-yarr-misc/yarr-tables-to-bss** (17) | **0.125** | high (byte-dumped from the SHIPPED canary by both skeptics) | low | none | yes | no | small | `JSC::Yarr::_wordcharData` (65,536 B, EXACTLY 63 nonzero = `\w`) + `_spacesData` (65,536 B, 25 nonzero = `\s`): **131,072 file bytes encoding 88 bits.** The Yarr JIT bakes the table ADDRESS as an immediate, so `.rodata` -> `.bss` + a one-time 88-byte write is bit-identical at runtime (read the `branchTest8(ExtendedAddress(ch, intptr(m_table)))` at `YarrJIT.cpp:1134`). Generator: `yarr/create_regex_tables`. Cosmetic caveat: the tables become writable; mitigate with a post-init `mprotect(PROT_READ)` (JSC's existing `__jsc_opcodes` pattern). |
| B3 | **wtf-yarr-misc/libpas-megapage-to-bss** (17), corrected UP | **0.125** | high | low | none | yes | no | small | `bmalloc_megapage_table` + `tagged_bmalloc_megapage_table`: each 65,544 B of `.data`, each with EXACTLY **4 nonzero bytes** (one pointer to the all-zero null sentinel at offset 65536). The report downgraded itself to 0.063 after looking at the **wrong binary** (the 1.3.14 Zig release, which has only one table); the CANARY has both, byte-dumped by both skeptics. ZERO-RISK VARIANT (skeptic 17.1): split the struct's two members into two file-scope globals — `fast_bits[16384]` (all-zero) goes to `.bss` by itself, `instances[1]` (8 B, the non-null sentinel) stays in `.data`; every generated instruction is TEXTUALLY IDENTICAL, no runtime write, no init-ordering question. `pas_fast_megapage_table.h:61-72`. |
| B4 | **icf-all-linker/wtf-config-sections-to-nobits** (10) | **0.032** | high (hexdumped: 2x16,384 B, 100.00% ZERO, in BOTH the local and official binary) | med | none | probably | no | small | `__DATA,__wtf_config` + `__DATA,__jsc_opcodes` are PROGBITS-of-zeros. Make them `@nobits`. **ONLY the named-section `@nobits` variant is safe** (skeptic): `WTF::Config::permanentlyFreeze()` `mprotect`s these pages and MUST own them exclusively — dropping the section name and letting lld coalesce into the general `.bss` could freeze a neighbor and crash at startup. `WTFConfig.cpp:84`. |
| B5 | **icf=all for WINDOWS** (from unit 12's NEW finding) | ~**0.25 (W)** | med | med | none | **windows-only** | no | small | `lld-link` has **no `/keep-unique`** (verified by running it), so Ground Truth #2's surgical linker fix is ELF-only. To get the equivalent on Windows, make `callHostFunctionAsConstructor` structurally unfoldable at the SOURCE in oven-sh/WebKit (a unique `asm volatile("" ::: "memory")` / a per-function `section` attribute), then flip `/OPT:SAFEICF` -> `/OPT:ICF`. The 0.25 MB is an extrapolation from the Linux relink (the shipped Windows binary is non-LTO, so local-map numbers transfer MORE faithfully there per unit 12). |
| B6 | **LTO-bloated one-shot startup fns** (named in Ground Truth; routed by unit 14's skeptic) | **UNQUANTIFIED** (the two bodies are 211,699 + 99,581 = 311,280 B in the SHIPPED canary; the *recovery* is the LTO-inlining bloat, unmeasured) | low | low | none (one-shot startup code; fewer bytes fault in) | yes | no | **small** (2 source annotations) | `JSC::JITThunks::initialize(VM&)` (212 KB) and `JSC::JSGlobalObject::init(VM&)` (100 KB) — full LTO massively inlined two functions that run exactly once at VM creation. Unit 14's skeptic PROVED the zero-source-change route **does not work** (`-mllvm -force-attribute` / `forceattrs` is absent from LLVM's LTO post-link pipeline — verified with `-print-pipeline-passes`). So: `NEVER_INLINE` / `__attribute__((minsize))` on the two definitions in oven-sh/WebKit. Measure on the next prebuilt. |

### TIER C — real feature / behavior tradeoffs (a maintainer must say yes to each)

| # | id | saving_mb | windows | the tradeoff, precisely |
|--|----|-----------|---------|--------------------------|
| C1 | **boringssl ML-DSA** (the other 55% of unit 08's proposal) | **0.231** | ~0.22 | **This removes a WORKING feature.** Both skeptics, fully independently, generated a real ML-DSA-44 cert with OpenSSL 3.5 and proved on the shipped binary: `tls.createServer({key,cert})` / `Bun.serve({tls})` complete a real TLS-1.3 handshake signed with `mldsa44`, verified by a **stock** `curl` and `openssl s_client`. `X509Certificate.verify()` -> `true`. Node 24 supports this; removing it is a Node-compat step backward. The unit's report said "regression: practically none" — **that was its central error.** 0.23 MB for a final NIST standard (FIPS 204) is the maintainers' call, and they must make it with eyes open. Same one-patch-file as row 5. |
| C2 | **sqlite-drop-fts3/fts4** (11, = 13's duplicate) | **0.16** | yes (~0.17) | Delete `SQLITE_ENABLE_FTS3(_PARENTHESIS)` from `deps/sqlite.ts`. fts3/fts4 work TODAY; 0 docs, 0 tests, 0 types refs. **The regression is worse than "can't CREATE":** a skeptic demonstrated that an existing `.sqlite` file written by ANY other tool containing an fts3/fts4 table becomes **unreadable AND un-DROP-able** from `bun:sqlite`. Real Node 26 ships fts3/4/5 + rtree + geopoly. Reasonable to ask; must be an explicit decision. |
| C3 | **sqlite-drop-rtree** (11) | 0.045 | yes | **BOTH skeptics recommend SKIPPING this**, and so do I: `loadExtension` is a documented `bun:sqlite` API, and spatialite — the main reason anyone uses `loadExtension` — **requires the host's built-in rtree**. 45 KB does not buy breaking every geospatial user. |
| C4 | **lsquic + lsqpack (http3 server)** (11) | **0.42** | yes | The single largest NEGOTIABLE item. `Bun.serve({http3:true})` works today (a skeptic started a real HTTP/3 server on the shipped binary), is documented (`server.mdx`), typed `@experimental @default false`. Removing or env-gating an experimental-but-shipped server feature is a product decision. |

---

## B. CUMULATIVE TOTALS — is 20 MB reachable?

**First, the context a maintainer needs:** the "20 MB" is measured against the 1.3.14
RELEASE. **~15 MB of it already happened before this investigation**, via two events between
the `bun-v1.3.14` tag and current main: (1) the **Zig -> Rust rewrite** (commit `23427dbc12`,
two days after the tag — unit 16 PROVED the 1.3.14 binary and main are different programs in
different languages, see section F) and (2) the **ICU per-item zstd compression** in
oven-sh/WebKit (on Windows, unit 12 counted zstd frame magics in `.rdata`: **1** in v1.3.14
vs **3,479** in the canary, a -15.3 MB `.rdata` delta). What is actually left to find is
4.87 MB linux / 2.20 MB windows, and that is what the tiers below are measured against.

### linux-x64 (need 4.87 MB)

| tier | what | MB |
|------|------|----|
| **A** | rows 1-14, encoding fork **Branch A** (0.39) | **2.05 MB** |
| A | ...fork Branch B (0.20) instead (the conservative choice) | 1.86 MB |
| **A + B** | + the 4 quantified WebKit items (0.33 + 0.125 + 0.125 + 0.032) | **2.66 MB** (+ B6, unquantified, bounded by ~0.3) |
| **A + B + C** | + the realistic Tier-C asks (ML-DSA 0.231 + fts3 0.16) | **3.05 MB** |
| A + B + C (max) | + also rtree + lsquic (I recommend against both) | 3.51 MB |

**The honest Tier-A-only number for linux is ~2.0 MB. The target of 4.87 MB is NOT
reachable from this investigation's confirmed inventory** — not from Tier A, not from A+B,
not even from A+B+C. **Shortfall: 1.4-2.8 MB**, and it is not hiding in anything these 18
units looked at. The credible remaining MB lives exactly where the orchestrator's closing
broadcast and the Jarred directive already point, and this synthesis quantifies the gap:

1. **The Rust `.text` — 16.37 MB, 100% bun-controlled, and essentially UNTOUCHED.** Across
   18 units and 36 skeptic passes, the ONLY Rust-.text proposal that survived is the 0.17 MB
   std-backtrace item. Nobody produced a `derive(Debug)` / monomorphization / cold-crate
   `opt-level="z"` analysis. Bun already has the mechanism (unit 16 B13:
   `[profile.release.package.bun_react_compiler] opt-level = "s"` is in `Cargo.toml` today).
   **This is wave 2's #1 target and the single largest unexplored territory.**
2. **JSC's 18.22 MB of `.text`** (the disassembler, `Options` metadata, Inspector protocol
   tables) — all in oven-sh/WebKit, all wave 2.
3. The two LTO-bloated startup functions (B6), which cost one source annotation to measure.

I am **not** padding those with invented numbers; wave 2 is producing the implementable
design. What this synthesis establishes is that the well-tuned-already thesis is CONFIRMED:
the free money is gone, and the rest is real engineering.

### windows-x64 (need 2.20 MB)

| tier | what | MB |
|------|------|----|
| **A** | the icon (0.250, **windows-only, relink-only**) + minify-whitespace 0.39 + libarchive ~0.25 + encoding fork A ~0.39 + boringssl ~0.18 + image codecs ~0.16 + cpp-unified ~0.14 + backtrace ~0.06 + runtime-js ~0.04. (strip fix, icf=all, hash-style are all 0 on Windows.) | **~1.86 MB** |
| A + B | + yarr 0.125 + libpas 0.125 + the Windows-only icf source fix ~0.25 | **~2.36 MB** |

**On Windows, the 2.20 MB target IS plausibly reachable from Tier A + B.** Two caveats:
(a) most of the Windows numbers are extrapolations from the Linux map — but unit 12 proved
the shipped Windows binary is built **without LTO** (`config.ts`: ThinLTO miscompiles JSC on
x86-64; the COFF regular-LTO route "hasn't been built yet"), so the local non-LTO map numbers
transfer MORE faithfully to Windows than to the LTO'd Linux canary. (b) The one item that is
windows-ONLY, byte-exact, relink-only, and 11.4% of the entire Windows gap by itself is the
**icon**: `src/bun.ico` is a raw uncompressed 270,600-B 32-bpp DIB; PNG-in-ICO (standard
since Vista) is ~8 KB, lossless. **Do this one today.**

Behind both: **the Windows LTO gap is the biggest structural Windows lever nobody can
quantify without building it.** The non-LTO cost bun's own `profiles.ts` documents is "~555 KB
of C++ vtables ... +962 KB" (eh_frame-equivalent) plus all cross-TU dedup and outlined JSC
slow paths. `config.ts` names the unbuilt fix (full-LTO Windows WebKit artifacts + a COFF
rust-summary fixup). Tier B, effort LARGE (a week+), wave 2.

---

## C. MEASUREMENT PLAN

All deltas are measured on the **stripped** output — that is what `scripts/binary-size.ts`
tracks (unit 15 verified this is the gate the team actually runs).

### Phase 1 — RELINK / POST-LINK ONLY (minutes each; do ALL of these first)

| # | exact change | expected delta | already measured by |
|--|---|---|---|
| R1 | `scripts/build/flags.ts` `stripFlags`: `["--strip-all","--strip-debug","--discard-all"]` -> `["--strip-all"]`. | linux **-41,080 B** | 3 skeptics, byte-exact, on 3 binaries incl. the canary |
| R2 | `scripts/build/flags.ts:1272` (the `c => c.linux` entry ONLY; **not** the `c.freebsd` one at :1359): `--hash-style=both` -> `gnu`. | linux **-16 KB** | the orchestrator's relink (GT #2) |
| R3 | Add `-Wl,--icf=all -Wl,--keep-unique=<mangled callHostFunctionAsConstructor>` to the linux link. **Pre-ship check:** `llvm-nm --print-size bun-profile | grep 'Constructor.*s_info'` -- the 48 ClassInfo objects must remain at distinct addresses. | linux **-0.250 MB** | the orchestrator's relink (GT #2) + smoke test |
| R4 | Replace `src/bun.ico` with a PNG-re-encoded single-entry ICO. Re-run `llvm-rc` + the Windows link. | **windows -252 KB** | 4 skeptics, incl. 2 who re-downloaded both real `bun.exe`s |

(NOTE FROM THE ORCHESTRATOR, post-synthesis: R1, R2, and R4 have ALREADY SHIPPED as
PR #33224 and are CI-CONFIRMED at exactly -56.7 KB linux / -252 KB on all 3 windows
targets. Only R3 remains, gated on a maintainer yes.)

### Phase 2 — NATIVE REBUILDS (40+ min each; order by saving/effort)

| # | the exact flag / file diff | expected delta |
|--|---|---|
| N1 | `src/codegen/bundle-modules.ts:~207`: add `--minify-whitespace` next to `--minify-syntax --keep-names`. (Unit 16's skeptic checked: the post-bundle regex surgery at :243-267 is already `\s*`-tolerant. **`--minify-identifiers` remains BLOCKED** by that regex stack — don't try it.) | -0.39 |
| N2 | New `patches/libarchive/disable-unused-formats.patch` editing the two by-code switches (`archive_read_support_format_by_code.c`, `archive_read_append_filter.c`) to keep only tar/gnutar + gzip; trim `SOURCES` in `deps/libarchive.ts`; fix the stale comment at line 27. | -0.254 |
| N3 | New `patches/boringssl/remove-kyber-mlkem.patch`: drop the 2 `EVP_pkey_ml_kem*` entries from `evp/internal.h`, the 2 arms in `evp_ctx.cc`, the ML-KEM + Kyber key-share classes in `ssl_key_share.cc`, `kNumNamedGroups 7u->5u`. **Leave ML-DSA alone unless C1 is approved.** | -0.185 |
| N4 | `scripts/build/rust.ts:380`: append `-Zbuild-std-features=panic-unwind` to the existing `-Zbuild-std=...` push. Validate `nm | grep -c gimli` == 0 and one startup benchmark. | -0.17 |
| N5 | `deps/libjpeg-turbo.ts` `defines:`: add `USE_CLZ_INTRINSIC: true` (gate on `!cfg.arm64`). `deps/libwebp.ts`: add `WEBP_REDUCE_CSP: true, WEBP_NEAR_LOSSLESS: 0`. | -0.103 |
| N6 | libjpeg `headers.replace` (ordered): undefine `QUANT_1PASS / QUANT_2PASS / C_LOSSLESS / DCT_IFAST / DCT_FLOAT / C_ARITH_CODING _SUPPORTED`; `deps/libwebp.ts` add `WEBP_REDUCE_SIZE`. | -0.064 |
| N7 | `src/jsc/bindings/BunBuiltinNames.{h,cpp}`: the `constexpr ASCIILiteral names[]` table + loop variant. | -0.12 |
| N8 | `src/bundler/ParseTask.rs`: replace the 4 `concatcp!` arms with a `OnceLock<[String;4]>`. | -0.038 |
| N9 | `src/codegen/generate-classes.ts`: (a) emit ONE shared `NEVER_INLINE` slow-path helper for `subspaceForImpl`, keeping each class's inline fast path; (b) per-class `[[noreturn]]` cold-throw helpers for the Callback tails; (c) `bundle-modules.ts`: the constexpr module table. | -0.09 |
| N10 | The encoding fork: Branch A = rewrite `src/runtime/webcore/TextDecoder.rs`'s legacy branch against `encoding_rs` + delete `src/jsc/bindings/{TextCodec*,EncodingTables*,TextEncoding*}` + the CMake source list; GATE on `test/js/web/encoding/text-decoder.test.js` + the WPT encoding suite. Branch B = an oven-sh lol-html fork / post-fetch patch replacing `SharedEncoding` with a streaming-UTF-8 shim. | -0.39 (A) or -0.20 (B) |

### Phase 3 — ONE oven-sh/WebKit prebuilt rebuild (batch ALL; then one pin bump)

| # | file in oven-sh/WebKit | change | expected delta |
|--|---|---|---|
| W1 | `Source/WTF/wtf/simdutf/simdutf_impl.h:9949` | delete the unconditional `#include <iostream>` (provably unused). PLUS, in bun: the 5 `std::cerr` -> `fputs` in `packages/bun-usockets` uWS headers + delete their 6 `#include <iostream>`. Verify `.init_array` 12->6. | -0.33 |
| W2 | `Source/JavaScriptCore/yarr/create_regex_tables` | emit the 2 tables as zero-init + a one-time 88-byte write (`.rodata` -> `.bss`) | -0.125 |
| W3 | `Source/bmalloc/libpas/src/libpas/pas_fast_megapage_table.h:61-72` | split `fast_bits[16384]` and `instances[1]` into two globals | -0.125 |
| W4 | `Source/WTF/wtf/WTFConfig.cpp:84` | named-section `@nobits` on `__wtf_config` / `__jsc_opcodes` (keep the section names — the `mprotect` must own its pages) | -0.032 |
| W5 | `JITThunks::initialize` + `JSGlobalObject::init` | `NEVER_INLINE` / `__attribute__((minsize))` | **measure** (bounded by 0.31) |
| W6 | `callHostFunctionAsConstructor` | make structurally unfoldable (an `asm volatile` no-op), then flip the Windows link to `/OPT:ICF` | windows ~-0.25 |

---

## D. IMPLEMENTATION PLAN — the top Tier A items (files and change, ready to assign)

1. **strip-all-flag-order** (`-0.040`, trivial). [SHIPPED in PR #33224.]
2. **minify-whitespace** (`-0.39`). `src/codegen/bundle-modules.ts:207`. Gate: diff the 158
   generated outputs against golden behavior (`test/js/node/`). Prior art: commit `3ec6669844`.
3. **libarchive-prune** (`-0.254`). New `patches/libarchive/prune-by-code.patch`: keep ONLY
   the `ARCHIVE_FORMAT_TAR*` cases + `ARCHIVE_FILTER_GZIP` (+ `NONE`). Then remove the
   now-unregisterable format/filter `.c` files from `SOURCES` in
   `scripts/build/deps/libarchive.ts` (the patch MUST land first). Fix the stale comment.
4. **icf=all + keep-unique** (`-0.250`, relink-only). `scripts/build/flags.ts:1288`: change
   to `icf=all` + add `--keep-unique=_ZN3JSC30callHostFunctionAsConstructorE...` (take the
   exact mangled name from `llvm-nm libJavaScriptCore.a`; it is `T`/GLOBAL). Keep + extend
   the SAFEICF comment with the 218430c731 reference. Run the ClassInfo pre-ship check.
   **Linux only. Gated on an explicit maintainer yes.**
5. **boringssl Kyber+ML-KEM** (`-0.185`). `scripts/build/deps/boringssl.ts`: add
   `patches: ["patches/boringssl/remove-kyber-mlkem.patch"]` touching exactly
   `crypto/evp/internal.h:399-419`, `crypto/evp/evp_ctx.cc:93-108`,
   `ssl/ssl_key_share.cc` (the MLKEM*/X25519Kyber768 classes + kNamedGroups),
   `ssl/internal.h:917` `kNumNamedGroups = 7u -> 5u`. Do NOT touch the ML-DSA paths.
6. **rust-std-backtrace-off** (`-0.17`). `scripts/build/rust.ts:380`: push
   `-Zbuild-std-features=panic-unwind` alongside the existing `-Zbuild-std=...`.
7. **The encoding fork, Branch A** (`-0.39`). `src/jsc/TextCodec.rs` +
   `src/runtime/webcore/TextDecoder.rs:~490`: replace the legacy-branch FFI calls with
   `encoding_rs::Encoding::for_label` + a streaming `Decoder`. Delete
   `src/jsc/bindings/{TextCodec*,TextCodecCJK,TextCodecSingleByte,TextCodecReplacement,
   TextCodecUserDefined,TextCodecWrapper,EncodingTables(73,451 lines!),TextEncoding*}`.
   `.encoding` must return `encoding.name().to_ascii_lowercase()`. MANDATORY gate:
   `test/js/web/encoding/text-decoder.test.js` + the WPT encoding suite.

---

## E. DISCARDED — refuted, superseded, or not worth it (one line each)

**Refuted outright**
- *Remove the PAL text-codec tables as dead weight* — REFUTED by the orchestrator's canary
  probe: every WHATWG label decodes correctly; they are load-bearing. (The *replacement*,
  row 2, is a different category and is not refuted.)
- *Drop ICU `.cnv` converters / `cnvalias`* — there is NOTHING to drop. I enumerated the
  shipped canary's icudt ToC (3,770 items): **0** `.cnv`, **0** `cnvalias`, **0**
  `unames.icu`, **0** `translit/`, **0** `rbnf/`. **The ICU avenue is 100% closed on BOTH
  axes.** One correction: bun's single-byte legacy labels (koi8-r, ibm866) are served by
  `PAL::TextCodecSingleByte`'s own 256-B tables, NOT by ICU.
- *`14-smol-opt-levels/linux-wpd-vfe`* — no derivation, AND a HARD link blocker: the
  `"Virtual Function Elim"` module flag (behavior=Error) refuses to link against the
  oven-sh/WebKit `-lto` prebuilt.
- *`18/highway-target-table`* (0.017 MB) — the bytes are real; the report's table, consumer,
  and change are all misidentified. LLVM's 64-byte ZMM constant pools have no
  `MergeableConst64` SectionKind so NO linker flag can fold them. Below the noise floor.
- *`17/uws-iostream-purge` AS WRITTEN* — the 5-line uWS fix recovers ~5 KB of 331 KB. Both
  skeptics found the real root. The CORRECTED version survives (B1).
- *`13/zgc-lazy-init-helpers` AS WRITTEN* — would add a call to every generated-class
  allocation. The CORRECTED version survives (row 9).
- *The getter/setter half of `13/zgc-per-class-this-cast`* — the 387 generated getters
  contain ZERO `createInvalidThisError` calls; the report never read the generated source.
- *`scripts/build/icu-repack.ts` / commit `7b32dae046`* — does not exist in any ref; it was
  the orchestrator's own erased prototype. Do not forward the citation.
- *"`vendor/lolhtml` is a bun fork"* — false; it is a pinned `cloudflare/lol-html` fetch.

**Perf-locked (violate the hard "neutral or improvement" constraint)**
- `-Os`/`-Oz`/a `smol`/`MinSizeRel` build — structurally only reaches 24% of `.text`. DEAD.
- Lower the LTO codegen level — `flags.ts:888-896` documents a MEASURED -5 MB-of-.text /
  perf tradeoff. No slack. (Skeptic 14.2 PROVED the `-O2` flag bun passes at link is a
  byte-for-byte no-op; the real default is already LTO-O2.) **The single most valuable
  dead-end on record** — it pre-kills the whole "lower the opt level" class.
- `-flto=full` -> `thin` on linux (~3 MB lead) — **a CORRECTNESS bug, not a perf question.**
  `flags.ts:480-496`: ThinLTO's backend pipeline MISCOMPILES JSC on x86-64 at -O1+.
- Remove frame pointers (~0.4-1 MB) — load-bearing for `bun.report` crash symbolication.
- `-falign-functions=1` (0.52 MB of inter-function padding, measured exactly) — perf-dead.
- `--hash-style` on the FreeBSD entry (`flags.ts:1359`) — FreeBSD 13's rtld-elf is
  SysV-hash-only. The linux-scoped change (row 14) is safe; the blanket one is not.
- `brotli` encoder static-dictionary hash tables — **0.28 MB**, encoder-only. The encoder IS
  live (`zlib.brotliCompressSync` at default quality 11 uses static-dict matching).
  Removing it produces DIFFERENT (larger) compressed output than Node. DEAD.
- Compress `ecp_nistz256_precomputed` (148 KB) / `k25519Precomp` — the data is 7.999
  bits/byte Shannon entropy; gzip-9 and xz-9e both GROW it. Mathematically hopeless.
- UPX / `--strip-sections` / any packer that rewrites the section table — EMPIRICALLY breaks
  `bun build --compile` (`BunSectionNotFound`; `elf.rs:438` name-matches `.bun`).
- `bun-standalone` (-10.1 MB) — Jarred's OWN unmerged experiment branch
  (`origin/claude/bun-standalone`, `14fe94ccc9`), which he built, measured, and chose not to
  ship. **NOTHING of it is at HEAD.** Re-proposing it is re-opening a decided question.
- Turn off LTO on Linux (+3.5 MB of .text is the LTO inlining) — LTO is on for perf. The
  RIGHT shape of this insight is B6.

**Duplicates (counted once)**
- `15/strip-all-flag-order` == `10/post-strip-symtab-residual`. `15/windows-ico-png` ==
  `12/ico-png`. `16/hash-style-gnu` == `10/hash-style-gnu`. `13/encodingtables-lazy` ⊂
  `07/replace-pal-with-encoding-rs`. `13/sqlite-drop-fts3-rtree` == `11/sqlite-drop-*`.
  `18/encoding-rs-utf8-only` == `17/lolhtml-utf8-only`. `14/mergefunc-lto` ≈
  `10/icf-all-keep-unique` (same byte population; --icf=all is measured, relink-only, and
  deletes the whole body instead of leaving a 5-B thunk; MergeFunctions' residual unique
  value: it is address-identity-safe *by construction*). `08/remove-kyber-draft` ⊂
  `08/remove-post-quantum`.

**Zero-value (correct, but 0 MB)**
- `14/lto-o3-trap-guard` — a comment fix: PR #28085's title says "-O3", its diff adds `-O2`,
  and the flag is provably a no-op. Fix the comment so nobody "restores" the -O3 (+5 MB).
- `12/file-prefix-map-parity` — ~206-412 B. Honestly self-reported as ~0.
- `14/-Wl,-mllvm,-force-attribute` to fix B6 — does NOT work (`forceattrs` is absent from
  LLVM's LTO post-link pipeline). Routed to the source annotation instead.

---

## F. OPEN QUESTION: why is the official 1.3.14 so much bigger than main?

**Answered, proven, and it matters.** The real deltas are 88.46 -> 73.33 MB = **15.13 MB**
against the shipped canary. And size-facts.md's earlier sentence "the v1.3.14 tag is not an
ancestor of local main" was wrong — it IS (`git merge-base --is-ancestor` exits 0).

**They are different programs, in different languages.**
- `bun-v1.3.14` (tag commit `0d9b296af33f`, 2026-05-12) is the **Zig** implementation. Two
  skeptics independently fingerprinted the official binary: its `.rodata` contains bun's own
  `.zig` SOURCE FILENAMES (`bundler/LinkerGraph.zig`, `js_parser/ast/P.zig`, ...) and Zig
  `std.posix` error-name strings, and has **zero** Rust markers.
- **Two days later** (2026-05-14), commit `23427dbc12` — **"Rewrite Bun in Rust (#30412)"**,
  Jarred Sumner — landed on main. Current main / the canary has `RUST_BACKTRACE` x3, the
  Rust panic string, and zero Zig posix names.
- `bun-v1.3.14` is the LAST tag. Nothing newer has been released.

On top of the language rewrite, the **ICU per-item zstd compression** landed in the
oven-sh/WebKit prebuilt between the two: unit 12 counted zstd frame magics in the real
Windows `.rdata` — **1** in v1.3.14 vs **3,479** in the canary; the `.rdata` shrank by
**15.34 MB**.

**Consequences for the maintainers:**
1. The 1.3.14 section sizes **cannot be decomposed from main's source** (different language,
   compiler, codegen). The only valid baseline is current main (= the canary).
2. **~75-80% of the 20 MB goal had already happened before this investigation started**, by
   the Zig->Rust rewrite and the ICU compression. The remaining 4.87 MB (linux) is the hard
   part, which is why 18 units of adversarial analysis produced only ~2 MB of proven,
   regression-free, perf-neutral inventory. That is not a failure of the investigation —
   it is the measured shape of an already-well-tuned binary, and it is the strongest
   possible argument for Jarred's directive: the rest requires changing lots of code (the
   Rust `.text`, the JSC internals, the Windows LTO route), which is what wave 2 is for.
