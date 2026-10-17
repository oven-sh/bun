mod bytes;
mod elf;
mod macho;

use bun_collections::index_sort::sort_slice_by_key;
use bun_core::strings;
use core::ops::Range;

use bytes::{slice, slice_mut, u16_at, u32_at, u64_at, usize_at};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    UnrecognizedExecutable,
    InvalidExecutable,
    NoIslands,
    NoSuchFeature,
}

impl Error {
    pub fn name(self) -> &'static str {
        match self {
            Error::UnrecognizedExecutable => "UnrecognizedExecutable",
            Error::InvalidExecutable => "InvalidExecutable",
            Error::NoIslands => "NoIslands",
            Error::NoSuchFeature => "NoSuchFeature",
        }
    }
}

impl core::fmt::Display for Error {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(self.name())
    }
}

impl core::error::Error for Error {}

pub type Result<T> = core::result::Result<T, Error>;

struct Section<'a> {
    name: &'a [u8],
    addresses: Range<u64>,
    offset: usize,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Container {
    Elf,
    MachO,
}

impl Container {
    fn of(file: &[u8]) -> Result<Container> {
        if elf::is(file) {
            Ok(Container::Elf)
        } else if macho::is(file) {
            Ok(Container::MachO)
        } else {
            Err(Error::UnrecognizedExecutable)
        }
    }

    fn is_arm64(self, file: &[u8]) -> Result<bool> {
        match self {
            Container::Elf => elf::is_arm64(file),
            Container::MachO => macho::is_arm64(file),
        }
    }

    fn table_range(self, file: &[u8]) -> Result<Range<usize>> {
        match self {
            Container::Elf => elf_table_range(file),
            Container::MachO => {
                let sections = macho::sections(file)?;
                let section = sections.iter().find(|section| section.name == MACHO_TABLE_SECTION);
                let section = section.ok_or(Error::NoIslands)?;
                let length = (section.addresses.end - section.addresses.start) as usize;
                slice(file, section.offset, length)?;
                Ok(section.offset..section.offset + length)
            }
        }
    }

    fn offset_of(self, file: &[u8], address: u64) -> Result<usize> {
        match self {
            Container::Elf => elf_offset_of(file, address),
            Container::MachO => {
                let sections = macho::sections(file)?;
                let section = sections.iter().find(|section| section.addresses.contains(&address));
                let section = section.ok_or(Error::InvalidExecutable)?;
                Ok(section.offset + (address - section.addresses.start) as usize)
            }
        }
    }

    fn without_pages(self, file: &[u8], dead: &[Range<u64>]) -> Result<Vec<u8>> {
        match self {
            Container::Elf => elf::without_pages(file, dead),
            Container::MachO => macho::without_pages(file, dead),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum WhenShut {
    Exit,
    Return,
}

struct Island {
    addresses: Range<u64>,
    needed_by: Vec<usize>,
}

struct Door {
    addresses: Range<u64>,
    feature: usize,
    when_shut: WhenShut,
}

struct Condition<'a> {
    feature: usize,
    fact: &'a [u8],
}

struct Table<'a> {
    stub: u64,
    features: Vec<&'a [u8]>,
    conditions: Vec<Condition<'a>>,
    islands: Vec<Island>,
    doors: Vec<Door>,
}

const ELF_TABLE_SECTION: &[u8] = b".bun_islands";
const MACHO_TABLE_SECTION: &[u8] = b"__bun_islands";
const SECTION_HEADER: usize = 64;
const PROGRAM_HEADER: usize = 56;
const PT_LOAD: u32 = 1;

fn elf_table_range(file: &[u8]) -> Result<Range<usize>> {
    let (first, count) = (usize_at(file, 0x28)?, usize::from(u16_at(file, 0x3c)?));
    let names = first + usize::from(u16_at(file, 0x3e)?) * SECTION_HEADER;
    let names = slice(file, usize_at(file, names + 24)?, usize_at(file, names + 32)?)?;
    for at in (0..count).map(|index| first + index * SECTION_HEADER) {
        let name = names.get(u32_at(file, at)? as usize..).unwrap_or_default();
        if bytes::fixed_name(name) == ELF_TABLE_SECTION {
            let (offset, size) = (usize_at(file, at + 24)?, usize_at(file, at + 32)?);
            slice(file, offset, size)?;
            return Ok(offset..offset + size);
        }
    }
    Err(Error::NoIslands)
}

fn hexadecimal(text: &[u8]) -> Result<u64> {
    core::str::from_utf8(text)
        .ok()
        .and_then(|text| u64::from_str_radix(text, 16).ok())
        .ok_or(Error::InvalidExecutable)
}

impl<'a> Table<'a> {
    fn parse(text: &'a [u8]) -> Result<Table<'a>> {
        let mut lines = strings::split(text, b"\n");
        if lines.next() != Some(b"bun-islands 1") {
            return Err(Error::NoIslands);
        }
        let mut table = Table {
            stub: 0,
            features: Vec::new(),
            conditions: Vec::new(),
            islands: Vec::new(),
            doors: Vec::new(),
        };
        for line in lines {
            let mut words = strings::split(line, b" ");
            let kind = words.next().unwrap_or_default();
            let mut word = || words.next().ok_or(Error::InvalidExecutable);
            match kind {
                b"stub" => table.stub = hexadecimal(word()?)?,
                b"feature" => table.features.push(word()?),
                b"when" => {
                    let feature = word()?;
                    let fact = line.get(kind.len() + feature.len() + 2..).ok_or(Error::InvalidExecutable)?;
                    table.conditions.push(Condition { feature: table.feature(feature)?, fact });
                }
                b"island" => {
                    let addresses = hexadecimal(word()?)?..hexadecimal(word()?)?;
                    let needed_by = strings::split(word()?, b",")
                        .map(|name| table.feature(name))
                        .collect::<Result<Vec<usize>>>()?;
                    table.islands.push(Island { addresses, needed_by });
                }
                b"door" => {
                    let start = hexadecimal(word()?)?;
                    let addresses = start..bytes::plus(start, hexadecimal(word()?)?)?;
                    let feature = table.feature(word()?)?;
                    let when_shut = match word()? {
                        b"exit" => WhenShut::Exit,
                        b"return" => WhenShut::Return,
                        _ => return Err(Error::InvalidExecutable),
                    };
                    table.doors.push(Door { addresses, feature, when_shut });
                }
                _ => {}
            }
        }
        Ok(table)
    }

    fn feature(&self, name: &[u8]) -> Result<usize> {
        self.features
            .iter()
            .position(|feature| *feature == name)
            .ok_or(Error::InvalidExecutable)
    }
}

fn elf_offset_of(file: &[u8], address: u64) -> Result<usize> {
    let first = usize_at(file, 0x20)?;
    for at in (0..usize::from(u16_at(file, 0x38)?)).map(|index| first + index * PROGRAM_HEADER) {
        let (start, size) = (u64_at(file, at + 16)?, u64_at(file, at + 32)?);
        if u32_at(file, at)? == PT_LOAD && address >= start && address - start < size {
            return Ok((u64_at(file, at + 8)? + (address - start)) as usize);
        }
    }
    Err(Error::InvalidExecutable)
}

fn shut_door(door: &Door, number: usize, stub: u64, is_arm64: bool) -> Result<Vec<u8>> {
    if door.feature >= 1 << 8 || number >= 1 << 24 {
        return Err(Error::InvalidExecutable);
    }
    let door_and_feature = (door.feature | number << 8) as u32;
    let mut code = Vec::new();
    if is_arm64 {
        let distance = (stub as i64 - (door.addresses.start as i64 + 8)) / 4;
        if !(-(1 << 25)..1 << 25).contains(&distance) {
            return Err(Error::InvalidExecutable);
        }
        let words: &[u32] = match door.when_shut {
            WhenShut::Exit => &[
                0x5280_0000 | (door_and_feature & 0xffff) << 5,
                0x72a0_0000 | (door_and_feature >> 16) << 5,
                0x1400_0000 | (distance as u32 & 0x03ff_ffff),
            ],
            WhenShut::Return => &[0x5280_0000, 0xd65f_03c0],
        };
        for word in words {
            code.extend_from_slice(&word.to_le_bytes());
        }
    } else {
        match door.when_shut {
            WhenShut::Exit => {
                let distance = stub as i64 - (door.addresses.start as i64 + 10);
                let distance = i32::try_from(distance).map_err(|_| Error::InvalidExecutable)?;
                code.push(0xbf);
                code.extend_from_slice(&door_and_feature.to_le_bytes());
                code.push(0xe9);
                code.extend_from_slice(&distance.to_le_bytes());
            }
            WhenShut::Return => code.extend_from_slice(&[0x31, 0xc0, 0xc3]),
        }
    }
    if code.len() as u64 > door.addresses.end - door.addresses.start {
        return Err(Error::InvalidExecutable);
    }
    Ok(code)
}

pub fn features(file: &[u8]) -> Result<Vec<&[u8]>> {
    let range = Container::of(file)?.table_range(file)?;
    Ok(Table::parse(&file[range])?.features)
}

pub fn features_unused_by(file: &[u8], facts: &[u8]) -> Result<Vec<Vec<u8>>> {
    let range = Container::of(file)?.table_range(file)?;
    let table = Table::parse(&file[range])?;
    let holds = |fact: &[u8]| {
        strings::split(facts, b"\n").any(|line| match line.strip_suffix(b"*") {
            Some(every) if every.ends_with(b" ") => fact.starts_with(every),
            _ => line == fact,
        })
    };
    let conditions_of = |feature: usize| table.conditions.iter().filter(move |condition| condition.feature == feature);
    Ok((0..table.features.len())
        .filter(|&feature| conditions_of(feature).next().is_some() && !conditions_of(feature).any(|condition| holds(condition.fact)))
        .map(|feature| table.features[feature].to_vec())
        .collect())
}

pub fn without(mut file: Vec<u8>, excluded: &[&[u8]]) -> Result<Vec<u8>> {
    let container = Container::of(&file)?;
    let is_arm64 = container.is_arm64(&file)?;
    let range = container.table_range(&file)?;
    let text = file[range.clone()].to_vec();
    let table = Table::parse(&text)?;
    let mut is_excluded = vec![false; table.features.len()];
    for name in excluded {
        let feature = table.features.iter().position(|feature| feature == name);
        is_excluded[feature.ok_or(Error::NoSuchFeature)?] = true;
    }

    let mut dead: Vec<Range<u64>> = table
        .islands
        .iter()
        .filter(|island| island.needed_by.iter().all(|feature| is_excluded[*feature]))
        .map(|island| island.addresses.clone())
        .collect();
    sort_slice_by_key(&mut dead, |addresses| addresses.start);
    dead.dedup_by(|next, before| {
        let abuts = next.start <= before.end;
        if abuts {
            before.end = before.end.max(next.end);
        }
        abuts
    });

    let trap: &[u8] = if is_arm64 { &[0x20, 0x00, 0x20, 0xd4] } else { &[0xcc] };
    for addresses in &dead {
        let length = (addresses.end - addresses.start) as usize;
        let offset = container.offset_of(&file, addresses.start)?;
        for chunk in slice_mut(&mut file, offset, length)?.chunks_mut(trap.len()) {
            chunk.copy_from_slice(&trap[..chunk.len()]);
        }
    }
    for (number, door) in table.doors.iter().enumerate().filter(|(_, door)| is_excluded[door.feature]) {
        if dead.iter().any(|addresses| addresses.contains(&door.addresses.start)) {
            continue;
        }
        let code = shut_door(door, number, table.stub, is_arm64)?;
        let offset = container.offset_of(&file, door.addresses.start)?;
        slice_mut(&mut file, offset, code.len())?.copy_from_slice(&code);
    }
    file[range].fill(0);
    container.without_pages(&file, &dead)
}
