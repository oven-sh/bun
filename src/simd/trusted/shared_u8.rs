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

mod sealed {
    pub trait Byte {
        fn get(&self) -> u8;
    }

    impl Byte for u8 {
        fn get(&self) -> u8 {
            *self
        }
    }

    impl Byte for super::SharedU8 {
        fn get(&self) -> u8 {
            self.get()
        }
    }
}

/// As many `u8` or `SharedU8` as fit. Returns the count. They may overlap with `to`.
#[inline(always)]
pub fn copy_to_shared(from: &[impl sealed::Byte], to: &[SharedOutU8]) -> usize {
    let len = from.len().min(to.len());
    cfg_select! {
        // To ThreadSanitizer, too, `memmove` is a copy that may not race.
        all(
            any(target_arch = "x86_64", target_arch = "aarch64"),
            not(any(miri, sanitize = "thread")),
        ) => {
            use core::ffi::c_void;
            unsafe extern "C" {
                fn memmove(to: *mut c_void, from: *const c_void, len: usize) -> *mut c_void;
            }
            /// To LLVM, `memmove` is a copy that may not race. It cannot look through this jump.
            /// A pointer to `memmove` would send all its callers through a stub, unless in PIE.
            #[unsafe(naked)]
            unsafe extern "C" fn jump(to: *const SharedOutU8, from: *const u8, len: usize) {
                core::arch::naked_asm!(
                    cfg_select! {
                        target_arch = "x86_64" => "jmp {}",
                        target_arch = "aarch64" => "b {}",
                    },
                    sym memmove,
                )
            }
            // SAFETY: both have `len` bytes. `memmove` accesses no others, whatever it reads.
            unsafe { jump(to.as_ptr(), from.as_ptr().cast(), len) };
        }
        _ => {
            let copy = |i: usize| to[i].set(from[i].get());
            match to.as_ptr().addr() < from.as_ptr().addr() {
                true => (0..len).for_each(copy),
                false => (0..len).rev().for_each(copy),
            }
        }
    }
    len
}
