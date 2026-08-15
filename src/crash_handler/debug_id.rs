//! The identifier the linker stamps into both the executable and its debug
//! info: the PDB GUID in the PE CodeView record on Windows, the GNU build-id
//! note on ELF, `LC_UUID` on Mach-O. Unlike the git sha it names one specific
//! link: a commit can be published as several links of one platform (an x64
//! and an x64-baseline zip, a re-run release step), and symbolizing a trace
//! against the other link's debug info produces plausible-looking nonsense.
//! The trace string carries this id so bun.report can check the debug file it
//! picked. Bytes are kept in the order the platform's tools print them
//! (`dumpbin`, `readelf -n`, `dwarfdump --uuid`), so the hex in a trace string
//! compares directly against their output.
//!
//! Runs inside the crash handler: reads only the loader-mapped image headers,
//! bounds-checks every offset, and does not allocate.

use bun_collections::BoundedArray;

/// A sha1 build-id is 20 bytes; a PDB GUID or Mach-O UUID is 16.
pub(crate) const MAX_LEN: usize = 20;

pub(crate) type DebugId = BoundedArray<u8, MAX_LEN>;

/// The debug id of the image whose frames the trace string encodes as bare
/// image-relative addresses (see `StackLine::from_address`), or `None` when
/// the image does not carry one.
pub(crate) fn of_running_executable() -> Option<DebugId> {
    #[cfg(windows)]
    {
        pe_codeview_guid()
    }
    #[cfg(target_os = "macos")]
    {
        macho_uuid()
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        elf_gnu_build_id()
    }
}

fn debug_id_from(bytes: &[u8]) -> Option<DebugId> {
    if bytes.is_empty() {
        return None;
    }
    DebugId::from_slice(&bytes[..bytes.len().min(MAX_LEN)]).ok()
}

#[cfg(windows)]
fn pe_codeview_guid() -> Option<DebugId> {
    const IMAGE_DIRECTORY_ENTRY_DEBUG: usize = 6;
    const IMAGE_DEBUG_TYPE_CODEVIEW: u32 = 2;
    const IMAGE_DEBUG_DIRECTORY_SIZE: usize = 28;

    /// Bounds-checked reads at RVAs of the mapped image.
    struct Image<'a>(&'a [u8]);

    impl Image<'_> {
        fn bytes(&self, rva: usize, len: usize) -> Option<&[u8]> {
            self.0.get(rva..rva.checked_add(len)?)
        }
        fn u16(&self, rva: usize) -> Option<u16> {
            Some(u16::from_le_bytes(self.bytes(rva, 2)?.try_into().ok()?))
        }
        fn u32(&self, rva: usize) -> Option<u32> {
            Some(u32::from_le_bytes(self.bytes(rva, 4)?.try_into().ok()?))
        }
    }

    let range = bun_sys::windows::exe_image_range();
    // SAFETY: the loader maps the exe's headers and sections contiguously over
    // `range` (base..base + SizeOfImage) for the lifetime of the process, and
    // `Image` checks every offset against that length before reading it.
    let image = Image(unsafe {
        core::slice::from_raw_parts(range.start as *const u8, range.end - range.start)
    });

    let nt_headers = image.u32(0x3C)? as usize;
    if image.bytes(nt_headers, 4)? != b"PE\0\0" {
        return None;
    }
    // Signature(4) + IMAGE_FILE_HEADER(20), then IMAGE_OPTIONAL_HEADER64 with
    // NumberOfRvaAndSizes at +108 and the 8-byte DataDirectory entries at +112.
    let optional_header = nt_headers + 4 + 20;
    if image.u16(optional_header)? != 0x20B {
        return None;
    }
    if image.u32(optional_header + 108)? as usize <= IMAGE_DIRECTORY_ENTRY_DEBUG {
        return None;
    }
    let directory = optional_header + 112 + IMAGE_DIRECTORY_ENTRY_DEBUG * 8;
    let mut entry = image.u32(directory)? as usize;
    let end = entry.checked_add(image.u32(directory + 4)? as usize)?;

    // IMAGE_DEBUG_DIRECTORY: Type at +12, AddressOfRawData at +20.
    while entry + IMAGE_DEBUG_DIRECTORY_SIZE <= end {
        if image.u32(entry + 12)? == IMAGE_DEBUG_TYPE_CODEVIEW {
            // CV_INFO_PDB70: "RSDS", GUID, age, pdb path.
            let codeview = image.u32(entry + 20)? as usize;
            if codeview != 0 && image.bytes(codeview, 4)? == b"RSDS" {
                let guid = image.bytes(codeview + 4, 16)?;
                // GUID {u32, u16, u16, [u8; 8]} is stored little-endian; emit
                // the byte order of its textual form.
                let mut id = [0u8; 16];
                id[0..4].copy_from_slice(&[guid[3], guid[2], guid[1], guid[0]]);
                id[4..6].copy_from_slice(&[guid[5], guid[4]]);
                id[6..8].copy_from_slice(&[guid[7], guid[6]]);
                id[8..16].copy_from_slice(&guid[8..16]);
                return debug_id_from(&id);
            }
        }
        entry += IMAGE_DEBUG_DIRECTORY_SIZE;
    }
    None
}

#[cfg(target_os = "macos")]
fn macho_uuid() -> Option<DebugId> {
    const LC_UUID: u32 = 0x1B;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct uuid_command {
        _cmd: u32,
        _cmdsize: u32,
        uuid: [u8; 16],
    }

    // Image 0 is the main executable, the image `StackLine` encodes as bare addresses.
    let header = bun_sys::c::_dyld_get_image_header(0);
    if header.is_null() {
        return None;
    }
    // SAFETY: dyld keeps the main executable's header and the `sizeofcmds`
    // bytes of load commands following it mapped for the process lifetime.
    let (ncmds, load_commands) = unsafe {
        let header_ref = &*header;
        (
            header_ref.ncmds,
            core::slice::from_raw_parts(
                header
                    .cast::<u8>()
                    .add(core::mem::size_of::<bun_sys::macho::mach_header_64>()),
                header_ref.sizeofcmds as usize,
            ),
        )
    };
    let mut it = bun_sys::macho::LoadCommandIterator::new(ncmds, load_commands);
    while let Some(command) = it.next() {
        if command.cmd() == LC_UUID {
            return debug_id_from(&command.cast::<uuid_command>()?.uuid);
        }
    }
    None
}

#[cfg(not(any(windows, target_os = "macos")))]
fn elf_gnu_build_id() -> Option<DebugId> {
    use core::ffi::{c_int, c_void};

    const PT_NOTE: u32 = 4;

    struct Ctx {
        address: usize,
        result: Option<DebugId>,
    }

    // Same shape as `bun_sys::elf::find_loaded_module`: the object whose PT_LOAD
    // covers an address inside this binary is the one whose notes to read.
    extern "C" fn callback(
        info: *mut libc::dl_phdr_info,
        _size: libc::size_t,
        data: *mut c_void,
    ) -> c_int {
        // SAFETY: `data` is the `&mut Ctx` handed to dl_iterate_phdr below.
        let ctx = unsafe { bun_core::callback_ctx::<Ctx>(data) };
        // SAFETY: dl_iterate_phdr passes a valid info pointer whose dlpi_phdr
        // points to dlpi_phnum program headers.
        let (base, phdrs) = unsafe {
            let info = &*info;
            (
                info.dlpi_addr as usize,
                core::slice::from_raw_parts(info.dlpi_phdr, info.dlpi_phnum as usize),
            )
        };
        let contains_address = phdrs.iter().any(|phdr| {
            phdr.p_type == bun_sys::elf::PT_LOAD && {
                let start = base.wrapping_add(phdr.p_vaddr as usize);
                ctx.address >= start && ctx.address < start.wrapping_add(phdr.p_memsz as usize)
            }
        });
        if !contains_address {
            return 0;
        }
        for phdr in phdrs.iter().filter(|phdr| phdr.p_type == PT_NOTE) {
            // SAFETY: a PT_NOTE segment lies inside one of the object's mapped
            // PT_LOAD segments, so `p_memsz` bytes are readable at
            // `base + p_vaddr` while the object is loaded, and the main
            // executable is never unloaded.
            let notes = unsafe {
                core::slice::from_raw_parts(
                    base.wrapping_add(phdr.p_vaddr as usize) as *const u8,
                    phdr.p_memsz as usize,
                )
            };
            if let Some(id) = gnu_build_id_note(notes) {
                ctx.result = Some(id);
                break;
            }
        }
        1
    }

    let mut ctx = Ctx {
        address: elf_gnu_build_id as *const () as usize,
        result: None,
    };
    // SAFETY: `ctx` outlives the call and `callback` has the signature libc expects.
    unsafe {
        libc::dl_iterate_phdr(Some(callback), (&raw mut ctx).cast::<c_void>());
    }
    ctx.result
}

/// Each note in a PT_NOTE segment is an `Elf64_Nhdr` (namesz, descsz, type as
/// native-endian u32s) followed by the name and the descriptor, each padded to
/// a multiple of 4 bytes.
#[cfg(not(any(windows, target_os = "macos")))]
fn gnu_build_id_note(mut notes: &[u8]) -> Option<DebugId> {
    const NT_GNU_BUILD_ID: u32 = 3;

    fn u32_at(bytes: &[u8], offset: usize) -> Option<u32> {
        Some(u32::from_ne_bytes(
            bytes.get(offset..offset + 4)?.try_into().ok()?,
        ))
    }
    fn align4(n: usize) -> Option<usize> {
        Some(n.checked_add(3)? & !3)
    }

    while notes.len() >= 12 {
        let name_end = 12usize.checked_add(u32_at(notes, 0)? as usize)?;
        let desc_start = align4(name_end)?;
        let desc_end = desc_start.checked_add(u32_at(notes, 4)? as usize)?;
        let desc = notes.get(desc_start..desc_end)?;
        if u32_at(notes, 8)? == NT_GNU_BUILD_ID && notes.get(12..name_end)? == b"GNU\0" {
            return debug_id_from(desc);
        }
        notes = notes.get(align4(desc_end)?.min(notes.len())..)?;
    }
    None
}
