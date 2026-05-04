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

use core::ffi::c_void;

// `bun.allocators.*` lives in this crate (bun_alloc).
use crate::{Allocator, Borrowed as BorrowedAlloc, Nullable};

/// See module docs.
pub struct MaybeOwned<A> {
    _parent: Nullable<A>,
}

// Zig: `pub const Borrowed = MaybeOwned(BorrowedParent);`
// Rust has no stable inherent associated types, so expose as a free alias.
// TODO(port): if inherent assoc types stabilize, move this onto `MaybeOwned<A>`.
pub type MaybeOwnedBorrowed<A> = MaybeOwned<BorrowedAlloc<A>>;

impl<A> MaybeOwned<A> {
    /// Same as `init_borrowed()`. This allocator cannot be used to allocate memory; a panic
    /// will occur.
    // TODO(port): requires `crate::init_nullable` to be a `const fn` for this to be a true `const`.
    pub const BORROWED: Self = Self::init_borrowed();

    /// Creates a `MaybeOwned` allocator that owns memory.
    ///
    /// Allocations are forwarded to a default-initialized `A`.
    pub fn init() -> Self {
        // Zig: `bun.memory.initDefault(Allocator)`
        // TODO(port): confirm crate path for `bun.memory` (likely `bun_memory::init_default::<A>()`
        // or simply `A::default()`).
        Self::init_owned(bun_memory::init_default::<A>())
    }

    /// Creates a `MaybeOwned` allocator that owns memory, and forwards to a specific
    /// allocator.
    ///
    /// Allocations are forwarded to `parent_alloc`.
    pub fn init_owned(parent_alloc: A) -> Self {
        Self::init_raw(Some(parent_alloc))
    }

    /// Creates a `MaybeOwned` allocator that does not own any memory. This allocator cannot
    /// be used to allocate new memory (a panic will occur), and its implementation of `free`
    /// is a no-op.
    pub const fn init_borrowed() -> Self {
        Self::init_raw(None)
    }

    pub fn is_owned(&self) -> bool {
        self.raw_parent().is_some()
    }

    pub fn allocator(&self) -> &dyn Allocator {
        // TODO(port): Zig returned a by-value `std.mem.Allocator` (ptr+vtable). Rust uses
        // `&dyn Allocator`; verify lifetimes once `crate::as_std` / trait shape is settled.
        match self.raw_parent() {
            Some(parent_alloc) => crate::as_std(parent_alloc),
            None => &NULL_ALLOCATOR,
        }
    }

    pub fn parent(&self) -> Option<BorrowedAlloc<A>> {
        match self.raw_parent() {
            Some(parent_alloc) => Some(crate::borrow(parent_alloc)),
            None => None,
        }
    }

    pub fn into_parent(self) -> Option<A> {
        // Zig: `defer self.* = undefined; return self.rawParent();`
        // Taking `self` by value consumes it; no explicit invalidation needed.
        crate::unpack_nullable::<A>(self._parent)
    }

    /// Used by smart pointer types and allocator wrappers. See `crate::borrow`.
    pub fn borrow(&self) -> MaybeOwnedBorrowed<A> {
        MaybeOwned {
            _parent: crate::init_nullable::<BorrowedAlloc<A>>(self.parent()),
        }
    }

    const fn init_raw(parent_alloc: Option<A>) -> Self {
        Self {
            _parent: crate::init_nullable::<A>(parent_alloc),
        }
    }

    fn raw_parent(&self) -> Option<&A> {
        // TODO(port): Zig passed/returned `Allocator` by value here (copy semantics for
        // zero-sized / pointer-sized allocators). Using `&A` to avoid requiring `A: Copy`;
        // revisit once `Nullable<A>` API is fixed.
        crate::unpack_nullable_ref::<A>(&self._parent)
    }
}

impl<A> Drop for MaybeOwned<A> {
    fn drop(&mut self) {
        // Zig `deinit`: take the parent (if owned) and deinit it.
        // In Rust, dropping `self._parent: Nullable<A>` already drops the inner `A` when
        // present, so this is largely a no-op beyond field drop glue.
        // Kept explicit to mirror `bun.memory.deinit(parent_alloc)` for side-effecting allocators.
        if let Some(parent_alloc) = crate::take_nullable::<A>(&mut self._parent) {
            bun_memory::deinit(parent_alloc);
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Null allocator vtable (used when `MaybeOwned` is borrowed)
// ──────────────────────────────────────────────────────────────────────────

fn null_alloc(_ptr: *mut c_void, _len: usize, _alignment: crate::Alignment, _ret_addr: usize) -> Option<*mut u8> {
    panic!("cannot allocate with a borrowed `MaybeOwned` allocator");
}

// TODO(port): Zig built a `std.mem.Allocator.VTable` literal with `noResize`/`noRemap`/`noFree`.
// The Rust `bun_alloc::Allocator` trait shape will determine whether this is a static vtable
// struct or a ZST implementing the trait. Modeled here as a ZST + trait impl.
struct NullAllocator;

static NULL_ALLOCATOR: NullAllocator = NullAllocator;

impl Allocator for NullAllocator {
    fn alloc(&self, len: usize, alignment: crate::Alignment, ret_addr: usize) -> Option<*mut u8> {
        null_alloc(core::ptr::null_mut(), len, alignment, ret_addr)
    }
    // resize / remap / free intentionally use the trait's default no-op impls
    // (Zig: `std.mem.Allocator.noResize` / `noRemap` / `noFree`).
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_alloc/maybe_owned.zig (112 lines)
//   confidence: medium
//   todos:      5
//   notes:      Generic allocator wrapper; depends on unsettled crate::{Nullable, Borrowed, init_nullable, unpack_nullable, as_std, Allocator trait} and bun_memory::{init_default, deinit}. Associated `Borrowed` type alias hoisted to free `MaybeOwnedBorrowed<A>` (no stable inherent assoc types).
// ──────────────────────────────────────────────────────────────────────────
