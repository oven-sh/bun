# DFG/FTL compile-time working memory: measurement and reduction proposals

This document investigates the working memory consumed by JavaScriptCore's
optimizing JIT tiers (DFG and FTL) **during compilation**, as distinct from
the memory occupied by the generated machine code. The measurements were taken
with the `jsc` shell on linux-x64 running JetStream3 subtests; the structural
analysis is architecture-independent.

Goal: identify where compile-time working memory goes and propose changes that
together reduce it by ~30%.

## TL;DR

- Peak working memory for a single DFG/FTL compilation is typically **100-300×**
  the size of the generated code, and **1,700×** in the worst observed case
  (octane-zlib, 176 MB working set for 100 KB of output).
- For both DFG-tier and FTL-tier compilations, **the DFG IR dominates**:
  70-80% of the FTL working set is allocated by DFG phases, not B3/Air.
- Two structures account for ~70% of the DFG peak on large functions:
  - per-`BasicBlock` `Operands<AbstractValue>` arrays (`valuesAtHead`,
    `valuesAtTail`, `intersectionOfPastValuesAtHead`): `blocks × operands × 3 × 32 B`
  - Phi nodes created by CPS rethreading: up to `blocks × operands × sizeof(Node)`
- The highest-leverage reductions are:
  1. Drop `intersectionOfPastValuesAtHead` for non-OSR-target blocks (-10 to -13%).
  2. Liveness-mask the per-block `Operands<AbstractValue>` arrays (-15 to -25%).
  3. Bump-allocate `DFG::Node` from the existing `SequesteredArena` path on all
     platforms (currently Darwin/PROTECTED_JIT only), eliminating ~16 B/node
     malloc overhead (-5 to -10%).
  4. Shrink `DFG::AbstractValue` from 32 B to 24 B (-8 to -10%).
  5. Shrink `Air::Inst` inline arg capacity 3 → 2, or shrink `Air::Arg`
     32 B → 24 B (-3 to -8% of FTL).

Items 1-4 alone comfortably exceed the 30% target for DFG, and since DFG
dominates FTL as well, FTL follows.

## Methodology

All measurements use the release `jsc` binary from bun's vendored WebKit build.

### Per-tier peak RSS (coarse)

Each JetStream3 subtest is run in a separate `jsc` process once per JIT
configuration; `/proc/<pid>/statm` is sampled at ~1 ms. `JSC_useConcurrentJIT=0`
so compilation happens on the main thread. Numbers below are `peakRSS(config)`
in MB.

| test            | no-jit | baseline | dfg-only |     ftl | dfg-concur | ftl-concur |
| --------------- | -----: | -------: | -------: | ------: | ---------: | ---------: |
| richards        |     32 |       36 |       38 |      42 |         40 |         49 |
| delta-blue      |     54 |       62 |       65 |      73 |         68 |         82 |
| raytrace        |     52 |       60 |       64 |      74 |         68 |         80 |
| crypto          |     32 |       36 |       39 |      44 |         43 |         49 |
| navier-stokes   |     23 |       27 |       30 |      35 |         31 |         39 |
| gbemu           |     53 |      121 |      132 |     143 |        138 |        152 |
| Box2D           |     52 |       74 |       78 |      97 |         82 |        105 |
| **typescript**  |     98 |      525 |      619 | **968** |        884 |   **1055** |
| **octane-zlib** |     36 |       43 |  **223** |     231 |        225 |        242 |
| Babylon         |     53 |       83 |       89 |     101 |         98 |        131 |
| ML              |     53 |       66 |       71 |      82 |         73 |         95 |
| Air             |     54 |      102 |      111 |     123 |        123 |        152 |
| cdjs            |     53 |       97 |      102 |      99 |        103 |        102 |

`ftl-concur - ftl` is the overhead of having 2 DFG + 7 FTL compiler threads
run plans simultaneously (default thread counts). For typescript this is
~90 MB, for Babylon ~30 MB.

`dfg-only - baseline` and `ftl - dfg-only` conflate generated code with
working memory, so the per-compile measurement below is used for attribution.

### Per-compile working memory (fine)

With `JSC_useConcurrentJIT=0 JSC_reportCompileTimes=1`, each compilation's
end time and `codeSize` are known on stderr; RSS is sampled every ~0.2 ms and
the spike `peakRSS - rssBefore` is attributed to the compile just completed.
Top spikes:

| benchmark   | function   | tier | codeSize | compile ms |  RSS spike | ratio |
| ----------- | ---------- | ---- | -------: | ---------: | ---------: | ----: |
| octane-zlib | `a1`       | DFG  |   100 KB |        371 | **176 MB** | 1760× |
| octane-zlib | `a1` (OSR) | DFG  |   101 KB |        375 |     131 MB | 1300× |
| typescript  | `#A9HIep`  | FTL  |    56 KB |        168 |    18.5 MB |  330× |
| typescript  | `#CDCNxP`  | FTL  |    36 KB |        141 |    17.1 MB |  475× |
| typescript  | `#A9HIep`  | DFG  |    47 KB |         18 |     8.8 MB |  187× |
| Box2D       | `#Al3BOp`  | FTL  |    18 KB |         52 |     4.8 MB |  267× |
| gbemu       | `#AYY9JL`  | FTL  |    30 KB |         28 |     6.0 MB |  200× |

The octane-zlib `a1` function is an emscripten-compiled monolith: 130,377
bytes of bytecode, 1,199 basic blocks, 497 locals+args, 51,046 DFG nodes after
parsing (84% of which are `MovHint`/`SetLocal`/`PhantomLocal`/`GetLocal`/
`Phantom`/`JSConstant` bookkeeping).

### Per-phase attribution

With `JSC_logPhaseTimes=1`, each phase logs its completion time; RSS at that
timestamp gives a per-phase high-water mark.

**octane-zlib `a1`, DFG-tier, 176 MB total:**

| phase                 |  RSS delta | notes                                                        |
| --------------------- | ---------: | ------------------------------------------------------------ |
| bytecode parser       | **+92 MB** | allocates `BasicBlock` + all 5 `Operands<>` arrays + `Node`s |
| CPS rethreading       | **+62 MB** | Phi node creation (one per live-in `(block, var)`)           |
| control flow analysis |     +10 MB | `FlowMap<AbstractValue>` + AtTail state                      |
| constant folding      |     +10 MB | insertion set, new nodes                                     |
| machine code gen      |    +2.5 MB | assembler buffer, OSR exit tables                            |

**typescript `#CDCNxP`, FTL-tier, 19.2 MB total:**

| phase group                                                               |   RSS delta |       % |
| ------------------------------------------------------------------------- | ----------: | ------: |
| DFG parse + CPS                                                           |      3.3 MB |     17% |
| DFG CFA + const-fold (CPS)                                                |      1.5 MB |      8% |
| DFG SSA conversion                                                        |      2.5 MB |     13% |
| DFG SSA passes (GCSE, liveness, LICM, obj-alloc-elim, IRC, store-barrier) |      7.3 MB |     38% |
| **DFG total**                                                             | **14.6 MB** | **76%** |
| B3 lowering + passes                                                      |      2.8 MB |     15% |
| Air (lowerToAir, liveness, regalloc, codegen)                             |      1.8 MB |      9% |

**Box2D `#Al3BOp`, FTL-tier, 5.8 MB**: DFG 80%, B3 8%, Air 12%.
**gbemu `#AYY9JL`, FTL-tier, 6.0 MB**: DFG 33%, B3 18%, Air 47% (Air liveness
dominates; gbemu has many tmps, few locals).

## Struct-level accounting

Release linux-x64. File references are relative to
`vendor/WebKit/Source/JavaScriptCore/`.

| type                           |                sizeof | file:line                        |
| ------------------------------ | --------------------: | -------------------------------- |
| `DFG::Node`                    |            **~104 B** | `dfg/DFGNode.h:3935-4101`        |
| `DFG::Edge`                    |                   8 B | `dfg/DFGEdge.h:227`              |
| `DFG::AdjacencyList`           |                  24 B | `dfg/DFGAdjacencyList.h:43,199`  |
| `DFG::AbstractValue`           |              **32 B** | `dfg/DFGAbstractValue.h:418-464` |
| `DFG::BasicBlock` (fixed part) |                ~300 B | `dfg/DFGBasicBlock.h`            |
| `B3::Value`                    | 40 B (48 B min alloc) | `b3/B3Value.h:937-965`           |
| `B3::BasicBlock`               |                ~112 B | `b3/B3BasicBlock.h:179-184`      |
| `Air::Arg`                     |              **32 B** | `b3/air/AirArg.h:1901-1914`      |
| `Air::Inst`                    |            **~128 B** | `b3/air/AirInst.h:213-215`       |
| `Air::BasicBlock`              |                ~112 B | `b3/air/AirBasicBlock.h:151-156` |

`DFG::BasicBlock` heap-allocates five `Operands<T>` vectors sized to
`numArguments + numLocals + numTmps` in its constructor
(`dfg/DFGBasicBlock.cpp:58-62`): two of `Node*` (8 B) and three of
`AbstractValue` (32 B), for **112 B per operand per block**.

`DFG::Node` is individually heap-allocated through `B3::SparseCollection<Node>`
(`b3/B3SparseCollection.h:73`). On platforms without `USE(PROTECTED_JIT)`
(everything except Apple-internal darwin/arm64), this is a plain `new`, so
each 104 B `Node` carries ~16 B of allocator metadata and size-class
quantization.

`Air::Inst` embeds `Vector<Arg, 3>`; 3 inline `Arg`s × 32 B is 96 B of the
128 B. Insts are stored **by value** in `Air::BasicBlock::m_insts`, so the
inline capacity is paid for every instruction whether or not it has 3 args.
The `AirCode.h:79` comment that Air is ~40× machine-code bytes matches the
measurements (36 KB code → ~1.4 MB of `Air::Inst`s).

### Accounting for the 176 MB `a1` DFG compile

`B = 1199` blocks, `V = 497` operands, `N₀ = 51046` nodes after parsing.

| component                                          | formula                                            |       bytes |
| -------------------------------------------------- | -------------------------------------------------- | ----------: |
| `BasicBlock` `valuesAtHead/Tail/intersection`      | `B × V × 3 × 32`                                   | **57.2 MB** |
| `BasicBlock` `variablesAtHead/Tail`                | `B × V × 2 × 8`                                    |      9.5 MB |
| Phi `Node`s from CPS rethreading                   | ~`B × Vₗᵢᵥₑ × (104 + overhead)`                    |  **~62 MB** |
| Post-parse `Node`s                                 | `N₀ × (104 + 8 + ~16)`                             |     ~6.5 MB |
| `FullBytecodeLiveness` (header vectors + bit data) | `2 × bytecodeBytes × 16` + `2 × instrs × ⌈V/32⌉×4` |       ~8 MB |
| `FlowMap<AbstractValue>` (`m_abstractValuesCache`) | `Nₘₐₓ × 32`                                        |     ~2-4 MB |
| `VariableAccessData`                               | `~N_setlocal × 64`                                 |     ~2.5 MB |
| `VariableEventStream`                              | `~Nₘₐₓ × 3 × 14`                                   |       ~3 MB |
| `OSRExit` + `OSRExitCompilationInfo`               | `~Nₑₓᵢₜ × 150`                                     |       ~4 MB |
| allocator slack + size-class quantization          |                                                    |      ~20 MB |
| **total accounted**                                |                                                    | **~175 MB** |

The `B × V` terms dominate at ~72% of the peak.

## Reduction proposals

Ordered by expected impact / effort ratio. "DFG %" is share of the DFG-tier
peak on large functions (octane-zlib / typescript class); "FTL %" is share of
the FTL-tier peak (typescript / Box2D class). Because ~76% of the FTL peak is
DFG, the DFG wins carry over.

### P1. Allocate `intersectionOfPastValuesAtHead` lazily, only for OSR-target blocks

`BasicBlock::intersectionOfPastValuesAtHead` is one of the three
`Operands<AbstractValue>` arrays allocated in every `BasicBlock` constructor
(`dfg/DFGBasicBlock.cpp:62`). Its only consumer is OSR entry
(`dfg/DFGJITCompiler.cpp` / `dfg/DFGOperations.cpp`), which reads it for
blocks with `isOSRTarget == true`. In the `a1` graph, only a handful of the
1,199 blocks are OSR targets.

Change: store it as `std::unique_ptr<Operands<AbstractValue>>`, allocated when
`isOSRTarget` is set or on first use from CFA's "remember the intersection"
path.

- **DFG peak impact**: removes one of the three `B × V × 32` arrays from almost
  every block: ~**-11%** of peak (19 MB on `a1`).
- **Risk**: low. The field is read in very few places; laziness is
  straightforward. `ensureLocals`/`ensureTmps` need a null check.

### P2. Liveness-mask `valuesAtHead` / `valuesAtTail`

`valuesAtHead`/`valuesAtTail` are dense `V`-sized arrays per block, but a
variable that is not live at the head/tail of a block is always `⊥`
(bottom). For code with many locals and high block counts (emscripten output
is the extreme, but heavy inlining produces the same shape), most entries are
bottom.

Two implementation options:

- **2a. Compress `Operands<AbstractValue>` to "live view"**: each
  `Operands<AbstractValue>` becomes `{BitVector liveMask; Vector<AbstractValue>
dense}` with `dense.size() == popcount(liveMask)`. Populated by CFA using
  `FullBytecodeLiveness` (already computed). Readers that index by operand do
  a rank lookup.
- **2b. Share one flat arena across all blocks**: replace the per-block
  `Vector<AbstractValue>` with `{uint32_t offset, uint32_t count}` into a
  single `Graph`-owned `SegmentedVector<AbstractValue>`, sized lazily in CFA
  to `Σ_block liveAt(block)`. This also eliminates ~`2B` small heap
  allocations.

The bytecode-liveness data is already in `Graph::m_bytecodeLiveness`; reusing
it avoids a second analysis.

- **DFG peak impact**: for `a1`, average live-in is well under half of `V`
  (the 9,371 `PhantomLocal`s over 1,199 blocks imply ~8 live-in operands/block
  at parse time; CFA widens this somewhat). Conservatively **-15% to -25%** of
  peak.
- **Risk**: medium. CFA merge logic (`DFGCFAPhase.cpp`, `InPlaceAbstractState`)
  indexes these arrays by operand and would need a `liveAt(block, op) ? value :
bottom()` adapter. `ensureLocals` growth path is affected.

### P3. Arena-allocate `DFG::Node` everywhere (enable the SequesteredArena path on non-Darwin)

`USE(PROTECTED_JIT)` (currently gated to Apple-internal darwin arm64,
`wtf/PlatformUse.h:322-330`) routes `WTF_MAKE_SEQUESTERED_ARENA_ALLOCATED`
types, including `B3::Value`, `B3::Procedure`, `DFG::FlowMap`, and the
`DFGTZoneImpls.cpp` set, through a per-compilation bump arena. `DFG::Node`
itself is not on that list, and on every other platform the macro falls
through to `WTF_MAKE_TZONE_ALLOCATED`/`FastMalloc`, so every `Node` is an
individual malloc.

Change: either (a) pull `DFG::Node` into the arena set and enable the
`SequesteredArenaAllocator` as a pure bump allocator independent of
`PROTECTED_JIT`'s page-protection semantics, or (b) add a simple
`DFG::Graph`-owned slab allocator that `SparseCollection<Node>::addNew`
draws from.

- **DFG peak impact**: removes ~16 B/node overhead and quantization. With
  ~550k nodes in `a1` (post-parse + phis), that is ~9 MB, **~-5%** of peak.
  More importantly, the freed `Node` memory is handed back in one `reset()`
  at the end of the compile instead of ~550k `free()` calls, which also helps
  compile time.
- **Risk**: low-medium. `SparseCollection::remove` deletes individual nodes;
  with a bump arena that becomes a no-op and memory is held to end of
  compilation (which it already effectively is, since the allocator caches it).

### P4. Shrink `DFG::AbstractValue` 32 B → 24 B

```
StructureAbstractValue  m_structure;    //  8 B  (TinyPtrSet pointer)
SpeculatedType          m_type;         //  8 B  (49 bits used, SpeculatedType.h)
ArrayModes              m_arrayModes;   //  4 B  (~30 bits used)
AbstractValueClobberEpoch m_effectEpoch;//  4 B  (counter)
JSValue                 m_value;        //  8 B  (constant, usually empty)
```

`SpeculatedType` uses 49 bits and `ArrayModes` uses ~30 bits; they cannot be
merged. However:

- `m_value` is set only when the abstract value is a single concrete constant
  (`isConstant()`). These are a small minority of abstract values. Replacing
  `JSValue m_value` with `uint32_t m_frozenValueIndex` into
  `Graph::m_frozenValues` (which already interns every constant) recovers 4 B.
- `m_effectEpoch` is a monotone counter compared for equality; 16 bits are
  sufficient within one CFA fixpoint if it is reset per block (it is, via
  `InPlaceAbstractState::beginBasicBlock`), recovering another 2-4 B.

That gets to 24 B with one 4-byte hole, or 28 B if only `m_value` is narrowed.

- **DFG peak impact**: `B × V × 3 × 32 → × 24` and `FlowMap × 32 → × 24`:
  ~**-8% to -10%** of peak. Multiplied by the arena of P2 this is smaller.
- **Risk**: medium. `AbstractValue` is compared and hashed pervasively; the
  `m_value` → index change touches `filter()`, `set()`, `merge()`,
  `validateOSREntryValue()`.

### P5. Slim CPS Phi bookkeeping

CPS rethreading allocates a full 104 B `Node` per live-in `(block, var)` to
represent a Phi. For `a1` that is roughly `B × 8` ≈ 10k at minimum and up to
`B × Vₗᵢᵥₑ` after reaching fixed point, which the +62 MB suggests is several
hundred thousand.

Phi nodes carry almost none of `Node`'s payload: they have no `m_opInfo`/
`m_opInfo2`, their `AdjacencyList` is always var-args into
`m_varArgChildren`, and they have no interesting `NodeOrigin` beyond the
block head. A separate `struct CPSPhi { Edge* children; uint16_t count;
VariableAccessData* vad; uint32_t index; }` (~24 B) stored in
`BasicBlock::phis` as a value vector, promoted to real `Node`s only when
another phase needs a `Node*` reference to them, would cut this by ~4×.

- **DFG peak impact**: up to **-20%** of peak on `B × V`-heavy graphs;
  much less on typical FTL inputs where CPS phis are already few (typescript
  FTL showed +180 KB for CPS rethreading).
- **Risk**: high. Many phases pattern-match on `node->op() == Phi`; a
  hybrid representation leaks widely. A cheaper variant is to keep `Node` but
  allocate Phi nodes from a second, tighter `struct PhiNode : Node {}` that
  `SparseCollection` cannot do today.

### P6. Shrink `Air::Arg` 32 B → 24 B and/or reduce `Air::Inst` inline args 3 → 2

`Air::Inst::args` is `Vector<Arg, 3>` (`b3/air/AirInst.h:49`), so every
instruction reserves 96 B of `Arg` inline. Most Air opcodes on x86-64 and
arm64 use ≤ 2 args; `Patch` and a few 3-operand forms are the exceptions.

Options:

- **6a.** Drop inline capacity to 2 (`Vector<Arg, 2>`). Insts with ≥3 args
  spill to heap, but since Air blocks hold `Inst`s by value in a `Vector`, the
  32 B saved applies to every instruction. Expected **~-25% of Air::Inst
  storage** (128 B → 96 B). The spill allocation for 3-arg insts should come
  from the arena (P3) to avoid trading one cost for another.
- **6b.** Shrink `Air::Arg`: `int64_t m_offset` and `int64_t m_additional`
  (`b3/air/AirArg.h:1902-1903`) rarely need 64 bits; most offsets fit in 32.
  Making both `int32_t` with a `BigImm`/`BigOffset` escape kind saves 8 B per
  arg → 24 B/arg → 72 B inline → `Inst` ~104 B. Also **~-20% of Air::Inst
  storage**.

- **FTL peak impact**: Air is ~10-45% of the FTL peak depending on benchmark;
  6a or 6b gives **~-3% to -8% of FTL peak**.
- **Risk**: 6a low (one template parameter, measure 3-arg frequency first).
  6b medium (MacroAssembler interfaces take `int64_t` offsets; need an
  escape-hatch `Arg::Kind`).

### P7. Free CPS-only state before CFA

`variablesAtHead`/`variablesAtTail` (two `Operands<Node*>` per block, `B × V
× 16` B = 9.5 MB on `a1`) are CPS-form bookkeeping. Once the DFG enters SSA
(`performSSAConversion`) they are never read again, and in the DFG-tier
(non-SSA) they are last read in `phantom insertion`. Clearing both vectors in
`Graph::killCPSData()` (or adding one) before `machine code generation` in
the DFG path, and before `lowerDFGToB3` in the FTL path, recovers ~5% of peak.

This does **not** reduce peak on its own (the arrays are allocated before CFA
and freed after), but stacked with P2 it lets CFA run in the reclaimed space.

- **Risk**: low.

### P8. Fix `FullBytecodeLiveness` to index by instruction, not byte offset

`FullBytecodeLiveness` holds two `FixedVector<FastBitVector>` sized by
`codeBlock->instructions().size()`, which is the **byte** length of the
instruction stream (`bytecode/FullBytecodeLiveness.h:44-47, 74-75`). Entries
at non-instruction offsets are default-constructed 16 B `FastBitVector`
headers that are never touched. For `a1` that is `2 × 130,377 × 16 B` ≈ 4.2 MB
of dead headers. The existing `FIXME` at `FullBytecodeLiveness.h:72-73` already
calls this out.

Fix: key by instruction index (monotone, dense) and add a `byteOffset →
instructionIndex` side table, or pack the bit data into a single contiguous
`FastBitVector` and store `{offset, length}` per instruction.

- **DFG peak impact**: **-2% to -3%**.
- **Risk**: low; mechanical.

### P9. Cap concurrent optimizing compilations by working-set budget, not thread count

Default `numberOfFTLCompilerThreads=7` + `numberOfDFGCompilerThreads=2` allows
up to nine optimizing compilations in flight. On JetStream-typescript the
concurrent FTL peak is ~90 MB above the synchronous peak, and the
`dfg-only-concurrent` peak is 265 MB above `dfg-only`. On machines where Bun
cares about RSS, this multiplier dominates everything above.

Change: add a per-plan working-set **estimate** (e.g.,
`k × instructionsSize × numCalleeLocals`, tuned against the table above) and
have `JITWorklist` admission-control against a global byte budget instead of a
fixed thread count. This doesn't reduce per-compile memory but directly
bounds peak RSS without losing parallelism on small functions.

- **Risk**: low-medium; scheduling heuristics are easy to get wrong and may
  regress JetStream first-iteration scores if large compiles are serialized.

## Reproducing these numbers

```sh
JSC=/root/.bun/build-cache/webkit-*/bin/jsc   # release build

# Per-compile spike, correlated with reportCompileTimes:
JSC_useConcurrentJIT=0 JSC_reportCompileTimes=1 $JSC -e 'testList=["octane-zlib"]' \
    vendor/WebKit/PerformanceTests/JetStream3/cli.js 2>times.log &
while read _ rss _ < /proc/$!/statm; do echo "$(date +%s%N) $rss"; done > rss.log

# Per-phase high-water mark:
JSC_useConcurrentJIT=0 JSC_logPhaseTimes=1 $JSC ...
```

A scripted harness for both is at `/tmp/measure-jit-mem.ts` and
`/tmp/phase-mem.ts` in the investigation environment; they can be upstreamed
into `bench/` if ongoing tracking is wanted.

## Summary table

| proposal                                 | scope                    |            DFG peak |     FTL peak | risk    |
| ---------------------------------------- | ------------------------ | ------------------: | -----------: | ------- |
| P1 lazy `intersectionOfPastValuesAtHead` | `dfg/DFGBasicBlock`      |                -11% |          -8% | low     |
| P2 liveness-masked `valuesAt*`           | `dfg/DFGBasicBlock`, CFA |         -15 to -25% |  -12 to -19% | med     |
| P3 arena-allocate `DFG::Node`            | WTF, `dfg/`              |                 -5% |          -4% | low-med |
| P4 `AbstractValue` 32 B → 24 B           | `dfg/DFGAbstractValue`   |          -8 to -10% |    -6 to -8% | med     |
| P5 slim CPS Phi                          | `dfg/DFGCPSRethreading`  |          up to -20% |        small | high    |
| P6 `Air::Inst`/`Arg` shrink              | `b3/air/`                |                   0 |    -3 to -8% | low/med |
| P7 free CPS data earlier                 | `dfg/`                   |        (enables P2) | (enables P2) | low     |
| P8 `FullBytecodeLiveness` indexing       | `bytecode/`              |           -2 to -3% |          -2% | low     |
| P9 working-set-budgeted worklist         | `jit/JITWorklist`        | bounds concur. peak |         same | low-med |

P1 + P2 + P3 + P4 together: ~**-35% to -45%** of DFG peak, ~**-30% to -35%**
of FTL peak. P1, P3, P8 are the cheapest first steps.
