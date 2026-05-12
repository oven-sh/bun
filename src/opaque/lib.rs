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
/// Every generated type gets an `as_mut_ptr(&self) -> *mut Self` accessor that
/// derives an interior-mutable FFI pointer from a shared borrow; prefer it over
/// reaching into `_p` directly.
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
        impl $name {
            /// Safe `*const Self → &Self` for an opaque ZST handle. See
            /// [`bun_opaque::opaque_deref`](crate::opaque_deref) for the
            /// soundness proof; panics on null.
            #[inline(always)]
            #[allow(dead_code)]
            pub fn opaque_ref<'a>(p: *const Self) -> &'a Self {
                $crate::opaque_deref(p)
            }
            /// Unchecked `*const Self → &Self` for an opaque ZST handle on a
            /// hot path where the caller guarantees non-null (e.g. JSC host-fn
            /// entry points). See [`bun_opaque::opaque_deref_nn`].
            ///
            /// # Safety
            /// `p` must be non-null.
            #[inline(always)]
            #[allow(dead_code)]
            pub unsafe fn opaque_ref_nn<'a>(p: *const Self) -> &'a Self {
                // SAFETY: forwarded to caller.
                unsafe { $crate::opaque_deref_nn(p) }
            }
            /// Safe `*mut Self → &mut Self` for an opaque ZST handle. See
            /// [`bun_opaque::opaque_deref_mut`](crate::opaque_deref_mut) for
            /// the soundness proof; panics on null.
            #[inline(always)]
            #[allow(dead_code)]
            pub fn opaque_mut<'a>(p: *mut Self) -> &'a mut Self {
                $crate::opaque_deref_mut(p)
            }
            /// Unchecked `*mut Self → &mut Self`. See [`opaque_ref_nn`].
            ///
            /// # Safety
            /// `p` must be non-null.
            #[inline(always)]
            #[allow(dead_code)]
            pub unsafe fn opaque_mut_nn<'a>(p: *mut Self) -> &'a mut Self {
                // SAFETY: forwarded to caller.
                unsafe { $crate::opaque_deref_mut_nn(p) }
            }
            /// `&self → *mut Self` for FFI calls that take a non-const handle.
            ///
            /// Sound because `_p: UnsafeCell<_>` sits at offset 0 of this
            /// `#[repr(C)]` ZST, so `UnsafeCell::get()` yields `self`'s own
            /// address with **write** provenance from a shared borrow — the
            /// sanctioned interior-mutability route, vs. the UB-under-Stacked-
            /// Borrows `&T as *const T as *mut T` cast. The C/C++ side may
            /// freely mutate the real allocation through the returned pointer;
            /// `&Self` covers zero Rust-visible bytes so cannot alias it.
            #[inline(always)]
            #[allow(dead_code)]
            pub fn as_mut_ptr(&self) -> *mut Self {
                self._p.get().cast::<Self>()
            }
        }
    )+};
    // Comma-list `pub Name, pub(super) Name2` form — kept for the
    // `bun_core::opaque_extern!` re-export and the boringssl_sys wrapper.
    ($( $(#[$m:meta])* $v:vis $name:ident ),+ $(,)?) => {
        $crate::opaque_ffi! { $( $(#[$m])* $v struct $name; )+ }
    };
}

// ───────────────────────────────────────────────────────────────────────────
// FFI layout assertions
// ───────────────────────────────────────────────────────────────────────────

/// Marker: `Self` is passed across `extern "C"` by value (or embedded in a
/// type that is) and its Rust layout has been **statically verified** against
/// the foreign side's `sizeof`/`alignof`. Implemented only via
/// [`assert_ffi_layout!`]; never `impl` by hand.
///
/// Generic FFI helpers may bound on `T: FfiLayout` to refuse unaudited types
/// at the *call* site, not just the *decl* site.
///
/// # Safety
/// Implementing this trait asserts that `size_of::<Self>() == C_SIZE` and
/// `align_of::<Self>() == C_ALIGN`, and that those constants match the C/C++
/// declaration `Self` is paired with. The only sound way to discharge this
/// obligation is via [`assert_ffi_layout!`], which `const`-asserts both.
pub unsafe trait FfiLayout {
    /// `sizeof(T)` on the C/C++ side. Equals `size_of::<Self>()` (asserted).
    const C_SIZE: usize;
    /// `alignof(T)` on the C/C++ side. Equals `align_of::<Self>()` (asserted).
    const C_ALIGN: usize;
}

/// Compile-time-fail if `size_of::<$T>() != $size` or
/// `align_of::<$T>() != $align`. Also implements [`FfiLayout`] for `$T`, so
/// the assertion is the *only* way to acquire the marker.
///
/// ```ignore
/// // Mirrors C++: static_assert(sizeof(BunString) == 24 && alignof == 8)
/// bun_opaque::assert_ffi_layout!(BunString, 24, 8);
///
/// // With per-field offset checks (catches field-order swaps that preserve
/// // total size — e.g. ParseTask.rs BunLogOptions level/line swap):
/// bun_opaque::assert_ffi_layout!(BunLogOptions, 80, 8; level @ 56, line @ 60);
///
/// // Cross-checked against a bindgen'd / codegen'd mirror struct instead of
/// // a literal — preferred when one exists:
/// bun_opaque::assert_ffi_layout!(OnBeforeParseArguments = bun_sys::c::OnBeforeParseArguments);
/// ```
///
/// The error message embeds both expected and actual values via
/// `concat!`/`stringify!` so a drift shows *what* changed, not just "false".
#[macro_export]
macro_rules! assert_ffi_layout {
    // literal size, align
    ($T:ty, $size:expr, $align:expr $(; $($field:ident @ $off:expr),+ $(,)?)?) => {
        const _: () = {
            ::core::assert!(
                ::core::mem::size_of::<$T>() == $size,
                concat!(
                    "FFI layout: size_of::<", stringify!($T), ">() != ", stringify!($size),
                    " — Rust struct drifted from C/C++ declaration"
                ),
            );
            ::core::assert!(
                ::core::mem::align_of::<$T>() == $align,
                concat!("FFI layout: align_of::<", stringify!($T), ">() != ", stringify!($align)),
            );
            $($(
                ::core::assert!(
                    ::core::mem::offset_of!($T, $field) == $off,
                    concat!(
                        "FFI layout: offset_of!(", stringify!($T), ", ",
                        stringify!($field), ") != ", stringify!($off)
                    ),
                );
            )+)?
        };
        // SAFETY: the const-asserts above are the proof obligation.
        unsafe impl $crate::FfiLayout for $T {
            const C_SIZE: usize = $size;
            const C_ALIGN: usize = $align;
        }
    };
    // mirror-type form: assert against a bindgen'd C struct
    ($T:ty = $Mirror:ty $(; $($field:ident),+ $(,)?)?) => {
        $crate::assert_ffi_layout!(
            $T,
            ::core::mem::size_of::<$Mirror>(),
            ::core::mem::align_of::<$Mirror>()
            $(; $($field @ ::core::mem::offset_of!($Mirror, $field)),+)?
        );
    };
}

/// Compile-time-fail if a `#[repr(<int>)]` enum's discriminant type is not the
/// width the C side expects. Catches `#[repr(u8)]` ↔ C `int` mismatches.
///
/// ```ignore
/// bun_opaque::assert_ffi_discr!(BufferEncodingType, u8);   // C++ is `enum class : uint8_t`
/// bun_opaque::assert_ffi_discr!(BunPluginTarget, u8; Bun = 0, Node = 1, Browser = 2);
/// ```
#[macro_export]
macro_rules! assert_ffi_discr {
    ($T:ty, $int:ty $(; $($var:ident = $val:expr),+ $(,)?)?) => {
        const _: () = {
            ::core::assert!(
                ::core::mem::size_of::<$T>() == ::core::mem::size_of::<$int>(),
                concat!(
                    "FFI discriminant: size_of::<", stringify!($T),
                    ">() != size_of::<", stringify!($int), ">()"
                ),
            );
            ::core::assert!(
                ::core::mem::align_of::<$T>() == ::core::mem::align_of::<$int>(),
                concat!(
                    "FFI discriminant: align_of::<", stringify!($T),
                    ">() != align_of::<", stringify!($int), ">()"
                ),
            );
            $($(
                ::core::assert!(
                    <$T>::$var as $int == $val,
                    concat!(
                        "FFI discriminant: ", stringify!($T), "::",
                        stringify!($var), " != ", stringify!($val)
                    ),
                );
            )+)?
        };
    };
}

/// Safe `*const T → &T` for a `#[repr(C)]` zero-sized, align-1 opaque FFI
/// handle (the body emitted by [`opaque_ffi!`]).
///
/// Soundness: a ZST occupies zero bytes, so dereferencing reads/writes
/// nothing — `dereferenceable(0)` is satisfied by **any** non-null, well-
/// aligned address, and align-1 makes every address well-aligned. The
/// `UnsafeCell<[u8; 0]>` body makes the type `!Freeze`, so `&T` carries no
/// `readonly`/`noalias` and the C/C++ owner may freely mutate the real object
/// behind the pointer without violating Rust's aliasing model. The only
/// remaining validity invariant for a reference is *non-null*, which is
/// `assert!`ed (not `debug_assert!`ed — this is a safe fn reachable from safe
/// code with arbitrary raw pointers, so null must panic, never UB).
///
/// Both the ZST and align-1 requirements are enforced at *compile time* via
/// `const { assert! }`, so a non-opaque `T` is a build error at the
/// monomorphisation site rather than runtime UB.
///
/// This is the single audited `unsafe` that backs every
/// `Type::opaque_ref(ptr)` call generated by the macro (S008).
///
/// Hot paths where the foreign caller contractually guarantees non-null (JSC
/// host-fn thunks, `.classes.ts`-generated trampolines) should use
/// [`opaque_deref_nn`] instead to elide the release-mode `testq; je <panic>`.
#[inline(always)]
pub fn opaque_deref<'a, T>(p: *const T) -> &'a T {
    assert!(!p.is_null(), "opaque_deref: null FFI handle");
    // SAFETY: non-null asserted above.
    unsafe { opaque_deref_nn(p) }
}

/// Unchecked `*const T → &T` for a `#[repr(C)]` zero-sized, align-1 opaque FFI
/// handle. Identical to [`opaque_deref`] minus the release-mode null check
/// (kept as `debug_assert!`). For hot FFI entry points where the C/C++ caller
/// is known never to pass null — e.g. `JSC::JSGlobalObject*` / `JSC::CallFrame*`
/// in host-function thunks, which JSC populates unconditionally — and the
/// per-call `testq %reg; je <panic>` shows up in profiles.
///
/// # Safety
/// `p` must be non-null. (Align-1 ZST means that is the *only* validity
/// requirement; see [`opaque_deref`] for the full proof.)
#[inline(always)]
pub unsafe fn opaque_deref_nn<'a, T>(p: *const T) -> &'a T {
    const {
        assert!(
            ::core::mem::size_of::<T>() == 0,
            "opaque_deref: T must be a ZST"
        )
    };
    const {
        assert!(
            ::core::mem::align_of::<T>() == 1,
            "opaque_deref: T must be align-1"
        )
    };
    debug_assert!(!p.is_null(), "opaque_deref_nn: null FFI handle");
    // SAFETY: per the const-asserts above `T` is size-0 align-1, so any
    // non-null `p` (caller precondition, debug-asserted) is dereferenceable
    // for zero bytes and the resulting `&T` covers no memory → cannot alias
    // any Rust-visible bytes.
    unsafe { &*p }
}

/// Safe `*mut T → &mut T` for a `#[repr(C)]` zero-sized, align-1 opaque FFI
/// handle. See [`opaque_deref`] for the full soundness argument; the `&mut`
/// case additionally relies on the ZST property to discharge `noalias` (a
/// mutable borrow of zero bytes cannot overlap any other borrow).
#[inline(always)]
pub fn opaque_deref_mut<'a, T>(p: *mut T) -> &'a mut T {
    assert!(!p.is_null(), "opaque_deref_mut: null FFI handle");
    // SAFETY: non-null asserted above.
    unsafe { opaque_deref_mut_nn(p) }
}

/// Unchecked `*mut T → &mut T`. See [`opaque_deref_nn`] / [`opaque_deref_mut`].
///
/// # Safety
/// `p` must be non-null.
#[inline(always)]
pub unsafe fn opaque_deref_mut_nn<'a, T>(p: *mut T) -> &'a mut T {
    const {
        assert!(
            ::core::mem::size_of::<T>() == 0,
            "opaque_deref_mut: T must be a ZST"
        )
    };
    const {
        assert!(
            ::core::mem::align_of::<T>() == 1,
            "opaque_deref_mut: T must be align-1"
        )
    };
    debug_assert!(!p.is_null(), "opaque_deref_mut_nn: null FFI handle");
    // SAFETY: see `opaque_deref_nn`; zero-byte `&mut` cannot alias.
    unsafe { &mut *p }
}

/// `core`-only FFI slice/string primitives shared between `bun_core::ffi` and
/// the freestanding `bun_shim_impl` PE. Lives here (not `bun_core`) because
/// `bun_core` carries `#[no_mangle]` C-ABI exports that become unsatisfiable
/// link roots in a `#![no_std]`/`no_main` binary; this crate has none. Mirrors
/// Zig `std.mem.{len,span}` / `bun.sliceTo`, which both consumers re-spelled
/// verbatim before this single audited copy existed.
pub mod ffi {
    /// `std.mem.len` for `[*:0]const u16` — count u16 code units up to (and
    /// excluding) the first NUL. Single audited funnel for the hand-rolled
    /// `while *p.add(n) != 0 { n += 1 }` loop that appeared at every
    /// `LPCWSTR` / `char16_t*` ingestion point (Windows path APIs, N-API
    /// `napi_create_string_utf16`, libarchive `_w` accessors, env-block
    /// scan). Adds a `debug_assert!(!p.is_null())` — same precondition as
    /// `CStr::from_ptr` and Zig `std.mem.len([*:0]const u16)`.
    ///
    /// # Safety
    /// `p` must be non-null and point to a NUL-terminated u16 sequence
    /// readable up to and including the terminator.
    #[inline(always)]
    pub unsafe fn wcslen(p: *const u16) -> usize {
        debug_assert!(!p.is_null(), "ffi::wcslen: null pointer");
        let mut n = 0usize;
        // SAFETY: caller contract — non-null, NUL-terminated.
        while unsafe { *p.add(n) } != 0 {
            n += 1;
        }
        n
    }

    /// UTF-16 analogue of `cstr_bytes`: scan to NUL and borrow the code units
    /// as a `&[u16]`. Dominant shape at call sites (Zig
    /// `std.mem.span([*:0]const u16)` port).
    ///
    /// # Safety
    /// Same contract as [`wcslen`]; the returned borrow must not outlive the
    /// allocation backing `p`.
    #[inline(always)]
    pub unsafe fn wstr_units<'a>(p: *const u16) -> &'a [u16] {
        // SAFETY: forwarded to `wcslen`; `p[..len]` is readable per contract.
        unsafe { core::slice::from_raw_parts(p, wcslen(p)) }
    }

    /// Assemble `&[T]` from a raw `(ptr, len)` pair handed across the FFI
    /// boundary (C++ out-params, `extern "C"` callback args, `#[repr(C)]`
    /// struct fields). Unlike a bare `from_raw_parts`, tolerates the C
    /// convention of `(null, 0)` for an empty slice (Rust requires a
    /// non-null, aligned pointer even at `len == 0`).
    ///
    /// Prefer bare `core::slice::from_raw_parts` at hot sites where `ptr` is
    /// provably non-null (pointer-arith from `&self`, `NonNull::as_ptr()`).
    ///
    /// # Safety
    /// Callers must still wrap the call in `unsafe` and uphold the
    /// `from_raw_parts` contract: when `len > 0`, `ptr` must be non-null,
    /// aligned, and point to `len` initialized `T` valid for `'a`. `ptr` may
    /// be null only when `len == 0`.
    #[inline(always)]
    pub const unsafe fn slice<'a, T>(ptr: *const T, len: usize) -> &'a [T] {
        if ptr.is_null() {
            // Hard assert: a `(null, N>0)` pair was UB under bare
            // `from_raw_parts`; silently returning `&[]` here would mask the
            // contract violation in release and let callers iterate 0 times
            // when they expect N. Fail loudly instead.
            assert!(len == 0, "ffi::slice: null ptr with non-zero len");
            &[]
        } else {
            // SAFETY: caller contract above.
            unsafe { core::slice::from_raw_parts(ptr, len) }
        }
    }

    /// Mutable counterpart of [`slice`]. Same null-at-zero tolerance.
    ///
    /// # Safety
    /// Same as [`slice`], plus the caller must guarantee no other `&`/`&mut`
    /// to the range is live for `'a`.
    #[inline(always)]
    pub const unsafe fn slice_mut<'a, T>(ptr: *mut T, len: usize) -> &'a mut [T] {
        if ptr.is_null() {
            assert!(len == 0, "ffi::slice_mut: null ptr with non-zero len");
            &mut []
        } else {
            // SAFETY: caller contract above.
            unsafe { core::slice::from_raw_parts_mut(ptr, len) }
        }
    }
}
