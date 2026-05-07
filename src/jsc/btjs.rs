use core::ffi::c_char;
#[cfg(debug_assertions)]
use std::io::Write as _;

#[cfg(debug_assertions)]
use bun_core::{self, err, Error};
#[cfg(debug_assertions)]
use crate::{CallFrame, VirtualMachineRef as VirtualMachine};

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
    use std::collections::HashMap;

    use bun_core::{err, Error};

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
    const HAVE_GETCONTEXT: bool =
        cfg!(all(not(windows), not(target_os = "android"), not(target_os = "openbsd")));

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
                core::ptr::write(context, core::mem::zeroed());
                bun_sys::windows::ntdll::RtlCaptureContext(context);
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
                // SAFETY: context points to a valid `ucontext_t`; getcontext(3) fills it.
                let result = unsafe { libc::getcontext(context) } == 0;
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
            unsafe { core::arch::asm!("mov {}, rbp", out(reg) fp, options(nomem, nostack, preserves_flags)) };
            fp
        }
        #[cfg(target_arch = "aarch64")]
        {
            let fp: usize;
            // SAFETY: reading x29 (fp) is side-effect-free.
            unsafe { core::arch::asm!("mov {}, x29", out(reg) fp, options(nomem, nostack, preserves_flags)) };
            fp
        }
        #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
        {
            // PORT NOTE: @frameAddress() — approximate with a stack local's addr on
            // arches without an asm! mapping yet. fp-walk will fail its alignment
            // sanity check and terminate cleanly.
            let probe = 0u8;
            &probe as *const u8 as usize
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
                        let local = libc::iovec { iov_base: buf.as_mut_ptr().cast(), iov_len: buf.len() };
                        let remote = libc::iovec { iov_base: address as *mut c_void, iov_len: buf.len() };
                        // SAFETY: iovecs point to valid memory for their stated lengths.
                        let bytes_read =
                            unsafe { libc::process_vm_readv(pid, &local, 1, &remote, 1, 0) };
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
                            libc::pread(fd, buf.as_mut_ptr().cast(), buf.len(), address as libc::off_t)
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
            if self.read(address, &mut result) { Some(usize::from_ne_bytes(result)) } else { None }
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
            // PORT NOTE: VirtualQuery path — fall back to "valid" on Windows; the
            // fp-walker is not used there (RtlVirtualUnwind path is taken instead).
            let _ = aligned_address;
            return true;
        }
        #[cfg(not(windows))]
        {
            // SAFETY: msync only inspects the mapping; aligned_address is page-aligned.
            let rc = unsafe { libc::msync(aligned_address as *mut c_void, page_size, libc::MS_ASYNC) };
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
                    return Some(LastUnwindError { err: e, address: unwind_state.pc });
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
    pub struct SelfInfo {
        address_map: HashMap<usize, Box<Module>>,
    }

    /// Port of `SelfInfo.Module`. On Linux Zig uses `Dwarf.ElfModule`; on Darwin a
    /// MachO symbol table reader. Both ultimately resolve `address → {name, CU,
    /// source_location}`. The DWARF/MachO parsers are not ported; `dladdr(3)`
    /// provides the symbol-name half (which is what `btjs` actually consumes for
    /// its `__`/`_llint_call_javascript` prefix checks). `source_location` is left
    /// `None`, which `print_line_info` already handles.
    // PORT NOTE: full `readElfDebugInfo`/`readMachODebugInfo` (~2k LOC of DWARF) not
    // ported — `dladdr` is the libc-level equivalent for symbol-name resolution.
    pub struct Module {
        base_address: usize,
        name: Box<[u8]>,
    }

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

    impl SelfInfo {
        /// Port of `SelfInfo.open`.
        pub fn open() -> Result<SelfInfo, Error> {
            // `if (builtin.strip_debug_info) return error.MissingDebugInfo;`
            if !cfg!(debug_assertions) {
                return Err(err!("MissingDebugInfo"));
            }
            #[cfg(any(
                target_os = "linux",
                target_os = "freebsd",
                target_os = "netbsd",
                target_os = "dragonfly",
                target_os = "openbsd",
                target_os = "macos",
                target_os = "solaris",
                target_os = "illumos",
                windows,
            ))]
            {
                // SelfInfo.init — non-Windows path is just an empty address_map.
                return Ok(SelfInfo { address_map: HashMap::new() });
            }
            #[allow(unreachable_code)]
            Err(err!("UnsupportedOperatingSystem"))
        }

        /// Port of `SelfInfo.getModuleForAddress`.
        pub fn get_module_for_address(&mut self, address: usize) -> Result<&mut Module, Error> {
            #[cfg(target_vendor = "apple")]
            {
                return self.lookup_module_dyld(address);
            }
            #[cfg(windows)]
            {
                let _ = address;
                return Err(err!("MissingDebugInfo"));
            }
            #[cfg(not(any(target_vendor = "apple", windows)))]
            {
                return self.lookup_module_dl(address);
            }
        }

        /// Port of `SelfInfo.getModuleNameForAddress`. Returns the basename of the
        /// shared object containing `address`, or `None` if not found.
        pub fn get_module_name_for_address(&mut self, address: usize) -> Option<Box<[u8]>> {
            #[cfg(target_vendor = "apple")]
            {
                return lookup_module_name_dyld(address);
            }
            #[cfg(windows)]
            {
                let _ = address;
                return None;
            }
            #[cfg(not(any(target_vendor = "apple", windows)))]
            {
                return lookup_module_name_dl(address);
            }
        }

        #[cfg(not(any(target_vendor = "apple", windows)))]
        fn lookup_module_dl(&mut self, address: usize) -> Result<&mut Module, Error> {
            struct Ctx {
                // Input
                address: usize,
                // Output
                base_address: usize,
                name: Box<[u8]>,
                found: bool,
            }
            let mut ctx = Ctx { address, base_address: 0, name: Box::default(), found: false };

            unsafe extern "C" fn callback(
                info: *mut libc::dl_phdr_info,
                _size: libc::size_t,
                data: *mut c_void,
            ) -> c_int {
                // SAFETY: dl_iterate_phdr passes a valid info pointer; data is &mut Ctx.
                let context = unsafe { &mut *(data as *mut Ctx) };
                // SAFETY: dl_iterate_phdr passes a valid info pointer.
                let info = unsafe { &*info };
                // The base address is too high
                if context.address < info.dlpi_addr as usize {
                    return 0;
                }
                // SAFETY: dlpi_phdr points to dlpi_phnum entries.
                let phdrs =
                    unsafe { core::slice::from_raw_parts(info.dlpi_phdr, info.dlpi_phnum as usize) };
                for phdr in phdrs {
                    if phdr.p_type != libc::PT_LOAD {
                        continue;
                    }
                    // Overflowing addition is used to handle the case of VSDOs having a p_vaddr = 0xffffffffff700000
                    let seg_start = (info.dlpi_addr as usize).wrapping_add(phdr.p_vaddr as usize);
                    let seg_end = seg_start + phdr.p_memsz as usize;
                    if context.address >= seg_start && context.address < seg_end {
                        // Android libc uses NULL instead of an empty string to mark the
                        // main program
                        context.name = if info.dlpi_name.is_null() {
                            Box::default()
                        } else {
                            // SAFETY: dlpi_name is a valid NUL-terminated C string.
                            unsafe { core::ffi::CStr::from_ptr(info.dlpi_name) }
                                .to_bytes()
                                .to_vec()
                                .into_boxed_slice()
                        };
                        context.base_address = info.dlpi_addr as usize;
                        context.found = true;
                        return 1; // error.Found → stop iteration
                    }
                }
                0
            }

            // SAFETY: ctx outlives the dl_iterate_phdr call; callback signature matches libc's contract.
            unsafe { libc::dl_iterate_phdr(Some(callback), &mut ctx as *mut Ctx as *mut c_void) };

            if !ctx.found {
                return Err(err!("MissingDebugInfo"));
            }

            if !self.address_map.contains_key(&ctx.base_address) {
                let obj_di = Box::new(Module { base_address: ctx.base_address, name: ctx.name });
                self.address_map.insert(ctx.base_address, obj_di);
            }
            Ok(self.address_map.get_mut(&ctx.base_address).unwrap())
        }

        #[cfg(target_vendor = "apple")]
        fn lookup_module_dyld(&mut self, address: usize) -> Result<&mut Module, Error> {
            // PORT NOTE: Zig walks `_dyld_get_image_header` + LoadCommandIterator. `dladdr`
            // gives the same `{base_address, fname}` pair on Darwin without the MachO walk.
            // SAFETY: dladdr only reads; out-param is a valid Dl_info.
            let mut info: libc::Dl_info = unsafe { core::mem::zeroed() };
            let rc = unsafe { libc::dladdr(address as *const c_void, &mut info) };
            if rc == 0 {
                return Err(err!("MissingDebugInfo"));
            }
            let base_address = info.dli_fbase as usize;
            if !self.address_map.contains_key(&base_address) {
                let name = if info.dli_fname.is_null() {
                    Box::default()
                } else {
                    // SAFETY: dli_fname is a valid NUL-terminated C string when non-null.
                    unsafe { core::ffi::CStr::from_ptr(info.dli_fname) }
                        .to_bytes()
                        .to_vec()
                        .into_boxed_slice()
                };
                self.address_map.insert(base_address, Box::new(Module { base_address, name }));
            }
            Ok(self.address_map.get_mut(&base_address).unwrap())
        }
    }

    impl Module {
        /// Port of `Module.getSymbolAtAddress`.
        pub fn get_symbol_at_address(&mut self, address: usize) -> Result<SymbolInfo, Error> {
            let _ = self.base_address;
            // SAFETY: dladdr only reads; out-param is a valid Dl_info.
            let mut info: libc::Dl_info = unsafe { core::mem::zeroed() };
            let rc = unsafe { libc::dladdr(address as *const c_void, &mut info) };
            if rc == 0 || info.dli_sname.is_null() {
                // Zig returns a default-initialized `Symbol` (`.{}` — name "???") here
                // rather than erroring, so the caller still prints the address line.
                return Ok(SymbolInfo {
                    name: b"???".to_vec().into_boxed_slice(),
                    compile_unit_name: bun_paths::basename(&self.name)
                        .to_vec()
                        .into_boxed_slice(),
                    source_location: None,
                });
            }
            // SAFETY: dli_sname is a valid NUL-terminated C string when non-null.
            let name = unsafe { core::ffi::CStr::from_ptr(info.dli_sname) }
                .to_bytes()
                .to_vec()
                .into_boxed_slice();
            let compile_unit_name = if info.dli_fname.is_null() {
                bun_paths::basename(&self.name).to_vec().into_boxed_slice()
            } else {
                // SAFETY: dli_fname is a valid NUL-terminated C string when non-null.
                bun_paths::basename(unsafe { core::ffi::CStr::from_ptr(info.dli_fname) }.to_bytes())
                    .to_vec()
                    .into_boxed_slice()
            };
            Ok(SymbolInfo {
                name,
                compile_unit_name,
                // PORT NOTE: DWARF line-table lookup not ported; dladdr does not provide
                // file:line. `print_line_info` handles `None` by printing `???:?:?`.
                source_location: None,
            })
        }
    }

    #[cfg(not(any(target_vendor = "apple", windows)))]
    fn lookup_module_name_dl(address: usize) -> Option<Box<[u8]>> {
        struct Ctx {
            address: usize,
            name: Option<Box<[u8]>>,
        }
        let mut ctx = Ctx { address, name: None };

        unsafe extern "C" fn callback(
            info: *mut libc::dl_phdr_info,
            _size: libc::size_t,
            data: *mut c_void,
        ) -> c_int {
            // SAFETY: dl_iterate_phdr passes a valid info pointer; data is &mut Ctx.
            let context = unsafe { &mut *(data as *mut Ctx) };
            // SAFETY: dl_iterate_phdr passes a valid info pointer.
            let info = unsafe { &*info };
            if context.address < info.dlpi_addr as usize {
                return 0;
            }
            // SAFETY: dlpi_phdr points to dlpi_phnum entries.
            let phdrs =
                unsafe { core::slice::from_raw_parts(info.dlpi_phdr, info.dlpi_phnum as usize) };
            for phdr in phdrs {
                if phdr.p_type != libc::PT_LOAD {
                    continue;
                }
                let seg_start = (info.dlpi_addr as usize).wrapping_add(phdr.p_vaddr as usize);
                let seg_end = seg_start + phdr.p_memsz as usize;
                if context.address >= seg_start && context.address < seg_end {
                    let name = if info.dlpi_name.is_null() {
                        &b""[..]
                    } else {
                        // SAFETY: dlpi_name is a valid NUL-terminated C string.
                        unsafe { core::ffi::CStr::from_ptr(info.dlpi_name) }.to_bytes()
                    };
                    context.name =
                        Some(bun_paths::basename(name).to_vec().into_boxed_slice());
                    return 1; // error.Found → stop iteration
                }
            }
            0
        }

        // SAFETY: ctx outlives the dl_iterate_phdr call; callback signature matches libc's contract.
        unsafe { libc::dl_iterate_phdr(Some(callback), &mut ctx as *mut Ctx as *mut c_void) };
        ctx.name
    }

    #[cfg(target_vendor = "apple")]
    fn lookup_module_name_dyld(address: usize) -> Option<Box<[u8]>> {
        // SAFETY: dladdr only reads; out-param is a valid Dl_info.
        let mut info: libc::Dl_info = unsafe { core::mem::zeroed() };
        let rc = unsafe { libc::dladdr(address as *const c_void, &mut info) };
        if rc == 0 || info.dli_fname.is_null() {
            return None;
        }
        // SAFETY: dli_fname is a valid NUL-terminated C string when non-null.
        let name = unsafe { core::ffi::CStr::from_ptr(info.dli_fname) }.to_bytes();
        Some(bun_paths::basename(name).to_vec().into_boxed_slice())
    }

    // ── std.debug.getSelfDebugInfo ───────────────────────────────────────
    static mut SELF_DEBUG_INFO: Option<SelfInfo> = None;

    /// Port of `std.debug.getSelfDebugInfo`. NOT thread-safe (the Zig original
    /// has the same `TODO multithreaded awareness` caveat); btjs is only called
    /// from lldb on a stopped process.
    pub fn get_self_debug_info() -> Result<&'static mut SelfInfo, Error> {
        // SAFETY: Zig's `var self_debug_info: ?SelfInfo = null` is also a plain
        // mutable global; this is debug-only and invoked from a stopped process.
        unsafe {
            let slot = &mut *core::ptr::addr_of_mut!(SELF_DEBUG_INFO);
            if let Some(info) = slot {
                return Ok(info);
            }
            *slot = Some(SelfInfo::open()?);
            Ok(slot.as_mut().unwrap())
        }
    }
}
#[cfg(debug_assertions)]
use zig_std_debug::{Module, SelfInfo, SourceLocation, StackIterator, SymbolInfo, ThreadContext, UnwindError};

// Port of the subset of `std.io.tty.{Config,Color,detectConfig}` used by btjs.zig
// (vendor/zig/lib/std/Io/tty.zig). Only the four colors btjs emits are mapped; the
// `windows_api` variant is omitted because btjs writes to an in-memory `Vec<u8>`
// returned to lldb, not to the live console handle, so `SetConsoleTextAttribute`
// would colour the wrong stream.
#[cfg(debug_assertions)]
mod tty {
    pub enum Config {
        NoColor,
        EscapeCodes,
    }
    pub enum Color {
        Bold,
        Reset,
        Dim,
        Green,
    }
    impl Config {
        /// Port of `std.io.tty.Config.setColor`.
        pub fn set_color(&self, w: &mut Vec<u8>, c: Color) -> Result<(), bun_core::Error> {
            match self {
                Config::NoColor => Ok(()),
                Config::EscapeCodes => {
                    let color_string: &[u8] = match c {
                        Color::Green => b"\x1b[32m",
                        Color::Bold => b"\x1b[1m",
                        Color::Dim => b"\x1b[2m",
                        Color::Reset => b"\x1b[0m",
                    };
                    w.extend_from_slice(color_string);
                    Ok(())
                }
            }
        }
    }

    /// Port of `process.hasNonEmptyEnvVarConstant`.
    fn has_non_empty_env_var(name: &core::ffi::CStr) -> bool {
        // SAFETY: getenv only reads; name is a valid NUL-terminated C string.
        let val = unsafe { libc::getenv(name.as_ptr()) };
        // SAFETY: getenv returns either NULL or a valid NUL-terminated C string.
        !val.is_null() && unsafe { *val } != 0
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

        if force_color == Some(true) { Config::EscapeCodes } else { Config::NoColor }
    }
}
#[cfg(debug_assertions)]
use tty::Color;

#[cfg(debug_assertions)]
unsafe extern "C" {
    static jsc_llint_begin: u8;
    static jsc_llint_end: u8;
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
        b"btjs is disabled in release builds\0".as_ptr() as *const c_char
    }
}

#[cfg(debug_assertions)]
fn dump_btjs_trace_debug_impl() -> *const c_char {
    let mut result_writer: Vec<u8> = Vec::new();
    let w = &mut result_writer;

    let debug_info: &mut SelfInfo = match get_self_debug_info() {
        Ok(di) => di,
        Err(err) => {
            if write!(
                w,
                "Unable to dump stack trace: Unable to open debug info: {}\x00",
                err.name()
            )
            .is_err()
            {
                return b"<oom>\0".as_ptr() as *const c_char;
            }
            // leak intentionally — caller is lldb and never frees
            return Box::into_raw(result_writer.into_boxed_slice()) as *const c_char;
        }
    };

    // std.log.info("jsc_llint_begin: {x}", .{@intFromPtr(&jsc_llint_begin)});
    // std.log.info("jsc_llint_end: {x}", .{@intFromPtr(&jsc_llint_end)});

    let tty_config = tty::detect_config_stdout();

    // SAFETY: Zig used `= undefined`; getcontext fully initializes.
    let mut context: ThreadContext = unsafe { core::mem::zeroed() };
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
    Box::into_raw(result_writer.into_boxed_slice()) as *const c_char
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

    let frame = fp as *const CallFrame;
    if do_llint {
        // SAFETY: fp is a raw frame pointer from the stack iterator; only dereferenced when
        // do_llint holds (i.e. address is inside the JSC LLInt range, so fp is a JSC CallFrame).
        let frame = unsafe { &*frame };
        // SAFETY: VM singleton is process-lifetime; `global` is set before any
        // JS frame can be on the stack to inspect.
        let srcloc = frame.get_caller_src_loc(unsafe { &*VirtualMachine::get().as_mut().global });
        tty_config.set_color(out_stream, Color::Bold)?;
        write!(out_stream, "{}:{}:{}: ", srcloc.str, srcloc.line, srcloc.column)?;
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
    if do_llint {
        // SAFETY: see above — address is inside the JSC LLInt range, so fp is a JSC CallFrame.
        let desc = unsafe { &*frame }.describe_frame();
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
                    let space_needed = usize::try_from(sl.column - 1).unwrap();

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
    let f = bun_sys::File::open_at(bun_sys::Fd::cwd(), &source_location.file_name, bun_sys::O::RDONLY, 0)
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
fn get_self_debug_info() -> Result<&'static mut SelfInfo, Error> {
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/btjs.zig (260 lines)
//   confidence: medium
//   notes:      std.debug.* (SelfInfo/StackIterator/MemoryAccessor/getContext)
//               ported inline from vendor/zig/lib/std/debug{.zig,/SelfInfo.zig,
//               /MemoryAccessor.zig}. fp-based unwinder is a faithful port;
//               DWARF line-table lookup is replaced by dladdr (symbol name only,
//               no file:line). Release builds compile only the static
//               "disabled" string.
// ──────────────────────────────────────────────────────────────────────────
