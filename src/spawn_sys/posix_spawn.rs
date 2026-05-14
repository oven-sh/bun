#![allow(unused_imports, dead_code, unused_variables)]
#![warn(unused_must_use)]

use core::ffi::{c_char, c_int, c_short};
use core::ptr;
use std::ffi::{CStr, CString};

use bun_core::{Error, err};
use bun_sys::{self as sys, Fd};

// `std.posix.system` — `bun_sys::c` only re-exports a thin slice of libc
// (no `posix_spawn*`/`waitpid`/`wait4`). Use the `libc` crate directly here;
// `bun_sys::c` can re-export these later and this `use` swaps back.
// TODO(port): swap to `bun_sys::c as system` once it forwards posix_spawn.
#[cfg(unix)]
use libc as system;

// ── Darwin spawn extensions missing from the `libc` crate ────────────────
// Values/signatures match <spawn.h> on macOS 14 SDK; Zig's translate-c picks
// these up via `bun.c`, but the Rust `libc` crate omits the `_np` variants.
#[cfg(target_os = "macos")]
mod darwin_spawn_np {
    use core::ffi::{c_char, c_int};
    /// `POSIX_SPAWN_SETSID` — set session ID (calls `setsid()` in child).
    /// `<spawn.h>`: `0x0400`.
    pub const POSIX_SPAWN_SETSID: c_int = 0x0400;
    unsafe extern "C" {
        pub fn posix_spawn_file_actions_addinherit_np(
            actions: *mut libc::posix_spawn_file_actions_t,
            fd: c_int,
        ) -> c_int;
        pub fn posix_spawn_file_actions_addchdir_np(
            actions: *mut libc::posix_spawn_file_actions_t,
            path: *const c_char,
        ) -> c_int;
    }
}

// `std.posix.{errno, fd_t, mode_t, pid_t, toPosixPath, unexpectedErrno}` —
// `bun_sys::posix` currently exposes only `mode_t`/`S`/`E`/`errno()` (the
// MOVE_DOWN stub from `bun_errno`). Shim the remainder locally so this file
// is self-contained; delete in favour of `bun_sys::posix::*` once that module
// widens.
use self::posix_compat::{Errno, errno, fd_t, mode_t, pid_t, to_posix_path, unexpected_errno};

#[allow(non_camel_case_types)]
mod posix_compat {
    use bun_core::{Error, err};
    use core::ffi::c_int;
    use std::ffi::CString;

    /// `std.posix.fd_t` — native fd backing int.
    // posix_spawn file actions use libc `int` fds on the C side
    // (`posix_spawn_bun.cpp`). On POSIX `FdNative == c_int`; on Windows
    // `FdNative` is HANDLE, but this code path is unreachable there — keep
    // the C-ABI type so the struct compiles unchanged.
    pub type fd_t = core::ffi::c_int;
    /// `std.posix.pid_t`.
    #[cfg(unix)]
    pub type pid_t = libc::pid_t;
    #[cfg(not(unix))]
    pub type pid_t = i32;
    pub use bun_sys::posix::mode_t;

    /// `std.posix.E` — errno enum with **unprefixed** variant names. The real
    /// `bun_errno::posix::E` aliases `SystemErrno` (E-prefixed); local newtype
    /// keeps the body's `Errno::SUCCESS`/`NOMEM`/... matches intact.
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    #[repr(transparent)]
    pub struct Errno(pub c_int);
    #[cfg(unix)]
    impl Errno {
        pub const SUCCESS: Errno = Errno(0);
        pub const NOMEM: Errno = Errno(libc::ENOMEM);
        pub const INVAL: Errno = Errno(libc::EINVAL);
        pub const BADF: Errno = Errno(libc::EBADF);
        pub const NAMETOOLONG: Errno = Errno(libc::ENAMETOOLONG);
        pub const INTR: Errno = Errno(libc::EINTR);
    }
    #[cfg(not(unix))]
    impl Errno {
        pub const SUCCESS: Errno = Errno(0);
        pub const NOMEM: Errno = Errno(12);
        pub const INVAL: Errno = Errno(22);
        pub const BADF: Errno = Errno(9);
        pub const NAMETOOLONG: Errno = Errno(36);
        pub const INTR: Errno = Errno(4);
    }

    /// `std.posix.errno(rc)` — Zig: with libc, `rc == -1 ⇒ read __errno`,
    /// else `.SUCCESS`. The `posix_spawn*` family instead returns the errno
    /// **directly** (0 on success). The Phase-A draft conflated both call
    /// conventions; preserve that here so behaviour matches the .zig source
    /// 1:1, and let Phase-B audit (TODO(port) below).
    // TODO(port): split into `errno_from_posix_spawn(rc)` (rc IS errno) vs
    // `errno_from_ret(rc)` (rc == -1 ⇒ read libc errno) and route call sites.
    #[inline]
    pub fn errno(rc: c_int) -> Errno {
        if rc == -1 {
            // Windows has no thread-local POSIX errno here — `posix_spawn`
            // is unreachable on that target (the libuv path handles spawn),
            // so just return UNKNOWN to keep the type compiling.
            #[cfg(unix)]
            return Errno(bun_sys::posix::errno());
            #[cfg(windows)]
            return Errno(bun_sys::E::UNKNOWN as i32);
        }
        Errno::SUCCESS
    }

    /// `std.posix.toPosixPath` — copy into a NUL-terminated buffer.
    pub fn to_posix_path(path: &[u8]) -> Result<CString, Error> {
        CString::new(path).map_err(|_| err!("Unexpected"))
    }

    /// `std.posix.unexpectedErrno` — Zig logs + returns `error.Unexpected`.
    pub fn unexpected_errno(_e: Errno) -> Error {
        err!("Unexpected")
    }
}

// MOVE_DOWN: this file was `src/runtime/api/bun/spawn.rs`; the `stdio`
// submodule (which depends on the JSC-tier `Subprocess`) stays in
// `bun_runtime::api::bun_spawn` and is not declared here.

pub mod bun_spawn {
    use super::*;

    // The #[repr(C)] FFI mirrors (`FileActionType`, `Action`) live in
    // `bun_core::spawn_ffi` — the single source of truth for bun-spawn.cpp's
    // request layout. The owning `CString` backing each non-null `Action.path`
    // lives in `Actions.paths` below.
    pub use bun_core::spawn_ffi::{Action, FileActionType};

    // `Fd::native()` returns `*mut c_void` on Windows, which can't fill the
    // `c_int` action slot. posix_spawn never runs on Windows (libuv handles
    // spawn there), so trap instead of inventing a HANDLE→int cast.
    #[cfg(unix)]
    #[inline(always)]
    fn fd_int(fd: Fd) -> fd_t {
        fd.native()
    }
    #[cfg(windows)]
    #[inline(always)]
    fn fd_int(_fd: Fd) -> fd_t {
        unreachable!("posix_spawn file actions are unix-only")
    }

    #[derive(Default)]
    pub struct Actions {
        pub chdir_buf: Option<CString>,
        pub actions: Vec<Action>,
        /// Owns the C strings pointed to by `Action.path` for `.Open` actions.
        /// `CString`'s heap buffer does not move when this Vec reallocates, so
        /// raw pointers stored in `actions[i].path` remain valid for the life
        /// of `Actions`.
        pub paths: Vec<CString>,
        pub detached: bool,
    }

    impl Actions {
        pub fn init() -> Result<Actions, Error> {
            // TODO(port): narrow error set
            Ok(Actions::default())
        }

        // deinit: freed chdir_buf, each action.path, and the actions list — all owned
        // types now, so Drop is automatic.

        pub fn open(&mut self, fd: Fd, path: &[u8], flags: u32, mode: i32) -> Result<(), Error> {
            let posix_path = to_posix_path(path)?;
            self.open_z(fd, &posix_path, flags, mode)
        }

        pub fn open_z(&mut self, fd: Fd, path: &CStr, flags: u32, mode: i32) -> Result<(), Error> {
            self.paths.push(path.to_owned());
            // SAFETY: CString's heap buffer is stable across Vec<CString> reallocs;
            // pointer outlives this Action because both are owned by `self`.
            let path_ptr = self.paths.last().unwrap().as_ptr();
            self.actions.push(Action {
                kind: FileActionType::Open,
                path: path_ptr,
                flags: i32::try_from(flags).expect("int cast"),
                mode: i32::try_from(mode).expect("int cast"),
                fds: [fd_int(fd), 0],
            });
            Ok(())
        }

        pub fn close(&mut self, fd: Fd) -> Result<(), Error> {
            self.actions.push(Action {
                kind: FileActionType::Close,
                fds: [fd_int(fd), 0],
                ..Default::default()
            });
            Ok(())
        }

        pub fn dup2(&mut self, fd: Fd, newfd: Fd) -> Result<(), Error> {
            self.actions.push(Action {
                kind: FileActionType::Dup2,
                fds: [fd_int(fd), fd_int(newfd)],
                ..Default::default()
            });
            Ok(())
        }

        pub fn inherit(&mut self, fd: Fd) -> Result<(), Error> {
            self.dup2(fd, fd)
        }

        pub fn chdir(&mut self, path: &[u8]) -> Result<(), Error> {
            // previous buffer (if any) is dropped by assignment
            // TODO(port): CString::new rejects interior NUL; Zig dupeZ did not check
            self.chdir_buf = Some(CString::new(path).map_err(|_| err!("Unexpected"))?);
            Ok(())
        }
    }

    #[derive(Clone, Copy)]
    pub struct Attr {
        pub detached: bool,
        pub new_process_group: bool,
        pub pty_slave_fd: i32,
        pub flags: u16,
        pub reset_signals: bool,
        pub linux_pdeathsig: i32,
    }

    impl Default for Attr {
        // Must match Zig field defaults (spawn.zig Attr): `pty_slave_fd: i32 = -1`.
        // `#[derive(Default)]` would yield `0` (stdin), which makes `spawn_z` take
        // the PTY path and call setsid()+ioctl(TIOCSCTTY, 0) in the child.
        fn default() -> Self {
            Self {
                detached: false,
                new_process_group: false,
                pty_slave_fd: -1,
                flags: 0,
                reset_signals: false,
                linux_pdeathsig: 0,
            }
        }
    }

    impl Attr {
        pub fn init() -> Result<Attr, Error> {
            Ok(Attr::default())
        }

        pub fn get(self) -> Result<u16, Error> {
            Ok(self.flags)
        }

        pub fn set(&mut self, flags: u16) -> Result<(), Error> {
            self.flags = flags;
            // FreeBSD's <spawn.h> has no POSIX_SPAWN_SETSID; bun-spawn.cpp
            // calls setsid() in the child for `detached`, which process.zig
            // sets directly on this struct BEFORE calling set(). Preserve
            // that value when the flag bit isn't available.
            // TODO(port): Zig used `@hasDecl(bun.c, "POSIX_SPAWN_SETSID")`; approximated
            // here as unix-not-freebsd. Phase B should use a build-time cfg from bindgen.
            #[cfg(target_os = "linux")]
            {
                self.detached = (flags & system::POSIX_SPAWN_SETSID as u16) != 0;
            }
            #[cfg(target_os = "macos")]
            {
                self.detached = (flags & super::darwin_spawn_np::POSIX_SPAWN_SETSID as u16) != 0;
            }
            Ok(())
        }

        pub fn reset_signals(&mut self) -> Result<(), Error> {
            self.reset_signals = true;
            Ok(())
        }
    }
}

// mostly taken from zig's posix_spawn.zig
pub mod posix_spawn {
    use super::bun_spawn;
    use super::*;

    const SYSCALL_POSIX_SPAWN: sys::Tag = sys::Tag::posix_spawn;
    const SYSCALL_WAITPID: sys::Tag = sys::Tag::waitpid;

    #[derive(Copy, Clone)]
    pub struct WaitPidResult {
        pub pid: pid_t,
        pub status: u32,
    }

    /// Map a `posix_spawn*` errno to `Result<(), Error>`. Shared across all
    /// `posix_spawnattr_*` / `posix_spawn_file_actions_*` wrappers — they only
    /// differ in which errnos are *documented* impossible for a given call.
    /// Those were previously per-site `unreachable!()`; here they become error
    /// returns, which widens the contract without changing observable behaviour
    /// for any errno the libc calls actually produce. `INVAL` stays a panic: it
    /// indicates a corrupted attr/actions object, i.e. a Bun bug.
    #[cfg(target_os = "macos")]
    #[inline]
    fn spawn_errno(e: Errno) -> Result<(), Error> {
        match e {
            Errno::SUCCESS => Ok(()),
            Errno::NOMEM => Err(err!("SystemResources")),
            Errno::BADF => Err(err!("InvalidFileDescriptor")),
            Errno::NAMETOOLONG => Err(err!("NameTooLong")),
            Errno::INVAL => unreachable!(), // attr/actions object is invalid
            e => Err(unexpected_errno(e)),
        }
    }

    // ─── libc posix_spawn wrappers ───────────────────────────────────────────
    // `PosixSpawnAttr`/`PosixSpawnActions` wrap `libc::posix_spawn*` directly.
    // On Linux/FreeBSD the runtime path goes through `bun_spawn` (vfork-based
    // `posix_spawn_bun`), so these are only **used** on macOS-non-PTY. Gate
    // them on `target_os = "macos"` to avoid the Darwin-only `_np` extensions
    // (`addinherit_np`) breaking the Linux build; the `not(unix)` Windows path
    // never reaches them either.
    #[cfg(target_os = "macos")]
    pub struct PosixSpawnAttr {
        pub attr: system::posix_spawnattr_t,
        pub detached: bool,
        pub pty_slave_fd: i32,
    }

    #[cfg(target_os = "macos")]
    impl PosixSpawnAttr {
        pub fn init() -> Result<PosixSpawnAttr, Error> {
            let mut attr = core::mem::MaybeUninit::<system::posix_spawnattr_t>::uninit();
            // SAFETY: posix_spawnattr_init writes into attr on SUCCESS
            spawn_errno(errno(unsafe {
                system::posix_spawnattr_init(attr.as_mut_ptr())
            }))?;
            // SAFETY: spawn_errno returned Ok ⇒ SUCCESS ⇒ initialized
            Ok(PosixSpawnAttr {
                attr: unsafe { attr.assume_init() },
                detached: false,
                pty_slave_fd: -1,
            })
        }

        pub fn get(&self) -> Result<u16, Error> {
            let mut flags: c_short = 0;
            // SAFETY: self.attr is a live posix_spawnattr_t
            spawn_errno(errno(unsafe {
                system::posix_spawnattr_getflags(&self.attr, &mut flags)
            }))?;
            Ok(flags as u16) // Zig: `@as(u16, @bitCast(flags))`
        }

        pub fn set(&mut self, flags: u16) -> Result<(), Error> {
            // Zig: `@as(c_short, @bitCast(flags))` — `as` between same-width
            // signed/unsigned is the bitcast.
            let flags_s: c_short = flags as c_short;
            // SAFETY: self.attr is a live posix_spawnattr_t
            spawn_errno(errno(unsafe {
                system::posix_spawnattr_setflags(&mut self.attr, flags_s)
            }))
        }

        pub fn reset_signals(&mut self) -> Result<(), Error> {
            // SAFETY: self.attr is a live posix_spawnattr_t
            if unsafe { posix_spawnattr_reset_signals(&mut self.attr) } != 0 {
                return Err(err!("SystemResources"));
            }
            Ok(())
        }
    }

    #[cfg(target_os = "macos")]
    impl Drop for PosixSpawnAttr {
        fn drop(&mut self) {
            // SAFETY: self.attr was initialized by posix_spawnattr_init
            unsafe { system::posix_spawnattr_destroy(&mut self.attr) };
        }
    }

    // TODO(port): move to runtime_sys
    #[cfg(target_os = "macos")]
    unsafe extern "C" {
        fn posix_spawnattr_reset_signals(attr: *mut system::posix_spawnattr_t) -> c_int;
    }

    #[cfg(target_os = "macos")]
    pub struct PosixSpawnActions {
        pub actions: system::posix_spawn_file_actions_t,
    }

    #[cfg(target_os = "macos")]
    impl PosixSpawnActions {
        pub fn init() -> Result<PosixSpawnActions, Error> {
            let mut actions =
                core::mem::MaybeUninit::<system::posix_spawn_file_actions_t>::uninit();
            // SAFETY: posix_spawn_file_actions_init writes into actions on SUCCESS
            spawn_errno(errno(unsafe {
                system::posix_spawn_file_actions_init(actions.as_mut_ptr())
            }))?;
            // SAFETY: spawn_errno returned Ok ⇒ SUCCESS ⇒ initialized
            Ok(PosixSpawnActions {
                actions: unsafe { actions.assume_init() },
            })
        }

        pub fn open(&mut self, fd: Fd, path: &[u8], flags: u32, mode: mode_t) -> Result<(), Error> {
            let posix_path = to_posix_path(path)?;
            self.open_z(fd, &posix_path, flags, mode)
        }

        pub fn open_z(
            &mut self,
            fd: Fd,
            path: &CStr,
            flags: u32,
            mode: mode_t,
        ) -> Result<(), Error> {
            // Zig: `@as(c_int, @bitCast(flags))`
            let flags_c: c_int = flags as c_int;
            // SAFETY: self.actions is live; path is NUL-terminated
            spawn_errno(errno(unsafe {
                system::posix_spawn_file_actions_addopen(
                    &mut self.actions,
                    fd.native(),
                    path.as_ptr(),
                    flags_c,
                    mode,
                )
            }))
        }

        pub fn close(&mut self, fd: Fd) -> Result<(), Error> {
            // SAFETY: self.actions is live
            spawn_errno(errno(unsafe {
                system::posix_spawn_file_actions_addclose(&mut self.actions, fd.native())
            }))
        }

        pub fn dup2(&mut self, fd: Fd, newfd: Fd) -> Result<(), Error> {
            if fd == newfd {
                return self.inherit(fd);
            }

            // SAFETY: self.actions is live
            spawn_errno(errno(unsafe {
                system::posix_spawn_file_actions_adddup2(
                    &mut self.actions,
                    fd.native(),
                    newfd.native(),
                )
            }))
        }

        pub fn inherit(&mut self, fd: Fd) -> Result<(), Error> {
            // SAFETY: self.actions is live
            spawn_errno(errno(unsafe {
                super::darwin_spawn_np::posix_spawn_file_actions_addinherit_np(
                    &mut self.actions,
                    fd.native(),
                )
            }))
        }

        pub fn chdir(&mut self, path: &[u8]) -> Result<(), Error> {
            let posix_path = to_posix_path(path)?;
            self.chdir_z(&posix_path)
        }

        // deliberately not pub
        fn chdir_z(&mut self, path: &CStr) -> Result<(), Error> {
            // SAFETY: self.actions is live; path is NUL-terminated
            spawn_errno(errno(unsafe {
                super::darwin_spawn_np::posix_spawn_file_actions_addchdir_np(
                    &mut self.actions,
                    path.as_ptr(),
                )
            }))
        }
    }

    #[cfg(target_os = "macos")]
    impl Drop for PosixSpawnActions {
        fn drop(&mut self) {
            // SAFETY: self.actions was initialized by posix_spawn_file_actions_init
            unsafe { system::posix_spawn_file_actions_destroy(&mut self.actions) };
        }
    }

    // Use BunSpawn types on POSIX (both Linux and macOS) for PTY support via posix_spawn_bun.
    // Windows uses different spawn mechanisms.
    #[cfg(unix)]
    pub type Actions = bun_spawn::Actions;
    #[cfg(unix)]
    pub type Attr = bun_spawn::Attr;
    // TODO(b2-blocked): not(unix) Actions/Attr aliased PosixSpawn* in the Zig
    // draft, but Windows goes through `process.rs::spawn_process_windows`
    // (libuv), never these. Leave undeclared on Windows for now.

    // The #[repr(C)] request mirrors + extern decl live in `bun_core::spawn_ffi`
    // (single source of truth for bun-spawn.cpp's `bun_spawn_request_t`). The
    // `sys::Result`-wrapping spawn helper stays here because `bun_core` cannot
    // depend on `bun_sys`.
    #[cfg(unix)]
    pub(super) use bun_core::spawn_ffi::{ActionsList, BunSpawnRequest, posix_spawn_bun};

    #[cfg(unix)]
    pub(super) fn spawn_bun(
        path: &CStr,
        req_: BunSpawnRequest,
        argv: *const *const c_char,
        envp: *const *const c_char,
    ) -> sys::Result<pid_t> {
        let mut req = req_;
        let mut pid: c_int = 0;

        // SAFETY: path is NUL-terminated; argv/envp are NULL-terminated arrays of C strings
        let rc =
            unsafe { posix_spawn_bun(&raw mut pid, path.as_ptr(), &raw const req, argv, envp) };
        let _ = &mut req; // keep req alive across the call (matches Zig taking &req of a local copy)

        if cfg!(debug_assertions) {
            // SAFETY: argv has at least one element (the NULL terminator)
            let arg0 = unsafe {
                let p = *argv;
                if p.is_null() {
                    &b""[..]
                } else {
                    bun_core::ffi::cstr(p).to_bytes()
                }
            };
            sys::syslog!(
                "posix_spawn_bun({}) = {} ({})",
                bstr::BStr::new(arg0),
                rc,
                pid
            );
        }

        if rc == 0 {
            return sys::Result::Ok(pid_t::try_from(pid).expect("int cast"));
        }

        // SAFETY: argv has at least one element (the NULL terminator)
        let arg0 = unsafe {
            let p = *argv;
            if p.is_null() {
                &b""[..]
            } else {
                bun_core::ffi::cstr(p).to_bytes()
            }
        };
        sys::Result::Err(sys::Error {
            // @truncate(@intFromEnum(@as(std.c.E, @enumFromInt(rc))))
            errno: rc as sys::ErrorInt,
            syscall: SYSCALL_POSIX_SPAWN,
            path: arg0.into(),
            ..Default::default()
        })
    }

    #[cfg(unix)]
    pub fn spawn_z(
        path: &CStr,
        actions: Option<&Actions>,
        attr: Option<&Attr>,
        argv: *const *const c_char,
        envp: *const *const c_char,
    ) -> sys::Result<pid_t> {
        let pty_slave_fd = attr.map_or(-1, |a| a.pty_slave_fd);
        let detached = attr.map_or(false, |a| a.detached);

        // Use posix_spawn_bun when:
        // - Linux: always (uses vfork which is fast and safe)
        // - macOS: only for PTY spawns (pty_slave_fd >= 0) because PTY setup requires
        //   setsid() + ioctl(TIOCSCTTY) before exec, which system posix_spawn can't do.
        //   For non-PTY spawns on macOS, we use system posix_spawn which is safer
        //   (Apple's posix_spawn uses a kernel fast-path that avoids fork() entirely).
        let use_bun_spawn = cfg!(target_os = "linux")
            || cfg!(target_os = "freebsd")
            || (cfg!(target_os = "macos") && pty_slave_fd >= 0);

        // TODO(port): cfg-gate platform-only field access — the body below touches
        // bun_spawn::Actions/Attr fields that don't exist on the not(unix) Actions/Attr
        // alias; cfg!() above keeps both arms in the type-checker. Phase B may need to
        // restructure (linux/freebsd fall-through after this block is statically
        // unreachable but rustc can't prove it from the runtime `use_bun_spawn` bool).
        #[cfg(unix)]
        if use_bun_spawn {
            return spawn_bun(
                path,
                BunSpawnRequest {
                    actions: match actions {
                        Some(act) => ActionsList {
                            ptr: act.actions.as_ptr(),
                            len: act.actions.len(),
                        },
                        None => ActionsList {
                            ptr: ptr::null(),
                            len: 0,
                        },
                    },
                    chdir_buf: actions
                        .and_then(|a| a.chdir_buf.as_deref())
                        .map_or(ptr::null(), |c| c.as_ptr()),
                    detached,
                    new_process_group: attr.map_or(false, |a| a.new_process_group),
                    pty_slave_fd,
                    linux_pdeathsig: attr.map_or(0, |a| a.linux_pdeathsig),
                },
                argv,
                envp,
            );
        }

        // macOS without PTY: use system posix_spawn
        // Need to convert BunSpawn.Actions to PosixSpawnActions for system posix_spawn
        #[cfg(target_os = "macos")]
        {
            let mut posix_actions = match PosixSpawnActions::init() {
                Ok(a) => a,
                Err(_) => {
                    return sys::Result::Err(sys::Error {
                        errno: Errno::NOMEM.0 as sys::ErrorInt,
                        syscall: SYSCALL_POSIX_SPAWN,
                        ..Default::default()
                    });
                }
            };
            // Drop handles posix_actions.deinit()

            let mut posix_attr = match PosixSpawnAttr::init() {
                Ok(a) => a,
                Err(_) => {
                    return sys::Result::Err(sys::Error {
                        errno: Errno::NOMEM.0 as sys::ErrorInt,
                        syscall: SYSCALL_POSIX_SPAWN,
                        ..Default::default()
                    });
                }
            };
            // Drop handles posix_attr.deinit()

            // Pass through all flags from the BunSpawn.Attr
            if let Some(a) = attr {
                let mut flags = a.flags;
                if a.new_process_group {
                    flags |= system::POSIX_SPAWN_SETPGROUP as u16;
                    // pgroup defaults to 0 in a freshly-init'd attr, i.e. child's own pid.
                }
                if flags != 0 {
                    let _ = posix_attr.set(flags);
                }
                if a.reset_signals {
                    let _ = posix_attr.reset_signals();
                }
            }

            // Convert actions
            if let Some(act) = actions {
                for action in &act.actions {
                    match action.kind {
                        bun_spawn::FileActionType::Close => {
                            if let Err(e) = posix_actions.close(Fd::from_native(action.fds[0])) {
                                if cfg!(debug_assertions) {
                                    sys::syslog!(
                                        "posix_spawn_file_actions_addclose({}) failed: {}",
                                        action.fds[0],
                                        e.name()
                                    );
                                }
                            }
                        }
                        bun_spawn::FileActionType::Dup2 => {
                            if let Err(e) = posix_actions.dup2(
                                Fd::from_native(action.fds[0]),
                                Fd::from_native(action.fds[1]),
                            ) {
                                if cfg!(debug_assertions) {
                                    sys::syslog!(
                                        "posix_spawn_file_actions_adddup2({}, {}) failed: {}",
                                        action.fds[0],
                                        action.fds[1],
                                        e.name()
                                    );
                                }
                            }
                        }
                        bun_spawn::FileActionType::Open => {
                            // SAFETY: `.Open` actions always have a non-null path
                            // backed by a CString in `act.paths` (see `open_z`).
                            let p = unsafe { bun_core::ffi::cstr(action.path) };
                            if let Err(e) = posix_actions.open_z(
                                Fd::from_native(action.fds[0]),
                                p,
                                u32::try_from(action.flags).expect("int cast"),
                                mode_t::try_from(action.mode).unwrap(),
                            ) {
                                if cfg!(debug_assertions) {
                                    sys::syslog!(
                                        "posix_spawn_file_actions_addopen({}, {}, {}, {}) failed: {}",
                                        action.fds[0],
                                        bstr::BStr::new(p.to_bytes()),
                                        action.flags,
                                        action.mode,
                                        e.name()
                                    );
                                }
                            }
                        }
                        bun_spawn::FileActionType::None => {}
                    }
                }

                // Handle chdir
                if let Some(chdir_path) = act.chdir_buf.as_deref() {
                    if let Err(e) = posix_actions.chdir(chdir_path.to_bytes()) {
                        if cfg!(debug_assertions) {
                            sys::syslog!(
                                "posix_spawn_file_actions_addchdir({}) failed: {}",
                                bstr::BStr::new(chdir_path.to_bytes()),
                                e.name()
                            );
                        }
                    }
                }
            }

            let mut pid: pid_t = 0;
            // SAFETY: all pointers valid; argv/envp NULL-terminated. Darwin's
            // `libc` crate types argv/envp as `*const *mut c_char` (matching
            // the C header's non-const `char *const argv[]`); the strings are
            // never written, so the const→mut element cast is sound.
            let rc = unsafe {
                system::posix_spawn(
                    &mut pid,
                    path.as_ptr(),
                    &posix_actions.actions,
                    &posix_attr.attr,
                    argv as *const *mut c_char,
                    envp as *const *mut c_char,
                )
            };
            if cfg!(debug_assertions) {
                sys::syslog!(
                    "posix_spawn({}) = {} ({})",
                    bstr::BStr::new(path.to_bytes()),
                    rc,
                    pid
                );
            }

            if rc == 0 {
                return sys::Result::Ok(pid);
            }

            return sys::Result::Err(sys::Error {
                errno: rc as sys::ErrorInt,
                syscall: SYSCALL_POSIX_SPAWN,
                path: path.to_bytes().into(),
                ..Default::default()
            });
        }

        // Linux/FreeBSD: `use_bun_spawn` is statically true above, so the
        // early return always fires; rustc can't prove that from the runtime
        // bool. macOS falls through to the system-posix_spawn block above.
        #[cfg(all(unix, not(target_os = "macos")))]
        #[allow(unreachable_code)]
        {
            unreachable!("posix_spawn_bun handles all unix-non-darwin spawns");
        }

        // Windows path (uses different mechanism)
        // Gated not(unix) because `actions`/`attr` here are PosixSpawnActions/PosixSpawnAttr
        // fields; on unix the Actions/Attr aliases resolve to bun_spawn::* which lack `.attr`.
        #[cfg(not(unix))]
        #[allow(unreachable_code)]
        {
            let mut pid: pid_t = 0;
            // SAFETY: all pointers valid; argv/envp NULL-terminated
            let rc = unsafe {
                system::posix_spawn(
                    &mut pid,
                    path.as_ptr(),
                    actions.map_or(ptr::null(), |a| &a.actions),
                    attr.map_or(ptr::null(), |a| &a.attr),
                    argv,
                    envp,
                )
            };
            if cfg!(debug_assertions) {
                sys::syslog!(
                    "posix_spawn({}) = {} ({})",
                    bstr::BStr::new(path.to_bytes()),
                    rc,
                    pid
                );
            }

            // Unlike most syscalls, posix_spawn returns 0 on success and an errno on failure.
            // That is why bun.sys.getErrno() is not used here, since that checks for -1.
            if rc == 0 {
                return sys::Result::Ok(pid);
            }

            sys::Result::Err(sys::Error {
                errno: rc as sys::ErrorInt,
                syscall: SYSCALL_POSIX_SPAWN,
                path: path.to_bytes().into(),
                ..Default::default()
            })
        }
    }

    /// Use this version of the `waitpid` wrapper if you spawned your child process using `posix_spawn`
    /// or `posix_spawnp` syscalls.
    /// See also `std.posix.waitpid` for an alternative if your child process was spawned via `fork` and
    /// `execve` method.
    #[cfg(unix)]
    pub fn waitpid(pid: pid_t, flags: u32) -> sys::Result<WaitPidResult> {
        type PidStatus = c_int;
        let mut status: PidStatus = 0;
        loop {
            // SAFETY: status is a valid out-pointer
            let rc = unsafe {
                system::waitpid(
                    pid,
                    &raw mut status,
                    c_int::try_from(flags).expect("int cast"),
                )
            };
            match errno(rc) {
                Errno::SUCCESS => {
                    return sys::Result::Ok(WaitPidResult {
                        pid: pid_t::try_from(rc).expect("int cast"),
                        status: status as u32,
                    });
                }
                Errno::INTR => continue,
                e => {
                    return sys::Result::Err(sys::Error::from_code_int(e.0, SYSCALL_WAITPID));
                }
            }
        }
    }

    /// Same as waitpid, but also returns resource usage information.
    #[cfg(unix)]
    pub fn wait4(
        pid: pid_t,
        flags: u32,
        usage: Option<&mut process::Rusage>,
    ) -> sys::Result<WaitPidResult> {
        type PidStatus = c_int;
        let mut status: PidStatus = 0;
        // PORT NOTE: reshaped for borrowck — Zig passes the same `?*Rusage` every loop
        // iteration via @ptrCast(usage); convert once to a raw ptr that is Copy.
        let usage_ptr: *mut system::rusage = match usage {
            Some(u) => std::ptr::from_mut::<process::Rusage>(u).cast(),
            None => ptr::null_mut(),
        };
        loop {
            // SAFETY: status is a valid out-pointer; usage_ptr is either null or a valid *mut Rusage
            let rc = unsafe {
                system::wait4(
                    pid,
                    &raw mut status,
                    c_int::try_from(flags).expect("int cast"),
                    usage_ptr,
                )
            };
            match errno(rc) {
                Errno::SUCCESS => {
                    return sys::Result::Ok(WaitPidResult {
                        pid: pid_t::try_from(rc).expect("int cast"),
                        status: status as u32,
                    });
                }
                Errno::INTR => continue,
                e => {
                    return sys::Result::Err(sys::Error::from_code_int(e.0, SYSCALL_WAITPID));
                }
            }
        }
    }

    // Higher-tier re-exports (`Process`/`Status`/`spawn_process`/`sync`/
    // `Windows*`) live in `bun_spawn::posix_spawn::bun_spawn`, which augments
    // this module — they need event-loop types this `-sys` crate cannot name.
    pub use crate::spawn_process::{PosixSpawnResult, Rusage};
}

use crate::spawn_process as process;

// ported from: src/runtime/api/bun/spawn.zig
