use crate::getenv::getenv_z;
use crate::once::Once;
use crate::sync::Mutex;
use crate::zstr::{ZBox, ZStr};

// ── self_exe_path ─────────────────────────────────────────────────────────
// Port of `bun.selfExePath` (bun.zig:3011). Memoized into a process-lifetime
// static buffer; thread-safe via `Once`. Returns a `&'static ZStr`.
pub fn self_exe_path() -> Result<&'static ZStr, crate::Error> {
    static CELL: Once<Result<ZBox, crate::Error>> = Once::new();
    let r = CELL.get_or_init(|| {
        let path = std::env::current_exe().map_err(crate::Error::from)?;
        // PORT NOTE: Zig's `std.fs.selfExePath` resolves symlinks. Rust's
        // `current_exe()` already does on Linux (`readlink /proc/self/exe`),
        // but on Darwin it returns the raw `_NSGetExecutablePath` result and on
        // Windows it returns the raw `GetModuleFileNameW` result — neither
        // realpaths, so a symlinked argv0 (Darwin) or an un-normalized
        // `C:\a\.\b\bun.exe` load path (Windows) leaks through to
        // `process.execPath` / `process.argv[0]`. Zig's Windows impl calls
        // `realpathW` (GetFinalPathNameByHandle); match that here so parent and
        // child agree on argv[0] regardless of how the binary was invoked
        // (test/js/node/process/process-args.test.js,
        //  test/js/node/test/parallel/test-process-execpath.js).
        #[cfg(any(target_vendor = "apple", windows))]
        let path = path.canonicalize().unwrap_or(path);
        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStringExt;
            Ok(ZBox::from_vec_with_nul(path.into_os_string().into_vec()))
        }
        #[cfg(windows)]
        {
            // PORT NOTE: Zig stored the WTF-8 form. `into_string()` rejects unpaired
            // surrogates; fall back to the lossy form (Windows exe paths are valid
            // Unicode in practice).
            let mut s = path
                .into_os_string()
                .into_string()
                .unwrap_or_else(|os| os.to_string_lossy().into_owned());
            // `canonicalize()` on Windows returns a verbatim `\\?\` path; Zig's
            // `realpathW` strips that back to a plain DOS path before WTF-8
            // encoding, so do the same (Node's `process.execPath` is never
            // verbatim-prefixed).
            if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
                s = format!(r"\\{}", rest);
            } else if let Some(rest) = s.strip_prefix(r"\\?\") {
                s = rest.to_owned();
            }
            Ok(ZBox::from_vec_with_nul(s.into_bytes()))
        }
    });
    match r {
        Ok(z) => Ok(z.as_zstr()),
        Err(e) => Err(*e),
    }
}

// ── get_thread_count ──────────────────────────────────────────────────────
// Port of `bun.getThreadCount` (bun.zig:3597). Clamped to [2, 1024]; honours
// UV_THREADPOOL_SIZE / GOMAXPROCS overrides.
pub fn get_thread_count() -> u16 {
    static CELL: Once<u16> = Once::new();
    *CELL.get_or_init(|| {
        const MAX: u16 = 1024;
        const MIN: u16 = 2;
        let from_env = || -> Option<u16> {
            for key in [
                crate::zstr!("UV_THREADPOOL_SIZE"),
                crate::zstr!("GOMAXPROCS"),
            ] {
                if let Some(v) = getenv_z(key) {
                    if let Ok(n) = crate::fmt::parse_int::<u16>(v.trim_ascii(), 10) {
                        if n >= MIN {
                            return Some(n.min(MAX));
                        }
                    }
                }
                // Windows: `getenv_z` is currently a no-op (no narrow C
                // environ to borrow from); honour the override via
                // `std::env::var` so behaviour matches Zig `bun.getThreadCount`
                // on all platforms. POSIX keeps the borrow path above.
                #[cfg(windows)]
                if let Ok(s) = std::env::var(
                    // SAFETY: keys above are ASCII literals.
                    unsafe { core::str::from_utf8_unchecked(key.as_bytes()) },
                ) {
                    if let Ok(n) = s.trim().parse::<u16>() {
                        if n >= MIN {
                            return Some(n.min(MAX));
                        }
                    }
                }
            }
            None
        };
        let raw = from_env().unwrap_or_else(|| {
            // Zig (bun.zig:3621) calls `jsc.wtf.numberOfProcessorCores()` —
            // `WTF::numberOfProcessorCores()` → sysconf(_SC_NPROCESSORS_ONLN)
            // on POSIX / GetSystemInfo on Windows. **Not** the same as
            // `std::thread::available_parallelism()`, which on Linux also
            // consults sched_getaffinity + cgroup cpu.max quota; on
            // cgroup-limited CI runners or P/E-core machines the two diverge,
            // changing bundler `max_threads` (and per-thread mimalloc arena
            // RSS) vs the Zig binary. Declare the C symbol locally — `jsc`
            // is above `bun_core` in the crate DAG so we can't `use` it, but
            // the symbol is always linked (wtf-bindings.cpp).
            unsafe extern "C" {
                safe fn WTF__numberOfProcessorCores() -> core::ffi::c_int;
            }
            WTF__numberOfProcessorCores().max(1) as u16
        });
        raw.clamp(MIN, MAX)
    })
}

// ── mach_port ─────────────────────────────────────────────────────────────
// Zig: `if (Environment.isMac) std.c.mach_port_t else u32`.
#[cfg(target_os = "macos")]
pub type mach_port = libc::mach_port_t;
#[cfg(not(target_os = "macos"))]
pub type mach_port = u32;

// ── auto_reload_on_crash / reload_process group ───────────────────────────
// Port of `bun.zig:1527-1686`. Full body of `reloadProcess` depends on
// `bun.spawn` (tier-4); the crash-handler only needs the flag + the
// thread-coordination helpers + a best-effort POSIX `execve` path.
use core::sync::atomic::{AtomicBool, Ordering as AOrdering};
static AUTO_RELOAD_ON_CRASH: AtomicBool = AtomicBool::new(false);
static RELOAD_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
thread_local! {
    static RELOAD_IN_PROGRESS_ON_CURRENT_THREAD: core::cell::Cell<bool> = const { core::cell::Cell::new(false) };
}

#[inline]
pub fn auto_reload_on_crash() -> bool {
    AUTO_RELOAD_ON_CRASH.load(AOrdering::Relaxed)
}
#[inline]
pub fn set_auto_reload_on_crash(v: bool) {
    AUTO_RELOAD_ON_CRASH.store(v, AOrdering::Relaxed)
}

#[inline]
pub fn is_process_reload_in_progress_on_another_thread() -> bool {
    RELOAD_IN_PROGRESS.load(AOrdering::Relaxed)
        && !RELOAD_IN_PROGRESS_ON_CURRENT_THREAD.with(|c| c.get())
}

/// Zig: `bun.exitThread()` — terminate the current OS thread without unwinding.
/// POSIX `pthread_exit`; Windows `ExitThread`. Called from worker `shutdown()`.
pub fn exit_thread() -> ! {
    #[cfg(unix)]
    {
        // `retval` is stored opaquely for `pthread_join` and never
        // dereferenced by libc itself; thread termination leaks but cannot
        // violate memory safety (same rationale as `std::process::exit`
        // being safe), so `safe fn` discharges the link-time proof.
        unsafe extern "C" {
            safe fn pthread_exit(retval: *mut core::ffi::c_void) -> !;
        }
        pthread_exit(core::ptr::null_mut());
    }
    #[cfg(windows)]
    // `ExitThread` is declared `safe fn` in `bun_windows_sys::kernel32`.
    crate::windows_sys::kernel32::ExitThread(0);
    #[cfg(not(any(unix, windows)))]
    loop {
        core::hint::spin_loop();
    }
}

/// Zig: `bun.deleteAllPoolsForThreadExit()` — release thread-local pooled
/// buffers (PathBuffer pool, ObjectPool, …) before the thread terminates so
/// the backing storage is returned to mimalloc rather than leaked with the
/// TLS block.
///
/// LAYERING: the actual pool registries live in higher-tier crates
/// (`bun_paths`, `bun_collections`). They register a destructor here at init
/// via [`register_thread_exit_pool_destructor`]; this fn just walks the list.
static THREAD_EXIT_POOL_DESTRUCTORS: Mutex<Vec<fn()>> = Mutex::new(Vec::new());

pub fn register_thread_exit_pool_destructor(f: fn()) {
    THREAD_EXIT_POOL_DESTRUCTORS.lock().push(f);
}

pub fn delete_all_pools_for_thread_exit() {
    // Snapshot under the lock so a destructor can't deadlock by
    // re-registering.
    let snapshot: Vec<fn()> = THREAD_EXIT_POOL_DESTRUCTORS.lock().clone();
    for f in snapshot {
        f();
    }
}

/// Port of `bun.maybeHandlePanicDuringProcessReload`.
#[inline(never)]
pub fn maybe_handle_panic_during_process_reload() {
    if is_process_reload_in_progress_on_another_thread() {
        crate::output::flush();
        #[cfg(debug_assertions)]
        crate::output::debug_warn("panic() called during process reload, ignoring\n");
        // Zig: `bun.exitThread()`. POSIX `pthread_exit`; Windows `ExitThread`.
        exit_thread();
    }
    // Spin if pthread_exit was a no-op (pathological).
    while is_process_reload_in_progress_on_another_thread() {
        core::hint::spin_loop();
        #[cfg(unix)]
        {
            // `&libc::timespec` / `Option<&mut libc::timespec>` are
            // ABI-identical to libc's `const struct timespec *` / nullable
            // `struct timespec *`; the types encode the only pointer-validity
            // preconditions, so `safe fn` discharges the link-time proof.
            unsafe extern "C" {
                #[link_name = "nanosleep"]
                safe fn libc_nanosleep(
                    req: &libc::timespec,
                    rem: Option<&mut libc::timespec>,
                ) -> core::ffi::c_int;
            }
            let _ = libc_nanosleep(
                &libc::timespec {
                    tv_sec: 1,
                    tv_nsec: 0,
                },
                None,
            );
        }
    }
}

/// Port of `bun.reloadProcess`. Allocator param dropped (uses libc malloc via
/// `dupe_z`). `may_return == true` → returns on failure; `false` → panics.
/// macOS posix_spawn path is deferred to bun_spawn (tier-4); tier-0 falls
/// back to plain `execve` on all POSIX which is correct on Linux/BSD and
/// best-effort on macOS (CLOEXEC handled by `on_before_reload_process_linux`
/// hook on Linux; Darwin gets the simpler path until tier-4 wires spawn).
pub fn reload_process(clear_terminal: bool, may_return: bool) {
    RELOAD_IN_PROGRESS.store(true, AOrdering::Relaxed);
    RELOAD_IN_PROGRESS_ON_CURRENT_THREAD.with(|c| c.set(true));

    if clear_terminal {
        crate::output::flush();
        crate::output::disable_buffering();
        crate::output::reset_terminal_all();
    }
    crate::output::stdio::restore();

    #[cfg(windows)]
    {
        // Signal the watcher-manager parent via magic exit code.
        use crate::windows_sys::kernel32::{GetCurrentProcess, GetLastError};
        unsafe extern "system" {
            // `h` is an opaque kernel HANDLE (never dereferenced in-process);
            // the kernel validates it and returns FALSE on a bad handle. No
            // memory-safety preconditions.
            safe fn TerminateProcess(h: *mut core::ffi::c_void, code: u32) -> i32;
        }
        // = 3224497970, bun.windows.watcher_reload_exit (windows.zig). Parent
        // watcher-manager compares the child's exit code against exactly this.
        const WATCHER_RELOAD_EXIT: u32 = 0xC031_EF32;
        let rc = TerminateProcess(GetCurrentProcess(), WATCHER_RELOAD_EXIT);
        if rc == 0 {
            let err = GetLastError();
            if may_return {
                crate::output::err_generic("Failed to reload process: {}", (err,));
                return;
            }
            panic!("Error while reloading process: {}", err);
        } else {
            if may_return {
                crate::output::err_generic("Failed to reload process", ());
                return;
            }
            panic!("Unexpected error while reloading process\n");
        }
    }

    #[cfg(unix)]
    // SAFETY: the FFI calls below (`on_before_reload_process_linux`, `execve`)
    // receive only locally-built NUL-terminated argv/envp arrays terminated by
    // a null pointer; on success `execve` never returns, on failure errno is
    // read. No borrowed Rust state is observed after the exec.
    unsafe {
        #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
        {
            unsafe extern "C" {
                safe fn on_before_reload_process_linux();
            }
            on_before_reload_process_linux();
        }

        // We clone argv so that the memory address isn't the same as the libc one
        // (mirrors Zig `allocator.dupeZ` per entry).
        let args = crate::argv::argv_storage();
        let dupe_argv: Vec<ZBox> = args
            .iter()
            .map(|z| ZBox::from_vec_with_nul(z.as_bytes().to_vec()))
            .collect();
        let mut newargv: Vec<*const core::ffi::c_char> =
            dupe_argv.iter().map(|z| z.as_ptr()).collect();
        newargv.push(core::ptr::null());

        // We clone envp so that the memory address of environment variables isn't
        // the same as the libc one (mirrors Zig `allocSentinel` + `dupeZ` loop).
        let mut dupe_env: Vec<ZBox> = Vec::new();
        let mut p = crate::getenv::c_environ();
        while !p.is_null() && !(*p).is_null() {
            let s = crate::ffi::cstr(*p);
            dupe_env.push(ZBox::from_vec_with_nul(s.to_bytes().to_vec()));
            p = p.add(1);
        }
        let mut envp: Vec<*const core::ffi::c_char> = dupe_env.iter().map(|z| z.as_ptr()).collect();
        envp.push(core::ptr::null());

        // we must clone selfExePath in case argv[0] was not an absolute path
        let exec_path = self_exe_path().expect("unreachable").as_ptr();

        libc::execve(exec_path, newargv.as_ptr().cast(), envp.as_ptr().cast());
        // execve only returns on error.
        let errno = std::io::Error::last_os_error().raw_os_error().unwrap_or(-1);
        if may_return {
            crate::output::pretty_errorln(format_args!(
                "error: Failed to reload process: errno {}",
                errno
            ));
            return;
        }
        panic!("Unexpected error while reloading: errno {}", errno);
    }

    #[cfg(not(any(unix, windows)))]
    {
        // Zig: `else @compileError("unsupported platform for reloadProcess")`.
        // Faithful port — Bun only targets POSIX + Windows; any other target
        // is a build-time error, not a runtime panic.
        let _ = (clear_terminal, may_return);
        compile_error!("unsupported platform for reload_process");
    }
}
