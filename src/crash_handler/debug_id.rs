//! The id the linker stamps into both the executable and its debug info (PDB
//! GUID, GNU build-id, `LC_UUID`), in the byte order `dumpbin` / `readelf -n` /
//! `dwarfdump --uuid` print it. Read from the mapped image headers inside the
//! crash handler, so every offset is bounds-checked and nothing allocates.

use bun_collections::BoundedArray;

/// A sha1 build-id is 20 bytes; a PDB GUID or Mach-O UUID is 16.
pub(crate) const MAX_LEN: usize = 20;

pub(crate) type DebugId = BoundedArray<u8, MAX_LEN>;

/// The id of the image whose frames `StackLine` encodes as bare addresses.
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
    // SAFETY: the loader keeps base..base + SizeOfImage mapped for the life of
    // the process; `Image` bounds-checks every read against it.
    let image = Image(unsafe {
        core::slice::from_raw_parts(range.start as *const u8, range.end - range.start)
    });

    let nt_headers = image.u32(0x3C)? as usize;
    if image.bytes(nt_headers, 4)? != b"PE\0\0" {
        return None;
    }
    // IMAGE_OPTIONAL_HEADER64: NumberOfRvaAndSizes at +108, DataDirectory at +112.
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
                // The first three GUID fields are little-endian in memory.
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

    // Image 0 is the main executable, the one `StackLine` encodes as bare addresses.
    let header = bun_sys::c::_dyld_get_image_header(0);
    if header.is_null() {
        return None;
    }
    // SAFETY: dyld keeps the main executable's header and its `sizeofcmds`
    // bytes of load commands mapped for the life of the process.
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

    // As in `bun_sys::elf::find_loaded_module`: the object whose PT_LOAD covers `address`.
    extern "C" fn callback(
        info: *mut libc::dl_phdr_info,
        _size: libc::size_t,
        data: *mut c_void,
    ) -> c_int {
        // SAFETY: `data` is the `&mut Ctx` handed to dl_iterate_phdr below.
        let ctx = unsafe { bun_core::callback_ctx::<Ctx>(data) };
        // SAFETY: dl_iterate_phdr passes a valid info whose dlpi_phdr has dlpi_phnum entries.
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
            // SAFETY: PT_NOTE lies inside a PT_LOAD of this object, which is the
            // main executable and therefore stays mapped.
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

/// Notes are `Elf64_Nhdr {namesz, descsz, type}` followed by the name and the
/// descriptor, each padded to 4 bytes.
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
