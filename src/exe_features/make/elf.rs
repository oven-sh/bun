//! ELF, linked by ld.lld with `-Map`, `--thinlto-cache-dir` and `--print-icf-sections`.
//!
//! A node is an input section.

use std::collections::{HashMap, HashSet};

use super::objects::{Object, Objects};
use super::{Data, Graph, Link, Node, Record, Result, fail, find, read_text};

const SHT_RELA: u32 = 4;
const SHT_NOTE: u32 = 7;
const SHT_NOBITS: u32 = 8;
const SHT_INIT_ARRAY: u32 = 14;
const SHT_PREINIT_ARRAY: u32 = 16;
const SHT_SYMTAB_SHNDX: u32 = 18;
const SHF_ALLOC: u64 = 2;
const SHF_MERGE: u64 = 0x10;
const SHF_TLS: u64 = 0x400;
const SHF_GNU_RETAIN: u64 = 0x20_0000;
const SHN_UNDEF: usize = 0;
const SHN_LORESERVE: usize = 0xff00;
const SHN_XINDEX: usize = 0xffff;
const STB_LOCAL: u8 = 0;

/// `address  address  size  align  text`, with the text indented by its level: output section, input section, symbol.
struct MapLine<'a> {
    address: u64,
    size: u64,
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
    let (address, _, size, _) = (column(16)?, column(16)?, column(16)?, column(10)?);
    let text = rest.strip_prefix(' ')?;
    let indent = text.len() - text.trim_start_matches(' ').len();
    Some(MapLine {
        address,
        size,
        indent,
        text: &text[indent..],
    })
}

/// `file:(section)`
fn input_section(text: &str) -> Option<(&str, &str)> {
    let (file, section) = text.strip_suffix(')')?.rsplit_once(":(")?;
    Some((file, section))
}

struct Section<'a> {
    name: &'a str,
    kind: u32,
    flags: u64,
    address: u64,
    offset: usize,
    size: u64,
    link: usize,
    info: usize,
}

fn sections_of(b: Data<'_>) -> Vec<Section<'_>> {
    let first = b.u64(0x28) as usize;
    // Numbers too large for the header are in the first section header.
    let count = if b.u16(0x3c) != 0 {
        u64::from(b.u16(0x3c))
    } else {
        b.u64(first + 32)
    };
    let names = if usize::from(b.u16(0x3e)) == SHN_XINDEX {
        b.u32(first + 40) as usize
    } else {
        usize::from(b.u16(0x3e))
    };
    let names = b.u64(first + names * 64 + 24) as usize;
    (0..count as usize)
        .map(|index| first + index * 64)
        .map(|at| Section {
            name: core::str::from_utf8(b.cstr(names + b.u32(at) as usize)).unwrap_or("?"),
            kind: b.u32(at + 4),
            flags: b.u64(at + 8),
            address: b.u64(at + 16),
            offset: b.u64(at + 24) as usize,
            size: b.u64(at + 32),
            link: b.u32(at + 40) as usize,
            info: b.u32(at + 44) as usize,
        })
        .collect()
}

/// What became of a section of an object file.
#[derive(Clone, Copy, PartialEq)]
enum Placed {
    Node(u32),
    /// Dropped, or not loaded.
    Nowhere,
    /// Merged with others piece by piece: strings, constants. Those refer to nothing and stay.
    Merged,
    /// The object has several of that name and only some were placed.
    OneOfSeveral,
}

/// A name that `__start_` and `__stop_` can be put before. The linker keeps all sections of such a name together.
fn is_c_identifier(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with(|c: char| c.is_ascii_digit())
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// The object files that LTO generated, by the names the map gives them.
///
/// They are in the linker's cache, under names that do not say which is which. (`--save-temps` is there to write them under
/// those of the map. With a cache it writes empty files.) But the map says which sections each of them `contributed`, by name
/// and size, and the one that did has all of those. So where only one has, that is the one.
fn generated_objects<'a>(
    cache: &std::path::Path,
    contributed: &[(&'a str, Vec<(&str, u64)>)],
) -> Result<HashMap<&'a str, Object>> {
    let mut objects: Vec<Option<Object>> = Vec::new();
    for entry in std::fs::read_dir(cache).map_err(|e| format!("{}: {e}", cache.display()))? {
        let entry = entry.map_err(|e| format!("{}: {e}", cache.display()))?;
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with("llvmcache-")
        {
            objects.push(Object::read(&entry.path()).filter(|o| o.bytes().starts_with(b"\x7fELF")));
        }
    }
    let mut has: Vec<HashSet<(&str, u64)>> = Vec::new();
    let mut having: HashMap<(&str, u64), Vec<usize>> = HashMap::new();
    for (index, object) in objects.iter().enumerate() {
        let sections = object
            .as_ref()
            .map(|o| sections_of(Data(o.bytes())))
            .unwrap_or_default();
        has.push(
            sections
                .iter()
                .filter(|s| s.flags & SHF_ALLOC != 0)
                .map(|s| (s.name, s.size))
                .collect(),
        );
        for &section in &has[index] {
            having.entry(section).or_default().push(index);
        }
    }
    let none = Vec::new();
    let mut candidates: Vec<Vec<usize>> = Vec::new();
    for (_, sections) in contributed {
        let rarest = sections
            .iter()
            .map(|s| having.get(s).unwrap_or(&none))
            .min_by_key(|list| list.len())
            .unwrap_or(&none);
        candidates.push(
            rarest
                .iter()
                .copied()
                .filter(|&o| sections.iter().all(|s| has[o].contains(s)))
                .collect(),
        );
    }
    // Each is one file of the map. So one that is spoken for is no candidate for another.
    let mut of_file: Vec<Option<usize>> = vec![None; contributed.len()];
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
    drop((has, having));
    let mut found = HashMap::new();
    for ((file, _), (object, candidates)) in contributed.iter().zip(of_file.iter().zip(&candidates))
    {
        match object.and_then(|o| objects[o].take()) {
            Some(object) => found.insert(*file, object),
            None => fail!(
                "{} entries of the LTO cache may be {file}",
                candidates.len()
            ),
        };
    }
    Ok(found)
}

pub(super) fn graph(link: &Link<'_>, linked: &[u8]) -> Result<Graph> {
    let b = Data(linked);
    let (map, printed) = (read_text(link.map)?, read_text(link.printed)?);
    let outputs = sections_of(b);

    // ---- nodes, and where each input section was placed: file -> section name -> nodes, in the order of the map
    let mut nodes: Vec<Node> = Vec::new();
    let mut files: Vec<&str> = Vec::new();
    let mut placed: HashMap<&str, HashMap<&str, Vec<u32>>> = HashMap::new();
    let mut output: Option<(usize, &Section<'_>)> = None;
    for line in map.lines().filter_map(map_line) {
        match line.indent {
            0 => {
                let is_it = |s: &&Section<'_>| s.name == line.text && s.address == line.address;
                // Thread-local zeroes take no addresses: those it is said to have are those of what follows.
                let is_loaded = |s: &&Section<'_>| {
                    s.flags & SHF_ALLOC != 0 && !(s.flags & SHF_TLS != 0 && s.kind == SHT_NOBITS)
                };
                output = outputs
                    .iter()
                    .enumerate()
                    .find(|(_, s)| is_it(s) && is_loaded(s));
            }
            8 => {
                let (Some((stretch, output)), Some((file, section))) =
                    (output, input_section(line.text))
                else {
                    continue;
                };
                if line.size == 0 {
                    continue;
                }
                // The linker takes the unwind tables apart and puts them together again. They live and die with the functions
                // that they are about, not those with them, so what they refer to is not followed.
                let is_from_an_object = file != "<internal>" && output.name != ".eh_frame";
                if is_from_an_object {
                    if !placed.contains_key(file) {
                        files.push(file);
                    }
                    placed
                        .entry(file)
                        .or_default()
                        .entry(section)
                        .or_default()
                        .push(nodes.len() as u32);
                }
                nodes.push(Node {
                    addresses: line.address..line.address + line.size,
                    stretch: stretch as u32,
                    can_be_left_out: is_from_an_object
                        && matches!(output.name, ".text" | ".rodata"),
                    // What the linker made itself refers to nothing that is known here, and is referred to in ways that are not.
                    is_root: !is_from_an_object,
                    name: None,
                });
            }
            _ => {}
        }
    }

    // ---- sections that identical code folding replaced by an identical one: {file, section} -> the one kept
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

    // ---- the object files: what became of each section, and which node each symbol that others can see is in
    let output_name = link
        .linked
        .file_name()
        .ok_or("the executable has no name")?
        .to_string_lossy();
    let generated_prefix = format!("{output_name}.lto.");
    let is_generated = |file: &str| {
        file.rsplit('/')
            .next()
            .is_some_and(|name| name.starts_with(&generated_prefix))
    };
    let mut contributed: Vec<(&str, Vec<(&str, u64)>)> = Vec::new();
    for &file in files.iter().filter(|f| is_generated(f)) {
        let mut sections = Vec::new();
        for (&name, at) in &placed[file] {
            sections.extend(
                at.iter()
                    .map(|&n| &nodes[n as usize].addresses)
                    .map(|a| (name, a.end - a.start)),
            );
        }
        contributed.push((file, sections));
    }
    let mut generated = generated_objects(link.lto_cache, &contributed)?;
    let mut archives = Objects::default();
    let mut loaded: Vec<(&str, Object)> = Vec::new();
    for &file in &files {
        let object = if is_generated(file) {
            generated.remove(file)
        } else {
            archives.get(file)
        };
        match object.filter(|o| o.bytes().starts_with(b"\x7fELF")) {
            Some(object) => loaded.push((file, object)),
            None => fail!("an object file of the link is not there: {file}"),
        }
    }
    struct Parsed<'a> {
        file: &'a str,
        b: Data<'a>,
        sections: Vec<Section<'a>>,
        placed: Vec<Placed>,
    }
    let mut objects: Vec<Parsed<'_>> = Vec::new();
    let mut seen_by_all: HashMap<&[u8], Vec<u32>> = HashMap::new();
    for (file, object) in &loaded {
        let (file, b) = (*file, Data(object.bytes()));
        let sections = sections_of(b);
        let is_content = |s: &Section<'_>| s.flags & SHF_ALLOC != 0 && s.size != 0;
        let mut copies: HashMap<&str, usize> = HashMap::new();
        for s in sections.iter().filter(|s| is_content(s)) {
            *copies.entry(s.name).or_default() += 1;
        }
        let mut seen: HashMap<&str, usize> = HashMap::new();
        let mut became = Vec::new();
        for s in &sections {
            became.push(if !is_content(s) {
                Placed::Nowhere
            } else if s.flags & SHF_MERGE != 0 && !placed[file].contains_key(s.name) {
                Placed::Merged
            } else if let Some(at) = placed[file].get(s.name) {
                let nth = seen.entry(s.name).or_default();
                *nth += 1;
                if copies[s.name] == at.len() {
                    Placed::Node(at[*nth - 1])
                } else {
                    Placed::OneOfSeveral
                }
            } else {
                match folded
                    .get(&(file, s.name))
                    .and_then(|(file, section)| placed.get(file)?.get(section))
                    .map(|at| &at[..])
                {
                    Some(&[one]) => Placed::Node(one),
                    Some(_) => Placed::OneOfSeveral,
                    None => Placed::Nowhere,
                }
            });
        }
        for (s, became) in sections.iter().zip(&became) {
            let Placed::Node(node) = *became else {
                continue;
            };
            let node = &mut nodes[node as usize];
            if placed[file].contains_key(s.name)
                && node.addresses.end - node.addresses.start != s.size
            {
                fail!(
                    "{file}:({}) has {} bytes, and {} where the map says it is",
                    s.name,
                    s.size,
                    node.addresses.end - node.addresses.start
                );
            }
            // What the linker keeps whether or not anything refers to it.
            node.is_root |= matches!(s.kind, SHT_NOTE | SHT_INIT_ARRAY..=SHT_PREINIT_ARRAY)
                || s.flags & SHF_GNU_RETAIN != 0
                || [".init", ".fini", ".ctors", ".dtors"].iter().any(|n| {
                    s.name == *n || s.name.strip_prefix(n).is_some_and(|r| r.starts_with('.'))
                })
                || is_c_identifier(s.name);
        }
        objects.push(Parsed {
            file,
            b,
            sections,
            placed: became,
        });
    }
    /// {name, is it seen only in its object, number of its section}
    fn symbol<'a>(o: &Parsed<'a>, symbols: &Section<'a>, index: usize) -> (&'a [u8], bool, usize) {
        let at = symbols.offset + index * 24;
        let number = match (
            usize::from(o.b.u16(at + 6)),
            o.sections.iter().find(|s| s.kind == SHT_SYMTAB_SHNDX),
        ) {
            (SHN_XINDEX, Some(extended)) => o.b.u32(extended.offset + index * 4) as usize,
            (number, _) => number,
        };
        (
            o.b.cstr(o.sections[symbols.link].offset + o.b.u32(at) as usize),
            o.b.u8(at + 4) >> 4 == STB_LOCAL,
            number,
        )
    }
    let is_a_section = |number: usize, o: &Parsed<'_>| {
        number != SHN_UNDEF
            && (number < SHN_LORESERVE || number >= 0x1_0000)
            && number < o.sections.len()
    };
    for o in &objects {
        for symbols in o.sections.iter().filter(|s| s.kind == 2) {
            for index in 1..(symbols.size / 24) as usize {
                let (name, is_local, number) = symbol(o, symbols, index);
                if !is_a_section(number, o) || name.is_empty() {
                    continue;
                }
                let Placed::Node(node) = o.placed[number] else {
                    continue;
                };
                if !is_local {
                    // Of a definition that several objects have, the linker as a rule placed one. Else it may be any of them.
                    let nodes = seen_by_all.entry(name).or_default();
                    if !nodes.contains(&node) {
                        nodes.push(node);
                    }
                }
                // The map has names too, but not as the linker takes them. An object or a function: on arm64 every section
                // starts with a `$x` or a `$d` as well, which says whether it is code.
                let at = symbols.offset + index * 24;
                let is_at_the_start = o.b.u64(at + 8) == 0 && matches!(o.b.u8(at + 4) & 15, 1 | 2);
                if is_at_the_start
                    && nodes[node as usize].name.is_none()
                    && placed[o.file].contains_key(o.sections[number].name)
                {
                    nodes[node as usize].name = Some(name.iter().map(|&c| char::from(c)).collect());
                }
            }
        }
    }

    // ---- edges
    let mut edges: Vec<(u32, u32)> = Vec::new();
    let (mut relocations, mut elsewhere) = (0u64, 0u64);
    for o in &objects {
        for list in o.sections.iter().filter(|s| s.kind == SHT_RELA) {
            let from = match o.placed[list.info] {
                Placed::Node(from) => from,
                Placed::OneOfSeveral => fail!(
                    "{}: which of several ({}) is where cannot be told",
                    o.file,
                    o.sections[list.info].name
                ),
                Placed::Nowhere | Placed::Merged => continue,
            };
            // An identical section that was folded into this one refers to the same.
            if !placed[o.file].contains_key(o.sections[list.info].name) {
                continue;
            }
            let symbols = &o.sections[list.link];
            for at in (list.offset..list.offset + list.size as usize).step_by(24) {
                relocations += 1;
                let (name, is_local, number) = symbol(o, symbols, (o.b.u64(at + 8) >> 32) as usize);
                let own;
                let to: &[u32] = if is_local {
                    if !is_a_section(number, o) {
                        continue;
                    }
                    match o.placed[number] {
                        Placed::Node(to) => {
                            own = [to];
                            &own
                        }
                        Placed::OneOfSeveral => fail!(
                            "{}: which of several ({}) is where cannot be told",
                            o.file,
                            o.sections[number].name
                        ),
                        Placed::Nowhere | Placed::Merged => &[],
                    }
                } else {
                    seen_by_all.get(name).map_or(&[], |nodes| &nodes[..])
                };
                edges.extend(to.iter().map(|&to| (from, to)));
                // imported, made by the linker, thread-local zeroes, merged
                elsewhere += u64::from(to.is_empty());
            }
        }
    }

    // ---- what is reached from outside
    let mut root = |address: u64| {
        if let Some(node) = find(&nodes, address) {
            nodes[node as usize].is_root = true;
        }
    };
    root(b.u64(0x18));
    for exported in outputs.iter().filter(|s| s.kind == 11) {
        for at in (exported.offset..exported.offset + exported.size as usize).step_by(24) {
            if b.u16(at + 6) != 0 {
                root(b.u64(at + 8));
            }
        }
    }

    // ---- records: {no-op, other side or 0, id, 0}. Those of what the linker dropped read 0.
    let mut records = Vec::new();
    for s in outputs.iter().filter(|s| s.name == ".bun_features") {
        for at in (s.offset..s.offset + s.size as usize).step_by(24) {
            if b.u64(at) != 0 {
                records.push(Record {
                    no_op: b.u64(at),
                    otherwise: Some(b.u64(at + 8)).filter(|&o| o != 0),
                    id: b.u32(at + 16),
                });
            }
        }
    }
    let report = format!(
        "objects {}, relocations {relocations}, of which to what is no node {elsewhere}\n",
        objects.len()
    );
    Ok(Graph {
        nodes,
        edges,
        records,
        report,
    })
}
