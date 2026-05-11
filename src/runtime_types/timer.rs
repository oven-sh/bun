use core::num::NonZeroUsize;
use core::sync::atomic::{AtomicUsize, Ordering};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct ImmediateTaskHandle(NonZeroUsize);

impl ImmediateTaskHandle {
    /// Build a non-null runtime timer handle from a raw address value.
    ///
    /// The handle is only pointer identity at this layer. Running the immediate
    /// task stays with `bun_runtime`, which owns `ImmediateObject`.
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct WtfTimerHandle(NonZeroUsize);

impl WtfTimerHandle {
    /// Build a non-null runtime timer handle from a raw address value.
    ///
    /// The handle is only pointer identity at this layer. Firing/cancelling
    /// the WTF timer stays with `bun_runtime`, which owns `WTFTimer`.
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
    pub fn from_ref<T>(value: &T) -> Self {
        Self::from_usize(core::ptr::from_ref(value).cast::<()>() as usize)
            .expect("reference pointer is non-null")
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

#[repr(transparent)]
pub struct ImminentWtfTimer(AtomicUsize);

impl ImminentWtfTimer {
    #[inline]
    pub const fn new() -> Self {
        Self(AtomicUsize::new(0))
    }

    #[inline]
    pub fn load(&self) -> Option<WtfTimerHandle> {
        WtfTimerHandle::from_usize(self.0.load(Ordering::SeqCst))
    }

    #[inline]
    pub fn take(&self) -> Option<WtfTimerHandle> {
        WtfTimerHandle::from_usize(self.0.swap(0, Ordering::SeqCst))
    }

    #[inline]
    pub fn try_set_if_empty(&self, timer: WtfTimerHandle) -> Result<(), Option<WtfTimerHandle>> {
        self.0
            .compare_exchange(0, timer.get(), Ordering::SeqCst, Ordering::SeqCst)
            .map(|_| ())
            .map_err(WtfTimerHandle::from_usize)
    }

    #[inline]
    pub fn clear_if_current(&self, timer: WtfTimerHandle) -> Result<(), Option<WtfTimerHandle>> {
        self.0
            .compare_exchange(timer.get(), 0, Ordering::SeqCst, Ordering::SeqCst)
            .map(|_| ())
            .map_err(WtfTimerHandle::from_usize)
    }
}

impl Default for ImminentWtfTimer {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn immediate_task_handle_rejects_null_and_preserves_pointer() {
        assert!(ImmediateTaskHandle::from_usize(0).is_none());

        let mut raw = 0u8;
        let ptr = core::ptr::from_mut(&mut raw);
        let handle = ImmediateTaskHandle::from_ptr(ptr).unwrap();

        assert_eq!(handle.as_ptr::<u8>(), ptr);
        assert_eq!(handle.get(), ptr.cast::<()>() as usize);
    }

    #[test]
    fn imminent_wtf_timer_is_atomic_optional_handle() {
        let mut raw = 0u8;
        let handle = WtfTimerHandle::from_ptr(core::ptr::from_mut(&mut raw)).unwrap();
        let imminent = ImminentWtfTimer::new();

        assert_eq!(imminent.load(), None);
        assert_eq!(imminent.try_set_if_empty(handle), Ok(()));
        assert_eq!(imminent.load(), Some(handle));
        assert_eq!(imminent.try_set_if_empty(handle), Err(Some(handle)));
        assert_eq!(imminent.clear_if_current(handle), Ok(()));
        assert_eq!(imminent.take(), None);
        assert_eq!(imminent.try_set_if_empty(handle), Ok(()));
        assert_eq!(imminent.take(), Some(handle));
        assert_eq!(imminent.load(), None);
    }
}
