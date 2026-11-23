# Quirks of CPUs

Instructions that are slow on some CPUs or in some situations, and what the crate does about them. Numbers are core cycles, and measured
unless a row says "read" (skx clx icx spr emr gnr: the Xeons from Skylake to Granite Rapids; zen1-5; n1 v1 v2 n3: Neoverse).

## How the crate chooses

Each quirk found so far is handled in one of five ways.

1. **A form that is good everywhere**, at no cost or a small one. Most rows below.
2. **The target tells.** `avx512` is the best level only on Skylake-X and Cascade Lake. Zen 4 and 5 have `icelake + bf16`, and Sapphire Rapids and later `icelake + fp16`. An operation can depend on that.
3. **The program decides once**, with `set_cpu` or with flags of the compiler, what a kernel can't know: how much of the time is spent in kernels.
4. **A word in the list of targets**: `fast_pdep`, `fast_gather`, `fast_zmm`, `full_zmm`, `fast_compress_store`, `fast_sha3`, `fast_clmul` (`src/simd/tuning.rs`).
5. **The operation asks**, with a load and a branch that always goes the same way: gathers of 64 bytes on `avx512` and `icelake`, and of 32 on `avx2 + vnni`, `extract_bits` and `deposit_bits`, `is_in` of 64 bytes in 16 `u32` or more, the large networks of `sort`, and `reverse` of a long slice of 32 bits on `avx2`. That costs 0.1 to 0.5 ns, so it is for slow operations only.

## What a consumer has to know

| | |
| --- | --- |
| 512 bits on Skylake-X, Cascade Lake | One such instruction slows the core for about 0.7 ms: scalar code by 15% on clx, 29% after multiplications. The default targets use `avx2` there. List `avx512` only for long kernels, or `avx512 + narrow`, which has vectors of 32 bytes. That is no guarantee: LLVM widens, and 96 of 1,095 operations at the native width have a `zmm` register there (93 with `+prefer-256-bit`). Only `avx2` has none |
| 512 bits on Ice Lake | 3%. glibc, BoringSSL, Linux and OpenJDK avoid them there; Highway, simdjson, simdutf and dav1d don't, nor does the default. The list `no_downclock` has `narrow` there. `icelake + fast_zmm, avx2 + vaes` in a list, or `set_cpu(cpu().without("avx512f"))`, turns them off. See [the trade](#the-clock) |
| Gathers from Skylake to Ice Lake | They take 2 to 5 times as long with the microcode against Downfall, which a program can't see, so `fast_gather` is off. On a machine without it, a search that gathers a lot took 1.3 to 1.5 times as long as after `set_cpu(cpu().with("fast_gather"))` |
| `store_partial`, then a load of the same 64 bytes | A masked store never forwards: 15-23 against 5-12, also if the load only touches lanes that were masked off. The same for a small store before `load_or_default` |
| Many short pieces in a row that are in no cache, read by masked loads only | 2 to 3× on Zen 5, with `vpmaskmovd` on Zen 2 to 5: the CPU seems not to fetch ahead for them. Use whole loads where the length allows. `prefetch` of each piece helps if they start less than 128 bytes apart |
| Two stores, then one load over both | 14-25. Build the vector in registers |
| A store across a page | 21-35 on all x86 and Apple M4, 8-12 on Neoverse. Align the output of long loops, as `map_into` does on x86 |
| A load across a page | 8-10 ns on Apple M4, whose pages have 16 KiB. The loads of a slice under 64 bytes overlap, so up to four can cross |
| Long chains | Simple vector instructions have latency 2 on Zen 5, masked ones of 8 and 16 bits 3 on Intel, dot products 4-6. Use several sums |
| Minimum, maximum, average and saturation of 64 bytes | One port on Intel. `max = a.xor3(b, min)` of integers in a sorting network took .7-.93 of the time on icx, spr and gnr, and 1.0-1.17 on zen4 and zen5. `sort` chooses by itself. In the list `icelake + fp16, icelake + fast_zmm, default`, these Intel CPUs have `has!(icelake) && (has!(fp16) \|\| !has!(fast_zmm))`, and Zen 4 and 5 don't |
| Loops with masks on AVX-512 | LLVM doesn't unroll a loop with `count` or `to_bitmask` in it. Short ones took .85 to 1.45 times as long as unrolled ones. `fold`, `count` and `counts` are unrolled, and so is a loop over `Twice` the width |
| Scalar loops in a kernel, on AVX-512 | LLVM can vectorize them with gathers and scatters. A loop over 5 triangles took 1.05 to 1.3 times as long, and 4 times on clx. A function with `#[shared]` and `#[inline(never)]` has none |
| A vector wider than a register, then a load at an odd place in it | LLVM takes the second from the first through general registers: 14 to 16 times the time on skx and zen2, 1.4 on v1. Load registers one by one, or take `shift_elements_right` |
| A cast from lanes of 64 bits to `f32`, or a relaxed one from `f64` to integers, right after a load of 32 bytes | If nothing else takes a long register, LLVM leaves out `vzeroupper`: 430 more for each call on spr, emr and gnr, if code for SSE follows. `map_into` from one slice avoids it for four lanes that become four of 32 bits. Elsewhere take `black_box` on what is loaded, which keeps LLVM from unrolling the loop |
| Denormals | 116-195 on Intel. Safe Rust can't turn them off |
| `core::arch` in a kernel | `pdep` and `pext` need `fast_pdep` next to `avx2` or `"bmi2"` in the list (24-143 on Zen 1, 2). Avoid compress to memory (42-168 on Zen 4), `vpmaskmov` stores (6-14 on Zen 1-4), gathers |
| SVE on Windows | Only with `panic = "abort"` |
| Rust 1.99 on x86 | `core::arch` spells out `mul_high` of 16 bits, `midpoint_up` and shifts by lanes, and LLVM doesn't always find the instruction in a loop. Encoding base64 with AVX2 took up to 2.4 times as long and base32 4.3 times, on zen2, other such loops 1.1 to 2.6. From Rust 1.102 on, each is one instruction |
| Flags | In the mean of 132 kernels, `-Cllvm-args=-x86-branches-within-32B-boundaries` gains 3% on skx and clx. `-Ztune-cpu=ampere1` (nightly) loses up to 2% on Neoverse (0.4 to 1.45 times the time). `-Cllvm-args=-lsr-drop-solution` gains less than 1% on x86, and over 20% in one. `-Cllvm-args=-x86-cmov-converter=false` keeps clamped indices free of jumps, and the mean as it is. |

## The last few percent

What [the page on speed][speed] leaves out. Numbers here are ratios of time: in the last column new over old, elsewhere old over new. Time each.

**Loops**

| Written first | Instead |
| --- | --- |
| A way for short inputs that saves the registers of the long way | `#[inline(never)]` on a helper for the long one: .9-1.15 in 49 kernels |
| All loads first, then a long chain with `/` or `sqrt`: 1.15 on x86 | Load what the chain needs first, and the rest after the division. Divide next to the root, not after it |
| A place in the output that is counted by the last mask of a long step | The first mask that tells: with AVX-512 .87-.99 on Intel, .96-1.14 on zen4 and zen5 |
| A list of the vectors that pass a first test, if two in three do | `if m.any()` in one loop: .7-1.0, short inputs up to 1.1. But 1.2-2.9 if it is hard to predict |
| `fold` with more sums than fit the registers four times: .6-1.4 beyond the caches | Time it against `exact`, or `over_all`, which keeps two sets |
| `reduce_*` for many short sums | `reduce_each`, a store, and a second loop at the full width. `for_each_part` adds up channels |
| `prefix_sum` in each round, to see where a sum passes a limit | `reduce_sum` of several vectors, then a closer look |
| `i.min(last)` for the records of each step | Whole steps by `as_chunks`, and the clamp in the last one: .5-.9 |
| Windows with a stride, whose last is copied to a buffer | Load it so that it ends with the slice, and give it a shuffle of its own |
| `Rows` in an array, which keep a check | A name for each |
| `e[0] \| e[1] << 16` | `u16x4::load(e).bitcast::<u64>()[0]`: .85-1.0 |
| Bits to a mask and back | With AVX-512, `compress_store` and `load_expand` want the mask. Elsewhere they take bits too |
| A table whose rows have a vector with a number in it | A table of its own for the numbers |
| Lanes of 16 bits as indices, through an array in memory | `bitcast::<u64>()`, and shifts: M4 .36-.85, skx and clx 1.01-1.08 |
| `push` of a slice of a few bytes | `push(v.first_n(n))` |
| `push_at` in a loop: two checks each | `store_at` in a buffer that the caller keeps |
| A result of more than 16 bytes that is moved as a whole: 4-5 ns on x86 | Read its fields |

**Operations**

| | Where | Instead |
| --- | --- | --- |
| `gather_*` | 1.3 to 3.3 times as fast as a plain loop with a clamp, for bytes from 0.9. On clx with `avx512`: level, and slower for bytes | With AVX-512, `concat_swizzle_dyn` for 32 `f32` |
| `fits &= at[i] <= last` before plain indexing | Arm: LLVM loads the indices as a vector | A branch for each |
| Plain lookups in a row with the same `& 31` | x86: up to 1.1, SSE4 1.35 | `as u8`, and a longer table |
| `recip_relaxed` and steps of Newton | In a longer step, level with `/` on AVX2, 1.05-1.25 on v2 and n3 | `/`, `sqrt`, unless 11 bits are enough on x86 |
| `Prefetch::Write`; `extract_bits` and `deposit_bits` of numbers | x86; `avx2`, `sse4 + bmi` and Arm. They test the CPU each time | Time it. For bits on x86, `fast_pdep` in the list. LLVM vectorizes no loop with the test: with one mask for a slice, take the methods of vectors |
| `dot_add` of `i16` | x86: mostly two instructions, with `vnni` too | `dot_add_relaxed` if it can't overflow, with `vnni` `saturating_dot_add`, if the loop doesn't wait for the sum |
| `dot_add` of bytes that are no constants | Most targets | `dot_add_relaxed` if they are within its limits |
| Shifts by a vector that stays the same | SSE4, AVX2 | Keep the powers of two, and multiply |
| `swizzle_dyn` of 32 bytes | zen1-3 | `in_blocks()` |
| `x as f32` of one `f16` | x86: it can wait for another register | Several in a vector |
| Vectors of 64 bytes | icx in a loop that mostly stores: 1.25. icx and zen4 in `windows`: 1.15 | The list `no_downclock`; `full_zmm` for zen4 |
| Partial loads and stores, `mul_high`, `*` and `compress` of 64 bits, a rotation after `^` | NEON | `#[simd(sve2, neon82, default)]`. The choice costs a call 0.4 to 0.8 ns, and the average kernel gained nothing |
| `to_bitmask` of 16 bytes | NEON | `iter`, `first_set`, `last_set`. `(m.to_simd::<u8>().bitcast::<u16>() >> 4).cast::<u8>().bitcast::<u64>()[0]` has four bits for each lane, in two instructions. Parsers took .92 with `neon86` |
| `/` and `%` by a vector of 32 or 64 bits, if the dividend is used again | `sve2` on v2, one vector in each round: 1.3-2 | `map_into`, or 32 bytes in each round |
| `complex_mul*` | `neon` | `fcma` |
| Little else but `xar`, `eor3` and `bcax`, with `sha3` or `sve2` | v1, v2 have one pipe. Keccak 1.2, n3 .45 | `neon + sha3 + fast_sha3`. ChaCha and BLAKE need no word: `sve2` took .9 on v2 |

**LLVM**

| Seen | Where | Cure |
| --- | --- | --- |
| `lea` or `add` for each `table[i]`, in a loop over many tables | AVX2, NEON | `hint::black_box(table)` in each round. In other loops that cost up to 70% |
| `zmm` for `fill(0)` among vectors of 32 bytes: 1.3 | AVX-512, Intel | Store a vector of zeros after `black_box()` |
| The stages of a transform under `unroll!`, one vector after the other | As many vectors as registers | `hint::black_box(&mut array)` between the stages |
| `and` and `eor` for `bcax`; `a & 0xf800 \| b >> 5`, twice in a row, without `sri` | NEON | `black_box()` on the constant, or each result |
| `mov` before `xar` | `sve2` | The operand that isn't used again on the left |
| `.rodata.cst16` of an object file aligned to 32 or 64 (`readelf -S`). LLD then pads all such constants of the program | x86, a constant array by value next to a vector, among arguments or in a `move` closure | Pass a reference |
| A call of `memset_pattern16` for `[1; 4]` | macOS, iOS | `const { [1; 4] }` |

## Memory on x86

Reciprocal throughput, unless it says latency.

| What | skx, clx | icx | spr, emr, gnr | zen1 | zen2, zen3 | zen4 | zen5 | In the crate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Masked load, 64 bytes | .5 | .9 | .65 | | | 1 | .5 | |
| .. masked-off lanes in a page that is unmapped, protected, **or just never touched** | 530 | 335 | 380-400 | | | 600 | 325 | `load_or_default`, `load_select_or_default` test the address |
| .. of an empty slice that points nowhere (`&[]`, `Vec::new()`) or past a mapping | 54 | 56 | 52-59 | | | 780-975 | 270-283 | the same test |
| `vpmaskmovd` load | .5 | .6 | .6 | 10 | .5 | .5 | .5 | `load_or_default` on `avx2`. On zen1, lanes of 8 and 16 bits go without it: .55-.7 of the time at one length, .7-1 at mixed ones, for up to a cycle on the others |
| .. next to such a page, or empty | 256-300 | 284-400 | 315-353 | 10 | 170-285 | 360-485 | 215-236 | the same test. No fault on any CPU |
| Masked store, 64 bytes | 2 | 2 | 2 | | | 2 | 1 | |
| .. next to such a page, **or one that was only read** | 485-530 | 235-275 | 240-286 | | | 595 | 380 | `store_partial` tests the address |
| `vpmaskmovd` store, 32 bytes | 1 | 1 | 1 | 14 | 12 | 12 | .5 | `store_partial` of 4 and 8 bytes takes it on Intel and Zen 5 (`fast_compress_store`): a fifth to a third of the time if the length is hard to predict, up to 0.3 ns more if not. LLVM makes it of a load, a choice and a store in one place: `select` keeps it from that. Loops in place then take .1-.6 of the time on zen2 and zen3, and on Intel 1.1 times in the mean (short closures at 1000 values 1.3-1.5). `store_select` blends too. Plain Rust still gets it |
| Load across a line / a page | 1 / 4 | 1 / 4 | 1 / 3.3 | 1.5 / 1.5 | 1 / 1 | 1 / 1 | 1 / 1 | searches align their loads |
| Store across a line / a page | 2 / 24 | 2 / 25 | 2 / 25 | 4 / 26 | 2 / 21-25 | 2 / 34 | 1 / 22 | `map_into` aligns its output from 1 KiB on, as far as groups of lanes allow: 8 KiB to an address from `malloc` in 1.2 to 2.2 times less time (zen1: the same) |
| Store of 32 bytes at an odd address within a line | 1 | .5 | .5 | 7 | 5 | 2 | .5 | |
| Store, load: latency | 6 | 6-9 | 6-7 | 9 | 9-10 | 10 | 9 | |
| Store, load of a part that isn't aligned in it | 16 | 20 | 20 | 26 | 9-10 | 10 | 9 | |
| Two stores, one load | 17 | 20 | 20 | 25 | 20-27 | 21 | 16 | `compress` did this for two halves, and now stays in registers: 1.5 to 4 times as fast |
| Masked store, load | 16 | 20-21 | 18-21 | | | 21-23 | 15 | |
| `vzeroupper` | 1 | 1 | 1 | 6 | 5, .2 | 1 | 1 | `avx2` is still no worse than `sse4` on zen1 (0.98 to 1.24 times as fast), and 1.2 to 1.6 times on zen2 |
| AVX, then SSE without `vzeroupper` | 1 | 1-4 | 390-440 | 1 | 270-340 | 1 | 2 | LLVM puts one before calls and returns, but see the casts above. Assembly of other libraries may not |
| 12 additions of 32 bytes / with one of 64 among them | 4 / 6.5 | 4 / 6.5 | 4 / 6.5 | | | 3 / 3.5 | 3 / 3.3 | Intel closes a port: don't mix widths in a loop |
| A search loop, by where its branches fall (JCC erratum) | 1.5 to 4 | 1.5 | 1.5-2.2 | 2.4 | 1.6-1.9 | 1.9 | 1 | a flag, see above |
| `vpmulld`, then all ones by `vpternlogd` in the same register | 12.5 | 12.5 | 13 | | | 4 | 5 | LLVM's form of the constant waits for what was in the register. The crate makes its own from a cleared register; **open** where LLVM makes one from `v + 1` |
| A call: direct / through the table | 4.5-6.5 / 4.5 | 5-7 / 5 | 4-5 / 3.5-5 | 7 / 7 | 4.3 / 5-5.8 | 4.2 / 4.1 | 4 / 4 | nothing to gain |

4K aliasing didn't show in a copy of 32 bytes in two cycles, and made a cheap map take up to 2.7 times as long on skx, clx, icx and n3. With stores that go around the caches it was up to 5 times on zen1 and zen2, and on icx 2 to 50 times, the more the narrower the vector. So their loops load four vectors first if the output is up to three vectors ahead, but not for `interleaved` or vectors wider than a register. At three to six vectors of 16 bytes, a long closure still takes up to 12 times as long on icx. The test in `load_or_default` and `store_partial` is two instructions and a branch, and a vector that ends
with the slice takes over next to the end of a page. At the same address each time it costs about a cycle. At random addresses the branch misses once in 64, and a
call on a string that is shorter than a vector takes 5-30% longer than without the test. It pays if one call in 200 would have hit an absent page or, on Zen 4, one in
500 has an empty slice that points nowhere. It misses a vector of 64 bytes that is beyond the page by one lane, and an empty `Vec` that is seen as narrower lanes. glibc's `memset` has such a test. `load_row` and `store_row` have none: mostly the last rows are hit, and with the test a loop over short rows took 1.1 to 1.4 times as long.

## Neoverse

Cycles for each instruction, on registers of 16 bytes, if none waits for another. `ldp` moves two registers and `ld4` four, for lanes of 8 and of 32 bits alike. The number of instructions says little here.

| What | v1 | v2 | n3 |
| --- | --- | --- | --- |
| Addition, `fmul`, `tbl` in one register | .5 | .25 | .5 |
| Shift, `shrn`, `mul` of 32 bits | .5 | .5 | 1 |
| `tbl` in 2 / 3 / 4 registers | .5 / 1 / 1.5 | .5 / .7 / .9 | .5 / 1 / 1.5 |
| `f16` to `f32` (`widening_mul_add` with `neon86 + fhm` needs none), `f32` to and from `i32` | 1 | 1 | 2 |
| `addv` / a lane to a general register | 1.3 / 1 | 1.3 / 1 | 2 / .5 |
| `ldp` at a multiple of 16 / elsewhere | .67 / 1.1 | .67 / 1.3 | 1 / 1 |
| `stp` at a multiple of 16 / elsewhere | 1 / 1.5 | 1 / 1.6 | 1 / 1.25 |
| `ld2` / `ld3` / `ld4` | .8 / 2.2 / 5.1 | .8 / 2 / 5.1 | 1.1 / 3 / 4 |
| `ld3` that also moves the pointer, as LLVM makes it in a forward loop, but for `load_interleaved` | 3.1 | 3 | 3 |
| `st2` / `st3` / `st4` | 1 / 2.5 / 4.1 | 1 / 2 / 4.1 | 1 / 3 / 3 |

## The clock

By how many percent a chain of additions slows down if a kernel runs every so often. One run, the best of 9;
noise is about 1, on spr, emr and zen5 up to 5. The starting clock depends on what the other cores do, which may be why skx loses so little.

| | skx | clx | icx | spr | emr | gnr | zen4, zen5 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| One 512-bit comparison every 20 or 300 µs | 1 | 15-16 | 3 | 0 | 0 | 0 | 0 |
| .. every 1 ms / 3 ms | 3 / 1 | 11 / 3 | 2 / 1 | 0 | 0 | 0 | 0 |
| Two 512-bit multiplications every 20 µs | 1 | 16 | 3 | 0 | 10 | 1-2 | 0 |
| 128 of them every 20 µs | 6-8 | 29 | 3-4, of integers up to 25 | 0 | 10 | 3 | 0 |
| 256 multiplications of 256 bits every 20 µs | 2-4 | 16 | 1 | 1 | 1 | 1 | 0 |
| 256-bit comparisons, VEX or EVEX | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

The time of a whole program on `avx512 + aes` over that on `avx2 + aes`, by the share of the time that it spends in kernels (two runs; searches, maps, checks of UTF-8 and sums of integers; inputs of 64 to 512 bytes / of 4 to 32 KiB):

| Share | skx | clx | icx | icx, another machine |
| --- | --- | --- | --- | --- |
| 0.1 to 1% | 1.03 | 1.15 | 1.03 | 1.06 |
| 10% | 1.03 / 1.00 | 1.15 / 1.12 | 1.03 / 1.01 | 1.06 / 1.05 |
| 50% | 0.96 / 0.89 | 1.08 / 0.99 | 0.97 / 0.93 | 1.01 / 0.97 |
| 100% | 0.87 / 0.72 | 0.96 / 0.80 | 0.90 / 0.82 | 0.92 / 0.87 |

Other machines with clx began at 1.01 to 1.18. With multiplications and floats, icx has up to 1.09 / 1.22 at small shares. `avx512 + narrow` stays within 0.96 to 1.04 up to 50%.

After 3 ms without vectors, a search of 4 KiB takes 150 ns more on skx and clx and 90 on icx, at 256 and at 512 bits alike, and 20 to 55 at 128. Elsewhere wider vectors lose no more.

What kernels lose without 512 bits (the time on `avx2 + vaes` over that on `icelake`, geometric means):

| | icx | spr | gnr | zen4 | zen5 |
| --- | --- | --- | --- | --- | --- |
| strings, two sets of kernels | 1.11 / 1.11 | 1.16 / 1.27 | 1.10 / 1.15 | 1.08 / 1.00 | 1.07 / 1.14 |
| parsers | 1.34 | 1.47 | 1.43 | 1.33 | 1.30 |
| hashes / images | 1.12 / 1.05 | 1.13 / 1.10 | 1.12 / 1.08 | 1.15 / 1.04 | 1.17 / 1.14 |

On Ice Lake, 512 bits pay if more than 15 to 55% of the time is spent in kernels like the searches, or 10% in those like the parsers, or if something else in
the process uses them anyway. On Cascade Lake that share was half with long inputs, and more with short ones.

## Not measured

Haswell, Broadwell, Intel's client and Atom cores, AMD before Zen, Cortex-A5x, Ampere, Snapdragon. The
trap at the first SVE instruction after a system call (Linux before 6.2, by glibc). The same trap in a new thread takes 350 to 600 ns on V2 and N3, so `sve2` isn't chosen on such kernels. SMT, and data outside of L1.

[speed]: speed.md
