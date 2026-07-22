//! Runtime side of the `.node` static-merge performed by
//! `pe::PEFile::add_linked_addon` during `bun build --compile` on Windows.
//!
//! The build step lays each addon out as a loader-mapped RW section inside
//! bun.exe, fixes absolute addresses up for bun.exe's preferred image base,
//! and writes a `.bunL` section describing, per addon: where it lives, its
//! relocation blocks (page RVAs already bun-relative), its import table,
//! its `.pdata`, and the export RVAs `process.dlopen` needs.
//!
//! At `process.dlopen("B:/~BUN/…")` we look the path up here and, if it was
//! merged, finish the link in-process:
//!
//!   1. add the ASLR delta (`GetModuleHandle(NULL) - preferred_base`) to
//!      every DIR64 relocation — the section is RW, so plain stores
//!   2. bind the IAT: host imports (`node.exe` etc.) against our own
//!      export table, everything else via `LoadLibraryA`+`GetProcAddress`
//!   3. `VirtualProtect` each original-section range to the protection the
//!      addon shipped with, then `FlushInstructionCache`
//!   4. `RtlAddFunctionTable` so SEH and stack unwinding through the addon
//!      work
//!   5. call the addon's `DllMain(DLL_PROCESS_ATTACH)` so its CRT and static
//!      constructors run — exactly what `LoadLibrary` would have triggered
//!
//! and hand the resolved `napi_register_module_v1` /
//! `node_api_module_get_api_version_v1` / `BUN_PLUGIN_NAME` pointers back to
//! `BunProcess.cpp` so the rest of the dlopen flow is unchanged.
//!
//! Addons with real `__declspec(thread)` storage (a nonzero TLS template)
//! are never merged: reserving a slot in the loader's private
//! `LdrpTlsBitmap` and growing every existing thread's
//! `ThreadLocalStoragePointer` array has no userspace API, and faking it
//! risks index collisions with later `LoadLibrary` calls. The MSVC CRT's
//! callback-only TLS directory (empty template — present in essentially
//! every node-gyp addon via `tlssup.obj`) needs no index and is merged
//! with the directory ignored.
//!
//! Addons that import `_CxxThrowException` from `VCRUNTIME140.dll`
//! (i.e. `/MD`-linked addons containing a C++ `throw`, notably
//! node-addon-api with `NAPI_CPP_EXCEPTIONS`) are likewise never
//! merged: `_CxxThrowException` calls `RtlPcToFileHeader(pThrowInfo, …)`
//! to find the image base that the 32-bit `_ThrowInfo`/`_CatchableType`
//! RVAs are relative to, and `RtlPcToFileHeader` only walks `PEB->Ldr`
//! (not `RtlAddFunctionTable` registrations), so it returns bun.exe's
//! base instead of the addon's — the catch-side type match then walks
//! garbage and terminates. SEH `__try`/`__except` and plain unwinding
//! through addon frames are unaffected; only C++ `throw`/`catch` type
//! matching breaks, so the gate is on the throw symbol, not the frame
//! handler. A `/MT`-linked addon has `_CxxThrowException` statically
//! linked into its own `.text` and is not caught by this import-table
//! gate; such addons should set `BUN_FEATURE_FLAG_DISABLE_PE_ADDON_LINK=1`
//! if they throw (node-gyp defaults to `/MD`, so this is rare).
//!
//! Both classes of addon go through the tempfile fallback where the real
//! loader handles TLS and gives `RtlPcToFileHeader` a proper
//! `LDR_DATA_TABLE_ENTRY`.
//!
//! Any failure (bad blob, missing import, `DllMain` returning FALSE)
//! returns false and the caller falls back to writing a temp file and
//! `LoadLibraryExW`ing it, so behaviour never regresses.

#![cfg(windows)]

use core::ffi::c_void;
use core::mem::size_of;

use bun_core::scoped_log;
use bun_exe_format::pe::{
    Bun__getLinkedAddonsPEData, Bun__getLinkedAddonsPELength, LINKED_MAGIC, LINKED_VERSION,
};
use bun_threading::Guarded;
use bun_windows_sys::externs::kernel32;

bun_core::declare_scope!(LinkedNodeModule, visible);

/// What `process.dlopen` needs back once an addon is bound. Pointers are
/// absolute (image base already applied); zero means "addon didn't export
/// it". Layout mirrors `Bun__LinkedNodeModuleResolved` in BunProcess.cpp.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct Resolved {
    pub napi_register_module_v1: *mut c_void,
    pub node_api_module_get_api_version_v1: *mut c_void,
    pub bun_plugin_name: *mut c_void,
    /// A per-addon identity for the C++ side's `DLHandleMap` /
    /// `napiDlopenHandle` bookkeeping. There is no real `HMODULE` for a
    /// merged addon (it is not in the loader's module list), so we use
    /// the address where its RVA 0 landed — unique per addon, stable for
    /// the process, and a valid in-image pointer. Never passed to a
    /// Win32 API that expects an actual module handle.
    pub handle_token: *mut c_void,
    /// True when this call to `init()` is the one that ran `bind()`
    /// (and therefore `DllMain`), in which case `init()` returns with
    /// the lock *still held* so the C++ caller can publish to
    /// `DLHandleMap` before a concurrent Worker on the cached-hit
    /// path reaches `DLHandleMap.get()`. The C++ side MUST call
    /// `Bun__linkedNodeModuleUnlock()` exactly once before any
    /// re-entrant user code (`executePendingNapiModule`,
    /// `napi_register_module_v1`). False on the cached-hit / failure
    /// paths, where `init()` already released the lock.
    pub did_bind: bool,
}

impl Resolved {
    const fn empty() -> Resolved {
        Resolved {
            napi_register_module_v1: core::ptr::null_mut(),
            node_api_module_get_api_version_v1: core::ptr::null_mut(),
            bun_plugin_name: core::ptr::null_mut(),
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
    BadPdata,
    NoBlob,
    NoModuleHandle,
    ImportNameTooLong,
    ImportDllMissing,
    ImportSymbolMissing,
    VirtualProtectFailed,
    RtlAddFunctionTableFailed,
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
    /// `bind()` irreversibly mutates the merged section (relocs, IAT,
    /// page protections, `RtlAddFunctionTable`, `DllMain`). It must run
    /// at most once: a second attempt would double-apply the ASLR delta
    /// or fault writing to a page that has already been flipped to RX.
    /// `Failed` is therefore terminal — later calls go straight to the
    /// tempfile fallback.
    Failed,
}

/// Parsed view over one addon's entry in the `.bunL` blob. Slices borrow
/// from the blob (which is loader-mapped for the process lifetime), so no
/// allocation and no freeing.
struct Entry {
    name: &'static [u8],
    rva_base: u32,
    image_size: u32,
    entry_point: u32,
    preferred_base: u64,
    pdata_rva: u32,
    pdata_count: u32,
    export_register: u32,
    export_api_version: u32,
    export_plugin_name: u32,
    /// Offset into the blob where this addon's section list begins
    /// (`n_sections` u32 followed by `SECTION_INFO_SIZE`-byte records).
    sections_pos: usize,
    relocs: &'static [u8],
    /// Offset into the blob where this addon's import list begins, so we
    /// can stream it during bind instead of materialising a nested array.
    imports_pos: usize,
    state: State,
}

struct Table {
    loaded: bool,
    /// Usually 0 or 1 addons, a handful at most — linear scan.
    entries: Vec<Entry>,
}

/// `process.dlopen` is reachable from Workers on separate OS threads.
/// The previous tempfile path serialised on the Windows loader lock; this
/// path has no such lock, so we take our own around the lazy blob parse
/// and the check-and-bind. Uncontended after first load.
///
/// `raw_mutex()` is used (not the RAII guard) because the `did_bind`
/// hand-off deliberately leaves the lock held across the FFI return;
/// see `Bun__initLinkedNodeModule`.
static TABLE: Guarded<Table> = Guarded::new(Table {
    loaded: false,
    entries: Vec::new(),
});

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

/// Caller must hold `TABLE`'s mutex.
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
    // No up-front reserve: `count` comes straight from the blob, and a
    // bit-rotted value like 0xFFFF_FFFF would make `Vec::reserve` request
    // hundreds of GB and abort on allocation failure instead of falling
    // back to the tempfile path via `Truncated` below. The list is a
    // handful of entries; incremental growth is fine.
    for _ in 0..count {
        let name = r.str_()?;
        let rva_base = r.u32_()?;
        let image_size = r.u32_()?;
        let entry_point = r.u32_()?;
        let preferred_base = r.u64_()?;
        let pdata_rva = r.u32_()?;
        let pdata_count = r.u32_()?;
        let export_register = r.u32_()?;
        let export_api_version = r.u32_()?;
        let export_plugin_name = r.u32_()?;
        let sections_pos = r.pos;
        let nsect = r.u32_()?;
        // Widen before multiplying so a hostile nsect cannot wrap the
        // u32 product past the bounds check and leave the section list
        // pointing at a huge span that bind() then walks.
        let sect_bytes = SECTION_INFO_SIZE
            .checked_mul(nsect as usize)
            .ok_or(BindError::Truncated)?;
        r.skip(sect_bytes)?;
        let relocs = r.str_()?;
        let imports_pos = r.pos;
        // Walk imports once to advance the cursor past them for the next
        // addon; the actual bind re-walks from imports_pos.
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
            pdata_rva,
            pdata_count,
            export_register,
            export_api_version,
            export_plugin_name,
            sections_pos,
            relocs,
            imports_pos,
            state: State::Unbound,
        });
    }
    Ok(())
}

/// Caller must hold `TABLE`'s mutex. Returns an index to avoid holding a
/// `&mut Entry` borrow across `bind()`.
fn lookup(table: &Table, path: &[u8]) -> Option<usize> {
    // Build-time keys are always forward-slash `B:/~BUN` paths (to_bytes
    // uses the public prefix), but Windows callers may hand us either
    // separator. Normalise here rather than at every call site.
    if let Some(i) = table.entries.iter().position(|e| e.name == path) {
        return Some(i);
    }
    if path.contains(&b'\\') {
        // PathBuffer is ~64KB on Windows; take it from the pool rather
        // than the stack.
        let mut buf = bun_paths::path_buffer_pool::get();
        if path.len() > buf.len() {
            return None;
        }
        buf[..path.len()].copy_from_slice(path);
        for c in buf[..path.len()].iter_mut() {
            if *c == b'\\' {
                *c = b'/';
            }
        }
        let normalized = &buf[..path.len()];
        return table.entries.iter().position(|e| e.name == normalized);
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

    // ASLR delta: the merge fixed absolutes up for `preferred_base`, the
    // loader actually put us at `base_addr`, so every DIR64 slot is off by
    // exactly this much. Section is RW so these are plain stores.
    let delta = (base_addr as i64).wrapping_sub(entry.preferred_base as i64);
    if delta != 0 {
        apply_relocs(base, entry, delta)?;
    }

    // Bind imports. Host imports resolve against our own export table —
    // bun.exe already exports the full napi_* / uv_* surface via
    // `src/symbols.def` — so the addon's delay-load hook is unnecessary.
    bind_imports(base, entry, base_h)?;

    // Now that code bytes are final, restore real protections. Same
    // corrupted-.bunL defence as apply_relocs/bind_imports: s.rva and
    // s.size come straight from the blob, so bound them to the merged
    // addon before handing them to VirtualProtect against the live
    // bun.exe image.
    let lo = entry.rva_base as u64;
    let hi = lo + entry.image_size as u64;
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
                    &mut old,
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

    // Register the addon's exception tables with its *own* image base.
    // RUNTIME_FUNCTION and the UNWIND_INFO structures they reference keep
    // the addon-relative RVAs they were built with, so BaseAddress has to
    // be where the addon's RVA 0 actually landed — not the exe's base —
    // or chained unwinds and language-specific handlers resolve to the
    // wrong place.
    if entry.pdata_count > 0 {
        // Same corrupted-.bunL defence as the VirtualProtect loop
        // above: pdata_rva/pdata_count come straight from the blob.
        // RtlAddFunctionTable does not validate the span, and a
        // garbage registration surfaces non-locally (during the next
        // SEH/C++ unwind), so fail closed to the tempfile path.
        let pdata_entry_size: u64 = if cfg!(target_arch = "aarch64") { 8 } else { 12 };
        if (entry.pdata_rva as u64) < lo
            || entry.pdata_rva as u64 + entry.pdata_count as u64 * pdata_entry_size > hi
        {
            return Err(BindError::BadPdata);
        }
        // SAFETY: the function table points at `pdata_count` entries
        // inside the merged addon span (checked above); BaseAddress is
        // where the addon's RVA 0 landed.
        if unsafe {
            kernel32::RtlAddFunctionTable(
                base.add(entry.pdata_rva as usize).cast(),
                entry.pdata_count,
                (base_addr + entry.rva_base as usize) as u64,
            )
        } == 0
        {
            // Without .pdata registered, any SEH / C++ exception inside
            // the addon would unwind through frames the OS cannot
            // describe. The tempfile path gets it via the loader, so
            // fall back rather than run with broken unwinding.
            return Err(BindError::RtlAddFunctionTableFailed);
        }
    }

    // Run CRT init + static constructors. Passing the exe's HMODULE as
    // hinstDLL is a deliberate lie: there's no separate module for the
    // addon in the loader's list, and `_DllMainCRTStartup` only uses it
    // for `DisableThreadLibraryCalls`/`GetModuleFileName`-style queries,
    // which returning the exe for is at worst what the tmpfile path gave
    // anyway (a meaningless path).
    //
    // DLL_THREAD_ATTACH / DLL_THREAD_DETACH are never delivered to a
    // merged addon: it is not in the loader's module list, so
    // LdrpInitializeThread / LdrShutdownThread never dispatch to it.
    // For /MD node-gyp addons this is inert — the CRT itself is loader-
    // tracked and uses FLS for per-thread state, the default DllMain has
    // no THREAD_ATTACH work, and the nonzero-TLS-template gate already
    // routes anything with real __declspec(thread) storage to the
    // fallback. An addon with a hand-written DllMain THREAD_ATTACH
    // handler should set BUN_FEATURE_FLAG_DISABLE_PE_ADDON_LINK=1.
    if entry.entry_point != 0 {
        // Same corrupted-.bunL defence as the sibling span checks
        // above. Unlike a write (immediate AV on a bad page), a *call*
        // into bun.exe's own RX .text can return without faulting and
        // make bind() succeed with the real DllMain (CRT init, static
        // ctors, napi_module_register) never having run — a non-local
        // failure. Fail closed to the tempfile path instead.
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
        // SAFETY: calling the addon's DllMain exactly as the loader would.
        if unsafe { dll_main(base_h, DLL_PROCESS_ATTACH, core::ptr::null_mut()) } == 0 {
            // Addon refused attach. Treat like a failed LoadLibrary — fall
            // back to the tempfile path rather than surfacing a half-bound
            // module.
            return Err(BindError::DllMainFalse);
        }
    }

    // Same corrupted-.bunL defence as entry_point above: the export
    // RVAs are cast to function pointers and *called* by
    // BunProcess.cpp (napi_register_module_v1,
    // node_api_module_get_api_version_v1), so a bit-rotted value
    // pointing into bun.exe's own RX .text could execute whatever is
    // there and return garbage instead of falling back.
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
        bun_plugin_name: abs(entry.export_plugin_name)?,
        // rva_base is lo itself; no span check needed.
        // SAFETY: rva_base is where the loader mapped the addon's RVA 0.
        handle_token: unsafe { base.add(entry.rva_base as usize).cast() },
        did_bind: false,
    })
}

fn apply_relocs(base: *mut u8, entry: &Entry, delta: i64) -> Result<(), BindError> {
    let blocks = entry.relocs;
    // The blob was produced by the same bun build that emitted this
    // exe, so in a well-formed image every page RVA already lies in
    // [rva_base, rva_base + image_size). Verifying it here costs
    // nothing and means a truncated/corrupted .bunL section cannot
    // make us scribble over unrelated bun.exe memory before falling
    // back to the tempfile path.
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
                let slot = base.add(slot_rva as usize).cast::<u64>();
                let old = slot.read_unaligned();
                slot.write_unaligned((old as i64).wrapping_add(delta) as u64);
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
    // Same corrupted-.bunL defence as apply_relocs: every IAT slot we
    // write must resolve into the merged addon, or a bit-rotted blob
    // could make us scribble into unrelated bun.exe memory instead of
    // falling back to the tempfile path.
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

/// C ABI entry for `BunProcess.cpp`. `path_ptr[0..path_len]` is the
/// WTF-string the user passed to `process.dlopen`, already stripped of any
/// `file://` prefix.
///
/// When this call is the one that ran `bind()` (`out.did_bind == true`),
/// the table mutex is intentionally left held across the return: the C++
/// caller first publishes the addon's self-registration to the
/// process-global `DLHandleMap`, then calls
/// `Bun__linkedNodeModuleUnlock()`. A concurrent Worker blocked here on
/// the cached-hit path therefore cannot reach `DLHandleMap.get()` until
/// that publish has happened. Without this hand-off the loser could
/// observe an empty map (self-registration's `napi_module_register`
/// bumped only the *binder's* threadlocal `napiModuleRegisterCallCount`)
/// and spuriously throw "napi_register_module_v1 not found".
///
/// # Safety
/// `path_ptr[0..path_len]` must be valid UTF-8-ish bytes; `out` must be a
/// valid `Bun__LinkedNodeModuleResolved*` (C++ ABI, BunProcess.cpp).
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

    let mutex = TABLE.raw_mutex();
    mutex.lock();
    // SAFETY: mutex held; this is the Guarded's protected value.
    let table = unsafe { &mut *TABLE.unsynchronized_value.get() };

    ensure_loaded(table);

    let Some(idx) = lookup(table, path) else {
        mutex.unlock();
        return false;
    };
    match table.entries[idx].state {
        State::Bound(resolved) => {
            // SAFETY: out is valid per the hook contract.
            unsafe {
                *out = resolved;
            }
            // did_bind stays false — lock releases before return.
            mutex.unlock();
            return true;
        }
        // A previous attempt already mutated the section; do not touch
        // it again. The tempfile fallback uses the pristine raw bytes
        // from `.bun`, so behaviour is exactly as if the merge had
        // never happened.
        State::Failed => {
            mutex.unlock();
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
            // Leave the lock held; the C++ caller releases it via
            // Bun__linkedNodeModuleUnlock() once DLHandleMap is populated
            // and before any re-entrant user code runs.
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
            mutex.unlock();
            false
        }
    }
}

/// Release the lock that `Bun__initLinkedNodeModule` left held on the
/// `did_bind == true` path. Called from `Process_functionDlopen` after
/// `DLHandleMap.add()` and before `executePendingNapiModule` /
/// `napi_register_module_v1` (which are re-entrant into init).
#[unsafe(no_mangle)]
pub extern "C" fn Bun__linkedNodeModuleUnlock() {
    TABLE.raw_mutex().unlock();
}
