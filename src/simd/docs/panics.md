# What can panic

Arithmetic doesn't: integers wrap, counts of shifts and the indices of `lookup` count modulo their range, `swizzle_dyn` gives zero out of range, a lane of zero as a divisor gives the quotient
zero, gathers give a default and scatters skip what is out of bounds.

After a panic in the closure of a loop, the output has unspecified values, and an `Output` an unspecified length.

## Because of values

| What | When | Why no type says it |
| --- | --- | --- |
| `load`, `load_at`, `load_last`, `load_bytes`, `load_block`, `load_interleaved`, `load_3_of_4`, `load_low_bytes`, the stores of those names, `store_select`, `compress_store*`, `set_bit_positions`, `load_bitmask`, `store_bitmask`, `expand_into` | the slice is too short | lengths of slices are values. An array is checked by the build, but not where the position is an argument or the number of values varies. `from`, `to_array`, `load_or*`, `store_partial` and `over` don't panic |
| `store_partial_at`, `Sink::part`, `Part::skip`, `Part::write`, `select_nth`, `partial_sort` | the position is after the end, or for `select_nth` at it | as for slices |
| `map_into`, `scan_into`, `unzip_into`, `stream_into`, `map_until`, `filter_into`, `filter_map_into`, `bitmask_into` | the output is too short | the same |
| `mat_vec*` | the lengths don't match | the same |
| `Over::bitmask` | more than 64 values | the same |
| `v[i]`, `lane_dyn`, `with_lane_dyn`, `Mask::test`, `Mask::set` | no such lane | as for arrays |
| `swizzle`, `concat_swizzle`, `*_groups` | an index is out of range | they take closures and arrays, which can depend on the width. If the indices are constants that fit, the check leaves no code, and else `tools/check-inlined.sh` finds it, with `lto = "fat"` |
| `Output` | no room, `push_at` after the end, a stream that is not full or was swapped, 2^47 pushes to one `Room` | it keeps uninitialized memory from being read. `try_push`, `room_for` and `extend_from_back` return `None` |
| `push_with_slack` | no room for whole vectors, whatever part of them counts | depends on the target. `push` doesn't |
| `Output::append`, `resume` | there is no memory | as for `Vec::reserve` |
| `Rows`, `RowsMut`, `load_row`, `store_row` | a rectangle or a row sticks out, or rows that overlap are split | sizes of images are values |
| `v / 0`, `v % 0`, `div_euclid`, `rem_euclid`, `div_ceil` | the integer is zero | as for integers. A vector as a divisor doesn't panic, since tails are padded with zeros, and a `Divisor` is never zero |
| `ByteClasses::new`, `with` | too few bits, or bits that are taken | an error in a `const`. `ByteSet` takes any set |
| `aes_encrypt*`, `aes_decrypt*` | a slice has fewer than two keys | one function for all sizes of keys |
| `gather_interleaved`, `gather_bytes` | the table has fewer than `K` values, or less than a lane | lengths of slices are values |

## Because of types

What doesn't fit the types doesn't panic. It is an error of `cargo build`, which `cargo check` doesn't show. The build stops at the first one. It names the rule and the types, and mostly the operation and the target:

```compile_fail
# use bun_simd::prelude::*;
#[kernel]
fn upper(x: &[u8]) -> u8 { u8x16::load(x).block::<1>()[0] }
# fn main() { upper(&[0; 64]); }
```

```text
error: values of the type `[*const bun_simd::Simd<T, W, S>::block::the_vector_has_no_block_K<bun_simd::Simd<u8, B16, bun_simd::ops::Portable>>; usize::MAX]` are too big for the target architecture
```

It doesn't have the line. Two switches find it:

- `CARGO_PROFILE_DEV_OPT_LEVEL=0 RUSTFLAGS='--cfg bun_simd_misfits_where' cargo build` shows all rules that a crate breaks, each with a note that has one call. That can be one in bun_simd, as for arrays.
- With `--cfg bun_simd_misfits_panic`, and in Miri, these are panics on the targets that they don't fit, mostly with the line. Then `tools/check-inlined.sh <binary>`, with `lto = "fat"`, lists the kernels and targets that call `does_not_fit`. Tests with `bun_simd_native` can need this, as `has!(avx2)` doesn't tell the width there.

It is an error only where code is made, so a branch can avoid it, if its condition is a constant:

| Counts | Doesn't count |
| --- | --- |
| `if const { W::BYTES >= 32 }`, `if T::IS_FLOAT`, `has!`, `pick!`, `#[only]`, `#[except]` | `if W::BYTES >= 32` without `const`, and a variable |
| these with `!`, `&&` and `\|\|`, in `while`, in the guard of an arm, in `assert!`, and before `return` or `break` | a call: `if wide::<W>()`, `const { .. }.then(..)`. `debug_assert!` with `--release` |
| `match W::BYTES` or `match const { .. }` on single numbers | ranges, tuples and enums in a `match`, `if let`, `matches!`, and a loop that has no turns |

Some builds accept some of the second column.

- No guard covers what follows an `.await`, the `drop` of a variable from outside of the branch, and the other methods of a `dyn`.
- With full debug info, none covers a variable that holds a constant pointer to a function. With optimization too, `dispatch_static` and `baseline().run(..)` have one: put them in a function with `#[inline(never)]`.
- Only the targets that are built are checked. A build for x86-64 has one with registers of 16 bytes, and so finds most of what doesn't fit NEON, unless the whole program is for AVX2 or more. What is after `has!(neon)` needs a build for AArch64.
- `#[kernel(avx2)]` also has a copy for `portable`, which has to fit.
- The error of a kernel that is generic, or has one target only, comes in the crate that calls it.

That rustc makes no code for such branches is how it works, and no rule of the language. If that changed, it would refuse right programs, and accept no wrong ones. The switch for panics lets them through, but doesn't reach the errors of `#[only]` and `#[except]`.

The rules:

| What | When | Can `u8xN` and its like break it? |
| --- | --- | --- |
| `block`, `with_block`, `lane`, `with_lane`, `splat_lane`, `shift_elements_*::<K>` (not of `as_u128s`) | there is no such block or lane | depends on the target |
| `sub_array`, `sub_array_mut` | the part ends after the array | on all targets alike |
| `flat_array`, `flat_array_mut` | the number of values is another | on all targets alike |
| what takes a `Slice` or `SliceMut`, `set_bit_positions` | an array is too short. `&array[..]` leaves it to run time | mostly depends on the target |
| `bitcast_slice`, `bitcast_slice_mut` | the result needs more alignment. `try_bitcast_slice` tests the address. Bytes need `as_chunks` first | depends on the architecture, and for vectors on the target |
| `swizzle_groups`, `concat_swizzle_groups` | the group is longer than the vector | depends on the target |
| `transpose` | the rows are not as many as the lanes | depends on the target |
| `from_parts`, `for_each_part` | a part is wider than the vector | for parts of more than 16 bytes |
| `gather_*`, `scatter*`, `stream_into`, `map_until`, `filter_map_into` | the numbers of lanes differ | if one has a fixed width. `Scaled` makes them equal |
| `to_bitmask`, `Mask::iter`, `compress*`, `partition`, `padded`, `bitmask*`, `positions`, `*bit_planes`, `selected`, `zip_bits`, `expand_into`, a `u64` for a mask (not `from_bitmask`) | more than 64 lanes | never, but for `u8` in `Twice` the width, after `concat`, or a `bitcast` of what was cast |
| `LinearMap::of` | the vector has another width than the map, which has more than 16 bytes, or it has less than 16 | depends on the target, but for `LinearMap<B16, S>` |
| `cast` and its like, `lookup*`, `*_minifloat`, `zip_scaled`, `enumerate`, `concat`, `cast_mul*` | the result has more than 512 bytes, or less than 2 | never |
| `split`, `widen` of 2 bytes (and `widen_even`, `widen_odd` of them to floats), `from_halves`, `concat_halves`, `swap_pairs`, `dot*`, `sum_groups`, `widening_mul_*`, `complex_mul*`, `*_times_i`, `carryless_mul_odd`, `carryless_dot_add` | too few lanes, or a half of one byte | never |
| `Sha1::rounds4`, `Sm3::rounds4` | there are no such rounds | on all targets alike |
| `Lane::of` | the lane can't hold the number | on all targets alike |
| constructors, `bitcast` | a lane is wider than the vector | never |
| `is_in`, `count_in`, `concat_lookup_bytes`, `mat_mul_add`, `sliding_abs_diff_sum`, `*_3_of_4`, `swizzle` and `simd_eq` of `as_u128s`, `LinearMap`, AES, SHA, SM4 | less than 16 bytes | never |
| `*_3_of_4` | lanes of 64 bits | on all targets alike |
| `first_n` of a tuple or an array | more than 512 values, values of more than 8 bytes, or a slice in it | depends on the target |
| `gather_windows` | the windows are not as many as the lanes | depends on the target |
| `load_low_bytes`, `store_low_bytes`, `low_bytes` | the counts of all lanes need more than 64 bits | never |
| `transpose_in_blocks` | the rows are not whole squares, or there is none | on all targets alike |
| `transpose_blocks` | the same | never for a multiple of 4 rows |
| `widen*`, `*_narrow`, `cast_mul` | `T::Wide` of 64 bits, `T::Narrow` of 8 | on all targets alike. Generic code needs these to be types |

What fits no width is mostly an error also in a branch that is never taken: `block::<32>`, `repeat` of three bytes, `swizzle_groups` in groups of three, a table of more than 1024 bytes, low bytes of `u8`, more planes than bits, `Minifloat::ieee` with bits that make no format. A note of the error has the line, with optimization not always.
