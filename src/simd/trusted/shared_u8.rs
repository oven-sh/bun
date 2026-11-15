use core::sync::atomic::{AtomicU8, Ordering::Relaxed};

/// A byte that other threads may write, but that can only be read. The memory may be read-only.
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
