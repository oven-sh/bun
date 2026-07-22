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

#[cfg(debug_assertions)]
use core::ptr::NonNull;

use bun_alloc::AllocError;

/// "Copy on write" slice. See module docs.
pub type CowSlice<T> = CowSliceZ<T, false>;

/// "Copy on write" slice with optional sentinel termination. See module docs.
///
/// `Z = true` means the backing storage has a sentinel element at `[len]`
/// (the sentinel value is assumed to be the zero value of `T`, produced via
/// `T::default()`).
///
/// For `Z = true`, owned allocations are physically `len + 1` elements
/// (logical `len` plus the sentinel).
pub struct CowSliceZ<T: 'static, const Z: bool> {
    /// Pointer to the underlying data. Do not access this directly.
    ///
    /// NOTE: `ptr` is logically const if data is borrowed.
    ptr: *mut T,
    flags: Flags,
    #[cfg(debug_assertions)]
    debug: Option<NonNull<DebugData>>,
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

impl<T: 'static, const Z: bool> CowSliceZ<T, Z> {
    // T: 'static needed for `EMPTY` (init_static takes &'static [T]). All
    // concrete uses (u8, u16, Index, ...) satisfy this; relax if a borrowed-T
    // case ever appears.
    pub const EMPTY: Self = Self::init_static(&[]);

    /// Debug-only accessor for the heap-allocated borrow-tracking data.
    ///
    /// Single `unsafe` deref site for the set-once `Option<NonNull<DebugData>>`
    /// field; `borrow` / `into_owned` / `Drop` go through this instead of
    /// repeating the raw deref at each call site.
    #[cfg(debug_assertions)]
    #[inline]
    fn debug_data(&self) -> Option<&DebugData> {
        // SAFETY: `self.debug` is `Some` only when populated by `init_owned` /
        // `into_owned` with a fresh `heap::alloc`ed box. Owned cows free it
        // exclusively in `Drop`; borrowed cows share the owner's box, which by
        // API contract outlives every borrow. The returned `&DebugData` is tied
        // to `&self` and so cannot dangle past the `CowSliceZ` itself.
        self.debug.map(|d| unsafe { d.as_ref() })
    }

    // For `Z = true` the sentinel is at `slice()[len]` in the backing storage.

    /// Number of elements physically backing an owned allocation of logical
    /// length `len`: for `Z = true` the trailing sentinel adds one element.
    #[inline]
    const fn physical_len(len: usize) -> usize {
        len + Z as usize
    }

    /// Create a new Cow that owns its allocation.
    ///
    /// `data` is transferred into the returned string, and must be freed with
    /// `Drop` when the string and its borrows are done being used.
    ///
    /// For `Z = true`, `data` must include the trailing sentinel as its final
    /// element; the logical length is `data.len() - 1`.
    pub fn init_owned(data: Box<[T]>) -> Self {
        // The `Box<[T]>` type already proves unique ownership. The
        // `checked_sub` enforces the sentinel contract even in release builds:
        // an empty box for `Z = true` would otherwise underflow to a near-max
        // length and make `slice()` instant UB.
        let len = data
            .len()
            .checked_sub(Z as usize)
            .expect("CowSliceZ<_, true>::init_owned requires a trailing sentinel element");
        let ptr = bun_core::heap::into_raw(data).cast::<T>();
        Self {
            ptr,
            flags: Flags::new(len, true),
            #[cfg(debug_assertions)]
            debug: Some(DebugData::new_boxed()),
        }
    }

    /// Create a new Cow that copies `data` into a new allocation.
    ///
    /// For `Z = true`, the new allocation holds `data.len() + 1` elements
    /// with a trailing zero (`T::default()`) sentinel.
    pub fn init_dupe(data: &[T]) -> Result<Self, AllocError>
    where
        T: Clone + Default,
    {
        Ok(Self::init_owned(Self::dupe_maybe_z(data)))
    }

    /// Copy `data` into a fresh boxed slice, appending the zero sentinel when
    /// `Z = true`. `Vec::into_boxed_slice` shrinks capacity to length, so the
    /// sentinel is part of the box (physical `len + 1`), never spare capacity.
    fn dupe_maybe_z(data: &[T]) -> Box<[T]>
    where
        T: Clone + Default,
    {
        let mut vec = Vec::with_capacity(Self::physical_len(data.len()));
        vec.extend_from_slice(data);
        if Z {
            vec.push(T::default());
        }
        vec.into_boxed_slice()
    }

    /// Create a Cow that wraps a static slice.
    ///
    /// `Drop` is safe to call, but will have no effect.
    const fn init_static(data: &'static [T]) -> Self {
        Self {
            // SAFETY: const semantics are enforced by is_owned flag
            ptr: data.as_ptr().cast_mut(),
            flags: Flags::new(data.len(), false),
            #[cfg(debug_assertions)]
            debug: None,
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

    /// Take ownership over this string's allocation. `self` is left in a
    /// valid, empty state.
    ///
    /// Caller owns the returned memory and must deinitialize it when done.
    /// `self` may be re-used. An allocation will be incurred if and only if
    /// `self` is not owned.
    ///
    /// For `Z = true` the returned box includes the trailing sentinel element
    /// (its length is the logical length plus one).
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
                // SAFETY: `d` was created via `heap::alloc` in `init_owned`/`into_owned`.
                drop(unsafe { bun_core::heap::take(d.as_ptr()) });
            }
        }
        // `*self = Self::EMPTY` would run `Drop` on the old value first and
        // free the very `ptr[..len]` allocation we are about to hand back.
        // `ManuallyDrop::new(mem::replace(..))` resets `self` without dropping.
        let _ = core::mem::ManuallyDrop::new(core::mem::replace(self, Self::EMPTY));
        // SAFETY: owned ⇒ `ptr[..physical_len(len)]` was produced by `heap::alloc`
        // (owned Z-cows always physically hold `len + 1` elements).
        Ok(unsafe {
            bun_core::heap::take(core::ptr::slice_from_raw_parts_mut(
                ptr,
                Self::physical_len(len),
            ))
        })
    }

    /// Returns a new string that borrows this string's data.
    ///
    /// The borrowed string should be dropped so that debug assertions
    /// that perform `borrows` checks are performed.
    pub fn borrow(&self) -> Self {
        #[cfg(debug_assertions)]
        if let Some(debug) = self.debug_data() {
            let mut borrows = debug.mutex.lock();
            *borrows += 1;
        }
        Self {
            ptr: self.ptr,
            flags: Flags::new(self.flags.len(), false),
            #[cfg(debug_assertions)]
            debug: self.debug,
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
        // Asserting the sentinel is present at `end_` would force a
        // `PartialEq + Default` bound on every caller, so the `Z = true` path
        // skips that debug assertion.
        let mut result = self.borrow();
        // SAFETY: const semantics are enforced by is_owned flag; `start <= end_ <= len`.
        result.ptr = unsafe { self.ptr.add(start) };
        result.flags.set_len(end_ - start);
        result
    }

    /// Make this Cow `owned` by duplicating its borrowed data. Panics if
    /// the Cow is already owned.
    #[inline(always)]
    fn into_owned(&mut self) -> Result<(), AllocError>
    where
        T: Clone + Default,
    {
        debug_assert!(!self.is_owned());

        // For `Z = true` the duplicate gets a fresh trailing zero sentinel
        // (see `dupe_maybe_z`).
        let bytes: Box<[T]> = Self::dupe_maybe_z(self.slice());
        self.ptr = bun_core::heap::into_raw(bytes).cast::<T>();
        // flags.len already correct (unchanged)
        self.flags.set_is_owned(true);

        #[cfg(debug_assertions)]
        {
            if let Some(dbg) = self.debug_data() {
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
    ///
    /// `data` is the logical slice. For `Z = true` with `is_owned = true`, the
    /// backing allocation must physically hold `data.len() + 1` elements (the
    /// sentinel beyond the slice), as `Drop` frees the physical length.
    pub fn init_unchecked(data: &[T], is_owned: bool) -> Self {
        Self {
            // SAFETY: const semantics are enforced by is_owned flag
            ptr: data.as_ptr().cast_mut(),
            flags: Flags::new(data.len(), is_owned),
            #[cfg(debug_assertions)]
            debug: None,
        }
    }
}

impl<T: 'static, const Z: bool> Drop for CowSliceZ<T, Z> {
    /// Free this `Cow`'s allocation if it is owned.
    ///
    /// In debug builds, dropping borrowed strings performs debug
    /// checks. In release builds it is a no-op.
    fn drop(&mut self) {
        #[cfg(debug_assertions)]
        if let Some(dbg) = self.debug_data() {
            if self.is_owned() {
                let borrows = dbg.mutex.lock();
                // active borrows become invalid data
                debug_assert!(
                    *borrows == 0,
                    "Cannot drop a CowSlice with active borrows. Current borrow count: {}",
                    *borrows
                );
                drop(borrows);
                // SAFETY: owned ⇒ we created this via `heap::alloc`.
                drop(unsafe { bun_core::heap::take(self.debug.unwrap().as_ptr()) });
            } else {
                let mut borrows = dbg.mutex.lock();
                *borrows -= 1; // double deinit of a borrowed string would underflow
            }
        }
        if self.flags.is_owned() {
            // SAFETY: owned ⇒ `ptr[..physical_len(len)]` came from `heap::alloc`
            // (owned Z-cows always physically hold `len + 1` elements).
            drop(unsafe {
                bun_core::heap::take(core::ptr::slice_from_raw_parts_mut(
                    self.ptr,
                    Self::physical_len(self.flags.len()),
                ))
            });
        }
    }
}

impl<const Z: bool> core::fmt::Display for CowSliceZ<u8, Z> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // `BStr` gives lossy Display over `[u8]` without UTF-8 validation.
        core::fmt::Display::fmt(bstr::BStr::new(self.slice()), f)
    }
}

#[cfg(debug_assertions)]
struct DebugData {
    /// Guards `borrows` (number of active borrows).
    // `bun_core::Mutex` (poison-free `std::sync` wrapper) is used because
    // `bun_ptr` sits below `bun_threading`.
    mutex: bun_core::Mutex<usize>,
}

#[cfg(debug_assertions)]
impl DebugData {
    fn new_boxed() -> NonNull<Self> {
        bun_core::heap::into_raw_nn(Box::new(Self {
            mutex: bun_core::Mutex::new(0),
        }))
    }
}

// Compile-time size assertion: CowSlice should be the same size as a native slice
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

        str.into_owned().unwrap();
        assert!(str.is_owned());
        assert_eq!(str.slice(), b"hello");

        drop(str);

        // borrow is unaffected by str being dropped
        assert_eq!(borrow.slice(), b"hello");
    }

    /// Exercises every `Z = true` path so the sentinel-aware alloc/free
    /// symmetry (physical `len + 1` everywhere) is monomorphized, compiled,
    /// and run — there are no other in-tree instantiations of `Z = true`.
    #[test]
    fn cow_slice_z_sentinel() {
        // init_dupe: physical len + 1 with trailing 0 sentinel.
        let mut str = CowSliceZ::<u8, true>::init_dupe(b"hello").unwrap();
        assert!(str.is_owned());
        assert_eq!(str.length(), 5);
        assert_eq!(str.slice(), b"hello");
        // SAFETY: owned Z-cows physically hold `len + 1` elements; index
        // `len` is the sentinel.
        assert_eq!(unsafe { *str.slice().as_ptr().add(str.length()) }, 0);

        // borrow → to_owned re-dupes through the sentinel-aware path.
        let mut borrow = str.borrow();
        assert!(!borrow.is_owned());
        assert_eq!(borrow.slice(), b"hello");
        borrow.into_owned().unwrap();
        assert!(borrow.is_owned());
        assert_eq!(borrow.slice(), b"hello");
        // SAFETY: owned Z-cow ⇒ sentinel at index `len`.
        assert_eq!(unsafe { *borrow.slice().as_ptr().add(borrow.length()) }, 0);
        drop(borrow);

        // take_slice hands back the physical allocation: logical len + sentinel.
        let boxed = str.take_slice().unwrap();
        assert_eq!(boxed.len(), 6);
        assert_eq!(&boxed[..5], b"hello");
        assert_eq!(boxed[5], 0);
        // `str` was reset to empty and is safe to reuse/drop.
        assert_eq!(str.slice(), b"");

        // init_owned round-trips the sentinel-carrying box; Drop frees len + 1
        // (an alloc/free length mismatch here would abort under ASAN/debug heap).
        let owned = CowSliceZ::<u8, true>::init_owned(boxed);
        assert_eq!(owned.length(), 5);
        assert_eq!(owned.slice(), b"hello");
        drop(owned);
    }
}
