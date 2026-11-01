/// # Safety
/// Its JS buffers are pinned and GC-rooted and its strings thread-isolated: a work-pool job may read it and the JS thread drops it.
pub unsafe trait ThreadIsolatedArg {}

/// A `T` built as [`ThreadIsolatedArg`] describes.
pub struct ThreadIsolated<T>(T);

impl<T: ThreadIsolatedArg> ThreadIsolated<T> {
    /// # Safety
    /// `value` was built as [`ThreadIsolatedArg`] describes.
    #[inline]
    pub unsafe fn new(value: T) -> Self {
        Self(value)
    }
}

// SAFETY: `new`'s contract is exactly what makes the value sendable.
unsafe impl<T: ThreadIsolatedArg> Send for ThreadIsolated<T> {}

impl<T> core::ops::Deref for ThreadIsolated<T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        &self.0
    }
}

impl<T> core::ops::DerefMut for ThreadIsolated<T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut T {
        &mut self.0
    }
}
