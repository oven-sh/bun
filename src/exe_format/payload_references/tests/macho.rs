use core::mem::{offset_of, size_of};

use super::super::macho::{
    EXPORT_KIND_ABSOLUTE, EXPORT_REEXPORT, EXPORT_STUB_AND_RESOLVER, bind_opcode, rebase_opcode,
};
use super::{
    Checked, MalformedExecutable, UnsupportedRelocations, bytes_of, check, dynamic_symbol_at, put,
    put_struct, relocation_at, zeroed,
};
use crate::macho_types::{
    DYLD_CHAINED_PTR_START_NONE as NONE, LC, MH_MAGIC_64, N_SECT, dyld_chained_fixups_header,
    dyld_chained_starts_in_segment, dyld_info_command, dysymtab_command, linkedit_data_command,
    mach_header_64, nlist_64, section_64, segment_command_64, symtab_command,
};

const PAGE: u64 = 0x4000;
const BASE: u64 = 0x1_0000_0000;
const START: u64 = BASE + 2 * PAGE;
const SIZE: u64 = PAGE + 0x100;
const END: u64 = START + SIZE;
const SEGMENT_NAME_OFFSET: usize = 8;
const N_EXT: u8 = 0x01;
const THREADED: u8 = 0xd0;
const TRIE_EDGE_SIZE: usize = 4;
const STARTS_OFFSET: usize = 32;

const DATA: u8 = 2;
const BUN: u8 = 3;
const AFTER: u8 = 4;
const LINKEDIT: usize = 5;
/// Name, first page and number of pages. The last page of `__BUN` holds no byte of the payload.
const SEGMENTS: [(&[u8], u64, u64); 6] = [
    (b"__PAGEZERO", 0, 0),
    (b"__TEXT", 0, 1),
    (b"__DATA", 1, 1),
    (b"__BUN", 2, 3),
    (b"__AFTER", 5, 1),
    (b"__LINKEDIT", 6, 1),
];
const LINKEDIT_OFFSET: u32 = (SEGMENTS[LINKEDIT].1 * PAGE) as u32;

#[derive(Default)]
struct Toy {
    chained_fixups: Option<Vec<u8>>,
    export_trie: Option<Vec<u8>>,
    rebases: Vec<u8>,
    binds: Vec<u8>,
    weak_binds: Vec<u8>,
    lazy_binds: Vec<u8>,
    exports_of_dyld_info: Vec<u8>,
    local_symbols: Vec<nlist_64>,
    defined_symbols: Vec<nlist_64>,
    classic_relocation_count: u32,
}

struct Builder {
    commands: Vec<u8>,
    command_count: u32,
    linkedit: Vec<u8>,
}

impl Builder {
    fn add_command<T: Copy>(&mut self, command: &T) {
        self.commands.extend_from_slice(&bytes_of(command));
        self.command_count += 1;
    }

    fn add_linkedit(&mut self, bytes: &[u8]) -> (u32, u32) {
        let offset = LINKEDIT_OFFSET + self.linkedit.len() as u32;
        self.linkedit.extend_from_slice(bytes);
        self.linkedit
            .resize(self.linkedit.len().next_multiple_of(8), 0);
        (offset, bytes.len() as u32)
    }

    fn add_linkedit_command(&mut self, cmd: u32, bytes: &[u8]) {
        let (dataoff, datasize) = self.add_linkedit(bytes);
        self.add_command(&linkedit_data_command {
            cmd,
            cmdsize: size_of::<linkedit_data_command>() as u32,
            dataoff,
            datasize,
        });
    }

    fn add_segments(&mut self) {
        for (index, (name, first_page, page_count)) in SEGMENTS.into_iter().enumerate() {
            let has_payload = index == usize::from(BUN);
            let sections_size = if has_payload {
                size_of::<section_64>()
            } else {
                0
            };
            let mut segment: segment_command_64 = zeroed();
            segment.cmd = LC::SEGMENT_64;
            segment.cmdsize = (size_of::<segment_command_64>() + sections_size) as u32;
            segment.vmaddr = if page_count == 0 {
                0
            } else {
                BASE + first_page * PAGE
            };
            segment.vmsize = if page_count == 0 {
                BASE
            } else {
                page_count * PAGE
            };
            segment.fileoff = first_page * PAGE;
            segment.filesize = page_count * PAGE;
            segment.nsects = u32::from(has_payload);
            let at = self.commands.len();
            self.add_command(&segment);
            put(&mut self.commands, at + SEGMENT_NAME_OFFSET, name);
            if has_payload {
                let mut section: section_64 = zeroed();
                section.sectname[..5].copy_from_slice(b"__bun");
                section.segname[..name.len()].copy_from_slice(name);
                section.addr = START;
                section.size = SIZE;
                section.offset = (START - BASE) as u32;
                self.commands.extend_from_slice(&bytes_of(&section));
            }
        }
    }

    fn add_dyld_info(&mut self, toy: &Toy) {
        let mut info: dyld_info_command = zeroed();
        info.cmd = LC::DYLD_INFO_ONLY;
        info.cmdsize = size_of::<dyld_info_command>() as u32;
        (info.rebase_off, info.rebase_size) = self.add_linkedit(&toy.rebases);
        (info.bind_off, info.bind_size) = self.add_linkedit(&toy.binds);
        (info.weak_bind_off, info.weak_bind_size) = self.add_linkedit(&toy.weak_binds);
        (info.lazy_bind_off, info.lazy_bind_size) = self.add_linkedit(&toy.lazy_binds);
        (info.export_off, info.export_size) = self.add_linkedit(&toy.exports_of_dyld_info);
        self.add_command(&info);
    }

    fn add_symbols(&mut self, toy: &Toy) {
        let symbols = toy.local_symbols.iter().chain(&toy.defined_symbols);
        let table: Vec<u8> = symbols.flat_map(bytes_of).collect();
        let mut symtab: symtab_command = zeroed();
        symtab.cmd = LC::SYMTAB;
        symtab.cmdsize = size_of::<symtab_command>() as u32;
        symtab.symoff = self.add_linkedit(&table).0;
        symtab.nsyms = (table.len() / size_of::<nlist_64>()) as u32;
        self.add_command(&symtab);

        let mut dysymtab: dysymtab_command = zeroed();
        dysymtab.cmd = LC::DYSYMTAB;
        dysymtab.cmdsize = size_of::<dysymtab_command>() as u32;
        dysymtab.nlocalsym = toy.local_symbols.len() as u32;
        dysymtab.iextdefsym = dysymtab.nlocalsym;
        dysymtab.nextdefsym = toy.defined_symbols.len() as u32;
        dysymtab.nlocrel = toy.classic_relocation_count;
        self.add_command(&dysymtab);
    }
}

impl Toy {
    fn build(&self) -> Vec<u8> {
        let mut builder = Builder {
            commands: Vec::new(),
            command_count: 0,
            linkedit: Vec::new(),
        };
        builder.add_segments();
        if let Some(fixups) = &self.chained_fixups {
            builder.add_linkedit_command(LC::DYLD_CHAINED_FIXUPS, fixups);
        }
        if let Some(trie) = &self.export_trie {
            builder.add_linkedit_command(LC::DYLD_EXPORTS_TRIE, trie);
        }
        builder.add_dyld_info(self);
        builder.add_symbols(self);
        assert!(builder.linkedit.len() as u64 <= PAGE);

        let mut header: mach_header_64 = zeroed();
        header.magic = MH_MAGIC_64;
        header.ncmds = builder.command_count;
        header.sizeofcmds = builder.commands.len() as u32;
        let mut file = vec![0u8; (LINKEDIT_OFFSET as u64 + PAGE) as usize];
        put_struct(&mut file, 0, &header);
        put(&mut file, size_of::<mach_header_64>(), &builder.commands);
        put(&mut file, LINKEDIT_OFFSET as usize, &builder.linkedit);
        file
    }
}

fn uleb(mut value: u64) -> Vec<u8> {
    let mut bytes = Vec::new();
    loop {
        let low = (value & 0x7f) as u8;
        value >>= 7;
        if value == 0 {
            bytes.push(low);
            return bytes;
        }
        bytes.push(low | 0x80);
    }
}

fn chained_fixups(version: u32, page_starts_of_segments: &[(u8, &[u16])]) -> Vec<u8> {
    let mut blob = vec![0u8; STARTS_OFFSET + 4 + 4 * SEGMENTS.len()];
    put_struct(&mut blob, STARTS_OFFSET, &(SEGMENTS.len() as u32));
    for &(segment, page_starts) in page_starts_of_segments {
        let at = blob.len().next_multiple_of(8);
        let entry = STARTS_OFFSET + 4 + 4 * usize::from(segment);
        put_struct(&mut blob, entry, &((at - STARTS_OFFSET) as u32));
        let mut record: dyld_chained_starts_in_segment = zeroed();
        record.page_size = PAGE as u16;
        record.pointer_format = 6;
        record.segment_offset = SEGMENTS[usize::from(segment)].1 * PAGE;
        record.page_count = page_starts.len() as u16;
        put_struct(&mut blob, at, &record);
        let page_starts_at = at + offset_of!(dyld_chained_starts_in_segment, first_page_start);
        for (page, start) in page_starts.iter().enumerate() {
            put_struct(&mut blob, page_starts_at + 2 * page, start);
        }
    }
    let mut header: dyld_chained_fixups_header = zeroed();
    header.fixups_version = version;
    header.starts_offset = STARTS_OFFSET as u32;
    put_struct(&mut blob, 0, &header);
    blob
}

fn check_chained(page_starts_of_segments: &[(u8, &[u16])]) -> Checked {
    let toy = Toy {
        chained_fixups: Some(chained_fixups(0, page_starts_of_segments)),
        ..Toy::default()
    };
    check(&toy.build())
}

#[test]
fn executable_without_fixups_or_symbols_is_accepted() {
    assert_eq!(check(&Toy::default().build()), Ok(()));
}

#[test]
fn chained_fixup_in_page_of_payload_is_refused() {
    assert_eq!(check_chained(&[(BUN, &[0x10])]), relocation_at(START));
    assert_eq!(
        check_chained(&[(BUN, &[NONE, 0x3ff8])]),
        relocation_at(START + PAGE)
    );
    assert_eq!(
        check_chained(&[(DATA, &[0]), (BUN, &[0])]),
        relocation_at(START)
    );
}

#[test]
fn chained_fixup_in_other_page_is_accepted() {
    assert_eq!(check_chained(&[]), Ok(()));
    assert_eq!(check_chained(&[(DATA, &[0x3ff8]), (AFTER, &[0])]), Ok(()));
    assert_eq!(check_chained(&[(BUN, &[NONE, NONE])]), Ok(()));
    assert_eq!(check_chained(&[(BUN, &[NONE, NONE, 0])]), Ok(()));
}

#[test]
fn other_version_of_chained_fixups_is_unsupported() {
    let toy = Toy {
        chained_fixups: Some(chained_fixups(1, &[])),
        ..Toy::default()
    };
    assert_eq!(check(&toy.build()), Err(UnsupportedRelocations));
}

#[test]
fn cut_off_chained_fixups_are_malformed() {
    let mut fixups = chained_fixups(0, &[(DATA, &[0, 0, 0, 0, 0, 0])]);
    fixups.truncate(fixups.len() - 8);
    let toy = Toy {
        chained_fixups: Some(fixups),
        ..Toy::default()
    };
    assert_eq!(check(&toy.build()), Err(MalformedExecutable));
}

fn at_offset(set_segment_opcode: u8, segment: u8, offset: u64) -> Vec<u8> {
    [vec![set_segment_opcode | segment], uleb(offset)].concat()
}

fn check_rebases(parts: &[&[u8]]) -> Checked {
    let toy = Toy {
        rebases: parts.concat(),
        ..Toy::default()
    };
    check(&toy.build())
}

fn rebase_at(segment: u8, offset: u64) -> Vec<u8> {
    at_offset(rebase_opcode::SET_SEGMENT_AND_OFFSET_ULEB, segment, offset)
}

#[test]
fn rebase_in_payload_is_refused() {
    use rebase_opcode::*;
    let once = [DO_REBASE_IMM_TIMES | 1];
    assert_eq!(
        check_rebases(&[&rebase_at(BUN, 0), &once]),
        relocation_at(START)
    );
    assert_eq!(
        check_rebases(&[&rebase_at(BUN, SIZE - 1), &once]),
        relocation_at(END - 1)
    );
    assert_eq!(
        check_rebases(&[&rebase_at(DATA, PAGE - 7), &once]),
        relocation_at(START - 7)
    );
    let moved = [
        &[ADD_ADDR_ULEB][..],
        &uleb(PAGE - 16),
        &[ADD_ADDR_IMM_SCALED | 2],
    ]
    .concat();
    assert_eq!(
        check_rebases(&[&rebase_at(DATA, 0), &moved, &once]),
        relocation_at(START)
    );
}

#[test]
fn rebase_beside_payload_is_accepted() {
    use rebase_opcode::*;
    let once = [SET_TYPE_IMM | 1, DO_REBASE_IMM_TIMES | 1, DONE];
    assert_eq!(check_rebases(&[&rebase_at(DATA, PAGE - 8), &once]), Ok(()));
    assert_eq!(check_rebases(&[&rebase_at(BUN, SIZE), &once]), Ok(()));
    assert_eq!(check_rebases(&[&rebase_at(AFTER, 0), &once]), Ok(()));
}

#[test]
fn run_of_rebases_is_checked_as_a_whole() {
    use rebase_opcode::*;
    let words_in_page = PAGE / 8;
    let times = |count: u64| [&[DO_REBASE_ULEB_TIMES][..], &uleb(count)].concat();
    let start_of_data = rebase_at(DATA, 0);
    assert_eq!(
        check_rebases(&[&start_of_data, &times(words_in_page)]),
        Ok(())
    );
    assert_eq!(
        check_rebases(&[&start_of_data, &times(words_in_page + 1)]),
        relocation_at(START)
    );
    assert_eq!(
        check_rebases(&[&start_of_data, &times(u64::MAX / 8)]),
        relocation_at(START)
    );

    let skipping = |count: u64, skip: u64| {
        [
            &[DO_REBASE_ULEB_TIMES_SKIPPING_ULEB][..],
            &uleb(count),
            &uleb(skip),
        ]
        .concat()
    };
    let last_word_of_data = rebase_at(DATA, PAGE - 8);
    assert_eq!(
        check_rebases(&[&last_word_of_data, &skipping(2, 3 * PAGE)]),
        Ok(())
    );
    let into_last_word = skipping(2, SIZE - 8);
    assert_eq!(
        check_rebases(&[&last_word_of_data, &into_last_word]),
        relocation_at(END - 8)
    );
    assert_eq!(
        check_rebases(&[&start_of_data, &skipping(3, PAGE)]),
        relocation_at(START + 8)
    );

    // What follows a run starts where the run ended.
    let then_skip = [&[DO_REBASE_ADD_ADDR_ULEB][..], &uleb(PAGE - 16)].concat();
    let once = [DO_REBASE_IMM_TIMES | 1];
    assert_eq!(check_rebases(&[&start_of_data, &then_skip, &once]), Ok(()));
    assert_eq!(
        check_rebases(&[&start_of_data, &then_skip, &once, &once]),
        relocation_at(START)
    );
}

#[test]
fn unreadable_rebases_are_told_apart() {
    use rebase_opcode::*;
    assert_eq!(check_rebases(&[&[0x90]]), Err(UnsupportedRelocations));
    assert_eq!(
        check_rebases(&[&[SET_SEGMENT_AND_OFFSET_ULEB | 9, 0]]),
        Err(MalformedExecutable)
    );
    assert_eq!(
        check_rebases(&[&[ADD_ADDR_ULEB, 0x80]]),
        Err(MalformedExecutable)
    );
}

fn bind_at(segment: u8, offset: u64) -> Vec<u8> {
    use bind_opcode::*;
    let symbol = [
        &[SET_DYLIB_ORDINAL_IMM | 1, SET_SYMBOL_TRAILING_FLAGS_IMM][..],
        b"_malloc\0",
        &[
            SET_TYPE_IMM | 1,
            SET_ADDEND_SLEB,
            0x7f,
            SET_DYLIB_ORDINAL_ULEB,
            0x81,
            0x01,
        ],
    ];
    [
        symbol.concat(),
        at_offset(SET_SEGMENT_AND_OFFSET_ULEB, segment, offset),
    ]
    .concat()
}

#[test]
fn bind_in_payload_is_refused_in_every_stream() {
    let in_payload = [bind_at(BUN, 8), vec![bind_opcode::DO_BIND]].concat();
    let streams: [fn(&mut Toy) -> &mut Vec<u8>; 3] = [
        |toy| &mut toy.binds,
        |toy| &mut toy.weak_binds,
        |toy| &mut toy.lazy_binds,
    ];
    for stream in streams {
        let mut toy = Toy::default();
        stream(&mut toy).clone_from(&in_payload);
        assert_eq!(check(&toy.build()), relocation_at(START + 8));
    }
}

fn check_binds(parts: &[&[u8]]) -> Checked {
    let toy = Toy {
        binds: parts.concat(),
        ..Toy::default()
    };
    check(&toy.build())
}

#[test]
fn every_bind_opcode_advances() {
    use bind_opcode::*;
    let two_words_below = bind_at(DATA, PAGE - 16);
    assert_eq!(
        check_binds(&[&two_words_below, &[DO_BIND, DO_BIND]]),
        Ok(())
    );
    let three_binds = [DO_BIND, DO_BIND, DO_BIND];
    assert_eq!(
        check_binds(&[&two_words_below, &three_binds]),
        relocation_at(START)
    );
    let scaled = [DO_BIND_ADD_ADDR_IMM_SCALED | 1, DO_BIND];
    assert_eq!(
        check_binds(&[&two_words_below, &scaled]),
        relocation_at(START)
    );
    let added = [DO_BIND_ADD_ADDR_ULEB, 16, DO_BIND];
    assert_eq!(
        check_binds(&[&two_words_below, &added]),
        relocation_at(START + 8)
    );
    let moved = [ADD_ADDR_ULEB, 24, DO_BIND];
    assert_eq!(
        check_binds(&[&two_words_below, &moved]),
        relocation_at(START + 8)
    );
    let skipping = [DO_BIND_ULEB_TIMES_SKIPPING_ULEB, 3, 0];
    assert_eq!(
        check_binds(&[&two_words_below, &skipping]),
        relocation_at(START)
    );
    let over_payload = [
        &[DO_BIND_ADD_ADDR_ULEB][..],
        &uleb(8 + 3 * PAGE),
        &[DO_BIND],
    ]
    .concat();
    assert_eq!(check_binds(&[&two_words_below, &over_payload]), Ok(()));
}

#[test]
fn done_does_not_end_stream_of_binds() {
    use bind_opcode::*;
    let entries = [
        bind_at(DATA, 0),
        vec![DO_BIND, DONE],
        bind_at(BUN, 0),
        vec![DO_BIND, DONE],
    ];
    assert_eq!(check_binds(&[&entries.concat()]), relocation_at(START));
}

#[test]
fn threaded_binds_are_unsupported() {
    assert_eq!(check_binds(&[&[THREADED]]), Err(UnsupportedRelocations));
}

/// A root whose children are the exports. `words` follow the flags of an export.
fn export_trie(exports: &[(u64, &[u64])]) -> Vec<u8> {
    let nodes: Vec<Vec<u8>> = exports
        .iter()
        .map(|(flags, words)| {
            let words = words.iter().flat_map(|word| uleb(*word));
            let export: Vec<u8> = uleb(*flags).into_iter().chain(words).collect();
            [vec![export.len() as u8], export, vec![0]].concat()
        })
        .collect();
    let mut trie = vec![0, exports.len() as u8];
    let mut node_at = trie.len() + TRIE_EDGE_SIZE * exports.len();
    for (index, node) in nodes.iter().enumerate() {
        assert!(node_at < 0x80);
        trie.extend_from_slice(&[b'_', b'a' + index as u8, 0, node_at as u8]);
        node_at += node.len();
    }
    trie.extend(nodes.concat());
    trie
}

fn check_exports(exports: &[(u64, &[u64])]) -> Checked {
    let in_command_of_its_own = Toy {
        export_trie: Some(export_trie(exports)),
        ..Toy::default()
    };
    let in_dyld_info = Toy {
        exports_of_dyld_info: export_trie(exports),
        ..Toy::default()
    };
    let result = check(&in_command_of_its_own.build());
    assert_eq!(check(&in_dyld_info.build()), result);
    result
}

#[test]
fn export_in_payload_is_refused() {
    let outside = (0, &[PAGE][..]);
    assert_eq!(
        check_exports(&[outside, (0, &[START - BASE])]),
        dynamic_symbol_at(START)
    );
    assert_eq!(
        check_exports(&[(0, &[END - 1 - BASE]), outside]),
        dynamic_symbol_at(END - 1)
    );
    let resolver_in_payload = (EXPORT_STUB_AND_RESOLVER, &[PAGE, START - BASE + 4][..]);
    assert_eq!(
        check_exports(&[resolver_in_payload]),
        dynamic_symbol_at(START + 4)
    );
}

#[test]
fn export_beside_payload_is_accepted() {
    assert_eq!(check_exports(&[]), Ok(()));
    assert_eq!(
        check_exports(&[(0, &[START - 1 - BASE]), (0, &[END - BASE])]),
        Ok(())
    );
    assert_eq!(
        check_exports(&[(EXPORT_STUB_AND_RESOLVER, &[PAGE, END - BASE])]),
        Ok(())
    );
}

#[test]
fn export_without_address_is_accepted() {
    assert_eq!(
        check_exports(&[(EXPORT_KIND_ABSOLUTE, &[START - BASE])]),
        Ok(())
    );
    assert_eq!(
        check_exports(&[(EXPORT_REEXPORT, &[START - BASE, 0])]),
        Ok(())
    );
}

#[test]
fn damaged_export_tries_end() {
    let check_trie = |trie: &[u8]| {
        let toy = Toy {
            export_trie: Some(trie.to_vec()),
            ..Toy::default()
        };
        check(&toy.build())
    };
    let child_is_root = [0, 1, b'_', 0, 0];
    assert_eq!(check_trie(&child_is_root), Ok(()));
    let child_outside_trie = [0, 1, b'_', 0, 0x40];
    assert_eq!(check_trie(&child_outside_trie), Err(MalformedExecutable));
    let edge_without_end = [0, 1, b'_'];
    assert_eq!(check_trie(&edge_without_end), Err(MalformedExecutable));
}

fn symbol(n_type: u8, n_value: u64) -> nlist_64 {
    nlist_64 {
        n_strx: 1,
        n_type,
        n_sect: 1,
        n_desc: 0,
        n_value,
    }
}

#[test]
fn defined_external_symbol_in_payload_is_refused() {
    let toy = Toy {
        local_symbols: vec![symbol(N_SECT, BASE)],
        defined_symbols: vec![
            symbol(N_SECT | N_EXT, START - 1),
            symbol(N_SECT | N_EXT, START),
        ],
        ..Toy::default()
    };
    assert_eq!(check(&toy.build()), dynamic_symbol_at(START));
}

#[test]
fn symbol_for_debuggers_may_name_payload() {
    let toy = Toy {
        local_symbols: vec![symbol(N_SECT, START), symbol(N_SECT, START + 0x40)],
        defined_symbols: vec![symbol(N_SECT | N_EXT, END), symbol(N_EXT | 0x02, START)],
        ..Toy::default()
    };
    assert_eq!(check(&toy.build()), Ok(()));
}

#[test]
fn classic_relocations_are_unsupported() {
    let toy = Toy {
        classic_relocation_count: 1,
        ..Toy::default()
    };
    assert_eq!(check(&toy.build()), Err(UnsupportedRelocations));
}
