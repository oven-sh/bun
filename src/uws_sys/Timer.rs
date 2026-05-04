use core::ffi::{c_int, c_uint, c_void};
use core::marker::{PhantomData, PhantomPinned};
use core::mem::size_of;
use core::ptr::NonNull;

use crate::Loop;

bun_output::declare_scope!(uws, visible);

/// **DEPRECATED**
/// **DO NOT USE IN NEW CODE!**
///
/// Use `JSC.EventLoopTimer` instead.
///
/// This code will be deleted eventually! It is very inefficient on POSIX. On
/// Linux, it holds an entire file descriptor for every single timer. On macOS,
/// it's several system calls.
#[repr(C)]
pub struct Timer {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl Timer {
    pub fn create<T>(loop_: &mut Loop, _ptr: T) -> NonNull<Timer> {
        // never fallthrough poll
        // the problem is uSockets hardcodes it on the other end
        // so we can never free non-fallthrough polls
        // SAFETY: loop_ is a valid live Loop handle; us_create_timer is sound for any ext_size.
        let t = unsafe { us_create_timer(loop_, 0, c_uint::try_from(size_of::<T>()).unwrap()) };
        NonNull::new(t).unwrap_or_else(|| {
            // TODO(port): use bun_sys errno accessor instead of std::io
            panic!(
                "us_create_timer: returned null: {}",
                std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
            )
        })
    }

    pub fn create_fallthrough<T>(loop_: &mut Loop, _ptr: T) -> NonNull<Timer> {
        // never fallthrough poll
        // the problem is uSockets hardcodes it on the other end
        // so we can never free non-fallthrough polls
        // SAFETY: loop_ is a valid live Loop handle; us_create_timer is sound for any ext_size.
        let t = unsafe { us_create_timer(loop_, 1, c_uint::try_from(size_of::<T>()).unwrap()) };
        NonNull::new(t).unwrap_or_else(|| {
            // TODO(port): use bun_sys errno accessor instead of std::io
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
        unsafe {
            us_timer_set(self, cb, ms, repeat_ms);
            let value_ptr = us_timer_ext(self);
            // SAFETY: ext storage was allocated with size_of::<T>() in create();
            // @setRuntimeSafety(false) in Zig — caller guarantees T matches.
            (value_ptr.cast::<T>()).write(ptr);
        }
    }

    // PORT NOTE: not `impl Drop` — FFI opaque handle with a const-generic param;
    // destruction is an explicit C call and Drop cannot take parameters. Per PORTING.md
    // FFI-handle exception, expose `unsafe fn close(*mut Self)` instead of `deinit(&mut self)`.
    pub unsafe fn close<const FALLTHROUGH: bool>(this: *mut Self) {
        bun_output::scoped_log!(uws, "Timer.deinit()");
        // SAFETY: `this` is a live timer handle; us_timer_close frees it (caller must not
        // use `this` afterward).
        unsafe { us_timer_close(this, FALLTHROUGH as i32) };
    }

    pub fn ext<T>(&mut self) -> Option<&mut T> {
        unsafe {
            // SAFETY: us_timer_ext returns a pointer to the ext slot (`*?*anyopaque`);
            // deref + unwrap, then cast to *mut T. Caller guarantees T matches the
            // type used at create()/set().
            let slot: *mut Option<NonNull<c_void>> = us_timer_ext(self).cast();
            Some(&mut *(*slot).expect("unreachable").as_ptr().cast::<T>())
        }
    }

    // PORT NOTE: Zig name is `as`, which is a Rust keyword.
    pub fn as_<T>(&mut self) -> T {
        unsafe {
            // SAFETY: @setRuntimeSafety(false) in Zig — reinterpret the ext slot
            // (`*?*anyopaque`) as `*?T`, deref, unwrap. Caller guarantees the slot
            // holds a valid Option<T> bit-pattern (T is expected to be a pointer-like).
            let slot: *mut Option<T> = us_timer_ext(self).cast();
            slot.read().expect("unreachable")
        }
    }
}

unsafe extern "C" {
    pub fn us_create_timer(loop_: *mut Loop, fallthrough: i32, ext_size: c_uint) -> *mut Timer;
    pub fn us_timer_ext(timer: *mut Timer) -> *mut *mut c_void;
    pub fn us_timer_close(timer: *mut Timer, fallthrough: i32);
    pub fn us_timer_set(
        timer: *mut Timer,
        cb: Option<extern "C" fn(*mut Timer)>,
        ms: i32,
        repeat_ms: i32,
    );
    pub fn us_timer_loop(t: *mut Timer) -> *mut Loop;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws_sys/Timer.zig (64 lines)
//   confidence: medium
//   todos:      2
//   notes:      ext()/as_() do unchecked type-punning of the ext slot; errno read uses std::io pending bun_sys accessor; deinit ported as unsafe close(*mut Self)
// ──────────────────────────────────────────────────────────────────────────
