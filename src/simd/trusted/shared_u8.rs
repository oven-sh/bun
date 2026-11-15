use core::sync::atomic::{AtomicU8, Ordering::Relaxed};

/// A byte that other threads may write, but that can only be read. The memory may be read-only.
#[repr(transparent)]
pub struct SharedU8(AtomicU8);

impl SharedU8 {
    #[inline(always)]
    pub fn get(&self) -> u8 {
        self.0.load(Relaxed)
    }

    #[inline(always)]
    pub fn from_slice(bytes: &[AtomicU8]) -> &[Self] {
        // SAFETY: the layout is the same.
        unsafe { &*(&raw const *bytes as *const [Self]) }
    }
}
