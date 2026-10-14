//! Leaves features out of a bun executable, for `bun build --compile --compile-exclude-features`.
//!
//! `bun_core::feature` says what a feature is. In the executable, what is compiled for it is in sections of its own, which have
//! in their names the features that need them, and the rest of Bun gets into it through doors, which are jumps. Leaving
//! features out is then
//!
//! 1. shut their doors: have each go to what Bun does without the feature,
//! 2. overwrite the sections that no other feature needs, with an instruction that traps,
//! 3. leave the pages that hold nothing else out of the file.
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

    /// What the section with the names of the features is called and the one with the doors (`bun_core::feature`), and, up to
    /// the features that need it, one with code and one with constants (scripts/build/feature-pass.cpp).
    fn names(self) -> [&'static [u8]; 4] {
        match self {
            Container::Elf => [
                b".bun_feature_names",
                b".bun_feature_doors",
                b".bun_feature_x.",
                b".bun_feature_r.",
            ],
            Container::MachO => [
                b"__bun_feat_names",
                b"__bun_feat_door",
                b"__bun_feat_x",
                b"__bun_feat_r",
            ],
            Container::Pe => [b".bunfnam", b".bunfdor", b".bfx", b".bfr"],
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

/// `file`, an executable, without the features `excluded`.
pub fn without(mut file: Vec<u8>, excluded: &[&[u8]]) -> Result<Vec<u8>> {
    let container = Container::of(&file)?;
    let is_arm64 = container.is_arm64(&file)?;
    let [called_names, called_doors, code, constants] = container.names();

    // ---- what to do, read from the file. Then the file is written to.
    let mut to_shut: Vec<(usize, u64, u64)> = Vec::new();
    let mut traps: Vec<(usize, Range<u64>)> = Vec::new();
    let mut dead: Vec<Range<u64>> = Vec::new();
    let names_at;
    {
        let sections = container.sections(&file)?;
        let names = names_in(&file, &sections, called_names)?;
        if names.len() > 64 {
            return Err(Error::InvalidExecutable);
        }
        if !excluded.iter().all(|name| names.contains(name)) {
            return Err(Error::NoSuchFeature);
        }
        let bit_if_excluded = |(index, name)| u64::from(excluded.contains(name)) << index;
        let excluded: u64 = names.iter().enumerate().map(bit_if_excluded).sum();
        let offset_of = |address: u64| {
            let holds = |s: &&Section<'_>| s.addresses.contains(&address);
            let section = sections
                .iter()
                .find(holds)
                .ok_or(Error::InvalidExecutable)?;
            Ok(section.offset + (address - section.addresses.start) as usize)
        };

        // {the door, where it goes without the features, the features}, the first two as distances from the record.
        for doors in sections.iter().filter(|s| s.name == called_doors) {
            for record in doors.addresses.clone().step_by(16) {
                let at = offset_of(record)?;
                let of =
                    u64::from(u32_at(&file, at + 8)?) | u64::from(u32_at(&file, at + 12)?) << 32;
                if of == 0 || of >> names.len() != 0 {
                    return Err(Error::InvalidExecutable);
                }
                if of & !excluded == 0 {
                    let door = record.wrapping_add_signed(i32_at(&file, at)?.into());
                    let absent = record.wrapping_add_signed(i32_at(&file, at + 4)?.into());
                    to_shut.push((offset_of(door)?, door, absent));
                }
            }
        }

        let mut follows_a_dead_one = false;
        for section in &sections {
            let needed_by =
                (section.name.strip_prefix(code)).or(section.name.strip_prefix(constants));
            let needed_by =
                needed_by.and_then(|hex| u64::from_str_radix(str::from_utf8(hex).ok()?, 16).ok());
            if needed_by.is_some_and(|set| set == 0 || set >> names.len() != 0) {
                return Err(Error::InvalidExecutable);
            }
            let is_dead = needed_by.is_some_and(|set| set & !excluded == 0);
            if is_dead {
                traps.push((section.offset, section.addresses.clone()));
                match dead.last_mut() {
                    // Between two sections there is only padding.
                    Some(last) if follows_a_dead_one => last.end = section.addresses.end,
                    _ => dead.push(section.addresses.clone()),
                }
            }
            follows_a_dead_one = is_dead;
        }
        let names = (sections.iter().find(|s| s.name == called_names)).ok_or(Error::NoFeatures)?;
        names_at = (
            names.offset,
            (names.addresses.end - names.addresses.start) as usize,
        );
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
    // The room for more headers is used up.
    slice_mut(&mut file, names_at.0, names_at.1)?.fill(0);
    container.without_pages(&file, &dead)
}
