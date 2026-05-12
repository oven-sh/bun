use core::ffi::c_char;
#[cfg(debug_assertions)]
use std::io::Write as _;

#[cfg(debug_assertions)]
use crate::{CallFrame, VirtualMachineRef as VirtualMachine};
#[cfg(debug_assertions)]
use bun_core::{self, Error, err};

// Port of the subset of Zig `std.debug.*` used by btjs.zig: `SelfInfo`, `StackIterator`,
// `ThreadContext`, `MemoryAccessor`, plus the symbol-lookup helpers. The frame-pointer
// unwinder is ported verbatim from `vendor/zig/lib/std/debug.zig`; the DWARF-backed
// unwind path is omitted (`supports_unwinding = false` here) so `StackIterator` falls
// through to fp-walking exactly as Zig does on targets without DWARF support.
#[cfg(debug_assertions)]
mod zig_std_debug {
    #[allow(unused_imports)]
    use core::ffi::{c_int, c_void};
    #[cfg(target_os = "linux")]
    use core::sync::atomic::{AtomicI32, Ordering};

    use bun_core::{Error, err};

    // ── ThreadContext / have_ucontext ────────────────────────────────────
    // Zig: `pub const ThreadContext = if (windows) windows.CONTEXT else if (have_ucontext) posix.ucontext_t else void;`
    #[cfg(not(windows))]
    pub type ThreadContext = libc::ucontext_t;
    #[cfg(windows)]
    pub type ThreadContext = bun_sys::windows::CONTEXT;

    // Zig: `pub const have_ucontext = posix.ucontext_t != void;`
    pub const HAVE_UCONTEXT: bool = cfg!(not(windows));
    // Zig: `pub const have_getcontext = @TypeOf(posix.system.getcontext) != void;`
    // Android / OpenBSD / Haiku lack getcontext; everywhere else we link libc's.
    const HAVE_GETCONTEXT: bool = cfg!(all(
        not(windows),
        not(target_os = "android"),
        not(target_os = "openbsd")
    ));

    // DWARF unwinding requires the full `Dwarf` parser (not ported). Zig falls back to
    // fp-walking when `SelfInfo.supports_unwinding == false`; we hard-code that here.
    const SUPPORTS_UNWINDING: bool = false;

    // ── std.debug.getContext ─────────────────────────────────────────────
    /// Port of `std.debug.getContext`. Captures the current register state.
    /// Returns `false` if the platform has no `getcontext`.
    #[inline(always)]
    pub fn get_context(context: *mut ThreadContext) -> bool {
        #[cfg(windows)]
        {
            // SAFETY: context is a valid out-param; RtlCaptureContext writes to it.
            unsafe {
                core::ptr::write(context, bun_core::ffi::zeroed_unchecked());
                bun_sys::windows::ntdll_context::RtlCaptureContext(context);
            }
            return true;
        }
        #[cfg(not(windows))]
        {
            if !HAVE_GETCONTEXT {
                return false;
            }
            #[cfg(any(target_os = "android", target_os = "openbsd"))]
            {
                let _ = context;
                return false;
            }
            #[cfg(not(any(target_os = "android", target_os = "openbsd")))]
            {
                // The `libc` crate omits the getcontext(3) binding on Darwin
                // and the BSDs (it exists in libSystem / libc); declare locally.
                // On Linux/glibc the crate does provide it, but we use the same
                // local decl for uniformity.
                unsafe extern "C" {
                    fn getcontext(ucp: *mut libc::ucontext_t) -> core::ffi::c_int;
                }
                // SAFETY: context points to a valid `ucontext_t`; getcontext(3) fills it.
                let result = unsafe { getcontext(context) } == 0;
                // On aarch64-macos, the system getcontext doesn't write anything into the pc
                // register slot, it only writes lr. This makes the context consistent with
                // other aarch64 getcontext implementations which write the current lr
                // (where getcontext will return to) into both the lr and pc slot of the context.
                #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
                {
                    // SAFETY: getcontext just initialized `*context`; mcontext is non-null.
                    unsafe {
                        let mctx = (*context).uc_mcontext;
                        if !mctx.is_null() {
                            (*mctx).__ss.__pc = (*mctx).__ss.__lr;
                        }
                    }
                }
                return result;
            }
        }
    }

    // ── @frameAddress() ──────────────────────────────────────────────────
    /// Port of Zig `@frameAddress()`. Reads the frame-pointer register directly.
    #[inline(always)]
    fn frame_address() -> usize {
        #[cfg(target_arch = "x86_64")]
        {
            let fp: usize;
            // SAFETY: reading rbp is side-effect-free.
            unsafe {
                core::arch::asm!("mov {}, rbp", out(reg) fp, options(nomem, nostack, preserves_flags))
            };
            fp
        }
        #[cfg(target_arch = "aarch64")]
        {
            let fp: usize;
            // SAFETY: reading x29 (fp) is side-effect-free.
            unsafe {
                core::arch::asm!("mov {}, x29", out(reg) fp, options(nomem, nostack, preserves_flags))
            };
            fp
        }
        #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
        {
            // PORT NOTE: @frameAddress() — approximate with a stack local's addr on
            // arches without an asm! mapping yet. fp-walk will fail its alignment
            // sanity check and terminate cleanly.
            let probe = 0u8;
            core::ptr::from_ref::<u8>(&probe) as usize
        }
    }

    // ── MemoryAccessor (vendor/zig/lib/std/debug/MemoryAccessor.zig) ─────
    /// Reads memory from any address of the current process using OS-specific
    /// syscalls, bypassing memory page protection. Used by `StackIterator` to
    /// safely walk frame pointers without segfaulting on a corrupt stack.
    struct MemoryAccessor {
        #[cfg(target_os = "linux")]
        mem: c_int, // -1 = uninit, -2 = unavailable, else /proc/<pid>/mem fd
        #[cfg(not(target_os = "linux"))]
        mem: (),
    }

    #[cfg(target_os = "linux")]
    static CACHED_PID: AtomicI32 = AtomicI32::new(-1);

    impl MemoryAccessor {
        const INIT: Self = Self {
            #[cfg(target_os = "linux")]
            mem: -1,
            #[cfg(not(target_os = "linux"))]
            mem: (),
        };

        fn read(&mut self, address: usize, buf: &mut [u8]) -> bool {
            #[cfg(target_os = "linux")]
            loop {
                match self.mem {
                    -2 => break,
                    -1 => {
                        let pid = match CACHED_PID.load(Ordering::Relaxed) {
                            -1 => {
                                // SAFETY: getpid has no preconditions.
                                let pid = unsafe { libc::getpid() };
                                CACHED_PID.store(pid, Ordering::Relaxed);
                                pid
                            }
                            pid => pid,
                        };
                        let local = libc::iovec {
                            iov_base: buf.as_mut_ptr().cast(),
                            iov_len: buf.len(),
                        };
                        let remote = libc::iovec {
                            iov_base: address as *mut c_void,
                            iov_len: buf.len(),
                        };
                        // SAFETY: iovecs point to valid memory for their stated lengths.
                        let bytes_read = unsafe {
                            libc::process_vm_readv(
                                pid,
                                &raw const local,
                                1,
                                &raw const remote,
                                1,
                                0,
                            )
                        };
                        if bytes_read >= 0 {
                            return bytes_read as usize == buf.len();
                        }
                        match bun_sys::last_errno() {
                            libc::EFAULT => return false,
                            // EPERM (containers), ENOMEM, ENOSYS (qemu) → fall through to /proc/pid/mem
                            _ => {}
                        }
                        let mut path_buf = [0u8; 32];
                        let path = {
                            use std::io::Write as _;
                            let mut cur = std::io::Cursor::new(&mut path_buf[..]);
                            let _ = write!(cur, "/proc/{}/mem\0", pid);
                            let n = cur.position() as usize;
                            &path_buf[..n]
                        };
                        // SAFETY: path is NUL-terminated.
                        let fd = unsafe { libc::open(path.as_ptr().cast(), libc::O_RDONLY) };
                        if fd < 0 {
                            self.mem = -2;
                            break;
                        }
                        self.mem = fd;
                    }
                    fd => {
                        // SAFETY: fd is a valid open file descriptor; buf is writable.
                        let n = unsafe {
                            libc::pread(
                                fd,
                                buf.as_mut_ptr().cast(),
                                buf.len(),
                                address as libc::off_t,
                            )
                        };
                        return n >= 0 && n as usize == buf.len();
                    }
                }
            }
            if !is_valid_memory(address) {
                return false;
            }
            // SAFETY: is_valid_memory just confirmed the page at `address` is mapped.
            unsafe {
                core::ptr::copy_nonoverlapping(address as *const u8, buf.as_mut_ptr(), buf.len());
            }
            true
        }

        fn load_usize(&mut self, address: usize) -> Option<usize> {
            let mut result = [0u8; core::mem::size_of::<usize>()];
            if self.read(address, &mut result) {
                Some(usize::from_ne_bytes(result))
            } else {
                None
            }
        }
    }

    impl Drop for MemoryAccessor {
        fn drop(&mut self) {
            #[cfg(target_os = "linux")]
            if self.mem >= 0 {
                // SAFETY: self.mem is a valid fd we opened.
                unsafe { libc::close(self.mem) };
            }
        }
    }

    fn is_valid_memory(address: usize) -> bool {
        let page_size = bun_alloc::page_size();
        let aligned_address = address & !(page_size - 1);
        if aligned_address == 0 {
            return false;
        }
        #[cfg(windows)]
        {
            // Port of vendor/zig/lib/std/debug/MemoryAccessor.zig:101-120.
            // The fp-walker IS used on Windows (see `!cfg!(windows)` gate on
            // `init_with_context` below), so we must validate the page via
            // `VirtualQuery` before `copy_nonoverlapping` dereferences it —
            // otherwise the first stale fp link reads unmapped memory and
            // crashes the very debugger helper meant to inspect crashed state.
            #[repr(C)]
            struct MemoryBasicInformation {
                base_address: *mut c_void,
                allocation_base: *mut c_void,
                allocation_protect: u32,
                partition_id: u16,
                region_size: usize,
                state: u32,
                protect: u32,
                type_: u32,
            }
            const MEM_FREE: u32 = 0x10000;
            unsafe extern "system" {
                fn VirtualQuery(
                    lpAddress: *const c_void,
                    lpBuffer: *mut MemoryBasicInformation,
                    dwLength: usize,
                ) -> usize;
            }
            let mut mbi: MemoryBasicInformation = unsafe { core::mem::zeroed() };
            // SAFETY: `mbi` is a valid out-param of the size we pass; VirtualQuery
            // only inspects the address-space mapping at `aligned_address`.
            let rc = unsafe {
                VirtualQuery(
                    aligned_address as *const c_void,
                    &mut mbi,
                    core::mem::size_of::<MemoryBasicInformation>(),
                )
            };
            if rc == 0 {
                return false;
            }
            if mbi.state == MEM_FREE {
                return false;
            }
            return true;
        }
        #[cfg(not(windows))]
        {
            // SAFETY: msync only inspects the mapping; aligned_address is page-aligned.
            let rc =
                unsafe { libc::msync(aligned_address as *mut c_void, page_size, libc::MS_ASYNC) };
            if rc != 0 {
                return bun_sys::last_errno() != libc::ENOMEM;
            }
            true
        }
    }

    // ── StackIterator (vendor/zig/lib/std/debug.zig:771) ─────────────────
    pub struct StackIterator {
        // Skip every frame before this address is found.
        first_address: Option<usize>,
        // Last known value of the frame pointer register.
        pub fp: usize,
        ma: MemoryAccessor,
        // When SelfInfo and a register context is available, this iterator can unwind
        // stacks with frames that don't use a frame pointer (ie. -fomit-frame-pointer),
        // using DWARF and MachO unwind info.
        unwind_state: Option<UnwindState>,
    }

    struct UnwindState {
        last_error: Option<UnwindError>,
        pc: usize,
    }

    impl StackIterator {
        // Offset of the saved BP wrt the frame pointer.
        const FP_OFFSET: usize = if cfg!(any(target_arch = "riscv64", target_arch = "riscv32")) {
            // On RISC-V the frame pointer points to the top of the saved register
            // area, on pretty much every other architecture it points to the stack
            // slot where the previous frame pointer is saved.
            2 * core::mem::size_of::<usize>()
        } else {
            0
        };
        const FP_BIAS: usize = 0; // SPARC only — not a Bun target.
        // Positive offset of the saved PC wrt the frame pointer.
        const PC_OFFSET: usize = if cfg!(target_arch = "powerpc64") {
            2 * core::mem::size_of::<usize>()
        } else {
            core::mem::size_of::<usize>()
        };

        pub fn init(first_address: Option<usize>, fp: Option<usize>) -> StackIterator {
            // (SPARC `flushw` omitted — not a Bun target.)
            StackIterator {
                first_address,
                fp: fp.unwrap_or_else(frame_address),
                ma: MemoryAccessor::INIT,
                unwind_state: None,
            }
        }

        pub fn init_with_context(
            first_address: Option<usize>,
            _debug_info: &mut SelfInfo,
            context: *mut ThreadContext,
        ) -> Result<StackIterator, Error> {
            let _ = context;
            // The implementation of DWARF unwinding on aarch64-macos is not complete. However, Apple mandates that
            // the frame pointer register is always used, so on this platform we can safely use the FP-based unwinder.
            #[cfg(all(target_vendor = "apple", target_arch = "aarch64"))]
            {
                // SAFETY: caller passes a `getcontext`-initialized ucontext; mcontext is non-null.
                let fp = unsafe { (*(*context).uc_mcontext).__ss.__fp } as usize;
                return Ok(Self::init(first_address, Some(fp)));
            }
            #[allow(unreachable_code)]
            if SUPPORTS_UNWINDING {
                // PORT NOTE: DWARF `UnwindContext::init` not ported — `SUPPORTS_UNWINDING`
                // is `false`, so this branch is dead. Kept to mirror Zig structure.
                return Err(err!("UnsupportedCpuArchitecture"));
            }
            Ok(Self::init(first_address, None))
        }

        pub fn get_last_error(&mut self) -> Option<LastUnwindError> {
            if !HAVE_UCONTEXT {
                return None;
            }
            if let Some(unwind_state) = &mut self.unwind_state {
                if let Some(e) = unwind_state.last_error.take() {
                    return Some(LastUnwindError {
                        err: e,
                        address: unwind_state.pc,
                    });
                }
            }
            None
        }

        pub fn next(&mut self) -> Option<usize> {
            let mut address = self.next_internal()?;
            if let Some(first_address) = self.first_address {
                while address != first_address {
                    address = self.next_internal()?;
                }
                self.first_address = None;
            }
            Some(address)
        }

        fn next_internal(&mut self) -> Option<usize> {
            // PORT NOTE: the `unwind_state` DWARF path (`next_unwind`) is not ported
            // (`SUPPORTS_UNWINDING == false`); Zig falls through to fp-walking here too.

            // `builtin.omit_frame_pointer` — Bun debug builds always keep frame pointers.

            let fp = self.fp.checked_sub(Self::FP_OFFSET)?;

            // Sanity check.
            if fp == 0 || fp % core::mem::align_of::<usize>() != 0 {
                return None;
            }
            let new_fp = self.ma.load_usize(fp)?.checked_add(Self::FP_BIAS)?;

            // Sanity check: the stack grows down thus all the parent frames must be
            // be at addresses that are greater (or equal) than the previous one.
            // A zero frame pointer often signals this is the last frame, that case
            // is gracefully handled by the next call to next_internal.
            if new_fp != 0 && new_fp < self.fp {
                return None;
            }
            let new_pc = self.ma.load_usize(fp.checked_add(Self::PC_OFFSET)?)?;

            self.fp = new_fp;

            Some(new_pc)
        }
    }

    pub type UnwindError = Error;
    pub struct LastUnwindError {
        pub address: usize,
        pub err: UnwindError,
    }

    // ── SelfInfo (vendor/zig/lib/std/debug/SelfInfo.zig) ─────────────────
    // D104: relocated to `bun_crash_handler::debug` (lower-tier crate, also
    // needed by the crash handler's stack-trace printer). Re-export so the
    // in-file callers below compile unchanged.
    pub use bun_crash_handler::debug::{
        Module, SelfInfo, SourceLocation, SymbolInfo, get_self_debug_info,
    };
}
#[cfg(debug_assertions)]
use zig_std_debug::{
    Module, SelfInfo, SourceLocation, StackIterator, SymbolInfo, ThreadContext, UnwindError,
};

// Port of the subset of `std.io.tty.{Config,Color,detectConfig}` used by btjs.zig
// (vendor/zig/lib/std/Io/tty.zig). The `windows_api` variant is omitted because
// btjs writes to an in-memory `Vec<u8>` returned to lldb, not to the live console
// handle, so `SetConsoleTextAttribute` would colour the wrong stream.
#[cfg(debug_assertions)]
mod tty {
    // D089: `Config`/`Color`/`set_color` deduped to the canonical port in
    // `bun_crash_handler::debug` (lower-tier crate; `Vec<u8>` already impls
    // `bun_io::Write` so the generic `set_color` covers btjs's in-memory sink).
    // `detect_config_stdout` stays LOCAL — it ports a *different* Zig call
    // site (`detectConfig(stdout())` with NO_COLOR/CLICOLOR_FORCE/isatty) than
    // crash_handler's `detect_tty_config_stderr()` (Output::ENABLE_ANSI_COLORS_STDERR).
    pub use bun_crash_handler::debug::{Color, TtyConfig as Config};

    /// Port of `process.hasNonEmptyEnvVarConstant`.
    fn has_non_empty_env_var(name: &core::ffi::CStr) -> bool {
        #[cfg(windows)]
        {
            // Zig spec (vendor/zig/lib/std/process.zig:435-446) reads the Win32
            // environment via `getenvW`, NOT MSVCRT `getenv`. The CRT keeps its
            // own narrow-string env cache that is not updated by
            // `SetEnvironmentVariableW`, which is how Bun mutates env vars at
            // runtime — so `libc::getenv` would silently miss those.
            unsafe extern "system" {
                fn GetEnvironmentVariableW(
                    lpName: *const u16,
                    lpBuffer: *mut u16,
                    nSize: u32,
                ) -> u32;
            }
            // `name` is a compile-time ASCII C string (c"NO_COLOR" / c"CLICOLOR_FORCE");
            // widen byte-by-byte into a NUL-terminated WCHAR buffer on the stack.
            let bytes = name.to_bytes();
            let mut name_w = [0u16; 32];
            if bytes.len() >= name_w.len() {
                return false;
            }
            for (i, &b) in bytes.iter().enumerate() {
                name_w[i] = b as u16;
            }
            let mut buf = [0u16; 2];
            // SAFETY: `name_w` is NUL-terminated; `buf` is a valid 2-WCHAR out-param.
            // With nSize=2: empty value copies successfully and returns 0 (chars
            // written, excluding NUL); not-found also returns 0; any non-empty
            // value returns >=1 (either chars written, or required size if it
            // didn't fit). So `rc != 0` ⇔ "exists and non-empty".
            let rc = unsafe {
                GetEnvironmentVariableW(name_w.as_ptr(), buf.as_mut_ptr(), buf.len() as u32)
            };
            return rc != 0;
        }
        #[cfg(not(windows))]
        {
            // SAFETY: getenv only reads; name is a valid NUL-terminated C string.
            let val = unsafe { libc::getenv(name.as_ptr()) };
            // SAFETY: getenv returns either NULL or a valid NUL-terminated C string.
            !val.is_null() && unsafe { *val } != 0
        }
    }

    /// Port of `std.io.tty.detectConfig(std.fs.File.stdout())`.
    pub fn detect_config_stdout() -> Config {
        let force_color: Option<bool> = if has_non_empty_env_var(c"NO_COLOR") {
            Some(false)
        } else if has_non_empty_env_var(c"CLICOLOR_FORCE") {
            Some(true)
        } else {
            None
        };

        if force_color == Some(false) {
            return Config::NoColor;
        }

        // `file.getOrEnableAnsiEscapeSupport()` — on POSIX this is `isatty(fd)`;
        // on Windows it tries to enable VT processing on the console handle.
        // PORT NOTE: btjs writes into a `Vec<u8>` returned to lldb, so the
        // `.windows_api` variant (which calls `SetConsoleTextAttribute` mid-write)
        // cannot apply; fall through to escape_codes / no_color.
        if bun_sys::isatty(bun_sys::Fd::stdout()) {
            return Config::EscapeCodes;
        }

        if force_color == Some(true) {
            Config::EscapeCodes
        } else {
            Config::NoColor
        }
    }
}
#[cfg(debug_assertions)]
use tty::Color;

#[cfg(debug_assertions)]
unsafe extern "C" {
    // safe: link-time section markers — only their *addresses* are taken
    // (`&raw const … as usize`), never dereferenced; no Rust-side precondition.
    safe static jsc_llint_begin: u8;
    safe static jsc_llint_end: u8;
}

/// allocated using bun.default_allocator. when called from lldb, it is never freed.
#[unsafe(no_mangle)]
pub extern "C" fn dumpBtjsTrace() -> *const c_char {
    // Zig: `if (comptime bun.Environment.isDebug)` — must use #[cfg], not cfg!(), so the
    // entire debug impl is DCE'd from release builds.
    #[cfg(debug_assertions)]
    {
        return dump_btjs_trace_debug_impl();
    }
    #[cfg(not(debug_assertions))]
    {
        b"btjs is disabled in release builds\0"
            .as_ptr()
            .cast::<c_char>()
    }
}

#[cfg(debug_assertions)]
fn dump_btjs_trace_debug_impl() -> *const c_char {
    let mut result_writer: Vec<u8> = Vec::new();
    let w = &mut result_writer;

    let debug_info: &mut SelfInfo = match get_self_debug_info() {
        // SAFETY: lazy debug-only singleton; lldb stopped-process, sole `&mut`.
        Ok(di) => unsafe { &mut *di },
        Err(err) => {
            if write!(
                w,
                "Unable to dump stack trace: Unable to open debug info: {}\x00",
                err.name()
            )
            .is_err()
            {
                return b"<oom>\0".as_ptr().cast::<c_char>();
            }
            // leak intentionally — caller is lldb and never frees
            return bun_core::heap::into_raw(result_writer.into_boxed_slice())
                .cast::<c_char>()
                .cast_const();
        }
    };

    // std.log.info("jsc_llint_begin: {x}", .{@intFromPtr(&jsc_llint_begin)});
    // std.log.info("jsc_llint_end: {x}", .{@intFromPtr(&jsc_llint_end)});

    let tty_config = tty::detect_config_stdout();

    // SAFETY: Zig used `= undefined`; getcontext fully initializes.
    let mut context: ThreadContext = unsafe { bun_core::ffi::zeroed_unchecked() };
    let has_context = get_context(&mut context);

    #[allow(unused_mut)]
    let mut it: StackIterator = (if has_context && !cfg!(windows) {
        stack_iterator_init_with_context(None, debug_info, &mut context).ok()
    } else {
        None
    })
    .unwrap_or_else(|| stack_iterator_init(None, None));
    // defer it.deinit() — handled by Drop

    while let Some(return_address) = it.next() {
        print_last_unwind_error(&mut it, debug_info, w, &tty_config);

        // On arm64 macOS, the address of the last frame is 0x0 rather than 0x1 as on x86_64 macOS,
        // therefore, we do a check for `return_address == 0` before subtracting 1 from it to avoid
        // an overflow. We do not need to signal `StackIterator` as it will correctly detect this
        // condition on the subsequent iteration and return `null` thus terminating the loop.
        // same behaviour for x86-windows-msvc
        let address = return_address.saturating_sub(1);
        let _ = print_source_at_address(debug_info, w, address, &tty_config, it.fp);
    }
    // Zig `while ... else` runs after normal loop exit (no `break` in body), so this is unconditional:
    print_last_unwind_error(&mut it, debug_info, w, &tty_config);

    // remove nulls
    for itm in result_writer.iter_mut() {
        if *itm == 0 {
            *itm = b' ';
        }
    }
    // add null terminator
    result_writer.push(0);
    // leak intentionally — caller is lldb and never frees
    bun_core::heap::into_raw(result_writer.into_boxed_slice())
        .cast::<c_char>()
        .cast_const()
}

#[cfg(debug_assertions)]
fn print_source_at_address(
    debug_info: &mut SelfInfo,
    out_stream: &mut Vec<u8>,
    address: usize,
    tty_config: &tty::Config,
    fp: usize,
) -> Result<(), Error> {
    // TODO(port): narrow error set
    if !cfg!(debug_assertions) {
        unreachable!();
    }
    let module = match get_module_for_address(debug_info, address) {
        Ok(m) => m,
        Err(e) if e == err!("MissingDebugInfo") || e == err!("InvalidDebugInfo") => {
            return print_unknown_source(debug_info, out_stream, address, tty_config);
        }
        Err(e) => return Err(e),
    };

    let symbol_info: SymbolInfo = match get_symbol_at_address(module, address) {
        Ok(s) => s,
        Err(e) if e == err!("MissingDebugInfo") || e == err!("InvalidDebugInfo") => {
            return print_unknown_source(debug_info, out_stream, address, tty_config);
        }
        Err(e) => return Err(e),
    };
    // defer free(sl.file_name) — handled by Drop on SourceLocation.file_name: Box<[u8]>

    // jsc_llint_begin/end are link-time symbols; `&raw const` avoids creating a reference to extern static
    let llint_begin = (&raw const jsc_llint_begin) as usize;
    let llint_end = (&raw const jsc_llint_end) as usize;
    let probably_llint = address > llint_begin && address < llint_end;
    let mut allow_llint = true;
    if symbol_info.name.starts_with(b"__") {
        allow_llint = false; // disallow llint for __ZN3JSC11Interpreter20executeModuleProgramEPNS_14JSModuleRecordEPNS_23ModuleProgramExecutableEPNS_14JSGlobalObjectEPNS_19JSModuleEnvironmentENS_7JSValueES9_
    }
    if symbol_info.name.starts_with(b"_llint_call_javascript") {
        allow_llint = false; // disallow llint for _llint_call_javascript
    }
    let do_llint = probably_llint && allow_llint;

    // SAFETY: fp is a raw frame pointer from the stack iterator; only dereferenced when
    // do_llint holds (i.e. address is inside the JSC LLInt range, so fp is a JSC CallFrame).
    // Single audited backref-deref hoisted for both LLInt branches below.
    let frame: Option<&CallFrame> = do_llint.then(|| unsafe { &*(fp as *const CallFrame) });
    if let Some(frame) = frame {
        // VM singleton is process-lifetime; `global` is set before any
        // JS frame can be on the stack to inspect.
        let srcloc = frame.get_caller_src_loc(VirtualMachine::get().global());
        tty_config.set_color(out_stream, Color::Bold)?;
        write!(
            out_stream,
            "{}:{}:{}: ",
            srcloc.str, srcloc.line, srcloc.column
        )?;
        tty_config.set_color(out_stream, Color::Reset)?;
    }

    print_line_info(
        out_stream,
        symbol_info.source_location.as_ref(),
        address,
        &symbol_info.name,
        &symbol_info.compile_unit_name,
        tty_config,
        print_line_from_file_any_os,
        do_llint,
    )?;
    if let Some(frame) = frame {
        let desc = frame.describe_frame();
        write!(out_stream, "    {}\n    ", bstr::BStr::new(desc))?;
        tty_config.set_color(out_stream, Color::Green)?;
        out_stream.extend_from_slice(b"^");
        tty_config.set_color(out_stream, Color::Reset)?;
        out_stream.extend_from_slice(b"\n");
    }
    Ok(())
}

#[cfg(debug_assertions)]
fn print_unknown_source(
    debug_info: &mut SelfInfo,
    out_stream: &mut Vec<u8>,
    address: usize,
    tty_config: &tty::Config,
) -> Result<(), Error> {
    // TODO(port): narrow error set
    if !cfg!(debug_assertions) {
        unreachable!();
    }
    let module_name = get_module_name_for_address(debug_info, address);
    print_line_info(
        out_stream,
        None,
        address,
        b"???",
        module_name.as_deref().unwrap_or(b"???"),
        tty_config,
        print_line_from_file_any_os,
        false,
    )
}

#[cfg(debug_assertions)]
fn print_line_info(
    out_stream: &mut Vec<u8>,
    source_location: Option<&SourceLocation>,
    address: usize,
    symbol_name: &[u8],
    compile_unit_name: &[u8],
    tty_config: &tty::Config,
    // Zig: `comptime printLineFromFile: anytype` — anytype maps to generic/impl-Trait so it
    // monomorphizes (PORTING.md type map), not a runtime fn pointer.
    print_line_from_file: impl Fn(&mut Vec<u8>, &SourceLocation) -> Result<(), Error>,
    do_llint: bool,
) -> Result<(), Error> {
    // TODO(port): narrow error set
    if !cfg!(debug_assertions) {
        unreachable!();
    }

    // nosuspend { ... } — no Rust equivalent needed (no async)
    tty_config.set_color(out_stream, Color::Bold)?;

    if let Some(sl) = source_location {
        write!(
            out_stream,
            "{}:{}:{}",
            bstr::BStr::new(&sl.file_name),
            sl.line,
            sl.column
        )?;
    } else if !do_llint {
        out_stream.extend_from_slice(b"???:?:?");
    }

    tty_config.set_color(out_stream, Color::Reset)?;
    if !do_llint || source_location.is_some() {
        out_stream.extend_from_slice(b": ");
    }
    tty_config.set_color(out_stream, Color::Dim)?;
    write!(
        out_stream,
        "0x{:x} in {} ({})",
        address,
        bstr::BStr::new(symbol_name),
        bstr::BStr::new(compile_unit_name)
    )?;
    tty_config.set_color(out_stream, Color::Reset)?;
    out_stream.extend_from_slice(b"\n");

    // Show the matching source code line if possible
    if let Some(sl) = source_location {
        match print_line_from_file(out_stream, sl) {
            Ok(()) => {
                if sl.column > 0 {
                    // The caret already takes one char
                    let space_needed = usize::try_from(sl.column - 1).expect("int cast");

                    // splatByteAll(' ', n)
                    out_stream.extend(core::iter::repeat_n(b' ', space_needed));
                    tty_config.set_color(out_stream, Color::Green)?;
                    out_stream.extend_from_slice(b"^");
                    tty_config.set_color(out_stream, Color::Reset)?;
                }
                out_stream.extend_from_slice(b"\n");
            }
            Err(e)
                if e == err!("EndOfFile")
                    || e == err!("FileNotFound")
                    || e == err!("BadPathName")
                    || e == err!("AccessDenied") => {}
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

#[cfg(debug_assertions)]
fn print_line_from_file_any_os(
    out_stream: &mut Vec<u8>,
    source_location: &SourceLocation,
) -> Result<(), Error> {
    // TODO(port): narrow error set
    if !cfg!(debug_assertions) {
        unreachable!();
    }

    // Need this to always block even in async I/O mode, because this could potentially
    // be called from e.g. the event loop code crashing.
    // TODO(port): Zig used std.fs.cwd().openFile directly (bypassing bun.sys). PORTING.md
    // forbids std::fs; using bun_sys here. Phase B: confirm bun_sys::File is safe to call
    // from inside a crash handler / lldb (must not re-enter event loop).
    let f = bun_sys::File::open_at(
        bun_sys::Fd::cwd(),
        &source_location.file_name,
        bun_sys::O::RDONLY,
        0,
    )
    .map_err(Into::<Error>::into)?;
    // defer f.close() — handled by Drop
    // TODO fstat and make sure that the file has the correct size

    let mut buf = [0u8; 4096];
    let mut amt_read = f.read(&mut buf[..]).map_err(Into::<Error>::into)?;
    let line_start: usize = 'seek: {
        let mut current_line_start: usize = 0;
        let mut next_line: usize = 1;
        while next_line != source_location.line as usize {
            let slice = &buf[current_line_start..amt_read];
            if let Some(pos) = slice.iter().position(|&b| b == b'\n') {
                next_line += 1;
                if pos == slice.len() - 1 {
                    amt_read = f.read(&mut buf[..]).map_err(Into::<Error>::into)?;
                    current_line_start = 0;
                } else {
                    current_line_start += pos + 1;
                }
            } else if amt_read < buf.len() {
                return Err(err!("EndOfFile"));
            } else {
                amt_read = f.read(&mut buf[..]).map_err(Into::<Error>::into)?;
                current_line_start = 0;
            }
        }
        break 'seek current_line_start;
    };
    let slice = &mut buf[line_start..amt_read];
    if let Some(pos) = slice.iter().position(|&b| b == b'\n') {
        let line = &mut slice[0..pos + 1];
        replace_scalar(line, b'\t', b' ');
        out_stream.extend_from_slice(line);
        return Ok(());
    } else {
        // Line is the last inside the buffer, and requires another read to find delimiter. Alternatively the file ends.
        replace_scalar(slice, b'\t', b' ');
        out_stream.extend_from_slice(slice);
        while amt_read == buf.len() {
            amt_read = f.read(&mut buf[..]).map_err(Into::<Error>::into)?;
            if let Some(pos) = buf[0..amt_read].iter().position(|&b| b == b'\n') {
                let line = &mut buf[0..pos + 1];
                replace_scalar(line, b'\t', b' ');
                out_stream.extend_from_slice(line);
                return Ok(());
            } else {
                let line = &mut buf[0..amt_read];
                replace_scalar(line, b'\t', b' ');
                out_stream.extend_from_slice(line);
            }
        }
        // Make sure printing last line of file inserts extra newline
        out_stream.push(b'\n');
    }
    Ok(())
}

#[cfg(debug_assertions)]
fn print_last_unwind_error(
    it: &mut StackIterator,
    debug_info: &mut SelfInfo,
    out_stream: &mut Vec<u8>,
    tty_config: &tty::Config,
) {
    if !cfg!(debug_assertions) {
        unreachable!();
    }
    if !zig_std_debug::HAVE_UCONTEXT {
        return;
    }
    if let Some(unwind_error) = stack_iterator_get_last_error(it) {
        let _ = print_unwind_error(
            debug_info,
            out_stream,
            unwind_error.address,
            unwind_error.err,
            tty_config,
        );
    }
}

#[cfg(debug_assertions)]
fn print_unwind_error(
    debug_info: &mut SelfInfo,
    out_stream: &mut Vec<u8>,
    address: usize,
    err: UnwindError,
    tty_config: &tty::Config,
) -> Result<(), Error> {
    // TODO(port): narrow error set
    if !cfg!(debug_assertions) {
        unreachable!();
    }

    let module_name = get_module_name_for_address(debug_info, address);
    let module_name = module_name.as_deref().unwrap_or(b"???");
    tty_config.set_color(out_stream, Color::Dim)?;
    if err == err!("MissingDebugInfo") {
        write!(
            out_stream,
            "Unwind information for `{}:0x{:x}` was not available, trace may be incomplete\n\n",
            bstr::BStr::new(module_name),
            address
        )?;
    } else {
        write!(
            out_stream,
            "Unwind error at address `{}:0x{:x}` ({}), trace may be incomplete\n\n",
            bstr::BStr::new(module_name),
            address,
            err.name()
        )?;
    }
    tty_config.set_color(out_stream, Color::Reset)?;
    Ok(())
}

#[cfg(debug_assertions)]
#[inline]
fn replace_scalar(slice: &mut [u8], from: u8, to: u8) {
    for b in slice.iter_mut() {
        if *b == from {
            *b = to;
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Thin forwarders to the `zig_std_debug` port — keep the call-site shape
// matching the Zig (`std.debug.getSelfDebugInfo()`, `it.getLastError()`, …).
// ──────────────────────────────────────────────────────────────────────────
#[cfg(debug_assertions)]
#[inline]
fn get_self_debug_info() -> Result<*mut SelfInfo, Error> {
    zig_std_debug::get_self_debug_info()
}
#[cfg(debug_assertions)]
#[inline(always)]
fn get_context(ctx: &mut ThreadContext) -> bool {
    zig_std_debug::get_context(ctx)
}
#[cfg(debug_assertions)]
#[inline(always)]
fn stack_iterator_init_with_context(
    first: Option<usize>,
    di: &mut SelfInfo,
    ctx: &mut ThreadContext,
) -> Result<StackIterator, Error> {
    StackIterator::init_with_context(first, di, ctx)
}
#[cfg(debug_assertions)]
#[inline(always)]
fn stack_iterator_init(first: Option<usize>, fp: Option<usize>) -> StackIterator {
    StackIterator::init(first, fp)
}
#[cfg(debug_assertions)]
#[inline]
fn stack_iterator_get_last_error(it: &mut StackIterator) -> Option<zig_std_debug::LastUnwindError> {
    it.get_last_error()
}
#[cfg(debug_assertions)]
#[inline]
fn get_module_for_address<'a>(di: &'a mut SelfInfo, addr: usize) -> Result<&'a mut Module, Error> {
    di.get_module_for_address(addr)
}
#[cfg(debug_assertions)]
#[inline]
fn get_symbol_at_address(module: &mut Module, addr: usize) -> Result<SymbolInfo, Error> {
    module.get_symbol_at_address(addr)
}
#[cfg(debug_assertions)]
#[inline]
fn get_module_name_for_address(di: &mut SelfInfo, addr: usize) -> Option<Box<[u8]>> {
    di.get_module_name_for_address(addr)
}

// ported from: src/jsc/btjs.zig
