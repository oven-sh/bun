mod bytes;
mod elf;
mod icu_data;
mod macho;
mod pe;

use bun_collections::index_sort::sort_slice_by_key;
use core::ops::Range;

use bytes::{put_u32, put_u64, slice, slice_mut, u16_at, u32_at, u64_at, usize_at};

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
    Pe,
}

impl Container {
    fn of(file: &[u8]) -> Result<Container> {
        if elf::is(file) {
            Ok(Container::Elf)
        } else if macho::is(file) {
            Ok(Container::MachO)
        } else if pe::is(file) {
            Ok(Container::Pe)
        } else {
            Err(Error::UnrecognizedExecutable)
        }
    }

    fn is_arm64(self, file: &[u8]) -> Result<bool> {
        match self {
            Container::Elf => elf::is_arm64(file),
            Container::MachO => macho::is_arm64(file),
            Container::Pe => pe::is_arm64(file),
        }
    }

    fn sections(self, file: &[u8]) -> Result<Vec<Section<'_>>> {
        match self {
            Container::Elf => Err(Error::InvalidExecutable),
            Container::MachO => macho::sections(file),
            Container::Pe => pe::sections(file),
        }
    }

    fn table_range(self, file: &[u8]) -> Result<Range<usize>> {
        let name = match self {
            Container::Elf => return elf_table_range(file),
            Container::MachO => MACHO_TABLE_SECTION,
            Container::Pe => PE_TABLE_SECTION,
        };
        let sections = self.sections(file)?;
        let section = sections.iter().find(|section| section.name == name);
        let section = section.ok_or(Error::NoIslands)?;
        let length = (section.addresses.end - section.addresses.start) as usize;
        slice(file, section.offset, length)?;
        Ok(section.offset..section.offset + length)
    }

    fn offset_of(self, file: &[u8], address: u64) -> Result<usize> {
        if self == Container::Elf {
            return elf_offset_of(file, address);
        }
        let sections = self.sections(file)?;
        let section = sections.iter().find(|section| section.addresses.contains(&address));
        let section = section.ok_or(Error::InvalidExecutable)?;
        Ok(section.offset + (address - section.addresses.start) as usize)
    }

    fn is_code(self, file: &[u8], addresses: &Range<u64>) -> Result<bool> {
        match self {
            Container::Elf => elf_is_code(file, addresses),
            Container::MachO => Ok(macho::sections(file)?.iter().any(|section| {
                section.name == MACHO_CODE_SECTION && section.addresses.start <= addresses.start && addresses.end <= section.addresses.end
            })),
            Container::Pe => Ok(false),
        }
    }

    fn has_fixups(self, file: &[u8], addresses: &Range<u64>) -> Result<bool> {
        match self {
            Container::MachO => Ok(!macho::is_in_text(file, addresses)?),
            Container::Elf | Container::Pe => Ok(false),
        }
    }

    fn without_pages(self, file: &[u8], dead: &[Range<u64>]) -> Result<Vec<u8>> {
        match self {
            Container::Elf => elf::without_pages(file, dead),
            Container::MachO => macho::without_pages(file, dead),
            Container::Pe => pe::without_pages(file, dead),
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

#[derive(Clone, Copy, PartialEq, Eq)]
enum PlaceKind {
    Add32,
    Add64,
    Branch26,
    Page21,
    Low12,
    Adr,
    Pointer36,
    Nop,
}

const PLACE_KINDS: [PlaceKind; 8] = [
    PlaceKind::Add32,
    PlaceKind::Add64,
    PlaceKind::Branch26,
    PlaceKind::Page21,
    PlaceKind::Low12,
    PlaceKind::Adr,
    PlaceKind::Pointer36,
    PlaceKind::Nop,
];

struct Place {
    address: u64,
    kind: PlaceKind,
}

struct Door {
    addresses: Range<u64>,
    feature: usize,
    when_shut: WhenShut,
    places: Vec<Place>,
}

struct Items {
    entries: Range<usize>,
    needed_by: Vec<usize>,
}

struct Package {
    addresses: Range<u64>,
    items: Vec<Items>,
}

struct Condition<'a> {
    feature: usize,
    kind: &'a [u8],
    name: &'a [u8],
}

struct Table<'a> {
    stub: u64,
    features: Vec<&'a [u8]>,
    conditions: Vec<Condition<'a>>,
    islands: Vec<Island>,
    doors: Vec<Door>,
    packages: Vec<Package>,
}

const ELF_TABLE_SECTION: &[u8] = b".bun_islands";
const MACHO_TABLE_SECTION: &[u8] = b"__bun_islands";
const MACHO_CODE_SECTION: &[u8] = b"__text";
const PE_TABLE_SECTION: &[u8] = b".bunisl";
const SECTION_HEADER: usize = 64;
const PROGRAM_HEADER: usize = 56;
const PT_LOAD: u32 = 1;
const PF_X: u32 = 1;

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

const TABLE_HEADER: &[u8] = b"bun-islands 2\n";

struct Reader<'a> {
    rest: &'a [u8],
}

impl<'a> Reader<'a> {
    fn number(&mut self) -> Result<u64> {
        let mut value = 0;
        for shift in (0..u64::BITS).step_by(7) {
            let (&byte, rest) = self.rest.split_first().ok_or(Error::InvalidExecutable)?;
            self.rest = rest;
            let bits = u64::from(byte & 0x7f);
            if bits << shift >> shift != bits || (byte == 0 && shift > 0) {
                return Err(Error::InvalidExecutable);
            }
            value |= bits << shift;
            if byte < 0x80 {
                return Ok(value);
            }
        }
        Err(Error::InvalidExecutable)
    }

    fn count(&mut self) -> Result<usize> {
        match self.number()? {
            count if count <= self.rest.len() as u64 => Ok(count as usize),
            _ => Err(Error::InvalidExecutable),
        }
    }

    fn text(&mut self) -> Result<&'a [u8]> {
        let length = self.count()?;
        let (text, rest) = self.rest.split_at(length);
        self.rest = rest;
        Ok(text)
    }

    fn list<T>(&mut self, mut item: impl FnMut(&mut Self) -> Result<T>) -> Result<Vec<T>> {
        (0..self.count()?).map(|_| item(self)).collect()
    }

    fn index_in<T>(&mut self, items: &[T]) -> Result<usize> {
        match self.number()? {
            index if index < items.len() as u64 => Ok(index as usize),
            _ => Err(Error::InvalidExecutable),
        }
    }
}

impl<'a> Table<'a> {
    fn parse(bytes: &'a [u8]) -> Result<Table<'a>> {
        let mut reader = Reader { rest: bytes.strip_prefix(TABLE_HEADER).ok_or(Error::NoIslands)? };
        let stub = reader.number()?;
        let smallest_door = [(WhenShut::Exit, reader.number()?), (WhenShut::Return, reader.number()?)];
        let features = reader.list(Reader::text)?;
        let kinds = reader.list(Reader::text)?;
        let facts = reader.list(|reader| Ok((kinds[reader.index_in(&kinds)?], reader.text()?)))?;
        let mut conditions = Vec::new();
        for feature in 0..features.len() {
            for _ in 0..reader.count()? {
                let (kind, name) = facts[reader.index_in(&facts)?];
                conditions.push(Condition { feature, kind, name });
            }
        }
        let sets = reader.list(|reader| reader.list(|reader| reader.index_in(&features)))?;
        if sets.iter().any(Vec::is_empty) {
            return Err(Error::InvalidExecutable);
        }
        let mut end = 0;
        let islands = reader.list(|reader| {
            let start = bytes::plus(end, reader.number()?)?;
            end = bytes::plus(bytes::plus(start, reader.number()?)?, 1)?;
            Ok(Island { addresses: start..end, needed_by: sets[reader.index_in(&sets)?].clone() })
        })?;
        let mut doors = Vec::new();
        for feature in 0..features.len() {
            for (when_shut, smallest) in smallest_door {
                let mut start = 0;
                for _ in 0..reader.count()? {
                    start = bytes::plus(start, reader.number()?)?;
                    doors.push(Door { addresses: start..bytes::plus(start, smallest)?, feature, when_shut, places: Vec::new() });
                }
            }
        }
        let thin = reader.count()?;
        let unit = if thin > 0 { reader.number()? } else { 1 };
        if unit != 1 && unit != 4 {
            return Err(Error::InvalidExecutable);
        }
        let (mut next, mut last_first) = (0, 0u64);
        for _ in 0..thin {
            let head = reader.number()?;
            let number = bytes::plus(next, head >> 2)?;
            let door = usize::try_from(number).ok().and_then(|number| doors.get_mut(number)).ok_or(Error::InvalidExecutable)?;
            let more = if head & 3 < 3 { (head & 3) as usize } else { reader.count()? + 3 };
            let mut address = last_first;
            for index in 0..=more {
                let field = reader.number()?;
                let steps = field >> 3;
                let times_unit = |steps: u64| steps.checked_mul(unit).ok_or(Error::InvalidExecutable);
                address = if index > 0 {
                    ensure(steps > 0)?;
                    bytes::plus(address, times_unit(steps)?)?
                } else if steps & 1 == 0 {
                    bytes::plus(address, times_unit(steps / 2)?)?
                } else {
                    bytes::minus(address, times_unit(steps / 2 + 1)?)?
                };
                door.places.push(Place { address, kind: PLACE_KINDS[(field & 7) as usize] });
            }
            groups_of(&door.places).try_for_each(|group| group.map(|_| ()))?;
            last_first = door.places[0].address;
            next = number + 1;
        }
        let mut packages = Vec::new();
        for _ in 0..if reader.rest.is_empty() { 0 } else { reader.count()? } {
            let start = reader.number()?;
            let addresses = start..bytes::plus(start, reader.number()?)?;
            let mut next = 0;
            let items = reader.list(|reader| {
                let first = bytes::plus(next, reader.number()?)?;
                next = bytes::plus(bytes::plus(first, reader.number()?)?, 1)?;
                Ok(Items { entries: first as usize..next as usize, needed_by: sets[reader.index_in(&sets)?].clone() })
            })?;
            packages.push(Package { addresses, items });
        }
        if reader.rest.iter().any(|&byte| byte != 0) {
            return Err(Error::InvalidExecutable);
        }
        Ok(Table { stub, features, conditions, islands, doors, packages })
    }
}

fn elf_segment_of(file: &[u8], address: u64) -> Result<usize> {
    let first = usize_at(file, 0x20)?;
    for at in (0..usize::from(u16_at(file, 0x38)?)).map(|index| first + index * PROGRAM_HEADER) {
        let (start, size) = (u64_at(file, at + 16)?, u64_at(file, at + 32)?);
        if u32_at(file, at)? == PT_LOAD && address >= start && address - start < size {
            return Ok(at);
        }
    }
    Err(Error::InvalidExecutable)
}

fn elf_offset_of(file: &[u8], address: u64) -> Result<usize> {
    let segment = elf_segment_of(file, address)?;
    Ok((u64_at(file, segment + 8)? + (address - u64_at(file, segment + 16)?)) as usize)
}

fn elf_is_code(file: &[u8], addresses: &Range<u64>) -> Result<bool> {
    let segment = elf_segment_of(file, addresses.start)?;
    let fits = addresses.end - u64_at(file, segment + 16)? <= u64_at(file, segment + 32)?;
    Ok(fits && u32_at(file, segment + 4)? & PF_X != 0)
}

fn shut_door(door: &Door, number: usize, stub: u64, container: Container, is_arm64: bool) -> Result<Vec<u8>> {
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
                code.push(if container == Container::Pe { 0xb9 } else { 0xbf });
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

fn stub_size(when_shut: WhenShut, is_arm64: bool) -> u64 {
    match (when_shut, is_arm64) {
        (WhenShut::Exit, true) => 12,
        (WhenShut::Return, true) => 8,
        (WhenShut::Exit, false) => 10,
        (WhenShut::Return, false) => 3,
    }
}

fn ensure(holds: bool) -> Result<()> {
    if holds { Ok(()) } else { Err(Error::InvalidExecutable) }
}

fn sign_extended(field: u32, bits: u32) -> i64 {
    i64::from(((field << (32 - bits)) as i32) >> (32 - bits))
}

fn as_field(value: i64, bits: u32) -> Result<u32> {
    ensure((-(1 << (bits - 1))..1 << (bits - 1)).contains(&value))?;
    Ok(value as u32 & ((1 << bits) - 1))
}

const ADR: u32 = 0x1000_0000;
const ADRP: u32 = 0x9000_0000;
const ADD: u32 = 0x9100_0000;
const NOP: u32 = 0xd503_201f;

fn immediate21(word: u32) -> i64 {
    sign_extended((((word >> 5) & 0x7_ffff) << 2) | ((word >> 29) & 3), 21)
}

fn with_immediate21(word: u32, immediate: i64) -> Result<u32> {
    let immediate = as_field(immediate, 21)?;
    Ok((word & 0x9f00_001f) | ((immediate & 3) << 29) | ((immediate >> 2) << 5))
}

fn redirect(file: &mut [u8], offset: usize, place: &Place, door: u64, stub: u64) -> Result<()> {
    const POINTER_TARGET: u64 = (1 << 36) - 1;
    let delta = stub.wrapping_sub(door) as i64;
    let distance_to = |target: u64| target.wrapping_sub(place.address) as i64;
    let pages_to = |target: u64| ((target & !0xfff).wrapping_sub(place.address & !0xfff) as i64) >> 12;
    match place.kind {
        PlaceKind::Add32 => {
            let value = i64::from(u32_at(file, offset)? as i32).checked_add(delta).and_then(|value| i32::try_from(value).ok());
            put_u32(file, offset, value.ok_or(Error::InvalidExecutable)? as u32)
        }
        PlaceKind::Add64 => {
            let value = u64_at(file, offset)?.checked_add_signed(delta);
            put_u64(file, offset, value.ok_or(Error::InvalidExecutable)?)
        }
        PlaceKind::Pointer36 => {
            let value = u64_at(file, offset)?;
            let target = (value & POINTER_TARGET).checked_add_signed(delta).ok_or(Error::InvalidExecutable)?;
            ensure(value >> 63 == 0 && target <= POINTER_TARGET)?;
            put_u64(file, offset, (value & !POINTER_TARGET) | target)
        }
        PlaceKind::Branch26 => {
            let word = u32_at(file, offset)?;
            ensure(word & 0x7c00_0000 == 0x1400_0000 && sign_extended(word, 26) * 4 == distance_to(door) && distance_to(stub) % 4 == 0)?;
            put_u32(file, offset, (word & 0xfc00_0000) | as_field(distance_to(stub) / 4, 26)?)
        }
        PlaceKind::Page21 => {
            let word = u32_at(file, offset)?;
            ensure(word & 0x9f00_0000 == ADRP && immediate21(word) == pages_to(door))?;
            put_u32(file, offset, with_immediate21(word, pages_to(stub))?)
        }
        PlaceKind::Low12 => {
            let word = u32_at(file, offset)?;
            ensure(word & 0xffc0_0000 == ADD && u64::from((word >> 10) & 0xfff) == door & 0xfff)?;
            put_u32(file, offset, (word & 0xffc0_03ff) | (((stub & 0xfff) as u32) << 10))
        }
        PlaceKind::Adr | PlaceKind::Nop => Err(Error::InvalidExecutable),
    }
}

fn unrelax(file: &mut [u8], offsets: [usize; 2], places: &[Place], door: u64, stub: u64) -> Result<()> {
    let adr = usize::from(places[0].kind != PlaceKind::Adr);
    let word = u32_at(file, offsets[adr])?;
    let points_at = places[adr].address.wrapping_add_signed(immediate21(word));
    ensure(word & 0x9f00_0000 == ADR && points_at == door && u32_at(file, offsets[1 - adr])? == NOP)?;
    let register = word & 0x1f;
    let pages = ((stub & !0xfff).wrapping_sub(places[0].address & !0xfff) as i64) >> 12;
    put_u32(file, offsets[0], with_immediate21(ADRP | register, pages)?)?;
    put_u32(file, offsets[1], ADD | (((stub & 0xfff) as u32) << 10) | (register << 5) | register)
}

fn groups_of(places: &[Place]) -> impl Iterator<Item = Result<&[Place]>> {
    let mut rest = places;
    core::iter::from_fn(move || {
        let first = rest.first()?;
        let other = match first.kind {
            PlaceKind::Adr => Some(PlaceKind::Nop),
            PlaceKind::Nop => Some(PlaceKind::Adr),
            _ => None,
        };
        if other.is_some() && rest.get(1).map(|place| place.kind) != other {
            rest = &[];
            return Some(Err(Error::InvalidExecutable));
        }
        let (group, after) = rest.split_at(if other.is_some() { 2 } else { 1 });
        rest = after;
        Some(Ok(group))
    })
}

fn shut_thin_doors(
    file: &mut [u8],
    container: Container,
    is_arm64: bool,
    table: &Table,
    is_excluded: &[bool],
    dead: &[Range<u64>],
) -> Result<Option<Range<u64>>> {
    let thin = || table.doors.iter().enumerate().filter(|(_, door)| is_excluded[door.feature] && !door.places.is_empty());
    let count_of = |when_shut: WhenShut| thin().filter(|(_, door)| door.when_shut == when_shut).count() as u64;
    let exit_stubs = count_of(WhenShut::Exit) * stub_size(WhenShut::Exit, is_arm64);
    let length = exit_stubs + count_of(WhenShut::Return).min(1) * stub_size(WhenShut::Return, is_arm64);
    if length == 0 {
        return Ok(None);
    }
    let mut strip = None;
    for addresses in dead {
        let start = addresses.start.checked_next_multiple_of(4).ok_or(Error::InvalidExecutable)?;
        let candidate = start..bytes::plus(start, length)?;
        if candidate.end <= addresses.end && container.is_code(file, &candidate)? {
            strip = Some(candidate);
            break;
        }
    }
    let strip = strip.ok_or(Error::InvalidExecutable)?;
    let mut next_exit_stub = strip.start;
    for (number, door) in thin() {
        let size = stub_size(door.when_shut, is_arm64);
        let start = if door.when_shut == WhenShut::Exit { next_exit_stub } else { strip.start + exit_stubs };
        if door.when_shut == WhenShut::Exit {
            next_exit_stub += size;
        }
        let stub = Door { addresses: start..start + size, feature: door.feature, when_shut: door.when_shut, places: Vec::new() };
        let code = shut_door(&stub, number, table.stub, container, is_arm64)?;
        let offset = container.offset_of(file, start)?;
        slice_mut(file, offset, code.len())?.copy_from_slice(&code);
        for group in groups_of(&door.places) {
            let group = group?;
            if dead.iter().any(|addresses| addresses.contains(&group[0].address)) {
                continue;
            }
            let offset = container.offset_of(file, group[0].address)?;
            match group.get(1) {
                Some(later) => unrelax(file, [offset, container.offset_of(file, later.address)?], group, door.addresses.start, start)?,
                None => redirect(file, offset, &group[0], door.addresses.start, start)?,
            }
        }
    }
    Ok(Some(strip))
}

pub fn features(file: &[u8]) -> Result<Vec<&[u8]>> {
    let range = Container::of(file)?.table_range(file)?;
    Ok(Table::parse(&file[range])?.features)
}

const KINDS_OF_FACTS: [&[u8]; 9] = [b"world", b"global", b"Bun", b"process", b"console", b"module", b"native", b"loader", b"property"];

pub fn features_unused_by(file: &[u8], facts: &[u8]) -> Result<Vec<Vec<u8>>> {
    let range = Container::of(file)?.table_range(file)?;
    let table = Table::parse(&file[range])?;
    Ok(unused_by(&table, facts).into_iter().map(|feature| table.features[feature].to_vec()).collect())
}

fn unused_by(table: &Table, facts: &[u8]) -> Vec<usize> {
    let follows_a_feature = |condition: &&Condition| condition.kind == b"feature";
    let holds = |condition: &Condition| {
        !follows_a_feature(&condition)
            && (!KINDS_OF_FACTS.contains(&condition.kind)
                || facts
                    .split(|&byte| byte == b'\n')
                    .filter_map(|line| line.strip_prefix(condition.kind)?.strip_prefix(b" "))
                    .any(|name| name == b"*" || name == condition.name))
    };
    let conditions_of = |feature: usize| table.conditions.iter().filter(move |condition| condition.feature == feature);
    let mut is_kept: Vec<bool> = (0..table.features.len()).map(|feature| conditions_of(feature).next().is_none() || conditions_of(feature).any(holds)).collect();
    loop {
        let mut has_grown = false;
        for condition in table.conditions.iter().filter(follows_a_feature) {
            let followed = table.features.iter().position(|name| *name == condition.name);
            if !is_kept[condition.feature] && followed.is_none_or(|feature| is_kept[feature]) {
                is_kept[condition.feature] = true;
                has_grown = true;
            }
        }
        if !has_grown {
            break;
        }
    }
    (0..table.features.len()).filter(|&feature| !is_kept[feature]).collect()
}

fn shut(file: &mut [u8], container: Container, is_arm64: bool, table: &Table, is_excluded: &[bool]) -> Result<Vec<Range<u64>>> {
    let mut dead: Vec<Range<u64>> = table
        .islands
        .iter()
        .filter(|island| island.needed_by.iter().all(|feature| is_excluded[*feature]))
        .map(|island| island.addresses.clone())
        .collect();
    for package in &table.packages {
        let is_left_out = |items: &&Items| items.needed_by.iter().all(|feature| is_excluded[*feature]);
        let left_out: Vec<&Range<usize>> = package.items.iter().filter(is_left_out).map(|items| &items.entries).collect();
        if left_out.is_empty() {
            continue;
        }
        let length = (package.addresses.end - package.addresses.start) as usize;
        let offset = container.offset_of(file, package.addresses.start)?;
        let bytes = slice_mut(file, offset, length)?;
        let kept = icu_data::without_items(bytes, |entry| left_out.iter().any(|entries| entries.contains(&entry)))?;
        dead.push(package.addresses.start + kept as u64..package.addresses.end);
    }
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
        if container.has_fixups(file, addresses)? {
            continue;
        }
        let length = (addresses.end - addresses.start) as usize;
        let offset = container.offset_of(file, addresses.start)?;
        for chunk in slice_mut(file, offset, length)?.chunks_mut(trap.len()) {
            chunk.copy_from_slice(&trap[..chunk.len()]);
        }
    }
    let strip = shut_thin_doors(file, container, is_arm64, table, is_excluded, &dead)?;
    for (number, door) in table.doors.iter().enumerate().filter(|(_, door)| is_excluded[door.feature] && door.places.is_empty()) {
        if dead.iter().any(|addresses| addresses.contains(&door.addresses.start)) {
            continue;
        }
        let code = shut_door(door, number, table.stub, container, is_arm64)?;
        let offset = container.offset_of(file, door.addresses.start)?;
        slice_mut(file, offset, code.len())?.copy_from_slice(&code);
    }
    if let Some(strip) = strip {
        for addresses in dead.iter_mut().filter(|addresses| addresses.contains(&strip.start)) {
            addresses.start = strip.end;
        }
    }
    Ok(dead)
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
    let dead = shut(&mut file, container, is_arm64, &table, &is_excluded)?;
    file[range].fill(0);
    container.without_pages(&file, &dead)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SMALL: [&[u8]; 10] = [
        TABLE_HEADER,
        b"\xb4\xa4\x80\x01\x0c\x08",
        b"\x03\x05tools\x03jit\x04text",
        b"\x02\x05world\x03Bun",
        b"\x02\x00\x04open\x01\x0aTranspiler",
        b"\x00\x01\x00\x02\x00\x01",
        b"\x02\x01\x00\x02\x00\x01",
        b"\x03\x80\x80\x81\x01\xff\x7f\x00\x00\x8f\x80\x01\x01\xf0\xff\x3c\xff\x7f\x00",
        b"\x02\x80\xa0\x80\x01\x80\x01\x00\x00\x01\x80\xa2\x80\x01\x01\x80\xa4\x80\x01\x00",
        b"\x02\x01\x06\x90\xe0\x84\x10\x80\xd0\x07\xb9\x80\xf6\x07\x00\x80\x02",
    ];

    fn error_of(table: &[u8]) -> Option<Error> {
        Table::parse(table).err()
    }

    fn with_part(index: usize, part: &[u8]) -> Vec<u8> {
        let mut parts = SMALL;
        parts[index] = part;
        parts.concat()
    }

    fn places_of(door: &Door) -> Vec<(u64, usize)> {
        let number_of = |kind: PlaceKind| PLACE_KINDS.iter().position(|other| *other == kind).unwrap();
        door.places.iter().map(|place| (place.address, number_of(place.kind))).collect()
    }

    fn with_stub(stub: &[u8]) -> Vec<u8> {
        [TABLE_HEADER, stub, &[0; 32]].concat()
    }

    #[test]
    fn reads_what_the_link_writes() {
        let bytes = SMALL.concat();
        let table = Table::parse(&bytes).unwrap();
        assert_eq!(table.stub, 0x201234);
        assert_eq!(table.features, [&b"tools"[..], b"jit", b"text"]);
        let conditions: Vec<_> = table.conditions.iter().map(|condition| (condition.feature, condition.kind, condition.name)).collect();
        assert_eq!(conditions, [(1, &b"world"[..], &b"open"[..]), (2, b"world", b"open"), (2, b"Bun", b"Transpiler")]);
        let islands: Vec<_> = table.islands.iter().map(|island| (island.addresses.clone(), island.needed_by.clone())).collect();
        assert_eq!(islands, [(0x204000..0x208000, vec![0]), (0x208000..0x20c010, vec![0, 1]), (0x300000..0x304000, vec![0])]);
        let doors: Vec<_> = table.doors.iter().map(|door| (door.addresses.clone(), door.feature, door.when_shut == WhenShut::Exit)).collect();
        assert_eq!(doors, [(0x201000..0x20100c, 0, true), (0x201080..0x20108c, 0, true), (0x201100..0x201108, 1, false), (0x201200..0x20120c, 2, true)]);
        assert_eq!(places_of(&table.doors[0]), []);
        assert_eq!(places_of(&table.doors[1]), [(0x201301, 0), (0x205001, 0), (0x400008, 1)]);
        assert_eq!(places_of(&table.doors[2]), [(0x201311, 0)]);
        assert_eq!(places_of(&table.doors[3]), []);
    }

    #[test]
    fn reads_the_packages_behind_the_doors() {
        const PACKAGES: &[u8] = b"\x01\x80\x80\x80\x02\x90\x80\x20\x03\x02\x02\x00\x00\x00\x01\xc2\x01\xab\x02\x00";
        let bytes = [&SMALL.concat(), PACKAGES].concat();
        let table = Table::parse(&bytes).unwrap();
        assert_eq!(table.packages.len(), 1);
        assert_eq!(table.packages[0].addresses, 0x400000..0x480010);
        let items: Vec<_> = table.packages[0].items.iter().map(|items| (items.entries.clone(), items.needed_by.clone())).collect();
        assert_eq!(items, [(2..5, vec![0]), (5..6, vec![0, 1]), (200..500, vec![0])]);
        assert!(Table::parse(&SMALL.concat()).unwrap().packages.is_empty());
        for length in bytes.len() - PACKAGES.len() + 1..bytes.len() {
            assert_eq!(error_of(&bytes[..length]), Some(Error::InvalidExecutable), "{length}");
        }
        let with_packages = |packages: &[u8]| error_of(&[&SMALL.concat(), packages].concat());
        let last = b"\xfe\xff\xff\xff\xff\xff\xff\xff\xff\x01";
        assert_eq!(with_packages(b"\x01\x00\x00\x01\x00\x00\x01"), None);
        assert_eq!(with_packages(b"\x01\x00\x00\x01\x00\x00\x02"), Some(Error::InvalidExecutable));
        assert_eq!(with_packages(&[b"\x01", &last[..], b"\x01\x00"].concat()), None);
        assert_eq!(with_packages(&[b"\x01", &last[..], b"\x02\x00"].concat()), Some(Error::InvalidExecutable));
        assert_eq!(with_packages(&[b"\x01\x00\x00\x01", &last[..], b"\x00\x00"].concat()), None);
        assert_eq!(with_packages(&[b"\x01\x00\x00\x01", &last[..], b"\x01\x00"].concat()), Some(Error::InvalidExecutable));
    }

    #[test]
    fn reads_a_table_of_nothing() {
        let bytes = with_stub(&[0]);
        let table = Table::parse(&bytes).unwrap();
        assert!(table.features.is_empty() && table.conditions.is_empty() && table.islands.is_empty() && table.doors.is_empty());
    }

    #[test]
    fn the_rest_of_the_room_is_zero() {
        let mut bytes = SMALL.concat();
        bytes.resize(49152, 0);
        assert_eq!(error_of(&bytes), None);
        bytes[49151] = 1;
        assert_eq!(error_of(&bytes), Some(Error::InvalidExecutable));
    }

    #[test]
    fn no_table() {
        assert_eq!(error_of(&[]), Some(Error::NoIslands));
        assert_eq!(error_of(&[0; 49152]), Some(Error::NoIslands));
        assert_eq!(error_of(b"bun-islands 1\nstub 201234\n"), Some(Error::NoIslands));
        assert_eq!(error_of(&TABLE_HEADER[..13]), Some(Error::NoIslands));
    }

    #[test]
    fn cut_short() {
        let bytes = SMALL.concat();
        for length in TABLE_HEADER.len()..bytes.len() {
            assert_eq!(error_of(&bytes[..length]), Some(Error::InvalidExecutable), "{length}");
        }
    }

    #[test]
    fn numbers() {
        let largest = with_stub(b"\xff\xff\xff\xff\xff\xff\xff\xff\xff\x01");
        assert_eq!(Table::parse(&largest).unwrap().stub, u64::MAX);
        assert_eq!(error_of(&with_stub(b"\xff\xff\xff\xff\xff\xff\xff\xff\xff\x02")), Some(Error::InvalidExecutable));
        assert_eq!(error_of(&with_stub(b"\x80\x80\x80\x80\x80\x80\x80\x80\x80\x80\x01")), Some(Error::InvalidExecutable));
        assert_eq!(error_of(&with_stub(b"\x80\x00")), Some(Error::InvalidExecutable));
    }

    #[test]
    fn names_what_it_does_not_list() {
        assert_eq!(error_of(&with_part(4, b"\x02\x02\x04open\x01\x0aTranspiler")), Some(Error::InvalidExecutable));
        assert_eq!(error_of(&with_part(5, b"\x00\x01\x02\x02\x00\x01")), Some(Error::InvalidExecutable));
        assert_eq!(error_of(&with_part(6, b"\x02\x01\x03\x02\x00\x01")), Some(Error::InvalidExecutable));
        assert_eq!(error_of(&with_part(7, b"\x01\x00\x00\x02")), Some(Error::InvalidExecutable));
        assert_eq!(error_of(&with_part(7, b"\x01\x00\x00\x01")), None);
    }

    #[test]
    fn an_island_is_needed_by_something() {
        assert_eq!(error_of(&with_part(6, b"\x02\x00\x02\x00\x01")), Some(Error::InvalidExecutable));
    }

    #[test]
    fn more_than_there_are_bytes_for() {
        assert_eq!(error_of(&with_part(2, b"\xff\x05tools\x03jit\x04text")), Some(Error::InvalidExecutable));
        assert_eq!(error_of(&with_part(2, b"\x03\x05tools\x03jit\xff\x01text")), Some(Error::InvalidExecutable));
    }

    #[test]
    fn addresses_past_the_last() {
        let last = b"\xfe\xff\xff\xff\xff\xff\xff\xff\xff\x01";
        assert_eq!(error_of(&with_part(7, &[b"\x01", &last[..], b"\x00\x00"].concat())), None);
        assert_eq!(error_of(&with_part(7, &[b"\x01", &last[..], b"\x01\x00"].concat())), Some(Error::InvalidExecutable));
        let with_doors = |doors: &[u8]| [&SMALL[..8].concat(), doors, &[0; 32]].concat();
        assert_eq!(error_of(&with_doors(b"\x01\x02")), None);
        assert_eq!(error_of(&with_doors(&[b"\x01", &last[..]].concat())), Some(Error::InvalidExecutable));
        assert_eq!(error_of(&with_doors(&[b"\x02\x02", &last[..]].concat())), Some(Error::InvalidExecutable));
    }

    #[test]
    fn places() {
        let places_of_door = |number: usize, section: &[u8]| Table::parse(&with_part(9, section)).map(|table| places_of(&table.doors[number]));
        assert_eq!(places_of_door(1, b"\x00"), Ok(vec![]));
        assert_eq!(places_of_door(3, b"\x01\x01\x0c\x10"), Ok(vec![(1, 0)]));
        assert_eq!(places_of_door(3, b"\x01\x01\x10\x10"), Err(Error::InvalidExecutable));
        assert_eq!(places_of_door(3, b"\x02\x01\x08\x10\x00\x10"), Ok(vec![(2, 0)]));
        assert_eq!(places_of_door(3, b"\x02\x01\x0c\x10\x00\x10"), Err(Error::InvalidExecutable));
        assert_eq!(places_of_door(0, b"\x01\x01\x01\x10\x09"), Ok(vec![(1, 0), (2, 1)]));
        assert_eq!(places_of_door(0, b"\x01\x01\x01\x10\x01"), Err(Error::InvalidExecutable));
        assert_eq!(places_of_door(0, b"\x01\x01\x00\x06"), Ok(vec![(0, 6)]));
        assert_eq!(places_of_door(0, b"\x01\x01\x01\x10"), Err(Error::InvalidExecutable));
        assert_eq!(places_of_door(0, b"\x01\x01\x03\x00\x10\x08\x08\x08"), Ok(vec![(1, 0), (2, 0), (3, 0), (4, 0)]));
        assert_eq!(places_of_door(0, b"\x01\x01\x03\x01\x10\x08\x08\x08\x0e"), Ok(vec![(1, 0), (2, 0), (3, 0), (4, 0), (5, 6)]));
        assert_eq!(places_of_door(0, b"\x01\x01\x03\xff\xff\xff\xff\x0f\x10"), Err(Error::InvalidExecutable));
        assert_eq!(places_of_door(0, b"\x01\x01\xfc\xff\xff\xff\xff\xff\xff\xff\xff\x01\x10"), Err(Error::InvalidExecutable));
    }

    #[test]
    fn the_first_place_of_a_door_is_told_from_that_of_the_last_door() {
        let firsts = |section: &[u8]| Table::parse(&with_part(9, section)).map(|table| [places_of(&table.doors[0]), places_of(&table.doors[1])]);
        assert_eq!(firsts(b"\x02\x01\x01\xa0\x01\x08\x00\x20"), Ok([vec![(10, 0), (11, 0)], vec![(12, 0)]]));
        assert_eq!(firsts(b"\x02\x01\x00\xa0\x01\x00\x18"), Ok([vec![(10, 0)], vec![(8, 0)]]));
        assert_eq!(firsts(b"\x02\x01\x00\xa0\x01\x00\x00"), Ok([vec![(10, 0)], vec![(10, 0)]]));
        assert_eq!(firsts(b"\x02\x01\x00\xa0\x01\x00\x98\x01"), Ok([vec![(10, 0)], vec![(0, 0)]]));
        assert_eq!(firsts(b"\x02\x01\x00\xa0\x01\x00\xa8\x01"), Err(Error::InvalidExecutable));
        assert_eq!(firsts(b"\x01\x01\x00\x08"), Err(Error::InvalidExecutable));
    }

    #[test]
    fn places_that_are_all_multiples_of_four_are_counted_in_fours() {
        let firsts = |section: &[u8]| Table::parse(&with_part(9, section)).map(|table| [places_of(&table.doors[0]), places_of(&table.doors[1])]);
        assert_eq!(firsts(b"\x02\x04\x01\xa0\x01\x0a\x00\x1a"), Ok([vec![(40, 0), (44, 2)], vec![(32, 2)]]));
        for unit in [0, 2, 3, 5, 8] {
            assert_eq!(firsts(&[1, unit, 0, 0x10]), Err(Error::InvalidExecutable));
        }
        let largest = b"\x01\x04\x00\xf0\xff\xff\xff\xff\xff\xff\xff\xff\x01";
        assert_eq!(firsts(largest), Ok([vec![((u64::MAX >> 4) * 4, 0)], vec![]]));
        let far = b"\xf8\xff\xff\xff\xff\xff\xff\xff\xff\x01";
        assert_eq!(firsts(&[b"\x01\x04\x02\x00", &far[..], &far[..]].concat()).map(|_| ()), Ok(()));
        assert_eq!(firsts(&[b"\x01\x04\x03\x00\x00", &far[..], &far[..], &far[..]].concat()), Err(Error::InvalidExecutable));
    }

    fn redirected(kind: PlaceKind, address: u64, door: u64, stub: u64, field: &[u8]) -> Result<Vec<u8>> {
        let mut file = [b"\xaa\xaa", field, b"\xbb\xbb"].concat();
        redirect(&mut file, 2, &Place { address, kind }, door, stub)?;
        assert!(file.starts_with(b"\xaa\xaa") && file.ends_with(b"\xbb\xbb"));
        Ok(file[2..file.len() - 2].to_vec())
    }

    fn redirected_word(kind: PlaceKind, address: u64, door: u64, stub: u64, word: u32) -> Result<u32> {
        redirected(kind, address, door, stub, &word.to_le_bytes()).map(|field| u32::from_le_bytes(field.try_into().unwrap()))
    }

    fn redirected_pointer(kind: PlaceKind, door: u64, stub: u64, pointer: u64) -> Result<u64> {
        redirected(kind, 0x403008, door, stub, &pointer.to_le_bytes()).map(|field| u64::from_le_bytes(field.try_into().unwrap()))
    }

    const REFUSED: Error = Error::InvalidExecutable;

    #[test]
    fn add32() {
        let add32 = |door, stub, word| redirected_word(PlaceKind::Add32, 0x201301, door, stub, word);
        assert_eq!(add32(0x201080, 0x204000, 0xffff_fd7b), Ok(0x0000_2cfb));
        assert_eq!(add32(0x204000, 0x201080, 0x0000_2cfb), Ok(0xffff_fd7b));
        assert_eq!(add32(0x204000, 0x201080, 0x0020_4000), Ok(0x0020_1080));
        assert_eq!(add32(0x201080, 0x204000, 0x7fff_d07f), Ok(0x7fff_ffff));
        assert_eq!(add32(0x201080, 0x204000, 0x7fff_d080), Err(REFUSED));
        assert_eq!(add32(0x204000, 0x201080, 0x8000_2f80), Ok(0x8000_0000));
        assert_eq!(add32(0x204000, 0x201080, 0x8000_2f7f), Err(REFUSED));
        assert_eq!(redirect(&mut [0; 5], 2, &Place { address: 0x201301, kind: PlaceKind::Add32 }, 0x201080, 0x204000), Err(REFUSED));
    }

    #[test]
    fn add64() {
        let add64 = |door, stub, pointer| redirected_pointer(PlaceKind::Add64, door, stub, pointer);
        assert_eq!(add64(0x201080, 0x204000, 0x201080), Ok(0x204000));
        assert_eq!(add64(0x204000, 0x201080, 0x204000), Ok(0x201080));
        assert_eq!(add64(0x201080, 0x204000, 0xffff_ffff_ffff_d07f), Ok(u64::MAX));
        assert_eq!(add64(0x201080, 0x204000, 0xffff_ffff_ffff_d080), Err(REFUSED));
        assert_eq!(add64(0x204000, 0x201080, 0x2f80), Ok(0));
        assert_eq!(add64(0x204000, 0x201080, 0x2f7f), Err(REFUSED));
    }

    #[test]
    fn pointer36() {
        let pointer36 = |door, stub, pointer| redirected_pointer(PlaceKind::Pointer36, door, stub, pointer);
        assert_eq!(pointer36(0x1_0020_1080, 0x1_0020_4000, 0x0018_0ab1_0020_1080), Ok(0x0018_0ab1_0020_4000));
        assert_eq!(pointer36(0x1_0020_4000, 0x1_0020_1080, 0x0018_0ab1_0020_4000), Ok(0x0018_0ab1_0020_1080));
        assert_eq!(pointer36(0x1_0020_1080, 0x1_0020_4000, 0x1_0020_1080), Ok(0x1_0020_4000));
        assert_eq!(pointer36(0x1_0020_1080, 0x1_0020_4000, 0x0018_0abf_ffff_d07f), Ok(0x0018_0abf_ffff_ffff));
        assert_eq!(pointer36(0x1_0020_1080, 0x1_0020_4000, 0x0018_0abf_ffff_d080), Err(REFUSED));
        assert_eq!(pointer36(0x1_0020_4000, 0x1_0020_1080, 0x0018_0ab0_0000_2f7f), Err(REFUSED));
        assert_eq!(pointer36(0x1_0020_1080, 0x1_0020_4000, 0x8018_0ab1_0020_1080), Err(REFUSED));
    }

    #[test]
    fn branch26() {
        let branch26 = |door, stub, word| redirected_word(PlaceKind::Branch26, 0x201300, door, stub, word);
        assert_eq!(branch26(0x201080, 0x204000, 0x97ff_ff60), Ok(0x9400_0b40));
        assert_eq!(branch26(0x204000, 0x201080, 0x9400_0b40), Ok(0x97ff_ff60));
        assert_eq!(branch26(0x201080, 0x204000, 0x17ff_ff60), Ok(0x1400_0b40));
        assert_eq!(branch26(0x201080, 0x201300 + (1 << 27) - 4, 0x97ff_ff60), Ok(0x95ff_ffff));
        assert_eq!(branch26(0x201080, 0x201300 + (1 << 27), 0x97ff_ff60), Err(REFUSED));
        assert_eq!(branch26(0x8201080, 0x201300, 0x95ff_ff60), Ok(0x9400_0000));
        assert_eq!(branch26(0x201080, 0x204002, 0x97ff_ff60), Err(REFUSED));
        assert_eq!(branch26(0x201080, 0x204000, 0x97ff_ff61), Err(REFUSED));
        assert_eq!(branch26(0x201080, 0x204000, 0xd503_201f), Err(REFUSED));
        assert_eq!(branch26(0x201080, 0x204000, 0x57ff_ff60), Err(REFUSED));
    }

    #[test]
    fn page21() {
        let page21 = |door, stub, word| redirected_word(PlaceKind::Page21, 0x201304, door, stub, word);
        assert_eq!(page21(0x205080, 0x203ff0, 0x9000_0020), Ok(0xd000_0000));
        assert_eq!(page21(0x203ff0, 0x205080, 0xd000_0000), Ok(0x9000_0020));
        assert_eq!(page21(0x205080, 0x200010, 0x9000_0033), Ok(0xf0ff_fff3));
        assert_eq!(page21(0x205080, 0x205ff8, 0x9000_0020), Ok(0x9000_0020));
        assert_eq!(page21(0x205080, 0x201000 + (0xf_ffff << 12), 0x9000_0020), Ok(0xf07f_ffe0));
        assert_eq!(page21(0x205080, 0x201000 + (0x10_0000 << 12), 0x9000_0020), Err(REFUSED));
        assert_eq!(page21(0x206080, 0x203ff0, 0x9000_0020), Err(REFUSED));
        assert_eq!(page21(0x205080, 0x203ff0, 0x1000_0020), Err(REFUSED));
    }

    #[test]
    fn low12() {
        let low12 = |door, stub, word| redirected_word(PlaceKind::Low12, 0x201308, door, stub, word);
        assert_eq!(low12(0x205080, 0x203ff0, 0x9102_0000), Ok(0x913f_c000));
        assert_eq!(low12(0x203ff0, 0x205080, 0x913f_c000), Ok(0x9102_0000));
        assert_eq!(low12(0x205080, 0x203000, 0x9102_0135), Ok(0x9100_0135));
        assert_eq!(low12(0x205084, 0x203ff0, 0x9102_0000), Err(REFUSED));
        assert_eq!(low12(0x205080, 0x203ff0, 0x9142_0000), Err(REFUSED));
        assert_eq!(low12(0x205080, 0x203ff0, 0xd102_0000), Err(REFUSED));
        assert_eq!(low12(0x205080, 0x203ff0, 0x1102_0000), Err(REFUSED));
        assert_eq!(low12(0x205080, 0x203ff0, 0xf940_4000), Err(REFUSED));
    }

    fn unrelaxed(first: (u64, PlaceKind, u32), second: (u64, PlaceKind, u32), door: u64, stub: u64) -> Result<[u32; 2]> {
        let mut file = [first.2.to_le_bytes(), [0xaa; 4], second.2.to_le_bytes()].concat();
        let places = [Place { address: first.0, kind: first.1 }, Place { address: second.0, kind: second.1 }];
        unrelax(&mut file, [0, 8], &places, door, stub)?;
        assert_eq!(file[4..8], [0xaa; 4]);
        Ok([u32_at(&file, 0).unwrap(), u32_at(&file, 8).unwrap()])
    }

    #[test]
    fn an_adr_and_its_nop_become_adrp_and_add_again() {
        use PlaceKind::{Adr, Nop};
        let adr_first = |door, stub, adr, nop| unrelaxed((0x201308, Adr, adr), (0x20130c, Nop, nop), door, stub);
        let nop_first = |door, stub, nop, adr| unrelaxed((0x201304, Nop, nop), (0x201308, Adr, adr), door, stub);
        assert_eq!(adr_first(0x201080, 0x5204010, 0x10ff_ebc1, NOP), Ok([0xf002_8001, 0x9100_4021]));
        assert_eq!(nop_first(0x201080, 0x5204010, NOP, 0x10ff_ebc1), Ok([0xf002_8001, 0x9100_4021]));
        assert_eq!(adr_first(0x201080, 0x100ff8, 0x10ff_ebc1, NOP), Ok([0xf0ff_f7e1, 0x913f_e021]));
        assert_eq!(adr_first(0x204000, 0x201000, 0x1001_67dc, NOP), Ok([0x9000_001c, 0x9100_039c]));
        assert_eq!(unrelaxed((0x201ffc, Adr, 0x1000_0423), (0x202000, Nop, NOP), 0x202080, 0x204008), Ok([0xf000_0003, 0x9100_2063]));
        assert_eq!(unrelaxed((0x201ffc, Nop, NOP), (0x202000, Adr, 0x1000_0403), 0x202080, 0x204008), Ok([0xf000_0003, 0x9100_2063]));
        assert_eq!(adr_first(0x201080, 0x201000 + (0xf_ffff << 12), 0x10ff_ebc1, NOP), Ok([0xf07f_ffe1, 0x9100_0021]));
        assert_eq!(adr_first(0x201080, 0x201000 + (0x10_0000 << 12), 0x10ff_ebc1, NOP), Err(REFUSED));
        assert_eq!(adr_first(0x201084, 0x5204010, 0x10ff_ebc1, NOP), Err(REFUSED));
        assert_eq!(adr_first(0x201080, 0x5204010, 0x90ff_ebc1, NOP), Err(REFUSED));
        assert_eq!(adr_first(0x201080, 0x5204010, 0x10ff_ebc1, 0x9100_4021), Err(REFUSED));
        assert_eq!(nop_first(0x201080, 0x5204010, 0x10ff_ebc1, NOP), Err(REFUSED));
        for kind in [Adr, Nop] {
            assert_eq!(redirected_word(kind, 0x201308, 0x201080, 0x204000, 0x10ff_ebc1), Err(REFUSED));
        }
    }

    #[test]
    fn an_adr_has_its_nop_beside_it() {
        let error_of_places = |fields: &[u8]| error_of(&with_part(9, &[&[1, 4, 3, fields.len() as u8 - 4][..], fields].concat()));
        assert_eq!(error_of_places(&[0x10, 0x0d, 0x0f, 0x08]), None);
        assert_eq!(error_of_places(&[0x10, 0x0f, 0x0d, 0x08]), None);
        assert_eq!(error_of_places(&[0x15, 0x0f, 0x0f, 0x0d]), None);
        assert_eq!(error_of_places(&[0x10, 0x08, 0x08, 0x0d]), Some(REFUSED));
        assert_eq!(error_of_places(&[0x10, 0x08, 0x08, 0x0f]), Some(REFUSED));
        assert_eq!(error_of_places(&[0x10, 0x0d, 0x08, 0x0f]), Some(REFUSED));
        assert_eq!(error_of_places(&[0x15, 0x0d, 0x0f, 0x0f]), Some(REFUSED));
        assert_eq!(error_of_places(&[0x17, 0x0f, 0x0d, 0x0d]), Some(REFUSED));
        assert_eq!(error_of_places(&[0x15, 0x0f, 0x0d, 0x08]), Some(REFUSED));
    }

    const CODE: Range<u64> = 0x201000..0x203000;

    fn executable() -> Vec<u8> {
        let mut file: Vec<u8> = (0..0x4000u32).map(|index| (index % 251) as u8 | 1).collect();
        put_u64(&mut file, 0x20, 0x40).unwrap();
        bytes::put_u16(&mut file, 0x36, PROGRAM_HEADER as u16).unwrap();
        bytes::put_u16(&mut file, 0x38, 3).unwrap();
        for (index, (flags, offset, address, size)) in [(4, 0, 0x200000, 0x1000), (5, 0x1000, CODE.start, CODE.end - CODE.start), (6, 0x3000, 0x403000, 0x1000)].into_iter().enumerate() {
            let at = 0x40 + index * PROGRAM_HEADER;
            put_u32(&mut file, at, PT_LOAD).unwrap();
            put_u32(&mut file, at + 4, flags).unwrap();
            for (field, value) in [offset, address, address, size, size, 0x1000].into_iter().enumerate() {
                put_u64(&mut file, at + 8 + field * 8, value).unwrap();
            }
        }
        file
    }

    fn at(address: u64) -> usize {
        elf_offset_of(&executable(), address).unwrap()
    }

    fn put(file: &mut [u8], address: u64, bytes: &[u8]) {
        file[at(address)..][..bytes.len()].copy_from_slice(bytes);
    }

    fn put_call(file: &mut [u8], address: u64, target: u64) {
        put(file, address, &(target.wrapping_sub(address + 4) as u32).to_le_bytes());
    }

    fn door(address: u64, feature: usize, when_shut: WhenShut, places: &[(u64, PlaceKind)]) -> Door {
        let places = places.iter().map(|&(address, kind)| Place { address, kind }).collect();
        Door { addresses: address..address + 12, feature, when_shut, places }
    }

    fn island(addresses: Range<u64>, needed_by: &[usize]) -> Island {
        Island { addresses, needed_by: needed_by.to_vec() }
    }

    const TRIMMED_OUT: u64 = 0x201010;

    fn exit_stub(address: u64, number: u32, feature: u32) -> Vec<u8> {
        let distance = TRIMMED_OUT.wrapping_sub(address + 10) as u32;
        [&[0xbf][..], &(feature | number << 8).to_le_bytes(), &[0xe9], &distance.to_le_bytes()].concat()
    }

    fn table() -> Table<'static> {
        use PlaceKind::{Add32, Add64};
        use WhenShut::{Exit, Return};
        Table {
            stub: TRIMMED_OUT,
            features: vec![b"a", b"b", b"c"],
            conditions: Vec::new(),
            islands: vec![island(0x200800..0x200900, &[0]), island(0x202000..0x202800, &[0]), island(0x202800..0x202c00, &[0, 1])],
            doors: vec![
                door(0x201200, 0, Exit, &[]),
                door(0x201300, 0, Exit, &[(0x201111, Add32)]),
                door(0x202100, 0, Exit, &[(0x201101, Add32), (0x201206, Add32), (0x202401, Add32), (0x202901, Add32), (0x403008, Add64)]),
                door(0x202300, 0, Return, &[(0x201121, Add32)]),
                door(0x202340, 0, Return, &[(0x403010, Add64)]),
                door(0x202880, 1, Exit, &[(0x201131, Add32)]),
            ],
            packages: Vec::new(),
        }
    }

    fn linked() -> Vec<u8> {
        let mut file = executable();
        for door in &table().doors {
            for place in &door.places {
                match place.kind {
                    PlaceKind::Add64 => put(&mut file, place.address, &door.addresses.start.to_le_bytes()),
                    _ => put_call(&mut file, place.address, door.addresses.start),
                }
            }
        }
        file
    }

    fn fill(file: &mut [u8], addresses: Range<u64>, byte: u8) {
        file[at(addresses.start)..at(addresses.end - 1) + 1].fill(byte);
    }

    #[test]
    fn a_feature_is_kept_with_the_features_it_follows() {
        let when = |feature, kind: &'static [u8], name: &'static [u8]| Condition { feature, kind, name };
        let conditions = vec![when(0, b"feature", b"b"), when(1, b"feature", b"c"), when(2, b"Bun", b"serve"), when(2, b"global", b"fetch")];
        let follows = Table { conditions, ..table() };
        assert_eq!(unused_by(&follows, b"closed\nBun write\n"), [0, 1, 2]);
        assert_eq!(unused_by(&follows, b"closed\nglobal fetch\n"), []);
        let own_fact_too = Table { conditions: vec![when(0, b"feature", b"c"), when(0, b"Bun", b"write"), when(1, b"feature", b"a"), when(2, b"Bun", b"serve")], ..table() };
        assert_eq!(unused_by(&own_fact_too, b"Bun write\n"), [2]);
        let one_another = Table { conditions: vec![when(0, b"feature", b"b"), when(1, b"feature", b"a"), when(2, b"Bun", b"serve")], ..table() };
        assert_eq!(unused_by(&one_another, b"Bun serve\n"), [0, 1]);
        let unknown = Table { conditions: vec![when(0, b"feature", b"nothing of that name"), when(1, b"Bun", b"serve"), when(2, b"Bun", b"serve")], ..table() };
        assert_eq!(unused_by(&unknown, b""), [1, 2]);
    }

    #[test]
    fn thin_doors_are_sent_to_a_strip_of_dead_code() {
        let mut file = linked();
        let dead = shut(&mut file, Container::Elf, false, &table(), &[true, false, false]).unwrap();
        assert_eq!(dead, [0x200800..0x200900, 0x202017..0x202800]);
        let mut expected = linked();
        fill(&mut expected, 0x200800..0x200900, 0xcc);
        fill(&mut expected, 0x202000..0x202800, 0xcc);
        put(&mut expected, 0x202000, &exit_stub(0x202000, 1, 0));
        put(&mut expected, 0x20200a, &exit_stub(0x20200a, 2, 0));
        put(&mut expected, 0x202014, &[0x31, 0xc0, 0xc3]);
        put_call(&mut expected, 0x201111, 0x202000);
        put_call(&mut expected, 0x201101, 0x20200a);
        put_call(&mut expected, 0x202901, 0x20200a);
        put(&mut expected, 0x403008, &0x20200au64.to_le_bytes());
        put_call(&mut expected, 0x201121, 0x202014);
        put(&mut expected, 0x403010, &0x202014u64.to_le_bytes());
        put(&mut expected, 0x201200, &exit_stub(0x201200, 0, 0));
        assert!(file == expected);
    }

    #[test]
    fn a_place_in_what_goes_as_well_is_left_alone() {
        let mut file = linked();
        let dead = shut(&mut file, Container::Elf, false, &table(), &[true, true, false]).unwrap();
        assert_eq!(dead, [0x200800..0x200900, 0x202021..0x202c00]);
        assert!(file[at(0x202021)..at(0x202bff) + 1].iter().all(|&byte| byte == 0xcc));
        assert_eq!(file[at(0x202014)..][..10], exit_stub(0x202014, 5, 1));
        assert_eq!(file[at(0x20201e)..][..3], [0x31, 0xc0, 0xc3]);
        let mut call = linked();
        put_call(&mut call, 0x201131, 0x202014);
        assert_eq!(file[at(0x201131)..][..4], call[at(0x201131)..][..4]);
    }

    #[test]
    fn a_package_loses_the_items_of_features_that_are_left_out() {
        use icu_data::tests::package_of;
        let items: [(&str, &[u8]); 4] = [
            ("icudt75l/af.res", &[1; 32]),
            ("icudt75l/coll/de.res", &[2; 48]),
            ("icudt75l/coll/root.res", &[3; 64]),
            ("icudt75l/zoneinfo64.res", &[4; 16]),
        ];
        let whole = package_of(&items);
        let addresses = 0x200400..0x200400 + whole.len() as u64;
        let mut table = table();
        let claims = vec![Items { entries: 1..2, needed_by: vec![2] }, Items { entries: 2..3, needed_by: vec![0, 2] }];
        table.packages = vec![Package { addresses: addresses.clone(), items: claims }];
        let with_package = |package: &[u8]| {
            let mut file = linked();
            put(&mut file, addresses.start, package);
            file
        };

        let mut file = with_package(&whole);
        assert_eq!(shut(&mut file, Container::Elf, false, &table, &[false, false, false]), Ok(vec![]));
        assert!(file == with_package(&whole));

        let kept = package_of(&[items[0], items[2], items[3]]);
        let tail = addresses.start + kept.len() as u64..addresses.end;
        assert_eq!(shut(&mut file, Container::Elf, false, &table, &[false, false, true]), Ok(vec![tail.clone()]));
        let mut expected = with_package(&whole);
        put(&mut expected, addresses.start, &kept);
        fill(&mut expected, tail, 0xcc);
        assert!(file == expected);

        let kept = package_of(&[items[0], items[3]]);
        let tail = addresses.start + kept.len() as u64..addresses.end;
        let mut file = with_package(&whole);
        let dead = shut(&mut file, Container::Elf, false, &table, &[true, false, true]).unwrap();
        assert_eq!(dead, [tail.clone(), 0x200800..0x200900, 0x202017..0x202800]);
        assert_eq!(file[at(addresses.start)..][..kept.len()], kept);
        assert!(file[at(tail.start)..at(tail.end)].iter().all(|&byte| byte == 0xcc));

        table.packages[0].addresses.start += 16;
        assert_eq!(shut(&mut with_package(&whole), Container::Elf, false, &table, &[false, false, true]), Err(REFUSED));
    }

    #[test]
    fn nothing_is_touched_for_features_that_are_kept() {
        for is_excluded in [[false, false, false], [false, false, true]] {
            let mut file = linked();
            assert_eq!(shut(&mut file, Container::Elf, false, &table(), &is_excluded), Ok(vec![]));
            assert!(file == linked());
        }
    }

    #[test]
    fn no_strip() {
        assert_eq!(shut(&mut linked(), Container::Elf, false, &table(), &[false, true, false]), Err(REFUSED));
        let mut small = table();
        small.islands[1].addresses.end = 0x202016;
        assert_eq!(shut(&mut linked(), Container::Elf, false, &small, &[true, false, false]), Err(REFUSED));
        small.islands[1].addresses.end = 0x202017;
        assert_eq!(shut(&mut linked(), Container::Elf, false, &small, &[true, false, false]), Ok(vec![0x200800..0x200900, 0x202017..0x202017]));
        let mut only_data = table();
        only_data.islands.truncate(1);
        assert_eq!(shut(&mut linked(), Container::Elf, false, &only_data, &[true, false, false]), Err(REFUSED));
        assert_eq!(shut(&mut linked(), Container::Pe, false, &table(), &[true, false, false]).err(), Some(REFUSED));
    }

    #[test]
    fn a_place_that_cannot_be_rewritten_stops_the_writer() {
        let mut file = linked();
        put(&mut file, 0x201101, &0x8000_0000u32.to_le_bytes());
        assert_eq!(shut(&mut file, Container::Elf, false, &table(), &[true, false, false]), Err(REFUSED));
        let mut outside = table();
        outside.doors[1].places[0].address = 0x500000;
        assert_eq!(shut(&mut linked(), Container::Elf, false, &outside, &[true, false, false]), Err(REFUSED));
    }

    #[test]
    fn arm64() {
        use PlaceKind::{Add64, Adr, Branch26, Low12, Nop, Page21};
        let word_at = |file: &[u8], address: u64| u32_at(file, at(address)).unwrap();
        let table = Table {
            stub: TRIMMED_OUT,
            features: vec![b"a"],
            conditions: Vec::new(),
            islands: vec![island(0x202002..0x202800, &[0])],
            doors: vec![
                door(0x202100, 0, WhenShut::Exit, &[(0x201100, Branch26), (0x201104, Page21), (0x201108, Low12), (0x20110c, Adr), (0x201110, Nop), (0x201120, Nop), (0x201124, Adr), (0x403008, Add64)]),
                door(0x202300, 0, WhenShut::Return, &[(0x201114, Branch26)]),
            ],
            packages: Vec::new(),
        };
        let mut file = executable();
        put(&mut file, 0x201100, &0x9400_0400u32.to_le_bytes());
        put(&mut file, 0x201104, &0xb000_0000u32.to_le_bytes());
        put(&mut file, 0x201108, &0x9104_0000u32.to_le_bytes());
        put(&mut file, 0x20110c, &0x1000_7fa0u32.to_le_bytes());
        put(&mut file, 0x403008, &0x202100u64.to_le_bytes());
        put(&mut file, 0x201110, &NOP.to_le_bytes());
        put(&mut file, 0x201120, &NOP.to_le_bytes());
        put(&mut file, 0x201124, &0x1000_7ee3u32.to_le_bytes());
        put(&mut file, 0x201114, &0x1400_047bu32.to_le_bytes());
        let dead = shut(&mut file, Container::Elf, true, &table, &[true]).unwrap();
        assert_eq!((dead.len(), dead[0].clone()), (1, 0x202018..0x202800));
        assert_eq!(file[at(0x202002)..][..2], [0x20, 0x00]);
        assert_eq!([0x202004, 0x202008, 0x20200c].map(|address| word_at(&file, address)), [0x5280_0000, 0x72a0_0000, 0x17ff_fc01]);
        assert_eq!([0x202010, 0x202014].map(|address| word_at(&file, address)), [0x5280_0000, 0xd65f_03c0]);
        assert_eq!(word_at(&file, 0x201100), 0x9400_03c1);
        assert_eq!(word_at(&file, 0x201104), 0xb000_0000);
        assert_eq!(word_at(&file, 0x201108), 0x9100_1000);
        assert_eq!([0x20110c, 0x201110].map(|address| word_at(&file, address)), [0xb000_0000, 0x9100_1000]);
        assert_eq!([0x201120, 0x201124].map(|address| word_at(&file, address)), [0xb000_0003, 0x9100_1063]);
        assert_eq!(u64_at(&file, at(0x403008)), Ok(0x202004));
        assert_eq!(word_at(&file, 0x201114), 0x1400_03bf);
    }
}
