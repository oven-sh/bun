//! Runtime side of the `.node` static merge that `pe::PEFile::add_linked_addon`
//! performs during `bun build --compile` on Windows. The build step adds each
//! addon to bun.exe as an RW section rebased to bun.exe's preferred image base,
//! and records per addon in a `.bunL` section: its span, relocation blocks,
//! imports, displaced exception handlers and the export RVAs `process.dlopen`
//! needs.
//!
//! `process.dlopen("B:/~BUN/...")` looks the path up here; if the addon was
//! merged, this module finishes the link and hands its exports to BunProcess.cpp:
//!
//!   1. add the ASLR delta to every DIR64 relocation
//!   2. bind the IAT: host imports (`node.exe` etc.) against bun.exe's own
//!      exports, everything else via `LoadLibraryA` + `GetProcAddress`
//!   3. `VirtualProtect` each section to its shipped protection, then
//!      `FlushInstructionCache`
//!   4. call the addon's `DllMain(DLL_PROCESS_ATTACH)`
//!
//! Unwinding needs no runtime step: the build merged the addon's unwind tables
//! into bun.exe's exception directory, the only table Windows consults for a pc
//! inside the exe image, and routed their exception handlers through
//! `Bun__linkedAddonExceptionHandler` below.
//!
//! A C++ throw locates the thrown type's metadata relative to the image that
//! `RtlPcToFileHeader` reports for the throw site, which for merged code would
//! be bun.exe. Addons linked against the static CRT (node-gyp's default) import
//! that function themselves, and step 2 binds the import to `pc_to_file_header`
//! below, which reports the addon. Addons linked against the CRT DLLs throw
//! through `vcruntime140.dll`'s own import, which cannot be redirected, so the
//! build leaves addons that import `_CxxThrowException` out of the merge.
//! Addons with real `__declspec(thread)` storage are left out too: no userspace
//! API hands out a loader TLS slot. Both, like any bind failure here, take the
//! tempfile plus `LoadLibraryExW` fallback.
//!
//! Not detectable at build time, so such addons need
//! `BUN_FEATURE_FLAG_DISABLE_PE_ADDON_LINK=1`: a `DllMain` that relies on
//! `DLL_THREAD_ATTACH`/`DETACH` or on `DLL_PROCESS_DETACH` at exit (neither is
//! delivered to a merged addon, so its `atexit` handlers and static destructors
//! do not run when the process exits), and static initializers that `dlopen`
//! another merged addon (V8-style `NODE_MODULE` Init functions run inside
//! `DllMain`, under `LOCK`).

#![cfg(windows)]

use core::cell::UnsafeCell;
use core::ffi::c_void;
use core::mem::size_of;

use bun_core::scoped_log;
use bun_exe_format::pe::{
    Bun__getLinkedAddonsPEData, Bun__getLinkedAddonsPELength, LINKED_HANDLER_ENTRY_SIZE,
    LINKED_INDEX_ENTRY_SIZE, LINKED_MAGIC, LINKED_VERSION,
};
use bun_sys::windows::disposition::ExceptionContinueSearch;
use bun_threading::Mutex;
use bun_windows_sys::externs::kernel32;

bun_core::declare_scope!(LinkedNodeModule, visible);

/// Mirrors `Bun__LinkedNodeModuleResolved` in BunProcess.cpp; null means not exported.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct Resolved {
    pub napi_register_module_v1: *mut c_void,
    pub node_api_module_get_api_version_v1: *mut c_void,
    /// `DLHandleMap` key: the addon's RVA 0 address (a merged addon has no HMODULE).
    pub handle_token: *mut c_void,
    /// True when this call ran `bind()` (and so `DllMain`). `Bun__initLinkedNodeModule`
    /// then returns with `LOCK` still held so the C++ caller can publish the handle to
    /// `DLHandleMap` before a concurrent Worker's cached-hit path reads it; C++ must
    /// call `Bun__linkedNodeModuleUnlock()` exactly once, before any re-entrant user
    /// code runs (the lock is not recursive). False on the cached-hit and failure
    /// paths, where the lock was already released.
    pub did_bind: bool,
}

impl Resolved {
    const fn empty() -> Resolved {
        Resolved {
            napi_register_module_v1: core::ptr::null_mut(),
            node_api_module_get_api_version_v1: core::ptr::null_mut(),
            handle_token: core::ptr::null_mut(),
            did_bind: false,
        }
    }
}

// SAFETY: the raw pointers are addresses into bun.exe's own image (valid
// for the process lifetime, same in every thread); Resolved is plain data.
unsafe impl Send for Resolved {}

struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
}

#[derive(Debug)]
enum BindError {
    Truncated,
    BadMagic,
    BadVersion,
    BadReloc,
    BadImport,
    BadSection,
    NoBlob,
    NoModuleHandle,
    ImportNameTooLong,
    ImportDllMissing,
    ImportSymbolMissing,
    VirtualProtectFailed,
    DllMainFalse,
}

impl<'a> Reader<'a> {
    fn u8_(&mut self) -> Result<u8, BindError> {
        if self.pos >= self.bytes.len() {
            return Err(BindError::Truncated);
        }
        let v = self.bytes[self.pos];
        self.pos += 1;
        Ok(v)
    }
    fn u16_(&mut self) -> Result<u16, BindError> {
        if self.pos + 2 > self.bytes.len() {
            return Err(BindError::Truncated);
        }
        let v = u16::from_le_bytes(
            self.bytes[self.pos..self.pos + 2]
                .try_into()
                .expect("infallible: size matches"),
        );
        self.pos += 2;
        Ok(v)
    }
    fn u32_(&mut self) -> Result<u32, BindError> {
        if self.pos + 4 > self.bytes.len() {
            return Err(BindError::Truncated);
        }
        let v = u32::from_le_bytes(
            self.bytes[self.pos..self.pos + 4]
                .try_into()
                .expect("infallible: size matches"),
        );
        self.pos += 4;
        Ok(v)
    }
    fn u64_(&mut self) -> Result<u64, BindError> {
        if self.pos + 8 > self.bytes.len() {
            return Err(BindError::Truncated);
        }
        let v = u64::from_le_bytes(
            self.bytes[self.pos..self.pos + 8]
                .try_into()
                .expect("infallible: size matches"),
        );
        self.pos += 8;
        Ok(v)
    }
    fn str_(&mut self) -> Result<&'a [u8], BindError> {
        let n = self.u32_()? as usize;
        if self.pos + n > self.bytes.len() {
            return Err(BindError::Truncated);
        }
        let s = &self.bytes[self.pos..self.pos + n];
        self.pos += n;
        Ok(s)
    }
    fn skip(&mut self, n: usize) -> Result<(), BindError> {
        if self.pos + n > self.bytes.len() {
            return Err(BindError::Truncated);
        }
        self.pos += n;
        Ok(())
    }
}

/// One `LinkedSectionInfo` record in the blob: rva, size, final_protect.
const SECTION_INFO_SIZE: usize = 12;

#[derive(Clone, Copy)]
enum State {
    Unbound,
    Bound(Resolved),
    /// `bind()` irreversibly mutates the merged section (relocs, page protections,
    /// `DllMain`), so it runs at most once: `Failed` is terminal and later calls
    /// go straight to the tempfile fallback.
    Failed,
}

/// One addon's record in the loader-mapped `.bunL` blob, which the slices borrow from.
struct Entry {
    name: &'static [u8],
    rva_base: u32,
    image_size: u32,
    entry_point: u32,
    preferred_base: u64,
    export_register: u32,
    export_api_version: u32,
    /// Blob offset of the section list: u32 count, then `SECTION_INFO_SIZE` bytes each.
    sections_pos: usize,
    relocs: &'static [u8],
    /// Blob offset of the import list (layout: see `bind_imports`).
    imports_pos: usize,
    state: State,
}

struct Table {
    loaded: bool,
    /// Usually 0 or 1 addons, a handful at most — linear scan.
    entries: Vec<Entry>,
}

/// Guards `TABLE`; no `lock_guard` because the `did_bind` path hands the release to C++.
static LOCK: Mutex = Mutex::new();

struct TableCell(UnsafeCell<Table>);
// SAFETY: every access to the inner `Table` goes through `LOCK`
// (`Bun__initLinkedNodeModule` takes it before touching `TABLE` and either
// releases it before returning or hands the release to
// `Bun__linkedNodeModuleUnlock`), so the `UnsafeCell` is never aliased
// mutably across threads. `Entry` holds `&'static [u8]` into the
// loader-mapped blob plus plain data, and `Resolved`'s pointers are
// process-wide image addresses, so the value itself is safe to share.
unsafe impl Sync for TableCell {}

static TABLE: TableCell = TableCell(UnsafeCell::new(Table {
    loaded: false,
    entries: Vec::new(),
}));

fn blob() -> Option<&'static [u8]> {
    // SAFETY: implemented in c-bindings.cpp; returns a pointer into the
    // loader-mapped `.bunL` section of the running exe (or null), valid
    // for the process lifetime.
    let len = unsafe { Bun__getLinkedAddonsPELength() };
    if len == 0 {
        return None;
    }
    // SAFETY: as above.
    let ptr = unsafe { Bun__getLinkedAddonsPEData() };
    if ptr.is_null() {
        return None;
    }
    // SAFETY: the section is mapped read-only for the process lifetime;
    // len is the u64 length prefix the build wrote.
    Some(unsafe { core::slice::from_raw_parts(ptr, len as usize) })
}

/// Caller must hold `LOCK`.
fn ensure_loaded(table: &mut Table) {
    if table.loaded {
        return;
    }
    table.loaded = true;
    let Some(blob) = blob() else { return };
    if let Err(err) = parse_blob(table, blob) {
        scoped_log!(
            LinkedNodeModule,
            "failed to parse .bunL blob: {:?}; falling back to temp-file LoadLibrary",
            err
        );
        table.entries.clear();
    }
}

fn parse_blob(table: &mut Table, blob: &'static [u8]) -> Result<(), BindError> {
    let mut r = Reader {
        bytes: blob,
        pos: 0,
    };
    if r.u32_()? != LINKED_MAGIC {
        return Err(BindError::BadMagic);
    }
    if r.u32_()? != LINKED_VERSION {
        return Err(BindError::BadVersion);
    }
    let count = r.u32_()?;
    // The handler index is only read by `Bun__linkedAddonExceptionHandler`.
    r.skip(
        (count as usize)
            .checked_mul(LINKED_INDEX_ENTRY_SIZE)
            .ok_or(BindError::Truncated)?,
    )?;
    // No `reserve(count)`: a corrupt count should hit `Truncated`, not abort on OOM.
    for _ in 0..count {
        let name = r.str_()?;
        let rva_base = r.u32_()?;
        let image_size = r.u32_()?;
        let entry_point = r.u32_()?;
        let preferred_base = r.u64_()?;
        let export_register = r.u32_()?;
        let export_api_version = r.u32_()?;
        let sections_pos = r.pos;
        let nsect = r.u32_()?;
        let sect_bytes = SECTION_INFO_SIZE
            .checked_mul(nsect as usize)
            .ok_or(BindError::Truncated)?;
        r.skip(sect_bytes)?;
        let relocs = r.str_()?;
        let imports_pos = r.pos;
        // Just skipping the imports; `bind_imports` re-reads them from `imports_pos`.
        let nlib = r.u32_()?;
        for _ in 0..nlib {
            let _ = r.str_()?; // dll name
            let _ = r.u8_()?; // is_host
            let nent = r.u32_()?;
            for _ in 0..nent {
                let _ = r.u32_()?; // iat_rva
                let _ = r.u16_()?; // ordinal
                let _ = r.str_()?; // name
            }
        }
        table.entries.push(Entry {
            name,
            rva_base,
            image_size,
            entry_point,
            preferred_base,
            export_register,
            export_api_version,
            sections_pos,
            relocs,
            imports_pos,
            state: State::Unbound,
        });
    }
    Ok(())
}

/// Caller must hold `LOCK`.
fn lookup(table: &Table, path: &[u8]) -> Option<usize> {
    if let Some(i) = table.entries.iter().position(|e| e.name == path) {
        return Some(i);
    }
    // The build-time keys always use forward slashes; callers may pass either separator.
    if bun_core::strings::contains_char(path, b'\\') {
        let mut buf = bun_paths::path_buffer_pool::get();
        if path.len() > buf.len() {
            return None;
        }
        let normalized = &mut buf[..path.len()];
        normalized.copy_from_slice(path);
        bun_paths::resolve_path::platform_to_posix_in_place::<u8>(normalized);
        return table.entries.iter().position(|e| e.name == &*normalized);
    }
    None
}

fn bind(entry: &Entry) -> Result<Resolved, BindError> {
    // SAFETY: kernel32 call with null (self) module name.
    let base_h = unsafe { kernel32::GetModuleHandleW(core::ptr::null()) };
    if base_h.is_null() {
        return Err(BindError::NoModuleHandle);
    }
    let base_addr = base_h as usize;
    let base = base_addr as *mut u8;

    // ASLR delta relative to the image base the merge rebased the addon to.
    let delta = (base_addr as i64).wrapping_sub(entry.preferred_base as i64);
    if delta != 0 {
        apply_relocs(base, entry, delta)?;
    }

    // Host (node.exe) imports resolve against bun.exe's own exports (src/symbols.def).
    bind_imports(base, entry, base_h)?;

    // Every RVA read from the blob is checked against the addon's own span before use.
    let lo = entry.rva_base as u64;
    let hi = lo + entry.image_size as u64;
    // Code bytes are final; restore the protections the addon shipped with.
    {
        let blob = blob().ok_or(BindError::NoBlob)?;
        let mut r = Reader {
            bytes: blob,
            pos: entry.sections_pos,
        };
        let nsect = r.u32_()?;
        for _ in 0..nsect {
            let rva = r.u32_()?;
            let size = r.u32_()?;
            let final_protect = r.u32_()?;
            if (rva as u64) < lo || rva as u64 + size as u64 > hi {
                return Err(BindError::BadSection);
            }
            let mut old: bun_windows_sys::externs::DWORD = 0;
            // SAFETY: [base + rva, base + rva + size) lies inside the
            // merged addon span (checked above), which the loader mapped
            // as part of bun.exe's image.
            if unsafe {
                kernel32::VirtualProtect(
                    base.add(rva as usize).cast(),
                    size as usize,
                    final_protect,
                    &raw mut old,
                )
            } == 0
            {
                return Err(BindError::VirtualProtectFailed);
            }
        }
    }
    // SAFETY: flushing the instruction cache over the merged addon span.
    unsafe {
        kernel32::FlushInstructionCache(
            kernel32::GetCurrentProcess(),
            base.add(entry.rva_base as usize).cast(),
            entry.image_size as usize,
        );
    }

    // DllMain(DLL_PROCESS_ATTACH) runs the addon's CRT init and static constructors.
    if entry.entry_point != 0 {
        if (entry.entry_point as u64) < lo || (entry.entry_point as u64) >= hi {
            return Err(BindError::BadSection);
        }
        const DLL_PROCESS_ATTACH: u32 = 1;
        type DllMain = unsafe extern "system" fn(*mut c_void, u32, *mut c_void) -> i32;
        // entry_point is a bun-relative RVA (rebased at build time), so
        // the absolute address is a single add.
        //
        // SAFETY: entry_point lies inside the merged addon span
        // (checked above); the section was just re-protected and
        // flushed.
        let dll_main: DllMain =
            unsafe { core::mem::transmute(base.add(entry.entry_point as usize)) };
        // hinstDLL is bun.exe's own HMODULE; a merged addon has no module of its own.
        // SAFETY: calling the addon's DllMain exactly as the loader would.
        if unsafe { dll_main(base_h, DLL_PROCESS_ATTACH, core::ptr::null_mut()) } == 0 {
            return Err(BindError::DllMainFalse);
        }
    }

    let abs = |rva: u32| -> Result<*mut c_void, BindError> {
        if rva == 0 {
            return Ok(core::ptr::null_mut());
        }
        if (rva as u64) < lo || (rva as u64) >= hi {
            return Err(BindError::BadSection);
        }
        // SAFETY: rva lies inside the merged addon span (checked above).
        Ok(unsafe { base.add(rva as usize).cast() })
    };
    Ok(Resolved {
        napi_register_module_v1: abs(entry.export_register)?,
        node_api_module_get_api_version_v1: abs(entry.export_api_version)?,
        // rva_base is lo itself; no span check needed.
        // SAFETY: rva_base is where the loader mapped the addon's RVA 0.
        handle_token: unsafe { base.add(entry.rva_base as usize).cast() },
        did_bind: false,
    })
}

fn apply_relocs(base: *mut u8, entry: &Entry, delta: i64) -> Result<(), BindError> {
    let blocks = entry.relocs;
    let lo = entry.rva_base as u64;
    let hi = lo + entry.image_size as u64;
    let mut off: usize = 0;
    while off + 8 <= blocks.len() {
        let page_rva = u32::from_le_bytes(
            blocks[off..off + 4]
                .try_into()
                .expect("infallible: size matches"),
        );
        let block_size = u32::from_le_bytes(
            blocks[off + 4..off + 8]
                .try_into()
                .expect("infallible: size matches"),
        );
        if block_size < 8 || off + block_size as usize > blocks.len() {
            return Err(BindError::BadReloc);
        }
        let n = (block_size as usize - 8) / 2;
        for i in 0..n {
            let e = u16::from_le_bytes(
                blocks[off + 8 + i * 2..off + 10 + i * 2]
                    .try_into()
                    .expect("infallible: size matches"),
            );
            let typ = e >> 12;
            if typ == 0 {
                continue; // IMAGE_REL_BASED_ABSOLUTE padding
            }
            if typ != 10 {
                return Err(BindError::BadReloc); // only DIR64 on PE32+
            }
            let slot_rva = page_rva as u64 + (e & 0x0FFF) as u64;
            if slot_rva < lo || slot_rva + 8 > hi {
                return Err(BindError::BadReloc);
            }
            // SAFETY: slot lies inside the merged addon span (checked
            // above), which is currently mapped RW.
            unsafe {
                let slot = base.add(slot_rva as usize).cast::<[u8; 8]>();
                let old = u64::from_le_bytes(slot.read());
                slot.write(((old as i64).wrapping_add(delta) as u64).to_le_bytes());
            }
        }
        off += block_size as usize;
    }
    Ok(())
}

fn bind_imports(base: *mut u8, entry: &Entry, self_h: *mut c_void) -> Result<(), BindError> {
    let blob = blob().ok_or(BindError::NoBlob)?;
    let mut r = Reader {
        bytes: blob,
        pos: entry.imports_pos,
    };
    let lo = entry.rva_base as u64;
    let hi = lo + entry.image_size as u64;
    let nlib = r.u32_()?;
    let mut name_buf = [0u8; 512];
    for _ in 0..nlib {
        let dll_name = r.str_()?;
        let is_host = r.u8_()? != 0;
        let nent = r.u32_()?;

        let module: *mut c_void = if is_host {
            self_h
        } else {
            if dll_name.len() >= name_buf.len() {
                return Err(BindError::ImportNameTooLong);
            }
            name_buf[..dll_name.len()].copy_from_slice(dll_name);
            name_buf[dll_name.len()] = 0;
            // Dependencies an addon declares are ones LoadLibrary would
            // have pulled in for it; doing so here has the same effect and
            // the same lifetime (process).
            // SAFETY: name_buf is NUL-terminated ASCII from the blob.
            let m = unsafe { bun_windows_sys::externs::LoadLibraryA(name_buf.as_ptr().cast()) };
            if m.is_null() {
                return Err(BindError::ImportDllMissing);
            }
            m
        };

        for _ in 0..nent {
            let iat_rva = r.u32_()?;
            let ordinal = r.u16_()?;
            let sym = r.str_()?;
            let addr: *mut c_void = if sym.is_empty() {
                // SAFETY: ordinal import — GetProcAddress accepts the
                // ordinal in the low word of the name pointer.
                unsafe {
                    bun_windows_sys::externs::GetProcAddress(
                        module,
                        ordinal as usize as *const core::ffi::c_char,
                    )
                }
            } else if sym == b"RtlPcToFileHeader" {
                let shim: PcToFileHeader = pc_to_file_header;
                shim as usize as *mut c_void
            } else {
                if sym.len() >= name_buf.len() {
                    return Err(BindError::ImportNameTooLong);
                }
                name_buf[..sym.len()].copy_from_slice(sym);
                name_buf[sym.len()] = 0;
                // SAFETY: name_buf is NUL-terminated ASCII from the blob.
                unsafe {
                    bun_windows_sys::externs::GetProcAddress(module, name_buf.as_ptr().cast())
                }
            };
            if addr.is_null() {
                return Err(BindError::ImportSymbolMissing);
            }
            if (iat_rva as u64) < lo || iat_rva as u64 + size_of::<usize>() as u64 > hi {
                return Err(BindError::BadImport);
            }
            // SAFETY: the IAT slot lies inside the merged addon span
            // (checked above), which is currently mapped RW.
            unsafe {
                base.add(iat_rva as usize)
                    .cast::<usize>()
                    .write_unaligned(addr as usize);
            }
        }
    }
    Ok(())
}

/// C ABI entry for BunProcess.cpp; `path_ptr[..path_len]` and `out` must be valid.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__initLinkedNodeModule(
    path_ptr: *const u8,
    path_len: usize,
    out: *mut Resolved,
) -> bool {
    // SAFETY: hook contract above.
    let path = unsafe { core::slice::from_raw_parts(path_ptr, path_len) };
    // SAFETY: out is a valid pointer per the hook contract.
    unsafe {
        *out = Resolved::empty();
    }

    if bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_PE_ADDON_LINK::get() == Some(true)
    {
        return false;
    }

    LOCK.lock();
    // SAFETY: LOCK is held (see the `TableCell` Sync impl); this is the
    // only place a `&mut Table` is ever formed, and it does not outlive
    // the locked region (the `did_bind` path returns without touching
    // `table` again; the unlock happens in Bun__linkedNodeModuleUnlock).
    let table = unsafe { &mut *TABLE.0.get() };

    ensure_loaded(table);

    let Some(idx) = lookup(table, path) else {
        LOCK.unlock();
        return false;
    };
    match table.entries[idx].state {
        State::Bound(resolved) => {
            // SAFETY: out is valid per the hook contract.
            unsafe {
                *out = resolved;
            }
            // did_bind stays false — lock releases before return.
            LOCK.unlock();
            return true;
        }
        State::Failed => {
            LOCK.unlock();
            return false;
        }
        State::Unbound => {}
    }
    match bind(&table.entries[idx]) {
        Ok(resolved) => {
            table.entries[idx].state = State::Bound(resolved);
            // SAFETY: out is valid per the hook contract.
            unsafe {
                *out = resolved;
                (*out).did_bind = true;
            }
            // LOCK stays held; see `Resolved::did_bind`.
            true
        }
        Err(err) => {
            scoped_log!(
                LinkedNodeModule,
                "linked-addon bind failed for {}: {:?}; falling back to temp-file LoadLibrary",
                bstr::BStr::new(path),
                err
            );
            table.entries[idx].state = State::Failed;
            LOCK.unlock();
            false
        }
    }
}

/// Releases the lock `Bun__initLinkedNodeModule` leaves held when `did_bind` is true.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__linkedNodeModuleUnlock() {
    LOCK.unlock();
}

/// The leading fields of DISPATCHER_CONTEXT, which x64 and ARM64 lay out identically.
#[repr(C)]
pub struct DispatcherContext {
    control_pc: u64,
    image_base: u64,
    function_entry: *mut u32,
}

type ExceptionRoutine =
    unsafe extern "system" fn(*mut c_void, *mut c_void, *mut c_void, *mut DispatcherContext) -> i32;

/// Words in an exception-directory entry: x64 RUNTIME_FUNCTION or ARM64's begin + unwind pair.
const FUNCTION_ENTRY_WORDS: usize = if cfg!(target_arch = "aarch64") { 2 } else { 3 };

/// One addon's entry in the fixed-size index at the start of the blob (`pe::serialize_linked_addons`).
/// Read without `LOCK`: the blob is immutable, and these readers run inside exception dispatch.
struct IndexEntry {
    rva_base: u32,
    /// Bytes of `.bnN` the addon occupies, image plus unwind appendix.
    section_size: u32,
    handlers_pos: usize,
    handler_count: usize,
}

impl IndexEntry {
    fn contains(&self, rva: u32) -> bool {
        rva >= self.rva_base && rva - self.rva_base < self.section_size
    }
}

/// Calls `f` for each addon until it returns `Some`.
fn find_in_index<T>(blob: &[u8], mut f: impl FnMut(&IndexEntry) -> Option<T>) -> Option<T> {
    let mut r = Reader {
        bytes: blob,
        pos: 0,
    };
    if r.u32_().ok()? != LINKED_MAGIC || r.u32_().ok()? != LINKED_VERSION {
        return None;
    }
    let count = r.u32_().ok()?;
    for _ in 0..count {
        let entry = IndexEntry {
            rva_base: r.u32_().ok()?,
            section_size: r.u32_().ok()?,
            handlers_pos: r.u32_().ok()? as usize,
            handler_count: r.u32_().ok()? as usize,
        };
        if let Some(found) = f(&entry) {
            return Some(found);
        }
    }
    None
}

struct Redirect {
    rva_base: u32,
    /// bun.exe RVA of the addon's own handler.
    handler: u32,
    /// Addon RVA of the record to present to it (`pe::HandlerRedirect::view`).
    view: u32,
}

/// Finds the handler the build displaced from the unwind info at `unwind_info` (a bun.exe RVA).
fn find_redirect(unwind_info: u32) -> Option<Redirect> {
    let blob = blob()?;
    find_in_index(blob, |addon| {
        if !addon.contains(unwind_info) {
            return None;
        }
        let entry_at = |index: usize| -> Option<(u32, u32, u32)> {
            let mut entry = Reader {
                bytes: blob,
                pos: addon
                    .handlers_pos
                    .checked_add(index.checked_mul(LINKED_HANDLER_ENTRY_SIZE)?)?,
            };
            Some((entry.u32_().ok()?, entry.u32_().ok()?, entry.u32_().ok()?))
        };
        let (mut lo, mut hi) = (0, addon.handler_count);
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            let (key, handler, view) = entry_at(mid)?;
            match key.cmp(&unwind_info) {
                core::cmp::Ordering::Equal => {
                    let valid = addon.contains(handler) && view < addon.section_size;
                    return valid.then_some(Redirect {
                        rva_base: addon.rva_base,
                        handler,
                        view,
                    });
                }
                core::cmp::Ordering::Less => lo = mid + 1,
                core::cmp::Ordering::Greater => hi = mid,
            }
        }
        None
    })
}

type PcToFileHeader = unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> *mut c_void;

/// Bound in place of a merged addon's `RtlPcToFileHeader` import (see the module docs): reports
/// the addon's base for a pc inside a merged addon and forwards every other pc to the real one.
unsafe extern "system" fn pc_to_file_header(
    pc: *mut c_void,
    base_of_image: *mut *mut c_void,
) -> *mut c_void {
    // SAFETY: kernel32 call with null (self) module name.
    let exe_base = unsafe { kernel32::GetModuleHandleW(core::ptr::null()) } as usize;
    let merged = blob().and_then(|blob| {
        find_in_index(blob, |addon| {
            let addon_base = exe_base.checked_add(addon.rva_base as usize)?;
            let offset = (pc as usize).checked_sub(addon_base)?;
            (offset < addon.section_size as usize).then_some(addon_base as *mut c_void)
        })
    });
    match merged {
        Some(base) => {
            // SAFETY: callers pass a valid out-pointer, as the real function requires too.
            unsafe { *base_of_image = base };
            base
        }
        // SAFETY: forwarding the caller's arguments unchanged.
        None => unsafe { kernel32::RtlPcToFileHeader(pc, base_of_image) },
    }
}

/// The exception handler the build installed in every merged unwind info (see `pe.rs`). Forwards to
/// the handler it displaced, with `ImageBase` and `FunctionEntry` expressed in the addon's own
/// terms as they would be under `LoadLibrary`: the handler's scope tables hold addon-relative RVAs.
/// Runs during dispatch on any thread, possibly with `LOCK` held, so it reads only the blob.
#[unsafe(no_mangle)]
pub unsafe extern "system" fn Bun__linkedAddonExceptionHandler(
    record: *mut c_void,
    frame: *mut c_void,
    context: *mut c_void,
    dispatcher: *mut DispatcherContext,
) -> i32 {
    // SAFETY: Windows passes a valid DISPATCHER_CONTEXT whose FunctionEntry holds
    // FUNCTION_ENTRY_WORDS words of RVAs relative to its ImageBase.
    let (os_image_base, os_entry) =
        unsafe { ((*dispatcher).image_base, (*dispatcher).function_entry) };
    let mut entry = [0u32; FUNCTION_ENTRY_WORDS];
    for (i, word) in entry.iter_mut().enumerate() {
        // SAFETY: as above.
        *word = unsafe { os_entry.add(i).read_unaligned() };
    }
    // SAFETY: kernel32 call with null (self) module name.
    let exe_base = unsafe { kernel32::GetModuleHandleW(core::ptr::null()) } as u64;
    // ImageBase is bun.exe's on a fresh dispatch. When an unwind collides with one in progress,
    // Windows re-dispatches with a copy of the context an earlier call here had already rewritten.
    let unwind_info = os_image_base
        .wrapping_add(entry[FUNCTION_ENTRY_WORDS - 1] as u64)
        .wrapping_sub(exe_base);
    let Some(redirect) = u32::try_from(unwind_info).ok().and_then(find_redirect) else {
        return ExceptionContinueSearch;
    };
    // SAFETY: `handler` lies inside the merged addon's span (checked by find_redirect), where the
    // build recorded the addon's original handler and bind() has since restored the protections.
    let handler: ExceptionRoutine =
        unsafe { core::mem::transmute(exe_base as usize + redirect.handler as usize) };
    let addon_base = exe_base + redirect.rva_base as u64;
    if os_image_base == addon_base {
        // SAFETY: the re-dispatched context is already in the addon's terms; forward it unchanged.
        return unsafe { handler(record, frame, context, dispatcher) };
    }
    // The code range becomes addon-relative; the unwind info is whichever record the build chose
    // to present (a chained record's addon-relative copy, otherwise the record itself).
    for word in &mut entry[..FUNCTION_ENTRY_WORDS - 1] {
        *word = word.wrapping_sub(redirect.rva_base);
    }
    entry[FUNCTION_ENTRY_WORDS - 1] = redirect.view;
    // SAFETY: `dispatcher` is valid for the duration of this call; `entry` outlives the handler call
    // and is unhooked again before it goes out of scope.
    unsafe {
        (*dispatcher).image_base = addon_base;
        (*dispatcher).function_entry = entry.as_mut_ptr();
        let disposition = handler(record, frame, context, dispatcher);
        (*dispatcher).image_base = os_image_base;
        (*dispatcher).function_entry = os_entry;
        disposition
    }
}
