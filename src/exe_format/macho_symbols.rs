use core::mem::size_of;

use crate::elf_symbols::SymbolTable;
use crate::image::KnownSection;
use crate::macho::{MachoFile, SEG_LINKEDIT};
use crate::macho_types::{
    INDIRECT_SYMBOL_LOCAL_OR_ABS, LC, N_SECT, dysymtab_command, linkedit_data_command,
    mach_header_64, nlist_64, section_64, segment_command_64, symtab_command,
};
use crate::{align_up, read_struct, write_struct};

const SYMBOL_ENTRY_SIZE: usize = size_of::<nlist_64>();
const INDIRECT_ENTRY_SIZE: usize = size_of::<u32>();
const SIGNATURE_ALIGNMENT: usize = 16;
const SEGMENT_ALIGNMENT: u64 = 16 * 1024;

struct SymbolCommands {
    symtab: (usize, symtab_command),
    dysymtab: (usize, dysymtab_command),
    signature: Option<(usize, linkedit_data_command)>,
    linkedit: (usize, segment_command_64),
    bun_ordinal: u8,
    bun_address: u64,
}

struct LinkeditLayout {
    symbols_at: usize,
    indirect_at: usize,
    strings_at: usize,
    strings_end: usize,
    after_strings: usize,
}

fn write_command<T: Copy>(data: &mut [u8], at: usize, command: &T) {
    write_struct(&mut data[at..][..size_of::<T>()], command);
}

fn find_ld_layout(commands: &SymbolCommands, length: usize) -> Option<LinkeditLayout> {
    let (_, symtab) = commands.symtab;
    let (_, dysymtab) = commands.dysymtab;
    let (_, linkedit) = commands.linkedit;
    let signature = commands.signature;
    let symbols_at = symtab.symoff as usize;
    let strings_at = symtab.stroff as usize;
    let strings_end = strings_at.checked_add(symtab.strsize as usize)?;
    let indirect_at = if dysymtab.nindirectsyms == 0 {
        strings_at
    } else {
        dysymtab.indirectsymoff as usize
    };
    let after_strings = signature.map_or(length, |(_, command)| command.dataoff as usize);
    let matches_ld_layout = dysymtab.ilocalsym == 0
        && dysymtab.iextdefsym == dysymtab.nlocalsym
        && dysymtab.iundefsym as u64 == dysymtab.iextdefsym as u64 + dysymtab.nextdefsym as u64
        && symtab.nsyms as u64 == dysymtab.iundefsym as u64 + dysymtab.nundefsym as u64
        && dysymtab.nextrel == 0
        && dysymtab.nlocrel == 0
        && dysymtab.ntoc == 0
        && dysymtab.nmodtab == 0
        && dysymtab.nextrefsyms == 0
        && symbols_at.checked_add(SYMBOL_ENTRY_SIZE * symtab.nsyms as usize)? == indirect_at
        && indirect_at.checked_add(INDIRECT_ENTRY_SIZE * dysymtab.nindirectsyms as usize)?
            == strings_at
        && strings_end <= after_strings
        && after_strings - strings_end < SIGNATURE_ALIGNMENT
        && after_strings <= length
        && signature.is_none_or(|(_, command)| {
            command.dataoff as u64 + command.datasize as u64 == length as u64
        })
        && linkedit.fileoff.checked_add(linkedit.filesize)? == length as u64;
    if !matches_ld_layout {
        return None;
    }
    Some(LinkeditLayout {
        symbols_at,
        indirect_at,
        strings_at,
        strings_end,
        after_strings,
    })
}

impl MachoFile {
    fn find_symbol_commands(&self) -> Option<SymbolCommands> {
        let names = KnownSection::Payload.names();
        let lc_base = size_of::<mach_header_64>();
        let seg_sz = size_of::<segment_command_64>();
        let sect_sz = size_of::<section_64>();
        let mut symtab: Option<(usize, symtab_command)> = None;
        let mut dysymtab: Option<(usize, dysymtab_command)> = None;
        let mut signature: Option<(usize, linkedit_data_command)> = None;
        let mut linkedit: Option<(usize, segment_command_64)> = None;
        let mut bun: Option<(u8, u64)> = None;
        let mut ordinal: usize = 0;
        let mut iter = self.iterator();
        while let Some(entry) = iter.next() {
            let at = lc_base + entry.offset;
            match entry.hdr.cmd {
                LC::SEGMENT_64 => {
                    let command = entry.cast::<segment_command_64>()?;
                    let nsects = command.nsects as usize;
                    if nsects.checked_mul(sect_sz)?.checked_add(seg_sz)? > entry.data.len() {
                        return None;
                    }
                    let is_bun_segment = command.seg_name() == names.macho_segment;
                    for i in 0..nsects {
                        ordinal += 1;
                        let sect: section_64 =
                            read_struct(&self.data[at + seg_sz + i * sect_sz..][..sect_sz]);
                        if is_bun_segment && sect.sect_name() == names.macho_section {
                            bun = Some((u8::try_from(ordinal).ok()?, sect.addr));
                        }
                    }
                    if command.seg_name() == SEG_LINKEDIT {
                        linkedit = Some((at, command));
                    }
                }
                LC::SYMTAB => symtab = Some((at, entry.cast::<symtab_command>()?)),
                LC::DYSYMTAB => dysymtab = Some((at, entry.cast::<dysymtab_command>()?)),
                LC::CODE_SIGNATURE => {
                    signature = Some((at, entry.cast::<linkedit_data_command>()?));
                }
                _ => {}
            }
        }
        let (bun_ordinal, bun_address) = bun?;
        Some(SymbolCommands {
            symtab: symtab?,
            dysymtab: dysymtab?,
            signature,
            linkedit: linkedit?,
            bun_ordinal,
            bun_address,
        })
    }

    /// Call before `write_section`, which sizes the signature from the offsets this moves.
    pub fn add_symbols(&mut self, table: &[u8], image_offset: u64) -> Option<()> {
        let commands = self.find_symbol_commands()?;
        let length = self.data.len();
        let LinkeditLayout {
            symbols_at,
            indirect_at,
            strings_at,
            strings_end,
            after_strings,
        } = find_ld_layout(&commands, length)?;
        let SymbolCommands {
            symtab: (symtab_at, mut symtab),
            dysymtab: (dysymtab_at, mut dysymtab),
            signature,
            linkedit: (linkedit_at, mut linkedit),
            bun_ordinal,
            bun_address,
        } = commands;
        let locals_end = symbols_at + SYMBOL_ENTRY_SIZE * dysymtab.nlocalsym as usize;

        let symbols = SymbolTable::parse(table)?;
        let count = u32::try_from(symbols.len()).ok()?;
        let code = symbols.code_address(bun_address, image_offset)?;

        let new_symbols_size = SYMBOL_ENTRY_SIZE * symbols.len();
        let mut tail: Vec<u8> = Vec::with_capacity(
            length - symbols_at + new_symbols_size + symbols.names.len() + SIGNATURE_ALIGNMENT,
        );
        tail.extend_from_slice(&self.data[symbols_at..locals_end]);
        for symbol in symbols.iter() {
            let n_strx = symtab.strsize.checked_add(symbol.name_offset)?;
            let n_value = code.checked_add(symbol.offset as u64)?;
            tail.extend_from_slice(&n_strx.to_le_bytes());
            tail.extend_from_slice(&[N_SECT, bun_ordinal, 0, 0]);
            tail.extend_from_slice(&n_value.to_le_bytes());
        }
        tail.extend_from_slice(&self.data[locals_end..indirect_at]);
        let new_indirect_at = symbols_at + tail.len();
        let indirect_table = &self.data[indirect_at..strings_at];
        for index in indirect_table.as_chunks::<INDIRECT_ENTRY_SIZE>().0 {
            let index = u32::from_le_bytes(*index);
            let moves = index & INDIRECT_SYMBOL_LOCAL_OR_ABS == 0 && index >= dysymtab.nlocalsym;
            let new_index = index.checked_add(if moves { count } else { 0 })?;
            tail.extend_from_slice(&new_index.to_le_bytes());
        }
        let new_strings_at = symbols_at + tail.len();
        tail.extend_from_slice(&self.data[strings_at..strings_end]);
        tail.extend_from_slice(symbols.names);
        while !(symbols_at + tail.len()).is_multiple_of(SIGNATURE_ALIGNMENT) {
            tail.push(0);
        }
        let new_after_strings = symbols_at + tail.len();
        tail.extend_from_slice(&self.data[after_strings..]);
        let growth = new_after_strings.checked_sub(after_strings)? as u64;

        symtab.nsyms = symtab.nsyms.checked_add(count)?;
        symtab.stroff = u32::try_from(new_strings_at).ok()?;
        symtab.strsize = u32::try_from(new_after_strings - new_strings_at).ok()?;
        dysymtab.nlocalsym = dysymtab.nlocalsym.checked_add(count)?;
        dysymtab.iextdefsym = dysymtab.iextdefsym.checked_add(count)?;
        dysymtab.iundefsym = dysymtab.iundefsym.checked_add(count)?;
        if dysymtab.nindirectsyms != 0 {
            dysymtab.indirectsymoff = u32::try_from(new_indirect_at).ok()?;
        }
        let signature = match signature {
            Some((at, mut command)) => {
                command.dataoff = u32::try_from(new_after_strings).ok()?;
                Some((at, command))
            }
            None => None,
        };
        linkedit.filesize += growth;
        linkedit.vmsize = align_up(linkedit.filesize, SEGMENT_ALIGNMENT);

        self.data.truncate(symbols_at);
        self.data.extend_from_slice(&tail);
        write_command(&mut self.data, symtab_at, &symtab);
        write_command(&mut self.data, dysymtab_at, &dysymtab);
        write_command(&mut self.data, linkedit_at, &linkedit);
        if let Some((at, command)) = signature {
            write_command(&mut self.data, at, &command);
        }
        Some(())
    }
}

#[cfg(test)]
mod tests {
    use bun_core::slice_to_nul;

    use super::*;
    use crate::elf_symbols::tests::{CODE_OFFSET, encode_table, symbol};
    use crate::macho::MachoSigner;
    use crate::macho_types::{CPU_TYPE_ARM64, MH_EXECUTE, MH_MAGIC_64, SuperBlob, load_command};

    const N_EXT: u8 = 0x01;
    const INDIRECT_SYMBOL_LOCAL: u32 = 0x8000_0000;

    const SEGMENT_COMMAND_SIZE: usize = size_of::<segment_command_64>();
    const SECTION_SIZE: usize = size_of::<section_64>();
    const TEXT_COMMAND: usize = size_of::<mach_header_64>();
    const BUN_COMMAND: usize = TEXT_COMMAND + SEGMENT_COMMAND_SIZE + SECTION_SIZE;
    const LINKEDIT_COMMAND: usize = BUN_COMMAND + SEGMENT_COMMAND_SIZE + SECTION_SIZE;
    const SYMTAB_COMMAND: usize = LINKEDIT_COMMAND + SEGMENT_COMMAND_SIZE;
    const DYSYMTAB_COMMAND: usize = SYMTAB_COMMAND + size_of::<symtab_command>();
    const SIGNATURE_COMMAND: usize = DYSYMTAB_COMMAND + size_of::<dysymtab_command>();
    const COMMANDS_END: usize = SIGNATURE_COMMAND + size_of::<linkedit_data_command>();
    const COMMAND_COUNT: u32 = 6;

    const IMAGE_BASE: u64 = 0x1_0000_0000;
    const SEGMENT_SIZE: usize = SEGMENT_ALIGNMENT as usize;
    const BUN_OFFSET: usize = SEGMENT_SIZE;
    const BUN_ORDINAL: u8 = 2;
    const SYMBOLS_OFFSET: usize = 2 * SEGMENT_SIZE;
    const INDIRECT_OFFSET: usize = SYMBOLS_OFFSET + OLD_SYMBOLS.len() * SYMBOL_ENTRY_SIZE;
    const STRINGS_OFFSET: usize = INDIRECT_OFFSET + OLD_INDIRECT_TABLE.len() * INDIRECT_ENTRY_SIZE;
    const STRINGS_END: usize = STRINGS_OFFSET + OLD_STRINGS.len();
    const SIGNATURE_OFFSET: usize = STRINGS_END.next_multiple_of(SIGNATURE_ALIGNMENT);
    const SIGNATURE: [u8; 32] = [0xfa; 32];

    const OLD_STRINGS: &[u8] = b"\0_local_a\0_local_b\0_main\0_malloc\0";
    const OLD_SYMBOLS: [nlist_64; 4] = [
        old_symbol(1, N_SECT, 1, IMAGE_BASE + 0x1000),
        old_symbol(10, N_SECT, 1, IMAGE_BASE + 0x1010),
        old_symbol(19, N_SECT | N_EXT, 1, IMAGE_BASE + 0x1020),
        old_symbol(25, N_EXT, 0, 0),
    ];
    const OLD_INDIRECT_TABLE: [u32; 2] = [3, INDIRECT_SYMBOL_LOCAL];

    const IMAGE_OFFSET: u64 = 120;
    const NEW_NAMES: &[u8] = b"main\0Parser.parse\0";
    const PAYLOAD: [u8; 2 * SEGMENT_SIZE] = [0x90; 2 * SEGMENT_SIZE];

    const fn old_symbol(n_strx: u32, n_type: u8, n_sect: u8, n_value: u64) -> nlist_64 {
        nlist_64 {
            n_strx,
            n_type,
            n_sect,
            n_desc: 0,
            n_value,
        }
    }

    fn toy_table() -> Vec<u8> {
        let symbols = [symbol(0, 0x100, 0), symbol(0x100, 0x100, 5)];
        encode_table(0x200, &symbols, NEW_NAMES)
    }

    fn padded_name(name: &[u8]) -> [u8; 16] {
        let mut padded = [0; 16];
        padded[..name.len()].copy_from_slice(name);
        padded
    }

    fn append_struct<T: Copy>(file: &mut Vec<u8>, value: &T) {
        let at = file.len();
        file.resize(at + size_of::<T>(), 0);
        write_command(file, at, value);
    }

    fn write_segment(
        file: &mut [u8],
        at: usize,
        name: &[u8],
        section_name: Option<&[u8]>,
        offset: usize,
        size: usize,
    ) {
        let section_count = section_name.iter().count();
        let mut command: segment_command_64 = read_struct(&[0; SEGMENT_COMMAND_SIZE]);
        command.cmd = LC::SEGMENT_64;
        command.cmdsize = (SEGMENT_COMMAND_SIZE + section_count * SECTION_SIZE) as u32;
        command.vmaddr = IMAGE_BASE + offset as u64;
        command.vmsize = align_up(size as u64, SEGMENT_ALIGNMENT);
        command.fileoff = offset as u64;
        command.filesize = size as u64;
        command.nsects = section_count as u32;
        write_command(file, at, &command);
        write_command(file, at + size_of::<load_command>(), &padded_name(name));
        if let Some(section_name) = section_name {
            let section = section_64 {
                sectname: padded_name(section_name),
                segname: padded_name(name),
                addr: command.vmaddr,
                size: size as u64,
                offset: offset as u32,
                ..read_struct(&[0; SECTION_SIZE])
            };
            write_command(file, at + SEGMENT_COMMAND_SIZE, &section);
        }
    }

    fn write_segments(file: &mut [u8]) {
        let linkedit_size = file.len() - SYMBOLS_OFFSET;
        write_segment(
            file,
            TEXT_COMMAND,
            b"__TEXT",
            Some(b"__text"),
            0,
            SEGMENT_SIZE,
        );
        write_segment(
            file,
            BUN_COMMAND,
            b"__BUN",
            Some(b"__bun"),
            BUN_OFFSET,
            SEGMENT_SIZE,
        );
        write_segment(
            file,
            LINKEDIT_COMMAND,
            SEG_LINKEDIT,
            None,
            SYMBOLS_OFFSET,
            linkedit_size,
        );
    }

    fn toy_macho() -> Vec<u8> {
        let mut file: Vec<u8> = (0..SYMBOLS_OFFSET)
            .map(|offset| (offset % 251) as u8)
            .collect();
        for symbol in &OLD_SYMBOLS {
            append_struct(&mut file, symbol);
        }
        append_struct(&mut file, &OLD_INDIRECT_TABLE);
        file.extend_from_slice(OLD_STRINGS);
        file.resize(SIGNATURE_OFFSET, 0);
        file.extend_from_slice(&SIGNATURE);

        let header = mach_header_64 {
            magic: MH_MAGIC_64,
            cputype: CPU_TYPE_ARM64,
            cpusubtype: 0,
            filetype: MH_EXECUTE,
            ncmds: COMMAND_COUNT,
            sizeofcmds: (COMMANDS_END - TEXT_COMMAND) as u32,
            flags: 0,
            reserved: 0,
        };
        let symtab = symtab_command {
            cmd: LC::SYMTAB,
            cmdsize: size_of::<symtab_command>() as u32,
            symoff: SYMBOLS_OFFSET as u32,
            nsyms: OLD_SYMBOLS.len() as u32,
            stroff: STRINGS_OFFSET as u32,
            strsize: OLD_STRINGS.len() as u32,
        };
        let dysymtab = dysymtab_command {
            cmd: LC::DYSYMTAB,
            cmdsize: size_of::<dysymtab_command>() as u32,
            nlocalsym: 2,
            iextdefsym: 2,
            nextdefsym: 1,
            iundefsym: 3,
            nundefsym: 1,
            indirectsymoff: INDIRECT_OFFSET as u32,
            nindirectsyms: OLD_INDIRECT_TABLE.len() as u32,
            ..read_struct(&[0; size_of::<dysymtab_command>()])
        };
        let signature = linkedit_data_command {
            cmd: LC::CODE_SIGNATURE,
            cmdsize: size_of::<linkedit_data_command>() as u32,
            dataoff: SIGNATURE_OFFSET as u32,
            datasize: SIGNATURE.len() as u32,
        };
        write_command(&mut file, 0, &header);
        write_segments(&mut file);
        write_command(&mut file, SYMTAB_COMMAND, &symtab);
        write_command(&mut file, DYSYMTAB_COMMAND, &dysymtab);
        write_command(&mut file, SIGNATURE_COMMAND, &signature);
        file
    }

    fn read_at<T: Copy>(file: &[u8], at: usize) -> T {
        read_struct(&file[at..][..size_of::<T>()])
    }

    fn edit_at<T: Copy>(file: &[u8], at: usize, edit: impl FnOnce(&mut T)) -> Vec<u8> {
        let mut edited = file.to_vec();
        let mut value: T = read_at(file, at);
        edit(&mut value);
        write_command(&mut edited, at, &value);
        edited
    }

    fn edit_symtab(file: &[u8], edit: impl FnOnce(&mut symtab_command)) -> Vec<u8> {
        edit_at(file, SYMTAB_COMMAND, edit)
    }

    fn edit_dysymtab(file: &[u8], edit: impl FnOnce(&mut dysymtab_command)) -> Vec<u8> {
        edit_at(file, DYSYMTAB_COMMAND, edit)
    }

    fn edit_signature(file: &[u8], edit: impl FnOnce(&mut linkedit_data_command)) -> Vec<u8> {
        edit_at(file, SIGNATURE_COMMAND, edit)
    }

    fn edit_linkedit(file: &[u8], edit: impl FnOnce(&mut segment_command_64)) -> Vec<u8> {
        edit_at(file, LINKEDIT_COMMAND, edit)
    }

    fn edit_bun_section(file: &[u8], edit: impl FnOnce(&mut section_64)) -> Vec<u8> {
        edit_at(file, BUN_COMMAND + SEGMENT_COMMAND_SIZE, edit)
    }

    fn symbol_bytes(file: &[u8], index: usize) -> &[u8] {
        let symtab: symtab_command = read_at(file, SYMTAB_COMMAND);
        &file[symtab.symoff as usize + index * SYMBOL_ENTRY_SIZE..][..SYMBOL_ENTRY_SIZE]
    }

    fn symbol_name(file: &[u8], index: usize) -> &[u8] {
        let symtab: symtab_command = read_at(file, SYMTAB_COMMAND);
        let symbol: nlist_64 = read_struct(symbol_bytes(file, index));
        slice_to_nul(&file[(symtab.stroff + symbol.n_strx) as usize..])
    }

    fn add_symbols(file: &[u8], table: &[u8]) -> (Option<()>, Vec<u8>) {
        let mut macho = MachoFile {
            header: read_at(file, 0),
            data: file.to_vec(),
            segment: read_struct(&[0; SEGMENT_COMMAND_SIZE]),
            section: read_struct(&[0; SECTION_SIZE]),
        };
        let result = macho.add_symbols(table, IMAGE_OFFSET);
        (result, macho.data)
    }

    fn assert_linkedit_ends_file(file: &[u8]) {
        let linkedit: segment_command_64 = read_at(file, LINKEDIT_COMMAND);
        let aligned_size = align_up(linkedit.filesize, SEGMENT_ALIGNMENT);
        assert_eq!(linkedit.fileoff as usize, SYMBOLS_OFFSET);
        assert_eq!(linkedit.fileoff + linkedit.filesize, file.len() as u64);
        assert_eq!(linkedit.vmsize, aligned_size);
    }

    fn assert_rejected(file: &[u8], table: &[u8]) {
        let (result, data) = add_symbols(file, table);
        assert_eq!(result, None);
        assert!(data == file);
    }

    #[test]
    fn adds_local_symbols() {
        let old = toy_macho();
        let (result, new) = add_symbols(&old, &toy_table());
        assert_eq!(result, Some(()));

        let symtab: symtab_command = read_at(&new, SYMTAB_COMMAND);
        let dysymtab: dysymtab_command = read_at(&new, DYSYMTAB_COMMAND);
        assert_eq!(symtab.symoff as usize, SYMBOLS_OFFSET);
        assert_eq!(symtab.nsyms, 6);
        assert_eq!((dysymtab.ilocalsym, dysymtab.nlocalsym), (0, 4));
        assert_eq!((dysymtab.iextdefsym, dysymtab.nextdefsym), (4, 1));
        assert_eq!((dysymtab.iundefsym, dysymtab.nundefsym), (5, 1));

        let code = IMAGE_BASE + BUN_OFFSET as u64 + 8 + IMAGE_OFFSET + CODE_OFFSET as u64;
        let new_symbols: [(&[u8], u64); 2] = [(b"main", code), (b"Parser.parse", code + 0x100)];
        for (index, (name, address)) in (2..).zip(new_symbols) {
            let symbol: nlist_64 = read_struct(symbol_bytes(&new, index));
            let kind = (symbol.n_type, symbol.n_sect, symbol.n_desc);
            assert_eq!(symbol_name(&new, index), name);
            assert_eq!(kind, (N_SECT, BUN_ORDINAL, 0));
            assert_eq!(symbol.n_value, address);
        }
        for (old_index, new_index) in [(0, 0), (1, 1), (2, 4), (3, 5)] {
            assert_eq!(symbol_bytes(&new, new_index), symbol_bytes(&old, old_index));
            assert_eq!(symbol_name(&new, new_index), symbol_name(&old, old_index));
        }
    }

    #[test]
    fn moves_tables_after_symbols() {
        let old = toy_macho();
        let (_, new) = add_symbols(&old, &toy_table());
        let growth = new.len() - old.len();
        let symbols_growth = 2 * SYMBOL_ENTRY_SIZE;
        let symtab: symtab_command = read_at(&new, SYMTAB_COMMAND);
        let dysymtab: dysymtab_command = read_at(&new, DYSYMTAB_COMMAND);
        let signature: linkedit_data_command = read_at(&new, SIGNATURE_COMMAND);

        let indirect_offset = dysymtab.indirectsymoff as usize;
        let indirect_table: [u32; 2] = read_at(&new, indirect_offset);
        assert_eq!(indirect_offset, INDIRECT_OFFSET + symbols_growth);
        assert_eq!(indirect_table, [5, INDIRECT_SYMBOL_LOCAL]);
        assert_eq!(symtab.stroff as usize, STRINGS_OFFSET + symbols_growth);
        assert_eq!(symtab.stroff + symtab.strsize, signature.dataoff);

        assert!(growth > 0);
        assert_eq!(signature.dataoff as usize, SIGNATURE_OFFSET + growth);
        assert_eq!(signature.dataoff as usize % SIGNATURE_ALIGNMENT, 0);
        assert_eq!(signature.datasize as usize, SIGNATURE.len());
        assert_eq!(new[signature.dataoff as usize..], SIGNATURE);
        assert_linkedit_ends_file(&new);

        assert!(new[..LINKEDIT_COMMAND] == old[..LINKEDIT_COMMAND]);
        assert!(new[COMMANDS_END..SYMBOLS_OFFSET] == old[COMMANDS_END..SYMBOLS_OFFSET]);
    }

    #[test]
    fn adds_symbols_without_signature() {
        let mut old = edit_signature(&toy_macho(), |command| command.cmd = LC::DATA_IN_CODE);
        old.truncate(SIGNATURE_OFFSET);
        let signature_size = SIGNATURE.len() as u64;
        let old = edit_linkedit(&old, |linkedit| linkedit.filesize -= signature_size);

        let (result, new) = add_symbols(&old, &toy_table());
        let symtab: symtab_command = read_at(&new, SYMTAB_COMMAND);
        assert_eq!(result, Some(()));
        assert_eq!(symtab.nsyms, 6);
        assert_eq!((symtab.stroff + symtab.strsize) as usize, new.len());
        assert_eq!(symbol_name(&new, 3), b"Parser.parse");
        assert_eq!(symbol_name(&new, 5), b"_malloc");
        assert!(new[SIGNATURE_COMMAND..COMMANDS_END] == old[SIGNATURE_COMMAND..COMMANDS_END]);
        assert_linkedit_ends_file(&new);
    }

    #[test]
    fn payload_writer_moves_and_signs_symbols() {
        let mut macho = MachoFile::init(&toy_macho(), PAYLOAD.len()).unwrap();
        assert_eq!(macho.add_symbols(&toy_table(), IMAGE_OFFSET), Some(()));
        let with_symbols = macho.data.clone();
        macho.write_section(&PAYLOAD, true).unwrap();
        let mut signed = Vec::new();
        let written = macho.build_and_sign(&mut signed).unwrap();

        let signature: linkedit_data_command = read_at(&signed, SIGNATURE_COMMAND);
        let signature_offset = signature.dataoff as usize;
        let signature_size = MachoSigner::compute_signature_size(signature_offset as u64);
        let super_blob: SuperBlob = read_at(&signed, signature_offset);
        let linkedit: segment_command_64 = read_at(&signed, LINKEDIT_COMMAND);
        assert_eq!(signature.datasize as usize, signature_size);
        assert_eq!(u32::from_be(super_blob.length), signature.datasize);
        assert_eq!(signed.len(), signature_offset + signature_size);
        assert_eq!(written, signed.len());
        assert_eq!(linkedit.fileoff + linkedit.filesize, signed.len() as u64);

        let old_symtab: symtab_command = read_at(&with_symbols, SYMTAB_COMMAND);
        let new_symtab: symtab_command = read_at(&signed, SYMTAB_COMMAND);
        let bun_section: section_64 = read_at(&signed, BUN_COMMAND + SEGMENT_COMMAND_SIZE);
        assert!(new_symtab.symoff > old_symtab.symoff);
        assert_eq!(new_symtab.nsyms, 6);
        assert_eq!(bun_section.addr, IMAGE_BASE + BUN_OFFSET as u64);
        for index in 0..new_symtab.nsyms as usize {
            let old_symbol = symbol_bytes(&with_symbols, index);
            assert_eq!(symbol_bytes(&signed, index), old_symbol);
            assert_eq!(
                symbol_name(&signed, index),
                symbol_name(&with_symbols, index)
            );
        }
    }

    #[test]
    fn rejects_file_with_payload() {
        let mut macho = MachoFile::init(&toy_macho(), PAYLOAD.len()).unwrap();
        macho.write_section(&PAYLOAD, true).unwrap();
        let with_payload = macho.data.clone();
        assert_eq!(macho.add_symbols(&toy_table(), IMAGE_OFFSET), None);
        assert!(macho.data == with_payload);
    }

    #[test]
    fn rejects_other_layouts() {
        let toy = toy_macho();
        let table = toy_table();
        let padding = SIGNATURE_OFFSET - STRINGS_END;
        let padding_growth = (SIGNATURE_ALIGNMENT - padding) as u32;
        let rejected = [
            edit_dysymtab(&toy, |dysymtab| dysymtab.nextrel = 1),
            edit_dysymtab(&toy, |dysymtab| dysymtab.ilocalsym = 1),
            edit_symtab(&toy, |symtab| symtab.strsize -= padding_growth),
            edit_bun_section(&toy, |section| section.sectname[2] = b'x'),
            edit_linkedit(&toy, |linkedit| linkedit.filesize -= 1),
            edit_signature(&toy, |signature| signature.datasize -= 1),
        ];
        for file in &rejected {
            assert_rejected(file, &table);
        }

        let widest_padding = edit_symtab(&toy, |symtab| symtab.strsize -= padding_growth - 1);
        assert_eq!(add_symbols(&widest_padding, &table).0, Some(()));
    }

    #[test]
    fn rejects_malformed_table() {
        let toy = toy_macho();
        let table = toy_table();
        assert_rejected(&toy, &table[..table.len() - 1]);
        assert_rejected(&toy, &[]);
    }

    #[test]
    fn rejects_shrinking_linkedit() {
        let aligned_strings_end = SIGNATURE_OFFSET - SIGNATURE_ALIGNMENT;
        let strings_size = (aligned_strings_end - STRINGS_OFFSET) as u32;
        let signature_shift = SIGNATURE_ALIGNMENT as u32 - 4;
        let toy = edit_symtab(&toy_macho(), |symtab| symtab.strsize = strings_size);
        let toy = edit_signature(&toy, |signature| {
            signature.dataoff -= signature_shift;
            signature.datasize += signature_shift;
        });
        assert_rejected(&toy, &encode_table(0, &[], b""));
    }
}
