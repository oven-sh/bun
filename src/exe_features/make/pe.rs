//! PE, x86-64, linked by lld-link with `/lldmap`, `/lldltocache`, `/verbose` and `/demangle:no`: the map has to name
//! symbols as the object files do. Addresses here, and in the table, are relative to the image base.
//!
//! A node is a CHUNK: a section of an object file. The map lists them as file:(section name), and in COFF nearly all of them
//! are called .text or .rdata. So which section of its file a chunk is has to be found out.
//!
//! For that the link is replayed. A section that defines a symbol the map lists under the same file has a known address. For
//! a relocation in such a section, the image holds the final address of the target and the object holds the addend, and the
//! difference is the final address of the section the target is in, exactly, even if it has no name (a jump table) and
//! even if the addend points outside of it. That section is then known too. Whatever is live is reached this way.
//!
//! The linker keeps some things that no relocation refers to, so the graph does not reach them and they stay: what only its own
//! thunks call (`__delayLoadHelper2`), and sections that are kept with another one, which is how the cleanup code of a C++
//! function (`?dtor$0@...`) hangs on to it, with all that it calls.
//!
//! Only code is left out. The map does not list what the linker made itself. In .text that can be told from padding, which
//! is int3. In .rdata padding is zeroes, and so is some of what the linker made.

use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;
use std::rc::Rc;

use super::{Data, Graph, Link, Node, Record as FeatureRecord, Result, fail, find, read};
use crate::bytes::fixed_name;

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
    /// As indexes.
    chunks_of_file: HashMap<Rc<[u8]>, Vec<usize>>,
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
        let Some(text) = rest[digits..].strip_prefix(b" ").filter(|_| digits != 0) else {
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
    for (index, chunk) in map.chunks.iter().enumerate() {
        let of_file = map.chunks_of_file.entry(Rc::clone(&chunk.file));
        of_file.or_default().push(index);
    }
    map
}

impl<'m> Map<'m> {
    fn chunks_of(&self, file: &[u8]) -> impl Iterator<Item = &Chunk<'m>> {
        let indexes = self
            .chunks_of_file
            .get(file)
            .map_or(&[][..], |list| &list[..]);
        indexes.iter().map(|&index| &self.chunks[index])
    }

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
/// names every archive that was read. Several may have a member of one name.
fn members_of_archives(printed: &[u8]) -> HashMap<Vec<u8>, Vec<Bytes>> {
    let mut members: HashMap<Vec<u8>, Vec<Bytes>> = HashMap::new();
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
                members.entry(name).or_default().push(Bytes {
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
    /// Where the chunk referred to starts. None: it is no chunk, and `target` is what there is to go by.
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

/// The object files that LTO generated, by the names the map gives them.
///
/// They are in the linker's cache, under names that do not say which is which. (`/lldsavetemps` is there to write them under
/// those of the map. With a cache it writes empty files.) But the map says how large each chunk of each of them is and which
/// symbols are in it, and the one that it is has a section like that for every one. So where only one has, that is the one.
fn generated_objects(
    cache: &std::path::Path,
    map: &Map<'_>,
    files: &[Rc<[u8]>],
) -> Result<HashMap<Rc<[u8]>, Vec<u8>>> {
    let mut objects: Vec<Vec<u8>> = Vec::new();
    for entry in std::fs::read_dir(cache).map_err(|e| format!("{}: {e}", cache.display()))? {
        let entry = entry.map_err(|e| format!("{}: {e}", cache.display()))?;
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with("llvmcache-")
        {
            objects.push(
                std::fs::read(entry.path()).map_err(|e| format!("{}: {e}", cache.display()))?,
            );
        }
    }
    // Per object: {name of a symbol, size of the section that it is in}, and the sizes alone for what has no name.
    let mut defines: Vec<HashSet<(&[u8], u64)>> = Vec::new();
    let mut sizes: Vec<HashSet<u64>> = Vec::new();
    let mut defining: HashMap<&[u8], Vec<usize>> = HashMap::new();
    for (index, object) in objects.iter().enumerate() {
        let (mut own, mut own_sizes) = (HashSet::new(), HashSet::new());
        if let Some(parsed) = parse(object) {
            own_sizes.extend(parsed.sections.iter().map(|s| s.size));
            for y in parsed.symbols.iter().flatten().filter(|y| y.section > 0) {
                if own.insert((y.name, parsed.sections[y.section as usize - 1].size)) {
                    defining.entry(y.name).or_default().push(index);
                }
            }
        }
        defines.push(own);
        sizes.push(own_sizes);
    }
    // Under a chunk the map lists the symbols of its section, and those of the sections of other files that were folded into it.
    let has = |o: usize, c: &Chunk<'_>| match &c.names[..] {
        [] => sizes[o].contains(&c.size),
        names => names.iter().any(|&n| defines[o].contains(&(n, c.size))),
    };
    let all: Vec<usize> = (0..objects.len()).collect();
    let mut candidates: Vec<Vec<usize>> = Vec::new();
    for file in files {
        let chunks: Vec<&Chunk<'_>> = (map.chunks_of(file))
            .filter(|c| c.output != b".pdata")
            .collect();
        let may_have = |c: &&&Chunk<'_>| -> Vec<usize> {
            let mut list: Vec<usize> = c
                .names
                .iter()
                .filter_map(|n| defining.get(n))
                .flatten()
                .copied()
                .collect();
            list.sort_unstable();
            list.dedup();
            list
        };
        let named = chunks.iter().filter(|c| !c.names.is_empty());
        let fewest = named
            .map(|c| may_have(&c))
            .min_by_key(Vec::len)
            .unwrap_or_else(|| all.clone());
        candidates.push(
            fewest
                .into_iter()
                .filter(|&o| chunks.iter().all(|c| has(o, c)))
                .collect(),
        );
    }
    // Each is one file of the map. So one that is spoken for is no candidate for another.
    let mut of_file: Vec<Option<usize>> = vec![None; files.len()];
    let mut is_taken = vec![false; objects.len()];
    loop {
        let mut has_changed = false;
        for (candidates, of_file) in candidates
            .iter_mut()
            .zip(&mut of_file)
            .filter(|c| c.1.is_none())
        {
            candidates.retain(|&o| !is_taken[o]);
            if let &[only] = &candidates[..] {
                (*of_file, is_taken[only], has_changed) = (Some(only), true, true);
            }
        }
        if !has_changed {
            break;
        }
    }
    drop((defines, sizes, defining));
    let mut found = HashMap::new();
    for (file, (object, candidates)) in files.iter().zip(of_file.iter().zip(&candidates)) {
        match object {
            Some(object) => found.insert(Rc::clone(file), core::mem::take(&mut objects[*object])),
            None => fail!(
                "{} entries of the LTO cache may be {}",
                candidates.len(),
                String::from_utf8_lossy(file)
            ),
        };
    }
    Ok(found)
}

fn replay(pe: &Pe<'_>, map: &Map<'_>, link: &Link<'_>) -> Result<Replayed> {
    let exe = pe.b;
    let unwind_info_of: HashMap<u64, u64> = pe.function_table().collect();
    let members = members_of_archives(&read(link.printed)?);

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
    let output = link
        .linked
        .file_name()
        .ok_or("the executable has no name")?;
    let generated_prefix = format!("{}.lto.", output.to_string_lossy()).into_bytes();
    let is_generated = |file: &&Rc<[u8]>| {
        let name = file
            .rsplit(|&b| b == b'/' || b == b'\\')
            .next()
            .unwrap_or(file);
        name.starts_with(&generated_prefix)
    };
    let generated: Vec<Rc<[u8]>> = files.iter().filter(is_generated).cloned().collect();
    let generated = generated_objects(link.lto_cache, map, &generated)?;
    for file in &files {
        let path = String::from_utf8_lossy(file).into_owned();
        let own = if generated.contains_key(file) {
            None
        } else {
            std::fs::read(&path).ok()
        };
        let member = match members.get(&file[..]).map(|m| &m[..]) {
            _ if own.is_some() || generated.contains_key(file) => None,
            Some([one]) => Some(&one.file[one.range.clone()]),
            Some(several)
                if several.iter().all(|m| {
                    m.file[m.range.clone()] == several[0].file[several[0].range.clone()]
                }) =>
            {
                Some(&several[0].file[several[0].range.clone()])
            }
            Some(_) => fail!("{path}: several archives have a member of that name"),
            None => None,
        };
        let bytes: Option<&[u8]> = (generated.get(file).map(|o| &o[..]))
            .or(own.as_deref())
            .or(member);
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
                    chunk: target.and_then(|t| u64::try_from(t).ok()),
                    target: t,
                });
            }
            if known.work.is_empty() {
                learn_unwind_info(&mut known, &mut identified)?;
            }
        }
        // What a chunk of this file that is none of the sections found refers to is not known, but for its pointers, which are
        // listed for the loader. So it has to be a section that has nothing else.
        let has_more_than_pointers = |s: &ObjectSection<'_>| {
            (0..s.relocation_count).any(|i| b.u16(s.relocations + i * 10 + 8) != reloc::ADDR64)
        };
        let is_left = |(index, s): &(usize, &ObjectSection<'_>)| {
            known.address[index + 1] < 0 && !s.is_function_table() && has_more_than_pointers(s)
        };
        let left: HashSet<u64> = (sections.iter().enumerate().filter(is_left))
            .map(|(_, s)| s.size)
            .collect();
        let is_unknown = |c: &&Chunk<'_>| {
            let is_followed = c.output != b".pdata" && c.output != b".bunft";
            is_followed && !identified.contains(&c.rva) && left.contains(&c.size)
        };
        if let Some(c) = map.chunks_of(file).find(is_unknown) {
            fail!(
                "{path}: which section the chunk at {:x} is cannot be told, and it may be one that refers to something",
                c.rva
            );
        }
    }
    // The linker makes an object of its own from the resources. What matters is code and constants.
    let is_covered = |c: &Chunk<'_>| c.output == b".text" || c.output == b".rdata";
    let matters = |file: &&Rc<[u8]>| map.chunks_of(file).any(is_covered);
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

// ---------------------------------------------------------------- the graph

pub(super) fn graph(link: &Link<'_>, linked: &[u8], is_arm64: bool) -> Result<Graph> {
    if is_arm64 {
        fail!("arm64 is not supported yet");
    }
    let pe = Pe::open(linked);
    let b = pe.b;
    let map_text = read(link.map)?;
    let mut map = read_map(&map_text);
    let replayed = replay(&pe, &map, link)?;
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
    let text = pe
        .sections
        .iter()
        .find(|s| s.name == b".text")
        .ok_or("no section .text")?;

    // ---- nodes: the chunks, and in .text what else there is between int3 padding, which the linker made: the thunks that jump
    // through an import slot, and the ones that load a DLL on first use.
    let mut nodes: Vec<Node> = Vec::new();
    let mut made_by_the_linker = 0;
    let mut end_of_code = text.rva;
    let mut unlisted = |nodes: &mut Vec<Node>, from: u64, to: u64| {
        let bytes = &linked[pe.file_offset(from)..][..(to - from) as usize];
        let is_padding = |byte: &u8| *byte == 0xcc;
        if let (Some(first), Some(last)) = (
            bytes.iter().position(|b| !is_padding(b)),
            bytes.iter().rposition(|b| !is_padding(b)),
        ) {
            made_by_the_linker += 1;
            nodes.push(Node {
                addresses: from + first as u64..from + last as u64 + 1,
                stretch: 0,
                can_be_left_out: false,
                is_root: true,
                names: Vec::new(),
            });
        }
    };
    let mut outputs: Vec<&[u8]> = vec![b".text"];
    let (mut unidentified, mut unidentified_code) = (0u64, 0u64);
    for c in &map.chunks {
        let is_code = c.output == b".text";
        if is_code {
            if c.rva > end_of_code {
                unlisted(&mut nodes, end_of_code, c.rva);
            }
            end_of_code = c.rva + c.size;
        }
        let stretch = outputs
            .iter()
            .position(|o| *o == c.output)
            .unwrap_or_else(|| {
                outputs.push(c.output);
                outputs.len() - 1
            });
        // The function table is sorted by the linker: what is where the map says a part of it went is not that part.
        let is_known = !c.is_unidentified && c.output != b".pdata";
        if !is_known && c.output != b".pdata" {
            unidentified += c.size;
            unidentified_code += if is_code { c.size } else { 0 };
        }
        nodes.push(Node {
            addresses: c.rva..c.rva + c.size,
            stretch: stretch as u32,
            can_be_left_out: is_code && is_known,
            // The linker drops only what is a COMDAT. And what is not known refers to what is not known.
            is_root: !c.is_comdat || !is_known,
            // With those of what was folded into it.
            names: (c.names.iter())
                .map(|name| name.iter().map(|&c| char::from(c)).collect())
                .collect(),
        });
    }
    if text.rva + text.size.min(text.raw_size) > end_of_code {
        unlisted(
            &mut nodes,
            end_of_code,
            text.rva + text.size.min(text.raw_size),
        );
    }
    nodes.sort_by_key(|n| n.addresses.start);
    let is_known = |nodes: &[Node], rva: u64| {
        find(nodes, rva).is_some_and(|n| {
            map.chunk_starting_at(nodes[n as usize].addresses.start.cast_signed())
                .is_some_and(|c| {
                    !map.chunks[c].is_unidentified && map.chunks[c].output != b".pdata"
                })
        })
    };

    // ---- edges
    let mut edges: Vec<(u32, u32)> = Vec::new();
    // A record of `bun_core::feature` does not keep the function that it is about.
    let records = pe.sections.iter().find(|s| s.name == b".bunft");
    let records = records.map_or(0..0, |s| s.rva..s.rva + s.size);
    for r in replayed
        .records
        .iter()
        .filter(|r| !records.contains(&r.place))
    {
        let to = r.chunk.or_else(|| u64::try_from(r.target).ok());
        if let (Some(from), Some(to)) = (find(&nodes, r.place), to.and_then(|to| find(&nodes, to)))
        {
            edges.push((from, to));
        }
    }
    // A function has unwind info, which may refer to a handler.
    for (function, info) in pe.function_table() {
        if let (Some(from), Some(to)) = (find(&nodes, function), find(&nodes, info)) {
            edges.push((from, to));
        }
    }

    // ---- what is reached from outside, or from what is not known
    let mut roots: Vec<u64> = vec![b.u32(pe.optional + 16).into()];
    let (exports, exports_size) = (
        b.u32(pe.optional + 112 + IMAGE_DIRECTORY_ENTRY_EXPORT * 8),
        b.u32(pe.optional + 116 + IMAGE_DIRECTORY_ENTRY_EXPORT * 8),
    );
    if exports_size != 0 {
        let at = pe.file_offset(exports.into());
        let functions = pe.file_offset(b.u32(at + 28).into());
        roots.extend((0..b.u32(at + 20) as usize).map(|i| u64::from(b.u32(functions + i * 4))));
    }
    // Every pointer in the image is listed for the loader.
    let mut pointers_from_the_unknown = 0;
    let (mut at, size) = pe.directory(IMAGE_DIRECTORY_ENTRY_BASERELOC);
    if size == 0 {
        fail!("the image has no base relocations");
    }
    let end = at + size;
    while at < end {
        let (page, block) = (u64::from(b.u32(at)), b.u32(at + 4) as usize);
        for entry in (at + 8..at + block)
            .step_by(2)
            .map(|e| b.u16(e))
            .filter(|e| e >> 12 == IMAGE_REL_BASED_DIR64)
        {
            let place = page + u64::from(entry & 0xfff);
            if !is_known(&nodes, place) {
                pointers_from_the_unknown += 1;
                roots.push(b.u64(pe.file_offset(place)).wrapping_sub(pe.image_base));
            }
        }
        at += block;
    }
    for root in roots {
        if let Some(node) = find(&nodes, root) {
            nodes[node as usize].is_root = true;
        }
    }

    // ---- records: {no-op - ., other side - . or 0, id, 0}
    let mut records = Vec::new();
    for s in pe.sections.iter().filter(|s| s.name == b".bunft") {
        for r in (0..s.size.saturating_sub(15)).step_by(16) {
            let (o, at) = (pe.file_offset(s.rva + r), s.rva + r);
            let relative = |field: usize| at.wrapping_add_signed(b.u32(field).cast_signed().into());
            if b.u32(o + 8) != 0 {
                records.push(FeatureRecord {
                    no_op: relative(o),
                    otherwise: (b.u32(o + 4) != 0).then(|| relative(o + 4)),
                    id: b.u32(o + 8),
                });
            }
        }
    }
    let mut report = replayed.report;
    let _ = writeln!(
        report,
        "stretches of .text that the linker made {made_by_the_linker}; chunks whose section could not be told: {unidentified} bytes, \
         of which code {unidentified_code}; pointers in those, or in no chunk: {pointers_from_the_unknown}"
    );
    Ok(Graph {
        nodes,
        edges,
        records,
        report,
    })
}
