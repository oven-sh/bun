use core::ptr::NonNull;

bun_opaque::opaque_ffi! {
    pub struct JsEventLoop;
    pub struct VirtualMachine;
}

#[repr(transparent)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct JsEventLoopHandle(*mut JsEventLoop);

impl JsEventLoopHandle {
    /// Wrap a live `bun_jsc::event_loop::EventLoop` pointer.
    ///
    /// # Safety
    /// Non-null pointers must point to a live JSC event loop that outlives
    /// every use of the handle. A null pointer is permitted only as the legacy
    /// struct-default sentinel used by constructors that overwrite the field
    /// before any effectful dispatch.
    #[inline(always)]
    pub unsafe fn from_raw(ptr: *mut ()) -> Self {
        Self(ptr.cast::<JsEventLoop>())
    }

    #[inline(always)]
    pub fn as_ptr(self) -> *mut JsEventLoop {
        self.0
    }

    #[inline(always)]
    pub fn as_void_ptr(self) -> *mut core::ffi::c_void {
        self.as_ptr().cast()
    }
}

#[repr(transparent)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VirtualMachineHandle(NonNull<VirtualMachine>);

impl VirtualMachineHandle {
    /// Wrap a live `bun_jsc::VirtualMachine` pointer.
    ///
    /// # Safety
    /// `ptr` must point to a live VirtualMachine that outlives every use of the
    /// handle. VM effects remain in `bun_jsc`.
    #[inline(always)]
    pub unsafe fn from_raw(ptr: *mut ()) -> Self {
        let ptr = NonNull::new(ptr.cast::<VirtualMachine>())
            .expect("VirtualMachineHandle cannot wrap a null pointer");
        Self(ptr)
    }

    #[inline(always)]
    pub fn as_ptr(self) -> *mut VirtualMachine {
        self.0.as_ptr()
    }

    #[inline(always)]
    pub fn as_void_ptr(self) -> *mut core::ffi::c_void {
        self.as_ptr().cast()
    }
}
