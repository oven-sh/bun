## REPORT

### unit: w3-lto-pipeline

---

### findings

All numbers are ADDRESS-DEDUPED (wave-2's counting lesson applied throughout:
`nm --size-sort --print-size --radix=d --demangle`, keep one record per unique
address, THEN aggregate). Two binaries were compared symbol-by-symbol:

- **LTO (the real shipped canary)**: `/tmp/canary/bun-linux-x64-profile/bun-profile`
  (revision `1.4.0-canary.1+eba370b69`), its `nm-dem.txt` (80,291 symbols,
  60,385 unique text addresses).
- **non-LTO reference**: `/workspace/bun/build/release/bun-profile` (revision
  `1.4.0-canary.1+d816daf47`) + my `nm` of it at
  `/tmp/w3-lto-pipeline/nm-local-dem.txt` (109,103 lines, 80,272 unique text
  addresses). I VERIFIED it is non-LTO three independent ways:
  `build/release/configure.json` = `{"profile":"release"}` (profiles.ts:133
  `lto:false`), `grep -c flto build/release/build.ninja` = **0**, and its
  stripped `bun` is 73,235,984 B vs the canary's 76,889,912 B (the +3.65 MB
  delta IS size-facts' "LTO GREW .text by ~3.5 MB").
- **CAVEAT carried through every per-symbol number below**: the two builds are
  **7 commits apart** (`git log --oneline d816daf47..eba370b69` = 7; 97 files).
  **None of the 7 touches `scripts/build/deps/webkit.ts`**, so the WebKit
  prebuilt COMMIT is identical and every JSC/WTF/WebCore per-symbol comparison
  is valid. The **Rust** bucket IS contaminated (PR #33032, the SIMD JSON
  rewrite) — I quantify that below and do not draw Rust conclusions from it.

#### F1. The exact LTO topology of the shipped linux binary (nobody had established this)

- The canary's linker map attributes **89,562 input sections to exactly ONE
  object: `bun-profile.lto.o`**. There is **NO ThinLTO partition** and **ONE
  regular (full) LTO partition** (`--lto-partitions=1`, the default). The only
  non-LTO inputs are libstdc++/libgcc archive members and the one deliberate
  `-fno-lto` exception, `src/jsc/bindings/workaround-missing-symbols.cpp`
  (`flags.ts:1535-1543`, an LLD-21 `@GLIBC` parse bug workaround).
  - Corollary: the 89,562 sections prove the LTO CODEGEN runs with
    `-ffunction-sections/-fdata-sections` (so `--icf` and `--gc-sections`
    work at function granularity on the LTO output). Confirms GT#5.
- Everything is in that one partition: bun's C++ (`-flto=full`,
  `flags.ts:496-498`), the ENTIRE Rust workspace (one fat, summary-less
  regular-LTO bitcode module via `CARGO_PROFILE_RELEASE_LTO=fat` +
  `-Clinker-plugin-lto`, `rust.ts:592-636,716-732`), AND the
  `bun-webkit-linux-amd64-lto` prebuilt (JSC/WTF/ICU as bitcode). The
  `flags.ts:480-498` comment is the load-bearing design fact: **linux is
  deliberately full (not thin) LTO because the ThinLTO backend miscompiles
  JSC** ("bun -e 'require(\"axobject-query\")' failing in the DFG tier").
- The CI toolchain is **LLVM 21.1.8** (`scripts/build/tools.ts:267`), which is
  EXACTLY the `/usr/lib/llvm-21` installed here — so every pass-pipeline /
  cl::opt default below is authoritative, not from memory.
- Levels: per-TU compile is **-O3** (`flags.ts:272`); the link passes **-O2**
  (`flags.ts:894`) → lld `--lto-O2` + `--lto-CGO2`
  (`CodeGenOptLevel::Default`). So the LTO IR pipeline is
  `buildLTODefaultPipeline(O2)` and the LTO CODEGEN is the SIZE-FRIENDLIER
  level vs the per-TU -O3 codegen (see F5).

#### F2. The authoritative LLVM-21.1.8 LTO inliner defaults (from `opt-21 --print-all-options`)

| cl::opt | default | meaning |
|---|---|---|
| `inline-threshold` | **225** | the LTO-O2 global threshold |
| `inlinehint-threshold` | **325** | callees with the `inlinehint` attr (the C++ `inline` keyword / in-class defn) |
| `inlinecold-threshold` | **45** | callees with `__attribute__((cold))` |
| `inline-cold-callsite-threshold` | **45** | call SITES the static BFI classifies cold |
| `cold-callsite-rel-freq` | **2** (%) | the static coldness criterion |
| `hot-callsite-threshold` | 3000 | **PGO-only** (never fires — no PGO in CI) |
| `locally-hot-callsite-threshold` | 525 | **O3-only** (`getInlineParams` only sets it at OptLevel>2; LTO is O2 → never fires) |
| `inline-instr-cost`/`inline-call-penalty` | 5 / 25 | |
| `enable-partial-inlining` / `hot-cold-split` / `enable-merge-functions` / `inline-deferral` | **0 / 0 / 0 / 0** | none run |
| `funcspec-max-clones` / `funcspec-min-function-size` | 3 / 500 | (moot — see F6) |
| `unroll-threshold-default` | 150 | O2 unroll threshold |
| `InlineConstants::OptAggressiveThreshold` (compile -O3) | **250** | `llvm/Analysis/InlineCost.h:46` |
| `InlineConstants::LastCallToStaticBonus` | **15000** | the body-relocation mechanism (F4) |

Minor doc bug: `flags.ts:904` says the -O3 inline threshold is "275"; LLVM
21's `InlineCost.h:46` says `OptAggressiveThreshold = 250`. Zero bytes; worth
fixing so nobody calibrates from the comment.

#### F3. The authoritative `lto<O2>` pass pipeline for LLVM 21.1.8 (from `opt-21 -passes='lto<O2>' -print-pipeline-passes`)

78 passes. The ones that matter:
`globaldce<vfe-linkage-unit-visibility>` (runs **3x**), `ipsccp` (bare — **no
`<func-spec>`**), `wholeprogramdevirt`, `globalsplit`, `globalopt`,
`constmerge`, `deadargelim`, `cgscc(inline<only-mandatory>, inline)` (ONE
inliner visit), `loop-unroll-full`, `loop-vectorize`, `loop-unroll<O2>`,
`slp-vectorizer`, `simplifycfg<switch-to-lookup;hoist-common-insts;sink-common-insts>`,
`lowertypetests` (2x), `elim-avail-extern`, `rel-lookup-table-converter`.
**NOT present: `forceattrs`, `mergefunc`, `hotcoldsplit`, `partial-inliner`,
any function-specialization.** The `lto-pre-link<O3>` (per-TU) pipeline DOES
contain `forceattrs` (relevant to one footnote below) and also bare `ipsccp`.

#### F4. THE CENTRAL MEASUREMENT: the per-symbol LTO-vs-non-LTO ledger (the first anyone has produced)

```
                               LTO (canary)          non-LTO (local)
unique text addresses               60,385                80,272
nm .text sum                    54,292,438 B          50,985,516 B
.text section (readelf -S)      54,846,298 B          51,681,676 B
NET LTO .text growth           +3,306,922 B (nm) / +3,164,622 B (section) = +3.15 MiB
.rodata section                 21,623,360 B          20,582,968 B   (+1.04 MiB)
nm-sum vs section GAP (= alignment padding)  553,860 B     696,160 B
```
Decomposition of the +3.31 MiB:
- **21,755 symbols (9.60 MiB) exist ONLY in the non-LTO build** — their
  bodies were absorbed by LTO's cross-TU inlining (or DCE'd by LTO's
  internalization+globaldce) and deleted.
- **1,974 symbols (1.06 MiB) exist ONLY in the LTO build** — mostly the Rust
  commit-skew (same function, different crate-disambiguator hash: e.g.
  `PackageJSON::parse::<Local>` appears in BOTH "only" lists, 19,542 B
  non-LTO-only / 17,283 B LTO-only). **The Rust bucket's numbers below are
  contaminated and I do not rely on them.**
- **The 57,089 SHARED symbols GREW by +12.26 MiB.**
- ⇒ `growth_of_survivors (12.26) − deleted_bodies (9.60) + new (1.06) = +3.31`.
  The TRUE, irreducible inliner DUPLICATION excess (growth beyond simply
  relocating the deleted bodies into their callers) is **~+2.7 MiB**.

Correctly-bucketed NET LTO growth (namespace resolved BEFORE the `(` so
return-type-prefixed names — `void JSC::...` — land in the right bucket; this
bug over-places ~2 MB into "other" otherwise, exactly as size-facts warned):

| bucket | sharedΔ | nonLTO-only | LTO-only | **NET Δ** | LTO total |
|---|---:|---:|---:|---:|---:|
| JSC (core) | +4,363,842 | −3,463,685 | +128,975 | **+1,029,132** | 10,853,778 |
| WebCore | +1,688,094 | −681,928 | +19,877 | **+1,026,043** | 3,072,803 |
| rust (SKEWED) | +1,222,184 | −687,801 | +235,875 | +770,258 | 18,399,714 |
| JSC::DFG | +963,723 | −643,576 | +80,640 | **+400,787** | 3,723,050 |
| Bun:: | +449,202 | −231,602 | +1,811 | +219,411 | 1,411,852 |
| JSC::Wasm | +361,677 | −298,976 | +117,343 | +180,044 | 1,837,307 |
| JSC::FTL | +148,485 | −38,063 | +3,085 | +113,507 | 924,993 |
| JSC::LOL | +232,310 | −132,812 | +1,614 | +101,112 | 279,282 |
| Zig:: | +100,938 | −28,601 | +946 | +73,283 | 226,967 |
| icu_ | +341,898 | −285,995 | +5,007 | +60,910 | 1,017,083 |
| JSC::Yarr | +249,633 | −201,248 | +732 | +49,117 | 572,691 |
| Inspector | +146,064 | −119,286 | +4,944 | +31,722 | 378,000 |
| JSC::B3 | +413,406 | −415,632 | +15,082 | **+12,856** (≈flat!) | 1,799,511 |
| bmalloc/pas_ | | | | −15,697 | 134,997 |
| WTF | +310,555 | −549,701 | +148,372 | **−90,774** | 1,395,914 |
| plain-C (deps) | +1,233,588 | −2,232,791 | +344,414 | **−654,789** | 8,264,496 |
| **TOTAL** | +12,264,528 | −10,066,393 | +1,108,787 | **+3,306,922** | 54,292,438 |

**LTO SHRINKS all of the plain-C deps (−0.65 MiB), WTF (−0.09), bmalloc, and
leaves B3 flat. The growth is JSC+WebCore+DFG.**

#### F5. THE BRIEF'S DELIVERABLE — the 30-largest canary .text symbols, classified

`(a)` = inherent, `(b)` = LTO over-inlining of a ONE-SHOT/COLD fn,
`(c)` = legitimate hot-path inlining, `(DEAD)` = already a SYNTHESIS2 row.

| # | LTO B | non-LTO B | Δ | symbol | class |
|--:|--:|--:|--:|---|---|
| 1 | 211,699 | 20,490 | +191,209 | `JSC::JITThunks::initialize(VM&)` | (b) one-shot VM init |
| 2 | 152,875 | 17,905 | +134,970 | `JSC::LOL::LOLJIT::privateCompileMainPass()` | DEAD (SYNTH2 B2) |
| 3 | 147,592 | 110,613 | +36,979 | `JSC::DFG::ByteCodeParser::parseBlock` | (c) hot DFG |
| 4 | 125,542 | 8,409 | +117,133 | `JSC::JIT::privateCompileMainPass()` | (c) hot baseline JIT |
| 5 | 106,449 | 13,108 | +93,341 | `JSC::LOL::LOLJIT::privateCompileSlowCases()` | DEAD (SYNTH2 B2) |
| 6 | 99,581 | 38,130 | +61,451 | `JSC::JSGlobalObject::init(VM&)` | (b) one-shot |
| 7 | 93,860 | 104,485 | **−10,625** | `WebCore::BunBuiltinNames::BunBuiltinNames(VM&)` | (b); LTO SHRANK it. SYNTH2 row 14 owns it |
| 8 | 93,716 | 96,631 | −2,915 | `encode_one_block` (libjpeg) | (a) |
| 9 | 93,329 | **435** | +92,894 | `JSC::typedArrayViewProtoFuncFilter` | (a) — see F7 |
| 10 | 87,911 | 83,434 | +4,477 | `B3 GraphColoringRegisterAllocation::allocateOnBank<0>` | DEAD (SYNTH2 §E.1) |
| 11 | 84,863 | 79,749 | +5,114 | `... ::allocateOnBank<1>` | DEAD (SYNTH2 §E.1) |
| 12 | 63,871 | 8,586 | +55,285 | `JSC::JIT::privateCompileSlowCases()` | (c) |
| 13 | 61,790 | 87,398 | **−25,608** | `Wasm::FunctionParser<BBQJIT>::parseExpression` | (a); LTO SHRANK it |
| 14 | 59,084 | 43,080 | +16,004 | `JSC::BytecodeIntrinsicRegistry::BIR(VM&)` | (b) one-shot |
| 15 | 57,189 | 435 | +56,754 | `JSC::typedArrayViewProtoFuncToSorted` | (a) — F7 |
| 16 | 56,078 | 58,580 | −2,502 | `DFG::AbstractInterpreter<InPlace>::executeEffects` | (c) |
| 17 | 56,027 | 82,901 | −26,874 | `Wasm::FunctionParser<OMGIRGenerator>::parseExpression` | (a) |
| 18 | 53,838 | 49,936 | +3,902 | `bun_install::npm::PackageManifest::parse` | (a) (rust, skewed) |
| 19 | 53,484 | 56,257 | −2,773 | `DFG::AbstractInterpreter<AtTail>::executeEffects` | (c) |
| 20 | 53,422 | 51,702 | +1,720 | `bun_install::isolated_install::install_isolated_packages` | (a) |
| 21 | 52,490 | 79,645 | −27,155 | `Wasm::FunctionParser<IPIntGenerator>::parseExpression` | (a) |
| 22 | 52,130 | 41,034 | +11,096 | `bun_lock::parse_into_binary_lockfile` | (a) |
| 23 | 51,366 | 50,148 | +1,218 | `sqlite3VdbeExec` | (a) |
| 24 | 51,268 | **597** | +50,671 | `JSC::B3::generateToAir(Procedure&)` | (c) hot B3 |
| 25 | 51,126 | 435 | +50,691 | `JSC::typedArrayViewProtoFuncSort` | (a) — F7 |
| 26 | 49,954 | 51,569 | −1,615 | `JSC::B3::Air::Inst::generate` | (c) |
| 27 | 48,865 | 54,127 | −5,262 | `JSC::B3::(anon)::Validater::run()` | DEAD (SYNTH2 §E.1) |
| 28 | 48,719 | 57,229 | −8,510 | `JSC::Options::initializeWithOptionsCustomization::$_0` | (b) one-shot, LTO SHRANK it |
| 29 | 48,121 | 12,219 | +35,902 | `Zig::GlobalObject::addBuiltinGlobals(VM&)` | (b) one-shot (bun src) |
| 30 | 47,764 | 12,686 | +35,078 | `WebCore::ReadableStreamInternalsBuiltinFunctions::init` | (b) one-shot |
| 31 | 47,625 | 48,505 | −880 | `JSC::B3::(anon)::ReduceStrength::reduceValueStrength()` | (c) |
| 32 | 45,671 | 72,857 | −27,186 | `Wasm::FunctionParser<ConstExprGenerator>::parseExpression` | (a) |
| 33 | 44,036 | 43,476 | +560 | `bun_bundler::parse_task::parse_worker::get_ast` | (c) |
| 34 | 43,367 | 55,095 | **−11,728** | `JSC::Options::setOptionWithoutAlias` | (b) one-shot, LTO SHRANK it |
| 35 | 42,976 | 11,333 | +31,643 | `EncodeStreamHook` (libjpeg) | (a) |
| 36 | 42,925 | 43,069 | −144 | `bun_js_parser::p::P<false,false>::lower_impl` | (c) |
| 37 | 42,120 | 38,188 | +3,932 | `encoding_rs::VariantEncoder::encode_from_utf8_raw` | (a) |
| 38 | 41,964 | 27,803 | +14,161 | `JSC::replaceUsingRegExpSearch` | (c) hot |
| 39 | 41,955 | 10,532 | +31,423 | `JSC::DFG::Plan::compileInThreadImpl()` | (c) |
| 40 | 41,860 | 19,838 | +22,022 | `JSC::VM::VM(VMType,HeapType,RunLoop*,bool*)` | (b) one-shot |

**THE HONEST CLASS-(b) CEILING (the brief's #3 ask). The (b) category is NOT
net size growth; it is body RELOCATION, and its ceiling as a size lever is
~0 MB.** Proof, three independent ways:
1. **Per symbol.** Row 9: `typedArrayViewProtoFuncFilter` went 435 → 93,329.
   In the non-LTO build the 108 separate `genericTypedArrayViewProtoFuncFilter<T>`
   instantiations total **132,715 B** and sit out-of-line (linkonce_odr; no
   `LastCallToStatic` bonus, cost >> 275, so the -O3 per-TU compile never
   inlines them). Under whole-program LTO they become `internal` +
   single-live-use → the **15000-point LastCallToStaticBonus**
   (`InlineCost.h:LastCallToStaticBonus`) makes the merge mandatory AND the
   originals get deleted. 435+132,715 = 133,150 before vs 93,329 after —
   **LTO made this symbol FAMILY 40 KB SMALLER.** The same shape holds for #1
   (JITThunks: its 20,490 B dispatcher + the ~80 `*ThunkGenerator(VM&)`
   single-caller bodies), #6, #24, #29, #30, #39.
2. **In aggregate.** deleted-body mass (9.60 MiB) ≈ survivor growth
   (12.26 MiB) minus the true duplication excess (2.7 MiB). The 2.7 MiB is
   **MULTI-caller** inlining (a helper under the 225/325 threshold copied
   into N>1 callers) — i.e., class (c), the normal -O2 speed/size tradeoff —
   NOT class (b).
3. **Four (b) rows LTO actually SHRANK** (rows 7, 28, 34, plus
   `Options::initializeWithOptionsCustomization`). The only way to separate
   the (b) fraction of the remaining +2.7 MiB from (c) is a PROFILE, which
   the inliner does not have (SYNTHESIS2 §E.6: PGO is not in the release
   pipeline).

This **quantitatively PROVES** SYNTHESIS2's wave-2 B6 downgrade ("the
212 KB is the single-caller callees' bodies, not duplication; outlining them
is size-NEUTRAL") for the first time, and **CLOSES its two §E.3
'need a MEASUREMENT' items**: `Zig::GlobalObject::addBuiltinGlobals`
12,219→48,121 and `JSC::JSGlobalObject::init` 38,130→99,581 are both pure
relocation. Outlining either gains ~0 bytes. Do not send anyone back there.

#### F6. The shipped binary PROVES the brief's named passes do nothing

- **`function-specialization`**: in LLVM 21 the `lto<O2>` pipeline runs plain
  `ipsccp`, NOT `ipsccp<func-spec>`. Independently: there are **0**
  `.specialized.N` symbols in the canary's 80,291. Cost: 0. Removable: 0.
- **`hot-cold-split` / `partial-inliner` / `enable-merge-functions` /
  `inline-deferral`**: all default **0** in LLVM 21.1.8 (`--print-all-options`)
  and none appear in the `lto<O2>` pipeline dump. Independently: the canary's
  30 `.cold` + 11 `.part.N` + 9 `.constprop.N` symbols are ALL from
  GCC-compiled libgcc/libstdc++ archive members (`_Unwind_*`, `basic_string`,
  the FDE btree), NOT from bun's LLVM LTO. So none of these passes ran.
  Cost: 0. Nothing to turn off.
- **machine outliner**: 0 `OUTLINED_FUNCTION` symbols (confirms
  w3-machine-outliner's starting premise).

#### F7. New measurements handed off

- **The `typedArrayViewProtoFunc*` + `genericTypedArrayView*` +
  `speciesConstruct` family totals 973,365 B = 0.93 MiB of canary .text**
  (554 unique-address symbols; non-LTO is 939,130 B in 873 symbols — LTO only
  net-grew it by 34 KB, i.e. relocation). Nobody in 2 waves has named this
  0.93 MiB as one population. It is the ≈11-element-type fan-out of JSC's
  generic `%TypedArray%.prototype` host functions. It is NOT an LTO problem
  and NOT dead code; the only fix is a JSC restructuring (type-erasing the
  element accessor), which is the SAME tradeoff wave 2's generated-classes
  unit + skeptic already (correctly) declined for bun's own classes.
  → handoff to **w3-webkit-build-options** / the synthesizer.
- **LOLJIT cross-validation + a small upgrade to SYNTHESIS2 B2**: in the
  canary, `grep JSC::LOL` (address-deduped, t+T) = **319,917 B** in 61
  symbols. B2 claims "0.30 (real ~0.32)". **319,917 B = 0.305 MB: exact
  match.** NEW fact: the non-LTO `JSC::LOL` total is only **209,790 B** (208
  symbols). LTO GREW LOLJIT by +110 KB (+52%) by inlining SHARED
  MacroAssembler/AssemblyHelpers emitter bodies into it — bodies it shares
  with the LIVE `JSC::JIT::privateCompile*`. So **B2's 0.30 is a LOWER bound
  on a real relink**: once LOLJIT is gone, any shared helper whose caller
  count drops from 2 to 1 will additionally fold into `JSC::JIT` via the
  LastCallToStatic bonus. (Do NOT re-count it; it only strengthens B2.)
- **LTO already does best-in-class vtable DCE.** Non-LTO: 2,063 `vtable for X`
  symbols, 183,664 B of slots. LTO canary: **210 vtables, 23,704 B**.
  Breakdown of the 210: 118 `std::` + 5 `__gnu_cxx` + 3 `__cxxabiv1`
  (native libstdc++, untouchable), **59 `icu_75::`**, 21 `JSC::` (the
  `B3::Value` hierarchy etc.), 3 `(anon)`, 1 `WTF::`, **ZERO `WebCore::` /
  `Bun::` / `Zig::`**. LTO + `-fwhole-program-vtables` + `wholeprogramdevirt`
  + `globaldce` already removed 87% of the vtable mass. (This is the evidence
  that kills the VFE dead end below.)
- **LTO SAVED 142 KB of function-alignment padding** (nm-sum-vs-section gap:
  553,860 B LTO vs 696,160 B non-LTO) — fewer, bigger functions.
- **LTO GREW `.rodata` by +1,040,392 B.** Heavily confounded (the #33032
  commit skew added SIMD JSON tables; the `-lto` vs native WebKit prebuilt
  differ; the LTO pipeline's `simplifycfg<switch-to-lookup>` +
  `rel-lookup-table-converter` re-run on the merged, more-inlined functions).
  → handoff to **w3-binary-archaeology**, with the confounds.

---

### proposals

> Honest framing up front: **this avenue's characterization is the value; the
> positive size inventory is small.** That is the brief's expected outcome
> ("the (b) total is this avenue's honest ceiling") and I refuse to inflate
> it. Both positive proposals are ranked below their stated point saving.

#### LP-1 — `-Wl,-mllvm,-inline-cold-callsite-threshold=0` (a RELINK-ONLY experiment, not a banked row)

- **id**: `w3-lto-pipeline/LP-1-cold-callsite-threshold`
- **saving_mb**: **UNKNOWN — cannot be derived from the symbol table**, and I
  will not fabricate a number. It MUST be measured by one relink (minutes).
  Honest reasoning for a SMALL expectation (0.00-0.10): at a statically-cold
  callsite the inliner ALREADY applies `DisallowAllBonuses()` (killing the
  15000-pt LastCallToStatic + hint + vector bonuses), so the only thing the
  remaining threshold of 45 still admits is a callee of cost <45 ≈ ≤9 IR
  instructions (`inline-instr-cost=5`), i.e. ~30-50 machine bytes. The saving
  per prevented inline is (callee bytes − ~5-15 B of call+arg setup). LLVM's
  default of 45 was already chosen to be conservative.
- **confidence**: HIGH on sign (non-negative) and perf-neutrality; **NONE on
  magnitude**.
- **risk**: none. The lever is a pure cl::opt to the LTO backend; a bad
  value is reverted by deleting one line.
- **perf**: **neutral, by the lever's own definition.** Without PGO (bun has
  none — SYNTHESIS2 §E.6, and `PSI->hasProfileSummary()` is false), LLVM
  classifies a callsite cold via the STATIC `BlockFrequencyInfo`:
  `llvm/lib/Analysis/InlineCost.cpp`, `InlineCostCallAnalyzer::isColdCallSite()`
  → `CallSiteFreq < CallerEntryFreq * BranchProbability(ColdCallSiteRelFreq=2, 100)`,
  i.e. the block executes **<2% as often as its function is entered**. It only
  gets there from frontend `llvm.expect` (JSC/WTF's `UNLIKELY()`,
  `[[unlikely]]`, `RELEASE_ASSERT` failure arms) and
  unreachable/noreturn-post-dominated blocks. A callsite at ≤2% relative
  frequency cannot be a throughput factor. LLVM's own comment at the site:
  "Do not apply bonuses for a cold callsite including the LastCallToStatic
  bonus. While this bonus might result in code size reduction, it can cause
  the size of a non-cold caller to increase." This is the maintainers'
  perf-citation; they do not need to benchmark it.
- **regression**: none (no behavior change; code at cold sites goes
  out-of-line).
- **windows**: yes in principle (`lld-link /mllvm:-inline-cold-callsite-threshold=0`
  reaches the ThinLTO backends), but credit **0** — windows is solved and the
  mechanism differs (ThinLTO there).
- **files + the exact change** (`scripts/build/flags.ts`, ONE new entry in the
  "LTO (link-side)" table immediately after the `flag: "-O2"` entry at ~:894):
  ```ts
  {
    // LTO backend cl::opt. Without PGO, a "cold callsite" is one the STATIC
    // BlockFrequencyInfo puts at <2% of its function's entry frequency
    // (cold-callsite-rel-freq=2): UNLIKELY()/[[unlikely]]/noreturn arms.
    // The default ColdCallSiteThreshold (45) still inlines <~9-instruction
    // callees there; 0 stops it. Pure size; never touches a warm callsite.
    flag: "-Wl,-mllvm,-inline-cold-callsite-threshold=0",
    when: c => c.unix && !c.darwin && c.lto && c.release && !c.smol,
    desc: "LTO: do not inline at statically-cold call sites",
  },
  ```
  (`-Wl,--plugin-opt=-inline-cold-callsite-threshold=0` is the exact
  equivalent; both verified present in LLD 21.1.8's option table.)
- **effort**: trivial (1 flag entry).
- **relink_only**: **YES** — this reaches only the LTO backend, which runs at
  link time. No bitcode changes. Minutes.

#### LP-2 — `[[clang::minsize]]` on the proven one-shot .text giants

- **id**: `w3-lto-pipeline/LP-2-minsize-one-shot`
- **saving_mb**: **0.04-0.09, point 0.05.** Derivation (all from
  `/tmp/canary/nm-dem.txt`, address-deduped): the target set — excluding
  `BunBuiltinNames` (SYNTHESIS2 row 14 owns it with a better fix) and
  excluding `JSBuiltinInternalFunctions::visit` (HOT: runs on every GC) — is
  ```
  211,699 JSC::JITThunks::initialize(VM&)
   99,581 JSC::JSGlobalObject::init(VM&)
   59,084 JSC::BytecodeIntrinsicRegistry::BytecodeIntrinsicRegistry(VM&)
   48,719 JSC::Options::initializeWithOptionsCustomization(...)::$_0::operator()()
   48,121 Zig::GlobalObject::addBuiltinGlobals(VM&)              [bun src]
   47,764 WebCore::ReadableStreamInternalsBuiltinFunctions::init  [bun codegen]
   43,367 JSC::Options::setOptionWithoutAlias(char const*, bool)
   41,860 JSC::VM::VM(VMType, HeapType, RunLoop*, bool*)
   39,075 WebCore::BunBuiltinNames::~BunBuiltinNames()
   25,196 WebCore::WritableStreamInternalsBuiltinFunctions::init  [bun codegen]
   24,541 WebCore::DOMIsoSubspaces::~DOMIsoSubspaces()
   22,290 JSC::IPInt::initialize()
   18,514 WebCore::ReadableByteStreamInternalsBuiltinFunctions::init [bun codegen]
   14,967 WebCore::JSVMClientData::JSVMClientData(VM&, ...)
  ------- = 744,778 B = 0.710 MiB of one-shot, straight-line .text
  ```
  `minsize` is worth 20-40% on LOOPY code but only **5-12%** on straight-line
  code like these (no unroll to skip; the wins are shorter encodings, no
  16-byte function/block alignment, -Oz MBB placement). 0.710 × 5-12% =
  0.036-0.085. I take the point at 0.05.
- **confidence**: LOW on magnitude. HIGH on sign and on perf-neutrality.
- **risk**: low. `minsize`'s one interaction with the LTO inliner,
  `InlineCost.cpp::updateThreshold()`:
  `if (Caller->hasMinSize()) { Threshold=min(,OptMinSizeThreshold=5);
  SingleBBBonusPercent=0; VectorBonusPercent=0;
  LastCallToStaticBonus = InlineConstants::LastCallToStaticBonus; }` —
  note the LastCallToStatic bonus is **explicitly preserved**, so the
  single-caller body-merge (F5) STILL happens. Only MULTI-caller callees stop
  being duplicated into the marked function (a further size win).
- **perf**: **neutral.** Every function in the list runs exactly once per
  `VM` / `JSGlobalObject` / process, on a path that is already doing I/O or
  mmap'ing JIT pages. The CODE THEY EMIT (JITThunks' thunks, the builtin
  functions) is DATA produced by MacroAssembler calls and is byte-for-byte
  unaffected by the generator's opt level. SYNTHESIS2 Tier-A row 12
  (`#[optimize(size)]` on cold CLI fn bodies) is the maintainer-accepted
  precedent for exactly this pattern on the Rust side.
- **regression**: none.
- **windows**: yes (`[[clang::minsize]]` works under clang-cl), same 5-12%,
  but the WebKit half needs `Dockerfile.windows`; credit **0** until measured.
- **files + change**:
  - oven-sh/bun: `src/jsc/bindings/ZigGlobalObject.cpp`
    (`Zig::GlobalObject::addBuiltinGlobals` — add `[[clang::minsize]]` to the
    definition), and the ONE codegen template that emits the per-module
    `WebCore::<Module>BuiltinFunctions::init(JSGlobalObject&)` bodies (so all
    of them get it at once).
  - oven-sh/WebKit: add a `WTF_MINSIZE` macro next to `NEVER_INLINE` in
    `Source/WTF/wtf/Compiler.h` (`#define WTF_MINSIZE [[clang::minsize]]`),
    then apply it to `JSC::JITThunks::initialize` (`jit/JITThunks.cpp`),
    `JSC::JSGlobalObject::init` (`runtime/JSGlobalObject.cpp`),
    `JSC::BytecodeIntrinsicRegistry`'s ctor, `JSC::VM::VM`,
    `JSC::Options::setOptionWithoutAlias`, `JSC::IPInt::initialize`.
- **effort**: medium (two repos; the bun half is small).
- **relink_only**: NO — a recompile of the annotated TUs + one 14-min LTO
  relink. The oven-sh/WebKit half batches into the same prebuilt rebuild
  SYNTHESIS2's Tier B already requires.

#### EXPERIMENTS the orchestrator should queue (relink-only unless noted; I cannot size them and say so)

1. LP-1 above (minutes; delete the line if it's ~0).
2. `-Wl,-mllvm,-inlinecold-threshold=0` alongside LP-1 — same perf argument
   (only callees explicitly marked `__attribute__((cold))`); essentially free
   to bundle into the same relink.

---

### dead_ends

These are this unit's MAIN deliverable. Each one would otherwise look
attractive enough to cost someone a 40-minute rebuild and a wrong PR.

**D1. `--lto-partitions=N` — REFUTES the brief's hypothesis, with the mechanism.**
The brief hypothesized "less cross-partition inlining = smaller". **It is the
opposite, by construction.** In `llvm/lib/LTO/LTOBackend.cpp::lto::backend()`,
the FULL IR optimization pipeline — `opt()` → `buildLTODefaultPipeline(O2)`,
which CONTAINS the inliner — runs **once on the single combined module**, and
ONLY THEN, `if (ParallelCodeGenParallelismLevel == 1) codegen(...) else
splitCodeGen(...)`. `--lto-partitions=N` sets
`ParallelCodeGenParallelismLevel`. So it affects nothing before codegen: **the
inliner never sees partitions.** It is purely a link-TIME knob. Worse, `llvm::
SplitModule(M, N, cb, /*PreserveLocals=*/false)` EXTERNALIZES internal globals
so they can be referenced across partitions, and `linkonce_odr` functions
reachable from multiple partitions get a copy in each — so N>1 would make the
binary LARGER, not smaller. The canary is at N=1 (one `bun-profile.lto.o` in
the map). DEAD. Do not try it.

**D2. `-fvirtual-function-elimination` — the novel, most attractive-looking
dead end, closed by a full derivation.** It is the "obvious" missing third
member of the flag trio bun already has 2/3 of (`-flto=full` ✓,
`-fwhole-program-vtables` ✓ at `flags.ts:517`, VFE ✗ — `grep -rn
virtual-function-elim scripts/` = 0 hits), it is spelled exactly right for
bun's config (clang requires `-flto=full`; linux IS `-flto=full`;
`-fvisibility=hidden` at `flags.ts:372` gives it the right safety model), the
canary's LTO pipeline **already runs the complete receiving machinery**
(`globaldce<vfe-linkage-unit-visibility>` three times + `lowertypetests` +
`wholeprogramdevirt`), and its lowering (`llvm.type.checked.load` →
`lowertypetests` → the identical plain vtable load) is **byte-for-byte
perf-neutral at every live call site**. It would have automatically subsumed
SYNTHESIS2 B3's 7 hand-written ICU hunks.
**BUT the universe is gone before it starts.** The non-LTO build has **2,063
vtables (183,664 B of slots)**; the LTO canary has **210 (23,704 B)** — bun's
existing full LTO + WPD + `globaldce` already eliminated 87% of them. Of the
surviving 210: **126 are `std::`/libgcc** (native, non-bitcode, AND
`CodeGenModule::AlwaysHasLTOVisibilityPublic()` exempts `std::` by name);
**59 are `icu_75::`** — which is EXACTLY SYNTHESIS2 B3's already-claimed
0.233 MB; and 21 are `JSC::` (the LIVE `B3::Value` compiler hierarchy).
**ZERO `WebCore::`/`Bun::`/`Zig::` vtables exist**, because JSC's design uses
`ClassInfo::MethodTable`, never C++ virtual dispatch, for heap cells.
VFE's NET NEW money beyond B3 is a fraction of ~21 JSC + 3 anon + 1 WTF
vtables: **≤0.03 MB**, against a real ALL-OR-NOTHING deployment constraint
(EVERY bitcode TU in the link — bun's C++, every `direct` C++ dep, AND the
oven-sh/WebKit `-lto` prebuilt — must be recompiled with the flag, or a
non-instrumented TU's plain vtable load hits a slot VFE zeroed and the binary
miscompiles). DEAD. Nobody should spend a rebuild on it.

**D3. `function-specialization` in the LTO pipeline.** See F6: not in
LLVM 21's `lto<O2>` pipeline (plain `ipsccp`, no `<func-spec>`), nor in
`lto-pre-link<O3>`; 0 `.specialized.` symbols in the canary. Costs 0 bytes,
there is nothing to turn off. The brief's question is fully answered.

**D4. `hot-cold-split` / `partial-inliner` / `enable-merge-functions` as
things to REMOVE.** All three default to 0, none runs (F6). 0 bytes. As
things to ADD, they are separate, perf-unknown experiments; `hot-cold-split`
in particular is mixed-sign on size WITHOUT a profile (each outlined cold
region pays a call + a prologue/epilogue) — do not ship it without a
measurement. `enable-merge-functions` is handed to w3-machine-outliner (see
overlaps).

**D5. The brief's class (b) — "LTO over-inlining of one-shot/cold
functions" — as a SIZE lever.** Ceiling ≈ **0 MB** (F5, proven 3 ways). Its
growth is body relocation driven by the 15000-pt `LastCallToStaticBonus`,
and relocation is what SYNTHESIS2 B6's downgrade already asserted. The only
non-relocation growth (+2.7 MiB) is multi-caller duplication, which no flag
can separate from hot-path inlining WITHOUT PGO.

**D6. `inlinehint-threshold` (325→225) and `inline-threshold` (225→lower)
and `--lto-CGO1`.** All GLOBAL and therefore PERF-LOCKED. In JSC/WTF, the
`inlinehint` population (= every header-defined / in-class function) IS the
intended-hot population; there is no static way to carve the cold slice out
of it. Same class as the already-perf-locked `--lto-O` level. DEAD by the
hard constraint.

**D7. `-mllvm -force-attribute=<fn>:minsize` at LINK time.** Would have made
LP-2 a RELINK-ONLY, zero-source change. REFUTED: `forceattrs` is in the
per-module/`lto-pre-link` pipeline but **NOT** in `buildLTODefaultPipeline`
(confirmed by the `lto<O2>` dump). The only route is lld 21.1.8's
`--lto-newpm-passes='forceattrs,lto<O2>'` (it DOES exist) plus `-mllvm
-force-attribute=<mangled>:minsize` — mechanically real but a brittle,
exotic, mangled-name-keyed hack a maintainer should not accept. Use LP-2's
source annotation instead.

**D8. `--lto-O` / the link-line `-O2`.** Pre-closed by the brief and
`flags.ts:888-915` (documented −5 MB / +3.1 MB measurements). NOT relitigated;
my F5 shrinker list (all 8 `FunctionParser<T>::parse*Expression`, −178 KB) is
the first per-symbol confirmation that the canary's LTO codegen at
`--lto-O2/CGO2` is ALREADY the size-friendlier level vs the per-TU -O3.

---

### overlaps

- **w3-machine-outliner** (item 4, `MergeFunctions`): handing over three
  facts it needs — (1) the exact LTO-reaching spelling is
  `-Wl,-mllvm,-enable-merge-functions` (reaches `PTO.MergeFunctions`; the
  pass sits at the END of `buildLTODefaultPipeline`, after the
  inliner+optimizer, which is the right place); (2) the LLVM 21.1.8 default
  is 0 (verified) and it is NOT running today (F6); (3) its key advantage
  over `--icf=all`: it is **address-identity-safe BY CONSTRUCTION** — it only
  aliases two functions if both are `unnamed_addr`, else it emits a tail-call
  thunk that preserves a distinct address — which sidesteps the ENTIRE
  `218430c731` / `callHostFunctionAsConstructor` bug class that GT#2's
  `--keep-unique` work-around exists for. It COMPOSES with `icf=safe` (they
  fold at different representations). I do not count its bytes.
- **w3-machine-outliner / w3-rust-codegen-flags**: 0 `OUTLINED_FUNCTION`
  symbols in the canary (F6) — the outliner is off. And the full rust LTO
  shape is in F1 (one fat, summary-less regular-LTO module; per-crate
  `opt-level="z"` function attrs DO survive `-Clinker-plugin-lto` into the
  link-time `buildLTODefaultPipeline`, so SYNTHESIS2 rows 12/20's Rust
  `optimize(size)`/`opt-level="z"` mechanisms are confirmed to work under
  bun's LTO topology).
- **SYNTHESIS2 B2 (LOLJIT)**: exact independent confirmation at 319,917 B +
  a second-order upgrade (F7). Do not re-count.
- **SYNTHESIS2 B6-downgrade + §E.3**: both are now MEASURED and CLOSED (F5).
  `JITThunks::initialize`, `JSGlobalObject::init`,
  `Zig::GlobalObject::addBuiltinGlobals` are relocation, not duplication.
- **SYNTHESIS2 row 14 (`BunBuiltinNames` ctor)**: LP-2 deliberately EXCLUDES
  it from its sum to avoid double counting; row 14's table-rewrite is the
  better fix for that one.
- **SYNTHESIS2 §E.1 (graph-coloring regalloc)**: rows 10/11/27 of my top-40
  are that lead's symbols; I add the non-LTO sizes (83,434 / 79,749 / 54,127)
  showing they are NOT LTO-inflated — they are inherently that big. The lead
  stands unchanged.
- **SYNTHESIS2 §E.6 (PGO)**: my F4/F5 data puts a NUMBER on why it matters to
  size: the +2.7 MiB of real inliner duplication is, structurally, the ONLY
  LTO-pipeline mass an instrumented profile could reclaim at zero (actually
  negative) perf cost, because the inline cost model is otherwise blind. PGO
  is the 1-MB-class LTO-pipeline answer — but it is a CI-architecture change,
  not a flag, and it is not a proposal from this unit.
- **w3-webkit-build-options**: the 0.93 MiB `typedArrayViewProtoFunc` family
  (F7) and the exact LTO mode of the `-lto` WebKit prebuilt (it joins bun's
  regular-LTO partition; there is no ThinLTO anywhere in the linux link).
- **w3-binary-archaeology**: the +1.04 MiB `.rodata` LTO growth (F7), with
  its confounds.
- **w3-cpp-compile-flags**: `-fvirtual-function-elimination` (D2) is
  technically a compile flag; I am closing it here so that unit does not
  re-open it. Also: the canary has no residual LTO-specific hardening taxes —
  everything in GT#7 holds.
