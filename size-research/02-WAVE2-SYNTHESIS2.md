# SYNTHESIS2 — wave 2 (code-change designs), combined with wave 1

Targets (authoritative, `scripts/binary-size.ts`, post-PR #33224):
**linux-x64 73.32 MB -> need <= 68.46 = 4.86 MB left. windows-x64 75.92 -> <= 73.92 = 2.00 MB left.**
Hard constraint: performance NEUTRAL OR AN IMPROVEMENT, no exceptions.

## Evidence provenance (read first)

The orchestrator's resume note warned that some wave-2 `*.report.md` files might be
gone. **They are not.** `/tmp/wf2/out/` contains all 11 reports AND all 11 skeptic
files, every one regenerated after the second restart. So, unlike wave 1:

> **Every wave-2 row below is backed by BOTH the unit's report AND an independent
> adversarial skeptic pass, both on disk. Provenance is uniformly HIGH.**

| unit | report | skeptic | skeptic's net verdict |
|---|---|---|---|
| w2-rust-debug-fmt | yes | yes | assigned avenue = CONFIRMED ZERO (GT#8); its one proposal (share-generics) WEAKENED |
| w2-rust-mono | yes | yes | P1 WEAKENED (counting bug), P2/P3/P4 CONFIRMED byte-exact |
| w2-rust-cold-crates | yes | yes | P2 CONFIRMED (weakly); P3's design REFUTED (does not compile) |
| w2-jsc-upstream | yes | yes | LOLJIT CONFIRMED to the byte; Temporal WEAKENED (design breaks a live API); P3 part-REFUTED |
| w2-generated-classes | yes | yes | gc-2 CONFIRMED + byte-diff proof; gc-1/gc-3 WEAKENED (magnitude) |
| w2-embedded-js-impl | yes | yes | all 3 CONFIRMED **in-engine** (JSC's own ASSERT_ENABLED builtin parser) |
| w2-symbol-hunt | yes | yes | both CONFIRMED via a fully independent 54 MB disassembly |
| w2-cpp-stdlib-rtti | yes | yes | CONFIRMED to the byte; == wave-1 row B1, not new money |
| w2-brotli-and-codecs | yes | yes | both CONFIRMED byte-for-byte on the live canary |
| w2-icu-unreachable | yes | yes | all CONFIRMED; skeptic replaced one wrong proof with a correct one |
| w2-windows-delta | yes | yes | P1 (/GS-) CONFIRMED — the single largest find of either wave |

Wave-1 rows carry wave-1's own provenance table (its SYNTHESIS.md §"Evidence
provenance"): units 07-18 had two skeptics each; units 01/04/06 were Ground-Truth-only;
02/03/05 produced nothing.

Two cross-cutting facts every number below already incorporates:
1. **The by-NAME counting bug.** Summing `nm-dem.txt` sizes by symbol NAME over-counts
   the canary's .text by **2.46-2.55 MB**: 67,654 local `t` symbols sit at only 59,819
   unique addresses (7,835 are ICF/MergeFunctions aliases). Found independently by the
   w2-rust-debug-fmt AND w2-symbol-hunt skeptics with matching totals. Every surviving
   number below was re-derived by ADDRESS. (The 80,291-symbol CENSUS in size-facts.md is
   likely ~2.5 MB over in aggregate on the same bug; it is still ordinally correct.)
2. **Cross-row interaction.** GT#2's `--icf=all` -0.250 was MEASURED on today's binary.
   After ~4 MB of other deletions, some of its folds evaporate. Every pair below was
   checked for byte-level disjointness (details per row), but icf=all carries an
   unavoidable ~0.05 MB of systematic uncertainty if it lands LAST. Land it first.

---

## A. COMBINED RANKED TABLE — every skeptic-surviving proposal from BOTH waves

Deduplicated. Shared bytes counted ONCE. REFUTED rows dropped (section D). WEAKENED
rows downgraded in-place with the reason. `(W)` = windows-only. `wave` column is the
proposal's origin; several are merges.

### TIER A — zero perf cost, zero user-visible regression, lands in oven-sh/bun

| # | id | wave | saving_mb | perf | regression | windows | effort | the one-line change |
|--|----|------|-----------|------|------------|---------|--------|----------------------|
| 1 | **windows-delta/gs-minus** | **2** | **1.45 (W)** band 1.35-1.60 | **IMPROVEMENT** (deletes a 49-B prologue/epilogue from each of 28,383 functions, incl. a disassembled hot JSC JSValue type check) | none user-visible. **ONE POLICY SIGN-OFF NEEDED:** removes Windows stack-smash detection — a mitigation `bun-linux` never had (GT#7). It is an accidental clang-cl-driver default nobody ever chose (git pickaxe: never touched). Parity fix. | **windows-ONLY** | small | Add `/GS-` to the windows C/C++ cflags in `scripts/build/flags.ts` AND to `CMAKE_{C,CXX}_FLAGS` in oven-sh/WebKit's windows lanes. Two independently-landable one-line PRs (~50/50 split). **MUST be spelled `/GS-`** — the skeptic proved at the `.obj` level that `-fno-stack-protector` and `/clang:-fno-stack-protector` are both SILENTLY IGNORED by clang-cl. |
| 2 | **pal-textcodecs/replace-pal-with-encoding-rs** (fork **A**) | 1 | **0.39** | neutral | none *if the WPT encoding suite passes* — the one A-row gated on a test, not a proof | yes ~0.39 | medium (days) | Route `TextDecoder`'s legacy branch through `encoding_rs` (already linked; the WHATWG reference impl); delete the 15 `PAL::TextCodec*` files. MUTUALLY EXCLUSIVE with fork B (0.20, proven-safe fallback). |
| 3 | **embedded-js/EJ1-minify-modules** | **1+2** | **0.349** (MEASURED; supersedes wave-1's 0.39 estimate) | **IMPROVEMENT** (21% less source for JSC to lex, one-time per module) | `.toString()`/`error.stack` of builtin-module functions collapse to 1 line (enumerated, cosmetic, debug-only). **Wave-1's N1 instruction as-written SHIPS A BROKEN BINARY** — the skeptic proved in JSC's own `ASSERT_ENABLED` builtin validator that 7 modules crash the parser unless the `/return \$\nexport /` regex at `bundle-modules.ts` is first made `\s*`-tolerant (**EJ1a — MANDATORY, and itself a proven byte-for-byte no-op on today's output**). | **yes 0.349** | small | `src/codegen/bundle-modules.ts:~207`: add `--minify-whitespace`; fix the ONE regex (R5). Also closes the `tmp_modules/` build-path leak (158 strings -> 0). |
| 4 | **dead-features/libarchive-prune** | 1 | **0.254** | neutral | none (proven 3 independent ways) | yes 0.254 | small | New `patches/libarchive/*.patch` editing the two by-code switches (`archive_read_support_format_by_code.c`, `archive_read_append_filter.c`) to keep only tar/gnutar+gzip; trim `SOURCES` in `deps/libarchive.ts`. |
| 5 | **icf-all-linker/icf-all-keep-unique** | 1 | **0.250** | neutral | none (orchestrator relink + 3 smoke tests; gated on an explicit maintainer yes — bare icf=all was reverted in `218430c731`) | **NO** — `lld-link` has no `--keep-unique` (skeptic ran it) | **trivial (RELINK ONLY, minutes)** | `scripts/build/flags.ts:~1288`: `icf=safe`->`all` + `--keep-unique=<mangled callHostFunctionAsConstructor>`. Pre-ship: the 48 `*Constructor::s_info` ClassInfo objects must stay at distinct addresses. NOTE: the sentinel is used at **9+ bun sites** (w2-windows-delta found 5 more than wave 1), so the pointer-identity audit is bigger than wave 1 implied. **Land this FIRST** (its 0.250 was measured pre-everything). |
| 6 | **brotli/P1-brotli-tables-zstd-bss** † | **2** | **0.225** | **one-time-lazy** (first Brotli instance; 0.9 ms; then one relaxed `mov`) | **† the ONLY A-row invoking size-facts' lazy-decompress allowance.** Honest ledger line the report omitted: **~404 KB/process private RSS** for brotli-USING processes (file-backed shared .rodata -> anon .bss). Precedent: the maintainers already shipped `patches/lshpack/bss-huff-tables.patch` — **786 KB of this exact tradeoff at a stricter per-connection site.** | **yes 0.225** (PE .bss = 0 file bytes; skeptic verified) | medium | New `patches/brotli/bss-static-dict.patch`: gate the 5 encoder static-dict tables (413,444 B) behind the UPSTREAM `BROTLI_EXTERNAL_DICTIONARY_DATA` hook; ship one 176,455-B zstd-22 blob; decompress once into `.bss`. Output is **bit-identical** (memcmp-proven). **Design fix required:** the decoder init goes in `BrotliDecoderStateInit`, NOT `BrotliDecoderCreateInstance`. |
| 7 | **boringssl/remove-kyber-mlkem** | 1 | **0.185** | neutral | none (TLS group list hard-locked to X25519/P-256/P-384; `SSL_set1_groups*` absent) | yes ~0.18 | small | New `patches/boringssl/remove-kyber-mlkem.patch`. **Do NOT touch ML-DSA** (Tier C1). |
| 8 | **rust-debug-fmt+rust-mono / std-backtrace-off** | 1 | **0.17** | neutral | a Rust panic BEFORE `crash_handler` installs loses `RUST_BACKTRACE=1` (bun's reporter uses `dladdr`, never gimli). w2-rust-debug-fmt's skeptic independently confirmed every component size (gimli 136 K, addr2line 55 K, demangle 24 K, miniz 13 K). | partial ~0.06 | small | `scripts/build/rust.ts:~380`: append `-Zbuild-std-features=panic-unwind`. Validate `nm | grep -c gimli` == 0. |
| 9 | **generated-classes/gc-1 + wave-1 row 9 MERGED** | **1+2** | **0.167** (= 0.134 subspaceForImpl + 0.033 createStructure; **downgraded from gc-1's 0.17**) | neutral (the `ALWAYS_INLINE` fast path is byte-identical; the 620-B cold body runs once per (T,VM)) | none, but the report's design is INCOMPLETE: the outlined helper MUST carry the `ASCIILiteral` IsoSubspace NAME or every bun class loses its type name in JSC heap snapshots. | yes ~0.17 | medium-large | `src/jsc/bindings/BunClientData.h:186-224` + `src/codegen/generate-classes.ts:577`: keep the 4-instruction inline fast path; outline the ~620-B cold body into ONE shared `NEVER_INLINE` non-template helper. **WHY WEAKENED:** gc-1's 344-copy count was 40% inflated — 137 of the call sites are inside the PREBUILT WebKit's own JSC symbols that `BunClientData.h` cannot reach. Corrected: 207 inlined + 33 standalone = 0.134. |
| 10 | **image-codecs** (4 sub-items) | 1 | **0.165** | neutral (the CLZ intrinsic's perf was measured NEUTRAL by the orchestrator, per upstream's own note — not "improvement") | none (wave-1 skeptics: identical SHA256 output for every adversarial option combo) | yes 0.165 (w2-windows-delta CONFIRMED windows links libjpeg/libwebp directly, not WIC) | small | `deps/libjpeg-turbo.ts`: `USE_CLZ_INTRINSIC` (gate `!arm64`) drops the 64 KB `jpeg_nbits_table`; `deps/libwebp.ts`: `WEBP_REDUCE_CSP` + `WEBP_NEAR_LOSSLESS=0` + `WEBP_REDUCE_SIZE`; the libjpeg `headers.replace` feature undefines. |
| 11 | **brotli/P2-zstd-null-cdict-block-compressors** | **2** | **0.150** | neutral (the removed code is never executed) | none for any reachable bun/Node API — but **a FOREVER constraint**: bun exposes ZERO zstd *compression*-dictionary API today (`ZSTD_createCDict*`, `loadDictionary`, `refCDict/refPrefix` are ALL absent from `src/`; `zstdCompressSync(b,{dictionary})` is byte-identical to no-dict on the canary). The skeptic independently proved the root set from the raw binary: all 48 symbols' only data refs land at the EXACT predicted slots of the 3 dispatch tables, and the patch is upstream's OWN idiom (the tables already ship NULL in 7/10 of one row). Patch also makes `loadDictionary` ERROR (fail-closed). | **yes 0.150** (non-LTO COFF: 48 `/Gy` COMDATs become unreferenced; `/OPT:REF` removes them) | small | New `patches/zstd/*.patch` (~40 lines): NULL rows [2]/[3] of `blockCompressor`, `rowBasedBlockCompressors`, `getAllMatchesFns` in `zstd_compress.c:3071`/`zstd_opt.c:889`; error out `ZSTD_CCtx_loadDictionary_advanced` + `ZSTD_CCtx_refCDict`. |
| 12 | **rust-cold-crates/P2 cli-cold-optimize-size-attr** | **2** | **0.14** (band 0.10-0.20; **downgraded from 0.16**) | neutral (every target is a one-shot CLI command body; the skeptic audited the callers) | none. **WHY WEAKENED:** `build_command` (29 KB) must come OUT (it IS benchmarked: `bench/bundle/`); the 0.30 shrink factor's size-weighted value is driven by de-inlining outliers. | yes ~0.14 | medium | `#![feature(optimize_attribute)]` + `#[optimize(size)]` on every `fn` in the 28 proven-cold `cli/*_command.rs` files + 4 cold `install/{pnpm,yarn,migration,patch_install}.rs`. The attribute does NOT propagate to generic callees (verified on the pinned nightly) — so none of the share-generics tension applies. Tripwire: `hyperfine 'bun --version'`. |
| 13 | **generated-classes/gc-2 redis-destamp** | **2** | **0.13** | neutral / **IMPROVEMENT** (163 x 1.3 KB of per-command cold code -> 7 hot shared bodies = strict I-cache win) | none. The skeptic added the decisive proof the unit lacked: a raw byte-diff of every cluster member — identical code modulo 78-125 relocation bytes — so **no linker flag (icf=safe OR all) can ever fold them**; only a source change can. | yes 0.13 | medium | `src/runtime/valkey_jsc/js_valkey_functions.rs`: move the 7 `macro_rules!` bodies into 7 `#[inline(never)] fn cmd_<shape>_impl(.., meta: &'static CmdMeta)`; each of 163 commands becomes a 3-line thunk. Drop the `#[inline]` on `send_cmd` (:111). **Completeness gap the skeptic found:** `get/ttl/decr/incr/exists/smembers` are HAND-WRITTEN fns that land in the same byte-clusters — the implementer must cover them too or lose ~5-10%. |
| 14 | **cpp-unified/builtinnames table variant** | 1 | **0.12** | **IMPROVEMENT** (the current code is literally `__attribute__((optnone))` = -O0 on a one-shot VM-init path) | none | yes | small | `src/jsc/bindings/BunBuiltinNames.{h,cpp}`: replace the 425-name ctor with a `constexpr ASCIILiteral[]` + a loop. |
| 15 | **rust-mono/P2 install-sort-with-int-collapse** | **2** | **0.076** | neutral (the delta — element width in driftsort's merges — is L1-trivial vs. the per-comparison string compare) | none. Byte-exact (29 syms / 94,363 B). The code's OWN comment at `npm.rs:3092` already says "Could collapse to a single usize path". | yes | small | `src/install/npm.rs:3165-3174`: collapse the `sort_with_int!` 1..=8 byte-width `match` to one `u64` (or `1..=4=>u32,5..=8=>u64`) arm. |
| 16 | **rust-mono/P4 array-hash-map-sort-type-erase** | **2** | **0.051** | neutral (the one A-row that ADDS an indirection: `&mut dyn FnMut` per comparison, on a provably-cold one-shot `bun install` lockfile sort) | none. Exhaustive caller grep: all 6 callers are in `src/install/lockfile/`. **A maintainer can legitimately kill this one on principle ("no new indirect calls").** Needs a 1-line doc comment stating the cold contract. | yes | small | `src/collections/array_hash_map.rs:906-924`: erase the comparator to `&mut dyn FnMut` at the `sort_perm` boundary -> ONE `quicksort<usize,_>` chain instead of 27. |
| 17 | **rust-mono/P3 dns-do-resolve-cares-inner** | **2** | **0.041** (real upside ~0.06: the skeptic found the per-T neighbor families it did not count) | neutral (only 2 callers, both `node:dns` / `Bun.dns` JS entries that already allocate a Promise + do a network query) | none, but the implementer MUST keep `T::SYSCALL` per-type (it is the user-visible thrown error's `.syscall`, node-compat-tested). The skeptic disassembled 2 of the 12: 875 IDENTICAL instructions differing only in relocation targets -> **icf can never fold them; fully additive with row 5.** | yes | medium | `src/runtime/dns_jsc/dns.rs:5372-5425`: hoist the 3,938-B generic body into a non-generic inner fn driven by a `&'static` per-T descriptor. |
| 18 | **embedded-js/EJ2-minify-builtin-functions** | **2** | **0.038** | neutral / improvement | none. 0/385 violate the `(function (` RELEASE_ASSERT; `toString()` is already `[native code]`. BONUS: the minify is unconditional so every `bun bd test` validates it for free. | yes | small | `src/codegen/bundle-functions.ts`: add `--minify-whitespace` to the JS-builtins bundler (the 252,941-B `WebCore::combinedSourceCodeBuffer`). |
| 19 | **duplicate-data/runtime-js-4x** | 1 | **0.038** | one-time-lazy (already lazy) | none | yes | small | `src/bundler/ParseTask.rs`: replace the 4 `concatcp!` arms (4 full copies of `runtime.js`) with a `OnceLock<[String;4]>`. |
| 20 | **rust-cold-crates/P1 cold-crate-opt-z** | **2** | **0.03** (**downgraded from the implied ~0.06**) | neutral | none. **WHY WEAKENED:** two false facts in the coldness argument (`bun_crash_handler::scoped_action` IS called per printed file — harmless only because it is `#[inline]`; `bun_standalone_graph` has a resolver READ side). Conclusion survives; the "airtight" adjective does not. | yes | small | `Cargo.toml`: `[profile.release.package."X"] opt-level = "z"` for `bun_analytics`, `bun_patch`, `bun_exe_format` (+ crash_handler/standalone_graph with the caveats). Precedent: `bun_react_compiler = "s"` at `Cargo.toml:451`. |
| 21 | **cpp-unified/zgc-per-class-cold-throw-tail** | 1 | **0.024** | neutral (the 39-B block sits AFTER `ret`) | none (the getter/setter half was refuted in wave 1 and stays dead) | yes | small-med | `src/codegen/generate-classes.ts`: per-class `[[noreturn]]` cold-throw helpers for the 889 method-callback tails. |
| 22 | **generated-classes/gc-3 cold boilerplate** | **2** | **0.02** (**downgraded from 0.025**) | neutral (always-throw ctor stubs, `.constructor` custom getters, `analyzeHeap`) | none. WHY WEAKENED: sub-item (b)'s "51 x 236 B" is an average presented as a cluster (real: 35x219 + a tail); (c) contradicts the unit's own F2. | yes | small | `src/codegen/generate-classes.ts:671,987,1803`: one shared body per family. |
| 23 | **cpp-unified/internal-module-switch-to-table** | 1 | **0.018** | neutral | none | yes | small | `src/codegen/bundle-modules.ts`: replace the 158-case `createInternalModuleById` switch with a constexpr table. |

**TIER A total: linux 3.03 MB (2.81 strict, i.e. excluding row 6's † lazy allowance).
Windows: ~2.67 MB cross-platform + 1.45 MB /GS- = ~4.1 MB.**

#### TIER A-GATED — zero expected cost, but NOT provable without ONE benchmark

| id | wave | saving_mb | why it is not in Tier A |
|----|------|-----------|--------------------------|
| **rust/share-generics-on** (= `w2-rust-debug-fmt/P1` = `w2-rust-mono/P1`; ONE proposal, two units, **credit once**) | 2 | **0.25** (range 0.20-0.29 standalone). The two skeptics disagree on the icf=all interaction: the rust-mono skeptic prices it 0.11-0.29 incremental; the rust-debug-fmt skeptic proves it essentially additive (LLVM MergeFunctions already ate the IR-identical population; what is left has divergent bytes). | `-Zshare-generics=on` in `rust.ts` (gated to the linux `crossLangLto` path ONLY — the rust-mono skeptic PROVED the Windows argument is wrong). **BOTH units had the same name-vs-address counting bug, inflating 0.46/0.30 -> 0.25-0.29.** And the rust-debug-fmt skeptic FALSIFIED perf-neutrality-by-construction on the shipped binary itself: `P<true,false>::parse_suffix` (bun's transpile hot path) has 2 genuinely divergent 14 KB bodies LLVM chose to specialize per caller-cluster; merging them produces ONE body optimized for the union, of UNKNOWN SIGN, with no PGO in CI to recover the hotness. **Cost to find out: one 40-min rebuild + one `bun build` / transpile benchmark.** The unit's own falsifier (`TryFromIntError x47 -> 1`) is BROKEN (that symbol is non-generic); use `parse_selector::<Selectors> 3 -> 1`. Do NOT combine with crate-level `opt-level="z"` on anything upstream of a hot crate. |

### TIER B — zero perf/regression, but the change lands in oven-sh/WebKit
(The orchestrator has write access; this is a NORMAL path. **ALL nine rows batch into
ONE prebuilt rebuild + ONE `scripts/build/deps/webkit.ts` pin bump.**)

| # | id | wave | saving_mb | perf | regression | windows | effort | the change |
|--|----|------|-----------|------|------------|---------|--------|------------|
| B1 | **iostream-locale-purge** (wave-1 B1; **CONFIRMED and UPGRADED by `w2-cpp-stdlib-rtti`, its sole proposal**) | **1+2** | **0.32** (refined from 0.33; skeptic re-derived 340,102 B to the byte) | **IMPROVEMENT** (6 fewer `.init_array` global ctors at EVERY process start; `std::ios_base::Init::Init()`'s locale heap construction disappears) | none. The skeptic independently re-proved the root set is CLOSED (exactly 3 roots across all 1,133 bun `.o` + 6 WebKit archives + `libbun_rust.a`), that no NAPI addon can bind to bun's libstdc++ (0 dynamic exports), and disassembled the shipped `.init_array`. | **unknown — credit 0 on Windows** (the skeptic explicitly refused to bank it; MS STL pulls iostream differently) | small | (a) oven-sh/WebKit: delete the ONE unconditional `#include <iostream>` at `Source/WTF/wtf/simdutf/simdutf_impl.h:9949` (provably unused). (b) bun: the 5 `std::cerr` -> `fputs` in `packages/bun-uws/src/{HttpContext,App,TopicTree}.h` + their 5 `#include <iostream>`. **ALL-OR-NOTHING: landing only ONE half saves ~0 B** (the other root still extracts `globals_io.o`). Both halves must be in the SAME measured build, with the 3 `nm` oracles as a CI assertion. |
| B2 | **jsc-upstream/jsc-loljit-compile-out** | **2** | **0.30** (real ~0.32: the skeptic found +4 KB of `operation*ForLOL` the regex missed) | neutral (never-executed code behind a runtime bool that is `false` on the canary) | `BUN_JSC_useLOLJIT=1` becomes a no-op — an undocumented, unfinished (`// TODO`) JSC internal experiment. Zero user impact. **Design is COMPLETE** (the skeptic verified the only external refs are a fwd-decl, a `friend`, a comment, and option reads). | yes ~0.30+ | small | oven-sh/WebKit: `ENABLE_LOL_JIT 0` in `PlatformEnable.h`; one-line `#if` at the top of the 5 `lol/*.{h,cpp}`; gate the one dispatch at `jit/BaselineJITPlan.cpp:57`. |
| B3 | **icu-dead-virtuals-patch** (w2-icu-unreachable P3; **SUBSUMES `w2-symbol-hunt/icu-parse-hemisphere` (0.202) + `rbc-vtable-ghosts` (0.006) — those 5 hunks are a strict subset of these 7+1**) | **2** | **0.233** | **IMPROVEMENT** (removes never-taken branches from the LIVE `Intl` construction path) | none. **THE MOST-VERIFIED PROPOSAL OF EITHER WAVE**: two units derived it independently; two skeptics re-proved it independently; one disassembled all 54 MB of canary `.text` (3.15 M reference pairs) and showed the 435-function dead set has ZERO inbound edges from live code, the other built the full inter-object reference graph from the real archive members. A skeptic CORRECTED one proof (`udat_open` has a 2nd LIVE caller via `dateStyle`/`timeStyle`) without changing the conclusion. | **yes ~0.19** (Windows ICU is **73.2** vs Linux **75.1** — the patch must be re-based; credit 0 on the Windows ledger until measured) | medium | oven-sh/WebKit: NEW `vendor/WebKit/icu/dead-code.patch`, 7 hunks across `numfmt/unum/smpdtfmt/decimfmt/number_formatimpl/datefmt.cpp` stubbing the parse hemisphere, RBNF, MessageFormat, the collation-rule COMPILER, and the units router; one `patch -p1` line in each `Dockerfile`. The hunks are INDEPENDENT. Simplification the skeptic found: hunks 1+2(+4) can instead be ICU's own tested `!U_HAVE_RBNF` fallback via a 2-line `rbnf.h` guard. |
| B4 | **wtf-yarr-misc/yarr-tables-to-bss** | 1 | **0.125** | neutral | none (bit-identical at runtime) | yes | small | `yarr/create_regex_tables`: emit the two 64 KB-for-88-bits tables zero-init + a one-time write. |
| B5 | **wtf-yarr-misc/libpas-megapage-to-bss** | 1 | **0.125** | neutral | none | yes | small | `pas_fast_megapage_table.h:61-72`: split the struct into 2 file-scope globals (16 KB all-zero -> `.bss`). |
| B6 | **icf-all-linker/wtf-config-sections-to-nobits** | 1 | **0.032** | neutral | none (ONLY the named-section `@nobits` variant is safe — `permanentlyFreeze()` must own its pages) | probably | small | `WTFConfig.cpp:84`. |
| B7 | **embedded-js/EJ3-jsc-builtins-configuration-release** | **2** | **0.025** | neutral | none (103/103 of the stripped functions proved AST-equivalent; the multi-line-template-literal hazard does not exist: exactly 2 template literals, both single-line) | yes | small | oven-sh/WebKit: JSC's `Scripts/wkbuiltins/builtins_model.py:140` gates its 4 whitespace-strip regexes on a `CONFIGURATION` env var **that JSC's CMake NEVER sets** (0 grep hits). Add `cmake -E env CONFIGURATION=Release` to the one `add_custom_command` at `CMakeLists.txt:389`. A real upstream bug. |
| B8 | **icu-uconfig-no-service** | **2** | **0.016** | improvement | none. The report's reachability proof (F6) is WRONG and the skeptic REPLACED it with a correct disassembly-backed one (`Collator::createInstance`'s `getService()` PLT edge is guarded by a never-true `fState != 0`). Ship the skeptic's proof, not the unit's. | yes | small | oven-sh/WebKit `Dockerfile:210` + `Dockerfile.windows:255`: append `-DUCONFIG_NO_SERVICE=1` (ICU-official, `@stable ICU 3.2`). |
| B9 | **icu-uconfig-no-filtered-break** | **2** | **0.005** | improvement | none (the `ss` locale extension is already unobservable on the canary) | yes | small | Same files: `-DUCONFIG_NO_FILTERED_BREAK_ITERATION=1`. |

**TIER B total (linux): 1.18 MB.** Windows from Tier B: ~0.45-0.70 (B3 0.19 + B2 0.30 + B4/B5; B1 0).

DOWNGRADED out of the banked Tier-B total:
- **Wave-1 B5** (windows icf SOURCE fix, claimed ~0.25 W): the `w2-windows-delta`
  skeptic produced the measurement wave 1 lacked — the hard lower bound computable from
  the shipped `bun.exe` (raw-byte-identical `.pdata` bodies `/OPT:SAFEICF` refused) is
  only **0.046 MB**; GT#2's 0.250 is NOT a transferable floor (different objects,
  linker, and ICF algorithm). Credible 0.05-0.25, point ~0.12, LOW confidence.
  **Keep as a do-after-/GS--then-RELINK-AND-MEASURE item. Do not bank.**
- **Wave-1 B6** (LTO-bloated startup fns, unquantified): the `JITThunks::initialize`
  half (212 KB) is **effectively refuted** — w2-jsc-upstream argued, and its skeptic
  accepted, that the 212 KB is the single-caller callees' bodies, not duplication, so
  outlining them is size-NEUTRAL. `JSGlobalObject::init` (100 KB) stays a measure-only
  lead. **Removed from the totals.**

### TIER C — a real feature/behavior tradeoff; a maintainer must say yes to each

| # | id | wave | saving_mb | windows | the tradeoff, precisely |
|--|----|------|-----------|---------|--------------------------|
| C1 | **jsc-temporal-enable-gate** | **2** | **0.39-0.41** | yes ~0.40 | `typeof Temporal` is `undefined` before AND after — with default options NOTHING changes. What breaks: `BUN_JSC_useTemporal=1`, which TODAY fully enables a working Temporal on the shipped canary (skeptic-run), becomes a no-op. And the strategic cost: Apple is ACTIVELY developing Temporal; when JSC flips the default, bun must revert this. **The unit's design (body-wrap 43 files) is REFUTED** — it silently breaks the LIVE, user-reachable `Intl.DurationFormat.prototype.format()` (whose first step is `TemporalDuration::toTemporalDurationRecord`, which the skeptic ran on the canary) AND fails to compile (`ISO8601.cpp` calls 3 `TemporalCore::` fns in the wrapped set). **The SKEPTIC'S corrected design is what to implement:** gate only the 3 ROOTS (`JSGlobalObject.cpp:1824`, `DatePrototype.cpp:295`, the Temporal-object branch of `IntlDateTimeFormat::handleDateTimeValue`) and let gc-sections+LTO strip the rest. The biggest B/C item. Bun has zero Temporal docs/types/tests. |
| C2 | **boringssl ML-DSA** | 1 | **0.231** | ~0.22 | Removes a WORKING, node-24-compatible feature: two wave-1 skeptics independently completed a real ML-DSA-44 TLS-1.3 handshake on the shipped binary, verified by stock `curl`. 0.23 MB for a final NIST standard (FIPS 204). |
| C3 | **sqlite-drop-fts3/fts4** | 1 | **0.16** | yes ~0.17 | An existing `.sqlite` file containing an fts3/4 table becomes unreadable AND un-DROP-able from `bun:sqlite`. Node 26 ships fts3/4/5+rtree. |
| C4 | **lsquic + lsqpack (http3)** | 1 | **0.42** | yes | `Bun.serve({http3:true})` works today, is documented and typed. The single largest negotiable item. |
| C5 | **sqlite-drop-rtree** | 1 | 0.045 | yes | Both wave-1 skeptics AND this synthesis say SKIP: `loadExtension` + spatialite require the host rtree. |

---

## B. CUMULATIVE TOTALS — are the targets reachable?

### linux-x64 — need **4.86 MB**

| tier | MB | cumulative | reaches 4.86? |
|------|---:|-----------:|----------------|
| **A** (certain, zero-tradeoff, oven-sh/bun) — was **2.0** after wave 1 | **3.03** | 3.03 | NO |
| A (strict: excluding row 6's lazy-decompress allowance) | 2.81 | — | — |
| + **A-GATED** share-generics, IF one benchmark passes | +0.25 | 3.28 | NO |
| + **B** (one oven-sh/WebKit prebuilt rebuild + pin bump) | +1.18 | **4.21** (4.46 w/ s-g) | **NO. Shortfall 0.65 (0.40 w/ s-g).** |
| + **C1** Temporal alone | +0.40 | 4.61 (4.86 w/ s-g) | on the line |
| + **C1 + C2** (Temporal + ML-DSA) | +0.63 | **4.84** | 20 KB short |
| + **C1 + C2 + C3** (+ fts3/4) | +0.79 | **5.00** | **YES** |
| + C4 (http3) as well | +0.42 | 5.42 | comfortably |

**THE HONEST LINUX VERDICT.** Wave 2 added **+1.03 MB to Tier A** (2.0 -> 3.03) and
**+0.58 MB to Tier B** (0.61 -> 1.18) of proven, zero-tradeoff, perf-neutral inventory.
**That is still not 4.86. The linux target is NOT reachable from Tier A + Tier B alone**
— not even with the benchmark-gated share-generics. It IS reachable, three ways:

1. **A + B + two Tier-C yeses.** Temporal (0.40) + ML-DSA (0.23) gets to 4.84; adding
   fts3 (0.16) or share-generics (0.25) clears it with margin. These are the three
   cheapest Tier-C asks; each costs an env-var escape hatch or a niche feature, not a
   mainstream one. **This is the recommended path.**
2. **A + B + wave 3 finding ~0.65 MB more at zero tradeoff.** There are named,
   partially-verified leads worth MORE than the gap (§E below) — but none is yet a
   skeptic-surviving row, so I do not bank them.
3. Both.

Two things every reader must internalize: (a) this is the residual AFTER two waves, 29
units, and 47 adversarial skeptic passes over an already well-tuned binary — GT#5's
"the easy levers are pulled" is now exhaustively proven; (b) **the Rust `.text` thesis
from wave 1 is now FALSIFIED on two of its three axes.** Wave 1 said the 16.37 MB of
Rust .text was "the #1 unexplored target, plausibly the missing MBs." Wave 2 went
there with 4 units and found: the derive(Debug) axis is **exactly ZERO** (GT#8, now
proven to the symbol — and for a stronger reason than LTO: rustc's demand-driven
monomorphization collector never codegens an uncalled derive, so the zero holds on
Windows too); the cold-CRATE axis is **0.03 MB** (bun's crate boundaries do not align
with its hot/cold boundary — only 4.7% of the Rust .text is identifiably cold); the
genuinely new money is the **monomorphization/codegen axis** (share-generics 0.25
gated + P2/P3/P4 0.17 + the RedisClient de-stamp 0.13 + rust-cold P2 0.14 ≈ **0.7 MB**).
The Rust .text was worth ~0.7-0.95 MB, not 2+.

### windows-x64 — need **2.00 MB**

| tier | MB | reaches 2.00? |
|------|---:|----------------|
| `windows-delta/gs-minus` ALONE (one policy sign-off, two 1-line PRs) | **1.45** | 73% of the gap by itself |
| + EJ1 minify-whitespace (0.35) + libarchive (0.25) | **2.05** | **YES — three small changes** |
| **full Tier A** (/GS- 1.45 + the ~2.67 MB of cross-platform rows at the measured ~1.0x transfer) | **~4.1** | **YES, >2x over** |
| cross-platform Tier A alone, WITHOUT /GS- | ~2.67 | **YES, even if /GS- is vetoed** |
| + Tier B windows (B2 0.30 + B4/B5 0.25 + B3 ~0.19) | +~0.7 | margin |

**THE WINDOWS VERDICT: comfortably, redundantly reachable.** The `w2-windows-delta`
skeptic established the transfer rule empirically from the SAME CI build (windows
`.text`/linux `.text` = 1.026, `.rdata`/`.rodata` = 1.005), so cross-platform rows
transfer at ~1.0x (band 0.8-1.2x per row; the order is exact). **The single decision
that matters is /GS-.** It is the highest-confidence, highest-value finding of either
wave: every count reproduced from scratch by the skeptic, the mechanism proven at the
`.obj` level, a hot JSC caller disassembled showing 42% of its bytes are the stack
protector, and `git` proving nobody ever chose it. It needs one explicit Jarred/Dylan
sign-off because it removes a mitigation — one the Linux flagship never had.

---

## C. IMPLEMENTATION ORDER for Tier A (both waves) — cheapest-certain first

Rule: relink-only first; then small+byte-exact; then medium; A-gated and Tier B last.
Every file path is exact. (Wave-1 R1/R2/R4 are already SHIPPED in PR #33224.)

1. **icf-all-keep-unique** (-0.250 linux, **RELINK ONLY, minutes**) — **gated on a
   maintainer yes.** `scripts/build/flags.ts:~1288`. Land FIRST so its measured number
   stays exact. Pre-ship: the 48 ClassInfo addresses + the 9+ sentinel-use audit.
2. **EJ1a** (regex fix ALONE, 0 bytes, ZERO risk — proven byte-identical on today's
   output) — `src/codegen/bundle-modules.ts:~250`: `/return \$\nexport /` ->
   `/return \$\s*export\s*(?=\{)/`. Ship as its own prep PR.
3. **EJ1 minify-whitespace** (-0.349) — `bundle-modules.ts:~207`: add
   `--minify-whitespace`. Requires #2. Gate: `BUN_JSC_validateBytecode=1` on a RELEASE
   build (NOT `bun bd test` — the debug build never loads the minified text; the
   skeptic proved wave-1's verification plan was wrong here too).
4. **EJ2** (-0.038) — `src/codegen/bundle-functions.ts`: same flag.
5. **rust-mono/P2** (-0.076) — `src/install/npm.rs:3165-3174`, one `match` arm.
6. **runtime-js-4x** (-0.038) — `src/bundler/ParseTask.rs`, `OnceLock`.
7. **libarchive-prune** (-0.254) — new `patches/libarchive/*.patch` + `deps/libarchive.ts`.
8. **boringssl Kyber+ML-KEM** (-0.185) — new `patches/boringssl/remove-kyber-mlkem.patch`.
9. **image codecs** (-0.165) — `deps/libjpeg-turbo.ts` (`USE_CLZ_INTRINSIC`, !arm64),
   `deps/libwebp.ts` (`WEBP_REDUCE_CSP`, `WEBP_NEAR_LOSSLESS=0`, `WEBP_REDUCE_SIZE`),
   the libjpeg `headers.replace` undefines.
10. **rust-std-backtrace-off** (-0.17) — `scripts/build/rust.ts:~380`.
11. **BunBuiltinNames table** (-0.12) — `src/jsc/bindings/BunBuiltinNames.{h,cpp}`.
12. **zstd-null-cdict** (-0.150) — new `patches/zstd/*.patch` (~40 lines) nulling rows
    [2]/[3] of `blockCompressor`, `rowBasedBlockCompressors`, `getAllMatchesFns` in
    `zstd_compress.c`/`zstd_opt.c` + erroring `ZSTD_CCtx_loadDictionary_advanced` and
    `ZSTD_CCtx_refCDict` (fail-closed).
13. **rust-mono/P4** (-0.051) — `src/collections/array_hash_map.rs:906-924`.
14. **internal-module table** (-0.018) + **gc-3** (-0.02) + **cold-throw-tail**
    (-0.024) — all in `src/codegen/{generate-classes,bundle-modules}.ts`; one PR.
15. **rust-cold P1** (-0.03) — `Cargo.toml`, 5 `[profile.release.package."X"]` lines.
16. **brotli-tables-zstd-bss** (-0.225, the † row) — `deps/brotli.ts` + new
    `patches/brotli/bss-static-dict.patch`; decoder init in `BrotliDecoderStateInit`.
    **Carry the honest RSS line in the PR.**
17. **gc-2 redis-destamp** (-0.13) — `src/runtime/valkey_jsc/js_valkey_functions.rs`,
    incl. the 6 hand-written fns.
18. **rust-cold P2** (-0.14) — `#[optimize(size)]` across the 28 cold `cli/*.rs` files.
19. **rust-mono/P3** (-0.041) — `src/runtime/dns_jsc/dns.rs:5372-5425`.
20. **gc-1 merged** (-0.167) — `BunClientData.h:186-224` + `generate-classes.ts:577`
    (with the IsoSubspace NAME fix). The largest-effort A item.
21. **encoding fork A** (-0.39) — `src/runtime/webcore/TextDecoder.rs` + delete
    `src/jsc/bindings/{TextCodec*,EncodingTables*,TextEncoding*}`. Gate: the WPT
    encoding suite. If it fails, fall back to fork B (-0.20).
22. **A-GATED: share-generics** — one flag in `rust.ts` on the `cfg.crossLangLto`
    branch + one 40-min rebuild + ONE transpile benchmark + the CORRECTED falsifier.
23. **(W) /GS-** — `scripts/build/flags.ts` windows cflags + oven-sh/WebKit windows
    `CMAKE_{C,CXX}_FLAGS`. After the policy sign-off. Two PRs.
24. **TIER B, all nine rows, ONE batch** — one oven-sh/WebKit prebuilt rebuild + one
    pin bump in `scripts/build/deps/webkit.ts` delivers **-1.18 MB linux**. B1 is
    all-or-nothing across the two repos; land its bun-uws half in the same measured
    build.

---

## D. DISCARDED — one line each

**REFUTED by a wave-2 skeptic (do not implement)**
- `w2-jsc-upstream/P3-G` (remove `Inspector::Remote*`, 30.6 KB) — `require("bun:jsc").startRemoteDebugger(host, port)` is a LIVE, TYPED, public API; the skeptic RAN it on the shipped canary.
- `w2-jsc-upstream/P3-L` (remove `InspectorAuditAgent`) — it IS registered (`JSGlobalObjectInspectorController.cpp:367`) and in bun's shipped inspector protocol types.
- `w2-jsc-upstream/P2` Temporal **AS DESIGNED** (43-file body-wrap) — breaks the live `Intl.DurationFormat` and does not compile; only the skeptic's 3-root design survives (-> Tier C1).
- `w2-jsc-upstream/P3` as a package — 8+ separate upstream patches for ~0.11 MB after the two refutations; superseded by the skeptic's two single-site mega-items (-> wave 3).
- `w2-rust-cold-crates/P3` (cli-cold-crate-split) — **does not compile**: 4 real hot->cold cross-module calls form a dependency cycle the design never addresses, AND the 1.29x CGU multiplier is misapplied (a carved-out crate CREATES a generic tail — that is exactly why react_compiler cost +1.0 MB — so the sign of its biggest term is unknown).
- `w2-icu-unreachable/F6`'s reachability PROOF for `UCONFIG_NO_SERVICE` — factually wrong (the `getService()` PLT edge exists); the conclusion survives on the skeptic's replacement proof. **A reviewer checking F6 literally will bounce the PR.**
- `w2-symbol-hunt`'s own brief suggestion `icu_75::Region` removal — Region is a real runtime fallback of the LIVE `DateTimePatternGenerator`.
- The unit-report by-NAME symbol sums (both Rust units, 0.46/0.30 claimed) — 32-40% phantom bytes from ICF/MergeFunctions aliases. Both skeptics found the identical bug independently.

**CONFIRMED ZERO (valuable negatives — nobody should re-chase these)**
- **`derive(Debug)` / manual `impl Debug` / `cfg_attr` on the AST enums** — the entire `w2-rust-debug-fmt` assigned avenue. 47 derives -> 3 surviving 41-B impls; `bun_js_parser` has ZERO. The mechanism is rustc's demand-driven monomorphization collector (NOT fat LTO), so it holds on Windows and on non-LTO builds too. == GT#8, now proven to the symbol.
- `-Zlocation-detail=none` — ALREADY SHIPPED at `rust.ts:525`. `core::panicking` = 746 B exact.
- Release-build Rust debug logging — a literal `const false` gate (`buildOptionsRs.ts:68`).
- `-fno-rtti` — already everywhere it can be (`flags.ts:348` unix, `:353` `/GR-` windows, in `globalFlags` which covers vendored deps). Binary-wide `_ZTS+_ZTI` ceiling is **34,539 B**, all ICU+libstdc++, ZERO from any bun namespace. Dead.
- `__cxa_demangle` (49 KB) — load-bearing (`WTF::StackTracePrinter::dump` for the `--cpu-prof` SamplingProfiler). Correctly not regressed.
- Every other `UCONFIG_NO_*` macro (regex, translit, IDNA, break-iteration, collation, normalization, formatting-subsets) — already 0 bytes / load-bearing / would break Intl. The ICU avenue is now closed on ALL THREE axes (data, UCONFIG, and — except the 0.23 surgical patch — code).
- zstd legacy decoders — `ZSTD_LEGACY_SUPPORT: 0` already; 0 symbols.
- JSC instruction DECODER — not present (`ENABLE_DISASSEMBLER 0`). (But the 27 KB of now-useless disassembler SCAFFOLDING is real -> wave 3.)
- The brief's literal ask to `w2-generated-classes` ("ONE descriptor-dispatched trampoline for the 877 generated methods, 0.5-1.5 MB") — **correctly REFUSED by the unit**: a megamorphic 877-target indirect branch that ALSO defeats the cross-language LTO already inlining every Rust impl into its C++ shell; only ~113 KB of the 873 KB is shell. The skeptic endorses the refusal.
- **The entire >= 4 KB symbol population outside ICU** — `w2-symbol-hunt` individually bucketed all 2,098 symbols (20.9 MB) and traced every suspicious one to a live root (`Bun.Image().jpeg()`, `bun:ffi cc`, `Bun.WebView`, `expect().toEqual`, ...). The suspicious-AND-unclaimed set is **EMPTY**. There is no second hidden dead feature in the large-symbol population.
- `w2-windows-delta`'s pre-answered clang-cl divergent-default sweep — frame pointers (already none), `/O2`->cc1 `-O3` (parity), `-faddrsig` (default on), RTTI/exceptions (off). After /GS-, **nothing else**.

**Perf-locked (violates the hard constraint; wave 2 MEASURED the cost)**
- **Removing the brotli encoder static dictionary** — `w2-brotli-and-codecs` measured the q11 ratio loss on real inputs: **15.6% / 11.5% / 69% worse** (gzip-9 control: ~0%). Unbounded, per-`Content-Encoding: br`-response network regression. The most decisively dead item of wave 2. (Deriving the table at runtime is also dead: upstream's own `TODO` at `encoder_dict.c:371` says the shipped table was built with a frequency map the runtime builder lacks.)
- Everything from wave 1's perf-locked list (-Os/-Oz globally, lower the LTO level, thin-LTO linux, remove frame pointers, `-falign-functions=1`, compress the boringssl ecc precomp, UPX, `bun-standalone`, turn off linux LTO) — all still dead.

**Duplicates (counted ONCE in section A)**
- `w2-rust-debug-fmt/P1` == `w2-rust-mono/P1` == the `-Zshare-generics` discussed in `w2-rust-cold-crates/F8`: ONE proposal, one A-GATED row.
- `w2-symbol-hunt/icu-parse-hemisphere` (0.202) + `rbc-vtable-ghosts` (0.006) ⊂ `w2-icu-unreachable/icu-dead-virtuals-patch` (0.233): 5 of its 7 hunks + the Tier-B 8th are identical text. Credited ONCE at 0.233; the independent 4-way re-derivation is why B3's confidence is the highest in the table.
- `w2-cpp-stdlib-rtti/iostream-locale-purge` **IS wave-1 row B1**. 0.00 NEW money. What wave 2 adds is the missing PROOF (closed 3-root set, the Int128 reverse-path, the 12 named `.init_array` identities). Recorded as "B1, confidence upgraded".
- `w2-generated-classes/gc-1` ABSORBS wave-1 row 9's subspaceForImpl half (0.017); merged into one row at 0.167.
- `w2-embedded-js-impl/EJ1` == wave-1 row 1 (minify-whitespace); the MEASURED 0.349 replaces the 0.39 estimate.
- `w2-brotli-and-codecs/D8` correctly CITES wave-1 row 7(a) (jpeg_nbits) rather than re-claiming it.

**Below the noise floor / 0 MB (correct, worth landing, not counted)**
- `w2-windows-delta/P3`: two stale `flags.ts` comments (`/Oy-` is a SILENT x64 NO-OP — the "Keep frame pointers" desc at :365 is false; `/O2` maps to cc1 `-O3`). 0 bytes. Land so nobody "fixes" either.
- `w2-icu-unreachable/P4` (windows ICU 73.2-vs-75.1 version skew + missing `UCONFIG_NO_LEGACY_CONVERSION`) — 0 bytes claimed, real hygiene debt.

---

## E. HANDOFF TO WAVE 3 (the Jarred/Dylan build-flag / CI / dep-internals / pattern hunt)

**Where NOT to look (exhaustively closed by waves 1+2):** linker flags beyond
`--icf=all` (GT#2/#5); the ICU data AND code axes; `derive(Debug)`; `-fno-rtti`; cold
CRATES; any large (>=4 KB) dead `.text` symbol; the clang-cl divergent-default class
after /GS-; and — a CORRECTION to wave 1's closing claim — **"Windows full LTO" is a
PERF lever, not a size one** (`-fwhole-program-vtables` is `when: c.unix && c.lto`, so
LTO-on-Windows would not recover the vtable bytes, and the ThinLTO-miscompiles-JSC gate
is a correctness hunt). Do not spend size budget there.

**The leads, ranked. #1-#3 alone are worth more than linux's 0.65 MB A+B shortfall.**

1. **JSC's dead graph-coloring register allocator, ~0.18 MB** (+ the `validateGraph`
   set ~0.10 = **~0.28 MB in TWO single-site `#if` gates** in oven-sh/WebKit). FOUND BY
   the `w2-jsc-upstream` SKEPTIC, not the unit, so it has had ONE rigorous pass but no
   adversarial second one — which is why I did not bank it. The evidence is strong:
   `Options::airUseGreedyRegAlloc()` defaults TRUE on the canary (verified by
   `BUN_JSC_dumpOptions=3`), `AirGenerate.cpp:119-122` is the ONLY dispatch, and
   `allocateRegistersByGraphColoring` (IRC + Briggs + framework, 183,304 B, 36 addrs, 0
   ICF-shared) has exactly ONE caller. Same regression class as LOLJIT/Temporal: a
   default-false `BUN_JSC_*` knob becomes a no-op. **Check whether greedy ever FALLS
   BACK to graph coloring before gating.** This is the single best lead I have.
2. **The Windows `/OPT:ICF` number** — do AFTER /GS- lands, then **relink and measure**.
   Credible 0.05-0.25; nobody can bound it tighter from the shipped exe.
3. **JSC's OWN `subspaceForImpl` LTO-inlining defect**: the `w2-generated-classes`
   skeptic found **95 copies (~57 KB) of the identical 620-B cold body** LTO-inlined
   into JSC's own `create()` functions (`BigIntObject`, `ProxyObject`, `IntlCollator`,
   `JSWeakMap`, ...). A `NEVER_INLINE` on JSC's `Heap::*SpaceSlow` pattern in
   oven-sh/WebKit. Same mechanism as Tier-A row 9, different repo. Plus
   **`Zig::GlobalObject::addBuiltinGlobals` (48,121 B)**, a bun-side one-shot-init
   function in the same LTO-bloat class; and **`JSGlobalObject::init` (100 KB)** — both
   need a MEASUREMENT, not another estimate.
4. **The brotli pattern GENERALIZES.** bun already ships
   `patches/lshpack/bss-huff-tables.patch` (786 KB of rodata -> zstd-blob + `.bss`),
   and the orchestrator's own ICU work is the same shape. Sweep the canary's `.rodata`
   for every OTHER large, cold, compressible `r` table. Remaining census `.rodata`:
   `PAL` 0.31 (owned by Tier-A row 2), `Yarr` 0.26 (owned by B4), `boringssl` 0.25 (the
   ecc precomp is 7.999 bits/byte — PROVEN incompressible; skip it). The CI metric is
   `statSync(strippedExe).size` (`ci.ts:423`), so `.bss` (0 file bytes) is exactly the
   right lever.
5. **A general build-system RULE the `w2-rust-cold-crates` skeptic derived** (new, not
   in any unit): lld `--icf=safe` **cannot fold the O3/optsize twins of the same
   monomorphization**, so ANY per-package `opt-level` override pays an un-folded
   duplicate tax on every SHARED generic it instantiates. A per-package override is net
   positive only on a crate with a UNIQUE type universe (react_compiler) — **never on a
   crate carved out of a bigger one.** This pre-kills a whole class of wave-3 ideas.
6. **PGO is NOT in the CI release pipeline** (`.buildkite/ci.mjs`: 0 `pgo` hits;
   `--pgo-generate/use` are unwired dev flags in `scripts/build/config.ts:845-848`).
   Not a size item — but it is the reason share-generics' perf question is statically
   unanswerable, and it is a perf lever hiding in plain sight in a CI-pipeline hunt.
7. **Methodology every wave-3 number MUST use:** canonicalize `nm` symbols by ADDRESS
   (`awk '{print $1}' | sort -u`) or over-count by ~2.5 MB. Both Rust units fell for
   this; both skeptics caught it.
8. The **8 residual small JSC option-gated sets** from `w2-jsc-upstream/P3` (Profiler
   39 K, disasm scaffolding 27 K, JITDump/GdbJIT 16 K, Options DESCRIPTION strings
   15 K, ICStats 12 K, ...) total ~0.11 MB across 5+ separate gates — real, skeptic-
   confirmed to the byte, but a poor effort/byte ratio. Only worth batching into a
   bigger WebKit sweep. **TRAP:** the HOT, LIVE `JSC::ICStatus` machinery (56 KB)
   matches a careless `ICStat` regex; do not touch it.
9. **Windows-only facts established:** `/Gw` + `/Gy` + `/OPT:{REF,SAFEICF}` + `/MT` are
   ALL already set (the brief's prime suspects are all 0); SEH unwind (`.pdata` +
   `.xdata`) is exactly **1.19 MiB** and mandatory on win64 — close that book; the
   15,106 unique UNWIND_INFO records, the `.tls`, and the export surface are all fine.
   Windows links libjpeg/libwebp directly (not WIC) so every codec row transfers.

---

*Every wave-2 row's evidence came through a skeptic file on disk (none relied on the
journal alone). Wave-1 rows carry wave-1's provenance. This document is the complete,
deduplicated inventory of both waves; nothing skeptic-surviving was dropped.*
