//! `node.PathLike` / `node.PathOrFileDescriptor` — single nominal definitions.
//!
//! LAYERING: defined at the
//! `bun_jsc` tier because every variant payload (`Buffer` =
//! `PinnedArrayBuffer`, `Utf8WithString`, `Utf8Bytes`, `Fd`)
//! is already reachable from this crate. `bun_runtime::node::types`
//! `pub use`s these and layers the JS-argument-parsing helpers (`from_js`,
//! `from_js_with_allocator`) on top via inherent impls in that crate.

use bun_core::{Utf8Bytes, Utf8WithString};
use bun_sys::Fd;

use crate::array_buffer::PinnedArrayBuffer;

/// A `T` parsed for the async flavor: every JS-backed payload inside it is
/// pinned and GC-rooted ([`PinnedArrayBuffer::root`]) or thread-isolated
/// (strings), so a work-pool job may read it and the value comes back to the
/// JS thread to drop.
///
/// `repr(transparent)` so identity-casts in the const-generic dispatch macros
/// (see `node_fs.rs`'s `args_as!`) remain bit-exact.
#[repr(transparent)]
#[derive(Default)]
pub struct ThreadIsolated<T>(T);

impl<T> ThreadIsolated<T> {
    /// Wrap a `T` that already satisfies the invariant above (parsed with
    /// `Flavor::Async` / `will_be_async`, or passed through `make_thread_isolated`).
    #[inline]
    pub fn adopt(value: T) -> Self {
        Self(value)
    }
}

// SAFETY: this is what the type asserts — see the struct doc.
unsafe impl<T> Send for ThreadIsolated<T> {}

impl<T> core::ops::Deref for ThreadIsolated<T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        &self.0
    }
}

impl<T> core::ops::DerefMut for ThreadIsolated<T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut T {
        &mut self.0
    }
}

/// `node.PathLike`. Parsed from JS it is `PathLike<'static>`; `Utf8` may
/// instead borrow Rust-side bytes for a synchronous call ([`PathLike::borrowed`]).
pub enum PathLike<'a> {
    /// Pinned for the call; also GC-rooted when parsed for an async call.
    Buffer(PinnedArrayBuffer),
    /// Always shares its WTF string's bytes (built by `shared_or_utf8`);
    /// transcoded paths are `Utf8(Owned)`.
    String(Utf8WithString),
    ThreadIsolatedString(Utf8WithString),
    Utf8(Utf8Bytes<'a>),
}

impl Default for PathLike<'_> {
    #[inline]
    fn default() -> Self {
        PathLike::Utf8(Utf8Bytes::EMPTY)
    }
}

impl Clone for PathLike<'_> {
    /// `clone().slice()` returns the same bytes. String payloads bump their
    /// ref; a `Buffer` clone *borrows* its bytes — it owns no pin or GC root
    /// (clones are taken on work-pool threads too) and must not outlive `self`.
    fn clone(&self) -> Self {
        match self {
            // SAFETY: the pinned backing store cannot move or detach while `self` lives; see the doc above.
            Self::Buffer(b) => Self::Utf8(Utf8Bytes::Borrowed(unsafe {
                &*core::ptr::from_ref(b.slice())
            })),
            Self::String(s) => Self::String(s.clone()),
            Self::ThreadIsolatedString(s) => Self::ThreadIsolatedString(s.clone()),
            Self::Utf8(s) => Self::Utf8(s.clone()),
        }
    }
}

impl<'a> PathLike<'a> {
    #[inline]
    pub fn borrowed(bytes: &'a [u8]) -> PathLike<'a> {
        PathLike::Utf8(Utf8Bytes::Borrowed(bytes))
    }

    #[inline]
    pub fn owned(bytes: Vec<u8>) -> PathLike<'static> {
        PathLike::Utf8(Utf8Bytes::Owned(bytes))
    }

    /// The bytes as a `Vec<u8>`: moved out of [`PathLike::owned`], copied otherwise.
    pub fn into_vec(mut self) -> Vec<u8> {
        if let Self::Utf8(utf8) = &mut self {
            return core::mem::replace(utf8, Utf8Bytes::EMPTY).into_vec();
        }
        self.slice().to_vec()
    }

    #[inline]
    pub fn slice(&self) -> &[u8] {
        match self {
            Self::Buffer(b) => b.slice(),
            Self::String(s) | Self::ThreadIsolatedString(s) => s.slice(),
            Self::Utf8(s) => s.slice(),
        }
    }

    pub(crate) fn estimated_size(&self) -> usize {
        match self {
            Self::Buffer(b) => b.slice().len(),
            Self::String(_) | Self::ThreadIsolatedString(_) => 0,
            Self::Utf8(s) => s.slice().len(),
        }
    }
}

impl PathLike<'static> {
    /// Promote a JS-backed string to its thread-isolated representation. A
    /// `Buffer` parsed with `will_be_async` is already rooted.
    ///
    /// Called in place by the fs `args::*` types' `into_thread_isolated`, which
    /// wrap the result in a [`ThreadIsolated`].
    pub fn make_thread_isolated(&mut self) {
        if let Self::String(s) = self {
            s.make_thread_isolated();
            let owned = core::mem::take(s);
            *self = Self::ThreadIsolatedString(owned);
        }
    }

    /// For a path a `Blob` store keeps (dropped on any thread): a JS-backed
    /// string is replaced by a private copy never handed to JS; a `Buffer` is
    /// GC-rooted for good.
    pub fn thread_isolated_copy(mut self) -> Self {
        match &mut self {
            Self::String(s) | Self::ThreadIsolatedString(s) => {
                let s = core::mem::take(s).thread_isolated_copy();
                self = Self::ThreadIsolatedString(s);
            }
            Self::Buffer(b) => b.value.protect(),
            Self::Utf8(_) => {}
        }
        self
    }
}

/// `node.PathOrFileDescriptor`.
pub enum PathOrFileDescriptor<'a> {
    Fd(Fd),
    Path(PathLike<'a>),
}

impl Default for PathOrFileDescriptor<'_> {
    #[inline]
    fn default() -> Self {
        Self::Fd(Fd::INVALID)
    }
}

impl Clone for PathOrFileDescriptor<'_> {
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

impl PathOrFileDescriptor<'static> {
    #[inline]
    pub fn make_thread_isolated(&mut self) {
        if let Self::Path(p) = self {
            p.make_thread_isolated();
        }
    }
    #[inline]
    pub fn thread_isolated_copy(self) -> Self {
        match self {
            Self::Path(p) => Self::Path(p.thread_isolated_copy()),
            Self::Fd(fd) => Self::Fd(fd),
        }
    }
}

impl PathOrFileDescriptor<'_> {
    #[inline]
    pub fn estimated_size(&self) -> usize {
        match self {
            Self::Fd(_) => 0,
            Self::Path(p) => p.estimated_size(),
        }
    }
}

impl core::fmt::Display for PathOrFileDescriptor<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::Path(p) => write!(f, "{}", bstr::BStr::new(p.slice())),
            // `bun.FD.format` semantics — bare number / `[invalid_fd]` — via
            // `Display for Fd` (bun_core), not the derived `Debug`.
            Self::Fd(fd) => write!(f, "{}", fd),
        }
    }
}

impl<'a> PathOrFileDescriptor<'a> {
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
    pub fn path(&self) -> &PathLike<'a> {
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
