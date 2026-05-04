//! "Copy on write" slice. There are many instances when it is desired to re-use
//! a slice, but doing so would make it unknown if that slice should be freed.
//! This structure, in release builds, is the same size as `&[T]`, but
//! stores one bit for if deinitialization should free the underlying memory.
//!
//! ```ignore
//! let str = CowSlice::<u8>::init_owned(Box::<[u8]>::from(b"hello!".as_slice()));
//! let borrow = str.borrow();
//! assert!(borrow.slice().as_ptr() == str.slice().as_ptr());
//! drop(borrow); // knows it is borrowed, no free
//! drop(str);    // calls free
//! ```
//!
//! In a debug build, there are aggressive assertions to ensure unintentional
//! frees do not happen. But in a release build, the developer is expected to
//! keep slice owners alive beyond the lifetimes of the borrowed instances.
//!
//! CowSlice does not support slices longer than `2^(usize::BITS - 1)`.

use core::ptr::NonNull;

use bun_alloc::AllocError;

/// "Copy on write" slice. See module docs.
pub type CowSlice<T> = CowSliceZ<T, false>;

/// "Copy on write" slice with optional sentinel termination. See module docs.
///
/// `Z = true` means the backing storage has a sentinel element at `[len]`
/// (the sentinel value is assumed to be the zero value of `T`).
// TODO(port): Zig's `comptime sentinel: ?T` allowed an arbitrary sentinel value;
// Rust const generics cannot express `Option<T>` for generic `T`, so this port
// uses a `bool` and assumes sentinel == 0 when `Z`. Revisit if a non-zero
// sentinel is ever needed.
pub struct CowSliceZ<T, const Z: bool> {
    /// Pointer to the underlying data. Do not access this directly.
    ///
    /// NOTE: `ptr` is logically const if data is borrowed.
    ptr: *mut T,
    flags: Flags,
    #[cfg(debug_assertions)]
    debug: Option<NonNull<DebugData>>,
    #[cfg(not(debug_assertions))]
    debug: (),
}

/// `packed struct(usize) { len: u(BITS-1), is_owned: bool }`
#[repr(transparent)]
#[derive(Clone, Copy)]
struct Flags(usize);

impl Flags {
    const IS_OWNED_BIT: usize = 1 << (usize::BITS - 1);
    const LEN_MASK: usize = !Self::IS_OWNED_BIT;

    #[inline]
    const fn new(len: usize, is_owned: bool) -> Self {
        debug_assert!(len <= Self::LEN_MASK);
        Self((len & Self::LEN_MASK) | if is_owned { Self::IS_OWNED_BIT } else { 0 })
    }

    #[inline]
    const fn len(self) -> usize {
        self.0 & Self::LEN_MASK
    }

    #[inline]
    const fn is_owned(self) -> bool {
        self.0 & Self::IS_OWNED_BIT != 0
    }

    #[inline]
    fn set_len(&mut self, len: usize) {
        debug_assert!(len <= Self::LEN_MASK);
        self.0 = (self.0 & Self::IS_OWNED_BIT) | (len & Self::LEN_MASK);
    }

    #[inline]
    fn set_is_owned(&mut self, v: bool) {
        if v {
            self.0 |= Self::IS_OWNED_BIT;
        } else {
            self.0 &= Self::LEN_MASK;
        }
    }
}

impl<T, const Z: bool> CowSliceZ<T, Z> {
    // TODO(port): Zig exposed `pub const Slice` / `SliceMut` associated type
    // aliases that switched on `sentinel` (`[:z]const T` vs `[]const T`). Rust
    // has no inherent associated type aliases; callers use `&[T]` / `&mut [T]`
    // directly. For `Z = true` the NUL is at `slice()[len]` in backing storage.

    pub const EMPTY: Self = Self::init_static(&[]);

    /// Create a new Cow that owns its allocation.
    ///
    /// `data` is transferred into the returned string, and must be freed with
    /// `Drop` when the string and its borrows are done being used.
    pub fn init_owned(data: Box<[T]>) -> Self {
        // PORT NOTE: Zig checked `allocation_scope.isInstance(allocator)` and
        // asserted ownership through `AllocationScope`. With the global mimalloc
        // allocator there is no scope to check; the `Box<[T]>` type already
        // proves unique ownership.
        let len = data.len();
        let ptr = Box::into_raw(data) as *mut T;
        Self {
            ptr,
            flags: Flags::new(len, true),
            #[cfg(debug_assertions)]
            debug: Some(DebugData::new_boxed()),
            #[cfg(not(debug_assertions))]
            debug: (),
        }
    }

    /// Create a new Cow that copies `data` into a new allocation.
    pub fn init_dupe(data: &[T]) -> Result<Self, AllocError>
    where
        T: Clone + Default,
    {
        // TODO(port): `allocator.dupeZ(T, data)` for `Z = true` — must allocate
        // len+1 with a trailing zero sentinel. `Vec::into_boxed_slice` shrinks
        // capacity to len, so the sentinel cannot live in spare capacity; the
        // Box must hold len+1 and `Flags::len`/`Drop`/`take_slice` must be
        // Z-aware (free len+1, expose len). Stubbed to plain dupe for now —
        // sentinel is NOT preserved.
        let bytes: Box<[T]> = Box::<[T]>::from(data);
        Ok(Self::init_owned(bytes))
    }

    /// Create a Cow that wraps a static slice.
    ///
    /// `Drop` is safe to call, but will have no effect.
    pub const fn init_static(data: &'static [T]) -> Self {
        Self {
            // SAFETY: const semantics are enforced by is_owned flag
            ptr: data.as_ptr() as *mut T,
            flags: Flags::new(data.len(), false),
            #[cfg(debug_assertions)]
            debug: None,
            #[cfg(not(debug_assertions))]
            debug: (),
        }
    }

    /// Returns `true` if this string owns its data.
    #[inline]
    pub fn is_owned(&self) -> bool {
        self.flags.is_owned()
    }

    /// Borrow this Cow's slice.
    pub fn slice(&self) -> &[T] {
        // SAFETY: `ptr` is valid for `len` elements for the lifetime of `self`.
        unsafe { core::slice::from_raw_parts(self.ptr, self.flags.len()) }
    }

    #[inline]
    pub fn length(&self) -> usize {
        self.flags.len()
    }

    /// Mutably borrow this `Cow`'s slice.
    ///
    /// Borrowed `Cow`s will be automatically converted to owned, incurring
    /// an allocation.
    pub fn slice_mut(&mut self) -> Result<&mut [T], AllocError>
    where
        T: Clone + Default,
    {
        if !self.is_owned() {
            self.into_owned()?;
        }
        // SAFETY: owned ⇒ `ptr` is uniquely owned and valid for `len` elements.
        Ok(unsafe { core::slice::from_raw_parts_mut(self.ptr, self.flags.len()) })
    }

    /// Mutably borrow this `Cow`'s slice, assuming it already owns its data.
    /// Calling this on a borrowed `Cow` invokes safety-checked Illegal Behavior.
    pub fn slice_mut_unsafe(&mut self) -> &mut [T] {
        debug_assert!(
            self.is_owned(),
            "CowSlice.slice_mut_unsafe cannot be called on Cows that borrow their data."
        );
        // SAFETY: caller contract — `self` is owned.
        unsafe { core::slice::from_raw_parts_mut(self.ptr, self.flags.len()) }
    }

    /// Take ownership over this string's allocation. `self` is left in a
    /// valid, empty state.
    ///
    /// Caller owns the returned memory and must deinitialize it when done.
    /// `self` may be re-used. An allocation will be incurred if and only if
    /// `self` is not owned.
    pub fn take_slice(&mut self) -> Result<Box<[T]>, AllocError>
    where
        T: Clone + Default,
    {
        if !self.is_owned() {
            self.into_owned()?;
        }
        let ptr = self.ptr;
        let len = self.flags.len();
        #[cfg(debug_assertions)]
        if self.is_owned() {
            if let Some(d) = self.debug.take() {
                // SAFETY: `d` was created via `Box::into_raw` in `init_owned`/`into_owned`.
                drop(unsafe { Box::from_raw(d.as_ptr()) });
            }
        }
        *self = Self::EMPTY;
        // SAFETY: owned ⇒ `ptr[..len]` was produced by `Box::into_raw`.
        Ok(unsafe { Box::from_raw(core::ptr::slice_from_raw_parts_mut(ptr, len)) })
    }

    /// Returns a new string that borrows this string's data.
    ///
    /// The borrowed string should be dropped so that debug assertions
    /// that perform `borrows` checks are performed.
    pub fn borrow(&self) -> Self {
        #[cfg(debug_assertions)]
        if let Some(debug) = self.debug {
            // SAFETY: `debug` is valid while the owning Cow is alive.
            let debug = unsafe { debug.as_ref() };
            let mut borrows = debug.mutex.lock();
            *borrows += 1;
        }
        Self {
            ptr: self.ptr,
            flags: Flags::new(self.flags.len(), false),
            #[cfg(debug_assertions)]
            debug: self.debug,
            #[cfg(not(debug_assertions))]
            debug: (),
        }
    }

    /// Returns a new string that borrows a subslice of this string.
    ///
    /// This is the Cow-equivalent of `&str[start..end]`.
    ///
    /// When `end` is `None`, the subslice will end at the end of the string.
    /// `end` must be less than or equal to `self.len`, and greater than or
    /// equal to `start`. The borrowed string should be dropped so that debug
    /// assertions get performed.
    pub fn borrow_subslice(&self, start: usize, end: Option<usize>) -> Self {
        let end_ = end.unwrap_or(self.flags.len());
        // TODO(port): Zig's sentinel-aware `str.ptr[start..end_ :s]` asserted
        // the sentinel is present at `end_`. No equivalent check here.
        let mut result = self.borrow();
        // SAFETY: const semantics are enforced by is_owned flag; `start <= end_ <= len`.
        result.ptr = unsafe { self.ptr.add(start) };
        result.flags.set_len(end_ - start);
        result
    }

    /// Make this Cow `owned` by duplicating its borrowed data. Does nothing
    /// if the Cow is already owned.
    pub fn to_owned(&mut self) -> Result<(), AllocError>
    where
        T: Clone + Default,
    {
        if !self.is_owned() {
            self.into_owned()?;
        }
        Ok(())
    }

    /// Make this Cow `owned` by duplicating its borrowed data. Panics if
    /// the Cow is already owned.
    #[inline(always)]
    fn into_owned(&mut self) -> Result<(), AllocError>
    where
        T: Clone + Default,
    {
        debug_assert!(!self.is_owned());

        // TODO(port): `allocator.dupeZ` for `Z = true` — see `init_dupe`.
        // Sentinel is NOT preserved in this stub.
        let bytes: Box<[T]> = Box::<[T]>::from(self.slice());
        self.ptr = Box::into_raw(bytes) as *mut T;
        // flags.len already correct (unchanged)
        self.flags.set_is_owned(true);

        #[cfg(debug_assertions)]
        {
            if let Some(debug) = self.debug {
                // SAFETY: `debug` is valid while the original owner is alive.
                let dbg = unsafe { debug.as_ref() };
                let mut borrows = dbg.mutex.lock();
                debug_assert!(*borrows > 0);
                *borrows -= 1;
                drop(borrows);
                self.debug = None;
            }
            self.debug = Some(DebugData::new_boxed());
        }

        Ok(())
    }

    /// Does not include debug safety checks.
    pub fn init_unchecked(data: &[T], is_owned: bool) -> Self {
        Self {
            // SAFETY: const semantics are enforced by is_owned flag
            ptr: data.as_ptr() as *mut T,
            flags: Flags::new(data.len(), is_owned),
            #[cfg(debug_assertions)]
            debug: None,
            #[cfg(not(debug_assertions))]
            debug: (),
        }
    }
}

impl<T, const Z: bool> Drop for CowSliceZ<T, Z> {
    /// Free this `Cow`'s allocation if it is owned.
    ///
    /// In debug builds, dropping borrowed strings performs debug
    /// checks. In release builds it is a no-op.
    fn drop(&mut self) {
        #[cfg(debug_assertions)]
        if let Some(debug) = self.debug {
            // SAFETY: `debug` is valid — owned Cows hold the box, borrowed Cows
            // are required (by contract) to be dropped before the owner.
            let dbg = unsafe { debug.as_ref() };
            // PORT NOTE: Zig asserted `debug.allocator.vtable == allocator.vtable`
            // here. With a single global allocator that check is moot.
            if self.is_owned() {
                let borrows = dbg.mutex.lock();
                // active borrows become invalid data
                debug_assert!(
                    *borrows == 0,
                    "Cannot drop a CowSlice with active borrows. Current borrow count: {}",
                    *borrows
                );
                drop(borrows);
                // SAFETY: owned ⇒ we created this via `Box::into_raw`.
                drop(unsafe { Box::from_raw(debug.as_ptr()) });
            } else {
                let mut borrows = dbg.mutex.lock();
                *borrows -= 1; // double deinit of a borrowed string would underflow
            }
        }
        if self.flags.is_owned() {
            // SAFETY: owned ⇒ `ptr[..len]` came from `Box::into_raw`.
            drop(unsafe {
                Box::from_raw(core::ptr::slice_from_raw_parts_mut(
                    self.ptr,
                    self.flags.len(),
                ))
            });
        }
    }
}

impl<const Z: bool> core::fmt::Display for CowSliceZ<u8, Z> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // PORT NOTE: Zig `writer.writeAll(str.slice())` wrote raw bytes.
        // `BStr` gives lossy Display over `[u8]` without UTF-8 validation.
        core::fmt::Display::fmt(bstr::BStr::new(self.slice()), f)
    }
}

#[cfg(debug_assertions)]
struct DebugData {
    /// Guards `borrows` (number of active borrows).
    // TODO(port): Zig used `bun.Mutex` with `borrows` as a separate field;
    // folded into the mutex payload here. Map to `bun_threading::Mutex` if
    // `parking_lot` is not the chosen primitive.
    mutex: parking_lot::Mutex<usize>,
}

#[cfg(debug_assertions)]
impl DebugData {
    fn new_boxed() -> NonNull<Self> {
        let b = Box::new(Self {
            mutex: parking_lot::Mutex::new(0),
        });
        // SAFETY: `Box::into_raw` never returns null.
        unsafe { NonNull::new_unchecked(Box::into_raw(b)) }
    }
}

// `comptime` size assertion: CowSlice should be the same size as a native slice
// (modulo the debug pointer).
#[cfg(not(debug_assertions))]
const _: () = assert!(
    core::mem::size_of::<CowSlice<u8>>() == core::mem::size_of::<&[u8]>(),
    "CowSlice should be the same size as a native slice"
);
#[cfg(debug_assertions)]
const _: () = assert!(
    core::mem::size_of::<CowSlice<u8>>() - core::mem::size_of::<Option<NonNull<DebugData>>>()
        == core::mem::size_of::<&[u8]>(),
    "CowSlice should be the same size as a native slice"
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cow_slice() {
        let mut str = CowSlice::<u8>::init_static(b"hello");
        assert!(!str.is_owned());
        assert_eq!(str.slice(), b"hello");

        let borrow = str.borrow();
        assert!(!borrow.is_owned());
        assert_eq!(borrow.slice(), b"hello");

        str.to_owned().unwrap();
        assert!(str.is_owned());
        assert_eq!(str.slice(), b"hello");

        drop(str);

        // borrow is unaffected by str being dropped
        assert_eq!(borrow.slice(), b"hello");
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/ptr/CowSlice.zig (320 lines)
//   confidence: medium
//   todos:      6
//   notes:      sentinel modeled as `const Z: bool` (Zig used `?T`); allocator params dropped (global mimalloc); DebugData shared via raw NonNull + Box::into_raw; dupeZ stubbed (sentinel dropped) — needs Z-aware backing-len in Drop/take_slice
// ──────────────────────────────────────────────────────────────────────────
