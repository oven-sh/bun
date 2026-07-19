#![warn(unused_must_use)]

#[cfg(target_os = "macos")]
use core::ffi::c_short;
#[cfg(unix)]
use core::ffi::{c_char, c_int};
#[cfg(unix)]
use core::ptr;
use std::ffi::{CStr, CString};

use crate::Error;
#[cfg(unix)]
use bun_sys as sys;
use bun_sys::Fd;

// `bun_sys::c` only re-exports a thin slice of libc
// (no `posix_spawn*`/`waitpid`/`wait4`). Use the `libc` crate directly here;
// `bun_sys::c` can re-export these later and this `use` swaps back.
#[cfg(unix)]
use libc as system;

// ── Darwin spawn extensions missing from the `libc` crate ────────────────
// Values/signatures match <spawn.h> on macOS 14 SDK; the `libc` crate omits
// the `_np` variants.
#[cfg(target_os = "macos")]
mod darwin_spawn_np {
    use core::ffi::{c_char, c_int};
    /// `POSIX_SPAWN_SETSID` — set session ID (calls `setsid()` in child).
    /// `<spawn.h>`: `0x0400`.
    pub(super) const POSIX_SPAWN_SETSID: c_int = 0x0400;
    unsafe extern "C" {
        pub(super) fn posix_spawn_file_actions_addinherit_np(
            actions: *mut libc::posix_spawn_file_actions_t,
            fd: c_int,
        ) -> c_int;
        pub(super) fn posix_spawn_file_actions_addchdir_np(
            actions: *mut libc::posix_spawn_file_actions_t,
            path: *const c_char,
        ) -> c_int;
    }
}

// `bun_sys::posix` currently exposes only `mode_t`/`S`/`E`/`errno()` (the
// MOVE_DOWN stub from `bun_errno`). Shim the remainder locally so this file
// is self-contained; delete in favour of `bun_sys::posix::*` once that module
// widens.
#[cfg(unix)]
use self::posix_compat::{Errno, errno};
#[cfg(target_os = "macos")]
use self::posix_compat::{errno_from_posix_spawn, mode_t};
use self::posix_compat::{fd_t, pid_t, to_posix_path};

#[allow(non_camel_case_types)]
mod posix_compat {
    use crate::Error;
    #[cfg(unix)]
    use core::ffi::c_int;
    use std::ffi::CString;

    /// Native fd backing int.
    // posix_spawn file actions use libc `int` fds on the C side
    // (`posix_spawn_bun.cpp`). On POSIX `FdNative == c_int`; on Windows
    // `FdNative` is HANDLE, but this code path is unreachable there — keep
    // the C-ABI type so the struct compiles unchanged.
    pub(super) type fd_t = core::ffi::c_int;
    /// Native process id type.
    #[cfg(unix)]
    pub(super) type pid_t = libc::pid_t;
    #[cfg(not(unix))]
    pub(super) type pid_t = i32;
    #[cfg(target_os = "macos")]
    pub(super) use bun_sys::posix::mode_t;

    /// Errno enum with **unprefixed** variant names. The real
    /// `bun_errno::posix::E` aliases `SystemErrno` (E-prefixed); local newtype
    /// keeps the body's `Errno::SUCCESS`/`NOMEM`/... matches intact.
    #[cfg(unix)]
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    #[repr(transparent)]
    pub(super) struct Errno(pub c_int);
    #[cfg(unix)]
    impl Errno {
        pub(super) const SUCCESS: Errno = Errno(0);
        #[cfg(target_os = "macos")]
        pub(super) const INVAL: Errno = Errno(libc::EINVAL);
        pub(super) const INTR: Errno = Errno(libc::EINTR);
    }
    /// Decode a syscall return: with libc, `rc == -1 ⇒ read __errno`,
    /// else `.SUCCESS`. For syscalls using the conventional return style
    /// (`wait4`, etc.) — NOT for `posix_spawn*`, which returns the errno
    /// directly; use [`errno_from_posix_spawn`] there.
    #[cfg(unix)]
    #[inline]
    pub(super) fn errno(rc: c_int) -> Errno {
        if rc == -1 {
            return Errno(bun_sys::posix::errno());
        }
        Errno::SUCCESS
    }

    /// The `posix_spawn*` family returns the errno **directly** (0 on
    /// success, nonzero errno on failure — never -1/`__errno`).
    #[cfg(target_os = "macos")]
    #[inline]
    pub(super) fn errno_from_posix_spawn(rc: c_int) -> Errno {
        Errno(rc)
    }

    /// Copy a path into a NUL-terminated buffer.
    pub(super) fn to_posix_path(path: &[u8]) -> Result<CString, Error> {
        CString::new(path).map_err(|_| crate::Error::Unexpected)
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
                mode,
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
            // previous buffer (if any) is dropped by assignment.
            // CString::new errors on interior NUL.
            self.chdir_buf = Some(CString::new(path).map_err(|_| crate::Error::Unexpected)?);
            Ok(())
        }
    }

    #[derive(Clone, Copy)]
    #[allow(dead_code)]
    pub(crate) struct Attr {
        pub detached: bool,
        pub new_process_group: bool,
        pub pty_slave_fd: i32,
        pub flags: u16,
        pub reset_signals: bool,
        pub linux_pdeathsig: i32,
        pub uid: Option<u32>,
        pub gid: Option<u32>,
    }

    impl Default for Attr {
        // `pty_slave_fd` must default to `-1`.
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
                uid: None,
                gid: None,
            }
        }
    }

    impl Attr {
        #[allow(dead_code)]
        pub(crate) fn init() -> Result<Attr, Error> {
            Ok(Attr::default())
        }

        #[allow(dead_code)]
        pub(crate) fn set(&mut self, flags: u16) -> Result<(), Error> {
            self.flags = flags;
            // FreeBSD's <spawn.h> has no POSIX_SPAWN_SETSID; bun-spawn.cpp
            // calls setsid() in the child for `detached`, which the spawn
            // path sets directly on this struct BEFORE calling set(). Preserve
            // that value when the flag bit isn't available. (The platforms
            // that define it are enumerated explicitly.)
            #[cfg(any(target_os = "linux", target_os = "android"))]
            {
                // glibc/musl/bionic <spawn.h> all define POSIX_SPAWN_SETSID as 0x80;
                // the libc crate only exposes it for `target_os = "linux"`.
                const POSIX_SPAWN_SETSID: u16 = 0x80;
                self.detached = (flags & POSIX_SPAWN_SETSID) != 0;
            }
            #[cfg(target_os = "macos")]
            {
                self.detached = (flags & super::darwin_spawn_np::POSIX_SPAWN_SETSID as u16) != 0;
            }
            Ok(())
        }

        #[allow(dead_code)]
        pub(crate) fn reset_signals(&mut self) -> Result<(), Error> {
            self.reset_signals = true;
            Ok(())
        }
    }
}

pub mod posix_spawn {
    #[cfg(unix)]
    use super::bun_spawn;
    use super::*;

    #[cfg(unix)]
    const SYSCALL_POSIX_SPAWN: sys::Tag = sys::Tag::posix_spawn;
    #[cfg(unix)]
    const SYSCALL_WAITPID: sys::Tag = sys::Tag::waitpid;

    #[derive(Copy, Clone)]
    pub struct WaitPidResult {
        pub pid: pid_t,
        pub status: u32,
    }

    /// Map a `posix_spawn*` errno to `sys::Result<()>`, preserving the errno
    /// so callers can surface it (Darwin's file-action registration returns
    /// EBADF for any fd >= OPEN_MAX, which must fail the spawn the way node
    /// does). Shared across all `posix_spawnattr_*` /
    /// `posix_spawn_file_actions_*` wrappers. `INVAL` stays a panic: it
    /// indicates a corrupted attr/actions object, i.e. a Bun bug.
    #[cfg(target_os = "macos")]
    #[inline]
    fn spawn_errno(e: Errno) -> sys::Result<()> {
        match e {
            Errno::SUCCESS => Ok(()),
            Errno::INVAL => unreachable!(), // attr/actions object is invalid
            e => Err(sys::Error::from_code_int(e.0, SYSCALL_POSIX_SPAWN)),
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
        pub fn init() -> sys::Result<PosixSpawnAttr> {
            let mut attr = core::mem::MaybeUninit::<system::posix_spawnattr_t>::uninit();
            // SAFETY: posix_spawnattr_init writes into attr on SUCCESS
            spawn_errno(errno_from_posix_spawn(unsafe {
                system::posix_spawnattr_init(attr.as_mut_ptr())
            }))?;
            Ok(PosixSpawnAttr {
                // SAFETY: spawn_errno returned Ok ⇒ SUCCESS ⇒ initialized
                attr: unsafe { attr.assume_init() },
                detached: false,
                pty_slave_fd: -1,
            })
        }

        pub fn set(&mut self, flags: u16) -> sys::Result<()> {
            // `as` between same-width signed/unsigned is a bitcast.
            let flags_s: c_short = flags as c_short;
            // SAFETY: self.attr is a live posix_spawnattr_t
            spawn_errno(errno_from_posix_spawn(unsafe {
                system::posix_spawnattr_setflags(&raw mut self.attr, flags_s)
            }))
        }

        pub fn reset_signals(&mut self) -> sys::Result<()> {
            // SAFETY: self.attr is a live posix_spawnattr_t
            if unsafe { posix_spawnattr_reset_signals(&raw mut self.attr) } != 0 {
                // posix_spawnattr_setsigdefault/setsigmask only fail on an
                // invalid attr; the C shim collapses the errno to 0/1.
                return Err(sys::Error::from_code(sys::E::EINVAL, SYSCALL_POSIX_SPAWN));
            }
            Ok(())
        }
    }

    #[cfg(target_os = "macos")]
    impl Drop for PosixSpawnAttr {
        fn drop(&mut self) {
            // SAFETY: self.attr was initialized by posix_spawnattr_init
            unsafe { system::posix_spawnattr_destroy(&raw mut self.attr) };
        }
    }

    // Implemented in src/jsc/bindings/spawn.cpp.
    #[cfg(target_os = "macos")]
    unsafe extern "C" {
        fn posix_spawnattr_reset_signals(attr: *mut system::posix_spawnattr_t) -> c_int;
    }

    #[cfg(target_os = "macos")]
    pub(crate) struct PosixSpawnActions {
        pub actions: system::posix_spawn_file_actions_t,
    }

    #[cfg(target_os = "macos")]
    impl PosixSpawnActions {
        pub(crate) fn init() -> sys::Result<PosixSpawnActions> {
            let mut actions =
                core::mem::MaybeUninit::<system::posix_spawn_file_actions_t>::uninit();
            // SAFETY: posix_spawn_file_actions_init writes into actions on SUCCESS
            spawn_errno(errno_from_posix_spawn(unsafe {
                system::posix_spawn_file_actions_init(actions.as_mut_ptr())
            }))?;
            Ok(PosixSpawnActions {
                // SAFETY: spawn_errno returned Ok ⇒ SUCCESS ⇒ initialized
                actions: unsafe { actions.assume_init() },
            })
        }

        pub(crate) fn open_z(
            &mut self,
            fd: Fd,
            path: &CStr,
            flags: u32,
            mode: mode_t,
        ) -> sys::Result<()> {
            let flags_c: c_int = flags as c_int;
            // SAFETY: self.actions is live; path is NUL-terminated
            spawn_errno(errno_from_posix_spawn(unsafe {
                system::posix_spawn_file_actions_addopen(
                    &raw mut self.actions,
                    fd.native(),
                    path.as_ptr(),
                    flags_c,
                    mode,
                )
            }))
        }

        pub(crate) fn dup2(&mut self, fd: Fd, newfd: Fd) -> sys::Result<()> {
            if fd == newfd {
                return self.inherit(fd);
            }

            // SAFETY: self.actions is live
            spawn_errno(errno_from_posix_spawn(unsafe {
                system::posix_spawn_file_actions_adddup2(
                    &raw mut self.actions,
                    fd.native(),
                    newfd.native(),
                )
            }))
        }

        pub(crate) fn inherit(&mut self, fd: Fd) -> sys::Result<()> {
            // SAFETY: self.actions is live
            spawn_errno(errno_from_posix_spawn(unsafe {
                super::darwin_spawn_np::posix_spawn_file_actions_addinherit_np(
                    &raw mut self.actions,
                    fd.native(),
                )
            }))
        }

        // deliberately not pub
        fn chdir_z(&mut self, path: &CStr) -> sys::Result<()> {
            // SAFETY: self.actions is live; path is NUL-terminated
            spawn_errno(errno_from_posix_spawn(unsafe {
                super::darwin_spawn_np::posix_spawn_file_actions_addchdir_np(
                    &raw mut self.actions,
                    path.as_ptr(),
                )
            }))
        }
    }

    #[cfg(target_os = "macos")]
    impl Drop for PosixSpawnActions {
        fn drop(&mut self) {
            // SAFETY: self.actions was initialized by posix_spawn_file_actions_init
            unsafe { system::posix_spawn_file_actions_destroy(&raw mut self.actions) };
        }
    }

    // Use BunSpawn types on POSIX (both Linux and macOS) for PTY support via posix_spawn_bun.
    // Windows uses different spawn mechanisms.
    #[cfg(unix)]
    pub(crate) type Actions = bun_spawn::Actions;
    #[cfg(unix)]
    pub(crate) type Attr = bun_spawn::Attr;
    // No not(unix) Actions/Attr aliases: Windows goes through
    // `process.rs::spawn_process_windows` (libuv) and never reaches these.

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
        let _ = &mut req; // keep req alive across the call

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
            // posix_spawn* returns the errno value directly.
            errno: rc as sys::ErrorInt,
            syscall: SYSCALL_POSIX_SPAWN,
            path: arg0.into(),
            ..Default::default()
        })
    }

    /// Convert portable `bun_spawn` actions/attrs into libc `posix_spawn`
    /// objects for the system posix_spawn path. Registration failures must
    /// fail the spawn: Darwin rejects file actions on fds >= OPEN_MAX (10240)
    /// with EBADF, and with POSIX_SPAWN_CLOEXEC_DEFAULT set, a silently
    /// dropped dup2 leaves the child's stdio closed, so the child looks like
    /// a successful run that produced no output.
    #[cfg(target_os = "macos")]
    fn convert_spawn_objects(
        actions: Option<&Actions>,
        attr: Option<&Attr>,
    ) -> sys::Result<(PosixSpawnActions, PosixSpawnAttr)> {
        let mut posix_actions = PosixSpawnActions::init()?;
        let mut posix_attr = PosixSpawnAttr::init()?;

        // Pass through all flags from the BunSpawn.Attr
        if let Some(a) = attr {
            let mut flags = a.flags;
            if a.new_process_group {
                flags |= system::POSIX_SPAWN_SETPGROUP as u16;
                // pgroup defaults to 0 in a freshly-init'd attr, i.e. child's own pid.
            }
            if flags != 0 {
                posix_attr.set(flags)?;
            }
            if a.reset_signals {
                posix_attr.reset_signals()?;
            }
        }

        if let Some(act) = actions {
            for action in &act.actions {
                match action.kind {
                    bun_spawn::FileActionType::Close => {
                        // Redundant: POSIX_SPAWN_CLOEXEC_DEFAULT (always set on
                        // this path) closes any fd without an open/dup2/inherit
                        // action. Darwin also fails the whole spawn with EBADF
                        // when an addclose fd is not open, so never register one.
                    }
                    bun_spawn::FileActionType::Dup2 => {
                        posix_actions.dup2(
                            Fd::from_native(action.fds[0]),
                            Fd::from_native(action.fds[1]),
                        )?;
                    }
                    bun_spawn::FileActionType::Open => {
                        // SAFETY: `.Open` actions always have a non-null path
                        // backed by a CString in `act.paths` (see `open_z`).
                        let p = unsafe { bun_core::ffi::cstr(action.path) };
                        posix_actions.open_z(
                            Fd::from_native(action.fds[0]),
                            p,
                            u32::try_from(action.flags).expect("int cast"),
                            mode_t::try_from(action.mode).unwrap(),
                        )?;
                    }
                    bun_spawn::FileActionType::None => {}
                }
            }

            if let Some(chdir_path) = act.chdir_buf.as_deref() {
                posix_actions.chdir_z(chdir_path)?;
            }
        }

        Ok((posix_actions, posix_attr))
    }

    #[cfg(unix)]
    pub(crate) fn spawn_z(
        path: &CStr,
        actions: Option<&Actions>,
        attr: Option<&Attr>,
        argv: *const *const c_char,
        envp: *const *const c_char,
    ) -> sys::Result<pid_t> {
        let pty_slave_fd = attr.map_or(-1, |a| a.pty_slave_fd);
        let detached = attr.is_some_and(|a| a.detached);
        let uid = attr.and_then(|a| a.uid);
        let gid = attr.and_then(|a| a.gid);

        // Use posix_spawn_bun when:
        // - Linux: always (uses vfork which is fast and safe)
        // - macOS: for PTY spawns (pty_slave_fd >= 0) because PTY setup requires
        //   setsid() + ioctl(TIOCSCTTY) before exec, which system posix_spawn can't do,
        //   and for uid/gid spawns because Darwin's posix_spawn cannot change ids
        //   (libuv makes the same fork() fallback for UV_PROCESS_SETUID/SETGID).
        //   For other spawns on macOS, we use system posix_spawn which is safer
        //   (Apple's posix_spawn uses a kernel fast-path that avoids fork() entirely).
        let use_bun_spawn = cfg!(any(target_os = "linux", target_os = "android"))
            || cfg!(target_os = "freebsd")
            || (cfg!(target_os = "macos") && (pty_slave_fd >= 0 || uid.is_some() || gid.is_some()));

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
                    new_process_group: attr.is_some_and(|a| a.new_process_group),
                    pty_slave_fd,
                    linux_pdeathsig: attr.map_or(0, |a| a.linux_pdeathsig),
                    uid: uid.unwrap_or(0),
                    gid: gid.unwrap_or(0),
                    set_uid: uid.is_some(),
                    set_gid: gid.is_some(),
                },
                argv,
                envp,
            );
        }

        // macOS without PTY: use system posix_spawn
        #[cfg(target_os = "macos")]
        {
            let (posix_actions, posix_attr) = match convert_spawn_objects(actions, attr) {
                Ok(converted) => converted,
                Err(e) => return sys::Result::Err(e.with_path(path.to_bytes())),
            };
            // Drop handles posix_actions.deinit() / posix_attr.deinit()

            let mut pid: pid_t = 0;
            // SAFETY: all pointers valid; argv/envp NULL-terminated. Darwin's
            // `libc` crate types argv/envp as `*const *mut c_char` (matching
            // the C header's non-const `char *const argv[]`); the strings are
            // never written, so the const→mut element cast is sound.
            let rc = unsafe {
                system::posix_spawn(
                    &raw mut pid,
                    path.as_ptr(),
                    &raw const posix_actions.actions,
                    &raw const posix_attr.attr,
                    argv.cast::<*mut c_char>(),
                    envp.cast::<*mut c_char>(),
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
        {
            unreachable!("posix_spawn_bun handles all unix-non-darwin spawns");
        }

        // Windows path (uses different mechanism)
        // Gated not(unix) because `actions`/`attr` here are PosixSpawnActions/PosixSpawnAttr
        // fields; on unix the Actions/Attr aliases resolve to bun_spawn::* which lack `.attr`.
        #[cfg(not(unix))]
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

    /// Same as waitpid, but also returns resource usage information.
    #[cfg(unix)]
    pub fn wait4(
        pid: pid_t,
        flags: u32,
        usage: Option<&mut process::Rusage>,
    ) -> sys::Result<WaitPidResult> {
        type PidStatus = c_int;
        let mut status: PidStatus = 0;
        // Convert the `Option<&mut Rusage>` once to a raw pointer (which is
        // Copy) so the retry loop can pass it on every iteration.
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

#[cfg(unix)]
use crate::spawn_process as process;
