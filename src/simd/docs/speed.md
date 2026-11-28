# Speed

Most first versions lose time in the shape of their loops, and not in single operations. [The guide][guide] has the basics.

1. **Put the whole loop in the kernel**, and take a loop of `over` if one fits. No scalar tail, and no copy of the tail to a buffer.
2. **Stay in vectors.** `reduce_*`, `count`, `to_bitmask` and `v[i]` come after the loop, or once for several vectors.
3. **Keep partial loads and stores out of the loop**: `exact`, and one step for the rest, which can [overlap](#overlap).
4. **Fit the step to the usual length.** [Short inputs](#short-inputs) want a straight path, no wider than they are, and one register of sums.
5. **Count chains and registers.** One long chain in a round wants two vectors, `Twice`. With more chains, time both: all has to fit the registers.
6. **Cut slices before the loop**, and the bounds checks go: `zip`, `over_all`, `as_chunks`, `chunk_at`, `Rows`.
7. **Take `_relaxed`** where NaN and the last bit don't matter, and `mul_add_relaxed` for `a * b + c`.
8. **Look up, and don't gather.** Load records by `interleaved`, not lane by lane. Shuffle within 16 bytes, by `in_blocks()`.
9. **Move what is rare out of the loop**, by `#[cold]`.
10. **Set `codegen-units = 1`**, time [each target](#by-target), and [read the inner loop](#reading-the-assembly).

That is enough for a first version. The rest is for looking up. “1.5×” means up to 1.5 times as long as the better form.

| | |
| --- | --- |
| The shape of a loop | [What is slow](#what-is-slow), [short inputs](#short-inputs), [overlap](#overlap), [less work](#less-work) |
| An operation or a target | [By target](#by-target), [slow operations](#slow-operations) |
| After timing | [Flags](#flags), [the assembly](#reading-the-assembly), [what LLVM undoes](#what-llvm-undoes). [Constant time](#constant-time) |
| Other pages | [Three larger loops][loops]: long chains, stencils, matrices. [Quirks][quirks]: single CPUs, and the last few percent |

## What is slow

The most costly come first.

**Tails, short inputs and rows**

| Written first | Instead |
| --- | --- |
| A scalar tail or border. A tail that is copied to a buffer | A loop of `over`, `load_or_default`, `load_interleaved_or_default`, or [overlap](#overlap). A padded copy pays only if many loads read it |
| A loop of up to three rounds, whose count varies: up to 6 ns a call | [A straight path](#short-inputs) |
| A branch on values that is hard to predict | `&` and `\|` for `&&` and `\|\|`, `core::hint::select_unpredictable` for `if`. To choose between slices, keep the branch |
| `load_or_default` or `store_partial` in each round | `map_into`, `scan_into`, `unzip_into`, or `exact` with `as_chunks_mut` |
| A step that is wider than the usual input, such as `u8x64` on AVX2 and NEON | `u8xN`, `Upto<B32, S>`. For a long step, `fn step<W: Width>`, with `Half<Native<S>>` if the rest fits |
| Sums that are wider than a register, for short runs: 2.5× on Arm, 2× on SSE4, else 1.6× | One register of sums |
| `count_before_first` at the end of a search that mostly finds nothing, if the next step waits for it: 2× on x86 and NEON, alone in a chain 9× | `first_set`, and a branch |
| Rare calls on fewer than 16 bytes: up to 1.4× on x86, as code and wide registers are cold | `u8x16::over(x)` if `x.len() < 16`, or `f::baseline(x)` in the caller. Many calls in a row, with lengths on both sides of 16, then take up to 3.4× |
| In place, `store_last` before the loop | `load_last` before it, and `store_last` after it |
| A loop of `over` for each row of up to 512 bytes: 1.6×, with a cheap step 5× | One loop over all rows, `as_chunks` with a fixed width, or `exact` and `if !rest.is_empty()` |
| `load_or_default` for each short row, or a second loop for the last rows | `load_row` and `store_row` with AVX-512. On AVX2 `load_short` and `store_short`, for steps lane by lane |
| A short inner loop, whose count is known at run time only | A `const` parameter, and one `match` before the rows. Else `not_unrolled()` |

**The loop**

| Written first | Instead |
| --- | --- |
| `reduce_*`, `m.count()` or `v[i]` in it | A vector of sums. For many short sums, a lane for each, or `reduce_each` |
| One vector for one long chain, such as `ln`, then `exp`, then `/`: 1.5× on NEON, 1.3× on AVX2 | `Twice`, an array of vectors, or [one step ahead][ahead] |
| `Twice` with more sums and constants than registers: 1.6× on AVX2 | One vector |
| On long slices, a step whose widest lanes fill one register only: 2× on NEON | A step of `B64` or `B128` |
| One vector of sums in a `for` over `exact`, with a cheap step: 3.8× on NEON, 3.2× on AVX2 | `fold`, which has several |
| A rare branch or call, such as `Vec::push`: 1.6× | A function with `#[cold]` `#[inline(never)]`, or `core::hint::cold_path()` |
| `for` over an array of vectors, which can go through the stack | `unroll!`, `array::from_fn` |
| A carry that is taken from the result, so that rounds wait for each other | See [neighbors][neighbors] |
| An inner loop that loads and stores its sums | [A tile][tiles] of them in registers |
| `iter().map(..).sum()` of bytes into a wider number: 11× on x86, 8× on NEON | `over(x).sum_wide()` |
| A pass for each result | One `fold` or `scan` with several |
| A round for each bit of a bitmask, if there are many: 1.4× | Arithmetic on all 64 bits. Two rounds without a test, then the loop |
| `position` again after each candidate | `positions` |
| `lend` between stores of 256 bytes: 3 to 11× on x86 | All are lent first, or one that is split |
| `m = m \| ..` for a mask that outlasts the round | `m \|= ..` |

**Bounds checks**

| Written first | Instead |
| --- | --- |
| `s[at..][..N]`, `s.get(at..at + N)`: two or three checks | `s.chunk_at::<N>(at)`, `load_at`, `store_at`: one. `sub_array`: none |
| Several slices with one index. The `zip` of `std` after `exact()` | `over(x).zip(a).zip(b).exact()`, `over_all`, or cut all to one length first |
| `&src[y * w..]`, on x86 `load_at` with `i += w`, or a step other than the vector, such as 64 loaded and 48 used | `Rows::new(src, step, width, count)` and `RowsMut`, for three rows or more, if `count` takes no division. Rows can overlap |
| Small accesses at computed places | One array, a little longer than a power of two `M`, and `at & (M - 1)`, where a wrong one wraps. A `u8` needs no check in an array of 256 |
| `get(i).map_or(..)`, on x86 at times `table[i.min(last)]`: a jump. If it is hard to predict: 7×, and 1.7×. If not, the jump can win | `table[select_unpredictable(i < table.len(), i, 0)]`, if the first value will do. `gather_or` |
| `if a <= b { i += n }` in a merge of sorted lists: a conditional move, for which the next load waits. 2 to 3× on x86 if it is easy to predict, else 0.8 to 1.2× | `core::hint::black_box(())` in the branch |
| A check between long chains and their stores: 1.4× on NEON, 1.1× on x86 | Cut the output first, by `chunk_at_mut` |

**Records, shuffles, bits and buffers**

| Written first | Instead |
| --- | --- |
| `from_fn` with a stride, or a gather for each field | `interleaved`, `gather_interleaved`. For structs, `from_parts` and `transpose_in_blocks` |
| Several shuffles that cross blocks: `interleave`, `cast`, narrowing | `in_blocks()`, and one `swizzle` at the end. Narrow two vectors to one. `load_interleaved`, `store_interleaved` |
| The same shuffle of the same values in each round | Split them into planes once |
| `from_bitmask` for each vector | `selected`, `zip_bits`, `pad(x)` before `padded` |
| A lookup, and a `select` for what is out of range | `lookup_or`, also in a vector: `i.lookup_or(&v.to_array(), or)` |
| `first_n`, `selected` or `low_bytes` pushed in a tight loop: up to 1.3×, of a single lane 2×, and more code | Push to what `out.room_for(n)` returns. A constant `n` drops the code for the end. So does `push_with_slack`, if whole vectors always fit |
| Many such pushes in an inner loop: 2.5× | `push_with_slack` after `out.limit(n)`, so that the sums don't wait for the length |
| A tuple with several such parts at the end of a short output without room to spare: 2.5× | A push for each |
| A buffer that is zeroed in each call: 45 ns for 4 KiB | [Scratch memory][memory] in an `Output` |
| A `const fn` that makes a table in the kernel | `const { .. }` around the call |
| Arrays as arguments or results of a kernel, which are copied | References |
| Vectors as arguments of a call by a pointer or `dyn`: 3 to 30 ns | Slices, or a `match` in the loop |

## Short inputs

If most inputs have one to three vectors, their lengths vary and the step is cheap, take the first, the middle and the last vector, which overlap. Where no value may count twice, a mask takes out what was seen.

```
# #[forbid(unsafe_code)] #[bun_simd::simd] mod simd { use bun_simd::prelude::*;
#[kernel]
pub fn sum(bytes: &[u8]) -> u64 {
    let len = bytes.len();
    if !(32..=96).contains(&len) {
        return any_length(bytes);
    }
    let middle = len.min(64);
    let a = u8x32::load(bytes);
    let b = mask8x32::first_n(64 - middle).select(0, u8x32::load_last(&bytes[..middle]));
    let c = mask8x32::first_n(96 - len).select(0, u8x32::load_last(bytes));
    (a.sum_groups::<u64>() + b.sum_groups() + c.sum_groups()).reduce_sum()
}

#[inline(never)]
fn any_length(bytes: &[u8]) -> u64 {
    over(bytes).fold(u64xN::zero(), |sum, v| sum + v.sum_groups(), |a, b| a + b).reduce_sum()
}
# } fn main() {
# for len in 0..200 {
# assert_eq!(simd::sum(&(1..=len as u8).collect::<Vec<_>>()), len * (len + 1) / 2);
# }
assert_eq!(simd::sum(&[2; 70]), 140);
# }
```

With lengths of 32 to 96 at random, this took half of the time of the loop, and with 8 to 200 the same. With one length, or with `exp` or a division, the loop was up to 1.5 times as fast.

- Below one vector, do the same with a narrower one. `load_short` and `store_short` repeat values: they are for steps lane by lane.
- With AVX-512, one `load_or_default` or `store_partial` of `B128` or `B256`, and `split`, is such a path.
- Do the general case here, and don't test for easy ones.
- For a search, shift the bitmasks to their places in a `u64`. A `u128` shifts slowly.

## Overlap

With a separate output, take the step that overlaps first, and go on where whole steps remain. For long inputs, that step takes the last vector and the loop `[..n - 1]`, which stays aligned. Don't clamp the index in each round of a cheap step: 1.9×.

```
# #[forbid(unsafe_code)] #[bun_simd::simd] mod simd { use bun_simd::prelude::*;
fn step(a: &[u8], b: &[u8], to: &mut [u8]) {
    u8xN::load(a).abs_diff(u8xN::load(b)).store(to);
}

/// For a vector or more.
#[kernel]
pub fn distances(a: &[u8], b: &[u8], to: &mut [u8]) {
    step(a, b, to);
    let (lanes, n) = (u8xN::LANES, to.len());
    let done = (n - 1) % lanes + 1;
    let (a, b) = (a[done..n].chunks_exact(lanes), b[done..n].chunks_exact(lanes));
    for ((a, b), to) in a.zip(b).zip(to[done..].chunks_exact_mut(lanes)) {
        step(a, b, to);
    }
}
# } use {bun_simd::prelude::*, simd::*}; fn main() {
let mut to = [0; 100];
distances(&[1; 100], &[4; 100], &mut to);
assert_eq!(to, [3; 100]);
# }
```

Without AVX-512 or `sve2`, partial loads and stores mostly branch on the length. Overlap saved short inputs of mixed lengths up to 45% there.

## Less work

- **The range that occurs.** A short formula for the usual values, such as `polynomial_relaxed`, or `exp_relaxed` and `ln_relaxed` with 16 bits. Join the tests by `|` or `simd_max`, ask once for several vectors, and send the rest to a cold path.
- **Narrower lanes.** Test and mend values before they are widened. If the usual ones fit 16 bits, `in_blocks().saturating_narrow` doubles the lanes.
- **One load for several results.** Neighboring outputs of a filter share samples, and rows of a [stencil][strips] their sums.
- **Passes over a batch.** Lookups that wait for memory go faster in steps over many keys: hash, load, resolve.
- **Bits as data.** A small set is `u32xN::splat(bits) >> v & 1`, for `v` below 32. Positive floats compare as integers. `bit_planes` makes a bit of each cell. `u8xN::iota(0).compress(m)` has places for `swizzle_dyn`.
- **Classes of input**, such as ASCII or zeros, pay on long inputs only.
- **A guess.** A record is often as long as the one before: check that, and search only if it fails.

## By target

A trick for one target often loses on another. Give it `has!` or `#[only(..)]`.

| | SSE4, AVX2 | `icelake` | NEON |
| --- | --- | --- | --- |
| Registers | 16 | 32, and masks apart: join passes | 32 of 16 bytes: `u8x32` takes two |
| Short inputs | A branch to a narrower vector | No branch, if the step is cheap | As AVX2 |
| Bytes in one lookup | 16. Take nibbles, `ByteSet`, `in_blocks().lookup_bytes` | 128, also of two vectors: `concat_swizzle_dyn` | 64 |
| Unsigned `<` | Three instructions: take `<=` below 64 bits, `saturating_sub` or signed lanes | One | One |
| Masks | `to_bitmask` is cheap. Join masks one register at a time | Keep the mask: `m.select(sum + x, sum)` is one instruction | `to_bitmask` pays for 64 lanes only. `first_set`, `any`, `m.select(index, found)` |
| Records, small squares | One in each block | `swizzle` of 64 bytes, `compress`, `expand`. For bits `galois_affine`, `rotate_bytes_from` | `load_interleaved` |
| Not in the default list | `sse4 + aes`, `avx2 + vaes` for `aes_*` and `carryless_mul_*` | `+ bf16`, `+ fp16` | `neon + aes` for the same. `neon82`, `neon86` for `dot`, `f16`, `bf16`. `sve2` gained nothing on average |

## Slow operations

The common operations are one instruction. These surprised people.

| | Where | Instead |
| --- | --- | --- |
| `gather_*` | Everywhere: a load for each lane, and more | `lookup` in up to 128 bytes, 256 single bytes, with AVX-512 1024. `gather_interleaved` for records, and for values in range |
| Gathers by indices from memory | All but Skylake: 1.7× | `table[at[i] as usize]` in `from_parts` of 16 bytes each. For single values, time `gather_interleaved` too: it wins with a fast instruction |
| Gathers of records with three floats | x86: 1.7× | Have one more value at the end of the table, and load four: `load_at` in `from_parts`, then `transpose_in_blocks` |
| Gathers in a small table, if each waits for the one before | All: 3.5× | Eight chains of plain lookups |
| `table[at] += x` at indices from `to_array` or `v[i]` | Zen 4: 9× | `gather_windows::<_, 1, N>` in `as_cells(table)`, which clamps the indices |
| `lookup` of wide values by widened indices | Below AVX-512: 1.3 to 5× | Keep the indices as bytes, 16 or more. For long sums, on all targets, a table for each byte: see `lookup` |
| `simd_max`, `reduce_max`, `cast` and `round_cast` of floats | x86, by four instructions or more on AVX2 | `_relaxed`. Clamp, then `cast_relaxed::<i32>` |
| `/`, `sqrt` | AVX-512 on Intel: 1.3×. Alone in a loop, `1.0 / v` on all x86: 3.3× | `recip_relaxed`, `recip_sqrt_relaxed` and steps of Newton, under `has!(avx512)` |
| `/` and `%` of integers by a number that is no constant, in a loop of `over`, or behind a branch or a bounds check | x86: 2.6×, behind a test 6×. Lanes of 64 bits behind a test: x86 12×, Arm 7× | A `Divisor`, made before the loop |
| Long loops that aren't aligned | AVX-512: 2.6×, other x86 2.1×, Arm 1.5× | Searches and counts align themselves, on x86 also `sum`, `dot`, and `map_into` as far as its groups allow. `fold`, `scan_into`, `unzip_into` and `bitmask_into` don't: from 1 KiB on, begin with an overlapping or padded step |
| `compress` of more than 16 bytes | Below AVX-512 | `compress_store`, `compress_relaxed`. On NEON, `f32x8` beats `f32x4` |
| Shifts and rotations by a vector | SSE4; 8 and 16 bits on AVX2 | Wider lanes |
| `*` of integers | x86, for 8 bits, 32 on Intel, 64 below AVX-512 | `dot`, `saturating_dot`, `widening_mul_even` |
| `cast` between floats and `u32` or 64 bits | SSE4, AVX2 | By way of `i32`, if the values fit |
| `leading_zeros`, `ilog2` | x86, but for 32 and 64 bits with AVX-512 | The exponent of `cast::<f32>()`, below 2^24 |
| `v * sign.signum()` | SSE4, AVX2: up to 3× | `neg_if_negative_relaxed`, which elsewhere can differ for a zero sign: see its page |
| Subnormal floats, also in lanes that are thrown away, and in functions such as `atan` of an `f32` below 1e-9 | Intel: over 100 cycles | Set small operands to zero, or scale by a power of two |
| Plain loops or `from_fn` with an index or a stride | AVX-512, where LLVM gathers and scatters: 3×, in nested loops 18× | `gather_or_default`, `interleaved`, `transpose`, or `core::hint::black_box(())` in the outer of two loops |
| A load soon after `store_partial` in the same 64 bytes | AVX-512, `sve2`: 1.5×, in a loop of only these 7× | All loads first, or overlap |
| Storing more than is needed, to save a branch | All. Four times as much: 3× | As much as is usual, and a branch for the rest |
| A comparison and `select` for which the next round waits | AVX-512: 2×, but not for floats on Intel | Leave `icelake` out of the list of this kernel |
| Many `simd_min`, `simd_max` or saturations of 64 bytes | Intel has one port: 1.5× | Logic, which loses on Zen 4 and 5: see [the quirks][quirks] |
| `avx2` for scalar code, where LLVM copies by 32 bytes | Intel, in a call after a pause: 2.3×. Copies that overlap: 2.6× | `sse4 + bmi` |
| Many comparisons of bytes | AVX-512 | `ByteSet`, `ByteClasses` |
| `load_interleaved` of 3 and 4, conversions, `reduce_*`, `v[i]` | Neoverse: as long as up to 20 additions | Plain loads and `concat_swizzle_dyn`, if a shuffle is needed anyway |
| `mul_add` with a constant to add | NEON, which copies it | `polynomial_relaxed` |
| Many numbers from an array as factors | NEON: a register each | One load, and `splat_lane` |

## Flags

- **`codegen-units = 1`** in `[profile.release]`, or in `[profile.release.package.<crate with the kernels>]`. Else generic functions of `core`, such as `Iterator::sum`, `Vec::extend`, `array.map` and `zip` of many slices, can stay out of line: 17×. LTO doesn't help.
  A library can't choose the profile: it takes `for`, the loops of `over`, `array::from_fn`, `array::map` and `Output`, and checks a build with the defaults.
- **`-Ctarget-cpu=nehalem`** (x86-64-v2) for code on the baseline, which each crate that calls it compiles with its own settings.
- **`opt-level = 2` or `3`** for the crate with the kernels. With `"s"`, gathers and scatters without an instruction keep their loops: 6×.

## Reading the assembly

1. Run the tests with `RUSTFLAGS='--cfg bun_simd_check'` and `--release --tests`. They fail to link if vectors have lost the instructions of their target.
2. `tools/check-inlined.sh <binary>` lists what was not inlined, kernels that move many single lanes, and gathers made of plain loops (with `debug = "line-tables-only"`). It fails if it finds any, so it can run in CI.
3. `tools/asm.sh <binary> <regex>` prints functions, such as `<..::avx2_aes as ..::Enter>::apart1::<..::__KernelOfSum..>`. If a kernel is missing, as is usual for `neon`, it was inlined: give it `#[inline(never)]`.

The scripts are in the source of the crate, and need the component `llvm-tools`. On Linux for x86-64, calls into other crates have names only with `lto = "fat"`.

| In the inner loop | Cause |
| --- | --- |
| `call`, `bl` | A helper or a closure was not inlined |
| `xmm` on AVX2 | A narrow width, or an operation in halves |
| `pextrb`, `pinsrb`, `umov` | Lanes one by one: `v[i]`, `to_array`, a missing instruction |
| `rsp`, `sp` | Too many vectors or constants, or a rare call that isn't cold |
| A branch to a panic. `div` before the loop | A bounds check. `to[at..]` with `at += stride`: take `Rows` |

## What LLVM undoes

After `v.black_box()`, which is no instruction, LLVM can't join what is before with what is after. Put it where the assembly departs from the source, under `has!`, and time both: it stops good rewrites too, and put in blindly it gained nothing on x86.
`core::hint::black_box` is for other values, and goes through the stack.

| Seen | Where | Cure, or `black_box()` on what |
| --- | --- | --- |
| `vpinsrb` or `vpextrq` for bytes that a wider load has read: 7× | x86 | `split` the wider vector |
| The same in a loop over `[v; N]`, filled from a buffer that was written as `u128`: 60× | AVX2, AVX-512 | `array::from_fn` |
| A masked store, for `m.select(v + 1, v)` in place, that is read soon: 3.3× | AVX-512 | On what is stored |
| `memcpy` and a second pass, if a loop stores what it loads: 2× | All | On what is loaded |
| Arithmetic twice, or lane by lane, next to a shuffle | NEON most | On the operand of the shuffle |
| A chain of `simd_max` or `+` in another order, so that rounds wait longer | Integers | On the part that is new in this round |
| A constant mask made in each round. `vpermt2b` for two shuffles | AVX-512 | On the source of the mask. On the first result |
| Products for shifts, or shifts for a product. Intrinsics taken apart | x86, NEON | On each step, or the constant |
| Two jumps for a rare `if a & b`, where `a` is hard to predict: 7× | All | `hint::black_box(a & b)` |
| All checks of `table[i]` in `from_parts` or `from_fn`, and then all loads: 1.6×, with 64 bytes 3.8× | x86 | `from_parts` of four lanes each, and `hint::black_box(())` after each part or vector |
| `knot` and moves for `!m` or `m.select(0, v)` | AVX-512 | Compare the other way |

## Constant time

Rust promises nothing about time, and neither does this crate. Read the assembly of each target. What is known:

- `aes_*`, `sm4_*`, `galois_*` and `carryless_mul_*` have no branch or address that depends on a value, also without their instructions. This was checked for x86-64 and AArch64.
- LLVM joins a `select` or an `&` by a mask with a load or a store next to it, so that the mask decides which memory is touched. `v.black_box()` on the loaded value, the mask (after `to_simd`) and what is stored keeps them apart.
- `position`, `any`, `all` and `cmp` end early. To compare secrets, `fold` with `|` and `^`.
- `lookup` and `swizzle_dyn` can go through memory on `portable` and `sse2`, and `lookup` in more than 128 bytes everywhere. `first_n`, and shifts and rotations of elements by a variable, read a table on x86. Gathers, `compress`, `expand`, divisions, roots and `mul_add` without FMA depend on the values.
- Secrets leave copies: the compiler puts vectors on the stack, and the system saves registers at signals. So this crate has no function that clears them.

[guide]: guide.md
[neighbors]: guide.md#neighbors
[memory]: guide.md#memory
[loops]: loops.md
[ahead]: loops.md#one-step-ahead
[strips]: loops.md#strips
[tiles]: loops.md#tiles
[quirks]: quirks.md
