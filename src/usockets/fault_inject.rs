//! Fault injection for the `bsd_*` syscall wrappers, plus the one allocation
//! whose failure path is otherwise unreachable on an overcommitting kernel
//! (`US_FAULT_SSL_LOOP_BUFFER`).
//!
//! Compiled in only under `--cfg=socket_fault_injection`. When compiled out,
//! [`us_fault_check`] is a constant `false` and the optimizer drops every
//! reference. When compiled in but no rule is armed, the hot path is a single
//! acquire atomic load + predicted-not-taken branch.
//!
//! Rules are process-global so a rule armed from the JS thread also affects
//! the HTTP-client thread (fetch) and worker threads. Use `rule.target_fd` for
//! per-socket isolation.

// ═══════════════════════════════════════════════════════════════════════════
// Enabled build
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(socket_fault_injection)]
mod enabled {
    use core::cell::UnsafeCell;
    use core::ffi::{c_int, c_uint};
    use core::sync::atomic::{AtomicI32, Ordering};

    use libc::ssize_t;

    use crate::types::{Bun__lock, Bun__unlock, zig_mutex_t};

    // ── `enum us_fault_syscall` ────────────────────────────────────────────
    pub const US_FAULT_RECV: c_int = 0;
    pub const US_FAULT_SEND: c_int = 1;
    pub const US_FAULT_WRITEV: c_int = 2;
    pub const US_FAULT_SENDMSG: c_int = 3;
    pub const US_FAULT_RECVMSG: c_int = 4;
    pub const US_FAULT_CONNECT: c_int = 5;
    pub const US_FAULT_ACCEPT: c_int = 6;
    // Reserved: no bsd.c hooks yet, so the JS setter does not accept them.
    pub const US_FAULT_SOCKET: c_int = 7;
    pub const US_FAULT_CLOSE: c_int = 8;
    pub const US_FAULT_SHUTDOWN: c_int = 9;
    /// Not a syscall: the per-loop TLS plaintext buffer allocated once by
    /// `us_internal_init_loop_ssl_data`. Only `US_FAULT_ERRNO` applies.
    pub const US_FAULT_SSL_LOOP_BUFFER: c_int = 10;
    pub const US_FAULT_COUNT: c_int = 11;

    // ── `enum us_fault_action` ─────────────────────────────────────────────
    pub const US_FAULT_NONE: c_int = 0;
    /// return -1 and set errno = errno_value
    pub const US_FAULT_ERRNO: c_int = 1;
    /// recv/send: clamp the length to `clamp_bytes`, then run the real syscall.
    pub const US_FAULT_SHORT: c_int = 2;
    /// recv/recvmsg: return 0 (peer closed); send/sendmsg/writev: return 0.
    pub const US_FAULT_ZERO: c_int = 3;

    /// `struct us_fault_rule` — ABI-locked; crosses FFI via [`us_fault_set`].
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct us_fault_rule {
        pub action: c_int,
        pub errno_value: c_int,
        pub clamp_bytes: c_int,
        /// skip the first N matching calls before triggering
        pub after_n_calls: c_int,
        /// fire this many times then disarm; -1 = forever
        pub repeat: c_int,
        /// match only this fd; -1 = any
        pub target_fd: c_int,
    }

    impl us_fault_rule {
        const DISARMED: Self = Self {
            action: US_FAULT_NONE,
            errno_value: 0,
            clamp_bytes: 0,
            after_n_calls: 0,
            repeat: 0,
            target_fd: 0,
        };
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct UsFaultSlot {
        rule: us_fault_rule,
        calls_seen: c_int,
        fired: c_int,
    }

    impl UsFaultSlot {
        const ZERO: Self = Self {
            rule: us_fault_rule::DISARMED,
            calls_seen: 0,
            fired: 0,
        };
    }

    /// `Sync` wrapper over `UnsafeCell` for process-global mutable state.
    /// All mutation of the payload happens under `US_FAULT_LOCK`.
    #[repr(transparent)]
    struct SyncCell<T>(UnsafeCell<T>);
    // SAFETY: every access to the inner value is either an atomic (for
    // `us_fault_armed`) or serialized by `US_FAULT_LOCK`.
    unsafe impl<T> Sync for SyncCell<T> {}
    impl<T> SyncCell<T> {
        const fn new(v: T) -> Self {
            Self(UnsafeCell::new(v))
        }
        #[inline]
        fn get(&self) -> *mut T {
            self.0.get()
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    const ZIG_MUTEX_INIT: zig_mutex_t = 0;
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    const ZIG_MUTEX_INIT: zig_mutex_t = libc::OS_UNFAIR_LOCK_INIT;
    #[cfg(windows)]
    const ZIG_MUTEX_INIT: zig_mutex_t = core::ptr::null_mut();

    /// Lock-free fast-path flag. The release store pairs with the acquire load
    /// in [`us_fault_check`]; a reader that observes `1` then re-reads the rule
    /// under the lock in [`us_fault_hit`], so it never sees a torn rule.
    #[unsafe(no_mangle)]
    pub static us_fault_armed: AtomicI32 = AtomicI32::new(0);

    /// Process-global so rules armed on the JS thread also affect the HTTP
    /// client thread (fetch) and any worker threads. Per-socket isolation is
    /// provided by `rule.target_fd` instead.
    static US_FAULT_STATE: SyncCell<[UsFaultSlot; US_FAULT_COUNT as usize]> =
        SyncCell::new([UsFaultSlot::ZERO; US_FAULT_COUNT as usize]);

    /// Guards every access to `US_FAULT_STATE` so a re-arm on the JS thread
    /// cannot tear the rule out from under a faulting I/O thread. Only taken
    /// after the lock-free `us_fault_armed` fast path has passed.
    static US_FAULT_LOCK: SyncCell<zig_mutex_t> = SyncCell::new(ZIG_MUTEX_INIT);

    /// Caller must hold `US_FAULT_LOCK`.
    unsafe fn us_fault_recompute_armed() {
        let state = US_FAULT_STATE.get().cast::<UsFaultSlot>();
        let mut any: c_int = 0;
        for i in 0..US_FAULT_COUNT as usize {
            // SAFETY: caller holds `US_FAULT_LOCK`; `i` is in-bounds. Raw read
            // so we never form a `&` that could alias a caller's `&mut` slot.
            if unsafe { (*state.add(i)).rule.action } != US_FAULT_NONE {
                any = 1;
                break;
            }
        }
        us_fault_armed.store(any, Ordering::Release);
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn us_fault_set(sc: c_int, rule: *const us_fault_rule) {
        if sc as c_uint >= US_FAULT_COUNT as c_uint {
            return;
        }
        // SAFETY: `US_FAULT_LOCK` address is process-lifetime; the lock grants
        // exclusive access to `US_FAULT_STATE`. `rule` is a caller-owned
        // pointer to an initialized struct (caller contract).
        unsafe {
            Bun__lock(US_FAULT_LOCK.get());
            let slot = &mut (*US_FAULT_STATE.get())[sc as usize];
            slot.rule = *rule;
            slot.calls_seen = 0;
            slot.fired = 0;
            us_fault_recompute_armed();
            Bun__unlock(US_FAULT_LOCK.get());
        }
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn us_fault_clear(sc: c_int) {
        if sc as c_uint >= US_FAULT_COUNT as c_uint {
            return;
        }
        // SAFETY: lock grants exclusive access to `US_FAULT_STATE`.
        unsafe {
            Bun__lock(US_FAULT_LOCK.get());
            let slot = &mut (*US_FAULT_STATE.get())[sc as usize];
            slot.rule.action = US_FAULT_NONE;
            slot.calls_seen = 0;
            slot.fired = 0;
            us_fault_recompute_armed();
            Bun__unlock(US_FAULT_LOCK.get());
        }
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn us_fault_clear_all() {
        // SAFETY: lock grants exclusive access to `US_FAULT_STATE`.
        unsafe {
            Bun__lock(US_FAULT_LOCK.get());
            for slot in (*US_FAULT_STATE.get()).iter_mut() {
                slot.rule.action = US_FAULT_NONE;
            }
            us_fault_armed.store(0, Ordering::Release);
            Bun__unlock(US_FAULT_LOCK.get());
        }
    }

    /// Returns 1 when the caller should short-circuit with `*out` as the
    /// syscall's return value; 0 means proceed with the real syscall (with
    /// `*clamp` possibly reduced).
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn us_fault_hit(
        sc: c_int,
        fd: c_int,
        out: *mut ssize_t,
        clamp: *mut c_int,
    ) -> c_int {
        if sc as c_uint >= US_FAULT_COUNT as c_uint {
            return 0;
        }
        // Snapshot under the lock so the post-release match below acts on one
        // coherent rule even if another thread swaps it right after we unlock.
        let (rule, fire);
        // SAFETY: lock grants exclusive access to `US_FAULT_STATE`.
        unsafe {
            Bun__lock(US_FAULT_LOCK.get());
            let slot = &mut (*US_FAULT_STATE.get())[sc as usize];
            rule = slot.rule;
            let mut f = false;
            if rule.action != US_FAULT_NONE && (rule.target_fd < 0 || rule.target_fd == fd) {
                let seen = slot.calls_seen;
                slot.calls_seen += 1;
                if seen >= rule.after_n_calls {
                    let fired = slot.fired;
                    slot.fired += 1;
                    if rule.repeat >= 0 && fired >= rule.repeat {
                        slot.rule.action = US_FAULT_NONE;
                        us_fault_recompute_armed();
                    } else {
                        f = true;
                    }
                }
            }
            fire = f;
            Bun__unlock(US_FAULT_LOCK.get());
        }
        if !fire {
            return 0;
        }
        match rule.action {
            US_FAULT_ERRNO => {
                #[cfg(windows)]
                bun_windows_sys::ws2_32::WSASetLastError(rule.errno_value);
                // SAFETY: `errno_ptr()` returns a valid thread-local int* for
                // the calling thread; `out` is a caller-owned stack local.
                unsafe {
                    *bun_core::ffi::errno_ptr() = rule.errno_value;
                    *out = -1;
                }
                1
            }
            US_FAULT_ZERO => {
                // SAFETY: `out` is a caller-owned stack local.
                unsafe { *out = 0 };
                1
            }
            US_FAULT_SHORT => {
                // SAFETY: `clamp` is a caller-owned stack local.
                unsafe {
                    if rule.clamp_bytes >= 0 && *clamp > rule.clamp_bytes {
                        *clamp = rule.clamp_bytes;
                    }
                }
                0
            }
            _ => 0,
        }
    }

    /// Hot-path check (Rust-side equivalent of the C `US_FAULT_CHECK` macro).
    /// Returns `true` when the call should short-circuit with `*out`; `*clamp`
    /// may be shrunk in-place when the rule wants a partial read/write.
    #[inline(always)]
    pub fn us_fault_check(sc: c_int, fd: c_int, out: &mut ssize_t, clamp: &mut c_int) -> bool {
        if us_fault_armed.load(Ordering::Acquire) == 0 {
            return false;
        }
        #[cold]
        fn hit(sc: c_int, fd: c_int, out: &mut ssize_t, clamp: &mut c_int) -> bool {
            // SAFETY: `out`/`clamp` are valid &mut references.
            unsafe { us_fault_hit(sc, fd, out, clamp) != 0 }
        }
        hit(sc, fd, out, clamp)
    }
}

#[cfg(socket_fault_injection)]
pub use enabled::*;

// ═══════════════════════════════════════════════════════════════════════════
// Disabled build — `US_FAULT_CHECK` expands to constant 0
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(not(socket_fault_injection))]
#[inline(always)]
pub fn us_fault_check(
    _sc: core::ffi::c_int,
    _fd: core::ffi::c_int,
    _out: &mut libc::ssize_t,
    _clamp: &mut core::ffi::c_int,
) -> bool {
    false
}
