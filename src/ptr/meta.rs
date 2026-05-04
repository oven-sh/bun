//! Private utilities used in smart pointer implementations.
//!
//! TODO(port): This module is Zig comptime type-reflection machinery that lets
//! `Owned(P)` / `Shared(P)` accept `*T`, `[]T`, `?*T`, `?[]T` as a single
//! generic `P` and then introspect optionality / constness / element type via
//! `@typeInfo`. Per PORTING.md §Pointers, `bun.ptr.Owned/Shared/AtomicShared`
//! map directly to `Box<T>` / `Rc<T>` / `Arc<T>` (and `Box<[T]>`,
//! `Option<Box<T>>` etc. are spelled at the use site), so the reflection layer
//! has no Rust counterpart. The skeleton below preserves shape for diffing;
//! Phase B should likely delete this module once the `bun_ptr` callers are
//! migrated to std smart pointers.

use core::marker::PhantomData;

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Kind {
    Single,
    Slice,
}

/// A possibly optional slice or single-item pointer type descriptor.
/// E.g., `*u8`, `[]u8`, `?*u8`, `?[]u8` in Zig.
///
/// TODO(port): In Zig this carries three `type` fields (`Pointer`,
/// `NonOptionalPointer`, `Child`) populated by `@typeInfo`. Rust cannot store
/// types as values; the generics here are a best-effort placeholder so
/// downstream signatures that mention `PointerInfo` have something to name.
pub struct PointerInfo<Pointer, NonOptionalPointer, Child> {
    /// A possibly optional slice or single-item pointer type.
    /// E.g., `*u8`, `[]u8`, `?*u8`, `?[]u8`.
    _pointer: PhantomData<Pointer>,

    /// If `Pointer` is an optional pointer, this is the non-optional equivalent. Otherwise, this
    /// is the same as `Pointer`.
    ///
    /// For example, if `Pointer` is `?[]u8`, this is `[]u8`.
    _non_optional_pointer: PhantomData<NonOptionalPointer>,

    /// The type of data stored by the pointer, i.e., the type obtained by dereferencing a
    /// single-item pointer or accessing an element of a slice.
    ///
    /// For example, if `Pointer` is `?[]u8`, this is `u8`.
    _child: PhantomData<Child>,
}

impl<Pointer, NonOptionalPointer, Child> PointerInfo<Pointer, NonOptionalPointer, Child> {
    pub fn kind(&self) -> Kind {
        // TODO(port): Zig: `switch (@typeInfo(self.NonOptionalPointer).pointer.size)`.
        // Rust has no `@typeInfo`; in the std-smart-pointer mapping the caller
        // already knows whether it has `Box<T>` vs `Box<[T]>`.
        unreachable!("comptime reflection — resolved at type level in Rust")
    }

    pub fn is_optional(&self) -> bool {
        // TODO(port): Zig: `@typeInfo(self.Pointer) == .optional`.
        unreachable!("comptime reflection — resolved at type level in Rust")
    }

    pub fn is_const(&self) -> bool {
        // TODO(port): Zig: `@typeInfo(self.NonOptionalPointer).pointer.is_const`.
        unreachable!("comptime reflection — resolved at type level in Rust")
    }

    pub fn parse(_options: ParseOptions) -> Self {
        // TODO(port): Zig body walks `@typeInfo(Pointer)`:
        //   - unwrap `.optional` to get `NonOptionalPointer`
        //   - assert `.pointer`, extract `Child`
        //   - reject `.many` / `.c` sizes, `is_volatile`, non-default
        //     alignment, `is_allowzero`, sentinel-terminated
        //   - reject `.slice` if `!options.allow_slices`
        //   - reject `is_const` if `!options.allow_const`
        // None of these checks are expressible in Rust's type system as a
        // value-level function; they are subsumed by choosing `Box<T>` /
        // `Box<[T]>` / `Option<Box<T>>` directly at the call site.
        unreachable!("comptime reflection — resolved at type level in Rust")
    }
}

#[derive(Copy, Clone)]
pub struct ParseOptions {
    pub allow_const: bool,
    pub allow_slices: bool,
}

impl Default for ParseOptions {
    fn default() -> Self {
        Self {
            allow_const: true,
            allow_slices: true,
        }
    }
}

// TODO(port): `pub fn AddConst(Pointer: type) type` mutates `@typeInfo` to set
// `.pointer.is_const = true` (recursing through `.optional`) and rebuilds the
// type via `@Type`. Rust has no type-level function for this; the moral
// equivalent is an associated type on a trait. Kept as a marker so callers
// (`Owned::asConst` etc.) have a name to reference during Phase B.
pub trait AddConst {
    type Output;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/ptr/meta.zig (100 lines)
//   confidence: low
//   todos:      6
//   notes:      pure @typeInfo/@Type comptime reflection backing bun.ptr smart pointers; per crate map those become Box/Rc/Arc so this module is likely dead in Phase B
// ──────────────────────────────────────────────────────────────────────────
