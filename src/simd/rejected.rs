//! Attempts to get past the gate, or out of bounds, without `unsafe`.

macro_rules! program {
    ($how:expr, $lints:literal, { $($in_module:tt)* } { $($outside:tt)* }) => {
        concat!(
            "```",
            $how,
            "\n#![allow(unused)]\n",
            $lints,
            "\n",
            stringify! {
                use ::bun_simd::{AtomicFn, if_supported};
                use ::bun_simd_trusted::shared;
                use ::core::sync::atomic::AtomicU8;
                type F = fn(&[u8]) -> usize;
                #[bun_simd::foreach_target]
                mod simd {
                    #[export]
                    pub fn k(text: &[u8]) -> usize {
                        isa::find_first(text, |v| v.eq(1))
                    }
                    $($in_module)*
                }
                $($outside)*
            },
            "\n```",
        )
    };
}

macro_rules! rejected {
    ($($name:ident $code:literal $in_module:tt $outside:tt)*) => {$(
        #[doc = program!(
            concat!("compile_fail,", $code), "#![forbid(unsafe_code)]", $in_module $outside
        )]
        mod $name {}
    )*};
}

macro_rules! rejected_in_main {
    ($($name:ident $code:literal $body:tt)*) => {
        rejected! { $($name $code {} { fn main() $body })* }
    };
}

macro_rules! rejected_in_module {
    ($($name:ident $code:literal $items:tt)*) => {
        rejected! { $($name $code $items { fn main() {} })* }
    };
}

/// The lint has no code, so these have to compile without it.
macro_rules! rejected_as_unsafe {
    ($($name:ident $in_module:tt $outside:tt)*) => {$(
        #[doc = program!("compile_fail", "#![forbid(unsafe_code)]", $in_module $outside)]
        #[doc = program!("no_run", "", $in_module $outside)]
        mod $name {}
    )*};
}

/// Nor have these errors, so each comes with a neighbor that compiles.
macro_rules! rejected_unlike {
    ($($name:ident $rejected:tt $accepted:tt)*) => {$(
        #[doc = program!("compile_fail", "#![forbid(unsafe_code)]", {} { fn main() $rejected })]
        #[doc = program!("no_run", "#![forbid(unsafe_code)]", {} { fn main() $accepted })]
        mod $name {}
    )*};
}

macro_rules! harmless {
    ($($name:ident $in_module:tt $outside:tt)*) => {$(
        #[doc = program!("", "#![forbid(unsafe_code)]", $in_module $outside)]
        mod $name {}
    )*};
}

rejected_in_main! {
    op "E0133" { bun_simd::avx2::U8::zero(); }
    op_of_the_baseline "E0133" { bun_simd::sse4::U8::zero(); }
    kernel "E0133" { simd::avx2::k(b""); }
    kernel_as_pointer "E0308" { let f: F = simd::avx2::k; }
    kernel_cast_to_pointer "E0605" { let f = simd::avx2::k as F; }
    kernel_as_impl_fn "E0277" {
        fn call(f: impl Fn(&[u8]) -> usize) {}
        call(simd::avx2::k);
    }
    kernel_as_dyn_fn "E0277" { let f: &dyn Fn(&[u8]) -> usize = &simd::avx2::k; }
    kernel_in_static "E0308" { static K: F = simd::avx2::k; }
    kernel_through_closure "E0133" { let f: F = |t| simd::avx2::k(t); }
    helper_outside_the_module "E0133" {
        fn helper(v: bun_simd::avx2::U8) -> bun_simd::avx2::U8 { v.lookup(v) }
    }

    avx512_behind_the_gate_of_avx2 "E0308" { if_supported!(avx2, F, simd::avx512_skx::k); }
    ice_lake_behind_the_gate_of_skylake "E0308" {
        if_supported!(avx512_skx, F, simd::avx512_icl::k);
    }
    static_mut_as_kernel "E0133" {
        static mut K: usize = 0;
        if_supported!(sse4, usize, K);
    }
    target_feature_replaced "E0659" {
        use bun_simd::foreach_width as target_feature;
        if_supported!(sse4, F, simd::avx2::k);
    }
    inline_replaced "E0659" {
        use bun_simd::foreach_width as inline;
        if_supported!(sse4, F, simd::avx2::k);
    }
    feature_that_does_not_exist "E0080" {
        const X: bun_simd::Features = bun_simd::Features::named(&["avx9"]);
    }
    detected_features_overwritten "E0433" { bun_simd_trusted::detected::CACHE.store(!0, todo!()); }

    kernel_in_atomic_fn "E0308" { static K: AtomicFn<F> = AtomicFn::new(simd::avx2::k); }
    number_in_atomic_fn "E0277" { static K: AtomicFn<usize> = AtomicFn::new(1); }
    atomic_fn_that_takes_less "E0308" {
        static K: AtomicFn<F> = AtomicFn::new(|t| t.len());
        let k: &AtomicFn<fn(&'static [u8]) -> usize> = &K;
    }
    unsafe_fn_taken_out_as_safe "E0308" {
        let f: F = AtomicFn::<unsafe fn(&[u8]) -> usize>::new(simd::avx2::k).get();
    }

    shared_load "E0133" { shared::load32::<1, 0>(&[[const { AtomicU8::new(0) }; 32]]); }
    shared_load_past_the_group "E0080" {
        shared::load8::<1, 1>(&[[const { AtomicU8::new(0) }; 8]]);
    }
    shared_store_past_the_group "E0080" {
        shared::store8::<1, 1>(1, &[[const { AtomicU8::new(0) }; 8]]);
    }
    shared_load_of_too_few_bytes "E0308" {
        shared::load8::<1, 0>(&[[const { AtomicU8::new(0) }; 7]]);
    }
    shared_store_to_plain_bytes "E0308" { shared::store8::<1, 0>(1, &[[0u8; 8]]); }
    shared_store_to_wider_atomics "E0308" {
        shared::store8::<1, 0>(1, &[[core::sync::atomic::AtomicU64::new(0)]]);
    }

    lane_of_ones_own "E0277" {
        #[derive(Clone, Copy, PartialEq)]
        struct B(bool);
        impl bun_simd::Lane for B {}
    }
}

rejected_in_module! {
    avx512_op_in_every_copy "E0133" { fn f() { bun_simd::avx512_skx::U8::zero(); } }
    avx512_intrinsic_in_every_copy "E0133" {
        fn f() { core::arch::x86_64::_mm512_setzero_si512(); }
    }
    avx512_shared_load_in_every_copy "E0133" {
        fn f(a: &[[AtomicU8; 64]; 1]) { shared::load64::<1, 0>(a); }
    }
    load_through_pointer "E0133" {
        fn f(p: *const core::arch::x86_64::__m128i) { core::arch::x86_64::_mm_loadu_si128(p); }
    }
    static_next_to_kernel "E0308" { pub static K: F = k; }
    static_in_kernel "E0308" { fn f() { static K: F = k; } }
    const_in_kernel "E0308" { fn f() { const K: F = k; } }
    associated_const_in_kernel "E0308" {
        pub struct S;
        fn f() { impl S { pub const K: F = k; } }
    }
    const_fn_goes_without_features "E0308" { pub const fn f() -> F { k } }
    closure_in_static_in_kernel "E0133" { fn f() { static K: F = |t| k(t); } }
    closure_in_array_length "E0133" { pub fn f(_: [u8; { let g: F = |t| k(t); 0 }]) {} }
    thread_local_in_kernel "E0308" { fn f() { thread_local!(static K: F = const { k }); } }
    vector_of_the_wrong_size "E0277" { fn f(a: &[u8; 15]) { isa::U8::load(a); } }
    trait_method "E0053" {
        pub struct S;
        impl Default for S { fn default() -> S { S } }
    }
    destructor "E0053" {
        pub struct S;
        impl Drop for S { fn drop(&mut self) {} }
    }
}

rejected_as_unsafe! {
    unsafe_in_kernel { fn f(p: *const u8) -> u8 { unsafe { *p } } } { fn main() {} }
    unsafe_in_inlined_helper {
        #[inline(always)]
        fn f(p: *const u8) -> u8 { unsafe { *p } }
    } { fn main() {} }
    unsafe_in_type {} {
        const Z: [u8; 0] = [];
        fn main() { if_supported!(sse4, [u8; unsafe { 0 }], Z); }
    }
}

rejected_unlike! {
    gate_that_does_not_exist
        { if_supported!(avx3, F, simd::sse4::k); }
        { if_supported!(avx2, F, simd::sse4::k); }
    vector_in_a_register_that_plain_code_lacks {
        extern "C" fn f(v: bun_simd::avx2::U8) {}
        core::hint::black_box(f as extern "C" fn(_));
    } {
        extern "C" fn f(v: bun_simd::sse4::U8) {}
        core::hint::black_box(f as extern "C" fn(_));
    }
}

harmless! {
    nothing_wrong {} { fn main() { assert_eq!(simd::k(&[0, 0, 1]), 2); } }
    cfg_replaced {} {
        macro_rules! cfg { ($($t:tt)*) => { panic!() }; }
        fn main() { if_supported!(avx2, F, simd::avx2::k); }
    }
    then_replaced {} {
        trait T { fn then<R>(self, f: impl FnOnce() -> R) -> Option<R>; }
        impl T for bool { fn then<R>(self, f: impl FnOnce() -> R) -> Option<R> { panic!() } }
        fn main() { if_supported!(avx2, F, simd::avx2::k); }
    }
    crates_replaced {} {
        mod core {}
        mod std {}
        mod bun_simd_trusted {}
        fn main() { if_supported!(avx2, F, simd::avx2::k); }
    }
    pick_replaced {} {
        fn pick() -> F { panic!() }
        fn main() {
            let pick = || -> F { panic!() };
            if_supported!(sse4, F, simd::sse4::k);
        }
    }
    operators_in_plain_code {
        #[export]
        pub fn twice(text: &[u8; 64]) -> u8 { plain(isa::U8::load_from(text)).lanes()[3] }
    } {
        #[inline(never)]
        fn plain<V: Copy + core::ops::Add<V, Output = V>>(v: V) -> V { v + v }
        fn main() { assert_eq!(simd::twice(&[21; 64]), 42); }
    }
    decoded_features_are_only_a_value {} {
        fn main() {
            let before = bun_simd::detected().names().count();
            ::bun_simd_trusted::x86_64::decode(|_, _| [!0; 4], !0);
            assert_eq!(bun_simd::detected().names().count(), before);
        }
    }
    limit_above_the_cpu {} {
        fn main() {
            bun_simd::limit_to(bun_simd::Target::avx512_icl);
            assert_eq!(simd::k(&[0, 1]), 1);
        }
    }
}
