use core::ffi::{c_char, c_int, c_short};
use core::ptr;
use std::ffi::{CStr, CString};

use bun_core::{err, Error};
use bun_sys::{self as sys, Fd};

// TODO(port): these std.posix wrappers need a home in bun_sys; placeholder paths for Phase B
use bun_sys::c as system; // std.posix.system (libc)
use bun_sys::posix::{errno, fd_t, mode_t, pid_t, to_posix_path, unexpected_errno, Errno};

// child module: src/runtime/api/bun/spawn/stdio.zig
pub mod stdio;

pub mod bun_spawn {
    use super::*;

    #[repr(u8)]
    #[derive(Copy, Clone, PartialEq, Eq, Default)]
    pub enum FileActionType {
        #[default]
        None = 0,
        Close = 1,
        Dup2 = 2,
        Open = 3,
    }

    // TODO(port): LIFETIMES.tsv classifies `path` as Option<CString> (OWNED), but this
    // struct is #[repr(C)] and crosses FFI to posix_spawn_bun via *const Action. CString
    // is a fat pointer and not ABI-compatible with `?[*:0]const u8`. Phase B must either
    // (a) keep Option<CString> here and marshal to a thin-ptr mirror struct at the FFI
    // boundary, or (b) revert this field to *const c_char with a manual Drop.
    #[repr(C)]
    pub struct Action {
        pub kind: FileActionType,
        pub path: Option<CString>,
        pub fds: [fd_t; 2],
        pub flags: c_int,
        pub mode: c_int,
    }

    impl Default for Action {
        fn default() -> Self {
            Self {
                kind: FileActionType::None,
                path: None,
                fds: [0; 2],
                flags: 0,
                mode: 0,
            }
        }
    }

    impl Action {
        pub fn init() -> Result<Action, Error> {
            // TODO(port): narrow error set
            Ok(Action::default())
        }
        // deinit: body only freed `path` when kind == .open; Option<CString> drops
        // automatically (it is None for other kinds), so no explicit Drop needed.
    }

    #[derive(Default)]
    pub struct Actions {
        pub chdir_buf: Option<CString>,
        pub actions: Vec<Action>,
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

        pub fn open_z(
            &mut self,
            fd: Fd,
            path: &CStr,
            flags: u32,
            mode: i32,
        ) -> Result<(), Error> {
            self.actions.push(Action {
                kind: FileActionType::Open,
                path: Some(path.to_owned()),
                flags: i32::try_from(flags).unwrap(),
                mode: i32::try_from(mode).unwrap(),
                fds: [fd.native(), 0],
            });
            Ok(())
        }

        pub fn close(&mut self, fd: Fd) -> Result<(), Error> {
            self.actions.push(Action {
                kind: FileActionType::Close,
                fds: [fd.native(), 0],
                ..Default::default()
            });
            Ok(())
        }

        pub fn dup2(&mut self, fd: Fd, newfd: Fd) -> Result<(), Error> {
            self.actions.push(Action {
                kind: FileActionType::Dup2,
                fds: [fd.native(), newfd.native()],
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

    #[derive(Default, Clone, Copy)]
    pub struct Attr {
        pub detached: bool,
        pub new_process_group: bool,
        pub pty_slave_fd: i32,
        pub flags: u16,
        pub reset_signals: bool,
        pub linux_pdeathsig: i32,
    }

    impl Attr {
        pub fn init() -> Result<Attr, Error> {
            Ok(Attr {
                pty_slave_fd: -1,
                ..Default::default()
            })
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
            // here as not-freebsd. Phase B should use a build-time cfg from bindgen.
            #[cfg(not(target_os = "freebsd"))]
            {
                self.detached = (flags & system::POSIX_SPAWN_SETSID as u16) != 0;
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
    use super::*;
    use super::bun_spawn;

    #[derive(Copy, Clone)]
    pub struct WaitPidResult {
        pub pid: pid_t,
        pub status: u32,
    }

    pub struct PosixSpawnAttr {
        pub attr: system::posix_spawnattr_t,
        pub detached: bool,
        pub pty_slave_fd: i32,
    }

    impl PosixSpawnAttr {
        pub fn init() -> Result<PosixSpawnAttr, Error> {
            let mut attr = core::mem::MaybeUninit::<system::posix_spawnattr_t>::uninit();
            // SAFETY: posix_spawnattr_init writes into attr on SUCCESS
            match errno(unsafe { system::posix_spawnattr_init(attr.as_mut_ptr()) }) {
                Errno::SUCCESS => Ok(PosixSpawnAttr {
                    // SAFETY: SUCCESS guarantees initialization
                    attr: unsafe { attr.assume_init() },
                    detached: false,
                    pty_slave_fd: -1,
                }),
                Errno::NOMEM => Err(err!("SystemResources")),
                Errno::INVAL => unreachable!(),
                e => Err(unexpected_errno(e)),
            }
        }

        pub fn get(&self) -> Result<u16, Error> {
            let mut flags: c_short = 0;
            // SAFETY: self.attr is a live posix_spawnattr_t
            match errno(unsafe { system::posix_spawnattr_getflags(&self.attr, &mut flags) }) {
                Errno::SUCCESS => {
                    // SAFETY: c_short and u16 are same size
                    Ok(unsafe { core::mem::transmute::<c_short, u16>(flags) })
                }
                Errno::INVAL => unreachable!(),
                e => Err(unexpected_errno(e)),
            }
        }

        pub fn set(&mut self, flags: u16) -> Result<(), Error> {
            // SAFETY: self.attr is a live posix_spawnattr_t
            let flags_s: c_short = unsafe { core::mem::transmute::<u16, c_short>(flags) };
            match errno(unsafe { system::posix_spawnattr_setflags(&mut self.attr, flags_s) }) {
                Errno::SUCCESS => Ok(()),
                Errno::INVAL => unreachable!(),
                e => Err(unexpected_errno(e)),
            }
        }

        pub fn reset_signals(&mut self) -> Result<(), Error> {
            // SAFETY: self.attr is a live posix_spawnattr_t
            if unsafe { posix_spawnattr_reset_signals(&mut self.attr) } != 0 {
                return Err(err!("SystemResources"));
            }
            Ok(())
        }
    }

    impl Drop for PosixSpawnAttr {
        fn drop(&mut self) {
            // SAFETY: self.attr was initialized by posix_spawnattr_init
            unsafe { system::posix_spawnattr_destroy(&mut self.attr) };
        }
    }

    // TODO(port): move to runtime_sys
    unsafe extern "C" {
        fn posix_spawnattr_reset_signals(attr: *mut system::posix_spawnattr_t) -> c_int;
    }

    pub struct PosixSpawnActions {
        pub actions: system::posix_spawn_file_actions_t,
    }

    impl PosixSpawnActions {
        pub fn init() -> Result<PosixSpawnActions, Error> {
            let mut actions =
                core::mem::MaybeUninit::<system::posix_spawn_file_actions_t>::uninit();
            // SAFETY: posix_spawn_file_actions_init writes into actions on SUCCESS
            match errno(unsafe { system::posix_spawn_file_actions_init(actions.as_mut_ptr()) }) {
                Errno::SUCCESS => Ok(PosixSpawnActions {
                    // SAFETY: SUCCESS guarantees initialization
                    actions: unsafe { actions.assume_init() },
                }),
                Errno::NOMEM => Err(err!("SystemResources")),
                Errno::INVAL => unreachable!(),
                e => Err(unexpected_errno(e)),
            }
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
            // SAFETY: self.actions is live; path is NUL-terminated
            let flags_c: c_int = unsafe { core::mem::transmute::<u32, c_int>(flags) };
            match errno(unsafe {
                system::posix_spawn_file_actions_addopen(
                    &mut self.actions,
                    fd.cast(),
                    path.as_ptr(),
                    flags_c,
                    mode,
                )
            }) {
                Errno::SUCCESS => Ok(()),
                Errno::BADF => Err(err!("InvalidFileDescriptor")),
                Errno::NOMEM => Err(err!("SystemResources")),
                Errno::NAMETOOLONG => Err(err!("NameTooLong")),
                Errno::INVAL => unreachable!(), // the value of file actions is invalid
                e => Err(unexpected_errno(e)),
            }
        }

        pub fn close(&mut self, fd: Fd) -> Result<(), Error> {
            // SAFETY: self.actions is live
            match errno(unsafe {
                system::posix_spawn_file_actions_addclose(&mut self.actions, fd.cast())
            }) {
                Errno::SUCCESS => Ok(()),
                Errno::BADF => Err(err!("InvalidFileDescriptor")),
                Errno::NOMEM => Err(err!("SystemResources")),
                Errno::INVAL => unreachable!(), // the value of file actions is invalid
                Errno::NAMETOOLONG => unreachable!(),
                e => Err(unexpected_errno(e)),
            }
        }

        pub fn dup2(&mut self, fd: Fd, newfd: Fd) -> Result<(), Error> {
            if fd == newfd {
                return self.inherit(fd);
            }

            // SAFETY: self.actions is live
            match errno(unsafe {
                system::posix_spawn_file_actions_adddup2(&mut self.actions, fd.cast(), newfd.cast())
            }) {
                Errno::SUCCESS => Ok(()),
                Errno::BADF => Err(err!("InvalidFileDescriptor")),
                Errno::NOMEM => Err(err!("SystemResources")),
                Errno::INVAL => unreachable!(), // the value of file actions is invalid
                Errno::NAMETOOLONG => unreachable!(),
                e => Err(unexpected_errno(e)),
            }
        }

        pub fn inherit(&mut self, fd: Fd) -> Result<(), Error> {
            // SAFETY: self.actions is live
            match errno(unsafe {
                system::posix_spawn_file_actions_addinherit_np(&mut self.actions, fd.cast())
            }) {
                Errno::SUCCESS => Ok(()),
                Errno::BADF => Err(err!("InvalidFileDescriptor")),
                Errno::NOMEM => Err(err!("SystemResources")),
                Errno::INVAL => unreachable!(), // the value of file actions is invalid
                Errno::NAMETOOLONG => unreachable!(),
                e => Err(unexpected_errno(e)),
            }
        }

        pub fn chdir(&mut self, path: &[u8]) -> Result<(), Error> {
            let posix_path = to_posix_path(path)?;
            self.chdir_z(&posix_path)
        }

        // deliberately not pub
        fn chdir_z(&mut self, path: &CStr) -> Result<(), Error> {
            // SAFETY: self.actions is live; path is NUL-terminated
            match errno(unsafe {
                system::posix_spawn_file_actions_addchdir_np(&mut self.actions, path.as_ptr())
            }) {
                Errno::SUCCESS => Ok(()),
                Errno::NOMEM => Err(err!("SystemResources")),
                Errno::NAMETOOLONG => Err(err!("NameTooLong")),
                Errno::BADF => unreachable!(),
                Errno::INVAL => unreachable!(), // the value of file actions is invalid
                e => Err(unexpected_errno(e)),
            }
        }
    }

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
    #[cfg(not(unix))]
    pub type Actions = PosixSpawnActions;

    #[cfg(unix)]
    pub type Attr = bun_spawn::Attr;
    #[cfg(not(unix))]
    pub type Attr = PosixSpawnAttr;

    /// Used for Linux spawns and macOS PTY spawns via posix_spawn_bun.
    #[repr(C)]
    pub(super) struct BunSpawnRequest {
        chdir_buf: *const c_char,
        detached: bool,
        new_process_group: bool,
        actions: ActionsList,
        pty_slave_fd: i32,
        linux_pdeathsig: i32,
    }

    impl Default for BunSpawnRequest {
        fn default() -> Self {
            Self {
                chdir_buf: ptr::null(),
                detached: false,
                new_process_group: false,
                actions: ActionsList::default(),
                pty_slave_fd: -1,
                linux_pdeathsig: 0,
            }
        }
    }

    #[repr(C)]
    pub(super) struct ActionsList {
        ptr: *const bun_spawn::Action,
        len: usize,
    }

    impl Default for ActionsList {
        fn default() -> Self {
            Self { ptr: ptr::null(), len: 0 }
        }
    }

    // TODO(port): move to runtime_sys
    unsafe extern "C" {
        fn posix_spawn_bun(
            pid: *mut c_int,
            path: *const c_char,
            request: *const BunSpawnRequest,
            argv: *const *const c_char,
            envp: *const *const c_char,
        ) -> isize;
    }

    impl BunSpawnRequest {
        pub fn spawn(
            path: &CStr,
            req_: BunSpawnRequest,
            argv: *const *const c_char,
            envp: *const *const c_char,
        ) -> sys::Result<pid_t> {
            let mut req = req_;
            let mut pid: c_int = 0;

            // SAFETY: path is NUL-terminated; argv/envp are NULL-terminated arrays of C strings
            let rc = unsafe { posix_spawn_bun(&mut pid, path.as_ptr(), &req, argv, envp) };
            let _ = &mut req; // keep req alive across the call (matches Zig taking &req of a local copy)

            if cfg!(debug_assertions) {
                // SAFETY: argv has at least one element (the NULL terminator)
                let arg0 = unsafe {
                    let p = *argv;
                    if p.is_null() {
                        &b""[..]
                    } else {
                        CStr::from_ptr(p).to_bytes()
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
                return sys::Result::Ok(pid_t::try_from(pid).unwrap());
            }

            // SAFETY: argv has at least one element (the NULL terminator)
            let arg0 = unsafe {
                let p = *argv;
                if p.is_null() {
                    &b""[..]
                } else {
                    CStr::from_ptr(p).to_bytes()
                }
            };
            sys::Result::Err(sys::Error {
                // @truncate(@intFromEnum(@as(std.c.E, @enumFromInt(rc))))
                errno: rc as sys::ErrorInt,
                syscall: sys::Syscall::PosixSpawn,
                path: arg0.into(),
                ..Default::default()
            })
        }
    }

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
            return BunSpawnRequest::spawn(
                path,
                BunSpawnRequest {
                    actions: match actions {
                        Some(act) => ActionsList {
                            ptr: act.actions.as_ptr(),
                            len: act.actions.len(),
                        },
                        None => ActionsList { ptr: ptr::null(), len: 0 },
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
                        errno: Errno::NOMEM as sys::ErrorInt,
                        syscall: sys::Syscall::PosixSpawn,
                        ..Default::default()
                    });
                }
            };
            // Drop handles posix_actions.deinit()

            let mut posix_attr = match PosixSpawnAttr::init() {
                Ok(a) => a,
                Err(_) => {
                    return sys::Result::Err(sys::Error {
                        errno: Errno::NOMEM as sys::ErrorInt,
                        syscall: sys::Syscall::PosixSpawn,
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
                            let p = action.path.as_deref().unwrap();
                            if let Err(e) = posix_actions.open_z(
                                Fd::from_native(action.fds[0]),
                                p,
                                u32::try_from(action.flags).unwrap(),
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
            // SAFETY: all pointers valid; argv/envp NULL-terminated
            let rc = unsafe {
                system::posix_spawn(
                    &mut pid,
                    path.as_ptr(),
                    &posix_actions.actions,
                    &posix_attr.attr,
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

            if rc == 0 {
                return sys::Result::Ok(pid);
            }

            return sys::Result::Err(sys::Error {
                errno: rc as sys::ErrorInt,
                syscall: sys::Syscall::PosixSpawn,
                path: path.to_bytes().into(),
                ..Default::default()
            });
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
                syscall: sys::Syscall::PosixSpawn,
                path: path.to_bytes().into(),
                ..Default::default()
            })
        }
    }

    /// Use this version of the `waitpid` wrapper if you spawned your child process using `posix_spawn`
    /// or `posix_spawnp` syscalls.
    /// See also `std.posix.waitpid` for an alternative if your child process was spawned via `fork` and
    /// `execve` method.
    pub fn waitpid(pid: pid_t, flags: u32) -> sys::Result<WaitPidResult> {
        type PidStatus = c_int;
        let mut status: PidStatus = 0;
        loop {
            // SAFETY: status is a valid out-pointer
            let rc = unsafe {
                system::waitpid(pid, &mut status, c_int::try_from(flags).unwrap())
            };
            match errno(rc) {
                Errno::SUCCESS => {
                    return sys::Result::Ok(WaitPidResult {
                        pid: pid_t::try_from(rc).unwrap(),
                        // SAFETY: c_int and u32 are same size
                        status: unsafe { core::mem::transmute::<c_int, u32>(status) },
                    });
                }
                Errno::INTR => continue,
                _ => {
                    return sys::Result::<WaitPidResult>::errno_sys(rc, sys::Syscall::Waitpid)
                        .unwrap();
                }
            }
        }
    }

    /// Same as waitpid, but also returns resource usage information.
    pub fn wait4(
        pid: pid_t,
        flags: u32,
        usage: Option<&mut process::Rusage>,
    ) -> sys::Result<WaitPidResult> {
        type PidStatus = c_int;
        let mut status: PidStatus = 0;
        // PORT NOTE: reshaped for borrowck — Zig passes the same `?*Rusage` every loop
        // iteration via @ptrCast(usage); convert once to a raw ptr that is Copy.
        let usage_ptr: *mut core::ffi::c_void = match usage {
            Some(u) => (u as *mut process::Rusage).cast(),
            None => ptr::null_mut(),
        };
        loop {
            // SAFETY: status is a valid out-pointer; usage_ptr is either null or a valid *mut Rusage
            let rc = unsafe {
                system::wait4(
                    pid,
                    &mut status,
                    c_int::try_from(flags).unwrap(),
                    usage_ptr,
                )
            };
            match errno(rc) {
                Errno::SUCCESS => {
                    return sys::Result::Ok(WaitPidResult {
                        pid: pid_t::try_from(rc).unwrap(),
                        // SAFETY: c_int and u32 are same size
                        status: unsafe { core::mem::transmute::<c_int, u32>(status) },
                    });
                }
                Errno::INTR => continue,
                _ => {
                    return sys::Result::<WaitPidResult>::errno_sys(rc, sys::Syscall::Waitpid)
                        .unwrap();
                }
            }
        }
    }

    pub use super::process;
    pub use process::{
        spawn_process, sync, PosixSpawnResult, Process, Rusage, SpawnOptions,
        SpawnProcessResult, Status, WindowsSpawnOptions, WindowsSpawnResult,
    };

    pub use super::stdio::Stdio;
}

// Re-export at file scope to mirror Zig's `pub const PosixSpawn` / `pub const BunSpawn`
pub use bun_spawn as BunSpawn;
pub use posix_spawn as PosixSpawn;

// sibling module: src/runtime/api/bun/process.zig
use super::process;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/bun/spawn.zig (566 lines)
//   confidence: medium
//   todos:      9
//   notes:      Action is #[repr(C)] but LIFETIMES.tsv mandates Option<CString> for .path — ABI-incompatible with posix_spawn_bun; Phase B must marshal or revert to *const c_char. std.posix wrappers (errno/to_posix_path/system) referenced via bun_sys placeholders. spawn_z platform branches cfg-gated but linux/freebsd fall-through reachability needs Phase B restructure.
// ──────────────────────────────────────────────────────────────────────────
