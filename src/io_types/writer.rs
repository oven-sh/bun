use core::num::NonZeroUsize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct PipeWriterHandle(NonZeroUsize);

impl PipeWriterHandle {
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
    use super::PipeWriterHandle;

    #[test]
    fn pipe_writer_handle_rejects_null_and_preserves_pointer() {
        assert!(PipeWriterHandle::from_usize(0).is_none());

        let mut writer = 0u8;
        let ptr = core::ptr::from_mut(&mut writer);
        let handle = PipeWriterHandle::from_ptr(ptr).unwrap();

        assert_eq!(handle.as_ptr::<u8>(), ptr);
    }
}
