//! Mach-O, linked by ld64.lld with `-map` and `-object_path_lto`.
//!
//! A node is an ATOM, which is what the linker places, strips and reorders: the bytes from one symbol to the next. Two
//! exceptions, both honoured here because the linker honours them: a symbol flagged `N_ALT_ENTRY` is a second name inside
//! the atom before it (hand-written assembly that falls through its labels uses this), and an object without
//! `MH_SUBSECTIONS_VIA_SYMBOLS` has one atom per section.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::Path;

use super::objects::{Object, Objects};
use super::{Data, Graph, Link, Node, Record, Result, fail, find, read};
use crate::bytes::fixed_name;

const MH_MAGIC_64: u32 = 0xfeed_facf;
const MH_SUBSECTIONS_VIA_SYMBOLS: u32 = 0x2000;
const LC_SYMTAB: u32 = 2;
const LC_SEGMENT_64: u32 = 0x19;
const LC_MAIN: u32 = 0x8000_0028;
const LC_DYLD_EXPORTS_TRIE: u32 = 0x8000_0033;
const N_STAB: u8 = 0xe0;
const N_TYPE: u8 = 0x0e;
const N_SECT: u8 = 0x0e;
const N_EXT: u8 = 1;
const N_NO_DEAD_STRIP: u16 = 0x20;
const N_ALT_ENTRY: u16 = 0x200;
const S_ATTR_NO_DEAD_STRIP: u32 = 0x1000_0000;
/// cstring, 4-, 8- and 16-byte literals, literal pointers: the linker merges these by content. They refer to nothing.
const LITERAL_SECTION_TYPES: [u8; 5] = [2, 3, 4, 5, 14];
const RELOC_UNSIGNED: u8 = 0;
const X86_64_RELOC_SUBTRACTOR: u8 = 5;
const ARM64_RELOC_ADDEND: u8 = 10;

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

pub(super) fn graph(link: &Link<'_>, linked: &[u8], is_arm64: bool) -> Result<Graph> {
    let b = Data(linked);
    let map_text = read(link.map)?;
    let map = read_map(&map_text);

    // ---- the object files
    // By the number the map gives them. It lists an object only if it credits a symbol to it, and the external symbols of
    // what LTO generated it credits to the bitcode they came from. So the rest of what LTO generated follows.
    let mut files: Vec<String> = map
        .files
        .iter()
        .map(|name| String::from_utf8_lossy(name).into_owned())
        .collect();
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
    for (file, name) in files.iter().enumerate().skip(1).filter(|f| !f.1.is_empty()) {
        match archives.get(name) {
            None => fail!("an input of the link is not there: {name}"),
            // Bitcode: its code is in what LTO generated.
            Some(object) if !object.bytes().starts_with(&MH_MAGIC_64.to_le_bytes()) => {}
            Some(object) => loaded.push((file, object)),
        }
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

    // ---- per object: its atoms, and what refers to what, as the addresses that atoms start at
    let mut keep = vec![false; map.atoms.len()];
    // Ranges that the map lists as several symbols but that are one atom.
    let mut whole: Vec<(u64, u64)> = Vec::new();
    let mut references: Vec<(u64, u64)> = Vec::new();
    let mut referred_to_by_the_nameless: Vec<u64> = Vec::new();
    // Per atom of the map: has it been found in an object?
    let mut is_claimed = vec![false; map.atoms.len()];
    // Sections in which something comes before the first symbol. The map does not say where that went.
    let mut has_nameless: HashSet<(&[u8], &[u8])> = HashSet::new();
    let (mut relocations, mut not_kept) = (0u64, 0u64);
    for (
        file,
        Parsed {
            bytes: o,
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
        // Where the atom that holds an address of this object starts.
        let locate = |section: usize, value: u64| -> Option<u64> {
            let list = &starts[section - 1];
            let found = &list[list.partition_point(|s| s.value <= value).checked_sub(1)?];
            found.names.iter().find_map(|name| final_address(name))
        };

        for y in symbols.iter().filter(|y| y.is_defined()) {
            if let Some(atom) = placed_atom(y.name) {
                is_claimed[atom] = true;
            }
        }
        for (s, starts) in sections.iter().zip(&starts) {
            if s.size != 0
                && starts.first().is_none_or(|first| first.value != s.addr)
                && !LITERAL_SECTION_TYPES.contains(&s.kind)
            {
                has_nameless.insert((s.segment, s.section));
            }
            for (k, start) in starts
                .iter()
                .enumerate()
                .filter(|s| s.1.has_alternative_entries)
            {
                if let Some(atom) = start.names.iter().find_map(|name| placed_atom(name)) {
                    let end = starts.get(k + 1).map_or(s.addr + s.size, |next| next.value);
                    whole.push((
                        map.atoms[atom].addr,
                        map.atoms[atom].addr + (end - start.value),
                    ));
                }
            }
        }
        for y in symbols.iter().filter(|y| y.is_defined()) {
            let is_kept = y.flags & N_NO_DEAD_STRIP != 0
                || sections[usize::from(y.section) - 1].attributes & S_ATTR_NO_DEAD_STRIP != 0;
            if let Some(atom) = placed_atom(y.name).filter(|_| is_kept) {
                keep[atom] = true;
            }
        }

        for (index, s) in sections.iter().enumerate() {
            // Debug information. Notes for the linker, which are not loaded. Unwind tables, which live and die with the functions
            // they are about. And a record of `bun_core::feature` does not keep the function that it is about.
            if s.segment == b"__DWARF"
                || s.segment == b"__LD"
                || s.section == b"__llvm_addrsig"
                || s.section == b"__eh_frame"
                || s.section == b"__bun_feat"
            {
                continue;
            }
            for i in 0..s.relocation_count {
                let q = s.relocation_offset + i * 8;
                let (offset, word) = (o.u32(q).cast_signed(), o.u32(q + 4));
                let (number, log2_length, is_external, kind) = (
                    word & 0xff_ffff,
                    (word >> 25) as u8 & 3,
                    word >> 27 & 1 != 0,
                    (word >> 28) as u8,
                );
                if is_arm64 && kind == ARM64_RELOC_ADDEND {
                    continue;
                }
                relocations += 1;
                let place = s.addr.wrapping_add_signed(offset.into());
                let from = locate(index + 1, place);
                // What comes before the first symbol of its section has no name, and the map does not say whether it was kept.
                let is_nameless = starts[index]
                    .first()
                    .is_none_or(|first| place < first.value);
                if from.is_none() && !is_nameless {
                    not_kept += 1;
                    continue;
                }
                let to = if !is_external {
                    // Against a section, for what has no symbol to go by. What is in place is an address in the object, or
                    // the distance to one from the end of the instruction. `SIGNED_1`, `_2` and `_4` say how far that is.
                    if is_arm64 {
                        fail!(
                            "{}: relocation against a section number, which arm64 does not use",
                            files[file]
                        );
                    }
                    let field = s.offset.wrapping_add_signed(offset as isize);
                    let address = if kind != RELOC_UNSIGNED && kind != X86_64_RELOC_SUBTRACTOR {
                        let following = match kind {
                            6 => 1,
                            7 => 2,
                            8 => 4,
                            _ => 0,
                        };
                        s.addr.wrapping_add_signed(
                            i64::from(offset)
                                + 4
                                + following
                                + i64::from(o.u32(field).cast_signed()),
                        )
                    } else if log2_length == 3 {
                        o.u64(field)
                    } else {
                        o.u32(field).into()
                    };
                    locate(number as usize, address).filter(|_| {
                        !LITERAL_SECTION_TYPES.contains(&sections[number as usize - 1].kind)
                    })
                } else {
                    let y = &symbols[number as usize];
                    if !y.is_defined() {
                        // else imported, or the header of the image
                        final_address(y.name)
                    } else if LITERAL_SECTION_TYPES
                        .contains(&sections[usize::from(y.section) - 1].kind)
                    {
                        None
                    } else {
                        match locate(y.section.into(), y.value) {
                            Some(to) => Some(to),
                            None if from.is_none() => None,
                            None => fail!(
                                "{}: cannot find {} in the image",
                                files[file],
                                String::from_utf8_lossy(y.name)
                            ),
                        }
                    }
                };
                match from {
                    Some(from) => references.extend(to.map(|to| (from, to))),
                    // So what it refers to stays.
                    None => referred_to_by_the_nameless.extend(to),
                }
            }
        }
    }

    // Else there are relocations that have not been read. A stub is credited to the library that it calls into. Strings have no
    // symbols and no relocations, and those of the unwind tables are not followed.
    let is_in = |a: &Atom<'_>, section: &[u8]| {
        (map.sections.iter())
            .any(|s| s.section == section && a.addr >= s.addr && a.addr < s.addr + s.size)
    };
    let is_from_an_object = |a: &Atom<'_>| {
        let is_from_a_file = a.file != 0 && a.size != 0 && !files[a.file].ends_with(".tbd");
        is_from_a_file && !is_in(a, b"__cstring") && !is_in(a, b"__eh_frame")
    };
    let mut unclaimed = (map.atoms.iter().zip(&is_claimed))
        .filter(|(a, is_claimed)| is_from_an_object(a) && !**is_claimed);
    if let Some((atom, _)) = unclaimed.next() {
        fail!(
            "{} atoms of the map were not found in their objects, one is {} of {}",
            unclaimed.count() + 1,
            String::from_utf8_lossy(atom.name),
            files[atom.file]
        );
    }

    // ---- nodes
    // What the linker made itself (file 0) refers to nothing that is known here, and is referred to in ways that are not.
    let mut listed: Vec<(u64, u64, usize, &[u8], bool, bool)> = Vec::new(); // {address, size, stretch, name, keep, is from an object}
    for (i, a) in map.atoms.iter().enumerate() {
        if let Some(stretch) = map
            .sections
            .iter()
            .position(|s| a.addr >= s.addr && a.addr < s.addr + s.size)
        {
            listed.push((
                a.addr,
                a.size,
                stretch,
                a.name,
                keep[i] || a.file == 0,
                a.file != 0,
            ));
        }
    }
    listed.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.cmp(&a.1)));
    whole.sort_unstable();
    let mut nodes: Vec<Node> = Vec::new();
    for &(address, size, stretch, name, keep, is_from_an_object) in &listed {
        let is_inside_whole = whole
            .partition_point(|w| w.0 <= address)
            .checked_sub(1)
            .is_some_and(|w| address > whole[w].0 && address < whole[w].1);
        match nodes.last_mut() {
            // another name for the same atom, or for a place inside it
            Some(last) if address == last.addresses.start || is_inside_whole => {
                last.addresses.end = last.addresses.end.max(address + size);
                last.is_root |= keep;
            }
            Some(last) if address < last.addresses.end => {
                if size != 0 {
                    fail!(
                        "atoms overlap at {address:x} ({})",
                        String::from_utf8_lossy(name)
                    );
                }
            }
            _ if size == 0 => {}
            _ => {
                let s = &map.sections[stretch];
                let is_whole_known = !has_nameless.contains(&(s.segment, s.section));
                nodes.push(Node {
                    addresses: address..address + size,
                    stretch: stretch as u32,
                    can_be_left_out: is_from_an_object
                        && s.segment == b"__TEXT"
                        && matches!(s.section, b"__text" | b"__const")
                        && is_whole_known,
                    is_root: keep,
                    names: vec![name.iter().map(|&c| char::from(c)).collect()],
                });
            }
        }
    }

    // ---- load commands
    let mut commands: Vec<(u32, usize)> = Vec::new();
    let mut at = 32;
    for _ in 0..b.u32(16) {
        commands.push((b.u32(at), at));
        at += b.u32(at + 4) as usize;
    }
    let command = |kind: u32| commands.iter().find(|c| c.0 == kind).map(|c| c.1);
    let is_text = |c: &&(u32, usize)| {
        c.0 == LC_SEGMENT_64 && fixed_name(&linked[c.1 + 8..c.1 + 24]) == b"__TEXT"
    };
    let base = b.u64(commands.iter().find(is_text).ok_or("no segment __TEXT")?.1 + 24);
    let section = |segment: &[u8], name: &[u8]| {
        output
            .sections
            .iter()
            .find(|s| s.segment == segment && s.section == name)
    };

    // ---- what is reached from outside, or from what the linker made
    let mut roots: Vec<u64> = vec![base + b.u64(command(LC_MAIN).ok_or("no LC_MAIN")? + 8)];
    if let Some(c) = command(LC_DYLD_EXPORTS_TRIE).filter(|&c| b.u32(c + 12) != 0) {
        let mut exports = Vec::new();
        exported(b, b.u32(c + 8) as usize, 0, &mut exports);
        roots.extend(exports.into_iter().map(|offset| base + offset));
    }
    if let Some(s) = section(b"__TEXT", b"__init_offsets") {
        roots.extend(
            (s.offset..s.offset + s.size as usize)
                .step_by(4)
                .map(|at| base + u64::from(b.u32(at))),
        );
    }
    roots.extend(&referred_to_by_the_nameless);
    for root in roots {
        if let Some(node) = find(&nodes, root) {
            nodes[node as usize].is_root = true;
        }
    }
    let mut edges = Vec::with_capacity(references.len());
    for (from, to) in references {
        if let (Some(from), Some(to)) = (find(&nodes, from), find(&nodes, to)) {
            edges.push((from, to));
        }
    }

    // ---- records: {no-op - ., other side - . or 0, id, 0}
    let mut records = Vec::new();
    if let Some(s) = section(b"__TEXT", b"__bun_feat") {
        for r in (0..s.size.saturating_sub(15)).step_by(16) {
            let (o, at) = (s.offset + r as usize, s.addr + r);
            let relative = |field: usize| at.wrapping_add_signed(b.u32(field).cast_signed().into());
            records.push(Record {
                no_op: relative(o),
                otherwise: (b.u32(o + 4) != 0).then(|| relative(o + 4)),
                id: b.u32(o + 8),
            });
        }
    }
    let mut nameless: Vec<String> = has_nameless
        .iter()
        .map(|(a, b)| {
            format!(
                "{},{}",
                String::from_utf8_lossy(a),
                String::from_utf8_lossy(b)
            )
        })
        .collect();
    nameless.sort_unstable();
    let report = format!(
        "objects {}, relocations {relocations}, of which in atoms that were not kept {not_kept}; references from what has no name \
         {}; sections that have something nameless: {}\n",
        objects.len(),
        referred_to_by_the_nameless.len(),
        nameless.join(" "),
    );
    Ok(Graph {
        nodes,
        edges,
        records,
        report,
    })
}
