//! PE, x86-64, linked by lld-link.
//!
//! The link has to be made with `/lldmap`, `/lldsavetemps:prelink`, `/verbose` and `/demangle:no`: the map has to name
//! symbols as the object files do. Addresses here, and in the table, are relative to the image base.
//!
//! A linked PE keeps only the relocations the loader needs, and lld-link cannot be asked to keep the rest. The object files
//! have them. What is missing is where each section of each object ended up: the map lists CHUNKS as file:(section name),
//! and in COFF nearly all of them are called .text or .rdata.
//!
//! So the link is replayed. A section that defines a symbol the map lists under the same file has a known address. For a
//! relocation in such a section, the image holds the final address of the target and the object holds the addend, and the
//! difference is the final address of the section the target is in, exactly, even if it has no name (a jump table) and
//! even if the addend points outside of it. That section is then known too. Whatever is live is reached this way.
//!
//! Only .text is packed, for now: towards its start, so that the file can hold fewer bytes of it. Its virtual size stays,
//! and with it the address of everything else. Constants (.rdata) can die, and are blanked, but stay in place.

use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;
use std::rc::Rc;

use super::blocks::{Functions, Marker, listing, marker_patch};
use super::features::{FEATURES, Select, matches};
use super::live::{Blocks, Excluded, Image, mark};
use super::{Data, FeatureRow, Link, Made, Nodes, Parts, Result, Units, fail, read};
use crate::executable::fixed_name;
use crate::table::{Arch, Area, Container, Feature, Form, Format, ROOT, Table};

/// `IMAGE_REL_AMD64_*`
mod reloc {
    pub(super) const ADDR64: u16 = 1;
    pub(super) const ADDR32NB: u16 = 3;
    pub(super) const REL32: u16 = 4;
    pub(super) const REL32_5: u16 = 9;
    pub(super) const SECTION: u16 = 10;
    pub(super) const SECREL: u16 = 11;
}
const IMAGE_SCN_LNK_COMDAT: u32 = 0x1000;
const IMAGE_SCN_LNK_NRELOC_OVFL: u32 = 0x0100_0000;
const IMAGE_DIRECTORY_ENTRY_EXPORT: usize = 0;
const IMAGE_DIRECTORY_ENTRY_EXCEPTION: usize = 3;
const IMAGE_DIRECTORY_ENTRY_BASERELOC: usize = 5;
const IMAGE_REL_BASED_DIR64: u16 = 10;

// ---------------------------------------------------------------- the image

struct ImageSection<'a> {
    name: &'a [u8],
    size: u64,
    rva: u64,
    raw_size: u64,
    raw: u64,
}

struct Pe<'a> {
    b: Data<'a>,
    optional: usize,
    image_base: u64,
    sections: Vec<ImageSection<'a>>,
}

impl<'a> Pe<'a> {
    fn open(bytes: &'a [u8]) -> Self {
        let b = Data(bytes);
        let pe = b.u32(0x3c) as usize;
        let optional = pe + 24;
        let first = optional + usize::from(b.u16(pe + 20));
        let sections = (0..usize::from(b.u16(pe + 6)))
            .map(|i| first + i * 40)
            .map(|h| ImageSection {
                name: fixed_name(&bytes[h..h + 8]),
                size: b.u32(h + 8).into(),
                rva: b.u32(h + 12).into(),
                raw_size: b.u32(h + 16).into(),
                raw: b.u32(h + 20).into(),
            })
            .collect();
        Self {
            b,
            optional,
            image_base: b.u64(optional + 24),
            sections,
        }
    }

    fn try_file_offset(&self, rva: u64) -> Option<usize> {
        if rva < self.sections[0].rva {
            return Some(rva as usize); // the headers
        }
        let s = self
            .sections
            .iter()
            .find(|s| rva >= s.rva && rva < s.rva + s.raw_size)?;
        Some((s.raw + (rva - s.rva)) as usize)
    }

    fn file_offset(&self, rva: u64) -> usize {
        self.try_file_offset(rva)
            .unwrap_or_else(|| panic!("no file bytes at {rva:x}"))
    }

    /// {where in the file, size}
    fn directory(&self, index: usize) -> (usize, usize) {
        let at = self.optional + 112 + index * 8;
        (
            self.file_offset(self.b.u32(at).into()),
            self.b.u32(at + 4) as usize,
        )
    }

    /// The function table: {begin, end, unwind info}. The linker sorts it, so an object's entries are not where the map says
    /// its .pdata went.
    fn function_table(&self) -> impl Iterator<Item = (u64, u64)> {
        let (at, size) = self.directory(IMAGE_DIRECTORY_ENTRY_EXCEPTION);
        (at..at + size)
            .step_by(12)
            .map(|o| (self.b.u32(o).into(), self.b.u32(o + 8).into()))
    }
}

// ---------------------------------------------------------------- the map

struct Chunk<'m> {
    rva: u64,
    size: u64,
    align: u64,
    file: Rc<[u8]>,
    output: &'m [u8],
    names: Vec<&'m [u8]>,
    /// The linker may drop it if nothing refers to it. Anything else, it keeps.
    is_comdat: bool,
    /// Which section of its file it is could not be told, so its relocations are not known.
    is_unidentified: bool,
}

#[derive(Default)]
struct Map<'m> {
    /// Sorted by address.
    chunks: Vec<Chunk<'m>>,
    /// Listed under a chunk of that file.
    symbols_of_file: HashMap<Rc<[u8]>, HashMap<&'m [u8], Vec<u64>>>,
    symbols_by_name: HashMap<&'m [u8], Vec<u64>>,
}

fn lines(text: &[u8]) -> impl Iterator<Item = &[u8]> {
    text.split(|&b| b == b'\n')
        .map(|line| line.strip_suffix(b"\r").unwrap_or(line))
}

/// A path as lld-link prints it, with each backslash doubled.
fn unescaped(path: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(path.len());
    let mut rest = path;
    while let Some((&first, after)) = rest.split_first() {
        out.push(first);
        rest = if first == b'\\' {
            after.strip_prefix(b"\\").unwrap_or(after)
        } else {
            after
        };
    }
    out
}

fn push_new<T: PartialEq>(list: &mut Vec<T>, value: T) {
    if !list.contains(&value) {
        list.push(value);
    }
}

fn read_map(text: &[u8]) -> Map<'_> {
    let mut map = Map::default();
    let mut files: HashMap<&[u8], Rc<[u8]>> = HashMap::new();
    let mut output: &[u8] = b"";
    // The chunk whose symbols follow: its file, and where it is in `chunks` unless it is empty.
    let mut current: Option<(Rc<[u8]>, Option<usize>)> = None;
    let hex8 = |field: &[u8]| {
        u64::from_str_radix(core::str::from_utf8(field).ok()?, 16)
            .ok()
            .filter(|_| field.len() == 8)
    };
    for line in lines(text) {
        // `address size  align  text`, with the text indented by its level: output section, chunk, symbol
        let Some((address, size)) = line
            .get(..18)
            .filter(|l| l[8] == b' ' && l[17] == b' ')
            .and_then(|l| Some((hex8(&l[..8])?, hex8(&l[9..17])?)))
        else {
            continue;
        };
        let rest = &line[17..];
        let rest = &rest[rest.iter().take_while(|&&b| b == b' ').count()..];
        let digits = rest.iter().take_while(|b| b.is_ascii_digit()).count();
        let (Some(align), Some(text)) = (
            core::str::from_utf8(&rest[..digits])
                .ok()
                .and_then(|d| d.parse::<u64>().ok()),
            rest[digits..].strip_prefix(b" "),
        ) else {
            continue;
        };
        let indent = text.iter().take_while(|&&b| b == b' ').count();
        let text = &text[indent..];
        if indent == 0 {
            output = text;
        } else if indent == 8 {
            // `file:(section)`
            let input = text.strip_suffix(b")").and_then(|t| {
                (0..t.len().saturating_sub(1))
                    .rev()
                    .find(|&i| &t[i..i + 2] == b":(")
                    .map(|i| &t[..i])
            });
            current = input.map(|file| {
                let file = Rc::clone(files.entry(file).or_insert_with(|| unescaped(file).into()));
                let index = (size != 0).then(|| {
                    let (names, file) = (Vec::new(), Rc::clone(&file));
                    map.chunks.push(Chunk {
                        rva: address,
                        size,
                        align: align.max(1),
                        file,
                        output,
                        names,
                        is_comdat: false,
                        is_unidentified: false,
                    });
                    map.chunks.len() - 1
                });
                (file, index)
            });
        } else if let Some((file, index)) = &current {
            if let Some(index) = *index {
                push_new(&mut map.chunks[index].names, text);
            }
            push_new(
                map.symbols_of_file
                    .entry(Rc::clone(file))
                    .or_default()
                    .entry(text)
                    .or_default(),
                address,
            );
            push_new(map.symbols_by_name.entry(text).or_default(), address);
        }
    }
    map.chunks.sort_by_key(|c| c.rva);
    map
}

impl Map<'_> {
    fn chunk_at(&self, rva: i64) -> Option<usize> {
        let rva = u64::try_from(rva).ok()?;
        let i = self
            .chunks
            .partition_point(|c| c.rva <= rva)
            .checked_sub(1)?;
        (rva < self.chunks[i].rva + self.chunks[i].size).then_some(i)
    }

    fn chunk_starting_at(&self, rva: i64) -> Option<usize> {
        self.chunk_at(rva)
            .filter(|&i| self.chunks[i].rva.cast_signed() == rva)
    }
}

// ---------------------------------------------------------------- COFF objects

struct Bytes {
    file: Rc<[u8]>,
    range: core::ops::Range<usize>,
}

/// The map names a member of an archive by the name it has inside the archive, without the archive. The log of the link
/// names every archive that was read.
fn members_of_archives(printed: &[u8]) -> HashMap<Vec<u8>, Bytes> {
    let mut members = HashMap::new();
    for line in lines(printed) {
        let Some(path) = line.strip_prefix(b"lld-link: Reading ") else {
            continue;
        };
        let lower = path.to_ascii_lowercase();
        if !lower.ends_with(b".lib") && !lower.ends_with(b".rlib") {
            continue;
        }
        let Ok(file) = std::fs::read(String::from_utf8_lossy(&unescaped(path)).as_ref()) else {
            continue;
        };
        let ar: Rc<[u8]> = file.into();
        let mut long_names = 0..0;
        let mut at = 8;
        while at + 60 <= ar.len() {
            let id = ar[at..at + 16].trim_ascii_end();
            let Some(size) = core::str::from_utf8(&ar[at + 48..at + 58])
                .ok()
                .and_then(|s| s.trim().parse::<usize>().ok())
            else {
                break;
            };
            let body = at + 60;
            if id == b"//" {
                long_names = body..body + size;
            } else if id != b"/" {
                let offset = id
                    .strip_prefix(b"/")
                    .filter(|n| !n.is_empty())
                    .and_then(|n| core::str::from_utf8(n).ok()?.parse::<usize>().ok());
                let name = match offset {
                    Some(offset) => {
                        let names = &ar[long_names.clone()][offset..];
                        &names[..names
                            .iter()
                            .position(|&b| b == 0 || b == b'\n')
                            .unwrap_or(names.len())]
                    }
                    None => id,
                };
                let name = name.strip_suffix(b"/").unwrap_or(name).to_vec();
                members.entry(name).or_insert_with(|| Bytes {
                    file: Rc::clone(&ar),
                    range: body..body + size,
                });
            }
            at = body + size + (size & 1);
        }
    }
    members
}

struct ObjectSection<'o> {
    name: &'o [u8],
    size: u64,
    raw: usize,
    relocations: usize,
    relocation_count: usize,
    flags: u32,
}

impl ObjectSection<'_> {
    fn is_function_table(&self) -> bool {
        self.name == b".pdata" || self.name.starts_with(b".pdata$")
    }
}

#[derive(Clone, Copy)]
struct ObjectSymbol<'o> {
    name: &'o [u8],
    value: i64,
    /// From 1. 0 or less: not defined here.
    section: i32,
}

struct Parsed<'o> {
    sections: Vec<ObjectSection<'o>>,
    /// By index. None: an auxiliary record.
    symbols: Vec<Option<ObjectSymbol<'o>>>,
}

fn parse(bytes: &[u8]) -> Option<Parsed<'_>> {
    let b = Data(bytes);
    // "bigobj": more than 65279 sections, so section numbers are 32 bits wide
    let is_big = b.u16(0) == 0 && b.u16(2) == 0xffff && b.u16(4) >= 2;
    if !is_big && b.u16(0) != 0x8664 {
        return None;
    }
    let (section_count, symbol_table, symbol_count, headers, entry) = if is_big {
        (
            b.u32(44) as usize,
            b.u32(48) as usize,
            b.u32(52) as usize,
            56,
            20,
        )
    } else {
        (
            usize::from(b.u16(2)),
            b.u32(8) as usize,
            b.u32(12) as usize,
            20 + usize::from(b.u16(16)),
            18,
        )
    };
    let strings = symbol_table + symbol_count * entry;
    let sections = (0..section_count)
        .map(|i| {
            let h = headers + i * 40;
            let mut name = fixed_name(&bytes[h..h + 8]);
            if let Some(offset) = name
                .strip_prefix(b"/")
                .and_then(|n| core::str::from_utf8(n).ok()?.parse::<usize>().ok())
            {
                name = b.cstr(strings + offset);
            }
            let (mut relocations, mut relocation_count, flags) = (
                b.u32(h + 24) as usize,
                usize::from(b.u16(h + 32)),
                b.u32(h + 36),
            );
            if flags & IMAGE_SCN_LNK_NRELOC_OVFL != 0 && relocation_count == 0xffff {
                relocation_count = b.u32(relocations) as usize - 1; // the first entry holds the real count
                relocations += 10;
            }
            ObjectSection {
                name,
                size: b.u32(h + 16).into(),
                raw: b.u32(h + 20) as usize,
                relocations,
                relocation_count,
                flags,
            }
        })
        .collect();
    let mut symbols = vec![None; symbol_count];
    let mut i = 0;
    while i < symbol_count {
        let at = symbol_table + i * entry;
        symbols[i] = Some(ObjectSymbol {
            name: if b.u32(at) != 0 {
                fixed_name(&bytes[at..at + 8])
            } else {
                b.cstr(strings + b.u32(at + 4) as usize)
            },
            value: b.u32(at + 8).into(),
            section: if is_big {
                b.i32(at + 12)
            } else {
                i32::from(b.u16(at + 12).cast_signed())
            },
        });
        i += 1 + usize::from(b.u8(at + entry - 1)); // auxiliary records
    }
    Some(Parsed { sections, symbols })
}

// ---------------------------------------------------------------- replay

struct Record {
    place: u64,
    kind: u16,
    /// Where the chunk referred to starts.
    chunk: Option<u64>,
    /// The address referred to.
    target: i64,
}

struct Replayed {
    records: Vec<Record>,
    /// {index of a chunk, whether its section is a COMDAT}
    comdat: Vec<(usize, bool)>,
    /// `__attribute__((used))` and the like reach the linker as /INCLUDE directives in the object files.
    included: HashSet<Vec<u8>>,
    /// The chunks whose section is known, by their addresses.
    identified: HashSet<u64>,
    report: String,
}

/// What is known about the sections of one object.
struct Known<'a, 'm> {
    map: &'a Map<'m>,
    file: &'a [u8],
    sizes: Vec<u64>,
    /// Final address of section number i. Negative: not known.
    address: Vec<i64>,
    /// Sections whose relocations are still to be read.
    work: Vec<usize>,
}

impl Known<'_, '_> {
    fn learn(&mut self, section: usize, rva: i64, identified: &mut HashSet<u64>) -> Result<()> {
        if self.address[section] == rva {
            return Ok(());
        }
        if self.address[section] >= 0 {
            fail!(
                "{}: section {section} is at {:x} and at {rva:x}",
                String::from_utf8_lossy(self.file),
                self.address[section]
            );
        }
        self.address[section] = rva;
        // It is a source of relocations only if the map says that this file provided what is there. A COMDAT section that
        // lost to another file's copy, or was folded into one, resolves to an address too, but the bytes there are not its
        // own. Of two identical sections of one file that were folded, either will do.
        let Some(chunk) = self.map.chunk_starting_at(rva).map(|i| &self.map.chunks[i]) else {
            return Ok(());
        };
        if &*chunk.file == self.file
            && chunk.size == self.sizes[section - 1]
            && chunk.output != b".pdata"
            && identified.insert(chunk.rva)
        {
            self.work.push(section);
        }
        Ok(())
    }
}

fn replay(pe: &Pe<'_>, map: &Map<'_>, printed: &[u8]) -> Result<Replayed> {
    let exe = pe.b;
    let unwind_info_of: HashMap<u64, u64> = pe.function_table().collect();
    let members = members_of_archives(printed);

    let mut counts: Vec<(&str, usize)> = Vec::new();
    let mut count = |what: &'static str| match counts.iter_mut().find(|c| c.0 == what) {
        Some(c) => c.1 += 1,
        None => counts.push((what, 1)),
    };
    let mut records = Vec::new();
    let mut missing: Vec<Rc<[u8]>> = Vec::new();
    let mut identified: HashSet<u64> = HashSet::new();
    let mut included: HashSet<Vec<u8>> = HashSet::new();
    let mut comdat: Vec<(usize, bool)> = Vec::new();

    let mut files: Vec<Rc<[u8]>> = Vec::new();
    let mut seen: HashSet<Rc<[u8]>> = HashSet::new();
    for chunk in &map.chunks {
        if seen.insert(Rc::clone(&chunk.file)) {
            files.push(Rc::clone(&chunk.file));
        }
    }
    for file in &files {
        let path = String::from_utf8_lossy(file).into_owned();
        let own = std::fs::read(&path).ok();
        let bytes: Option<&[u8]> = own
            .as_deref()
            .or_else(|| members.get(&file[..]).map(|m| &m.file[m.range.clone()]));
        let Some((bytes, Parsed { sections, symbols })) =
            bytes.and_then(|bytes| Some((bytes, parse(bytes)?)))
        else {
            missing.push(Rc::clone(file));
            continue;
        };
        count("objects");
        let b = Data(bytes);
        let symbol =
            |index: u32| symbols[index as usize].ok_or("a relocation against an auxiliary record");
        for s in sections.iter().filter(|s| s.name == b".drectve") {
            // `/include:name` or `/include:"name"`, in any case
            let text = &bytes[s.raw..s.raw + s.size as usize];
            let lower = text.to_ascii_lowercase();
            for at in (0..lower.len()).filter(|&at| lower[at..].starts_with(b"/include:")) {
                let name = &text[at + 9..];
                let name = name.strip_prefix(b"\"").unwrap_or(name);
                let length = name
                    .iter()
                    .take_while(|&&c| !c.is_ascii_whitespace() && c != b'"')
                    .count();
                if length != 0 {
                    included.insert(name[..length].to_vec());
                }
            }
        }
        let mut known = Known {
            map,
            file,
            sizes: sections.iter().map(|s| s.size).collect(),
            address: vec![-1; sections.len() + 1],
            work: Vec::new(),
        };

        let listed = map.symbols_of_file.get(file);
        // MSVC reuses local labels ($LN12) across the sections of an object: a name says where a section is only if it is
        // unique.
        let mut definitions: HashMap<&[u8], usize> = HashMap::new();
        for y in symbols.iter().flatten().filter(|y| y.section > 0) {
            *definitions.entry(y.name).or_default() += 1;
        }
        for y in symbols.iter().flatten().filter(|y| y.section > 0) {
            let s = &sections[y.section as usize - 1];
            if y.name == s.name || s.is_function_table() || definitions[y.name] != 1 {
                continue;
            }
            if let Some(&[at]) = listed.and_then(|l| l.get(y.name)).map(|at| &at[..]) {
                known.learn(
                    y.section as usize,
                    at.cast_signed() - y.value,
                    &mut identified,
                )?;
            }
        }

        // An entry of this object's function table names a function, whose address is known by now, and its unwind info, which
        // has no name. The final table says where the unwind info of the function at that address is.
        let learn_unwind_info =
            |known: &mut Known<'_, '_>, identified: &mut HashSet<u64>| -> Result<()> {
                for s in sections.iter().filter(|s| s.is_function_table()) {
                    for i in (0..s.relocation_count.saturating_sub(2)).step_by(3) {
                        let field = |k: usize| -> Result<(ObjectSymbol<'_>, i64, u32)> {
                            let r = s.relocations + (i + k) * 10;
                            Ok((
                                symbol(b.u32(r + 4))?,
                                b.i32(s.raw + b.u32(r) as usize).into(),
                                b.u32(r),
                            ))
                        };
                        let (
                            (begin, begin_addend, begin_offset),
                            (unwind, unwind_addend, unwind_offset),
                        ) = (field(0)?, field(2)?);
                        if begin_offset % 12 != 0 || unwind_offset != begin_offset + 8 {
                            fail!("{path}: unexpected function table");
                        }
                        if begin.section <= 0
                            || unwind.section <= 0
                            || known.address[begin.section as usize] < 0
                        {
                            continue;
                        }
                        let function = known.address[begin.section as usize];
                        if map
                            .chunk_starting_at(function)
                            .is_none_or(|c| map.chunks[c].file != *file)
                        {
                            continue; // another file's copy won
                        }
                        if let Some(&info) = u64::try_from(function + begin.value + begin_addend)
                            .ok()
                            .and_then(|f| unwind_info_of.get(&f))
                        {
                            known.learn(
                                unwind.section as usize,
                                info.cast_signed() - unwind_addend - unwind.value,
                                identified,
                            )?;
                        }
                    }
                }
                Ok(())
            };

        learn_unwind_info(&mut known, &mut identified)?;
        while let Some(number) = known.work.pop() {
            let s = &sections[number - 1];
            let start = known.address[number];
            comdat.push((
                map.chunk_starting_at(start)
                    .ok_or("a section that is no chunk")?,
                s.flags & IMAGE_SCN_LNK_COMDAT != 0,
            ));
            for i in 0..s.relocation_count {
                let r = s.relocations + i * 10;
                let (offset, y, kind) = (b.u32(r), symbol(b.u32(r + 4))?, b.u16(r + 8));
                let p = start.cast_unsigned() + u64::from(offset);
                let at = pe
                    .try_file_offset(p)
                    .ok_or_else(|| format!("no file bytes at {p:x}"))?;
                let in_object = s.raw + offset as usize;
                let (t, addend): (i64, i64) = match kind {
                    reloc::ADDR64 => (
                        exe.u64(at).wrapping_sub(pe.image_base).cast_signed(),
                        b.i64(in_object),
                    ),
                    reloc::ADDR32NB => (exe.u32(at).into(), b.i32(in_object).into()),
                    reloc::REL32..=reloc::REL32_5 => (
                        p.cast_signed()
                            + 4
                            + i64::from(kind - reloc::REL32)
                            + i64::from(exe.i32(at)),
                        b.i32(in_object).into(),
                    ),
                    reloc::SECREL | reloc::SECTION => {
                        count("offsets in a section (thread-local, debug)");
                        continue;
                    }
                    kind => fail!("{path}: relocation type {kind}"),
                };
                let mut target = if y.section > 0 {
                    known.learn(y.section as usize, t - addend - y.value, &mut identified)?;
                    Some(known.address[y.section as usize])
                } else {
                    if let Some(in_map) = map.symbols_by_name.get(y.name) {
                        if !u64::try_from(t - addend).is_ok_and(|a| in_map.contains(&a)) {
                            fail!(
                                "{path}: {} is at {:x} in the image, not in the map",
                                String::from_utf8_lossy(y.name),
                                t - addend
                            );
                        }
                        count("references to a named symbol, checked against the map");
                    }
                    // where the symbol itself is
                    let chunk = map
                        .chunk_at(t - addend)
                        .map(|i| map.chunks[i].rva.cast_signed());
                    if chunk.is_none() {
                        count(if y.name.starts_with(b"__imp_") {
                            "to an import slot"
                        } else if y.name == b"__ImageBase" {
                            "to the image base"
                        } else {
                            "to something else the linker made"
                        });
                    }
                    chunk
                };
                if target.is_some_and(|t| t >= 0 && map.chunk_starting_at(t).is_none()) {
                    count("targets that are no chunk of the map (defined in the object)");
                    target = None;
                }
                records.push(Record {
                    place: p,
                    kind,
                    chunk: target.and_then(|t| u64::try_from(t).ok()),
                    target: t,
                });
            }
            if known.work.is_empty() {
                learn_unwind_info(&mut known, &mut identified)?;
            }
        }
    }
    // The linker makes an object of its own from the resources. What matters is code and constants.
    let is_covered = |c: &Chunk<'_>| c.output == b".text" || c.output == b".rdata";
    let matters = |file: &&Rc<[u8]>| map.chunks.iter().any(|c| c.file == **file && is_covered(c));
    if let Some(first) = missing.iter().find(matters) {
        fail!(
            "an input of the link is not there: {}",
            String::from_utf8_lossy(first)
        );
    }
    let mut report = format!(
        "chunks {}, relocations {}\n",
        map.chunks.len(),
        records.len()
    );
    let _ = writeln!(
        report,
        "{}",
        counts
            .iter()
            .map(|(what, n)| format!("{what}: {n}"))
            .collect::<Vec<_>>()
            .join("; ")
    );
    Ok(Replayed {
        records,
        comdat,
        included,
        identified,
        report,
    })
}

// ---------------------------------------------------------------- the table

struct Node<'m> {
    align: u64,
    is_code: bool,
    names: Vec<&'m [u8]>,
    is_comdat: bool,
    /// The linker made it, or its section could not be told: see `thunk_fields`.
    has_no_relocations: bool,
}

struct Linked<'a, 'm> {
    pe: &'a Pe<'a>,
    text: (u64, u64),
    nodes: Nodes,
    list: Vec<Node<'m>>,
    records: Vec<Record>,
    blocks: Blocks,
    /// Node of a function -> its unwind infos.
    unwind_info_of: HashMap<usize, Vec<u64>>,
    thunk_fields: Vec<u64>,
}

impl Linked<'_, '_> {
    fn records_in(&self, start: u64, end: u64) -> &[Record] {
        let from = self.records.partition_point(|r| r.place < start);
        let to = from + self.records[from..].partition_point(|r| r.place < end);
        &self.records[from..to]
    }

    fn is_in_text(&self, rva: i64) -> bool {
        rva >= self.text.0.cast_signed() && rva < self.text.1.cast_signed()
    }

    fn find(&self, rva: i64) -> Option<usize> {
        self.nodes.find(u64::try_from(rva).ok()?)
    }

    /// What the 4 bytes at `place` refer to, relative to the instruction pointer.
    fn relative(&self, place: u64) -> i64 {
        place.cast_signed() + 4 + i64::from(self.pe.b.i32(self.pe.file_offset(place)))
    }
}

impl Image for Linked<'_, '_> {
    fn nodes(&self) -> &Nodes {
        &self.nodes
    }
    fn blocks(&self) -> &Blocks {
        &self.blocks
    }
    fn references(&self, start: u64, end: u64, touch: &mut dyn FnMut(u64)) -> Result<()> {
        for r in self.records_in(start, end) {
            let Some(chunk) = r.chunk else {
                if self.is_in_text(r.target) {
                    touch(r.target.cast_unsigned()); // a thunk
                }
                continue;
            };
            // Into a function that is split into blocks: the address decides which block.
            let n = self
                .nodes
                .find(chunk)
                .filter(|&n| self.blocks.of(n).is_some());
            touch(if n.is_some() && self.find(r.target) == n {
                r.target.cast_unsigned()
            } else {
                chunk
            });
        }
        let Some(n) = self.nodes.find(start) else {
            return Ok(());
        };
        if self.nodes.addr[n] == start {
            self.unwind_info_of
                .get(&n)
                .into_iter()
                .flatten()
                .copied()
                .for_each(&mut *touch);
        }
        if self.list[n].has_no_relocations {
            let inside = self
                .thunk_fields
                .iter()
                .filter(|&&place| place >= start && place < end);
            inside.for_each(|&place| touch(self.relative(place).cast_unsigned()));
        }
        Ok(())
    }
}

pub(super) fn make(link: &Link<'_>, linked: &[u8], arch: Arch) -> Result<Made> {
    if arch != Arch::X64 {
        fail!("arm64 is not supported yet");
    }
    let pe = Pe::open(linked);
    let b = pe.b;
    let map_text = read(link.map)?;
    let mut map = read_map(&map_text);
    let replayed = replay(&pe, &map, &read(link.printed)?)?;
    for &(chunk, is_comdat) in &replayed.comdat {
        map.chunks[chunk].is_comdat = is_comdat;
    }
    for chunk in &mut map.chunks {
        if chunk
            .names
            .iter()
            .any(|&name| replayed.included.contains(name))
        {
            chunk.is_comdat = false;
        }
        chunk.is_unidentified = !replayed.identified.contains(&chunk.rva);
    }
    let section = |name: &str| {
        pe.sections
            .iter()
            .find(|s| s.name == name.as_bytes())
            .ok_or_else(|| format!("no section {name}"))
    };
    let text = section(".text")?;
    let text = (text.rva, text.rva + text.size);
    let file_offset = |rva: u64| pe.file_offset(rva);

    // ---- nodes: the chunks
    struct Listed<'m> {
        rva: u64,
        size: u64,
        node: Node<'m>,
    }
    let mut listed: Vec<Listed<'_>> = Vec::new();
    for c in map
        .chunks
        .iter()
        .filter(|c| c.output == b".text" || c.output == b".rdata")
    {
        let is_code = c.output == b".text";
        let has_no_relocations = is_code && c.is_unidentified;
        let node = Node {
            align: c.align,
            is_code,
            names: c.names.clone(),
            is_comdat: c.is_comdat,
            has_no_relocations,
        };
        listed.push(Listed {
            rva: c.rva,
            size: c.size,
            node,
        });
    }
    // The map lists what came from object files. What else there is in .text, between int3 padding, the linker made: the
    // thunks that jump through an import slot, and the ones that load a DLL on first use. Each stretch is one piece.
    let mut made_by_the_linker = Vec::new();
    let mut at = text.0;
    let code: Vec<(u64, u64)> = listed
        .iter()
        .filter(|c| c.node.is_code)
        .map(|c| (c.rva, c.size))
        .collect();
    for (next, size) in code.into_iter().chain([(text.1, 0)]) {
        let (mut from, mut to) = (at, next);
        while from < to && b.u8(file_offset(from)) == 0xcc {
            from += 1;
        }
        while to > from && b.u8(file_offset(to - 1)) == 0xcc {
            to -= 1;
        }
        if to > from {
            made_by_the_linker.push((from, to - from));
        }
        at = at.max(next + size);
    }
    let linker_made = made_by_the_linker.len();
    for (rva, size) in made_by_the_linker {
        let node = Node {
            align: 1,
            is_code: true,
            names: vec![b"<made by the linker>"],
            is_comdat: false,
            has_no_relocations: true,
        };
        listed.push(Listed { rva, size, node });
    }
    listed.sort_by_key(|c| c.rva);
    let nodes = Nodes {
        addr: listed.iter().map(|c| c.rva).collect(),
        size: listed.iter().map(|c| c.size).collect(),
    };
    let list: Vec<Node<'_>> = listed.into_iter().map(|c| c.node).collect();
    let n_nodes = nodes.len();

    // ---- relocations, sorted by the address they apply to
    let mut records = replayed.records;
    records.sort_by_key(|r| r.place);
    if let Some(twice) = records
        .iter()
        .zip(records.iter().skip(1))
        .find(|(a, b)| a.place == b.place)
    {
        fail!("two relocations at {:x}", twice.0.place);
    }

    // ---- what the linker made
    // The function table says which unwind info lives and dies with which function.
    let unwind_info: Vec<(u64, u64)> = pe.function_table().collect();
    let mut exported_functions: Vec<u64> = Vec::new(); // the places that hold their addresses
    if b.u32(pe.optional + 112 + IMAGE_DIRECTORY_ENTRY_EXPORT * 8 + 4) != 0 {
        let o = pe.directory(IMAGE_DIRECTORY_ENTRY_EXPORT).0;
        exported_functions
            .extend((0..u64::from(b.u32(o + 20))).map(|i| u64::from(b.u32(o + 28)) + 4 * i));
    }
    let entry_point_field = pe.optional as u64 + 16;

    // In the thunks every address is relative to the instruction pointer. For these instructions, which take no immediate
    // operand, it is the last 4 bytes. The same goes for the few nameless scraps of the C runtime's assembly whose section
    // could not be told: they hold padding, but if one held an address it would be found here, or stop the build.
    let mut thunk_fields: Vec<u64> = Vec::new();
    for n in (0..n_nodes).filter(|&n| list[n].has_no_relocations) {
        let lines = listing(
            link.objdump,
            link.linked,
            nodes.addr[n] + pe.image_base,
            nodes.end(n) + pe.image_base,
        )?;
        for (i, (at, mnemonic, operands)) in lines.iter().enumerate() {
            let at = at - pe.image_base;
            let is_direct = matches!(&mnemonic[..], "call" | "callq" | "jmp" | "jmpq")
                && operands.starts_with("0x");
            if !is_direct && !operands.contains("(%rip)") {
                continue;
            }
            if !is_direct
                && !matches!(
                    &mnemonic[..],
                    "lea" | "leaq" | "jmp" | "jmpq" | "call" | "callq" | "mov" | "movq"
                )
            {
                fail!("unexpected {mnemonic} {operands} in a thunk at {at:x}");
            }
            if operands.contains('$') {
                fail!("an immediate operand in a thunk at {at:x}");
            }
            thunk_fields.push(
                lines
                    .get(i + 1)
                    .map_or_else(|| nodes.end(n), |next| next.0 - pe.image_base)
                    - 4,
            );
        }
    }

    // ---- markers, and the blocks of the functions that hold them
    // A record is {marker - ., `false` side - ., id, 0} (4 x 32 bits), in .bunft.
    let mut markers: Vec<(u64, Marker)> = Vec::new();
    let table = section(".bunft")?;
    for r in (0..table.size.saturating_sub(15)).step_by(16) {
        let (o, at) = ((table.raw + r) as usize, table.rva + r);
        let (site, marker) = (
            at.wrapping_add_signed(b.i32(o).into()),
            Marker {
                skip: at.wrapping_add_signed(b.i32(o + 4).into()),
                id: b.u32(o + 8),
            },
        );
        match markers.iter_mut().find(|m| m.0 == site) {
            _ if marker.id == 0 => {}
            Some(known) => known.1 = marker,
            None => markers.push((site, marker)),
        }
    }
    let mut unwind_info_of: HashMap<usize, Vec<u64>> = HashMap::new();
    for &(begin, info) in &unwind_info {
        if let Some(n) = nodes.find(begin) {
            unwind_info_of.entry(n).or_default().push(info);
        }
    }
    let mut image = Linked {
        pe: &pe,
        text,
        nodes,
        list,
        records,
        blocks: Blocks::default(),
        unwind_info_of,
        thunk_fields,
    };
    image.blocks = Functions {
        arch,
        objdump: link.objdump,
        path: link.linked,
        bias: pe.image_base,
        bytes: b,
        file_offset: &file_offset,
        markers: &markers,
        nodes: &image.nodes,
        is_code: &|n| image.list[n].is_code,
        does_not_return: &HashSet::new(),
        constants_taken_by: &|_, _| Vec::new(),
    }
    .split()?;

    // A jump table holds `label - table` in 32 bits. In the object that is a relocation relative to the entry, with the
    // entry's position in the table folded into the addend, so the address recovered for it is off by that position. The
    // table starts where the function's own `lea` points, which is known exactly: the label is that plus the value of the
    // entry.
    {
        let mut table_starts: Vec<u64> = Vec::new();
        for &(n, _) in &image.blocks.of {
            let taken = image
                .records_in(image.nodes.addr[n], image.nodes.end(n))
                .iter();
            table_starts.extend(
                taken
                    .filter(|r| r.chunk.is_some() && !image.is_in_text(r.target))
                    .map(|r| r.target.cast_unsigned()),
            );
        }
        table_starts.sort_unstable();
        let mut corrected = Vec::new();
        for (k, r) in image.records.iter().enumerate() {
            let Some(n) = r
                .chunk
                .and_then(|c| image.nodes.find(c))
                .filter(|&n| image.blocks.of(n).is_some())
            else {
                continue;
            };
            if image.is_in_text(r.place.cast_signed())
                || r.kind == reloc::ADDR64
                || r.kind == reloc::ADDR32NB
            {
                continue;
            }
            let start = table_starts
                .partition_point(|&t| t <= r.place)
                .checked_sub(1)
                .map(|i| table_starts[i]);
            let Some(start) = start.filter(|&s| image.nodes.find(s) == image.nodes.find(r.place))
            else {
                fail!("a jump table nobody points at, at {:x}", r.place);
            };
            let target = start.cast_signed() + i64::from(b.i32(file_offset(r.place)));
            if image.find(target) != Some(n) {
                fail!(
                    "an entry of a jump table leaves its function, at {:x}",
                    r.place
                );
            }
            corrected.push((k, target));
        }
        for (k, target) in corrected {
            image.records[k].target = target;
        }
    }
    let image = image;
    let (nodes, list, records, blocks) = (&image.nodes, &image.list, &image.records, &image.blocks);
    let is_in_text = |rva: u64| rva >= text.0 && rva < text.1;

    // ---- rows of tables that belong to features
    let pointer_at = |rva: u64| {
        b.u64(file_offset(rva))
            .wrapping_sub(pe.image_base)
            .cast_signed()
    };
    let mut feature_rows: Vec<FeatureRow> = Vec::new();
    for (feature, row) in FEATURES
        .iter()
        .flat_map(|f| f.rows.iter().map(move |row| (f, row)))
    {
        let found: Vec<usize> = (0..n_nodes)
            .filter(|&n| {
                list[n]
                    .names
                    .iter()
                    .any(|name| matches(row.msvc_table, name))
            })
            .collect();
        let &[table] = &found[..] else {
            fail!("{} tables match {}", found.len(), row.msvc_table)
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
                        b.u32(file_offset(a + 8)) as usize == key.len() + 1 && pointer_at(a) > 0;
                    if is_named
                        && linked[file_offset(pointer_at(a).cast_unsigned())..]
                            .starts_with(key.as_bytes())
                    {
                        add(a);
                    }
                }
            }
            Select::PointsAt { msvc, .. } => {
                for r in image.records_in(start, end) {
                    let target = r.chunk.and_then(|c| nodes.find(c));
                    if target.is_some_and(|t| list[t].names.iter().any(|name| matches(msvc, name)))
                    {
                        add(start + (r.place - start) / row.size * row.size);
                    }
                }
            }
        }
        if feature_rows.len() == before {
            fail!("no row of {} belongs to {}", row.msvc_table, feature.name);
        }
    }
    feature_rows.sort_by_key(|r| r.start);

    // ---- what is live
    let mut roots = vec![u64::from(b.u32(entry_point_field as usize))];
    roots.extend(
        exported_functions
            .iter()
            .map(|&place| u64::from(b.u32(file_offset(place)))),
    );
    // The linker drops only COMDAT sections. What is not in a node (.data and so on) stays, and what it refers to with it.
    roots.extend(
        (0..n_nodes)
            .filter(|&n| !list[n].is_comdat)
            .map(|n| nodes.addr[n]),
    );
    for r in records.iter().filter(|r| nodes.find(r.place).is_none()) {
        image.references(r.place, r.place + 1, &mut |a| roots.push(a))?;
    }
    let as_linked = mark(&image, &roots, Excluded::BothSides)?;
    let unexplained: Vec<usize> = (0..n_nodes).filter(|&n| !as_linked.node[n]).collect();

    // ---- units
    let mut parts = Parts::default();
    let Units {
        first_of_node,
        of_block,
    } = parts.add_nodes(nodes, blocks, &feature_rows, &|n| Some(list[n].align));
    // The unit of the chunk that starts at `chunk`; for a function that is split, of the block that holds `address`.
    let unit_for = |chunk: u64, address: i64| -> Option<u32> {
        let n = nodes.find(chunk)?;
        match blocks.of(n) {
            Some(of) if image.find(address) == Some(n) => {
                Some(of_block[blocks.at(of, address.cast_unsigned())])
            }
            _ => first_of_node[n],
        }
    };
    // Of the piece that holds `address`.
    let unit_holding = |address: i64| {
        image
            .find(address)
            .and_then(|n| unit_for(nodes.addr[n], address))
    };
    for root in roots
        .iter()
        .copied()
        .chain(unexplained.iter().map(|&n| nodes.addr[n]))
    {
        if let Some(u) = unit_for(root, root.cast_signed()) {
            parts.units[u as usize].flags |= ROOT;
        }
    }
    for i in (0..blocks.all.len()).filter(|&i| !as_linked.block[i]) {
        parts.units[of_block[i] as usize].flags |= ROOT;
    }

    // ---- fixups
    let mut add = |sort: &'static str, place: u64, form: Form, target: Option<u32>| {
        // If neither end can move there is nothing to patch. It is still an edge if the target can die.
        let moves =
            is_in_text(place) || target.is_some_and(|t| is_in_text(parts.units[t as usize].start));
        let form = if moves { form } else { Form::None };
        if target.is_some() || !matches!(form, Form::None | Form::Abs64 | Form::Abs32) {
            parts.add_fixup(sort, place, form, target, 0);
        }
    };
    for r in records {
        // A thunk has no chunk, but it is a piece.
        let target = match r.chunk {
            Some(chunk) => unit_for(chunk, r.target),
            None if image.is_in_text(r.target) => unit_holding(r.target),
            None => None,
        };
        match r.kind {
            reloc::ADDR64 if is_in_text(r.place) => {
                fail!(
                    "an absolute address in code, which the base relocations would have to follow, at {:x}",
                    r.place
                )
            }
            reloc::ADDR64 => add("address", r.place, Form::Abs64, target),
            reloc::ADDR32NB => add("offset from the image base", r.place, Form::Abs32, target),
            _ => add(
                "relative to the instruction pointer",
                r.place,
                Form::Rel32,
                target,
            ),
        }
    }
    for &place in &image.thunk_fields {
        let t = image.relative(place);
        add(
            "in a thunk",
            place,
            Form::Rel32,
            if image.is_in_text(t) {
                unit_holding(t)
            } else {
                None
            },
        );
    }
    for &(begin, info) in &unwind_info {
        // An entry of the function table is kept as long as any of the function is left, so its unwind info hangs on the start
        // of the function, wherever in it the entry begins.
        if let (Some(n), Some(i)) = (nodes.find(begin), nodes.find(info)) {
            add(
                "a function's unwind info",
                nodes.addr[n],
                Form::None,
                unit_for(nodes.addr[i], nodes.addr[i].cast_signed()),
            );
        }
    }
    // The base relocations list every absolute pointer of the image. One that no object file accounts for, the linker made:
    // the slots of the delay-load import table start out pointing at thunks.
    {
        let covered: HashSet<u64> = records
            .iter()
            .filter(|r| r.kind == reloc::ADDR64)
            .map(|r| r.place)
            .collect();
        let (table, size) = pe.directory(IMAGE_DIRECTORY_ENTRY_BASERELOC);
        let mut block = table;
        while block < table + size {
            for entry in (block + 8..block + b.u32(block + 4) as usize).step_by(2) {
                let place = u64::from(b.u32(block)) + u64::from(b.u16(entry) & 0xfff);
                if b.u16(entry) >> 12 == IMAGE_REL_BASED_DIR64
                    && !covered.contains(&place)
                    && image.is_in_text(pointer_at(place))
                {
                    add(
                        "pointer the linker made",
                        place,
                        Form::Abs64,
                        unit_holding(pointer_at(place)),
                    );
                }
            }
            block += b.u32(block + 4) as usize;
        }
    }
    let unit_of_piece_at = |rva: u32| {
        image
            .find(rva.into())
            .and_then(|n| unit_for(nodes.addr[n], nodes.addr[n].cast_signed()))
    };
    for &place in &exported_functions {
        add(
            "exported function",
            place,
            Form::Abs32,
            unit_of_piece_at(b.u32(file_offset(place))),
        );
    }
    add(
        "entry point",
        entry_point_field,
        Form::Abs32,
        unit_of_piece_at(b.u32(entry_point_field as usize)),
    );

    // ---- the table
    let mut patches = Vec::new();
    for &(site, marker) in &markers {
        patches.push(marker_patch(arch, b, file_offset(site), site, marker)?);
    }
    let bytes_of = |only_code: bool| {
        unexplained
            .iter()
            .filter(|&&n| !only_code || list[n].is_code)
            .map(|&n| nodes.size[n])
            .sum::<u64>()
    };
    let report = format!(
        "{}chunks {n_nodes} ({linker_made} made by the linker, {} addresses in them), relocations {}, functions in the function \
         table {}, markers {} in {} functions ({} blocks), rows of features {}\nkept by the linker but not reached by the \
         graph: {} chunks, {} bytes (.text {})\nunits {}, flow edges {}, fixups {}, patches {}\n{}\n",
        replayed.report,
        image.thunk_fields.len(),
        records.len(),
        unwind_info.len(),
        markers.len(),
        blocks.of.len(),
        blocks.all.len(),
        feature_rows.len(),
        unexplained.len(),
        bytes_of(false),
        bytes_of(true),
        parts.units.len(),
        parts.flows.len(),
        parts.fixups.len(),
        patches.len(),
        parts.sorts(),
    );
    let table = Table {
        format: Format {
            container: Container::Pe,
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
            low: text.0,
            high: text.1,
            towards_high: false,
            fill: [0xcc].into(),
        }], // int3
        code: vec![text],
        patches,
        units: parts.units,
        flows: parts.flows,
        fixups: parts.fixups,
    }
    .canonical();
    Ok(Made { table, report })
}
