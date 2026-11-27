use core::ffi::c_uint;
use core::ptr::NonNull;

use crate::Loop;

bun_core::declare_scope!(uws, visible);

// Windows (libuv) only. Use `JSC.EventLoopTimer` everywhere else.
bun_opaque::opaque_ffi! { pub struct Timer; }

impl Timer {
    pub fn create(loop_: &'static Loop) -> NonNull<Timer> {
        let t = us_create_timer(loop_, 0, 0);
        NonNull::new(t).unwrap_or_else(|| {
            panic!(
                "us_create_timer: returned null: {}",
                std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
            )
        })
    }

    pub fn set(&mut self, cb: Option<extern "C" fn(*mut Timer)>, ms: i32, repeat_ms: i32) {
        us_timer_set(self, cb, ms, repeat_ms);
    }

    pub unsafe fn close<const FALLTHROUGH: bool>(this: *mut Self) {
        bun_core::scoped_log!(uws, "Timer.deinit()");
        // SAFETY: `this` is a live timer handle; us_timer_close frees it.
        unsafe { us_timer_close(this, FALLTHROUGH as i32) };
    }
}

unsafe extern "C" {
    pub(crate) safe fn us_create_timer(
        loop_: &Loop,
        fallthrough: i32,
        ext_size: c_uint,
    ) -> *mut Timer;
    pub(crate) fn us_timer_close(timer: *mut Timer, fallthrough: i32);
    pub(crate) safe fn us_timer_set(
        timer: &mut Timer,
        cb: Option<extern "C" fn(*mut Timer)>,
        ms: i32,
        repeat_ms: i32,
    );
}
