# FINAL — bun binary size, three waves (39 units, 67 adversarial skeptic passes)

**Targets** (authoritative: `scripts/binary-size.ts`, post-PR #33224):
`bun-linux-x64` 73.32 MB → need ≤ 68.46 = **4.86 MB left**.
`bun-windows-x64` 75.92 MB → need ≤ 73.92 = **2.00 MB left**.
Hard constraint: every row is performance-NEUTRAL or an IMPROVEMENT. No exceptions.

## THE VERDICT, FIRST

> **⚠️ SUPERSEDED IN PART. W1 (embedded-js-zstd), the single largest item below,
> was REJECTED by @Jarred-Sumner: "bad idea. don't do this!" (oven-sh/bun#33250,
> CHANGES_REQUESTED, PR closed unmerged). It had been implemented and CI-measured
> at -1.33 to -1.34 MB on all 15 platforms, so the bytes were real; the design
> was not wanted. Every total below that includes W1 is therefore wrong. See
> §D "REJECTED BY A MAINTAINER" for the corrected arithmetic. Treat the whole
> `†` lazy-decompress class as suspect until the specific objection is known.**

- **Linux Tier A alone (oven-sh/bun only, zero perf cost, zero regression): 4.68 MB.**
  ~~96% of the gap from one repo with zero policy decisions.~~
  **Corrected: 3.69 MB once W1's 0.995 is removed.**
- **Linux Tier A + Tier B (one batched oven-sh/WebKit rebuild + one pin bump): 6.46 MB.**
  **Corrected: 5.47 MB. The linux target (4.86) is still reachable, but only with
  Tier B, and the 1.60 MB of margin is now 0.61 MB.**
- **Windows: trivially reached from 5 small cross-platform Tier-A PRs**
  (W1+EJ1 1.34 + libarchive 0.25 + CP-1 0.17 + image-codecs 0.17 + any one more).
  **Corrected: without W1 this is no longer trivial. The PRs actually merged so
  far total -0.94 MB against a 2.00 MB need; roughly 1.1 MB more of Tier A must
  ship.** /GS- measured at -0.69 MB (not 1.45 — `flags.ts` only reaches bun's own
  code and the deps bun compiles, not the WebKit prebuilt), so it is no longer
  "pure margin" either.
- ~~The single finding that changed the answer is **W1 (embedded-js-zstd)**~~ —
  the bytes were real and independently re-derived three times, but the design
  was rejected. **The honest post-mortem: a finding is not money until a
  maintainer wants the design, and a skeptic pass that only audits the BYTES
  will never catch that.** Every wave verified W1's arithmetic; none of them
  asked whether bun wants module source on the heap.

## Provenance
Every wave-3 row below survived an independent adversarial skeptic who re-derived
its bytes BY ADDRESS from `/tmp/canary/nm-dem.txt` (decimal radix) and, where
relevant, re-ran the live canary. I additionally re-verified the four headline
wave-3 numbers myself (W1's compression, CP-1's 288 addresses, webkit-P1's
598,554 B union, and the live `JSC::Options` defaults). Wave-1/2 rows carry
SYNTHESIS2's provenance. REFUTED rows are in section D, not here.

---

# A. THE ONE COMBINED RANKED TABLE (all three waves, deduplicated, shared bytes once)

Column key: **wave** = origin (w3 rows are NEW money); **relink** = measurable by a
relink/strip alone (minutes) vs a rebuild; `(W)` = windows-only; `†` = invokes
size-facts' sanctioned lazy-decompress allowance (the mechanism the maintainers
have already shipped 3× themselves: ICU `compress-data.ts`, `patches/lshpack/
bss-huff-tables.patch`, node-fallbacks). `saving_mb` is the LINUX delta.

## TIER A — zero perf cost, zero regression, lands in oven-sh/bun

| # | id | wave | saving_mb | perf | regression | windows | effort | relink | the one-line change |
|--:|----|------|----------:|------|------------|---------|--------|--------|---------------------|
| 1 | **(W) windows/gs-minus** | 2 | **1.45 (W)** | IMPROVEMENT | none; ONE policy sign-off (removes a Windows stack-canary linux never had; nobody ever chose it) | windows-ONLY | small | no | `/GS-` in `flags.ts` windows cflags + oven-sh/WebKit windows `CMAKE_{C,CXX}_FLAGS`. MUST be spelled `/GS-` (`-fno-stack-protector` is silently ignored by clang-cl). Two 1-line PRs. |
| 2 | **weird-ideas/W1 embedded-js-zstd** † | **3** | **0.995** (net over row 4; 1.306 alone; W1+EJ1 combined = 1.344, MEASURED) | one-time-lazy(`InternalModuleRegistry::requireId`, an existing `if (!value)` cached-field check) — ≤4% of the already-lazy 11 ms module cascade it precedes, even on the hottest real trigger (`process.stdout`); **0 modules load on bare startup** (proven by a heap-snapshot edge-count oracle) | none observable; `fn.toString()` is byte-identical (unlike EJ1). Honest RSS line: a loaded module's source moves from shared file-backed `.rodata` to per-VM heap. | **yes ~1.30** | small-med | no | `src/codegen/helpers.ts:34` + `bundle-modules.ts:384,401`: emit `${name}Zstd[K]` + `${name}RawSize` instead of the raw array; `src/jsc/bindings/InternalModuleRegistry.cpp:118` `INTERNAL_MODULE_REGISTRY_GENERATE`: `ZSTD_getFrameContentSize`+`StringImpl::createUninitialized`+`ZSTD_decompress` (decoder already linked). |
| 3 | **pal-textcodecs/encoding-fork A** | 1 | **0.39** | neutral | none IF the WPT encoding suite passes (the one A row gated on a test, not a proof). Fallback: fork B (lolhtml-utf8-only, 0.20, proven). | yes 0.39 | medium | no | Route `TextDecoder`'s legacy branch through the already-linked `encoding_rs`; delete the 15 `PAL::TextCodec*` files. `.encoding` must return `name().to_ascii_lowercase()`. |
| 4 | **embedded-js/EJ1 minify-whitespace** | 1+2 | **0.349** | IMPROVEMENT (21% less source to lex) | builtin `fn.toString()` collapses to 1 line (cosmetic). **MANDATORY prep: EJ1a**, the `\s*`-tolerant regex fix at `bundle-modules.ts:~250` — 7 modules crash JSC's validator without it. | yes 0.349 | small | no | `src/codegen/bundle-modules.ts:~207`: add `--minify-whitespace`. Verification gate is `BUN_JSC_validateBytecode=1` on a RELEASE build. **Note: W1 (row 2) is 2.8× bigger and has ZERO behavior change; if the maintainers take only one, take W1.** |
| 5 | **dead-features/libarchive-prune** | 1 | **0.254** | neutral | none (proven 3 ways; `new Bun.Archive(zipBuf)` already errors today) | yes 0.254 | small | no | New `patches/libarchive/*.patch` editing `archive_read_support_format_by_code.c` + `archive_read_append_filter.c` to keep only tar/gnutar+gzip; trim `SOURCES` in `deps/libarchive.ts`. |
| 6 | **icf-all / MergeFunctions** (RESHAPED by w3-machine-outliner) | 1→3 | **0.25** (MergeFunctions alone 0.15–0.22; the 0.250 is GT#2's MEASURED relink with `icf=all`) | neutral | none | **no** (lld-link has no `--keep-unique`; ThinLTO makes MergeFunctions per-module) | trivial | **YES — minutes** | TWO spellings, both relink-only in `flags.ts` linkerFlags. **(b) RECOMMENDED, zero gates:** `-Wl,-mllvm,-enable-merge-functions` next to the LINUX `-flto=full` block at `:883-886` (NOT the darwin `:873` block) — proven address-safe for every address-significant fn; it structurally dodges the whole `218430c731` bug class, needs no `--keep-unique`, no 9-site audit. **(a) optional on top:** `--icf=all --keep-unique=<callHostFunctionAsConstructor>` for the residual ~0.05. They compose. ONE relink measures both. |
| 7 | **weird-ideas/W3 ∪ code-patterns/CP-2 ∪ archaeology/P1 — cold-CLI-asset-zstd** † | **3** | **0.22** (0.17 address-hard + 0.05 probe-verified) | one-shot CLI (`bun init`/`create`/`completions`) or one-time-lazy (bake dev server) — NOT ONE byte is on `bun run`/`test`/`install`/`build`/`Bun.serve` | none. RSS: ~192 KB anon only for a bake-dev-server process, whose biggest asset is ALREADY heap-copied today. | yes ~0.22 | medium | no | Extend `runtime_embed_file!` (`src/bun_core/util.rs:3146`) with a zstd arm whose body IS `src/resolver/node_fallbacks.rs:42-67` (the maintainers' own shipped mechanism); flip ~22 call sites in `cli/{init,create,shell_completions}.rs`, `bake/{bake_body,DevServer}.rs`, `js_parser/parser.rs:466-476`, `ffi/mod.rs:232`. Use a per-COMMAND archive, not per-file (CP-2 skeptic: per-file is only 0.085). **Drop `welcome-page.html.gz`** — it IS the HTTP wire format (REFUTED). |
| 8 | **boringssl/remove-kyber-mlkem** | 1 | **0.185** | neutral | none (TLS group list hard-locked to X25519/P-256/P-384) | yes 0.18 | small | no | New `patches/boringssl/remove-kyber-mlkem.patch`. **Do NOT touch ML-DSA** (Tier C2). |
| 9 | **rust/std-backtrace-off** | 1→3 | **0.17** | neutral | a Rust panic BEFORE `set_hook` loses only the SYMBOLIZED frames (raw frames survive — the print loop is not feature-gated) | ~0.02 (dbghelp backend, proven from std's Cargo.toml) | small | no | **SYNTHESIS2's spelling FAILS THE BUILD.** It is a CARGO arg: in `scripts/build/rust.ts` `args` at line **399** (next to `-Zbuild-std=`), NOT `rustflags`: `if (cfg.release && !cfg.assertions && !cfg.asan) args.push("-Zbuild-std-features=panic-unwind")`. Fix the stale `src/bun_core/Global.rs:160-167` comment in the same PR. CI oracle: `nm \| grep -c gimli` == 0. |
| 10 | **code-patterns/CP-1 lazy-common-strings** | **3** | **0.168** | neutral (the hot `LazyProperty::get()` is byte-identical; the 288 collapsed bodies each run ONCE per globalObject) | none. Two defects to fix: each file keeps ITS OWN string ctor (`jsOwnedString` vs `jsString(AtomString)`); add one `RELEASE_ASSERT` on the array-index recovery. | yes 0.17 | small→med | no | `src/jsc/bindings/{BunCommonStrings,BunHttp2CommonStrings,BunMarkdownTagStrings,webcore/HTTPHeaderIdentifiers}.{h,cpp}`: replace the per-literal X-macro lambda with ONE shared lambda + a `constexpr ASCIILiteral kLits[]` indexed by `&init.property - &m_strings[0]`. 2 of the 4 files ALREADY have the array. 288 relocation-divergent bodies → 4; NO linker flag can ever fold them (fully additive with row 6). |
| 11 | **gc-1 subspaceForImpl** | 2 | **0.167** | neutral | the outlined helper MUST carry the `ASCIILiteral` IsoSubspace NAME | yes 0.17 | med-large | no | `BunClientData.h:186-224` + `generate-classes.ts:577`: keep the inline fast path, outline the 620-B cold body into ONE shared `NEVER_INLINE` helper. |
| 12 | **image-codecs** (4 sub-items) | 1 | **0.165** | neutral (CLZ intrinsic measured NEUTRAL per upstream's own note) | none | yes 0.165 | small | no | `deps/libjpeg-turbo.ts`: `USE_CLZ_INTRINSIC` (gate `!arm64`); `deps/libwebp.ts`: `WEBP_REDUCE_CSP`, `WEBP_NEAR_LOSSLESS=0`, `WEBP_REDUCE_SIZE`; the libjpeg `headers.replace` undefines. Free add-on from w3-dep-internals: drop `C_ARITH_CODING_SUPPORTED` (~7 KB, encode half only). |
| 13 | **zstd/null-cdict-block-compressors** | 2 | **0.150** | neutral | bun exposes ZERO zstd compression-dictionary API today (proven); the patch makes `loadDictionary` ERROR (fail-closed). COMPATIBLE with row 2 (decoder untouched). | yes 0.150 | small | no | New `patches/zstd/*.patch` (~40 lines): NULL rows [2]/[3] of the 3 dispatch tables in `zstd_compress.c:3071`/`zstd_opt.c:889`. |
| 14 | **rust-cold/cli-optimize-size-attr** | 2 | **0.14** | neutral (`hyperfine 'bun --version'` tripwire) | none; `build_command` EXCLUDED (benchmarked) | yes 0.14 | medium | no | `#![feature(optimize_attribute)]` + `#[optimize(size)]` on the 28 proven-cold `cli/*_command.rs` files + 4 cold `install/*.rs`. |
| 15 | **gc-2 redis-destamp** | 2 | **0.13** | IMPROVEMENT (163 × 1.3 KB cold → 7 hot shared = I-cache win) | none; MUST also cover the 6 hand-written fns | yes 0.13 | medium | no | `src/runtime/valkey_jsc/js_valkey_functions.rs`: 7 `#[inline(never)] fn cmd_<shape>_impl(&'static CmdMeta)`; drop `#[inline]` on `send_cmd` (:111). |
| 16 | **cpp/builtinnames table** | 1 | **0.12** | IMPROVEMENT (the code is literally `optnone` = -O0 today) | none | yes | small | no | `src/jsc/bindings/BunBuiltinNames.{h,cpp}`: a `constexpr ASCIILiteral[]` + a loop. **If the members become an array the DTOR collapses too and row 17 loses ~36 KB — one of them gets those bytes, not both.** |
| 17 | **lto-pipeline/LP-2a minsize on one-shot bun giants** | **3** | **0.10** (skeptic RAISED the unit's 0.05 to 0.14; the bun-only half ≈ 75% of it) | neutral; `hyperfine 'bun --version'` tripwire (the de-inlining is real but bounded ~10-20 µs vs an 8-12 ms startup) | none | yes ~0.10 | small | no | `[[clang::minsize]]` on the proven-DUPLICATION one-shot bodies: `src/jsc/bindings/ZigGlobalObject.cpp` `addBuiltinGlobals` (86% of its +35,902 LTO delta is reversible multi-caller duplication — PROVEN by a deleted-body audit) + the ONE `*BuiltinFunctions::init` template at `src/codegen/bundle-functions.ts:718` + `src/js/builtins/BunBuiltinNames.h:243` (~dtor) + `DOMIsoSubspaces.h` (~dtor) + `BunClientData.h` (`JSVMClientData`). ONE bun-only PR, zero WebKit-rebase cost. (The WebKit half → Tier B row B11.) |
| 18 | **rust-mono/P2 install-sort-collapse** | 2 | **0.076** | neutral | none; `npm.rs:3092`'s own comment already suggests it | yes | small | no | `src/install/npm.rs:3165-3174`: collapse the byte-width `match` to one `u64` arm. |
| 19 | **archaeology/P3 highway-dead-isa** | **3** | **0.053** | **neutral BY HIGHWAY'S OWN DESIGN DOC** (`targets.h:360-366`: "only enable targets that were actually compiled in this module") — the N_AVX2 bodies are byte-unchanged; only `GetIndex()`'s AND-mask immediate differs | none on non-baseline x64 (`bun-linux-x64` ships unconditional AVX2 opcodes; a no-AVX2 CPU already SIGILLs) | yes ~0.05 | **small (ONE flag-table line)** | no | `scripts/build/flags.ts` `bunOnlyFlags`: `{ flag: "-DHWY_WANT_SSE4=1", when: c => c.x64 && !c.baseline }`. Root cause (the /GS- lesson, on LINUX): `-march=haswell` omits `__AES__`, so Highway's baseline derivation (`detect_targets.h:618-630,739,970`) silently demotes to SSSE3 and compiles 2 provably-unreachable ISA variants (SSSE3 27,729 B + SSE4 27,441 B). The Highway-official override, no `-maes` policy question. |
| 20 | **rust-mono/P4 array-hash-map erase** | 2 | **0.051** | neutral (one `&mut dyn FnMut` on a cold `bun install` lockfile sort) | a maintainer may kill it on "no new indirect calls" principle | yes | small | no | `src/collections/array_hash_map.rs:906-924`. |
| 21 | **archaeology/P2 root-certs PEM→DER** | **3** | **0.049** (+0.035 more with the zstd variant) | **IMPROVEMENT** — `d2i_X509` is strictly cheaper than `PEM_read_bio_X509`; the SAME file already uses `d2i_X509` on its Windows path (`root_certs.cpp:305`) | `tls.rootCertificates` must PEM-render lazily (cached) with bun's 72-char lines; **TWO readers to redirect** (the `call_once` at `:152` AND the `us_internal_raw_root_certs` bypass at `:167` — the latter was MISSED by 2 of the 3 units that found these bytes) | yes | medium | no | Regenerate `packages/bun-usockets/src/crypto/root_certs.h` to emit DER `(ptr,len)` entries; `root_certs.cpp:63-67` `d2i_X509`; add a lazy PEM renderer for `us_internal_raw_root_certs`. The zstd variant ships one 91 KB blob decompressed in the existing `call_once`. |
| 22 | **rust-mono/P3 dns generic-collapse** | 2 | **0.041** | neutral | MUST keep `T::SYSCALL` per-type (node-compat error `.syscall`) | yes | medium | no | `src/runtime/dns_jsc/dns.rs:5372-5425`: non-generic inner fn + a `&'static` descriptor. |
| 23 | **embedded-js/EJ2 minify-builtin-functions** | 2 | **0.038** | neutral | none (0/385 violate the `(function (` RELEASE_ASSERT) | yes | small | no | `src/codegen/bundle-functions.ts`: add `--minify-whitespace`. (Superseded by A-GATED W5 IF that gate passes.) |
| 24 | **duplicate-data/runtime-js-4x** | 1 | **0.038** | one-time-lazy (already lazy) | none | yes | small | no | `src/bundler/ParseTask.rs`: the 4 `concatcp!` arms → a `OnceLock<[String;4]>`. |
| 25 | **rust-cold/P1 cold-crate opt-z** | 2 | **0.03** | neutral | none | yes | small | no | `Cargo.toml`: `[profile.release.package."X"] opt-level="z"` for `bun_analytics`, `bun_patch`, `bun_exe_format`. Precedent at `Cargo.toml:451`. |
| 26 | **ci-audit/P1+P1b .bun-dealign + .bun_err→bss** | **3** | **0.027** (24,576 + 4,096) | neutral (cold static data) | none — the skeptic closed the ONE unanalyzed vector: the config sections land 4 KB-aligned and `permanentlyFreeze` only needs 4096 (`PageBlock.h:59`, `WTFConfig.h:80`) | no (no compile-time `.bun` on PE) | small | no (1 TU + relink) | `src/jsc/bindings/c-bindings.cpp:1057-1078`: `#if OS(DARWIN)/#else` the `BLOB_HEADER_ALIGNMENT` macro — ELF only needs the 8-byte `size`; 16 KB alignment costs 16,384 B of zeros + 11,100 B of pad. + `src/bun_core/lib.rs:1146`: `.bun_err` → `.bss.bun_err` (the UNIQUELY correct fix: LLVM's `isSuitableForBSS` rejects ANY explicitly-sectioned global; only a `.bss.` prefix flips it). P1b is 0 without P1. Gate: `bun build --compile` round trip (skeptic ran it). |
| 27 | **cpp/zgc-cold-throw-tail** | 1 | **0.024** | neutral (the 39-B block sits AFTER `ret`) | none | yes | sm-med | no | `src/codegen/generate-classes.ts`: per-class `[[noreturn]]` cold-throw helpers for the 889 method-callback tails. |
| 28 | **dep-internals/zlib-ng dead tiers** | **3** | **0.024** | neutral (PCLMULQDQ is in haswell's CPU contract, so `functable.c:163` ALWAYS overwrites the Chorba/SSSE3/SSE4.2 tiers before publish) | none (the `-baseline` build keeps everything) | yes ~0.024 (verify clang-cl honors `-march=haswell` first) | small | no | `scripts/build/deps/zlib.ts` — **use the SKEPTIC'S copy-pasteable change verbatim** (the unit's change DOES NOT LINK): defines `WITHOUT_CHORBA` **AND** `WITHOUT_CHORBA_SSE` (zlib-ng uses two macros; the unit mis-transcribed `functable.c:148`), gated `cfg.x64 && !cfg.baseline`; skip the `X86_SSSE3`/`X86_SSE41`/`X86_SSE42` kernel rows. DO NOT touch `X86_SSE2` or `x64Generic()` (they are the unconditional functable FLOOR). |
| 29 | **generated-classes/gc-3** | 2 | **0.02** | neutral | none | yes | small | no | `src/codegen/generate-classes.ts:671,987,1803`: one shared body per family. |
| 30 | **cpp/internal-module-switch-to-table** | 1 | **0.018** | neutral | none | yes | small | no | `src/codegen/bundle-modules.ts`: the 158-case `createInternalModuleById` switch → a constexpr table. (Byte-DISJOINT from row 2: this is the `.text` switch; W1 is the `.rodata` arrays.) |
| 31 | **ci-audit/P2 output::SOURCE .tdata→.tbss** | **3** | **0.008** | neutral (the memcpy becomes a memset; the report's "IMPROVEMENT" was oversold) | none. The hot write path never reads `raw_stream`; its ONLY 2 external callers are one-shot VM construction (`VirtualMachine.rs:2016-2017`). Proven in the SAME file: `SOURCE_SET` uses the same macro with a zero init and lands in `.tbss`. | no (windows `Fd::INVALID = Fd(0)`) | small | no | `src/bun_core/output.rs:272-380`: 2 sentinel bytes (`Fd::INVALID = i32::MIN` ×2) drag an 8,528-B `RefCell<Source>` — including two all-zero 4 KB buffers — into `.tdata`. Shape (a): `raw_stream: Option<File>` + `.expect()`. Do NOT take `Fd(0)`. |
| 32 | **ci-audit/P3 strip -R .comment -R .note.stapsdt** | **3** | **0.001** (656 B, measured) | neutral | none (the stripped binary runs a full `--compile` round trip) | no | **trivial** | **YES — strip-only, seconds** | `scripts/build/flags.ts:1432-1469` `stripFlags`: add `{flag:["-R",".comment","-R",".note.stapsdt"], when:c=>c.linux&&c.release}`. (weird-ideas #23 declared this "already in #33224" — **FALSE, measured**; #33224 leaves both. Also removes the leaked `/checkout/src/llvm-project` toolchain path.) |

**TIER A TOTAL (linux): 4.68 MB.** Cross-platform rows at SYNTHESIS2's ~1.0× rule
plus /GS- put **windows Tier A at ~5.6 MB (~4.2 without /GS-)** against a 2.00 need.

### TIER A-GATED — zero expected cost, but NOT provable without ONE benchmark each
| id | wave | saving_mb | the gate |
|----|------|----------:|----------|
| **rust/share-generics=on** | 2 | **0.25** | `-Zshare-generics=on` in `rust.ts` on the linux `crossLangLto` branch. ONE 40-min rebuild + ONE transpile benchmark (the bun_js_parser `P<>::parse_suffix` twins are the risk). Falsifier: `parse_selector::<Selectors>` 3→1. Do NOT combine with crate `opt-level="z"` on anything upstream of a hot crate. |
| **weird-ideas/W5 jsbuiltins-combined-zstd** | 3 | **+0.26** net (0.321 − EJ2's 0.038 − B7's 0.025, which it supersedes) | The two combined JS-builtin buffers (`WebCore::combinedSourceCodeBuffer` 252,941 B + `JSC::s_JSCCombinedCode` 136,133 B → zstd 52,981 B). UNLIKE W1, the decompress site is **VM INIT**, not a lazy branch: ~250 µs on EVERY `bun` invocation. ONE `hyperfine 'bun -e null'` settles it. Honest and correctly NOT promoted to Tier A. |
| lto-pipeline/LP-1 `-inline-cold-callsite-threshold=0` | 3 | **unknown** | A FREE relink-only `-Wl,-mllvm,` experiment (bundle with row 6's relink). The skeptic REFUTED "HIGH confidence on non-negative sign" with a real IR counterexample; the net sign over 52 MB is genuinely unknown. Run it, read the number, delete the line if ~0. |

## TIER B — zero perf cost + zero regression, lands in oven-sh/WebKit
(The orchestrator has write access; this is a NORMAL path. **ALL rows batch into
ONE prebuilt rebuild + ONE `scripts/build/deps/webkit.ts:10` pin bump.**)

| # | id | wave | saving_mb | perf | windows | the change |
|--:|----|------|----------:|------|---------|------------|
| B10 | **webkit/bun-enable-jsc-debug-tooling** | **3** | **0.555** (band 0.53–0.555; 0.571 only if (e) is accepted) | neutral-to-IMPROVEMENT. **THE DECISIVE CITATION IS THE MAINTAINERS' OWN SHIPPED GATE, same file, same shape**: `PlatformEnable.h:763-780` `BUN_ENABLE_JIT_DISASSEMBLER ASSERT_ENABLED` — "a debugging-only facility reached solely by diagnostic options ... compile it out of release builds." Every byte here satisfies that sentence verbatim, and I re-verified every root `JSC::Options` Bool is `false` on the LIVE canary. | ~0.57 (credit 0; windows solved) | ONE new `#define BUN_ENABLE_JSC_DEBUG_TOOLING ASSERT_ENABLED` sibling in `PlatformEnable.h` + 5 small `#if` gates: **(a)** Air graph-coloring regalloc, 292,211 B, ONE call site at `AirGenerate.cpp:119-122` (greedy NEVER falls back — answered SYNTHESIS2's open question, NO, exhaustively); **(b)** B3+Air+DFG IR validaters, 112,681 B, via `B3Common.cpp:59-67` + `DFGCommon.h:87-94`; **(c)** BytecodeDumper, 144,950 B, stub the INNER overload at `BytecodeDumper.cpp:95-99` (NOT 102-106); **(d)** IonGraph, 32,272 B, **8 roots not 5**. **DROP (e) HeapVerifier (16,440 B)** — `test/js/web/abort/abort-controller-gc-reason.test.ts` spawns with `BUN_JSC_verifyGC=1` and would go VACUOUS on release CI. Also gate the 2nd `airUseGreedyRegAlloc` reader at `WasmOMGIRGenerator.cpp:5361`. `validateBytecode` does NOT break (EJ1's verification gate survives). This SUPERSEDES + CORRECTS SYNTHESIS2's unbanked §E lead #1 (0.28 → 0.555) and is 0-byte-disjoint from every banked row. |
| B1 | **iostream-locale-purge** | 1+2 | **0.32** | IMPROVEMENT (6 fewer `.init_array` global ctors at every process start) | 0 (credit) | oven-sh/WebKit: delete the ONE unconditional `#include <iostream>` at `wtf/simdutf/simdutf_impl.h:9949` (provably unused; its file-level `__asm(".globl _ZSt21ios_base_library_initv")` is immune to gc-sections). **PLUS, ALL-OR-NOTHING, in the SAME measured build:** the 5 `std::cerr`→`fputs` in `packages/bun-uws/src/{HttpContext,App,TopicTree}.h`. Verify `.init_array` 12→6. |
| B2 | **jsc/LOLJIT compile-out** | 2 | **0.30** | neutral (never-executed; `BUN_JSC_useLOLJIT=1`, an unfinished `//TODO` internal experiment, becomes a no-op) | ~0.30 | `ENABLE_LOL_JIT 0` in `PlatformEnable.h`; one `#if` atop the 5 `lol/*.{h,cpp}`; the one dispatch at `jit/BaselineJITPlan.cpp:57`. w3-lto-pipeline re-confirmed 319,917 B and proved the 0.30 is a LOWER bound on a real relink. |
| B3 | **icu-dead-virtuals-patch** | 2 | **0.233** | IMPROVEMENT (removes never-taken branches from the LIVE `Intl` path) | ~0.19 (credit 0 until rebased — windows ICU is 73.2 vs 75.1) | NEW `vendor/WebKit/icu/dead-code.patch`, 7 independent hunks stubbing the parse hemisphere, RBNF, MessageFormat, the collation COMPILER, the units router. The most-verified proposal of any wave (2 units + 2 skeptics + a 54 MB disassembly). |
| B4 | **yarr-tables-to-bss** | 1 | **0.125** | neutral (the JIT bakes the table ADDRESS; bit-identical) | yes | `yarr/create_regex_tables`: emit the two 64 KB-for-88-bit tables (`_wordcharData` 63 nonzero, `_spacesData` 25 nonzero) zero-init + a one-time 88-byte write. |
| B5 | **libpas-megapage-to-bss** — **RECIPE REWRITTEN** | 1→3 | **0.125** | neutral | yes | **SYNTHESIS2's instruction is WRONG and an implementer following it literally changes nothing** (w3-weird-ideas F12, skeptic-confirmed): the reality is TWO 65,544-B tables (`bmalloc_megapage_table` + `tagged_bmalloc_megapage_table`) that are ALREADY separate file-scope globals. The actual defect: libpas's explicit initializer defeats `-fzero-initialized-in-bss`. Fix: make the initializer zero (or `__attribute__((section(".bss....")))`) in `pas_fast_megapage_table.h`. The 0.125 NUMBER is confirmed by address. |
| B6 | **wtf-config-sections-to-nobits** — **SCOPE CORRECTED** | 1→3 | **0.032** | neutral | **YES +32,768 B** (the two 16,384-B `__DATA,_` COFF sections are in the real Windows PE — upgraded from "probably") | SYNTHESIS2 cites only `WTFConfig.cpp:84` — **as written it lands HALF.** The 32 KB is TWO sections: `__DATA,__wtf_config` (that file) AND `__DATA,__jsc_opcodes` (`llint/LLIntData.cpp`). Both 100% zero (3 wave-3 units independently hexdumped both). Named-section `@nobits` on BOTH; keep the names — `permanentlyFreeze` must own its pages (source only asks for 4096 alignment; verified). |
| B11 | **lto-pipeline/LP-2b minsize, WebKit half** | **3** | **~0.04** (measure on the rebuild) | neutral | 0 | `WTF_MINSIZE` macro in `wtf/Compiler.h` + `[[clang::minsize]]` on `JSGlobalObject::init` (PROVEN 86% multi-caller duplication), `BytecodeIntrinsicRegistry`, `VM::VM`, `Options::setOptionWithoutAlias`, `IPInt::initialize`. LOW-value half (`JITThunks::initialize` is PROVEN relocation → minsize gets only ~5% codegen there); batch into the SAME rebuild, do not give it its own PR. |
| B7 | **jsc-builtins CONFIGURATION=Release** | 2 | **0.025** | neutral | yes | `cmake -E env CONFIGURATION=Release` at JSC `CMakeLists.txt:389` — JSC's own `builtins_model.py:140` gates its whitespace strip on an env var cmake never sets. A real upstream bug. |
| B8 | **icu UCONFIG_NO_SERVICE** | 2 | **0.016** | improvement | yes | `Dockerfile:210` + `Dockerfile.windows:255`: `-DUCONFIG_NO_SERVICE=1`. Use the SKEPTIC's reachability proof (the unit's F6 is wrong). |
| B9 | **icu UCONFIG_NO_FILTERED_BREAK** | 2 | **0.005** | improvement | yes | Same files: `-DUCONFIG_NO_FILTERED_BREAK_ITERATION=1`. |

**TIER B TOTAL (linux): 1.78 MB** — all in ONE prebuilt rebuild + ONE pin bump.

## TIER C — a real feature/behavior tradeoff; a maintainer must answer ONE question each
**With A+B at 6.46 MB vs a 4.86 need, NONE of these is required for linux.** Listed
because the brief demands them and because windows /GS- technically belongs here.

| # | id | wave | saving_mb | the measured cost | THE QUESTION the maintainer must answer |
|--:|----|------|----------:|-------------------|------------------------------------------|
| C0 | **(W) /GS-** | 2 | **1.45 (W)** | removes Windows stack-smash detection — a mitigation bun-linux NEVER had (GT#7); an accidental clang-cl driver default nobody ever chose (git pickaxe: never touched). Measured: 49 B × 28,383 functions; a hot JSC JSValue type check is 42% stack protector. | "Is Windows/Linux hardening PARITY an acceptable rationale for removing a mitigation from `bun.exe` and every `bun build --compile` output it produces?" (Pure margin; windows is solved without it.) |
| C1 | **jsc-temporal 3-root gate** | 2 | **0.40** | `typeof Temporal` is `undefined` before AND after. What breaks: `BUN_JSC_useTemporal=1` (a working, undocumented knob) becomes a no-op. Apple is ACTIVELY developing Temporal; when JSC flips the default, this must be reverted. Implement ONLY the SKEPTIC's 3-root design (the unit's 43-file body-wrap breaks the LIVE `Intl.DurationFormat.prototype.format()` and does not compile). | "Is it acceptable to lose the Temporal escape hatch until JSC ships it, knowing we must revert?" |
| C4 | **lsquic + lsqpack (http3)** | 1 | **0.42** | `Bun.serve({http3:true})` WORKS today (a skeptic started a real server on the shipped binary), is documented (`server.mdx`) and typed `@experimental`. | "Remove or env-gate a shipped experimental server feature?" |
| C2 | **boringssl ML-DSA** | 1 | **0.231** | Removes a WORKING feature: two skeptics INDEPENDENTLY completed a real ML-DSA-44 TLS-1.3 handshake on the shipped binary, verified by stock `curl`. Node 24 supports it. FIPS 204 is a final NIST standard. | "0.23 MB for a post-quantum signature algorithm users can reach today?" |
| C3 | **sqlite fts3/fts4** | 1 | **0.16** | An existing `.sqlite` file written by ANY tool with an fts3/4 table becomes unreadable AND un-DROP-able from `bun:sqlite`. Node 26 ships fts3/4/5+rtree. | "Accept a data-loss-shaped regression on other tools' databases?" |
| C6 | **(W) windows /FIXED drop .reloc** | 3 | **0.173 (W)** | Removes ASLR from `bun.exe` AND every Windows `--compile` output. **The killer the units under-stated**: Windows "Mandatory ASLR" with the `RequireInfo` ("do not allow stripped images") sub-policy — deployable by enterprise Defender — **refuses to LOAD a relocs-stripped image.** Wave 2 ALREADY measured this (181,760 B) and said **"No."** w3-cpp-compile-flags re-proposed it at a REFUTED 0.63 (3.7× over, from a broken pointer census). | "Re-open a question wave 2 already declined, for 0.17 MB of surplus windows margin?" (Recommend: NO.) |
| C7 | **react-compiler out-of-band** | 3 | **1.05** | `bun_react_compiler` is 1.05 MB (by address) backing ONE opt-in flag (`bun build --react-compiler`). Splitting it to a downloaded component breaks the single-binary principle; Jarred already rejected the adjacent `bun-standalone` split. The unit itself does NOT recommend it. | "Is any second file ever acceptable?" (Recommend: NO.) |
| C5 | **sqlite rtree** | 1 | 0.045 | Two skeptics + both syntheses say SKIP: `loadExtension`+spatialite require the host rtree. | SKIP. |


---

# B. CUMULATIVE TOTALS — are the targets reachable? (YES, and from which tiers)

## linux-x64 — need **4.86 MB**

| tier | MB | cumulative | reaches 4.86? |
|------|---:|-----------:|---------------|
| **TIER A** (32 rows, zero tradeoff, oven-sh/bun only) | **4.68** | 4.68 | **96% — 0.18 short** |
| Tier A, "strict" (excluding the 3 † lazy-decompress rows: W1 0.995, brotli 0.225, cli-assets 0.22) | 3.24 | — | the honest floor if a maintainer rejects the whole lazy-decompress class — which they themselves invented and have shipped 3× |
| + **A-GATED** (share-generics 0.25 OR W5 0.26 — ONE benchmark each) | +0.25–0.51 | **4.93–5.19** | **YES from Tier A + one benchmark** |
| **A + B** (one batched oven-sh/WebKit rebuild + pin bump) | +1.78 | **6.46** | **YES, +1.60 MB of margin** |
| A + B + both A-GATED | +0.51 | **6.97** | — |
| A + B + every Tier-C yes (C1+C2+C3+C4) | +1.21 | **8.18** | far past — NOT needed |

> **THE HONEST LINUX VERDICT: REACHED.** Tier A alone is 4.68 (0.18 short of 4.86);
> EITHER A-gated benchmark closes it from oven-sh/bun alone. Tier A + Tier B is
> 6.46 — past the target with 1.60 MB of margin and **ZERO Tier-C feature
> removals.** This reverses SYNTHESIS2's "NOT reachable from A+B; shortfall 0.65;
> needs two Tier-C yeses." Wave 3 found the missing money: **+1.645 MB Tier A**
> (W1 0.995, cli-assets 0.22, CP-1 0.168, LP-2a 0.10, highway 0.053, root-certs
> 0.049, .bun-dealign 0.027, zlib-ng 0.024, .tdata 0.008, strip 0.001) and
> **+0.595 MB Tier B** (jsc-debug-tooling 0.555 + LP-2b 0.04).
>
> Even under the most hostile reading — drop all 3 lazy-decompress rows AND
> Tier B — A-strict (3.24) + B (1.78) = 5.02 still clears 4.86.

## windows-x64 — need **2.00 MB**

| tier | MB | reaches 2.00? |
|------|---:|---------------|
| **W1 + EJ1 alone** (two codegen changes, one file) | **1.344** | 67% by itself |
| + libarchive (0.254) + CP-1 (0.17) + image-codecs (0.165) + highway (0.05) | **1.98** | on the line |
| + ANY one more cross-platform row (cli-assets 0.22, boringssl 0.18, ...) | **>2.2** | **YES — 5-6 small PRs, ZERO policy decisions** |
| full cross-platform Tier A (no /GS-) | **~4.2** | >2× over |
| + /GS- (the one policy sign-off) | **~5.6** | pure margin |
| + Tier B windows (B10 ~0.57 + B2 0.30 + B4/B5 0.25 + B6 0.033) | +~1.2 | — |

> **THE WINDOWS VERDICT: trivially, redundantly reached. /GS- is OPTIONAL.**
> SYNTHESIS2's conclusion that /GS- was "the single decision that matters" is
> now obsolete — windows closes comfortably from the cross-platform Tier-A rows
> alone, at the ~1.0× transfer ratio the w2-windows-delta skeptic measured
> empirically from the same CI build.

## Why wave 3 succeeded where waves 1-2 fell short (one paragraph)
Waves 1-2 swept the SYMBOL TABLE exhaustively (w2-symbol-hunt bucketed every
≥4 KB symbol) and correctly concluded the large-symbol population was clean.
Wave 3's three biggest finds are all STRUCTURALLY INVISIBLE to a symbol sweep:
W1's bytes are 158 `.rodata` arrays whose only lever is a codegen step nobody
had considered compressing (everyone minified); B10's 454 functions are each
<300 KB and behind runtime `JSC::Options` Bools that full LTO cannot fold;
CP-1's 288 bodies are each <800 B. The remaining money was hiding BELOW the
4 KB census floor and in a mechanism (lazy zstd) the maintainers had already
shipped three times but applied to only one of the ~5 asset families it fits.


---

# C. IMPLEMENTATION ORDER — cheapest-certain-first, across all three waves

Every entry is a literal, copy-pasteable change. Each group is independent.

## Group 1 — RELINK / STRIP ONLY (minutes each; do ALL of these TODAY)

1. **Row 6, MergeFunctions spelling** — `scripts/build/flags.ts`, add to `linkerFlags`
   next to the LINUX `-flto=full` entry at **:883-886** (`when: c => c.unix &&
   !c.darwin && c.lto && c.release`) — NOT the darwin block at :873:
   `flag: ["-Wl,-mllvm,-enable-merge-functions"]`.
   Do NOT add `-mergefunc-use-aliases`. Expected **-0.15 to -0.22**. NO gate, NO
   audits. Optionally ALSO flip `--icf=safe`→`--icf=all --keep-unique=<mangled
   callHostFunctionAsConstructor>` at `:1294` for the residual (needs the maintainer
   gate + the 48-`s_info` distinct-address check). ONE relink measures both.
2. **LP-1** (free, bundle into the SAME relink): `-Wl,-mllvm,-inline-cold-callsite-threshold=0`
   in the same block. Read the number. Delete the line if ~0.
3. **Row 32** — `scripts/build/flags.ts:1432-1469` `stripFlags`: append
   `{flag:["-R",".comment","-R",".note.stapsdt"], when:c=>c.linux&&c.release,
   desc:"toolchain-version strings + libstdc++'s dead SystemTap probes"}`. **-656 B.**

## Group 2 — oven-sh/bun REBUILDS (order by saving ÷ effort)

4. **EJ1a prep** (0 bytes, MANDATORY before row 4): `src/codegen/bundle-modules.ts:~250`
   `/return \$\nexport /` → `/return \$\s*export\s*(?=\{)/`. Own PR.
5. **Row 2 (W1) + Row 4 (EJ1), SAME codegen file, ONE PR — the 1.344 MB PR.**
   (a) `bundle-modules.ts:~207`: add `--minify-whitespace` (requires #4).
   (b) `src/codegen/helpers.ts:34` `declareASCIILiteral` + `bundle-modules.ts:384,401`:
       emit `static constexpr const unsigned char ${name}Zstd[K]` + `${name}RawSize`.
   (c) `src/jsc/bindings/InternalModuleRegistry.cpp:36` `generateModule` + `:118`:
       `size_t n=ZSTD_getFrameContentSize(z,k); std::span<LChar> out;
        auto impl=StringImpl::createUninitialized(n,out);
        ZSTD_decompress(out.data(),n,z,k); RELEASE_ASSERT(n==rawSize);
        makeSource(String(WTFMove(impl)),...)` — the decoder is already linked.
   Gate: `BUN_JSC_validateBytecode=1` on a RELEASE build + the full `test/js/node/` suite.
   PR text MUST carry the honest RSS line and the ≤4%-of-an-11-ms-lazy-path bound.
6. **Row 19 (highway)** — ONE flag-table line, `scripts/build/flags.ts` `bunOnlyFlags`:
   `{flag:"-DHWY_WANT_SSE4=1", when:c=>c.x64 && !c.baseline}`. -0.053.
7. **Row 9 (std-backtrace)** — `scripts/build/rust.ts`, in the CARGO `args` array
   immediately after line 399: `if (cfg.release && !cfg.assertions && !cfg.asan)
   args.push("-Zbuild-std-features=panic-unwind")`. Fix `src/bun_core/Global.rs:160-167`.
   -0.17.
8. **Row 10 (CP-1)** — stage 1 (the 2 files with the array, -0.051), then stage 2. -0.168.
9. **Row 17 (LP-2a)** — `[[clang::minsize]]` on `Zig::GlobalObject::addBuiltinGlobals`
   (`ZigGlobalObject.cpp`), the `init` template at `bundle-functions.ts:718`, and the
   3 headers. ONE PR. Tripwire: `hyperfine 'bun --version'`. -0.10.
10. **Row 16 (BunBuiltinNames table)** — decide WITH row 17 who gets the ~dtor's 36 KB.
11. **Row 5 (libarchive)** + **Row 8 (boringssl)** + **Row 13 (zstd)**: three new
    `patches/*/*.patch` files. -0.59 total.
12. **Row 12 (image codecs)** — `deps/libjpeg-turbo.ts` + `deps/libwebp.ts`. -0.165.
13. **Row 28 (zlib-ng)** — USE THE SKEPTIC'S change verbatim (w3-dep-internals.skeptic
    §"THE CORRECTED, COPY-PASTEABLE CHANGE"). -0.024.
14. **Row 26 (.bun dealign)** — `c-bindings.cpp:1057-1078` (`#if OS(DARWIN)/#else` the
    macro) + `bun_core/lib.rs:1146` (`.bss.bun_err`). Gate: `--compile` round trip. -0.027.
15. **Rows 7, 21, 31** (cli-assets zstd, root-certs DER, .tdata) + the remaining small
    Rust/codegen rows (15,18,20,22,23,24,25,27,29,30). -0.72 total.
16. **Row 3 (encoding fork A)** — the largest-effort A row. Gate: the WPT encoding suite;
    fall back to fork B (-0.20) on any divergence. -0.39.
17. **A-GATED: share-generics** — one flag + one 40-min rebuild + ONE transpile benchmark.
18. **(W) Row 1 (/GS-)** — after the policy sign-off. Two 1-line PRs. -1.45 W.

## Group 3 — ONE batched oven-sh/WebKit prebuilt rebuild + ONE pin bump

Land ALL of B1-B11 + (optionally) Tier-C C1 in ONE oven-sh/WebKit commit, rebuild
the prebuilt ONCE, bump `scripts/build/deps/webkit.ts:10` ONCE. **-1.78 MB linux.**
- **B10** (the headline): `PlatformEnable.h` `BUN_ENABLE_JSC_DEBUG_TOOLING ASSERT_ENABLED`
  + the gates at `AirGenerate.cpp:119-122`, `B3Common.cpp:59-67`, `DFGCommon.h:87-94`,
  `BytecodeDumper.cpp:95-99`, the 8 `dumpIonGraph` roots,
  `WasmOMGIRGenerator.cpp:5361`. DROP HeapVerifier.
- **B1**: delete the `#include <iostream>` at `wtf/simdutf/simdutf_impl.h:9949`
  (+ the 5 bun-uws `std::cerr`→`fputs` IN THE SAME MEASURED BUILD — all-or-nothing).
- **B2**: `ENABLE_LOL_JIT 0`. **B3**: the 7-hunk ICU patch. **B4**: `create_regex_tables`.
- **B5 (REWRITTEN)**: zero the `bmalloc_megapage_table`/`tagged_*` initializers.
- **B6 (BOTH sections)**: `WTFConfig.cpp` AND `llint/LLIntData.cpp`, named `@nobits`.
- **B7**: `cmake -E env CONFIGURATION=Release` at JSC `CMakeLists.txt:389`.
- **B8/B9**: the two `UCONFIG_NO_*` defines in both Dockerfiles.
- **B11**: `WTF_MINSIZE` on the 6 JSC one-shot giants.

## Group 4 — the maintainer decisions (each ONE question; NONE required for linux)
See Tier C. Ask in this order (best value ÷ cost): C0 (/GS-, windows margin only),
C1 (Temporal, 0.40), C4 (http3, 0.42), C2 (ML-DSA, 0.231), C3 (fts3/4, 0.16).
Recommend NO on C5 (rtree), C6 (windows /FIXED — wave 2 already said no), C7
(react-compiler split).

---

# D. DISCARDED — across all three waves, one line each
The dead-end list is as valuable as the proposals. Do NOT re-chase anything here.

## REJECTED BY A MAINTAINER (the bytes were real; the design was not wanted)
- **W1 / embedded-js-zstd — store the 161 internal JS module sources as per-module
  zstd frames, decompress on first require.** Implemented, tested, and CI-measured
  at **-1.33 to -1.34 MB on all 15 platforms** (`bun-linux-x64` 73.37 → 72.05,
  `bun-windows-x64` 76.17 → 74.83). @Jarred-Sumner, CHANGES_REQUESTED on
  oven-sh/bun#33250: **"bad idea. don't do this!"** PR closed unmerged.
  The most likely objection, and the one structural difference from the ICU
  decompress hook that DOES ship: `bun_icu_maybe_decompress` caches each decoded
  item **per process** (a static HashMap keyed by the `.rodata` address), so every
  VM shares one copy; W1 decompressed **per `globalObject`**, so N Workers pay N
  copies of up to ~1.7 MB, and the pages go from file-backed+shareable to anonymous.
  **Corrected arithmetic:** Linux Tier A 4.68 → **3.69**; Linux Tier A+B 6.46 →
  **5.47** (still clears the 4.86 need, with 0.61 MB of margin instead of 1.60);
  Windows is no longer trivially reached and needs ~1.1 MB more Tier A on top of
  the ~0.94 MB already in flight.
  **Carry-forward:** treat every `†` lazy-decompress row (cli-assets-zstd 0.22,
  brotli 0.225, W5 jsbuiltins 0.26) as suspect until the exact objection is known.
  The generalizable lesson is in §E.11.

## REFUTED by a skeptic (do NOT implement)
- `w3-weird-ideas/W4` + `w3-binary-archaeology/P4` — NOBITS the `.bun` section: `elf.rs:355-364` writes 8 FILE bytes at `.bun`'s `sh_offset`, which a NOBITS section does not own; the kernel maps NOBITS as zeros → EVERY `bun build --compile` binary silently fails to load its module graph. (The CORRECT fix is ci-audit P1's alignment drop — Tier-A row 26.)
- `w3-cpp-compile-flags/P1` windows `/FIXED` at **0.63 MB** — off by 3.7× (the census counted 276K LLVM switch jump-table slots that have ZERO PE base relocations because COFF jump tables are 4-byte self-relative). The REAL number, read off the real `bun.exe`'s `.reloc`, is **181,760 B = 0.173**. And wave 2 ALREADY measured it and said "No."
- `w3-dep-internals/DI-3` drop `ZSTD_MULTITHREAD` — its ONLY justification ("node-PARITY; Node throws") is **BACKWARDS**: Node v26 SUCCEEDS with `nbWorkers:4` (the skeptic RAN it; Node's zstd 1.5.7 IS built `ZSTD_MULTITHREAD`). Removing it is a node-compat REGRESSION.
- `w3-webkit-build-options/P2` WPD-visibility relink — its headline ("WPD is provably inert on linux") is EXPERIMENTALLY FALSE: under `-fvisibility=hidden` clang emits `!vcall_visibility=LinkageUnit` and `WholeProgramDevirt` ALREADY devirtualizes with NO linker flag (the skeptic got `single-impl: devirtualized` remarks on the exact toolchain). The `flags.ts:867-869` comment the unit "confirmed" is itself wrong. Upside ≤ tens of KB. Do not run it.
- `w3-webkit-build-options/P3` delete the WPD flags as "no-ops" — **ACTIVELY HARMFUL**: those flags feed the already-running devirt pass; removing them is a perf REGRESSION.
- `w3-code-patterns/CP-3` as written — `us_internal_raw_root_certs` (→ `tls.rootCertificates`) bypasses the `std::call_once` the design relies on; shipped verbatim it returns 120 garbage strings. Implement `w3-binary-archaeology/P2` (the DER variant, row 21) instead.
- `w3-binary-archaeology/P1(e)` re-encode `welcome-page.html.gz` as zstd — the gzip blob IS the HTTP wire format (`RequestContext.rs:1006-1008`, `Content-Encoding: gzip`).
- `w3-dep-internals/DI-1 + DI-2` AS WRITTEN — do not link (zlib-ng needs TWO macros, `WITHOUT_CHORBA` + `WITHOUT_CHORBA_SSE`; the `X86_SSE2` row is the unconditional functable FLOOR). The SKEPTIC'S corrected change is row 28.
- `w3-rust-codegen-flags` / SYNTHESIS2 row 8's spelling — `-Zbuild-std-features` in the `rustflags` array FAILS THE BUILD (`unknown unstable option`). It is a CARGO arg. Corrected in row 9.
- `w2-jsc-upstream/P3-G` — `require("bun:jsc").startRemoteDebugger` is LIVE + typed; the skeptic RAN it.
- `w2-jsc-upstream/P2` Temporal 43-file body-wrap — breaks the LIVE `Intl.DurationFormat` and does not compile. Only the 3-root design survives (Tier C1).
- `w2-rust-cold-crates/P3` (cli cold-crate split) — does not compile (4 hot→cold cycles) AND the 1.29× CGU multiplier's sign is unknown.
- The unit-report by-NAME `nm` sums — 32-40% phantom bytes from ICF/MergeFunctions aliases. Both wave-2 Rust units fell for it.
- Wave-1's `13/zgc-lazy-init-helpers`, `13/zgc-per-class getters`, `17/uws-iostream` AS WRITTEN, `14/linux-wpd-vfe`, `18/highway-target-table` — all refuted in wave 1/2; see SYNTHESIS2 §D.

## CONFIRMED ZERO — valuable negatives; this is where NOT to look next time
- **The entire C/C++ compile-flag space on linux is CLOSED at the cc1 level**, flag-by-flag (w3-cpp-compile-flags' matrix: rtti/exceptions/unwind/visibility/PLT/merge-constants/jump-tables/threadsafe-statics/VFE/stack-clash/trivial-auto-var-init/...). The maintainers' 1-MB breakthrough was NOT in `flags.ts`.
- **The Rust `-C`/`-Z` flag space is EXHAUSTED** (w3-rust-codegen-flags): `-Zfmt-debug` ceiling 29 KB AND user-visible; `-Cpanic=immediate-abort` destroys bun.report's panic message; `-Zlocation-detail=none` already shipped and 100% effective (1 `<redacted>` string left); `-Cllvm-args` is INERT on linux (bitcode; only a `-Wl,-mllvm,` LINKER flag reaches the binary); `optimize_for_size` std feature is perf-locked by its own doc; `-Zvirtual-function-elimination` is incompatible with `-Clinker-plugin-lto` and bun has ~0 `dyn Trait`.
- **The LLVM LTO pipeline is CLOSED** (w3-lto-pipeline): `--lto-partitions=N` is link-TIME parallelism that runs AFTER the single-module inliner and GROWS the binary; `function-specialization`/`hotcoldsplit`/`partial-inliner` are all OFF and not in the `lto<O2>` pipeline (0 `.specialized.` symbols); `-fvirtual-function-elimination` is dead (LTO+WPD+globaldce already killed 87% of vtables; 0 `WebCore::`/`Bun::`/`Zig::` vtables exist; ≤0.03 MB net); `--lto-O`/the link `-O2` is perf-locked with a documented -5 MB cost.
- **The Machine Outliner is a 5-9 MB perf REGRESSION with NO escape hatch in LLVM 21** (w3-machine-outliner). The ONLY reachable x86 mode is `=always`; the `nooutline` attribute has NO clang-21 spelling; there is ZERO hotness gating; the #1 victim (8,184 LTO-inlined copies of `AssemblerBuffer::ensureSpace`, verified by exact bytes) is the inner loop of EVERY JIT compile. Textbook size-facts-dead. One relink measures it if anyone wants the record; it cannot ship.
- **"A dep compiles an uncalled API/feature" is worth ZERO bytes** (w3-dep-internals, proven FOUR independent ways: sqlite shared-cache, lsquic logging, boringssl trust_token/DTLS/SLH-DSA/xwing/hrss/CMS, zlib-ng gzFile). Full LTO + `linker.lds`'s `local:*` + `--gc-sections` is a near-perfect dead-feature eliminator for `direct` deps. Only RUNTIME-dispatch-pinned code survives — and waves 1-3 already took it.
- **The CI pipeline is byte-HONEST** (w3-ci-pipeline-audit): the tracked size IS `statSync(strippedExe)` and the released `bun` is `cmp`-IDENTICAL to it for both 1.3.14 and the canary. Windows Authenticode signing happens AFTER size tracking (10,328 B of pessimistic skew, not a lever). Dylan's hypothesized "mystery CI step" does not exist.
- **Windows full LTO is a size GROWTH, not a saving** — full LTO grew linux `.text` by ~3.5 MB and the compensating `-fwhole-program-vtables` is `c.unix && c.lto`-gated. Windows non-LTO `.text` is already only 1.028× linux LTO `.text`.
- **The WebKit cmake `ENABLE_*` option table is CLEAN** (w3-webkit-build-options, from the real shipped `cmakeconfig.h`). Every compile-time validation mode is already 0. The ~550 KB RELEASE_ASSERT string avenue is ALREADY closed by the oven-sh fork's own `CRASH_WITH_INFO` override (`Assertions.h:1056-1075`) — residue 23 KB, load-bearing.
- **The ICU avenue is closed AT ZERO PERF COST on all THREE axes** (data GT#1, UCONFIG, code modulo B3). w3-weird-ideas added a 4th: ICU's statically-compiled property tries (0.15 MB zstd-able) are HOT in `u_charType`/regex `\w`. PERF-LOCKED. **Precisely**: 3.49 MiB of ICU data is still raw, and every byte of it is on oven-sh/WebKit's `icu/keep-raw.txt`, a measured per-item exclusion log. Re-derived from the shipped `libicudata.a` (3,770 items, 3,621 already zstd, 149 raw) and re-timed with bun's zstd: the decodes are WORSE than keep-raw.txt's own estimates (cjdict 4.71 ms vs its "~1.9 ms"; ucadata 1.76 ms vs its "~0.8 ms"). 2.05 MiB of it is perf-locked outright (tier D puts a decode on every bun startup and on `Date.toString()`; tier C taxes the first `localeCompare` in every process). **The one slice with a real price tag: 1.04 MiB (`coll/{zh,ko,ja}.res` + the 4 non-CJK `brkitr` dicts) costs ≤1.24 ms on first use and is paid ONLY by a process that does CJK collation or SEA segmentation.** Leave `cjdict` raw (worst trade in the archive: 571 KB for 4.71 ms, 28% compression). Full table and the one-line question for @dylan-conway: oven-sh/bun#33205 (comment 4871886378). Not a Tier-A row because it is not free; it is a maintainer's call, and it lands as a 4-line `keep-raw.txt` edit in oven-sh/WebKit + a pin bump.
- `derive(Debug)` / `-fno-rtti` / cold CRATES / the ≥4 KB symbol population / the clang-cl divergent-default class after /GS- (minus `-relaxed-aliasing`) — all closed in wave 2.
- **JSC-bytecode-cache the builtins instead of source**: bytecode is 2-8× LARGER. A startup win, a size LOSS.
- **Compress the 1.14 MB merged string pool / the 4.8 MB anonymous `.rodata`**: referenced directly by `lea`/immediates; no indirection to make lazy. Structurally impossible at zero perf.
- **`Bun::StringWidthTables` / the 0.93 MiB `typedArrayViewProtoFunc*` family / `core::slice::sort` 0.68 MB / `encode_one_block` 96 KB** — all LIVE and hot-path-locked; each individually closed.
- Toolchain facts every future linker proposal needs: the final release link is **rust-lld (LLD 22.1.4)**, NOT clang-21's lld; the LTO backend that codegen'd the shipped `.text` is LLVM **22** (rustc's). `-plugin-opt`/`-mllvm` talk to THAT.

## Perf-LOCKED (violates the hard constraint; the cost was MEASURED)
-Os/-Oz/MinSizeRel globally (24% of `.text`); lower the LTO level (-5 MB documented); thin-LTO linux (a CORRECTNESS bug, not perf); remove frame pointers (bun.report); `-falign-functions=1` (0.52 MB — but 0.14 of it is IPInt's load-bearing jump-table stride, not compiler alignment); brotli static dictionary (15-69% worse `br` output); the boringssl ecc precomp (8.00 bits/byte, incompressible); UPX/packers/`--strip-sections` (break `--compile`'s by-name section lookup, re-proven in wave 3); `bun-standalone` (Jarred's own rejected experiment); turn off linux LTO.

## DUPLICATES (counted ONCE in section A)
- `w3-weird-ideas/W2` ≡ `w3-code-patterns/CP-3` ≡ `w3-binary-archaeology/P2` (root certs) → ONE row (21), ba's DER design.
- `w3-weird-ideas/W3` ⊂ `w3-code-patterns/CP-2` ∪ `w3-binary-archaeology/P1` (cold assets) → ONE row (7).
- `w3-cpp-compile-flags/P1` ≡ `w3-ci-pipeline-audit/P4` (windows /FIXED) → ONE Tier-C row (C6), at 0.173 not 0.63.
- `w3-cpp-compile-flags/P3a,b` ≡ `w3-ci-pipeline-audit/P3,P1b` → rows 32 and 26.
- `w3-machine-outliner/MO-P1` ≡ SYNTHESIS2 row 5 ≡ wave-1 `14/mergefunc-lto` (SAME byte population) → ONE row (6).
- `w3-rust-codegen-flags/P1` IS SYNTHESIS2 row 8 (spelling-corrected) → row 9.
- `w3-webkit-build-options/P1(a)+(b)` SUPERSEDES SYNTHESIS2's unbanked §E lead #1 → row B10.
- All wave-1/2 duplicates: see SYNTHESIS.md §E and SYNTHESIS2 §D.

## Ground-truth and record CORRECTIONS (carry forward; not money)
- **GT#7 needs a literal footnote**: the shipped canary DOES contain 400 `__stack_chk_fail` calls, 1,082 `%fs:0x28` canary loads (317 functions), and 1,633 `endbr64` — **100% from the Ubuntu-GCC-built static libstdc++/libgcc/crt, ~8-19 KB, a strict SUBSET of Tier-B B1's bytes, NOT a flag bun controls.** Three wave-3 units found this independently. GT#7's INTENT (no accidental flag taxes bun's ~60K functions) fully survives.
- `/tmp/canary/nm-dem.txt` is `--radix=d`: the size column is **DECIMAL**. A hex parse inflates every number 2-6×. One unit produced (and self-caught) a "0.662 MB breakthrough" this way.
- SYNTHESIS2's §E lead #3 is HALF-closed: `JITThunks::initialize`'s 212 KB IS pure single-caller relocation (outlining gains ~0) — but `JSGlobalObject::init` and `addBuiltinGlobals` are PROVEN-by-disassembly 86% multi-caller DUPLICATION, reversible by `minsize` (rows 17/B11). Do NOT carry the wave-3 report's "CLOSES §E.3" claim.
- SYNTHESIS2 B5's recipe and B6's scope are corrected in rows B5/B6.
- `flags.ts:904`'s "275" is wrong (LLVM 21's `OptAggressiveThreshold` is 250). `flags.ts:863-872`'s WPD comment is wrong for this build. Both are 0-byte doc fixes so nobody "restores" anything.
- **A REAL, accidental clang-cl driver default wave 2 missed**: clang-cl silently defaults to `-relaxed-aliasing` (`-fno-strict-aliasing`); linux is strict. A PERF-PARITY BUG (size sign unknown → correctly banked at 0). The fix IS honored (unlike `/GS`'s `-fno-*` forms): add `-fstrict-aliasing` gated `c.windows`; brotli + libuv + boringssl already carry their own `-fno-strict-aliasing` `spec.cflags` which win.

---

# E. WHAT THE INVESTIGATION LEARNED — durable facts for the next size pass

1. **This binary is already extraordinarily well-tuned, and you can now prove it
   at every layer.** The linux compile-flag space is closed at the cc1 token
   level; the Rust `-C`/`-Z` space is exhausted; the LLVM LTO `lto<O2>` pipeline
   has no inert or accidental pass; the linker levers beyond `--icf=all` are done;
   the CI pipeline is byte-honest (the tracked number `cmp`s identical to the
   shipped download). Three waves and 67 adversarial passes found ZERO
   "accidental flag that taxes every function." The money was never in the build
   system — it was in SOURCE and in CODEGEN.

2. **The remaining bytes live BELOW the symbol census's resolution.** Wave 2
   exhaustively bucketed every ≥4 KB symbol and correctly found nothing. Wave 3's
   3 biggest finds (W1 1.3 MB, B10 0.56 MB, CP-1 0.17 MB) are, respectively:
   a `.rodata` population whose only lever is a CODEGEN step; 454 functions each
   <300 KB behind never-true runtime Bools; and 288 bodies each <800 B. The next
   pass must start from the LINKER MAP and the RAW `.rodata` bytes, not from `nm`.

3. **The single highest-leverage MECHANISM is one the maintainers already own:
   lazy zstd-decompress on a path that is already one-time-lazy.** Dylan shipped
   it for ICU (`compress-data.ts`), for lshpack (`bss-huff-tables.patch`), and
   for node-fallbacks (`node_fallbacks.rs` + `build-fallbacks.ts`) — and it fit
   at least 4 more families nobody had applied it to (the 158 internal modules,
   the CLI scaffolding, the root CA store, the JSC combined builtins). When a
   team invents a good mechanism, audit EVERY population it fits before looking
   for a new mechanism.

4. **"A dep compiles an API/feature we never call" is ALWAYS worth zero bytes
   in this build.** Proven 4 independent ways. `direct` deps + full LTO +
   `linker.lds`'s `local:*` + `--gc-sections` is a near-perfect dead-feature
   eliminator. The ONLY dep bytes left are pinned by a RUNTIME-dispatched value
   (CPUID, a user-supplied level, a function-pointer table) — and those are
   exactly the rows waves 1-3 found. Reject every future `SQLITE_OMIT_X` /
   `OPENSSL_NO_Y` idea on sight unless it names the runtime pin.

5. **LTO "over-inlining of one-shot code" is mostly a MIRAGE — but not entirely.**
   LTO's 15000-point `LastCallToStaticBonus` makes single-caller bodies MERGE
   (relocation, ~0 net bytes — `JITThunks::initialize`'s +191 KB is 105 absorbed
   thunk generators). The real, recoverable slice is MULTI-caller fast-path
   DUPLICATION into one-shot functions, and the proven lever is a per-caller
   `[[clang::minsize]]` (which PRESERVES the single-caller merge — empirically
   verified on LLVM 21.1.8). Wave 3's LP-2 is ~0.14 MB of it. The ONLY thing that
   could reclaim the other ~2.7 MB of genuine multi-caller duplication is PGO —
   which is NOT in the release pipeline (`.buildkite/ci.mjs` has 0 `pgo` hits)
   and is the largest un-pulled lever of all, for perf AND size.

6. **Methodology that MUST survive**: (a) dedupe `nm` symbols BY ADDRESS or
   over-count by ~2.5 MB (ICF aliases); (b) `/tmp/canary/nm-dem.txt` is DECIMAL
   radix; (c) the `.rodata`/`.data` sections are mostly ANONYMOUS — only 4.78 of
   20.62 MB has a named symbol; a symbol walk is structurally blind to the rest
   (the linker MAP is the only complete `.rodata` attribution); (d) a "confirmed
   on the binary" claim from a `-###` driver dump or a pagemap probe is NOT a
   confirmation — two wave-3 units were refuted by skeptics who RAN the thing.

7. **The /GS- lesson generalized and struck twice more.** "A toolchain default
   nobody chose, discovered only by dumping the real driver/cc1 line" produced:
   /GS- on windows (1.45 MB); `-relaxed-aliasing` on windows (a perf-parity bug);
   and — on LINUX — Highway silently demoting its baseline to SSSE3 because
   `-march=haswell` omits `__AES__` (0.053 MB of provably-unreachable ISA
   variants). This class is now exhaustively swept on BOTH platforms.

8. **Two wave-2 ground truths needed literal footnotes.** GT#7 ("no stack
   protector/CET") is true of every byte bun COMPILES but false of the prebuilt
   Ubuntu-GCC static libstdc++/libgcc (~400 canary checks, ~1,633 endbr64,
   ~8-19 KB, a subset of Tier-B B1). GT#2's `--icf=all --keep-unique` has a
   SAFER, gate-free, structurally address-identity-correct sibling
   (`-Wl,-mllvm,-enable-merge-functions`) that dodges the `218430c731` bug class
   entirely. Neither changes a ledger number; both will save the next person a
   false "refutation."

9. **The release toolchain is NOT what you think.** The final link is performed
   by **rust-lld (LLD 22.1.4)** — rustc 1.97's bundled LLVM 22 — not clang-21's
   lld, because cross-language LTO requires the newer LLVM. Any `-mllvm` /
   `-plugin-opt` is talking to LLVM 22's LTO backend. On linux, rustc emits
   BITCODE, so `-Cllvm-args=<backend opt>` in RUSTFLAGS is INERT — only a LINKER
   flag reaches the binary. Full LTO grew `.text` by +3.3 MB (nm) over non-LTO;
   it SHRANK every plain-C dep and WTF; the growth is JSC+WebCore+DFG.

10. **Where the NEXT pass should look, if one is ever needed** (it should not be):
    (a) PGO — the only lever left on the 2.7 MB of real inliner duplication, and
    a perf win besides; (b) the libjpeg-turbo x64 SIMD TODO (`deps/libjpeg-turbo.ts`:
    `const simd = cfg.arm64` — the shipped x64 bun runs the ENTIRELY SCALAR JPEG
    codec on every `Bun.Image` op; a perf find, not a size one, but exactly
    Dylan's "something in a dep we haven't looked into"); (c) brotli is the one
    large C dep OUTSIDE the LTO partition (its own documented `-fno-lto` is
    `cfg.linux && cfg.x64 && !cfg.baseline` ONLY — on windows it IS LTO'd under
    relaxed aliasing, the exact alias-analysis combination the linux comment
    blames); (d) nothing else — every other door is closed above.

11. **The lesson this whole effort actually paid for: a finding is not money
    until a maintainer wants the DESIGN, and a skeptic pass that only audits the
    BYTES will never catch that.** W1 survived three waves, an adversarial
    skeptic, an independent byte-exact re-derivation, a full implementation, and
    a CI measurement on 15 platforms. Every one of those checks asked "are the
    bytes real?" and the answer was yes, every time. Not one of them asked "does
    bun want module source living on the heap?" — and that was the only question
    that mattered. It was rejected in five words. The same blind spot produced
    the earlier ICU over-claim: 3.3 MB of real bytes that were real *because*
    they were deliberately left raw, which `keep-raw.txt` said in writing and
    nobody read. **Before measuring anything, find the decision log and the
    owner. If a design changes a memory/ownership shape, price that first and
    the bytes second.**

---
*Every Tier-A row is a literal, copy-pasteable change with an exact file and
line. Every REFUTED and CONFIRMED-ZERO item is named so nobody re-chases it.
I independently re-verified the four wave-3 headline numbers (W1, CP-1, B10's
union, the live `JSC::Options` defaults) on the shipped canary before writing
this; everything else is the skeptics' work, which I cross-checked for
double-counting. — final synthesizer, wave 3.*
