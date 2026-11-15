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

## The gate

Fewer features than the kernel has:

```rust,compile_fail,E0308
# #[bun_simd::foreach_target] mod simd { pub fn kernel() {} }
bun_simd::if_supported!(["avx2"], fn(), simd::avx2::kernel);
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
# use {bun_simd_trusted::shared::*, std::sync::atomic::*};
load32::<1, 0>(&[[const { AtomicU8::new(0) }; 32]]);
```

A load past the group:

```rust,compile_fail,E0080
# use {bun_simd_trusted::shared::*, std::sync::atomic::*};
#[target_feature(enable = "sse2")]
fn f(bytes: &[[AtomicU8; 8]; 1]) {
    load8::<1, 1>(bytes);
}
# let keep: unsafe fn(_) = f;
```

A store past the group:

```rust,compile_fail,E0080
# use {bun_simd_trusted::shared::*, std::sync::atomic::*};
#[target_feature(enable = "sse2")]
fn f(bytes: &[[AtomicU8; 8]; 1]) {
    store8::<1, 1>(0, bytes);
}
# let keep: unsafe fn(_) = f;
```

Too few bytes:

```rust,compile_fail,E0308
# use {bun_simd_trusted::shared::*, std::sync::atomic::*};
#[target_feature(enable = "sse2")]
fn f(bytes: &[[AtomicU8; 7]; 1]) {
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

A store to wider atomics:

```rust,compile_fail,E0308
# use {bun_simd_trusted::shared::*, std::sync::atomic::*};
#[target_feature(enable = "sse2")]
fn f(bytes: &[[AtomicU64; 1]; 1]) {
    store8::<1, 0>(0, bytes);
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

A load from shared memory that is wider than a register:

```rust,compile_fail,E0080
#[bun_simd::foreach_target]
mod simd {
    #[export]
    pub fn f(bytes: &[std::sync::atomic::AtomicU8; 32]) -> u8 {
        isa::Vector::load(bytes)[0]
    }
}
simd::f(&Default::default());
```

A limit that is no target of a CPU:

```rust,compile_fail
#[bun_simd::foreach_target]
mod simd {
    #[export(up_to = portable)]
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

A lane of one's own:

```rust,compile_fail,E0277
#[derive(Clone, Copy, Default)]
struct Lane(bool);
impl bun_simd::Lane for Lane {}
```

## `unsafe` in what the macros are given

The lint has no code, so each of these comes a second time, where it is allowed.

In a function:

```rust,compile_fail
#[bun_simd::foreach_target]
mod simd {
    fn f(p: *const u8) -> u8 {
        unsafe { *p }
    }
}
```

```rust,no_run
#![allow(unsafe_code)]
#[bun_simd::foreach_target]
mod simd {
    fn f(p: *const u8) -> u8 {
        unsafe { *p }
    }
}
```

In a type:

```rust,compile_fail
const EMPTY: [u8; 0] = [];
bun_simd::if_supported!(["sse2"], [u8; unsafe { 0 }], EMPTY);
```

```rust,no_run
#![allow(unsafe_code)]
const EMPTY: [u8; 0] = [];
bun_simd::if_supported!(["sse2"], [u8; unsafe { 0 }], EMPTY);
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
