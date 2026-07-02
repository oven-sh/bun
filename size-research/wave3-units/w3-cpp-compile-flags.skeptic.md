# SKEPTIC — w3-cpp-compile-flags

Every number below was independently re-derived from the real artifacts on disk.
Tooling: the exact pinned major (LLVM 21; I used `clang-21` 21.1.8, CI used
21.1.5 per the canary's own `.comment`). Scratch: `/tmp/skep/{reloc,census_lin}.py`.

---

## VERDICTS

### VERDICT `w3-cppflags/P1-windows-fixed`: **REFUTED** — saving is 0.173 MB, not 0.63 MB (3.63x over, outside the stated 0.55-0.72 band); the census methodology is provably broken; the "I could not read this off a real artifact" claim is false (the real `bun.exe` was on disk, left by TWO other units); it re-opens a question wave 2 already CLOSED with the correct number; and it is a DUPLICATE of a wave-3 sibling proposal that already has the correct number. Net new MB: **0.00**.

**(1) The REAL number, read off the REAL shipped `bun.exe`.**
The report said its 0.63 MB was "the one number in my report I could not read off
a real artifact" and asked whoever holds `bun.exe` to run `llvm-readobj --sections`.
That artifact was on disk all along:
`/tmp/w3-ci-pipeline-audit/rcanary/bun-windows-x64/bun.exe` (the canary) and
`/tmp/w3-ci-pipeline-audit/r1314/bun-windows-x64/bun.exe` (1.3.14). I ran the
exact command the report asked for:

```
canary .reloc : VirtualSize 0x2C464 = 181,348 B  RawDataSize = 181,760 B = 0.1733 MiB
1.3.14 .reloc : VirtualSize 0x2DD98 = 187,800 B  RawDataSize = 187,904 B
BaseRelocationTableSize = 0x2C464   (same number; that IS the whole table)
DllCharacteristics today: DYNAMIC_BASE | HIGH_ENTROPY_VA | NX_COMPAT
```

I then PARSED the canary's `.reloc` byte-for-byte (`/tmp/skep/reloc.py`):
**705 blocks, 87,484 real `IMAGE_REL_BASED_DIR64` entries** (+370 ABS padding);
705*8 + 87,854*2 = 181,348. Exact. `/FILEALIGN:0x200` is already set
(flags.ts:1007), so dropping `.reloc` saves exactly its 512-aligned
RawDataSize: **181,760 B = 0.173 MB**. Stable across two releases (~0.17-0.18).
The report predicted **~324,000 entries / 664 KB**. **3.7x over.**

**(2) WHY the census over-predicts by 3.7x — proven, not hand-waved.**
I reproduced the report's Linux pointer census exactly (its 5 sections, its VA
window `[0x200238, 0x4D0F2E8)` which I confirmed is `.interp`-start to
`.bss`-end): I get **324,005 hits (report: 323,932); 281,840 into .text,
42,165 into data** — a byte-faithful reproduction. Then the new fact:

> **275,655 of the 281,840 ".text-pointing function pointers" (97.8%) sit in
> RUNS of >=3 consecutive 8-byte slots all pointing into .text.**

Those are not function pointers. They are **LLVM switch jump tables.** Proven
with bun's exact pinned compiler on bun's exact flags:

```
LINUX   (bunOnlyFlags: -fno-pic -fno-pie => Reloc::Static):
          jmpq *.LJTI0_0(,%rdi,8)      .LJTI0_0: .quad .LBB0_2 / .quad .LBB0_3 ...
          => 8-BYTE ABSOLUTE code pointers in .rodata. One per case label.
WINDOWS (clang-cl /O2 => -mrelocation-model pic  -- the report's OWN F6 line!):
          lea rax,[rip+.LJTI0_0]; movsxd rcx,[rax+4*rcx]; add rcx,rax; jmp rcx
          .LJTI0_0: .long .LBB0_2-.LJTI0_0 ...
          => 4-BYTE self-relative label differences. ZERO base relocations.
```

~276 K of the 324 K counted Linux slots simply do not exist as relocatable
pointers in the Windows PE. The genuine absolute data pointers (vtables, Rust
`&'static str` fat pointers, HashTableValue arrays, init lists) are the
residual — and the real bun.exe says that residual is **87,484**.

The bitter irony: the report's own F6 dead_ends table has BOTH halves of the
refutation — a `-mrelocation-model pic` row (used to MOTIVATE P1) and a
`-fno-jump-tables` row ("Jump tables USED") — and never connected them.

**(3) The "w2-windows-delta never reported `.reloc`" claim is FALSE.**
`/tmp/wf2/out/w2-windows-delta.report.md`:
- line 48:  `.reloc | 181,760 | 0.173 | ASLR base relocs, DISCARDABLE`
- line 180: `/fixed / /dynamicbase:no | not set; ASLR (DYNAMIC_BASE + HIGH_ENTROPY_VA) ON`
- F7 is TITLED "the `.reloc` / ASLR question **(closed)**": "`/fixed` would
  remove it + ASLR; **0.17 MiB is not worth an ASLR removal. Closed.**"
- its closure #3: "**.reloc / disabling ASLR.** 181,760 B measured. ... **No.**"

So the 10-second verification the report deferred to a future reader had
already been done, in wave 2, with the correct answer, AND a negative
disposition. The report's claim that P1 is one of "the two entries
[w2-windows-delta's] sweep missed" is half false: only P2 is new.

**(4) DUPLICATE within wave 3.** Sibling `w3-ci-pipeline-audit` proposal **P4**
(`windows-fixed-base-drop-reloc`, its report lines 302-332) is the IDENTICAL
one-token `/FIXED` in the IDENTICAL flags.ts block — derived FROM the real
`bun.exe`, at the CORRECT **0.173 MB**, with a cleaner risk section. Credit ONCE,
to them.

**What P1 got right (so the synthesizer doesn't over-correct):** `/fixed` and
`/dynamicbase` are genuinely absent from flags.ts (verified); lld-link's `/help`
text is quoted verbatim ("`/fixed  Disable base relocations`", "`/dynamicbase
Enable ASLR (default unless /fixed)`" — I re-ran it); `src/exe_format/pe.rs`
never touches `data_directories[BASERELOC]` — the only directory it writes is
`IMAGE_DIRECTORY_ENTRY_SECURITY` at pe.rs:422/472/553/695, so `--compile` is
unaffected (verified); `.reloc` IS `IMAGE_SCN_MEM_DISCARDABLE` so the perf
argument is sound. The one-token change is real. It is just worth 0.17 MB,
already claimed correctly by a sibling, and already declined once by wave 2.

**Regression BOTH /FIXED proposals understate (for whoever carries
w3-ci-pipeline-audit/P4):** Windows Exploit Protection "Force randomization for
images (Mandatory ASLR)" has a "Do not allow stripped images" sub-policy
(`PROCESS_MITIGATION_ASLR_POLICY.RequireRelocSection`). With BOTH on, an image
with `IMAGE_FILE_RELOCS_STRIPPED` (which `/fixed` sets) **fails to LOAD**, not
merely fails to rebase. Both units' "still loads at the preferred base" is true
only for the default sub-policy. Enterprise-locked-down deployments of `bun.exe`
AND of every Windows `bun build --compile` output are the exposure.

---

### VERDICT `w3-cppflags/P2-win-strict-aliasing`: **CONFIRMED** — exactly as the report framed it: a REAL, accidental, /GS--class clang-cl driver divergence, correctly banked at **0.00 MB** (a perf-parity bug report, not a size row). My testing is STRONGER than the report's. I found one risk the report MISSED (brotli) and one it listed that is ALREADY CLOSED in the repo (libuv).

**Independent reproduction (real pinned compiler):**
- bun's EXACT windows release flag set through `clang-21 --driver-mode=cl -###`
  → cc1 has `-relaxed-aliasing` (plus `-stack-protector 2`, `-fno-rtti-data`,
  `-funwind-tables=2`, `-mrelocation-model pic`, `-target-cpu haswell`).
  Reproduces F6.
- Bare `clang++-21 -O3` (Linux) → NO `-relaxed-aliasing`. TBAA is on. Linux
  and Windows genuinely diverge, and nobody chose it.
- **The /GS- trap does NOT apply — proven by REAL compilation, not `-###`:**
  ```
  clang-cl /O2 -fstrict-aliasing    t.cpp   -> rc=0, ZERO warnings, -relaxed-aliasing GONE
  clang-cl /O2 -fmath-errno         t.cpp   -> "unknown argument ignored in clang-cl"
  clang-cl /O2 -fno-stack-protector t.cpp   -> "unknown argument ignored in clang-cl"
  ```
  The three-way contrast is decisive: `-fstrict-aliasing` IS a CLOption and is
  honored; the /GS--class silently-ignored failure mode is real for OTHER `-f`
  flags (and is documented in-repo at `deps/highway.ts:46`) but NOT this one.
  `/clang:-fstrict-aliasing` also works (tested).

**The report's F4 grep was INCOMPLETE — in a direction that makes P2 SAFER.**
F4 lists the deps with their own aliasing flags as `boringssl.ts:64` and
`tinycc.ts:67` (the UNIX spellings). It MISSED:
- `deps/boringssl.ts:59`:  `"/clang:-fno-strict-aliasing"`  (windows branch)
- `deps/libuv.ts:66`:      `"/clang:-fno-strict-aliasing"`  (libuv is windows-only)

P2's stated "one real gap: libuv ... has never been compiled strict. Audit them"
is thus ALREADY CLOSED: libuv's `spec.cflags` opt-out is last-wins
(`source.ts:1512`, verified) and becomes live the moment the global flag lands.
Same for boringssl (the TLS stack). The residual truly-windows-only bun C++ is
`src/jsc/bindings/windows/` = 3 `rescle*` files (a PE resource editor; tiny,
cold, not aliasing-risky).

**Regression the report did NOT list — BROTLI.** `deps/brotli.ts:56-63`
documents an LTO miscompile — *"likely an alias-analysis issue around brotli's
ring-buffer copy hoisting"* — and fixes it with `-fno-lto` gated
`cfg.linux && cfg.x64 && !cfg.baseline`. So on WINDOWS, brotli IS ThinLTO'd
today, under relaxed aliasing. P2 flips it to strict + ThinLTO — the exact
combination whose Linux sibling the repo's own comment blames on alias analysis.
Cheap mitigation, same shape as libuv/boringssl: add
`"/clang:-fno-strict-aliasing"` to brotli's windows `spec.cflags` in the SAME PR.
One line. The report should have named this.

Also fine: the proposed `when: c => c.windows` placement in `globalFlags` is
correct (globalFlags reach bun's TUs AND all 19 direct deps; F3's "zero
`nested-cmake` deps in the release" is confirmed — only `webkit.ts`'s local dev
mode uses nested-cmake). NOT a wave-1/2 duplicate: SYNTHESIS2's "after /GS-,
nothing else" is scoped to the listed COMPILE-flag set; `-relaxed-aliasing` is
a genuine, new correction to it.

---

### VERDICT `w3-cppflags/P3-hygiene`: **CONFIRMED** (with one implementation-note correction on 3b) — correctly priced at ~0.005 MB, i.e. below the noise floor and correctly NOT banked.

- **P3a** ✓ byte-exact: `.comment` = 0x114 = **276 B** and `.note.stapsdt` =
  0xe8 = **232 B** (canary `readelf -S`), both non-allocated, both survive
  `--strip-all`. `stripFlags` (flags.ts:1432-1467) is `--strip-all` + the
  `-R .eh_frame/-eh_frame_hdr/-gcc_except_table` trio, nothing for `.comment`.
  And **F9 is correct and load-bearing**: the `--strip-all`-only spelling IS
  already landed in the repo (flags.ts:1434-1441, with the "Do not restore the
  extra flags" comment and the measured **41,080 B**) = PR #33224. The canary
  on disk is PRE-fix (it has a 25,104-B `.symtab`). Anyone claiming the
  `.symtab` as new money would double-count. F9 prevents that.
- **P3b** ✓ byte-exact and ✓ genuinely new to the canary: `.bun_err` is
  **2,788 B, 100% zero, PROGBITS, flags WA, align 2** in the canary and absent
  from 1.3.14 (both verified by `readelf -S` + a raw byte scan). **NEW FACT the
  report missed — it never identified the owner.** It is
  `src/bun_core/lib.rs:1146`:
  ```rust
  #[cfg_attr(any(target_os="linux",target_os="android"), unsafe(link_section=".bun_err"))]
  static __E: AtomicU16 = AtomicU16::new(0);
  ```
  — one 2-byte slot per `err!()` call site (2,788/2 = 1,394 ≈ the comment's
  "~1.3k call-site statics"; the align-2 matches). And the macro's OWN doc
  comment three lines up (**lib.rs:1133-1135**) says the whole point is that
  they "shrink and **land in `.bss` for free**". `#[link_section]` defeated the
  author's stated intent: Rust/LLVM emit an explicitly-sectioned zero-init
  static as `SHT_PROGBITS` unless the name begins with `.bss`. So:
  **CORRECTION to the report's "the exact B6 technique":** Rust has no
  `@nobits` attribute. The fix is renaming to `".bss.bun_err"` (LLVM's
  `getELFSectionTypeFromName` special-cases the `.bss`/`.tbss` prefixes to
  NOBITS). Caveat for the PR: lld's section-prefix rule folds `.bss.*` input
  sections into the output `.bss`, losing the author's "whole set on one page"
  clustering — a cold path by the author's own words, but state it. 2,788 B.
- **P3c** ✓: `picFlags` really is darwin-only (`source.ts:1507`), and
  `-fno-pic -fno-pie` lives in `bunOnlyFlags` (flags.ts:667), NOT `globalFlags`,
  so the LINUX direct deps do compile at the LLVM-21 driver's PIE default.
  The non-LTO population is real: brotli's `-fno-lto` is
  `cfg.linux && cfg.x64 && !cfg.baseline` (brotli.ts:62) and zlib-ng's SIMD
  kernels get per-file `-fno-lto` (zlib.ts:213). ~1-4 KB. Honest.

---

## The dead_ends matrix and F1-F9: **CONFIRMED** — this is the report's real deliverable and it holds.

I re-derived every `nm`-based number **BY ADDRESS** (`awk '{a[$1]=$2}'`) from
`/tmp/canary/nm-dem.txt`, and every one is EXACT:

| claim | report | my re-derivation | |
|---|---|---|---|
| `_ZTI+_ZTS` typeinfo by address | 34,539 B | **34,539 B / 1,068 addrs** | EXACT |
| `vtable for` by address | 208 / 22,792 B | **208 / 22,792 B** | EXACT |
| ...and 89% of them native | "all ICU/libstdc++" | 118 std + 59 icu_75 + 5 __gnu_cxx + 3 __cxxabiv1 = 185/208; only 19 JSC + 1 WTF are LTO-reachable | EXACT |
| `guard variable for` | 157 | **157** | EXACT |
| `.dynsym` | 24,288 B / 1,012 | **0x5ee0 = 24,288 B** | EXACT |
| `.rela.dyn` | 2,736 B | **0xab0 = 2,736 B** | EXACT |
| `.plt` | 5,904 B / 368 slots | **0x1710 = 5,904 B; .rela.plt/24 = 368** | EXACT |
| `sqrt`/`sqrtf` not imported | claimed | **0 UND sqrt* in dyn-syms**; the 37 UND libm names are exactly the no-x86-instruction transcendentals | EXACT |
| `.eh_frame` shipped | 0 B | absent from `readelf -S` | EXACT |
| lld `-whole-program-visibility` darwin-only | flags.ts:873 | **L873, `when: c.darwin && c.lto`** | EXACT |
| no RELR, `-z norelro`, version-script `local:*` | flags.ts:1253-1261, :1331 | all verified at those lines | EXACT |

**F1 (the Linux cc1 line): I INDEPENDENTLY REPRODUCED IT** from bun's exact
`globalFlags` + `cpuTargetFlags` + `bunOnlyFlags` with `clang++-21 -###`. Every
quoted token is present (`-O3 -emit-llvm-bc -flto=full -flto-unit
-mrelocation-model static -mframe-pointer=all -fforce-emit-vtables -fmath-errno
-mconstructor-aliases -target-cpu haswell -ffunction-sections -fdata-sections
-fvisibility=hidden -fvisibility-inlines-hidden -fno-rtti -vectorize-loops
-vectorize-slp -fwhole-program-vtables -fsplit-lto-unit
-fc++-static-destructors=none -faddrsig`), and every claimed-ABSENT token really
is absent (`-stack-protector`, `-fcf-protection`, `-ftrivial-auto-var-init`,
`-funwind-tables=N`, `-relaxed-aliasing`). The headline — **the Linux compile-
flag space is closed at the cc1 level** — rests on a correct reproduction.

**F2 / GT#7 refinement:** I did not re-run the 54-MB rel32 decode, but the
conclusion has three independent hard anchors I verified: (a) the cc1 line has
no `-stack-protector`/`-fcf-protection`; (b) `__stack_chk_fail` IS in the
canary's dynamic imports (count=1) so SOMETHING in the link uses the stack
protector; (c) the canary's `.comment` reads VERBATIM
"GCC: (Ubuntu 13.1.0-8ubuntu1~20.04.2)" — the Ubuntu-GCC-built static
libstdc++/libgcc, whose distro defaults are exactly
`-fstack-protector-strong -fcf-protection`. The refinement is sound.

**F3/F4 (flag regimes):** `grep -l nested-cmake scripts/build/deps/*.ts` →
only `webkit.ts` (its LOCAL dev mode). `source.ts:1512`'s
`[...baseFlags, ...picFlags, ...incFlags, ...defFlags, ...(spec.cflags??[])]`
last-wins ordering is exact. CONFIRMED — modulo the two MISSING rows of the F4
opt-out list noted under P2.

**F5:** `brotli.ts:56-63` and `zlib.ts:57-59,213` exact. One nuance the report
over-generalized: brotli's `-fno-lto` is `cfg.linux && cfg.x64 && !cfg.baseline`
ONLY — on windows and on linux-baseline, brotli IS LTO'd. Doesn't change F5's
verdict; it DOES matter for my P2 brotli warning above.

**F8:** `.dynsym` = 24,288 B / 1,012 entries, byte-exact; `src/linker.lds` is
the quoted `BUN_1.2 { global: ...; local: *; }`. CONFIRMED.

**F9:** correct and load-bearing (see P3a). One nit: the report's 41,632 B
differs from both the in-repo comment's 41,080 B and the canary's actual
`.symtab+.strtab` = 41,480 B. Irrelevant to its conclusion (0 new money).

**IMPLEMENTATION NOTES on B6 and /GS-:** BOTH CONFIRMED and valuable.
- B6: I byte-scanned the canary — `__DATA,__jsc_opcodes` (file off 0x4940000)
  AND `__DATA,__wtf_config` (0x4944000) are EACH 16,384 B and **100% zero**.
  SYNTHESIS2 row B6 as written (WTFConfig.cpp:84 only) lands half. Real.
- /GS- (SYNTHESIS2 row 1): `-stack-protector` (value 2) IS on the reproduced
  clang-cl cc1 line, independently confirming the wave-2 flagship.

**One soft spot in dead_ends (does not change the verdict):** the
`-fvirtual-function-elimination` row calls 22,792 B a "ceiling". It is a LOWER
bound on the vtable bytes, not a ceiling on the dead virtual BODIES VFE could
remove. The DEAD verdict survives anyway on two independent legs I verified:
(i) 185/208 surviving vtables are in NATIVE non-LTO objects (std/icu_75/
__gnu_cxx/__cxxabiv1) VFE cannot reach; (ii) VFE requires lld's
`--lto-whole-program-visibility`, which is `c.darwin && c.lto`-only in flags.ts
AND would be unsound on the Linux full-LTO link against the native libstdc++.a
vtables. Correct for the right reasons; the word "ceiling" should go.

---

## Wave-1/2 duplication and DISCARDED-list audit

- **P1 is a duplicate / re-open.** See its verdict: it re-opens
  w2-windows-delta F7 ("Closed", "No") AND duplicates w3-ci-pipeline-audit/P4.
  **It is NOT in SYNTHESIS2's DISCARDED list** because w2-windows-delta
  self-rejected it (0-banked) rather than proposing it — so SYNTHESIS2 never
  saw it. The synthesizer must not credit this bytes twice (P1 vs ci-audit/P4)
  and must surface that wave 2 already said no.
- **P2 is NOT a duplicate.** SYNTHESIS2's "the clang-cl divergent-default sweep
  — after /GS-, nothing else" is a CONFIRMED-ZERO entry scoped to the specific
  compile-flag list w2-windows-delta checked. `-relaxed-aliasing` is outside
  that list. P2 is a legitimate correction, and the report says so explicitly.
- **P3 is not a duplicate.** Nothing in either wave touches
  `.comment`/`.note.stapsdt`/`.bun_err`/direct-dep `picFlags`.
- **No DISCARDED item is re-opened.** I checked the report's dead_ends against
  SYNTHESIS2's DISCARDED + CONFIRMED-ZERO + perf-locked lists: `-fno-rtti`
  (34,539 B, all ICU/libstdc++) matches SYNTHESIS2's own CONFIRMED-ZERO line
  verbatim; `-fmerge-all-constants` correctly defers to GT#2's measured
  icf=all rather than double-counting; the report explicitly does NOT re-chase
  the GNU-runtime bytes (it attributes them to wave-1 B1).

---

## SCOREBOARD (corrected)

| | report claimed | after skeptic |
|---|---|---|
| new linux MB banked | 0.00 | **0.00** (confirmed) |
| new windows MB banked | 0.00 | **0.00** (confirmed) |
| Tier-C windows upside from THIS unit | ~0.63 (P1) | **0.00** — P1 REFUTED; the residual 0.173 MB belongs to `w3-ci-pipeline-audit/P4` (credit once), and wave 2 already dispositioned it "No" |
| perf-parity bugs (size unknown) | 1 (P2) | **1 (P2) — CONFIRMED, stronger** |
| double-counts prevented | F9 (41.6 KB) + merge-all-constants/icf=all | confirmed, PLUS the NEW P1/ci-audit-P4 double-count this skeptic caught |
| GT corrections | GT#7 refined; B6 note; w2-windows "nothing else" corrected | all three CONFIRMED |

The report's ONE quantified size claim was wrong by 3.63x AND a duplicate AND a
re-open. Everything else — the F1-F9 structural facts, the entire dead_ends
matrix, P2, P3, and both implementation notes — survives an adversarial pass,
most of it to the exact byte. The report's own headline was already honest:
its value is the NEGATIVE (the Linux compile-flag avenue is closed at the cc1
level), and that negative is now independently reproduced.

## credible NEW (non-duplicate) total MB for this unit: **0.00** (linux 0.00, windows 0.00)

(For the synthesizer: if P2's strict-aliasing parity turns out to shrink the
Windows binary when the maintainers do the /GS- relink, those bytes would be NEW
— but neither the unit nor I will guess the sign, and the unit correctly banked
it at 0.)
