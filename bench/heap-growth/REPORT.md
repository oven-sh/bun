# JSC heap growth factor characterization for Bun

**Binary**: Bun 1.4.0 release (main @ df84f8db), linux-x64, 256 GB host.
**Method**: `BUN_JSC_logGC=1` parsed for per-collection live set, VmHWM polled for peak RSS, 3-5 reps per arm, medians reported.

## Effective defaults in Bun (not upstream JSC)

| option | upstream | Bun | where |
|---|---|---|---|
| `heapGrowthMaxIncrease` | 3.0 | **2.0** | `src/jsc/bindings/ZigGlobalObject.cpp:319` |
| `heapGrowthSteepnessFactor` | 2.0 | **1.0** | `src/jsc/bindings/ZigGlobalObject.cpp:318` |
| `smallHeapRAMFraction` | 0.25 | **0.8** | `Options.cpp:610` (because `USE_MEMORY_FOOTPRINT_API`) |
| `mediumHeapRAMFraction` | 0.5 | **0.9** | `Options.cpp:611` |
| `smallHeapGrowthFactor` | 2.0 | 2.0 | |
| `mediumHeapGrowthFactor` | 1.5 | 1.5 | |
| `largeHeapGrowthFactor` | 1.24 | 1.24 | |

So on ≥16 GB the trigger ratio is `2·e^(−heap/RAM)+1 ≈ 3.0` (heap ≪ RAM).
On <16 GB it is a flat `2.0×` until process RSS reaches 80% of RAM.

## Live sets (Bun defaults)

| workload | live MB | peak heap MB | peak RSS MB | native MB | notes |
|---|---|---|---|---|---|
| tsc 5.9 (2000-mod synthetic) | 221 | 814 | 1042 | ~228 | single process |
| `next build --webpack` | 84 | 362 | 579 | | 10 heaps; primary shown |
| synth (hold ~160 MB, churn 6 GB) | ~100-165 | 416 | 529 | | |
| express (150 MB cache, 15s @ 64c) | 181 | 376 | 344 | | heap<RSS: overshoot counted as heap |
| fastify (same) | 182 | 207 | 363 | | |
| elysia (same) | 180 | 276 | 293 | | |
| node:http (same) | 179 | 196 | 314 | | |

## The hard floor: `minEdenToOldGenerationRatio = 1/3`

`Heap.cpp:2586-2589`: after each eden GC, if `remainingHeapSize / maxHeapSize < 1/3`, the next collection is forced full. With `maxHeapSize = factor × live` and `remaining ≈ (factor-1) × live`, the condition reduces to **factor < 1.5**. Below that, every eden GC schedules a full GC.

This is not a tunable option; it is a literal `1.0 / 3.0` in the source.

## ≥16 GB regime: `heapGrowthMaxIncrease` sweep (steepness=1.0)

### tsc (5 reps, median)

| MI | ratio | RSS MB | heap MB | wall s | CPU s | full GCs | full ms |
|---|---|---|---|---|---|---|---|
| 0.5 | ~1.5 | 796 | 598 | 5.40 | 15 | 6 | 615 |
| 0.75 | ~1.75 | **869** | 642 | 4.61 | 14.0 | 5 | 260 |
| 1.0 | ~2.0 | **893** | 685 | 5.50 | 15.2 | 4 | 196 |
| 1.25 | ~2.25 | 930 | 677 | 5.67 | 14.4 | 3 | 182 |
| 1.5 | ~2.5 | 885 | 636 | 4.95 | 13.7 | 2 | 51 |
| **2.0 (current)** | ~3.0 | 1034 | 812 | 4.49 | 13.5 | 2 | 56 |
| 3.0 | ~4.0 | 1260 | 1022 | 6.28 | 17 | 2 | 79 |

### next build --webpack (3 reps)

| MI | RSS MB | heap MB | wall s | CPU s | full GCs |
|---|---|---|---|---|---|
| 1.0 | 491 | 261 | 17 | 33 | 7 |
| **2.0** | 625 | 386 | 16 | 31 | 3 |

### servers under load (3 reps, median; cpu µs/req = server user+sys / requests)

| MI | express RSS | express µs/req | express full | fastify RSS | fastify µs/req | fastify full |
|---|---|---|---|---|---|---|
| 0.5 | 324 | 310 | **78** | 337 | 221 | **58** |
| 1.0 | 351 | 151 | 3 | 369 | 118 | 2 |
| 1.5 | 349 | 164 | 2 | 365 | 113 | 2 |
| **2.0** | 344 | 127 | 3 | 369 | 90 | 2 |
| 3.0 | 339 | 191 | 2 | 363 | 161 | 2 |

Server rps has ~30% run-to-run noise (load generator + shared host); RSS is stable. Above MI=0.5 the full-GC count is flat and CPU/req is within noise.

### Steepness (MI=2.0, tsc)

| steepness | RSS MB | heap MB | wall s |
|---|---|---|---|
| 0.5 | 1032 | 818 | 5.37 |
| 1.0 | 1019 | 803 | 5.80 |
| 2.0 | 1017 | 801 | 5.30 |
| 4.0 | 1020 | 787 | 4.46 |

No effect: `heap/RAM ≈ 0.003`, so `e^(−s·x) ≈ 1` for any `s` tested. Steepness would only bite on a host where one process's heap is a large fraction of RAM (multi-GB heap on a 16-32 GB box).

## <16 GB regime (`forceRAMSize=8GB`): `smallHeapGrowthFactor` sweep

### tsc

| factor | RSS MB | heap MB | wall s | CPU s | full GCs |
|---|---|---|---|---|---|
| 1.3 | 759 | 522 | 4.53 | 15 | 9 |
| 1.5 | 813 | 603 | 4.71 | 14 | 6 |
| 1.75 | 879 | 644 | 4.20 | 13 | 5 |
| **2.0** | 889 | 631 | 4.28 | 12 | 3 |
| 2.5 | 889 | 639 | 4.58 | 14 | 2 |

### servers (cliff demonstration)

| factor | express full | express CPU s | express µs/req | fastify full | fastify CPU s |
|---|---|---|---|---|---|
| 1.3 | **183** | **55** | 295 | **178** | **54** |
| 1.5 | **180** | **55** | 295 | **191** | **56** |
| 1.75 | 4 | 22 | 140 | 2 | 22 |
| **2.0** | 3 | 22 | 131 | 2 | 22 |
| 2.5 | 2 | 22 | 138 | 2 | 22 |

RSS is 342-366 MB across the entire range; tightening the factor buys nothing on servers.

## With `minEdenToOldGenerationRatio` as a knob ([oven-sh/WebKit#332](https://github.com/oven-sh/WebKit/pull/332))

Re-swept with a local-WebKit build exposing `Options::minEdenToOldGenerationRatio()`. The cliff moves exactly as `floor = 1/(1-ratio)` predicts:

### express full-GC count /15s (thrash indicator)

| MI → | 0.3 | 0.5 | 0.75 | 1.0 |
|---|---|---|---|---|
| ratio = 1/3 (current) | 205 | 182 | 4 | 3 |
| ratio = 0.25 | 203 | 5 | 3 | 2 |
| **ratio = 0.20** | 10 | 3 | 2 | 2 |

### tsc RSS / wall / CPU by ratio × MI (median of 3)

| ratio | MI | RSS MB | wall s | CPU s | full GCs |
|---|---|---|---|---|---|
| 1/3 | 2.0 (current) | 1035 | 4.29 | 12.1 | 2 |
| 1/3 | 1.0 | 875 | 4.45 | 12.5 | 3 |
| **0.20** | **0.5** | **800** | 4.41 | 12.5 | 4 |
| 0.20 | 0.3 | 748 | 4.45 | 14.2 | 8 |

### <16 GB (forceRAMSize=8GB) tsc RSS by ratio × smallHeapGrowthFactor

| ratio | small | RSS MB | wall s | CPU s | full GCs |
|---|---|---|---|---|---|
| 1/3 | 2.0 (current) | 887 | 4.20 | 11.8 | 3 |
| **0.20** | **1.5** | **793** | 4.40 | 13.1 | 4 |
| 0.20 | 1.3 | 747 | 4.58 | 14.9 | 8 |

Server RSS unchanged across every arm. Full dataset: `results2.ndjson`.

## Recommendations

Two options depending on appetite:

### Conservative (no WebKit change)

Set `heapGrowthMaxIncrease = 1.0` (from 2.0) in `ZigGlobalObject.cpp`. Keep everything else.

- tsc: −15% peak RSS, ≤5% wall
- next build: −21% peak RSS, wall flat
- servers: neutral
- safe margin above the 1.5 floor

### With the eden-ratio knob (after oven-sh/WebKit#332 lands)

Set in `ZigGlobalObject.cpp`:

- `minEdenToOldGenerationRatio = 0.2`
- `heapGrowthMaxIncrease = 0.5`
- `smallHeapGrowthFactor = 1.5`

Effect vs current:

- tsc: **−23% peak RSS** (1035 → 800 MB), +3% wall, +3% CPU
- <16 GB tsc: **−11% peak RSS** (887 → 793 MB), +5% wall
- servers: neutral (no thrash at these settings with ratio=0.2)
- Node v26.3.0 reference: tsc 606 MB; this closes ~55% of the gap

Going tighter (MI=0.3, small=1.3) saves another ~5% RSS but costs +15-25% CPU on builds; not recommended.

`heapGrowthSteepnessFactor` stays 1.0 (no effect for heap ≪ RAM). `mediumHeapGrowthFactor`/`largeHeapGrowthFactor` are moot with `RAMFraction` at 0.8/0.9; leave at defaults.

## Caveats

- Server rps/CPU has ~30% noise (bun-based load generator on shared host). The full-GC counts and RSS are stable; throughput deltas within 20% should not be trusted.
- `next build` is multi-process; only the primary heap's RSS is attributed.
- Workloads were reconstructed, not the internal `bun-perf-tester` suite.
- `logGC=1` overhead is ~negligible (a few µs/collection of printf) but was on for all arms equally.
