# SKEPTIC — w3-dep-internals

Every number below was re-derived BY ADDRESS from `/tmp/canary/nm-dem.txt`
(script: `/tmp/skeptic/verify_addr.py`, which counts each address ONCE and
flags any address that also hosts a name outside the requested set).
Every behavioral claim was run on `/tmp/canary/bun-linux-x64/bun`.
Every source claim was read from `/workspace/bun/vendor/zlib/*` and
`/workspace/bun/scripts/build/*` at the checked-out revision.

---

## VERDICTS

**VERDICT DI-1: WEAKENED** — the 14,677 B is exact-by-address and the
perf-neutrality argument is SOLID (I attacked it hard; it survived). But the
**prescribed change is wrong**: `WITHOUT_CHORBA` is the wrong macro for
7,519 B (51%) of the claimed bytes, and the report's source-list edits as
written **do not link**. The report literally mis-transcribed
`functable.c:148` (it wrote `!defined(WITHOUT_CHORBA)`; the source says
`!defined(WITHOUT_CHORBA_SSE)`). The fix is one extra define. Corrected,
this is a clean 0.014 MB.

**VERDICT DI-2: WEAKENED** — gross 22,201 B is exact-by-address, but
(a) 707 B of it (`adler32_c`+`adler32_fold_copy_c`) is **not removable by
any `deps/zlib.ts` change** (they are the UNCONDITIONAL x86-64 functable
floor, not an SSE tier); (b) the re-add cost is **9,582 B MEASURED** with
the exact production cflags, not "~4,700 B" — 2x off, because the report
forgot that `compare256_c.c` also generates `longest_match_c` +
`longest_match_slow_c`; (c) the design is internally inconsistent as
written (see below) and would ship a functable with NULL slots. Corrected
honest net: **~11.9 KB** (0.011 MB), not 17.5 KB — and 10,717 B of that is
available from a trivially-safe SSSE3+SSE42-only subset the report
**missed**, which needs none of DI-2's risk.

**VERDICT DI-3: REFUTED** — the 10,856 B is exact-by-address and the
canary reachability test reproduces. But the **one claim the entire
Tier-C classification rests on is factually backwards**. The report wrote
"Node.js vendors zstd without `ZSTD_MULTITHREAD`, so on real Node the same
call throws `parameter_unsupported` — removing it would be node-PARITY",
while admitting "I did not run real Node to confirm." **I ran it. Node
v26.3.0 SUCCEEDS with `nbWorkers: 4`.** `nm -D /usr/local/bin/node |
grep -c ZSTDMT` = **9** (17 total symbols): Node's vendored zstd 1.5.7 IS
built `ZSTD_MULTITHREAD`. And Node DOES surface `ZSTD_CCtx_setParameter`
failures (I proved it: `windowLog: 5` → `ERR_ZLIB_INITIALIZATION_FAILED`),
so its acceptance of `nbWorkers` is real, not error-swallowing. DI-3 is a
**node:zlib node-compat REGRESSION**, the exact opposite of its only
stated justification. It belongs in dead_ends, not Tier C. 0 bytes banked.

**VERDICT on the 16 dead_ends / F-findings: CONFIRMED**, with one
independent extension (below). These are the unit's real value and the
final synthesizer should cite them with confidence.

---

## EVIDENCE

### 1. Byte re-derivation (all proposals + F5 + F7)

From `/tmp/skeptic/verify_addr.py` over `/tmp/canary/nm-dem.txt`:

| set | names | unique addrs | by-ADDRESS sum | report claimed | match |
|---|---|---|---|---|---|
| DI-1 (4 chorba syms) | 4/4 found | 4 | **14,677 B** | 14,677 | EXACT |
| DI-2 gross (12 syms) | 12/12 found | 12 | **22,201 B** | 22,201 | EXACT |
| DI-3 (all `ZSTDMT_*`+`POOL_*`) | 13/13 found | 13 | **10,856 B** | 10,856 | EXACT |
| F5 total (DI-1+DI-2) | 16 | 16 | **36,878 B** | 36,878 | EXACT |
| F7 boringssl `_nohw` | 4/4 | 4 | **14,087 B** | 14,087 | EXACT |

**Zero ICF aliasing** in any of these sets: no target address hosts any
other symbol name, and no target name appears at >1 address. The unit did
NOT fall for the by-name counting bug. Arithmetic is above reproach.

Bonus: DI-3's "plus zstd's `threading.c` pthread wrappers, not
individually counted" is **0** — no `ZSTD_pthread_*` symbol survived. So
10,856 is exact, not a lower bound.

### 2. THE PERF ATTACK (DI-1 / DI-2) — and why it SURVIVED

This is where I expected to kill DI-1, because **bun's own
`scripts/build/deps/zlib.ts:22-26` contains a comment that appears to
flatly contradict it**:

> `172b8544 (Apr 2026): inverted COPY guard disables Chorba CRC32
> fast-path on PCLMULQDQ-only x64 (Westmere–Comet Lake, Zen1–Zen3)`

That says a *Chorba CRC32 fast-path IS the live fast-path on
Haswell/Skylake/Zen1-3* — exactly the CPUs the shipped binary targets —
which would make DI-1 a straight hot-path perf regression.

**I traced it to source and it is a DIFFERENT piece of code.** The "COPY
guard" is `vendor/zlib/arch/x86/crc32_fold_pclmulqdq_tpl.h:114`:
`#if !defined(COPY) || defined(__AVX512VL__)`, which gates an **inline,
local-variable Chorba-interleaved loop** (the `while (len >= 512+64+16*8)`
block at lines 108-325, implementing arXiv 2412.16398 with `__m128i
chorba1..chorba8` LOCALS) **inside `crc32_fold_pclmulqdq`'s own body**.
It calls no external Chorba function. It shares nothing with DI-1's four
symbols. DI-1 does not touch it. The zlib.ts comment is correct AND
irrelevant to DI-1.

The actual `ft.crc32` dispatch at the vendored 2.3.3 (`functable.c`):

```
 84: ft.crc32 = &crc32_braid         [x86_64 uncond floor]
116: ft.crc32 = &crc32_chorba        [uncond]  <- generic chorba
127: ft.crc32 = &crc32_chorba_sse2   [uncond on x86_64]
150: if (has_sse41)     ft.crc32 = &crc32_chorba_sse41
163: if (has_pclmulqdq) ft.crc32 = &crc32_pclmulqdq   <- ALWAYS wins on haswell
212: if (avx512+vpclmul) ft.crc32 = &crc32_vpclmulqdq
```

PCLMULQDQ is in `-march=haswell`'s feature set (`scripts/build/flags.ts`,
`when: c => c.x64 && !c.baseline`), so on any CPU the non-baseline x64
binary is in contract on, line 163 fires and every Chorba assignment is
dead. `ft` is a LOCAL struct; intermediate values are never observable
(the atomic publish happens once at the end). The baseline build
(`-march=nehalem`, no PCLMUL) MUST keep Chorba and the proposal gates on
`!cfg.baseline`. **Perf-neutral: CONFIRMED.**

Decisive corroboration the unit didn't have: `crc32_chorba` (the generic
dispatcher at line 116) and `crc32_braid` (line 84) are **already absent
from the canary** — LTO dead-store-eliminated lines 84 and 116 because
line 127 unconditionally overwrites them on x86_64. Only the four
symbols pinned by the *runtime*-conditional assignments (lines 127/150,
plus the callees inside `chorba_sse{2,41}.c`) survive. That is the
unit's F4 mechanism, reproduced inside its own proposal's data.

Same argument for DI-2 (SSSE3/SSE42 tiers are conditional on
`has_ssse3`/`has_sse42`, always overwritten by the `has_avx2 && has_bmi2`
tier at :176, and `-march=haswell` guarantees both). **CONFIRMED.**

### 3. DI-1: the prescription is wrong

zlib-ng uses **two** macros, not one:

| macro | gates (in the vendored 2.3.3) | upstream origin |
|---|---|---|
| `WITHOUT_CHORBA` | `functable.c:115` (generic `crc32_chorba`, already LTO-dead, **0 bytes**); the `crc32_chorba_118960_nondestructive` CALLS at `chorba_sse41.c:318` and `chorba_sse2.c:860` (**7,158 B**) | `CMakeLists.txt:200-202`, the `WITH_CRC32_CHORBA` option (report said `WITH_CHORBA` — minor) |
| `WITHOUT_CHORBA_SSE` | `functable.c:126` (`crc32_chorba_sse2`, 102 B + its callee `chorba_small_nondestructive_sse2`, 3,013 B); `functable.c:148` (`crc32_chorba_sse41`, 4,404 B); the file-level `#if` on both `chorba_sse{2,41}.c:1` (**7,519 B**) | `CMakeLists.txt:228` — upstream's MSVC<2022 compat path, so it IS an upstream-compiled-and-tested configuration |

- `defines.WITHOUT_CHORBA = true` ALONE → **7,158 B**, not 14,677.
- The report's source-list edit ("remove `chorba_sse2` from the
  `X86_SSE2` kernel's sources") WITHOUT `WITHOUT_CHORBA_SSE` →
  `functable.c:127` still emits `ft.crc32 = &crc32_chorba_sse2;` →
  **undefined reference, link error**. The change as written does not build.
- Removing `arch/generic/crc32_chorba_c` from `CORE` without
  `WITHOUT_CHORBA` → `chorba_sse{2,41}.c:{861,319}` still call
  `crc32_chorba_118960_nondestructive` → link error.
- The report even QUOTES `functable.c:148` as
  `#if defined(X86_SSE41) && !defined(WITHOUT_CHORBA)` — the real line is
  `!defined(WITHOUT_CHORBA_SSE)`. It read the file and got the token wrong.

**Unlisted offset:** once the Chorba stores are gone, the
`ft.crc32 = &crc32_braid` store at `functable.c:84` is no longer dead
(line 163 is conditional), so the `crc32_braid` wrapper comes back.
`crc32_braid_internal` (2,201 B) is already linked and stays either way
(the report correctly excluded it). Net offset: ~50-100 B. Negligible.

**Corrected DI-1: ~14,600 B = 0.0139 MB linux.**

### 4. DI-2: three independent errors

**(a) 707 B is misclassified.** `adler32_c` (645 B, addr 53368784) and
`adler32_fold_copy_c` (62 B, addr 53369440) are referenced by the
UNCONDITIONAL x86-64 floor at `functable.c:82-83` — NOT by any SSE tier.
There is no x86-64 SIMD `adler32` floor (the `X86_SSE2` kernel row has no
adler32 source); `adler32_c` IS the floor and stays no matter what.
(The 53M addresses confirm they are in the LTO'd region, not the
`-fno-lto` kernel region at 24M, i.e. the arch/generic TUs.)

**(b) The re-add is 2x bigger than estimated.** I compiled
`arch/generic/{chunkset_c,compare256_c,slide_hash_c}.c` with the EXACT
production cflags taken from `build/release/build.ninja`'s
`adler32_c.c.o` edge (`-march=haswell -DNDEBUG -O3 ...` +
the full zlib define set):

```
inflate_fast_c       5016     compare256_c            10
CHUNKCOPY_SAFE        751     longest_match_c        662
chunkmemset_safe_c    592     compare256_64          836
slide_hash_c          364     longest_match_slow_c  1351
                         TOTAL = 9,582 B   (report: "~4,700 B")
```

The report forgot that zlib-ng's `compare256_c.c` ALSO emits
`longest_match_c` + `longest_match_slow_c` + `compare256_64` (2,859 B of
the 9,582) via `match_tpl.h` — and those ARE required: with
`HAVE_BUILTIN_CTZ` defined (it is, `zlib.ts:156`), `functable.c:89-93`'s
generic `longest_match_c` fallback is compiled OUT, so
`longest_match_sse2`/`_slow_sse2` are the x86-64 FLOOR for those slots
(`functable.c:133-134`, inside the unconditional `X86_SSE2` block).

**(c) The design does not work as written.** Deleting the `X86_SSE2` row
removes the `X86_SSE2` DEFINE. `functable.c:80` is
`#if (defined(__x86_64__)||defined(_M_X64)) && defined(X86_SSE2)` —
without it, the ENTIRE non-`WITH_ALL_FALLBACKS` x86-64 generic floor
block (lines 79-94) vanishes. Its `#else // WITH_ALL_FALLBACKS` branch
(lines 96-108) only compiles if `WITH_ALL_FALLBACKS` is defined, which
`zlib.ts` sets ONLY for arm64 (line 193) and which the report never
mentions. So with the report's stated change:
- The "re-added" `chunkset_c`/`compare256_c`/`slide_hash_c` have **no
  referencer** → `--gc-sections` deletes them (they contribute 0 bytes,
  not the "formal fallbacks" the report describes).
- `ft.crc32_fold`/`crc32_fold_copy`/`crc32_fold_final`/`crc32_fold_reset`
  are set ONLY in the `if (has_pclmulqdq)` block, and
  `ft.longest_match*`/`compare256`/`chunkmemset_safe`/`slide_hash`/
  `inflate_fast` ONLY under `if (has_avx2 && has_bmi2)`. On a CPU missing
  either, `FUNCTABLE_VERIFY_ASSIGN` hits a NULL and
  `fprintf(stderr, "Zlib-ng functable failed initialization!") + abort()`
  (the stub path) or `Z_VERSION_ERROR`. On the haswell build those CPUs
  are already out of contract (SIGILL), but this silently converts
  "works" into "aborts" on any CPUID-masking hypervisor and is an
  indefensible landmine to ship for 1.2 KB.

**The SAFE SUBSET the report missed.** The `X86_SSSE3` row
(`adler32_ssse3`, `chunkmemset_safe_ssse3`, `inflate_fast_ssse3`) and
`X86_SSE42` row (`adler32_fold_copy_sse42`) are at `functable.c:139-145`
and `:155-159` — BOTH are `if (has_*)`-conditional pure overrides, NEITHER
is a floor for any slot, and BOTH are always re-overridden by the AVX2
tier on haswell. Deleting those two rows removes **10,717 B** with ZERO
re-adds, ZERO macro work, and ZERO functable risk. That is 90% of a
correctly-designed DI-2's ~11.9 KB net at ~10% of the effort. The extra
~1.2 KB from the `X86_SSE2`-row half requires adding `WITH_ALL_FALLBACKS`
+ 3 source files + a functable audit — not worth it.

Full zlib-ng kernel census on the canary (my derivation — every symbol
accounted for): 29 symbols. AVX2/AVX512/VNNI/PCLMUL/VPCLMUL tiers are all
present and LIVE (a haswell binary on an AVX512 CPU selects them at
runtime — the report is right not to touch them). The dead set is exactly
DI-1's 4 + the 10,717 B SSSE3/SSE42 subset + the SSE2 floor (removable
only with WITH_ALL_FALLBACKS). Nothing else.

### 5. DI-3: the decisive test

```
# bun canary:
zlib.zstdCompressSync(buf, {params:{[ZSTD_c_nbWorkers]:4}})  -> OK (162 B)   [confirms reachability]

# node v26.3.0:
zlib.zstdCompressSync(buf, {params:{[ZSTD_c_nbWorkers]:4}})  -> OK (162 B)   [REFUTES "node throws"]
zlib.zstdCompressSync(buf, {params:{[ZSTD_c_windowLog]:5}})  -> THROWS
   ERR_ZLIB_INITIALIZATION_FAILED "Setting parameter failed"                 [proves node surfaces
                                                                              setParameter errors,
                                                                              so the OK is real]
nm -D /usr/local/bin/node | grep -c ZSTDMT  -> 9   (17 total)                [node zstd 1.5.7 IS
                                                                              built ZSTD_MULTITHREAD]
```

Also verified from `/workspace/bun/src/`: the ONLY `nbWorkers`/`ZSTDMT`
reference is `src/jsc/bindings/ProcessBindingConstants.cpp:1133`, which
exports the `ZSTD_c_nbWorkers` CONSTANT **for node parity**. Bun's
internal zstd paths (install cache, `Content-Encoding`) never set it —
so the report's "perf: improvement" claim and the 10,856 B count are
both fine. What's refuted is the tradeoff: this removes a
node-compatible `node:zlib` capability that node 24/25/26 ships, making
bun throw where node succeeds. Under the hard constraint and SYNTHESIS2's
policy, a regression goes to dead_ends. **0 bytes banked.**

### 6. The NEGATIVES (F2-F11) — all CONFIRMED, plus one NEW confirmation

These are what the final synthesizer will lean on, so I re-ran every
falsifiable one:

| claim | my independent result |
|---|---|
| F2 `-DNDEBUG` reaches deps | `flags.ts:247` in `globalFlags`, comment literally says "Direct deps only see globalFlags, so it must be here too"; `__assert_fail` = **0** in canary |
| F2 `-march=haswell` reaches deps | confirmed on the REAL ninja edge for `chunkset_sse2.c.o`: `cflags = -march=haswell -DNDEBUG -O3 ... -msse2 -fno-lto` |
| F2 no zstd BMI2 dups | exactly **1** `ZSTD_decompressSequences`; 0 zstd `_bmi2`/`_default` pairs |
| F3 `node:sqlite` absent | `require("node:sqlite")` → "No such built-in module" on the canary |
| F3 sqlite compile_options | exact match: 7 `ENABLE_*`, 0 `OMIT_*` |
| F4 sqlite sharedcache gone | only `sqlite3SharedCacheList` (8 B `.bss`) survives |
| F4 boringssl | trust_token/DTLS/SLHDSA/hrss/xwing/aes_nohw/ghash_ssse3 ALL = **0**; MLKEM 71, MLDSA 106 — byte-for-byte |
| F7 `_nohw` asm | 14,087 B exact by address |
| F11 decrepit load-bearing | `bf-cbc`,`bf-ecb`,`rc2-cbc`,`rc4`,`des-ecb`,`des-ede3-cbc` ALL in `getCiphers()`; `ripemd160`,`md4` in `getHashes()` on the canary |
| dead_end 5 COLUMN_METADATA | `sqlite3_column_{database,table,origin}_name{,16}` are 17-20 B stubs + `sqlite3_table_column_metadata` 1,255 B = **1,366 B**. Correctly not a row. |

**NEW, a 4th independent confirmation of F4 that the unit did not run:**
`deps/zlib.ts` builds `WITH_GZFILEOP: true` plus `infback.c`, `uncompr.c`,
`compress.c`, `gzlib.c`, `gzread.c`, `gzwrite.c`. Canary:
`gzopen`/`gzread`/`gzwrite`/`gzdopen`/`inflateBack`/`uncompress` are ALL
absent — only `compress2` (324 B) has a live caller. So `--gc-sections`
already ate the entire zlib-ng gzFile + inflateBack + uncompress API
surface despite no `WITHOUT_GZFILEOP` knob. This extends F4's thesis to a
4th dep-internal axis and is ITSELF a valuable negative: **nobody should
propose `WITH_GZFILEOP` removal, `infback.c` removal, or any other
zlib-ng public-API trimming — it is worth 324 B at most.**

F4's central thesis ("any 'dep compiles an uncalled API' proposal is
worth 0; only runtime-dispatch-pinned code survives") is the single
best guidance this unit produced for the rest of wave 3, and it is
now confirmed from FOUR independent directions (sqlite sharedcache,
lsquic logging, boringssl dead features, zlib-ng gzFile). CITE IT.

### 7. Duplication / DISCARDED-list check

- **SYNTHESIS2 contains NO zlib-ng row** in any tier or in DISCARDED. The
  wave-3 brief explicitly assigned "zlib-ng: ... are the pre-haswell ones
  dead given -march=haswell?" to THIS unit. DI-1 and DI-2 are **novel**.
- DI-3 (ZSTDMT): not in SYNTHESIS2. Fully **disjoint** from wave-2 Tier-A
  row 11 (zstd NULL cdict block compressors), as the report says. Novel —
  but refuted.
- The report does NOT re-open anything: it CONFIRMS SYNTHESIS2-DISCARDED
  "zstd legacy decoders = 0" rather than re-claiming it; correctly routes
  F8/F9 → wave-1 row 10, the brotli rodata attribution → wave-2 row 6,
  lsquic → Tier C4, fts3 → C3, rtree → C5, MLKEM → row 7, ML-DSA → C2.
  **No duplicate money claimed. Clean.**

### 8. The one open item (honest flag, not a refutation)

Both zlib proposals' "windows: yes, same bytes" lines depend on clang-cl
honoring `-march=haswell`. I could not reach the windows machine this
session. Evidence it does: clang's `Options.td` gives `march_EQ`
`CLOption` visibility; `deps/zlib.ts:68-70` explicitly says "clang-cl
accepts gcc-spelling `-m<isa>` flags"; and the `w2-windows-delta`
skeptic's clang-cl divergent-default sweep (SYNTHESIS2 DISCARDED, last
bullet) did not flag it. I rate this high-confidence but, per the /GS-
lesson, it is the one thing a windows implementer should confirm with a
30-second `clang-cl -march=haswell -c t.c` + a macro probe before
banking the windows bytes.

---

## THE CORRECTED, COPY-PASTEABLE CHANGE (for the synthesizer)

One file: `scripts/build/deps/zlib.ts`. One PR. Supersedes DI-1 and DI-2.

1. First line of `build: cfg => {` (before the `sources` array):
   ```ts
   // On the non-baseline x64 build (-march=haswell, see scripts/build/flags.ts),
   // PCLMULQDQ is part of the CPU contract, so functable.c's PCLMULQDQ tier
   // (functable.c:163) always overwrites the Chorba/SSSE3/SSE4.2 tiers before
   // init_functable() publishes. The baseline (-march=nehalem) build has no
   // PCLMULQDQ and MUST keep them.
   const x64Haswell = cfg.x64 && !cfg.baseline;
   ```
2. Add to the `defines` object (next to `WITH_OPTIM`):
   ```ts
   // BOTH are zlib-ng's own macros and BOTH are required: functable.c gates
   // the generic Chorba on WITHOUT_CHORBA (:115) but the SSE Chorba tiers on
   // WITHOUT_CHORBA_SSE (:126, :148). With one but not the other you either
   // get 7 KB instead of 14 KB, or an undefined-reference link error.
   ...(x64Haswell && { WITHOUT_CHORBA: true, WITHOUT_CHORBA_SSE: true }),
   ```
3. In the `for (const k of kernels)` loop, skip the three rows whose only
   consumers the defines/AVX2-tier now kill, and the now-empty chorba TU:
   ```ts
   for (const k of kernels) {
     // SSSE3 and SSE4.2 are if(has_*)-conditional pure overrides (never a
     // functable floor) that the AVX2 tier always wins on haswell. SSE4.1's
     // only source is chorba_sse41, dead under WITHOUT_CHORBA_SSE.
     if (x64Haswell && (k.define === "X86_SSSE3" || k.define === "X86_SSE41" || k.define === "X86_SSE42")) continue;
     defines[k.define] = true;
     for (const s of k.sources) {
       // chorba_sse2.c is a no-op TU under WITHOUT_CHORBA_SSE (file-level #if).
       if (x64Haswell && s === "chorba_sse2") continue;
       sources.push({ path: `arch/${archDir}/${s}.c`, cflags: [...k.flags, "-fno-lto"] });
     }
   }
   ```
   DO NOT touch the `X86_SSE2` row otherwise — it IS the x86-64 functable
   floor (functable.c:79-94 is `#if (x86_64) && defined(X86_SSE2)`).
   DO NOT touch `x64Generic()` — `adler32_c`/`adler32_fold_c` are the
   unconditional adler32 floor (functable.c:82-83).
4. Optional, 0 bytes, hygiene: filter `"arch/generic/crc32_chorba_c"` out
   of `CORE` when `x64Haswell` (otherwise it compiles and gc-sections
   eats it).

What this deletes (all verified dead on a haswell binary):
```
crc32_chorba_118960_nondestructive 7158  crc32_chorba_sse41     4404
chorba_small_nondestructive_sse2   3013  crc32_chorba_sse2       102
inflate_fast_ssse3                 8107  adler32_ssse3          1070
chunkmemset_safe_ssse3              558  adler32_fold_copy_sse42 982
                          TOTAL = 25,394 B   (minus ~50-100 B crc32_braid
                                              wrapper returning)
```
**= 0.024 MB linux**, ~0.024 MB windows (modulo the clang-cl note).
Effort: small. Rebuild: only the ~25 zlib TUs. No patch file needed.
Test: `Bun.gzipSync`/`gunzipSync`/`Bun.zlibCompress` round-trips +
`node:zlib` crc32; the baseline CI lane covers the kept path.

---

## credible NEW (non-duplicate) total MB for this unit: 0.024

(The report claimed 0.045: DI-1 0.014 + DI-2 0.017 + DI-3 0.010, "plus
0.031-windows". I credit DI-1 at 0.0139, DI-2 at the 0.0102 safe subset,
and DI-3 at 0. The unit's own honest framing — "the sum is ~0.045 MB; this
unit's primary deliverable is its negatives" — survives; its negatives are
its real contribution and I confirm them all, plus one.)
