# REPORT

## unit: w3-cpp-compile-flags

## TL;DR (honest)

**LINUX: the C/C++ compile-flag avenue is CLOSED, now PROVEN at the cc1 level, not
merely asserted.** I dumped the *actual driver-produced cc1 line* for bun's exact
release flag set and walked every size-relevant token: there is ZERO accidental
driver default on Linux. I also proved the "a dep's own build system adds a flag"
hole **does not exist** on the bun side (every C/C++ dep except the prebuilt
WebKit is `direct` and gets `globalFlags` last-wins-safe). **0.00 new linux MB.**

**WINDOWS: two things the wave-2 clang-cl divergent-default sweep ("after /GS-,
nothing else") MISSED, both found by the same `-###` method that should have
found /GS-:**
1. **`/FIXED`** (drop the PE base-relocation table): **~0.63 MB windows-only**, a
   RELINK-ONLY one-token change, zero perf cost, but it removes ASLR — the
   *identical* policy class as /GS- (a Windows mitigation the Linux flagship,
   which is `ET_EXEC`, never had), just a bigger one. Tier-C.
2. **`-relaxed-aliasing`**: clang-cl *silently defaults to `-fno-strict-aliasing`*;
   the Linux driver is strict. A perf-losing driver divergence nobody chose.
   Size sign unknown → NOT a size row; filed as a perf-parity bug.

The rest of my output is the exhaustive, evidence-backed **dead-end matrix** the
brief asked for, plus one implementation-note correction to SYNTHESIS2 row B6 and
a refinement of Ground-Truth #7.

---

## findings

### F1. The Linux release cc1 line, flag-by-flag — ZERO accidental defaults

I ran the real driver (`clang++-21 -### -c` with **bun's exact release globalFlags
+ bunOnlyFlags** from `scripts/build/flags.ts`) and inspected every cc1 token:

```
-O3 -emit-llvm-bc -flto=full -flto-unit -mrelocation-model static
-mframe-pointer=all -fforce-emit-vtables -fmath-errno -mconstructor-aliases
-target-cpu haswell -ffunction-sections -fdata-sections -fvisibility=hidden
-fvisibility-inlines-hidden -fno-rtti -vectorize-loops -vectorize-slp
-fwhole-program-vtables -fsplit-lto-unit -fc++-static-destructors=none -faddrsig
```

Present and correct: static reloc model (non-PIE), frame pointers (deliberate,
GT), ctor aliasing, function/data sections, hidden visibility, no RTTI, addrsig.
ABSENT and correct: `-stack-protector`, `-fcf-protection`,
`-ftrivial-auto-var-init`, `-funwind-tables=N` (so unwind tables are level 0),
`-relaxed-aliasing`, exceptions. **Every token is either explicitly chosen in
flags.ts or a correct-for-size driver default.**

Raw-byte fingerprint scan of the canary's 54,846,298-byte `.text`
(`/tmp/w3-cpp-compile-flags/scan.py`, exact-decoded `call rel32` targets):

| pattern | count | verdict |
|---|---|---|
| `endbr64` (f3 0f 1e fa) | **1,633** (6.5 KB) | see F2 |
| `mov %fs:0x28,%r` (canary load) | **291** | see F2 |
| `call __stack_chk_fail@plt` (exact rel32→0x4b14080) | **399** | see F2 |
| `call __{s,f}printf_chk@plt` (exact) | 12 + 2 | see F2 |
| stack-clash probe (`sub $0x1000,%rsp; orq $0,(%rsp)`) | **0** | absent ✓ |
| `-ftrivial-auto-var-init=pattern` (0xAA×8) | 39 (noise) | absent ✓ |
| `lfence` (SLH) | 1 | absent ✓ |

### F2. GT#7 REFINEMENT: the non-zero hardening counts are the GCC-built static runtime

GT#7 says "NO stack protector, NO CET/endbr64". That is true for every byte of
bun/WebKit/dep code but is not literally zero. The 1,633 `endbr64` + 291 canaries
+ 399 `__stack_chk_fail` calls + 14 `__*printf_chk` calls exist, and they ALL
come from `/usr/lib/gcc/x86_64-linux-gnu/13/{libstdc++,libgcc_eh,libgcc}.a` +
`crt*.o`, which are built by the **Ubuntu host GCC 13** (proof: the canary's
`.comment` reads `GCC: (Ubuntu 13.1.0-8ubuntu1~20.04.2)`), and Ubuntu GCC
defaults `-fstack-protector-strong -fcf-protection=full -D_FORTIFY_SOURCE`.
Total ≈ **8 KB**. The per-input-file LTO-map sum (my `mapsum.py`) puts the whole
GNU-runtime native contribution at ~0.40 MB of `.text` — that population IS
wave-1/2's **B1 `iostream-locale-purge`** (skeptic-confirmed 0.32 MB). Nothing
new; do not re-chase. Value: GT#7's "zero" is now an exact, attributed 8 KB.

### F3. The complete flag-regime map of the link (THE key structural fact)

From the LTO linker map, I summed the allocated (strip-surviving) bytes of every
NON-LTO input (`/tmp/w3-cpp-compile-flags/mapsum.py`). Everything else is in
`bun-profile.lto.o` (59.0 MB, `Reloc::Static` codegen forced by the `-no-pie`
link regardless of per-TU `-fpic`). The full regime map:

| regime | who | flag owner | /GS--class risk? |
|---|---|---|---|
| bun's own C/C++ (LTO bitcode) | everything in `src/` | `flags.ts` globalFlags+bunOnlyFlags | **none (F1)** |
| C/C++ deps (LTO bitcode) | ALL 19 C/C++ deps except WebKit are **`direct`** | `flags.ts` globalFlags, then `spec.cflags` LAST (`source.ts:1512`) | **none — see F4** |
| WebKit | `prebuilt` tarball | oven-sh/WebKit Dockerfile + cmake | **YES — not my lane** (w3-webkit-build-options) |
| 3 deliberately non-LTO dep file sets | brotli `*.c`, zlib-ng SIMD kernels, boringssl `.S` | same `flags.ts` path | no (F5) |
| GNU static runtime | libstdc++.a, libgcc*.a, crt*.o | **Ubuntu GCC 13's distro defaults** | ~8 KB; owned by B1 |
| Rust | libbun_rust.a | rust.ts / Cargo.toml | other units |

**There are ZERO `nested-cmake` deps in the release build** (`grep -l nested-cmake
scripts/build/deps/*.ts` → only `webkit.ts`'s *local dev* mode). So the one and
only C/C++ input whose compiler flags bun's `flags.ts` does NOT decide is the
prebuilt WebKit. That closes the "a dep's own CMakeLists appends something after
bun's CMAKE_C_FLAGS" hypothesis conclusively on the bun side.

### F4. Direct-dep flag ordering is last-wins-safe; two deps deliberately opt OUT of strict aliasing

`scripts/build/source.ts:1512`:
`[...computeDepFlags(globalFlags), ...picFlags, ...incFlags, ...defFlags, ...(spec.cflags ?? [])]`
— per-dep `spec.cflags` always wins. Deps that set size/aliasing flags of their
own: `deps/boringssl.ts:64` and `deps/tinycc.ts:67` both pass
`-fno-strict-aliasing` (deliberate, upstream-documented), and
`deps/highway.ts:49` explicitly re-adds `-fmath-errno`. This matters for F8.

### F5. The ONLY non-LTO'd C/C++ is a deliberate, documented LTO-miscompile workaround (and it is already optimal)

The linker map shows brotli's entire `.c` set (~0.48 MB `.text` + 0.41 MB
`.rodata`) and zlib-ng's SIMD kernels (~55 KB) as native (non-bitcode) objects.
Both are explicit: `deps/brotli.ts:56-63` ("LTO miscompile ... BrotliDecompress
... -fno-lto sidesteps it") and `deps/zlib.ts:57-59,213` ("mirrors cmake's
NOLTOFLAG: ThinLTO can hoist ... SIGILL"). **Both still get `-ffunction-sections`**
(the map shows `.text.CreateBackwardReferencesDH5` etc., not a monolithic
`.text`). Correct by design. DEAD.

### F6. The Windows clang-cl cc1 line (bun's exact windows release flag set)

`clang-21 --driver-mode=cl -### /c -march=haswell /MT /U_DLL -DNDEBUG /O2 /Z7
/EHs-c- /clang:-fno-c++-static-destructors /GR- /Oy- /Gy /Gw /GF /GA -flto=thin
-fno-split-lto-unit /std:c++23preview --target=x86_64-pc-windows-msvc` produced:

```
-O3 -emit-llvm-bc -flto=thin -flto-unit -mrelocation-model pic -pic-level 2
-mframe-pointer=none -relaxed-aliasing -fms-volatile -funwind-tables=2
-target-cpu haswell -flto-visibility-public-std -fno-rtti-data
-stack-protector 2 -ffunction-sections -fdata-sections -ftls-model=local-exec
-fc++-static-destructors=none -faddrsig
```

Every divergence from the Linux line, dispositioned:

| windows cc1 token | status |
|---|---|
| `-stack-protector 2` | the /GS finding. ALREADY CLAIMED (1.45 MB, SYNTHESIS2 row 1). I independently confirm it from the driver AND that oven-sh/WebKit's own cmake sets no stack-protector flag (so clang-cl's default reaches the WebKit half too — the 2-PR split in row 1 is correct). |
| `-funwind-tables=2` | Win64 SEH, mandatory. SYNTHESIS2 already closed this book (1.19 MiB). |
| **`-relaxed-aliasing`** | **NEW. clang-cl defaults to `-fno-strict-aliasing`** (MSVC compat). Linux is strict. → proposal P2. |
| **`-mrelocation-model pic` + lld-link `/dynamicbase` default** | **NEW. The Windows binary is ASLR'd + carries `.reloc`; Linux is `ET_EXEC` with ZERO image ASLR.** → proposal P1. |
| `-mframe-pointer=none` | `/Oy-` is an x64 no-op; Windows OMITS frame pointers. Already w2-windows-delta/P3 (stale comment, 0 B). |
| `-fno-rtti-data` (from `/GR-`) | I verified at the IR level: a polymorphic hierarchy under `/GR-` emits **0 `??_R*` RTTI objects**, same as `-fno-rtti`. Size-equivalent. DEAD. |
| `-target-cpu haswell` | **`-march=haswell` IS honored by clang-cl on x64.** (Important negative: I suspected a /GS--twin "silently ignored flag" here because the windows-arm64 entry in flags.ts uses the `/clang:` prefix and x64 does not. It is fine.) |
| `-faddrsig` | present on COFF → `/OPT:SAFEICF` is NOT running blind. Confirms w2. |
| `-flto-visibility-public-std` | windows-only; std:: vtables stay WPD-public. Ceiling: the whole binary has only 208 surviving vtables (22,792 B). DEAD. |
| `/guard:cf`, `/Qspectre`, `/sdl`, `/ZH`, `/RTC*`, `/hotpatch` | **ALL absent from the cc1 line.** clang-cl defaults every one OFF. DEAD. |
| `-fms-volatile`, `-fno-use-cxa-atexit`, `-fdelayed-template-parsing`, `-gcodeview` | 0 bytes / not size-relevant. |

### F7. WebKit itself forces `-fno-strict-aliasing` on ALL platforms

`oven-sh/WebKit @ c9ad5813` `Source/cmake/WebKitCompilerFlags.cmake:192-197`:
```
# FIXME: Remove once the strict-aliasing violations exposed by 315506@main are fixed.
# Enabling strict aliasing (the compiler default at -O2) miscompiles type-punning code
WEBKIT_APPEND_GLOBAL_COMPILER_FLAGS(-fno-strict-aliasing)
```
Consequence: (a) the 17+ MB JSC prebuilt is relaxed-aliasing on BOTH platforms —
there is no JSC parity gap and flipping it is a documented miscompile; (b) my
strict-aliasing finding (P2) applies ONLY to bun's own C++ + 17 of the 19 direct
deps. This is a material CORRECTION that shrinks P2; I state it up front rather
than let a skeptic find it. (Also a lead for w3-webkit-build-options.)

### F8. The `-rdynamic` / `.dynsym`-is-24-KB question (brief item) — fully answered

`flags.ts:1330-1339` passes `-Wl,-Bsymbolic-functions -rdynamic
--dynamic-list=src/symbols.dyn --version-script=src/linker.lds`. The version
script is `BUN_1.2 { global: napi*; node_api_*; node_module_register; uv_*
(~290 names); extern "C++" { v8::*; node::*; }; local: *; }` plus the
572-symbol `symbols.dyn`. lld assigns `VER_NDX_LOCAL` to everything matching
`local: *`, which makes `computeBinding()` return `STB_LOCAL`, which excludes
the symbol from `.dynsym` AND from the `--gc-sections` root set AND from
ICF's address-significant set. **So `-rdynamic` is fully neutered by the
version script**, and the 24,288-byte `.dynsym` (1,012 entries) is EXACTLY the
intended NAPI/uv/v8/node ABI surface + the glibc UNDEFs. 0 removable bytes.

### F9. The `.symtab` residual is NOT new money (avoided a 41.6 KB double-count)

The shipped canary (`1.4.0-canary.1+eba370b69`) AND the official 1.3.14 both
still carry a 1,011-symbol `.symtab`+`.strtab` (41,632 B) + `.comment` (276 B) +
`.note.stapsdt` (232 B, from libstdc++'s `__cxa_throw`/`begin_catch`/`rethrow`
STAP probes — which is also the answer to the brief's "~3 exception symbols
leak; WHICH TU": libstdc++'s `eh_throw.cc`/`eh_catch.cc`, not any bun TU).
`strip --strip-all` on `bun-profile` gives 0 symbols, so the residual is the
pre-fix 3-flag strip spelling. **This is exactly commit `6f5ef8a6` (2026-07-02,
"build: fix strip flag downgrade, drop legacy .hash") = the orchestrator's
PR #33224 = the already-banked "-56.7 KB linux" in size-facts.** After it, only
~656 B of non-loadable cruft remains. `llvm-strip --strip-sections` would remove
the 2,432 B of section headers too but **`src/exe_format/elf.rs:289-348` moves
the section-header tail during `bun build --compile` → the shdr table is
load-bearing. Do not strip-sections.**

---

## proposals

### P1: windows-fixed-no-reloc — drop the PE base-relocation table
- **id:** `w3-cppflags/P1-windows-fixed`
- **saving_mb:** **0.63 (W)**, band 0.55–0.72. **Windows-only; linux 0.**
  - **Derivation (from the canary, by ADDRESS, FP-controlled):**
    `ptrcensus2.py` scanned every 8-byte-aligned slot of the canary's
    `.rodata`/`.data`/`.data.rel.ro`/`.{init,fini}_array` for values landing in
    the image's VA range `[0x200238, 0x4D0F2E8)`:
    **323,932** absolute pointers (280 K into `.text` = function pointers;
    40 K into data).
    **False-positive control:** the 11,577,652-byte ICU data blob
    (`libicudata.a(icudt75l_dat.o)` at VMA `0x3B8D70`, which contains ZERO
    pointers by construction) scored **39 hits in 1,447,206 slots = 0.0027%**;
    the implied FP across the non-ICU slots is ~34. The count is real.
    A `/DYNAMICBASE` PE needs one 2-byte `IMAGE_REL_BASED_DIR64` per such slot,
    plus an 8-byte header per 4 KB page with a reloc:
    `323,932 × 2 + ~16 KB ≈ 664 KB = 0.63 MB`.
    w2-windows-delta's .rdata transfer factor is 1.005×, so the count transfers.
  - **VERIFY FIRST (10 s, whoever holds the real `bun.exe`):**
    `llvm-readobj --sections bun.exe | grep -A4 '\.reloc'` — that is the exact
    number. **w2-windows-delta never reported `.reloc`; this is the one number
    in my report I could not read off a real artifact.**
  - **The spelling + the "accidental default" claim are BOTH confirmed from
    lld-link's own `/help` (the /GS- lesson: never assume):**
    `/dynamicbase  Enable ASLR (default unless /fixed)` and
    `/fixed        Disable base relocations`. lld's own docs say it: ASLR +
    `.reloc` is a linker DEFAULT, and `flags.ts` sets neither `/fixed` nor
    `/dynamicbase`. Nobody ever chose it.
- **confidence:** HIGH on the mechanism, the pointer count, and the spelling;
  MEDIUM on the final MB until the 10-second read above is done.
- **perf:** **neutral** (strictly: a tiny one-time *improvement* — the loader
  never rebases an EXE loaded at its preferred base, so `.reloc` is 0.63 MB
  that is mapped and never read; with `/FIXED` it is not even on disk).
- **risk / regression (state it loudly):** **removes ASLR from `bun.exe` AND
  from every `bun build --compile` output built from it.** The parity argument
  is *exactly* /GS-'s: the Linux flagship is `ET_EXEC` (`flags.ts:1243-1246:
  "No PIE (we don't need ASLR; simpler codegen)"`) and has had **zero image
  ASLR since forever** — including every Linux `--compile` output. Nobody ever
  *chose* ASLR on Windows; lld-link's `/dynamicbase` default did. BUT: ASLR is
  a materially stronger mitigation than a stack canary, `bun.exe` is a
  network-facing server, EDR/BinSkim will flag a non-ASLR PE, and "Mandatory
  ASLR" (Exploit Protection) users lose nothing but see a relocs-stripped
  image. **This needs an explicit Jarred/Dylan sign-off and I expect it may be
  declined. Windows is already solved without it (SYNTHESIS2). File it as
  Tier-C.** Safety checked: `src/exe_format/pe.rs` never reads/writes the
  base-reloc data directory, so `--compile` is unaffected.
- **windows:** yes (windows-ONLY).
- **files / change:** `scripts/build/flags.ts` — add `"/FIXED"` to the
  `c.windows && c.release` linker block at lines ~990-1021 (next to
  `/OPT:REF`). One token. lld-link's `/fixed` sets `dynamicBase=false` and
  omits `.reloc` + sets `IMAGE_FILE_RELOCS_STRIPPED`.
- **effort:** trivial.
- **relink_only:** **YES — minutes.** Purely a link-time decision.

### P2: windows-strict-aliasing-parity — a /GS--class accidental clang-cl default
- **id:** `w3-cppflags/P2-win-strict-aliasing`
- **saving_mb:** **0.00 banked (unknown sign).** I refuse to invent a number.
  TBAA's two size effects pull opposite ways (more dead-load elimination →
  smaller; more vectorization license → bigger). **This is a PERF-PARITY BUG
  REPORT, not a size row.** Per the orchestrator's update, the maintainers are
  doing perf validation; the ONE windows ThinLTO relink they will already be
  doing for /GS- answers this for free.
- **confidence:** HIGH that the divergence is real and accidental.
  - `clang-21 --driver-mode=cl -### /c /O2 t.cpp --target=x86_64-pc-windows-msvc`
    (NO bun flags) → `-relaxed-aliasing`. Bare `clang++ -### -c -O3 t.cpp` →
    no `-relaxed-aliasing`. It is a pure driver-default divergence.
  - The fix IS honored (unlike /GS, where `-fno-stack-protector` is silently
    ignored): with `-fstrict-aliasing` OR `/clang:-fstrict-aliasing`, the cc1
    `-relaxed-aliasing` disappears, **0 warnings**, both spellings, clang-cl 21.
- **perf:** **IMPROVEMENT.** Strict aliasing is strictly more optimizer
  freedom; it never produces worse code.
- **risk / regression:** Strict-aliasing UB becomes live. **Bounded tightly:**
  (a) the SAME source is compiled strict-aliasing on Linux TODAY and ships
  green (F1's cc1 line), so bun's own C++ + the deps are already proven under
  clang's TBAA; (b) `boringssl` and `tinycc` explicitly carry their own
  `-fno-strict-aliasing` (`deps/boringssl.ts:64`, `deps/tinycc.ts:67`) which
  WINS over a global flag (F4's last-wins ordering) — they stay relaxed;
  (c) WebKit is OUT OF SCOPE — its own cmake appends `-fno-strict-aliasing`
  with a "miscompiles type-punning code" FIXME (F7). **The one real gap:** the
  Windows-ONLY TUs (`src/jsc/bindings/windows/*`, libuv) have never been
  compiled strict. Audit them or exclude them with a per-file override.
- **windows:** yes (windows-only; linux already strict).
- **files / change:** `scripts/build/flags.ts` globalFlags:
  `{ flag: "-fstrict-aliasing", when: c => c.windows, desc: "clang-cl defaults to -fno-strict-aliasing (MSVC compat); match the linux clang default (strict/TBAA). boringssl + tinycc opt back out via their own spec.cflags." }`
- **effort:** small.
- **relink_only:** NO (it changes every Windows TU's bitcode).

### P3: below-noise-floor hygiene bundle (~5 KB total; land only as drive-bys)
- **id:** `w3-cppflags/P3-hygiene`  — **saving_mb: ~0.005**. perf neutral, no regression, yes windows (partially), effort trivial.
- (a) Post-#33224, `.comment` (276 B) + `.note.stapsdt` (232 B) + a smaller
  `.shstrtab` (148 B) = **656 B** still survive `strip --strip-all`. Either add
  `-R .comment -R .note.stapsdt` to `stripFlags` next to the existing `-R
  .eh_frame` trio, or add `-fno-ident` to `globalFlags` (unix). **Do NOT add
  `--strip-sections`** (F9: `--compile` relocates the shdr tail).
- (b) `.bun_err` is a 2,788-byte all-zero PROGBITS section in the canary that
  does not exist in 1.3.14 — a newly-added named section that should be emitted
  with `@nobits` (the exact B6 technique) before it bakes into a release.
- (c) `source.ts:1506`: `picFlags` adds `-fno-pic -fno-pie` for direct deps on
  **darwin only**. On Linux the direct deps compile at the driver's `-fPIE`
  default; harmless for the LTO'd ones (lld's `-no-pie` link forces
  `Reloc::Static` at LTO codegen regardless), but the ~0.55 MB of deliberately
  non-LTO brotli/zlib-ng kernels (F5) are native `-fPIE` objects in a `-no-pie`
  executable: each RIP-relative `lea` is 2 B wider than a `mov $imm32` and
  cannot be relaxed. ~1-4 KB. Mirror the darwin branch: `else if (cfg.linux &&
  cfg.abi !== "android") picFlags.push("-fno-pic","-fno-pie")`.

### IMPLEMENTATION NOTES on EXISTING rows (no new MB; prevents two landing bugs)
- **SYNTHESIS2 row B6** (`wtf-config-sections-to-nobits`, 0.032 MB) cites only
  `WTFConfig.cpp:84` but its 32 KB is TWO separate 16 KB sections —
  `__DATA,__wtf_config` (that file) AND **`__DATA,__jsc_opcodes`**, which lives
  in JSC's LLInt (`Source/JavaScriptCore/llint/` in oven-sh/WebKit). I verified
  BOTH are **100% zero in the shipped file** (`dd | tr -d '\0' | wc -c` → 0 for
  each), so both are valid `@nobits` candidates. **As written, B6 lands half.**
- **SYNTHESIS2 row 1** (/GS-): independently confirmed — `-stack-protector 2`
  is on bun's real clang-cl cc1 line, AND `WebKitCompilerFlags.cmake` sets no
  stack-protector flag of its own, so the WebKit half also receives clang-cl's
  default. The "two independently-landable one-line PRs" design is correct.

---

## dead_ends (the exhaustive answered matrix the brief demanded)

Per-flag: (a) the LINUX clang driver default, (b) the WINDOWS clang-cl driver
default, (c) what `flags.ts` sets, (d) the deps, (e) the measured verdict.

| flag | linux default | clang-cl default | flags.ts | verdict |
|---|---|---|---|---|
| `-fno-rtti` | RTTI ON | ON | `-fno-rtti` (unix) + `/GR-` (win) | DEAD. `_ZTI+_ZTS` by ADDRESS = **34,539 B**, all ICU/libstdc++ (== GT). `/GR-`→`-fno-rtti-data` verified size-equivalent (0 `??_R*`). |
| `-fno-exceptions` | ON | ON | `-fno-exceptions` + `/EHs-c-` | DEAD. The 3 leaking symbols are libstdc++.a's `__cxa_throw`/`__cxa_begin_catch`/`__cxa_rethrow` (eh_throw.cc/eh_catch.cc), proven by the `.note.stapsdt` STAP probes pointing into them. Not a bun TU. |
| `-fno-unwind-tables` + `-fno-asynchronous-unwind-tables` | BOTH ON (x86-64) | `-funwind-tables=2` forced | BOTH set (unix). Win64: mandatory SEH. | DEAD. Shipped `.eh_frame` = **0 bytes** (confirmed by `readelf -S`). bun-profile's 806 KB of `.eh_frame` is from the prebuilt WebKit + libstdc++ and is removed by the existing `stripFlags -R .eh_frame` + `-Wl,--no-eh-frame-hdr` pair. Fully handled. |
| `-fvisibility=hidden` + `-fvisibility-inlines-hidden` | default vis | N/A on COFF | set (unix) | DEAD. ✓ |
| `-rdynamic` / `--dynamic-list` / `--version-script` | — | `/DEF:` | all three | DEAD. F8: `.dynsym` = 24,288 B = the exact intended NAPI ABI. The version script's `local: *` neuters `-rdynamic`. 0 B. |
| `-fno-ident` | ident ON (`.comment`) | ON | not set | DEAD: 276 B (canary), non-allocated. P3a. |
| `-fmerge-all-constants` | `-fmerge-constants` | same | not set | DEAD / **DOUBLE-COUNT HAZARD**. lld ≥13 ICF already folds identical read-only sections; the residual (address-significant identical `.rodata.*`) is EXACTLY the population `--icf=all` folds, and GT#2's **-0.250 MB is MEASURED on today's binary**. Claiming `-fmerge-all-constants` on top would double-count. |
| `-fno-plt` | PLT used | — | not set | DEAD. `.plt` = 5,904 B (368 glibc slots). `-fno-plt` makes each call 1 B BIGGER. |
| `-fno-semantic-interposition` | interposable (only under `-fpic`) | N/A | set (linux) | DEAD. Moot with `-fno-pic` / `Reloc::Static` anyway. |
| `-ffunction-sections -fdata-sections` | OFF | OFF | set (unix) + `/Gy /Gw` (win) | DEAD. ✓ AND verified for the NON-LTO deps (F5). |
| `-fno-math-errno` | `-fmath-errno` ON | ON | not set (`highway.ts` even re-adds `-fmath-errno`) | DEAD. The one instruction it inlines (`sqrtsd`) is already inlined: **`sqrt`/`sqrtf` are NOT in the canary's 368-entry PLT**. The remaining libm imports (sin/cos/tan/pow/exp/log/...) have no x86 instruction, so the flag saves nothing. |
| `-fstack-clash-protection` | OFF (upstream clang) | — | not set | DEAD. **0** probe loops in 54.8 MB of `.text` (byte scan). |
| `-ftrivial-auto-var-init` | `uninitialized` | `uninitialized` | not set | DEAD. 39 coincidental 0xAA×8 hits = noise. Confirmed absent. |
| `-fstack-protector` | OFF (upstream clang) | **`-stack-protector 2` (/GS)** | not set (linux) | LINUX DEAD (F2: the 291/399 are the GCC runtime). WINDOWS = the already-claimed /GS- row 1. |
| `-fcf-protection` | OFF (upstream clang) | OFF | not set | DEAD. F2: 1,633 `endbr64` = 6.5 KB, all the GCC-built runtime. GT#7 refined, not contradicted. |
| `-mno-red-zone` | red zone USED | N/A | not set | DEAD. Setting it GROWS code. The default is correct. |
| `-fno-jump-tables` | jump tables USED | USED | not set | DEAD. Jump tables are the smaller AND faster form; the flag exists for CFI/retpoline, which bun does not use. |
| `-fno-threadsafe-statics` | guards ON | `/Zc:threadSafeInit` ON | not set | DEAD. Only **157** `guard variable for` symbols in the whole canary → ~3 KB. And it is a CORRECTNESS hazard in a heavily-threaded runtime. |
| `-fvirtual-function-elimination` | OFF | OFF | not set | DEAD. Only **208** vtables (22,792 B by address) survive full LTO; the rest is ICU/libstdc++ (NATIVE objects VFE cannot reach) and is owned by Tier-B row B3. Plus VFE is an ODR violation against the non-LTO libstdc++.a. |
| `-fwhole-program-vtables` / `--lto-whole-program-visibility` | — | — | compile-side set (unix+lto); lld's `-whole-program-visibility` is **darwin-only** (flags.ts:873) | DEAD for size. WPD devirtualizes (perf) but never DELETES a virtual unless VFE is also on. And adding the lld flag on linux full-LTO would be unsound against the native libstdc++.a vtables. |
| PIE / `-z pack-relative-relocs` (RELR) | `-fPIE -pie` (Ubuntu clang) | `/dynamicbase` | **`-fno-pic -fno-pie -Wl,-no-pie`** explicit | DEAD on linux. The canary is `ET_EXEC`; `.rela.dyn` = 2,736 B. `flags.ts:1258-1261` already documents why RELR is pointless. **The Windows mirror of this asymmetry is my P1.** |
| `-fno-c++-static-destructors` | dtors registered | registered | set BOTH | ✓ (cc1: `-fc++-static-destructors=none` on both). |
| `-mconstructor-aliases` | ON | ON | driver default | ✓ (verified: `v8::HandleScope::HandleScope` C1/C2 share one address in the canary). |
| `/guard:cf`, `/Qspectre`, `/sdl`, `/ZH:SHA_256`, `/RTC*`, `/hotpatch`, `/Zc:dllexportInlines-` | N/A | ALL OFF | not set | DEAD. None appear in the real cc1 line (F6). The w2-windows-delta "nothing else" claim holds for THIS list; it missed `-relaxed-aliasing` and the relocation model. |
| `-march=haswell` on clang-cl x64 | — | — | set bare (no `/clang:` prefix) | **HONORED** (`-target-cpu haswell` in the cc1). Important negative: this was my strongest /GS--twin candidate (a silently-ignored flag) and it is NOT one. |
| `-faddrsig` on COFF | — | ON for lld | not set on windows | ON by default; `/OPT:SAFEICF` is not running blind. Confirms w2. |
| `--strip-sections` | — | — | not set | DEAD. `src/exe_format/elf.rs:289-348` moves the non-ALLOC tail incl. the shdr table during `bun build --compile`. Would brick `--compile`. |
| "a nested-cmake dep's own CMakeLists appends a flag" | — | — | — | **DOES NOT EXIST.** Zero `nested-cmake` deps in the release (F3). |

**Methodology notes I followed (and that a skeptic should check):** all nm-based
byte counts (`_ZTV`, `_ZTI+_ZTS`) were summed **by ADDRESS** (`awk '{a[$1]=$2}'`)
per SYNTHESIS2's warning; the `call` counts are exact rel32-decoded targets, not
string greps; the `.reloc` pointer census has a built-in false-positive control.

---

## overlaps

- **w3-webkit-build-options:** owns the ONE flag regime outside my lane (the
  WebKit prebuilt). Handing them two leads: (1) `WebKitCompilerFlags.cmake:
  192-197` forces `-fno-strict-aliasing` everywhere with an upstream FIXME;
  (2) the B6 implementation note (`__DATA,__jsc_opcodes` lives in their repo).
- **w3-machine-outliner:** `-fmerge-functions` / `-mllvm -enable-merge-functions`
  is theirs. From my cc1 dump: MergeFunctions is NOT on, `-mconstructor-aliases`
  IS. For the LTO link the spelling is `-Wl,-mllvm,-<opt>` (same mechanism that
  already carries `-whole-program-visibility` on darwin at `flags.ts:873`) —
  a RELINK-ONLY experiment.
- **w3-binary-archaeology:** the `.rodata` duplicate-blob / inter-symbol-gap
  scan; my `-fmerge-all-constants` analysis defers its residual to them and to
  GT#2's measured icf=all.
- **w3-ci-pipeline-audit:** the `.bun` 16 KB placeholder and the strip step
  (F9 gives them the exact PR-#33224 attribution so neither of us double-counts
  the 41.6 KB).
- **w3-dep-internals:** I classified EVERY dep's build kind and flag ordering
  (F3/F4) — their job is the per-dep UPSTREAM feature knobs, not the flags.
  Useful fact for them: `spec.cflags` always wins (`source.ts:1512`).
- **w3-lto-pipeline:** the `-O2`-at-link / `--lto-CGO` level is theirs; F1's cc1
  dump confirms the compile side is fully intentional, so the LTO over-inlining
  they are chasing is NOT caused by a stray compile flag.
- **w2-windows-delta / SYNTHESIS2 row 1:** P1 and P2 are the two entries their
  "after /GS-, nothing else" sweep missed. They are additive with /GS-.

---

## SCOREBOARD (honest)

| | new linux MB | new windows MB |
|---|---|---|
| proposals I am willing to bank | **0.00** | **0.00** (P1 is Tier-C policy-gated) |
| Tier-C, if the maintainers say yes | 0 | **~0.63** (P1) |
| perf-parity bugs found (size unknown) | 0 | 1 (P2) |
| double-counts prevented | 0.040 (F9) + the `-fmerge-all-constants`/icf=all overlap |
| GT corrections | GT#7 refined (F2); B6 impl note; w2-windows "nothing else" corrected |

The real deliverable here is the negative: **the Linux C/C++ compile-flag space
is now closed at the cc1 level, per flag, with the evidence to prove it.** The
maintainers' 1 MB Linux breakthrough is not in `flags.ts`. The two real /GS--
class accidental driver defaults that remained were both on Windows, and Windows
is already solved.
