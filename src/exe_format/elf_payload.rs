use core::mem::size_of;
use core::ops::Range;

use bun_sys::elf::PT_LOAD;

use crate::elf::{
    BunSectionInfo, Elf64_Ehdr, Elf64_Phdr, Elf64_Shdr, ElfError, ElfFile, PF_W, SHF_ALLOC,
    SHF_TLS, SHT_NOBITS, read_ehdr, validate_elf64_le, write_u64_le,
};
use crate::elf_program_headers::{
    PAYLOAD_SEGMENT_COUNT, PT_BUN_PAYLOAD, PT_NULL, find_reserved_segment,
};
use crate::{align_up, read_struct, write_struct};

pub enum Piece<'a> {
    Bytes(&'a [u8]),
    Zeros(u64),
    Length([u8; 8]),
}

impl Piece<'_> {
    pub fn len(&self) -> u64 {
        match self {
            Piece::Bytes(bytes) => bytes.len() as u64,
            Piece::Zeros(count) => *count,
            Piece::Length(length) => length.len() as u64,
        }
    }
}

#[derive(Copy, Clone)]
struct ProgramHeaderWrite {
    file_offset: u64,
    header: Elf64_Phdr,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum ReservedSegmentUse {
    Absent,
    HoldsPayload {
        header_index: usize,
        header_count: usize,
        address: u64,
    },
    Unused {
        header_index: usize,
        header_count: usize,
    },
}

const PF_X: u32 = 1;
const PF_R: u32 = 4;

struct PayloadMapping {
    address: u64,
    file_offset: u64,
    header_index: usize,
    header: Elf64_Phdr,
}

impl PayloadMapping {
    /// `code` is relative to the start of the section.
    fn split_at_code(&self, code: &Range<u64>) -> [Elf64_Phdr; PAYLOAD_SEGMENT_COUNT] {
        let piece = |range: Range<u64>, p_flags: u32| match range.is_empty() {
            true => Elf64_Phdr::ZEROED,
            false => Elf64_Phdr {
                p_flags,
                p_offset: self.header.p_offset + range.start,
                p_vaddr: self.header.p_vaddr + range.start,
                p_paddr: self.header.p_paddr + range.start,
                p_filesz: range.end - range.start,
                p_memsz: range.end - range.start,
                ..self.header
            },
        };
        [
            Elf64_Phdr {
                p_type: PT_BUN_PAYLOAD,
                p_flags: PF_R,
                ..self.header
            },
            piece(0..code.start, PF_R),
            piece(code.clone(), PF_R | PF_X),
            piece(code.end..self.header.p_filesz, PF_R),
        ]
    }
}

struct PayloadPlace {
    replaces_payload: bool,
    mapping: PayloadMapping,
    spare_headers: Range<usize>,
    tail: Range<u64>,
}

struct LoadSegments {
    rw_index: usize,
    rw_phdr: Elf64_Phdr,
    max_vaddr_end: u64,
    next_vaddr: u64,
}

impl LoadSegments {
    fn compute_appended_mapping(
        &self,
        replaced_address: Option<u64>,
        aligned_size: u64,
        page_size: u64,
    ) -> Result<PayloadMapping, ElfError> {
        let rw_phdr = self.rw_phdr;

        // Place the new data at a page-aligned virtual address past every existing mapping; a payload from an earlier call keeps its address.
        let address = match replaced_address {
            Some(address) => address,
            None => self
                .max_vaddr_end
                .checked_next_multiple_of(page_size)
                .ok_or(ElfError::InvalidElfFile)?,
        };

        // Sanity: `max_vaddr_end` already reflects the RW segment's full memsz range (`find_load_segments` folds every PT_LOAD), so address is past it by construction.
        if replaced_address.is_none() && address < rw_phdr.p_vaddr + rw_phdr.p_memsz {
            return Err(ElfError::NewVaddrCollides);
        }
        if replaced_address.is_some() && address.saturating_add(aligned_size) > self.next_vaddr {
            return Err(ElfError::NewVaddrCollides);
        }
        let offset_in_segment = address - rw_phdr.p_vaddr;
        let file_offset = rw_phdr
            .p_offset
            .checked_add(offset_in_segment)
            .ok_or(ElfError::InvalidElfFile)?;

        // Extend the existing writable PT_LOAD to cover the appended payload.
        let segment_size = offset_in_segment
            .checked_add(aligned_size)
            .ok_or(ElfError::InvalidElfFile)?;
        let header = Elf64_Phdr {
            p_filesz: segment_size,
            p_memsz: segment_size,
            ..rw_phdr
        };

        Ok(PayloadMapping {
            address,
            file_offset,
            header_index: self.rw_index,
            header,
        })
    }
}

const ET_EXEC: u16 = 2;

struct PayloadPlan {
    replaces_payload: bool,
    /// `.bun` as linked: where BUN_COMPILED holds the payload's address.
    pointer_file_offset: u64,
    section_index: u16,
    address: u64,
    file_offset: u64,
    content_size: u64,
    aligned_size: u64,
    tail_start: u64,
    tail_end: u64,
    moved_tail_start: u64,
    section_headers_offset: u64,
    section_count: u16,
    header_writes: Vec<ProgramHeaderWrite>,
}

impl PayloadPlan {
    /// Bytes below this offset neither move nor get overwritten by the payload.
    fn head_end(&self) -> u64 {
        if self.replaces_payload {
            self.file_offset
        } else {
            self.tail_start
        }
    }

    fn has_headers_in_head(&self) -> bool {
        let head_end = self.head_end();
        let phdr_size = size_of::<Elf64_Phdr>();
        let is_in_head = |offset: u64, size: usize| {
            offset
                .checked_add(size as u64)
                .is_some_and(|end| end <= head_end)
        };
        head_end <= self.file_offset
            && is_in_head(0, size_of::<Elf64_Ehdr>())
            && self
                .header_writes
                .iter()
                .all(|write| is_in_head(write.file_offset, phdr_size))
            && (self.replaces_payload || is_in_head(self.pointer_file_offset, size_of::<u64>()))
    }

    fn moved_tail_offset(&self, offset: u64) -> u64 {
        // Subtract first: a smaller payload moves the tail down.
        offset - self.tail_start + self.moved_tail_start
    }
}

impl<'a> ElfFile<&'a mut [u8]> {
    pub fn over(data: &'a mut [u8]) -> Result<ElfFile<&'a mut [u8]>, ElfError> {
        validate_elf64_le(data)?;
        Ok(ElfFile { data })
    }

    /// Find the `.bun` section and place `payload` so the kernel `mmap`s it at exec time alongside the rest of the binary.
    pub fn bun_section_in_pieces(
        mut self,
        payload: &'a [u8],
        code: Option<Range<u64>>,
    ) -> Result<[Piece<'a>; 6], ElfError> {
        let plan = self.plan_payload(payload.len() as u64, code)?;
        self.write_payload_headers(&plan);

        let head_end = plan.head_end();
        let data: &'a [u8] = self.data;
        Ok([
            Piece::Bytes(&data[..usize::try_from(head_end).expect("int cast")]),
            Piece::Zeros(plan.file_offset - head_end),
            Piece::Length((payload.len() as u64).to_le_bytes()),
            Piece::Bytes(payload),
            Piece::Zeros(plan.aligned_size - plan.content_size),
            Piece::Bytes(
                &data[usize::try_from(plan.tail_start).expect("int cast")
                    ..usize::try_from(plan.tail_end).expect("int cast")],
            ),
        ])
    }
}

impl<D: core::ops::DerefMut<Target = [u8]>> ElfFile<D> {
    /// Where the first byte of a payload of this length is at run time. `None`: the loader chooses where the executable goes.
    pub fn payload_address(&self, payload_length: u64) -> Result<Option<u64>, ElfError> {
        if read_ehdr(&self.data).e_type != ET_EXEC {
            return Ok(None);
        }
        let plan = self.plan_payload(payload_length, None)?;
        // The payload stands behind its length.
        Ok(Some(plan.address + size_of::<u64>() as u64))
    }

    fn plan_payload(
        &self,
        payload_length: u64,
        code: Option<Range<u64>>,
    ) -> Result<PayloadPlan, ElfError> {
        let ehdr = read_ehdr(&self.data);
        let bun_section = self.find_bun_section(ehdr)?;
        let page_size = Self::page_size(ehdr);

        let content_size: u64 = size_of::<u64>() as u64 + payload_length;
        let aligned_size = align_up(content_size, page_size);

        let place = match self.find_payload_span(ehdr, &bun_section, page_size)? {
            Some((header_index, span)) => {
                self.place_over_span(ehdr, header_index, span, aligned_size)?
            }
            None => self.place_on_linked_segments(ehdr, &bun_section, aligned_size, page_size)?,
        };
        let PayloadPlace {
            replaces_payload,
            mapping,
            spare_headers,
            tail,
        } = place;
        let header_size = size_of::<u64>() as u64;
        let code_in_section = code
            .map(|code| code.start + header_size..code.end + header_size)
            .filter(|code| {
                code.start.is_multiple_of(page_size)
                    && code.end.is_multiple_of(page_size)
                    && code.start < code.end
                    && code.end <= aligned_size
            });
        let header_write = |index: usize, header: Elf64_Phdr| ProgramHeaderWrite {
            file_offset: ehdr.e_phoff + (index * size_of::<Elf64_Phdr>()) as u64,
            header,
        };
        let has_own_segment = spare_headers.contains(&mapping.header_index);
        let mut header_writes: Vec<ProgramHeaderWrite> = spare_headers
            .clone()
            .map(|index| header_write(index, Elf64_Phdr::ZEROED))
            .collect();
        match code_in_section {
            Some(code) if has_own_segment && spare_headers.len() >= PAYLOAD_SEGMENT_COUNT => {
                for (write, header) in header_writes.iter_mut().zip(mapping.split_at_code(&code)) {
                    write.header = header;
                }
            }
            _ if has_own_segment => header_writes[0].header = mapping.header,
            _ => header_writes.push(header_write(mapping.header_index, mapping.header)),
        }

        let moved_tail_start = mapping
            .file_offset
            .checked_add(aligned_size)
            .filter(|start| start.checked_add(tail.end - tail.start).is_some())
            .ok_or(ElfError::InvalidElfFile)?;

        let plan = PayloadPlan {
            replaces_payload,
            pointer_file_offset: bun_section.file_offset,
            section_index: bun_section.section_index,
            address: mapping.address,
            file_offset: mapping.file_offset,
            content_size,
            aligned_size,
            tail_start: tail.start,
            tail_end: tail.end,
            moved_tail_start,
            section_headers_offset: ehdr.e_shoff,
            section_count: ehdr.e_shnum,
            header_writes,
        };
        // `write_payload_headers` writes at offsets read before the tail moves.
        if !plan.has_headers_in_head() {
            return Err(ElfError::InvalidElfFile);
        }
        Ok(plan)
    }

    fn place_on_linked_segments(
        &self,
        ehdr: Elf64_Ehdr,
        bun_section: &BunSectionInfo,
        aligned_size: u64,
        page_size: u64,
    ) -> Result<PayloadPlace, ElfError> {
        let segments = self.find_load_segments(ehdr, bun_section.vaddr)?;
        let rw_phdr = segments.rw_phdr;
        let replaces_payload = self.bun_section_is_payload(
            ehdr,
            bun_section,
            &rw_phdr,
            segments.max_vaddr_end,
            page_size,
        )?;
        let replaced_address = replaces_payload.then_some(bun_section.vaddr);
        let appended =
            segments.compute_appended_mapping(replaced_address, aligned_size, page_size)?;
        let tail = self.find_tail(ehdr, &rw_phdr)?;

        let reserved = self.reserved_segment(
            replaces_payload,
            segments.max_vaddr_end,
            aligned_size,
            page_size,
        );
        let (mapping, spare_headers) = match reserved {
            ReservedSegmentUse::HoldsPayload {
                header_index,
                header_count,
                address,
            } => {
                // The writable segment stays as it is, so `.bss` gets no file bytes.
                let file_offset = align_up(tail.start, page_size);
                let header = Elf64_Phdr {
                    p_offset: file_offset,
                    p_vaddr: address,
                    p_paddr: address,
                    p_filesz: aligned_size,
                    p_memsz: aligned_size,
                    p_align: page_size,
                    ..rw_phdr
                };
                let mapping = PayloadMapping {
                    address,
                    file_offset,
                    header_index,
                    header,
                };
                (mapping, header_index..header_index + header_count)
            }
            ReservedSegmentUse::Unused {
                header_index,
                header_count,
            } => (appended, header_index..header_index + header_count),
            ReservedSegmentUse::Absent => (appended, 0..0),
        };
        Ok(PayloadPlace {
            replaces_payload,
            mapping,
            spare_headers,
            tail,
        })
    }

    /// The header that spans a payload with compiled code from an earlier build (`split_at_code`), and its index.
    fn find_payload_span(
        &self,
        ehdr: Elf64_Ehdr,
        bun_section: &BunSectionInfo,
        page_size: u64,
    ) -> Result<Option<(usize, Elf64_Phdr)>, ElfError> {
        let phdr_size = size_of::<Elf64_Phdr>();
        let headers: Vec<Elf64_Phdr> = usize::try_from(ehdr.e_phoff)
            .ok()
            .and_then(|offset| {
                self.data
                    .get(offset..)?
                    .get(..ehdr.e_phnum as usize * phdr_size)
            })
            .ok_or(ElfError::InvalidElfFile)?
            .chunks_exact(phdr_size)
            .map(read_struct::<Elf64_Phdr>)
            .collect();
        let Some(header_index) = headers
            .iter()
            .position(|header| header.p_type == PT_BUN_PAYLOAD)
        else {
            return Ok(None);
        };
        let span = headers[header_index];
        let span_end = span
            .p_vaddr
            .checked_add(span.p_memsz)
            .ok_or(ElfError::InvalidElfFile)?;
        let pieces = header_index + 1..header_index + PAYLOAD_SEGMENT_COUNT;
        let is_piece = |header: &Elf64_Phdr| {
            header.p_type == PT_NULL
                || (header.p_type == PT_LOAD
                    && header.p_vaddr >= span.p_vaddr
                    && header
                        .p_vaddr
                        .checked_add(header.p_memsz)
                        .is_some_and(|end| end <= span_end))
        };
        let spans_section = span.p_vaddr == bun_section.vaddr
            && span.p_offset == bun_section.file_offset
            && span.p_filesz == span.p_memsz
            && bun_section.size.checked_next_multiple_of(page_size) == Some(span.p_filesz);
        let is_followed_by_pieces = headers
            .get(pieces.clone())
            .is_some_and(|pieces| pieces.iter().all(is_piece));
        // Nothing is mapped past the payload, so a longer one runs into no other mapping.
        let is_highest = headers.iter().enumerate().all(|(index, header)| {
            header.p_type != PT_LOAD
                || pieces.contains(&index)
                || header
                    .p_vaddr
                    .checked_add(header.p_memsz)
                    .is_some_and(|end| end <= span.p_vaddr)
        });
        match spans_section && is_followed_by_pieces && is_highest {
            true => Ok(Some((header_index, span))),
            false => Err(ElfError::BunSectionAlreadyWritten),
        }
    }

    /// The new payload takes the address, the place in the file and the headers of the one that `span` covers.
    fn place_over_span(
        &self,
        ehdr: Elf64_Ehdr,
        header_index: usize,
        span: Elf64_Phdr,
        aligned_size: u64,
    ) -> Result<PayloadPlace, ElfError> {
        span.p_vaddr
            .checked_add(aligned_size)
            .ok_or(ElfError::InvalidElfFile)?;
        let tail = self.find_tail(ehdr, &span)?;
        let header = Elf64_Phdr {
            p_type: PT_LOAD,
            p_flags: PF_R | PF_W,
            p_filesz: aligned_size,
            p_memsz: aligned_size,
            ..span
        };
        Ok(PayloadPlace {
            replaces_payload: true,
            mapping: PayloadMapping {
                address: span.p_vaddr,
                file_offset: span.p_offset,
                header_index,
                header,
            },
            spare_headers: header_index..header_index + PAYLOAD_SEGMENT_COUNT,
            tail,
        })
    }

    fn find_load_segments(
        &self,
        ehdr: Elf64_Ehdr,
        bun_section_vaddr: u64,
    ) -> Result<LoadSegments, ElfError> {
        let phdr_size = size_of::<Elf64_Phdr>();
        let is_table_in_file = ehdr
            .e_phoff
            .checked_add(ehdr.e_phnum as u64 * phdr_size as u64)
            .is_some_and(|table_end| table_end <= self.data.len() as u64);
        if !is_table_in_file {
            return Err(ElfError::InvalidElfFile);
        }

        // Extend the writable PT_LOAD that contains `.bun` (matched by vaddr, not "first writable": patchelf'd templates have an extra writable PT_LOAD holding the relocated PHDR + `.interp`, #31023).
        let mut rw_segment: Option<(usize, Elf64_Phdr)> = None;
        let mut max_vaddr_end: u64 = 0;
        let mut next_vaddr = u64::MAX;
        for i in 0..ehdr.e_phnum as usize {
            let phdr_offset = usize::try_from(ehdr.e_phoff).expect("int cast") + i * phdr_size;
            let phdr: Elf64_Phdr = read_struct(&self.data[phdr_offset..][..phdr_size]);
            if phdr.p_type != PT_LOAD {
                continue;
            }

            let vaddr_end = phdr
                .p_vaddr
                .checked_add(phdr.p_memsz)
                .ok_or(ElfError::InvalidElfFile)?;
            if vaddr_end > max_vaddr_end {
                max_vaddr_end = vaddr_end;
            }
            if phdr.p_vaddr > bun_section_vaddr {
                next_vaddr = next_vaddr.min(phdr.p_vaddr);
            }

            if (phdr.p_flags & PF_W) != 0
                && phdr.p_vaddr <= bun_section_vaddr
                && bun_section_vaddr < vaddr_end
            {
                rw_segment = Some((i, phdr));
            }
        }

        let Some((rw_index, rw_phdr)) = rw_segment else {
            return Err(ElfError::NoWritableLoadSegment);
        };
        Ok(LoadSegments {
            rw_index,
            rw_phdr,
            max_vaddr_end,
            next_vaddr,
        })
    }

    fn find_tail(&self, ehdr: Elf64_Ehdr, rw_phdr: &Elf64_Phdr) -> Result<Range<u64>, ElfError> {
        // The tail behind the RW segment's file-backed bytes moves past the payload, and the gap is filled with zeros to keep BSS semantics.
        let tail_end: u64 = self.data.len() as u64;
        let tail_start = rw_phdr
            .p_offset
            .checked_add(rw_phdr.p_filesz)
            .filter(|&tail_start| tail_start <= tail_end)
            .ok_or(ElfError::InvalidElfFile)?;

        // `find_bun_section` checked that the table ends inside the file.
        let shdr_table_size = ehdr.e_shnum as u64 * size_of::<Elf64_Shdr>() as u64;
        if ehdr.e_shoff < tail_start || ehdr.e_shoff + shdr_table_size > tail_end {
            return Err(ElfError::InvalidElfFile);
        }
        Ok(tail_start..tail_end)
    }

    fn reserved_segment(
        &self,
        replaces_payload: bool,
        image_end: u64,
        aligned_size: u64,
        page_size: u64,
    ) -> ReservedSegmentUse {
        let Some(reserved) = find_reserved_segment(&self.data) else {
            return ReservedSegmentUse::Absent;
        };
        let (header_index, header_count) = (reserved.header_index, reserved.header_count);
        // A replaced payload keeps its address, which BUN_COMPILED already holds.
        let free_address = reserved
            .address
            .checked_next_multiple_of(page_size)
            .filter(|_| !replaces_payload)
            .filter(|&address| address >= image_end && address.checked_add(aligned_size).is_some());
        match free_address {
            Some(address) => ReservedSegmentUse::HoldsPayload {
                header_index,
                header_count,
                address,
            },
            None => ReservedSegmentUse::Unused {
                header_index,
                header_count,
            },
        }
    }

    /// Whether `.bun` is a payload that an earlier build appended, in the layout that `plan_payload` produces.
    fn bun_section_is_payload(
        &self,
        ehdr: Elf64_Ehdr,
        bun_section: &BunSectionInfo,
        rw_phdr: &Elf64_Phdr,
        max_vaddr_end: u64,
        page_size: u64,
    ) -> Result<bool, ElfError> {
        let first_word = usize::try_from(bun_section.file_offset)
            .ok()
            .and_then(|offset| self.data.get(offset..)?.first_chunk::<8>())
            .map(|bytes| u64::from_le_bytes(*bytes))
            .ok_or(ElfError::InvalidElfFile)?;
        // BUN_COMPILED as linked. A payload starts with its length, and `write_executable` writes no empty one.
        if first_word == 0 {
            return Ok(false);
        }

        // Where the linked image ends. `.tbss` takes no room in it.
        let linked_end = (0..ehdr.e_shnum)
            .filter(|&index| index != bun_section.section_index)
            .map(|index| self.read_shdr(ehdr.e_shoff, index))
            .filter(|shdr| {
                shdr.sh_flags & SHF_ALLOC != 0
                    && !(shdr.sh_type == SHT_NOBITS && shdr.sh_flags & SHF_TLS != 0)
            })
            .map(|shdr| shdr.sh_addr.saturating_add(shdr.sh_size))
            .max()
            .unwrap_or(0);
        let rw_vaddr_end = rw_phdr.p_vaddr.checked_add(rw_phdr.p_memsz);
        let payload_vaddr_end = bun_section
            .size
            .checked_next_multiple_of(page_size)
            .and_then(|aligned_size| bun_section.vaddr.checked_add(aligned_size));

        let has_length_prefix =
            bun_section.size.checked_sub(size_of::<u64>() as u64) == Some(first_word);
        let is_page_aligned = bun_section.vaddr.is_multiple_of(page_size);
        // 1.3.14 to 1.4.x left a second payload behind the one BUN_COMPILED points at: a page or more later.
        let follows_linked_sections = bun_section
            .vaddr
            .checked_sub(linked_end)
            .is_some_and(|gap| gap < page_size);
        let offset_matches_segment = bun_section.vaddr.checked_sub(rw_phdr.p_vaddr)
            == bun_section.file_offset.checked_sub(rw_phdr.p_offset);
        let is_file_backed = rw_phdr.p_filesz == rw_phdr.p_memsz;
        // Nothing is mapped past the payload, so a longer one runs into no other mapping.
        let segment_is_highest = rw_vaddr_end == Some(max_vaddr_end);
        let ends_segment = payload_vaddr_end == rw_vaddr_end;

        let starts_segment = bun_section.vaddr == rw_phdr.p_vaddr;

        if has_length_prefix
            && is_page_aligned
            && (starts_segment || (follows_linked_sections && segment_is_highest))
            && offset_matches_segment
            && is_file_backed
            && ends_segment
        {
            Ok(true)
        } else {
            Err(ElfError::BunSectionAlreadyWritten)
        }
    }

    fn write_payload_headers(&mut self, plan: &PayloadPlan) {
        // Write the vaddr of the appended data at the ORIGINAL .bun section location (where BUN_COMPILED symbol points).
        if !plan.replaces_payload {
            write_u64_le(
                &mut self.data[usize::try_from(plan.pointer_file_offset).expect("int cast")..][..8],
                plan.address,
            );
        }

        // Update every section header whose sh_offset pointed into the moved tail so tools like `readelf -S`, `objdump`, and `gdb` still find the right bytes.
        self.write_ehdr_shoff(plan.moved_tail_offset(plan.section_headers_offset));

        for i in 0..plan.section_count as usize {
            let shdr_file_offset: u64 =
                plan.section_headers_offset + i as u64 * size_of::<Elf64_Shdr>() as u64;
            let shdr_file_offset_usz = usize::try_from(shdr_file_offset).expect("int cast");
            let mut shdr: Elf64_Shdr =
                read_struct(&self.data[shdr_file_offset_usz..][..size_of::<Elf64_Shdr>()]);

            if i == plan.section_index as usize {
                shdr.sh_offset = plan.file_offset;
                shdr.sh_size = plan.content_size;
                shdr.sh_addr = plan.address;
            } else if shdr.sh_type != SHT_NOBITS
                && shdr.sh_offset >= plan.tail_start
                && shdr.sh_offset < plan.tail_end
            {
                shdr.sh_offset = plan.moved_tail_offset(shdr.sh_offset);
            }

            write_struct(
                &mut self.data[shdr_file_offset_usz..][..size_of::<Elf64_Shdr>()],
                &shdr,
            );
        }

        let phdr_size = size_of::<Elf64_Phdr>();
        for write in &plan.header_writes {
            let phdr_offset = usize::try_from(write.file_offset).expect("int cast");
            write_struct(&mut self.data[phdr_offset..][..phdr_size], &write.header);
        }
    }
}

#[cfg(test)]
impl ElfFile {
    /// Carries out the plan in memory. Tests compare `bun_section_in_pieces` with it.
    pub(crate) fn write_bun_section(&mut self, payload: &[u8]) -> Result<(), ElfError> {
        let plan = self.plan_payload(payload.len() as u64, None)?;

        // Grow before the tail moves, shrink after: a smaller payload moves the tail down.
        let file_size = usize::try_from(plan.moved_tail_offset(plan.tail_end))
            .map_err(|_| ElfError::InvalidElfFile)?;
        if let Some(growth) = file_size.checked_sub(self.data.len()) {
            self.data
                .try_reserve_exact(growth)
                .map_err(|_| ElfError::InvalidElfFile)?;
            self.data.resize(file_size, 0);
        }

        // The section header table moves with the tail.
        self.write_payload_headers(&plan);

        // Relocate the tail (non-ALLOC sections + old shdr table) past the payload.
        self.data.copy_within(
            usize::try_from(plan.tail_start).expect("int cast")
                ..usize::try_from(plan.tail_end).expect("int cast"),
            usize::try_from(plan.moved_tail_start).expect("int cast"),
        );
        self.data.truncate(file_size);

        // Zero the bytes between the old RW file-content end and the payload start.
        if !plan.replaces_payload {
            self.data[usize::try_from(plan.tail_start).expect("int cast")
                ..usize::try_from(plan.file_offset).expect("int cast")]
                .fill(0);
        }

        // Write the payload at the new location: [u64 LE size][data][zero padding]
        let section = &mut self.data[usize::try_from(plan.file_offset).expect("int cast")
            ..usize::try_from(plan.moved_tail_start).expect("int cast")];
        let (length, contents) = section.split_at_mut(size_of::<u64>());
        write_u64_le(length, payload.len() as u64);
        contents[..payload.len()].copy_from_slice(payload);
        contents[payload.len()..].fill(0);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use bun_core::slice_to_nul;

    use super::*;
    use crate::elf_ranges::reserve_payload_segments;
    use crate::elf_ranges::tests::toy_elf;
    use crate::image::{AddressRange, Architecture, ImageEditor};

    const ARCHITECTURES: [Architecture; 2] = [Architecture::X86_64, Architecture::Aarch64];
    const PHDR_SIZE: usize = size_of::<Elf64_Phdr>();
    const SHDR_SIZE: usize = size_of::<Elf64_Shdr>();

    fn page_size(elf: &[u8]) -> u64 {
        ElfFile::<Vec<u8>>::page_size(read_ehdr(elf))
    }

    fn program_header_offset(elf: &[u8], index: usize) -> usize {
        read_ehdr(elf).e_phoff as usize + index * PHDR_SIZE
    }

    fn load_segments(elf: &[u8]) -> Vec<(usize, Elf64_Phdr)> {
        let header_at = |index: usize| read_struct(&elf[program_header_offset(elf, index)..]);
        (0..read_ehdr(elf).e_phnum as usize)
            .map(|index| (index, header_at(index)))
            .filter(|(_, phdr): &(usize, Elf64_Phdr)| phdr.p_type == PT_LOAD)
            .collect()
    }

    fn load_segment_at(elf: &[u8], address: u64) -> (usize, Elf64_Phdr) {
        load_segments(elf)
            .into_iter()
            .find(|(_, phdr)| phdr.p_vaddr <= address && address < phdr.p_vaddr + phdr.p_memsz)
            .unwrap()
    }

    fn section_header_offset(elf: &[u8], name: &[u8]) -> usize {
        let ehdr = read_ehdr(elf);
        let header_offset = |index: u16| ehdr.e_shoff as usize + index as usize * SHDR_SIZE;
        let names: Elf64_Shdr = read_struct(&elf[header_offset(ehdr.e_shstrndx)..]);
        (0..ehdr.e_shnum)
            .map(header_offset)
            .find(|&offset| {
                let shdr: Elf64_Shdr = read_struct(&elf[offset..]);
                slice_to_nul(&elf[(names.sh_offset + shdr.sh_name as u64) as usize..]) == name
            })
            .unwrap()
    }

    fn find_section(elf: &[u8], name: &[u8]) -> Elf64_Shdr {
        read_struct(&elf[section_header_offset(elf, name)..])
    }

    fn section_bytes<'a>(elf: &'a [u8], name: &[u8]) -> &'a [u8] {
        let section = find_section(elf, name);
        &elf[section.sh_offset as usize..][..section.sh_size as usize]
    }

    fn is_zero(bytes: &[u8]) -> bool {
        bytes.iter().all(|&byte| byte == 0)
    }

    fn edited<T: Copy>(elf: &[u8], offset: usize, edit: impl FnOnce(&mut T)) -> Vec<u8> {
        let mut elf = elf.to_vec();
        let mut value: T = read_struct(&elf[offset..]);
        edit(&mut value);
        write_struct(&mut elf[offset..], &value);
        elf
    }

    fn template(architecture: Architecture) -> Vec<u8> {
        let mut elf = toy_elf(architecture, true);
        let linked = find_section(&elf, b".bun");
        assert!(linked.sh_size >= 8);
        elf[linked.sh_offset as usize..][..linked.sh_size as usize].fill(0);
        elf
    }

    fn remove_text_pages(elf: &mut Vec<u8>) -> AddressRange {
        let page = page_size(elf);
        let start = align_up(find_section(elf, b".text").sh_addr, page);
        let end = start + 4 * page;
        let cut = AddressRange { start, end };
        let mut editor = ImageEditor::open(elf).unwrap();
        editor.remove_ranges(&[cut]).unwrap();
        cut
    }

    fn is_mapped(elf: &[u8], range: AddressRange) -> bool {
        load_segments(elf)
            .iter()
            .any(|(_, phdr)| phdr.p_vaddr < range.end && range.start < phdr.p_vaddr + phdr.p_memsz)
    }

    fn create_payload(length: u64) -> Vec<u8> {
        (0..length).map(|index| (index % 251) as u8 + 1).collect()
    }

    fn write_in_memory(template: &[u8], payload: &[u8]) -> (Result<(), ElfError>, Vec<u8>) {
        let mut elf = ElfFile::init(template.to_vec()).unwrap();
        let result = elf.write_bun_section(payload);
        (result, elf.data)
    }

    fn concatenate(pieces: [Piece<'_>; 6]) -> Vec<u8> {
        let mut bytes = Vec::new();
        for piece in pieces {
            let start = bytes.len();
            match piece {
                Piece::Bytes(slice) => bytes.extend_from_slice(slice),
                Piece::Zeros(count) => bytes.resize(start + count as usize, 0),
                Piece::Length(length) => bytes.extend_from_slice(&length),
            }
            assert_eq!(piece.len(), (bytes.len() - start) as u64);
        }
        bytes
    }

    fn write_in_pieces(template: &[u8], payload: &[u8]) -> (Result<Vec<u8>, ElfError>, Vec<u8>) {
        let mut bytes = template.to_vec();
        let written = ElfFile::over(&mut bytes)
            .and_then(|elf| elf.bun_section_in_pieces(payload, None))
            .map(concatenate);
        (written, bytes)
    }

    fn write_with_code(template: &[u8], payload: &[u8], code: Range<u64>) -> Vec<u8> {
        let mut bytes = template.to_vec();
        let elf = ElfFile::over(&mut bytes).unwrap();
        concatenate(elf.bun_section_in_pieces(payload, Some(code)).unwrap())
    }

    fn payload_segments(elf: &[u8]) -> Vec<(u32, u64, u64)> {
        let section = find_section(elf, b".bun");
        load_segments(elf)
            .into_iter()
            .filter(|(_, phdr)| phdr.p_vaddr >= section.sh_addr)
            .map(|(_, phdr)| {
                assert_eq!(phdr.p_filesz, phdr.p_memsz);
                assert_eq!(
                    phdr.p_offset - section.sh_offset,
                    phdr.p_vaddr - section.sh_addr
                );
                (phdr.p_flags, phdr.p_vaddr - section.sh_addr, phdr.p_memsz)
            })
            .collect()
    }

    struct Written {
        elf: Vec<u8>,
        shdr: Elf64_Shdr,
        phdr: Elf64_Phdr,
    }

    fn write_checked(template: &[u8], pointer_address: u64, payload: &[u8]) -> Written {
        let (in_memory, elf) = write_in_memory(template, payload);
        assert_eq!(in_memory, Ok(()));
        assert!(write_in_pieces(template, payload).0 == Ok(elf.clone()));

        let page = page_size(&elf);
        let shdr = find_section(&elf, b".bun");
        let (_, phdr) = load_segment_at(&elf, shdr.sh_addr);
        let offset_in_segment = shdr.sh_addr - phdr.p_vaddr;
        let aligned_size = align_up(shdr.sh_size, page);
        assert_eq!(shdr.sh_size, 8 + payload.len() as u64);
        let unwritten = ElfFile::init(template.to_vec()).unwrap();
        let planned_address = unwritten.payload_address(payload.len() as u64);
        assert_eq!(planned_address, Ok(Some(shdr.sh_addr + 8)));
        assert_eq!(shdr.sh_addr % page, 0);
        assert_eq!(shdr.sh_offset % page, 0);
        assert_eq!(shdr.sh_offset, phdr.p_offset + offset_in_segment);
        assert_eq!(phdr.p_filesz, offset_in_segment + aligned_size);
        assert_eq!(phdr.p_memsz, phdr.p_filesz);

        let contents = &elf[shdr.sh_offset as usize..][..aligned_size as usize];
        assert_eq!(contents[..8], (payload.len() as u64).to_le_bytes());
        assert!(contents[8..][..payload.len()] == *payload);
        assert!(is_zero(&contents[8 + payload.len()..]));

        let (_, rw_phdr) = load_segment_at(&elf, pointer_address);
        let pointer_offset = rw_phdr.p_offset + (pointer_address - rw_phdr.p_vaddr);
        let pointer = &elf[pointer_offset as usize..][..8];
        assert_eq!(pointer, shdr.sh_addr.to_le_bytes());

        let tail_sections: [&[u8]; 2] = [b".comment", b".shstrtab"];
        for name in tail_sections {
            assert!(section_bytes(template, name) == section_bytes(&elf, name));
        }
        assert_eq!(read_ehdr(template).e_phnum, read_ehdr(&elf).e_phnum);
        assert!(load_segments(&elf).is_sorted_by_key(|(_, phdr)| phdr.p_vaddr));
        assert_eq!(find_reserved_segment(&elf), None);
        Written { elf, shdr, phdr }
    }

    #[test]
    fn position_independent_executable_has_no_payload_address() {
        const ET_DYN: u16 = 3;
        for architecture in ARCHITECTURES {
            let set_type = |ehdr: &mut Elf64_Ehdr| ehdr.e_type = ET_DYN;
            let elf = ElfFile::init(edited(&template(architecture), 0, set_type)).unwrap();
            assert_eq!(elf.payload_address(64), Ok(None));
        }
    }

    fn assert_both_fail(template: &[u8], payload_length: u64, expected: ElfError) {
        let payload = create_payload(payload_length);
        let (in_memory, bytes) = write_in_memory(template, &payload);
        assert_eq!(in_memory, Err(expected));
        assert!(bytes == template);
        let (in_pieces, bytes) = write_in_pieces(template, &payload);
        assert_eq!(in_pieces, Err(expected));
        assert!(bytes == template);
    }

    #[test]
    fn fresh_template_appends_payload() {
        for architecture in ARCHITECTURES {
            let template = template(architecture);
            let page = page_size(&template);
            let pointer_address = find_section(&template, b".bun").sh_addr;
            let (_, rw_phdr) = load_segment_at(&template, pointer_address);
            let rw_vaddr_end = rw_phdr.p_vaddr + rw_phdr.p_memsz;
            let payload = create_payload(page + page / 2);

            let written = write_checked(&template, pointer_address, &payload);
            assert_eq!(written.shdr.sh_addr, align_up(rw_vaddr_end, page));
            assert_eq!(written.phdr.p_vaddr, rw_phdr.p_vaddr);
            let tail_start = (rw_phdr.p_offset + rw_phdr.p_filesz) as usize;
            let zero_fill = &written.elf[tail_start..written.shdr.sh_offset as usize];
            assert!(!zero_fill.is_empty() && is_zero(zero_fill));
        }
    }

    #[test]
    fn second_payload_keeps_address() {
        for architecture in ARCHITECTURES {
            let template = template(architecture);
            let page = page_size(&template);
            let pointer_address = find_section(&template, b".bun").sh_addr;
            let first = write_checked(&template, pointer_address, &create_payload(2 * page));

            for (length, shrinks) in [(5 * page, false), (10, true)] {
                let payload = create_payload(length);
                let second = write_checked(&first.elf, pointer_address, &payload);
                assert_eq!(second.shdr.sh_addr, first.shdr.sh_addr);
                assert_eq!(second.elf.len() < first.elf.len(), shrinks);
                let written_once = write_checked(&template, pointer_address, &payload);
                assert!(second.elf == written_once.elf);
            }
        }
    }

    #[test]
    fn trimmed_template_maps_payload_past_image() {
        for architecture in ARCHITECTURES {
            let mut trimmed = template(architecture);
            let cut = remove_text_pages(&mut trimmed);
            let page = page_size(&trimmed);
            let pointer_address = find_section(&trimmed, b".bun").sh_addr;
            let (_, rw_phdr) = load_segment_at(&trimmed, pointer_address);
            let rw_file_end = rw_phdr.p_offset + rw_phdr.p_filesz;
            let first_free_page = align_up(rw_phdr.p_vaddr + rw_phdr.p_memsz, page);
            assert!(rw_phdr.p_filesz < rw_phdr.p_memsz);

            let first = write_checked(&trimmed, pointer_address, &create_payload(page - 8));
            assert_eq!(first.shdr.sh_addr, first_free_page);
            assert_eq!(first.shdr.sh_offset, align_up(rw_file_end, page));
            assert_eq!(first.phdr.p_vaddr, first_free_page);
            assert_eq!(first.phdr.p_memsz, page);
            assert_eq!(first.phdr.p_flags, rw_phdr.p_flags);
            assert_eq!(first.phdr.p_align, page);
            let (_, rw_phdr_written) = load_segment_at(&first.elf, pointer_address);
            assert_eq!(rw_phdr_written.p_filesz, rw_phdr.p_filesz);
            assert_eq!(rw_phdr_written.p_memsz, rw_phdr.p_memsz);
            assert!(!is_mapped(&first.elf, cut));

            let payload = create_payload(cut.len() + page);
            let second = write_checked(&first.elf, pointer_address, &payload);
            assert_eq!(second.shdr.sh_addr, first_free_page);
            assert!(!is_mapped(&second.elf, cut));
            let written_once = write_checked(&trimmed, pointer_address, &payload);
            assert!(second.elf == written_once.elf);
        }
    }

    #[test]
    fn code_gets_executable_segment() {
        for architecture in ARCHITECTURES {
            let mut trimmed = template(architecture);
            remove_text_pages(&mut trimmed);
            let page = page_size(&trimmed);
            let payload = create_payload(4 * page);
            let without_code = write_in_pieces(&trimmed, &payload).0.unwrap();
            let data_flags = payload_segments(&without_code)[0].0;
            assert_eq!(payload_segments(&without_code), [(data_flags, 0, 5 * page)]);
            assert_ne!(data_flags & PF_W, 0);

            let written = write_with_code(&trimmed, &payload, page - 8..3 * page - 8);
            let expected = [
                (PF_R, 0, page),
                (PF_R | PF_X, page, 2 * page),
                (PF_R, 3 * page, 2 * page),
            ];
            assert_eq!(payload_segments(&written), expected);
            assert_eq!(find_reserved_segment(&written), None);
            let (first_index, _) =
                load_segment_at(&written, find_section(&written, b".bun").sh_addr);
            let span: Elf64_Phdr =
                read_struct(&written[program_header_offset(&written, first_index - 1)..]);
            let section = find_section(&written, b".bun");
            assert_eq!(
                (span.p_type, span.p_offset, span.p_vaddr),
                (PT_BUN_PAYLOAD, section.sh_offset, section.sh_addr)
            );
            assert_eq!((span.p_filesz, span.p_memsz), (5 * page, 5 * page));
            assert!(load_segments(&written).is_sorted_by_key(|(_, phdr)| phdr.p_vaddr));
            let (section, plain) = (
                find_section(&written, b".bun"),
                find_section(&without_code, b".bun"),
            );
            assert_eq!(
                (section.sh_addr, section.sh_offset, section.sh_size),
                (plain.sh_addr, plain.sh_offset, plain.sh_size)
            );
            assert!(section_bytes(&written, b".bun") == section_bytes(&without_code, b".bun"));
            assert_eq!(written.len(), without_code.len());

            let to_the_end = write_with_code(
                &trimmed,
                &create_payload(3 * page - 8),
                page - 8..3 * page - 8,
            );
            assert_eq!(
                payload_segments(&to_the_end),
                [(PF_R, 0, page), (PF_R | PF_X, page, 2 * page)]
            );
            assert_eq!(find_reserved_segment(&to_the_end), None);
        }
    }

    #[test]
    fn payload_with_code_is_replaced_where_it_lies() {
        for architecture in ARCHITECTURES {
            let mut trimmed = template(architecture);
            remove_text_pages(&mut trimmed);
            let page = page_size(&trimmed);
            let first =
                write_with_code(&trimmed, &create_payload(4 * page), page - 8..3 * page - 8);
            let mut reserved_again = first.clone();
            assert_eq!(reserve_payload_segments(&mut reserved_again), Ok(true));
            assert!(reserved_again == first);

            for (length, code) in [
                (6 * page, 2 * page - 8..5 * page - 8),
                (2 * page - 8, page - 8..2 * page - 8),
            ] {
                let payload = create_payload(length);
                let second = write_with_code(&first, &payload, code.clone());
                assert!(second == write_with_code(&trimmed, &payload, code));
            }
            let payload = create_payload(3 * page);
            let without_code = write_in_pieces(&first, &payload).0.unwrap();
            assert!(without_code == write_in_pieces(&trimmed, &payload).0.unwrap());

            let (first_index, _) = load_segment_at(&first, find_section(&first, b".bun").sh_addr);
            let span_offset = program_header_offset(&first, first_index - 1);
            let longer_span =
                edited::<Elf64_Phdr>(&first, span_offset, |span| span.p_filesz += page);
            assert_both_fail(&longer_span, 100, ElfError::BunSectionAlreadyWritten);
            let moved_span = edited::<Elf64_Phdr>(&first, span_offset, |span| span.p_vaddr += page);
            assert_both_fail(&moved_span, 100, ElfError::BunSectionAlreadyWritten);
        }
    }

    #[test]
    fn untrimmed_template_with_reserved_headers_leaves_bss_out_of_file() {
        for architecture in ARCHITECTURES {
            let untrimmed = template(architecture);
            let mut reserved = untrimmed.clone();
            assert_eq!(reserve_payload_segments(&mut reserved), Ok(true));
            let page = page_size(&untrimmed);
            let pointer_address = find_section(&untrimmed, b".bun").sh_addr;
            let (_, rw_phdr) = load_segment_at(&untrimmed, pointer_address);
            let payload = create_payload(4 * page);
            let code = page - 8..3 * page - 8;

            let grown = write_with_code(&untrimmed, &payload, code.clone());
            let written = write_with_code(&reserved, &payload, code);
            let expected = [
                (PF_R, 0, page),
                (PF_R | PF_X, page, 2 * page),
                (PF_R, 3 * page, 2 * page),
            ];
            assert_eq!(payload_segments(&written), expected);
            let (section, appended) = (
                find_section(&written, b".bun"),
                find_section(&grown, b".bun"),
            );
            assert_eq!(section.sh_addr, appended.sh_addr);
            assert_eq!(
                section.sh_offset,
                align_up(rw_phdr.p_offset + rw_phdr.p_filesz, page)
            );
            assert!(section.sh_offset < appended.sh_offset);
            assert_eq!(
                (grown.len() - written.len()) as u64,
                appended.sh_offset - section.sh_offset
            );
            assert!(section_bytes(&written, b".bun") == section_bytes(&grown, b".bun"));
            let (_, rw_phdr_written) = load_segment_at(&written, pointer_address);
            assert_eq!(
                (rw_phdr_written.p_filesz, rw_phdr_written.p_memsz),
                (rw_phdr.p_filesz, rw_phdr.p_memsz)
            );
        }
    }

    #[test]
    fn misaligned_code_or_missing_headers_keep_one_segment() {
        for architecture in ARCHITECTURES {
            let untrimmed = template(architecture);
            let mut trimmed = untrimmed.clone();
            remove_text_pages(&mut trimmed);
            let page = page_size(&trimmed);
            let payload = create_payload(4 * page);
            let without_code = write_in_pieces(&trimmed, &payload).0.unwrap();
            for code in [
                page..3 * page,
                page - 8..3 * page,
                page - 8..page - 8,
                page - 8..6 * page - 8,
            ] {
                assert!(write_with_code(&trimmed, &payload, code) == without_code);
            }
            let grown = write_in_pieces(&untrimmed, &payload).0.unwrap();
            assert!(write_with_code(&untrimmed, &payload, page - 8..3 * page - 8) == grown);
        }
    }

    #[test]
    fn replaced_payload_stops_at_next_segment() {
        for architecture in ARCHITECTURES {
            let mut trimmed = template(architecture);
            remove_text_pages(&mut trimmed);
            let page = page_size(&trimmed);
            let pointer_address = find_section(&trimmed, b".bun").sh_addr;
            let written = write_checked(&trimmed, pointer_address, &create_payload(page));

            let last_header = read_ehdr(&written.elf).e_phnum as usize - 1;
            let offset = program_header_offset(&written.elf, last_header);
            let next_segment = Elf64_Phdr {
                p_type: PT_LOAD,
                p_vaddr: written.shdr.sh_addr + 3 * page,
                p_memsz: page,
                ..Elf64_Phdr::ZEROED
            };
            let elf = edited(&written.elf, offset, |phdr: &mut Elf64_Phdr| {
                *phdr = next_segment
            });
            write_checked(&elf, pointer_address, &create_payload(3 * page - 8));
            assert_both_fail(&elf, 3 * page, ElfError::NewVaddrCollides);
        }
    }

    #[test]
    fn clears_unused_reserved_segment() {
        for architecture in ARCHITECTURES {
            let mut elf = template(architecture);
            let page = page_size(&elf);
            let pointer_address = find_section(&elf, b".bun").sh_addr;
            let appended = write_checked(&elf, pointer_address, &create_payload(page));
            let mut elf_with_payload = appended.elf;
            let cut = remove_text_pages(&mut elf);
            remove_text_pages(&mut elf_with_payload);

            let header_index = find_reserved_segment(&elf).unwrap().header_index;
            let offset = program_header_offset(&elf, header_index);
            let reserve_cut = |phdr: &mut Elf64_Phdr| phdr.p_vaddr = cut.start;
            let elf_reserving_cut = edited(&elf, offset, reserve_cut);

            for (elf, length) in [(elf_reserving_cut, page), (elf_with_payload, 10)] {
                let reserved = find_reserved_segment(&elf).unwrap();
                let written = write_checked(&elf, pointer_address, &create_payload(length));
                assert_eq!(written.shdr.sh_addr, appended.shdr.sh_addr);
                assert!(!is_mapped(&written.elf, cut));
                let cleared = program_header_offset(&written.elf, reserved.header_index);
                assert!(is_zero(&written.elf[cleared..][..PHDR_SIZE]));
            }
        }
    }

    #[test]
    fn reserved_segment_below_image_end_is_unused() {
        for architecture in ARCHITECTURES {
            let mut elf = template(architecture);
            let page = page_size(&elf);
            let (_, last_load) = *load_segments(&elf).last().unwrap();
            let image_end = last_load.p_vaddr + last_load.p_memsz;
            let first_free_page = align_up(image_end, page);
            let replaced_payload_segment = |elf: &[u8], aligned_size: u64| {
                let file = ElfFile::init(elf.to_vec()).unwrap();
                file.reserved_segment(true, image_end, aligned_size, page)
            };
            let reserved_segment = |elf: &[u8], aligned_size: u64| {
                let file = ElfFile::init(elf.to_vec()).unwrap();
                file.reserved_segment(false, image_end, aligned_size, page)
            };
            let absent = ReservedSegmentUse::Absent;
            assert_eq!(reserved_segment(&elf, page), absent);
            assert_eq!(replaced_payload_segment(&elf, page), absent);

            let cut = remove_text_pages(&mut elf);
            let header_index = find_reserved_segment(&elf).unwrap().header_index;
            let header_count = PAYLOAD_SEGMENT_COUNT;
            let unused = ReservedSegmentUse::Unused {
                header_index,
                header_count,
            };
            let holds_payload = |address: u64| ReservedSegmentUse::HoldsPayload {
                header_index,
                header_count,
                address,
            };
            assert_eq!(reserved_segment(&elf, page), holds_payload(first_free_page));
            assert_eq!(
                reserved_segment(&elf, cut.len() + page),
                holds_payload(first_free_page)
            );
            assert_eq!(replaced_payload_segment(&elf, page), unused);
            assert_eq!(reserved_segment(&elf, u64::MAX - page + 1), unused);

            let offset = program_header_offset(&elf, header_index);
            let reserved_at = |address: u64| {
                let elf = edited(&elf, offset, |phdr: &mut Elf64_Phdr| phdr.p_vaddr = address);
                reserved_segment(&elf, page)
            };
            assert_eq!(
                reserved_at(first_free_page + 8),
                holds_payload(first_free_page + page)
            );
            assert_eq!(reserved_at(first_free_page - page), unused);
            assert_eq!(reserved_at(cut.start), unused);
        }
    }

    #[test]
    fn malformed_templates_are_rejected() {
        use ElfError::{BunSectionNotFound, InvalidElfFile, NoWritableLoadSegment};

        let template = template(Architecture::X86_64);
        let ehdr = read_ehdr(&template);
        let linked = find_section(&template, b".bun");
        let (rw_index, _) = load_segment_at(&template, linked.sh_addr);
        let rw_header = program_header_offset(&template, rw_index);

        let header_edits: [fn(&mut Elf64_Ehdr); 4] = [
            |ehdr| ehdr.e_phoff = 1 << 62,
            |ehdr| ehdr.e_phoff = u64::MAX,
            |ehdr| ehdr.e_shoff = u64::MAX - 8,
            |ehdr| ehdr.e_shstrndx = ehdr.e_shnum,
        ];
        for edit in header_edits {
            assert_both_fail(&edited(&template, 0, edit), 100, InvalidElfFile);
        }

        let segment_edits: [(fn(&mut Elf64_Phdr), ElfError); 3] = [
            (|phdr| phdr.p_flags &= !PF_W, NoWritableLoadSegment),
            (|phdr| phdr.p_memsz = u64::MAX, InvalidElfFile),
            (|phdr| phdr.p_filesz = u64::MAX, InvalidElfFile),
        ];
        for (edit, expected) in segment_edits {
            assert_both_fail(&edited(&template, rw_header, edit), 100, expected);
        }

        let section_edits: [(&[u8], fn(&mut Elf64_Shdr), ElfError); 2] = [
            (b".bun", |shdr| shdr.sh_name = u32::MAX, BunSectionNotFound),
            (b".shstrtab", |shdr| shdr.sh_size = u64::MAX, InvalidElfFile),
        ];
        for (name, edit, expected) in section_edits {
            let offset = section_header_offset(&template, name);
            assert_both_fail(&edited(&template, offset, edit), 100, expected);
        }

        let offset = linked.sh_offset as usize;
        let occupied = edited(&template, offset, |word: &mut u64| *word = 1);
        assert_both_fail(&occupied, 100, ElfError::BunSectionAlreadyWritten);

        let e_shoff = find_section(&template, b".text").sh_offset;
        let mut early_table = edited(&template, 0, |ehdr: &mut Elf64_Ehdr| ehdr.e_shoff = e_shoff);
        let table_start = ehdr.e_shoff as usize;
        let table = table_start..table_start + ehdr.e_shnum as usize * SHDR_SIZE;
        early_table.copy_within(table, e_shoff as usize);
        assert_both_fail(&early_table, 100, InvalidElfFile);
    }

    #[test]
    fn tail_program_headers_rejected() {
        let template = template(Architecture::X86_64);
        let ehdr = read_ehdr(&template);
        let e_phoff = template.len() as u64;
        let mut elf = edited(&template, 0, |ehdr: &mut Elf64_Ehdr| ehdr.e_phoff = e_phoff);
        let table_start = ehdr.e_phoff as usize;
        elf.extend_from_within(table_start..table_start + ehdr.e_phnum as usize * PHDR_SIZE);
        assert_both_fail(&elf, 100, ElfError::InvalidElfFile);
    }

    #[test]
    fn detects_headers_outside_head() {
        let file = ElfFile::init(template(Architecture::X86_64)).unwrap();
        let edits: [fn(&mut PayloadPlan, u64); 5] = [
            |plan, head_end| plan.header_writes[0].file_offset = head_end - PHDR_SIZE as u64 + 1,
            |plan, head_end| plan.header_writes[1].file_offset = head_end,
            |plan, head_end| plan.pointer_file_offset = head_end - 7,
            |plan, _| plan.tail_start = 63,
            |plan, _| plan.tail_start = plan.file_offset + 1,
        ];
        for edit in edits {
            let mut plan = file.plan_payload(100, None).unwrap();
            plan.header_writes.push(plan.header_writes[0]);
            assert!(plan.has_headers_in_head());
            let head_end = plan.head_end();
            edit(&mut plan, head_end);
            assert!(!plan.has_headers_in_head());
        }
    }
}
