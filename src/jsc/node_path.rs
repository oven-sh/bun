//! `node.PathLike` / `node.PathOrFileDescriptor` — single nominal definitions.
//!
//! LAYERING: ported from `src/runtime/node/types.zig:532-910`. Defined at the
//! `bun_jsc` tier because every variant payload (`PathString`, `Buffer` =
//! `MarkedArrayBuffer`, `SliceWithUnderlyingString`, `ZigStringSlice`, `Fd`)
//! is already reachable from this crate. `bun_runtime::node::types`
//! `pub use`s these and layers the JS-argument-parsing helpers (`from_js`,
//! `from_js_with_allocator`) on top via inherent impls in that crate.

use bun_string::{PathString, SliceWithUnderlyingString, ZigStringSlice};
use bun_sys::Fd;

use crate::array_buffer::MarkedArrayBuffer;

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
    /// [`Self::deinit_and_unprotect`]); the discriminant is preserved so
    /// callers matching on `Buffer` after this call see the same shape as Zig.
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

    /// `PathLike.deinitAndUnprotect()` (types.zig:571) — release owned
    /// payloads and undo the `protect()` taken by [`Self::to_thread_safe`] /
    /// `ArgumentsSlice::protect_eat`. Leaves `self` in the default state so
    /// the subsequent `Drop` is a no-op.
    pub fn deinit_and_unprotect(&mut self) {
        if let Self::Buffer(b) = self {
            b.buffer.value.unprotect();
        }
        // Dropping the taken value releases `SliceWithUnderlyingString` /
        // `ThreadsafeString` / `EncodedSlice` exactly as Zig's
        // `deinitAndUnprotect` does for those arms; nothing is reused.
        drop(core::mem::take(self));
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

    /// `PathOrFileDescriptor.deinitAndUnprotect()` (types.zig:934).
    #[inline]
    pub fn deinit_and_unprotect(&mut self) {
        if let Self::Path(p) = self {
            p.deinit_and_unprotect();
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
            Self::Fd(fd) => {
                // SAFETY: `Fd` is POD; reinterpret as bytes for hashing.
                let bytes = unsafe {
                    core::slice::from_raw_parts(
                        (fd as *const bun_sys::Fd).cast::<u8>(),
                        core::mem::size_of::<bun_sys::Fd>(),
                    )
                };
                bun_wyhash::hash(bytes)
            }
        }
    }
}
