use core::mem::size_of;
use core::ops::Range;

use bun_sys::elf::PT_LOAD;

pub(crate) use crate::elf::PF_W;
use crate::elf::{Elf64_Ehdr, Elf64_Phdr, Elf64_Shdr, SHN_LORESERVE, read_ehdr, validate_elf64_le};
use crate::image::ImageError;
use crate::{read_struct, write_struct};

// In PT_LOOS..=PT_HIOS: the kernel and every libc skip it.
pub const PT_BUN_RESERVED: u32 = 0x6fb0_0001;
/// Spans the payload's segments. llvm-strip writes a second copy of a section that no single segment contains.
pub const PT_BUN_PAYLOAD: u32 = 0x6fb0_0002;
pub(crate) const PT_NULL: u32 = 0;
pub(crate) const PT_NOTE: u32 = 4;
pub(crate) const PT_PHDR: u32 = 6;
// FreeBSD reads program headers from the first page only (imgact_elf.c, phdr_in_zero_page).
const MAX_TABLE_END_OFFSET: u64 = 4096;
// Linux refuses a table that is larger than a page (binfmt_elf.c, load_elf_phdrs).
const MAX_TABLE_SIZE: u64 = 4096;
const EI_OSABI: usize = 7;
const ELFOSABI_FREEBSD: u8 = 9;
// Type of the note named "Bun\0" whose descriptor is room for the program header table.
pub(crate) const NT_BUN_PROGRAM_HEADER_ROOM: u32 = 1;

const PN_XNUM: u16 = 0xffff;
const PROGRAM_HEADER_SIZE: usize = size_of::<Elf64_Phdr>();
const PROGRAM_HEADER_ALIGNMENT: u64 = 8;
const ROOM_NOTE_NAME: &[u8] = b"Bun\0";

/// `PT_BUN_PAYLOAD`, data before the compiled code, the code, data after it.
pub const PAYLOAD_SEGMENT_COUNT: usize = 4;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ReservedSegment {
    pub header_index: usize,
    pub header_count: usize,
    pub address: u64,
}

pub fn find_reserved_segment(elf: &[u8]) -> Option<ReservedSegment> {
    let ehdr = read_header(elf).ok()?;
    let headers: Vec<Elf64_Phdr> =
        bytes_at(elf, ehdr.e_phoff, table_size(usize::from(ehdr.e_phnum)))?
            .as_chunks::<PROGRAM_HEADER_SIZE>()
            .0
            .iter()
            .map(|bytes| read_struct::<Elf64_Phdr>(bytes))
            .collect();
    let is_reserved = |header: &Elf64_Phdr| header.p_type == PT_BUN_RESERVED;
    let header_index = headers.iter().position(is_reserved)?;
    Some(ReservedSegment {
        header_index,
        header_count: headers[header_index..]
            .iter()
            .take_while(|header| is_reserved(header))
            .count(),
        address: headers[header_index].p_vaddr,
    })
}

pub(crate) fn read_header(elf: &[u8]) -> Result<Elf64_Ehdr, ImageError> {
    validate_elf64_le(elf).map_err(|_| ImageError::UnrecognizedExecutable)?;
    let ehdr = read_ehdr(elf);
    let uses_extended_numbering = ehdr.e_phnum == PN_XNUM
        || usize::from(ehdr.e_shnum) >= SHN_LORESERVE
        || (ehdr.e_shnum == 0 && ehdr.e_shoff != 0);
    let program_headers = HeaderTable {
        offset: ehdr.e_phoff,
        count: ehdr.e_phnum,
        entry_size: ehdr.e_phentsize,
    };
    let section_headers = HeaderTable {
        offset: ehdr.e_shoff,
        count: ehdr.e_shnum,
        entry_size: ehdr.e_shentsize,
    };
    if uses_extended_numbering
        || !program_headers.is_in_file::<Elf64_Phdr>(elf.len())
        || !section_headers.is_in_file::<Elf64_Shdr>(elf.len())
    {
        return Err(ImageError::MalformedHeaders);
    }
    Ok(ehdr)
}

pub(crate) fn bytes_at(bytes: &[u8], offset: u64, size: u64) -> Option<&[u8]> {
    let offset = usize::try_from(offset).ok()?;
    let size = usize::try_from(size).ok()?;
    bytes.get(offset..)?.get(..size)
}

fn bytes_at_mut(bytes: &mut [u8], offset: u64, size: u64) -> Option<&mut [u8]> {
    let offset = usize::try_from(offset).ok()?;
    let size = usize::try_from(size).ok()?;
    bytes.get_mut(offset..)?.get_mut(..size)
}

const fn table_size(header_count: usize) -> u64 {
    (header_count * PROGRAM_HEADER_SIZE) as u64
}

struct HeaderTable {
    offset: u64,
    count: u16,
    entry_size: u16,
}

impl HeaderTable {
    fn is_in_file<Entry>(&self, file_size: usize) -> bool {
        let has_expected_entries =
            self.count == 0 || usize::from(self.entry_size) == size_of::<Entry>();
        let size = u64::from(self.count) * size_of::<Entry>() as u64;
        let end = self.offset.checked_add(size);
        has_expected_entries && end.is_some_and(|end| end <= file_size as u64)
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
pub(crate) struct NoteHeader {
    pub(crate) name_size: u32,
    pub(crate) descriptor_size: u32,
    pub(crate) note_type: u32,
}

#[derive(Copy, Clone)]
struct FileExtent {
    offset: u64,
    size: u64,
}

struct TableLocation {
    file_offset: u64,
    capacity: usize,
    address: Option<u64>,
}

pub(crate) fn note_alignment(segment_alignment: u64) -> usize {
    if segment_alignment == 8 { 8 } else { 4 }
}

pub(crate) fn find_note_descriptor(
    notes: &[u8],
    alignment: usize,
    name: &[u8],
    note_type: u32,
) -> Option<Range<usize>> {
    let mut note_start = 0usize;
    loop {
        let name_start = note_start.checked_add(size_of::<NoteHeader>())?;
        let header: NoteHeader = read_struct(notes.get(note_start..name_start)?);
        let name_end = name_start.checked_add(header.name_size as usize)?;
        let descriptor_start = name_end.checked_next_multiple_of(alignment)?;
        let descriptor_end = descriptor_start.checked_add(header.descriptor_size as usize)?;
        let note_name = notes.get(name_start..name_end)?;
        if descriptor_end > notes.len() {
            return None;
        }
        if header.note_type == note_type && note_name == name {
            return Some(descriptor_start..descriptor_end);
        }
        note_start = descriptor_end.checked_next_multiple_of(alignment)?;
    }
}

fn find_room_descriptor(elf: &[u8], segment: &Elf64_Phdr) -> Option<FileExtent> {
    let notes = bytes_at(elf, segment.p_offset, segment.p_filesz)?;
    let descriptor = find_note_descriptor(
        notes,
        note_alignment(segment.p_align),
        ROOM_NOTE_NAME,
        NT_BUN_PROGRAM_HEADER_ROOM,
    )?;
    Some(FileExtent {
        offset: segment.p_offset + descriptor.start as u64,
        size: descriptor.len() as u64,
    })
}

// Linux before 5.18 computes AT_PHDR as the first segment's p_vaddr - p_offset + e_phoff.
fn find_table_address(headers: &[Elf64_Phdr], table: FileExtent) -> Option<u64> {
    let table_end = table.offset.checked_add(table.size)?;
    headers
        .iter()
        .find(|load| load.p_type == PT_LOAD && load.p_offset == 0 && table_end <= load.p_filesz)
        .and_then(|load| load.p_vaddr.checked_add(table.offset))
}

fn compute_room_capacity(room: FileExtent, os_abi: u8) -> usize {
    let max_size = match os_abi {
        ELFOSABI_FREEBSD => MAX_TABLE_END_OFFSET.saturating_sub(room.offset),
        _ => MAX_TABLE_SIZE,
    };
    (room.size.min(max_size) / PROGRAM_HEADER_SIZE as u64) as usize
}

fn find_room(elf: &[u8], headers: &[Elf64_Phdr]) -> Option<TableLocation> {
    let room = headers
        .iter()
        .filter(|segment| segment.p_type == PT_NOTE)
        .find_map(|segment| find_room_descriptor(elf, segment))?;
    if !room.offset.is_multiple_of(PROGRAM_HEADER_ALIGNMENT) {
        return None;
    }
    let address = find_table_address(headers, room)?;
    Some(TableLocation {
        file_offset: room.offset,
        capacity: compute_room_capacity(room, *elf.get(EI_OSABI)?),
        address: Some(address),
    })
}

pub(crate) struct ProgramHeaderTable {
    pub(crate) headers: Vec<Elf64_Phdr>,
    capacity: usize,
    file_offset: u64,
    address: Option<u64>,
    previous_file_offset: u64,
    previous_count: usize,
}

impl ProgramHeaderTable {
    pub(crate) fn read(elf: &[u8], ehdr: &Elf64_Ehdr) -> Result<ProgramHeaderTable, ImageError> {
        let count = usize::from(ehdr.e_phnum);
        let current = FileExtent {
            offset: ehdr.e_phoff,
            size: table_size(count),
        };
        let headers: Vec<Elf64_Phdr> = bytes_at(elf, current.offset, current.size)
            .ok_or(ImageError::MalformedHeaders)?
            .as_chunks::<PROGRAM_HEADER_SIZE>()
            .0
            .iter()
            .map(|bytes| read_struct(bytes))
            .collect();
        let location = find_room(elf, &headers)
            .filter(|room| room.capacity >= count)
            .unwrap_or_else(|| TableLocation {
                file_offset: current.offset,
                capacity: count,
                address: find_table_address(&headers, current),
            });
        Ok(ProgramHeaderTable {
            headers,
            capacity: location.capacity,
            file_offset: location.file_offset,
            address: location.address,
            previous_file_offset: current.offset,
            previous_count: count,
        })
    }

    pub(crate) fn capacity(&self) -> usize {
        self.capacity
    }

    pub(crate) fn end_file_offset(&self) -> u64 {
        self.file_offset + table_size(self.capacity)
    }

    pub(crate) fn insert_by_address(&mut self, header: Elf64_Phdr) {
        let next_by_address = self.headers.iter().position(|other| {
            matches!(other.p_type, PT_LOAD | PT_BUN_RESERVED) && other.p_vaddr > header.p_vaddr
        });
        let after_last_load = self
            .headers
            .iter()
            .rposition(|other| other.p_type == PT_LOAD)
            .map(|index| index + 1);
        let index = next_by_address
            .or(after_last_load)
            .unwrap_or(self.headers.len());
        self.headers.insert(index, header);
    }

    pub(crate) fn write(&self, elf: &mut [u8]) -> Result<(), ImageError> {
        if self.headers.len() > self.capacity {
            return Err(ImageError::HeaderRoomExhausted);
        }
        let ehdr_bytes = bytes_at(elf, 0, size_of::<Elf64_Ehdr>() as u64);
        let mut ehdr: Elf64_Ehdr = read_struct(ehdr_bytes.ok_or(ImageError::MalformedHeaders)?);
        ehdr.e_phoff = self.file_offset;
        ehdr.e_phnum =
            u16::try_from(self.headers.len()).map_err(|_| ImageError::HeaderRoomExhausted)?;

        let previous_size = table_size(self.previous_count);
        bytes_at_mut(elf, self.previous_file_offset, previous_size)
            .ok_or(ImageError::MalformedHeaders)?
            .fill(0);
        let table = bytes_at_mut(elf, self.file_offset, table_size(self.capacity))
            .ok_or(ImageError::MalformedHeaders)?;
        table.fill(0);
        let entries = table.as_chunks_mut::<PROGRAM_HEADER_SIZE>().0.iter_mut();
        for (entry, header) in entries.zip(&self.headers) {
            write_struct(entry, &self.resolve_table_segment(*header));
        }
        write_struct(elf, &ehdr);
        Ok(())
    }

    fn resolve_table_segment(&self, header: Elf64_Phdr) -> Elf64_Phdr {
        if header.p_type != PT_PHDR {
            return header;
        }
        let size = table_size(self.headers.len());
        Elf64_Phdr {
            p_offset: self.file_offset,
            p_vaddr: self.address.unwrap_or(header.p_vaddr),
            p_paddr: self.address.unwrap_or(header.p_paddr),
            p_filesz: size,
            p_memsz: size,
            ..header
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::align_up;
    use crate::elf::{
        EM_AARCH64, EM_X86_64, SHF_ALLOC, SHF_EXECINSTR, SHF_WRITE, SHT_NOBITS, SHT_PROGBITS,
        SHT_STRTAB,
    };
    use crate::image::Architecture;
    use crate::macho_types::MH_MAGIC_64;

    pub(crate) const BASE_ADDRESS: u64 = 0x20_0000;
    pub(crate) const EHDR_SIZE: u64 = size_of::<Elf64_Ehdr>() as u64;
    pub(crate) const PHDR_SIZE: u64 = PROGRAM_HEADER_SIZE as u64;
    const SHDR_SIZE: usize = size_of::<Elf64_Shdr>();
    pub(crate) const TOY_SEGMENT_COUNT: u64 = 7;
    const NOTE_INDEX: usize = 1;
    const READ_ONLY_INDEX: usize = 2;
    pub(crate) const TEXT_INDEX: usize = 3;
    pub(crate) const DATA_INDEX: usize = 4;
    pub(crate) const DYNAMIC_INDEX: usize = 5;
    pub(crate) const STACK_INDEX: usize = 6;
    pub(crate) const NOTES_OFFSET: u64 = EHDR_SIZE + TOY_SEGMENT_COUNT * PHDR_SIZE;
    pub(crate) const NOTE_HEADER_SIZE: u64 = 16;
    pub(crate) const ROOM_OFFSET: u64 = NOTES_OFFSET + NOTE_HEADER_SIZE;
    const ROOM_SIZE: u32 = 3584;
    pub(crate) const ROOM_CAPACITY: usize = 64;
    pub(crate) const BUILD_ID_NOTE_SIZE: u64 = NOTE_HEADER_SIZE + 20;
    pub(crate) const RODATA_OFFSET: u64 = 0x1100;
    const ET_EXEC: u16 = 2;
    pub(crate) const PT_DYNAMIC: u32 = 2;
    const PT_GNU_STACK: u32 = 0x6474_e551;
    const PF_X: u32 = 1;
    const PF_R: u32 = 4;
    const SHT_DYNAMIC: u32 = 6;
    const SHT_NOTE: u32 = 7;
    const NT_GNU_BUILD_ID: u32 = 3;

    // The top byte of the product differs from page to page, so a shift by whole pages shows.
    pub(crate) fn toy_byte(address: u64) -> u8 {
        (address.wrapping_mul(0x9e37_79b9_7f4a_7c15) >> 56) as u8
    }

    fn create_null_section_header() -> Elf64_Shdr {
        read_struct(&[0u8; SHDR_SIZE])
    }

    fn create_note_header(name: &[u8], note_type: u32, descriptor_size: u32) -> [u8; 16] {
        let mut header = [0; 16];
        header[..4].copy_from_slice(&(name.len() as u32).to_le_bytes());
        header[4..8].copy_from_slice(&descriptor_size.to_le_bytes());
        header[8..12].copy_from_slice(&note_type.to_le_bytes());
        header[12..].copy_from_slice(name);
        header
    }

    fn create_room_note_header(descriptor_size: u32) -> [u8; 16] {
        create_note_header(ROOM_NOTE_NAME, NT_BUN_PROGRAM_HEADER_ROOM, descriptor_size)
    }

    fn create_segment(
        p_type: u32,
        p_flags: u32,
        p_align: u64,
        first: &Elf64_Shdr,
        last: &Elf64_Shdr,
    ) -> Elf64_Phdr {
        let last_file_size = if last.sh_type == SHT_NOBITS {
            0
        } else {
            last.sh_size
        };
        Elf64_Phdr {
            p_type,
            p_flags,
            p_offset: first.sh_offset,
            p_vaddr: first.sh_addr,
            p_paddr: first.sh_addr,
            p_filesz: last.sh_offset + last_file_size - first.sh_offset,
            p_memsz: last.sh_addr + last.sh_size - first.sh_addr,
            p_align,
        }
    }

    struct ToyBuilder {
        page_size: u64,
        bytes: Vec<u8>,
        address: u64,
        section_names: Vec<u8>,
        sections: Vec<Elf64_Shdr>,
    }

    impl ToyBuilder {
        fn append_pattern(&mut self, size: u64) {
            let addresses = self.address..self.address + size;
            self.bytes.extend(addresses.map(toy_byte));
            self.address += size;
        }

        fn start_segment(&mut self) {
            let page_offset = self.bytes.len() as u64 % self.page_size;
            self.address = align_up(self.address, self.page_size) + page_offset;
        }

        fn add_section(&mut self, name: &str, kind: u32, flags: u64, size: u64) -> Elf64_Shdr {
            let is_allocated = flags & SHF_ALLOC != 0;
            let header = Elf64_Shdr {
                sh_name: self.section_names.len() as u32,
                sh_type: kind,
                sh_flags: flags,
                sh_addr: if is_allocated { self.address } else { 0 },
                sh_offset: self.bytes.len() as u64,
                sh_size: size,
                sh_addralign: 1,
                ..create_null_section_header()
            };
            self.section_names.extend_from_slice(name.as_bytes());
            self.section_names.push(0);
            self.sections.push(header);
            if kind == SHT_NOBITS {
                self.address += size;
            } else {
                self.append_pattern(size);
            }
            header
        }

        fn finish(mut self, e_machine: u16, e_entry: u64, segments: &[Elf64_Phdr]) -> Vec<u8> {
            let names_size = (self.section_names.len() + ".shstrtab\0".len()) as u64;
            let names = self.add_section(".shstrtab", SHT_STRTAB, 0, names_size);
            write_bytes(&mut self.bytes, names.sh_offset, &self.section_names);

            let e_shoff = align_up(self.bytes.len() as u64, 8);
            let file_size = e_shoff as usize + self.sections.len() * SHDR_SIZE;
            self.bytes.resize(file_size, 0);
            let entries = self.bytes[e_shoff as usize..]
                .as_chunks_mut::<SHDR_SIZE>()
                .0
                .iter_mut();
            for (entry, section) in entries.zip(&self.sections) {
                write_struct(entry, section);
            }
            let entries = self.bytes[EHDR_SIZE as usize..]
                .as_chunks_mut::<PROGRAM_HEADER_SIZE>()
                .0
                .iter_mut();
            for (entry, segment) in entries.zip(segments) {
                write_struct(entry, segment);
            }
            let ehdr = Elf64_Ehdr {
                e_ident: *b"\x7fELF\x02\x01\x01\0\0\0\0\0\0\0\0\0",
                e_type: ET_EXEC,
                e_machine,
                e_version: 1,
                e_entry,
                e_phoff: EHDR_SIZE,
                e_shoff,
                e_flags: 0,
                e_ehsize: EHDR_SIZE as u16,
                e_phentsize: PHDR_SIZE as u16,
                e_phnum: segments.len() as u16,
                e_shentsize: SHDR_SIZE as u16,
                e_shnum: self.sections.len() as u16,
                e_shstrndx: self.sections.len() as u16 - 1,
            };
            write_struct(&mut self.bytes, &ehdr);
            self.bytes
        }
    }

    pub(crate) fn toy_elf(architecture: Architecture, has_room: bool) -> Vec<u8> {
        let (e_machine, page_size) = match architecture {
            Architecture::X86_64 => (EM_X86_64, 0x1000),
            Architecture::Aarch64 => (EM_AARCH64, 0x1_0000),
        };
        let mut toy = ToyBuilder {
            page_size,
            bytes: Vec::new(),
            address: BASE_ADDRESS,
            section_names: vec![0],
            sections: vec![create_null_section_header()],
        };
        let executable = SHF_ALLOC | SHF_EXECINSTR;
        let writable = SHF_ALLOC | SHF_WRITE;
        let room_note_size = NOTE_HEADER_SIZE + u64::from(ROOM_SIZE);

        toy.append_pattern(NOTES_OFFSET);
        let room_note =
            has_room.then(|| toy.add_section(".note.bun", SHT_NOTE, SHF_ALLOC, room_note_size));
        let build_id_name = ".note.gnu.build-id";
        let build_id_note = toy.add_section(build_id_name, SHT_NOTE, SHF_ALLOC, BUILD_ID_NOTE_SIZE);
        toy.append_pattern(RODATA_OFFSET - toy.bytes.len() as u64);
        toy.add_section(".rodata", SHT_PROGBITS, SHF_ALLOC, 8 * page_size);
        toy.add_section(".bun_builtins", SHT_PROGBITS, SHF_ALLOC, 0x300);
        toy.add_section(".bun_trim", SHT_PROGBITS, SHF_ALLOC, 0x1000);
        let features = toy.add_section(".bun_features", SHT_PROGBITS, SHF_ALLOC, 0x400);
        toy.start_segment();
        let text = toy.add_section(".text", SHT_PROGBITS, executable, 8 * page_size);
        toy.start_segment();
        let dynamic = toy.add_section(".dynamic", SHT_DYNAMIC, writable, 0x100);
        toy.add_section(".data", SHT_PROGBITS, writable, 2 * page_size);
        let payload = toy.add_section(".bun", SHT_PROGBITS, writable, 16);
        let bss = toy.add_section(".bss", SHT_NOBITS, writable, 2 * page_size);
        toy.add_section(".comment", SHT_PROGBITS, 0, 0x20);

        if let Some(note) = room_note {
            let header = create_room_note_header(ROOM_SIZE);
            write_bytes(&mut toy.bytes, note.sh_offset, &header);
        }
        let build_id_header = create_note_header(b"GNU\0", NT_GNU_BUILD_ID, 20);
        write_bytes(&mut toy.bytes, build_id_note.sh_offset, &build_id_header);
        write_bytes(&mut toy.bytes, payload.sh_offset, &[0; 16]);

        let file_start = Elf64_Shdr {
            sh_addr: BASE_ADDRESS,
            ..create_null_section_header()
        };
        let table = Elf64_Shdr {
            sh_addr: BASE_ADDRESS + EHDR_SIZE,
            sh_offset: EHDR_SIZE,
            sh_size: TOY_SEGMENT_COUNT * PHDR_SIZE,
            ..create_null_section_header()
        };
        let first_note = room_note.unwrap_or(build_id_note);
        let note_alignment = if has_room { 8 } else { 4 };
        let segments = [
            create_segment(PT_PHDR, PF_R, 8, &table, &table),
            create_segment(PT_NOTE, PF_R, note_alignment, &first_note, &build_id_note),
            create_segment(PT_LOAD, PF_R, page_size, &file_start, &features),
            create_segment(PT_LOAD, PF_R | PF_X, page_size, &text, &text),
            create_segment(PT_LOAD, PF_R | PF_W, page_size, &dynamic, &bss),
            create_segment(PT_DYNAMIC, PF_R | PF_W, 8, &dynamic, &dynamic),
            Elf64_Phdr {
                p_type: PT_GNU_STACK,
                p_flags: PF_R | PF_W,
                ..Elf64_Phdr::ZEROED
            },
        ];
        toy.finish(e_machine, text.sh_addr, &segments)
    }

    fn toy() -> Vec<u8> {
        toy_elf(Architecture::X86_64, true)
    }

    pub(crate) fn edited(original: &[u8], edit: impl FnOnce(&mut Vec<u8>)) -> Vec<u8> {
        let mut elf = original.to_vec();
        edit(&mut elf);
        elf
    }

    fn write_bytes(elf: &mut [u8], offset: u64, bytes: &[u8]) {
        elf[offset as usize..][..bytes.len()].copy_from_slice(bytes);
    }

    pub(crate) fn edit_header(elf: &mut [u8], edit: impl FnOnce(&mut Elf64_Ehdr)) {
        let mut ehdr = read_ehdr(elf);
        edit(&mut ehdr);
        write_struct(elf, &ehdr);
    }

    pub(crate) fn edit_segment(elf: &mut [u8], index: usize, edit: impl FnOnce(&mut Elf64_Phdr)) {
        let offset = read_ehdr(elf).e_phoff as usize + index * PROGRAM_HEADER_SIZE;
        let mut segment: Elf64_Phdr = read_struct(&elf[offset..]);
        edit(&mut segment);
        write_struct(&mut elf[offset..], &segment);
    }

    fn read_table(elf: &[u8]) -> ProgramHeaderTable {
        ProgramHeaderTable::read(elf, &read_header(elf).unwrap()).unwrap()
    }

    pub(crate) fn segments_of_type(elf: &[u8], p_type: u32) -> Vec<Elf64_Phdr> {
        let mut segments = read_table(elf).headers;
        segments.retain(|segment| segment.p_type == p_type);
        segments
    }

    pub(crate) fn is_zero_at(elf: &[u8], offset: u64, size: u64) -> bool {
        let bytes = bytes_at(elf, offset, size).unwrap();
        bytes.iter().all(|byte| *byte == 0)
    }

    #[test]
    fn malformed_headers_are_errors() {
        let edits: [fn(&mut Elf64_Ehdr); 9] = [
            |ehdr| ehdr.e_phnum = 0xfffe,
            |ehdr| ehdr.e_phnum = PN_XNUM,
            |ehdr| ehdr.e_phentsize = 32,
            |ehdr| ehdr.e_phoff = u64::MAX - 8,
            |ehdr| ehdr.e_shentsize = 40,
            |ehdr| ehdr.e_shnum = 0xff00,
            |ehdr| ehdr.e_shnum = 0,
            |ehdr| ehdr.e_shoff += 8,
            |ehdr| ehdr.e_shoff = u64::MAX - 8,
        ];
        for edit in edits {
            let elf = edited(&toy(), |elf| edit_header(elf, edit));
            assert_eq!(read_header(&elf).err(), Some(ImageError::MalformedHeaders));
        }
    }

    #[test]
    fn other_files_are_not_recognized() {
        let toy = toy();
        let mut macho = vec![0; 4096];
        macho[..4].copy_from_slice(&MH_MAGIC_64.to_le_bytes());
        let files = [
            toy[..63].to_vec(),
            macho,
            edited(&toy, |elf| elf[4] = 1),
            edited(&toy, |elf| elf[5] = 2),
        ];
        for file in &files {
            let error = read_header(file).err();
            assert_eq!(error, Some(ImageError::UnrecognizedExecutable));
            assert_eq!(find_reserved_segment(file), None);
        }
        assert_eq!(find_reserved_segment(&toy), None);
    }

    fn misalign_room(elf: &mut Vec<u8>) {
        let header = create_room_note_header(ROOM_SIZE - 4);
        write_bytes(elf, NOTES_OFFSET + 4, &header);
        edit_segment(elf, NOTE_INDEX, |segment| {
            segment.p_offset += 4;
            segment.p_filesz -= 4;
            segment.p_align = 4;
        });
    }

    fn move_room_past_first_page(elf: &mut Vec<u8>) {
        elf[EI_OSABI] = ELFOSABI_FREEBSD;
        let header = create_room_note_header(ROOM_SIZE);
        write_bytes(elf, MAX_TABLE_END_OFFSET, &header);
        edit_segment(elf, NOTE_INDEX, |segment| {
            segment.p_offset = MAX_TABLE_END_OFFSET;
            segment.p_filesz = NOTE_HEADER_SIZE + u64::from(ROOM_SIZE);
        });
    }

    #[test]
    fn unusable_room_is_ignored() {
        let toy = toy();
        let with_note =
            |header: [u8; 16]| edited(&toy, |elf| write_bytes(elf, NOTES_OFFSET, &header));
        let with_segment = |index: usize, edit: fn(&mut Elf64_Phdr)| {
            edited(&toy, |elf| edit_segment(elf, index, edit))
        };
        let room_type = NT_BUN_PROGRAM_HEADER_ROOM;
        let mut oversized_name = create_room_note_header(ROOM_SIZE);
        oversized_name[..4].fill(0xff);
        let unusable = [
            with_note(create_room_note_header(PHDR_SIZE as u32)),
            with_note(create_room_note_header(u32::MAX)),
            with_note(create_note_header(ROOM_NOTE_NAME, room_type + 1, ROOM_SIZE)),
            with_note(create_note_header(b"GNU\0", room_type, ROOM_SIZE)),
            with_note(oversized_name),
            edited(&toy, misalign_room),
            edited(&toy, move_room_past_first_page),
            with_segment(NOTE_INDEX, |segment| segment.p_offset = u64::MAX),
            with_segment(READ_ONLY_INDEX, |segment| segment.p_filesz = ROOM_OFFSET),
        ];
        for elf in &unusable {
            let table = read_table(elf);
            assert_eq!(table.capacity(), TOY_SEGMENT_COUNT as usize);
            assert_eq!(table.end_file_offset(), NOTES_OFFSET);
        }
    }

    #[test]
    fn room_capacity_ends_in_first_page_on_freebsd() {
        let compute_capacity_at = |offset: u64| {
            let size = u64::from(ROOM_SIZE);
            compute_room_capacity(FileExtent { offset, size }, ELFOSABI_FREEBSD)
        };
        assert_eq!(compute_capacity_at(ROOM_OFFSET), ROOM_CAPACITY);
        assert_eq!(compute_capacity_at(0x3a0), 56);
        assert_eq!(compute_capacity_at(MAX_TABLE_END_OFFSET - PHDR_SIZE), 1);
        assert_eq!(compute_capacity_at(MAX_TABLE_END_OFFSET - PHDR_SIZE + 8), 0);
        assert_eq!(compute_capacity_at(MAX_TABLE_END_OFFSET + 8), 0);

        let notes_size = RODATA_OFFSET - NOTES_OFFSET;
        let room_size = notes_size - NOTE_HEADER_SIZE;
        assert!(room_size / PHDR_SIZE > ROOM_CAPACITY as u64);
        let mut elf = toy();
        let header = create_room_note_header(room_size as u32);
        write_bytes(&mut elf, NOTES_OFFSET, &header);
        edit_segment(&mut elf, NOTE_INDEX, |segment| {
            segment.p_filesz = notes_size
        });
        assert_eq!(read_table(&elf).capacity() as u64, room_size / PHDR_SIZE);

        elf[EI_OSABI] = ELFOSABI_FREEBSD;
        let table = read_table(&elf);
        assert_eq!(table.capacity(), ROOM_CAPACITY);
        assert!(table.end_file_offset() <= MAX_TABLE_END_OFFSET);
    }

    #[test]
    fn room_capacity_is_one_page_on_linux() {
        let compute_capacity = |offset: u64, size: u64| {
            const ELFOSABI_NONE: u8 = 0;
            compute_room_capacity(FileExtent { offset, size }, ELFOSABI_NONE)
        };
        assert_eq!(compute_capacity(0x2f8, 73 * PHDR_SIZE), 73);
        assert_eq!(compute_capacity(0x2f8, 2 * MAX_TABLE_SIZE), 73);
        assert_eq!(compute_capacity(2 * MAX_TABLE_END_OFFSET, PHDR_SIZE), 1);
    }

    #[test]
    fn room_follows_another_note() {
        let mut elf = toy();
        let room_note_offset = ROOM_OFFSET + 8;
        let room_size = ROOM_SIZE - 8 - NOTE_HEADER_SIZE as u32;
        let other_type = NT_BUN_PROGRAM_HEADER_ROOM + 1;
        let other_note = create_note_header(ROOM_NOTE_NAME, other_type, 8);
        write_bytes(&mut elf, NOTES_OFFSET, &other_note);
        write_bytes(
            &mut elf,
            room_note_offset,
            &create_room_note_header(room_size),
        );

        let table = read_table(&elf);
        assert_eq!(table.capacity(), ROOM_CAPACITY - 1);
        table.write(&mut elf).unwrap();
        assert_eq!(read_ehdr(&elf).e_phoff, room_note_offset + NOTE_HEADER_SIZE);
    }

    #[test]
    fn insert_by_address_orders_loadable_headers() {
        let reserve = |p_vaddr: u64| Elf64_Phdr {
            p_type: PT_BUN_RESERVED,
            p_vaddr,
            ..Elf64_Phdr::ZEROED
        };
        let mut table = read_table(&toy());
        table.insert_by_address(reserve(u64::MAX));
        assert_eq!(table.headers[DATA_INDEX + 1].p_type, PT_BUN_RESERVED);

        table.headers.retain(|header| header.p_type != PT_LOAD);
        table.insert_by_address(reserve(0x1000));
        assert_eq!(table.headers[READ_ONLY_INDEX].p_vaddr, 0x1000);

        table
            .headers
            .retain(|header| header.p_type != PT_BUN_RESERVED);
        table.insert_by_address(reserve(0x1000));
        assert_eq!(table.headers.last().unwrap().p_type, PT_BUN_RESERVED);
    }

    #[test]
    fn write_moves_table_into_room() {
        let mut elf = toy();
        let mut table = read_table(&elf);
        assert_eq!(table.capacity(), ROOM_CAPACITY);
        table.write(&mut elf).unwrap();

        let ehdr = read_header(&elf).unwrap();
        let table_size = TOY_SEGMENT_COUNT * PHDR_SIZE;
        let unused_size = u64::from(ROOM_SIZE) - table_size;
        assert_eq!(ehdr.e_phoff, ROOM_OFFSET);
        assert_eq!(u64::from(ehdr.e_phnum), TOY_SEGMENT_COUNT);
        assert!(is_zero_at(&elf, EHDR_SIZE, table_size));
        assert!(is_zero_at(&elf, ROOM_OFFSET + table_size, unused_size));
        let note_header = create_room_note_header(ROOM_SIZE);
        assert_eq!(bytes_at(&elf, NOTES_OFFSET, 16), Some(&note_header[..]));

        table.headers.resize(ROOM_CAPACITY + 1, Elf64_Phdr::ZEROED);
        assert_eq!(table.write(&mut elf), Err(ImageError::HeaderRoomExhausted));
    }
}
