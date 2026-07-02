## REPORT

### unit: w3-dep-internals

**One-paragraph summary (read this first).** I systematically enumerated the upstream build options bun is NOT using across ALL 22 `scripts/build/deps/*.ts` files, confirmed every finding on the real canary, and the answer is a high-confidence, well-evidenced NEGATIVE plus ~0.04 MB of small certain wins. The reason is architectural, and it is the single most useful thing in this report: **every C dep is a `direct` build — its `.o`s sit on bun's own link line, compiled with bun's own `globalFlags` (so they ALL already get `-march=haswell`, `-DNDEBUG`, `-ffunction-sections`, and LTO bitcode), inside the ONE full-LTO link whose version script (`src/linker.lds`) is `local: *`.** That combination (internalize → LTO GlobalDCE → GlobalOpt store-once constant-folding → `--gc-sections`) ALREADY deletes every dep API bun never calls AND constant-folds away the runtime flags those dead APIs would have set. I proved this happened independently in three deps (sqlite's shared-cache machinery, lsquic's entire `LSQ_DEBUG` logging apparatus including its format strings, boringssl's trust_token/DTLS/SLH-DSA/aes_nohw). The only dep bytes LEFT are (a) genuinely live code and (b) code pinned by a **runtime-dispatched value the optimizer cannot constant-fold** — CPUID, a user-supplied level/quality/format byte, or a function-pointer table. Waves 1+2's surviving dep rows (zstd blockCompressor rows, libarchive by-code switch, brotli tables, libwebp/libjpeg codec options) are EXACTLY that shape and they already took most of it. The C-dep axis is NOT where the missing 1 MB is.

---

### findings

All numbers are from the canary unless marked "(local map)". Two sources were used: `/tmp/canary/nm-dem.txt` **deduplicated BY ADDRESS** (per SYNTHESIS2's counting-bug warning — keep max size per address), and `/workspace/bun/build/release/bun-profile.linker-map`, which I verified is a NON-LTO build (`grep -c lto.o` = 0) so it keeps per-object attribution. The two are different bun revisions; the local map is used for ATTRIBUTION only, never for saving_mb.

**F1. Per-dep footprint (local non-LTO map, .text+.rodata+.data+.rel.ro+.bss), parsed from the map's input-section lines by object path.** Script at `/tmp/w3-dep-internals/map.py`.

| dep | MB (non-LTO) | notes |
|---|---:|---|
| boringssl | 1.707 | bcm.cc.o alone is 814,139 B (one unity TU) |
| sqlite | 1.544 | → shrinks to ~0.70 in the LTO canary (F4) |
| brotli | 0.849 | 0.449 is the encoder-dict .rodata = wave-2 row 6 |
| lshpack | 0.839 | 0.852 of it is ALREADY .bss (the shipped bss-huff-tables patch) |
| libwebp | 0.569 | wave-1 row 10 |
| zstd | 0.539 | 0.213 is zstd_lazy.c.o = mostly wave-2 row 11's target |
| tinycc | 0.463 | 0.166 is .bss (`hash_ident` 131,072 B); ~0.29 real text |
| libjpeg-turbo | 0.451 | `jchuff.c.o:encode_one_block` is ONE 96,631 B function (F9) |
| libarchive | 0.395 | wave-1 row 4 |
| lsquic | 0.381 | Tier C4 |
| mimalloc | 0.176 | already well-tuned (see F11) |
| zlib(-ng) | 0.123 | |
| cares | 0.117 | |
| libdeflate | 0.090 | |
| lsqpack / libspng / highway / hdrhistogram / picohttp | 0.043/0.042/0.002/0.003/0.002 | highway is effectively absent |

**F2. THE /GS--CLASS CHECK, done properly, and all CLEAN.** Per the wave-3 lesson I verified each on the BINARY, not from flags.ts:
- `-DNDEBUG` IS set (`flags.ts:247` and `:788`). Proof on the canary: `grep -cE '__assert_fail|__assert_perror' nm-dem.txt` = **0**; `strings | grep -c` for mimalloc/zstd/brotli assertion texts = **0**. Every C dep uses bare `assert()`; if NDEBUG were missing this would have been a multi-hundred-KB + perf bug. It is not.
- `-march=haswell` reaches EVERY direct dep. `cpuTargetFlags` (`flags.ts:49-80`) is spread into `globalFlags` at `flags.ts:212`, and `globalFlags` is "bun's own sources AND vendored deps". `when: c => c.x64 && !c.baseline` at `flags.ts:76` — so it covers both `bun-linux-x64` AND `bun-windows-x64`. Consequence proven on the canary: zstd has exactly ONE `ZSTD_decompressSequences` (3,662 B) and ONE `HUF_decompress4X1_usingDTable_internal` — `__BMI2__` is defined so zstd's `DYNAMIC_BMI2` is 0 and there are **no `_default`/`_bmi2` duplicate codegen pairs**.
- The prebuilt WebKit archives HAVE per-function sections: 28,295 `libJavaScriptCore.a(...):(.text.<sym>)` entries vs 3 bare `(.text)`. Not an un-gc-able blob.

**F3. The sqlite reality (`bun:sqlite`; `node:sqlite` does NOT exist on this canary — `require("node:sqlite")` throws "No such built-in module").** `PRAGMA compile_options` on the canary: sqlite 3.53.0 with `ENABLE_COLUMN_METADATA, ENABLE_FTS3, ENABLE_FTS3_PARENTHESIS, ENABLE_FTS5, ENABLE_MATH_FUNCTIONS, ENABLE_RTREE, ENABLE_UPDATE_DELETE_LIMIT` and **ZERO `OMIT_*` options and none of SQLite's "Recommended Compile-time Options"**. That LOOKS like a big target. It is not, because of F4.

**F4. THE CENTRAL MECHANISM, proven 3 times.** `src/linker.lds` is `{ global: napi*, node_api_*, node_module_register, uv_<enumerated>, v8::*, node::*; local: *; }` and the canary's 1,015 dynsyms contain ZERO `sqlite3_*`/dep symbols. So full LTO internalizes every dep symbol → GlobalDCE deletes the uncalled public API functions → GlobalOpt sees the globals those functions were the ONLY writers of as store-once/never-stored → constant-folds them → the guarded "slow" paths fold away → gc-sections removes them. Evidence, all canary-measured by address:
- **sqlite shared cache:** `SQLITE_OMIT_SHARED_CACHE` is NOT defined, yet `querySharedCacheTableLock`/`setSharedCacheTableLock`/`clearAllSharedCacheTableLocks`/`downgradeAllSharedCacheTableLocks` are **absent** (exactly 1 sharedcache-family symbol survives, 295 B total across 3). LTO proved `sqlite3GlobalConfig.sharedCacheEnabled == 0` because `sqlite3_enable_shared_cache` is uncalled and was DCE'd. Same story for `PROGRESS_CALLBACK` (129 B left), `set_authorizer` (476 B), the deprecated APIs (630 B).
- **lsquic logging:** `LSQUIC_LOWEST_LOG_LEVEL` is not set (so every `LSQ_DEBUG(fmt,…)` compiles) and `lsquic.ts` sets no log define — yet **14/14 distinctive `LSQ_DEBUG` format strings are ABSENT from `strings(canary)`** and only 36 %-format QUIC-vocabulary strings remain. `lsquic_set_log_level`/`lsquic_logger_lopt` are uncalled → `lsq_log_levels[]` is never stored → constant `LSQ_LOG_WARN` → `>= LSQ_LOG_DEBUG` folds to false → call sites AND strings gone.
- **boringssl:** `deps/boringssl.ts` compiles the FULL `gen/sources.json` manifest — `crypto/trust_token/{pmbtoken,trust_token,voprf}.cc`, `crypto/slhdsa/slhdsa.cc`, `crypto/kyber/kyber.cc`, `crypto/hrss/hrss.cc`+its .S, `crypto/cms/cms.cc`, `ssl/d1_*.cc`+`ssl/dtls_*.cc` (DTLS), `crypto/xwing/xwing.cc`, the whole `decrepit/`. Canary counts (correct ERE, `grep -cE`): `TRUST_TOKEN|pmbtoken|voprf`=0, `dtls1_|DTLSv1|dtls_method|DTLS_`=0, `SLHDSA`=0, `hrss_|poly_Rq_mul`=0, `CMS_|cms_`=0, `xwing`=0, `BORINGSSL_self_test|self_check`=0, `aes_nohw_encrypt`=0, `gcm_ghash_ssse3`=0, `SPAKE2`=0, `srtp`=0, `bssl::(der|ParsedCert|CertPath)`=1. **ALL already gone.**

> **Implication for the rest of wave 3 and for the synthesizer:** any proposal whose mechanism is "this dep compiles an API/feature bun never calls" is worth **0 bytes** and should be rejected on sight. Only RUNTIME-DISPATCH-PINNED code survives. The zero-cost residue in the C deps is the list in F5–F8.

**F5. zlib-ng: ~0.035 MB of provably-never-selected ISA kernels.** `deps/zlib.ts` compiles ALL 9 x86 kernel tiers (SSE2/SSSE3/SSE41/SSE42/PCLMUL/AVX2/AVX512/AVX512VNNI/VPCLMULQDQ), each deliberately `-fno-lto` (upstream-recommended; prevents LTO hoisting an AVX intrinsic above the CPUID dispatch). `functable.c` takes all their addresses, so neither LTO nor `--gc-sections` can touch them. On a `-march=haswell` binary the functable's ascending-override init means a CPU that can boot the binary ALWAYS reaches the AVX2 assignments, so every SSE2/SSSE3/SSE4x-tier kernel (and the entire Chorba CRC family, which only wins where PCLMULQDQ is absent) is dead. **Exact canary symbols (each a unique `t` at a unique address in nm-dem.txt):**
```
inflate_fast_sse2 4925  chunkmemset_safe_sse2 615  inflate_fast_ssse3 8107
chunkmemset_safe_ssse3 558  compare256_sse2 632  longest_match_sse2 1843
longest_match_slow_sse2 2385  slide_hash_sse2 377  adler32_ssse3 1070
adler32_fold_copy_sse42 982  adler32_c 645  adler32_fold_copy_c 62
crc32_chorba_118960_nondestructive 7158  crc32_chorba_sse41 4404
crc32_chorba_sse2 102  chorba_small_nondestructive_sse2 3013
                                               TOTAL = 36,878 B
```
The AVX512/VNNI/VPCLMUL tiers (29,172 B) are LIVE (a haswell binary on an AVX512 CPU uses them) — do not touch. `crc32_braid_internal` (2,201 B) is LIVE — zlib-ng's pclmul CRC falls back to it for `len < 16`; I explicitly excluded it.

**F6. zstd: `ZSTD_MULTITHREAD: true` (`deps/zstd.ts`) links 10,856 B that only a bun-only extension reaches.** Canary by address: 13 `ZSTDMT_*`+`POOL_*` symbols = 10,856 B (largest: `ZSTDMT_compressStream_generic` 4,858, `ZSTDMT_compressionJob` 2,614). I PROVED reachability on the canary: `zlib.zstdCompressSync(buf, {params: {[zlib.constants.ZSTD_c_nbWorkers]: 4}})` **succeeds** (4.3 ms vs 2.3 ms; same output). This is why LTO could NOT fold it (a live user-supplied parameter). Node.js vendors zstd without `ZSTD_MULTITHREAD`, so on real Node the same call throws `parameter_unsupported` — removing it would be node-PARITY, but it IS a working (undocumented) feature today, so this is Tier-C-shaped. Also confirmed: zstd's dictBuilder (`ZDICT_|COVER_|divsufsort`) = **0** in the canary despite being in the SOURCES list; legacy = 0 (confirms SYNTHESIS2's DISCARDED line).

**F7. boringssl hand-written `.S` files are MONOLITHIC `.text` sections → their dead-on-haswell `_nohw` variants cannot be gc'd.** boringssl's C dispatch already self-optimizes for `-march` (`CRYPTO_is_SSSE3_capable()` returns the constant 1 under `__SSSE3__`), which is WHY `aes_nohw_*` and the entire `ghash-ssse3-*.S.o` are 0 in the canary. But when a .S file is PARTIALLY live, the whole section stays. Local map confirms `sha1-x86_64-linux.S.o` is one 18,207 B `.text` input section (vs the 28,295 per-function sections of JSC). Canary-present dead variants, exact: `sha1_block_data_order_nohw` 4,122 + `sha256_block_data_order_nohw` 4,475 + `sha512_block_data_order_nohw` 4,599 + `ChaCha20_ctr32_nohw` 891 = **14,087 B**. (The much larger `chacha20_poly1305_x86_64-linux.S.o` at 40,097 B similarly carries its SSE body dead next to its AVX2 body, but they share one symbol via an internal jump, so I cannot bound it from nm.)

**F8. libjpeg-turbo still defines `C_ARITH_CODING_SUPPORTED` + `D_ARITH_CODING_SUPPORTED`.** `deps/libjpeg-turbo.ts` — the `cmakedefine(true)` at the end of BOTH the `jconfig.h` and `jconfigint.h` `replace` arrays is annotated "`// C_/D_ARITH_CODING_SUPPORTED`" and sets them. This is the only real knob left in that dep file (the 12/16-bit + lossless-precision axis is already excised by `patches/libjpeg-turbo/8bit-only.patch`). Local map: `jcarith.c.o` 6,666 + `jdarith.c.o` 8,039 + jaricom ≈ **~16 KB**. Pinned by `jcinit.c`/`jdmaster.c`'s runtime `cinfo->arith_code` test. The ENCODE half is zero-regression (Bun.Image never sets it); the DECODE half is a feature cut (arithmetic-coded JPEGs stop decoding). Below my reporting threshold alone; belongs as an extension to wave-1 row 10.

**F9. libjpeg-turbo `encode_one_block` is ONE 96,631-byte function** (local map, `.text.encode_one_block` in `jchuff.c.o`) — libjpeg-turbo's deliberately fully-unrolled 63×`kloop()` scalar Huffman encoder. It is LIVE because **bun builds libjpeg-turbo WITHOUT SIMD on x64** (`deps/libjpeg-turbo.ts`: "x64 stays C-only for now; the x86_64 path is NASM .asm and needs a separate wiring step"; `const simd = cfg.arm64`). De-unrolling it is a perf REGRESSION on `Bun.Image().jpeg()` → dead. *Side note for the maintainers (perf, not size, 0 bytes for this report): that TODO means every `Bun.Image` JPEG op on x64 runs the scalar codec.*

**F10. The Rust dependency tree does NOT duplicate any C dep.** `Cargo.lock` has NO `zstd-sys`/`flate2`/`miniz_oxide`(non-backtrace)/`ring`/`rustls`/`sha2`/`idna`/`url`/`icu_*`/`chrono`/`image`. `regex` IS present but it is a `[dev-dependencies]` of `src/js_parser/Cargo.toml:43` and contributes **0 canary symbols**. `lol_html` is a path dependency inside the ONE workspace cargo build (`deps/lolhtml.ts`'s own comment explains the two-staticlib/two-std hazard and that they avoided it), so there is exactly ONE Rust std and ONE `encoding_rs` (0.128 MB, canary — the wave-1 Tier-A row-2 target).

**F11. Confirmed already-optimal (the /GS--style per-dep defaults audit).** mimalloc: `MI_DEBUG=0`/`MI_STAT=0` follow from NDEBUG; `mimalloc.ts` already sets `MI_SKIP_COLLECT_ON_EXIT`, `MI_NO_PROCESS_DETACH`, `MI_DEFAULT_ALLOW_THP=0`, `MI_NO_SET_VMA_NAME`, `MI_BUILD_RELEASE`; only 3 `mimalloc:` message strings survive. lsquic.ts already excises gQUIC (`disable-gquic.patch`, "~175 KB") and sets `LSQUIC_CONN_STATS:0`, `LSQUIC_QIR:0`. libjpeg-turbo already patches out 12/16-bit. zstd: `ZSTD_LEGACY_SUPPORT:0`. highway: 2,460 B total linked — irrelevant. Bun's own node:crypto legacy surface (`bf-cbc`,`bf-ecb`,`rc2-cbc`,`rc4`,`des-*`,`ripemd160`,`md4`) is LIVE on the canary (`getCiphers()`/`getHashes()`), so `decrepit/` is load-bearing.

---

### proposals

> **Honesty up front: the sum of everything below is ~0.045 MB linux. This unit's primary deliverable is its negatives (dead_ends). None of this is the 1 MB-class breakthrough.**

---

**id: DI-1 — zlib-ng: define `WITHOUT_CHORBA` on the non-baseline x64 build and drop the 3 Chorba sources**
- **saving_mb: 0.014 linux.** Derivation (canary, `/tmp/canary/nm-dem.txt`, each a single `t` symbol at a unique address): `crc32_chorba_118960_nondestructive` 7,158 + `crc32_chorba_sse41` 4,404 + `crc32_chorba_sse2` 102 + `chorba_small_nondestructive_sse2` 3,013 = **14,677 B**.
- **confidence: high.** The dead-ness argument is structural: zlib-ng's `functable.c` assigns `ft.crc32` in ascending tiers and the LAST assignment on any CPU that can execute a `-march=haswell` binary is the PCLMULQDQ one (PCLMULQDQ is Westmere-2010; Haswell is 2013). The Chorba family only wins where PCLMULQDQ is ABSENT. The pclmul path's own `len<16` fallback is `crc32_braid_internal`, NOT chorba, and I left braid alone.
- **risk: low.** `WITHOUT_CHORBA` is zlib-ng's own, supported macro (the `WITH_CHORBA` CMake option). The only thing to watch is link errors from `functable.c`'s `#if defined(X86_SSE41) && !defined(WITHOUT_CHORBA)` references — the define removes those references too.
- **perf: neutral** (the deleted code is selected by CPUID only on CPUs the haswell binary cannot run on). Upstream citation: zlib-ng `functable.c` `init_functable()`; bun's floor at `scripts/build/flags.ts:76` (`-march=haswell`, `when: c.x64 && !c.baseline`).
- **regression: none.** `bun-linux-x64-baseline` (`-march=nehalem`, NO pclmul) MUST keep Chorba — that is why the change is gated on `!cfg.baseline`.
- **windows: yes, same 0.014** — flags.ts:76's `when` is not linux-gated, so `bun-windows-x64` is also haswell-floor and `zlib.ts` uses one kernel table for both. (`bun-windows-x64-baseline` keeps it.)
- **files: `scripts/build/deps/zlib.ts`.**
- **change (copy-pasteable):** in `build: cfg => {`, after the `defines` object is built, add
  `if (cfg.x64 && !cfg.baseline) defines.WITHOUT_CHORBA = true;`
  and in the `CORE` handling replace the unconditional `"arch/generic/crc32_chorba_c"` entry so it is only pushed when `cfg.baseline || !cfg.x64`; remove `"chorba_sse2"` from the `X86_SSE2` kernel's `sources` and delete the whole `X86_SSE41` row (`chorba_sse41` is its only source) — both gated on `!cfg.baseline`.
- **effort: small.**
- **relink_only: NO** — rebuild (a compile-list + define change), but only the ~30 zlib TUs recompile.

---

**id: DI-2 — zlib-ng: drop the sub-AVX2 (SSE2/SSSE3/SSE4.2) dispatch kernels on the non-baseline x64 build**
- **saving_mb: 0.017 linux NET.** Derivation (canary, by address): gross dead = `inflate_fast_sse2` 4,925 + `chunkmemset_safe_sse2` 615 + `inflate_fast_ssse3` 8,107 + `chunkmemset_safe_ssse3` 558 + `compare256_sse2` 632 + `longest_match_sse2` 1,843 + `longest_match_slow_sse2` 2,385 + `slide_hash_sse2` 377 + `adler32_ssse3` 1,070 + `adler32_fold_copy_sse42` 982 + `adler32_c` 645 + `adler32_fold_copy_c` 62 = **22,201 B**; minus ~4,700 B for the generic `chunkset_c`/`compare256_c`/`slide_hash_c` that must be RE-ADDED as the (never-executed) formal functable fallbacks (they are currently stripped by `x64Generic()` on the premise "SSE2 is the x64 floor"). NET ≈ **17,500 B**.
- **confidence: medium** (the net depends on the re-added generic C sizes; the gross is exact).
- **risk: medium.** `functable.c`'s x86-64 path uses the `X86_SSE2` block as the UNCONDITIONAL initial assignment; without `X86_SSE2` the generic `_c` block must be present, so `x64Generic()`'s 3 dropped files must come back. This needs a careful `#ifdef` audit of `functable.c`.
- **perf: neutral.** Identical argument to DI-1: a haswell binary always reaches the AVX2 overrides; the SSE2/SSSE3/SSE4.2 assignments are overwritten before use on every CPU the binary can run on. The new C fallbacks are never executed either.
- **regression: none** (baseline build keeps everything).
- **windows: yes, ~0.017** (same reasoning as DI-1).
- **files: `scripts/build/deps/zlib.ts`** (`X86` kernel table + `x64Generic()`).
- **effort: medium.**
- **relink_only: NO** — rebuild.

> DI-1 and DI-2 are DISJOINT symbol sets (listed above). Combined: **0.031 MB linux + 0.031 MB windows.** If the implementer only has time for one, DI-1 is the one.

---

**id: DI-3 — zstd: drop `ZSTD_MULTITHREAD` (GATED — a maintainer must say yes; this removes a working but undocumented bun extension)**
- **saving_mb: 0.010 linux.** Derivation (canary, by address, all 13 `ZSTDMT_*`+`POOL_*` symbols): 88+146+185+200+274+281+287+301+502+529+591+2,614+4,858 = **10,856 B** (plus zstd's `threading.c` pthread wrappers, not individually counted).
- **confidence: high** on the number; the GATE is the question.
- **risk: behavior change.** MEASURED on the canary: `zlib.zstdCompressSync(buf, {params: {[zlib.constants.ZSTD_c_nbWorkers]: 4}})` currently SUCCEEDS and returns bit-identical output. After this change it throws `parameter_unsupported`. Node.js builds its vendored zstd WITHOUT `ZSTD_MULTITHREAD`, so this is node-PARITY — but I did not run real Node to confirm, and an undocumented-but-working feature is a maintainer call, so this is **Tier-C-shaped**.
- **perf: improvement** on the default path — `ZSTD_compressStream2`'s `#ifdef ZSTD_MULTITHREAD if (params.nbWorkers > 0)` branch and `ZSTD_createCCtxParams`'s pool fields disappear. Citation: the define is at `deps/zstd.ts` (`ZSTD_MULTITHREAD: true`); zstd's own `lib/README.md` documents it as the opt-in.
- **regression:** as above, exact and enumerated.
- **windows: yes, ~0.010.**
- **files: `scripts/build/deps/zstd.ts`.**
- **change:** delete the `ZSTD_MULTITHREAD: true` line and remove `"compress/zstdmt_compress"`, `"common/pool"`, `"common/threading"` from `SOURCES`. Add a test that `zstdCompressSync(b,{params:{[ZSTD_c_nbWorkers]:1}})` throws the right error.
- **effort: small.**
- **relink_only: NO.**

---

### dead_ends (the bulk of this unit's value — every one is NEW evidence, none is in SYNTHESIS2)

1. **THE WHOLE "uncalled dep API surface" AXIS IS WORTH ZERO BYTES.** Proven 3 independent ways (F4). `--gc-sections` + full LTO + `local: *` is a near-perfect dead-feature eliminator for `direct` deps. Every future idea of the shape "SQLITE_OMIT_X", "OPENSSL_NO_Y", "this dep compiles a feature bun never exposes" must be rejected unless it names the RUNTIME value that pins the code.
2. **`-DNDEBUG` is set.** 0 `__assert_fail`, 0 assertion strings. The highest-value /GS--class hypothesis in the C deps is falsified cleanly.
3. **`-march=haswell` reaches every direct dep** (it is inside `globalFlags`). Consequently: zstd has NO `DYNAMIC_BMI2` duplicates (verified: exactly one `ZSTD_decompressSequences`); highway would have had no sub-AVX2 variants (moot — it is 2,460 B total); boringssl's C-side pre-SSSE3 fallbacks (`aes_nohw_*`, `ghash-ssse3`) already constant-fold away because boringssl's `CRYPTO_is_*_capable()` returns a literal 1 under the matching `__X__` macro.
4. **The prebuilt WebKit has `-ffunction-sections`** (28,295 per-function `.text.*` input sections vs 3 bare `.text`). The "the 20.7 MB prebuilt is un-gc-able" hypothesis is false.
5. **The sqlite OMIT matrix is 80%+ already done by LTO** (F4). The only remaining sqlite mass is fts5 0.211 MB (documented, live), fts3 0.147 MB (= Tier C3, confirms its 0.16 to the right order), rtree 0.032 MB (= C5). The "Recommended Compile-time Options" page's three size-relevant OMITs are all <500 B in the canary. The only no-regression residue is `SQLITE_ENABLE_COLUMN_METADATA`, whose 3 APIs bun NEVER calls (I extracted the complete `sqlite3_*` call set from `JSSQLStatement.cpp` + `src/runtime/`: bun uses `sqlite3_column_decltype`, which is core, but never `sqlite3_column_{database,table,origin}_name` or `sqlite3_table_column_metadata`) — removing it is a one-line, zero-regression PERF improvement per sqlite's own docs but only ~2 KB of size, so it is NOT a row.
6. **boringssl is picked clean.** Everything in the enormous `deps/boringssl.ts` source list that bun doesn't reach (trust_token, DTLS, SLH-DSA, the old Kyber draft, hrss, CMS, xwing, the FIPS self-test, `pki/`, `fiat_p256`) is already 0 in the canary. What remains is MLKEM (71 syms, = Tier-A row 7) + MLDSA (106 syms, = Tier C2) + genuinely live crypto/TLS. The `decrepit/` legacy ciphers (bf/rc2/rc4/des/ripemd/md4) are LIVE — I ran `crypto.getCiphers()`/`getHashes()` on the canary and they are all exposed. `ecp_nistz256_precomputed` (151,552 B) is the hot P-256 table; wave 1 already proved it incompressible.
7. **libdeflate's 74 KB compressor is LIVE.** `Bun.gzipSync(buf, {level: 12, library: "libdeflate"})` works on the canary (level 12 = the near-optimal bt matchfinder). `SUPPORT_NEAR_OPTIMAL_PARSING=0` is a feature cut. And libdeflate is on the HTTP path (`src/http/compress_body.rs`). Both compressors (zlib-ng + libdeflate) and both inflates are real, separately-user-selectable APIs. The "is one redundant" lead is closed: no.
8. **zstd dictBuilder is 0** (`ZDICT_|COVER_|divsufsort` = 0 canary syms) even though it is in `SOURCES` — gc-sections ate it. `ZSTD_LEGACY_SUPPORT:0` already set (confirms SYNTHESIS2). `HUF_FORCE_DECOMPRESS` is a perf regression by design. zstd's huffman `_fast_c_loop` pair (2,519 B) is pinned by a never-settable experimental flag — too small.
9. **libjpeg-turbo `encode_one_block` (96,631 B of ONE function) is LIVE** — see F9. De-unrolling it = a perf regression on `Bun.Image().jpeg()`. The ONLY zero-perf way to make it dead is to first enable the x64 SIMD path (a perf-improvement change of its own), which ADDS asm; the net sign is unknown. Out of scope for a size unit.
10. **libarchive's Unicode NFC normalization tables (`u_composition_table` + `u_decomposition_table` + `ccc_*` = 25,742 B rodata + 11,486 B text in `archive_string.c.o`) are on the `bun install` tarball-extraction path** (non-Apple libarchive sets `SCONV_NORMALIZATION_C` on the from-UTF-8 converter that every tar pathname goes through). Not removable without changing install behavior for non-ASCII filenames.
11. **The Rust dep tree duplicates nothing** (F10). `regex` is a dev-dep, 0 bytes.
12. **boringssl `_nohw` asm variants (14,087 B, F7)** — real, new, zero-perf, but the fix is a patch to the CHECKED-IN `gen/bcm/*.S` files (per-function `.section` directives) that must be re-based on every boringssl bump, or an upstream perlasm change. 14 KB is not worth that maintenance cost. Parked.
13. **libjpeg arithmetic coding (~16 KB, F8)** — the encode half is zero-regression but ~7 KB; the decode half is a (tiny) feature cut. Below threshold; the libjpeg implementer of wave-1 row 10 should fold in the encode half for free (drop `C_ARITH_CODING_SUPPORTED` from the `cmakedefine(true)` in `deps/libjpeg-turbo.ts`).
14. **libwebp's SharpYuv is only 8,015 B in the canary** and `deps/libwebp.ts` says the encoder "prefers" it. Not worth investigating further.
15. **mimalloc, cares, lshpack, lsqpack, libspng, hdrhistogram, picohttpparser, highway**: each either already optimally configured (F11), already patched (lshpack's .bss), owned by a Tier-C row (lsqpack rides on lsquic=C4), or <5 KB.
16. **lsquic/lsqpack internals beyond Tier C4**: the only large internal knob (`LSQUIC_LOWEST_LOG_LEVEL`) is ALREADY a no-op — LTO folded the logging away (F4). Nothing additive.

### overlaps

- **w2 Tier-A row 6 (brotli tables → .bss)**: I attributed brotli's rodata precisely and it is relevant to that row's implementer: `encoder_dict.c.o` holds `kStaticDictionaryWords` 126,820 + `kStaticDictionaryBuckets` 65,536; `dictionary_hash.c.o` holds `kStaticDictionaryHashWords` 65,536 + `kStaticDictionaryHashLengths` 32,768. `dictionary.c.o`'s `kBrotliDictionaryData` (122,784 B) is the SHARED dictionary the DECODER reads on every `br` response — it is HOT and must NOT be moved to .bss. Note that upstream's `BROTLI_EXTERNAL_DICTIONARY_DATA` macro gates `kBrotliDictionaryData`, NOT the encoder hash tables; the encoder tables need their own new gate. Row 6's implementer should double-check this.
- **w2 Tier-A row 11 (zstd NULL cdict block compressors)**: `zstd_lazy.c.o` is 213,512 B (the single biggest zstd object); the dictMatchState/dedicatedDictSearch columns of it + `zstd_fast`/`zstd_double_fast`/`zstd_opt` are that row's 0.150. My DI-3 (ZSTDMT) is fully disjoint from it.
- **w1 Tier-A row 10 (image codecs)**: my F8 (arith coding) and F9 (the SIMD TODO) extend that row. Fold the -C_ARITH one-liner into it.
- **w3-cpp-compile-flags**: F2's `-march`/`NDEBUG`/version-script facts and the `local: *` `linker.lds` are things that unit will also hit — it should CITE mine rather than re-derive. The `-rdynamic` at `flags.ts:1333` is NEUTRALIZED by the version script (only 1,015 dynsyms, all napi/uv/v8).
- **w3-lto-pipeline / w3-binary-archaeology**: F4's mechanism suggests a GENUINELY NEW hunt that is NOT in my scope: find the never-written dispatch globals that LTO FAILED to constant-fold (where it succeeded for sqlite/lsquic). That is an inverse-of-F4 search over the whole binary, not over the deps.
- **w3-weird-ideas**: tinycc (0.29 MB of text for the opt-in `bun:ffi` `cc()`) has no internal knob at zero cost; the only move is architectural (lazy/split). Same for lsquic (C4).
- **w3-webkit-build-options**: the WebKit PREBUILT is the one dep I could not audit flag-by-flag; I DID verify its function-sections (F2).

### one free, zero-size observation for the maintainers
`deps/libjpeg-turbo.ts` has `const simd = cfg.arm64; // x64 NASM path TODO` — **the shipped x64 bun runs the entirely scalar libjpeg-turbo.** That is a documented, upstream-measured multi-x perf gap on every `Bun.Image` JPEG operation, hiding in a dep build file. Not a size item (enabling SIMD ADDS bytes), but it is exactly Dylan's "something in one of our dependencies we haven't looked into", in the perf direction.
