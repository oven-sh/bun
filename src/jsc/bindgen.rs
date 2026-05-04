use core::ffi::c_uint;
use core::marker::PhantomData;
use core::mem::{align_of, size_of};
use core::ptr::NonNull;

use bun_jsc::{self as jsc, JSValue, Strong};
use bun_runtime::webcore;
use bun_str as string;

// ──────────────────────────────────────────────────────────────────────────
// The Zig file defines a family of "Bindgen*" comptime structs that all share
// the same shape: associated `ZigType`/`ExternType` plus `convertFromExtern`,
// and optionally `OptionalZigType`/`OptionalExternType`/`convertOptionalFromExtern`.
// In Rust this is a trait. `@hasDecl(Child, "OptionalExternType")` (structural
// duck-typing) becomes a separate trait that a `Child` may opt into.
// ──────────────────────────────────────────────────────────────────────────

pub trait Bindgen {
    type ZigType;
    type ExternType;

    fn convert_from_extern(extern_value: Self::ExternType) -> Self::ZigType;
}

/// Implemented by `Bindgen` types that have a bespoke "optional" representation
/// (e.g. a nullable pointer) instead of the default `ExternTaggedUnion` wrapper.
/// Mirrors Zig's `@hasDecl(Child, "OptionalExternType")` checks.
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

    fn convert_from_extern(extern_value: Self::ExternType) -> Self::ZigType {
        extern_value
    }
}

pub type BindgenBool = BindgenTrivial<bool>;
pub type BindgenU8 = BindgenTrivial<u8>;
pub type BindgenI8 = BindgenTrivial<i8>;
pub type BindgenU16 = BindgenTrivial<u16>;
pub type BindgenI16 = BindgenTrivial<i16>;
pub type BindgenU32 = BindgenTrivial<u32>;
pub type BindgenI32 = BindgenTrivial<i32>;
pub type BindgenU64 = BindgenTrivial<u64>;
pub type BindgenI64 = BindgenTrivial<i64>;
pub type BindgenF64 = BindgenTrivial<f64>;
pub type BindgenRawAny = BindgenTrivial<JSValue>;

// ──────────────────────────────────────────────────────────────────────────

pub struct BindgenStrongAny;

impl Bindgen for BindgenStrongAny {
    type ZigType = Strong;
    // `?*jsc.Strong.Impl` — must be single-word for #[repr(C)] union placement, so
    // `Option<NonNull<T>>` (niche-optimized), NOT `Option<*mut T>` (two words).
    type ExternType = Option<NonNull<jsc::strong::Impl>>;
    // TODO(port): lifetime — `?*jsc.Strong.Impl` is an FFI handle from C++; raw ptr for now.

    fn convert_from_extern(extern_value: Self::ExternType) -> Self::ZigType {
        Strong { impl_: extern_value.expect("non-null") }
    }
}

impl BindgenOptionalRepr for BindgenStrongAny {
    type OptionalZigType = jsc::strong::Optional;
    type OptionalExternType = <Self as Bindgen>::ExternType;

    fn convert_optional_from_extern(
        extern_value: Self::OptionalExternType,
    ) -> Self::OptionalZigType {
        jsc::strong::Optional { impl_: extern_value }
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
// TODO(port): Zig switches on `@hasDecl(Child, "OptionalExternType")` to pick
// between this default and `Child::convertOptionalFromExtern`. Stable Rust
// cannot specialize on "does Child impl BindgenOptionalRepr". Phase B should
// either (a) require every `Child` to impl `BindgenOptionalRepr` (blanket impl
// providing this default, overridden by the four custom types below), which
// needs `min_specialization`, or (b) have the bindgen codegen emit
// `BindgenOptional<Child>` vs `BindgenOptionalCustom<Child>` explicitly.
impl<Child: Bindgen> Bindgen for BindgenOptional<Child> {
    type ZigType = Option<Child::ZigType>;
    type ExternType = ExternTaggedUnion2<u8, Child::ExternType>;

    fn convert_from_extern(extern_value: Self::ExternType) -> Self::ZigType {
        if extern_value.tag == 0 {
            return None;
        }
        debug_assert_eq!(extern_value.tag, 1);
        // SAFETY: tag == 1 means the `_1` arm of the union is initialized.
        Some(Child::convert_from_extern(unsafe { extern_value.data._1 }))
    }
}

/// Explicit wrapper for children that DO define a custom optional repr
/// (the `@hasDecl` == true branch in Zig).
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
    type ZigType = string::WTFString;
    // TODO(port): verify `bun_str::WTFStringImpl` is a `NonNull`/ref newtype with a
    // null niche so `Option<WTFStringImpl>` is single-word (FFI layout requirement —
    // ExternType is placed in `#[repr(C)]` unions). If not, change to
    // `Option<NonNull<string::WTFStringImplStruct>>`.
    type ExternType = Option<string::WTFStringImpl>;

    fn convert_from_extern(extern_value: Self::ExternType) -> Self::ZigType {
        string::WTFString::adopt(extern_value.unwrap())
    }
}

impl BindgenOptionalRepr for BindgenString {
    type OptionalZigType = string::wtf_string::Optional;
    type OptionalExternType = <Self as Bindgen>::ExternType;

    fn convert_optional_from_extern(
        extern_value: Self::OptionalExternType,
    ) -> Self::OptionalZigType {
        string::wtf_string::Optional::adopt(extern_value)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// BindgenUnion / ExternTaggedUnion / ExternUnion
//
// Zig builds these via `@typeInfo` / `@Type` over a `[]const type` slice —
// pure comptime reflection with no Rust equivalent. The Rust side must be
// generated per arity (or by a proc-macro from the bindgen codegen).
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): proc-macro — `BindgenUnion(children)` reflects over a comptime
// type list to build a tagged union and dispatch `convertFromExtern` per arm
// via `inline else`. Phase B should emit this from `generate-classes.ts` /
// the bindgen TS codegen as a concrete `enum` + `#[repr(C)]` union pair per
// call site, rather than a generic Rust combinator.
pub struct BindgenUnion;

/// `extern struct { data: ExternUnion(field_types), tag: u8 }`
///
/// Zig builds the inner untagged `extern union` from a comptime type list via
/// `@Type`. We provide fixed-arity instantiations; the 2-ary case is the only
/// one used directly in this file (by `BindgenOptional`).
#[repr(C)]
pub struct ExternTaggedUnion2<T0, T1> {
    pub data: ExternUnion2<T0, T1>,
    pub tag: u8,
}

#[repr(C)]
pub union ExternUnion2<T0: Copy, T1: Copy> {
    pub _0: T0,
    pub _1: T1,
}

// TODO(port): variadic `ExternTaggedUnion<const N>` / `ExternUnion<const N>` —
// generate per arity from codegen, or use a `macro_rules!` arity expander.
// Compile-time assert `field_types.len() <= u8::MAX` belongs in that macro.

// ──────────────────────────────────────────────────────────────────────────

pub struct BindgenArray<Child>(PhantomData<Child>);

impl<Child: Bindgen> Bindgen for BindgenArray<Child> {
    type ZigType = bun_collections::ArrayListDefault<Child::ZigType>;
    type ExternType = ExternArrayList<Child::ExternType>;

    fn convert_from_extern(extern_value: Self::ExternType) -> Self::ZigType {
        let length = usize::try_from(extern_value.length).unwrap();
        let capacity = usize::try_from(extern_value.capacity).unwrap();

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
        let mut unmanaged: Vec<Child::ExternType> =
            unsafe { Vec::from_raw_parts(data, length, capacity) };

        if !bun_alloc::USE_MIMALLOC {
            // Don't reuse memory in this case; it would be freed by the wrong allocator.
        } else if size_of::<Child::ZigType>() == size_of::<Child::ExternType>()
            // TODO(port): Zig checks `Child.ZigType == Child.ExternType` (type identity).
            // Rust cannot compare types for equality on stable; Phase B can gate this on
            // `TypeId::of` (requires `'static`) or a `const SAME_REPR: bool` on the trait.
            && false
        {
            // PORT NOTE: when the types are identical the Vec is returned as-is.
            // SAFETY: `ZigType == ExternType` ⇒ same layout; `from_raw_parts` round-trip.
            let (ptr, len, cap) = {
                let mut v = core::mem::ManuallyDrop::new(unmanaged);
                (v.as_mut_ptr(), v.len(), v.capacity())
            };
            let reused: Vec<Child::ZigType> =
                unsafe { Vec::from_raw_parts(ptr.cast::<Child::ZigType>(), len, cap) };
            return Self::ZigType::from_unmanaged(reused);
        } else if size_of::<Child::ZigType>() <= size_of::<Child::ExternType>()
            && align_of::<Child::ZigType>() <= bun_alloc::mimalloc::MI_MAX_ALIGN_SIZE
        {
            // We can reuse the allocation, but we still need to convert the elements.
            let mut v = core::mem::ManuallyDrop::new(unmanaged);
            let storage_len = v.capacity() * size_of::<Child::ExternType>();
            // SAFETY: `data` is a contiguous mimalloc block of `storage_len` bytes.
            let mut storage: &mut [u8] =
                unsafe { core::slice::from_raw_parts_mut(v.as_mut_ptr().cast::<u8>(), storage_len) };

            // Convert the elements.
            for i in 0..length {
                // Zig doesn't have a formal aliasing model, so we should be maximally
                // pessimistic.
                // PORT NOTE: Rust DOES — but we keep the byte-wise copy to match behavior
                // exactly (in-place reinterpretation of overlapping element slots).
                let mut old_elem = core::mem::MaybeUninit::<Child::ExternType>::uninit();
                // SAFETY: source range is within `storage` and holds a valid ExternType.
                unsafe {
                    core::ptr::copy_nonoverlapping(
                        storage
                            .as_ptr()
                            .add(i * size_of::<Child::ExternType>()),
                        old_elem.as_mut_ptr().cast::<u8>(),
                        size_of::<Child::ExternType>(),
                    );
                }
                // SAFETY: bytes for element `i` were just copied from initialized storage.
                let new_elem =
                    Child::convert_from_extern(unsafe { old_elem.assume_init() });
                // SAFETY: dest range is within `storage`; ZigType <= ExternType in size so
                // slot `i` of the new layout never overruns slot `i` of the old layout.
                unsafe {
                    core::ptr::copy_nonoverlapping(
                        (&new_elem as *const Child::ZigType).cast::<u8>(),
                        storage
                            .as_mut_ptr()
                            .add(i * size_of::<Child::ZigType>()),
                        size_of::<Child::ZigType>(),
                    );
                }
                core::mem::forget(new_elem);
            }

            let new_size_is_multiple =
                size_of::<Child::ExternType>() % size_of::<Child::ZigType>() == 0;
            let new_capacity = if new_size_is_multiple {
                capacity * (size_of::<Child::ExternType>() / size_of::<Child::ZigType>())
            } else {
                let new_capacity = storage.len() / size_of::<Child::ZigType>();
                let new_alloc_size = new_capacity * size_of::<Child::ZigType>();
                if new_alloc_size != storage.len() {
                    // Allocation isn't a multiple of `size_of::<Child::ZigType>()`; we have to
                    // resize it.
                    // TODO(port): `bun.default_allocator.realloc` — need a raw mimalloc
                    // realloc that preserves the pointer/contents. Phase B: expose
                    // `bun_alloc::realloc(ptr, old_size, new_size)`.
                    // SAFETY: `storage` was allocated by mimalloc (USE_MIMALLOC branch
                    // above guards entry to this path); reallocating with the same
                    // allocator to a smaller size preserves the prefix bytes.
                    storage = unsafe {
                        bun_alloc::realloc_slice(storage, new_alloc_size)
                    };
                }
                new_capacity
            };

            // SAFETY: storage.ptr is aligned to at least MI_MAX_ALIGN_SIZE ≥ align_of ZigType.
            let items_ptr = storage.as_mut_ptr().cast::<Child::ZigType>();
            let new_unmanaged: Vec<Child::ZigType> =
                unsafe { Vec::from_raw_parts(items_ptr, length, new_capacity) };
            return Self::ZigType::from_unmanaged(new_unmanaged);
        }

        // Fallback: allocate fresh, convert, free old.
        // PORT NOTE: Zig frees `unmanaged` with `raw_c_allocator` when `!use_mimalloc`;
        // in Rust the global allocator IS mimalloc (per crate prereq), so dropping the
        // `Vec` is correct only when USE_MIMALLOC. The `!USE_MIMALLOC` arm needs an
        // explicit `libc::free` — left as TODO since `USE_MIMALLOC` is always true in
        // production builds.
        // TODO(port): free via raw_c_allocator when !USE_MIMALLOC
        let mut result = Self::ZigType::init_capacity(length);
        for item in unmanaged.drain(..) {
            // PERF(port): was appendAssumeCapacity — profile in Phase B
            result.push(Child::convert_from_extern(item));
        }
        drop(unmanaged);
        result
    }
}

#[repr(C)]
pub struct ExternArrayList<Child> {
    // Zig `?[*]Child` — single-word nullable pointer. `Option<*mut T>` has no niche
    // (two words) and would break the C ABI; use raw `*mut T` and check `.is_null()`.
    pub data: *mut Child,
    // TODO(port): lifetime — raw FFI buffer from C++, ownership transferred on convert.
    pub length: c_uint,
    pub capacity: c_uint,
}

// ──────────────────────────────────────────────────────────────────────────

pub struct BindgenExternalShared<T>(PhantomData<T>);

impl<T> Bindgen for BindgenExternalShared<T> {
    type ZigType = bun_ptr::ExternalShared<T>;
    // TODO(port): `bun.ptr.ExternalShared` is not in the crate map — assumed to be a
    // C++-owned ref-counted handle wrapper living in `bun_ptr` (or `bun_collections`).
    // `?*T` — single-word FFI layout requires `Option<NonNull<T>>`, not `Option<*mut T>`.
    type ExternType = Option<NonNull<T>>;

    fn convert_from_extern(extern_value: Self::ExternType) -> Self::ZigType {
        bun_ptr::ExternalShared::adopt(extern_value.expect("non-null"))
    }
}

impl<T> BindgenOptionalRepr for BindgenExternalShared<T> {
    type OptionalZigType = bun_ptr::external_shared::Optional<T>;
    type OptionalExternType = <Self as Bindgen>::ExternType;

    fn convert_optional_from_extern(
        extern_value: Self::OptionalExternType,
    ) -> Self::OptionalZigType {
        bun_ptr::external_shared::Optional::adopt(extern_value)
    }
}

pub type BindgenArrayBuffer = BindgenExternalShared<jsc::JSCArrayBuffer>;
pub type BindgenBlob = BindgenExternalShared<webcore::Blob>;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/bindgen.zig (254 lines)
//   confidence: medium
//   todos:      10
//   notes:      Heavy comptime reflection (@hasDecl/@Type/@typeInfo) reshaped into Bindgen/BindgenOptionalRepr traits; BindgenUnion + variadic ExternTaggedUnion need codegen/proc-macro in Phase B; BindgenArray type-identity fast-path gated off pending stable type-eq; ExternType layouts use Option<NonNull<T>>/raw *mut T for single-word FFI ABI.
// ──────────────────────────────────────────────────────────────────────────
