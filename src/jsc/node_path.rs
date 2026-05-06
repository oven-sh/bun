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
    /// the clone is independently droppable.
    fn clone(&self) -> Self {
        match self {
            Self::String(s) => Self::String(*s),
            Self::Buffer(b) => Self::Buffer(MarkedArrayBuffer {
                buffer: b.buffer,
                // The clone borrows the JS-owned backing store; only the
                // original (if any) owns the allocation.
                owns_buffer: false,
            }),
            Self::SliceWithUnderlyingString(s) => Self::SliceWithUnderlyingString(s.dupe_ref()),
            Self::ThreadsafeString(s) => Self::ThreadsafeString(s.dupe_ref()),
            Self::EncodedSlice(s) => {
                Self::EncodedSlice(ZigStringSlice::init_owned(s.slice().to_vec()))
            }
        }
    }
}

impl Drop for PathLike {
    fn drop(&mut self) {
        match self {
            // `PathString` is a borrowed (ptr,len) pair; `MarkedArrayBuffer`
            // is JS-GC-owned. Neither needs an explicit release here.
            Self::String(_) | Self::Buffer(_) => {}
            Self::SliceWithUnderlyingString(s) | Self::ThreadsafeString(s) => s.deinit(),
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

    /// `PathLike.toThreadSafe()` (types.zig:599) — promote any borrowed-JS
    /// payload to an owned, thread-safe representation.
    pub fn to_thread_safe(&mut self) {
        match self {
            Self::SliceWithUnderlyingString(s) => {
                s.to_thread_safe();
                let owned = core::mem::take(s);
                *self = Self::ThreadsafeString(owned);
            }
            Self::Buffer(b) => {
                let bytes = b.slice().to_vec();
                *self = Self::EncodedSlice(ZigStringSlice::init_owned(bytes));
            }
            Self::String(_) | Self::ThreadsafeString(_) | Self::EncodedSlice(_) => {}
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

    #[inline]
    pub fn estimated_size(&self) -> usize {
        match self {
            Self::Fd(_) => 0,
            Self::Path(p) => p.estimated_size(),
        }
    }
}
