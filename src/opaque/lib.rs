//! Single-macro crate for the Nomicon "opaque extern type" pattern.
//!
//! Every C/C++ handle type that Rust only ever observes by pointer wants the
//! same body:
//!
//! ```ignore
//! #[repr(C)]
//! pub struct Foo {
//!     _p: ::core::cell::UnsafeCell<[u8; 0]>,
//!     _m: ::core::marker::PhantomData<(*mut u8, ::core::marker::PhantomPinned)>,
//! }
//! ```
//!
//! which buys, in one shot:
//!
//! * `UnsafeCell<[u8; 0]>` → the type is **`!Freeze`**, so a `&Foo` does
//!   *not* assert immutability of the (foreign-owned) pointee. The C side
//!   routinely mutates through both `const T*` and `T*`; without `UnsafeCell`,
//!   deriving a `*mut` from `&Foo` and letting FFI write through it is UB
//!   under Stacked Borrows. It also drops the `readonly`/`noalias` LLVM
//!   attributes from `&Foo` parameters, so the reference is ABI-identical to
//!   a bare non-null pointer — letting `extern "C"` shims that take only the
//!   handle (plus value types) be declared `safe fn`.
//! * `PhantomData<*mut u8>` → **`!Send` + `!Sync`** by default. Callers that
//!   know the foreign object is thread-safe opt back in with an explicit
//!   `unsafe impl Send/Sync for Foo {}` next to the macro call.
//! * `PhantomPinned` → **`!Unpin`**: the foreign object's address is its
//!   identity; it must never be moved by Rust.
//! * `[u8; 0]` → zero-sized, align-1, so `&Foo` carries no
//!   `dereferenceable(N)` obligation (N = 0) and a non-null `*mut Foo` is
//!   always valid to reborrow.
//!
//! Before this crate existed the body above was hand-typed ~180 times across
//! ~100 files (plus three crate-local `macro_rules! opaque!` copies in
//! `boringssl_sys`, `uws_sys`, and `uws`). [`opaque_ffi!`] is the single
//! source of truth.
#![no_std]

/// Declare one or more opaque FFI handle types. See the [crate] docs for the
/// auto-trait / ABI rationale.
///
/// ```ignore
/// bun_opaque::opaque_ffi! {
///     /// `struct ssl_st` (`typedef ... SSL`).
///     pub struct SSL;
///     pub(crate) struct BIO;
/// }
/// ```
///
/// The generated `_p` field is reachable from the call-site module, so
/// `self._p.get()` can be used to derive an interior-mut `*mut Self` from
/// `&self` (see `bun_alloc::Zone::as_mut_ptr`).
#[macro_export]
macro_rules! opaque_ffi {
    // `pub struct Name;` form — preferred (reads like the decl it replaces).
    ($( $(#[$m:meta])* $v:vis struct $name:ident; )+) => {$(
        $(#[$m])*
        #[repr(C)]
        $v struct $name {
            _p: ::core::cell::UnsafeCell<[u8; 0]>,
            _m: ::core::marker::PhantomData<(*mut u8, ::core::marker::PhantomPinned)>,
        }
    )+};
    // Comma-list `pub Name, pub(super) Name2` form — kept for the
    // `bun_core::opaque_extern!` re-export and the boringssl_sys wrapper.
    ($( $(#[$m:meta])* $v:vis $name:ident ),+ $(,)?) => {
        $crate::opaque_ffi! { $( $(#[$m])* $v struct $name; )+ }
    };
}
