use core::num::NonZeroUsize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct ParentDeathWatchdogHandle(NonZeroUsize);

impl ParentDeathWatchdogHandle {
    #[inline]
    pub const fn from_usize(handle: usize) -> Option<Self> {
        match NonZeroUsize::new(handle) {
            Some(handle) => Some(Self(handle)),
            None => None,
        }
    }

    #[inline]
    pub fn from_ptr<T>(ptr: *mut T) -> Option<Self> {
        Self::from_usize(ptr.cast::<()>() as usize)
    }

    #[inline]
    pub const fn get(self) -> usize {
        self.0.get()
    }

    #[inline]
    pub fn as_ptr<T>(self) -> *mut T {
        self.0.get() as *mut T
    }
}

#[cfg(test)]
mod tests {
    use super::ParentDeathWatchdogHandle;

    #[test]
    fn parent_death_watchdog_handle_rejects_null_and_preserves_pointer() {
        assert!(ParentDeathWatchdogHandle::from_usize(0).is_none());

        let mut watchdog = 1u8;
        let ptr = core::ptr::from_mut(&mut watchdog);
        let handle = ParentDeathWatchdogHandle::from_ptr(ptr).unwrap();

        assert_eq!(handle.as_ptr::<u8>(), ptr);
    }
}
