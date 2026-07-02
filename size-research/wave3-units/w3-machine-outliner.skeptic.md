# SKEPTIC — w3-machine-outliner

Verification toolchain: LLVM 21.1.8 = the exact pinned version (`scripts/build/tools.ts:267`).
Every number below was re-derived by me, BY ADDRESS, from the REAL canary
(`/tmp/canary/bun-linux-x64-profile/bun-profile`, `.text` = `[0x16c4a00, 0x4b12d5a)`,
52.43 MiB, ELF type EXEC). Scratch: `/tmp/sk-mo/` (`census.py`, `census_fix.py`,
`ua.ll`, `lto/`, `MergeFunctions.cpp`).

---

## VERDICT MO-P1 (`w3-machine-outliner/mergefunc`, `-Wl,-mllvm,-enable-merge-functions`, 0.15-0.25 MB): CONFIRMED on mechanism, size, and perf — WEAKENED on novelty (0.00 NEW MB)

**It is a re-proposal of wave-1 unit 14's `14/mergefunc-lto`.** The report's summary
sentence — "Nothing here duplicates SYNTHESIS2's table or DISCARDED list: neither the
words 'machine outliner' nor `-enable-merge-functions` appears in either" — is FALSE by
omission: the brief says to read BOTH syntheses, and **wave-1's `SYNTHESIS.md:285-287`
"Duplicates" ledger already contains `14/mergefunc-lto ≈ 10/icf-all-keep-unique` with the
literal phrase "MergeFunctions' residual unique value: it is address-identity-safe *by
construction*".** That wave-1 row was merged into `10/icf-all-keep-unique`, which IS
SYNTHESIS2 Tier-A row 5 (0.250 MB, already banked). The brief's part (4) even hands the
unit wave-1's claim to "confirm or refute". So the byte population is ALREADY in the
inventory; this unit adds **zero new MB**. (The report's OVERLAPS section does get the
accounting right — "MUTUALLY EXCLUSIVE with row 5, credit ONCE" — only the "novel"
framing in the summary is wrong. Within wave 3 the coordination is clean: w3-lto-pipeline
`:475,:511` and w3-rust-codegen-flags `:354` explicitly HAND OFF these flags to this unit.)

What the unit DOES add is large and real: the evidence package that **unblocks** row 5 by
replacing its risky spelling. Row 5 today is "gated on a maintainer yes" with a
9+-site `callHostFunctionAsConstructor` audit, a 48-member `*Constructor::s_info`
distinct-address audit, and a `--keep-unique=<mangled>` to maintain. MO-P1 has none of
that. That is worth crediting as an UPGRADE to row 5, not as new bytes.

### Mechanism: CONFIRMED, independently, with the REAL link driver shape

The report's probe used bare `ld.lld-21`. bun's linux link is the CLANG++ DRIVER
(`compile.ts:173`: `${cxx} @$out.rsp $ldflags -o $out`) with lld via `--ld-path`
(`tools.ts:480`), so I re-ran the probe through `clang-21 -fuse-ld=lld -flto=full`:

```
BASE  (--icf=safe only)                     .text=1700 B  addresses-distinct=1
+ -Wl,-mllvm,-enable-merge-functions        .text= 693 B  addresses-distinct=1  <- PRESERVED
+ -Wl,-plugin-opt=-enable-merge-functions   .text= 693 B  (the alternate spelling also works)
```

`twinA`@0x201920 and `twinB`@0x201910 are DISTINCT addresses, each a 5-byte
`jmp <representative>`. Program output identical. **Both `-Wl,-mllvm,` and
`-Wl,-plugin-opt=` reach the LTO pipeline from the ELF clang link driver.**

Every LLVM line citation is EXACT (I have the release/21.x sources):
- `PassBuilderPipelines.cpp:180` `EnableMergeFunctions` `cl::init(false)` (OFF today) ✓
- `:321` `MergeFunctions = EnableMergeFunctions;` in `PipelineTuningOptions()` ✓
- `:1852` `buildLTODefaultPipeline` ✓
- `:2185` `if (PTO.MergeFunctions) MPM.addPass(MergeFunctionsPass());` — and it runs
  AFTER GlobalDCE (`:2183`), i.e. on POST-inlining LTO IR ✓
- `MergeFunctions.cpp:165-166` `mergefunc-use-aliases` `cl::init(false)` ✓
- `merge-functions`/`mergefunc` appears NOWHERE in bun's `scripts/`/`Cargo.toml`, and
  `-fmerge-functions` is NOT a clang-21 driver flag (verified). It IS off today.

### Safety: CONCLUSION CONFIRMED — but the report's PROOF has a hole I had to close

The report's claim "Two distinct source functions can NEVER end up at one address" is
**false as stated.** `MergeFunctions.cpp:927-940` (release/21.x):

```cpp
if (G->hasGlobalUnnamedAddr() && !Used.contains(G)) {
  ...
  G->replaceAllUsesWith(F);     // <-- &G BECOMES &F. Addresses DO collapse.
```

For `unnamed_addr` functions (rustc marks EVERY Rust function `UnnamedAddr::Global`),
MergeFunctions collapses the addresses with no thunk. I then **closed the hole**: I wrote
an IR probe (`/tmp/sk-mo/ua.ll`, two `unnamed_addr` functions, both addresses escaping
into a global table AND explicitly compared) and linked it with the canary's actual
`--icf=safe`:

```
--icf=none  -> addresses-distinct=1
--icf=safe  -> addresses-distinct=0     <-- TODAY'S SHIPPED BEHAVIOR
```

**`--icf=safe` already collapses the `unnamed_addr` population, today.** `unnamed_addr`
IS the IR contract "my address is not significant"; lld's `icf=safe` keys on exactly it
(the `.llvm_addrsig` table the LTO backend emits). So MergeFunctions' RAUW path hits
ONLY a population the shipped build already folds. For C++ functions clang never emits
global `unnamed_addr` (C++ requires distinct addresses), so every address-significant
function takes `replaceDirectCallers` -> thunk at its own address. **Conclusion: MO-P1
introduces ZERO new address-collapse risk.** The report's PR comment should say
"address-identity-safe for every address-SIGNIFICANT function" — the words "by
construction" are an over-claim that an LLVM reader would bounce.

### Size: CONFIRMED within the band — my independent BY-ADDRESS derivation lands at the floor

The report explicitly does not derive its 0.15-0.25 from `nm-dem.txt` (it transfers from
GT#2's measured icf=all −0.250). I DID derive it by address. Method
(`/tmp/sk-mo/census_fix.py`): take every unique `.text` address+size from `nm.txt`
(60,385), read each body from the binary, zero out every `call/jmp/jcc rel32` slot
recording its target-function index, and compute the **transitive fixpoint** equivalence
(identical skeleton + pairwise-equivalent call targets) — exactly lld-ICF's equivalence.
5 iterations to fixpoint.

```
single-round, raw bytes          : 0.040 MiB   (237 groups,  1,167 duplicate bodies)
single-round, rel32-normalized   : 0.045 MiB   (348 groups,  1,409 duplicate bodies)
TRANSITIVE FIXPOINT              : 0.150 MiB   (1,409 duplicate bodies)
GT#2 (orchestrator, MEASURED relink of the real objects) : 0.250 MB
```

**0.150 MiB is the floor** (I only normalize call/jump references, not absolute
`imm32`/data references — the non-PIE binary has those too); **0.250 is the measured
ceiling**. MO-P1's 0.15-0.25 band is exactly `[my floor, GT#2's ceiling]`. Consistent.
One honest caveat the report under-states: MergeFunctions alone is NOT expected to reach
0.250 — it pays a thunk per address-taken duplicate (~1,400 x <=16 B ≈ 22 KB) and misses
the same-bytes-different-IR-types residual. **Choosing MO-P1 over row 5 trades ~0.03-0.10 MB
for the removal of ALL of row 5's pre-ship burden.** The two ALSO compose (keep
`--icf=safe`; optionally still do `icf=all --keep-unique` on top) — the report does not
note that the union is available.

### Perf: CONFIRMED — and I produced the evidence the report never did

The report's perf argument for MO-P1 is abstract ("<=1 cycle on a >=50-cycle
host-function dispatch"). I NAMED the actual fold population. The top 12 fixpoint groups
on the real canary, in saving order:

| save B | size | n | symbol |
|---:|---:|---:|---|
| 5,490 | 549 | 11 | `WebCore::JSBytesInternalReadableStreamSource::visitChildren` |
| 4,598 | 38 | 122 | `JSC::Wasm::ConstExprGenerator::addI32DivS` (+121 siblings) |
| 3,630 | 605 | 7 | `JSC::LazyProperty<..>::callFunc<Bun::Http2CommonStrings::initialize()::$_N>` |
| 3,186 | 354 | 10 | `WTF::ScopedLambdaFunctor<JSC::AbstractMacroAssembler<X86Assembler>::Jump..>` |
| 3,174 | 529 | 7 | `bun_image::N_AVX3_SPR::Rotate270Impl` (Highway ISA variants) |
| 2,742 | 914 | 4 | `WebCore::JSDebugHTTPSServer::visitChildren` |
| 2,700 | 450 | 7 | `bun_image::N_AVX3_SPR::Rotate90Impl` |
| 2,576 | 368 | 8 | `WebCore::JSListener::visitChildren` |
| 2,475 | 33 | 76 | `JSC::Wasm::IPIntGenerator::addI32Add` (+75 siblings) |
| 3x2,379 | 793 | 4ea | `JSC::Wasm::OMGIRGenerator::addI32{GeS,GtS,LeS}` |

Every one is a GC visitor, a Wasm COMPILE-time op handler, a one-shot lazy initializer,
a JIT-COMPILE-time lambda, or a Highway dispatch variant. **Not one is a steady-state
inner loop.** All are address-taken through a vtable / method table / function-pointer
dispatch table — which is WHY `icf=safe` refused them, and which means the thunk's
single predicted direct `jmp` sits behind an already-indirect call. The merge itself is
a strict I-cache IMPROVEMENT (11 x 549 B -> 1 body). Perf-neutral verdict CONFIRMED.

### Two copy-paste errors the synthesizer must fix before a PR

1. **The insertion point is wrong.** The report says to insert "immediately after the
   existing `-Wl,-mllvm,-whole-program-visibility` entry at ~:873". That entry is
   **`when: c => c.darwin && c.lto` — a DARWIN-ONLY block.** The correct neighbor is the
   LINUX link-side LTO block at `flags.ts:883-886`
   (`-flto=full -fwhole-program-vtables -fforce-emit-vtables`,
   `when: c => c.unix && !c.darwin && c.lto`), inside `export const linkerFlags`
   (`flags.ts:833`). The report's `when: c => c.unix && !c.darwin && c.lto && c.release`
   is correct; only the stated neighbor/line is wrong.
2. **Soften the comment.** Replace "preserved by construction" with "preserved for every
   address-significant function; `unnamed_addr` functions (all Rust fns) collapse, which
   `--icf=safe` already does today". An LLVM-literate reviewer WILL find
   `MergeFunctions.cpp:932`.

One regression the report did not list: MergeFunctions adds a `FunctionComparator` pass
over a ~53-MB merged LTO module. Link-time cost only, but it should be measured, not
assumed at "+10-30 s".

---

## VERDICT MO-D1 (`-Wl,-mllvm,-enable-machine-outliner`, 5.1-8.7 MB, REGRESSION): CONFIRMED as a dead end

The report's OWN verdict is "perf: REGRESSION -> dead_end" and that is correct — this is
size-facts' textbook dead mechanism (inline -> call). I attacked its supporting
measurements anyway because the 5-9 MB number is now in the permanent record.

**The F6 kill shot is REAL.** I counted the exact 19-byte encoding of the #1 claimed
hot victim (the inlined `AssemblerBuffer::ensureSpace` check,
`8b 8b a8000000  8b 83 b0000000  48 8d 50 10  48 39 ca`) in the real canary's `.text`:

```
%rbx family : 5,996     %r14 family : 1,338     %r15 family : 850    TOTAL 8,184
```

The report's "≈8,000 inlined copies" is independently reproduced BY BYTES. That sequence
ends in a `cmpq` whose flags feed the caller's branch (legal on x86 because `call`/`ret`
do not touch EFLAGS) — it WOULD be outlined, 5,996 times, into the inner loop of every
JIT compile. Dead end confirmed. (This same 8,184-copy count is also the strongest
independent datum for `w3-lto-pipeline`'s over-inlining brief, now verified.)

**The legality/cost model (F2) matches LLVM release/21.x source exactly** — I read the
files the report downloaded:
- Base class `TargetInstrInfo.cpp:2134-2197`: inline-asm / label / terminator-with-
  successors / predicated / MBB-BlockAddress-CPI-JTI, in that order. **`GlobalAddress`
  is NOT in the illegal operand list** (`:2193`) — F4's central "non-PIE absolute
  immediates are legal AND byte-matchable" claim holds from source.
- `X86InstrInfo::getOutliningTypeImpl` (`:10643-10680`): `isTerminator()` is checked
  FIRST, so `ret` is LEGAL (a tail-call candidate). census2.py marks `ret`/`j*` illegal
  -> a CONSERVATIVE under-count. RSP/RIP/CFI rules match.
- `isFunctionSafeToOutlineFrom` (`:10623-10642`) red-zone skip: correct — `-mno-red-zone`
  is NOT in flags.ts, so with `-mno-omit-leaf-frame-pointer` every leaf sets
  `usesRedZone` and is skipped. The 7,947-leaf exclusion is the right model.
- `getOutliningCandidateInfo` (`:10564-10620`): the 1-byte-per-instruction FIXME,
  call overhead 1, frame 1. Verbatim.
- `OutlinerBenefitThreshold` `cl::init(1)` (`MachineOutliner.cpp:129-130`),
  `MinRepeats=2` (`:826`). No `LiveRegUnits`/hotness pruning exists (grep = 0).

**I REFUTED my own two strongest attacks on F5:**
1. *"9,234,275 legal positions > 8,809,952 LEGAL instructions"* — NOT a contradiction.
   `census2.py` appends a sentinel (`-1` / `\0`) after every run; 9,234,275 = surviving
   legal instructions + the run count. The prose is imprecise; the pipeline is sound.
2. *"212K outlined functions x 16-byte alignment = ~1.7 MB of uncounted padding"* —
   FALSE. Outlined functions carry `minsize`/`optsize` and get 1-byte alignment. Proven
   on the report's own artifact: `probe_always.o` has `OUTLINED_FUNCTION_0..9` at
   `0x771, 0x77e, 0x78b, 0x798, 0x7a2, ...` — 10-13-byte spacing, zero padding.

**One OVER-count the report missed (immaterial):** module-level inline `asm(...)` — the
JSC LLInt's opcode handlers — lives in the LTO `.text` but is NEVER a `MachineFunction`,
so the outliner cannot touch it. `census2.py` classifies its (very repetitive)
instructions as LEGAL. Bounded by the LLInt's size, ~0.1-0.2 MB against a 5-9 MB band.

**The honest framing the synthesizer should carry:** the 5.1-8.7 band is an ESTIMATE
whose width is the report's admitted greedy-ORDER approximation (longest-first 8.67 vs
shortest-first 5.13; LLVM's real benefit-sorted greedy is neither). The 8.67 headline is
the OPTIMISTIC end of a model, not a measurement. Do NOT quote "8.67 MB" as a fact; quote
"a modeled 5-9 MB, relink-measurable in minutes, and a perf regression with no escape
hatch in LLVM 21." The relink-only mechanism IS proven end-to-end.

## VERDICT MO-D2 (no scoping mechanism in LLVM 21 on x86): CONFIRMED

Every claim verified: `MachineOutliner.cpp:1211` `F.hasFnAttribute("nooutline")` (exact
line); I ran clang 21.1.8 on both spellings — `__attribute__((nooutline))` AND
`[[clang::nooutline]]` -> `unknown attribute ... ignored; did you mean 'noinline'?`;
`flags.ts:1528` `file: string` in `FileOverride`; `unified.ts:21,:192-198` the
per-file-flag no-share-TU machinery. A compile-time `-mllvm` on a `-flto=full` bitcode
TU is a no-op for a link-time codegen pass. Grep of `MachineOutliner.cpp` for
hot/profile/BFI/PSI = 0. Closed.

## VERDICT MO-D3 (the brief's "strip immediates" normalization over-estimates): CONFIRMED

Independently proven by bytes on the canary: the `%rbx` / `%r14` / `%r15` families of
the SAME 4-instruction `ensureSpace` sequence are 3 DISTINCT byte patterns
(5,996 / 1,338 / 850 occurrences) that the real post-RA `isIdenticalTo` can never merge.
Stripping registers would have counted them as one 8,184-occurrence candidate.

## VERDICT MO-D4 (`-outliner-benefit-threshold` / `-reruns` don't fix the perf): CONFIRMED

The threshold (`MachineOutliner.cpp:129-130`, `cl::init(1)`) filters by TOTAL benefit,
which is maximized by high-N candidates — which ARE the most-inlined, hottest helpers
(my 5,996-count #1 has the highest benefit by construction). No hotness signal exists.

---

## Cross-references and NEW leads I found that belong to OTHER units

1. **Highway SIMD duplicate kernels (NEW — no unit has this).** My fixpoint census found
   `bun_image::N_AVX3_SPR::Rotate270Impl` x7 (529 B) and `Rotate90Impl` x7 (450 B) —
   Highway's per-ISA namespaces (`N_AVX3_SPR`, `N_AVX3_ZEN4`, `N_AVX3_DL`, ...) stamping
   7 byte-identical copies of the same kernel, address-taken via the
   `HWY_DYNAMIC_DISPATCH` function-pointer table so `icf=safe` refuses them. This is
   EXACTLY w3-dep-internals' brief question ("highway: how many ISA variants ... are the
   pre-haswell ones dead?"). The rotate pair alone is ~7 KB; the FULL Highway duplicate
   population across all its kernels is worth enumerating. -> **w3-dep-internals**.
2. **`AssemblerBuffer::ensureSpace` LTO-inlined 8,184x** — the report's F9 handoff to
   w3-lto-pipeline is now INDEPENDENTLY verified by exact bytes. -> **w3-lto-pipeline**.
3. **JSC Wasm op-handler stamping** (122 identical `ConstExprGenerator::addI32*`,
   76 identical `IPIntGenerator::addI32*`, 4-way `OMGIRGenerator::addI32*S` at 793 B
   each) — the same "parallel per-op functions differing only in which helper they call"
   shape as bun's `generate-classes.ts`, but inside upstream JSC. A `NEVER_INLINE` on
   the shared helper would fold them at the SOURCE. -> **w3-webkit-build-options**.

---

## credible NEW (non-duplicate) total MB for this unit: 0.00

MO-P1's 0.15-0.25 MB is the SAME byte population as SYNTHESIS2 Tier-A row 5
(`icf-all-keep-unique`, 0.250 MB, already banked) — and was already identified as such
by wave-1 unit 14 (`14/mergefunc-lto`, SYNTHESIS.md:285-287). MO-D1's 5-9 MB is a
correctly-classified perf dead end. **What this unit ACTUALLY delivers is not new MB
— it is the evidence that converts row 5 from "gated on a maintainer yes, 3 pre-ship
audits, a --keep-unique list to maintain" into "a one-line, relink-only, no-gate flag
with a proven-safe mechanism." That unblocks an already-banked 0.25 MB. The synthesizer
should REPLACE row 5's implementation with MO-P1's (at row 5's position, re-pointing the
saving to 0.15-0.25 with one relink to nail it) rather than add a new row.**
