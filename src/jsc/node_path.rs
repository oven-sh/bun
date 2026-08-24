//! `node.PathLike` / `node.PathOrFileDescriptor` — single nominal definitions.
//!
//! LAYERING: defined at the
//! `bun_jsc` tier because every variant payload (`Buffer` =
//! `MarkedArrayBuffer`, `Utf8WithString`, `Utf8Bytes`, `Fd`)
//! is already reachable from this crate. `bun_runtime::node::types`
//! `pub use`s these and layers the JS-argument-parsing helpers (`from_js`,
//! `from_js_with_allocator`) on top via inherent impls in that crate.

use bun_core::{Utf8Bytes, Utf8WithString};
use bun_sys::Fd;

use crate::array_buffer::MarkedArrayBuffer;

// ──────────────────────────────────────────────────────────────────────────
// RAII for `protect()`/`unprotect()` pairs taken by `to_thread_safe()`.
//
// The async-fs path calls `to_thread_safe()` (which `JSValue::protect()`s
// any borrowed JS-backed buffers so the work-pool thread may read them) and
// must later release them. The "deinit" half is
// already `Drop`; only the JS-side `unprotect()` needs an explicit hook, and
// pairing it with the protect via a guard type removes the leak hazard on
// every early return between `to_thread_safe` and the manual cleanup.
// ──────────────────────────────────────────────────────────────────────────

/// Undo the `JSValue::protect()` calls taken by [`to_thread_safe`](
/// PathLike::to_thread_safe) (or an `args::*` type's `to_thread_safe`).
///
/// Implementations release **only** the JS-GC protect refcount — owned Rust
/// payloads (Vec, `Utf8WithString`, …) are freed by the type's own
/// `Drop`, which runs immediately after when the value is held in a
/// [`ThreadSafe<T>`].
pub trait Unprotect {
    fn unprotect(&mut self);
}

/// RAII guard returned by `into_thread_safe()`: a `T` whose JS-backed buffers
/// have been `protect()`ed. `Drop` calls [`Unprotect::unprotect`] then drops
/// the inner `T` normally.
///
/// `repr(transparent)` so identity-casts in the const-generic dispatch macros
/// (see `node_fs.rs`'s `args_as!`) remain bit-exact.
#[repr(transparent)]
pub struct ThreadSafe<T: Unprotect>(T);

impl<T: Unprotect> ThreadSafe<T> {
    /// Wrap an **already-protected** `T`. Use when the protect was taken
    /// elsewhere (e.g. inside `from_js_maybe_async(.., Flavor::Async, ..)`).
    #[inline]
    pub fn adopt(value: T) -> Self {
        Self(value)
    }
}

// SAFETY: this is what the type asserts — the JS-backed views inside `T` are
// GC-protected for as long as it is held, so a pool job may read them (under
// its `Ticket`, which keeps the VM alive); the job comes back to the JS
// thread, where this is dropped and the protection released.
unsafe impl<T: Unprotect> Send for ThreadSafe<T> {}

impl<T: Unprotect> core::ops::Deref for ThreadSafe<T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        &self.0
    }
}

impl<T: Unprotect> core::ops::DerefMut for ThreadSafe<T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut T {
        &mut self.0
    }
}

impl<T: Unprotect> Drop for ThreadSafe<T> {
    #[inline]
    fn drop(&mut self) {
        // The same argument types serve mini-loop threads (the shell's `cp` via
        // `ShellAsyncCpTask`, `bun exec`), which have no VM and never protected
        // anything; only a JS thread has a protection to release. A JS VM's job
        // always comes back to its own thread to drop this (its VM waits for it).
        if crate::virtual_machine::VirtualMachine::get_or_null().is_some() {
            self.0.unprotect();
        }
        // `self.0: T` drops next (field drop after `Drop::drop`).
    }
}

impl<T: Unprotect + Default> Default for ThreadSafe<T> {
    #[inline]
    fn default() -> Self {
        Self(T::default())
    }
}

// `ThreadSafe<T>` crosses to the work-pool thread; auto-`Send` iff `T: Send`.

/// `node.PathLike`.
pub enum PathLike {
    Buffer(MarkedArrayBuffer),
    String(Utf8WithString),
    ThreadsafeString(Utf8WithString),
    Utf8(Utf8Bytes<'static>),
}

impl Default for PathLike {
    #[inline]
    fn default() -> Self {
        PathLike::Utf8(Utf8Bytes::EMPTY)
    }
}

impl Clone for PathLike {
    /// Bumps any owning ref so
    /// the clone is independently droppable *and* `clone().slice()` returns
    /// the same bytes as the original.
    fn clone(&self) -> Self {
        match self {
            Self::Buffer(b) => Self::Buffer(MarkedArrayBuffer {
                buffer: b.buffer,
                // The clone borrows the JS-owned backing store; only the
                // original (if any) owns the allocation.
                owns_buffer: false,
                pinned: false,
            }),
            Self::String(s) => Self::String(s.clone()),
            Self::ThreadsafeString(s) => Self::ThreadsafeString(s.clone()),
            Self::Utf8(s) => Self::Utf8(s.clone()),
        }
    }
}

impl Drop for PathLike {
    fn drop(&mut self) {
        match self {
            Self::Buffer(b) => {
                if b.pinned {
                    b.pinned = false;
                    b.buffer.unpin();
                }
            }
            Self::String(_) | Self::ThreadsafeString(_) | Self::Utf8(_) => {}
        }
    }
}

impl PathLike {
    /// Lend `bytes` to a synchronous syscall without copying.
    ///
    /// # Safety
    /// `bytes` must stay alive and unmoved until the returned `PathLike` is
    /// dropped.
    #[inline]
    pub unsafe fn borrowed(bytes: &[u8]) -> PathLike {
        // SAFETY: caller contract above.
        PathLike::Utf8(Utf8Bytes::Borrowed(unsafe {
            bun_ptr::detach_lifetime(bytes)
        }))
    }

    #[inline]
    pub fn slice(&self) -> &[u8] {
        match self {
            Self::Buffer(b) => b.slice(),
            Self::String(s) | Self::ThreadsafeString(s) => s.slice(),
            Self::Utf8(s) => s.slice(),
        }
    }

    pub(crate) fn estimated_size(&self) -> usize {
        match self {
            Self::Buffer(b) => b.slice().len(),
            Self::String(_) | Self::ThreadsafeString(_) => 0,
            Self::Utf8(s) => s.slice().len(),
        }
    }

    /// Promote any borrowed-JS
    /// payload to a thread-safe representation. For `Buffer` the variant is
    /// kept and the backing JS value is `protect()`ed (paired with
    /// [`Unprotect::unprotect`]); the discriminant is preserved so callers
    /// matching on `Buffer` after this call see the same shape.
    ///
    /// Prefer [`Self::into_thread_safe`] which returns a [`ThreadSafe`] guard;
    /// this in-place form exists for nested calls from container types'
    /// `to_thread_safe`.
    pub fn to_thread_safe(&mut self) {
        match self {
            Self::String(s) => {
                s.to_thread_safe();
                let owned = core::mem::take(s);
                *self = Self::ThreadsafeString(owned);
            }
            Self::Buffer(b) => {
                b.buffer.value.protect();
            }
            Self::ThreadsafeString(_) | Self::Utf8(_) => {}
        }
    }
}

impl Unprotect for PathLike {
    /// JS-side half of cleanup — undo
    /// the `protect()` taken by [`Self::to_thread_safe`] /
    /// `ArgumentsSlice::protect_eat`. Owned payloads are released by `Drop`.
    #[inline]
    fn unprotect(&mut self) {
        if let Self::Buffer(b) = self {
            b.buffer.value.unprotect();
        }
    }
}

/// `node.PathOrFileDescriptor`.
pub enum PathOrFileDescriptor {
    Fd(Fd),
    Path(PathLike),
}

impl Default for PathOrFileDescriptor {
    #[inline]
    fn default() -> Self {
        Self::Fd(Fd::INVALID)
    }
}

impl Clone for PathOrFileDescriptor {
    fn clone(&self) -> Self {
        match self {
            Self::Fd(fd) => Self::Fd(*fd),
            Self::Path(p) => Self::Path(p.clone()),
        }
    }
}

/// `PathOrFileDescriptor.SerializeTag`.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum PathOrFileDescriptorSerializeTag {
    Fd = 0,
    Path = 1,
}

impl PathOrFileDescriptorSerializeTag {
    #[inline]
    pub fn from_raw(raw: u8) -> Option<Self> {
        match raw {
            0 => Some(Self::Fd),
            1 => Some(Self::Path),
            _ => None,
        }
    }
}

impl PathOrFileDescriptor {
    #[inline]
    pub fn to_thread_safe(&mut self) {
        if let Self::Path(p) = self {
            p.to_thread_safe();
        }
    }

    #[inline]
    pub fn estimated_size(&self) -> usize {
        match self {
            Self::Fd(_) => 0,
            Self::Path(p) => p.estimated_size(),
        }
    }
}

impl Unprotect for PathOrFileDescriptor {
    /// JS-side half of cleanup — see [`PathLike::unprotect`].
    #[inline]
    fn unprotect(&mut self) {
        if let Self::Path(p) = self {
            p.unprotect();
        }
    }
}

impl core::fmt::Display for PathOrFileDescriptor {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::Path(p) => write!(f, "{}", bstr::BStr::new(p.slice())),
            // `bun.FD.format` semantics — bare number / `[invalid_fd]` — via
            // `Display for Fd` (bun_core), not the derived `Debug`.
            Self::Fd(fd) => write!(f, "{}", fd),
        }
    }
}

impl PathOrFileDescriptor {
    #[inline]
    pub fn is_path(&self) -> bool {
        matches!(self, Self::Path(_))
    }

    #[inline]
    pub fn is_fd(&self) -> bool {
        matches!(self, Self::Fd(_))
    }

    /// Unwrap the `Path` arm. Panics on `Fd` (used only after the caller has
    /// matched on the tag).
    #[inline]
    pub fn path(&self) -> &PathLike {
        match self {
            Self::Path(path) => path,
            Self::Fd(_) => unreachable!("PathOrFileDescriptor::path() on Fd variant"),
        }
    }

    /// Unwrap the `Fd` arm. Panics on `Path`.
    #[inline]
    pub fn fd(&self) -> bun_sys::Fd {
        match self {
            Self::Fd(fd) => *fd,
            Self::Path(_) => unreachable!("PathOrFileDescriptor::fd() on Path variant"),
        }
    }
}
