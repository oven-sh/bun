//! Leaves features out of a bun executable, for `bun build --compile --compile-exclude-features`.
//!
//! A release build of bun says of itself which of its bytes only which features need: the TABLE, a list of address ranges,
//! each with the features that need it. Leaving features out is then
//!
//! 1. turn each `bun_core::feature::present` of theirs into a jump to its `false` side,
//! 2. overwrite the ranges that no feature that is left needs, with an instruction that traps,
//! 3. leave the pages that hold nothing else out of the file.
//!
//! Nothing moves. Every byte that stays is loaded at the address it was linked for, so no address stored anywhere has to be
//! found or changed: not in code, not in data, not in symbols, debug information or unwind tables, and a crash report has
//! the addresses it would have had, to be read against the symbols of the release. All that changes is where in the file
//! things are, and into how many segments or sections it is cut, which only the headers of the file say. That is the whole of
//! what [`elf`], [`macho`] and [`pe`] do. What is left out cannot be read or run, and what of it shares a page with something
//! that stays traps: whatever gets there by mistake stops there.
//!
//! An executable is loaded in pages, so only whole pages leave the file. Bun's build lays out what each set of features
//! needs as one stretch, so that is nearly all of it.
//!
//! Which bytes those are is found out by Bun's build (`make`), where the linker's work is still at hand and anything
//! unexpected stops the build.
//!
//! This crate has no dependencies, so that the host tool of Bun's build (`main.rs`, feature `tool`) is these same functions
//! and nothing else.

mod bytes;
mod elf;
mod macho;
mod pe;
mod table;

#[cfg(feature = "tool")]
mod make;

use core::ops::Range;

use bytes::{slice, slice_mut};
use table::Table;

#[cfg(feature = "tool")]
pub use make::{Link, make_order, make_table};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    /// Not a 64-bit ELF, Mach-O or PE executable for x86-64 or arm64.
    UnrecognizedExecutable,
    /// A header of the executable points outside the file, or it is not laid out as bun is.
    InvalidExecutable,
    /// The executable does not say what can be left out: a build of bun that is not a release, one older than this, or one
    /// that features were left out of already.
    MissingTable,
    InvalidTable,
    /// `Features::without` was given a name that is not among `Features::names`.
    NoSuchFeature,
}

impl Error {
    pub fn name(self) -> &'static str {
        match self {
            Error::UnrecognizedExecutable => "UnrecognizedExecutable",
            Error::InvalidExecutable => "InvalidExecutable",
            Error::MissingTable => "MissingTable",
            Error::InvalidTable => "InvalidTable",
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

    /// Where in the file the room for the table is: `TABLE` of `bun_core::feature`.
    fn room_for_table(self, file: &[u8]) -> Result<Range<usize>> {
        match self {
            Container::Elf => elf::section(file, b".bun_feature_table"),
            Container::MachO => macho::section(file, b"__TEXT", b"__bun_feat_tab"),
            Container::Pe => pe::section(file, b".bunftab"),
        }?
        .ok_or(Error::MissingTable)
    }

    fn offset_of(self, file: &[u8], address: u64) -> Result<usize> {
        match self {
            Container::Elf => elf::offset_of(file, address),
            Container::MachO => macho::offset_of(file, address),
            Container::Pe => pe::offset_of(file, address),
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

/// What can be left out of an executable.
pub struct Features<'a> {
    table: Table<'a>,
}

impl<'a> Features<'a> {
    pub fn of(executable: &'a [u8]) -> Result<Self> {
        let room = Container::of(executable)?.room_for_table(executable)?;
        let table = Table::read(slice(executable, room.start, room.len())?)?;
        Ok(Self { table })
    }

    pub fn names(&self) -> impl Iterator<Item = &'a [u8]> {
        self.table.features.iter().copied()
    }
}

/// `file`, an executable, without the features `excluded`.
pub fn without(mut file: Vec<u8>, excluded: &[&[u8]]) -> Result<Vec<u8>> {
    let container = Container::of(&file)?;
    let room = container.room_for_table(&file)?;
    // A copy of it rather than of the executable, which is written to.
    let table = slice(&file, room.start, room.len())?.to_vec();
    let table = Table::read(&table)?;
    if !excluded.iter().all(|name| table.features.contains(name)) {
        return Err(Error::NoSuchFeature);
    }
    let is_excluded: Vec<bool> = table
        .features
        .iter()
        .map(|name| excluded.contains(name))
        .collect();

    for marker in table.markers.iter().filter(|m| is_excluded[m.feature]) {
        let at = container.offset_of(&file, marker.address)?;
        let there = slice_mut(&mut file, at, marker.present.len())?;
        if there != marker.present {
            return Err(Error::InvalidTable);
        }
        there.copy_from_slice(marker.excluded);
    }

    let is_needed_by_none = |set: &Vec<usize>| set.iter().all(|&feature| is_excluded[feature]);
    let is_needed_by_none: Vec<bool> = table.sets.iter().map(is_needed_by_none).collect();
    let mut dead: Vec<Range<u64>> = Vec::new();
    for (range, needed_by) in &table.ranges {
        if is_needed_by_none[*needed_by] {
            match dead.last_mut() {
                Some(last) if last.end == range.start => last.end = range.end,
                _ => dead.push(range.clone()),
            }
        }
    }
    // int3; brk #1
    let trap: &[u8] = if container.is_arm64(&file)? {
        &[0x20, 0x00, 0x20, 0xd4]
    } else {
        &[0xcc]
    };
    for range in dead.iter().filter(|r| r.start < r.end) {
        // One stretch of the file.
        let length = (range.end - range.start) as usize;
        let first = container.offset_of(&file, range.start)?;
        if container.offset_of(&file, range.end - 1)? != first.saturating_add(length - 1) {
            return Err(Error::InvalidTable);
        }
        let addresses = range.start as usize..;
        for (byte, address) in slice_mut(&mut file, first, length)?
            .iter_mut()
            .zip(addresses)
        {
            *byte = trap[address % trap.len()];
        }
    }
    // It is about what the executable was.
    slice_mut(&mut file, room.start, room.len())?.fill(0);
    container.without_pages(&file, &dead)
}
