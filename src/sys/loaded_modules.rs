//! The executable segments of the loaded images, with the build id a symbolizer needs.

pub struct LoadedModule {
    /// Page-aligned, as the kernel maps it.
    pub start: usize,
    pub limit: usize,
    /// File offset that `start` is mapped from.
    pub file_offset: u64,
    /// Empty when the loader does not know it (the vDSO).
    pub path: Vec<u8>,
    /// `NT_GNU_BUILD_ID` on ELF, `LC_UUID` on Mach-O, empty on Windows.
    pub build_id: Vec<u8>,
}

/// The modules that contain at least one of `addresses`, sorted by `start`.
pub fn modules_containing(addresses: &[usize]) -> Vec<LoadedModule> {
    let mut modules = imp::collect(addresses);
    modules.sort_unstable_by_key(|m| m.start);
    modules
}

#[cfg(not(windows))]
fn any_inside(addresses: &[usize], start: usize, limit: usize) -> bool {
    addresses.iter().any(|&a| a >= start && a < limit)
}

#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
mod imp {
    use super::{LoadedModule, any_inside};
    use crate::elf;
    use core::ffi::{c_int, c_void};

    const NT_GNU_BUILD_ID: u32 = 3;

    struct Context<'a> {
        addresses: &'a [usize],
        out: Vec<LoadedModule>,
        is_first: bool,
    }

    pub(super) fn collect(addresses: &[usize]) -> Vec<LoadedModule> {
        let mut context = Context {
            addresses,
            out: Vec::new(),
            is_first: true,
        };
        // SAFETY: `context` outlives the call; `callback` has the signature libc expects.
        unsafe { libc::dl_iterate_phdr(Some(callback), (&raw mut context).cast::<c_void>()) };
        context.out
    }

    extern "C" fn callback(
        info: *mut libc::dl_phdr_info,
        _size: usize,
        data: *mut c_void,
    ) -> c_int {
        // SAFETY: `data` is the `Context` that `collect` passed to `dl_iterate_phdr`.
        let context = unsafe { &mut *data.cast::<Context<'_>>() };
        let is_main_program = core::mem::replace(&mut context.is_first, false);
        // SAFETY: libc passes a valid `dl_phdr_info` for the duration of the callback.
        let info = unsafe { &*info };
        if info.dlpi_phdr.is_null() {
            return 0;
        }
        // SAFETY: `dlpi_phdr` points to `dlpi_phnum` program headers of a loaded image.
        let phdrs =
            unsafe { core::slice::from_raw_parts(info.dlpi_phdr, info.dlpi_phnum as usize) };
        let base = info.dlpi_addr as usize;
        let page = bun_alloc::page_size();

        let mut path: Option<Vec<u8>> = None;
        let mut build_id: Option<Vec<u8>> = None;
        for phdr in phdrs {
            if phdr.p_type != elf::PT_LOAD || phdr.p_flags & elf::PF_X == 0 {
                continue;
            }
            let vaddr = base.wrapping_add(phdr.p_vaddr as usize);
            // As in /proc/self/maps: pprof finds a mapping's program header by its page-aligned offset.
            let start = vaddr & !(page - 1);
            let limit = (vaddr.wrapping_add(phdr.p_memsz as usize) + page - 1) & !(page - 1);
            if !any_inside(context.addresses, start, limit) {
                continue;
            }
            let path = path.get_or_insert_with(|| {
                // glibc and musl report the main program first and with an empty name.
                let name = if info.dlpi_name.is_null() {
                    &b""[..]
                } else {
                    // SAFETY: a non-null `dlpi_name` is a NUL-terminated string.
                    unsafe { core::ffi::CStr::from_ptr(info.dlpi_name) }.to_bytes()
                };
                if name.is_empty() && is_main_program {
                    bun_core::self_exe_path()
                        .map(|p| p.as_bytes().to_vec())
                        .unwrap_or_default()
                } else {
                    name.to_vec()
                }
            });
            let build_id = build_id.get_or_insert_with(|| {
                phdrs
                    .iter()
                    .filter(|p| p.p_type == elf::PT_NOTE)
                    .find_map(|p| {
                        // SAFETY: a PT_NOTE segment of a loaded image is mapped for `p_memsz` bytes.
                        let notes = unsafe {
                            core::slice::from_raw_parts(
                                base.wrapping_add(p.p_vaddr as usize) as *const u8,
                                p.p_memsz as usize,
                            )
                        };
                        find_note(notes, b"GNU\0", NT_GNU_BUILD_ID)
                    })
                    .map(<[u8]>::to_vec)
                    .unwrap_or_default()
            });
            context.out.push(LoadedModule {
                start,
                limit,
                file_offset: (phdr.p_offset as u64) & !(page as u64 - 1),
                path: path.clone(),
                build_id: build_id.clone(),
            });
        }
        0
    }

    fn find_note<'a>(mut notes: &'a [u8], name: &[u8], kind: u32) -> Option<&'a [u8]> {
        let align4 = |n: usize| n.checked_add(3).map(|n| n & !3);
        while notes.len() >= 12 {
            let namesz = u32::from_ne_bytes(notes[0..4].try_into().ok()?) as usize;
            let descsz = u32::from_ne_bytes(notes[4..8].try_into().ok()?) as usize;
            let note_type = u32::from_ne_bytes(notes[8..12].try_into().ok()?);
            let name_end = 12usize.checked_add(namesz)?;
            let desc_start = 12usize.checked_add(align4(namesz)?)?;
            let desc_end = desc_start.checked_add(descsz)?;
            if desc_end > notes.len() {
                return None;
            }
            if note_type == kind && &notes[12..name_end] == name {
                return Some(&notes[desc_start..desc_end]);
            }
            notes = notes.get(desc_start.checked_add(align4(descsz)?)?..)?;
        }
        None
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::{LoadedModule, any_inside};
    use crate::macho;

    const LC_UUID: u32 = 0x1b;

    /// `struct uuid_command` (mach-o/loader.h).
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct UuidCommand {
        cmd: u32,
        cmdsize: u32,
        uuid: [u8; 16],
    }

    unsafe extern "C" {
        /// Null for an out-of-range index.
        safe fn _dyld_get_image_name(image_index: u32) -> *const core::ffi::c_char;
    }

    pub(super) fn collect(addresses: &[usize]) -> Vec<LoadedModule> {
        let mut out = Vec::new();
        for i in 0..crate::c::_dyld_image_count() {
            let header = crate::c::_dyld_get_image_header(i);
            if header.is_null() {
                continue;
            }
            let slide = crate::c::_dyld_get_image_vmaddr_slide(i) as usize;
            // SAFETY: dyld keeps the header of a loaded image mapped.
            let header_ref = unsafe { &*header };
            // SAFETY: the load commands follow the header and are `sizeofcmds` bytes long.
            let commands = unsafe {
                core::slice::from_raw_parts(
                    header
                        .cast::<u8>()
                        .add(core::mem::size_of::<macho::mach_header_64>()),
                    header_ref.sizeofcmds as usize,
                )
            };
            let mut text: Option<(usize, usize, u64)> = None;
            let mut uuid = Vec::new();
            let mut it = macho::LoadCommandIterator::new(header_ref.ncmds, commands);
            while let Some(command) = it.next() {
                match command.cmd() {
                    macho::LC_SEGMENT_64 => {
                        if let Some(segment) = command.cast::<macho::segment_command_64>() {
                            if segment.seg_name() == b"__TEXT" {
                                let start = (segment.vmaddr as usize).wrapping_add(slide);
                                text = Some((
                                    start,
                                    start.wrapping_add(segment.vmsize as usize),
                                    segment.fileoff,
                                ));
                            }
                        }
                    }
                    LC_UUID => {
                        if let Some(command) = command.cast::<UuidCommand>() {
                            uuid = command.uuid.to_vec();
                        }
                    }
                    _ => {}
                }
            }
            let Some((start, limit, file_offset)) = text else {
                continue;
            };
            if !any_inside(addresses, start, limit) {
                continue;
            }
            let name = _dyld_get_image_name(i);
            out.push(LoadedModule {
                start,
                limit,
                file_offset,
                path: if name.is_null() {
                    Vec::new()
                } else {
                    // SAFETY: a non-null image name is a NUL-terminated string owned by dyld.
                    unsafe { core::ffi::CStr::from_ptr(name) }
                        .to_bytes()
                        .to_vec()
                },
                build_id: uuid,
            });
        }
        out
    }
}

#[cfg(windows)]
mod imp {
    use super::LoadedModule;

    pub(super) fn collect(addresses: &[usize]) -> Vec<LoadedModule> {
        let mut out: Vec<LoadedModule> = Vec::new();
        for &address in addresses {
            if out.iter().any(|m| address >= m.start && address < m.limit) {
                continue;
            }
            let Some(module) = crate::windows::get_module_handle_from_address(address) else {
                continue;
            };
            let base = module as usize;
            let Some(size) = size_of_image(base) else {
                continue;
            };
            let mut wide = [0u16; 1024];
            let path = crate::windows::get_module_name_w(module, &mut wide)
                .map(|name| bun_core::strings::to_utf8_alloc(name))
                .unwrap_or_default();
            out.push(LoadedModule {
                start: base,
                limit: base.wrapping_add(size),
                file_offset: 0,
                path,
                build_id: Vec::new(),
            });
        }
        out
    }

    /// `IMAGE_OPTIONAL_HEADER64.SizeOfImage` of the PE image mapped at `base`.
    fn size_of_image(base: usize) -> Option<usize> {
        const E_LFANEW: usize = 0x3c;
        const OPTIONAL_HEADER: usize = 0x18;
        const SIZE_OF_IMAGE: usize = 0x38;
        // SAFETY: `base` is the HMODULE of a loaded image, whose headers stay mapped.
        unsafe {
            if core::ptr::read_unaligned(base as *const u16) != 0x5a4d {
                return None;
            }
            let nt = base + core::ptr::read_unaligned((base + E_LFANEW) as *const u32) as usize;
            if core::ptr::read_unaligned(nt as *const u32) != 0x0000_4550 {
                return None;
            }
            Some(
                core::ptr::read_unaligned((nt + OPTIONAL_HEADER + SIZE_OF_IMAGE) as *const u32)
                    as usize,
            )
        }
    }
}

#[cfg(not(any(
    target_os = "linux",
    target_os = "android",
    target_os = "freebsd",
    target_os = "macos",
    windows
)))]
mod imp {
    pub(super) fn collect(_addresses: &[usize]) -> Vec<super::LoadedModule> {
        Vec::new()
    }
}
