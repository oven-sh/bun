//! This type can be used with `bun_ptr::Owned` to model "maybe owned" pointers:
//!
//! ```ignore
//! // Either owned by the default allocator, or borrowed
//! type MaybeOwnedFoo = bun_ptr::OwnedIn<Foo, bun_alloc::MaybeOwned<bun_alloc::DefaultAllocator>>;
//!
//! let owned_foo: MaybeOwnedFoo = MaybeOwnedFoo::new(make_foo());
//! let borrowed_foo: MaybeOwnedFoo = MaybeOwnedFoo::from_raw_in(some_foo_ptr, MaybeOwned::init_borrowed());
//!
//! drop(owned_foo);    // calls `Foo::drop` and frees the memory
//! drop(borrowed_foo); // no-op
//! ```
//!
//! This type is a `GenericAllocator`; see `src/allocators.zig`.
//!
//! PORT NOTE: Zig modelled this over `Nullable<A>` / `Borrowed<A>` allocator
//! adaptors. With `#[global_allocator]`, "owned" reduces to "drop the box,
//! borrowed = leak"; the generic allocator threading is dropped. The struct
//! keeps the `Option<A>` shape so callers that pattern-match on
//! `is_owned()` keep working.

/// See module docs.
pub struct MaybeOwned<A> {
    _parent: Option<A>,
}

// Zig: `pub const Borrowed = MaybeOwned(BorrowedParent);`
// Rust has no stable inherent associated types, so expose as a free alias.
// `Borrowed<A>` collapsed to `()` — borrows carry no allocator state.
pub type MaybeOwnedBorrowed = MaybeOwned<()>;

impl<A: Default> MaybeOwned<A> {
    /// Creates a `MaybeOwned` allocator that owns memory.
    ///
    /// Allocations are forwarded to a default-initialized `A`.
    pub fn init() -> Self {
        // Zig: `bun.memory.initDefault(Allocator)`
        Self::init_owned(A::default())
    }
}

impl<A> MaybeOwned<A> {
    /// Same as `init_borrowed()`. This allocator cannot be used to allocate memory; a panic
    /// will occur.
    pub const BORROWED: Self = Self::init_borrowed();

    /// Creates a `MaybeOwned` allocator that owns memory, and forwards to a specific
    /// allocator.
    ///
    /// Allocations are forwarded to `parent_alloc`.
    pub fn init_owned(parent_alloc: A) -> Self {
        Self {
            _parent: Some(parent_alloc),
        }
    }

    /// Creates a `MaybeOwned` allocator that does not own any memory. This allocator cannot
    /// be used to allocate new memory (a panic will occur), and its implementation of `free`
    /// is a no-op.
    pub const fn init_borrowed() -> Self {
        Self { _parent: None }
    }

    pub fn is_owned(&self) -> bool {
        self._parent.is_some()
    }

    pub fn parent(&self) -> Option<&A> {
        self._parent.as_ref()
    }

    pub fn into_parent(self) -> Option<A> {
        // Zig: `defer self.* = undefined; return self.rawParent();`
        // Taking `self` by value consumes it; no explicit invalidation needed.
        self._parent
    }

    /// Used by smart pointer types and allocator wrappers. See `crate::borrow`.
    pub fn borrow(&self) -> MaybeOwnedBorrowed {
        // Borrowed view carries no allocator state — just the owned/borrowed bit.
        MaybeOwned {
            _parent: if self.is_owned() { Some(()) } else { None },
        }
    }
}

// Zig `deinit` only forwarded to `bun.memory.deinit(parent_alloc)` on the owned field.
// Per PORTING.md (Idiom map: `pub fn deinit`), that is exactly field drop glue on
// `_parent: Option<A>`, so no explicit `Drop` impl — keeping one would also forbid
// moving `self._parent` out in `into_parent(self)`.

// ported from: src/bun_alloc/maybe_owned.zig
