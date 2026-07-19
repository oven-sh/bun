# Reducing JavaScriptCore Memory Usage in Bun

This document catalogs the memory layout of core JSC heap types as measured in Bun's WebKit fork on Linux x64, and a ranked set of changes to reduce per-object footprint. All sizes are verified against the compiler (`sizeof`/`offsetof`), not estimated.

## Current Sizes (Linux x64, release)

| Type                           |    `sizeof` | Size class | Notes                                      |
| ------------------------------ | ----------: | ---------: | ------------------------------------------ |
| `JSCell`                       |           8 |         16 | 4B StructureID + 4B type/flags blob        |
| `JSObjectWithButterfly`        |          16 |         16 | + `Butterfly*`                             |
| `JSArray`                      |          16 |         16 | cell only; butterfly allocated separately  |
| `JSString`                     |          16 |         16 | + `StringImpl*` (or rope tag) in `m_fiber` |
| `JSRopeString`                 |          32 |         32 | 3 packed fiber pointers + length           |
| `JSFunction`                   |          32 |         32 |                                            |
| `Structure`                    |     **112** |        112 | see layout below                           |
| `StructureRareData`            |         112 |        112 |                                            |
| `PropertyTable`                |          40 |         48 | + out-of-line hash table                   |
| `JSFinalObject` (`{}` default) |      **64** |         64 | 6 inline slots pre-reserved                |
| `[]` cell + butterfly          | 16 + **48** |    16 + 48 | 5 pre-reserved vector slots                |

MarkedSpace size classes (bytes): `16, 32, 48, 64, 80, 112, 160, 224, 320, ...`
(There is no 96-byte class; anything in `81..112` allocates 112.)

### Measured heap per object (1M instances, RSS delta)

| Pattern              |   Bun | Node 26 | Notes                                                 |
| -------------------- | ----: | ------: | ----------------------------------------------------- |
| `{}`                 |  90 B |    88 B | 64-byte cell + array slot + block header amortization |
| `{a:1}`              |  60 B |    52 B | literal analyzer sizes the cell to 32 B               |
| `{a..f:1}` (6 props) |  90 B |   154 B | JSC wins: all inline                                  |
| `{a..g:1}` (7 props) | 112 B |   148 B | spills to butterfly                                   |
| `[]`                 |  91 B |    80 B | 48-byte butterfly dominates                           |
| `[1,2,3,4,5]`        |  38 B |    74 B | JSC wins: CoW butterfly shared                        |
| `{}; o['k'+i]=i`     | 598 B |     n/a | 1 Structure per object: Structure dominates           |

## `Structure` Layout (112 bytes)

```
  0  JSCell header                           8
  8  m_blob (TypeInfoBlob)                   4
 12  m_outOfLineTypeFlags                    2
 14  m_inlineCapacity                        1
 15  m_lock                                  1
 16  m_bitField                              4
 20  m_transitionPropertyAttributes          1
 21  m_structureVariant                      1
 22  m_transitionOffset                      2
 24  m_maxOffset                             2
 26  [padding]                               2
 28  m_propertyHash                          4
 32  m_seenProperties  (TinyBloomFilter)     8
 40  m_realm           (WriteBarrier)        8
 48  m_prototype       (WriteBarrier<Unknown>) 8
 56  m_cachedPrototypeChain (WriteBarrier)   8
 64  m_previousOrRareData   (WriteBarrier)   8
 72  m_transitionPropertyName (CompactRefPtr) 8
 80  m_classInfo                             8
 88  m_transitionTable                       8
 96  m_propertyTableUnsafe  (WriteBarrier)   8
104  m_transitionWatchpointSet               8
                                           ───
                                           112
```

On Apple platforms with `HAVE(36BIT_ADDRESS)`, `CompactRefPtr` and the `SeenProperties` bloom filter are 4 bytes each instead of 8; `sizeof(Structure)` is 8 bytes smaller but still in the 112-byte class.

---

## Change Set 1: Allocation-Heuristic Tweaks (quick wins)

These are policy constants, not layout changes. They do not touch the JIT or change any observable semantics; they only change how much slack space is pre-allocated.

### 1a. `{}` inline-capacity fallback: 6 → 2

**File:** `Source/JavaScriptCore/bytecode/ObjectAllocationProfileInlines.h:74-77`

```cpp
if (!inferredInlineCapacity) {
    // Empty objects are rare, so most likely the static analyzer just didn't
    // see the real initializer function. This can happen with helper functions.
    inferredInlineCapacity = JSFinalObject::defaultInlineCapacity; // = 6
}
```

The bytecode generator's `StaticPropertyAnalyzer` counts `putById` ops that follow `new_object`/`create_this` in the same register. When it sees zero, this code assumes the analyzer missed something and allocates 6 slots (64-byte cell). The "Empty objects are rare" assumption is tuned for web content; in server-side JS, `{}` that stays empty is common (option bags, default parameters, sentinels).

**Change:** fall back to `2` instead of `defaultInlineCapacity`. A 32-byte cell with 2 slots still handles the common "helper adds a couple of properties" case without a butterfly spill.

**Effect:** `{}` with no statically-observed properties drops from 64 to 32 bytes (50%). Object literals with visible properties are unaffected (the analyzer already sizes those).

**Risk:** `const o = {}; helper(o)` where `helper` adds 3+ own properties now spills to a butterfly on the third add. This is one extra allocation, not a per-access cost; inline-cache behaviour is unchanged.

### 1b. `[]` initial butterfly: 5 slots → 1 slot

**File:** `Source/JavaScriptCore/runtime/ArrayConventions.h`

```cpp
#define BASE_CONTIGUOUS_VECTOR_LEN_EMPTY 5U
```

Used only by `Butterfly::optimalContiguousVectorLength()` when the requested vector length is zero, i.e. for `[]` / `new Array()`. The butterfly rounds to `IndexingHeader` (8 B) + 5×8 B = 48 bytes. `[1,2,3,4,5]` does not hit this path (it uses a CoW butterfly), so the constant is purely "how much to pre-grow an array created empty".

**Change:** `5U` → `1U`. `availableContiguousVectorLength` then rounds the 16-byte request to the 16-byte size class, giving 1 slot.

**Effect:** `[]` butterfly drops from 48 to 16 bytes; total `[]` footprint 64 → 32 bytes (50%).

**Risk:** `[]; a.push(x)` five times now reallocates the butterfly twice (1→3→5 via `BASE_CONTIGUOUS_VECTOR_LEN`) instead of zero times. Empty arrays that stay empty (very common as default values) save 32 bytes each.

### 1c. (Optional) `initialOutOfLineCapacity`: 4 → 2

**File:** `Source/JavaScriptCore/runtime/Structure.h:103`

When an object overflows its inline slots, the first butterfly property segment is 4 slots (32 B). Lowering to 2 saves 16 bytes on every object that spills by exactly 1 or 2 properties. This interacts with 1a: if 1a causes more objects to spill at 3 properties, 1c makes that spill cheaper.

---

## Change Set 2: Shrink `Structure` 112 → 80 Bytes

To cross from the 112-byte class to the 80-byte class, 32 bytes must be removed. Candidates, in order of increasing risk:

| Field                    | Bytes | Proposal                                                                                                                            | Hot?                                                                                                                                                                                                 |
| ------------------------ | ----: | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `m_cachedPrototypeChain` |     8 | Move to `StructureRareData`                                                                                                         | Cold. Lazy cache, null on most transition structures.                                                                                                                                                |
| `m_propertyTableUnsafe`  |     8 | Move to `StructureRareData`                                                                                                         | Null except on pinned/dictionary structures. Dictionary-object property access goes through it, so dictionary reads gain one indirection; non-dictionary (the overwhelming majority) are unaffected. |
| `m_seenProperties`       |   8→4 | Use `TinyBloomFilter<uint32_t>` unconditionally                                                                                     | Warm on property miss path. A 32-bit filter has higher false-positive rate than 64-bit, but the filter is a fast-reject hint only; correctness is unchanged. Already 32-bit on Apple.                |
| padding at offset 26     |     2 | Reorder `m_propertyHash` before `m_maxOffset`                                                                                       | Free.                                                                                                                                                                                                |
| `m_classInfo`            |   8→? | 16- or 32-bit index into a global `ClassInfo*` table                                                                                | Read on every `jsDynamicCast`. A table lookup (one extra load) replaces a direct pointer. ~1000 distinct `ClassInfo` instances exist in Bun.                                                         |
| `m_realm`                |   8→4 | There is typically one `JSGlobalObject` per VM, a handful with `node:vm`. No existing 32-bit encoding is suitable. Lowest priority. |

The first four rows total **8 + 8 + 4 + 2 = 22 bytes**, leaving `Structure` at 90 → still the 112-byte class. Adding `m_classInfo` as a 16-bit index removes another 6 bytes → 84, still 112. An additional 4 bytes must come from somewhere to reach 80; the remaining candidate is encoding `m_previousOrRareData` as a 32-bit ID (both `Structure` and `StructureRareData` could be allocated from the structure heap), saving 4 bytes.

**Net effect if reached:** 112 → 80 bytes is a 28.6% reduction per Structure. This matters proportionally to how polymorphic the workload is: with 100K unique structures, ~3.2 MB saved; with the typical few hundred, negligible.

**JIT impact:** `m_classInfo`, `m_seenProperties`, and `m_propertyTableUnsafe` offsets are all read from LLInt/JIT code (`Structure::classInfoOffset()` / `seenPropertiesOffset()` / `propertyTableUnsafeOffset()` are baked into assembly). Each change must be reflected in `LowLevelInterpreter64.asm` and `AssemblyHelpers`.

---

## Change Set 3: Pointer Compression (the 40%+ lever)

This is the V8-style approach and the only mechanism that plausibly reaches a large across-the-board reduction without changing semantics.

### What JSC already has

- **`StructureID`** (`runtime/StructureID.h`): every `Structure*` is encoded as a 32-bit offset from `g_jscConfig.structureIDBase`. The structure heap is a single aligned ≤4 GB reservation (`heap/StructureAlignedMemoryAllocator.cpp:98-123`). Decode is `ptr = id + base` (one add). LLInt decodes via `structureIDToStructureWithScratch` (`llint/LowLevelInterpreter64.asm:693`); JIT via `emitNonNullDecodeZeroExtendedStructureID` (`jit/AssemblyHelpers.cpp:802`, `or64` with a baked immediate).
- **`WriteBarrierStructureID`** (`runtime/WriteBarrier.h:286`): a 4-byte `WriteBarrier` for `Structure*`. Already used in `BrandedStructure`, `FunctionExecutable`, `StructureRareData`.
- **`CompactPtr<T>`** (`WTF/wtf/CompactPtr.h`): 4-byte pointer when `HAVE(36BIT_ADDRESS)`, otherwise 8 bytes. Only Apple platforms set the 36-bit flag.

### What does not exist

All non-Structure `JSCell`s are allocated via `FastMallocAlignedMemoryAllocator`: `cellSpace`, `destructibleObjectSpace`, every `IsoSubspace`, and `PreciseAllocation` for large cells all draw from the general fastMalloc heap with no bounded address range. Butterflies (`auxiliarySpace`) are also fastMalloc'd.

### Design

1. **Cell cage.** A new `CellAlignedMemoryAllocator` modelled on `StructureAlignedMemoryAllocator`: one process-wide aligned reservation (default 4 GB, configurable; `g_jscConfig.startOfCellHeap` / `cellIDBase` / `sizeOfCellHeap`). All MarkedBlock allocations for every subspace come from it. Unlike the structure allocator, it must also implement `tryAllocateMemory`/`freeMemory` so that `PreciseAllocation` (cells > ~8 KB and lower-tier-precise cells) stays inside the cage; `bmalloc_force_auxiliary_heap_into_reserved_memory` already supports this under libpas.

2. **`CellID`.** A 32-bit `uint32_t` encoding `low32(ptr)`, decoded as `ptr = id + cellIDBase`. Bit 3 (`PreciseAllocation::halfAlignment`) remains the precise-allocation discriminator. 0 is null.

3. **`WriteBarrier<T>` compression.** Either a `CompactCellPtrTraits` plugged into `WriteBarrierBase<T, Traits>` or a `WriteBarrierCellID<T>` clone of `WriteBarrierStructureID`. This halves every cell-pointer field in `Structure`, `StructureRareData`, `JSFunction`, etc. (`Structure` alone has 5 such fields = 20 bytes.)

4. **`JSValue` cell encoding.** Optional but highest-leverage: a JSValue holding a cell currently stores the raw 48-bit pointer in bits 0-48 with the top 15 bits zero (`JSCJSValue.h`). If the cage base is below `0x0001_0000_0000_0000`, the raw caged pointer already satisfies `!(value & NotCellMask)`, so `isCell()` is unchanged. `asCell()` becomes `base | low32(value)` in the JIT; the C++ side continues to store the full pointer and no change is required there. This step only matters for secondary compression (e.g. packing two cell refs per 64-bit word); the basic win comes from step 3.

5. **JIT / LLInt.** Clone `structureIDToStructureWithScratch` / `emitNonNullDecodeZeroExtendedStructureID` into a `cellID` variant reading `offsetOfJSCConfigCellIDBase`. Every site that materializes a `JSCell*` from a compressed field needs a `load32`+`or64` instead of `load64`. StructureID is the exact template; the work is breadth, not novelty.

6. **4 GB limit.** Becomes a hard cap on live `JSCell` bytes (not counting butterflies/auxiliary, which can stay outside the cage). The structure heap already enforces the same cap for `Structure` with no reported issues; for general cells, a server holding >4 GB of live cell headers (as opposed to string/array payload) is unusual but not impossible. An 8 GB cage with a 1-bit shift in `CellID` (cells are 16-byte aligned, so 4 low bits are free) is a straightforward extension.

### Expected yield

- `Structure`: 112 → ~72 bytes (below the 80-byte class) with five 8→4 pointer fields plus the Change-Set-2 cleanups. 36% per Structure.
- Every `WriteBarrier<JSCell>` in generated bindings and builtins: 8 → 4 bytes.
- Inline property storage in `JSFinalObject` stays 8 bytes/slot (JSValue is still 64-bit), so plain `{a:1}` objects do not shrink from this step.
- This is the closest analogue to V8's pointer-compression project, which they report at ~40% heap reduction for real workloads.

---

## Change Set 4: Inline Small Strings

`JSString` is 16 bytes: 8-byte `JSCell` header + 8-byte `m_fiber` (`uintptr_t`). Non-rope: `m_fiber` is a `StringImpl*`. Rope: bit 0 of `m_fiber` is set (`isRopeInPointer`) and the body is reinterpreted as packed fiber pointers.

A third variant: bit 1 (`isInlineInPointer`) set, remaining 62 bits hold

```
[ tag:2 | is8bit:1 | length:3 | payload:56 ]
```

for up to 7 Latin-1 bytes or 3 UTF-16 code units. A 5-character Latin-1 string today costs 16 B (`JSString`) + 32 B (`StringImpl` header + 8 B payload rounded) ≈ 48 B; inline it costs 16 B (67% reduction).

All JIT tiers already branch on `m_fiber & isRopeInPointer` before loading the `StringImpl*`; widening that test to `m_fiber & (isRopeInPointer | isInlineInPointer)` and routing the inline case to a new slow-path (or a dedicated fast-path for `length`/`charCodeAt`) is the bulk of the work. `JSString::value()` (returns `WTF::String`) would need to materialize a `StringImpl` on first call for inline strings; callers that only need raw characters (`tryGetValueImpl` → `nullptr` for inline, handled by fallback) can skip that.

---

## Summary Table

| Change                             | Scope                                  | Per-instance saving                     | Estimated difficulty                                                                           |
| ---------------------------------- | -------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1a. `{}` fallback 6→2              | `{}` / `new C()` with 0 analyzed props | 64→32 B (50%)                           | 1-line constant, no JIT change                                                                 |
| 1b. `[]` pre-growth 5→1            | `[]` / `new Array()`                   | 64→32 B (50%)                           | 1-line constant, no JIT change                                                                 |
| 1c. `initialOutOfLineCapacity` 4→2 | objects spilling by 1-2 props          | 16 B                                    | 1-line constant                                                                                |
| 2. `Structure` → 80 B              | every Structure                        | 112→80 B (29%)                          | Move 2 fields to rare data, reorder, 32-bit bloom, LLInt/JIT offset updates                    |
| 3. Pointer compression             | every cell-pointer field               | varies; ~40% overall in V8's experience | New allocator, `CellID` type, `WriteBarrier` traits, LLInt/JIT decode at every compressed load |
| 4. Inline small strings            | strings ≤7 Latin-1 chars               | ~48→16 B (67%)                          | New `JSString` variant, JIT branch widening, `value()` materialization                         |

Changes 1a-1b were prototyped behind `USE(BUN_JSC_ADDITIONS)` and measured below. Changes 2-4 are design-stage.

## Measured Results (Change Set 1 Prototype)

Built locally (`--webkit=local`, RelWithDebInfo) with 1a and 1b applied; compared against the release prebuilt. 1M instances per row.

| Pattern                                                            | Baseline heap/obj | Patched heap/obj |                       Delta |
| ------------------------------------------------------------------ | ----------------: | ---------------: | --------------------------: |
| `{}`                                                               |              64 B |             32 B |                    **-50%** |
| `[]`                                                               |              64 B |             48 B | -25% (LLInt/Baseline: 32 B) |
| `new Array()`                                                      |              64 B |             48 B |                        -25% |
| `{a}`, `{a,b,c}`, `{a..g}`, `[1]`, `[1..5]`, `Object.create(null)` |         unchanged |        unchanged |                           0 |

DFG/FTL's `NewArray` path applies `max(BASE_CONTIGUOUS_VECTOR_LEN=3, hint)` even when the hint is 1 (`DFGByteCodeParser.cpp:8184` + `ButterflyInlines.h:64`), so once the loop tiers up the butterfly is 32 B, not 16 B. Reaching 32 B under DFG would need `BASE_CONTIGUOUS_VECTOR_LEN` lowered too, or the hint special-cased for 0-element arrays.

Performance (1M iterations, median of 5, control-adjusted against `{x,y,z}` literal which both builds run in ~64 ms):

| Pattern                              | Baseline | Patched |  Delta |
| ------------------------------------ | -------: | ------: | -----: |
| `{}` then `helper(o)` adding 3 props |  65.9 ms | 71.6 ms |  +8.6% |
| `{}` then `helper(o)` adding 5 props |  67.7 ms | 74.5 ms | +10.0% |
| `[]` then 5× `push`                  |   9.5 ms | 10.2 ms |  +7.4% |
| `{x:i, y:i, z:i}` (control)          |  65.9 ms | 64.2 ms |  -2.6% |

The "helper adds N properties" pattern regresses because the third property now triggers a butterfly allocation that the 6-slot default avoided. Object literals (which the static analyzer sizes correctly) are unaffected. This is a real speed/space trade-off; 1a is not free.

## Inline Small String Design

### Encoding

`m_fiber` low-3-bit states today: `0b000` = `StringImpl*`, `0b001` = rope, `0b011` = rope+substring, `0b101` = rope+8bit. Only bits 0-2 are guaranteed zero on a `StringImpl*` (8-byte alignment; 16-byte only under `HAVE(36BIT_ADDRESS)`).

Proposed inline encoding (little-endian byte view of `m_fiber`):

```
byte 0             bytes 1..7
[ len:4 | 0 1 0 ]  [ c0 c1 c2 c3 c4 c5 c6 ]   // 0..7 Latin-1 bytes
```

Bit 0 = 0 distinguishes from rope. Bit 1 = 1 is the inline flag. `JSString::isSubstring()` (currently `fiber & 0x2` with no rope gate, `JSString.h:1250`) must be tightened to `(fiber & 0b11) == 0b11`; all JIT substring tests already gate on the rope bit first (`ThunkGenerators.cpp:686`). A UTF-16 variant can use bit 2 and hold 3 code units, but the Latin-1 case covers the majority of short strings (identifiers, HTTP tokens, small integers stringified).

### Materialization

`resolveInline()` mirrors `JSRopeString::resolveRope()`: allocate a `StringImpl` with the inline bytes, `storeStoreFence()`, overwrite `m_fiber` with the raw pointer. The cell becomes a plain `JSString` in place; subsequent reads are a straight pointer deref. Called from `value()`/`toAtomString()`/`getValueImpl()` when they encounter the inline bit. `view()` does not materialize: it returns a `GCOwnedDataScope<StringView>` whose `StringView` points at `reinterpret_cast<LChar*>(&m_fiber) + 1` and whose owner is the `JSString` cell (GC is non-moving for MarkedBlock cells, so the address is stable for the scope's lifetime).

### Construction

The choke points are the `jsString(VM&, ...)` family in `JSString.h:985-1030` and `jsSubstringOfResolved` in `JSStringInlines.h:823`. Intercepting before `JSString::create(VM&, Ref<StringImpl>&&)` avoids allocating the `StringImpl` at all for ≤7-byte Latin-1 inputs. `jsSingleCharacterString` already routes 1-byte strings to `SmallStrings`; 2-7 bytes would route to the inline factory.

### Touch Points

Runtime C++:

- `runtime/JSString.h`: `isSubstring()` tighten, `length()`, `is8Bit()`, `view()`, `value()`, `tryGetValue()`, `getValueImpl()`, `tryGetValueImpl()`, `toIdentifier()`, `toAtomString()`, `toExistingAtomString()`, `swapToAtomString()`, `jsString` overloads.
- `runtime/JSStringInlines.h`: `JSString::destroy` (skip `~String()` when inline), `equal()`, `equalInline()`, `resolveToBuffer()`, `jsSubstringOfResolved()`.
- `runtime/JSString.cpp`: `visitChildrenImpl` (skip `reportExtraMemoryVisited`), `estimatedSize`, `dumpToStream`.

JIT tiers — every site that does `load fiber → branch-if-rope → deref as StringImpl*` needs the branch widened to `fiber & 0b11 != 0`, with an inline-path that reads length from byte 0 and chars from bytes 1..7:

- `llint/LowLevelInterpreter64.asm:2418` / `LowLevelInterpreter32_64.asm:2230` (`op_switch_char`).
- `jit/AssemblyHelpers.h:1248` `branchIfRopeStringImpl` / `branchIfNotRopeStringImpl`.
- `jit/JITInlines.h:74` `emitLoadCharacterString`.
- `jit/ThunkGenerators.cpp:613,684-720,797,942`.
- `bytecode/InlineAccess.cpp:340` `generateStringLength`; `bytecode/InlineCacheCompiler.cpp:2386,3958`.
- `dfg/DFGSpeculativeJIT.cpp`: string length `8613`, char-at family `1728-2050`, GetByVal `2727`, indexOf `10467`, MakeRope `17657`, ResolveRope `13303`; `DFGSpeculativeJIT64.cpp:5677,6055`.
- `ftl/FTLLowerDFGToB3.cpp`: `isRopeString` `25583`, length `6230,23501`, char-at `11942,12075,12121,20581`, compare `12312,22193`, MakeRope `11704`.

The branch-widening is mechanically: replace `testPtr(fiber, TrustedImm32(isRopeInPointer))` with `testPtr(fiber, TrustedImm32(isRopeInPointer | isInlineInPointer))` and route both to the existing slow path initially; fast-path `length`/`charCodeAt` for inline can follow once correctness lands.

### Prototype Results

Implemented on `oven-sh/WebKit@bun-inline-small-strings` (11 files). `jsString(VM&, StringView)` and `jsSubstringOfResolved` create inline cells for 2-7 Latin-1 / 1-3 UTF-16 code units; all C++ accessors handle the inline bit; `branchIfRopeStringImpl` and `FTL::isRopeString` test `notStringImplMask` (0x3) so JIT tiers route inline to the existing rope slow paths; `operationResolveRopeString` materializes inline in place. DFG/FTL string-length got a direct inline-decode fast path.

All four tiers pass a 1M-iteration loop exercising `length`/`charAt`/`charCodeAt`/`===`/`+`/`indexOf`/`slice`/`toUpperCase`/`switch` on Latin-1 and UTF-16. Bun's own `stringWidth`/`bunstring-tothreadsafe`/`path` suites pass unchanged; `fetch.test.ts` has fewer failures than the unpatched baseline.

Memory (heap bytes/obj, 1M instances, verified via `$vm.value()` describe):

| Pattern               | Baseline | Patched | Delta |
| --------------------- | -------: | ------: | ----: |
| `slice(3..7)` Latin-1 |       32 |      16 |  -50% |
| `slice(2..3)` UTF-16  |       32 |      16 |  -50% |
| `slice(8+)`           |       32 |      32 |     0 |

Performance (2M ops, patched RelWithDebInfo vs baseline release; builds not perfectly comparable):

| Op on 5-char inline                 | Baseline | Patched |    Delta |
| ----------------------------------- | -------: | ------: | -------: |
| `slice()` create                    |   ~80 ms |  ~88 ms |     +10% |
| `.length`                           |    ~8 ms |  ~11 ms |     +34% |
| `.charCodeAt(0)`                    |   ~67 ms |  ~57 ms | **-15%** |
| `.length` on 20-char rope (control) |   ~12 ms |  ~12 ms |      +3% |

Phase-2/3 fast paths: DFG/FTL `compileStringEquality`/`stringsEqual` compare `m_fiber` words directly when both operands are inline; `ThunkGenerators::decodeString` decodes from the fiber word; `SpecStringInline` speculation type plumbed through the lattice so DFG/FTL emit OSR-guarded branch-free decodes for `.length`/`charCodeAt`; `FixupPhase` skips `ResolveRope` for monomorphic-inline `StringCharCodeAt`; `jsString(globalObject, a, b)` writes short concats directly into an inline cell.

Function-scoped loops, 2M ops, vs unpatched release:

| Op on 5-char inline      | Baseline |    Final |    Delta |
| ------------------------ | -------: | -------: | -------: |
| `.length`                |  14.9 ms |   6.5 ms | **-56%** |
| `.charCodeAt`            |  14.7 ms |   7.1 ms | **-52%** |
| `===` (50/50 true/false) |  30.2 ms |   7.8 ms | **-74%** |
| `=== "literal"`          |  15.1 ms |  13.9 ms |  **-8%** |
| short `a + b` concat     | 32 B/obj | 16 B/obj | **-50%** |

Net: smaller and 2-4x faster than rope substrings for the eligible range.

Correctness: all four tiers pass a 1M-iteration suite; `JSTests/stress/string-*.js` 158/160 (the two failures are ICU collation data issues in the local build environment, not this change); Bun's `node/util`/`buffer`/`path`/`stringWidth`/`url` suites, 1543 tests, 0 failures.

Prototype: `oven-sh/WebKit#307`.

## Change Set 5: Deduplicate `JSString` for Atom Strings

`AtomString` interns the `StringImpl*` process-wide, but each `jsString(vm, s)` call still allocates a fresh 16-byte `JSString` wrapper. JSC already has two direct-mapped `JSString*` caches for specific paths (`vm.jsonAtomStringCache` and `vm.keyAtomStringCache`, each a 512-slot `std::array<JSString*, 512>` keyed by `hash % 512`), but the general `jsString(VM&, const String&)` / `jsString(VM&, String&&)` entry points used by host bindings do not consult them.

Measured: `JSON.parse` of `{"m":"GET","s":"ok","t":"json"}` 100 000 times creates 4 `JSString` cells total (the cache works). `URLSearchParams::get()` returning the same value 100 000 times creates 100 000 `JSString` cells (it doesn't).

**Change:** add an `AtomString` fast path to `jsString(VM&, ...)` (`JSString.h:985-1030`) that, when the incoming `StringImpl` is already atomic, indexes a `KeyAtomStringCache`-shaped array by `impl->existingHash() % capacity` and returns the cached `JSString*` on a pointer-equal hit. Atom strings already carry a computed hash, so the lookup is one masked index and one pointer compare; no hashing, no locking. The cache is per-`VM`, holds raw `JSString*`, and is cleared on every GC the same way the existing caches are (`KeyAtomStringCache::clear()` from `Heap::finalize`).

**Effect:** eliminates duplicate `JSString` wrappers for repeated atom values returned from native code (`Request.method`, header lookups, URL component getters, enum-like string returns). 16 B per avoided duplicate; no JIT involvement; no behaviour change (returning an identical `JSString*` is unobservable since strings compare by value).
