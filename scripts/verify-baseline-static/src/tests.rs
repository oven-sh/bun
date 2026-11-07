//! The x64 sweep and the switch-table rule, on byte fixtures.

use super::*;

const IMAGE_BASE: u64 = 0x1_4000_0000;

/// Where CI build 126987 linked the UCRT's `_powf_special`: 0x14c bytes of
/// code, then a nine-entry switch table up to the procedure's end.
const PROC: u64 = IMAGE_BASE + 0x0519_c200;
const TABLE: u64 = PROC + 0x14c;
const PROC_END: u64 = PROC + 0x170;

/// That table at that address: the RVAs of the case labels at +0x2d, +0x57,
/// +0x86 (three times), +0x98, +0xc4, +0x13d and +0xf0.
const TABLE_BYTES: [u8; 36] = [
    0x2d, 0xc2, 0x19, 0x05, 0x57, 0xc2, 0x19, 0x05, 0x86, 0xc2, 0x19, 0x05, 0x86, 0xc2, 0x19, 0x05,
    0x86, 0xc2, 0x19, 0x05, 0x98, 0xc2, 0x19, 0x05, 0xc4, 0xc2, 0x19, 0x05, 0x3d, 0xc3, 0x19, 0x05,
    0xf0, 0xc2, 0x19, 0x05,
];

const NOP: u8 = 0x90;
const RET: u8 = 0xc3;
const VZEROUPPER: [u8; 3] = [0xc5, 0xf8, 0x77];

/// `_powf_special` (nops for its code, `ret; nop` before the table) and the
/// first bytes of the function after it.
fn powf_special() -> Vec<u8> {
    let mut bytes = vec![NOP; 0x149];
    bytes.extend([RET, 0x66, 0x90]);
    bytes.extend(TABLE_BYTES);
    bytes.extend([RET, 0xcc, 0xcc, 0xcc]);
    bytes
}

fn powf_special_syms() -> Vec<Sym> {
    vec![
        sym("_powf_special", PROC, PROC_END),
        sym("next", PROC_END, PROC_END + 1),
    ]
}

fn sym(name: &str, addr: u64, end: u64) -> Sym {
    Sym {
        addr,
        end,
        name: name.to_owned(),
    }
}

fn mark(proc_start: u64, proc_end: u64, va: u64) -> TableMark {
    TableMark {
        proc_start,
        proc_end,
        va,
    }
}

fn put(bytes: &mut [u8], at: u64, new: &[u8]) {
    let at = at as usize;
    bytes[at..at + new.len()].copy_from_slice(new);
}

fn rva(va: u64) -> [u8; 4] {
    ((va - IMAGE_BASE) as u32).to_le_bytes()
}

/// Reads the words of a section that is `bytes` at `sec_addr`.
fn words(bytes: &[u8], sec_addr: u64) -> impl Fn(u64) -> Option<u32> + '_ {
    move |va| {
        let at = usize::try_from(va.checked_sub(sec_addr)?).ok()?;
        let word = bytes.get(at..at.checked_add(4)?)?;
        Some(u32::from_le_bytes(word.try_into().ok()?))
    }
}

/// `msvc_table_ranges` over a section that is `bytes` at `sec_addr`.
fn table_ranges(bytes: &[u8], sec_addr: u64, marks: &[TableMark]) -> Vec<(u64, u64)> {
    msvc_table_ranges(&mut marks.to_vec(), IMAGE_BASE, words(bytes, sec_addr))
}

/// Every instruction the sweep reports with an empty allowlist, by address.
fn violations(
    bytes: &[u8],
    sec_addr: u64,
    syms: &[Sym],
    data_ranges: &[(u64, u64)],
) -> Vec<(String, u64, &'static str, &'static str)> {
    let res = scan_x86_64(bytes, sec_addr, syms, &Allowlist::new(), data_ranges);
    assert!(res.allowlisted.is_empty());
    let mut hits: Vec<_> = res
        .violations
        .iter()
        .flat_map(|(sym, rep)| {
            rep.hits
                .iter()
                .map(move |h| (sym.clone(), h.ip, h.mnemonic, h.feature))
        })
        .collect();
    hits.sort_by_key(|h| h.1);
    hits
}

fn hit(sym: &str, ip: u64, mnemonic: &'static str) -> (String, u64, &'static str, &'static str) {
    (sym.to_owned(), ip, mnemonic, "AVX")
}

#[test]
fn the_sweep_reports_the_table_of_powf_special_unless_it_is_cut_out() {
    let bytes = powf_special();
    let syms = powf_special_syms();
    // The line of CI build 126987: `0x014519c364  Vphsubw  (AVX)`.
    assert_eq!(
        violations(&bytes, PROC, &syms, &[]),
        [hit("_powf_special", 0x1_4519_c364, "Vphsubw")]
    );

    let ranges = table_ranges(&bytes, PROC, &[mark(PROC, PROC_END, TABLE)]);
    assert_eq!(ranges, [(TABLE, PROC_END)]);
    assert_eq!(violations(&bytes, PROC, &syms, &ranges), []);
}

#[test]
fn code_on_both_sides_of_a_cut_table_is_still_reported() {
    let mut bytes = powf_special();
    put(&mut bytes, 0x10, &VZEROUPPER);
    put(&mut bytes, 0x149, &VZEROUPPER);
    put(&mut bytes, 0x170, &VZEROUPPER);
    assert_eq!(
        violations(&bytes, PROC, &powf_special_syms(), &[(TABLE, PROC_END)]),
        [
            hit("_powf_special", PROC + 0x10, "Vzeroupper"),
            hit("_powf_special", PROC + 0x149, "Vzeroupper"),
            hit("next", PROC_END, "Vzeroupper"),
        ]
    );
}

#[test]
fn a_block_is_a_table_only_if_every_word_is_a_case_label() {
    let marks = [mark(PROC, PROC_END, TABLE)];
    let with_entry_3 = |word: [u8; 4]| {
        let mut bytes = powf_special();
        put(&mut bytes, 0x14c + 3 * 4, &word);
        table_ranges(&bytes, PROC, &marks)
    };
    // The first and the last byte of the procedure's code are labels.
    assert_eq!(with_entry_3(rva(PROC)), [(TABLE, PROC_END)]);
    assert_eq!(with_entry_3(rva(TABLE - 1)), [(TABLE, PROC_END)]);
    // The table is not code, and neither is anything outside the procedure.
    assert_eq!(with_entry_3(rva(TABLE)), []);
    assert_eq!(with_entry_3(rva(PROC - 1)), []);
    assert_eq!(with_entry_3(rva(PROC_END)), []);
    assert_eq!(with_entry_3([0xc5, 0xf8, 0x77, 0x90]), []);
}

#[test]
fn an_rva_that_overflows_the_address_space_is_no_case_label() {
    // Image base + RVA wraps around to 0x14, inside the procedure's code.
    let mut marks = vec![mark(0x10, 0x24, 0x20)];
    let ranges = msvc_table_ranges(&mut marks, u64::MAX - 3, |_| Some(0x18));
    assert_eq!(ranges, []);
}

#[test]
fn a_block_is_a_table_only_if_it_is_whole_words_of_the_image() {
    let bytes = powf_special();
    // The procedure ends 2 bytes into the last entry.
    assert_eq!(
        table_ranges(&bytes, PROC, &[mark(PROC, PROC_END - 2, TABLE)]),
        []
    );
    // The section ends inside the table.
    assert_eq!(
        table_ranges(&bytes[..0x16e], PROC, &[mark(PROC, PROC_END, TABLE)]),
        []
    );
}

/// A two-level switch: jump table, byte index table, jump table. The word
/// after the procedure is a case label too, and in no block.
fn two_level_switch() -> (Vec<u8>, [TableMark; 3]) {
    let mut bytes = vec![NOP; 0x30];
    put(
        &mut bytes,
        0x0c,
        &[rva(PROC), rva(PROC + 1), rva(PROC + 2)].concat(),
    );
    put(&mut bytes, 0x18, &[0, 1, 2, 2, 1, 0, 0x66, 0x90]);
    put(&mut bytes, 0x20, &[rva(PROC + 2), rva(PROC)].concat());
    put(&mut bytes, 0x28, &rva(PROC + 1));
    let end = PROC + 0x28;
    let marks = [0x0c, 0x18, 0x20].map(|at| mark(PROC, end, PROC + at));
    (bytes, marks)
}

#[test]
fn a_block_ends_at_the_next_mark_and_at_the_procedure_end() {
    let (bytes, marks) = two_level_switch();
    let tables = [(PROC + 0x0c, PROC + 0x18), (PROC + 0x20, PROC + 0x28)];
    assert_eq!(table_ranges(&bytes, PROC, &marks), tables);

    // cl lists the marks from the last table to the first, and identical
    // procedures that the linker folded list them again.
    let [first, bytes_table, last] = marks;
    let mut as_in_a_pdb = vec![last, bytes_table, first, last, bytes_table, first];
    let ranges = msvc_table_ranges(&mut as_in_a_pdb, IMAGE_BASE, words(&bytes, PROC));
    assert_eq!(
        (ranges.as_slice(), as_in_a_pdb.as_slice()),
        (&tables[..], &marks[..])
    );

    // The code ends at the procedure's first table: an entry of the last
    // table that points into the first one is no case label.
    let mut bytes = bytes;
    put(&mut bytes, 0x20, &rva(PROC + 0x0c));
    assert_eq!(table_ranges(&bytes, PROC, &marks), tables[..1]);
}

#[test]
fn only_the_marks_inside_a_procedure_bound_its_tables() {
    let bytes = powf_special();
    let table = mark(PROC, PROC_END, TABLE);
    for stray in [PROC - 4, PROC_END, PROC_END + 4] {
        let mut marks = vec![table, mark(PROC, PROC_END, stray)];
        let ranges = msvc_table_ranges(&mut marks, IMAGE_BASE, words(&bytes, PROC));
        assert_eq!(
            (ranges, marks),
            (vec![(TABLE, PROC_END)], vec![table]),
            "stray mark at {stray:#x}"
        );
    }
    // A mark of another procedure, below this one's table.
    let other = mark(PROC - 0x40, PROC + 0x20, PROC + 0x10);
    assert_eq!(
        table_ranges(&bytes, PROC, &[table, other]),
        [(TABLE, PROC_END)]
    );
}

#[test]
fn a_mark_on_one_word_that_passes_for_a_case_label_hides_no_code() {
    // vaddps ymm0, ymm0, [rax + disp32], where the disp32 is the procedure's
    // own RVA. A mark on the disp32 must not cut the instruction in two.
    let mut bytes = powf_special();
    put(&mut bytes, 0x40, &[0xc5, 0xfc, 0x58, 0x80]);
    put(&mut bytes, 0x44, &rva(PROC));
    let marks = [
        mark(PROC, PROC_END, PROC + 0x44),
        mark(PROC, PROC_END, TABLE),
    ];
    let ranges = table_ranges(&bytes, PROC, &marks);
    assert_eq!(ranges, []);
    assert_eq!(
        violations(&bytes, PROC, &powf_special_syms(), &ranges),
        [
            hit("_powf_special", PROC + 0x40, "Vaddps"),
            hit("_powf_special", 0x1_4519_c364, "Vphsubw"),
        ]
    );
}

#[test]
fn an_instruction_that_would_run_into_a_range_is_not_decoded() {
    let mut bytes = vec![NOP; 16];
    put(&mut bytes, 2, &VZEROUPPER);
    put(&mut bytes, 8, &VZEROUPPER);
    let syms = [sym("f", PROC, PROC + 16)];
    assert_eq!(
        violations(&bytes, PROC, &syms, &[]),
        [
            hit("f", PROC + 2, "Vzeroupper"),
            hit("f", PROC + 8, "Vzeroupper")
        ]
    );
    // The range starts at the last byte of the first VZEROUPPER.
    assert_eq!(
        violations(&bytes, PROC, &syms, &[(PROC + 4, PROC + 8)]),
        [hit("f", PROC + 8, "Vzeroupper")]
    );
}

#[test]
fn the_sweep_continues_at_the_first_byte_after_a_range() {
    // ret; a one-word range; vmovdqa ymm0, ymm1; the next symbol. Decoded from
    // its first byte, the range is an 11-byte MOV that ends inside `next`.
    let bytes = [
        RET, 0xc7, 0x84, 0x71, 0x52, 0xc5, 0xfd, 0x6f, 0xc1, RET, NOP, NOP, NOP, NOP, NOP, NOP,
    ];
    let syms = [sym("f", PROC, PROC + 9), sym("next", PROC + 9, PROC + 16)];
    assert_eq!(violations(&bytes, PROC, &syms, &[]), []);
    assert_eq!(
        violations(&bytes, PROC, &syms, &[(PROC + 1, PROC + 5)]),
        [hit("f", PROC + 5, "Vmovdqa")]
    );
}

#[test]
fn a_range_never_covers_a_symbol_start() {
    let mut bytes = vec![NOP; 16];
    put(&mut bytes, 8, &VZEROUPPER);
    let syms = [sym("f", PROC, PROC + 8), sym("g", PROC + 8, PROC + 16)];
    for range in [(PROC + 4, PROC + 12), (PROC + 8, PROC + 12)] {
        assert_eq!(
            violations(&bytes, PROC, &syms, &[range]),
            [hit("g", PROC + 8, "Vzeroupper")],
            "{range:x?}"
        );
    }
}

#[test]
fn the_decoder_restarts_at_a_symbol_start_after_a_range() {
    // After the table: mov eax, imm32, whose last byte is the first byte of
    // `next`. It is dropped, and `next` is decoded from its start.
    let mut bytes = powf_special();
    bytes.truncate(0x170);
    bytes.extend([0xb8, 0, 0, 0]);
    bytes.extend(VZEROUPPER);
    let syms = [
        sym("_powf_special", PROC, PROC_END),
        sym("next", PROC_END + 4, PROC_END + 7),
    ];
    assert_eq!(
        violations(&bytes, PROC, &syms, &[(TABLE, PROC_END)]),
        [hit("next", PROC_END + 4, "Vzeroupper")]
    );
}

#[test]
fn code_pieces_are_the_section_without_the_ranges() {
    let pieces = |ranges: &[(u64, u64)], starts: &[u64]| code_pieces(100, 200, ranges, starts);
    assert_eq!(pieces(&[], &[]), [(100, 200)]);
    assert_eq!(pieces(&[(120, 140)], &[]), [(100, 120), (140, 200)]);
    // At the section's two ends.
    assert_eq!(pieces(&[(100, 110), (190, 200)], &[]), [(110, 190)]);
    // Adjacent and overlapping ranges.
    assert_eq!(
        pieces(&[(120, 130), (130, 140), (135, 150)], &[]),
        [(100, 120), (150, 200)]
    );
    // Ranges of other sections, and ranges that cross the section's ends.
    assert_eq!(pieces(&[(10, 20), (300, 310)], &[]), [(100, 200)]);
    assert_eq!(pieces(&[(90, 110), (195, 210)], &[]), [(110, 195)]);
    // A symbol start inside a range ends it. One at its start leaves nothing.
    assert_eq!(pieces(&[(120, 140)], &[130]), [(100, 120), (130, 200)]);
    assert_eq!(pieces(&[(120, 140)], &[120, 150]), [(100, 200)]);
    assert_eq!(pieces(&[(100, 200)], &[]), []);
}
