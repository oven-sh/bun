//! Private utilities used in smart pointer implementations.
//!
//! TODO(port): This module is Zig comptime type-reflection machinery that lets
//! `Owned(P)` / `Shared(P)` accept `*T`, `[]T`, `?*T`, `?[]T` as a single
//! generic `P` and then introspect optionality / constness / element type via
//! `@typeInfo`. Per PORTING.md §Pointers, `bun.ptr.Owned/Shared/AtomicShared`
//! map directly to `Box<T>` / `Rc<T>` / `Arc<T>` (and `Box<[T]>`,
//! `Option<Box<T>>` etc. are spelled at the use site), so the reflection layer
//! has no Rust counterpart. The skeleton below preserves shape for diffing;
//! TODO(refactor): delete this module once the `bun_ptr` callers are migrated
//! to std smart pointers.

use core::marker::PhantomData;

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Kind {
    Single,
    Slice,
}

pub struct PointerInfo<Pointer, NonOptionalPointer, Child> {
    /// A possibly optional slice or single-item pointer type.
    /// E.g., `*u8`, `[]u8`, `?*u8`, `?[]u8`.
    _pointer: PhantomData<Pointer>,

    _non_optional_pointer: PhantomData<NonOptionalPointer>,

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

pub trait AddConst {
    type Output;
}

// ported from: src/ptr/meta.zig
