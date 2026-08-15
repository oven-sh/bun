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
        #[cfg(any(target_os = "linux", target_os = "android"))]
        if self.mem >= 0 {
            // SAFETY: self.mem is a valid fd we opened.
            unsafe { libc::close(self.mem) };
        }
    }
}

/// Protection flags of the committed, accessible page containing `address`.
/// `None` for free/reserved pages and for committed pages that would still
/// fault on access: "not MEM_FREE" is not enough to make a read safe, since
/// MEM_RESERVE has no backing and MEM_COMMIT pages can be PAGE_NOACCESS or
/// PAGE_GUARD (the stack guard page after EXCEPTION_STACK_OVERFLOW is exactly
/// this).
#[cfg(windows)]
fn accessible_page_protection(address: usize) -> Option<u32> {
    use bun_windows_sys::kernel32::{
        MEM_COMMIT, MEMORY_BASIC_INFORMATION, PAGE_GUARD, PAGE_NOACCESS, VirtualQuery,
    };
    // SAFETY: MEMORY_BASIC_INFORMATION is a plain Win32 POD; all-zeros is
    // a valid representation.
    let mut mbi: MEMORY_BASIC_INFORMATION = unsafe { crate::ffi::zeroed_unchecked() };
    // SAFETY: `mbi` is a valid out-param of the size we pass; VirtualQuery
    // only inspects the address-space mapping at `address`.
    let rc = unsafe {
        VirtualQuery(
            core::ptr::without_provenance(address),
            &raw mut mbi,
            core::mem::size_of::<MEMORY_BASIC_INFORMATION>(),
        )
    };
    (rc != 0 && mbi.State == MEM_COMMIT && mbi.Protect & (PAGE_NOACCESS | PAGE_GUARD) == 0)
        .then_some(mbi.Protect)
}

/// Whether `address` points into mapped code: an image `.text` section or a
/// JIT/FFI allocation. Return addresses always do; the stack slots a derailed
/// walk would otherwise report (JSValues, heap pointers, counters) never do.
#[cfg(windows)]
fn is_executable_memory(address: usize) -> bool {
    use bun_windows_sys::kernel32::{
        PAGE_EXECUTE, PAGE_EXECUTE_READ, PAGE_EXECUTE_READWRITE, PAGE_EXECUTE_WRITECOPY,
    };
    const EXECUTABLE: u32 =
        PAGE_EXECUTE | PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY;
    accessible_page_protection(address).is_some_and(|p| p & EXECUTABLE != 0)
}

fn is_valid_memory(address: usize) -> bool {
    let page_size = bun_alloc::page_size();
    let aligned_address = address & !(page_size - 1);
    if aligned_address == 0 {
        return false;
    }
    #[cfg(windows)]
    {
        use bun_windows_sys::kernel32::{
            PAGE_EXECUTE_READ, PAGE_EXECUTE_READWRITE, PAGE_EXECUTE_WRITECOPY, PAGE_READONLY,
            PAGE_READWRITE, PAGE_WRITECOPY,
        };
        const READABLE: u32 = PAGE_READONLY
            | PAGE_READWRITE
            | PAGE_WRITECOPY
            | PAGE_EXECUTE_READ
            | PAGE_EXECUTE_READWRITE
            | PAGE_EXECUTE_WRITECOPY;
        accessible_page_protection(aligned_address).is_some_and(|p| p & READABLE != 0)
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

#[cfg(windows)]
fn context_pc_sp(ctx: &bun_windows_sys::CONTEXT) -> (u64, u64) {
    #[cfg(target_arch = "x86_64")]
    {
        (ctx.Rip, ctx.Rsp)
    }
    #[cfg(target_arch = "aarch64")]
    {
        (ctx.Pc, ctx.Sp)
    }
}

/// Step out of a leaf function (no unwind info because it never touches the
/// stack): the return address is still where the call left it, `[Rsp]` on x64
/// and `Lr` on ARM64 (`bl` pushes nothing, so `Sp` is correctly left alone).
/// Only frame 0 can be a leaf; a return address never points into a function
/// that makes no calls. Declines, leaving `ctx` untouched, when the slot does
/// not hold a code address: the faulting code is then offlineasm (see
/// [`unwind_frame_pointer`]) and the slot is scratch.
#[cfg(windows)]
fn unwind_leaf(ctx: &mut bun_windows_sys::CONTEXT, ma: &mut MemoryAccessor) -> bool {
    #[cfg(target_arch = "x86_64")]
    {
        if ctx.Rsp & 7 != 0 {
            return false;
        }
        let Some(return_pc) = ma.load_usize(ctx.Rsp as usize) else {
            return false;
        };
        if !is_executable_memory(return_pc) {
            return false;
        }
        ctx.Rip = return_pc as u64;
        ctx.Rsp += 8;
        true
    }
    #[cfg(target_arch = "aarch64")]
    {
        let _ = ma;
        if ctx.Lr == ctx.Pc || !is_executable_memory(ctx.Lr as usize) {
            return false;
        }
        ctx.Pc = ctx.Lr;
        true
    }
}

/// Step out of a frame that has no unwind info and is not a leaf. In bun that
/// is JSC's offlineasm code (the LLInt opcode handlers and the `vmEntryTo*`
/// trampolines carry no `.seh_*` directives, and for a PC inside the image
/// `RtlLookupFunctionEntry` consults only its static `.pdata`) and tinycc's
/// `bun:ffi` trampolines. Both keep the frame-pointer register (`rbp`/`x29`)
/// on a frame whose first two slots are the caller's frame pointer and the
/// return address: the `CallFrame` layout, which is also what the unwind info
/// JSC registers for its JIT pool describes (`registerJITUnwindInfo` in
/// WebKit's `ExecutableAllocator.cpp`). The Rtl unwinder restores that
/// register when it steps out of a compiled frame, so it holds the right frame
/// here however many C++ and JIT frames sat above. A frame pointer below the
/// stack pointer, or with unreadable slots, holds something else: stop.
#[cfg(windows)]
fn unwind_frame_pointer(ctx: &mut bun_windows_sys::CONTEXT, ma: &mut MemoryAccessor) -> bool {
    #[cfg(target_arch = "x86_64")]
    let (frame, sp) = (ctx.Rbp, ctx.Rsp);
    #[cfg(target_arch = "aarch64")]
    let (frame, sp) = (ctx.Fp, ctx.Sp);
    const SLOT: u64 = core::mem::size_of::<usize>() as u64;
    if frame % SLOT != 0 || frame < sp {
        return false;
    }
    let Some(caller_sp) = frame.checked_add(2 * SLOT) else {
        return false;
    };
    let (Some(caller_frame), Some(return_pc)) = (
        ma.load_usize(frame as usize),
        ma.load_usize((frame + SLOT) as usize),
    ) else {
        return false;
    };
    #[cfg(target_arch = "x86_64")]
    {
        ctx.Rbp = caller_frame as u64;
        ctx.Rip = return_pc as u64;
        ctx.Rsp = caller_sp;
    }
    #[cfg(target_arch = "aarch64")]
    {
        ctx.Fp = caller_frame as u64;
        ctx.Pc = return_pc as u64;
        ctx.Sp = caller_sp;
    }
    true
}

/// Capture a faulting thread's call stack from the fault context. `pc` is the
/// exact faulting instruction (`ExceptionAddress` / `mcontext` PC) and becomes
/// frame 0.
///
/// POSIX: walk frame pointers from `fp` (the saved frame pointer register).
/// No trimming is needed — the walk starts on the faulting stack, so the
/// signal handler's own frames (on the altstack) are never in the chain.
///
/// Windows: `fp` is the `*const CONTEXT` the VEH received (`EXCEPTION_POINTERS
/// ::ContextRecord`). The walk is `RtlLookupFunctionEntry` + `RtlVirtualUnwind`
/// seeded from that context, so it starts at the fault frame and the handler's
/// own frames are never in the chain. Compiled code always has unwind info and
/// JSC registers it for the JIT pool; the frames that lack it are JSC's
/// offlineasm (LLInt, `vmEntryToJavaScript`), which every JS-initiated crash
/// passes through, and those are stepped over via the frame pointer
/// ([`unwind_frame_pointer`]). A pure frame-pointer walk is still not an
/// option: the prebuilt C++ does not maintain one, and it is the Rtl unwinder
/// stepping through those frames that keeps the frame-pointer register valid.
pub fn capture_from_context(pc: usize, fp: usize, out: &mut [usize]) -> usize {
    if out.is_empty() {
        return 0;
    }
    out[0] = pc;
    let mut n = 1usize;
    #[cfg(windows)]
    {
        use bun_windows_sys::{CONTEXT, UNW_FLAG_NHANDLER, ntdll};
        if fp == 0 {
            // No CONTEXT available (should not happen for a real VEH fault).
            return n;
        }
        // SAFETY: `fp` is `EXCEPTION_POINTERS::ContextRecord` from the kernel;
        // valid for the duration of the handler. Copy so RtlVirtualUnwind can
        // mutate freely without touching the kernel's record.
        let mut ctx: CONTEXT = unsafe { *(fp as *const CONTEXT) };
        let mut ma = MemoryAccessor::INIT;
        // Termination: on x64 RtlVirtualUnwind sets Pc = 0 at the end of the
        // chain; on ARM64 it can leave the CONTEXT entirely unchanged, so a
        // step that changed neither Pc nor Sp is also terminal. An Sp-only or
        // Pc-only check truncates legitimate stacks: an ARM64 fault at prolog
        // offset 0 (or a .pdata-bearing zero-stack leaf) sets Pc = Lr while
        // leaving Sp unchanged, and directly-recursive frames share a return
        // Pc. A step that produces a non-code Pc has lost the chain (a smashed
        // return address, or a fallback applied to a frame it does not fit);
        // the trace ends at the last frame that was actually recovered rather
        // than continuing into whatever the stack slots happen to hold. The
        // `n < out.len()` cap is the ultimate bound.
        while n < out.len() {
            let (control_pc, control_sp) = context_pc_sp(&ctx);
            let mut image_base: u64 = 0;
            // SAFETY: `control_pc` is a code address from the fault context;
            // `image_base` is valid for write; history table may be null.
            let rf = unsafe {
                ntdll::RtlLookupFunctionEntry(control_pc, &mut image_base, core::ptr::null_mut())
            };
            if !rf.is_null() {
                let mut handler_data: *mut core::ffi::c_void = core::ptr::null_mut();
                let mut establisher_frame: u64 = 0;
                // SAFETY: `rf` and `image_base` came from RtlLookupFunctionEntry
                // for `control_pc`; `ctx` is a valid local CONTEXT; out-params
                // are valid for write; ContextPointers may be null.
                unsafe {
                    ntdll::RtlVirtualUnwind(
                        UNW_FLAG_NHANDLER,
                        image_base,
                        control_pc,
                        rf,
                        &mut ctx,
                        &mut handler_data,
                        &mut establisher_frame,
                        core::ptr::null_mut(),
                    );
                }
            } else if !(n == 1 && unwind_leaf(&mut ctx, &mut ma))
                && !unwind_frame_pointer(&mut ctx, &mut ma)
            {
                break;
            }
            let (next_pc, next_sp) = context_pc_sp(&ctx);
            if next_pc == 0
                || (next_pc == control_pc && next_sp == control_sp)
                || !is_executable_memory(next_pc as usize)
            {
                break;
            }
            out[n] = next_pc as usize;
            n += 1;
        }
    }
    #[cfg(not(windows))]
    {
        let mut it = StackIterator::init(fp);
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
