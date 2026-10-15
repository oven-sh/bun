//! Leaves features out of a bun executable, for `bun build --compile --compile-exclude-features`.
//!
//! `bun_core::feature` says what a feature and an island are. The executable has a byte for each feature that says whether it
//! is there, which the rest of Bun asks before it goes into one, and it says which features need each island. Leaving
//! features out is then
//!
//! 1. clear their bytes,
//! 2. overwrite the islands that no other feature needs, with an instruction that traps,
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

use bun_collections::index_sort::sort_slice_by_key;
use bun_exe_format::builtins::{self, Builtins};
use core::ops::Range;

use bytes::{i32_at, slice, slice_mut, u32_at};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    /// Not a 64-bit ELF, Mach-O or PE executable for x86-64 or arm64.
    UnrecognizedExecutable,
    /// A header of the executable points outside the file, or it is not laid out as bun is.
    InvalidExecutable,
    /// The executable does not say what can be left out: a bun that was built without scripts/build/feature-pass.cpp, one older
    /// than this, or one that features were left out of already.
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
        sort_slice_by_key(&mut sections, |s| s.addresses.start);
        Ok(sections)
    }

    /// What the section with the names of the features is called, the one that says which are there and the one that says
    /// which need each island (`bun_core::feature`).
    fn names(self) -> [&'static [u8]; 3] {
        match self {
            Container::Elf => [
                b".bun_feature_names",
                b".bun_feature_present",
                b".bun_feature_islands",
            ],
            Container::MachO => [b"__bun_feat_names", b"__bun_feat_pres", b"__bun_feat_isl"],
            Container::Pe => [b".bunfnam", b".bunfprs", b".bunfisl"],
        }
    }

    /// Where the islands are, each with its number (scripts/build/feature-pass.cpp). One has code and constants, apart.
    fn islands(self, file: &[u8], sections: &[Section<'_>]) -> Result<Vec<(usize, Range<u64>)>> {
        let mut islands = Vec::new();
        let prefixes: [&[u8]; 2] = match self {
            Container::Elf => [b".bun_island_x.", b".bun_island_r."],
            Container::MachO => [b"__bun_x", b"__bun_r"],
            // Has room for few sections. A record for each: {where it starts, where it ends, its number}, in words of 32 bits, the
            // first two as distances from the record.
            Container::Pe => {
                for section in sections.iter().filter(|s| s.name == b".bunisl") {
                    let length = (section.addresses.end - section.addresses.start) as usize;
                    let records = slice(file, section.offset, length)?;
                    for at in (0..records.len() / 12).map(|index| index * 12) {
                        let address = section.addresses.start + at as u64;
                        let start = address.wrapping_add_signed(i32_at(records, at)?.into());
                        let end = address.wrapping_add_signed(i32_at(records, at + 4)?.into());
                        // What is after the last record, up to where the section ends.
                        if (start, end) != (address, address) {
                            islands.push((u32_at(records, at + 8)? as usize, start..end));
                        }
                    }
                }
                return Ok(islands);
            }
        };
        for section in sections {
            let number = prefixes
                .iter()
                .find_map(|it| section.name.strip_prefix(*it));
            if let Some(number) = number {
                let number = core::str::from_utf8(number)
                    .ok()
                    .and_then(|it| it.parse().ok());
                let number = number.ok_or(Error::InvalidExecutable)?;
                islands.push((number, section.addresses.clone()));
            }
        }
        Ok(islands)
    }

    /// The section with the builtin modules of JavaScript (src/codegen/bundle-modules.ts), and what it says is in it.
    fn builtins<'a, 's>(
        self,
        file: &'a [u8],
        sections: &'s [Section<'s>],
    ) -> Option<(&'s Section<'s>, Builtins<'a>)> {
        let called: &[u8] = match self {
            Container::Elf => builtins::ELF_SECTION_NAME,
            Container::MachO => builtins::MACHO_SECTNAME,
            Container::Pe => bun_core::slice_to_nul(&builtins::PE_SECTION_NAME),
        };
        let section = sections.iter().find(|s| s.name == called)?;
        let length = (section.addresses.end - section.addresses.start) as usize;
        Some((
            section,
            Builtins::parse(slice(file, section.offset, length).ok()?).ok()?,
        ))
    }

    fn without_pages(self, file: &[u8], dead: &[Range<u64>]) -> Result<Vec<u8>> {
        match self {
            Container::Elf => elf::without_pages(file, dead),
            Container::MachO => macho::without_pages(file, dead),
            Container::Pe => pe::without_pages(file, dead),
        }
    }
}

fn contents_of<'a>(file: &'a [u8], sections: &[Section<'_>], called: &[u8]) -> Result<&'a [u8]> {
    let section = (sections.iter().find(|s| s.name == called)).ok_or(Error::NoFeatures)?;
    let length = (section.addresses.end - section.addresses.start) as usize;
    let contents = slice(file, section.offset, length)?;
    let end = contents.iter().rposition(|byte| *byte != 0);
    Ok(&contents[..=end.ok_or(Error::NoFeatures)?])
}

/// Each ends with a 0, the first is of feature 1.
fn names_in<'a>(file: &'a [u8], sections: &[Section<'_>], called: &[u8]) -> Result<Vec<&'a [u8]>> {
    Ok(bun_core::strings::split(contents_of(file, sections, called)?, b"\0").collect())
}

/// The features that can be left out of `file`, an executable.
pub fn names(file: &[u8]) -> Result<Vec<&[u8]>> {
    let container = Container::of(file)?;
    let [called_names, _, called_islands] = container.names();
    let sections = container.sections(file)?;
    // Without islands only the doors could be shut, and all of the features would still be there.
    contents_of(file, &sections, called_islands)?;
    let mut names = names_in(file, &sections, called_names)?;
    if let Some((_, builtins)) = container.builtins(file, &sections) {
        names.extend(builtins.public_names());
    }
    Ok(names)
}

/// For each island, from number 1, whether none of the features that need it stays. `table` is `1;1,2,3;2,3`, `is_excluded` is of
/// the features, the first of which is number 1.
fn dead_islands(table: &[u8], is_excluded: &[bool]) -> Result<Vec<bool>> {
    bun_core::strings::split(table, b";")
        .map(|features| {
            let mut all = true;
            for feature in bun_core::strings::split(features, b",") {
                let number = core::str::from_utf8(feature)
                    .ok()
                    .and_then(|it| it.parse().ok());
                let index = number.and_then(|it: usize| it.checked_sub(1));
                all &=
                    *(index.and_then(|it| is_excluded.get(it))).ok_or(Error::InvalidExecutable)?;
            }
            Ok(all)
        })
        .collect()
}

/// `file`, an executable, without the features `excluded`.
pub fn without(mut file: Vec<u8>, excluded: &[&[u8]]) -> Result<Vec<u8>> {
    let container = Container::of(&file)?;
    let is_arm64 = container.is_arm64(&file)?;
    let [called_names, called_present, called_islands] = container.names();

    // ---- what to do, read from the file. Then the file is written to.
    let mut zeros: Vec<(usize, usize)> = Vec::new();
    let mut traps: Vec<(usize, usize)> = Vec::new();
    let mut dead: Vec<Range<u64>> = Vec::new();
    {
        let sections = container.sections(&file)?;
        let names = names_in(&file, &sections, called_names)?;
        let builtins = container.builtins(&file, &sections);
        let is_module = |name: &[u8]| {
            builtins
                .as_ref()
                .is_some_and(|it| it.1.public_names().any(|public| public == name))
        };
        if !excluded
            .iter()
            .all(|name| names.contains(name) || is_module(name))
        {
            return Err(Error::NoSuchFeature);
        }
        let is_excluded: Vec<bool> = names.iter().map(|name| excluded.contains(name)).collect();
        let length_of = |s: &Section<'_>| (s.addresses.end - s.addresses.start) as usize;

        // A byte for each feature.
        let present = sections.iter().find(|s| s.name == called_present);
        let present = present.filter(|s| length_of(s) >= names.len());
        let present = present.ok_or(Error::InvalidExecutable)?;
        for (index, _) in is_excluded.iter().enumerate().filter(|it| *it.1) {
            zeros.push((present.offset + index, 1));
        }

        let is_dead = dead_islands(contents_of(&file, &sections, called_islands)?, &is_excluded)?;
        // What goes, and whether it is code.
        let mut gone: Vec<(Range<u64>, bool)> = Vec::new();
        for (number, addresses) in container.islands(&file, &sections)? {
            let index = number.checked_sub(1).ok_or(Error::InvalidExecutable)?;
            if *is_dead.get(index).ok_or(Error::InvalidExecutable)? {
                gone.push((addresses, true));
            }
        }
        if let Some((section, builtins)) = &builtins {
            for id in builtins.without(excluded) {
                let (source, length) = builtins
                    .source_offsets(id)
                    .ok_or(Error::InvalidExecutable)?;
                let size = builtins.module(id).map_or(0, |it| it.source.len()) as u64;
                let start = section.addresses.start + source as u64;
                gone.push((start..start + size, false));
                // A module without source is one that this executable was built without (InternalModuleRegistry.cpp).
                zeros.push((section.offset + length, 4));
            }
        }
        sort_slice_by_key(&mut gone, |(addresses, _)| addresses.start);
        for (addresses, is_code) in gone {
            let holds = |s: &&Section<'_>| {
                s.addresses.start <= addresses.start && addresses.end <= s.addresses.end
            };
            let section = sections
                .iter()
                .find(holds)
                .filter(|_| addresses.start <= addresses.end);
            let section = section.ok_or(Error::InvalidExecutable)?;
            let offset = section.offset + (addresses.start - section.addresses.start) as usize;
            let length = (addresses.end - addresses.start) as usize;
            if is_code { &mut traps } else { &mut zeros }.push((offset, length));
            // What no section has, between this one and the one before it, holds nothing.
            match dead.last_mut().filter(|before| {
                let between = before.end..addresses.start;
                !(sections.iter())
                    .any(|s| s.addresses.start < between.end && between.start < s.addresses.end)
            }) {
                Some(before) => before.end = addresses.end,
                None => dead.push(addresses),
            }
        }

        // An executable with features left out does not say what can be left out: the room for more headers is used up.
        for section in sections
            .iter()
            .filter(|s| [called_names, called_islands].contains(&s.name))
        {
            zeros.push((section.offset, length_of(section)));
        }
    }

    // int3; brk #1. Code starts where an instruction can.
    let trap: &[u8] = if is_arm64 {
        &[0x20, 0x00, 0x20, 0xd4]
    } else {
        &[0xcc]
    };
    let many = trap.repeat(4096);
    for (at, length) in traps {
        for some in slice_mut(&mut file, at, length)?.chunks_mut(many.len()) {
            some.copy_from_slice(&many[..some.len()]);
        }
    }
    for (at, length) in zeros {
        slice_mut(&mut file, at, length)?.fill(0);
    }
    container.without_pages(&file, &dead)
}
