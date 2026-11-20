# What rustc rejects

Attempts to get past the gate, or out of bounds, without `unsafe`. Each block is a test, for x86-64. `simd` is a module with `#[foreach_target]` and a `fn kernel() {}`.

## From plain code

An op with an instruction of its own:

```rust,compile_fail,E0133
let v = bun_simd::avx2::U8::zero();
v.lookup(v);
```

The same for the lowest target:

```rust,compile_fail,E0133
let v = bun_simd::sse4::U8::zero();
v.lookup(v);
```

A loop:

```rust,compile_fail,E0133
bun_simd::avx2::U8::position(b"", |v| v.simd_eq(1));
```

A kernel:

```rust,compile_fail,E0133
# #[bun_simd::foreach_target] mod simd { pub fn kernel() {} }
simd::avx2::kernel();
```

As a pointer:

```rust,compile_fail,E0308
# #[bun_simd::foreach_target] mod simd { pub fn kernel() {} }
let f: fn() = simd::avx2::kernel;
```

With a cast:

```rust,compile_fail,E0605
# #[bun_simd::foreach_target] mod simd { pub fn kernel() {} }
let f = simd::avx2::kernel as fn();
```

As `impl Fn`:

```rust,compile_fail,E0277
# #[bun_simd::foreach_target] mod simd { pub fn kernel() {} }
fn call(f: impl Fn()) {}
call(simd::avx2::kernel);
```

As `dyn Fn`:

```rust,compile_fail,E0277
# #[bun_simd::foreach_target] mod simd { pub fn kernel() {} }
let f: &dyn Fn() = &simd::avx2::kernel;
```

In a `static`:

```rust,compile_fail,E0308
# #[bun_simd::foreach_target] mod simd { pub fn kernel() {} }
static F: fn() = simd::avx2::kernel;
```

Through a closure:

```rust,compile_fail,E0133
# #[bun_simd::foreach_target] mod simd { pub fn kernel() {} }
let f: fn() = || simd::avx2::kernel();
```

A vector in a register that plain code lacks:

```rust,compile_fail
extern "C" fn f(v: bun_simd::avx2::U8) {}
std::hint::black_box(f as extern "C" fn(_));
```

That error has no code. This is its neighbour, which compiles:

```rust,no_run
extern "C" fn f(v: bun_simd::sse4::U8) {}
std::hint::black_box(f as extern "C" fn(_));
```

A shuffle from past the second vector:

```rust,compile_fail,E0080
struct Past;
impl bun_simd::Shuffle<16> for Past {
    const FROM: [usize; 16] = [32; 16];
}
let v = bun_simd::sse4::U8::zero();
v.shuffle::<Past>(v);
```

More lanes to repeat than there is room for:

```rust,compile_fail,E0080
bun_simd::sse4::Vector::<u8, 8>::repeat([0; 16]);
```

More than 16 bytes to repeat:

```rust,compile_fail,E0080
bun_simd::sse4::Vector::<u8, 32>::repeat([0; 32]);
```

The minimum of an odd number of `f64`, in the portable copies:

```rust,compile_fail,E0080
let v = bun_simd::portable::Vector::<f64, 1>::zero();
v.min(v);
```

A product that is slow on most targets:

```rust,compile_fail,E0369
bun_simd::sse4::U8::zero() * 3;
```

```rust,compile_fail,E0369
bun_simd::sse4::I8::zero() * 3;
```

```rust,compile_fail,E0369
bun_simd::sse4::U64::zero() * 3;
```

```rust,compile_fail,E0369
bun_simd::sse4::I64::zero() * 3;
```

## The gate

Fewer features than the kernel has:

```rust,compile_fail,E0308
# #[bun_simd::foreach_target] mod simd { pub fn kernel() {} }
bun_simd::if_supported!(["avx2"], fn(), simd::avx2::kernel);
```

The same for a generic kernel:

```rust,compile_fail,E0308
#[target_feature(enable = "bmi1,bmi2")]
fn kernel<T>() {}
fn f<T>() {
    bun_simd::if_supported!(<T> ["bmi1"], fn(), kernel::<T>);
}
```

Its neighbour, which compiles:

```rust,no_run
#[target_feature(enable = "bmi1,bmi2")]
fn kernel<T>() {}
fn f<T>() {
    bun_simd::if_supported!(<T> ["bmi1", "bmi2"], fn(), kernel::<T>);
}
```

A `static mut` in the place of a type:

```rust,compile_fail,E0747
static mut K: usize = 0;
fn kernel() {}
bun_simd::if_supported!(<K> ["sse2"], fn(), kernel);
```

An intrinsic in a closure, which also runs without the feature:

```rust,compile_fail,E0133
bun_simd::with_bmi2(|| core::arch::x86_64::_bzhi_u64(1, 1));
```

Two features in one string:

```rust,compile_fail,E0080
# #[bun_simd::foreach_target] mod simd { pub fn kernel() {} }
bun_simd::if_supported!(["popcnt,sse4.2"], fn(), simd::sse4::kernel);
```

A feature that is not detected:

```rust,compile_fail,E0080
# #[bun_simd::foreach_target] mod simd { pub fn kernel() {} }
bun_simd::if_supported!(["popcnt", "sse4.2", "rdseed"], fn(), simd::sse4::kernel);
```

A `static mut` in the place of the kernel:

```rust,compile_fail,E0133
static mut K: usize = 0;
bun_simd::if_supported!(["sse2"], usize, K);
```

Another `target_feature`:

```rust,compile_fail,E0659
# #[bun_simd::foreach_target] mod simd { pub fn kernel() {} }
use bun_simd::foreach_width as target_feature;
bun_simd::if_supported!(["sse2"], fn(), simd::avx2::kernel);
```

Another `inline`:

```rust,compile_fail,E0659
# #[bun_simd::foreach_target] mod simd { pub fn kernel() {} }
use bun_simd::foreach_width as inline;
bun_simd::if_supported!(["sse2"], fn(), simd::avx2::kernel);
```

A write to what was detected:

```rust,compile_fail,E0433
bun_simd_trusted::detected::CACHE.store(!0, todo!());
```

Features out of nothing:

```rust,compile_fail,E0624
bun_simd::Features::from_bits(0);
```

## `AtomicFn`

A kernel:

```rust,compile_fail,E0308
# #[bun_simd::foreach_target] mod simd { pub fn kernel() {} }
static F: bun_simd::AtomicFn<fn()> = bun_simd::AtomicFn::new(simd::avx2::kernel);
```

A number:

```rust,compile_fail,E0277
static F: bun_simd::AtomicFn<usize> = bun_simd::AtomicFn::new(1);
```

A function that takes less:

```rust,compile_fail,E0308
static F: bun_simd::AtomicFn<fn(&u8)> = bun_simd::AtomicFn::new(|_| {});
let f: &bun_simd::AtomicFn<fn(&'static u8)> = &F;
```

An `unsafe fn`, taken out as safe:

```rust,compile_fail,E0308
# #[bun_simd::foreach_target] mod simd { pub fn kernel() {} }
let f: fn() = bun_simd::AtomicFn::<unsafe fn()>::new(simd::avx2::kernel).get();
```

## Shared memory

From plain code:

```rust,compile_fail,E0133
# use bun_simd_trusted::{SharedU8, shared::*};
fn f(bytes: &[[SharedU8; 32]; 1]) {
    load32::<1, 0>(bytes);
}
```

A load past the group:

```rust,compile_fail,E0080
# use bun_simd_trusted::{SharedU8, shared::*};
#[target_feature(enable = "sse2")]
fn f(bytes: &[[SharedU8; 8]; 1]) {
    load8::<1, 1>(bytes);
}
# let keep: unsafe fn(_) = f;
```

A store past the group:

```rust,compile_fail,E0080
# use bun_simd_trusted::{SharedOutU8, shared::*};
#[target_feature(enable = "sse2")]
fn f(bytes: &[[SharedOutU8; 8]; 1]) {
    store8::<1, 1>(0, bytes);
}
# let keep: unsafe fn(_) = f;
```

Too few bytes:

```rust,compile_fail,E0308
# use bun_simd_trusted::{SharedU8, shared::*};
#[target_feature(enable = "sse2")]
fn f(bytes: &[[SharedU8; 7]; 1]) {
    load8::<1, 0>(bytes);
}
```

A store to plain bytes:

```rust,compile_fail,E0308
# use {bun_simd_trusted::shared::*, std::sync::atomic::*};
#[target_feature(enable = "sse2")]
fn f(bytes: &[[u8; 8]; 1]) {
    store8::<1, 0>(0, bytes);
}
```

A store to what can only be read:

```rust,compile_fail,E0308
# use bun_simd_trusted::{SharedU8, shared::*};
#[target_feature(enable = "sse2")]
fn f(bytes: &[[SharedU8; 8]; 1]) {
    store8::<1, 0>(0, bytes);
}
```

```rust,compile_fail,E0308
fn f(bytes: &[bun_simd::SharedU8]) {
    bun_simd::SharedOutU8::from_slice(bytes);
}
```

```rust,compile_fail,E0616
fn f(byte: &bun_simd::SharedU8) {
    byte.0.store(0, std::sync::atomic::Ordering::Relaxed);
}
```

A load from what can only be written:

```rust,compile_fail,E0308
# use bun_simd_trusted::{SharedOutU8, shared::*};
#[target_feature(enable = "sse2")]
fn f(bytes: &[[SharedOutU8; 8]; 1]) {
    load8::<1, 0>(bytes);
}
```

```rust,compile_fail,E0277
# use bun_simd_trusted::{SharedOutU8, shared::*};
#[target_feature(enable = "avx512bw")]
fn f(bytes: &[SharedOutU8]) {
    load64_masked::<false>(bytes);
}
```

```rust,compile_fail,E0616
fn f(byte: &bun_simd::SharedOutU8) {
    byte.0.get();
}
```

A view that lives longer than the memory:

```rust,compile_fail,E0597
let view = {
    let bytes = [std::sync::atomic::AtomicU8::new(0)];
    bun_simd::SharedU8::from_slice(&bytes)
};
```

```rust,compile_fail,E0597
let view = {
    let mut bytes = [0];
    bun_simd::Out::from(&mut bytes[..]).into_shared()
};
```

A read of plain bytes between two stores:

```rust,compile_fail,E0503
let mut bytes = [0];
let view = bun_simd::Out::from(&mut bytes[..]).into_shared();
let byte = bytes[0];
view[0].set(byte);
```

A store to wider atomics:

```rust,compile_fail,E0308
fn f(words: &[std::sync::atomic::AtomicU64]) {
    bun_simd::SharedOutU8::from_slice(words);
}
```

A masked load of bytes that are not initialized:

```rust,compile_fail,E0277
# use bun_simd_trusted::shared::*;
#[target_feature(enable = "avx512bw")]
fn f(bytes: &[std::mem::MaybeUninit<u8>]) {
    load64_masked::<true>(bytes);
}
```

Of a type of one's own:

```rust,compile_fail,E0603
struct Padded(u8, u16);
impl bun_simd_trusted::shared::sealed::Readable for Padded {}
```

A masked store to plain bytes:

```rust,compile_fail,E0308
# use bun_simd_trusted::shared::*;
#[target_feature(enable = "avx512bw")]
fn f(bytes: &[u8]) {
    store64_masked::<true>(Default::default(), bytes);
}
```

To what can only be read:

```rust,compile_fail,E0308
# use bun_simd_trusted::{SharedU8, shared::*};
#[target_feature(enable = "avx512bw")]
fn f(bytes: &[SharedU8]) {
    store64_masked::<true>(Default::default(), bytes);
}
```

A store to a type that has invalid values:

```rust,compile_fail,E0277
bun_simd::Out::from(&mut [true][..]).into_shared()[0].set(2);
```

A copy from what can only be written:

```rust,compile_fail,E0277
fn f(bytes: &[bun_simd::SharedOutU8]) {
    bun_simd::copy_to_shared(bytes, bytes);
}
```

From bytes that are not initialized:

```rust,compile_fail,E0277
fn f(from: &[std::mem::MaybeUninit<u8>], to: &[bun_simd::SharedOutU8]) {
    bun_simd::copy_to_shared(from, to);
}
```

From what is smaller than a byte:

```rust,compile_fail,E0277
fn f(to: &[bun_simd::SharedOutU8]) {
    bun_simd::copy_to_shared(&[(); 100], to);
}
```

From a type of one's own:

```rust,compile_fail,E0603
struct Nothing;
impl bun_simd_trusted::shared_u8::sealed::Byte for Nothing {
    fn get(&self) -> u8 {
        0
    }
}
```

A copy that lives longer than its memory:

```rust,compile_fail,E0597
let copy = {
    let mut bytes = [0];
    bun_simd::copy_from_shared(&[], (&mut bytes[..]).into())
};
```

## `Out`

A vector that moves while its spare capacity is lent:

```rust,compile_fail,E0499
let mut vec = Vec::with_capacity(1);
let (out, _) = bun_simd::spare_capacity(&mut vec);
vec.reserve(100);
out.into_writer().push([1]);
```

```rust,compile_fail,E0616
let mut vec = Vec::<u8>::with_capacity(1);
let (out, rest) = bun_simd::spare_capacity(&mut vec);
rest.0.reserve(100);
out.into_writer().push([1]);
```

Two ways to what was appended:

```rust,compile_fail,E0499
let mut vec = Vec::with_capacity(1);
let (out, rest) = bun_simd::spare_capacity(&mut vec);
let filled = out.fill_chunks(&[1], |_, &[it]| Some([it]));
rest.append(filled);
let first = &mut vec[0];
filled[0] = *first;
```

A read:

```rust,compile_fail,E0616
fn f(out: bun_simd::Out<'_, u8>) {
    out.0;
}
```

A second handle:

```rust,compile_fail,E0382
fn f(out: bun_simd::Out<'_, u8>) {
    (out.take(1), out.take(1));
}
```

A value that is not initialized, into memory that is:

```rust,compile_fail,E0308
let mut bytes = [0u8; 1];
let mut out = bun_simd::Out::<u8>::from(&mut bytes[..]).into_writer();
out.push([std::mem::MaybeUninit::uninit()]);
```

The same, with another type of `Out`:

```rust,compile_fail,E0277
let mut bytes = [0u8; 1];
bun_simd::Out::<std::mem::MaybeUninit<u8>>::from(&mut bytes[..]);
```

Bytes that may be no value of the type:

```rust,compile_fail,E0277
#[target_feature(enable = "avx512bw")]
fn f(out: bun_simd::Out<'_, bool>) {
    out.fill_from_last(Default::default());
}
```

A reference that lives less long than the memory promises:

```rust,compile_fail,E0597
let (mut all, short) = ([&1u8; 1], 2);
let all: &mut [&'static u8] = &mut all;
bun_simd::Out::from(all).into_writer().push([&short]);
```

```rust,compile_fail
fn f<'a>(rest: bun_simd::Append<'a, &'static u8>) -> bun_simd::Append<'a, &'a u8> {
    rest
}
```

An `Out` that lives longer than the memory:

```rust,compile_fail,E0597
let out = {
    let mut bytes = [0u8; 2];
    bun_simd::Out::from(&mut bytes[..])
};
```

```rust,compile_fail,E0597
let out = {
    let mut bytes = [0u8; 2];
    bun_simd::Out::from(&mut bytes[..]).into_chunks::<2>()
};
```

A value with a destructor:

```rust,compile_fail,E0277
fn f(all: &mut [String]) -> bun_simd::Out<'_, String> {
    all.into()
}
```

A length out of nothing:

```rust,compile_fail,E0616
fn f(mut out: bun_simd::Writer<'_, u8>) {
    out.len = 1;
}
```

Keeping what was lent:

```rust,compile_fail,E0521
let mut kept = None;
bun_simd::extend_vec(&mut vec![0u8], 1, |out| {
    kept = Some(out);
    &mut []
});
```

A write to the lender in the meantime:

```rust,compile_fail,E0499
fn f(mut out: bun_simd::Writer<'_, u8>) {
    out.append(|_| {
        out.push([1]);
        &mut []
    });
}
```

## In the module

An op of another target:

```rust,compile_fail,E0133
#[bun_simd::foreach_target]
mod simd {
    fn f(v: bun_simd::avx512_skx::U8) {
        v.lookup(v);
    }
}
```

An intrinsic that not all targets have:

```rust,compile_fail,E0133
#[bun_simd::foreach_target]
mod simd {
    fn f() {
        core::arch::x86_64::_mm512_setzero_si512();
    }
}
```

An intrinsic that takes a pointer:

```rust,compile_fail,E0133
#[bun_simd::foreach_target]
mod simd {
    fn f(p: *const core::arch::x86_64::__m128i) {
        core::arch::x86_64::_mm_loadu_si128(p);
    }
}
```

A `static` next to the kernel:

```rust,compile_fail,E0308
#[bun_simd::foreach_target]
mod simd {
    fn kernel() {}
    pub static F: fn() = kernel;
}
```

A `static` in a function:

```rust,compile_fail,E0308
#[bun_simd::foreach_target]
mod simd {
    fn kernel() {
        static F: fn() = kernel;
    }
}
```

A `const` in a function:

```rust,compile_fail,E0308
#[bun_simd::foreach_target]
mod simd {
    fn kernel() {
        const F: fn() = kernel;
    }
}
```

An associated `const` in a function:

```rust,compile_fail,E0308
#[bun_simd::foreach_target]
mod simd {
    pub struct S;
    fn kernel() {
        impl S {
            pub const F: fn() = kernel;
        }
    }
}
```

A `const fn`:

```rust,compile_fail,E0308
#[bun_simd::foreach_target]
mod simd {
    fn kernel() {}
    pub const fn f() -> fn() {
        kernel
    }
}
```

A closure in a `static`:

```rust,compile_fail,E0133
#[bun_simd::foreach_target]
mod simd {
    fn kernel() {
        static F: fn() = || kernel();
    }
}
```

A closure in the length of an array:

```rust,compile_fail,E0133
#[bun_simd::foreach_target]
mod simd {
    fn kernel() {}
    fn f(_: [u8; { let f: fn() = || kernel(); 0 }]) {}
}
```

A `thread_local!`:

```rust,compile_fail,E0308
#[bun_simd::foreach_target]
mod simd {
    fn kernel() {
        thread_local!(static F: fn() = const { kernel });
    }
}
```

The method of a trait:

```rust,compile_fail,E0133
#[bun_simd::foreach_target]
mod simd {
    fn kernel() {}
    pub struct S;
    impl Drop for S {
        fn drop(&mut self) {
            kernel();
        }
    }
}
```

The default of such a method:

```rust,compile_fail,E0133
#[bun_simd::foreach_target]
mod simd {
    fn kernel() {}
    pub trait T {
        fn f() {
            kernel();
        }
    }
}
```

An array of another size:

```rust,compile_fail,E0308
#[bun_simd::foreach_target]
mod simd {
    fn f(bytes: &[u8; 15]) {
        isa::U8::load(bytes);
    }
}
```

A vector of another size:

```rust,compile_fail,E0271
#[bun_simd::foreach_target]
mod simd {
    fn f(v: isa::U8) -> isa::Vector<u8, 8> {
        v.bitcast()
    }
}
```

A loop with vectors that a target has no short loads for:

```rust,compile_fail,E0080
#[bun_simd::foreach_target]
mod simd {
    #[export]
    pub fn f(text: &[u8]) -> Option<usize> {
        isa::Vector::<u8, 64>::position(text, |v| v.simd_eq(0))
    }
}
simd::f(b"");
```

`opaque` for a vector that does not fill one register:

```rust,compile_fail,E0080
#[bun_simd::foreach_target]
mod simd {
    #[export]
    pub fn f() -> u8 {
        isa::x256::U8::zero().opaque()[0]
    }
}
simd::f();
```

```rust,compile_fail,E0080
#[bun_simd::foreach_target]
mod simd {
    #[export]
    pub fn f() -> u8 {
        isa::Vector::<u8, 8>::zero().opaque()[0]
    }
}
simd::f();
```

A load from shared memory that is wider than a register:

```rust,compile_fail,E0080
#[bun_simd::foreach_target]
mod simd {
    #[export]
    pub fn f(bytes: &[bun_simd::SharedU8]) -> u8 {
        isa::Vector::<_, 32>::load(bytes.first_chunk().unwrap())[0]
    }
}
simd::f(&[]);
```

A store to it:

```rust,compile_fail,E0080
#[bun_simd::foreach_target]
mod simd {
    #[export]
    pub fn f(bytes: &[bun_simd::SharedOutU8]) {
        isa::Vector::<u8, 32>::zero().store_shared(bytes.first_chunk().unwrap());
    }
}
simd::f(&[]);
```

Sums that overflow a byte:

```rust,compile_fail,E0080
#[bun_simd::foreach_target]
mod simd {
    #[export]
    pub fn f(text: &[u8]) -> usize {
        isa::U8::sum_of_bytes::<_, 64>(text, |v| v)
    }
}
simd::f(b"");
```

Sums of vectors of another size:

```rust,compile_fail,E0080
#[bun_simd::foreach_target]
mod simd {
    #[export]
    pub fn f(text: &[u8]) -> usize {
        isa::x128::U8::sum_of_bytes::<_, 1>(text, |_| isa::U8::zero())
    }
}
simd::f(b"");
```

Halves of chunks that can end inside of a vector:

```rust,compile_fail,E0080
#[bun_simd::foreach_target]
mod simd {
    #[export]
    pub fn f(from: &[u8], to: bun_simd::Out<'_, u8>) {
        isa::U8::append_chunks(from, &mut to.into_writer(), |it| Some(isa::U8::load(it)));
    }
}
simd::f(b"", [0; 0][..].as_mut().into());
```

A limit that is no target of a CPU:

```rust,compile_fail
#[bun_simd::foreach_target]
mod simd {
    #[export(up_to = portable)]
    pub fn f() {}
}
```

```rust,compile_fail
#[bun_simd::foreach_target]
mod simd {
    #[export(up_to = avx, up_to = neon)]
    pub fn f() {}
}
```

Two limits for one architecture:

```rust,compile_fail
#[bun_simd::foreach_target]
mod simd {
    #[export(up_to = sse4, up_to = avx2)]
    pub fn f() {}
}
```

An argument that `export` does not know:

```rust,compile_fail
#[bun_simd::foreach_target]
mod simd {
    #[export(fast)]
    pub fn f() {}
}
```

Code that no copy uses:

```rust,compile_fail
#[deny(dead_code)]
#[bun_simd::foreach_target]
mod simd {
    fn f() {}
}
# fn main() {}
```

```rust,compile_fail
#[deny(dead_code)]
#[bun_simd::foreach_target(avx2, sse4, neon, portable)]
mod simd {
    fn f() {}
}
# fn main() {}
```

A kind of inlining that the macro would drop:

```rust,compile_fail
#[bun_simd::foreach_target]
mod simd {
    #[export]
    #[inline(always)]
    pub fn f() {}
}
```

An attribute that only the macro may use:

```rust,compile_fail,E0658
#[bun_simd::foreach_target]
mod simd {
    #[rustc_force_inline]
    fn f() {}
}
```

The same, with a `#` of the macro:

```rust,compile_fail,E0658
macro_rules! take {
    (then $($item:tt)*) => { $($item)* };
    ($hash:tt [inline] $(#$more:tt)* fn f $($rest:tt)*) => {
        take! { then $hash $($rest)* }
    };
}
#[bun_simd::foreach_target]
mod simd {
    take! { fn f [rustc_nounwind] const fn g() {} }
}
# fn main() {}
```

With brackets of the macro at the end:

```rust,compile_fail,E0658
macro_rules! take {
    (then $($meta:tt)*) => { #[cfg_attr(all(), $($meta)*)] struct S; };
    (#$group:tt $(#$more:tt)* fn f $($start:tt)*) => { take! { then $($start)* $group } };
    ($($group:tt)*) => { "" };
}
#[bun_simd::foreach_target]
mod simd {
    take! { fn f rustc_dummy = take! }
}
# fn main() {}
```

After the attribute that has the right:

```rust,compile_fail,E0658
#[bun_simd::force_inline]
#[rustc_nounwind]
fn f() {}
```

A macro in the place of the module, which would get all that is added:

```rust,compile_fail
macro_rules! take {
    ($($all:tt)*) => {};
}
#[bun_simd::foreach_target]
take! {}
# fn main() {}
```

A fragment of a macro, for which `C` would be -4:

```rust,compile_fail
macro_rules! make {
    ($e:expr) => {
        #[bun_simd::foreach_target]
        mod simd {
            pub const C: i8 = $e.pow(2);
        }
    };
}
make!(-2i8);
# fn main() {}
```

Its neighbour:

```rust
# macro_rules! make {
#     ($e:expr) => {
#         #[bun_simd::foreach_target]
#         mod simd {
#             pub const C: i8 = $e.pow(2);
#         }
#     };
# }
make!((-2i8));
fn main() {
    assert_eq!(simd::portable::C, 4);
}
```

A pointer to what has to be inlined:

```rust,compile_fail,E0308
#[bun_simd::foreach_target]
mod simd {
    #[inline(always)]
    fn kernel() {}
    fn f() -> fn() {
        kernel
    }
}
```

The same, from a macro in the module:

```rust,compile_fail,E0308
#[bun_simd::foreach_target]
mod simd {
    macro_rules! make {
        ($vis:vis, $name:ident) => {
            #[inline(always)]
            $vis fn $name() {}
        };
    }
    make!(pub(crate), kernel);
    fn f() -> fn() {
        kernel
    }
}
```

A lane of one's own:

```rust,compile_fail,E0277
#[derive(Clone, Copy, Default)]
struct Lane(bool);
impl bun_simd::Lane for Lane {}
```

## `unsafe` in what the macros are given

The lint has no code, so each of these expects it, and is rejected if it stays away.

In a function:

```rust,no_run
#![expect(unsafe_code)]
#[bun_simd::foreach_target]
mod simd {
    fn f(p: *const u8) -> u8 {
        unsafe { *p }
    }
}
```

In a type:

```rust,no_run
#![expect(unsafe_code)]
const EMPTY: [u8; 0] = [];
bun_simd::if_supported!(["sse2"], [u8; unsafe { 0 }], EMPTY);
```

In a bound:

```rust,no_run
#![expect(unsafe_code)]
fn kernel() {}
fn f<T: From<[u8; 0]>>() {
    bun_simd::if_supported!(<T: From<[u8; unsafe { 0 }]>> ["sse2"], fn(), kernel);
}
```

In an attribute that only the function that dispatches has:

```rust,no_run
#![expect(unsafe_code)]
mod portable {
    pub fn f() {}
}
bun_simd::export! {
    native[is_allowed (all()) Sse4 portable ["sse2"]] portable_for_tests[] or[]
    #[unsafe(export_name = "g")]
    fn f()
}
# fn main() {}
```

In a macro whose path ends with a token of `foreach_width`:

```rust,no_run
#![expect(unsafe_code)]
mod isa {
    pub use core::arch::global_asm as x128;
}
macro_rules! isa {
    ($text:literal) => {};
}
#[bun_simd::foreach_width]
mod width {
    isa!("nop");
}
# fn main() {}
```

In a macro that has the name of an added attribute:

```rust,no_run
#![expect(unsafe_code)]
use core::arch::global_asm as inline;
macro_rules! take {
    (then $($call:tt)*) => { $($call)* };
    (portable #[$name:tt] fn f $($rest:tt)*) => { take! { then $name $($rest)* } };
    ($($other:tt)*) => {};
}
#[bun_simd::foreach_target]
mod simd {
    take! { this_target fn f !("nop"); }
}
# fn main() {}
```

Or that of what replaces `#[inline(never)]`:

```rust,no_run
#![expect(unsafe_code)]
use core::arch::global_asm as inline;
macro_rules! take {
    (then $($call:tt)*) => { $($call)* };
    (portable #[$name:tt] fn f $($rest:tt)*) => { take! { then $name $($rest)* } };
    ($($other:tt)*) => {};
}
#[bun_simd::foreach_target]
mod simd {
    take! { this_target #[inline(never)] fn f !("nop"); }
}
# fn main() {}
```

Or that of an argument of `export!`:

```rust,no_run
#![expect(unsafe_code)]
extern crate bun_simd as real;
extern crate self as bun_simd;
use {core::arch::global_asm as native, export::export, real::*};
mod export {
    macro_rules! export {
        (then $($name:tt)*) => { $($name)*!("nop"); };
        ($name:tt $($more:tt)*) => { export! { then $name } };
    }
    pub(crate) use export;
}
#[real::foreach_target]
mod simd {
    #[export]
    fn f() {}
}
# fn main() {}
```

In the arguments of an attribute, which are only compared:

```rust,compile_fail
macro_rules! item { ($($it:tt)*) => { const _: u8 = { $($it)* }; } }
macro_rules! nothing { ($($it:tt)*) => {} }
#[bun_simd::foreach_width(a {} item! { unsafe { 0 } } nothing!)]
mod width {}
# fn main() {}
```

## What compiles, and does no harm

Another `then`:

```rust
# #[bun_simd::foreach_target] mod simd { pub fn kernel() {} }
trait Then {
    fn then<R>(self, f: impl FnOnce() -> R) -> Option<R>;
}
impl Then for bool {
    fn then<R>(self, f: impl FnOnce() -> R) -> Option<R> {
        panic!()
    }
}
bun_simd::if_supported!(["popcnt", "sse4.2"], fn(), simd::sse4::kernel);
```

Other crates:

```rust
# #[bun_simd::foreach_target] mod simd { pub fn kernel() {} }
mod core {}
mod std {}
mod bun_simd_trusted {}
bun_simd::if_supported!(["popcnt", "sse4.2"], fn(), simd::sse4::kernel);
```

Other macros with the names of those in `core`:

```rust
macro_rules! matches { ($($it:tt)*) => { compile_error!("") } }
macro_rules! unreachable { ($($it:tt)*) => { compile_error!("") } }
#[bun_simd::foreach_target]
mod simd {
    #[export]
    pub fn f() {}
}
# fn main() {}
```

A function to fall back on with a name that the dispatch uses:

```rust
#[bun_simd::foreach_target(neon + "aes")]
mod simd {
    #[export(or = is_any)]
    pub fn f(list: &[bool]) -> bool {
        false
    }
}
fn is_any(list: &[bool]) -> bool {
    false
}
fn main() {
    assert!(!simd::f(&[true]));
}
```

Another `pick`:

```rust
# #[bun_simd::foreach_target] mod simd { pub fn kernel() {} }
fn pick() -> fn() {
    panic!()
}
{
    let pick = || -> fn() { panic!() };
    bun_simd::if_supported!(["popcnt", "sse4.2"], fn(), simd::sse4::kernel);
}
```

The other ops in plain code, where LLVM makes do with the instructions that it has:

```rust
let v = bun_simd::avx512_icl::U8::iota();
assert_eq!((v + v).simd_eq(42).first_set(), Some(21));
```

Vectors on their way through plain code:

```rust
#[bun_simd::foreach_target]
mod simd {
    #[export]
    pub fn twice(byte: u8) -> u8 {
        plain(isa::U8::splat(byte))[3]
    }
}
#[inline(never)]
fn plain<V: Copy + core::ops::Add<Output = V>>(v: V) -> V {
    v + v
}
fn main() {
    assert_eq!(simd::twice(21), 42);
}
```

Features that are decoded from a lie:

```rust
let before = bun_simd::detected().names().count();
bun_simd_trusted::x86_64::decode(|_, _| [!0; 4], !0);
assert_eq!(bun_simd::detected().names().count(), before);
```

## Further features

An op needs its feature in the list of the module:

```rust,compile_fail,E0133
#[bun_simd::foreach_target(sse4, neon)]
mod simd {
    pub fn f(v: isa::U64) -> isa::U64 {
        v.carryless_mul_lower(v)
    }
}
# fn main() {}
```

```rust,no_run
#[bun_simd::foreach_target(sse4 + "pclmulqdq", neon + "aes")]
mod simd {
    pub fn f(v: isa::U64) -> isa::U64 {
        v.carryless_mul_lower(v)
    }
}
# fn main() {}
```

What runs otherwise cannot need one:

```rust,compile_fail,E0308
#[bun_simd::foreach_target(sse4 + "pclmulqdq", neon + "aes")]
mod simd {
    #[export(or = g)]
    pub fn f() {}
}
#[cfg_attr(target_arch = "x86_64", target_feature(enable = "avx2"))]
#[cfg_attr(target_arch = "aarch64", target_feature(enable = "sve2"))]
fn g() {}
# fn main() {}
```

The best copy comes first:

```rust,compile_fail
#[bun_simd::foreach_target(sse4, avx2)]
mod simd {}
# fn main() {}
```

```rust,compile_fail
#[bun_simd::foreach_target(sse4, sse4 + "bmi2")]
mod simd {}
# fn main() {}
```

```rust,compile_fail
#[bun_simd::foreach_target(sse4 + "pclmulqdq", sse4 + "aes", sse4 + "vpclmulqdq")]
mod simd {}
# fn main() {}
```

```rust,compile_fail
#[bun_simd::foreach_target(sse4 + "aes", avx2)]
mod simd {}
# fn main() {}
```

```rust,compile_fail
#[bun_simd::foreach_target(portable, sse4)]
mod simd {}
# fn main() {}
```

The features of two architectures are not compared. These fill the start of their table, where those of `sse4` are in theirs:

```rust,no_run
#[bun_simd::foreach_target(sse4, neon + "crc" + "lse2" + "lse128" + "rcpc3" + "flagm2" + "cssc" + "mops" + "hbc" + "aes")]
mod simd {}
# fn main() {}
```

A feature in place of a target:

```rust,compile_fail
#[bun_simd::foreach_target(avx, sse4)]
mod simd {}
# fn main() {}
```

The list has names from the tables only:

```rust,compile_fail
#[bun_simd::foreach_target(sse4 + "none", neon + "none")]
mod simd {}
# fn main() {}
```

```rust,compile_fail
#[bun_simd::foreach_target(portable + "aes")]
mod simd {}
# fn main() {}
```

```rust,compile_fail
macro_rules! item { ($($it:tt)*) => { const _: u8 = { $($it)* }; } }
macro_rules! nothing { ($($it:tt)*) => {} }
#[bun_simd::foreach_target(portable + a {} item! { un safe { 0 } } nothing!)]
mod simd {}
# fn main() {}
```

`or` takes a path:

```rust,compile_fail
#[bun_simd::foreach_target(sse4 + "aes", neon + "aes")]
mod simd {
    #[export(or = g / * [ * / ] #[inline / * ] * /)]
    pub fn f() {}
}
fn g() {}
# fn main() {}
```
