//! ELF, x86-64 or arm64, not position independent.
//!
//! The link has to be made with `--emit-relocs`, which keeps the relocations in the linked file, `--save-temps=prelink`,
//! `--print-icf-sections` and, on arm64, `--no-relax`.

use std::collections::{HashMap, HashSet};

use super::blocks::{Functions, Marker, marker_patch};
use super::check_blocks::Reconstruction;
use super::features::{FEATURES, Select, matches};
use super::live::{Blocks, Excluded, Image, mark};
use super::objects::Objects;
use super::{Data, FeatureRow, Link, Made, Nodes, Parts, Result, Units, fail, read_text};
use crate::table::{Arch, Area, Container, Feature, Form, Format, ROOT, Table};

const SHF_ALLOC: u64 = 2;
const SHF_MERGE: u64 = 0x10;
const SHF_STRINGS: u64 = 0x20;
const SHT_RELA: u32 = 4;
const SHT_NOBITS: u32 = 8;
const SHT_SYMTAB_SHNDX: u32 = 18;
const STT_SECTION: u8 = 3;
const STT_TLS: u8 = 6;
const PT_LOAD: u32 = 1;

mod x64 {
    pub(super) const R_64: u32 = 1;
    pub(super) const PC32: u32 = 2;
    pub(super) const PLT32: u32 = 4;
    pub(super) const GOTPCREL: u32 = 9;
    pub(super) const R_32: u32 = 10;
    pub(super) const R_32S: u32 = 11;
    pub(super) const TLSGD: u32 = 19;
    pub(super) const TLSLD: u32 = 20;
    pub(super) const DTPOFF32: u32 = 21;
    pub(super) const GOTTPOFF: u32 = 22;
    pub(super) const TPOFF32: u32 = 23;
    pub(super) const PC64: u32 = 24;
    pub(super) const GOTPCRELX: u32 = 41;
    pub(super) const REX_GOTPCRELX: u32 = 42;
}

mod arm64 {
    pub(super) const ABS64: u32 = 257;
    pub(super) const ABS32: u32 = 258;
    pub(super) const PREL64: u32 = 260;
    pub(super) const PREL32: u32 = 261;
    pub(super) const ADR_PREL_PG_HI21: u32 = 275;
    pub(super) const ADR_PREL_PG_HI21_NC: u32 = 276;
    pub(super) const ADD_ABS_LO12_NC: u32 = 277;
    pub(super) const LDST8_ABS_LO12_NC: u32 = 278;
    pub(super) const JUMP26: u32 = 282;
    pub(super) const CALL26: u32 = 283;
    pub(super) const LDST16_ABS_LO12_NC: u32 = 284;
    pub(super) const LDST32_ABS_LO12_NC: u32 = 285;
    pub(super) const LDST64_ABS_LO12_NC: u32 = 286;
    pub(super) const LDST128_ABS_LO12_NC: u32 = 299;
    pub(super) const ADR_GOT_PAGE: u32 = 311;
    pub(super) const LD64_GOT_LO12_NC: u32 = 312;
    /// All of these are thread-local.
    pub(super) const TLS: core::ops::RangeInclusive<u32> = 512..=573;
    pub(super) const TLSIE_ADR_GOTTPREL_PAGE21: u32 = 541;
}

/// Imported functions that do not return.
const NO_RETURN: [&str; 20] = [
    "exit",
    "_exit",
    "_Exit",
    "abort",
    "quick_exit",
    "pthread_exit",
    "longjmp",
    "siglongjmp",
    "__longjmp_chk",
    "__assert_fail",
    "__stack_chk_fail",
    "__fortify_fail",
    "__chk_fail",
    "_Unwind_Resume",
    "__cxa_throw",
    "__cxa_rethrow",
    "__cxa_bad_cast",
    "__cxa_bad_typeid",
    "__cxa_pure_virtual",
    "__cxa_throw_bad_array_new_length",
];

/// `address  address  size  align  text`, with the text indented by its level: output section, input section, symbol.
struct MapLine<'a> {
    addr: u64,
    size: u64,
    align: u64,
    indent: usize,
    text: &'a str,
}

fn map_line(line: &str) -> Option<MapLine<'_>> {
    let mut rest = line;
    let mut column = |radix| {
        rest = rest.trim_start();
        let (word, after) = rest.split_at(rest.find(char::is_whitespace)?);
        rest = after;
        u64::from_str_radix(word, radix).ok()
    };
    let (addr, _, size, align) = (column(16)?, column(16)?, column(16)?, column(10)?);
    let text = rest.strip_prefix(' ')?;
    let indent = text.len() - text.trim_start_matches(' ').len();
    Some(MapLine {
        addr,
        size,
        align,
        indent,
        text: &text[indent..],
    })
}

/// `file:(section)`
fn input_section(text: &str) -> Option<(&str, &str)> {
    let (file, section) = text.strip_suffix(')')?.rsplit_once(":(")?;
    Some((file, section))
}

struct Section {
    name: String,
    kind: u32,
    flags: u64,
    addr: u64,
    offset: u64,
    size: u64,
    link: u32,
    info: u32,
    align: u64,
    entry_size: u64,
}

impl Section {
    fn holds(&self, address: u64) -> bool {
        address >= self.addr && address < self.addr + self.size
    }
}

fn sections_of(b: Data<'_>) -> Vec<Section> {
    let shoff = b.u64(0x28) as usize;
    // Numbers too large for the header are in the first section header.
    let count = if b.u16(0x3c) != 0 {
        u64::from(b.u16(0x3c))
    } else {
        b.u64(shoff + 32)
    };
    let names = if b.u16(0x3e) == 0xffff {
        b.u32(shoff + 40) as usize
    } else {
        usize::from(b.u16(0x3e))
    };
    let names = b.u64(shoff + names * 64 + 24) as usize;
    (0..count as usize)
        .map(|i| {
            let o = shoff + i * 64;
            Section {
                name: String::from_utf8_lossy(b.cstr(names + b.u32(o) as usize)).into_owned(),
                kind: b.u32(o + 4),
                flags: b.u64(o + 8),
                addr: b.u64(o + 16),
                offset: b.u64(o + 24),
                size: b.u64(o + 32),
                link: b.u32(o + 40),
                info: b.u32(o + 44),
                align: b.u64(o + 48),
                entry_size: b.u64(o + 56),
            }
        })
        .collect()
}

/// For every relocation against a SECTION symbol: which input section does it mean?
///
/// `--emit-relocs` rewrites such a relocation to "output section + offset". That is ambiguous whenever the offset lies
/// outside the input section that was meant: `table - 8`, one past the end, `label - table`. The object file still
/// names the section, so read it there.
struct Exact {
    /// {address of the relocated field, start of the section meant}, sorted by the first.
    targets: Vec<(u64, u64)>,
    report: String,
}

fn exact_targets(map: &str, printed: &str) -> Result<Exact> {
    // Where each input section was placed: file -> section name -> addresses, in the order of the map.
    let mut files: Vec<&str> = Vec::new();
    let mut placed: HashMap<&str, HashMap<&str, Vec<u64>>> = HashMap::new();
    // Mergeable sections (strings, constants) are merged piece by piece into one pool per sort.
    let mut pools: HashMap<&str, Vec<u64>> = HashMap::new();
    for line in map.lines().filter_map(map_line).filter(|l| l.indent == 8) {
        let Some((file, section)) = input_section(line.text) else {
            continue;
        };
        if file == "<internal>" {
            pools.entry(section).or_default().push(line.addr);
            continue;
        }
        if !placed.contains_key(file) {
            files.push(file);
        }
        placed
            .entry(file)
            .or_default()
            .entry(section)
            .or_default()
            .push(line.addr);
    }

    // Sections that identical code folding replaced by an identical one: {file, section} -> the one kept.
    let mut folded: HashMap<(&str, &str), (&str, &str)> = HashMap::new();
    let mut kept = ("", "");
    for line in printed.lines() {
        if let Some(selected) = line
            .strip_prefix("selected section ")
            .and_then(input_section)
        {
            kept = selected;
        } else if let Some(removed) = line
            .strip_prefix("  removing identical section ")
            .and_then(input_section)
        {
            folded.insert(removed, kept);
        }
    }

    #[derive(Clone, Copy, PartialEq)]
    enum Final {
        At(u64),
        NotPlaced,
        Ambiguous,
    }
    let mut objects = Objects::default();
    let mut targets = Vec::new();
    let mut missing = Vec::new();
    let (mut count, mut relocations, mut exact, mut pool, mut ambiguous, mut not_placed) =
        (0, 0, 0, 0, 0, 0);

    for file in files {
        let by_name = &placed[file];
        let Some(object) = objects
            .get(file)
            .filter(|o| o.bytes().starts_with(b"\x7fELF"))
        else {
            missing.push(file);
            continue;
        };
        count += 1;
        let b = Data(object.bytes());
        let sections = sections_of(b);

        // The final address of each section of this object. If a name occurs twice, trust the order only if every copy was
        // placed.
        let mut copies: HashMap<&str, usize> = HashMap::new();
        for s in sections
            .iter()
            .filter(|s| s.flags & SHF_ALLOC != 0 && s.size != 0)
        {
            *copies.entry(&s.name).or_default() += 1;
        }
        let mut seen: HashMap<&str, usize> = HashMap::new();
        let final_address: Vec<Final> = sections
            .iter()
            .map(|s| {
                if s.flags & SHF_ALLOC == 0 || s.size == 0 {
                    return Final::NotPlaced;
                }
                let nth = seen.entry(&s.name).or_default();
                *nth += 1;
                let nth = *nth - 1;
                let one = |at: Option<&Vec<u64>>, otherwise| match at.map(|a| &a[..]) {
                    Some(&[one]) => Final::At(one),
                    _ => otherwise,
                };
                if s.flags & SHF_MERGE != 0 {
                    // The linker merges by what the sections hold, not by name: strings of one entry size and alignment,
                    // constants of one size. A pool goes by the name of its first member, and the usual names say just that.
                    let usual_name = if s.flags & SHF_STRINGS != 0 {
                        format!(".rodata.str{}.{}", s.entry_size, s.align)
                    } else {
                        format!(".rodata.cst{}", s.entry_size)
                    };
                    return one(
                        pools
                            .get(&s.name[..])
                            .or_else(|| pools.get(&usual_name[..])),
                        Final::Ambiguous,
                    );
                }
                if let Some(addresses) = by_name.get(&s.name[..]) {
                    return if copies[&s.name[..]] == addresses.len() {
                        Final::At(addresses[nth])
                    } else {
                        Final::Ambiguous
                    };
                }
                let kept = folded.get(&(file, &s.name[..]));
                one(
                    kept.and_then(|(file, section)| placed.get(file)?.get(section)),
                    Final::NotPlaced,
                )
            })
            .collect();

        let extended_index = sections.iter().find(|s| s.kind == SHT_SYMTAB_SHNDX);
        for rela in sections.iter().filter(|s| s.kind == SHT_RELA) {
            let Some(&Final::At(base)) = final_address.get(rela.info as usize) else {
                continue;
            };
            let symtab = &sections[rela.link as usize];
            for o in (rela.offset..rela.offset + rela.size).step_by(24) {
                let o = o as usize;
                let symbol = (b.u64(o + 8) >> 32) as usize;
                let entry = symtab.offset as usize + symbol * 24;
                if b.u8(entry + 4) & 15 != STT_SECTION {
                    continue;
                }
                relocations += 1;
                let index = match (b.u16(entry + 6), extended_index) {
                    (0xffff, Some(extended)) => {
                        b.u32(extended.offset as usize + symbol * 4) as usize
                    }
                    (index, _) => usize::from(index),
                };
                match final_address[index] {
                    Final::Ambiguous => ambiguous += 1,
                    Final::NotPlaced => not_placed += 1,
                    Final::At(target) => {
                        targets.push((base + b.u64(o), target));
                        *(if sections[index].flags & SHF_MERGE != 0 {
                            &mut pool
                        } else {
                            &mut exact
                        }) += 1;
                    }
                }
            }
        }
    }
    if !missing.is_empty() {
        fail!(
            "{} object files of the link are not there, the first: {}",
            missing.len(),
            missing[0]
        );
    }
    targets.sort_by_key(|t| t.0);
    let report = format!(
        "objects {count}; relocations against section symbols {relocations}: into a section {exact}, into a merged pool \
         {pool}, ambiguous {ambiguous}, target not in the image {not_placed}\n"
    );
    Ok(Exact { targets, report })
}

// Only these output sections are packed. Everything else keeps its address and is always kept.
#[derive(Clone, Copy, PartialEq)]
enum Packed {
    No,
    /// Read-only data ends its segment once the release has stripped the unwind tables, so it is packed downwards.
    Data,
    /// Code starts its segment, so it is packed upwards and the head is cut (.init, .fini and .plt after it stay).
    Code,
}

fn packed(output: &str) -> Packed {
    match output {
        ".rodata" | ".bun_builtins" => Packed::Data,
        ".text" => Packed::Code,
        _ => Packed::No,
    }
}

/// What a relocation refers to.
#[derive(Clone, Copy, PartialEq)]
enum Target {
    /// The symbol, or for a section symbol the start of the input section meant.
    Address(u64),
    /// Imported (reached through .plt and .got, which do not move) or thread-local.
    Nothing,
    /// A section symbol that could not be attributed. Fatal if it turns up in live code.
    Unknown,
}

struct Relocation {
    place: u64,
    kind: u32,
    symbol: u32,
    addend: i64,
    target: Target,
}

struct Symbol {
    value: u64,
    kind: u8,
    section: u16,
    name: u32,
}

impl Symbol {
    fn is_defined(&self) -> bool {
        self.section != 0
    }
}

struct Elf {
    arch: Arch,
    nodes: Nodes,
    area: Vec<Packed>,
    symbols: Vec<Symbol>,
    relocations: Vec<Relocation>,
    blocks: Blocks,
}

impl Elf {
    fn relocations_in(&self, start: u64, end: u64) -> &[Relocation] {
        let from = self.relocations.partition_point(|r| r.place < start);
        let to = from + self.relocations[from..].partition_point(|r| r.place < end);
        &self.relocations[from..to]
    }

    /// Whether the field holds a distance from itself, so that the addend of a reference by offset is biased.
    fn is_pc_relative(&self, kind: u32) -> bool {
        match self.arch {
            Arch::Arm64 => matches!(kind, arm64::PREL32 | arm64::PREL64),
            Arch::X64 => {
                matches!(
                    kind,
                    x64::PC32
                        | x64::PLT32
                        | x64::PC64
                        | x64::GOTPCREL
                        | x64::GOTPCRELX
                        | x64::REX_GOTPCRELX
                )
            }
        }
    }
}

impl Image for Elf {
    fn nodes(&self) -> &Nodes {
        &self.nodes
    }
    fn blocks(&self) -> &Blocks {
        &self.blocks
    }
    fn references(&self, start: u64, end: u64, touch: &mut dyn FnMut(u64)) -> Result<()> {
        for r in self.relocations_in(start, end) {
            let target = match r.target {
                Target::Nothing => continue,
                Target::Unknown => {
                    fail!("cannot tell what the relocation at {:x} refers to", r.place)
                }
                Target::Address(target) => target,
            };
            let symbol = &self.symbols[r.symbol as usize];
            let split = self
                .nodes
                .find(target)
                .and_then(|n| Some((n, self.blocks.of(n)?)));
            let (Some((n, (first, count))), STT_SECTION) = (split, symbol.kind) else {
                touch(target);
                continue;
            };
            // Into a function that is split into blocks, by offset: the offset decides which block.
            let inside = |a: u64| a >= self.nodes.addr[n] && a < self.nodes.end(n);
            let flat = symbol.value.wrapping_add_signed(r.addend);
            if !self.is_pc_relative(r.kind) {
                // an entry of a jump table; on arm64, also any reference from code
                touch(if inside(flat) {
                    flat
                } else {
                    self.nodes.addr[n]
                });
            } else if self.arch == Arch::Arm64 {
                // `label - table`, an entry of a jump table. Where the function's own indirect branches go is known already.
                touch(self.nodes.addr[n]);
            } else if self
                .nodes
                .find(r.place)
                .is_some_and(|p| self.area[p] == Packed::Code)
            {
                // The addend is biased by the distance from the field to the end of its instruction: 4 to 8 bytes.
                (4..=8)
                    .map(|bias| flat.wrapping_add(bias))
                    .filter(|&a| inside(a))
                    .for_each(&mut *touch);
            } else {
                // `label - table`: biased by the position in the table, which is not known here. All of the function stays.
                self.blocks.all[first..first + count]
                    .iter()
                    .for_each(|b| touch(b.start));
            }
        }
        Ok(())
    }
}

pub(super) fn make(
    link: &Link<'_>,
    linked: &[u8],
    arch: Arch,
    want_blocks: bool,
) -> Result<(Made, Option<Reconstruction>)> {
    let b = Data(linked);
    let map = read_text(link.map)?;
    let exact = exact_targets(&map, &read_text(link.printed)?)?;

    // ---- sections
    let sections = sections_of(b);
    let section = |name: &str| sections.iter().find(|s| s.name == name);
    let within = |s: Option<&Section>, a: u64| s.is_some_and(|s| s.holds(a));
    let file_offset = |a: u64| -> usize {
        let holds = |s: &&Section| s.flags & SHF_ALLOC != 0 && s.kind != SHT_NOBITS && s.holds(a);
        let s = sections
            .iter()
            .find(holds)
            .unwrap_or_else(|| panic!("no file bytes at {a:x}"));
        (s.offset + (a - s.addr)) as usize
    };
    let (got, got_plt, plt) = (section(".got"), section(".got.plt"), section(".plt"));

    // ---- nodes: the linker's input sections, from its map
    struct Node<'m> {
        addr: u64,
        size: u64,
        align: u64,
        output: &'m str,
        file: &'m str,
        section: &'m str,
    }
    let mut list: Vec<Node<'_>> = Vec::new();
    let mut current = "";
    for line in map.lines().filter_map(map_line) {
        if line.indent == 0 {
            current = line.text;
        }
        let is_loaded = || {
            sections
                .iter()
                .any(|s| s.flags & SHF_ALLOC != 0 && s.name == current)
        };
        if line.indent != 8 || line.size == 0 || !is_loaded() {
            continue;
        }
        let Some((file, section)) = input_section(line.text) else {
            continue;
        };
        list.push(Node {
            addr: line.addr,
            size: line.size,
            align: line.align.max(1),
            output: current,
            file,
            section,
        });
    }
    list.sort_by_key(|n| n.addr);
    let nodes = Nodes {
        addr: list.iter().map(|n| n.addr).collect(),
        size: list.iter().map(|n| n.size).collect(),
    };
    let area: Vec<Packed> = list.iter().map(|n| packed(n.output)).collect();

    // ---- symbols
    let symtab = section(".symtab").ok_or("the input has no symbol table")?;
    let strtab = &sections[symtab.link as usize];
    let name_at = |offset: u32| b.cstr(strtab.offset as usize + offset as usize);
    let mut names_of: Vec<Vec<u32>> = vec![Vec::new(); nodes.len()];
    let symbols: Vec<Symbol> = (0..symtab.size / 24)
        .map(|i| {
            let o = (symtab.offset + i * 24) as usize;
            Symbol {
                value: b.u64(o + 8),
                kind: b.u8(o + 4) & 15,
                section: b.u16(o + 6),
                name: b.u32(o),
            }
        })
        .collect();
    for s in symbols
        .iter()
        .filter(|s| s.kind <= 2 && s.section != 0 && s.section < 0xff00)
    {
        if let Some(n) = nodes.find(s.value) {
            names_of[n].push(s.name);
        }
    }
    let name_of = |n: usize| match names_of[n].first() {
        Some(&name) => String::from_utf8_lossy(name_at(name)).into_owned(),
        None => list[n].section.to_owned(),
    };

    // ---- relocations, sorted by the address they apply to
    let mut relocations = Vec::new();
    for s in sections
        .iter()
        .filter(|s| s.kind == SHT_RELA && s.flags & SHF_ALLOC == 0)
    {
        let applies_to = &sections[s.info as usize];
        if applies_to.flags & SHF_ALLOC == 0 {
            continue;
        }
        // The release strips the unwind tables, so what they refer to does not count.
        if applies_to.name == ".eh_frame" || applies_to.name == ".gcc_except_table" {
            continue;
        }
        for o in (s.offset..s.offset + s.size).step_by(24) {
            let o = o as usize;
            let info = b.u64(o + 8);
            if info as u32 == 0 {
                continue;
            }
            let (place, symbol) = (b.u64(o), &symbols[(info >> 32) as usize]);
            let target = if !symbol.is_defined() || symbol.kind == STT_TLS {
                Target::Nothing
            } else if symbol.kind != STT_SECTION
                || packed(&sections[usize::from(symbol.section)].name) == Packed::No
            {
                Target::Address(symbol.value) // in the latter case nothing in that output section moves
            } else {
                let e = exact.targets.partition_point(|t| t.0 < place);
                exact
                    .targets
                    .get(e)
                    .filter(|t| t.0 == place)
                    .map_or(Target::Unknown, |t| Target::Address(t.1))
            };
            relocations.push(Relocation {
                place,
                kind: info as u32,
                symbol: (info >> 32) as u32,
                addend: b.i64(o + 16),
                target,
            });
        }
    }
    relocations.sort_by_key(|r| r.place);

    // ---- markers, and the blocks of the functions that hold them
    // A record is {marker u64, `false` side u64, id u32, 0 u32}, in .bun_features.
    let mut markers: Vec<(u64, Marker)> = Vec::new();
    if let Some(records) = section(".bun_features") {
        for o in (records.offset..records.offset + records.size).step_by(24) {
            let o = o as usize;
            let (site, marker) = (
                b.u64(o),
                Marker {
                    skip: b.u64(o + 8),
                    id: b.u32(o + 16),
                },
            );
            match markers.iter_mut().find(|m| m.0 == site) {
                _ if site == 0 => {} // the linker dropped the function
                Some(known) => known.1 = marker,
                None => markers.push((site, marker)),
            }
        }
    }
    let mut does_not_return = HashSet::new();
    if let (Some(rela_plt), Some(dynsym), Some(plt)) =
        (section(".rela.plt"), section(".dynsym"), plt)
    {
        let names = sections[dynsym.link as usize].offset as usize;
        for i in 0..rela_plt.size / 24 {
            let symbol = b.u64((rela_plt.offset + i * 24 + 8) as usize) >> 32;
            let name = b.cstr(names + b.u32((dynsym.offset + symbol * 24) as usize) as usize);
            if NO_RETURN.iter().any(|n| n.as_bytes() == name) {
                // The entries, of 16 bytes, follow a header of 16 (x86-64) or 32 bytes.
                does_not_return
                    .insert(plt.addr + if arch == Arch::Arm64 { 32 } else { 16 } + 16 * i);
            }
        }
    }
    let mut elf = Elf {
        arch,
        nodes,
        area,
        symbols,
        relocations,
        blocks: Blocks::default(),
    };
    elf.blocks = {
        let is_code = |n: usize| elf.area[n] == Packed::Code;
        let taken_by = |start: u64, end: u64| {
            let mut tables: Vec<u64> = Vec::new();
            for r in elf
                .relocations_in(start, end)
                .iter()
                .filter(|r| r.kind == arm64::ADD_ABS_LO12_NC)
            {
                let symbol = &elf.symbols[r.symbol as usize];
                let at = symbol.value.wrapping_add_signed(r.addend);
                if symbol.is_defined() && !tables.contains(&at) {
                    tables.push(at);
                }
            }
            let holder = |at: u64| elf.nodes.find(at).filter(|&t| elf.area[t] == Packed::Data);
            tables
                .into_iter()
                .filter_map(|at| Some((at, elf.nodes.end(holder(at)?))))
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
            nodes: &elf.nodes,
            is_code: &is_code,
            does_not_return: &does_not_return,
            constants_taken_by: &taken_by,
        }
        .split()?
    };
    let elf = elf;
    let (nodes, area, symbols, blocks) = (&elf.nodes, &elf.area, &elf.symbols, &elf.blocks);
    let n_nodes = nodes.len();

    // ---- rows of tables that belong to features
    let mut feature_rows: Vec<FeatureRow> = Vec::new();
    for (feature, row) in FEATURES
        .iter()
        .flat_map(|f| f.rows.iter().map(move |row| (f, row)))
    {
        let is_table = |n: &usize| {
            names_of[*n]
                .iter()
                .any(|&name| matches(row.table, name_at(name)))
        };
        let found: Vec<usize> = (0..n_nodes).filter(is_table).collect();
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
                    let o = file_offset(a);
                    if b.u64(o + 8) == key.len() as u64 + 1
                        && b.u64(o) != 0
                        && b.0[file_offset(b.u64(o))..].starts_with(key.as_bytes())
                    {
                        add(a);
                    }
                }
            }
            Select::PointsAt { itanium, .. } => {
                for r in elf.relocations_in(start, end) {
                    if matches(itanium, name_at(symbols[r.symbol as usize].name)) {
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

    // ---- what is live
    let mut roots = vec![b.u64(0x18)]; // the entry point
    // Everything that is neither code nor constants stays, and so do the pools the linker merged and the builtin JS.
    let stays = |n: &usize| {
        area[*n] == Packed::No
            || list[*n].file == "<internal>"
            || list[*n].output == ".bun_builtins"
    };
    roots.extend((0..n_nodes).filter(stays).map(|n| nodes.addr[n]));
    let dynsym = section(".dynsym").ok_or("no .dynsym")?; // exported: N-API and friends
    let dynamic_symbols = || (dynsym.addr + 24..dynsym.addr + dynsym.size).step_by(24);
    roots.extend(
        dynamic_symbols()
            .map(file_offset)
            .filter(|&o| b.u16(o + 6) != 0)
            .map(|o| b.u64(o + 8)),
    );

    // With nothing excluded the graph should reach everything the linker kept. What it does not reach is kept regardless.
    let as_linked = mark(&elf, &roots, Excluded::BothSides)?;
    let unexplained: Vec<usize> = (0..n_nodes).filter(|&n| !as_linked.node[n]).collect();

    let reconstruction = if want_blocks {
        let mut ids: Vec<u32> = Vec::new();
        for (_, m) in &markers {
            if !ids.contains(&m.id) {
                ids.push(m.id);
            }
        }
        let every_root: Vec<u64> = roots
            .iter()
            .copied()
            .chain(unexplained.iter().map(|&n| nodes.addr[n]))
            .collect();
        let mut combinations = Vec::new();
        for bits in 0..1u32 << ids.len() {
            let excluded: Vec<u32> = ids
                .iter()
                .enumerate()
                .filter(|(i, _)| bits & (1 << i) != 0)
                .map(|(_, &id)| id)
                .collect();
            let live = mark(&elf, &every_root, Excluded::Features(&excluded))?.block;
            combinations.push((excluded, live));
        }
        Some(Reconstruction {
            functions: blocks
                .of
                .iter()
                .map(|&(n, of)| (name_of(n), nodes.addr[n], nodes.end(n), of))
                .collect(),
            blocks: blocks.all.iter().map(|b| (b.start, b.end)).collect(),
            markers: markers.clone(),
            combinations,
        })
    } else {
        None
    };

    // ---- units
    let mut parts = Parts::default();
    let in_table = |n: usize| (area[n] != Packed::No).then_some(list[n].align);
    let Units {
        first_of_node: first_unit_of,
        of_block: unit_of_block,
    } = parts.add_nodes(nodes, blocks, &feature_rows, &in_table);

    // The unit an address belongs to, as the target of a reference. None: it is in no unit, so it stays and does not move.
    let unit_for = |a: u64| -> Option<u32> {
        // One past the end of a section still means that section.
        let n = nodes
            .find(a)
            .or_else(|| nodes.at_or_below(a).filter(|&n| a == nodes.end(n)))?;
        match blocks.of(n) {
            _ if area[n] == Packed::No => None,
            None => first_unit_of[n],
            Some(of) => Some(unit_of_block[blocks.at(of, a)]),
        }
    };
    for &root in roots.iter().chain(
        &unexplained
            .iter()
            .map(|&n| nodes.addr[n])
            .collect::<Vec<_>>(),
    ) {
        if let Some(u) = unit_for(root) {
            parts.units[u as usize].flags |= ROOT;
        }
    }
    // The same for blocks that no control flow reaches: the padding between blocks, mostly.
    for i in (0..blocks.all.len()).filter(|&i| !as_linked.block[i]) {
        parts.units[unit_of_block[i] as usize].flags |= ROOT;
    }

    // ---- fixups
    let is_in_unit = |a: u64| nodes.find(a).is_some_and(|n| area[n] != Packed::No);
    let mut add = |sort: &'static str, place: u64, form: Form, target: Option<u32>, extra: u16| {
        // If neither end can move there is nothing to do, and no edge either.
        if target.is_some() || (is_in_unit(place) && !matches!(form, Form::Abs64 | Form::Abs32)) {
            parts.add_fixup(sort, place, form, target, extra);
        }
    };
    let page_of = |a: u64| a & !0xfff;

    for r in &elf.relocations {
        let (p, symbol) = (r.place, &symbols[r.symbol as usize]);
        let (s, a, defined) = (symbol.value, r.addend, symbol.is_defined());
        let t = s.wrapping_add_signed(a);
        let o = file_offset(p);
        let target = || match r.target {
            Target::Unknown => Err(format!(
                "cannot tell what the relocation at {p:x} refers to"
            )),
            Target::Nothing => Ok(None),
            Target::Address(address) => Ok(unit_for(address)),
        };
        // `p + 4 + the 32 bits at o`
        let next_plus = |o: usize, p: u64| (p + 4).wrapping_add_signed(b.i32(o).into());

        if arch == Arch::Arm64 {
            let w = b.u32(o);
            let is_adrp = w & 0x9f00_0000 == 0x9000_0000;
            let count = ((((w >> 5) & 0x7_ffff) << 2) | ((w >> 29) & 3)) << 11;
            let adrp_page =
                page_of(p).wrapping_add_signed(i64::from(count.cast_signed() >> 11) * 4096);
            let is_add = w & 0xffc0_0000 == 0x9100_0000;
            let is_load_or_store = w & 0x3b00_0000 == 0x3900_0000;
            let log2_scale = if is_add {
                0
            } else if w & 0x0400_0000 != 0 && w & 0x0080_0000 != 0 {
                4
            } else {
                (w >> 30) as u16
            };
            let low12 = u64::from((w >> 10) & 0xfff) << log2_scale;
            // Of what stays, an `adrp` needs no more than the page.
            let low_bits = |unit: Option<u32>| if unit.is_some() { (t % 4096) as u16 } else { 0 };
            match r.kind {
                arm64::ABS64 => {
                    if !defined || symbol.kind == STT_TLS {
                        continue;
                    }
                    if b.u64(o) != t {
                        fail!("unexpected 64-bit address at {p:x}");
                    }
                    add("absolute 64", p, Form::Abs64, target()?, 0);
                }
                arm64::ABS32 => {
                    if !defined {
                        continue;
                    }
                    if b.u32(o) != t as u32 {
                        fail!("unexpected 32-bit address at {p:x}");
                    }
                    add("absolute 32", p, Form::Abs32, target()?, 0);
                }
                arm64::PREL32 => {
                    if i64::from(b.i32(o)) != t.wrapping_sub(p).cast_signed() {
                        fail!("unexpected 32-bit distance at {p:x}");
                    }
                    add("pc-relative", p, Form::Rel32, target()?, 0);
                }
                arm64::PREL64 => add("pc-relative 64", p, Form::Rel64, target()?, 0),
                arm64::CALL26 | arm64::JUMP26 => {
                    if w & 0x7c00_0000 != 0x1400_0000 {
                        fail!("no branch at {p:x}");
                    }
                    let used = p.wrapping_add_signed(i64::from((w << 6).cast_signed() >> 6) * 4);
                    if defined && used == t {
                        add("branch", p, Form::Branch26, target()?, 0);
                    } else if within(plt, used) {
                        add("branch, to .plt", p, Form::Branch26, None, 0);
                    } else if defined || used != p + 4 {
                        // (undefined weak: on to the next instruction)
                        let name = String::from_utf8_lossy(name_at(symbol.name));
                        fail!("the branch at {p:x} goes to {used:x}, not to {name}");
                    }
                }
                arm64::ADR_PREL_PG_HI21 | arm64::ADR_PREL_PG_HI21_NC => {
                    if !is_adrp || (defined && adrp_page != page_of(t)) {
                        fail!("unexpected instruction for a page at {p:x}");
                    }
                    let unit = if defined { target()? } else { None };
                    add("page", p, Form::Page21, unit, low_bits(unit));
                }
                arm64::ADD_ABS_LO12_NC
                | arm64::LDST8_ABS_LO12_NC
                | arm64::LDST16_ABS_LO12_NC
                | arm64::LDST32_ABS_LO12_NC
                | arm64::LDST64_ABS_LO12_NC
                | arm64::LDST128_ABS_LO12_NC => {
                    if !defined {
                        continue;
                    }
                    if (!is_add && !is_load_or_store) || low12 != t % 4096 {
                        fail!("unexpected instruction for an offset in a page at {p:x}");
                    }
                    // else it stays what it is
                    if let Some(unit) = target()? {
                        add(
                            "offset in a page",
                            p,
                            Form::PageOff12,
                            Some(unit),
                            log2_scale,
                        );
                    }
                }
                arm64::ADR_GOT_PAGE => {
                    // The linker turns a load from the GOT into the address itself where it can.
                    if !is_adrp {
                        fail!("unexpected instruction for a page of the got at {p:x}");
                    }
                    let is_in_got = got.is_some_and(|g| {
                        adrp_page >= page_of(g.addr) && adrp_page <= page_of(g.addr + g.size - 1)
                    });
                    if is_in_got && adrp_page != page_of(t) {
                        add("page of a got slot", p, Form::Page21, None, 0);
                        if defined {
                            add("what a got slot holds", p, Form::None, target()?, 0); // the slot itself keeps nothing alive
                        }
                    } else if defined && adrp_page == page_of(t) {
                        let unit = target()?;
                        add(
                            "page of a got slot, relaxed to the symbol",
                            p,
                            Form::Page21,
                            unit,
                            low_bits(unit),
                        );
                    } else {
                        fail!("unrecognised GOT access at {p:x}");
                    }
                }
                arm64::LD64_GOT_LO12_NC => {
                    if is_add && defined && low12 == t % 4096 {
                        if let Some(unit) = target()? {
                            add(
                                "got slot, relaxed to the symbol",
                                p,
                                Form::PageOff12,
                                Some(unit),
                                0,
                            );
                        }
                    } else if !is_load_or_store {
                        fail!("unrecognised GOT access at {p:x}");
                    }
                }
                // An offset in the thread-local block, unless it still goes through the GOT.
                arm64::TLSIE_ADR_GOTTPREL_PAGE21 if is_adrp => {
                    add("thread-local, through the got", p, Form::Page21, None, 0)
                }
                kind if arm64::TLS.contains(&kind) => {}
                kind => fail!("relocation type {kind} at {p:x}"),
            }
            continue;
        }

        match r.kind {
            x64::R_64 => {
                if !defined || symbol.kind == STT_TLS {
                    continue;
                }
                if b.u64(o) != t {
                    fail!("unexpected 64-bit address at {p:x}");
                }
                add("absolute 64", p, Form::Abs64, target()?, 0);
            }
            x64::R_32 | x64::R_32S => {
                if !defined {
                    continue;
                }
                if b.u32(o) != t as u32 {
                    fail!("unexpected 32-bit address at {p:x}");
                }
                add("absolute 32", p, Form::Abs32, target()?, 0);
            }
            x64::PC32 | x64::PLT32 => {
                // the symbol address the linker used
                let used = p.wrapping_add_signed(i64::from(b.i32(o)) - a);
                if defined && used == s {
                    add("pc-relative", p, Form::Rel32, target()?, 0);
                } else if within(plt, used) {
                    add("pc-relative, to .plt", p, Form::Rel32, None, 0);
                } else if !defined && used == 0 {
                    add("pc-relative, undefined weak", p, Form::Rel32, None, 0);
                }
                // else: rewritten together with its thread-local sequence, and no longer an address
            }
            x64::GOTPCREL | x64::GOTPCRELX | x64::REX_GOTPCRELX => {
                // The linker turns a load from the GOT into the address itself where it can.
                if a == -4 && next_plus(o, p) == s {
                    add("got, relaxed to pc-relative", p, Form::Rel32, target()?, 0);
                } else if b.u8(o - 2) == 0xe9 && next_plus(o - 1, p - 1) == s {
                    add("got, relaxed to jmp", p - 1, Form::Rel32, target()?, 0);
                } else if u64::from(b.u32(o)) == s {
                    add("got, relaxed to absolute", p, Form::Abs32, target()?, 0);
                } else if within(got, next_plus(o, p)) || within(got_plt, next_plus(o, p)) {
                    add("got slot", p, Form::Rel32, None, 0);
                    if defined {
                        add("what a got slot holds", p, Form::None, target()?, 0); // the slot itself keeps nothing alive
                    }
                } else {
                    fail!("unrecognised GOT access at {p:x}");
                }
            }
            x64::GOTTPOFF | x64::TLSGD | x64::TLSLD => {
                if within(got, next_plus(o, p)) {
                    add("thread-local, through the got", p, Form::Rel32, None, 0);
                }
            }
            x64::TPOFF32 | x64::DTPOFF32 => {} // an offset in the thread-local block
            x64::PC64 => add("pc-relative 64", p, Form::Rel64, target()?, 0),
            kind => fail!("relocation type {kind} at {p:x}"),
        }
    }

    // A reference by offset into a function that is split may mean one of several blocks: `references` names them all.
    for &(n, _) in &blocks.of {
        let inside = |a: u64| a >= nodes.addr[n] && a < nodes.end(n);
        for r in &elf.relocations {
            let Target::Address(address) = r.target else {
                continue;
            };
            if symbols[r.symbol as usize].kind != STT_SECTION || !inside(address) {
                continue;
            }
            let already = unit_for(address);
            elf.references(r.place, r.place + 1, &mut |a| {
                if unit_for(a) != already {
                    add(
                        "one more block it may mean",
                        r.place,
                        Form::None,
                        unit_for(a),
                        0,
                    );
                }
            })?;
        }
    }

    // What the linker made has no relocation records.
    if let Some(got) = got {
        for a in (got.addr..got.addr + got.size).step_by(8) {
            add(
                "got entry",
                a,
                Form::Abs64Weak,
                unit_for(b.u64(file_offset(a))),
                0,
            );
        }
    }
    for a in dynamic_symbols() {
        let o = file_offset(a);
        if b.u16(o + 6) != 0 && b.u16(o + 6) < 0xff00 && b.u8(o + 4) & 15 != STT_TLS {
            add(
                "dynamic symbol",
                a + 8,
                Form::Abs64Weak,
                unit_for(b.u64(o + 8)),
                0,
            );
        }
    }
    for i in 0..usize::from(b.u16(0x38)) {
        let o = b.u64(0x20) as usize + i * 56;
        if b.u32(o) == PT_LOAD && b.u64(o + 8) == 0 {
            add(
                "entry point",
                b.u64(o + 16) + 0x18,
                Form::Abs64,
                unit_for(b.u64(0x18)),
                0,
            );
        }
    }

    // ---- the table
    let bounds = |which: Packed| {
        let mut members = (0..n_nodes).filter(|&n| area[n] == which);
        let first = members.next().expect("the area has members");
        (
            nodes.addr[first],
            nodes.end(members.next_back().unwrap_or(first)),
        )
    };
    let ((data_low, data_high), (code_low, code_high)) =
        (bounds(Packed::Data), bounds(Packed::Code));
    let trap: &[u8] = if arch == Arch::Arm64 {
        &[0x20, 0x00, 0x20, 0xd4]
    } else {
        &[0xcc]
    }; // brk #1, int3
    let mut patches = Vec::new();
    for &(site, marker) in &markers {
        patches.push(marker_patch(arch, b, file_offset(site), site, marker)?);
    }
    let bytes_of = |list: &[usize]| list.iter().map(|&n| nodes.size[n]).sum::<u64>();
    let mut outputs: Vec<&str> = Vec::new();
    for &n in &unexplained {
        if !outputs.contains(&list[n].output) {
            outputs.push(list[n].output);
        }
    }
    let report = format!(
        "{}sections {n_nodes}, relocations {}, markers {} in {} functions ({} blocks), rows of features {}\n\
         kept by the linker but not reached by the graph: {} sections, {} bytes ({})\n\
         units {}, flow edges {}, fixups {}, patches {}\n{}\n",
        exact.report,
        elf.relocations.len(),
        markers.len(),
        blocks.of.len(),
        blocks.all.len(),
        feature_rows.len(),
        unexplained.len(),
        bytes_of(&unexplained),
        outputs.join(", "),
        parts.units.len(),
        parts.flows.len(),
        parts.fixups.len(),
        patches.len(),
        parts.sorts(),
    );
    let table = Table {
        format: Format {
            container: Container::Elf,
            arch,
        },
        features: FEATURES
            .iter()
            .map(|f| Feature {
                id: f.id,
                name: f.name.as_bytes().into(),
            })
            .collect(),
        areas: vec![
            Area {
                low: data_low,
                high: data_high,
                towards_high: false,
                fill: [0].into(),
            },
            Area {
                low: code_low,
                high: code_high,
                towards_high: true,
                fill: trap.into(),
            },
        ],
        code: vec![(code_low, code_high)],
        patches,
        units: parts.units,
        flows: parts.flows,
        fixups: parts.fixups,
    }
    .canonical();
    Ok((Made { table, report }, reconstruction))
}

/// `linked` without what `--emit-relocs` added, and without the records of the markers. The sections keep their numbers.
pub(super) fn without_relocations(linked: &[u8]) -> Vec<u8> {
    let b = Data(linked);
    let sections = sections_of(b);
    let is_in_file = |s: &&Section| s.flags & SHF_ALLOC == 0 && s.kind != SHT_NOBITS && s.size != 0;
    let is_dropped =
        |s: &Section| s.flags & SHF_ALLOC == 0 && (s.kind == SHT_RELA || s.name == ".bun_features");

    // What is not loaded follows what is.
    let mut rest: Vec<(usize, &Section)> = sections
        .iter()
        .enumerate()
        .filter(|(_, s)| is_in_file(s))
        .collect();
    rest.sort_by_key(|(_, s)| s.offset);
    let shoff = b.u64(0x28) as usize;
    let mut headers = linked[shoff..shoff + sections.len() * 64].to_vec();
    let mut out = linked[..rest.first().map_or(shoff, |(_, s)| s.offset as usize)].to_vec();
    for (i, s) in rest {
        let header = &mut headers[i * 64..(i + 1) * 64];
        if is_dropped(s) {
            header.fill(0);
            continue;
        }
        out.resize(out.len().next_multiple_of(s.align.max(1) as usize), 0);
        header[24..32].copy_from_slice(&(out.len() as u64).to_le_bytes());
        out.extend_from_slice(&linked[s.offset as usize..(s.offset + s.size) as usize]);
    }
    out.resize(out.len().next_multiple_of(8), 0);
    let new_shoff = out.len() as u64;
    out.extend_from_slice(&headers);
    out[0x28..0x30].copy_from_slice(&new_shoff.to_le_bytes());
    out
}
