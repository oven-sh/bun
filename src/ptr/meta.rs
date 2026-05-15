//! Private utilities used in smart pointer implementations.
//!
//! TODO(port): This module is type-reflection machinery for introspecting
//! optionality / constness / element type of generic pointer params. Per
//! PORTING.md §Pointers, `bun.ptr.Owned/Shared/AtomicShared` map directly to
//! `Box<T>` / `Rc<T>` / `Arc<T>` (and `Box<[T]>`, `Option<Box<T>>` etc. are
//! spelled at the use site), so the reflection layer has no Rust counterpart.
//! The skeleton below preserves shape for diffing; Phase B should likely
//! delete this module once the `bun_ptr` callers are migrated to std smart
//! pointers.

use core::marker::PhantomData;

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Kind {
    Single,
    Slice,
}

/// A possibly optional slice or single-item pointer type descriptor.
///
/// TODO(port): Rust cannot store types as values; the generics here
/// (`Pointer`, `NonOptionalPointer`, `Child`) are a best-effort placeholder
/// so downstream signatures that mention `PointerInfo` have something to name.
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
        // TODO(port): in the std-smart-pointer mapping the caller already
        // knows whether it has `Box<T>` vs `Box<[T]>`.
        unreachable!("type reflection — resolved at type level in Rust")
    }

    pub fn is_optional(&self) -> bool {
        unreachable!("type reflection — resolved at type level in Rust")
    }

    pub fn is_const(&self) -> bool {
        unreachable!("type reflection — resolved at type level in Rust")
    }

    pub fn parse(_options: ParseOptions) -> Self {
        // TODO(port): the original validated pointer shape (single vs slice,
        // optionality, constness, no sentinel/volatile/allowzero). None of
        // these checks are expressible in Rust's type system as a value-level
        // function; they are subsumed by choosing `Box<T>` / `Box<[T]>` /
        // `Option<Box<T>>` directly at the call site.
        unreachable!("type reflection — resolved at type level in Rust")
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

// TODO(port): a type-level "add const to pointer" transform has no Rust
// type-level function; the moral equivalent is an associated type on a trait.
// Kept as a marker so callers (`Owned::asConst` etc.) have a name to reference
// during Phase B.
pub trait AddConst {
    type Output;
}
