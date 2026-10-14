//! Leaves features out of a bun executable, for `bun build --compile --compile-exclude-features`.
//!
//! What belongs to a feature is said in Bun's source, by a gate on a function or on a crate (`bun_core::feature`). A gate names
//! the features that need the code, and the code of each gate is a section of the executable, which has the gate in its name.
//! Leaving features out is then
//!
//! 1. turn each `feature::present!` of theirs into a jump to its `false` side,
//! 2. overwrite the sections of the gates that name no other feature, with an instruction that traps,
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

    /// What `bun_core::feature` calls the section with the names of the features, the one with the markers, and, up to the
    /// gate, the one of a gate.
    fn names(self) -> [&'static [u8]; 3] {
        match self {
            Container::Elf => [
                b".bun_feature_names",
                b".bun_feature_markers",
                b".bun_gate.",
            ],
            Container::MachO => [b"__bun_feat_names", b"__bun_feat_marks", b"__bun_gate_"],
            Container::Pe => [b".bunfnam", b".bunfmrk", b".bg"],
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

/// The no-op that `bun_core::feature` has at `at` for the feature `id`, and the jump to `to` that goes in its place.
fn no_op_and_jump(is_arm64: bool, id: u32, at: u64, to: u64) -> Result<(Vec<u8>, Vec<u8>)> {
    let distance = to.wrapping_sub(at).cast_signed();
    if is_arm64 {
        if id >= 1 << 16 || distance % 4 != 0 || !(-(1 << 27)..1 << 27).contains(&distance) {
            return Err(Error::InvalidExecutable);
        }
        let no_op: u32 = 0xd280_001f | id << 5;
        let jump: u32 = 0x1400_0000 | (distance / 4) as u32 & 0x03ff_ffff;
        return Ok((no_op.to_le_bytes().to_vec(), jump.to_le_bytes().to_vec()));
    }
    let relative = i32::try_from(distance - 5).map_err(|_| Error::InvalidExecutable)?;
    let (mut no_op, mut jump) = (vec![0x0f, 0x1f, 0x80], vec![0xe9]);
    no_op.extend_from_slice(&id.to_le_bytes());
    jump.extend_from_slice(&relative.to_le_bytes());
    jump.extend_from_slice(&[0x66, 0x90]);
    Ok((no_op, jump))
}

/// `file`, an executable, without the features `excluded`.
pub fn without(mut file: Vec<u8>, excluded: &[&[u8]]) -> Result<Vec<u8>> {
    let container = Container::of(&file)?;
    let is_arm64 = container.is_arm64(&file)?;
    let [called_names, called_markers, gate_prefix] = container.names();

    // ---- what to do, read from the file. Then the file is written to.
    let mut patches: Vec<(usize, Vec<u8>, Vec<u8>)> = Vec::new();
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

        // {no-op, other side, id, 0}, the first two as distances from the record.
        for markers in sections.iter().filter(|s| s.name == called_markers) {
            for record in markers.addresses.clone().step_by(16) {
                let at = offset_of(record)?;
                let id = u32_at(&file, at + 8)?;
                if id == 0 || id as usize > names.len() {
                    return Err(Error::InvalidExecutable);
                }
                if excluded & 1 << (id - 1) != 0 {
                    let no_op = record.wrapping_add_signed(i32_at(&file, at)?.into());
                    let otherwise = record.wrapping_add_signed(i32_at(&file, at + 4)?.into());
                    let (present, absent) = no_op_and_jump(is_arm64, id, no_op, otherwise)?;
                    patches.push((offset_of(no_op)?, present, absent));
                }
            }
        }
        // The linker folds identical functions, and then their markers are one.
        patches.sort_unstable();
        patches.dedup();

        let mut follows_a_dead_one = false;
        for section in &sections {
            let gate = section.name.strip_prefix(gate_prefix);
            let gate = gate.and_then(|hex| u64::from_str_radix(str::from_utf8(hex).ok()?, 16).ok());
            if gate.is_some_and(|gate| gate == 0 || gate >> names.len() != 0) {
                return Err(Error::InvalidExecutable);
            }
            let is_dead = gate.is_some_and(|needed_by| needed_by & !excluded == 0);
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

    for (at, present, absent) in patches {
        let there = slice_mut(&mut file, at, present.len())?;
        if there != present {
            return Err(Error::InvalidExecutable);
        }
        there.copy_from_slice(&absent);
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
