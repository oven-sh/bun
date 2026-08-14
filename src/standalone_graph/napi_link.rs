//! NAPI link slots: a fixed table of stub addon loaders baked into the bun
//! binary (`BUN_NAPI_LINK_SLOTS` in `c-bindings.cpp`), so a `.node` can be
//! appended to a `bun build --compile` executable after the fact without
//! rebundling. The addon image is stored in the `__BUN,__bun` / `.bun`
//! section past the module-graph payload; the slot records its offset and the
//! `/$bunfs/` path `process.dlopen` will ask for. Matching slots are loaded
//! from memory (`NSLinkModule` on macOS, memfd on Linux), never extracted to
//! disk. Only the Mach-O patcher exists so far.

use core::ffi::c_void;
use core::mem::size_of;
use core::sync::atomic::{AtomicPtr, Ordering};

use bun_exe_format::macho::{MachoError, MachoFile};

/// Mirrors `BunNapiLinkSlot` in `c-bindings.cpp`.
#[repr(C)]
pub struct Slot {
    /// `MAGIC_BASE | (index << 56)`.
    pub magic: u64,
    /// From the start of the `.bun` section (its u64 size header); 0 = unused.
    pub offset: u64,
    pub length: u64,
    pub hash: u64,
    pub path: [u8; 224],
}

const _: () = assert!(size_of::<Slot>() == 256);

impl Slot {
    pub const COUNT: usize = 8;
    /// `"bunlink\0"` as a little-endian u64; the high byte holds the index.
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
    // SAFETY: static table in the binary's own data section.
    unsafe { core::slice::from_raw_parts(Bun__getNapiLinkSlots(), count) }
}

pub fn find_slot(input_path: &[u8]) -> Option<&'static Slot> {
    slots()
        .iter()
        .find(|s| s.is_valid() && s.is_used() && s.path_slice() == input_path)
}

#[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
fn slot_bytes(slot: &Slot) -> Option<&'static [u8]> {
    // SAFETY: `offset`/`length` were written by the patcher to lie inside the
    // mapped `.bun` section, which lives as long as the process.
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

/// Per-slot handle cache; native addons are never unloaded, so a second
/// `require()` must hand `Process_functionDlopen` the same handle for its
/// `DLHandleMap` replay.
static LOADED_HANDLES: [AtomicPtr<c_void>; Slot::COUNT] =
    [const { AtomicPtr::new(core::ptr::null_mut()) }; Slot::COUNT];

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
    let mut name = [0u8; 32];
    use std::io::Write as _;
    let mut c = std::io::Cursor::new(&mut name[..]);
    let _ = write!(c, "bun:napi-slot-{}\0", slot.index());
    *is_ns_module = true;
    // SAFETY: `bytes` is a live slice; `name` is NUL-terminated.
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
    // `fd` is intentionally kept open: `/proc/self/fd/N` must stay valid for
    // as long as the module is mapped.
    let mut path = [0u8; 48];
    use std::io::Write as _;
    let mut c = std::io::Cursor::new(&mut path[..]);
    let _ = write!(c, "/proc/self/fd/{}", fd.0);
    let len = c.position() as usize;
    let zpath = ZStr::from_buf(&path, len);
    bun_sys::dlopen(zpath, bun_sys::RTLD::LAZY).unwrap_or(core::ptr::null_mut())
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "android")))]
fn load_slot_for_platform(_slot: &Slot, _is_ns_module: &mut bool) -> *mut c_void {
    core::ptr::null_mut()
}

/// Returns whether `path` names a link slot. On `true`, `*out_handle` is the
/// loaded module or null if loading failed; the caller must not fall back to
/// the module-graph extractor in either case. `*out_is_ns_module` means the
/// handle is an `NSModule` (use `NSLookupSymbolInModule`, not `dlsym`).
///
/// # Safety
/// `path_ptr[..path_len]` must be readable; the out-pointers must be valid
/// for writes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__tryLoadNapiLinkSlot(
    path_ptr: *const u8,
    path_len: usize,
    out_handle: *mut *mut c_void,
    out_is_ns_module: *mut bool,
) -> bool {
    // SAFETY: per the function contract, upheld by BunProcess.cpp.
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

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum LinkError {
    UnsupportedExecutableFormat,
    NotStandaloneExecutable,
    NoFreeSlot,
    PathTooLong,
    SlotTableMissing,
}

const MH_MAGIC_64: u32 = 0xfeedfacf;

/// Append `addon_bytes` to the `__BUN,__bun` section of a compiled Mach-O
/// executable, stamp the first free slot with its location and
/// `virtual_path`, and return the re-signed image.
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

    let bun_section = macho
        .find_section(b"__BUN", b"__bun")
        .ok_or(LinkError::NotStandaloneExecutable)?;
    if bun_section.size < size_of::<u64>() as u64 {
        return Err(LinkError::NotStandaloneExecutable);
    }

    let existing = macho
        .section_bytes(bun_section)
        .ok_or(LinkError::NotStandaloneExecutable)?;
    let graph_len = u64::from_le_bytes(existing[0..8].try_into().unwrap());
    if graph_len == 0 {
        return Err(LinkError::NotStandaloneExecutable);
    }
    // Everything after the size header (module graph plus any previously
    // linked addons) is carried over verbatim; the new image is appended on a
    // 16 KiB boundary.
    let prior_payload = &existing[size_of::<u64>()..];
    let addon_off_in_payload = prior_payload.len().next_multiple_of(16 * 1024);
    let mut new_payload = Vec::with_capacity(addon_off_in_payload + addon_bytes.len());
    new_payload.extend_from_slice(prior_payload);
    new_payload.resize(addon_off_in_payload, 0);
    new_payload.extend_from_slice(addon_bytes);

    // The size header must still describe only the module graph, or the
    // runtime's trailer check lands on the addon bytes instead.
    macho
        .write_section_with_header(&new_payload, graph_len)
        .map_err(|e| match e {
            MachoError::InvalidObject => LinkError::NotStandaloneExecutable,
            _ => LinkError::UnsupportedExecutableFormat,
        })?;

    // Locate the table only after the section rewrite above has moved things.
    let slot_section = macho
        .find_section(b"__DATA", b"__bun_napi_lnk")
        .ok_or(LinkError::SlotTableMissing)?;
    let table = macho
        .section_bytes_mut(slot_section)
        .filter(|t| t.len() >= size_of::<Slot>())
        .ok_or(LinkError::SlotTableMissing)?;
    let picked = table
        .chunks_exact(size_of::<Slot>())
        .position(|raw| {
            let magic = u64::from_le_bytes(raw[0..8].try_into().unwrap());
            let offset = u64::from_le_bytes(raw[8..16].try_into().unwrap());
            let length = u64::from_le_bytes(raw[16..24].try_into().unwrap());
            (magic & 0x00FF_FFFF_FFFF_FFFF) == Slot::MAGIC_BASE && offset == 0 && length == 0
        })
        .ok_or(LinkError::NoFreeSlot)?;

    let magic = Slot::MAGIC_BASE | ((picked as u64) << 56);
    let offset = size_of::<u64>() as u64 + addon_off_in_payload as u64;
    let hash = bun_wyhash::hash(addon_bytes);
    let dest = &mut table[picked * size_of::<Slot>()..][..size_of::<Slot>()];
    dest[0..8].copy_from_slice(&magic.to_le_bytes());
    dest[8..16].copy_from_slice(&offset.to_le_bytes());
    dest[16..24].copy_from_slice(&(addon_bytes.len() as u64).to_le_bytes());
    dest[24..32].copy_from_slice(&hash.to_le_bytes());
    dest[32..].fill(0);
    dest[32..][..virtual_path.len()].copy_from_slice(virtual_path);

    let mut out: Vec<u8> = Vec::new();
    macho
        .build_and_sign(&mut out)
        .map_err(|_| LinkError::UnsupportedExecutableFormat)?;
    Ok(out)
}
