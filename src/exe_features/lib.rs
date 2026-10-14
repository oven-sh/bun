//! Leaves features out of a bun executable, for `bun build --compile --compile-exclude-features`.
//!
//! `bun_core::feature` says what a feature is. The executable says, in records, where the parts are that were compiled for
//! features, with the features that need each, and where the doors are through which the rest of Bun gets into them.
//! Leaving features out is then
//!
//! 1. shut their doors: have each go to what Bun does without the feature,
//! 2. overwrite the parts that no other feature needs, with an instruction that traps,
//! 3. leave the pages that hold nothing else out of the file.
//!
//! The first two are done to all of it, however many features there are and however small. The third is a matter of size
//! only: a loader takes a file in whole pages and in no more than so many pieces, so the largest go.
//!
//! Nothing moves. Every byte that stays is loaded at the address it was linked for, so no address stored anywhere has to be
//! found or changed: not in code, not in data, not in symbols, debug information or unwind tables, and a crash report has
//! the addresses it would have had, to be read against the symbols of the release. All that changes is where in the file
//! things are, and into how many segments or sections it is cut, which only the headers of the file say. That is the whole of
//! what [`elf`], [`macho`] and [`pe`] do. What is left out cannot be read or run, and what of it shares a page with something
//! that stays traps: whatever gets there by mistake stops there.

mod bytes;
mod elf;
mod macho;
mod pe;

use core::ops::Range;

use bytes::{i32_at, slice, slice_mut, u32_at};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    /// Not a 64-bit ELF, Mach-O or PE executable for x86-64 or arm64.
    UnrecognizedExecutable,
    /// A header of the executable points outside the file, or it is not laid out as bun is.
    InvalidExecutable,
    /// The executable does not say what can be left out: a bun for a platform without gates, one older than this, or one that
    /// features were left out of already.
    NoFeatures,
    /// [`without`] was given a name that is not among [`names`].
    NoSuchFeature,
}

impl Error {
    pub fn name(self) -> &'static str {
        match self {
            Error::UnrecognizedExecutable => "UnrecognizedExecutable",
            Error::InvalidExecutable => "InvalidExecutable",
            Error::NoFeatures => "NoFeatures",
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

/// A section that is loaded.
struct Section<'a> {
    name: &'a [u8],
    addresses: Range<u64>,
    /// Where in the file it starts.
    offset: usize,
}

#[derive(Clone, Copy, PartialEq)]
enum Container {
    Elf,
    MachO,
    Pe,
}

impl Container {
    fn of(file: &[u8]) -> Result<Self> {
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

    /// Sorted by address.
    fn sections(self, file: &[u8]) -> Result<Vec<Section<'_>>> {
        let mut sections = match self {
            Container::Elf => elf::sections(file),
            Container::MachO => macho::sections(file),
            Container::Pe => pe::sections(file),
        }?;
        sections.sort_by_key(|s| s.addresses.start);
        Ok(sections)
    }

    /// What the section with the names of the features is called, the one with the doors (`bun_core::feature`) and the one
    /// with the parts (scripts/build/feature-pass.cpp).
    fn names(self) -> [&'static [u8]; 3] {
        match self {
            Container::Elf => [
                b".bun_feature_names",
                b".bun_feature_doors",
                b".bun_feature_parts",
            ],
            Container::MachO => [b"__bun_feat_names", b"__bun_feat_door", b"__bun_feat_part"],
            Container::Pe => [b".bunfnam", b".bunfdor", b".bunfprt"],
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

/// The contents of the section with the names: each ends with a 0, the first is of feature 1.
fn names_in<'a>(file: &'a [u8], sections: &[Section<'_>], called: &[u8]) -> Result<Vec<&'a [u8]>> {
    let section = (sections.iter().find(|s| s.name == called)).ok_or(Error::NoFeatures)?;
    let length = (section.addresses.end - section.addresses.start) as usize;
    let names = slice(file, section.offset, length)?;
    let mut names: Vec<&[u8]> = bun_core::strings::split(names, b"\0").collect();
    while names.pop_if(|name| name.is_empty()).is_some() {}
    if names.is_empty() {
        return Err(Error::NoFeatures);
    }
    Ok(names)
}

/// The features that can be left out of `file`, an executable.
pub fn names(file: &[u8]) -> Result<Vec<&[u8]>> {
    let container = Container::of(file)?;
    names_in(file, &container.sections(file)?, container.names()[0])
}

/// Makes `no_op`, which a door starts with, at `at`, a jump to `to`.
fn shut(is_arm64: bool, no_op: &mut [u8], at: u64, to: u64) -> Result<()> {
    let distance = to.wrapping_sub(at).cast_signed();
    let (expected, jump): (&[u8], Vec<u8>) = if is_arm64 {
        if distance % 4 != 0 || !(-(1 << 27)..1 << 27).contains(&distance) {
            return Err(Error::InvalidExecutable);
        }
        let b: u32 = 0b000101 << 26 | (distance / 4) as u32 & 0x03ff_ffff;
        (&[0x1f, 0x20, 0x03, 0xd5], b.to_le_bytes().to_vec())
    } else {
        let relative = i32::try_from(distance - 5).map_err(|_| Error::InvalidExecutable)?;
        let jump = [&[0xe9][..], &relative.to_le_bytes()].concat();
        (&[0x0f, 0x1f, 0x44, 0x00, 0x00], jump)
    };
    // The linker folds identical functions, and then their doors are one.
    if no_op != expected && no_op != jump {
        return Err(Error::InvalidExecutable);
    }
    no_op.copy_from_slice(&jump);
    Ok(())
}

/// A record of a door or of a part: {an address, an address, how many features, the features}, in words of 32 bits. The
/// addresses are distances from the record.
struct Record {
    first: u64,
    second: u64,
    /// None of its features stays.
    is_excluded: bool,
}

/// The records in the sections `called`. `is_excluded` is of the features, the first of which is number 1.
fn records(
    file: &[u8],
    sections: &[Section<'_>],
    called: &[u8],
    is_excluded: &[bool],
) -> Result<Vec<Record>> {
    let mut records = Vec::new();
    for section in sections.iter().filter(|s| s.name == called) {
        let length = (section.addresses.end - section.addresses.start) as usize;
        let words = slice(file, section.offset, length)?;
        let mut at = 0;
        while at < words.len() {
            let address = section.addresses.start + at as u64;
            let count = u32_at(words, at + 8)? as usize;
            let features = slice(
                words,
                at + 12,
                count.checked_mul(4).ok_or(Error::InvalidExecutable)?,
            )?;
            let mut all = count > 0;
            for feature in features.as_chunks::<4>().0 {
                let number = u32::from_le_bytes(*feature) as usize;
                let index = number.checked_sub(1).ok_or(Error::InvalidExecutable)?;
                all &= *is_excluded.get(index).ok_or(Error::InvalidExecutable)?;
            }
            if count == 0 {
                return Err(Error::InvalidExecutable);
            }
            records.push(Record {
                first: address.wrapping_add_signed(i32_at(words, at)?.into()),
                second: address.wrapping_add_signed(i32_at(words, at + 4)?.into()),
                is_excluded: all,
            });
            at += 12 + features.len();
        }
    }
    Ok(records)
}

/// `file`, an executable, without the features `excluded`.
pub fn without(mut file: Vec<u8>, excluded: &[&[u8]]) -> Result<Vec<u8>> {
    let container = Container::of(&file)?;
    let is_arm64 = container.is_arm64(&file)?;
    let [called_names, called_doors, called_parts] = container.names();

    // ---- what to do, read from the file. Then the file is written to.
    let mut to_shut: Vec<(usize, u64, u64)> = Vec::new();
    let mut traps: Vec<(usize, Range<u64>)> = Vec::new();
    let mut dead: Vec<Range<u64>> = Vec::new();
    let mut spent: Vec<(usize, usize)> = Vec::new();
    {
        let sections = container.sections(&file)?;
        let names = names_in(&file, &sections, called_names)?;
        if !excluded.iter().all(|name| names.contains(name)) {
            return Err(Error::NoSuchFeature);
        }
        let is_excluded: Vec<bool> = names.iter().map(|name| excluded.contains(name)).collect();
        let index_of = |address: u64| {
            let holds = |s: &Section<'_>| s.addresses.contains(&address);
            sections
                .iter()
                .position(holds)
                .ok_or(Error::InvalidExecutable)
        };
        let offset_in =
            |s: &Section<'_>, address: u64| s.offset + (address - s.addresses.start) as usize;

        // {the door, where it goes without the features}
        for door in records(&file, &sections, called_doors, &is_excluded)? {
            if door.is_excluded {
                let at = offset_in(&sections[index_of(door.first)?], door.first);
                to_shut.push((at, door.first, door.second));
            }
        }

        // {where it starts, where it ends}, in one section.
        let mut parts = records(&file, &sections, called_parts, &is_excluded)?;
        parts.sort_by_key(|part| part.first);
        let mut before: Option<(&Record, usize)> = None;
        for part in &parts {
            let index = index_of(part.first)?;
            let section = &sections[index];
            if part.second < part.first
                || part.second > section.addresses.end
                || before.is_some_and(|(before, _)| before.second > part.first)
            {
                return Err(Error::InvalidExecutable);
            }
            if part.is_excluded {
                // A linker keeps what an object has in a section together, and between two sections there is only padding. So
                // what is between two parts that follow each other is of the one, of the other, or padding, and goes if
                // both do.
                match before.filter(|(before, _)| before.is_excluded) {
                    Some((before, same)) if same == index => {
                        traps.push((
                            offset_in(section, before.second),
                            before.second..part.second,
                        ));
                    }
                    Some((before, previous)) if previous + 1 == index => {
                        let previous = &sections[previous];
                        let rest = before.second..previous.addresses.end;
                        traps.push((offset_in(previous, rest.start), rest));
                        traps.push((section.offset, section.addresses.start..part.second));
                    }
                    _ => {
                        traps.push((offset_in(section, part.first), part.first..part.second));
                        dead.push(part.first..part.first);
                    }
                }
                dead.last_mut().ok_or(Error::InvalidExecutable)?.end = part.second;
            }
            before = Some((part, index));
        }

        // An executable with features left out does not say what can be left out: the room for more headers is used up.
        for section in &sections {
            if [called_names, called_doors, called_parts].contains(&section.name) {
                let length = (section.addresses.end - section.addresses.start) as usize;
                spent.push((section.offset, length));
            }
        }
    }

    for (at, door, absent) in to_shut {
        let length = if is_arm64 { 4 } else { 5 };
        shut(is_arm64, slice_mut(&mut file, at, length)?, door, absent)?;
    }
    // int3; brk #1
    let trap: &[u8] = if is_arm64 {
        &[0x20, 0x00, 0x20, 0xd4]
    } else {
        &[0xcc]
    };
    for (at, addresses) in traps {
        let length = (addresses.end - addresses.start) as usize;
        for (byte, address) in slice_mut(&mut file, at, length)?
            .iter_mut()
            .zip(addresses.start as usize..)
        {
            *byte = trap[address % trap.len()];
        }
    }
    for (at, length) in spent {
        slice_mut(&mut file, at, length)?.fill(0);
    }
    container.without_pages(&file, &dead)
}
