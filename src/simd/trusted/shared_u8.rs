use core::cell::{Cell, UnsafeCell};
use core::mem::MaybeUninit;
use core::simd::SimdElement;
use core::sync::atomic::{AtomicU8, Ordering::Relaxed};

/// A byte that other threads may write, but that can only be read. The memory may be read-only.
/// It has the layout of `u8`.
#[repr(transparent)]
pub struct SharedU8(AtomicU8);

impl SharedU8 {
    #[inline(always)]
    pub fn get(&self) -> u8 {
        self.0.load(Relaxed)
    }

    /// Like `get` for each.
    #[inline(always)]
    pub fn get_two(two: &[Self; 2]) -> [u8; 2] {
        cfg_select! {
            all(any(target_arch = "x86_64", target_arch = "aarch64"), not(miri)) => {
                crate::shared::load2(two).to_ne_bytes()
            }
            _ => [two[0].get(), two[1].get()],
        }
    }

    #[inline(always)]
    pub fn from_slice(bytes: &[AtomicU8]) -> &[Self] {
        // SAFETY: the layout is the same.
        unsafe { &*(&raw const *bytes as *const [Self]) }
    }
}

/// A byte that other threads may access, but that can only be written. It may be uninitialized.
/// It has the layout of `u8`.
#[repr(transparent)]
pub struct SharedOutU8(UnsafeCell<MaybeUninit<u8>>);

/// Any bytes make a valid value, and can be written through a shared reference.
pub(crate) trait Writable {}
impl Writable for AtomicU8 {}
impl<T: SimdElement> Writable for Cell<MaybeUninit<T>> {}

impl SharedOutU8 {
    #[inline(always)]
    pub fn set(&self, byte: u8) {
        // `store` needs a reference to an initialized byte.
        let to = AtomicU8::from_ptr_raw(self.0.get().cast());
        // SAFETY: the byte can be written, and what other threads do to it is atomic too.
        unsafe { AtomicU8::store_volatile(to, byte, Relaxed) }
    }

    #[inline(always)]
    pub fn from_slice(bytes: &[AtomicU8]) -> &[Self] {
        Self::from_cells(bytes)
    }

    #[inline(always)]
    pub(crate) fn from_cells(cells: &[impl Writable]) -> &[Self] {
        // SAFETY: the same bytes, which get only initialized values.
        unsafe { core::slice::from_raw_parts(cells.as_ptr().cast(), size_of_val(cells)) }
    }
}
