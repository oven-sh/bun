//! Mach-O, arm64 or x86-64, linked by ld64.lld.
//!
//! The link has to be made with `-map`, `-object_path_lto` and `-ignore_optimization_hints`: the hints let the linker turn
//! `adrp` + `add` into `adr` + `nop` and the like, after which the relocations no longer describe the instructions.
//!
//! A linked Mach-O keeps no relocations and ld64.lld cannot be asked to keep them. But the link can be reconstructed: the
//! map says where each symbol of each object file ended up, and the object files hold the relocations.
//!
//! An ATOM is what the linker places, strips and reorders: the bytes from one symbol to the next. Two exceptions, both
//! honoured here because the linker honours them: a symbol flagged `N_ALT_ENTRY` is a second name inside the atom before
//! it (hand-written assembly that falls through its labels uses this), and an object without
//! `MH_SUBSECTIONS_VIA_SYMBOLS` has one atom per section.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::fmt::Write as _;
use std::path::Path;

use super::blocks::{Functions, Marker, marker_patch};
use super::features::{FEATURES, Select, matches};
use super::live::{Blocks, Excluded, Image, mark};
use super::objects::{Object, Objects};
use super::{Data, FeatureRow, Link, Made, Nodes, Parts, Result, Units, fail, read};
use crate::executable::fixed_name;
use crate::table::{Arch, Area, Container, Feature, Form, Format, ROOT, STARTS_PIECE, Table};

const MH_MAGIC_64: u32 = 0xfeed_facf;
const MH_SUBSECTIONS_VIA_SYMBOLS: u32 = 0x2000;
const LC_SYMTAB: u32 = 2;
const LC_SEGMENT_64: u32 = 0x19;
const LC_DATA_IN_CODE: u32 = 0x29;
const LC_MAIN: u32 = 0x8000_0028;
const LC_DYLD_EXPORTS_TRIE: u32 = 0x8000_0033;
const LC_DYLD_CHAINED_FIXUPS: u32 = 0x8000_0034;
const DYLD_CHAINED_PTR_64: u16 = 2;
const N_STAB: u8 = 0xe0;
const N_TYPE: u8 = 0x0e;
const N_SECT: u8 = 0x0e;
const N_EXT: u8 = 1;
const N_NO_DEAD_STRIP: u16 = 0x20;
const N_ALT_ENTRY: u16 = 0x200;
const S_ATTR_NO_DEAD_STRIP: u32 = 0x1000_0000;
/// cstring, 4-, 8- and 16-byte literals, literal pointers: the linker merges these by content.
const LITERAL_SECTION_TYPES: [u8; 5] = [2, 3, 4, 5, 14];

/// The same for both.
const RELOC_UNSIGNED: u8 = 0;

/// `X86_64_RELOC_*`
mod x64 {
    pub(super) const SIGNED: u8 = 1;
    pub(super) const BRANCH: u8 = 2;
    pub(super) const GOT_LOAD: u8 = 3;
    pub(super) const GOT: u8 = 4;
    pub(super) const SUBTRACTOR: u8 = 5;
    pub(super) const SIGNED_1: u8 = 6;
    pub(super) const SIGNED_2: u8 = 7;
    pub(super) const SIGNED_4: u8 = 8;
    pub(super) const TLV: u8 = 9;
}

/// `ARM64_RELOC_*`
mod reloc {
    pub(super) const SUBTRACTOR: u8 = 1;
    pub(super) const BRANCH26: u8 = 2;
    pub(super) const PAGE21: u8 = 3;
    pub(super) const PAGEOFF12: u8 = 4;
    pub(super) const GOT_LOAD_PAGE21: u8 = 5;
    pub(super) const GOT_LOAD_PAGEOFF12: u8 = 6;
    pub(super) const TLVP_LOAD_PAGE21: u8 = 8;
    pub(super) const TLVP_LOAD_PAGEOFF12: u8 = 9;
    pub(super) const ADDEND: u8 = 10;
}

// ---------------------------------------------------------------- the map

struct Atom<'m> {
    addr: u64,
    size: u64,
    file: usize,
    name: &'m [u8],
}

struct OutputSection<'m> {
    addr: u64,
    size: u64,
    segment: &'m [u8],
    section: &'m [u8],
}

#[derive(Default)]
struct Map<'m> {
    /// By the number the map gives them. 0 is "linker synthesized".
    files: Vec<&'m [u8]>,
    sections: Vec<OutputSection<'m>>,
    atoms: Vec<Atom<'m>>,
}

fn number(text: &[u8], radix: u32) -> Option<u64> {
    u64::from_str_radix(core::str::from_utf8(text).ok()?.trim_start(), radix).ok()
}

/// `[  12] rest`
fn bracketed(text: &[u8]) -> Option<(usize, &[u8])> {
    let close = text.strip_prefix(b"[")?.iter().position(|&b| b == b']')?;
    Some((
        number(&text[1..=close], 10)? as usize,
        text[close + 2..].strip_prefix(b" ")?,
    ))
}

fn read_map(text: &[u8]) -> Map<'_> {
    let mut map = Map::default();
    let mut part: &[u8] = b"";
    for line in text.split(|&b| b == b'\n') {
        if line.first() == Some(&b'#') {
            let parts: [&[u8]; 4] = [
                b"Object files",
                b"Sections",
                b"Symbols",
                b"Dead Stripped Symbols",
            ];
            let named = |p: &&[u8]| {
                line[1..]
                    .strip_prefix(b" ")
                    .and_then(|l| l.strip_prefix(*p))
                    .is_some_and(|l| l.starts_with(b":"))
            };
            part = parts.into_iter().find(named).unwrap_or(part);
            continue;
        }
        let mut columns = line.splitn(3, |&b| b == b'\t');
        let mut hex = || number(columns.next()?.strip_prefix(b"0x")?, 16);
        match part {
            b"Object files" => {
                if let Some((file, name)) = bracketed(line) {
                    map.files.resize(map.files.len().max(file + 1), b"");
                    map.files[file] = name;
                }
            }
            b"Sections" => {
                let (Some(addr), Some(size)) = (hex(), hex()) else {
                    continue;
                };
                let mut names = columns
                    .next()
                    .unwrap_or(b"")
                    .split(|b| b.is_ascii_whitespace());
                if let (Some(segment), Some(section)) = (names.next(), names.next()) {
                    map.sections.push(OutputSection {
                        addr,
                        size,
                        segment,
                        section,
                    });
                }
            }
            b"Symbols" => {
                let (Some(addr), Some(size)) = (hex(), hex()) else {
                    continue;
                };
                if let Some((file, name)) = columns.next().and_then(bracketed) {
                    map.atoms.push(Atom {
                        addr,
                        size,
                        file,
                        name,
                    });
                }
            }
            _ => {}
        }
    }
    map
}

// ---------------------------------------------------------------- object files

struct ObjectSection<'o> {
    section: &'o [u8],
    segment: &'o [u8],
    addr: u64,
    size: u64,
    offset: usize,
    align: u64,
    relocation_offset: usize,
    relocation_count: usize,
    kind: u8,
    attributes: u32,
}

struct ObjectSymbol<'o> {
    name: &'o [u8],
    kind: u8,
    /// From 1.
    section: u8,
    flags: u16,
    value: u64,
}

impl ObjectSymbol<'_> {
    fn is_defined(&self) -> bool {
        self.kind & N_STAB == 0 && self.kind & N_TYPE == N_SECT && self.section > 0
    }
}

struct Parsed<'o> {
    bytes: Data<'o>,
    is_splittable: bool,
    sections: Vec<ObjectSection<'o>>,
    symbols: Vec<ObjectSymbol<'o>>,
}

fn parse(bytes: &[u8]) -> Parsed<'_> {
    let b = Data(bytes);
    let (mut sections, mut symbols) = (Vec::new(), Vec::new());
    let mut o = 32;
    for _ in 0..b.u32(16) {
        match b.u32(o) {
            LC_SEGMENT_64 => {
                for s in 0..b.u32(o + 64) as usize {
                    let q = o + 72 + s * 80;
                    sections.push(ObjectSection {
                        section: fixed_name(&bytes[q..q + 16]),
                        segment: fixed_name(&bytes[q + 16..q + 32]),
                        addr: b.u64(q + 32),
                        size: b.u64(q + 40),
                        offset: b.u32(q + 48) as usize,
                        align: 1 << b.u32(q + 52),
                        relocation_offset: b.u32(q + 56) as usize,
                        relocation_count: b.u32(q + 60) as usize,
                        kind: b.u32(q + 64) as u8,
                        attributes: b.u32(q + 64) & 0xffff_ff00,
                    });
                }
            }
            LC_SYMTAB => {
                let strings = b.u32(o + 16) as usize;
                for k in 0..b.u32(o + 12) as usize {
                    let q = b.u32(o + 8) as usize + k * 16;
                    symbols.push(ObjectSymbol {
                        name: b.cstr(strings + b.u32(q) as usize),
                        kind: b.u8(q + 4),
                        section: b.u8(q + 5),
                        flags: b.u16(q + 6),
                        value: b.u64(q + 8),
                    });
                }
            }
            _ => {}
        }
        o += b.u32(o + 4) as usize;
    }
    Parsed {
        bytes: b,
        is_splittable: b.u32(24) & MH_SUBSECTIONS_VIA_SYMBOLS != 0,
        sections,
        symbols,
    }
}

// ---------------------------------------------------------------- atoms and relocations of each object

#[derive(Clone, Copy, PartialEq)]
enum Refers {
    /// To an atom of the image: where the atom starts, and the address in (or near) it that is meant.
    Atom(u64, i64),
    /// To a literal, or to a constant that comes before the first symbol of its section. Where it ended up is not known
    /// here. It has to be where nothing is moved.
    Literal,
    /// To something that comes from a dylib, through a stub or the GOT.
    Imported,
}

#[derive(Clone, Copy, PartialEq)]
struct Record {
    place: u64,
    kind: u8,
    log2_length: u8,
    /// x86-64: how many bytes of the instruction follow the field, which counts from the end of the instruction.
    following: u8,
    refers: Refers,
    /// For `target - other`: start of the atom that holds `other`.
    minus_atom: Option<u64>,
}

/// Where the symbols of the object files ended up.
struct Placement<'a> {
    atoms: &'a [Atom<'a>],
    by_file_and_name: HashMap<(usize, &'a [u8]), Vec<usize>>,
    by_name: HashMap<&'a [u8], Vec<usize>>,
    /// A definition only its own object can see. A reference from another object never means one of these.
    file_local: HashSet<(usize, &'a [u8])>,
    /// A name that identical code folding merged into another is missing from the map, but the symbol table of the output
    /// has it, at the address of the copy that was kept.
    in_output: HashMap<&'a [u8], Vec<u64>>,
}

impl Placement<'_> {
    /// The map credits an external symbol of an LTO object to the bitcode file it came from, so look those up by name alone.
    fn atom(&self, file: usize, external: &HashSet<&[u8]>, name: &[u8]) -> Option<usize> {
        if let Some(own) = self.by_file_and_name.get(&(file, name)) {
            return if let &[one] = &own[..] {
                Some(one)
            } else {
                None
            };
        }
        if !external.contains(name) {
            return None;
        }
        let mut visible = self
            .by_name
            .get(name)?
            .iter()
            .filter(|&&a| !self.file_local.contains(&(self.atoms[a].file, name)));
        let &first = visible.next()?;
        visible
            .all(|&a| self.atoms[a].addr == self.atoms[first].addr)
            .then_some(first)
    }

    fn address(&self, file: usize, external: &HashSet<&[u8]>, name: &[u8]) -> Option<u64> {
        if let Some(atom) = self.atom(file, external, name) {
            return Some(self.atoms[atom].addr);
        }
        if let &[one] = &self.in_output.get(name)?[..] {
            Some(one)
        } else {
            None
        }
    }
}

struct Reconstructed {
    /// Per atom of the map.
    align: Vec<u64>,
    keep: Vec<bool>,
    /// Ranges that the map lists as several symbols but that are one atom.
    whole: Vec<(u64, u64)>,
    records: Vec<Record>,
    report: String,
}

fn reconstruct(map: &Map<'_>, linked: &[u8], arch: Arch) -> Result<Reconstructed> {
    // The Mach-O header, which `__mh_execute_header` and `___dso_handle` stand for. __text follows it in the same 16 MB.
    let image_base = map
        .sections
        .first()
        .ok_or("the map lists no sections")?
        .addr
        >> 24
        << 24;

    // By the number the map gives them. It lists an object only if it credits a symbol to it, and the external symbols of
    // what LTO generated it credits to the bitcode they came from. So the rest of what LTO generated follows.
    let listed = map
        .files
        .iter()
        .map(|name| String::from_utf8_lossy(name).into_owned());
    let mut files: Vec<String> = listed.collect();
    let generated = files.iter().filter(|name| name.ends_with(".lto.o"));
    let directories: BTreeSet<&Path> = generated
        .filter_map(|name| Path::new(name).parent())
        .collect();
    let mut unlisted = Vec::new();
    for directory in directories {
        for entry in
            std::fs::read_dir(directory).map_err(|e| format!("{}: {e}", directory.display()))?
        {
            let path = entry
                .map_err(|e| format!("{}: {e}", directory.display()))?
                .path();
            unlisted.push(path.to_string_lossy().into_owned());
        }
    }
    let is_listed: HashSet<&str> = files.iter().map(|name| &name[..]).collect();
    unlisted.retain(|name| name.ends_with(".lto.o") && !is_listed.contains(&name[..]));
    unlisted.sort_unstable();
    files.extend(unlisted);
    let files = files;

    let mut archives = Objects::default();
    let mut loaded: Vec<(usize, Object)> = Vec::new();
    let (mut missing, mut bitcode) = (Vec::new(), 0);
    for (file, name) in files.iter().enumerate().skip(1).filter(|f| !f.1.is_empty()) {
        match archives.get(name) {
            None => missing.push(name),
            Some(object) if !object.bytes().starts_with(&MH_MAGIC_64.to_le_bytes()) => bitcode += 1,
            Some(object) => loaded.push((file, object)),
        }
    }
    if let Some(first) = missing.first() {
        fail!(
            "{} inputs of the link are not there, the first: {first}",
            missing.len()
        );
    }
    let objects: Vec<(usize, Parsed<'_>)> = loaded
        .iter()
        .map(|(file, object)| (*file, parse(object.bytes())))
        .collect();
    let output = parse(linked);

    let mut placement = Placement {
        atoms: &map.atoms,
        by_file_and_name: HashMap::new(),
        by_name: HashMap::new(),
        file_local: HashSet::new(),
        in_output: HashMap::new(),
    };
    for (i, atom) in map.atoms.iter().enumerate() {
        placement
            .by_file_and_name
            .entry((atom.file, atom.name))
            .or_default()
            .push(i);
        placement.by_name.entry(atom.name).or_default().push(i);
    }
    for (file, object) in &objects {
        let local = object
            .symbols
            .iter()
            .filter(|y| y.is_defined() && y.kind & N_EXT == 0);
        placement.file_local.extend(local.map(|y| (*file, y.name)));
    }
    for y in output.symbols.iter().filter(|y| y.is_defined()) {
        let addresses = placement.in_output.entry(y.name).or_default();
        if !addresses.contains(&y.value) {
            addresses.push(y.value);
        }
    }
    let placement = placement;

    let mut made = Reconstructed {
        align: vec![1; map.atoms.len()],
        keep: vec![false; map.atoms.len()],
        whole: Vec::new(),
        records: Vec::new(),
        report: String::new(),
    };
    let (mut several_entries, mut not_kept) = (0, 0);

    for (
        file,
        Parsed {
            bytes: b,
            is_splittable,
            sections,
            symbols,
        },
    ) in &objects
    {
        let file = *file;
        let external: HashSet<&[u8]> = symbols
            .iter()
            .filter(|y| y.kind & N_EXT != 0)
            .map(|y| y.name)
            .collect();
        let placed_atom = |name: &[u8]| placement.atom(file, &external, name);
        let final_address = |name: &[u8]| placement.address(file, &external, name);

        // The atoms of each section: where each starts (as an address in the object) and the names it starts with.
        struct Start<'o> {
            value: u64,
            names: Vec<&'o [u8]>,
            has_alternative_entries: bool,
        }
        let mut starts: Vec<Vec<Start<'_>>> = sections.iter().map(|_| Vec::new()).collect();
        let mut defined: Vec<&ObjectSymbol<'_>> =
            symbols.iter().filter(|y| y.is_defined()).collect();
        defined.sort_by_key(|y| y.value);
        for y in defined {
            let list = &mut starts[usize::from(y.section) - 1];
            match list.last_mut() {
                Some(last) if last.value == y.value => last.names.push(y.name),
                Some(last) if !is_splittable || y.flags & N_ALT_ENTRY != 0 => {
                    last.has_alternative_entries = true
                }
                _ => list.push(Start {
                    value: y.value,
                    names: vec![y.name],
                    has_alternative_entries: false,
                }),
            }
        }

        // Where an address of this object ended up: {start of its atom, the address}.
        let locate = |section: usize, value: u64| -> Option<(u64, u64)> {
            let list = &starts[section - 1];
            let found = &list[list.partition_point(|s| s.value <= value).checked_sub(1)?];
            let at = found.names.iter().find_map(|name| final_address(name))?;
            Some((at, at + (value - found.value)))
        };

        for (s, starts) in sections.iter().zip(&starts) {
            for (k, start) in starts.iter().enumerate() {
                let Some(atom) = start.names.iter().find_map(|name| placed_atom(name)) else {
                    continue;
                };
                let offset = start.value - s.addr;
                let align = if offset != 0 {
                    s.align.min(offset.isolate_lowest_one())
                } else {
                    s.align
                };
                made.align[atom] = made.align[atom].max(align);
                if start.has_alternative_entries {
                    let end = starts.get(k + 1).map_or(s.addr + s.size, |next| next.value);
                    made.whole.push((
                        map.atoms[atom].addr,
                        map.atoms[atom].addr + (end - start.value),
                    ));
                    several_entries += 1;
                }
            }
        }

        for y in symbols.iter().filter(|y| y.is_defined()) {
            let is_kept = y.flags & N_NO_DEAD_STRIP != 0
                || sections[usize::from(y.section) - 1].attributes & S_ATTR_NO_DEAD_STRIP != 0;
            if let Some(atom) = placed_atom(y.name).filter(|_| is_kept) {
                made.keep[atom] = true;
            }
        }

        let name_of_file = || &files[file];
        for (index, s) in sections.iter().enumerate() {
            if s.segment == b"__DWARF" || s.segment == b"__LD" || s.section == b"__eh_frame" {
                continue;
            }
            let mut addend = 0i64;
            let mut minus: Option<u64> = None;
            for i in 0..s.relocation_count {
                let q = s.relocation_offset + i * 8;
                let (offset, word) = (b.i32(q), b.u32(q + 4));
                let (number, log2_length, is_external, kind) = (
                    word & 0xff_ffff,
                    (word >> 25) as u8 & 3,
                    word >> 27 & 1 != 0,
                    (word >> 28) as u8,
                );
                if arch == Arch::Arm64 && kind == reloc::ADDEND {
                    addend = i64::from((number << 8).cast_signed() >> 8); // applies to the relocation that follows
                    continue;
                }
                let this_addend = core::mem::take(&mut addend);
                let field = s.offset.wrapping_add_signed(offset as isize);
                // x86-64 holds every addend in place. One relative to the instruction pointer counts from the end of the field.
                let is_relative =
                    arch == Arch::X64 && kind != RELOC_UNSIGNED && kind != x64::SUBTRACTOR;
                let following: u8 = match kind {
                    x64::SIGNED_1 if is_relative => 1,
                    x64::SIGNED_2 if is_relative => 2,
                    x64::SIGNED_4 if is_relative => 4,
                    _ => 0,
                };
                let relative_addend = if is_relative {
                    i64::from(b.i32(field)) + i64::from(following)
                } else {
                    0
                };

                let nameless = ObjectSymbol {
                    name: b"<a section>",
                    kind: 0,
                    section: 0,
                    flags: 0,
                    value: 0,
                };
                let y = if is_external {
                    &symbols[number as usize]
                } else {
                    &nameless
                };
                // {start of the atom, the address}, if it is in the image
                let (target, otherwise) = if !is_external {
                    // Against a section, for what has no symbol to go by. What is in place is an address in the object.
                    if arch == Arch::Arm64 {
                        fail!(
                            "{}: relocation against a section number, which arm64 does not use",
                            name_of_file()
                        );
                    }
                    let address = if is_relative {
                        s.addr
                            .wrapping_add_signed(i64::from(offset) + 4 + relative_addend)
                    } else if log2_length == 3 {
                        b.u64(field)
                    } else {
                        b.u32(field).into()
                    };
                    let is_literal =
                        LITERAL_SECTION_TYPES.contains(&sections[number as usize - 1].kind);
                    match locate(number as usize, address).filter(|_| !is_literal) {
                        Some(located) => (Some(located), None),
                        None => (None, Some(Refers::Literal)),
                    }
                } else if y.is_defined() {
                    if LITERAL_SECTION_TYPES.contains(&sections[usize::from(y.section) - 1].kind) {
                        (None, Some(Refers::Literal))
                    } else {
                        (locate(y.section.into(), y.value), None)
                    }
                } else if y.name == b"__mh_execute_header" || y.name == b"___dso_handle" {
                    (Some((image_base, image_base)), None)
                } else {
                    let at = final_address(y.name);
                    (
                        at.map(|at| (at, at)),
                        at.is_none().then_some(Refers::Imported),
                    )
                };

                if kind
                    == (if arch == Arch::Arm64 {
                        reloc::SUBTRACTOR
                    } else {
                        x64::SUBTRACTOR
                    })
                {
                    minus = target.map(|t| t.0); // pairs with the UNSIGNED that follows
                    continue;
                }
                let this_minus = minus.take();
                let Some((_, place)) = locate(index + 1, s.addr.wrapping_add_signed(offset.into()))
                else {
                    not_kept += 1;
                    continue;
                };
                // A pointer holds its addend in place. For a difference it does not matter: only the two atoms do.
                let in_place = match (kind, this_minus, log2_length) {
                    _ if !is_external => 0, // it was the address
                    (RELOC_UNSIGNED, None, 3) => b.i64(field),
                    (RELOC_UNSIGNED, None, _) => b.i32(field).into(),
                    _ => relative_addend,
                };
                let refers = match (otherwise, target) {
                    (Some(otherwise), _) => otherwise,
                    (None, Some((atom, address))) => {
                        Refers::Atom(atom, address.cast_signed() + this_addend + in_place)
                    }
                    (None, None) => fail!(
                        "{}: cannot find {} in the image",
                        name_of_file(),
                        String::from_utf8_lossy(y.name)
                    ),
                };
                made.records.push(Record {
                    place,
                    kind,
                    log2_length,
                    following,
                    refers,
                    minus_atom: this_minus,
                });
            }
        }
    }
    let _ = writeln!(
        made.report,
        "symbols in the map {}, relocations {}; inputs that are bitcode (their code is in the LTO objects): {bitcode}; objects: \
         {}; atoms with several entries: {several_entries}; relocations in atoms that were not kept: {not_kept}",
        map.atoms.len(),
        made.records.len(),
        objects.len(),
    );
    Ok(made)
}

// ---------------------------------------------------------------- the table

struct Section<'a> {
    segment: &'a [u8],
    name: &'a [u8],
    addr: u64,
    size: u64,
    offset: usize,
}

impl Section<'_> {
    fn holds(&self, address: u64) -> bool {
        address >= self.addr && address < self.addr + self.size
    }
}

struct Node<'a> {
    align: u64,
    segment: &'a [u8],
    section: &'a [u8],
    names: Vec<&'a [u8]>,
    keep: bool,
}

struct MachO<'a> {
    nodes: Nodes,
    list: Vec<Node<'a>>,
    records: Vec<Record>,
    blocks: Blocks,
}

impl MachO<'_> {
    fn records_in(&self, start: u64, end: u64) -> &[Record] {
        let from = self.records.partition_point(|r| r.place < start);
        let to = from + self.records[from..].partition_point(|r| r.place < end);
        &self.records[from..to]
    }
}

impl Image for MachO<'_> {
    fn nodes(&self) -> &Nodes {
        &self.nodes
    }
    fn blocks(&self) -> &Blocks {
        &self.blocks
    }
    fn references(&self, start: u64, end: u64, touch: &mut dyn FnMut(u64)) -> Result<()> {
        if self
            .nodes
            .find(start)
            .is_some_and(|n| self.list[n].section == b"__bun_feat")
        {
            return Ok(()); // a record does not keep its function alive
        }
        for r in self.records_in(start, end) {
            let Refers::Atom(atom, target) = r.refers else {
                continue;
            };
            // Into a function that is split into blocks: the address decides which block.
            let is_split = self
                .nodes
                .find(atom)
                .is_some_and(|n| self.blocks.of(n).is_some())
                && target >= atom.cast_signed();
            touch(if is_split {
                target.cast_unsigned()
            } else {
                atom
            });
            r.minus_atom.into_iter().for_each(&mut *touch);
        }
        Ok(())
    }
}

fn read_uleb(b: Data<'_>, at: &mut usize) -> u64 {
    let mut value = 0;
    for shift in (0..).step_by(7) {
        let byte = b.u8(*at);
        *at += 1;
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            break;
        }
    }
    value
}

/// The offsets from the image base of what is exported.
fn exported(b: Data<'_>, trie: usize, node: usize, out: &mut Vec<u64>) {
    let mut o = trie + node;
    let terminal_size = read_uleb(b, &mut o) as usize;
    if terminal_size != 0 {
        let mut terminal = o;
        read_uleb(b, &mut terminal); // flags
        out.push(read_uleb(b, &mut terminal));
    }
    o += terminal_size;
    let children = b.u8(o);
    o += 1;
    for _ in 0..children {
        o += b.cstr(o).len() + 1;
        let child = read_uleb(b, &mut o) as usize;
        exported(b, trie, child, out);
    }
}

pub(super) fn make(link: &Link<'_>, linked: &[u8], arch: Arch) -> Result<Made> {
    let b = Data(linked);
    let map_text = read(link.map)?;
    let map = read_map(&map_text);
    let reconstructed = reconstruct(&map, linked, arch)?;

    // ---- load commands
    let mut commands: Vec<(u32, usize)> = Vec::new();
    let mut segments: Vec<(&[u8], u64, u64, u64)> = Vec::new(); // {name, address, offset, size in the file}
    let mut sections: Vec<Section<'_>> = Vec::new();
    let mut o = 32;
    for _ in 0..b.u32(16) {
        commands.push((b.u32(o), o));
        if b.u32(o) == LC_SEGMENT_64 {
            let name = fixed_name(&linked[o + 8..o + 24]);
            segments.push((name, b.u64(o + 24), b.u64(o + 40), b.u64(o + 48)));
            for s in 0..b.u32(o + 64) as usize {
                let header = o + 72 + s * 80;
                sections.push(Section {
                    segment: name,
                    name: fixed_name(&linked[header..header + 16]),
                    addr: b.u64(header + 32),
                    size: b.u64(header + 40),
                    offset: b.u32(header + 48) as usize,
                });
            }
        }
        o += b.u32(o + 4) as usize;
    }
    let command = |kind: u32| commands.iter().find(|c| c.0 == kind).map(|c| c.1);
    let section = |segment: &str, name: &str| {
        sections
            .iter()
            .find(|s| s.segment == segment.as_bytes() && s.name == name.as_bytes())
    };
    let within = |s: Option<&Section<'_>>, a: u64| s.is_some_and(|s| s.holds(a));
    let file_offset = |a: u64| -> usize {
        let s = segments
            .iter()
            .find(|s| a >= s.1 && a < s.1 + s.3)
            .unwrap_or_else(|| panic!("no file bytes at {a:x}"));
        (s.2 + (a - s.1)) as usize
    };
    let base = segments
        .iter()
        .find(|s| s.0 == b"__TEXT")
        .ok_or("no segment __TEXT")?
        .1;
    let header_size = 32 + u64::from(b.u32(20));
    let first_fixed = section("__TEXT", "__cstring").ok_or("no __cstring")?.addr; // from here on nothing moves
    let (stubs, got) = (
        section("__TEXT", "__stubs"),
        section("__DATA_CONST", "__got"),
    );
    let init_offsets = section("__TEXT", "__init_offsets");
    let main_command = command(LC_MAIN).ok_or("no LC_MAIN")?;

    // ---- nodes: the atoms
    // One piece each, always kept, patched by their form.
    let is_made_by_the_linker =
        |section: &[u8]| section == b"__stubs" || section == b"__init_offsets";
    struct Listed<'a> {
        addr: u64,
        size: u64,
        align: u64,
        name: &'a [u8],
        segment: &'a [u8],
        section: &'a [u8],
        keep: bool,
    }
    let mut listed: Vec<Listed<'_>> = Vec::new();
    for (i, a) in map.atoms.iter().enumerate() {
        let Some(s) = map
            .sections
            .iter()
            .find(|s| a.addr >= s.addr && a.addr < s.addr + s.size)
        else {
            continue;
        };
        if s.segment == b"__TEXT" && is_made_by_the_linker(s.section) {
            continue;
        }
        let (align, keep) = (reconstructed.align[i], reconstructed.keep[i]);
        listed.push(Listed {
            addr: a.addr,
            size: a.size,
            align,
            name: a.name,
            segment: s.segment,
            section: s.section,
            keep,
        });
    }
    for s in sections
        .iter()
        .filter(|s| s.segment == b"__TEXT" && is_made_by_the_linker(s.name))
    {
        listed.push(Listed {
            addr: s.addr,
            size: s.size,
            align: 4,
            name: s.name,
            segment: s.segment,
            section: s.name,
            keep: false,
        });
    }
    listed.sort_by(|a, b| a.addr.cmp(&b.addr).then(b.size.cmp(&a.size)));
    let mut whole_starts: Vec<u64> = reconstructed.whole.iter().map(|w| w.0).collect();
    whole_starts.sort_unstable();
    let whole_end: HashMap<u64, u64> = reconstructed.whole.iter().copied().collect();

    let mut nodes = Nodes::default();
    let mut list: Vec<Node<'_>> = Vec::new();
    for a in &listed {
        let is_inside_whole = whole_starts
            .partition_point(|&w| w <= a.addr)
            .checked_sub(1)
            .is_some_and(|w| a.addr > whole_starts[w] && a.addr < whole_end[&whole_starts[w]]);
        let last = list.len().checked_sub(1);
        match last {
            // another name for the same atom, or for a place inside it
            Some(last) if a.addr == nodes.addr[last] || is_inside_whole => {
                list[last].names.push(a.name);
                list[last].align = list[last].align.max(if a.addr == nodes.addr[last] {
                    a.align
                } else {
                    1
                });
                nodes.size[last] = nodes.size[last].max(a.addr + a.size - nodes.addr[last]);
                list[last].keep |= a.keep;
            }
            Some(last) if a.addr < nodes.end(last) => {
                if a.size != 0 {
                    fail!(
                        "atoms overlap at {:x} ({})",
                        a.addr,
                        String::from_utf8_lossy(a.name)
                    );
                }
            }
            _ => {
                nodes.addr.push(a.addr);
                nodes.size.push(a.size);
                list.push(Node {
                    align: a.align,
                    segment: a.segment,
                    section: a.section,
                    names: vec![a.name],
                    keep: a.keep,
                });
            }
        }
    }
    let n_nodes = nodes.len();

    // ---- relocations, sorted by the address they apply to
    // A weak function defined in several objects is placed once, and the relocations of every copy land on it.
    // They have to agree. One object may know a literal by name where another only knows that it is a literal.
    let mut all = reconstructed.records;
    all.sort_by_key(|r| r.place);
    let mut records: Vec<Record> = Vec::with_capacity(all.len());
    let mut duplicates = 0;
    for r in all {
        let Some(kept) = records.last_mut().filter(|kept| kept.place == r.place) else {
            records.push(r);
            continue;
        };
        duplicates += 1;
        match (kept.refers, r.refers) {
            (Refers::Literal, Refers::Atom(..)) if kept.kind == r.kind => *kept = r,
            (Refers::Atom(..), Refers::Literal) if kept.kind == r.kind => {}
            _ if *kept != r => fail!("two objects disagree about the relocation at {:x}", r.place),
            _ => {}
        }
    }

    // ---- tables the linker made
    let mut exports = Vec::new();
    if let Some(c) = command(LC_DYLD_EXPORTS_TRIE).filter(|&c| b.u32(c + 12) != 0) {
        exported(b, b.u32(c + 8) as usize, 0, &mut exports);
    }
    // Chained fixups: the pointers the loader rebases. The low 36 bits of a pointer hold the address of its target.
    let mut rebased: Vec<u64> = Vec::new();
    {
        let header = b.u32(
            command(LC_DYLD_CHAINED_FIXUPS).ok_or("the image does not use chained fixups")? + 8,
        ) as usize;
        let starts = header + b.u32(header + 4) as usize;
        for i in 0..b.u32(starts) as usize {
            if b.u32(starts + 4 + 4 * i) == 0 {
                continue;
            }
            let in_segment = starts + b.u32(starts + 4 + 4 * i) as usize;
            if b.u16(in_segment + 6) != DYLD_CHAINED_PTR_64 {
                fail!("chained pointer format {}", b.u16(in_segment + 6));
            }
            for page in 0..usize::from(b.u16(in_segment + 20)) {
                let first = b.u16(in_segment + 22 + 2 * page);
                if first == 0xffff {
                    continue;
                }
                let mut a = base
                    + b.u64(in_segment + 8)
                    + page as u64 * u64::from(b.u16(in_segment + 4))
                    + u64::from(first);
                loop {
                    let value = b.u64(file_offset(a));
                    if value >> 63 == 0 {
                        rebased.push(a); // else it is bound to an import
                    }
                    let next = (value >> 51) & 0xfff;
                    if next == 0 {
                        break;
                    }
                    a += next * 4;
                }
            }
        }
    }

    // ---- markers, and the blocks of the functions that hold them
    // A record is {marker - ., `false` side - ., id, 0} (4 x 32 bits), in __TEXT,__bun_feat.
    let marker_records = section("__TEXT", "__bun_feat");
    let mut markers: Vec<(u64, Marker)> = Vec::new();
    if let Some(table) = marker_records {
        for r in (0..table.size.saturating_sub(15)).step_by(16) {
            let (o, at) = (table.offset + r as usize, table.addr + r);
            let site = at.wrapping_add_signed(b.i32(o).into());
            let marker = Marker {
                skip: at.wrapping_add_signed(b.i32(o + 4).into()),
                id: b.u32(o + 8),
            };
            match markers.iter_mut().find(|m| m.0 == site) {
                Some(known) if known.1.id != marker.id => {
                    fail!("two features share the marker at {site:x}")
                }
                Some(known) => known.1 = marker,
                None => markers.push((site, marker)),
            }
        }
    }

    // x86-64: a jump table follows the code of its function, and `LC_DATA_IN_CODE` lists {offset, length u16, kind u16}.
    let mut jump_tables_in_code: Vec<(u64, u64)> = Vec::new();
    if let Some(c) = command(LC_DATA_IN_CODE).filter(|_| arch == Arch::X64) {
        const DICE_KIND_JUMP_TABLE32: u16 = 4;
        let at = b.u32(c + 8) as usize;
        for o in (at..at + b.u32(c + 12) as usize)
            .step_by(8)
            .filter(|&o| b.u16(o + 6) == DICE_KIND_JUMP_TABLE32)
        {
            let start = base + u64::from(b.u32(o));
            jump_tables_in_code.push((start, start + u64::from(b.u16(o + 4))));
        }
        jump_tables_in_code.sort_unstable();
    }

    let mut image = MachO {
        nodes,
        list,
        records,
        blocks: Blocks::default(),
    };
    let is_code_in = |list: &[Node<'_>], n: usize| {
        list[n].segment == b"__TEXT"
            && (list[n].section == b"__text" || list[n].section == b"__jsc_int")
    };
    image.blocks = {
        let is_code = |n: usize| is_code_in(&image.list, n);
        let taken_by = |start: u64, end: u64| {
            let mut tables: Vec<u64> = Vec::new();
            for r in image
                .records_in(start, end)
                .iter()
                .filter(|r| r.kind == reloc::PAGEOFF12)
            {
                let Refers::Atom(atom, target) = r.refers else {
                    continue;
                };
                let is_constant = |t: usize| !is_code(t) && image.list[t].segment == b"__TEXT";
                if image.nodes.find(atom).is_some_and(is_constant)
                    && !tables.contains(&target.cast_unsigned())
                {
                    tables.push(target.cast_unsigned());
                }
            }
            tables
                .into_iter()
                .filter_map(|at| Some((at, image.nodes.end(image.nodes.find(at)?))))
                .collect()
        };
        Functions {
            arch,
            objdump: link.objdump,
            path: link.linked,
            bias: 0,
            bytes: b,
            file_offset: &file_offset,
            markers: &markers,
            nodes: &image.nodes,
            is_code: &is_code,
            does_not_return: &HashSet::new(),
            constants_taken_by: &taken_by,
            jump_tables_in_code: &jump_tables_in_code,
        }
        .split()?
    };
    let image = image;
    let (nodes, list, records, blocks) = (&image.nodes, &image.list, &image.records, &image.blocks);
    let is_movable = |n: usize| list[n].segment == b"__TEXT" && nodes.addr[n] < first_fixed;
    // What may turn out dead. Constants with pointers live in __DATA_CONST: they count for liveness but stay in place for now.
    let is_collectable = |n: usize| {
        if is_movable(n) {
            !is_made_by_the_linker(list[n].section)
        } else {
            list[n].segment == b"__DATA_CONST" && list[n].section == b"__const"
        }
    };

    // ---- what is live
    let mut roots = vec![base + b.u64(main_command + 8)];
    roots.extend(exports.iter().map(|offset| base + offset));
    roots.extend(
        (0..n_nodes)
            .filter(|&n| !is_collectable(n) || list[n].keep)
            .map(|n| nodes.addr[n]),
    );
    if let Some(s) = init_offsets {
        roots.extend(
            (0..s.size as usize)
                .step_by(4)
                .map(|o| base + u64::from(b.u32(s.offset + o))),
        );
    }
    // x86-64: what comes before the first symbol of its section has no name, so where its relocations apply is not known.
    // It always stays, and what it points at with it.
    let has_relocation = |at: u64| !image.records_in(at, at + 1).is_empty();
    let nameless = rebased
        .iter()
        .filter(|&&at| !within(got, at) && !has_relocation(at));
    roots.extend(nameless.map(|&at| b.u64(file_offset(at)) & 0xf_ffff_ffff));
    // With nothing excluded the graph should reach everything the linker kept. What it does not reach is kept regardless.
    let as_linked = mark(&image, &roots, Excluded::BothSides)?;
    let unexplained: Vec<usize> = (0..n_nodes)
        .filter(|&n| !as_linked.node[n] && nodes.size[n] != 0)
        .collect();

    // ---- rows of tables that belong to features
    let pointer_at = |a: u64| b.u64(file_offset(a)) & 0xf_ffff_ffff;
    let mut feature_rows: Vec<FeatureRow> = Vec::new();
    for (feature, row) in FEATURES
        .iter()
        .flat_map(|f| f.rows.iter().map(move |row| (f, row)))
    {
        let found: Vec<usize> = (0..n_nodes)
            .filter(|&n| list[n].names.iter().any(|name| matches(row.table, name)))
            .collect();
        let &[table] = &found[..] else {
            fail!("{} tables match {}", found.len(), row.table)
        };
        let (start, end) = (nodes.addr[table], nodes.end(table));
        let before = feature_rows.len();
        let mut add = |a: u64| {
            if !feature_rows.iter().any(|r| r.start == a) {
                feature_rows.push(FeatureRow {
                    node: table,
                    start: a,
                    end: a + row.size,
                    feature: feature.id,
                });
            }
        };
        match row.select {
            // It starts with its name, as {pointer, length including the terminator}.
            Select::Key(key) => {
                for a in (start..=end.saturating_sub(row.size)).step_by(row.size as usize) {
                    let is_named =
                        b.u64(file_offset(a + 8)) == key.len() as u64 + 1 && pointer_at(a) != 0;
                    if is_named && linked[file_offset(pointer_at(a))..].starts_with(key.as_bytes())
                    {
                        add(a);
                    }
                }
            }
            Select::PointsAt { itanium, .. } => {
                for r in image.records_in(start, end) {
                    let Refers::Atom(atom, _) = r.refers else {
                        continue;
                    };
                    if nodes
                        .find(atom)
                        .is_some_and(|t| list[t].names.iter().any(|name| matches(itanium, name)))
                    {
                        add(start + (r.place - start) / row.size * row.size);
                    }
                }
            }
        }
        if feature_rows.len() == before {
            fail!("no row of {} belongs to {}", row.table, feature.name);
        }
    }
    feature_rows.sort_by_key(|r| r.start);

    // ---- units
    let mut parts = Parts::default();
    // The header is a unit too. It is in no area: it moves by as much as the image base.
    let header_unit = parts.add_unit(base, header_size, STARTS_PIECE | ROOT, 1);
    let is_in_table = |n: usize| is_movable(n) || is_collectable(n);
    let in_table =
        |n: usize| (is_in_table(n) && nodes.size[n] != 0).then_some(list[n].align.max(4));
    let Units {
        first_of_node,
        of_block,
    } = parts.add_nodes(nodes, blocks, &feature_rows, &in_table);

    // The unit of the atom that starts at `atom`; for a function that is split, of the block that holds `address`.
    let unit_for = |atom: u64, address: i64| -> Option<u32> {
        if atom == base {
            return Some(header_unit);
        }
        let n = nodes.find(atom).filter(|&n| is_in_table(n))?;
        match blocks.of(n) {
            Some(of) if address >= atom.cast_signed() => {
                Some(of_block[blocks.at(of, address.cast_unsigned())])
            }
            _ => first_of_node[n],
        }
    };
    let unit_at = |atom: u64| unit_for(atom, atom.cast_signed());
    for root in roots
        .iter()
        .copied()
        .chain(unexplained.iter().map(|&n| nodes.addr[n]))
    {
        if let Some(u) = unit_at(root) {
            parts.units[u as usize].flags |= ROOT;
        }
    }
    // The same for blocks that no control flow reaches.
    for i in (0..blocks.all.len()).filter(|&i| !as_linked.block[i]) {
        parts.units[of_block[i] as usize].flags |= ROOT;
    }

    // ---- fixups
    let moves = |a: u64| nodes.find(a).is_some_and(is_movable);
    let page_of = |a: u64| a & !0xfff;
    let is_in_got_pages = |a: u64| got.is_some_and(|g| a >= page_of(g.addr) && a < g.addr + g.size);
    let adrp_target = |p: u64| -> Result<u64> {
        let w = b.u32(file_offset(p));
        if w & 0x9f00_0000 != 0x9000_0000 {
            fail!("expected adrp at {p:x}, found {w:x}");
        }
        let count = ((((w >> 5) & 0x7_ffff) << 2) | ((w >> 29) & 3)) << 11;
        Ok(page_of(p).wrapping_add_signed(i64::from(count.cast_signed() >> 11) * 4096))
    };

    let mut atom_of_pointer: HashMap<u64, u64> = HashMap::new(); // where a pointer is -> the atom it means
    for r in records {
        let p = r.place;
        let atom = if let Refers::Atom(atom, target) = r.refers {
            Some((atom, target))
        } else {
            None
        };
        let unit = || atom.and_then(|(atom, target)| unit_for(atom, target));
        let means = |address: u64| atom.is_some_and(|(_, target)| target == address.cast_signed());
        if r.kind == RELOC_UNSIGNED {
            if r.minus_atom.is_none() {
                // handled with the fixup chains below
                atom_of_pointer.extend(atom.map(|(atom, _)| (p, atom)));
            } else if !within(marker_records, p) {
                // Tables of constants hold the distances from themselves to other constants. None of those move, so there
                // is nothing to patch, but what a table leads to lives as long as the table.
                if atom.is_some_and(|(atom, _)| moves(atom)) || r.minus_atom.is_some_and(moves) {
                    fail!("a difference of two addresses, one of which can move, at {p:x}");
                }
                if unit().is_some() {
                    parts.add_fixup("distance to a constant", p, Form::None, unit(), 0);
                }
            }
            continue;
        }
        if arch == Arch::X64 {
            // Every other field is a distance from the end of its instruction.
            let t =
                (p + 4 + u64::from(r.following)).wrapping_add_signed(b.i32(file_offset(p)).into());
            match r.kind {
                x64::BRANCH if means(t) && !within(stubs, t) => {
                    parts.add_fixup("branch", p, Form::Rel32, unit(), 0)
                }
                x64::BRANCH if within(stubs, t) => {
                    parts.add_fixup(
                        "branch to a stub",
                        p,
                        Form::Rel32,
                        stubs.and_then(|s| unit_at(s.addr)),
                        0,
                    );
                }
                x64::SIGNED | x64::SIGNED_1 | x64::SIGNED_2 | x64::SIGNED_4 if means(t) => {
                    parts.add_fixup("relative", p, Form::Rel32, unit(), 0);
                }
                // it stays, the instruction moves
                x64::SIGNED | x64::SIGNED_1 | x64::SIGNED_2 | x64::SIGNED_4
                    if atom.is_none() && t >= first_fixed =>
                {
                    parts.add_fixup("relative, to a literal", p, Form::Rel32, None, 0);
                }
                x64::GOT_LOAD | x64::GOT if within(got, t) => {
                    parts.add_fixup("got slot", p, Form::Rel32, None, 0);
                    if atom.is_some() {
                        parts.add_fixup("what a got slot holds", p, Form::None, unit(), 0); // the slot itself keeps nothing alive
                    }
                }
                // The linker turns a load from the GOT into the address itself where it can.
                x64::GOT_LOAD if means(t) => {
                    parts.add_fixup("got slot, relaxed to the symbol", p, Form::Rel32, unit(), 0)
                }
                x64::TLV if t >= first_fixed => {
                    parts.add_fixup("thread-local descriptor", p, Form::Rel32, None, 0)
                }
                kind => fail!("the relocation of type {kind} at {p:x} means {t:x}, and should not"),
            }
            continue;
        }
        match r.kind {
            reloc::BRANCH26 => {
                let w = b.u32(file_offset(p));
                if w & 0x7c00_0000 != 0x1400_0000 {
                    fail!("expected b or bl at {p:x}");
                }
                let goes_to = p.wrapping_add_signed(i64::from((w << 6).cast_signed() >> 6) * 4);
                if means(goes_to) && !within(stubs, goes_to) {
                    parts.add_fixup("branch", p, Form::Branch26, unit(), 0);
                } else if let Some(stubs) = stubs.filter(|s| s.holds(goes_to)) {
                    parts.add_fixup(
                        "branch to a stub",
                        p,
                        Form::Branch26,
                        unit_at(stubs.addr),
                        0,
                    );
                } else {
                    fail!("the branch at {p:x} goes to {goes_to:x}, and should not");
                }
            }
            reloc::PAGE21 | reloc::GOT_LOAD_PAGE21 | reloc::TLVP_LOAD_PAGE21 => {
                let page = adrp_target(p)?;
                let via_got = r.kind == reloc::GOT_LOAD_PAGE21;
                let same_page = atom.filter(|&(_, target)| page == page_of(target.cast_unsigned()));
                if let Some((_, target)) = same_page.filter(|_| !(via_got && is_in_got_pages(page)))
                {
                    // Of what stays, an `adrp` needs no more than the page.
                    let low = if unit().is_some() {
                        (target % 4096) as u16
                    } else {
                        0
                    };
                    let sort = if via_got {
                        "page of a got slot, relaxed to the symbol"
                    } else {
                        "page"
                    };
                    parts.add_fixup(sort, p, Form::Page21, unit(), low);
                } else if page >= page_of(first_fixed) && (atom.is_none() || via_got) {
                    // it stays, the instruction moves
                    parts.add_fixup(
                        if via_got {
                            "page of a got slot"
                        } else {
                            "page of a literal"
                        },
                        p,
                        Form::Page21,
                        None,
                        0,
                    );
                    if atom.is_some() {
                        parts.add_fixup("what a got slot holds", p, Form::None, unit(), 0); // the slot itself keeps nothing alive
                    }
                } else {
                    fail!("the adrp at {p:x} means page {page:x}, and should not");
                }
            }
            reloc::PAGEOFF12 | reloc::GOT_LOAD_PAGEOFF12 | reloc::TLVP_LOAD_PAGEOFF12 => {
                let w = b.u32(file_offset(p));
                let is_add = w & 0x7f80_0000 == 0x1100_0000;
                if !is_add && w & 0x3b00_0000 != 0x3900_0000 {
                    fail!("expected add, ldr or str at {p:x}, found {w:x}");
                }
                // The low bits of something that stays, stay: a literal, a got slot, a thread-local descriptor.
                let Some((atom, target)) = atom else { continue };
                if r.kind == reloc::TLVP_LOAD_PAGEOFF12
                    || (r.kind == reloc::GOT_LOAD_PAGEOFF12 && !is_add)
                {
                    continue;
                }
                // A load or store scales its offset by the size of the access; 128-bit accesses are encoded apart.
                let log2_scale = if is_add {
                    0
                } else if w & 0x0400_0000 != 0 && w & 0x0080_0000 != 0 {
                    4
                } else {
                    (w >> 30) as u16
                };
                if i64::from((w >> 10) & 0xfff) << log2_scale != target % 4096 {
                    fail!("unexpected low 12 bits at {p:x}");
                }
                // If the target does not move there is nothing to patch, and the adrp that goes with this is the edge already.
                if moves(atom) {
                    parts.add_fixup("low bits", p, Form::PageOff12, unit(), log2_scale);
                }
            }
            kind => fail!("relocation type {kind}"),
        }
    }

    // What the linker made has no relocations. A stub is `adrp x16, slot ; ldr x16, [x16, #low] ; br x16`, or `jmpq *slot(%rip)`.
    for a in stubs
        .into_iter()
        .flat_map(|s| (s.addr..s.addr + s.size).step_by(if arch == Arch::Arm64 { 12 } else { 6 }))
    {
        if arch == Arch::Arm64 {
            if !is_in_got_pages(adrp_target(a)?) {
                fail!("a stub does not load from the got");
            }
            parts.add_fixup("stub", a, Form::Page21, None, 0);
        } else {
            let o = file_offset(a);
            if linked[o..o + 2] != [0xff, 0x25]
                || !within(got, (a + 6).wrapping_add_signed(b.i32(o + 2).into()))
            {
                fail!("a stub does not jump through the got");
            }
            parts.add_fixup("stub", a + 2, Form::Rel32, None, 0);
        }
    }
    for &at in &rebased {
        let pointer = pointer_at(at);
        if let Some(&atom) = atom_of_pointer.get(&at) {
            if unit_at(atom).is_some() {
                parts.add_fixup(
                    "pointer",
                    at,
                    Form::ChainRebase,
                    unit_for(atom, pointer.cast_signed()),
                    0,
                );
            }
        } else if let Some(n) = nodes.find(pointer).filter(|&n| is_in_table(n)) {
            let (sort, form) = if within(got, at) {
                ("got slot", Form::ChainRebaseWeak)
            } else {
                ("pointer in what has no name", Form::ChainRebase)
            };
            let unit = unit_for(nodes.addr[n], pointer.cast_signed());
            parts.add_fixup(sort, at, form, unit, 0);
        }
    }
    if let Some(s) = init_offsets {
        for a in (s.addr..s.addr + s.size).step_by(4) {
            parts.add_fixup(
                "initializer",
                a,
                Form::Base32,
                unit_at(base + u64::from(b.u32(file_offset(a)))),
                0,
            );
        }
    }
    // Nothing in the header is listed: stripping removes section headers, and what follows them is then somewhere else.

    // ---- the table
    let mut patches = Vec::new();
    for &(site, marker) in &markers {
        patches.push(marker_patch(arch, b, file_offset(site), site, marker)?);
    }
    let report = format!(
        "{}atoms {n_nodes}, relocations {} (and {duplicates} duplicates), rebased pointers {}, markers {} in {} functions ({} \
         blocks), rows of features {}\nkept by the linker but not reached by the graph: {} atoms\nunits {}, flow edges {}, \
         fixups {}, patches {}\n{}\n",
        reconstructed.report,
        records.len(),
        rebased.len(),
        markers.len(),
        blocks.of.len(),
        blocks.all.len(),
        feature_rows.len(),
        unexplained.len(),
        parts.units.len(),
        parts.flows.len(),
        parts.fixups.len(),
        patches.len(),
        parts.sorts(),
    );
    let is_code_section = |s: &&Section<'_>| {
        s.segment == b"__TEXT" && [&b"__text"[..], b"__jsc_int", b"__stubs"].contains(&s.name)
    };
    let table = Table {
        format: Format {
            container: Container::MachO,
            arch,
        },
        features: FEATURES
            .iter()
            .map(|f| Feature {
                id: f.id,
                name: f.name.as_bytes().into(),
            })
            .collect(),
        areas: vec![Area {
            low: nodes.addr[(0..n_nodes)
                .find(|&n| is_movable(n))
                .ok_or("nothing moves")?],
            high: first_fixed,
            towards_high: true,
            fill: if arch == Arch::Arm64 {
                [0x20, 0x00, 0x20, 0xd4][..].into()
            } else {
                [0xcc][..].into()
            }, // brk #1, int3
        }],
        code: sections
            .iter()
            .filter(is_code_section)
            .map(|s| (s.addr, s.addr + s.size))
            .collect(),
        patches,
        units: parts.units,
        flows: parts.flows,
        fixups: parts.fixups,
    }
    .canonical();
    Ok(Made { table, report })
}
