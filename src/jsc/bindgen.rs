use core::ffi::c_uint;
use core::marker::PhantomData;
use core::mem::{ManuallyDrop, align_of, size_of};
use core::ptr::NonNull;

use crate::{self as jsc, Strong};
use bun_core::{WTFString, WTFStringImplStruct};
use bun_ptr::{ExternalShared, ExternalSharedDescriptor, ExternalSharedOptional};

// `BindgenArray::convert_from_extern` reuses C++-allocated buffers by adopting
// them into `Vec<ZigType>` even when `align_of::<ZigType>() != align_of::<ExternType>()`.
// That is only sound because mimalloc's `mi_free` ignores the allocation layout;
// the Rust `GlobalAlloc::dealloc` contract would otherwise be violated. The C++ side
// (`ExternVectorTraits.h`) always allocates with `mi_malloc`, so when the global
// allocator is not mimalloc the reuse path is skipped and the fallback frees the
// C++ buffer with `mi_free` directly.

// ──────────────────────────────────────────────────────────────────────────
// A `Bindgen` adapter supplies associated `ZigType`/`ExternType` plus
// `convert_from_extern`; a bespoke optional representation is a separate
// trait that a `Child` may opt into.
// ──────────────────────────────────────────────────────────────────────────

pub trait Bindgen {
    type ZigType;
    type ExternType;

    /// `true` when `ZigType` and `ExternType` are layout-identical.
    /// Enables `BindgenArray`'s
    /// allocation-reuse fast path. Defaults to `false`; override per adapter.
    const SAME_REPR: bool = false;

    fn convert_from_extern(extern_value: Self::ExternType) -> Self::ZigType;
}

/// Implemented by `Bindgen` types that have a bespoke "optional" representation
/// (e.g. a nullable pointer) instead of the default `ExternTaggedUnion` wrapper.
pub trait BindgenOptionalRepr: Bindgen {
    type OptionalZigType;
    type OptionalExternType;

    fn convert_optional_from_extern(
        extern_value: Self::OptionalExternType,
    ) -> Self::OptionalZigType;
}

// ──────────────────────────────────────────────────────────────────────────

pub struct BindgenTrivial<T>(PhantomData<T>);

impl<T> Bindgen for BindgenTrivial<T> {
    type ZigType = T;
    type ExternType = T;
    const SAME_REPR: bool = true;

    fn convert_from_extern(extern_value: Self::ExternType) -> Self::ZigType {
        extern_value
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub struct BindgenStrongAny;

impl Bindgen for BindgenStrongAny {
    type ZigType = Strong;
    // `?*jsc.Strong.Impl` — must be single-word for #[repr(C)] union placement, so
    // `Option<NonNull<T>>` (niche-optimized), NOT `Option<*mut T>` (two words).
    type ExternType = Option<NonNull<jsc::strong::Impl>>;

    fn convert_from_extern(extern_value: Self::ExternType) -> Self::ZigType {
        // SAFETY: bindgen contract — C++ passes a freshly-allocated Strong handle
        // whose ownership is transferred to Rust here.
        unsafe { Strong::adopt(extern_value.expect("non-null")) }
    }
}

impl BindgenOptionalRepr for BindgenStrongAny {
    type OptionalZigType = jsc::strong::Optional;
    type OptionalExternType = <Self as Bindgen>::ExternType;

    fn convert_optional_from_extern(
        extern_value: Self::OptionalExternType,
    ) -> Self::OptionalZigType {
        // SAFETY: bindgen contract — if non-null, ownership is transferred.
        unsafe { jsc::strong::Optional::adopt(extern_value) }
    }
}

// ──────────────────────────────────────────────────────────────────────────

/// This represents both `IDLNull` and `IDLMonostateUndefined`.
pub struct BindgenNull;

impl Bindgen for BindgenNull {
    type ZigType = ();
    type ExternType = u8;

    fn convert_from_extern(extern_value: Self::ExternType) -> Self::ZigType {
        let _ = extern_value;
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub struct BindgenOptional<Child>(PhantomData<Child>);

// Default path: `Child` does NOT define a custom optional repr — wrap in
// `ExternTaggedUnion<(u8, Child::ExternType)>` and produce `Option<Child::ZigType>`.
//
// Stable Rust cannot specialize on "does Child impl BindgenOptionalRepr",
// so the bindgen codegen emits `BindgenOptional<Child>` vs
// `BindgenOptionalCustom<Child>` explicitly per call site.
impl<Child: Bindgen> Bindgen for BindgenOptional<Child> {
    type ZigType = Option<Child::ZigType>;
    type ExternType = ExternTaggedUnion2<u8, Child::ExternType>;

    fn convert_from_extern(extern_value: Self::ExternType) -> Self::ZigType {
        if extern_value.tag == 0 {
            return None;
        }
        debug_assert_eq!(extern_value.tag, 1);
        // SAFETY: tag == 1 means the `_1` arm of the union is initialized.
        Some(Child::convert_from_extern(unsafe {
            ManuallyDrop::into_inner(extern_value.data._1)
        }))
    }
}

/// Explicit wrapper for children that DO define a custom optional repr.
pub struct BindgenOptionalCustom<Child>(PhantomData<Child>);

impl<Child: BindgenOptionalRepr> Bindgen for BindgenOptionalCustom<Child> {
    type ZigType = Child::OptionalZigType;
    type ExternType = Child::OptionalExternType;

    fn convert_from_extern(extern_value: Self::ExternType) -> Self::ZigType {
        Child::convert_optional_from_extern(extern_value)
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub struct BindgenString;

impl Bindgen for BindgenString {
    type ZigType = WTFString;
    // `?bun.string.WTFStringImpl` — `Option<NonNull<_>>` for single-word FFI layout.
    type ExternType = Option<NonNull<WTFStringImplStruct>>;

    fn convert_from_extern(extern_value: Self::ExternType) -> Self::ZigType {
        // SAFETY: bindgen contract — C++ passes a `StringImpl*` with one ref already
        // taken for us; `adopt` consumes that ref.
        unsafe { WTFString::adopt(extern_value.expect("non-null").as_ptr()) }
    }
}

impl BindgenOptionalRepr for BindgenString {
    type OptionalZigType = ExternalSharedOptional<WTFStringImplStruct>;
    type OptionalExternType = <Self as Bindgen>::ExternType;

    fn convert_optional_from_extern(
        extern_value: Self::OptionalExternType,
    ) -> Self::OptionalZigType {
        // SAFETY: bindgen contract — if non-null, one ref is transferred.
        unsafe {
            ExternalSharedOptional::adopt(
                extern_value.map_or(core::ptr::null_mut(), |p| p.as_ptr()),
            )
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// BindgenUnion / ExternTaggedUnion / ExternUnion
//
// These are generated per arity (or by a proc-macro from the bindgen codegen).
// ──────────────────────────────────────────────────────────────────────────

// The bindgen TS codegen emits a concrete `enum` + `#[repr(C)]` union pair
// per call site rather than a generic Rust combinator (see
// `src/jsc/generated.rs`). This marker type exists for documentation parity.

/// `extern struct { data: ExternUnion(field_types), tag: u8 }`
///
/// We provide fixed-arity instantiations; the 2-ary case is the only
/// one used directly in this file (by `BindgenOptional`). Higher arities are
/// emitted by codegen alongside their consumers.
#[repr(C)]
pub struct ExternTaggedUnion2<T0, T1> {
    pub data: ExternUnion2<T0, T1>,
    pub tag: u8,
}

/// Union fields are wrapped in `ManuallyDrop` so non-`Copy` payloads
/// (e.g. nested `ExternTaggedUnion2`, `ExternArrayList`) are permitted without
/// trait bounds. There is no auto-drop — the active arm must be dropped
/// explicitly by whoever knows the tag.
#[repr(C)]
pub union ExternUnion2<T0, T1> {
    pub _0: ManuallyDrop<T0>,
    pub _1: ManuallyDrop<T1>,
}

// ──────────────────────────────────────────────────────────────────────────

pub struct BindgenArray<Child>(PhantomData<Child>);

impl<Child: Bindgen> Bindgen for BindgenArray<Child> {
    type ZigType = bun_collections::ArrayListDefault<Child::ZigType>;
    type ExternType = ExternArrayList<Child::ExternType>;

    fn convert_from_extern(extern_value: Self::ExternType) -> Self::ZigType {
        let length = usize::try_from(extern_value.length).expect("int cast");
        let capacity = usize::try_from(extern_value.capacity).expect("int cast");

        if extern_value.data.is_null() {
            return Self::ZigType::init();
        }
        let data = extern_value.data;
        debug_assert!(
            length <= capacity,
            "length ({}) should not exceed capacity ({})",
            length,
            capacity,
        );
        // SAFETY: C++ side guarantees `data` points to `capacity` elements with
        // `length` initialized; allocation came from mimalloc (when `USE_MIMALLOC`).
        let unmanaged: Vec<Child::ExternType> =
            unsafe { Vec::from_raw_parts(data, length, capacity) };

        if !bun_alloc::USE_MIMALLOC {
            // Don't reuse memory in this case; it would be freed by the wrong allocator.
        } else if size_of::<Child::ZigType>() == size_of::<Child::ExternType>()
            && align_of::<Child::ZigType>() == align_of::<Child::ExternType>()
            // Rust has no stable type-equality test in generic context, so this
            // fast-path is gated on the `const SAME_REPR: bool` opt-in: it only
            // fires when the bindgen codegen has proven layout identity.
            && Child::SAME_REPR
        {
            // The layouts are identical, so the Vec is returned as-is.
            let (ptr, len, cap) = {
                let mut v = ManuallyDrop::new(unmanaged);
                (v.as_mut_ptr(), v.len(), v.capacity())
            };
            // SAFETY: `SAME_REPR` ⇒ same layout; `from_raw_parts` round-trip.
            let reused: Vec<Child::ZigType> =
                unsafe { Vec::from_raw_parts(ptr.cast::<Child::ZigType>(), len, cap) };
            return Self::ZigType::from_unmanaged(reused);
        } else if size_of::<Child::ZigType>() <= size_of::<Child::ExternType>()
            && align_of::<Child::ZigType>() <= bun_alloc::mimalloc::MI_MAX_ALIGN_SIZE
        {
            // We can reuse the allocation, but we still need to convert the elements.
            //
            // Materializing a `&mut [u8]` over the full capacity would assert that
            // every byte — including uninitialized tail elements and `ExternType`
            // padding — is a valid `u8`, which is UB. Work entirely through raw
            // `*mut u8` and `ptr::copy_nonoverlapping` instead; no reference to
            // the storage is ever formed.
            let mut v = ManuallyDrop::new(unmanaged);
            let mut storage_ptr: *mut u8 = v.as_mut_ptr().cast::<u8>();
            let storage_len = v.capacity() * size_of::<Child::ExternType>();

            // Convert the elements.
            for i in 0..length {
                // Byte-wise copy: this is an in-place reinterpretation of
                // overlapping element slots, so each element is copied out
                // before conversion.
                let mut old_elem = core::mem::MaybeUninit::<Child::ExternType>::uninit();
                // SAFETY: source range lies within the mimalloc block and holds a
                // valid (C++-initialized) `ExternType` for `i < length`.
                unsafe {
                    core::ptr::copy_nonoverlapping(
                        storage_ptr.add(i * size_of::<Child::ExternType>()),
                        old_elem.as_mut_ptr().cast::<u8>(),
                        size_of::<Child::ExternType>(),
                    );
                }
                // SAFETY: bytes for element `i` were just copied from initialized storage.
                let new_elem = ManuallyDrop::new(Child::convert_from_extern(unsafe {
                    old_elem.assume_init()
                }));
                // SAFETY: dest range lies within the block; `size_of ZigType <=
                // size_of ExternType` so slot `i` of the new layout never overruns
                // slot `i` of the old layout (and never clobbers slot `i+1`).
                unsafe {
                    core::ptr::copy_nonoverlapping(
                        (&raw const *new_elem).cast::<u8>(),
                        storage_ptr.add(i * size_of::<Child::ZigType>()),
                        size_of::<Child::ZigType>(),
                    );
                }
            }

            let new_size_is_multiple =
                size_of::<Child::ExternType>() % size_of::<Child::ZigType>() == 0;
            let new_capacity = if new_size_is_multiple {
                capacity * (size_of::<Child::ExternType>() / size_of::<Child::ZigType>())
            } else {
                let new_capacity = storage_len / size_of::<Child::ZigType>();
                let new_alloc_size = new_capacity * size_of::<Child::ZigType>();
                if new_alloc_size != storage_len {
                    // Allocation isn't a multiple of `size_of::<Child::ZigType>()`; we have to
                    // resize it.
                    // SAFETY: `storage_ptr` is the original mimalloc block (the
                    // `USE_MIMALLOC` guard above gates entry to this path); shrinking
                    // with `mi_realloc` preserves the prefix bytes.
                    storage_ptr = bun_core::handle_oom(unsafe {
                        bun_alloc::realloc_raw(storage_ptr, new_alloc_size)
                    });
                }
                new_capacity
            };

            let items_ptr = storage_ptr.cast::<Child::ZigType>();
            // SAFETY: `storage_ptr` is aligned to ≥ `MI_MAX_ALIGN_SIZE` ≥
            // `align_of::<ZigType>()`; the first `length` slots were just written
            // with valid `ZigType` values; the block is mimalloc-owned and the
            // global allocator is mimalloc (the `if !bun_alloc::USE_MIMALLOC`
            // guard above gates entry to this path), so `Vec`'s eventual dealloc
            // — even with `ZigType`'s layout — routes to `mi_free`, which
            // ignores layout.
            let new_unmanaged: Vec<Child::ZigType> =
                unsafe { Vec::from_raw_parts(items_ptr, length, new_capacity) };
            return Self::ZigType::from_unmanaged(new_unmanaged);
        }

        // Fallback: allocate fresh, convert, free old. `data` was `mi_malloc`'d
        // by the C++ side regardless of the Rust global allocator, so free it
        // with `mi_free` directly instead of `Vec::drop`.
        let mut result = bun_core::handle_oom(Self::ZigType::init_capacity(length));
        let mut unmanaged = ManuallyDrop::new(unmanaged);
        for item in unmanaged.iter_mut() {
            // SAFETY: each slot holds a C++-initialized `ExternType`; `ManuallyDrop` ensures it isn't read twice.
            result.append_assume_capacity(Child::convert_from_extern(unsafe {
                core::ptr::read(item)
            }));
        }
        // SAFETY: `data` is the live `mi_malloc`'d block from `ExternVectorTraits::convertToExtern`.
        unsafe { bun_alloc::mimalloc::mi_free(data.cast()) };
        result
    }
}

#[repr(C)]
pub struct ExternArrayList<Child> {
    // Single-word nullable pointer. `Option<*mut T>` has no niche
    // (two words) and would break the C ABI; use raw `*mut T` and check `.is_null()`.
    pub data: *mut Child,
    pub length: c_uint,
    pub capacity: c_uint,
}

// ──────────────────────────────────────────────────────────────────────────

pub struct BindgenExternalShared<T>(PhantomData<T>);

impl<T: ExternalSharedDescriptor> Bindgen for BindgenExternalShared<T> {
    type ZigType = ExternalShared<T>;
    // `?*T` — single-word FFI layout requires `Option<NonNull<T>>`, not `Option<*mut T>`.
    type ExternType = Option<NonNull<T>>;

    fn convert_from_extern(extern_value: Self::ExternType) -> Self::ZigType {
        // SAFETY: bindgen contract — C++ passes a pointer with one ref already taken.
        unsafe { ExternalShared::adopt(extern_value.expect("non-null").as_ptr()) }
    }
}

impl<T: ExternalSharedDescriptor> BindgenOptionalRepr for BindgenExternalShared<T> {
    type OptionalZigType = ExternalSharedOptional<T>;
    type OptionalExternType = <Self as Bindgen>::ExternType;

    fn convert_optional_from_extern(
        extern_value: Self::OptionalExternType,
    ) -> Self::OptionalZigType {
        // SAFETY: bindgen contract — if non-null, one ref is transferred.
        unsafe {
            ExternalSharedOptional::adopt(
                extern_value.map_or(core::ptr::null_mut(), |p| p.as_ptr()),
            )
        }
    }
}

pub type BindgenBlob = BindgenExternalShared<crate::webcore::Blob>;
