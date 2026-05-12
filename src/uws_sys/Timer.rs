use core::ffi::{c_int, c_uint, c_void};
use core::marker::{PhantomData, PhantomPinned};
use core::mem::size_of;
use core::ptr::NonNull;

use crate::Loop;

bun_core::declare_scope!(uws, visible);

/// **DEPRECATED**
/// **DO NOT USE IN NEW CODE!**
///
/// Use `JSC.EventLoopTimer` instead.
///
/// This code will be deleted eventually! It is very inefficient on POSIX. On
/// Linux, it holds an entire file descriptor for every single timer. On macOS,
/// it's several system calls.
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
        // SAFETY: `loop_` is a valid loop pointer.
        let t = unsafe {
            us_create_timer(
                loop_,
                1,
                c_uint::try_from(size_of::<T>()).expect("int cast"),
            )
        };
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
        bun_core::scoped_log!(uws, "Timer.deinit()");
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
            // (`*?*anyopaque`) as `*?T`, deref, unwrap. The slot was allocated
            // with `size_of::<T>()` and written via [`set`] as a bare `T`, so
            // read it as `T` directly. Zig's `?*T` is one word with a null
            // niche, but Rust's `Option<*mut T>` is two words — wrapping in
            // `Option<T>` here over-reads and misinterprets the bytes. Callers
            // pass pointer-ish `T` and tolerate a (debug-asserted) null read
            // exactly as Zig's `.?` would.
            let slot: *mut T = us_timer_ext(self).cast();
            slot.read()
        }
    }
}

unsafe extern "C" {
    // `Loop` is a sized `#[repr(C)]` mirror (not an opaque ZST) — keep raw `*mut`
    // so the FFI boundary does not annotate `noalias` over real loop fields.
    pub fn us_create_timer(loop_: *mut Loop, fallthrough: i32, ext_size: c_uint) -> *mut Timer;
    pub safe fn us_timer_ext(timer: &mut Timer) -> *mut *mut c_void;
    pub fn us_timer_close(timer: *mut Timer, fallthrough: i32);
    pub safe fn us_timer_set(
        timer: &mut Timer,
        cb: Option<extern "C" fn(*mut Timer)>,
        ms: i32,
        repeat_ms: i32,
    );
    pub safe fn us_timer_loop(t: &mut Timer) -> *mut Loop;
}

// ported from: src/uws_sys/Timer.zig
