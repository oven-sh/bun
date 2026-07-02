# SKEPTIC — w3-webkit-build-options

Everything below was re-derived from scratch. Size numbers: my own, independently written
address-exclusive script (`/tmp/skeptic-w3wbo/xaddr.py`, NOT the unit's `xsize.py`) over
`/tmp/canary/nm-dem.txt`, grouping by ADDRESS, counting an address ONLY if every symbol at it
matches (per SYNTHESIS2's mandated methodology). Every runtime-option claim: re-run on the
LIVE shipped `/tmp/canary/bun-linux-x64/bun`. Every source claim: re-read from
`/workspace/bun/vendor/WebKit` (verified `git rev-parse HEAD` ==
`c9ad5813fd23bd8b98b0738abc3d037ec716aa92`, the exact `scripts/build/deps/webkit.ts:10` pin).

---

## VERDICT P1 (`webkit/bun-enable-jsc-debug-tooling`): **CONFIRMED** — the union reproduces
to the BYTE (598,554 B at 454 addrs), every option default and every root is independently
verified on the live canary and in source, the `BUN_ENABLE_JIT_DISASSEMBLER` precedent is
real and verbatim, and the set is 0-byte-disjoint from every banked SYNTHESIS2 row. BUT the
report missed ONE real regression (the `BUN_JSC_verifyGC` bun-CI safety net, item (e)) and
one second reader of `airUseGreedyRegAlloc`; its per-item (e) number is wrong; and two of its
regression statements are factually inaccurate. Credible corrected number: **0.555 MB**
(0.571 only if the maintainers accept the named verifyGC test interaction).

## VERDICT P2 (`webkit/lto-whole-program-visibility-linux`): **REFUTED** — its core,
headline claim ("WholeProgramDevirt is provably inert at the linux link") is
**EXPERIMENTALLY FALSE**. I reproduced it and the WPD pass devirtualizes TODAY with no
linker flag. The report banked 0 MB for it, so the ledger is unaffected; do NOT run the
relink.

## VERDICT P3 (`webkit/remove-inert-wpd-flags`): **REFUTED — and actively harmful.** The
flags it calls "no-ops" are load-bearing for an optimization that is ALREADY RUNNING.
Removing them is a perf REGRESSION, the one thing this wave is forbidden to do.

---

## P1 — the evidence

### 1. Re-derivation BY ADDRESS (independent script; required by my brief)

| set | report | MY re-derivation | verdict |
|---|---:|---:|---|
| (a) Air graph-coloring regalloc | 292,211 @ 194 | **292,211 B @ 194 addrs** | EXACT |
| (b) B3+Air+DFG IR validation | 112,681 @ 23 | **112,681 B @ 23 addrs** | EXACT |
| (c) BytecodeDumper | 144,950 @ 195 | **144,950 B @ 195 addrs** | EXACT |
| (d) IonGraph | 32,272 @ 6 | **32,272 B @ 6 addrs** | EXACT |
| (e) HeapVerifier | 18,568 @ 37 | **16,440 B @ 36 addrs** | **WRONG, off by 2,128 B** |
| **GRAND UNION** (one combined regex) | 598,554 @ 454 | **598,554 B @ 454 addrs = 0.5708 MB** | **EXACT** |

ICF-shared bytes correctly excluded (751 B on the union — matches).

**The (e) table entry is not reproducible even with the unit's OWN `xsize.py`** (I ran it:
16,440 @ 36). The 5 sets are actually fully DISJOINT by address (194+23+195+6+36 = 454),
so the report's "2,128 B of overlap is correctly not double-counted" narrative is ALSO
false. The HEADLINE union is nevertheless exact because
292,211+112,681+144,950+32,272+16,440 = 598,554. A precision error, not a money error.

### 2. The perf-neutrality argument, attacked hardest — HOLDS

The entire claim rests on "every byte is behind a `JSC::Options` Bool that is `false` on
the shipped binary". I verified every link of that chain independently:

- **All 16 option defaults on the LIVE canary** (`BUN_JSC_dumpOptions=3
  /tmp/canary/bun-linux-x64/bun -e 1`): `airUseGreedyRegAlloc=true`; `validateGraph`,
  `validateGraphAtEachPhase`, `dumpGeneratedBytecodes`, `dumpBytecodeAtDFGTime`,
  `dumpBytecodesBeforeGeneratorification`, `dumpBytecodeLivenessResults`, `validateBytecode`,
  `dumpDisassembly`, `useProfiler`, `useDollarVM`, `dumpIonGraph`, `verifyGC`,
  `airForceBriggsAllocator`, `airForceIRCAllocator` ALL `false`. CONFIRMED.
- **`Options::airUseGreedyRegAlloc` is never WRITTEN anywhere in JSC** — only its
  `OptionsList.h:516` declaration (`true`), the dispatch read (`AirGenerate.cpp:119`), and
  one more read. No `recomputeDependentOptions` forcing. **There is no fallback.** The
  SYNTHESIS2 open question ("check whether greedy ever FALLS BACK") is definitively NO.
- **`allocateRegistersByGraphColoring(Code&)` is the ONLY non-anonymous-namespace symbol
  in `AirAllocateRegistersByGraphColoring.cpp`** (the whole TU is `namespace { ... }` from
  line 52; the one public function is at :2318; the header declares it with NO export
  attribute). One gated call → all 194 addresses die transitively. CONFIRMED.
- **The LIVE stack allocator is NOT swept up.** `AirAllocateStackByGraphColoring.cpp`
  (which ALWAYS runs, `AirGenerate.cpp:137`) uses entirely different class names
  (`StackAllocatorBase`, `GraphColoringStackAllocator`). The regex matches none of them.
  This was my most likely refutation vector and it is clean.
- **Every caller of all three validaters** (exhaustive tree grep):
  `AirGenerate.cpp:76,93,176` + `B3Generate.cpp:81,133` + `B3PhaseScope.cpp:56` +
  `DFGPlan.cpp:108,233,253,268,280` + `DFGPhase.cpp:58-60` +
  `DFGObjectAllocationSinkingPhase.cpp:853` + `DFGCFGSimplificationPhase.cpp:249`, ALL
  behind `shouldValidateIR()` / `shouldValidateIRAtEachPhase()` /
  `Options::validateGraphAtEachPhase()` / `validationEnabled()`. In release
  `DFG::validationEnabled()` IS `validateGraph||validateGraphAtEachPhase`
  (`DFGCommon.h:87-94`, which is itself already `#if ASSERT_ENABLED` structured —
  identical shape to the proposed change). `WasmOMGIRGenerator.cpp:6742` IS literally
  `if (ASSERT_ENABLED) validate(procedure, ...)`. CONFIRMED. The test-only callers
  (`testb3_*.cpp`) are a separate binary the Dockerfile never builds.
- **`::JSC::dumpBytecode` (the 11,359-B generated 200-case switch) has exactly ONE
  caller**: `BytecodeDumper.cpp:97`. All ~190 `OpXxx::dump` methods (counted because the
  `BytecodeDumperBase<>*` parameter type contains the regex token) die with it. Zero
  `Wasm`/`Inspector` symbols in the 195. CONFIRMED.
- **`CodeBlock::dumpBytecode` has exactly the 11 roots the report listed, plus none.**
  Critically, the `DFG_CRASH` / `Graph::handleAssertionFailure` path (the one LIVE
  release-assert diagnostic path) calls `Graph::dump`/`dumpBlockHeader` — the DFG IR
  dumper, which the report's own dead_ends correctly declares NOT removable — and does
  NOT call the BytecodeDumper. No live crash-diagnostic degradation.
- **`dumpIonGraph` has 8 roots, not the 5 listed** (also `DFGGraph.cpp:102`,
  `AirGenerate.cpp:73`, `WasmOMGIRGenerator.cpp:6687`), every one
  `Options::dumpIonGraph()` and almost every one annotated `[[unlikely]]`. More work for
  the implementer, same conclusion.
- **The precedent citation is real and verbatim.** `PlatformEnable.h:763-780` is exactly
  the quoted `BUN_ENABLE_JIT_DISASSEMBLER ASSERT_ENABLED` block with the maintainers' own
  identical argument. This is the strongest possible perf-neutrality citation.
- I re-ran the report's "the knobs work today" checks: `BUN_JSC_dumpGeneratedBytecodes=1`
  prints real bytecode; `BUN_JSC_airUseGreedyRegAlloc=0` forces graph coloring and the
  binary runs correctly. CONFIRMED (so the PR's regression description can be honest).

### 3. Disjointness + novelty — CONFIRMED

- Byte-level intersection of the whole 454-address union with
  `JSC::LOL::|LOLJIT|ForLOL|Temporal|JSC::Profiler::|Disassembler|JITDump|GdbJIT|ICStats|DollarVM|FuzzerAgent|icu_75::|JSC::Yarr`:
  **0 symbols, 0 bytes.** P1 is fully disjoint from SYNTHESIS2 B2 (LOLJIT), C1 (Temporal),
  B3 (ICU), and all 8 w2-P3 residuals.
- `w2-jsc-upstream` report AND skeptic: **0** occurrences of
  BytecodeDumper/IonGraph/HeapVerifier/dumpIonGraph/verifyGC. (c)+(d)+(e) are genuinely
  NEW.
- The w2 skeptic's narrow graph-coloring regex reproduces at exactly **183,304 B @ 36
  addrs** (SYNTHESIS2 lead #1's number). The report's 292,211 is the correct WIDER set;
  the 183→292 correction is real.
- SYNTHESIS2 §E lead #1 (0.28 MB) is EXPLICITLY not in its 4.21 total ("which is why I
  did not bank it"). P1(a)+(b) is the adversarial second pass it asked for. Fully
  additive, NOT a duplicate.
- No sibling wave-3 unit double-counts P1. `w3-lto-pipeline` lists
  `GraphColoringRegisterAllocation::allocateOnBank<0>` in its top-30 and correctly marks
  it "DEAD (SYNTH2 §E.1)" rather than claiming it.
- Nothing in P1 re-opens the SYNTHESIS2 DISCARDED list.

### 4. The regressions the report did NOT list (the skeptic's contribution)

**(R1, the important one) `BUN_JSC_verifyGC` is NOT the "undocumented, nobody-uses-it
debug knob" the report claims. It is a bun CI SAFETY NET.**
`test/js/web/abort/abort-controller-gc-reason.test.ts:36-42` spawns `bunExe()` with
`BUN_JSC_verifyGC: "1"` + `BUN_JSC_collectContinuously: "1"` and asserts on the
HeapVerifier's output. Its own comment: *"verifyGC asserts on reachable cells the
concurrent collector missed. Before the fix, abort() ... stored the reason with no write
barrier / output constraint, leaving it unmarked"* (WebKit 293319). P1(e) compiles
`HeapVerifier` out of release builds → that test silently becomes VACUOUS on every
release CI lane (it keeps PASSING but no longer detects a re-regression of a real GC
write-barrier bug). The report's blanket claim — *"NONE is documented by bun; NONE is a
user feature"* — is FALSE for `verifyGC`. This is exactly the CLAUDE.md class "never
silently weaken an existing safety net". Nuance: it still works on the debug/ASAN CI
lanes (the gate is `ASSERT_ENABLED`), so the net is weakened, not deleted. **My
recommendation: DROP (e) from P1.** It is only 16,440 B (2.7% of the union) and it is the
one item with a real, undisclosed cost. P1 minus (e) = **582,114 B = 0.555 MB.**

**(R2) `BUN_JSC_airUseGreedyRegAlloc=0` does NOT "become a no-op" — there is a second
LIVE reader of the option the report never found.** The report's verification grep was
for the FUNCTION name `allocateRegistersByGraphColoring`; it never grepped the OPTION
name. `wasm/WasmOMGIRGenerator.cpp:5361`:
`if (valueLocation.location.isStackArgument() && Options::airUseGreedyRegAlloc())` — a
LIVE, production-taken branch (the default is true) that selects Wasm-OMG result-constraint
SHAPE based on which allocator is running. After P1's exact diff, the option no longer
switches the allocator but STILL flips this codegen decision. Reading the in-source FIXME
("Graph Coloring has an issue where it runs out of 'colors' ... so instead place results
where they would canonically go"), the `else` branch is the MORE-constrained,
both-allocators-safe `ValueRep(location)`, so this is a BENIGN inconsistency, not a
miscompile. But (a) the report's "no-op" claim is false and (b) its "Nothing else is
needed" completeness claim fails an option-level audit a WebKit reviewer will run on day
one. The fix is one line (force the option under `!BUN_ENABLE_JSC_DEBUG_TOOLING`, or gate
the second reader). Must be in the PR.

**(R3) `validateBytecode` is WRONGLY listed in the report's regression list.**
`Options::validateBytecode()` → `ScriptExecutable.cpp` → `CodeBlock::validate()`, and
`CodeBlock::validate()` is NOT in any of the 5 regexes. P1 stubs only
`endValidationDidFail()`'s FAILURE-path bytecode dump. `BUN_JSC_validateBytecode=1` keeps
VALIDATING and keeps RELEASE_ASSERTing on failure. This matters: SYNTHESIS2's own
prescribed verification gate for Tier-A row 3 (EJ1 minify-whitespace) IS
`BUN_JSC_validateBytecode=1` — **P1 does not break it.** (An error in P1's favor, but a
factual error a reviewer would flag.)

**(R4, cosmetic) The (c) diff's line numbers are wrong.** `BytecodeDumper.cpp:102-106` is
the static WRAPPER; the body that actually calls the generated `::JSC::dumpBytecode`
switch is the INNER overload at **lines 95-99**. The design still works (the wrapper +
`dumpBlock`/`dumpGraph` are all stubbed, so the inner overload becomes unreferenced and
is gc-sectioned), but the "literal, copy-pasteable" contract the orchestrator set is not
met by this number. Stubbing the INNER body at 95-99 is the 1-line version.

### 5. Corrected bottom line for P1

`saving_mb`: **0.555** (= 598,554 − the 16,440 of (e)). The report's 0.571 stands ONLY if
the maintainers explicitly accept R1. Apply the report's own (correct) icf=all-first
deduction of ~0.015-0.025 → floor **~0.53**. Band: **0.53 – 0.555** (0.571 with R1
accepted). Windows: same source, same `OptionsList.h`, same `ASSERT_ENABLED=0`; credit 0
per the report (windows is solved). Relink-only: NO (one oven-sh/WebKit prebuilt rebuild +
one `scripts/build/deps/webkit.ts:10` pin bump; batches with SYNTHESIS2 Tier B). The
report's "A + B + P1 = 4.78 MB (0.08 short)" becomes **A(3.03) + B(1.18) + 0.555 = 4.77
(0.09 short)** — not materially different; the claim that P1 closes most of the Tier-C gap
survives.

---

## P2 — the refutation (the single biggest error in this unit)

The headline of F3 and the definition of P2 is: *"WholeProgramDevirt never runs on the
linux binary"*, presented as *"EMPIRICALLY CONFIRMED on the exact toolchain"* by a
`clang++-21 -###` run. **That experiment tests the wrong thing.** `-###` only shows that
the clang DRIVER does not forward a visibility-UPGRADE flag to `ld.lld`. It says nothing
about whether the WPD pass fires. It does.

**The experiment** (clang 21.1.8 + ld.lld-21, the exact toolchain). I compiled a two-TU
virtual-call fixture with the EXACT WebKit prebuilt flags
(`-fvisibility=hidden -fvisibility-inlines-hidden -flto=full -fwhole-program-vtables
-fforce-emit-vtables -fno-rtti -fno-exceptions -O3 -ffunction-sections -fdata-sections`),
made the receiver an OPAQUE `B* volatile` global so no interprocedural dataflow can learn
the dynamic type, and linked with the EXACT linux production link flags
(`flags.ts:883` `-flto=full -fwhole-program-vtables -fforce-emit-vtables` + `:894` `-O2`),
**with NO `--lto-whole-program-visibility`**, asking the WPD pass for its own remarks
(`-Wl,-mllvm,-pass-remarks=wholeprogramdevirt`):

```
<unknown>:0:0: single-impl: devirtualized a call to _ZN1D1fEv
<unknown>:0:0: devirtualized _ZN1D1fEv.llvm.merged
```
and `go()` disassembles to `movq g_b,%rax; movl $0x7,%eax; ret` — the virtual call is
GONE. Adding `--lto-whole-program-visibility` produces byte-identical code for this case.
Files: `/tmp/skeptic-w3wbo/wpd1b.cpp`, `/tmp/skeptic-w3wbo/wpd2.cpp`.

**WHY the report was wrong.** `--lto-whole-program-visibility` only UPGRADES
*public*-visibility vtables to linkage-unit. With `-fvisibility=hidden` — set for the
WebKit prebuilt (`OptionsJSCOnly.cmake`) AND for bun's own C++ (`flags.ts:372`) — clang's
`-fwhole-program-vtables` already emits `!vcall_visibility = LinkageUnit` on those
vtables, under which `WholeProgramDevirt` devirtualizes with NO linker flag at all. The
`flags.ts:867-869` comment the report quoted and "confirmed" (*"without the visibility
upgrade WPD only fires for classes explicitly annotated [[clang::lto_visibility]], i.e.
never"*) is factually wrong for this build; the report adopted the flag author's own
mistaken comment and then ran an experiment that could not falsify it.

**Independent corroboration from a sibling unit.** `w3-cpp-compile-flags` reached the same
kill from a second, also-correct direction (its row for these flags): *"DEAD for size. WPD
devirtualizes (perf) but never DELETES a virtual unless VFE is also on."* — correct:
devirtualization replaces an indirect call with a direct one; the virtual function BODY is
only deleted by `-fvirtual-function-elimination`, which is set nowhere (0 hits in flags.ts
and the WebKit Dockerfile). So the size upside of P2 is structurally ~0 by TWO
independent arguments: WPD already runs, and WPD-without-VFE cannot delete code.

**What survives.** The report was HONEST that P2 is not banked (`saving_mb: UNKNOWN SIGN
— not banked`) and gave the right ceiling (I reproduce `_ZTV` = exactly **210**). So the
LEDGER is unaffected: P2 was always 0 MB. What is refuted is the entire WHY. Given two
independent refutations of the mechanism and a structural ~0 upside, the relink is not
worth the maintainers' time. **Do not run it.**

---

## P3 — REFUTED, and it is the one dangerous item

P3's premise: `-fwhole-program-vtables` + `-fforce-emit-vtables` are
"load-bearing-looking, dual-maintained no-ops" that "cost LTO bitcode size and link TIME,
not binary bytes" — "perf neutral (provably 0 executed instructions change)". **Every part
of that is falsified by the same experiment.** `-fwhole-program-vtables` is what emits the
`!type` + `!vcall_visibility` metadata that makes the ALREADY-RUNNING `WholeProgramDevirt`
pass fire on this binary; `-fforce-emit-vtables` feeds it `available_externally` vtable
definitions so the full implementation set is visible. Deleting them:

1. DISABLES a devirtualization pass that is currently active across all of
   WebKit-bitcode + bun-C++-bitcode → indirect virtual calls return → a **perf
   REGRESSION**, the single thing this wave's hard constraint forbids.
2. CHANGES the binary's bytes (my `go()` collapsed from a vtable load + indirect call to
   `movl $7; ret`; those sites revert). "provably 0 executed instructions change" is false.

The one piece worth saving, as 0-byte hygiene SEPARATE from any flag removal (I verified
both in `release.sh`): the duplicate `--build-arg RELEASE_FLAGS=` at lines 69 AND 71 (the
second with an `-O2` fallback; docker takes the last), and `LTO_FLAG` defaulting to `""`
at line 9 (only the workflow matrix row makes the `-lto` variant LTO). Real, harmless,
0 bytes. **The flag-removal half of P3 must not land. "Mutually exclusive with P2 — land
exactly one" should be "land NEITHER."**

Side-finding for the synthesizer (0 bytes, doc hygiene only): the `flags.ts:863-872`
comment is wrong for this build, and a maintainer should know that before anyone else
relies on it the way this unit did.

---

## The report's OTHER findings — spot-checked

- **F1** (the effective prebuilt CXXFLAGS, the cmake `ENABLE_*` table being clean): the
  `Dockerfile:4` `ARG LTO_FLAG` and the `bun-webkit-linux-amd64-lto` row in
  `.github/workflows/build-reusable.yml` are exactly as quoted; the `webkit.ts` comment
  about "ThinLTO -lto variants" refers to the macOS/Windows artifacts and the LINUX `-lto`
  row IS `-flto=full -fwhole-program-vtables -fforce-emit-vtables`. CONFIRMED.
- **D2** (the ~550 KB assert-string avenue is ALREADY closed): `Assertions.h:1050-1065` is
  exactly the quoted bun-added `CRASH_WITH_INFO` override. CONFIRMED verbatim. This closed
  book is correct and valuable.
- **D3** (LOLJIT, the w2 skeptic missed nothing): not re-derived; the w2 skeptic already
  owns it and the report only corroborates.
- `_ZTV` census = **210** exact.

---

## credible NEW (non-duplicate) total MB for this unit: **0.555** (band 0.53–0.571)

All of it is P1. It is 0-byte-disjoint from every banked SYNTHESIS2 row, absent from every
w2 report/skeptic, and fully additive with SYNTHESIS2's unbanked lead #1 (which it
supersedes and corrects). It is one coherent mechanism, in one oven-sh/WebKit commit,
batching into the SAME prebuilt rebuild as SYNTHESIS2's entire Tier B. It is the same
pattern the maintainers already invented and shipped themselves
(`BUN_ENABLE_JIT_DISASSEMBLER`), for which I verified the precedent verbatim. P2 and P3
contribute 0 and must not be implemented (P3 would be a regression).

Required before a PR:
1. DROP (e) HeapVerifier, or update/annotate
   `test/js/web/abort/abort-controller-gc-reason.test.ts` in the same change and say so.
2. Add one line handling the second `Options::airUseGreedyRegAlloc()` reader at
   `wasm/WasmOMGIRGenerator.cpp:5361` (or state why it is intentionally left).
3. Fix the (c) line numbers to `BytecodeDumper.cpp:95-99`.
4. Correct the regression list: `validateBytecode` does NOT become a no-op; there are 8
   `dumpIonGraph` roots, not 5.
