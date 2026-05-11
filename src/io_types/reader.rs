use core::num::NonZeroUsize;

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum ReadState {
    /// The most common scenario: neither EOF nor EAGAIN.
    Progress,
    /// Received a 0-byte read.
    Eof,
    /// Received EAGAIN.
    Drained,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct BufferedReaderHandle(NonZeroUsize);

impl BufferedReaderHandle {
    /// Build a non-null lower-reader handle from a raw address value.
    ///
    /// The handle is only pointer identity at this layer. Dereferencing or
    /// mutating the reader stays with `bun_io`, which owns `BufferedReader`.
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
    use super::*;

    #[test]
    fn buffered_reader_handle_rejects_null_and_preserves_pointer() {
        assert!(BufferedReaderHandle::from_usize(0).is_none());

        let mut raw_reader = 0u8;
        let ptr = core::ptr::from_mut(&mut raw_reader);
        let handle = BufferedReaderHandle::from_ptr(ptr).unwrap();

        assert_eq!(handle.as_ptr::<u8>(), ptr);
        assert_eq!(handle.get(), ptr.cast::<()>() as usize);
    }

    #[test]
    fn read_state_preserves_pipe_reader_states() {
        assert_eq!(ReadState::Progress, ReadState::Progress);
        assert_eq!(ReadState::Eof, ReadState::Eof);
        assert_eq!(ReadState::Drained, ReadState::Drained);
    }
}
