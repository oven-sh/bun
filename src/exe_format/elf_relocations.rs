use bun_sys::elf::PT_LOAD;

use crate::elf::{EM_AARCH64, EM_X86_64, Elf64_Shdr};
use crate::elf_program_headers::{ProgramHeaderTable, read_header};
use crate::image::{AddressRange, ImageError};
use crate::{read_struct, write_struct};

const PT_DYNAMIC: u32 = 2;
const DT_NULL: u64 = 0;
const DT_RELA: u64 = 7;
const DT_RELASZ: u64 = 8;
const DT_RELACOUNT: u64 = 0x6fff_fff9;
const DT_RELRSZ: u64 = 35;
const DT_RELR: u64 = 36;
const SHT_RELA: u32 = 4;
const SHT_RELR: u32 = 19;
const R_X86_64_RELATIVE: u32 = 8;
const R_AARCH64_RELATIVE: u32 = 1027;
const DYNAMIC_ENTRY_SIZE: usize = 16;
const RELOCATION_SIZE: usize = 24;
const WORD_SIZE: u64 = 8;
const WORDS_IN_A_BITMAP: u64 = 63;

fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, ImageError> {
    let word = bytes
        .get(offset..offset + 8)
        .ok_or(ImageError::MalformedHeaders)?;
    Ok(u64::from_le_bytes(word.try_into().expect("eight bytes")))
}

fn write_u64(bytes: &mut [u8], offset: usize, value: u64) {
    bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}

fn is_removed(removed: &[AddressRange], address: u64) -> bool {
    let next = removed.partition_point(|range| range.start <= address);
    next > 0 && address + WORD_SIZE <= removed[next - 1].end
}

fn unpack(words: impl Iterator<Item = u64>) -> Vec<u64> {
    let (mut addresses, mut next) = (Vec::new(), 0u64);
    for word in words {
        if word & 1 == 0 {
            addresses.push(word);
            next = word.wrapping_add(WORD_SIZE);
            continue;
        }
        let set = (0..WORDS_IN_A_BITMAP).filter(|bit| word >> (bit + 1) & 1 != 0);
        addresses.extend(set.map(|bit| next.wrapping_add(bit * WORD_SIZE)));
        next = next.wrapping_add(WORDS_IN_A_BITMAP * WORD_SIZE);
    }
    addresses
}

fn pack(addresses: &[u64]) -> Vec<u64> {
    let (mut words, mut at) = (Vec::new(), 0);
    while at < addresses.len() {
        words.push(addresses[at]);
        let mut base = addresses[at] + WORD_SIZE;
        at += 1;
        loop {
            let mut bitmap = 0u64;
            while at < addresses.len() {
                let distance = addresses[at].wrapping_sub(base);
                if distance >= WORDS_IN_A_BITMAP * WORD_SIZE || !distance.is_multiple_of(WORD_SIZE)
                {
                    break;
                }
                bitmap |= 1 << (distance / WORD_SIZE);
                at += 1;
            }
            if bitmap == 0 {
                break;
            }
            words.push(bitmap << 1 | 1);
            base += WORDS_IN_A_BITMAP * WORD_SIZE;
        }
    }
    words
}

struct Table {
    address: u64,
    size_entry: usize,
    start: usize,
    end: usize,
}

impl Table {
    fn shrink(
        &self,
        elf: &mut [u8],
        ehdr: &crate::elf::Elf64_Ehdr,
        section_type: u32,
        kept_end: usize,
    ) {
        elf[kept_end..self.end].fill(0);
        write_u64(elf, self.size_entry, (kept_end - self.start) as u64);
        for index in 0..usize::from(ehdr.e_shnum) {
            let at = ehdr.e_shoff as usize + index * size_of::<Elf64_Shdr>();
            let Some(bytes) = elf.get_mut(at..at + size_of::<Elf64_Shdr>()) else {
                break;
            };
            let mut section: Elf64_Shdr = read_struct(bytes);
            if section.sh_type == section_type && section.sh_addr == self.address {
                section.sh_size = (kept_end - self.start) as u64;
                write_struct(bytes, &section);
            }
        }
    }
}

fn remove_packed_relocations(
    elf: &mut [u8],
    ehdr: &crate::elf::Elf64_Ehdr,
    table: &Table,
    removed: &[AddressRange],
) -> Result<u64, ImageError> {
    let offsets = (table.start..table.end).step_by(WORD_SIZE as usize);
    let words = offsets
        .map(|at| read_u64(elf, at))
        .collect::<Result<Vec<u64>, ImageError>>()?;
    let all = unpack(words.iter().copied());
    if !all.is_sorted() {
        return Ok(0);
    }
    let kept: Vec<u64> = all
        .iter()
        .copied()
        .filter(|&address| !is_removed(removed, address))
        .collect();
    let packed = pack(&kept);
    if kept.len() == all.len() || packed.len() > words.len() {
        return Ok(0);
    }
    for (index, &word) in packed.iter().enumerate() {
        write_u64(elf, table.start + index * WORD_SIZE as usize, word);
    }
    table.shrink(
        elf,
        ehdr,
        SHT_RELR,
        table.start + packed.len() * WORD_SIZE as usize,
    );
    Ok((all.len() - kept.len()) as u64)
}

/// Drops the relative relocations whose target is in `removed` (sorted, disjoint), so the loader doesn't dirty those pages.
pub(crate) fn remove_relative_relocations(
    elf: &mut [u8],
    removed: &[AddressRange],
) -> Result<u64, ImageError> {
    let ehdr = read_header(elf)?;
    let relative = match ehdr.e_machine {
        EM_X86_64 => R_X86_64_RELATIVE,
        EM_AARCH64 => R_AARCH64_RELATIVE,
        _ => return Ok(0),
    };
    let headers = ProgramHeaderTable::read(elf, &ehdr)?.headers;
    let Some(dynamic) = headers.iter().find(|header| header.p_type == PT_DYNAMIC) else {
        return Ok(0);
    };

    let (mut table, mut size_entry, mut count_entry) = (None, None, None);
    let (mut packed_table, mut packed_size_entry) = (None, None);
    let dynamic_start = dynamic.p_offset as usize;
    for entry in
        (dynamic_start..dynamic_start + dynamic.p_filesz as usize).step_by(DYNAMIC_ENTRY_SIZE)
    {
        match read_u64(elf, entry)? {
            DT_NULL => break,
            DT_RELA => table = Some(read_u64(elf, entry + 8)?),
            DT_RELASZ => size_entry = Some(entry + 8),
            DT_RELACOUNT => count_entry = Some(entry + 8),
            DT_RELR => packed_table = Some(read_u64(elf, entry + 8)?),
            DT_RELRSZ => packed_size_entry = Some(entry + 8),
            _ => {}
        }
    }
    let locate = |elf: &[u8],
                  address: u64,
                  size_entry: usize,
                  entry_size: usize|
     -> Result<Table, ImageError> {
        let size = read_u64(elf, size_entry)?;
        let load = headers
            .iter()
            .find(|load| {
                load.p_type == PT_LOAD
                    && load.p_vaddr <= address
                    && address + size <= load.p_vaddr + load.p_filesz
            })
            .ok_or(ImageError::MalformedHeaders)?;
        let start = (load.p_offset + (address - load.p_vaddr)) as usize;
        let end = start + size as usize;
        if end > elf.len() || !(size as usize).is_multiple_of(entry_size) {
            return Err(ImageError::MalformedHeaders);
        }
        Ok(Table {
            address,
            size_entry,
            start,
            end,
        })
    };
    let removed_from_the_packed_table = match (packed_table, packed_size_entry) {
        (Some(address), Some(size_entry)) => remove_packed_relocations(
            elf,
            &ehdr,
            &locate(elf, address, size_entry, WORD_SIZE as usize)?,
            removed,
        )?,
        _ => 0,
    };
    let (Some(table), Some(size_entry)) = (table, size_entry) else {
        return Ok(removed_from_the_packed_table);
    };
    let table = locate(elf, table, size_entry, RELOCATION_SIZE)?;
    let (start, end) = (table.start, table.end);

    let mut kept_end = start;
    for relocation in (start..end).step_by(RELOCATION_SIZE) {
        let is_relative = read_u64(elf, relocation + 8)? as u32 == relative;
        if is_relative && is_removed(removed, read_u64(elf, relocation)?) {
            continue;
        }
        elf.copy_within(relocation..relocation + RELOCATION_SIZE, kept_end);
        kept_end += RELOCATION_SIZE;
    }
    let removed_count = ((end - kept_end) / RELOCATION_SIZE) as u64;
    if removed_count == 0 {
        return Ok(removed_from_the_packed_table);
    }
    table.shrink(elf, &ehdr, SHT_RELA, kept_end);
    if let Some(count_entry) = count_entry {
        let count = read_u64(elf, count_entry)?;
        write_u64(elf, count_entry, count.saturating_sub(removed_count));
    }
    Ok(removed_count + removed_from_the_packed_table)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::elf_program_headers::tests::{DYNAMIC_INDEX, RODATA_OFFSET, toy_elf};
    use crate::image::Architecture;

    const R_X86_64_GLOB_DAT: u32 = 6;
    const TABLE_OFFSET: usize = RODATA_OFFSET as usize;

    fn dynamic_offset(elf: &[u8]) -> usize {
        let ehdr = read_header(elf).unwrap();
        ProgramHeaderTable::read(elf, &ehdr).unwrap().headers[DYNAMIC_INDEX].p_offset as usize
    }

    fn with_relocations(
        architecture: Architecture,
        relocations: &[(u64, u32)],
        relative_count: u64,
    ) -> Vec<u8> {
        let mut elf = toy_elf(architecture, true);
        let ehdr = read_header(&elf).unwrap();
        let headers = ProgramHeaderTable::read(&elf, &ehdr).unwrap().headers;
        let load = headers
            .iter()
            .find(|load| {
                load.p_type == PT_LOAD
                    && load.p_offset <= RODATA_OFFSET
                    && RODATA_OFFSET < load.p_offset + load.p_filesz
            })
            .unwrap();
        let table = load.p_vaddr + (RODATA_OFFSET - load.p_offset);
        let size = (relocations.len() * RELOCATION_SIZE) as u64;
        let dynamic = dynamic_offset(&elf);
        let entries = [
            (DT_RELA, table),
            (DT_RELASZ, size),
            (DT_RELACOUNT, relative_count),
            (DT_NULL, 0),
        ];
        for (index, (tag, value)) in entries.into_iter().enumerate() {
            write_u64(&mut elf, dynamic + index * DYNAMIC_ENTRY_SIZE, tag);
            write_u64(&mut elf, dynamic + index * DYNAMIC_ENTRY_SIZE + 8, value);
        }
        for (index, &(address, kind)) in relocations.iter().enumerate() {
            let at = TABLE_OFFSET + index * RELOCATION_SIZE;
            write_u64(&mut elf, at, address);
            write_u64(&mut elf, at + 8, u64::from(kind));
            write_u64(&mut elf, at + 16, address + 1);
        }
        elf
    }

    fn read_relocations(elf: &[u8]) -> (Vec<(u64, u32)>, u64) {
        let dynamic = dynamic_offset(elf);
        let size = read_u64(elf, dynamic + DYNAMIC_ENTRY_SIZE + 8).unwrap() as usize;
        let relocations = (TABLE_OFFSET..TABLE_OFFSET + size)
            .step_by(RELOCATION_SIZE)
            .map(|at| {
                assert_eq!(
                    read_u64(elf, at + 16).unwrap(),
                    read_u64(elf, at).unwrap() + 1
                );
                (
                    read_u64(elf, at).unwrap(),
                    read_u64(elf, at + 8).unwrap() as u32,
                )
            })
            .collect();
        (
            relocations,
            read_u64(elf, dynamic + 2 * DYNAMIC_ENTRY_SIZE + 8).unwrap(),
        )
    }

    #[test]
    fn drops_relative_relocations_in_removed_ranges() {
        for (architecture, relative) in [
            (Architecture::X86_64, R_X86_64_RELATIVE),
            (Architecture::Aarch64, R_AARCH64_RELATIVE),
        ] {
            let relocations = [
                (0x1000, relative),
                (0x2000, relative),
                (0x2ff8, relative),
                (0x2ffc, relative),
                (0x3000, relative),
                (0x5008, relative),
                (0x2010, R_X86_64_GLOB_DAT),
            ];
            let mut elf = with_relocations(architecture, &relocations, 6);
            let removed = [
                AddressRange {
                    start: 0x2000,
                    end: 0x3000,
                },
                AddressRange {
                    start: 0x5000,
                    end: 0x6000,
                },
            ];
            assert_eq!(remove_relative_relocations(&mut elf, &removed), Ok(3));
            let kept = vec![
                (0x1000, relative),
                (0x2ffc, relative),
                (0x3000, relative),
                (0x2010, R_X86_64_GLOB_DAT),
            ];
            assert_eq!(read_relocations(&elf), (kept, 3));
            let tail = TABLE_OFFSET + 4 * RELOCATION_SIZE
                ..TABLE_OFFSET + relocations.len() * RELOCATION_SIZE;
            assert!(elf[tail].iter().all(|&byte| byte == 0));
        }
    }

    fn with_packed_relocations(addresses: &[u64]) -> (Vec<u8>, usize) {
        let mut elf = with_relocations(Architecture::X86_64, &[], 0);
        let dynamic = dynamic_offset(&elf);
        let table = read_u64(&elf, dynamic + 8).unwrap();
        let words = pack(addresses);
        let entries = [
            (DT_RELR, table),
            (DT_RELRSZ, words.len() as u64 * WORD_SIZE),
            (DT_NULL, 0),
        ];
        for (index, (tag, value)) in entries.into_iter().enumerate() {
            write_u64(&mut elf, dynamic + index * DYNAMIC_ENTRY_SIZE, tag);
            write_u64(&mut elf, dynamic + index * DYNAMIC_ENTRY_SIZE + 8, value);
        }
        for (index, &word) in words.iter().enumerate() {
            write_u64(&mut elf, TABLE_OFFSET + index * WORD_SIZE as usize, word);
        }
        (elf, words.len())
    }

    fn read_packed_relocations(elf: &[u8]) -> Vec<u64> {
        let size = read_u64(elf, dynamic_offset(elf) + DYNAMIC_ENTRY_SIZE + 8).unwrap() as usize;
        unpack(
            (TABLE_OFFSET..TABLE_OFFSET + size)
                .step_by(WORD_SIZE as usize)
                .map(|at| read_u64(elf, at).unwrap()),
        )
    }

    #[test]
    fn packing_and_unpacking_agree() {
        assert_eq!(pack(&[0x1000]), [0x1000]);
        assert_eq!(pack(&[0x1000, 0x1008, 0x1018]), [0x1000, 0b101 << 1 | 1]);
        assert_eq!(pack(&[0x1000, 0x1000 + 64 * 8]), [0x1000, 0x1000 + 64 * 8]);
        assert_eq!(
            pack(&[0x1000, 0x1000 + 63 * 8, 0x1000 + 64 * 8]),
            [0x1000, 1 << 63 | 1, 0b1 << 1 | 1]
        );
        for addresses in [
            vec![],
            vec![0x1000],
            (0..500).map(|index| 0x2000 + index * 8).collect(),
            (0..500)
                .map(|index| 0x2000 + index * index * 8)
                .collect::<Vec<u64>>(),
        ] {
            assert_eq!(unpack(pack(&addresses).into_iter()), addresses);
        }
    }

    #[test]
    fn drops_packed_relative_relocations_in_removed_ranges() {
        let addresses: Vec<u64> = (0..0x1000u64)
            .map(|index| 0x1000 + index * 8)
            .chain([0xa000, 0xa010, 0xc000])
            .collect();
        let (mut elf, word_count) = with_packed_relocations(&addresses);
        let removed = [
            AddressRange {
                start: 0x1000,
                end: 0x1010,
            },
            AddressRange {
                start: 0x2000,
                end: 0x3004,
            },
            AddressRange {
                start: 0xa000,
                end: 0xa008,
            },
        ];
        let kept: Vec<u64> = addresses
            .iter()
            .copied()
            .filter(|&address| !is_removed(&removed, address))
            .collect();
        assert_eq!(
            remove_relative_relocations(&mut elf, &removed),
            Ok((addresses.len() - kept.len()) as u64)
        );
        assert_eq!(addresses.len() - kept.len(), 2 + 0x200 + 1);
        assert_eq!(read_packed_relocations(&elf), kept);
        let kept_words = pack(&kept).len();
        assert!(kept_words <= word_count);
        assert!(
            elf[TABLE_OFFSET + kept_words * 8..TABLE_OFFSET + word_count * 8]
                .iter()
                .all(|&byte| byte == 0)
        );
    }

    #[test]
    fn no_packed_relocation_removed_changes_nothing() {
        let (original, _) = with_packed_relocations(&[0x1000, 0x1008, 0x4000]);
        let mut elf = original.clone();
        assert_eq!(
            remove_relative_relocations(
                &mut elf,
                &[AddressRange {
                    start: 0x2000,
                    end: 0x3000
                }]
            ),
            Ok(0)
        );
        assert_eq!(elf, original);
    }

    #[test]
    fn nothing_removed_changes_nothing() {
        let original = with_relocations(Architecture::X86_64, &[(0x1000, R_X86_64_RELATIVE)], 1);
        let mut elf = original.clone();
        assert_eq!(
            remove_relative_relocations(
                &mut elf,
                &[AddressRange {
                    start: 0x2000,
                    end: 0x3000
                }]
            ),
            Ok(0)
        );
        assert_eq!(elf, original);
    }
}
