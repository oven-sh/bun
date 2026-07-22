//! `SourceLocation`/`SymbolInfo` and the frame-pointer stack unwinder
//! (`MemoryAccessor`, `StackIterator`).
//! Lives in `bun_core` (libc/std/bun_alloc only) so the crash
//! handler, `StoredTrace`, and `btjs` can all share one implementation.

#[derive(Clone)]
pub struct SourceLocation {
    pub file_name: Box<[u8]>,
    pub line: u32,
    pub column: u32,
}

pub struct SymbolInfo {
    pub name: Box<[u8]>,
    pub compile_unit_name: Box<[u8]>,
    pub source_location: Option<SourceLocation>,
}

// ──────────────────────────────────────────────────────────────────────
// Frame-pointer stack unwinder. Capture had
// briefly been routed through libc `backtrace()` / `RtlCaptureStackBackTrace`,
// which are CFI/unwind-table based — but release builds strip the unwind tables
// (`-fno-asynchronous-unwind-tables` + `--no-eh-frame-hdr`) and the POSIX
// signal handler runs on an `SA_ONSTACK` altstack, so those APIs captured only
// the handler's own frames (or nothing). Frame pointers are force-enabled
// (`-Cforce-frame-pointers=yes`, `-fno-omit-frame-pointer`), so FP walking is
// the correct mechanism. Lives in `bun_core` (libc/std/bun_alloc only) so the
// crash handler, `StoredTrace`, and `btjs` can all share one implementation.
// ──────────────────────────────────────────────────────────────────────
/// Reads the frame-pointer register directly.
#[inline(always)]
pub fn frame_address() -> usize {
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
        // Approximate with a stack local's addr on arches
        // without an asm! mapping yet. fp-walk will fail its alignment sanity
        // check and terminate cleanly.
        let probe = 0u8;
        core::ptr::from_ref::<u8>(&probe) as usize
    }
}

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn mach_vm_read_overwrite(
        target_task: libc::mach_port_t,
        address: u64,
        size: u64,
        data: u64,
        out_size: *mut u64,
    ) -> libc::kern_return_t;
    // `mach_task_self()` in C is `#define mach_task_self() mach_task_self_`.
    safe static mach_task_self_: libc::mach_port_t;
}

/// Reads memory from any address of the current process, tolerating unmapped
/// or corrupt pages so a damaged stack can't fault the walker itself.
struct MemoryAccessor {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    mem: core::ffi::c_int, // -1 = uninit, -2 = unavailable, else /proc/<pid>/mem fd
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    _mem: (),
}

impl MemoryAccessor {
    const INIT: Self = Self {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        mem: -1,
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        _mem: (),
    };

    fn read(&mut self, address: usize, buf: &mut [u8]) -> bool {
        #[cfg(target_os = "macos")]
        {
            // `msync` only checks *mapped*, not *readable*, so a PROT_NONE
            // page (guard, mimalloc/JSC reservation) would pass and the raw
            // copy below would fault — inside the SIGSEGV handler, with
            // SA_RESETHAND set, that loses the whole report.
            // `mach_vm_read_overwrite` asks the kernel to do the copy and
            // returns KERN_INVALID_ADDRESS / KERN_PROTECTION_FAILURE instead.
            let mut out: u64 = 0;
            // SAFETY: `buf` is a valid writable slice; the kernel validates
            // `address` and writes at most `buf.len()` bytes into `buf`.
            let kr = unsafe {
                mach_vm_read_overwrite(
                    mach_task_self_,
                    address as u64,
                    buf.len() as u64,
                    buf.as_mut_ptr() as u64,
                    &raw mut out,
                )
            };
            return kr == 0 && out == buf.len() as u64;
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        loop {
            match self.mem {
                -2 => break,
                -1 => {
                    // SAFETY: getpid has no preconditions. Don't cache across
                    // calls — it's served from the vDSO and a stale cache after
                    // fork() would target the wrong process.
                    let pid = unsafe { libc::getpid() };
                    let local = libc::iovec {
                        iov_base: buf.as_mut_ptr().cast(),
                        iov_len: buf.len(),
                    };
                    let remote = libc::iovec {
                        iov_base: address as *mut core::ffi::c_void,
                        iov_len: buf.len(),
                    };
                    // SAFETY: iovecs point to valid memory for their stated lengths.
                    let bytes_read = unsafe {
                        libc::process_vm_readv(pid, &raw const local, 1, &raw const remote, 1, 0)
                    };
                    if bytes_read >= 0 {
                        return bytes_read as usize == buf.len();
                    }
                    match crate::ffi::errno() {
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
                    let fd = unsafe {
                        libc::open(path.as_ptr().cast(), libc::O_RDONLY | libc::O_CLOEXEC)
                    };
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
        #[cfg(not(target_os = "macos"))]
        {
            if !is_valid_memory(address) {
                return false;
            }
            // SAFETY: is_valid_memory just confirmed the page at `address` is mapped.
            unsafe {
                core::ptr::copy_nonoverlapping(address as *const u8, buf.as_mut_ptr(), buf.len());
            }
            true
        }
    }

    fn load_usize(&mut self, address: usize) -> Option<usize> {
        let mut result = [0u8; core::mem::size_of::<usize>()];
        if self.read(address, &mut result) {
            Some(usize::from_ne_bytes(result))
        } else {
            None
        }
    }

    /// Quick plausibility filter for a candidate return address recovered
    /// from `lr` / `[rsp]`: mapped page and (on aarch64) 4-byte instruction
    /// alignment. Not a precise text-segment test; the goal is only to drop
    /// obvious garbage (small integers, unmapped) so a clobbered `lr` in a
    /// framed function doesn't inject a nonsense frame.
    #[cfg(not(windows))]
    fn looks_like_code(&mut self, address: usize) -> bool {
        if address == 0 {
            return false;
        }
        #[cfg(target_arch = "aarch64")]
        if !address.is_multiple_of(4) {
            return false;
        }
        let mut probe = [0u8; 1];
        self.read(address, &mut probe)
    }
}

impl Drop for MemoryAccessor {
    fn drop(&mut self) {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        if self.mem >= 0 {
            // SAFETY: self.mem is a valid fd we opened.
            unsafe { libc::close(self.mem) };
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn is_valid_memory(address: usize) -> bool {
    let page_size = bun_alloc::page_size();
    let aligned_address = address & !(page_size - 1);
    if aligned_address == 0 {
        return false;
    }
    #[cfg(windows)]
    {
        use bun_windows_sys::kernel32::{MEM_FREE, MEMORY_BASIC_INFORMATION, VirtualQuery};
        // SAFETY: MEMORY_BASIC_INFORMATION is a plain Win32 POD; all-zeros is
        // a valid representation.
        let mut mbi: MEMORY_BASIC_INFORMATION = unsafe { crate::ffi::zeroed_unchecked() };
        // SAFETY: `mbi` is a valid out-param of the size we pass; VirtualQuery
        // only inspects the address-space mapping at `aligned_address`.
        let rc = unsafe {
            VirtualQuery(
                core::ptr::without_provenance(aligned_address),
                &raw mut mbi,
                core::mem::size_of::<MEMORY_BASIC_INFORMATION>(),
            )
        };
        rc != 0 && mbi.State != MEM_FREE
    }
    #[cfg(not(windows))]
    {
        // SAFETY: msync only inspects the mapping; aligned_address is page-aligned.
        let rc = unsafe {
            libc::msync(
                aligned_address as *mut core::ffi::c_void,
                page_size,
                libc::MS_ASYNC,
            )
        };
        if rc != 0 {
            return crate::ffi::errno() != libc::ENOMEM;
        }
        true
    }
}

/// Walks the frame-pointer chain.
pub struct StackIterator {
    pub fp: usize,
    ma: MemoryAccessor,
}

impl StackIterator {
    // Offset of the saved BP wrt the frame pointer.
    const FP_OFFSET: usize = if cfg!(any(target_arch = "riscv64", target_arch = "riscv32")) {
        2 * core::mem::size_of::<usize>()
    } else {
        0
    };
    // Positive offset of the saved PC wrt the frame pointer.
    const PC_OFFSET: usize = if cfg!(target_arch = "powerpc64") {
        2 * core::mem::size_of::<usize>()
    } else {
        core::mem::size_of::<usize>()
    };

    /// `fp` is required: this function is not `#[inline(always)]`, so a
    /// `frame_address()` call from inside it would read this frame's own rbp —
    /// a frame that no longer exists by the time `next()` dereferences it. Pass
    /// `frame_address()` from the caller (where it inlines) or a context-seeded
    /// value.
    pub fn init(fp: usize) -> StackIterator {
        StackIterator {
            fp,
            ma: MemoryAccessor::INIT,
        }
    }

    pub fn next(&mut self) -> Option<usize> {
        let fp = self.fp.checked_sub(Self::FP_OFFSET)?;

        // Sanity check.
        if fp == 0 || fp % core::mem::align_of::<usize>() != 0 {
            return None;
        }
        let new_fp = self.ma.load_usize(fp)?;

        // The stack grows down, so parent frames must be at addresses strictly
        // greater than the previous one (a self-linked frame would loop). A
        // zero frame pointer signals the last frame.
        if new_fp != 0 && new_fp <= self.fp {
            return None;
        }
        let new_pc = self.ma.load_usize(fp.checked_add(Self::PC_OFFSET)?)?;

        self.fp = new_fp;

        Some(new_pc)
    }
}

pub(crate) const PC_OFFSET: usize = StackIterator::PC_OFFSET;

/// Capture the current thread's call stack.
///
/// POSIX: walk frame pointers. Windows: `RtlCaptureStackBackTrace` via
/// `.pdata` (rbp is not a reliable frame pointer across all linked code).
///
/// `first_address`, when present, trims every frame above (and including) the
/// capture machinery: frames are dropped until one matches `first_address`.
/// If no frame matches (e.g. inlining moved the boundary), the full untrimmed
/// trace is returned rather than an empty one — a noisier trace beats none.
#[inline(never)]
pub(crate) fn capture_current(first_address: Option<usize>, out: &mut [usize]) -> usize {
    // Miri can neither execute `frame_address`'s inline asm nor follow the
    // frame-pointer chain it returns. An empty trace keeps the debug-only
    // `StoredTrace` captures on the refcount paths interpretable. `cfg!` rather
    // than `#[cfg]` so the walk below stays compiled (and `PC_OFFSET` live).
    if cfg!(miri) {
        return 0;
    }
    #[cfg(windows)]
    let n = {
        let cap = out.len().min(u16::MAX as usize) as u32;
        // SAFETY: out is valid for `cap` writes; hash ptr may be null.
        unsafe {
            bun_windows_sys::ntdll::RtlCaptureStackBackTrace(
                0,
                cap,
                out.as_mut_ptr().cast::<*mut core::ffi::c_void>(),
                core::ptr::null_mut(),
            )
        }
    } as usize;
    #[cfg(not(windows))]
    let n = {
        // `frame_address` is `#[inline(always)]`, so this reads
        // `capture_current`'s own fp and seeds the walk from this frame.
        let fp = frame_address();
        let mut it = StackIterator::init(fp);
        let mut n = 0usize;
        while n < out.len() {
            match it.next() {
                Some(addr) => {
                    out[n] = addr;
                    n += 1;
                }
                None => break,
            }
        }
        n
    };
    if let Some(target) = first_address {
        if let Some(skip) = out[..n].iter().position(|&a| a == target) {
            out.copy_within(skip..n, 0);
            return n - skip;
        }
    }
    n
}

/// Capture a faulting thread's call stack from the fault context. `pc` is the
/// exact faulting instruction (`ExceptionAddress` / `mcontext` PC) and becomes
/// frame 0.
///
/// POSIX: walk frame pointers from `fp` (the saved frame pointer register).
/// No trimming is needed — the walk starts on the faulting stack, so the
/// signal handler's own frames (on the altstack) are never in the chain.
/// `lr` (aarch64 x30) or `[sp]` (x86_64, the word `call` pushed) is inserted
/// after `pc` when it names a caller the fp-walk would skip — i.e. a fault
/// inside a frameless leaf, where `fp` still belongs to the caller and the
/// walk's first hop is the caller's caller. When the faulting function has
/// its own frame record, the walk's first hop is already the caller and the
/// recovered value would either duplicate it (not yet clobbered) or be stale
/// (clobbered); both are suppressed. The `[sp]` read is deferred to here (not
/// done in the signal handler) so a stack overflow with `rsp` in a guard page
/// cannot recursively fault before the crash header is printed.
///
/// Windows: `rbp` is not a reliable frame pointer across all linked code (the
/// prebuilt JavaScriptCore and LLInt assembly do not maintain it), so an
/// fp-walk derails at the C++ boundary. Use the native `.pdata`-based
/// `RtlCaptureStackBackTrace` instead — it works with or without unwind tables
/// since `.pdata` is always emitted — and trim the handler's own frames by
/// scanning for `pc`. `fp` / `lr` / `sp` are unused on Windows.
pub fn capture_from_context(
    pc: usize,
    fp: usize,
    lr: usize,
    sp: usize,
    out: &mut [usize],
) -> usize {
    if out.is_empty() {
        return 0;
    }
    out[0] = pc;
    let mut n = 1usize;
    #[cfg(windows)]
    {
        let _ = (fp, lr, sp);
        let cap = (out.len() - 1).min(u16::MAX as usize) as u32;
        // SAFETY: out[1..] is valid for `cap` writes; hash ptr may be null.
        let got = unsafe {
            bun_windows_sys::ntdll::RtlCaptureStackBackTrace(
                0,
                cap,
                out[1..].as_mut_ptr().cast::<*mut core::ffi::c_void>(),
                core::ptr::null_mut(),
            )
        } as usize;
        // VEH runs on the faulting thread's stack, so the captured trace is
        // [handler frames…][fault frame][callers…]. Trim everything above the
        // first frame whose return address sits within a small tolerance of
        // the fault `pc` (the call-site/return-address may be a few bytes
        // off). If no match, keep the full trace rather than discard it.
        const TOLERANCE: usize = 256;
        let frames = &out[1..1 + got];
        let skip = frames
            .iter()
            .take(12)
            .position(|&a| a.abs_diff(pc) <= TOLERANCE)
            .map(|i| i + 1)
            .unwrap_or(0);
        if skip > 0 {
            out.copy_within(1 + skip..1 + got, 1);
        }
        n += got - skip;
    }
    #[cfg(not(windows))]
    {
        let mut it = StackIterator::init(fp);
        let first = it.next();
        // x86_64 has no link register; derive one from the word `call`
        // pushed. A stack overflow can leave `rsp` in a PROT_NONE guard page
        // — `it.ma` tolerates that (process_vm_readv / mach_vm_read_overwrite
        // return an error rather than faulting).
        let lr = if lr == 0 && sp != 0 && sp.is_multiple_of(core::mem::align_of::<usize>()) {
            it.ma.load_usize(sp).unwrap_or(0)
        } else {
            lr
        };
        // Frameless-leaf recovery: emit `lr` between `pc` and the fp-walk when
        // it is a distinct, plausible return address. `first` (the saved LR at
        // `[fp+8]`) is the caller when the faulting function pushed a frame
        // record, but the caller's caller when it didn't; only in the latter
        // case does `lr` add information. `lr == first` means the faulting
        // function pushed a frame and hasn't clobbered x30/[rsp] yet, so skip
        // the duplicate. `lr == pc` covers a fault on the leaf's very first
        // instruction. The stack-proximity check rejects the x86_64 case
        // where a framed function has adjusted `rsp` and `[rsp]` is a local
        // rather than the pushed return address. A stale clobbered `lr` that
        // still lands in the image is tolerated — one noisy frame is cheaper
        // than a missing one.
        const STACK_RADIUS: usize = 64 * 1024 * 1024;
        if lr != 0
            && lr != pc
            && Some(lr) != first
            && lr.abs_diff(fp) > STACK_RADIUS
            && n < out.len()
            && it.ma.looks_like_code(lr)
        {
            out[n] = lr;
            n += 1;
        }
        if let Some(addr) = first {
            if n < out.len() {
                out[n] = addr;
                n += 1;
            }
        }
        while n < out.len() {
            match it.next() {
                Some(addr) => {
                    out[n] = addr;
                    n += 1;
                }
                None => break,
            }
        }
    }
    n
}
