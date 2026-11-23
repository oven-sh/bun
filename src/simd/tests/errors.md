Mistakes that don't compile.

## Types that don't fit

`cargo check` finds these.

This compiles.

```
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _: (u16x32<S>, f32x16<S>, u8x16<S>, u8x64<S>) = (v.widen()[0], w.cast(), w.cast(), h.saturating_narrow(h));
let _: (f32x16<S>, u32x16<S>, u64x8<S>) = (w.simd_eq(1).select(f, 0.5), h.dot(h), v.sum_groups());
let _ = (i16x16::from(u8x16::zero()), u8x4::from([1, 2, 3, 4]), v.rotate_left(v), v.rotate_left(1), v == v, v == 0);
# } example()
```

Lanes of another type.

```compile_fail,E0277
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v + h;
# } example()
```

Another width.

```compile_fail,E0277
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v + u8x32::zero();
# } example()
```

An array of another length.

```compile_fail,E0277
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v ^ [1, 2, 3, 4];
# } example()
```

The same in `from`.

```compile_fail,E0277
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = u8x16::from([0u8; 8]);
# } example()
```

A conversion that loses something.

```compile_fail,E0277
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = u16x16::from(i8x16::zero());
# } example()
```

A cast that changes the number of lanes.

```compile_fail,E0271
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _: u8x64<S> = w.cast();
# } example()
```

Widening to four times the size.

```compile_fail,E0277
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v.widen::<u32>();
# } example()
```

Widening to a narrower lane.

```compile_fail,E0277
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = h.widen_even::<u8>();
# } example()
```

Narrowing to a quarter of the size.

```compile_fail,E0277
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = w.saturating_narrow::<u8>(w);
# } example()
```

The same within blocks.

```compile_fail,E0277
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = w.in_blocks().saturating_narrow::<u8>(w);
# } example()
```

The same without saturation.

```compile_fail,E0277
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = w.wrapping_narrow::<u8>(w);
# } example()
```

A mask for lanes of another size.

```compile_fail,E0277
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v.simd_eq(1).select(h, h);
# } example()
```

A table of other lanes than the result has.

```compile_fail,E0308
# use bun_simd::prelude::*; #[kernel] fn example() {
let _: u8x16<S> = u8x16::zero().lookup(&[1u16, 2]);
# } example()
```

Sums that saturate, into another lane.

```compile_fail,E0277
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u8x16::zero().saturating_dot::<i32>(1);
# } example()
```

Masks for lanes of two sizes.

```compile_fail,E0308
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v.simd_eq(1) & h.simd_eq(1);
# } example()
```

Products that can't be summed into that lane.

```compile_fail,E0277
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = w.dot::<u16>(w);
# } example()
```

Sums into a narrower lane.

```compile_fail,E0277
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = w.sum_groups::<u8>();
# } example()
```

An operation on integers.

```compile_fail,E0599
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = f.saturating_add(f);
# } example()
```

An operation on floating-point numbers.

```compile_fail,E0599
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = w.sqrt();
# } example()
```

Counts of another type.

```compile_fail,E0277
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v.rotate_left(h);
# } example()
```

Halves of two widths.

```compile_fail,E0277
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = u8x16::zero().concat(u8x32::zero());
# } example()
```

A slice of other lanes.

```compile_fail,E0277
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = u8x16::load(&[0u16; 16]);
# } example()
```

The same for a store.

```compile_fail,E0277
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
v.store(&mut [0u16; 64]);
# } example()
```

Sums in the order of the target can't be read.

```compile_fail,E0616
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = PairSums::<i16, B16, S>::new().0;
# } example()
```

A view is not a vector.

```compile_fail,E0369
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v.in_blocks() + v;
# } example()
```

## Constants that fit no width

`cargo build` finds these, and `cargo check` doesn't.

A branch that is dead for a width still compiles.

```
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
if const { B16::BYTES >= 32 } {
    let _ = (u16x8::zero().block::<1>(), v.cast::<u16>(), v.concat(v));
}
# } example()
```

The largest constants that fit compile.

```
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v.block::<3>();
let _ = v.with_block::<3>(v.block::<0>());
let _ = v.splat_lane::<63>();
let _ = v.in_blocks().splat_lane::<15>();
let _ = v.as_u128s().splat_lane::<3>();
let _ = v.shift_elements_left::<64>(v);
let _ = v.shift_elements_right::<64>(v);
let _ = v.in_blocks().shift_elements_left::<16>(v);
let _ = v.in_blocks().shift_elements_left::<16>(0);
let _ = v.in_blocks().shift_elements_right::<16>(v);
let _ = v.in_blocks().shift_elements_right::<16>(0);
let _ = v.in_blocks().sliding_abs_diff_sum::<1, 0>(v);
let _ = v.in_blocks().sliding_abs_diff_sum::<0, 3>(v);
let _ = v.concat_halves::<1, 0>(v);
let _ = u8x64::load_interleaved::<4>(&[0; 512]);
let _ = v.lookup(&[0u8; 128]);
let _ = v.lookup(&[0u8; 1024]);
let _ = (u8x64::repeat(&[0; 64]), u32x16::repeat(&[0; 2]));
let _: ([u32x4<S>; 2], [u32x4<S>; 4]) = (u32x4::gather_interleaved(&[0; 9], u32x4::zero()), u32x4::gather_interleaved(&[0; 9], u32x4::zero()));
let _: [u32x4<S>; 1] = u32x4::gather_interleaved(&[0; 9], u32x4::zero());
let _ = u16x8::<S>::load_low_bytes(&[0; 16], 0u64);
let _ = (v.bit_planes::<8>(), u16x32::from_bit_planes([0; 16]));
let _ = (u8x8::zero().cast_mul::<u16>(1), u32x4::zero().cast_mul::<u64>(1));
let _ = u8x16::over_all([&[0u8; 9][..]]);
# } example()
```

What fits no width doesn't.

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v.block::<32>();
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u8x16::repeat(&[0; 3]);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
# let f = f32x4::zero();
let _ = f.polynomial_relaxed([]);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v.with_block::<32>(v.block::<0>());
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v.splat_lane::<512>();
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v.in_blocks().splat_lane::<16>();
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v.as_u128s().splat_lane::<32>();
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v.shift_elements_left::<513>(v);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v.shift_elements_right::<513>(v);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v.in_blocks().shift_elements_left::<17>(v);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v.in_blocks().shift_elements_left::<17>(0);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v.in_blocks().shift_elements_right::<17>(v);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v.in_blocks().shift_elements_right::<17>(0);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v.in_blocks().sliding_abs_diff_sum::<2, 0>(v);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v.in_blocks().sliding_abs_diff_sum::<0, 4>(v);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v.concat_halves::<2, 0>(v);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = u8x64::load_interleaved::<17>(&[0; 2048]);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v.lookup(&[0u8; 2048]);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u8x64::zero().lookup_relaxed(&[0u8; 1025]);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u8x64::zero().lookup_or(&[0u8; 1025], 0);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u64x2::zero().lookup_relaxed(&[0u64; 129]);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u16x8::zero().lookup(&[0u16; 1024]);
# } example()
```

A table whose length is not a power of two.

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v.lookup(&[0u8; 24]);
# } example()
```

Groups whose length is not a power of two.

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v.swizzle_groups([0, 0, 1]);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = v.concat_swizzle_groups(v, [3, 0, 1]);
# } example()
```

A product that is four times as wide.

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w, f) = (u8x64::zero(), u16x32::zero(), u32x16::zero(), f32x16::zero());
let _ = u8x8::zero().cast_mul::<u32>(1);
# } example()
```

A group that is larger than a block.

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u8x64::repeat(&[0; 128]);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u32x16::repeat(&[0; 32]);
# } example()
```

More planes than bits.

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u8x64::zero().bit_planes::<9>();
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u16x32::from_bit_planes([0; 17]);
# } example()
```

No slices.

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u8x16::over_all::<0, u8>([]);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = over(&[0u8]).windows::<0>().len();
# } example()
```

Empty windows.

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u32x4::zero().gather_windows::<u8, 0, 4>(&[0; 9]);
# } example()
```

Too few or too many vectors to interleave.

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u32x4::gather_interleaved::<0, _>(&[0; 9], u32x4::zero());
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u32x4::gather_interleaved::<5, _>(&[0; 9], u32x4::zero());
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u8x16::load_interleaved::<0>(&[0; 512]);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
u8x16::store_interleaved([u8x16::zero(); 0], &mut [0; 512]);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
u8x16::store_interleaved([u8x16::zero(); 17], &mut [0; 512]);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*;
let _ = u8x16::<Baseline>::repeat(&[0; 3]);
```

The low bytes of bytes.

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u8x16::load_low_bytes(&[0; 16], 0u64);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u8x16::<S>::load_low_bytes(&[0; 16], 0u64);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u8x16::zero().store_low_bytes(&mut [0; 16], 0u64);
# } example()
```

A third half.

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u8x16::zero().concat_halves::<0, 2>(0);
# } example()
```

Sixteen targets compile, and seventeen don't.

```
# use bun_simd::{prelude::*, target::Targets};
const MANY: Targets = Targets(&[Target::ALL[1]; 16]);
#[kernel(targets = MANY)]
fn f() {}
# fn main() { f() }
```

```compile_fail,E0080
# use bun_simd::{prelude::*, target::Targets};
const MANY: Targets = Targets(&[Target::ALL[1]; 17]);
#[kernel(targets = MANY)]
fn f() {}
# fn main() { f() }
```

An end of `unroll!` that is a constant above 16.

```compile_fail,E0080
const N: usize = 17;
bun_simd::unroll!(for i in 0..N { let _ = i; });
```

## What doesn't fit the width

`cargo build` finds these where it makes code. This compiles.

```
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w) = (u8x64::zero(), u16x32::zero(), u32x16::zero());
let _ = u8xN::zero().block::<0>();
let _ = u64x4::zero().swizzle_groups([3, 2, 1, 0]);
let _ = Simd::transpose([u32x8::zero(); 8]);
let _ = u8xN::from_parts(|_| u8x16::zero());
let _ = u32xN::gather_or_default(&[0], u32xN::zero());
let _ = h.concat(h).simd_eq(0).to_bitmask();
let _ = bun_simd::math::LinearMap::new(v, v).of(v);
let _ = v.cast::<u64>();
let _ = u64x2::zero().split();
let _ = u8x8::zero().bitcast::<u64>();
let _ = u8x16::zero().aes_round(0);
let _ = u32x4::load_3_of_4(&[0; 9]);
let _ = w.gather_windows::<u8, 1, 16>(&[0; 9]);
let _ = h.cast::<u32>().store_low_bytes(&mut [0; 256], 0u64);
let _ = Simd::transpose_in_blocks([w; 4]);
let _ = Simd::transpose_blocks([w; 4]);
let _ = u32x4::zero().widen::<<u32 as Int>::Wide>();
let _ = if const { u8xN::<S>::LANES > 16 } { u8xN::zero().block::<1>()[0] } else { 0 };
# } example()
```

So does this.

```
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w) = (u8x64::zero(), u16x32::zero(), u32x16::zero());
if const { Native::<S>::BYTES > 64 } {
    let _ = u8xN::zero().block::<1>();
    let _ = u64x2::zero().swizzle_groups([3, 2, 1, 0]);
    let _ = Simd::transpose([u32xN::zero(); 8]);
    let _ = u8xN::from_parts(|_| u8x32::zero());
    let _ = u32xN::gather_or_default(&[0], u32x8::zero());
    let _ = v.concat(v).simd_eq(0).to_bitmask();
    let _ = bun_simd::math::LinearMap::new(v, v).of(u8x32::zero());
    let _ = v.concat(v).cast::<u64>();
    let _ = u64x1::zero().split();
    let _ = u8x4::zero().bitcast::<u64>();
    let _ = u8x8::zero().aes_round(0);
    let _ = u64x4::load_3_of_4(&[0; 9]);
    let _ = w.gather_windows::<u8, 1, 8>(&[0; 9]);
    let _ = v.cast::<u32>().store_low_bytes(&mut [0; 256], 0u64);
    let _ = Simd::transpose_in_blocks([w; 3]);
    let _ = Simd::transpose_blocks([w; 2]);
    let _ = u64x2::zero().widen::<<u64 as Int>::Wide>();
    let _ = if u8xN::LANES > 16 { u8xN::zero().block::<1>()[0] } else { 0 };
}
# } example()
```

A block or lane that only some targets have.

```compile_fail
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w) = (u8x64::zero(), u16x32::zero(), u32x16::zero());
let _ = u8xN::zero().block::<1>();
# } example()
```

A group that is longer than the vector.

```compile_fail
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w) = (u8x64::zero(), u16x32::zero(), u32x16::zero());
let _ = u64x2::zero().swizzle_groups([3, 2, 1, 0]);
# } example()
```

Rows that are not as many as the lanes.

```compile_fail
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w) = (u8x64::zero(), u16x32::zero(), u32x16::zero());
let _ = Simd::transpose([u32xN::zero(); 8]);
# } example()
```

A part that is wider than the vector.

```compile_fail
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w) = (u8x64::zero(), u16x32::zero(), u32x16::zero());
let _ = u8xN::from_parts(|_| u8x32::zero());
# } example()
```

Another number of indices.

```compile_fail
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w) = (u8x64::zero(), u16x32::zero(), u32x16::zero());
let _ = u32xN::gather_or_default(&[0], u32x8::zero());
# } example()
```

More than 64 lanes.

```compile_fail
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w) = (u8x64::zero(), u16x32::zero(), u32x16::zero());
let _ = v.concat(v).simd_eq(0).to_bitmask();
# } example()
```

A map of another width.

```compile_fail
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w) = (u8x64::zero(), u16x32::zero(), u32x16::zero());
let _ = bun_simd::math::LinearMap::new(v, v).of(u8x32::zero());
# } example()
```

More than 512 bytes.

```compile_fail
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w) = (u8x64::zero(), u16x32::zero(), u32x16::zero());
let _ = v.concat(v).cast::<u64>();
# } example()
```

Too few lanes.

```compile_fail
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w) = (u8x64::zero(), u16x32::zero(), u32x16::zero());
let _ = u64x1::zero().split();
# } example()
```

A lane that is wider than the vector.

```compile_fail
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w) = (u8x64::zero(), u16x32::zero(), u32x16::zero());
let _ = u8x4::zero().bitcast::<u64>();
# } example()
```

Less than 16 bytes.

```compile_fail
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w) = (u8x64::zero(), u16x32::zero(), u32x16::zero());
let _ = u8x8::zero().aes_round(0);
# } example()
```

Three of four lanes of 64 bits.

```compile_fail
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w) = (u8x64::zero(), u16x32::zero(), u32x16::zero());
let _ = u64x4::load_3_of_4(&[0; 9]);
# } example()
```

Another number of windows.

```compile_fail
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w) = (u8x64::zero(), u16x32::zero(), u32x16::zero());
let _ = w.gather_windows::<u8, 1, 8>(&[0; 9]);
# } example()
```

Lengths that need more than 64 bits.

```compile_fail
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w) = (u8x64::zero(), u16x32::zero(), u32x16::zero());
let _ = v.cast::<u32>().store_low_bytes(&mut [0; 256], 0u64);
# } example()
```

Rows that are not whole squares.

```compile_fail
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w) = (u8x64::zero(), u16x32::zero(), u32x16::zero());
let _ = Simd::transpose_in_blocks([w; 3]);
# } example()
```

The same for blocks.

```compile_fail
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w) = (u8x64::zero(), u16x32::zero(), u32x16::zero());
let _ = Simd::transpose_blocks([w; 2]);
# } example()
```

No lane is wider than 64 bits.

```compile_fail
# use bun_simd::prelude::*; #[kernel] fn example() {
# let (v, h, w) = (u8x64::zero(), u16x32::zero(), u32x16::zero());
let _ = u64x2::zero().widen::<<u64 as Int>::Wide>();
# } example()
```

## A static that would have the size of another target

```compile_fail
#[bun_simd::simd]
mod simd {
    use bun_simd::prelude::*;
    const N: usize = u8xN::LANES;
    static TABLE: [u8; N] = [0; N];
    #[kernel] pub fn f() -> u8 { TABLE[N - 1] }
}
# fn main() {}
```

No slices side by side.

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u8x16::over_all::<0, u8>([]);
# } example()
```

Records of no value.

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _: [u8x16<S>; 0] = u8x16::load_interleaved_or_default(&[0u8]);
# } example()
```

Records of 17 values.

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _: [u8x16<S>; 17] = u8x16::load_interleaved_or_default(&[0u8]);
# } example()
```

The same for a store.

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
u8x16::store_interleaved_partial([u8x16::zero(); 17], &mut [0u8]);
# } example()
```

The same for a result.

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
over(&[0u8]).scan_into(&mut [0u8; 9], |v| [v; 0]);
# } example()
```

And of 17.

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
over(&[0u8]).scan_into(&mut [0u8; 9], |v| [v; 17]);
# } example()
```

A mask that is shifted by more lanes than any vector has.

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let m = mask8x16::splat(true);
let _ = m.shift_elements_left::<513>(m);
# } example()
```

The same to the right.

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let m = mask8x16::splat(true);
let _ = m.shift_elements_right::<513>(m);
# } example()
```

The low bytes of bytes.

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
Output::overwrite(&mut [0; 16]).push(u8x16::zero().low_bytes(0));
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u8x16::zero().first_n(1).low_bytes(0);
# } example()
```

Reductions of no vector, and of 17.

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u8x16::<S>::reduce_each([], |a, b| a + b);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u8x16::reduce_each([u8x16::zero(); 17], |a, b| a + b);
# } example()
```

Records of no value and of 17, and no slice.

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = over(&[0u8]).interleaved::<0>();
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = over(&[0u8]).interleaved::<17>();
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u8x16::over_all::<0, u8>([]);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
over(&[0u8]).map_into(&mut [0u8], |v| [v; 0]);
# } example()
```

More planes than bits.

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u8x16::zero().bit_planes::<9>();
# } example()
```

The derives take structs without parameters.

```compile_fail
# use bun_simd::prelude::*; #[kernel] fn example() {
#[derive(Copy, Clone, Plain)]
struct Pair<T>(T, T);
# } example()
```

```compile_fail
# use bun_simd::prelude::*; #[kernel] fn example() {
#[derive(Copy, Clone, Plain)]
enum Kind { A }
# } example()
```

```compile_fail
# use bun_simd::prelude::*; #[kernel] fn example() {
#[derive(Copy, Clone, AsBytes)]
union Both { a: u8, b: u8 }
# } example()
```

What is read as bytes has no padding, and what is made from bytes takes all of them.

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
#[derive(Copy, Clone, AsBytes)]
#[repr(C)]
struct Between(u8, u16);
let _ = as_bytes(&[Between(0, 0)]);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
#[derive(Copy, Clone, AsBytes)]
#[repr(C)]
struct After(u16, u8);
let _ = as_bytes(&[After(0, 0)]);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
#[derive(Copy, Clone, AsBytes)]
#[repr(u8, align(2))]
enum Number { A }
let _ = as_bytes(&[Number::A]);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = as_bytes(&[Aligned([0u8; 63])]);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = as_bytes_mut(&mut [Aligned([0u8; 63])]);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = bitcast_slice_mut::<u8>(&mut [Aligned([0u8; 63])]);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = as_bytes(&[u8x8::zero()]);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = as_bytes_mut(&mut [u8x8::zero()]);
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = bitcast_slice::<[u8; 0]>(&[0u8]);
# } example()
```

A cast to more alignment.

```compile_fail
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = bitcast_slice::<u16>(Aligned([0u8; 64]).0[1..].as_chunks::<2>().0);
# } example()
```

A lane that no vector has.

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = u8x64::zero().with_lane::<512>(1);
# } example()
```

Formats with too few bits, or too many. The first compiles.

```
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = (Minifloat::ieee::<2, 1>(), Minifloat::ieee::<2, 5>(), Minifloat::ieee::<6, 1>());
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = Minifloat::ieee::<1, 3>();
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = Minifloat::ieee::<4, 0>();
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = Minifloat::ieee::<4, 4>();
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = Minifloat::ieee::<7, 1>();
# } example()
```

```compile_fail,E0080
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = Minifloat::ieee::<8, 1>();
# } example()
```

A lane in a branch that is not taken compiles.

```
# use bun_simd::prelude::*; #[kernel] fn example() {
let _ = if has!(B64) { u8xN::zero().concat(u8xN::zero()).lane::<64>() } else { u8x16::zero().lane::<15>() };
# } example()
```

A kernel that is written by hand can't have features in quotes.

```compile_fail,E0080
use bun_simd::{generic::*, target, target::*};
struct K;
impl Kernel<()> for K {
    type Output = ();
    const TARGETS: Targets = Targets(&[target!(avx2 + "adx"), target!(neon + "i8mm")]);
    fn run<S: Isa>(_: S, _: ()) {}
}
dispatch::<K, _>(());
```

A length that depends on a word which is no level.

```compile_fail,E0080
#[bun_simd::simd]
mod k {
    use bun_simd::prelude::*;
    #[simd]
    const N: usize = if has!(aes) { 4 } else { 8 };
    #[kernel(avx2 + aes, avx2, neon + aes, neon)]
    pub fn f() -> usize { [0u8; S::N].len() }
}
k::f();
```
