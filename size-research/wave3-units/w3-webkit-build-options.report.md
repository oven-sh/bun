## REPORT

### unit: w3-webkit-build-options

### findings

All sizes are **address-exclusive** sums over `/tmp/canary/nm-dem.txt` (the real shipped
LTO canary, 80,291 symbols), per SYNTHESIS2's mandated methodology: an address is
counted ONCE (its max size) and ONLY if every symbol at that address matches the set
(bytes ICF-shared with any non-matching symbol are EXCLUDED). Script:
`/tmp/w3-webkit-build-options/xsize.py` (reproducible; every number below cites its
regex). Ground truth sources actually read end-to-end: `vendor/WebKit/` IS the exact
pinned `c9ad5813fd23bd8b98b0738abc3d037ec716aa92` checkout (verified `git rev-parse
HEAD`); I also read the root `Dockerfile`, `Dockerfile.windows`, `Dockerfile.musl`,
`release.sh`, `.github/workflows/build-reusable.yml`, `Source/cmake/OptionsJSCOnly.cmake`,
`Source/cmake/WebKitFeatures.cmake`, `Source/cmake/WebKitCompilerFlags.cmake`,
`Source/cmake/OptionsCommon.cmake`, `Source/WTF/wtf/PlatformEnable.h`,
`Source/WTF/wtf/Assertions.h`, `runtime/OptionsList.h`. The ACTUAL shipped prebuilt's
`cmakeconfig.h` is on disk at
`/root/.bun/build-cache/webkit-c9ad5813fd23bd8b/include/cmakeconfig.h` and is my
definitive option table. I RAN the shipped canary for every runtime-option claim.

### F1 — The EFFECTIVE build configuration of the WebKit prebuilt bun links (nobody had this)

`bun-webkit-linux-amd64-lto` is built by `oven-sh/WebKit:Dockerfile` via
`.github/workflows/build-reusable.yml:75-80` (the matrix row) + `release.sh`. The
EXACT effective CXXFLAGS for the shipped linux x64 prebuilt:

```
-mno-omit-leaf-frame-pointer -g -fno-omit-frame-pointer -ffunction-sections -fdata-sections
-faddrsig -fno-unwind-tables -fno-asynchronous-unwind-tables -DU_STATIC_IMPLEMENTATION=1
-march=haswell -stdlib=libstdc++
-flto=full -fwhole-program-vtables -fforce-emit-vtables
-fno-c++-static-destructors -ffile-prefix-map=/webkit/Source=vendor/WebKit/Source
[WebKit's own cmake APPENDS] -fno-exceptions -fno-rtti -fcoroutines -fno-strict-aliasing
[WebKit's own cmake SETS]    -fvisibility=hidden -fvisibility-inlines-hidden
[WebKit's own cmake PREPENDS -fasynchronous-unwind-tables, but bun's later
                             -fno-asynchronous-unwind-tables correctly wins]
[CMAKE_CXX_FLAGS_RELEASE]    -O3 -DNDEBUG=1
```

Provenance of each: `Dockerfile:4,7` (DEFAULT_CFLAGS/LTO_FLAG),
`build-reusable.yml:75-80,138` (lto_flag + MARCH_FLAG default `-march=haswell` +
RELEASE_FLAGS `-O3 -DNDEBUG=1`), `WebKitCompilerFlags.cmake:197,203-208`
(`-fno-strict-aliasing` + `-fno-exceptions -fno-rtti -fcoroutines`
force-APPENDED — so JSC/WTF are RTTI/exception-free even though bun's Dockerfile never
says so; confirms the census's "34 KB RTTI, all ICU+libstdc++"),
`OptionsJSCOnly.cmake:6-8` (hidden visibility).

A build-system bug worth landing for hygiene (0 bytes): `release.sh` passes
`--build-arg RELEASE_FLAGS=` **TWICE** (lines ~65 and ~68; the second has an `-O2`
fallback default); docker uses the LAST. Today the workflow always sets
`RELEASE_FLAGS=-O3 -DNDEBUG=1` so it is harmless, but the duplicate is a trap. Also,
`LTO_FLAG` defaults to **EMPTY** in `release.sh` — only the workflow's explicit
matrix row makes the `-lto` variant LTO. Not a bug today, but nothing protects it.

Windows is different and matters for my transfer claim:
`build-reusable.yml:171-185`: the `-lto` Windows prebuilt is
`/clang:-flto=thin /clang:-fno-split-lto-unit` — ThinLTO, **NO
`-fwhole-program-vtables`** (the file's own comment: the COFF
associative-COMDAT abort). `flags.ts:512-518` makes the same exclusion for bun's
Windows C++.

**The cmake `ENABLE_*` option table (the brief's core deliverable) is CLEAN.**
The ACTUAL `cmakeconfig.h` (same file the LTO variant uses — only LTO_FLAG in CFLAGS
differs between the lto/non-lto matrix rows, no `-D`s):

| option (the JSC-relevant subset) | value | size on the canary | verdict |
|---|---|---|---|
| ENABLE_JIT / DFG_JIT / FTL_JIT | 1/1/1 | — | required |
| ENABLE_C_LOOP | 0 | 0 symbols | clean |
| ENABLE_WEBASSEMBLY / _BBQJIT / _OMGJIT | 1/1/1 | — | all live |
| ENABLE_SAMPLING_PROFILER | 1 (x64 default, `WebKitFeatures.cmake:98`) | **46,306 B** | LIVE (`bun:jsc.profile()`, `--cpu-prof`). Do NOT touch. |
| ENABLE_REMOTE_INSPECTOR → USE_INSPECTOR_SOCKET_SERVER | 1 → 1 | `Inspector::Remote*` = **32,589 B** | LIVE (`require("bun:jsc").startRemoteDebugger` — w2 skeptic refuted removal). Do NOT touch. |
| ENABLE_RESOURCE_USAGE | 1 (unconditional, `OptionsJSCOnly.cmake:88`) | **9,260 B** | too small to act on |
| ENABLE_RELEASE_LOG | 0 | 0 | clean |
| ENABLE_UNIFIED_BUILDS | 1 | 0 (irrelevant under full LTO) | clean |
| USE_ISO_MALLOC | 1 | (libpas) | required |
| ENABLE_BUN_SKIP_FAILING_ASSERTIONS | 1 | 0 | bun-specific |
| ENABLE_FUZZILLI | 0 | 0 (FuzzerAgents are a `use*` option, = w2's K) | clean |
| ENABLE_API_TESTS / ENABLE_JAVASCRIPT_SHELL | 1 / 1 | **0 in the .a's** (separate binaries; the Dockerfile builds `--target jsc` only) | clean |
| Every WebCore-only option (VIDEO, XSLT, MATHML, GEOLOCATION, WEB_AUDIO, ...) | various ONs | **0** (`ENABLE_WEBCORE OFF`; no WebCore source is compiled) | clean |

**Conclusion of F1: NO cmake option is a lever.** Every money-item in JSC is behind a
RUNTIME `JSC::Options` Bool, which full LTO cannot fold (`g_jscConfig` is mutable for
`BUN_JSC_*` env vars — w2-jsc-upstream D11, independently confirmed). That is why
every proposal below is a per-feature compile-time `#if` gate.

**Every compile-time VALIDATION mode is ALREADY OFF** (the brief asked me to nail each):
`ENABLE_ASSERTS=AUTO` + `CMAKE_BUILD_TYPE=Release` → `NDEBUG` → `ASSERT_ENABLED 0`
(`PlatformEnable.h:62-66`, `OptionsCommon.cmake:293-301`). Therefore all 0:
`ENABLE_EXCEPTION_SCOPE_VERIFICATION` (`PlatformEnable.h:979-980`,
`= ASSERT_ENABLED || ASAN_ENABLED`), `ENABLE_DFG_DOES_GC_VALIDATION` (`:823-826`),
`ENABLE_GC_VALIDATION` (`:1010-1011`), `ENABLE_DFG_REGISTER_ALLOCATION_VALIDATION`
(`:905-906`), `ENABLE_SECURITY_ASSERTIONS` (`:534-538`), `ENABLE_JIT_OPERATION_VALIDATION`
(`:1018-1019`, Darwin-only anyway), `ENABLE_REFTRACKER` (`:695-702`),
`BUN_ENABLE_JIT_DISASSEMBLER = ASSERT_ENABLED` → `ENABLE_DISASSEMBLER 0`,
`ENABLE_ZYDIS 0` (`:773-790`). **Zero bytes in the compile-time gate space.**

### F2 — THE MAIN FINDING: a 0.571 MB "compile out the JSC debug tooling" sweep, all ONE mechanism

Five sets, all reachable ONLY through `JSC::Options` Bools that default `false`
(every default VERIFIED on the LIVE canary: `BUN_JSC_dumpOptions=3
/tmp/canary/bun-linux-x64/bun -e 1`). The **GRAND UNION, by address, is 598,554 B =
0.571 MB** at 454 unique exclusive addresses (the 5 individual sets sum to 600,682;
2,128 B of overlap is correctly not double-counted; 751 B ICF-shared with unrelated
code is correctly excluded).

| item | bytes (excl.) | addrs | root options (all `false` on the canary) |
|---|---|---|---|
| (a) Air graph-coloring register allocator | **292,211** | 194 | `airUseGreedyRegAlloc` is default **TRUE** (`OptionsList.h:516`); `airForceBriggsAllocator=false` (:512), `airForceIRCAllocator=false` (:513) |
| (b) B3 + Air + DFG IR validation | **112,681** | 23 | `validateGraph`, `validateGraphAtEachPhase` (`OptionsList.h:189-190`) |
| (c) **BytecodeDumper — 100% NEW, not in ANY prior report** | **144,950** | 195 | `dumpGeneratedBytecodes`, `dumpBytecodeAtDFGTime`, `dumpBytecodesBeforeGeneratorification`, `validateBytecode`, `dumpBytecodeLivenessResults`, `dumpDisassembly`, `useProfiler`, `useDollarVM` |
| (d) IonGraph dumper — NEW | **32,272** | 6 | `dumpIonGraph` (`OptionsList.h:663`) |
| (e) HeapVerifier — NEW | **18,568** | 37 | `verifyGC` |
| **UNION** | **598,554** | **454** | |

(xsize.py regexes, verbatim, in order:
(a) `allocateRegistersByGraphColoring|GraphColoringRegisterAllocation|Air::\(anonymous namespace\)::(AbstractColoringAllocator|ColoringAllocator|Briggs|IRC)[<(:]`
(b) `JSC::B3::\(anonymous namespace\)::Validater|JSC::B3::Air::\(anonymous namespace\)::Validater|JSC::DFG::\(anonymous namespace\)::Validate\b|JSC::B3::Air::validate\(|JSC::DFG::validate\(`
(c) `BytecodeDumper|^JSC::dumpBytecode\(|^JSC::CodeBlock::dumpBytecode\(`
(d) `IonGraph|ionGraph|appendIonGraphPass`  (e) `VerifierSlotVisitor|HeapVerifier`.)

**I am the adversarial second pass SYNTHESIS2 asked for on (a) and (b)** (its lead
#1, 0.28 MB, explicitly "not banked" because "it has had ONE rigorous pass but no
adversarial second one"). My verdict:

**(a) CONFIRMED and CORRECTED UP 59% (183 KB -> 292 KB).** SYNTHESIS2's open
question — "check whether greedy ever FALLS BACK to graph coloring before gating" —
is answered **NO**, exhaustively: `grep -rn allocateRegistersByGraphColoring` over
the whole JSC tree returns exactly the definition, the header declaration, and ONE
call site (`b3/air/AirGenerate.cpp:122`). `allocateRegistersByGreedy` likewise has
exactly ONE caller (`:120`). Both sit under a single
`if (Options::airUseGreedyRegAlloc())` dispatch. The 3,636-line
`AirAllocateRegistersByGreedy.cpp` contains ZERO references to graph coloring and
ZERO fallback/retry code paths. Only FTL and Wasm-OMG reach `AirGenerate.cpp` (the
DFG tier and BBQJIT do their own regalloc), and both hit the same one dispatch.
Every class in `AirAllocateRegistersByGraphColoring.cpp` is in an **anonymous
namespace** (internal linkage — provably unreachable from any other TU); the ONLY
external symbol is `allocateRegistersByGraphColoring(Code&)`, declared with NO export
attribute (`AirAllocateRegistersByGraphColoring.h:48`). Therefore gating the ONE call
site lets `--gc-sections` + LTO internalization strip all 292 KB transitively. The
skeptic's 183,304 B covered only `GraphColoringRegisterAllocation|
allocateRegistersByGraphColoring`; they themselves flagged that the
`ColoringAllocator<>` families would add more — the full file-scoped set is
292,211 B. (The two biggest symbols alone are
`GraphColoringRegisterAllocation::allocateOnBank<Bank 0/1>()` = 87,911 + 84,863 B,
the LTO-inlined union of the whole allocator.) I RAN
`BUN_JSC_airUseGreedyRegAlloc=0` on the shipped canary: it works (FTL compiles,
result correct) — a working, undocumented debug escape hatch.

**(b) CONFIRMED at 112,681 B** (skeptic claimed ~108 KB). I traced EVERY `validate`
call site: `AirGenerate.cpp:76,93,176`, `B3Generate.cpp:81,133`,
`B3LowerMacrosAfterOptimizations.cpp:267` (all `shouldValidateIR()`),
`B3PhaseScope.cpp:57` + `AirPhaseScope.cpp:56` (`shouldValidateIRAtEachPhase()`),
`DFGPlan.cpp:108,233,253,268,280` (`validationEnabled()`), `DFGPhase.cpp:59`,
`DFGObjectAllocationSinkingPhase.cpp:853`, `DFGCFGSimplificationPhase.cpp:249`
(`Options::validateGraphAtEachPhase()`). In release,
`DFG::validationEnabled()` (`DFGCommon.h:87-94`) is
`Options::validateGraph()||Options::validateGraphAtEachPhase()`, both runtime-false.
`WasmOMGIRGenerator.cpp:6742`'s call is `if (ASSERT_ENABLED)` — COMPILE-time 0,
already folded. `BUN_JSC_validateGraph=1` WORKS on the shipped canary (I ran it).

**(c) BytecodeDumper (144,950 B) — the new money.** The ~190 generated
`JSC::OpXxx::dump(BytecodeDumperBase<…>*,…)` methods (one per bytecode opcode, from
`generator/DSL.rb:233`) + the 11,359-B generated `JSC::dumpBytecode(...)` 200-case
switch + `CodeBlockBytecodeDumper<T>::dumpBlock/dumpGraph`. Bun's `src/` has ZERO
references. I traced ALL 11 roots; every one is behind a runtime-false option:
1. `dfg/DFGByteCodeParser.cpp:11290`: `if (Options::dumpBytecodeAtDFGTime()) [[unlikely]]`
2. `bytecode/BytecodeGeneratorification.cpp:293,301`: `Options::dumpBytecodesBeforeGeneratorification()`
3. `bytecode/CodeBlock.cpp:774`: `if (Options::dumpGeneratedBytecodes())`
4. `bytecode/CodeBlock.cpp:3472` <- `endValidationDidFail` <- `CodeBlock::validate()` <- `runtime/ScriptExecutable.cpp:406: if (Options::validateBytecode())`
5. `bytecode/BytecodeLivenessAnalysis.cpp:149` <- `dumpResults` <- `:46: if (Options::dumpBytecodeLivenessResults())`
6. `jit/JITDisassembler.cpp:135` — `JITDisassembler` is only constructed under `Options::dumpDisassembly()`
7. `profiler/ProfilerBytecodeSequence.cpp:58` — `useProfiler=false` (= w2's P3-D set)
8. `tools/JSDollarVM.cpp:2784` — `useDollarVM=false`
9. `lol/LOLJIT.cpp:287,595` — removed by SYNTHESIS2's B2 anyway
10. `dfg/DFGValidate.cpp:77` — item (b)
11. `bytecode/BytecodeGraph.h:110` — template `dump()`, ZERO instantiating callers found
The inspector (Debugger/Runtime/Heap domains) NEVER calls it; the bytecode CACHE
(`CachedTypes.cpp`, `bun build --bytecode`) is a separate serializer. NOT a live
path. `BUN_JSC_dumpGeneratedBytecodes=1` WORKS on the shipped canary (prints real
bytecode) — so like (a), it is a working but undocumented debug knob.

**(d) IonGraph (32,272 B).** Apple's SpiderMonkey-`iongraph`-format IR dumper, all
roots behind `Options::dumpIonGraph()` (`DFGPhase.h:90-91`, `DFGGraph.cpp:102`,
`B3PhaseScope.cpp:59`, `AirPhaseScope.cpp:59`,
`runtime/ProfilerSupport.cpp:205`). **(e) HeapVerifier (18,568 B)** behind `verifyGC`.

**THE PERF ARGUMENT, cited, not measured** (per the orchestrator's update). Every
byte is reached only through a `JSC::Options` Bool verified `false` at runtime on
the shipped binary. Removing never-executed code changes ZERO instructions on any
live path (strictly: it deletes the never-taken `Options::x()` load + branch + cold
tail from the ~25 live callers, a micro-improvement). The DECISIVE citation is the
maintainers' OWN existing, shipped gate — the same shape, in the same file:
`oven-sh/WebKit:Source/WTF/wtf/PlatformEnable.h:762-790`,
`#define BUN_ENABLE_JIT_DISASSEMBLER ASSERT_ENABLED`, whose comment they wrote:
*"The JIT disassembler is a debugging-only facility: it is reached solely by
diagnostic options such as dumpDisassembly ... so compile it out of release builds.
ASSERT_ENABLED is on only in debug builds, where the size cost does not matter."*
Every F2 item satisfies that sentence verbatim.

### F3 — Whole-Program Devirtualization is provably inert at the linux link (NEW; relink-only)

Nobody mentioned `-fwhole-program-vtables`/`-fforce-emit-vtables` in 29 prior units.
The chain:
1. oven-sh/WebKit `Dockerfile:4`: `ARG LTO_FLAG="-flto=full -fwhole-program-vtables
   -fforce-emit-vtables"` — the prebuilt pays the compile-side WPD cost. So does
   the ICU build (`Dockerfile:209-210` passes `$LTO_FLAG`). So does bun's own C++
   (`scripts/build/flags.ts:517`, `when: c.unix && c.lto, lang: "cxx"`).
2. `scripts/build/flags.ts:873`: `["-Wl,-mllvm,-whole-program-visibility"]`,
   **`when: c => c.darwin && c.lto`** — with the author's own explanation:
   *"without the visibility upgrade WPD only fires for classes explicitly annotated
   [[clang::lto_visibility]], i.e. never. ... Darwin only: linux is on full LTO
   where this was never enabled."*
3. **EMPIRICALLY CONFIRMED on the exact toolchain (clang++-21):**
   `clang++-21 -### -fuse-ld=lld -flto=full -fwhole-program-vtables
   -fforce-emit-vtables -O2 d.o -o d` forwards ONLY `-plugin-opt=mcpu=x86-64
   -plugin-opt=O2` to `ld.lld` — identical to the invocation WITHOUT
   `-fwhole-program-vtables`. The driver does NOT auto-forward the visibility
   upgrade. **WholeProgramDevirt never runs on the linux binary.** `ld.lld-21` DOES
   have the ELF named options `--lto-whole-program-visibility` AND
   `--lto-validate-all-vtables-have-type-infos`.
4. **THE HONEST BOUND (why this is a low-priority lead, not a banked saving):** the
   canary has only **210 `_ZTV` symbols** (grep of `/tmp/canary/nm.txt`), ~24 KB of
   vtable bytes. JSC deliberately avoids C++ virtual dispatch for the JS object
   model (`ClassInfo::methodTable`), so the devirtualizable surface is tiny. The
   size DIRECTION is also unknown (devirt enables inlining, which can grow code).

### F4 — negatives / already-done (as valuable as the positives)

**(D2, important) The ~550 KB of RELEASE_ASSERT `__FILE__`/`__PRETTY_FUNCTION__`
strings is ALREADY REMOVED by the oven-sh fork.** `Source/WTF/wtf/Assertions.h:1056-1075`
is a bun-added `CRASH_WITH_INFO` override whose comment states: *"don't materialize
__FILE__ / __PRETTY_FUNCTION__ at the ~17,000 call sites — they account for ~550 KB
of unreferenced .rodata in release builds."* I verified it on the shipped STRIPPED
canary: only **54** `vendor/WebKit/Source` path strings (3,523 B) and **106**
pretty-function-shaped `JSC::` strings (19,669 B) survive — the `DFG_CRASH`-family
macros that DO print their arguments, exactly as the comment says. Residue ~23 KB,
load-bearing for crash diagnostics. **CLOSED. No other wave-3 unit should chase the
assert-string avenue.**

**(D3) LOLJIT: the w2 skeptic missed NOTHING.** My wider regex
(`JSC::LOL::|LOLJIT|operation(ResolveScope|GetFromScope|PutToScope)ForLOL|LOLRegisterAllocator`)
= **323,024 B at 58 addresses** = exactly the skeptic's 318,943 + their 4,081 of
`operation*ForLOL`. Every other "LOL" symbol in the binary is the `lol_html` Rust
crate. B2's design is complete.

Also: every compile-time validation mode already 0 (F1 table). The WebKit cmake
option table is clean. `Wasm::B3IRGenerator`/`AirIRGenerator`/`LLIntGenerator`/
`LLIntPlan` = **0 symbols** (the old Wasm tiers are already stripped).
Exact canary sizes for the brief's three "LTO startup function" questions:
`JSC::JITThunks::initialize(VM&)` = 211,699 B @ 0x407efa0 (w2 REFUTED the
over-inlining claim; accept), `JSC::JSGlobalObject::init(VM&)` = 99,581 B,
`Zig::GlobalObject::addBuiltinGlobals(VM&)` = 48,121 B — handed to w3-lto-pipeline.

---

### proposals

### P1 — id: `webkit/bun-enable-jsc-debug-tooling` (the headline)

- **saving_mb: 0.571** (linux). Derivation: the GRAND UNION over
  `/tmp/canary/nm-dem.txt` of the 5 regexes in F2, deduplicated BY ADDRESS,
  counting an address only when EVERY symbol at it matches =
  **598,554 B / 1,048,576 = 0.5708 MB** (454 addresses; the naive per-set sum
  would be 600,682 B and 751 B of ICF-shared bytes are correctly excluded).
  Systematic uncertainty: the graph-coloring set contains ~15-25 KB of
  identical-modulo-relocation `ColoringAllocator<>` template PAIRS that
  `--icf=all` (SYNTHESIS2 row 5, "land first") could fold; if icf=all lands
  before this, subtract up to 0.025. Conservative band: **0.546-0.571 MB.**
  Breakdown: (a) graph-coloring regalloc 292,211 | (b) IR validation 112,681 |
  (c) BytecodeDumper 144,950 | (d) IonGraph 32,272 | (e) HeapVerifier 18,568.
- **how much is NEW vs SYNTHESIS2:** (a)+(b) CORRECT its un-banked lead #1 from
  0.28 up to 0.405; (c)+(d)+(e) = **0.186 MB that no prior unit or skeptic
  mentions at all.** The entire 0.571 is disjoint (regex-verified) from EVERY
  banked SYNTHESIS2 Tier-A/B row, from B2 (LOLJIT), from C1 (Temporal), and
  from the 8 w2-P3 residuals (Profiler, disasm wrappers, JITDump, Options
  descriptions, ICStats, DollarVM, Fuzzer).
- **confidence:** HIGH. Every byte count is address-exclusive and reproducible
  from the script; every root is traced to a named `Options::X()` read whose
  default I verified on the LIVE shipped canary; the mechanism (a never-true
  runtime bool full LTO cannot fold) is w2's independently-confirmed D11.
- **risk:** LOW. Same regression class as the already-banked B2 (LOLJIT) and as
  the maintainers' own shipped BUN_ENABLE_JIT_DISASSEMBLER.
- **perf:** neutral (strictly, a micro-improvement: ~25 live functions lose a
  never-taken `Options::x()` load+branch+cold-tail). **Citation, not a
  benchmark:** `PlatformEnable.h:762-772`, the maintainers' own words for the
  identical pattern. Every removed byte sits behind an `if` on a runtime Bool
  that is `false` on the shipped binary (proof: `BUN_JSC_dumpOptions=3`).
- **regression (precise):** these WORKING-today but undocumented `BUN_JSC_*`
  env vars become no-ops on the RELEASE build (they still work on debug builds,
  because the default is `ASSERT_ENABLED`): `airUseGreedyRegAlloc=0`,
  `airForceBriggsAllocator`, `airForceIRCAllocator`, `validateGraph`,
  `validateGraphAtEachPhase`, `validateBytecode`, `dumpGeneratedBytecodes`,
  `dumpBytecodeAtDFGTime`, `dumpBytecodesBeforeGeneratorification`,
  `dumpBytecodeLivenessResults`, `dumpIonGraph`, `verifyGC`. NONE is documented
  by bun; NONE is a user feature. I ran three of them on the shipped canary to
  prove they work today (so the description is honest), and the counter-precedent
  is that the maintainers already accepted exactly this for the Zydis
  disassembler (per their own comment) and for LOLJIT (SYNTHESIS2 Tier-B row B2).
- **windows:** yes, ~0.57 (same source, same `OptionsList.h` platform-independent
  defaults, same `ASSERT_ENABLED=0`; SYNTHESIS2's empirical windows/linux .text
  transfer ratio is 1.026; `/OPT:REF` removes the orphaned functions under the
  Windows ThinLTO prebuilt). Windows is already solved; credit 0 on its ledger.
- **files / CHANGE (all in oven-sh/WebKit; copy-pasteable):**
  1. `Source/WTF/wtf/PlatformEnable.h` — immediately after the existing
     `BUN_ENABLE_JIT_DISASSEMBLER` block (after line ~790), add ONE sibling with
     the same comment shape:
     ```c
     /* Like BUN_ENABLE_JIT_DISASSEMBLER above: JSC's IR validaters
        (JSC_validateGraph*), the bytecode dumper (JSC_dumpGeneratedBytecodes,
        JSC_dumpBytecodeAtDFGTime, ...), the Air graph-coloring register
        allocator (the greedy allocator replaced it; it is only reachable via
        JSC_airUseGreedyRegAlloc=0), the iongraph dumper (JSC_dumpIonGraph),
        and the heap verifier (JSC_verifyGC) are debugging-only facilities
        reached solely by diagnostic options. Compile them out of release
        builds. Define BUN_ENABLE_JSC_DEBUG_TOOLING=1 to force them back on. */
     #if !defined(BUN_ENABLE_JSC_DEBUG_TOOLING)
     #define BUN_ENABLE_JSC_DEBUG_TOOLING ASSERT_ENABLED
     #endif
     ```
  2. **(a, 292 KB, ONE call site)** `Source/JavaScriptCore/b3/air/AirGenerate.cpp:119-122`:
     ```cpp
     #if BUN_ENABLE_JSC_DEBUG_TOOLING
         if (Options::airUseGreedyRegAlloc())
             allocateRegistersByGreedy(code);
         else
             allocateRegistersByGraphColoring(code);
     #else
         allocateRegistersByGreedy(code);
     #endif
     ```
     (Nothing else is needed: every class in
     `AirAllocateRegistersByGraphColoring.cpp` is in an anonymous namespace and
     `allocateRegistersByGraphColoring` has no other caller and no export
     attribute, so `--gc-sections` + LTO internalization strip all 194 addresses.
     Optional belt-and-suspenders: `#if BUN_ENABLE_JSC_DEBUG_TOOLING`-wrap the
     body of `AirAllocateRegistersByGraphColoring.cpp` so the prebuilt `.a` is
     also smaller — needed for correctness on neither platform.)
  3. **(b, 113 KB, make the predicates compile-time false)**
     `Source/JavaScriptCore/b3/B3Common.cpp:59-67`:
     ```cpp
     bool shouldValidateIR()
     {
     #if !BUN_ENABLE_JSC_DEBUG_TOOLING
         return false;
     #else
         return DFG::validationEnabled() || shouldValidateIRAtEachPhase();
     #endif
     }
     bool shouldValidateIRAtEachPhase()
     {
     #if !BUN_ENABLE_JSC_DEBUG_TOOLING
         return false;
     #else
         return Options::validateGraphAtEachPhase();
     #endif
     }
     ```
     `Source/JavaScriptCore/dfg/DFGCommon.h:87-94` (`validationEnabled()`): the
     same `#if !BUN_ENABLE_JSC_DEBUG_TOOLING return false;` prelude. The 3
     remaining direct sites — `DFGPhase.cpp:58-60`,
     `DFGObjectAllocationSinkingPhase.cpp:853`, `DFGCFGSimplificationPhase.cpp:249` —
     change `Options::validateGraphAtEachPhase()` to the now-constant
     `B3::shouldValidateIRAtEachPhase()` (or the same 2-line `#if`). The compiler
     folds every `if (false) validate(...)`; `--gc-sections` strips the 23
     orphaned validater bodies (the biggest: `B3::(anon)::Validater::run()`
     48,865 B, `DFG::(anon)::Validate::validate()` 28,017 B, `::validateCPS()`
     14,140 B, its `clobberize<Validate...>` instance 12,770 B).
  4. **(c, 145 KB, ONE function body)**
     `Source/JavaScriptCore/bytecode/BytecodeDumper.cpp:102-106`, the body of
     `template<class Block> void BytecodeDumper<Block>::dumpBytecode(Block*,
     PrintStream& out, const JSInstructionStream::Ref& it, const ICStatusMap&)`:
     ```cpp
     #if BUN_ENABLE_JSC_DEBUG_TOOLING
         /* ...the existing body (calls ::JSC::dumpBytecode, the generated
            200-case switch that roots all ~190 OpXxx::dump methods)... */
     #else
         out.print("[", it.offset(), "] <bytecode text compiled out; rebuild with BUN_ENABLE_JSC_DEBUG_TOOLING=1>");
         UNUSED_PARAM(block); UNUSED_PARAM(statusMap);
     #endif
     ```
     Same 4-line treatment on the `CodeBlockBytecodeDumper<Block>::dumpBlock/
     dumpGraph` bodies in the same file (they also walk the opcode table). Every
     one of the 11 callers keeps compiling; the 195 orphaned generated
     `OpXxx::dump` addresses get `--gc-sections`'d.
  5. **(d, 32 KB)** `runtime/ProfilerSupport.cpp:203-206`
     (`dumpIonGraphFunction` — `#if`-stub the body), `dfg/DFGGraph.cpp:102`,
     `dfg/DFGPhase.h:90`, `b3/B3PhaseScope.cpp:59`, `b3/air/AirPhaseScope.cpp:59`
     (each `if (Options::dumpIonGraph())` becomes
     `if (BUN_ENABLE_JSC_DEBUG_TOOLING && Options::dumpIonGraph())`).
  6. **(e, 19 KB)** `heap/HeapVerifier.cpp`: `#if BUN_ENABLE_JSC_DEBUG_TOOLING`
     the TU body + the `Options::verifyGC()` root in `heap/Heap.cpp`.
  7. **bun side:** bump `scripts/build/deps/webkit.ts:10 WEBKIT_VERSION`. No
     `-D` is needed (the PlatformEnable default does the work), which is exactly
     how `BUN_ENABLE_JIT_DISASSEMBLER` ships today.
- **effort:** medium (6 files in one repo, one coherent commit, one mechanism).
  (a) and (c) are ~5 lines each and are 75% of the bytes; ship them first if
  splitting.
- **relink_only: NO** — one oven-sh/WebKit prebuilt rebuild + one pin bump.
  **Batches into the SAME rebuild as SYNTHESIS2's ENTIRE Tier B (B1-B9, 1.18 MB)
  and C1 — one rebuild, not twelve.**

### P2 — id: `webkit/lto-whole-program-visibility-linux` (a relink-only EXPERIMENT, not a banked number)

- **saving_mb: UNKNOWN SIGN — not banked. Request ONE relink.** I will not
  invent a number: whole-program devirtualization shrinks virtual-call sites and
  kills vtable-only-reachable functions, but also enables inlining of the newly
  direct calls, which grows code. The only honest bound I CAN derive from the
  canary is the CEILING of the virtual-dispatch surface: **210 `_ZTV` symbols,
  ~24 KB of vtable bytes** — so the upside is TENS of KB at most, not MB. JSC
  does not use C++ virtuals for the JS object model.
- **WHY IT IS STILL WORTH ONE RELINK (minutes):** (1) it is PROVABLY not running
  today — I verified on the exact clang-21 driver that `-fwhole-program-vtables`
  at link does NOT forward `whole-program-visibility` to ld.lld, confirming the
  `flags.ts:873` author's own "this was never enabled [on linux]" comment; (2)
  BOTH repos already pay the compile-side cost for nothing (the type metadata is
  already in every shipped `.o` and `.a`, so this reaches the LTO backend with
  ZERO recompilation); (3) the perf direction is neutral-or-improvement by
  construction (indirect -> direct calls); (4) the maintainers already ship the
  identical assumption on macOS (flags.ts:863-871: *"A static executable that
  only dlopens C-ABI addons (NAPI) satisfies the whole-program assumption"*).
- **confidence in the MECHANISM:** HIGH (empirical). **In the magnitude:** NONE —
  it is an experiment.
- **risk:** MEDIUM. The one linux-specific difference from the shipped macOS
  config is that linux statically links the NATIVE (non-bitcode) `libstdc++.a`
  into the same LTO unit. `ld.lld-21` ships
  `--lto-validate-all-vtables-have-type-infos` for exactly this case; it MUST be
  added alongside, and the FULL test suite (not a smoke test) must run on the
  relinked binary before it ships.
- **perf:** neutral or improvement (devirtualization). Citation: the flags.ts
  author's own comment, already shipped on macOS.
- **regression:** none user-visible if the test suite passes.
- **windows:** N/A (the Windows prebuilt never passes `-fwhole-program-vtables`;
  `flags.ts:512-516` documents the COFF associative-COMDAT blocker).
- **files / CHANGE:** `scripts/build/flags.ts:873` — extend the existing
  `-Wl,-mllvm,-whole-program-visibility` entry's `when: c => c.darwin && c.lto`
  with a sibling ELF entry:
  ```ts
  {
    // ld.lld (ELF) has the named options ld64.lld lacks. Must be paired with
    // --lto-validate-all-vtables-have-type-infos: linux statically links the
    // NATIVE libstdc++.a into the LTO unit.
    flag: ["-Wl,--lto-whole-program-visibility", "-Wl,--lto-validate-all-vtables-have-type-infos"],
    when: c => c.linux && c.lto,
    desc: "Whole-program devirtualization at link time (the compile-side -fwhole-program-vtables metadata is already emitted and otherwise unused)",
  },
  ```
- **effort:** small (one flags.ts entry).
- **relink_only: YES — MINUTES.** This is the unique relink-only experiment of
  the whole unit. **If the measured delta is not a clear win, go to P3 instead.**

### P3 — id: `webkit/remove-inert-wpd-flags` (the converse of P2; 0 bytes, hygiene)

- **saving_mb: 0.00** (explicitly). `-fforce-emit-vtables` emits
  `available_externally` vtables that never reach the binary, and
  `-fwhole-program-vtables`' type metadata is bitcode-only. They cost LTO bitcode
  size and link TIME, not binary bytes.
- **why propose it:** if P2 is NOT taken, these flags are load-bearing-looking,
  dual-maintained-across-two-repos no-ops that have already misled one build-
  system author into writing the flags.ts:863 comment. Delete them from
  `scripts/build/flags.ts:517`, `oven-sh/WebKit:Dockerfile:4` (`ARG LTO_FLAG`),
  the ICU block at `Dockerfile:209-210`, and the 3 linux `lto_flag:` matrix rows
  in `.github/workflows/build-reusable.yml:63,75,87` (+ the 3 musl rows). Also
  fix the duplicate `--build-arg RELEASE_FLAGS=` in `release.sh`.
- perf neutral (provably 0 executed instructions change). windows N/A. effort
  small. relink_only N/A. **Mutually exclusive with P2 — land exactly one.**

---

### dead_ends

- **The entire WebKit cmake `ENABLE_*` option space is CLEAN (0 bytes).** Every
  option in the shipped prebuilt's actual `cmakeconfig.h`
  (`/root/.bun/build-cache/webkit-c9ad5813fd23bd8b/include/cmakeconfig.h`) is
  correct, LIVE, or gates nothing in a JSCOnly build. The brief's premise ("a
  build option nobody chose") has NO instance in the cmake layer. The money is
  100% in the RUNTIME `JSC::Options` layer (F2), exactly as w2's D11 predicted.
- **Every compile-time VALIDATION/VERIFICATION mode is already 0 in Release.**
  `ASSERT_ENABLED=0` via `ENABLE_ASSERTS=AUTO` + `NDEBUG`; therefore
  `EXCEPTION_SCOPE_VERIFICATION`, `DFG_DOES_GC_VALIDATION`, `GC_VALIDATION`,
  `DFG_REGISTER_ALLOCATION_VALIDATION`, `SECURITY_ASSERTIONS`,
  `JIT_OPERATION_VALIDATION`, `REFTRACKER`, `DISASSEMBLER`, `ZYDIS` are ALL 0.
  Exact lines in F1. Nothing to do.
- **The RELEASE_ASSERT `__FILE__`/`__PRETTY_FUNCTION__` string avenue (~550 KB)
  is ALREADY DONE** by `Source/WTF/wtf/Assertions.h:1056-1075` (a bun-added
  `CRASH_WITH_INFO` override, active on linux). Measured residue on the shipped
  STRIPPED canary: 54 path strings (3,523 B) + 106 pretty-function strings
  (19,669 B), all from the `DFG_CRASH`-family macros that DO print and are
  load-bearing for crash diagnostics. ~23 KB ceiling. CLOSED — and no other
  wave-3 unit should rediscover it as "free".
- **LOLJIT: the w2 skeptic missed nothing.** 323,024 B at 58 addresses, exactly
  their number. Every other "LOL" symbol is `lol_html`.
- **`DFG::Graph::dump` / `DFG::Node::dump` (56,559 B) is NOT removable.** It is
  reached from `DFG_CRASH` / `Graph::handleAssertionFailure`, the RELEASE_ASSERT
  path of the LIVE DFG. Do not sweep it into P1.
- **`ENABLE_SAMPLING_PROFILER` (46,306 B) and `ENABLE_REMOTE_INSPECTOR` /
  `USE_INSPECTOR_SOCKET_SERVER` (32,589 B) are LIVE** (`bun:jsc.profile()`,
  `--cpu-prof`, `bun:jsc.startRemoteDebugger` — the last one already refuted by
  the w2 skeptic). Sized, per the brief; do NOT touch.
- `ENABLE_RESOURCE_USAGE` (unconditionally ON, `OptionsJSCOnly.cmake:88`) is
  only 9,260 B. Below the effort floor.
- `Wasm::B3IRGenerator`/`AirIRGenerator`/`LLIntGenerator`/`LLIntPlan`: 0 symbols
  — the old Wasm tiers are already stripped upstream. Nothing to do.
- Frontend `-O3` -> `-O2` on the prebuilt: confirmed from the workflow matrix;
  still w2's D7, perf-unprovable, perf-locked. Dead.
- The JSC Options DESCRIPTION strings (15,117 B) + the 8-B desc-pointer column
  of the 536-row `g_constMetaData` (~4.3 KB): already w2's finding; too small
  and the parser code around it (`setOptionWithoutAlias` 43 KB + the init
  lambda 49 KB) IS the LIVE `BUN_JSC_*` feature. Nothing new here.
- `JITThunks::initialize` (211,699 B): w2's refutation of the over-inlining
  claim is structurally sound; I found nothing to contradict it. Dead.

### overlaps

- **P1 is fully disjoint from every banked SYNTHESIS2 row** — verified by regex
  against B2 (LOLJIT), C1 (Temporal), B3 (icu_75::), and the 8 w2-P3 residuals
  (`JSC::Profiler::`, `*Disassembler`, JITDump/GdbJIT, Options descriptions,
  ICStats, DollarVM, FuzzerAgents). P1 SUBSUMES and corrects SYNTHESIS2's
  un-banked lead #1 (0.28 -> 0.405) and adds 0.186 MB more. Land it in the
  SAME oven-sh/WebKit prebuilt rebuild + `scripts/build/deps/webkit.ts:10` pin
  bump as Tier B (B1-B9) and C1 — ONE rebuild.
- **icf=all interaction (SYNTHESIS2 cross-cutting fact #2):** ~15-25 KB of P1(a)
  is icf=ALL-foldable `ColoringAllocator<>` pairs. If row 5 lands first (as
  instructed), deduct up to 0.025 from P1. Already reflected in my band.
- **w3-lto-pipeline** owns the `JSGlobalObject::init` (99,581 B) /
  `addBuiltinGlobals` (48,121 B) over-inlining question; I provide the exact
  canary sizes.
- **w3-cpp-compile-flags** owns `flags.ts`; the WPD finding (P2/P3) straddles
  both repos, but the ROOT is the WebKit Dockerfile's LTO_FLAG so I claim it.
  They should NOT double-count it.
- **w3-binary-archaeology**: the `vendor/WebKit/Source` string count (54 / 3,523 B)
  and the `_ZTV` census (210 / ~24 KB) are handed over as closed books.

### THE BOTTOM LINE (for the synthesizer)

SYNTHESIS2's linux verdict was: Tier A (3.03) + Tier B (1.18) = **4.21 MB**,
shortfall **0.65** vs the 4.86 need, reachable only with two Tier-C feature
removals. **P1 alone adds 0.571 MB of skeptic-methodology, zero-tradeoff,
one-rebuild Tier-B money** (0.546 conservative). New ledger:
**A + B + P1 = 4.78 MB (0.08 short) — and with the one benchmark-gated
A-row (share-generics, 0.25, a validation the maintainers are now doing
themselves) it is 5.03 > 4.86. The linux target is reached from Tier A + Tier B
+ P1 alone, with NO Tier-C feature removal.** That, plus the fact that P1 is
the same mechanism the maintainers already invented and shipped themselves
(`BUN_ENABLE_JIT_DISASSEMBLER`), is this unit's contribution.
