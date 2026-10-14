//! Removes features from a bun executable, for `bun build --compile`.
//!
//! A release build of bun carries a TABLE that says which piece of the executable refers to which, and where every
//! address is stored. With it, what an excluded feature leaves unreferenced can be dropped and the rest packed, without
//! a linker, a disassembler or symbols, for an ELF, Mach-O or PE file from any host.
//!
//! - UNIT: an address range with a liveness of its own. Sorted, not overlapping.
//! - PIECE: one or more consecutive units that the linker placed as one thing. It moves as a whole and stays if any of
//!   its units is live. A function that holds feature markers is one unit per basic block; a data table with rows that
//!   belong to features is one unit per such row. A dead unit of a live piece is blanked.
//! - FIXUP: a field that holds an address: where it is, how the address is encoded, which unit it refers to. So it is
//!   an edge of the liveness graph and an instruction for patching at once.
//! - FLOW: an edge between units that is no address: one block runs into another, a table has a row. It may depend on
//!   a feature, which is what a marker (`bun_core::feature::present`) is.
//! - PATCH: bytes to write if a feature is excluded: the jump that replaces a marker.
//! - AREA: an address range whose pieces are packed, towards its low or its high end.
//!
//! Whatever is in no unit always stays and never moves. A fixup there makes its target a root.
//!
//! Nothing says which code belongs to a feature. A piece goes when nothing that stays refers to it, so a missing marker
//! leaves bytes in the file and cannot remove something that is still used.
//!
//! The table as it ships holds only what cannot be read off the executable it describes: see [`scan`].
//!
//! This crate has no dependencies, so that the host tool of Bun's build (`main.rs`, feature `tool`) is these same
//! functions and nothing else. The table is compressed in the executable; the caller decompresses it.

mod bytes;
mod elf;
mod executable;
mod expand;
mod macho;
mod patch;
mod pe;
mod plan;
mod scan;
mod table;
mod without_table;

#[cfg(feature = "tool")]
mod compact;
#[cfg(feature = "tool")]
mod embed;
#[cfg(feature = "tool")]
mod make;
#[cfg(feature = "tool")]
mod merge;

use executable::Executable;
use plan::Options;
use table::Table;

pub use without_table::without_table;

#[cfg(feature = "tool")]
pub use embed::embed;
#[cfg(feature = "tool")]
pub use make::{Link, check_blocks, make_table};
#[cfg(feature = "tool")]
pub use plan::Testing;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    /// Not an ELF x86-64, Mach-O arm64 or PE x86-64 executable.
    UnrecognizedExecutable,
    /// A header or a table of the executable points outside the file.
    InvalidExecutable,
    /// The executable has no feature table: a bun older than this, or one that features were removed from already.
    MissingTable,
    InvalidTable,
    UnsupportedTableVersion,
    /// The table was made for other bytes than these.
    TableOfAnotherExecutable,
    /// Something that stays refers to something that was removed, or can no longer reach it.
    Inconsistent,
}

impl Error {
    pub fn name(self) -> &'static str {
        match self {
            Self::UnrecognizedExecutable => "UnrecognizedExecutable",
            Self::InvalidExecutable => "InvalidExecutable",
            Self::MissingTable => "MissingFeatureTable",
            Self::InvalidTable => "InvalidFeatureTable",
            Self::UnsupportedTableVersion => "UnsupportedFeatureTableVersion",
            Self::TableOfAnotherExecutable => "FeatureTableOfAnotherExecutable",
            Self::Inconsistent => "InconsistentFeatureTable",
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

/// The compressed table in `executable`.
pub fn table_section(executable: &[u8]) -> Result<&[u8]> {
    Executable::open(executable)?.table_section()
}

/// An executable and its table.
pub struct Features<'a> {
    executable: Executable<'a>,
    table: Table,
}

impl<'a> Features<'a> {
    /// `table` is [`table_section`], decompressed.
    pub fn open(executable: &'a [u8], table: &[u8]) -> Result<Self> {
        let executable = Executable::open(executable)?;
        let table = expand::expand(table, &executable)?;
        Ok(Self { executable, table })
    }

    /// The features that can be excluded.
    pub fn names(&self) -> impl Iterator<Item = &[u8]> {
        self.table.features.iter().map(|f| &*f.name)
    }

    fn id(&self, name: &[u8]) -> Option<u32> {
        self.table
            .features
            .iter()
            .find(|f| &*f.name == name)
            .map(|f| f.id)
    }

    /// The executable without `excluded`, each of which is one of [`Self::names`], and without the table.
    /// A Mach-O comes out with room for a signature and none in it.
    pub fn remove(&self, excluded: &[&[u8]]) -> Result<Vec<u8>> {
        let excluded: Vec<u32> = excluded.iter().filter_map(|name| self.id(name)).collect();
        self.apply(&Options::excluding(&excluded))
    }

    fn apply(&self, options: &Options<'_>) -> Result<Vec<u8>> {
        let plan = plan::plan(&self.table, options);
        match self.table.format.container {
            table::Container::Elf => elf::apply(&self.executable, &self.table, options, &plan),
            table::Container::MachO => macho::apply(&self.executable, &self.table, options, plan),
            table::Container::Pe => pe::apply(&self.executable, &self.table, options, &plan),
        }
    }
}

#[cfg(feature = "tool")]
impl<'a> Features<'a> {
    /// From a table with every fixup written out, as `scripts/build` makes it. Only such a table, unmerged, can scatter
    /// every piece.
    pub fn open_written_out(executable: &'a [u8], table: &[u8]) -> Result<Self> {
        Ok(Self {
            executable: Executable::open(executable)?,
            table: Table::read_written_out(table)?,
        })
    }

    pub fn remove_for_testing(&self, excluded: &[&[u8]], testing: Testing) -> Result<Vec<u8>> {
        let excluded: Vec<u32> = excluded.iter().filter_map(|name| self.id(name)).collect();
        self.apply(&Options {
            excluded: &excluded,
            testing,
        })
    }
}

/// What ships: `written_out` merged and reduced to what cannot be read off `executable`, which has to be the file as it
/// ships. Checked to expand to the same table.
#[cfg(feature = "tool")]
pub fn compact(executable: &[u8], written_out: &[u8]) -> Result<Vec<u8>> {
    let executable = Executable::open(executable)?;
    let table = merge::merge(&Table::read_written_out(written_out)?);
    let bytes = compact::compact(&table, &executable)?;
    if expand::expand(&bytes, &executable)? != table {
        return Err(Error::Inconsistent);
    }
    Ok(bytes)
}

/// `written_out` in the one order that [`make_table`] writes, to compare two tables.
#[cfg(feature = "tool")]
pub fn canonical(written_out: &[u8]) -> Result<Vec<u8>> {
    Ok(Table::read_written_out(written_out)?.write_written_out())
}
