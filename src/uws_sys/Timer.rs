use core::ffi::{c_uint, c_void};
use core::mem::size_of;
use core::ptr::NonNull;

use crate::Loop;

bun_core::declare_scope!(uws, visible);

// Windows (libuv) only. Use `JSC.EventLoopTimer` everywhere else.
bun_opaque::opaque_ffi! { pub struct Timer; }

impl Timer {
    pub fn create<T>(loop_: &mut Loop, _ptr: T) -> NonNull<Timer> {
        // SAFETY: `loop_` is a valid loop pointer.
        let t = unsafe {
            us_create_timer(
                loop_,
                0,
                c_uint::try_from(size_of::<T>()).expect("int cast"),
            )
        };
        NonNull::new(t).unwrap_or_else(|| {
            panic!(
                "us_create_timer: returned null: {}",
                std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
            )
        })
    }

    pub fn set<T>(
        &mut self,
        ptr: T,
        cb: Option<extern "C" fn(*mut Timer)>,
        ms: i32,
        repeat_ms: i32,
    ) {
        // SAFETY: ext storage was allocated with size_of::<T>() in create();
        // caller guarantees T matches.
        unsafe {
            us_timer_set(self, cb, ms, repeat_ms);
            let value_ptr = us_timer_ext(self);
            (value_ptr.cast::<T>()).write(ptr);
        }
    }

    pub unsafe fn close<const FALLTHROUGH: bool>(this: *mut Self) {
        bun_core::scoped_log!(uws, "Timer.deinit()");
        // SAFETY: `this` is a live timer handle; us_timer_close frees it.
        unsafe { us_timer_close(this, FALLTHROUGH as i32) };
    }
}

unsafe extern "C" {
    pub(crate) fn us_create_timer(
        loop_: *mut Loop,
        fallthrough: i32,
        ext_size: c_uint,
    ) -> *mut Timer;
    pub(crate) safe fn us_timer_ext(timer: &mut Timer) -> *mut *mut c_void;
    pub(crate) fn us_timer_close(timer: *mut Timer, fallthrough: i32);
    pub(crate) safe fn us_timer_set(
        timer: &mut Timer,
        cb: Option<extern "C" fn(*mut Timer)>,
        ms: i32,
        repeat_ms: i32,
    );
}
