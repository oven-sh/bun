use core::marker::PhantomData;

use bun_semver::{ExternalString, Version as SemverVersion};
use bun_install::PackageNameHash;

/// `extern struct { off: u32, len: u32 }` parameterized over the element type.
/// The element type is phantom-only (storage is just two u32s).
#[repr(C)]
pub struct ExternalSlice<T> {
    pub off: u32,
    pub len: u32,
    _marker: PhantomData<T>,
}

// Manual impls: the Zig `extern struct { off: u32, len: u32 }` is unconditionally
// copyable/comparable regardless of `Type`. `#[derive]` would add spurious `T: Copy`
// (etc.) bounds via `PhantomData<T>`, breaking by-value `self` methods for non-Copy `T`.
impl<T> Copy for ExternalSlice<T> {}
impl<T> Clone for ExternalSlice<T> {
    #[inline]
    fn clone(&self) -> Self { *self }
}
impl<T> PartialEq for ExternalSlice<T> {
    #[inline]
    fn eq(&self, other: &Self) -> bool { self.off == other.off && self.len == other.len }
}
impl<T> Eq for ExternalSlice<T> {}
impl<T> core::fmt::Debug for ExternalSlice<T> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("ExternalSlice").field("off", &self.off).field("len", &self.len).finish()
    }
}

impl<T> Default for ExternalSlice<T> {
    fn default() -> Self {
        Self { off: 0, len: 0, _marker: PhantomData }
    }
}

impl<T> ExternalSlice<T> {
    // Zig: `pub const Slice = @This();` — dropped (Self).
    // Zig: `pub const Child: type = Type;`
    // TODO(port): inherent associated types are unstable; callers should use the generic param directly.

    pub const INVALID: Self = Self {
        off: u32::MAX,
        len: u32::MAX,
        _marker: PhantomData,
    };

    #[inline]
    pub fn is_invalid(self) -> bool {
        self.off == u32::MAX && self.len == u32::MAX
    }

    #[inline]
    pub fn contains(self, id: u32) -> bool {
        id >= self.off && id < (self.len + self.off)
    }

    #[inline]
    pub fn get(self, in_: &[T]) -> &[T] {
        debug_assert!((self.off + self.len) as usize <= in_.len());
        // it should be impossible to address this out of bounds due to the minimum here
        &in_[self.off as usize..in_.len().min((self.off + self.len) as usize)]
    }

    #[inline]
    pub fn mut_(self, in_: &mut [T]) -> &mut [T] {
        debug_assert!((self.off + self.len) as usize <= in_.len());
        let end = in_.len().min((self.off + self.len) as usize);
        &mut in_[self.off as usize..end]
    }

    #[inline]
    pub fn begin(self) -> u32 {
        self.off
    }

    #[inline]
    pub fn end(self) -> u32 {
        self.off + self.len
    }

    pub fn init(buf: &[T], in_: &[T]) -> Self {
        // if cfg!(debug_assertions) {
        //     debug_assert!(buf.as_ptr() as usize <= in_.as_ptr() as usize);
        //     debug_assert!((in_.as_ptr() as usize + in_.len()) <= (buf.as_ptr() as usize + buf.len()));
        // }

        Self {
            off: ((in_.as_ptr() as usize - buf.as_ptr() as usize) / core::mem::size_of::<T>()) as u32,
            len: in_.len() as u32,
            _marker: PhantomData,
        }
    }
}

#[repr(C)]
#[derive(Copy, Clone, Default, Debug)]
pub struct ExternalStringMap {
    pub name: ExternalStringList,
    pub value: ExternalStringList,
}

pub type ExternalStringList = ExternalSlice<ExternalString>;
pub type ExternalPackageNameHashList = ExternalSlice<PackageNameHash>;
pub type VersionSlice = ExternalSlice<SemverVersion>;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/ExternalSlice.zig (73 lines)
//   confidence: high
//   todos:      1
//   notes:      `mut` renamed to `mut_` (Rust keyword); `Child` assoc type dropped (unstable inherent assoc types)
// ──────────────────────────────────────────────────────────────────────────
