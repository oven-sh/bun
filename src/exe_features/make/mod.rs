//! Makes the table of a link. Only Bun's build does this, right after it links.
//!
//! A linked executable no longer says what each of its address fields refers to. The linker's map says where every piece
//! of every object file went, and the object files say what refers to what. With LTO those are temporary files that the
//! linker is asked to leave behind; they are large, and deleted here once they are read.
//!
//! Every check is made here as well: each relocated field is compared with the value it must hold, and each way the
//! linker may have rewritten an instruction is recognised by its form. Anything else stops the build.

// Runs on the machine that builds bun and links none of it but this crate: there is no bun_sys here.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

mod blocks;
mod check_blocks;
mod elf;
mod features;
mod live;
mod macho;
mod objects;
mod pe;

use std::path::Path;

use crate::table::{Container, Fixup, Flow, Form, NO_UNIT, STARTS_PIECE, Table, Unit};

type Result<T> = core::result::Result<T, String>;

macro_rules! fail {
    ($($arg:tt)*) => {
        return Err(format!($($arg)*))
    };
}
use fail;

/// A finished link. The current directory is the one it ran in.
pub struct Link<'a> {
    /// The executable, not stripped.
    pub linked: &'a Path,
    /// lld's own map.
    pub map: &'a Path,
    /// What the linker wrote to its standard output: identical code folding (ELF), where each member came from (PE).
    pub printed: &'a Path,
    pub objdump: &'a Path,
}

struct Made {
    table: Table,
    /// For whoever reads the build's log.
    report: String,
}

fn read(path: &Path) -> Result<Vec<u8>> {
    std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))
}

/// Latin-1, like the names in it: a map is not always UTF-8.
fn read_text(path: &Path) -> Result<String> {
    Ok(read(path)?.into_iter().map(char::from).collect())
}

fn make(
    link: &Link<'_>,
    want_blocks: bool,
) -> Result<(Made, Option<check_blocks::Reconstruction>)> {
    let linked = read(link.linked)?;
    let format = crate::executable::Executable::open(&linked)
        .map_err(|e| e.to_string())?
        .format;
    match format.container {
        Container::Elf => elf::make(link, &linked, format.arch, want_blocks),
        Container::MachO => Ok((macho::make(link, &linked, format.arch)?, None)),
        Container::Pe => Ok((pe::make(link, &linked, format.arch)?, None)),
    }
}

/// The table of `link`, with every fixup written out, and a report.
///
/// What the linker left behind only for this goes, unless told not to: its temporary files, and from an ELF the relocations,
/// which more than double it.
pub fn make_table(link: &Link<'_>, keep_temporary_files: bool) -> Result<(Vec<u8>, String)> {
    let (made, _) = make(link, false)?;
    if !keep_temporary_files {
        // ld64.lld puts its own into a directory that the debug information refers to. That one stays.
        if made.table.format.container != Container::MachO {
            let output = link
                .linked
                .file_name()
                .ok_or("the executable has no name")?;
            let prefix = format!("{}.lto.", output.to_string_lossy());
            remove_files_starting_with(Path::new("."), &prefix)
                .map_err(|e| format!("{prefix}*: {e}"))?;
        }
        if made.table.format.container == Container::Elf {
            let without = elf::without_relocations(&read(link.linked)?);
            std::fs::write(link.linked, without)
                .map_err(|e| format!("{}: {e}", link.linked.display()))?;
        }
    }
    Ok((made.table.write_written_out(), made.report))
}

/// lld writes each temporary file, `<output>.lto.<input>`, next to the input it was made from.
fn remove_files_starting_with(directory: &Path, prefix: &str) -> std::io::Result<()> {
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_dir() {
            remove_files_starting_with(&entry.path(), prefix)?;
        } else if kind.is_file() && entry.file_name().to_string_lossy().starts_with(prefix) {
            std::fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}

/// Is the control flow that is reconstructed by disassembly sound? See [`check_blocks`]. ELF only.
pub fn check_blocks(link: &Link<'_>, readobj: &Path) -> Result<String> {
    let (_, blocks) = make(link, true)?;
    check_blocks::check(link.linked, readobj, &blocks.ok_or("no blocks")?)
}

/// The bytes of something the linker wrote. Reading outside of it is a bug here, not an error to report.
#[derive(Clone, Copy)]
struct Data<'a>(pub(crate) &'a [u8]);

impl<'a> Data<'a> {
    fn array<const N: usize>(self, at: usize) -> [u8; N] {
        *self.0[at..].first_chunk::<N>().expect("in range")
    }
    fn u8(self, at: usize) -> u8 {
        self.0[at]
    }
    fn u16(self, at: usize) -> u16 {
        u16::from_le_bytes(self.array(at))
    }
    fn u32(self, at: usize) -> u32 {
        u32::from_le_bytes(self.array(at))
    }
    fn i32(self, at: usize) -> i32 {
        i32::from_le_bytes(self.array(at))
    }
    fn u64(self, at: usize) -> u64 {
        u64::from_le_bytes(self.array(at))
    }
    fn i64(self, at: usize) -> i64 {
        i64::from_le_bytes(self.array(at))
    }
    /// Up to the next NUL.
    fn cstr(self, at: usize) -> &'a [u8] {
        crate::executable::fixed_name(&self.0[at..])
    }
}

/// The pieces the linker placed (ELF input sections, Mach-O atoms, COFF chunks), sorted by address.
#[derive(Default)]
struct Nodes {
    addr: Vec<u64>,
    size: Vec<u64>,
}

impl Nodes {
    fn len(&self) -> usize {
        self.addr.len()
    }
    fn end(&self, n: usize) -> u64 {
        self.addr[n] + self.size[n]
    }
    /// The last node that starts at or below `address`.
    fn at_or_below(&self, address: u64) -> Option<usize> {
        self.addr.partition_point(|&a| a <= address).checked_sub(1)
    }
    /// The node that holds `address`. An empty one holds the address it is at.
    fn find(&self, address: u64) -> Option<usize> {
        self.at_or_below(address)
            .filter(|&n| address < self.end(n) || address == self.addr[n])
    }
}

/// A row of a table of properties that belongs to a feature.
struct FeatureRow {
    node: usize,
    start: u64,
    end: u64,
    feature: u32,
}

struct Units {
    /// For a table with rows this is its head.
    first_of_node: Vec<Option<u32>>,
    of_block: Vec<u32>,
}

/// The units, flows and fixups of a table as they are found.
#[derive(Default)]
struct Parts {
    units: Vec<Unit>,
    flows: Vec<Flow>,
    fixups: Vec<Fixup>,
    /// How many fixups of each sort, for the report.
    sorts: Vec<(&'static str, usize)>,
}

impl Parts {
    fn add_unit(&mut self, start: u64, size: u64, flags: u8, align: u64) -> u32 {
        self.units.push(Unit {
            start,
            size,
            flags,
            log2_align: align.max(1).ilog2() as u8,
        });
        (self.units.len() - 1) as u32
    }

    /// The units of the nodes for which `in_table` gives an alignment, and the flows between the units of one node.
    fn add_nodes(
        &mut self,
        nodes: &Nodes,
        blocks: &live::Blocks,
        rows: &[FeatureRow],
        in_table: &dyn Fn(usize) -> Option<u64>,
    ) -> Units {
        let mut units = Units {
            first_of_node: vec![None; nodes.len()],
            of_block: vec![0; blocks.all.len()],
        };
        for n in 0..nodes.len() {
            let Some(align) = in_table(n) else { continue };
            let mut rows = rows.iter().filter(|r| r.node == n).peekable();
            if let Some((first, count)) = blocks.of(n) {
                for i in first..first + count {
                    let (block, flags) =
                        (&blocks.all[i], if i == first { STARTS_PIECE } else { 0 });
                    units.of_block[i] =
                        self.add_unit(block.start, block.end - block.start, flags, align);
                }
                units.first_of_node[n] = Some(units.of_block[first]);
            } else if rows.peek().is_some() {
                // An empty head stands for the table. It brings in the rows: those of a feature only if the feature is present.
                let head = self.add_unit(nodes.addr[n], 0, STARTS_PIECE, align);
                units.first_of_node[n] = Some(head);
                let mut at = nodes.addr[n];
                for row in rows.map(Some).chain([None]) {
                    let until = row.map_or_else(|| nodes.end(n), |r| r.start);
                    if until > at {
                        let rest = self.add_unit(at, until - at, 0, 1);
                        self.add_flow(head, rest, 0);
                    }
                    let Some(row) = row else { break };
                    let unit = self.add_unit(row.start, row.end - row.start, 0, 1);
                    self.add_flow(head, unit, 2 * row.feature + 1);
                    at = row.end;
                }
            } else {
                units.first_of_node[n] =
                    Some(self.add_unit(nodes.addr[n], nodes.size[n], STARTS_PIECE, align));
            }
        }
        for (block, &from) in blocks.all.iter().zip(&units.of_block) {
            for &next in &block.succ {
                self.add_flow(from, units.of_block[next as usize], 0);
            }
            // `2 * id + 1`: if the feature is present. `2 * id + 2`: if it is excluded.
            if let Some(m) = &block.marker {
                if let Some(yes) = m.yes {
                    self.add_flow(from, units.of_block[yes as usize], 2 * m.id + 1);
                }
                self.add_flow(from, units.of_block[m.no as usize], 2 * m.id + 2);
            }
        }
        units
    }

    fn add_flow(&mut self, from: u32, to: u32, condition: u32) {
        self.flows.push(Flow {
            from,
            to,
            condition,
        });
    }

    fn add_fixup(
        &mut self,
        sort: &'static str,
        place: u64,
        form: Form,
        target: Option<u32>,
        extra: u16,
    ) {
        match self.sorts.iter_mut().find(|s| s.0 == sort) {
            Some(s) => s.1 += 1,
            None => self.sorts.push((sort, 1)),
        }
        self.fixups.push(Fixup {
            place,
            form,
            target: target.unwrap_or(NO_UNIT),
            extra,
        });
    }

    fn sorts(&self) -> String {
        self.sorts
            .iter()
            .map(|(sort, n)| format!("{sort}: {n}"))
            .collect::<Vec<_>>()
            .join("; ")
    }
}
