//! Type which could be borrowed or owned.
//! The name is from the Rust std's `Cow` type.
//! Can't think of a better name.

// NOTE: Should not be used with slice types. Use `CowSlice` or `CowSliceZ` instead.
// TODO(port): the Zig `@typeInfo(T) == .pointer && .size == .slice` @compileError guard
// has no direct Rust equivalent on a generic param; enforced by convention/docs.

// The Zig `VTable: type` param + `Handler` adapter (with `@hasDecl` + `@compileError`
// checks for `copy`/`deinit`) collapses to a `T: Clone` bound:
//   - `VTable.copy(&T, allocator) -> T`  →  `T::clone(&self)`  (allocator param deleted; non-AST crate)
//   - `VTable.deinit(&mut T, allocator)` →  implicit `Drop` on `T`
// Per PORTING.md §Comptime reflection: `@hasDecl` + `@compileError` → trait bound.

pub enum Cow<'a, T: Clone> {
    Borrowed(&'a T),
    Owned(T),
}

impl<'a, T: Clone> Cow<'a, T> {
    pub fn borrow(val: &'a T) -> Self {
        Cow::Borrowed(val)
    }

    pub fn own(val: T) -> Self {
        Cow::Owned(val)
    }

    pub fn replace(&mut self, newval: T) {
        // Zig: `if (this.* == .owned) this.deinit(allocator);` then assign.
        // In Rust, assigning over `*self` drops the old value automatically
        // (no-op for `Borrowed`, runs `T::drop` for `Owned`), so the explicit
        // branch is unnecessary.
        *self = Cow::Owned(newval);
    }

    /// Get the underlying value.
    #[inline]
    pub fn inner(&self) -> &T {
        match self {
            Cow::Borrowed(b) => *b,
            Cow::Owned(o) => o,
        }
    }

    #[inline]
    pub fn inner_mut(&mut self) -> Option<&mut T> {
        match self {
            Cow::Borrowed(_) => None,
            Cow::Owned(o) => Some(o),
        }
    }

    pub fn to_owned(&mut self) -> &mut T {
        // PORT NOTE: reshaped for borrowck — cannot reassign `*self` while
        // borrowing the `Borrowed` payload and then return `&mut self.owned`
        // in one match; split into clone-then-rematch.
        if let Cow::Borrowed(b) = *self {
            *self = Cow::Owned(b.clone());
        }
        match self {
            Cow::Owned(o) => o,
            Cow::Borrowed(_) => unreachable!(),
        }
    }

    // `pub fn deinit(this, allocator)` → intentionally omitted.
    // The Zig body only calls `Handler.deinit(&this.owned, allocator)` when
    // `.owned`; Rust's auto-generated enum Drop glue already drops the `Owned(T)`
    // payload. Per PORTING.md: deinit bodies that only free owned fields are
    // deleted entirely; `Drop` cannot take an allocator param.
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/ptr/Cow.zig (81 lines)
//   confidence: high
//   todos:      1
//   notes:      VTable param collapsed to `T: Clone` bound; allocator params dropped (non-AST crate); slice-type @compileError guard not expressible on generic T.
// ──────────────────────────────────────────────────────────────────────────
