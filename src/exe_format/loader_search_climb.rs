//! How far the search paths a shared library declares climb above the library.
//!
//! A compiled executable writes its embedded shared libraries into a directory
//! of its own before it loads one (`bun_standalone_graph::native_libs`). The
//! loader expands `$ORIGIN` (ELF) and `@loader_path` (Mach-O) to the directory
//! the library sits in, and every `..` after the token is a step up from it.
//! The standalone graph puts the libraries as many levels below their directory
//! as these strings climb, so a declared search path never leaves it.
//!
//! The reader takes the bytes of a library of any target, on any host, and
//! follows the loader: the dynamic section through the program headers on ELF,
//! the load commands on Mach-O. A PE image carries no search path.

use core::mem::size_of;

use bun_core::{slice_to_nul, strings};
use bun_sys::elf::PT_LOAD;
use bun_sys::macho;

use crate::elf::{EI_CLASS, EI_DATA, ELFCLASS64, ELFDATA2LSB, Elf64_Ehdr, Elf64_Phdr};
use crate::macho_types::LC_REQ_DYLD;
use crate::read_struct;

/// The `..` segments in the search strings of one library.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SearchClimb {
    /// Most `..` segments in one string that starts at the library's directory:
    /// an `$ORIGIN` entry of DT_RPATH or DT_RUNPATH, an `$ORIGIN` name in
    /// DT_NEEDED, DT_AUXILIARY or DT_FILTER, an `@loader_path` install name.
    pub direct: u32,
    /// Most `..` segments in one `@loader_path` entry of LC_RPATH. `None` for a
    /// library without such an entry.
    pub rpath: Option<u32>,
    /// Most `..` segments in one `@rpath/` install name. dyld appends such a
    /// name to the LC_RPATH entries of every image that led to the load, so it
    /// adds to the `rpath` of each of them.
    pub below_rpath: u32,
}

impl SearchClimb {
    fn or(self, other: Self) -> Self {
        Self {
            direct: self.direct.max(other.direct),
            rpath: self.rpath.max(other.rpath),
            below_rpath: self.below_rpath.max(other.below_rpath),
        }
    }
}

/// An ELF or Mach-O image whose search strings cannot be read in full.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Unreadable;

/// The search strings of the library in `bytes`. All zero when `bytes` is not an
/// ELF64 little-endian or a 64-bit Mach-O image (universal or not): no loader
/// of a bun target takes a search path from it.
pub fn scan(bytes: &[u8]) -> Result<SearchClimb, Unreadable> {
    if bytes.starts_with(b"\x7fELF") {
        return elf_climb(bytes).ok_or(Unreadable);
    }
    if is_macho(bytes) {
        return macho_climb(bytes).ok_or(Unreadable);
    }
    match be_u32(bytes, 0, 0) {
        Some(FAT_MAGIC) => universal_climb(bytes, &FatArch::NARROW),
        Some(FAT_MAGIC_64) => universal_climb(bytes, &FatArch::WIDE),
        _ => Some(SearchClimb::default()),
    }
    .ok_or(Unreadable)
}

fn read_at<T: Copy>(bytes: &[u8], offset: usize) -> Option<T> {
    let end = offset.checked_add(size_of::<T>())?;
    bytes.get(offset..end).map(read_struct)
}

fn be_u32(bytes: &[u8], base: usize, offset: usize) -> Option<u32> {
    read_at::<[u8; 4]>(bytes, base.checked_add(offset)?).map(u32::from_be_bytes)
}

fn be_u64(bytes: &[u8], base: usize, offset: usize) -> Option<u64> {
    read_at::<[u8; 8]>(bytes, base.checked_add(offset)?).map(u64::from_be_bytes)
}

fn parent_segments(path: &[u8]) -> u32 {
    let count = strings::split(path, b"/")
        .filter(|segment| *segment == b"..")
        .count();
    u32::try_from(count).unwrap_or(u32::MAX)
}

const PT_DYNAMIC: u32 = 2;
/// `e_phnum` of a file whose real count is in a section header.
const PN_XNUM: u16 = 0xffff;

const DT_NULL: i64 = 0;
const DT_NEEDED: i64 = 1;
const DT_STRTAB: i64 = 5;
const DT_RPATH: i64 = 15;
const DT_RUNPATH: i64 = 29;
const DT_AUXILIARY: i64 = 0x7fff_fffd;
const DT_FILTER: i64 = 0x7fff_ffff;

#[repr(C)]
#[derive(Clone, Copy)]
struct Elf64_Dyn {
    d_tag: i64,
    d_val: u64,
}

/// `None` when the image cannot be read in full.
fn elf_climb(bytes: &[u8]) -> Option<SearchClimb> {
    let ident = bytes.get(..EI_DATA + 1)?;
    if ident[EI_CLASS] != ELFCLASS64 || ident[EI_DATA] != ELFDATA2LSB {
        return Some(SearchClimb::default());
    }
    let header: Elf64_Ehdr = read_at(bytes, 0)?;
    if header.e_phnum == 0 {
        return Some(SearchClimb::default());
    }
    let entry_size = usize::from(header.e_phentsize);
    if header.e_phnum == PN_XNUM || entry_size < size_of::<Elf64_Phdr>() {
        return None;
    }
    let table = usize::try_from(header.e_phoff).ok()?;
    let program_header = |index: u16| -> Option<Elf64_Phdr> {
        read_at(
            bytes,
            table.checked_add(usize::from(index).checked_mul(entry_size)?)?,
        )
    };

    // The loader reads the dynamic section and its strings from the memory it
    // mapped, and so does this: the file bytes behind `address`, to the end of
    // their segment. A later segment maps over an earlier one.
    let mapped = |address: u64| -> Option<&[u8]> {
        let mut found = None;
        for index in 0..header.e_phnum {
            let segment = program_header(index)?;
            if segment.p_type != PT_LOAD {
                continue;
            }
            let Some(into) = address.checked_sub(segment.p_vaddr) else {
                continue;
            };
            if into >= segment.p_filesz {
                continue;
            }
            let start = usize::try_from(segment.p_offset.checked_add(into)?).ok()?;
            let end = usize::try_from(segment.p_offset.checked_add(segment.p_filesz)?).ok()?;
            found = Some(bytes.get(start..end)?);
        }
        found
    };

    let mut dynamic = None;
    for index in 0..header.e_phnum {
        let segment = program_header(index)?;
        if segment.p_type == PT_DYNAMIC {
            dynamic = Some(segment.p_vaddr);
        }
    }
    let Some(dynamic) = dynamic else {
        return Some(SearchClimb::default());
    };
    let entries = || {
        mapped(dynamic).map(|table| {
            table
                .as_chunks::<{ size_of::<Elf64_Dyn>() }>()
                .0
                .iter()
                .map(|entry| read_struct::<Elf64_Dyn>(entry))
                .take_while(|entry| entry.d_tag != DT_NULL)
        })
    };

    let mut string_table = None;
    for entry in entries()? {
        if entry.d_tag == DT_STRTAB {
            string_table = Some(entry.d_val);
        }
    }
    let mut climb = SearchClimb::default();
    for entry in entries()? {
        let is_list = match entry.d_tag {
            DT_RPATH | DT_RUNPATH => true,
            DT_NEEDED | DT_AUXILIARY | DT_FILTER => false,
            _ => continue,
        };
        let text = mapped(string_table?.checked_add(entry.d_val)?)?;
        let text = &text[..strings::index_of_char_usize(text, 0)?];
        let from_origin = |path: &[u8]| -> u32 {
            if strings::contains(path, b"$ORIGIN") || strings::contains(path, b"${ORIGIN}") {
                parent_segments(path)
            } else {
                0
            }
        };
        let levels = if is_list {
            strings::split(text, b":")
                .map(from_origin)
                .max()
                .unwrap_or(0)
        } else {
            from_origin(text)
        };
        climb.direct = climb.direct.max(levels);
    }
    Some(climb)
}

const MH_MAGIC_64: u32 = 0xfeed_facf;
/// The header of a universal file is big-endian on every host.
const FAT_MAGIC: u32 = 0xcafe_babe;
const FAT_MAGIC_64: u32 = 0xcafe_babf;

const LC_LOAD_DYLIB: u32 = 0xc;
const LC_LOAD_WEAK_DYLIB: u32 = 0x18 | LC_REQ_DYLD;
const LC_RPATH: u32 = 0x1c | LC_REQ_DYLD;
const LC_REEXPORT_DYLIB: u32 = 0x1f | LC_REQ_DYLD;
const LC_LAZY_LOAD_DYLIB: u32 = 0x20;
const LC_LOAD_UPWARD_DYLIB: u32 = 0x23 | LC_REQ_DYLD;

/// `rpath_command` and `dylib_command` both keep the offset of their string,
/// from the start of the command, in the field after the command header.
const LC_STRING_OFFSET_AT: usize = size_of::<macho::load_command>();

fn is_macho(bytes: &[u8]) -> bool {
    read_at::<[u8; 4]>(bytes, 0).map(u32::from_le_bytes) == Some(MH_MAGIC_64)
}

/// `None` when the image cannot be read in full.
fn macho_climb(bytes: &[u8]) -> Option<SearchClimb> {
    let header: macho::mach_header_64 = read_at(bytes, 0)?;
    let commands = bytes
        .get(size_of::<macho::mach_header_64>()..)?
        .get(..usize::try_from(header.sizeofcmds).ok()?)?;

    let mut climb = SearchClimb::default();
    let mut read = 0u32;
    let mut iterator = macho::LoadCommandIterator::new(header.ncmds, commands);
    while let Some(command) = iterator.next() {
        read += 1;
        let kind = command.cmd();
        if !matches!(
            kind,
            LC_RPATH
                | LC_LOAD_DYLIB
                | LC_LOAD_WEAK_DYLIB
                | LC_REEXPORT_DYLIB
                | LC_LAZY_LOAD_DYLIB
                | LC_LOAD_UPWARD_DYLIB
        ) {
            continue;
        }
        let data = commands.get(command.offset..)?.get(..command.data.len())?;
        let at = read_at::<[u8; 4]>(data, LC_STRING_OFFSET_AT).map(u32::from_le_bytes)?;
        let path = slice_to_nul(data.get(usize::try_from(at).ok()?..)?);
        let levels = parent_segments(path);
        if kind == LC_RPATH {
            if path.starts_with(b"@loader_path") {
                climb.rpath = climb.rpath.max(Some(levels));
            }
        } else if path.starts_with(b"@rpath") {
            climb.below_rpath = climb.below_rpath.max(levels);
        } else if path.starts_with(b"@loader_path") {
            climb.direct = climb.direct.max(levels);
        }
    }
    // The iterator stops at a command it cannot read.
    (read == header.ncmds).then_some(climb)
}

/// Where a `fat_arch` (32-bit fields) or a `fat_arch_64` keeps the offset and
/// the size of its image.
struct FatArch {
    size: usize,
    image_offset: fn(&[u8], usize) -> Option<u64>,
    image_size: fn(&[u8], usize) -> Option<u64>,
}

impl FatArch {
    const NARROW: Self = Self {
        size: 20,
        image_offset: |bytes, arch| be_u32(bytes, arch, 8).map(u64::from),
        image_size: |bytes, arch| be_u32(bytes, arch, 12).map(u64::from),
    };
    const WIDE: Self = Self {
        size: 32,
        image_offset: |bytes, arch| be_u64(bytes, arch, 8),
        image_size: |bytes, arch| be_u64(bytes, arch, 16),
    };
}

const FAT_HEADER_SIZE: usize = 8;

/// `None` when an image of the file cannot be read in full.
fn universal_climb(bytes: &[u8], arch: &FatArch) -> Option<SearchClimb> {
    let count = usize::try_from(be_u32(bytes, 0, 4)?).ok()?;
    let mut climb = SearchClimb::default();
    for index in 0..count {
        let at = FAT_HEADER_SIZE.checked_add(index.checked_mul(arch.size)?)?;
        let image = bytes
            .get(usize::try_from((arch.image_offset)(bytes, at)?).ok()?..)?
            .get(..usize::try_from((arch.image_size)(bytes, at)?).ok()?)?;
        if is_macho(image) {
            climb = climb.or(macho_climb(image)?);
        }
    }
    Some(climb)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE: u64 = 0x40_0000;
    const EHDR: usize = 64;
    const PHDR: usize = 56;

    fn program_header(kind: u32, offset: u64, address: u64, size: u64) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&kind.to_le_bytes());
        out.extend_from_slice(&0u32.to_le_bytes());
        for field in [offset, address, address, size, size, 8] {
            out.extend_from_slice(&field.to_le_bytes());
        }
        assert_eq!(out.len(), PHDR);
        out
    }

    /// One segment maps the whole file at `BASE`. `front` bytes sit between the
    /// dynamic section and the strings.
    fn elf_with(entries: &[(i64, &[u8])], front: usize) -> Vec<u8> {
        let dynamic_at = EHDR + 2 * PHDR;
        let dynamic_size = (entries.len() + 2) * 16;
        let strings_at = dynamic_at + dynamic_size + front;

        let mut strings = vec![0u8];
        let mut dynamic = Vec::new();
        for (tag, text) in entries {
            dynamic.extend_from_slice(&tag.to_le_bytes());
            dynamic.extend_from_slice(&(strings.len() as u64).to_le_bytes());
            strings.extend_from_slice(text);
            strings.push(0);
        }
        dynamic.extend_from_slice(&DT_STRTAB.to_le_bytes());
        dynamic.extend_from_slice(&(BASE + strings_at as u64).to_le_bytes());
        dynamic.extend_from_slice(&[0u8; 16]);
        assert_eq!(dynamic.len(), dynamic_size);

        let total = (strings_at + strings.len()) as u64;
        let mut out = Vec::new();
        out.extend_from_slice(b"\x7fELF");
        out.extend_from_slice(&[ELFCLASS64, ELFDATA2LSB, 1, 0]);
        out.extend_from_slice(&[0u8; 8]);
        out.extend_from_slice(&3u16.to_le_bytes());
        out.extend_from_slice(&62u16.to_le_bytes());
        out.extend_from_slice(&1u32.to_le_bytes());
        out.extend_from_slice(&0u64.to_le_bytes());
        out.extend_from_slice(&(EHDR as u64).to_le_bytes());
        out.extend_from_slice(&0u64.to_le_bytes());
        out.extend_from_slice(&0u32.to_le_bytes());
        out.extend_from_slice(&(EHDR as u16).to_le_bytes());
        out.extend_from_slice(&(PHDR as u16).to_le_bytes());
        out.extend_from_slice(&2u16.to_le_bytes());
        out.extend_from_slice(&[0u8; 6]);
        assert_eq!(out.len(), EHDR);
        out.extend(program_header(PT_LOAD, 0, BASE, total));
        out.extend(program_header(
            PT_DYNAMIC,
            dynamic_at as u64,
            BASE + dynamic_at as u64,
            dynamic_size as u64,
        ));
        out.extend(dynamic);
        out.extend(core::iter::repeat_n(0xaau8, front));
        out.extend(strings);
        out
    }

    fn elf(entries: &[(i64, &[u8])]) -> Vec<u8> {
        elf_with(entries, 0)
    }

    fn direct(levels: u32) -> Result<SearchClimb, Unreadable> {
        Ok(SearchClimb {
            direct: levels,
            ..SearchClimb::default()
        })
    }

    const SHARP_RPATH: &[u8] = b"$ORIGIN/../../sharp-libvips-linux-x64/lib:$ORIGIN/../../../sharp-libvips-linux-x64/1.2.4/lib:$ORIGIN/../../node_modules/@img/sharp-libvips-linux-x64/lib:$ORIGIN/../../../node_modules/@img/sharp-libvips-linux-x64/lib:$ORIGIN/../../../../../@img-sharp-libvips-linux-x64-npm-1.2.4-105fd6d44d/node_modules/@img/sharp-libvips-linux-x64/lib";

    #[test]
    fn elf_search_paths() {
        assert_eq!(scan(&elf(&[(DT_NEEDED, b"libc.so.6")])), direct(0));
        assert_eq!(scan(&elf(&[(DT_RUNPATH, b"$ORIGIN")])), direct(0));
        assert_eq!(scan(&elf(&[(DT_RUNPATH, b"$ORIGIN/deps")])), direct(0));
        assert_eq!(
            scan(&elf(&[(DT_RUNPATH, b"$ORIGIN/../../lib:$ORIGIN")])),
            direct(2)
        );
        assert_eq!(scan(&elf(&[(DT_RPATH, SHARP_RPATH)])), direct(5));
        assert_eq!(scan(&elf(&[(DT_RPATH, b"${ORIGIN}/..")])), direct(1));
        // A name is not taken off the count: `a/..` still counts one.
        assert_eq!(scan(&elf(&[(DT_RUNPATH, b"$ORIGIN/a/../..")])), direct(2));
        // Not relative to the library.
        assert_eq!(
            scan(&elf(&[(DT_RUNPATH, b"/opt/../lib:../../lib")])),
            direct(0)
        );
        assert_eq!(
            scan(&elf(&[
                (DT_NEEDED, b"libc.so.6"),
                (DT_RPATH, b"$ORIGIN/.."),
                (DT_RUNPATH, b"$ORIGIN/../../.."),
            ])),
            direct(3)
        );
    }

    #[test]
    fn elf_names_with_origin() {
        for tag in [DT_NEEDED, DT_AUXILIARY, DT_FILTER] {
            assert_eq!(
                scan(&elf(&[(tag, b"$ORIGIN/../../lib/libdep.so")])),
                direct(2),
                "tag {tag:#x}"
            );
        }
        // A name is one path: a `:` does not split it.
        assert_eq!(scan(&elf(&[(DT_NEEDED, b"a:$ORIGIN/../b")])), direct(1));
    }

    #[test]
    fn elf_strings_far_into_the_table() {
        let image = elf_with(&[(DT_RUNPATH, b"$ORIGIN/../..")], 100_000);
        assert_eq!(scan(&image), direct(2));
    }

    #[test]
    fn elf_without_search_paths() {
        let mut no_program_headers = elf(&[(DT_RUNPATH, b"$ORIGIN/..")]);
        no_program_headers[56..58].copy_from_slice(&0u16.to_le_bytes());
        assert_eq!(scan(&no_program_headers), direct(0));

        let mut no_dynamic = elf(&[(DT_RUNPATH, b"$ORIGIN/..")]);
        no_dynamic[EHDR + PHDR..][..4].copy_from_slice(&PT_LOAD.to_le_bytes());
        assert_eq!(scan(&no_dynamic), direct(0));

        for (at, value) in [(EI_CLASS, 1u8), (EI_DATA, 2u8)] {
            let mut other = elf(&[(DT_RUNPATH, b"$ORIGIN/..")]);
            other[at] = value;
            assert_eq!(scan(&other), direct(0));
        }
    }

    #[test]
    fn elf_that_cannot_be_read() {
        let image = elf(&[(DT_RUNPATH, b"$ORIGIN/..")]);
        assert_eq!(scan(&image), direct(1));

        assert_eq!(scan(&image[..EHDR - 1]), Err(Unreadable));
        assert_eq!(scan(&image[..EHDR + PHDR]), Err(Unreadable));
        // The segment says more bytes than the file has.
        assert_eq!(scan(&image[..image.len() - 1]), Err(Unreadable));

        let mut far_table = image.clone();
        far_table[32..40].copy_from_slice(&u64::MAX.to_le_bytes());
        assert_eq!(scan(&far_table), Err(Unreadable));

        let mut small_entries = image.clone();
        small_entries[54..56].copy_from_slice(&55u16.to_le_bytes());
        assert_eq!(scan(&small_entries), Err(Unreadable));

        let mut extended_count = image.clone();
        extended_count[56..58].copy_from_slice(&PN_XNUM.to_le_bytes());
        assert_eq!(scan(&extended_count), Err(Unreadable));

        let mut unmapped_dynamic = image.clone();
        unmapped_dynamic[EHDR + PHDR + 16..][..8].copy_from_slice(&1u64.to_le_bytes());
        assert_eq!(scan(&unmapped_dynamic), Err(Unreadable));

        let strings_field = EHDR + 2 * PHDR + 16 + 8;
        let mut unmapped_strings = image.clone();
        unmapped_strings[strings_field..][..8].copy_from_slice(&1u64.to_le_bytes());
        assert_eq!(scan(&unmapped_strings), Err(Unreadable));

        let mut string_past_the_end = image.clone();
        string_past_the_end[EHDR + 2 * PHDR + 8..][..8].copy_from_slice(&u64::MAX.to_le_bytes());
        assert_eq!(scan(&string_past_the_end), Err(Unreadable));

        let mut no_terminator = image.clone();
        *no_terminator.last_mut().unwrap() = b'x';
        assert_eq!(scan(&no_terminator), Err(Unreadable));

        // Nothing to read a string for: the table is not needed.
        let mut unused_strings = elf(&[]);
        unused_strings[EHDR + 2 * PHDR + 8..][..8].copy_from_slice(&1u64.to_le_bytes());
        assert_eq!(scan(&unused_strings), direct(0));
    }

    fn load_command(kind: u32, string_at: u32, path: &[u8]) -> Vec<u8> {
        let size = (string_at as usize + path.len() + 1).next_multiple_of(8);
        let mut out = Vec::new();
        out.extend_from_slice(&kind.to_le_bytes());
        out.extend_from_slice(&(size as u32).to_le_bytes());
        out.extend_from_slice(&string_at.to_le_bytes());
        out.resize(string_at as usize, 0);
        out.extend_from_slice(path);
        out.resize(size, 0);
        out
    }

    fn rpath(path: &[u8]) -> Vec<u8> {
        load_command(LC_RPATH, 12, path)
    }

    fn dylib(kind: u32, path: &[u8]) -> Vec<u8> {
        load_command(kind, 24, path)
    }

    fn macho(commands: &[Vec<u8>]) -> Vec<u8> {
        let size: usize = commands.iter().map(Vec::len).sum();
        let mut out = Vec::new();
        out.extend_from_slice(&MH_MAGIC_64.to_le_bytes());
        for field in [
            0x0100_000cu32,
            0,
            6,
            commands.len() as u32,
            size as u32,
            0,
            0,
        ] {
            out.extend_from_slice(&field.to_le_bytes());
        }
        assert_eq!(out.len(), size_of::<macho::mach_header_64>());
        for command in commands {
            out.extend_from_slice(command);
        }
        out.extend_from_slice(&[0u8; 64]);
        out
    }

    #[test]
    fn macho_search_paths() {
        assert_eq!(
            scan(&macho(&[dylib(
                LC_LOAD_DYLIB,
                b"/usr/lib/libSystem.B.dylib"
            )])),
            Ok(SearchClimb::default())
        );
        assert_eq!(
            scan(&macho(&[
                rpath(b"@loader_path"),
                dylib(LC_LOAD_DYLIB, b"@rpath/libfoo.dylib"),
            ])),
            Ok(SearchClimb {
                direct: 0,
                rpath: Some(0),
                below_rpath: 0,
            })
        );
        assert_eq!(
            scan(&macho(&[
                rpath(b"@loader_path/../../lib"),
                rpath(b"@loader_path/.."),
                rpath(b"@executable_path/../../../.."),
                dylib(LC_LOAD_DYLIB, b"@rpath/../x/libfoo.dylib"),
                dylib(LC_LOAD_WEAK_DYLIB, b"@loader_path/../../../libbar.dylib"),
                dylib(LC_REEXPORT_DYLIB, b"/opt/../../../../libbaz.dylib"),
            ])),
            Ok(SearchClimb {
                direct: 3,
                rpath: Some(2),
                below_rpath: 1,
            })
        );
        for kind in [
            LC_LOAD_DYLIB,
            LC_LOAD_WEAK_DYLIB,
            LC_REEXPORT_DYLIB,
            LC_LAZY_LOAD_DYLIB,
            LC_LOAD_UPWARD_DYLIB,
        ] {
            assert_eq!(
                scan(&macho(&[dylib(kind, b"@loader_path/../libfoo.dylib")])),
                direct(1),
                "command {kind:#x}"
            );
        }
        // LC_ID_DYLIB names the library itself.
        assert_eq!(
            scan(&macho(&[dylib(0xd, b"@loader_path/../libfoo.dylib")])),
            direct(0)
        );
    }

    #[test]
    fn macho_that_cannot_be_read() {
        let image = macho(&[rpath(b"@loader_path/..")]);
        assert_eq!(scan(&image).map(|climb| climb.rpath), Ok(Some(1)));
        assert_eq!(scan(&image[..31]), Err(Unreadable));
        assert_eq!(scan(&image[..40]), Err(Unreadable));

        let mut one_more_command = image.clone();
        one_more_command[16..20].copy_from_slice(&2u32.to_le_bytes());
        assert_eq!(scan(&one_more_command), Err(Unreadable));

        let mut short_command = image.clone();
        short_command[32 + 4..][..4].copy_from_slice(&4u32.to_le_bytes());
        assert_eq!(scan(&short_command), Err(Unreadable));

        let mut string_past_the_end = image.clone();
        string_past_the_end[32 + 8..][..4].copy_from_slice(&4096u32.to_le_bytes());
        assert_eq!(scan(&string_past_the_end), Err(Unreadable));
    }

    fn universal(wide: bool, images: &[&[u8]]) -> Vec<u8> {
        let entry = if wide { 32 } else { 20 };
        let mut at = (8 + entry * images.len()).next_multiple_of(16);
        let mut out = Vec::new();
        out.extend_from_slice(&(if wide { FAT_MAGIC_64 } else { FAT_MAGIC }).to_be_bytes());
        out.extend_from_slice(&(images.len() as u32).to_be_bytes());
        for image in images {
            out.extend_from_slice(&[0u8; 8]);
            if wide {
                out.extend_from_slice(&(at as u64).to_be_bytes());
                out.extend_from_slice(&(image.len() as u64).to_be_bytes());
                out.extend_from_slice(&[0u8; 8]);
            } else {
                out.extend_from_slice(&(at as u32).to_be_bytes());
                out.extend_from_slice(&(image.len() as u32).to_be_bytes());
                out.extend_from_slice(&[0u8; 4]);
            }
            at = (at + image.len()).next_multiple_of(16);
        }
        for image in images {
            out.resize(out.len().next_multiple_of(16), 0);
            out.extend_from_slice(image);
        }
        out
    }

    #[test]
    fn universal_files() {
        let one = macho(&[rpath(b"@loader_path/..")]);
        let two = macho(&[
            dylib(LC_LOAD_DYLIB, b"@loader_path/../../libfoo.dylib"),
            dylib(LC_LOAD_DYLIB, b"@rpath/../libbar.dylib"),
        ]);
        let other = b"\xce\xfa\xed\xfe a 32-bit image";
        for wide in [false, true] {
            assert_eq!(
                scan(&universal(wide, &[&one, other, &two])),
                Ok(SearchClimb {
                    direct: 2,
                    rpath: Some(1),
                    below_rpath: 1,
                }),
                "wide {wide}"
            );
            assert_eq!(scan(&universal(wide, &[])), direct(0));

            let image = universal(wide, &[&one, &two]);
            assert_eq!(scan(&image[..image.len() - 65]), Err(Unreadable));
            assert_eq!(scan(&image[..12]), Err(Unreadable));
            assert_eq!(
                scan(&universal(wide, &[&one[..one.len() - 70]])),
                Err(Unreadable)
            );
        }
    }

    #[test]
    fn other_files() {
        for bytes in [
            &b""[..],
            b"\x7f",
            b"MZ\x90\x00\x03\x00\x00\x00 a PE image",
            b"INPUT(libfoo.so.1)",
            b"\xce\xfa\xed\xfe",
            b"\xcf\xfa",
            b"$ORIGIN/../../..",
        ] {
            assert_eq!(scan(bytes), direct(0), "{}", bstr::BStr::new(bytes));
        }
        assert_eq!(scan(b"\x7fELF"), Err(Unreadable));
        assert_eq!(scan(b"\xcf\xfa\xed\xfe"), Err(Unreadable));
        assert_eq!(scan(b"\xca\xfe\xba\xbe"), Err(Unreadable));
    }
}
