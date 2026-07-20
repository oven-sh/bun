//! Process-wide DNS-config-change watcher.
//!
//! c-ares reads the system nameserver list once when a channel is created and
//! never again, so after a VPN connect / Wi-Fi switch / DHCP renew the
//! resolver keeps querying the boot-time servers. Node's `ChannelWrap::
//! EnsureServers` works around only the "started offline → 127.0.0.1 fallback"
//! case (nodejs/node#13076); the general case is nodejs/node#49485, closed
//! wontfix.
//!
//! We do better: arm one OS-native change notification per process and bump a
//! global generation counter when it fires. Each `Resolver::get_channel()`
//! checks the counter and, if stale (and the user hasn't called `setServers`),
//! destroys and lazily recreates its channel so the next query re-reads the
//! current system config. The connect-path `GlobalCache` is invalidated at the
//! same time so `fetch()`/sockets don't serve stale `getaddrinfo` results for
//! the rest of the TTL window.
//!
//! Backends (mirroring c-ares' own `ares_event_configchg.c`, which we can't
//! use directly because it's bound to c-ares' private event thread):
//!   - Linux: `inotify` on `/etc` filtering `resolv.conf` / `nsswitch.conf`.
//!   - macOS: `notify_register_file_descriptor` on SystemConfiguration's
//!     DNS-config notify key.
//!   - Windows: `NotifyIpInterfaceChange`. The callback runs on a system
//!     threadpool thread; it only touches atomics / the `Guarded` cache, so
//!     no marshaling to the JS thread is needed.
//!   - elsewhere: no-op; the reactive loopback fallback in
//!     `Resolver::ensure_servers` still applies.
//!
//! Installed lazily on the first c-ares channel creation, lives for the
//! process, does not keep the event loop alive.

use core::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use bun_jsc::virtual_machine::VirtualMachine;

bun_output::declare_scope!(DNSConfigWatcher, visible);

static GENERATION: AtomicU64 = AtomicU64::new(0);
static INSTALLED: AtomicBool = AtomicBool::new(false);

#[inline]
pub fn generation() -> u64 {
    GENERATION.load(Ordering::Relaxed)
}

/// Record that the system DNS configuration changed: bump the generation so
/// every `Resolver` recreates its channel on next use, and drop any cached
/// `getaddrinfo` results from the connect-path cache.
pub fn bump_generation() {
    GENERATION.fetch_add(1, Ordering::Relaxed);
    super::internal::invalidate_global_cache();
    bun_output::scoped_log!(DNSConfigWatcher, "generation bumped");
}

/// Arm the OS watcher once per process. Best-effort: if the backend can't
/// register (readonly `/etc`, seccomp, unsupported OS) we silently fall back
/// to the reactive loopback check.
pub fn install(vm: &VirtualMachine) {
    if INSTALLED.swap(true, Ordering::Relaxed) {
        return;
    }
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
    posix::install(vm);
    #[cfg(windows)]
    windows::install(vm);
    #[cfg(not(any(
        target_os = "linux",
        target_os = "android",
        target_os = "macos",
        windows
    )))]
    let _ = vm;
}

// ────────────────────────────────────────────────────────────────────────────
// POSIX backend: inotify (Linux) / notify(3) (macOS), polled via FilePoll
// ────────────────────────────────────────────────────────────────────────────

#[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
mod posix {
    use core::ptr::NonNull;

    use bun_io::posix_event_loop::{FilePoll, Flags, Owner, poll_tag};
    use bun_jsc::virtual_machine::VirtualMachine;
    use bun_sys::Fd;

    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn open_watch_fd() -> Option<Fd> {
        use core::ffi::{c_char, c_int};
        const IN_NONBLOCK: c_int = 0o4000;
        const IN_CLOEXEC: c_int = 0o2000000;
        const IN_MODIFY: u32 = 0x00000002;
        const IN_MOVED_TO: u32 = 0x00000080;
        const IN_CREATE: u32 = 0x00000100;
        const IN_ONLYDIR: u32 = 0x01000000;
        unsafe extern "C" {
            fn inotify_init1(flags: c_int) -> c_int;
            fn inotify_add_watch(fd: c_int, path: *const c_char, mask: u32) -> c_int;
        }

        // SAFETY: FFI; both flags are valid.
        let fd = unsafe { inotify_init1(IN_NONBLOCK | IN_CLOEXEC) };
        if fd < 0 {
            return None;
        }
        // Test override so CI can point the watch at a temp dir instead of /etc.
        let mut buf = [0u8; 512];
        let dir: *const c_char =
            match bun_core::getenv_z(bun_core::zstr!("BUN_DNS_CONFIG_WATCH_DIR")) {
                Some(v) if v.len() < buf.len() => {
                    buf[..v.len()].copy_from_slice(v);
                    buf.as_ptr().cast()
                }
                _ => c"/etc".as_ptr(),
            };
        // SAFETY: FFI; `dir` is NUL-terminated, `fd` is the live inotify instance.
        if unsafe { inotify_add_watch(fd, dir, IN_CREATE | IN_MODIFY | IN_MOVED_TO | IN_ONLYDIR) }
            < 0
        {
            let _ = bun_sys::close(Fd::from_native(fd));
            return None;
        }
        Some(Fd::from_native(fd))
    }

    #[cfg(target_os = "macos")]
    fn open_watch_fd() -> Option<Fd> {
        use core::ffi::{c_char, c_int};
        const NOTIFY_STATUS_OK: u32 = 0;
        unsafe extern "C" {
            fn notify_register_file_descriptor(
                name: *const c_char,
                fd: *mut c_int,
                flags: c_int,
                token: *mut c_int,
            ) -> u32;
        }
        // `dns_configuration_notify_key()` in SystemConfiguration has returned
        // this constant since 10.4; hardcoding it avoids a dlsym round-trip.
        let key = c"com.apple.system.SystemConfiguration.dns_configuration";
        let mut fd: c_int = -1;
        let mut token: c_int = 0;
        // SAFETY: FFI; out-params are stack locals, key is NUL-terminated.
        let rc = unsafe { notify_register_file_descriptor(key.as_ptr(), &mut fd, 0, &mut token) };
        if rc != NOTIFY_STATUS_OK || fd < 0 {
            return None;
        }
        // SAFETY: FFI; `fd` is the live notify fd.
        unsafe {
            let flags = libc::fcntl(fd, libc::F_GETFL, 0);
            libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK);
        }
        Some(Fd::from_native(fd))
    }

    pub(super) fn install(vm: &VirtualMachine) {
        let Some(fd) = open_watch_fd() else {
            return;
        };
        let ctx = vm.loop_ctx();
        let poll = FilePoll::init(
            ctx,
            fd,
            Default::default(),
            Owner::new(poll_tag::DNS_CONFIG, NonNull::<()>::dangling().as_ptr()),
        );
        // SAFETY: `poll` is the fresh hive slot; `platform_event_loop` is the live uws loop.
        if unsafe { (*poll).register(ctx.platform_event_loop(), Flags::Readable, false) }.is_err() {
            // SAFETY: fresh hive slot never handed out.
            unsafe { (*poll).deinit() };
            let _ = bun_sys::close(fd);
            return;
        }
        // SAFETY: `poll` just successfully registered; exclusive on the JS thread.
        unsafe { (*poll).disable_keeping_process_alive(ctx) };
    }

    /// `__bun_run_file_poll` dispatch target for `poll_tag::DNS_CONFIG`.
    pub fn on_poll(poll: &mut FilePoll) {
        let fd = poll.fd;

        #[cfg(any(target_os = "linux", target_os = "android"))]
        let triggered = {
            const HDR: usize = 16; // sizeof(struct inotify_event) up to `name[]`
            let mut buf = [0u8; 4096];
            let mut hit = false;
            loop {
                let n = match bun_sys::read(fd, &mut buf) {
                    Ok(n) if n > 0 => n,
                    _ => break,
                };
                let mut off = 0usize;
                while off + HDR <= n {
                    // The header is `{ wd:i32, mask:u32, cookie:u32, len:u32 }`;
                    // we only need `len` (bytes 12..16). The kernel never
                    // returns a partial event.
                    let name_len = u32::from_ne_bytes(buf[off + 12..off + 16].try_into().unwrap())
                        as usize;
                    let name_off = off + HDR;
                    let name = &buf[name_off..name_off + name_len];
                    let name = name.split(|&b| b == 0).next().unwrap_or(name);
                    if name == b"resolv.conf" || name == b"nsswitch.conf" {
                        hit = true;
                    }
                    off = name_off + name_len;
                }
            }
            hit
        };

        #[cfg(target_os = "macos")]
        let triggered = {
            let mut any = false;
            let mut t: i32 = 0;
            // SAFETY: `t` is a 4-byte stack slot; fd is the live notify fd.
            while let Ok(n) = bun_sys::read(fd, unsafe {
                core::slice::from_raw_parts_mut((&mut t as *mut i32).cast::<u8>(), 4)
            }) {
                if n < 4 {
                    break;
                }
                any = true;
            }
            any
        };

        if triggered {
            super::bump_generation();
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
pub use posix::on_poll;

// ────────────────────────────────────────────────────────────────────────────
// Windows backend: NotifyIpInterfaceChange on the system threadpool
// ────────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
mod windows {
    use core::ffi::c_void;

    use bun_jsc::virtual_machine::VirtualMachine;

    type HANDLE = *mut c_void;
    const AF_UNSPEC: u16 = 0;

    unsafe extern "system" {
        fn NotifyIpInterfaceChange(
            family: u16,
            callback: unsafe extern "system" fn(ctx: *mut c_void, row: *mut c_void, kind: i32),
            ctx: *mut c_void,
            initial: u8,
            handle: *mut HANDLE,
        ) -> u32;
    }

    unsafe extern "system" fn on_change(_ctx: *mut c_void, _row: *mut c_void, _kind: i32) {
        super::bump_generation();
    }

    pub(super) fn install(_vm: &VirtualMachine) {
        let mut handle: HANDLE = core::ptr::null_mut();
        // SAFETY: FFI; `handle` is a stack out-param, callback has `system` ABI.
        // Handle is intentionally leaked; the watch lives for the process.
        let _ = unsafe {
            NotifyIpInterfaceChange(AF_UNSPEC, on_change, core::ptr::null_mut(), 0, &mut handle)
        };
    }
}

// ────────────────────────────────────────────────────────────────────────────
// test hooks
// ────────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
pub extern "C" fn Bun__DNSConfig__generation() -> u64 {
    generation()
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__DNSConfig__bump() {
    bump_generation();
}
