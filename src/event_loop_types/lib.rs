#![allow(dead_code)]

use core::ptr::NonNull;

bun_opaque::opaque_ffi! {
    pub struct MiniEventLoop;
}

#[repr(transparent)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MiniEventLoopHandle(NonNull<MiniEventLoop>);

impl MiniEventLoopHandle {
    /// Wrap a live `bun_event_loop::MiniEventLoop` pointer.
    ///
    /// # Safety
    /// `ptr` must point to a live MiniEventLoop that outlives every use of the
    /// handle. Effectful operations on the loop remain in `bun_event_loop`.
    #[inline(always)]
    pub unsafe fn from_raw(ptr: *mut ()) -> Self {
        let ptr = NonNull::new(ptr.cast::<MiniEventLoop>())
            .expect("MiniEventLoopHandle cannot wrap a null pointer");
        Self(ptr)
    }

    #[inline(always)]
    pub fn as_ptr(self) -> *mut MiniEventLoop {
        self.0.as_ptr()
    }

    #[inline(always)]
    pub fn as_void_ptr(self) -> *mut core::ffi::c_void {
        self.as_ptr().cast()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mini_event_loop_handle_preserves_pointer_shape() {
        assert_eq!(
            core::mem::size_of::<MiniEventLoopHandle>(),
            core::mem::size_of::<usize>()
        );

        let ptr = NonNull::<MiniEventLoop>::dangling().as_ptr().cast::<()>();
        let handle = unsafe { MiniEventLoopHandle::from_raw(ptr) };
        assert_eq!(handle.as_void_ptr(), ptr.cast::<core::ffi::c_void>());
    }
}
