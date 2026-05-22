use bun_core::zstr::ZBox;

// ── spawn_sync_inherit ────────────────────────────────────────────────────
/// Minimal "spawn argv, inherit stdio, wait" used by crash_handler's
/// symbolizer. Port of the subset of `bun.spawnSync` needed at tier-0.
/// Full `bun.spawnSync` (with buffered stdio, env, cwd) is in bun_spawn.
#[derive(Debug, Clone, Copy)]
pub struct SpawnStatus {
    pub code: i32,
}
impl SpawnStatus {
    #[inline]
    pub fn is_ok(self) -> bool {
        self.code == 0
    }
}

// ── posix_spawn_bun FFI (canonical #[repr(C)] mirror) ─────────────────────
// RULE: libc `posix_spawn`/`posix_spawnp` must NEVER be called directly on
// Linux/FreeBSD. Bun ships its own vfork-based spawner in
// `src/jsc/bindings/bun-spawn.cpp` (`posix_spawn_bun`) which is async-signal-
// safe, supports CLOEXEC sweeps, pdeathsig, PTY setup, and writes the exec
// errno back through a pipe. glibc's posix_spawn forks (not vfork) on some
// configurations and musl's has had signal-mask bugs; ours is the audited
// path. macOS keeps libc `posix_spawnp` for the non-PTY case because Apple's
// implementation is a true kernel fast-path (no fork at all), but the macOS
// PTY path also routes through `posix_spawn_bun` (setsid + TIOCSCTTY before
// exec), hence `cfg(unix)` here.
//
// This is the single source of truth for the request layout; `spawn_sys`
// re-exports these types rather than re-declaring them. The #[repr(C)] data
// mirrors are target-agnostic so the module is ungated; only the extern decl
// is `cfg(unix)` (Windows spawns go through libuv and never link this symbol).
pub mod spawn_ffi {
    use core::ffi::{c_char, c_int};

    /// Matches `bun_spawn_request_file_action_t::kind`.
    #[repr(u8)]
    #[derive(Copy, Clone, PartialEq, Eq, Default)]
    pub enum FileActionType {
        #[default]
        None = 0,
        Close = 1,
        Dup2 = 2,
        Open = 3,
    }

    /// Matches `bun_spawn_request_file_action_t`.
    ///
    /// ABI: this struct crosses FFI to `posix_spawn_bun` via `*const Action`
    /// (see [`ActionsList`]) and must match spawn.zig's `extern struct` /
    /// bun-spawn.cpp's C struct exactly. `path` is `?[*:0]const u8` on the
    /// Zig/C side — an 8-byte thin nullable pointer — so it MUST be
    /// `*const c_char` here, not `Option<CString>` (which is a 16-byte fat
    /// pointer and would shift `fds`/`flags`/`mode`).
    #[repr(C)]
    pub struct Action {
        pub kind: FileActionType,
        pub path: *const c_char,
        pub fds: [c_int; 2],
        pub flags: c_int,
        pub mode: c_int,
    }

    impl Default for Action {
        fn default() -> Self {
            Self {
                kind: FileActionType::None,
                path: core::ptr::null(),
                fds: [0; 2],
                flags: 0,
                mode: 0,
            }
        }
    }

    /// Matches `bun_spawn_file_action_list_t`.
    #[repr(C)]
    pub struct ActionsList {
        pub ptr: *const Action,
        pub len: usize,
    }

    impl Default for ActionsList {
        fn default() -> Self {
            Self {
                ptr: core::ptr::null(),
                len: 0,
            }
        }
    }

    /// Matches `bun_spawn_request_t`.
    #[repr(C)]
    pub struct BunSpawnRequest {
        pub chdir_buf: *const c_char,
        pub detached: bool,
        pub new_process_group: bool,
        pub actions: ActionsList,
        pub pty_slave_fd: c_int,
        pub linux_pdeathsig: c_int,
    }

    impl Default for BunSpawnRequest {
        fn default() -> Self {
            Self {
                chdir_buf: core::ptr::null(),
                detached: false,
                new_process_group: false,
                actions: ActionsList::default(),
                pty_slave_fd: -1,
                linux_pdeathsig: 0,
            }
        }
    }

    #[cfg(unix)]
    unsafe extern "C" {
        pub fn posix_spawn_bun(
            pid: *mut c_int,
            path: *const c_char,
            request: *const BunSpawnRequest,
            argv: *const *const c_char,
            envp: *const *const c_char,
        ) -> isize;
    }
}

pub fn spawn_sync_inherit(argv: &[impl AsRef<[u8]>]) -> Result<SpawnStatus, bun_core::Error> {
    #[cfg(unix)]
    // SAFETY: argv strings are owned `ZBox`es (NUL-terminated) kept alive in
    // `cargs` for the duration of the spawn; `ptrs`/`environ` are null-
    // terminated `*const c_char` arrays as required by `posix_spawn_bun` /
    // `posix_spawnp`. `waitpid` is passed a valid `&mut c_int` out-param.
    unsafe {
        let cargs: Vec<ZBox> = argv
            .iter()
            .map(|a| ZBox::from_vec_with_nul(a.as_ref().to_vec()))
            .collect();
        let mut ptrs: Vec<*const core::ffi::c_char> = cargs.iter().map(|z| z.as_ptr()).collect();
        ptrs.push(core::ptr::null());

        let environ = bun_core::getenv::c_environ();

        // Linux/FreeBSD: route through Bun's vfork-based posix_spawn_bun.
        // It uses execve (no PATH search), so resolve argv[0] via $PATH first
        // to preserve the `posix_spawnp`-like contract callers expect (e.g.
        // crash_handler spawning `llvm-symbolizer` by bare name).
        #[cfg(any(target_os = "linux", target_os = "freebsd"))]
        let pid: libc::pid_t = {
            let arg0 = argv[0].as_ref();
            let mut pathbuf = bun_core::PathBuffer::uninit();
            let exe: *const core::ffi::c_char = if arg0.contains(&b'/') {
                // Contains a separator → use as-is (execve resolves relative
                // to cwd, matching posix_spawnp semantics for non-bare names).
                ptrs[0]
            } else {
                let path_env =
                    bun_core::getenv_z(bun_core::ZStr::from_static(b"PATH\0")).unwrap_or(b"");
                match bun_which::which(&mut pathbuf, path_env, b".", arg0) {
                    Some(z) => z.as_ptr(),
                    None => return Err(bun_core::Error::from_errno(libc::ENOENT)),
                }
            };

            let req = spawn_ffi::BunSpawnRequest::default();
            let mut pid: core::ffi::c_int = 0;
            // SAFETY: exe/ptrs/environ are NUL-terminated; req layout matches C.
            let rc = spawn_ffi::posix_spawn_bun(
                &raw mut pid,
                exe,
                &raw const req,
                ptrs.as_ptr(),
                environ,
            );
            if rc != 0 {
                return Err(bun_core::Error::from_errno(rc as i32));
            }
            pid as libc::pid_t
        };
        // macOS: Apple's posix_spawnp is a kernel fast-path (no fork); keep it
        // for the non-PTY inherit case. PTY spawns go through spawn_sys.
        #[cfg(target_os = "macos")]
        let pid: libc::pid_t = {
            let mut pid: libc::pid_t = 0;
            let rc = libc::posix_spawnp(
                &raw mut pid,
                ptrs[0],
                core::ptr::null(),
                core::ptr::null(),
                ptrs.as_ptr().cast::<*mut core::ffi::c_char>(),
                environ.cast::<*mut core::ffi::c_char>(),
            );
            if rc != 0 {
                return Err(bun_core::Error::from_errno(rc));
            }
            pid
        };
        // Android: bionic only added posix_spawnp at API 28 and the `libc`
        // crate doesn't bind it for `target_os = "android"`; bun-spawn.cpp is
        // gated to LINUX/DARWIN/FREEBSD. Fall back to fork+execvp.
        #[cfg(target_os = "android")]
        let pid: libc::pid_t = {
            let _ = environ;
            let pid = libc::fork();
            if pid < 0 {
                let e = std::io::Error::last_os_error().raw_os_error().unwrap_or(-1);
                return Err(bun_core::Error::from_errno(e));
            }
            if pid == 0 {
                // Child. execvp inherits stdio + environ, which is exactly the
                // "inherit" contract this helper promises. On failure, _exit
                // (no destructors / atexit hooks in a forked child).
                libc::execvp(ptrs[0], ptrs.as_ptr());
                libc::_exit(127);
            }
            pid
        };
        // Other unix (e.g. NetBSD/OpenBSD if ever targeted): not a Bun
        // platform. Fail loudly rather than silently fork.
        #[cfg(not(any(
            target_os = "linux",
            target_os = "freebsd",
            target_os = "macos",
            target_os = "android",
        )))]
        let pid: libc::pid_t = {
            let _ = (&ptrs, environ);
            return Err(bun_core::err!(Unexpected));
        };

        let mut status: i32 = 0;
        loop {
            let r = libc::waitpid(pid, &raw mut status, 0);
            if r == -1 {
                let e = std::io::Error::last_os_error().raw_os_error().unwrap_or(-1);
                if e == libc::EINTR {
                    continue;
                }
                return Err(bun_core::Error::from_errno(e));
            }
            break;
        }
        let code = if libc::WIFEXITED(status) {
            libc::WEXITSTATUS(status)
        } else {
            -1
        };
        Ok(SpawnStatus { code })
    }
    #[cfg(windows)]
    {
        // Zig spec call sites (init_command.zig:855, :1237) use
        // `std.process.Child{.stderr,stdin,stdout = .Inherit}.spawnAndWait()`,
        // which on Windows is `windowsCreateProcessPathExt` → CreateProcessW
        // with no event loop. Route through `std::process::Command` (also
        // CreateProcessW) with inherited stdio — see spawn/lib.rs:307 for the
        // PORTING.md rationale on why off-loop spawns may bypass bun_spawn on
        // Windows. Do NOT return `err!(Unexpected)` here: that bubbles up as
        // `error: An unknown error occurred (Unexpected)` and fails every
        // `bun init` invocation on Windows (test/cli/init/init.test.ts).
        use std::ffi::OsString;
        use std::os::windows::ffi::OsStringExt;

        // argv is WTF-8 (selfExePath etc.); decode to WTF-16 for CreateProcessW.
        fn to_os(b: &[u8]) -> OsString {
            let mut wbuf = vec![0u16; b.len() + 1];
            let n = bun_core::strings::convert_utf8_to_utf16_in_buffer(&mut wbuf, b).len();
            OsString::from_wide(&wbuf[..n])
        }

        let mut iter = argv.iter();
        let argv0 = iter.next().ok_or(bun_core::err!("FileNotFound"))?;
        let mut cmd = std::process::Command::new(to_os(argv0.as_ref()));
        for arg in iter {
            cmd.arg(to_os(arg.as_ref()));
        }
        // Inherit stdio + environ (Command default), matching Zig `.Inherit`.
        let status = cmd.status().map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => bun_core::err!("FileNotFound"),
            std::io::ErrorKind::PermissionDenied => bun_core::err!("AccessDenied"),
            _ => bun_core::Error::from(e),
        })?;
        let code = status.code().unwrap_or(-1);
        Ok(SpawnStatus { code })
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = argv;
        Err(bun_core::err!(Unexpected))
    }
}
