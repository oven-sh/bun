use core::ffi::{c_uint, c_void};
use core::mem::size_of;
use core::ptr::NonNull;

use crate::Loop;

bun_core::declare_scope!(uws, visible);

// **DEPRECATED**
// **DO NOT USE IN NEW CODE!**
//
// Use `JSC.EventLoopTimer` instead.
//
// Windows (libuv) only. On epoll/kqueue this type no longer exists: it held an
// entire file descriptor per timer on Linux, and cost several system calls per
// arm on macOS.
bun_opaque::opaque_ffi! { pub struct Timer; }

impl Timer {
    pub fn create<T>(loop_: &mut Loop, _ptr: T) -> NonNull<Timer> {
        // never fallthrough poll
        // the problem is uSockets hardcodes it on the other end
        // so we can never free non-fallthrough polls
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

    // Not `impl Drop` — FFI opaque handle with a const-generic param;
    // destruction is an explicit C call and Drop cannot take parameters. Per PORTING.md
    // FFI-handle exception, expose `unsafe fn close(*mut Self)` instead of `deinit(&mut self)`.
    pub unsafe fn close<const FALLTHROUGH: bool>(this: *mut Self) {
        bun_core::scoped_log!(uws, "Timer.deinit()");
        // SAFETY: `this` is a live timer handle; us_timer_close frees it (caller must not
        // use `this` afterward).
        unsafe { us_timer_close(this, FALLTHROUGH as i32) };
    }
}

unsafe extern "C" {
    // `Loop` is a sized `#[repr(C)]` mirror (not an opaque ZST) — keep raw `*mut`
    // so the FFI boundary does not annotate `noalias` over real loop fields.
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
