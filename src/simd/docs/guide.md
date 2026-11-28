# A guide to bun_simd

This guide assumes Rust, and the idea of SIMD: one instruction for many values. The README has the setup.

[A first kernel](#a-first-kernel), [vectors](#vectors), [tails](#tails), [masks](#masks), [neighbors](#neighbors), [widths and lanes](#widths-and-lanes) and [helpers](#helpers) are enough to start.
Then come [memory](#memory), [targets](#dispatch-and-targets), [tests](#testing-on-each-target) and [pitfalls](#pitfalls).
[The index][index] finds an operation, and [the page on speed][speed] makes a kernel fast: read its first list before you write a loop. Its tables are for looking up.

Other pages: [three larger loops][loops], [programs larger than a module][programs], [targets][targets], [panics][panics], [quirks of CPUs][quirks], [the names of Highway][highway].

## A first kernel

A *target* is a set of instructions, such as AVX2. A *kernel* is a function that is compiled for several targets: a call runs the best version that the CPU has.
`#[bun_simd::simd]` marks what kernels use, here a module, and can name the targets. Each file has [a module of its own][marks].

```rust
#![forbid(unsafe_code)]

#[bun_simd::simd]
mod simd {
    use bun_simd::prelude::*;

    #[kernel]
    pub fn count(text: &[u8], byte: u8) -> usize {
        over(text).count(|v| v.simd_eq(byte))
    }

    /// With a loop of its own.
    #[kernel]
    pub fn largest(values: &[u32]) -> u32 {
        let (vectors, rest) = over(values).exact();
        let mut max = u32xN::load_or_default(rest);
        for v in vectors {
            max = max.simd_max(v);
        }
        max.reduce_max()
    }
}

fn main() {
    assert_eq!(simd::count(&b"a,b,c,".repeat(20), b','), 60);
    assert_eq!(simd::largest(&[1, 9, 4]), 9);
}
```

In marked code the target is a type parameter, `S`, the last one. **Types say `S`, expressions don't**: `fn f(v: u8xN<S>)` and `f::<3, S>(v)`, but `u8xN::load(text)` and `f(v)`, where the compiler infers it. All functions and methods have it, and so have types and constants that depend on it: `type V<W> = Simd<u8, W, S>` is used as `V<W, S>`, and `const N` as `S::N`.
The examples below hide the module or the kernel around them, by a `#` before the line in the source of this page.

There are two types:

| | | |
| --- | --- | --- |
| `v` | `Simd<T, W, S>` | The values: lanes of `T`. The `Width` is a type, such as `B16` for 16 bytes. |
| `m` | `MaskOf<T, W, S>` | One boolean for each lane, from a comparison. Messages call it `Mask<T::Signed, W, S>`. |

Both are `Copy`. `SimdN<u8, S>` is short for `Simd<u8, Native<S>, S>`, which fills a register, and `u8xN<S>` is shorter. `u8xN::LANES`
is 16, 32 or 64, a constant for each target. `u8x16`, `f32x8` and so on are
the same on all targets. Masks have `MaskN<T, S>`, `mask8xN`, `mask32x8` and so on. Make them by `mask8xN::first_n(n)`, or `Mask::first_n(n)` for any lane.

To find an operation, guess the name from `std::simd`, the scalar methods, slices or `Iterator`, or see [the index][index].
What makes a vector is a function of its type, and the rest is a method of the first operand. A plain name acts on the
whole vector, and has one result on all CPUs, with [few exceptions](#pitfalls) for floats. What depends on the CPU ends in `_relaxed`.

## Vectors

The operators work on each lane. Integers wrap. A number of the type of the lanes can take the place of a vector that
has it in each lane, and so can an array. The count of a shift is any integer. `iota(n)` is `n`, `n + 1` and so on, `v[0]` is the first lane, `==` compares
all lanes, and `sum_groups::<u64>` adds each 8 bytes to a `u64`.

```
# use bun_simd::prelude::*; #[kernel] fn example() {
let v = u8x8::from([1, 2, 3, 4, 5, 6, 7, 250]);
assert_eq!(v + 10, [11, 12, 13, 14, 15, 16, 17, 4]);
assert_eq!(v.saturating_add(10), [11, 12, 13, 14, 15, 16, 17, 255]);
assert_eq!(v << 1 & 15, [2, 4, 6, 8, 10, 12, 14, 4]);
assert_eq!(v.simd_min(u8x8::iota(0)), [0, 1, 2, 3, 4, 5, 6, 7]);
assert_eq!(v.reverse()[0], v.reduce_max());
// The sum wraps too. Widen first.
assert_eq!(v.reduce_sum(), 22);
assert_eq!(v.sum_groups::<u64>().reduce_sum(), 278);
# } example()
```

`load` reads the first lanes of a slice and `store` writes them. Neither needs alignment. Both panic if the slice is too
short. An array that is too short is an error.

```
# use bun_simd::prelude::*; #[kernel] fn example() {
let mut out = [0.0; 6];
f32x4::load(&[1.0, 4.0, 9.0, 16.0, 25.0]).sqrt().store(&mut out[1..]);
assert_eq!(out, [0.0, 1.0, 2.0, 3.0, 4.0, 0.0]);
# } example()
```

A *block* is 16 bytes. Many shuffles of x86 work within each block, and crossing blocks takes longer. `v.in_blocks()` is
a view with the same names, which treats each block as a vector of its own. Take it where the order is undone later, or
doesn't matter.

```
# use bun_simd::prelude::*; #[kernel] fn example() {
let (a, b) = (u32x8::iota(0), u32x8::iota(10));
let [lower, upper] = a.interleave(b);
assert_eq!(lower, [0, 10, 1, 11, 2, 12, 3, 13]);
assert_eq!(upper, [4, 14, 5, 15, 6, 16, 7, 17]);
assert_eq!(a.in_blocks().interleave(b)[0], [0, 10, 1, 11, 4, 14, 5, 15]);
# } example()
```

`indices.lookup(&table)` looks up each lane in an array, as in `(v >> 4).lookup(b"0123456789abcdef")`. For 16 bytes it is one instruction, and one more to cut the index unless the compiler sees that it fits.
Give a table of numbers its type: `lookup(&[1u8, 2, 4, 8])`. The values can have another size than the indices, as in a palette or a codebook.
`lookup_or(&table, or)` gives `or` outside of the table, which checks and translates in one step.

## Tails

The length of a slice is rarely a multiple of the lanes. `over(slice).exact()` gives the whole vectors and what is left, the
*tail*. A scalar loop is the slowest, most of all with wide registers.

**Let a loop of the crate do it.** `over(slice)` sees a slice a register at a time, and `u8x64::over(slice)` at another
width. It has `position`, `any`, `all`, `count`, `map_into`, `filter_into`, `fold`, `sum`, `sum_wide`, `zip` and others, and `over_mut` has `map`,
`retain` and `sort`. They take slices of any length. `fold` has several sums, and takes a second closure that joins them. The result
counts each value once. But a closure can see a value more than once, in any lane and next to padding, so it has to
treat all lanes alike. `scan_into` and `scan` go in order and see each value once, so their closures can have state.

```
# #[forbid(unsafe_code)] #[bun_simd::simd] mod simd { use bun_simd::prelude::*;
#[kernel]
pub fn to_upper(text: &mut [u8]) {
    over_mut(text).map(|v| v.within(b'a'..=b'z').select(v - 32, v));
}
# } use {bun_simd::prelude::*, simd::*}; fn main() {
let mut text = *b"Hello, world!";
to_upper(&mut text);
assert_eq!(&text, b"HELLO, WORLD!");
# }
```

**Several slices, records and windows** have loops too. Their closures get an array or a pair, the bounds are checked once, and the tail is taken care of.

| | Each step gets |
| --- | --- |
| `over(a).zip(b)` | `(a, b)`, up to the end of the shorter slice |
| `over(a).zip(b).zip(c)` | `((a, b), c)`. `zip_scaled` takes values of another size |
| `f32xN::over_all([x, y, z])` | `[x, y, z]` |
| `over(rgb).interleaved()` | `[r, g, b]`, for records of 1 to 16 values |
| `over(x).windows()` | `[a, b, c]`: the values at each index, and at the next two |
| `over(x).enumerate()` | `(i, x)`, where `i` is a vector of indices |
| `over(x).zip_bits(bits)` | `(x, m)`, where `m` is a mask from a bitmap of `u64` |

An array that the closure of `map_into` returns is written interleaved. `unzip_into((p, q), |v| (a, b))` has several outputs.
In place, `over_mut(y).zip(x).map(|(y, x)| ..)` changes one slice. For more, or for records, `as_cells(x)` makes a slice that these loops can read and write. `v.store_at(&mut &cells[..], at)` writes one vector to it.
`filter_map_into` keeps some indices, of one slice or several. Where a loop pads with zeros, `pad(value)` before it chooses another value.

```
# #[forbid(unsafe_code)] #[bun_simd::simd] mod simd { use bun_simd::prelude::*;
#[kernel]
pub fn lengths(points: &[[f32; 3]], to: &mut [f32]) {
    over(points.as_flattened()).interleaved().map_into(to, |[x, y, z]| (x * x + y * y + z * z).sqrt());
}

#[kernel]
pub fn in_range(low: &[i32], x: &[i32], high: &[i32], bitmap: &mut [u64]) {
    i32xN::over_all([low, x, high]).bitmask_into(bitmap, |[low, x, high]| x.simd_ge(low) & x.simd_le(high));
}
# } use {bun_simd::prelude::*, simd::*}; fn main() {
let mut to = [0.0; 21];
lengths(&[[2.0, 3.0, 6.0]; 21], &mut to);
assert_eq!(to, [7.0; 21]);
let mut bitmap = [0];
in_range(&[0, 0, 0], &[1, 5, 2], &[2, 2, 2], &mut bitmap);
assert_eq!(bitmap, [0b101]);
# }
```

A bitmap such as this can choose values later: `selected` skips what has no bit, and `expand_into` puts values back in their places.

**Pad it.** `load_or_default` reads what there is and fills up with zeros, `load_or` with another value. `store_partial`
writes what fits. Choose a value that doesn't change the result, such as `u32::MAX` for a minimum. In a loop that rarely sees the end of its input, as in a parser,
`load_padded` keeps the code for the end out of the way.

```
# #[forbid(unsafe_code)] #[bun_simd::simd] mod simd { use bun_simd::prelude::*;
#[kernel]
pub fn axpy(a: f32, x: &[f32], y: &mut [f32]) {
    let (vectors, x_rest) = over(&x[..y.len()]).exact();
    let mut y = y.chunks_exact_mut(f32xN::LANES);
    for (x, y) in vectors.zip(&mut y) {
        x.mul_add_relaxed(a, f32xN::load(y)).store(y);
    }
    let y_rest = y.into_remainder();
    f32xN::load_or_default(x_rest).mul_add_relaxed(a, f32xN::load_or_default(y_rest)).store_partial(y_rest);
}
# } use {bun_simd::prelude::*, simd::*}; fn main() {
let mut y = [1.0; 35];
axpy(2.0, &[3.0; 35], &mut y);
assert_eq!(y, [7.0; 35]);
# }
```

**Mask it.** `mask8xN::first_n(n)` is true in the first `n` lanes, or in all if there are fewer. `padded` pads and masks in one loop: it
gives each vector, the last one filled up with zeros, and a `u64` with a bit for each lane that is in the slice: `for (v, valid) in over(bytes).padded()`, and `m.to_bitmask() & valid`.

**Overlap.** `load_last` reads the last whole vector, of which some lanes were seen before. That needs no padding, and works if the slice has at least one vector, and if
seeing a value twice does no harm, as in `all |= v`, or is undone, by `m & !mask8xN::first_n(seen)` or `m.to_bitmask() >> seen`.

Keep partial loads and stores out of the inner loop. [The page on speed][speed] says which way wins where.

## Masks

A comparison gives a mask. Masks combine with `&`, `|`, `^` and `!`. A mask selects lanes, or answers a question.

```
# use bun_simd::prelude::*; #[kernel] fn example() {
let v = i32x4::from([5, -3, 0, 8]);
let m = v.simd_gt(0);
assert_eq!(m.select(v, -1), [5, -1, -1, 8]);
assert_eq!(m.to_simd::<i32>(), [-1, 0, 0, -1]);
assert_eq!((m.count(), m.any(), m.all()), (2, true, false));
assert_eq!((!m).first_set(), Some(1));
assert_eq!(m.iter().collect::<Vec<_>>(), [0, 3]);
assert_eq!(m.to_bitmask(), 0b1001);
assert_eq!((m & mask32x4::first_n(2)).to_bitmask(), 0b0001);
# } example()
```

For bytes, `to_bitmask` is one instruction on x86-64, and five on NEON, where `any`, `first_set`, `count_before_first`, `iter` and the like take two for 16 bytes,
so prefer them. `to_bitmask` is worth it for 64 bytes at once, to do arithmetic on the bits. All of these leave the vector registers. A long loop is faster
if it stays there: `over(x).count(..)` and `counts` subtract masks from vectors of sums, and `any` joins several vectors before it asks.

`compress_store` moves the lanes where the mask is true to the front, and returns their number. It writes a whole
vector, so the output needs that much room. It also takes the bits of a mask. `filter_into` is this loop. For the indices of the lanes, `set_bit_positions` takes 64 bits at once.

```
# #[forbid(unsafe_code)] #[bun_simd::simd] mod simd { use bun_simd::prelude::*;
#[kernel]
pub fn without_spaces(text: &[u8]) -> Vec<u8> {
    let (mut out, mut len) = (vec![0; text.len() + u8xN::LANES], 0);
    for (v, _) in over(text).pad(b' ').padded() {
        len += v.compress_store(&mut out[len..][..u8xN::LANES], v.simd_ne(b' '));
    }
    out.truncate(len);
    out
}
# } use {bun_simd::prelude::*, simd::*}; fn main() {
assert_eq!(without_spaces(&b"a b  c ".repeat(30)), b"abc".repeat(30));
# }
```

A `ByteSet` tests for many bytes at once. `const SET: ByteSet = ByteSet::new(&[0..=0x1f, b'"'..=b'"'])` makes one from ranges, for `SET.contains(v)`, which takes at most two lookups for any set of
ASCII. `ByteSet::of` takes a list of bytes, also at run time. `ByteClasses` sorts bytes into up to eight classes, which `with` makes from sets.

A mask depends only on the size of the lanes: one that compares `u32` selects `f32` too. `cast` changes the size, and keeps
the number of lanes. It can name the lanes: `cast::<f32>()`. As a mask doesn't know the type of its lanes, `to_simd::<u8>()` has to name it if a method follows.

```
# use bun_simd::prelude::*; #[kernel] fn example() {
let v = f32x4::from([1.5, 2.5, 3.5, 4.5]);
assert_eq!(u32x4::iota(0).simd_lt(2).select(v, 0.0), [1.5, 2.5, 0.0, 0.0]);
let keep = u8x4::from([1, 0, 0, 1]).simd_ne(0);
assert_eq!(keep.cast().select(v, 0.0), [1.5, 0.0, 0.0, 4.5]);
# } example()
```

## Neighbors

Many kernels need the value before or after each lane. **For values in memory, load again**: `windows` does, as in `over(x).windows().map_into(to, |[x, next]| next - x)`. With registers of 64 bytes these loads cross cache lines, and [`Upto<B32, S>`](#widths-and-lanes) can be faster on Zen 4 and Ice Lake.

```
# #[forbid(unsafe_code)] #[bun_simd::simd] mod simd { use bun_simd::prelude::*;
#[kernel]
pub fn end_of_head(text: &[u8]) -> Option<usize> {
    over(text).windows().position(|[a, b, c, d]| a.simd_eq(b'\r') & b.simd_eq(b'\n') & c.simd_eq(b'\r') & d.simd_eq(b'\n'))
}
# } use {bun_simd::prelude::*, simd::*}; fn main() {
assert_eq!(end_of_head(b"a: b\r\n\r\nc"), Some(4));
# }
```

**For a property of each value, shift the mask**, and keep it for the next round. Look back, not ahead: what is ahead isn't loaded yet.
[`Output`](#memory) appends to the `Vec`.

```
# #[forbid(unsafe_code)] #[bun_simd::simd] mod simd { use bun_simd::prelude::*;
#[kernel]
pub fn starts_of_words(text: &[u8], at: &mut Vec<u32>) {
    let out = &mut Output::append(at, text.len() + 64);
    let mut previous = mask8x64::splat(false);
    for (i, (v, _)) in u8x64::over(text).padded().enumerate() {
        let letters = v.is_ascii_alphanumeric();
        let starts = letters & !letters.shift_elements_right::<1>(previous);
        set_bit_positions(starts.to_bitmask(), 64 * i as u32, out);
        previous = letters;
    }
}
# } use {bun_simd::prelude::*, simd::*}; fn main() {
let mut at = Vec::new();
starts_of_words(b"one two, three", &mut at);
assert_eq!(at, [0, 4, 9]);
# }
```

**For values that were computed, shift the lanes**: `v.shift_elements_right::<1>(previous)` takes the last lane of the vector before. It takes up to two instructions
for more than 16 bytes on x86. `prefix_sum` and `scan` run over the lanes, and `splat_last` carries the result on. `prefix_xor` tells from the bits of the quotes what is between them.

```
# #[forbid(unsafe_code)] #[bun_simd::simd] mod simd { use bun_simd::prelude::*;
#[kernel]
pub fn running_max(x: &[u32], to: &mut [u32]) {
    let mut carry = u32xN::zero();
    over(x).scan_into(to, |v| {
        let (max, before) = (v.scan(0, |a, b| a.simd_max(b)), carry);
        carry = carry.simd_max(max.splat_last()); // Only this step waits for the round before.
        max.simd_max(before)
    });
}
# } use {bun_simd::prelude::*, simd::*}; fn main() {
let mut to = [0; 5];
running_max(&[1, 3, 2, 5, 4], &mut to);
assert_eq!(to, [1, 3, 3, 5, 5]);
# }
```

**For neighbors in the rows above and below**, walk down [a strip of columns][strips].

## Widths and lanes

A lane is `u8` to `u64`, `i8` to `i64`, `f16`, `bf16`, `f32` or `f64`. A width is a number of bytes, as a type: `B2`, `B4`, `B8`,
`B16` and so on, up to `B512`. Registers have up to 64 bytes.

| | |
| --- | --- |
| `SimdN<T, S>`, `u8xN<S>` | A register: `Native`. The usual choice. |
| `Simd<T, Upto<B32, S>, S>` | A register, but no more than 32 bytes. For short inputs, and for loads at neighboring places. |
| `Simd<T, Twice<Native<S>>, S>`, and with `Half` | Two registers, or half of one. `Twice<Twice<..>>` is four sums in one name, and `f16` in half of a register has the lanes of `f32xN`. |
| `Simd<T, B16, S>`, `u8x16<S>` | The same on all targets. For formats with a fixed size, such as a row of a block of pixels. |

Every width that holds a lane works on every target. One that is wider than a register takes several:
`u8x64` takes four on SSE4 and NEON, like a loop that is unrolled four times.
An array of vectors stays in registers only if the loops over it are unrolled: `unroll!(for i in 0..8 { .. })` always is,
and its `i` is a constant. `array::from_fn(..)` and `array::map(..)` of this crate make such arrays, and are always inlined, unlike those of `core`.

A conversion keeps the bits, the number of lanes or the width:

| | Width | Lanes |
| --- | --- | --- |
| `v.bitcast::<U>()`, `cast_signed`, `cast_unsigned` | the same | as many `U` as fit, with the same bits |
| `v.cast::<U>()`, `saturating_cast`, `round_cast` | as wide as it takes | the same number |
| `let [lo, hi] = v.widen::<U>()`, `lo.saturating_narrow(hi)`, `lo.wrapping_narrow(hi)` | the same | one vector to two, and back |
| `let [lo, hi] = v.split()`, `lo.concat(hi)`, `v.resize::<W>()` | half, twice, any | the same type |

`bitcast`, `load_bytes` and `store_bytes` are little-endian, also on CPUs that are not. There, `swap_bytes` next to them takes no time.

`cast` is `as` for each lane. `from` takes a vector too, if nothing can be lost.

```
# use bun_simd::prelude::*; #[kernel] fn example() {
let v = i32x4::from([-1, 7, 255, 300]);
assert_eq!(v.saturating_cast::<u8>(), [0, 7, 255, 255]);
assert_eq!(v.cast::<u8>(), [255, 7, 255, 44]);
assert_eq!(v.cast::<f32>(), [-1.0, 7.0, 255.0, 300.0]);
assert_eq!(i64x4::from(v), [-1, 7, 255, 300]);
assert_eq!(v.cast_unsigned()[0], u32::MAX);
# } example()
```

`cast::<f32>()` of a `u8xN`, as in `over(bytes).map_into(floats, |v| v.cast::<f32>() / 255.0)`, takes four registers, which is as fast or faster for long slices. For a few values, or if many
vectors are alive, let the widest lane fill one register, as in `Simd::<u8, Half<Half<Native<S>>>, S>::over(from)`. `Scaled<T, U, W>` is the width of as many `U` as `W` has `T`.

Or keep the width, and go from one vector to two and back: `let [a, b] = v.widen::<i16>()`, and `(a * k >> 3).saturating_narrow(b * k >> 3)`.

A kernel can be generic over the lane. The traits are `Lane`, `Int`, `Unsigned`, `Signed`, `Float` and `HasSign`.
`T::ZERO`, `T::ONE`, `T::of::<2>()` and `T::from_f64(0.5)` are numbers, and `T::BITS`, `T::IS_FLOAT` and `T::IS_SIGNED` tell the type: `fn increment<T: Lane>(x: &mut [T]) { over_mut(x).map(|v| v + T::ONE) }`.

It can branch on the width, as in `if const { Native::<S>::BYTES == 64 }`. The other branch leaves no code, and can have operations that don't fit the width,
which are errors of `cargo build` elsewhere. Without `const`, it is compiled first, which can take long, and has to fit. What fits no width, such as
`widen` to a narrower lane, is an error, also in such a branch.

`f16` and `bf16` are types of the crate, with `from_f32` and `to_f32`. Their vectors have all that those of `f32` have, by the same rules. Only targets with `fp16` compute in `f16`, and
only those with `bf16` have its dot product and its rounding as instructions, so a kernel that gains from these names the words, as in `#[simd(icelake + bf16, avx2, neon86, neon)]`.
Elsewhere each step converts to `f32` and back, which a longer computation does once, with `widen` and `narrow`.

Formats of 8 bits and less, such as E4M3, are bytes, for `to_minifloat` and `from_minifloat`.

## Helpers

Functions and methods of a marked module have the instructions of the target, and are inlined unless they say otherwise. So do their closures.
A type, trait, `impl` or constant has the parameter `S` if it names it. Where parameters are written, it is written too: `impl<W: Width> Sums<W, S>`, `is_digit::<B16, S>(v)`.

```
# #[forbid(unsafe_code)] #[bun_simd::simd] mod simd { use bun_simd::prelude::*;
fn is_digit<W: Width>(v: Simd<u8, W, S>) -> MaskOf<u8, W, S> {
    v.within(b'0'..=b'9')
}

/// State that lives in registers.
struct Sums {
    digits: u64xN<S>,
}

impl Sums<S> {
    fn new() -> Self {
        Self { digits: Simd::zero() }
    }
    fn add(&mut self, v: u8xN<S>) {
        self.digits += is_digit(v).select(v - b'0', 0).sum_groups::<u64>();
    }
}

#[kernel]
pub fn sum_of_digits(text: &[u8]) -> u64 {
    let mut sums = Sums::new();
    for (v, _) in over(text).padded() {
        sums.add(v);
    }
    sums.digits.reduce_sum()
}
# } use simd::*; fn main() {
assert_eq!(sum_of_digits(&b"a1b22c333".repeat(10)), 140);
# }
```

`#[shared]` leaves a function or `impl` as it is written, as for a large one without vectors or one that other code calls.
For a parameter `W`, the compiler doesn't know that twice the half is `W`: add `resize::<W>()`, which costs nothing between equal widths, or join by `from_halves([lower, upper])`.

**Constants and lengths.** A constant that depends on the target names `S` or has `#[simd]`, and is used as `S::NAME`. Lengths of arrays and constant arguments can say `S`.

```
# #[forbid(unsafe_code)] #[bun_simd::simd] mod simd { use bun_simd::prelude::*;
#[simd]
const N: usize = u8xN::LANES;

fn sum<const K: usize>(v: [u8xN<S>; K]) -> u64 {
    v.iter().map(|v| v.sum_groups::<u64>().reduce_sum()).sum()
}

fn pair(bytes: &[u8; 2 * S::N]) -> u64 {
    sum::<2, S>([u8xN::load(bytes), u8xN::load(&bytes[S::N..])])
}

#[kernel]
pub fn sum_of_bytes(bytes: &[u8]) -> u64 {
    let (pairs, rest) = bytes.as_chunks::<{ 2 * S::N }>();
    let mut last = [0; 2 * S::N];
    last[..rest.len()].copy_from_slice(rest);
    pairs.iter().map(|it| pair(it)).sum::<u64>() + pair(&last)
}

#[kernel]
#[simd(by_level)] // No length says S here, but that of the array has to be known.
pub fn sum_of_first(bytes: &[u8]) -> Option<u64> {
    Some(pair(bytes.first_chunk()?))
}
# } use simd::*; fn main() {
assert_eq!(sum_of_bytes(&[2; 300]), 600);
# assert_eq!(sum_of_first(&[0; 128]), Some(0));
# }
```

- A function with such a length is checked once for each level. So is one with `#[simd(by_level)]`, or the methods of an `impl` with it. Elsewhere, such an array, also in a field, can only be passed on: messages show its type as `NeedsSimdByLevel`.
- The length can depend on the width and on `icelake`, `avx512`, `avx2`, `sse4` and `neon`. Other words are an error of `cargo build` (in a field, where a function writes the length): take a constant parameter, as in `if has!(vaes) { f::<4, S>(x) } else { f::<8, S>(x) }`.
- It can't name a parameter for lanes or widths: take `to_array`. It doesn't work in a `const fn`, in a method of a trait, or in a macro that is defined outside of the function. Take a constant parameter or a slice there.

## Memory

All access goes through slices, and is checked. In a loop over `exact` the checks are optimized away. With an index,
`load_at` and `store_at` leave one check each, where `load(&slice[at..])` has two. For several slices or offsets, `over_all`, `zip` and `windows` have `exact` and `padded` too. Their items are arrays or pairs, and what `exact` leaves goes on with `rest.padded()`.
`as_chunks::<{ 3 * f32xN::<S>::LANES }>()`, `first_chunk` and `chunk_at::<N>(at)` give arrays, in which loads at constant places need no checks. The compiler checks the place of `sub_array::<AT, N>()`, and not that of `&array[AT..]`. `flat_array::<N>()` keeps the length that `as_flattened` loses.

**Interleaved values**, such as pixels: `over(from).interleaved().map_into(to, |[r, g, b]| [b, g, r, u8xN::splat(255)])`. In a loop of one's own, `load_interleaved` and `store_interleaved` take whole vectors, and
`load_interleaved_or_default` and `store_interleaved_partial` the tail.

**Rows with a stride**, such as images. `Rows` checks a rectangle once. At a border, let the shift or the padding bring in the value: `v.shift_elements_right::<1>(v.splat_lane::<0>())`,
`load_or(row, last)`. A tail for each row adds up, so overlap, or see [strips][strips].

```
# #[forbid(unsafe_code)] #[bun_simd::simd] mod simd { use bun_simd::prelude::*;
#[kernel]
pub fn transpose_tile(from: Rows<'_, u8>, mut to: RowsMut<'_, u8>, x: usize, y: usize) {
    let (from, mut to) = (from.at(x, y, 16, 16), to.at(y, x, 16, 16));
    let columns = u8x16::transpose::<16>(array::from_fn(|i| u8x16::load(from.row(i))));
    unroll!(for i in 0..16 {
        columns[i].store(to.row(i));
    });
}
# } use {bun_simd::prelude::*, simd::*}; fn main() {
let (image, mut out): (Vec<u8>, _) = ((0..=255).cycle().take(32 * 16).collect(), [0; 16 * 32]);
transpose_tile(Rows::new(&image, 32, 32, 16), RowsMut::new(&mut out, 16, 16, 32), 16, 0);
assert_eq!(out[16 * 17 + 2], image[32 * 2 + 17]);
# }
```

**Threads.** `chunks_mut` splits an output into bands. For columns and tiles, `RowsMut` has `split_at_column` and `split_at_row`, whose parts can go to other threads.
`rows_mut` gives several rows at the same time.

**Output that is larger than the caches**, or that another core or a device reads. On x86-64, a store first fetches the line that it changes. `stream_into` is a `map_into` that doesn't, and
`streaming` is for all other loops, and for many short copies: it waits at its end and in each `lend`, so lend all first.

**Appending to a `Vec`.** An `Output` has a fixed room. It writes to the spare capacity, which needs no zeros
first, and counts what is initialized. The `Vec` gets that when the result of `append` is dropped. It also takes a `String`. `Output::new` starts in a slice of `MaybeUninit`, and `Output::overwrite` in a plain one, which can change after the length, too.
Loops take it as their output: `over(text).filter_into(&mut Output::append(to, text.len()), |v| ..)`. To use the `Vec` in the same function, write `let mut out = Output::append(..)`, and `drop(out)`.

ASCII goes to a `String` by `push(v.ascii())` and the loops, which clear the highest bit of each byte. A literal is `const { Ascii::from_bytes(b"0x").unwrap() }`. `over(bytes).to_str()` and `string_from_utf8` check other text, and `over(bytes).utf8()` does so in the loop that reads it.

`out.push(piece)` adds a lane, a vector, a slice, or a part: `v.first_n(n)`, `v.selected(mask)`, or `v.low_bytes(more)` for the lowest byte of each lane and `more` after it, by a vector of counts or a mask. The last two can follow `first_n`. An array or a tuple of up to six of these takes one check for all, unless it has a slice. `push_one` takes other types, such as `usize`. For a `String` only `first_n` has `ascii`: write the others to scratch memory, and `map_into` from there.
Like `filter_into`, `push` needs room only for what it adds, and panics without. `try_push` returns `None` then, and the length stays. `set_bit_positions` adds the position of each bit that is set, and needs room for 64.
Parts are written as whole vectors where these fit, so room for a vector more pays: without it, outputs below 64 bytes took 1.1 to 1.5 times as long, and short parts of `streams` up to twice.

```
# #[forbid(unsafe_code)] #[bun_simd::simd] mod simd { use bun_simd::prelude::*;
#[kernel]
pub fn quoted_without_spaces(text: &[u8], out: &mut Output<'_, u8>) -> Option<()> {
    let (vectors, rest) = over(text).exact();
    out.try_push(b'"')?;
    for v in vectors {
        out.try_push(v.selected(v.simd_ne(b' ')))?;
    }
    let v = u8xN::load_or(rest, b' ');
    out.try_push((v.selected(v.simd_ne(b' ')), b'"'))
}
# } use {bun_simd::prelude::*, simd::*}; fn main() {
let mut room = [0; 5];
assert_eq!(quoted_without_spaces(b"a b c", &mut Output::overwrite(&mut room)), Some(()));
assert_eq!(&room, b"\"abc\"");
assert_eq!(quoted_without_spaces(b"abcd", &mut Output::overwrite(&mut room)), None);
# }
```

`out.streams` splits the next values into parts that are filled in any order, or by threads, such as a band of rows of a transpose. For any other order, `vec![0; n]` gets its zeros from the system if it is large and new.
A decoder of LZ77 copies matches with `extend_from_back`, which returns `None` for a wrong one. If they can reach into the `Vec`, it takes `Output::resume(to, history, room)`, in which the last `history` values count as written.

| | Needs room for | Else | For |
| --- | --- | --- | --- |
| `push`, `try_push` | what is added | a panic, `None` | most code |
| `room_for(n)` | `n` | `None` | long loops: one check for the pushes and matches of a round |
| `push_with_slack` | whole vectors | a panic | tuned loops and small code. It can be slower |
| `limit(n)` | `n` | a panic | a shorter `Output` that counts from zero, which can make a loop faster |

`let Some(mut out) = out.room_for(N) else { break }` spares all checks if the constant counts each part as a whole vector, and 32 bytes on top of each match. A second loop without it does the rest. A helper takes `&mut Room`: as `&mut Output` it has its checks again.

**Scratch memory.** An `Output` on the stack costs nothing. From AVX2 on, `Aligned` saved up to 30%. `filled` and `into_filled` give what was written as a plain slice, to be read or changed in any order.

```
# #[forbid(unsafe_code)] #[bun_simd::simd] mod simd { use bun_simd::prelude::*;
use core::mem::MaybeUninit;

#[kernel]
pub fn sum_of_squares(x: &[u32], at: &[u16]) -> u32 {
    let mut room = Aligned([MaybeUninit::uninit(); 1024]);
    let mut squares = Output::new(&mut room.0);
    over(x).map_into(&mut squares, |v| v * v);
    let squares = squares.into_filled();
    at.iter().map(|&i| squares[i as usize]).sum()
}
# } use simd::*; fn main() {
assert_eq!(sum_of_squares(&[1, 2, 3], &[2, 2, 0]), 19);
# }
```

To load whole vectors up to the end, push one of zeros last. To write in any order, zero only what is used, by `while out.len() < n { out.push(u32xN::zero()) }`, or
take a `&mut` buffer that the caller keeps: in a loop that only scatters, the zeros took 1.0 to 1.4 times as long as that.

**Memory that is not a plain slice.** Stores also take `MaybeUninit`, and both ways `[u8; N]`, cells and atomics: see [larger programs][programs].

**Other lanes than those of the slice.** `load_bytes` and `store_bytes` take bytes, and `u32xN::over(bytes.as_chunks::<4>().0)` is the loop. `as_chunks_mut` is for its output.

**Structs and other types.** `bitcast_slice` and `bitcast_slice_mut` show a slice as one of lanes, without a copy, and `try_bitcast_slice` if these need more alignment. They take numbers, arrays, vectors of 16 bytes or more, `Aligned<[u8; 64]>`, and structs with `#[derive(Plain)]` and `#[repr(C)]`.
`bool`, `char` and enums with `#[derive(AsBytes)]` can be read only. Types of other crates, such as `half::bf16`, need a cast of that crate to integers first. A `Vec` of vectors of up to 64 lanes is an aligned buffer, on targets with vectors.

**Caches.** CPUs fetch ahead by themselves what is read in order. For other orders, `prefetch` asks for a line, and `prefetch_with` chooses the cache, or asks for a line to write to (`Prefetch::Write`).

**Indices.** `gather_or_default` gives zero for an index that is out of bounds, and `scatter` skips it. `gather_interleaved` reads neighbors or records, as for
interpolation or the corners of a mesh, and `gather_bytes` lanes at offsets in bytes. `gather_windows` gives references to larger records. These clamp the index, which is faster. The documentation of `gather_or_default` says where these are instructions.

## Dispatch and targets

The first call of a kernel detects the CPU. From then on a call loads an index and jumps through a table, and isn't inlined.
Put the loop in the kernel. If there is nothing to choose from, as with the default on
AArch64, it is a plain call. **It dispatches in marked code too: there `f::here(..)` stays on the target.** Within a module there is a warning, unless it says `self::f(..)`. `f::baseline(..)` runs on
the best target that the whole program is compiled for, and can be inlined. A kernel can return pointers to functions of its target, and closures: see [larger programs][programs].

A target is a *level*, such as `avx2`, plus features, such as `avx2 + vaes`. Each one compiles the kernel once more, so the
default has few: `icelake`, `avx2 + aes` and `sse4`, or `neon`, or `wasm + relaxed` and `wasm`. The first in the list that the CPU has wins, so the best comes first:
Skylake-X runs `avx2 + aes`. A CPU that has none of them runs `portable`, which has 16 bytes and uses what the whole program is compiled for. A module can name
its own list, or the path of another module, and so can `#[kernel(..)]`. Targets of other architectures are ignored. `#[simd(sve2, default)]` adds to the default.
A word such as `fast_gather` is for what only some CPUs with the feature do fast. [The page on targets][targets] has all words.

```
# #![forbid(unsafe_code)]
#[bun_simd::simd(sse4, neon + crc)]
mod crc {
    use bun_simd::prelude::*;

    #[kernel]
    pub fn checksum(bytes: &[u8]) -> u32 {
        let (words, rest) = bytes.as_chunks();
        let crc = words.iter().fold(!0, |crc, &word| crc32c(crc, u64::from_le_bytes(word)));
        !rest.iter().fold(crc, |crc, &byte| crc32c(crc, byte))
    }
}
# fn main() {
assert_eq!(crc::checksum(b"123456789"), 0xe3069283);
# }
```

The *baseline* is the best target that the whole program is compiled for. Without `-Ctarget-cpu` it is `neon` on
AArch64, and `sse2` on x86-64, which has no lookup of bytes: sets of bytes and tables that are constants
become comparisons, but to permute, compress or look up in other tables takes 2 to 20 times as long as on `sse4`. `portable` has the same code, so a list needs `sse2` only for `core::arch`. With `-Ctarget-cpu=nehalem` it is `sse4`.

A kernel can be plain Rust, which LLVM vectorizes for each target. Time it with AVX-512, where loops with a stride or an index can get [slower][slow].

### Another way for some targets

All operations work on all targets. Where an instruction is missing, others stand in, and some of those are slow. A level means "at least" here: `avx2` holds on `icelake`, `sse2` on all levels of x86, and `neon` on all of AArch64.

| | |
| --- | --- |
| `if has!(fma)`, `has!(avx2 + gfni)`, `has!(vnni \| dot)` | A constant. The other branch leaves no code |
| `pick! { gfni => a, _ => b }` | The first arm that fits. It takes as known what its targets have in common, such as the width |
| `#[only(avx2)]`, `#[except(avx512)]`, or both | The same for a function, or those that are written in an `impl` or a module. A call on another target is an error of `cargo build`, unless it is after `if has!(..)` or in an arm |
| Several such functions of one name, signature and visibility | *Twins*, of which the first that fits is called. One without words is for all other targets. They are in one marked module or `impl` |
| `Pick![S: avx512 => u32x16<S>, _ => u32x8<S>]` | A width, or a vector or mask with one type of lanes. `Either!` takes any types that are `Copy`. Neither takes quotes, or words like `fast_zmm` |

A word can also be a width, `B32`, or a feature of the compiler in quotes. For `fp16`, `fhm` and SVE of Arm, take the operations of the crate. What only such a function uses goes into it, or has `#[only]` too: else it is dead code on other architectures.
In such functions and arms, the intrinsics of `core::arch` that take no pointers are safe, for instructions that the crate lacks. `v.into()` gives a type
of `core::arch` if the width is known (`avx2` alone has two), and `x.into()` or `u8x32::from(x)` is the way back. The widths are the same: `split` and `for_each_part(|i, part| ..)` take a wider vector apart. (For `even_bits` there is `extract_bits`, which avoids the instruction where it is slow.)

```
# #[forbid(unsafe_code)] #[bun_simd::simd(avx2, neon)] mod simd { use bun_simd::prelude::*;
type V = Simd<f32, Pick![S: avx512 => Native<S>, _ => Twice<Native<S>>], S>;

#[kernel]
pub fn roots(x: &mut [f32]) {
    V::over_mut(x).map(|v| v.sqrt());
}

#[only(avx2 + B32)]
fn signed(v: i8xN<S>, by: i8xN<S>) -> i8xN<S> {
    use core::arch::x86_64::*; // In here, as other architectures leave the function out.
    i8xN::from(_mm256_sign_epi8(v.into(), by.into()))
}
fn signed(v: i8xN<S>, by: i8xN<S>) -> i8xN<S> {
    by.simd_eq(0).select(0, by.simd_lt(0).select(-v, v))
}

#[kernel]
pub fn minus(x: i8) -> i8 {
    signed(i8xN::splat(x), i8xN::splat(-1))[0]
}

#[kernel]
pub fn even_bits(bits: u32) -> u32 {
    pick! {
        "bmi2" => core::arch::x86_64::_pext_u32(bits, 0x5555_5555),
        _ => (0..16).map(|i| (bits >> (2 * i) & 1) << i).sum(),
    }
}
# } use simd::*; fn main() {
# let mut x = [4.0; 40];
# roots(&mut x);
# assert_eq!(x, [2.0; 40]);
# assert_eq!(minus(3), -3);
assert_eq!(even_bits(0b1000101), 0b1011);
# }
```

## Testing on each target

`cargo check` and `cargo clippy` report most mistakes. Conditions on constants, such as `widen` to a narrower lane, show in `cargo build` only. `#[simd(portable)]` builds faster.

A normal call tests one target: the best of the machine. (A method that is a kernel has only that: use `set_cpu`.) `f::to(target, ..)` runs the version for `target`. It gives `None` if there is none, or
if the CPU lacks the target. `f::targets()` are those that it can run, and `bun_simd::target!(avx2 + vaes)` names one. Compare with plain Rust, at all lengths up to a few times 64 bytes:
the mistakes are in the tails.

```
# #[forbid(unsafe_code)] #[bun_simd::simd] mod simd { use bun_simd::prelude::*;
#[kernel]
pub fn count(text: &[u8], byte: u8) -> usize {
    over(text).count(|v| v.simd_eq(byte))
}
# } use {bun_simd::prelude::*, simd::*}; fn main() {
let text: Vec<u8> = (0..300u32).map(|i| (i * i % 7) as u8).collect();
for target in count::targets() {
    for len in 0..text.len() {
        let expected = text[..len].iter().filter(|&&b| b == 0).count();
        assert_eq!(count::to(target, &text[..len], 0), Some(expected), "{target:?}, {len} bytes");
    }
}
# }
```

`bun_simd::target::set_cpu` makes all kernels treat the CPU as a lesser one, such as each of `Target::ALL`, until `reset_cpu`, and returns `false` if it lacks the target. It can't go below the
baseline, and drops words such as `fast_gather` unless the target names them. `cpu().with("fast_gather")` adds one. It is global, so
tests that use it can't run side by side.

- A machine without AVX-512 never has 64 lanes. `RUSTFLAGS='--cfg bun_simd_native="64"' cargo test` makes `Native` 64 bytes on all targets, or 16 or 32. 
- **`RUSTFLAGS='--cfg bun_simd_check' cargo test --release --tests` fails to link if vectors are used without the instructions of their target**, which is right and slow: see [pitfalls](#pitfalls). It holds for all targets above the baseline, whatever the machine has. The linker names the first few functions. All crates have to be optimized, which doc tests are not. It doesn't see code that only loads, stores or joins masks, or that the program doesn't reach. A dynamic library can fail as late as it is loaded.
- Print which targets ran.
- `#[test]` and `#[cfg(test)]` are left as they are written, but for kernels. Test a helper in a kernel, such as `#[test] #[kernel] fn`.
- For the other architecture, run `cargo test --target aarch64-unknown-linux-gnu` in QEMU. `.cargo/config.toml` needs `linker = "aarch64-linux-gnu-gcc"` and
  `runner = "qemu-aarch64 -cpu max -L /usr/aarch64-linux-gnu"` under `[target.aarch64-unknown-linux-gnu]`. `-cpu max` has all targets.
- Set `opt-level = 2` and `incremental = false` in `[profile.dev]`, or in `[profile.dev.package.<name>]` for the crate with the kernels and for bun_simd, never for bun_simd alone. Level 1 compiles and runs slower. Level `z` gives slower and longer kernels than `s`.
  At level 0, kernels took 100 times as long and more, and up to 100 KB of stack for a call (640 KB if only bun_simd is optimized, and 3 MB for `sort`). Generic kernels are compiled in the crate that calls them.

## Pitfalls

**What depends on the target needs one.** Outside of marked code, `u8xN::splat(1)` or the call of a helper is the error "type annotations needed": add `#[simd]` or `#[kernel]`, or name `Baseline`.

**A function without a mark has no instructions but those of the baseline**, unless it is inlined. That holds for scalar ones too. [A flag for tests](#testing-on-each-target) finds those with vectors.

| | Mend |
| --- | --- |
| A function that declares `S: Isa`, or that a `macro_rules!` writes [among the items][programs] | `#[simd]` |
| A generic function of another crate, such as `Iterator::sum` unless `opt-level` is 2 or 3 | Pass it a closure, or write the loop |
| An operation as a pointer, a closure in a constant | A marked function with `#[inline(never)]`. A `match` in the loop is faster than pointers |
| A closure in the text of a macro | `#[simd]` on the macro. If it is exported, a marked function in the place of the closure |
| A closure in the arguments of a macro, but for `vec!`, `assert!` and their like | `let f = \|v\| ..;` before it. Or a marked macro writes it again: `(\|$v:ident\| $e:expr) => { f(\|$v\| $e) }` |

A closure needs no mend where a loop of this crate calls it.

**The closure of a loop doesn't know its lanes.** `over_mut(x).map(|v| v ^ u8xN::repeat(&key))` is wrong if the length is not a multiple of that of the key,
since the last vector overlaps the one before. `scan` goes in order. The documentation of `map_into` says which groups stay together.

**The padding can match.** `load_or_default` fills up with zeros, so a search for zero, or for "less than", finds them.

```
# use bun_simd::prelude::*; #[kernel] fn example() {
let rest = b"abc";
let control = u8x16::load_or_default(rest).simd_lt(0x20);
assert_eq!(control.first_set(), Some(3));
assert_eq!((control & mask8x16::first_n(rest.len())).first_set(), None);
# } example()
```

**Where names of `std::simd` differ.** `store_select` panics if the slice is shorter than the vector, and `shift_elements_left::<K>` by more than all lanes doesn't build. `simd_clamp` never panics, nor do `/` and `%` by a vector.
`resize` fills up with zeros, `reduce_sum` adds floats as a tree, and `count_ones`, `leading_zeros` and the like keep the type of the lane.

**Counts of shifts are taken modulo the number of bits**, as in `wrapping_shl`: `v << 8` leaves bytes as they are.

**A floating-point sum of one's own depends on the width.** A loop over `f32xN` adds in an order that depends on the
lanes. For the same bits everywhere, use a fixed width, or `over(x).sum()` and `zip(y).dot()`, whose order depends only on the length.

**`mul_add` is slow without FMA**, since it rounds once on all CPUs. `wasm + relaxed` asks the engine whether it has it. `mul_add_relaxed` rounds once or twice.

**Functions such as `exp` and `sin` keep their bounds of error on all CPUs, and have two results**: one on all targets with `has!(fma)`, and one on all without, such as `sse4`, `wasm` and `portable`.
The payload of a NaN can differ anywhere, and so can what `simd_min`, `reduce_min` and their like make of a signaling NaN. A kernel that needs the same bits can return an error unless `has!(fma)`.

**`_relaxed` passes tests by luck.** `simd_min_relaxed` with NaN, or `lookup_relaxed` with an index out of range, gives some
value, and another one on x86-64 than on AArch64.

**Some mistakes show in `cargo build` only.** `block::<1>` of a `u8xN` doesn't fit SSE4 and NEON. The error says that a type with the name of the rule is too big.
Put the call after `if const { .. }` or `if has!(..)`. [The page on panics][panics] lists the rules, and the conditions that count.

**A `const` assertion fails even in a branch that the target never takes.** Use `assert!(const { .. })`, which leaves no code if
it holds, or `#[only(..)]` and `#[except(..)]`.

**Left is toward lane 0** in `shift_elements_left` and `rotate_elements_left`, as for slices. x86 and Highway call it right.

**A number without a type is an `i32`** if nothing else tells. `v + m.select(9, 0)` compiles, and `let x = m.select(9, 0)` needs `9u8`.

**Functions of `std` that take closures are not always inlined.** `array.map(..)` with several codegen units is the usual case, also with plain numbers, and `collect` another. Use `array::map` of this crate,
or a `for` loop. The closure keeps the instructions of the target, but each round is a call.

**A vector can't be a `const`, nor an argument or result of a kernel**, and a method of a trait can't be a kernel. [Larger programs][programs] has recipes, and a table of messages.

[index]: index.md
[speed]: speed.md
[slow]: speed.md#slow-operations
[strips]: loops.md#strips
[loops]: loops.md
[programs]: programs.md
[marks]: programs.md#many-files-and-crates
[targets]: targets.md
[panics]: panics.md
[quirks]: quirks.md
[highway]: highway.md
