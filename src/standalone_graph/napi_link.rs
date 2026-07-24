//! Stub native-addon loaders for standalone (`bun build --compile`) executables.
//!
//! The bun binary carries a small fixed table of "link slots" in its own
//! section (`__DATA,__bun_napi_lnk` on Mach-O, `.bun_napi_link` on ELF,
//! `.bnapi` on PE; defined in `c-bindings.cpp`). Each slot is 256 bytes:
//! `{ magic, offset, length, hash, path[224] }`. A post-build linker can
//! binary-patch a slot in place and append the `.node` image into the
//! `__BUN,__bun` / `.bun` section *after* the standalone module graph
//! payload, without re-running the bundler.
//!
//! At runtime, when `process.dlopen` sees a `/$bunfs/...` path, it consults
//! this table before falling back to the per-launch tmpfile extraction used
//! for bundler-embedded addons. A matching slot is loaded entirely from
//! memory: on macOS via `NSCreateObjectFileImageFromMemory` + `NSLinkModule`
//! (bun never writes a `.node` to disk), on Linux via
//! `memfd_create(MFD_EXEC)` + `dlopen("/proc/self/fd/N")`. Other platforms
//! return no handle; they also have no post-link patcher yet, so their slots
//! can never be populated.

use core::ffi::c_void;
use core::mem::size_of;
use core::sync::atomic::{AtomicPtr, Ordering};

use bun_exe_format::macho::{MachoError, MachoFile};

/// Mirrors `BunNapiLinkSlot` in `c-bindings.cpp`. Keep both at 256 bytes.
#[repr(C)]
pub struct Slot {
    pub magic: u64,
    pub offset: u64,
    pub length: u64,
    pub hash: u64,
    pub path: [u8; 224],
}

const _: () = assert!(
    size_of::<Slot>() == 256,
    "BunNapiLinkSlot must be 256 bytes so external patchers can index the table"
);

impl Slot {
    pub const COUNT: usize = 8;
    /// `"bunlink\0"` little-endian — the low 7 bytes are the signature, the
    /// high byte carries the slot index so patchers can locate slot N by
    /// scanning for `62 75 6E 6C 69 6E 6B NN`.
    pub const MAGIC_BASE: u64 = 0x006B_6E69_6C6E_7562;

    pub fn is_used(&self) -> bool {
        self.offset != 0 && self.length != 0
    }

    pub fn index(&self) -> u32 {
        (self.magic >> 56) as u32
    }

    pub fn path_slice(&self) -> &[u8] {
        bun_core::slice_to_nul(&self.path)
    }

    pub fn is_valid(&self) -> bool {
        (self.magic & 0x00FF_FFFF_FFFF_FFFF) == Self::MAGIC_BASE
    }
}

unsafe extern "C" {
    fn Bun__getNapiLinkSlots() -> *const Slot;
    safe fn Bun__getNapiLinkSlotCount() -> u32;
    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
    fn Bun__getNapiLinkSectionBase() -> *const u8;
}

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn Bun__darwinLoadMachOFromMemory(
        bytes: *const u8,
        len: usize,
        name: *const core::ffi::c_char,
    ) -> *mut c_void;
}

pub fn slots() -> &'static [Slot] {
    let count = Bun__getNapiLinkSlotCount() as usize;
    // SAFETY: the table is a static array of `count` slots in the binary's
    // own data section; it lives for the process lifetime.
    unsafe { core::slice::from_raw_parts(Bun__getNapiLinkSlots(), count) }
}

/// Find the slot whose virtual path matches `input_path` exactly.
pub fn find_slot(input_path: &[u8]) -> Option<&'static Slot> {
    slots()
        .iter()
        .find(|s| s.is_valid() && s.is_used() && s.path_slice() == input_path)
}

/// Return the embedded `.node` bytes for `slot` as a slice pointing directly
/// into the mapped `__BUN,__bun` / `.bun` section. The memory lives for the
/// lifetime of the process.
#[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
fn slot_bytes(slot: &Slot) -> Option<&'static [u8]> {
    // SAFETY: base points at the start of the mapped standalone section; the
    // patcher wrote `offset`/`length` to describe a range inside it.
    unsafe {
        let base = Bun__getNapiLinkSectionBase();
        if base.is_null() {
            return None;
        }
        Some(core::slice::from_raw_parts(
            base.add(slot.offset as usize),
            slot.length as usize,
        ))
    }
}

/// Cache of already-loaded slots so repeated `require()` of the same virtual
/// path returns the same module instance (via the `DLHandleMap` replay path
/// in `Process_functionDlopen`). Entries are written once and never freed —
/// native addons cannot be unloaded.
static LOADED_HANDLES: [AtomicPtr<c_void>; Slot::COUNT] =
    [const { AtomicPtr::new(core::ptr::null_mut()) }; Slot::COUNT];

/// Load the addon image stored in `slot` and return an opaque handle usable
/// by `process.dlopen` (an `NSModule` on macOS, a `dlopen()` handle on
/// Linux). Sets `is_ns_module` on macOS so the caller knows to use
/// `NSLookupSymbolInModule` instead of `dlsym()`.
fn load_slot_from_memory(slot: &Slot, is_ns_module: &mut bool) -> *mut c_void {
    *is_ns_module = false;
    let idx = slot.index() as usize;
    if idx < LOADED_HANDLES.len() {
        let cached = LOADED_HANDLES[idx].load(Ordering::Acquire);
        if !cached.is_null() {
            *is_ns_module = cfg!(target_os = "macos");
            return cached;
        }
    }

    let handle = load_slot_for_platform(slot, is_ns_module);

    if !handle.is_null() && idx < LOADED_HANDLES.len() {
        LOADED_HANDLES[idx].store(handle, Ordering::Release);
    }
    handle
}

#[cfg(target_os = "macos")]
fn load_slot_for_platform(slot: &Slot, is_ns_module: &mut bool) -> *mut c_void {
    let Some(bytes) = slot_bytes(slot) else {
        return core::ptr::null_mut();
    };
    // dyld uses this as the image's install name; keep it stable per slot so
    // stack traces and `NSNameOfModule` are recognisable.
    let mut name = [0u8; 32];
    use std::io::Write as _;
    let mut c = std::io::Cursor::new(&mut name[..]);
    let _ = write!(c, "bun:napi-slot-{}\0", slot.index());
    *is_ns_module = true;
    // SAFETY: `bytes` is a live slice into the mapped section; `name` is
    // NUL-terminated above.
    unsafe { Bun__darwinLoadMachOFromMemory(bytes.as_ptr(), bytes.len(), name.as_ptr().cast()) }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn load_slot_for_platform(slot: &Slot, _is_ns_module: &mut bool) -> *mut c_void {
    use bun_core::ZStr;
    use bun_sys::FdExt as _;

    if !bun_sys::can_use_memfd() {
        return core::ptr::null_mut();
    }
    let Some(bytes) = slot_bytes(slot) else {
        return core::ptr::null_mut();
    };
    let Ok(fd) = bun_sys::memfd_create(c"bun-napi-link", bun_sys::MemfdFlags::Executable) else {
        return core::ptr::null_mut();
    };
    // Pre-size so dlopen sees the full extent immediately.
    let _ = bun_sys::ftruncate(fd, bytes.len() as i64);
    let mut remain = bytes;
    while !remain.is_empty() {
        match bun_sys::write(fd, remain) {
            Ok(0) | Err(_) => {
                fd.close();
                return core::ptr::null_mut();
            }
            Ok(n) => remain = &remain[n..],
        }
    }
    // Leave the fd open so /proc/self/fd/N remains valid for dlopen and for
    // the lifetime of the loaded module.
    let mut path = [0u8; 48];
    use std::io::Write as _;
    let mut c = std::io::Cursor::new(&mut path[..]);
    let _ = write!(c, "/proc/self/fd/{}", fd.0);
    let len = c.position() as usize;
    // `path` was zero-initialized, so `path[len] == 0`.
    let zpath = ZStr::from_buf(&path, len);
    bun_sys::dlopen(zpath, bun_sys::RTLD::LAZY).unwrap_or(core::ptr::null_mut())
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "android")))]
fn load_slot_for_platform(_slot: &Slot, _is_ns_module: &mut bool) -> *mut c_void {
    // No in-memory loader here, and no post-link patcher can populate slots
    // for this executable format yet either. `Process_functionDlopen`
    // reports ERR_DLOPEN_FAILED for the (currently unreachable) case of a
    // populated slot.
    core::ptr::null_mut()
}

/// Called from `Process_functionDlopen` when the target starts with the
/// `/$bunfs/` prefix. If the path matches a populated slot, loads it from
/// memory and writes the resulting handle into `out_handle`. Returns true
/// whether or not the load succeeded — a true return with
/// `*out_handle == null` means "this path is a link slot but loading
/// failed", so the caller surfaces a dlopen error instead of falling through
/// to the module-graph tmpfile extractor (which wouldn't find it either).
///
/// # Safety
/// `path_ptr[..path_len]` must be readable; `out_handle` and
/// `out_is_ns_module` must be valid for writes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__tryLoadNapiLinkSlot(
    path_ptr: *const u8,
    path_len: usize,
    out_handle: *mut *mut c_void,
    out_is_ns_module: *mut bool,
) -> bool {
    // SAFETY: caller (BunProcess.cpp) passes the UTF-8 bytes of the dlopen
    // target and valid out-pointers.
    unsafe {
        *out_handle = core::ptr::null_mut();
        *out_is_ns_module = false;
        let path = core::slice::from_raw_parts(path_ptr, path_len);
        let Some(slot) = find_slot(path) else {
            return false;
        };
        let mut is_ns_module = false;
        *out_handle = load_slot_from_memory(slot, &mut is_ns_module);
        *out_is_ns_module = is_ns_module;
        true
    }
}

// ---------------------------------------------------------------------------
// Linker side: rewrite a standalone executable to carry an extra `.node`
// addon in one of the free slots. We locate the fixed slot table section,
// stamp a slot, append the addon bytes into the `__BUN,__bun` section (after
// the existing module-graph payload so `fromExecutable`'s trailer check
// still lands on the `"\n---- Bun! ----\n"` sentinel), and re-sign.
//
// Only Mach-O is wired up for now; ELF and PE need their own
// section-finders and payload-appenders which can reuse the same slot
// layout.
// ---------------------------------------------------------------------------

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum LinkError {
    UnsupportedExecutableFormat,
    NotStandaloneExecutable,
    NoFreeSlot,
    PathTooLong,
    SlotTableMissing,
}

const MH_MAGIC_64: u32 = 0xfeedfacf;

/// Append `addon_bytes` (a complete Mach-O `.node` image) to the standalone
/// executable `exe_bytes` and register it under `virtual_path` in the first
/// free link slot. Returns a freshly-allocated, re-signed Mach-O image.
pub fn link_into_macho(
    exe_bytes: &[u8],
    addon_bytes: &[u8],
    virtual_path: &[u8],
) -> Result<Vec<u8>, LinkError> {
    if exe_bytes.len() < 4 || u32::from_le_bytes(exe_bytes[0..4].try_into().unwrap()) != MH_MAGIC_64
    {
        return Err(LinkError::UnsupportedExecutableFormat);
    }
    if virtual_path.is_empty() || virtual_path.len() >= 224 {
        return Err(LinkError::PathTooLong);
    }

    let mut macho = MachoFile::init(exe_bytes, addon_bytes.len() + (16 * 1024))
        .map_err(|_| LinkError::UnsupportedExecutableFormat)?;

    // The existing `__BUN,__bun` section starts with a u64 length header
    // followed by the serialised module graph (ending in the trailer). We
    // preserve that header value so `StandaloneModuleGraph.fromExecutable`
    // keeps finding the trailer, and append the addon image after it.
    let bun_section = macho
        .find_section(b"__BUN", b"__bun")
        .ok_or(LinkError::NotStandaloneExecutable)?;
    if bun_section.size < size_of::<u64>() as u64 {
        return Err(LinkError::NotStandaloneExecutable);
    }

    let existing = &macho.data[bun_section.file_offset as usize..][..bun_section.size as usize];
    let graph_len = u64::from_le_bytes(existing[0..8].try_into().unwrap());
    if graph_len == 0 {
        return Err(LinkError::NotStandaloneExecutable);
    }
    // Current payload (without the u64 header) is `graph ++ prior napi
    // images`. The section's filesize may be padded past the last byte we
    // care about, but those padding bytes are zero; copying them is harmless
    // and keeps previously-linked addons intact.
    let prior_payload = &existing[size_of::<u64>()..];

    // Pad so the addon image starts on a 16 KiB boundary within the section —
    // matches the section alignment and gives the loader a page-aligned
    // source.
    let alignment: usize = 16 * 1024;
    let addon_off_in_payload = prior_payload.len().next_multiple_of(alignment);
    let mut new_payload = Vec::with_capacity(addon_off_in_payload + addon_bytes.len());
    new_payload.extend_from_slice(prior_payload);
    new_payload.resize(addon_off_in_payload, 0);
    new_payload.extend_from_slice(addon_bytes);

    // Rewrite the section. The header must keep pointing at the module graph
    // length, not the combined length.
    macho
        .write_section_with_header(&new_payload, graph_len)
        .map_err(|e| match e {
            MachoError::InvalidObject => LinkError::NotStandaloneExecutable,
            _ => LinkError::UnsupportedExecutableFormat,
        })?;

    // Stamp the first free slot. The slot table is fixed-size inside
    // `__DATA,__bun_napi_lnk` so this is a straight overwrite that doesn't
    // shift any load commands — but it must happen *after*
    // `write_section_with_header` has finished shuffling bytes around, or
    // we'd be editing stale memory. `__DATA` sits before `__BUN` in the
    // file, so its offset is unaffected by the shift.
    let slot_section = macho
        .find_section(b"__DATA", b"__bun_napi_lnk")
        .ok_or(LinkError::SlotTableMissing)?;
    if slot_section.size < size_of::<Slot>() as u64 {
        return Err(LinkError::SlotTableMissing);
    }
    let n_slots = (slot_section.size as usize) / size_of::<Slot>();
    let table_off = slot_section.file_offset as usize;
    let picked = (0..n_slots)
        .find(|i| {
            let off = table_off + i * size_of::<Slot>();
            let magic = u64::from_le_bytes(macho.data[off..off + 8].try_into().unwrap());
            let offset = u64::from_le_bytes(macho.data[off + 8..off + 16].try_into().unwrap());
            let length = u64::from_le_bytes(macho.data[off + 16..off + 24].try_into().unwrap());
            (magic & 0x00FF_FFFF_FFFF_FFFF) == Slot::MAGIC_BASE && offset == 0 && length == 0
        })
        .ok_or(LinkError::NoFreeSlot)?;

    // Slot offsets are measured from the start of the section (the u64
    // header), so account for the 8-byte header `write_section_with_header`
    // places before `new_payload`.
    let mut path_buf = [0u8; 224];
    path_buf[..virtual_path.len()].copy_from_slice(virtual_path);
    let dest_off = table_off + picked * size_of::<Slot>();
    let magic = Slot::MAGIC_BASE | ((picked as u64) << 56);
    let offset = size_of::<u64>() as u64 + addon_off_in_payload as u64;
    let hash = bun_wyhash::hash(addon_bytes);
    macho.data[dest_off..dest_off + 8].copy_from_slice(&magic.to_le_bytes());
    macho.data[dest_off + 8..dest_off + 16].copy_from_slice(&offset.to_le_bytes());
    macho.data[dest_off + 16..dest_off + 24]
        .copy_from_slice(&(addon_bytes.len() as u64).to_le_bytes());
    macho.data[dest_off + 24..dest_off + 32].copy_from_slice(&hash.to_le_bytes());
    macho.data[dest_off + 32..dest_off + 256].copy_from_slice(&path_buf);

    let mut out: Vec<u8> = Vec::new();
    macho
        .build_and_sign(&mut out)
        .map_err(|_| LinkError::UnsupportedExecutableFormat)?;
    Ok(out)
}
