//! `node.PathLike` / `node.PathOrFileDescriptor` — single nominal definitions.
//!
//! LAYERING: ported from `src/runtime/node/types.zig:532-910`. Defined at the
//! `bun_jsc` tier because every variant payload (`PathString`, `Buffer` =
//! `MarkedArrayBuffer`, `SliceWithUnderlyingString`, `ZigStringSlice`, `Fd`)
//! is already reachable from this crate. `bun_runtime::node::types`
//! `pub use`s these and layers the JS-argument-parsing helpers (`from_js`,
//! `from_js_with_allocator`) on top via inherent impls in that crate.

use bun_core::{PathString, SliceWithUnderlyingString, ZigStringSlice};
use bun_sys::Fd;

use crate::array_buffer::MarkedArrayBuffer;

// ──────────────────────────────────────────────────────────────────────────
// RAII for `protect()`/`unprotect()` pairs taken by `to_thread_safe()`.
//
// Zig's async-fs path calls `args.toThreadSafe()` (which `JSValue.protect()`s
// any borrowed JS-backed buffers so the work-pool thread may read them) and
// later `args.deinitAndUnprotect()` to release. In Rust the "deinit" half is
// already `Drop`; only the JS-side `unprotect()` needs an explicit hook, and
// pairing it with the protect via a guard type removes the leak hazard on
// every early return between `toThreadSafe` and the manual cleanup.
// ──────────────────────────────────────────────────────────────────────────

/// Undo the `JSValue::protect()` calls taken by [`to_thread_safe`](
/// PathLike::to_thread_safe) (or an `args::*` type's `to_thread_safe`).
///
/// Implementations release **only** the JS-GC protect refcount — owned Rust
/// payloads (Vec, `SliceWithUnderlyingString`, …) are freed by the type's own
/// `Drop`, which runs immediately after when the value is held in a
/// [`ThreadSafe<T>`].
pub trait Unprotect {
    fn unprotect(&mut self);
}

/// RAII guard returned by `into_thread_safe()`: a `T` whose JS-backed buffers
/// have been `protect()`ed. `Drop` calls [`Unprotect::unprotect`] then drops
/// the inner `T` normally — the Rust spelling of Zig's
/// `defer args.deinitAndUnprotect()`.
///
/// `repr(transparent)` so identity-casts in the const-generic dispatch macros
/// (see `node_fs.rs`'s `args_as!`) remain bit-exact.
#[repr(transparent)]
pub struct ThreadSafe<T: Unprotect>(T);

impl<T: Unprotect> ThreadSafe<T> {
    /// Wrap an **already-protected** `T`. Use when the protect was taken
    /// elsewhere (e.g. inside `from_js_maybe_async(.., is_async=true)`).
    #[inline]
    pub fn adopt(value: T) -> Self {
        Self(value)
    }
}

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
        self.0.unprotect();
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

/// `node.PathLike` (types.zig:532) — `union(enum)`.
pub enum PathLike {
    String(PathString),
    Buffer(MarkedArrayBuffer),
    SliceWithUnderlyingString(SliceWithUnderlyingString),
    ThreadsafeString(SliceWithUnderlyingString),
    EncodedSlice(ZigStringSlice),
}

impl Default for PathLike {
    #[inline]
    fn default() -> Self {
        PathLike::String(PathString::empty())
    }
}

impl Clone for PathLike {
    /// Zig `PathLike` is bitwise-copy; the Rust port bumps any owning ref so
    /// the clone is independently droppable *and* `clone().slice()` returns
    /// the same bytes as the original.
    fn clone(&self) -> Self {
        match self {
            Self::String(s) => Self::String(*s),
            Self::Buffer(b) => Self::Buffer(MarkedArrayBuffer {
                buffer: b.buffer,
                // The clone borrows the JS-owned backing store; only the
                // original (if any) owns the allocation.
                owns_buffer: false,
            }),
            Self::SliceWithUnderlyingString(s) => {
                // `dupe_ref()` alone leaves `utf8` empty (lib.rs:1603) — a
                // cloned PathLike would then return b"" from `slice()`. Clone
                // the utf8 view explicitly (bumps a WTF ref / copies an owned
                // buffer) alongside the bumped `underlying` ref.
                Self::SliceWithUnderlyingString(SliceWithUnderlyingString {
                    utf8: s.utf8.clone_ref(),
                    underlying: s.underlying.dupe_ref(),
                    #[cfg(debug_assertions)]
                    did_report_extra_memory_debug: s.did_report_extra_memory_debug,
                })
            }
            Self::ThreadsafeString(s) => Self::ThreadsafeString(SliceWithUnderlyingString {
                utf8: s.utf8.clone_ref(),
                underlying: s.underlying.dupe_ref(),
                #[cfg(debug_assertions)]
                did_report_extra_memory_debug: s.did_report_extra_memory_debug,
            }),
            Self::EncodedSlice(s) => Self::EncodedSlice(s.clone_ref()),
        }
    }
}

impl Drop for PathLike {
    fn drop(&mut self) {
        match self {
            // `PathString` is a borrowed (ptr,len) pair; `MarkedArrayBuffer`
            // is JS-GC-owned. Neither needs an explicit release here.
            Self::String(_) | Self::Buffer(_) => {}
            Self::SliceWithUnderlyingString(s) | Self::ThreadsafeString(s) => {
                core::mem::take(s).deinit();
            }
            // `ZigStringSlice` releases its WTF ref / owned buffer in its own
            // `Drop`.
            Self::EncodedSlice(_) => {}
        }
    }
}

impl PathLike {
    /// Zig parity: `pathlike == .string`.
    #[inline]
    pub fn is_string(&self) -> bool {
        matches!(self, Self::String(_))
    }

    #[inline]
    pub fn slice(&self) -> &[u8] {
        match self {
            Self::String(s) => s.slice(),
            Self::Buffer(b) => b.slice(),
            Self::SliceWithUnderlyingString(s) | Self::ThreadsafeString(s) => s.slice(),
            Self::EncodedSlice(s) => s.slice(),
        }
    }

    pub fn estimated_size(&self) -> usize {
        match self {
            Self::String(s) => s.estimated_size(),
            Self::Buffer(b) => b.slice().len(),
            Self::SliceWithUnderlyingString(_) | Self::ThreadsafeString(_) => 0,
            Self::EncodedSlice(s) => s.slice().len(),
        }
    }

    /// `PathLike.toThreadSafe()` (types.zig:557) — promote any borrowed-JS
    /// payload to a thread-safe representation. For `Buffer` the variant is
    /// kept and the backing JS value is `protect()`ed (paired with
    /// [`Unprotect::unprotect`]); the discriminant is preserved so callers
    /// matching on `Buffer` after this call see the same shape as Zig.
    ///
    /// Prefer [`Self::into_thread_safe`] which returns a [`ThreadSafe`] guard;
    /// this in-place form exists for nested calls from container types'
    /// `to_thread_safe`.
    pub fn to_thread_safe(&mut self) {
        match self {
            Self::SliceWithUnderlyingString(s) => {
                s.to_thread_safe();
                let owned = core::mem::take(s);
                *self = Self::ThreadsafeString(owned);
            }
            Self::Buffer(b) => {
                b.buffer.value.protect();
            }
            Self::String(_) | Self::ThreadsafeString(_) | Self::EncodedSlice(_) => {}
        }
    }

    /// Consuming `to_thread_safe()`: protect any JS-backed buffer and return a
    /// guard that unprotects on drop. The Rust replacement for Zig's
    /// `args.toThreadSafe()` / `defer args.deinitAndUnprotect()` pair.
    #[inline]
    pub fn into_thread_safe(mut self) -> ThreadSafe<Self> {
        self.to_thread_safe();
        ThreadSafe::adopt(self)
    }
}

impl Unprotect for PathLike {
    /// `PathLike.deinitAndUnprotect()` (types.zig:571), JS-side half — undo
    /// the `protect()` taken by [`Self::to_thread_safe`] /
    /// `ArgumentsSlice::protect_eat`. Owned payloads are released by `Drop`.
    #[inline]
    fn unprotect(&mut self) {
        if let Self::Buffer(b) = self {
            b.buffer.value.unprotect();
        }
    }
}

/// `node.PathOrFileDescriptor` (types.zig:903) — `union(enum) { fd, path }`.
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

/// `PathOrFileDescriptor.SerializeTag` (types.zig:912) — `enum(u8)`.
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
    pub fn slice(&self) -> &[u8] {
        match self {
            Self::Fd(_) => b"",
            Self::Path(p) => p.slice(),
        }
    }

    #[inline]
    pub fn to_thread_safe(&mut self) {
        if let Self::Path(p) = self {
            p.to_thread_safe();
        }
    }

    /// Consuming `to_thread_safe()` — see [`PathLike::into_thread_safe`].
    #[inline]
    pub fn into_thread_safe(mut self) -> ThreadSafe<Self> {
        self.to_thread_safe();
        ThreadSafe::adopt(self)
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
    /// `PathOrFileDescriptor.deinitAndUnprotect()` (types.zig:934), JS-side half.
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
    /// Zig: `pathlike == .path`.
    #[inline]
    pub fn is_path(&self) -> bool {
        matches!(self, Self::Path(_))
    }

    /// Zig: `pathlike == .fd`.
    #[inline]
    pub fn is_fd(&self) -> bool {
        matches!(self, Self::Fd(_))
    }

    /// Unwrap the `Path` arm. Panics on `Fd` (mirrors Zig's `pathlike.path`
    /// direct field access, used only after the caller has matched on the tag).
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

    pub fn hash(&self) -> u64 {
        match self {
            Self::Path(path) => bun_wyhash::hash(path.slice()),
            // `Fd` is `#[repr(transparent)]` over its backing integer (`i32`
            // on posix, `u64` on Windows), so hashing `fd.0.to_ne_bytes()` is
            // byte-identical to the previous raw `from_raw_parts` reinterpret.
            Self::Fd(fd) => bun_wyhash::hash(&fd.0.to_ne_bytes()),
        }
    }
}
