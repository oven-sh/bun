//! Finds out which bytes of a linked bun only which features need. Only Bun's build does this, right after it links.
//!
//! A linked executable no longer says what refers to what. The linker's map says where every piece of every object file
//! went, and the relocations of the object files say which piece refers to which. With LTO the linker generates most of the
//! object files itself, and is asked to leave them behind.
//!
//! That gives a GRAPH: a NODE is what the linker places and drops as one thing (an input section, an atom, a chunk), an
//! edge is a relocation. Which address in a node is meant, and how it is stored, does not matter: nothing is going to move.
//!
//! A DOOR is a node that holds the no-op of `bun_core::feature::enter`: the function that the closure was compiled to.
//! Without its feature nothing runs it, so an edge to it counts only with the feature.
//!
//! - What is reached from the roots without going through a door always stays.
//! - What is reached from the doors of a feature, without going through a door of another, is needed by that feature.
//!
//! Whatever runs in an executable with the features P is reached from a root through doors of P only. Take the last door on
//! the way: what follows it goes through no door, so it is needed by that door's feature, which is in P. With no door on the
//! way it always stays. So nothing that runs is ever left out.
//!
//! The linker did the same reckoning when it dropped what nothing refers to. What it kept and this graph does not reach is
//! something this graph does not know about, so it stays, with all that it refers to.

// Runs on the machine that builds bun and links none of it but this crate: there is no bun_sys here.
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

mod elf;
mod features;
mod macho;
mod objects;
mod pe;

use core::ops::Range;
use std::fmt::Write as _;
use std::path::Path;

use crate::Container;
use crate::table::{Marker, Table};
use features::FEATURES;

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
    /// What the linker printed: identical code folding (ELF), which libraries it read (PE).
    pub printed: &'a Path,
    /// ELF: the directory of the linker's LTO cache, which held nothing before this link.
    pub lto_cache: &'a Path,
}

struct Node {
    addresses: Range<u64>,
    /// Which stretch of the image it is in. All that is in one is a node, so between two of them there is only padding.
    stretch: u32,
    /// Code, or constants that the loader changes nothing in.
    can_be_left_out: bool,
    /// The linker keeps it whether or not anything refers to it.
    is_root: bool,
    /// A symbol at its start, if it has one.
    name: Option<String>,
}

/// `bun_core::feature`
struct Record {
    no_op: u64,
    /// Of `present`: its `false` side. Else it is in a door.
    otherwise: Option<u64>,
    id: u32,
}

struct Graph {
    /// Sorted, not overlapping.
    nodes: Vec<Node>,
    /// {from, to}
    edges: Vec<(u32, u32)>,
    records: Vec<Record>,
    report: String,
}

impl Graph {
    fn find(&self, address: u64) -> Option<u32> {
        find(&self.nodes, address)
    }
}

fn find(nodes: &[Node], address: u64) -> Option<u32> {
    let index = nodes
        .partition_point(|n| n.addresses.start <= address)
        .checked_sub(1)?;
    nodes[index]
        .addresses
        .contains(&address)
        .then_some(index as u32)
}

fn read(path: &Path) -> Result<Vec<u8>> {
    std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))
}

/// Latin-1, like the names in it: a map is not always UTF-8.
fn read_text(path: &Path) -> Result<String> {
    Ok(read(path)?.into_iter().map(char::from).collect())
}

/// The bytes of something the linker wrote. Reading outside of it is a bug here, not an error to report.
#[derive(Clone, Copy)]
struct Data<'a>(&'a [u8]);

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
        crate::bytes::fixed_name(&self.0[at..])
    }
}

/// Per node: the features that need it, as indexes into `FEATURES`. None: it always stays.
struct Needs {
    of: Vec<Option<Vec<usize>>>,
    report: String,
}

fn needs(graph: &Graph) -> Result<Needs> {
    let count = graph.nodes.len();
    let mut edges = graph.edges.clone();
    edges.sort_unstable();
    edges.dedup();
    let first_edge: Vec<usize> = (0..=count as u32)
        .map(|n| edges.partition_point(|e| e.0 < n))
        .collect();

    // Per node: the features it is a door of. Two doors that are alike may have been folded into one.
    let mut door_of: Vec<Vec<usize>> = vec![Vec::new(); count];
    let mut doors = vec![0; FEATURES.len()];
    for record in &graph.records {
        let Some(feature) = FEATURES.iter().position(|f| f.1 == record.id) else {
            fail!(
                "the no-op at {:x} is of a feature, {}, that has no name",
                record.no_op,
                record.id
            );
        };
        let Some(node) = graph.find(record.no_op) else {
            fail!(
                "the no-op at {:x} is in nothing that the linker placed",
                record.no_op
            );
        };
        match record.otherwise {
            Some(otherwise) if graph.find(otherwise) != Some(node) => {
                fail!(
                    "the no-op at {:x} and its other side are not in one function",
                    record.no_op
                );
            }
            Some(_) => {}
            None => {
                doors[feature] += 1;
                if !door_of[node as usize].contains(&feature) {
                    door_of[node as usize].push(feature);
                }
            }
        }
    }
    if let Some(feature) = doors.iter().position(|&d| d == 0) {
        fail!("nothing is behind the feature {}", FEATURES[feature].0);
    }

    // Marks what is reached from `starts`, going on to a node only if it `may_enter`.
    let reach =
        |is_reached: &mut Vec<bool>, starts: Vec<u32>, may_enter: &dyn Fn(usize) -> bool| {
            let mut pending: Vec<u32> = Vec::new();
            for start in starts {
                if !core::mem::replace(&mut is_reached[start as usize], true) {
                    pending.push(start);
                }
            }
            while let Some(node) = pending.pop() {
                for &(_, to) in &edges[first_edge[node as usize]..first_edge[node as usize + 1]] {
                    if !is_reached[to as usize] && may_enter(to as usize) {
                        is_reached[to as usize] = true;
                        pending.push(to);
                    }
                }
            }
        };
    let all = || 0..count as u32;
    let roots: Vec<u32> = all().filter(|&n| graph.nodes[n as usize].is_root).collect();

    let mut is_explained = vec![false; count];
    reach(&mut is_explained, roots.clone(), &|_| true);
    let unexplained: Vec<u32> = all().filter(|&n| !is_explained[n as usize]).collect();

    let mut always_stays = vec![false; count];
    let starts = roots.iter().chain(&unexplained).copied().collect();
    reach(&mut always_stays, starts, &|n| door_of[n].is_empty());

    let mut of: Vec<Option<Vec<usize>>> = always_stays
        .iter()
        .map(|&stays| (!stays).then(Vec::new))
        .collect();
    for feature in 0..FEATURES.len() {
        let mut is_reached = always_stays.clone();
        let starts = all()
            .filter(|&n| door_of[n as usize].contains(&feature))
            .collect();
        reach(&mut is_reached, starts, &|n| {
            door_of[n].is_empty() || door_of[n].contains(&feature)
        });
        for (node, needed_by) in of.iter_mut().enumerate() {
            if let Some(needed_by) = needed_by.as_mut().filter(|_| is_reached[node]) {
                needed_by.push(feature);
            }
        }
    }
    if let Some(node) = of
        .iter()
        .position(|n| n.as_ref().is_some_and(Vec::is_empty))
    {
        fail!(
            "{:x} is reached from nowhere",
            graph.nodes[node].addresses.start
        );
    }

    let size = |nodes: &mut dyn Iterator<Item = usize>| {
        nodes
            .map(|n| graph.nodes[n].addresses.end - graph.nodes[n].addresses.start)
            .sum::<u64>()
    };
    let mut report = format!(
        "nodes {count}, edges {}, roots {}, doors {doors:?}\nkept by the linker but not reached by the graph: {} nodes, {} \
         bytes, of which can be left out {} bytes\n",
        edges.len(),
        roots.len(),
        unexplained.len(),
        size(&mut unexplained.iter().map(|&n| n as usize)),
        size(
            &mut unexplained
                .iter()
                .map(|&n| n as usize)
                .filter(|&n| graph.nodes[n].can_be_left_out)
        ),
    );
    for &node in unexplained.iter().take(12) {
        let node = &graph.nodes[node as usize];
        let _ = writeln!(
            report,
            "  {:x} {} {}",
            node.addresses.start,
            node.addresses.end - node.addresses.start,
            node.name.as_deref().unwrap_or("")
        );
    }
    Ok(Needs { of, report })
}

fn graph_of(link: &Link<'_>, linked: &[u8]) -> Result<(Container, Graph)> {
    let container = Container::of(linked).map_err(|e| e.to_string())?;
    let graph = match container {
        Container::Elf => elf::graph(link, linked)?,
        Container::MachO => macho::graph(
            link,
            linked,
            container.is_arm64(linked).map_err(|e| e.to_string())?,
        )?,
        Container::Pe => pe::graph(
            link,
            linked,
            container.is_arm64(linked).map_err(|e| e.to_string())?,
        )?,
    };
    if let Some(pair) = graph
        .nodes
        .iter()
        .zip(graph.nodes.iter().skip(1))
        .find(|(a, b)| a.addresses.end > b.addresses.start)
    {
        fail!("two things are placed at {:x}", pair.1.addresses.start);
    }
    Ok((container, graph))
}

/// The no-op that holds `id`, and the jump from `at` to `to` that is as long.
fn no_op_and_jump(is_arm64: bool, id: u32, at: u64, to: u64) -> Result<(Vec<u8>, Vec<u8>)> {
    let distance = to.wrapping_sub(at).cast_signed();
    if is_arm64 {
        if distance % 4 != 0 || !(-(1 << 27)..1 << 27).contains(&distance) {
            fail!("the jump at {at:x} does not reach");
        }
        let (no_op, jump) = (
            0xd280_001f | id << 5,
            0x1400_0000 | (distance / 4) as u32 & 0x03ff_ffff,
        );
        return Ok((no_op.to_le_bytes().to_vec(), jump.to_le_bytes().to_vec()));
    }
    let Ok(relative) = i32::try_from(distance - 5) else {
        fail!("the jump at {at:x} does not reach");
    };
    let (mut no_op, mut jump) = (vec![0x0f, 0x1f, 0x80], vec![0xe9]);
    no_op.extend_from_slice(&id.to_le_bytes());
    jump.extend_from_slice(&relative.to_le_bytes());
    jump.extend_from_slice(&[0x66, 0x90]);
    Ok((no_op, jump))
}

/// Writes the table of `link` into the executable, in the room it has for it. Returns a report.
pub fn make_table(link: &Link<'_>) -> Result<String> {
    let mut linked = read(link.linked)?;
    let (container, graph) = graph_of(link, &linked)?;
    let needs = needs(&graph)?;
    let is_arm64 = container.is_arm64(&linked).map_err(|e| e.to_string())?;

    // A node with the padding that follows it.
    let mut ranges: Vec<(Range<u64>, Vec<usize>)> = Vec::new();
    for (index, node) in graph
        .nodes
        .iter()
        .enumerate()
        .filter(|n| n.1.can_be_left_out)
    {
        let Some(needed_by) = &needs.of[index] else {
            continue;
        };
        let next = graph
            .nodes
            .get(index + 1)
            .filter(|next| next.stretch == node.stretch);
        let range =
            node.addresses.start..next.map_or(node.addresses.end, |next| next.addresses.start);
        match ranges.last_mut() {
            Some(last) if last.0.end == range.start && last.1 == *needed_by => {
                last.0.end = range.end
            }
            _ => ranges.push((range, needed_by.clone())),
        }
    }

    let mut patches = Vec::new();
    for record in &graph.records {
        let (no_op, jump) = no_op_and_jump(
            is_arm64,
            record.id,
            record.no_op,
            record.otherwise.unwrap_or(record.no_op),
        )?;
        let at = container
            .offset_of(&linked, record.no_op)
            .map_err(|e| e.to_string())?;
        if !linked[at..].starts_with(&no_op) {
            fail!(
                "there is no no-op of the feature {} at {:x}",
                record.id,
                record.no_op
            );
        }
        if record.otherwise.is_some() {
            patches.push((record.no_op, record.id, no_op, jump));
        }
    }
    patches.sort();
    patches.dedup();
    if let Some(pair) = patches
        .iter()
        .zip(patches.iter().skip(1))
        .find(|(a, b)| a.0 == b.0)
    {
        fail!("two records disagree about the no-op at {:x}", pair.0.0);
    }
    let feature_of = |id: u32| {
        FEATURES
            .iter()
            .position(|f| f.1 == id)
            .expect("`needs` has looked")
    };
    let table = Table {
        features: FEATURES.iter().map(|f| f.0.as_bytes()).collect(),
        markers: patches
            .iter()
            .map(|(address, id, present, excluded)| Marker {
                address: *address,
                feature: feature_of(*id),
                present,
                excluded,
            })
            .collect(),
        ranges,
    };
    let bytes = table.write();
    let room = container
        .room_for_table(&linked)
        .map_err(|e| e.to_string())?;
    if bytes.len() > room.len() {
        fail!(
            "the table takes {} bytes and `TABLE` of bun_core::feature has {}",
            bytes.len(),
            room.len()
        );
    }

    let mut report = format!("{}{}", graph.report, needs.report);
    let _ = writeln!(
        report,
        "ranges {}, markers {}, table {} bytes of {}",
        table.ranges.len(),
        table.markers.len(),
        bytes.len(),
        room.len()
    );
    for (feature, (name, _)) in FEATURES.iter().enumerate() {
        let only: u64 = table
            .ranges
            .iter()
            .filter(|r| r.1 == [feature])
            .map(|r| r.0.end - r.0.start)
            .sum();
        let shared: u64 = table
            .ranges
            .iter()
            .filter(|r| r.1.contains(&feature))
            .map(|r| r.0.end - r.0.start)
            .sum();
        let _ = writeln!(
            report,
            "  {name}: {only} bytes that nothing else needs, {shared} with what other features need too"
        );
    }
    let total: u64 = table.ranges.iter().map(|r| r.0.end - r.0.start).sum();
    let _ = writeln!(report, "  all: {total} bytes");

    linked[room.clone()].fill(0);
    linked[room.start..room.start + bytes.len()].copy_from_slice(&bytes);
    std::fs::write(link.linked, linked).map_err(|e| format!("{}: {e}", link.linked.display()))?;
    // lld-link writes each object that LTO generates, `<output>.lto.<input>`, next to the input it was made from.
    if container == Container::Pe {
        let output = link
            .linked
            .file_name()
            .ok_or("the executable has no name")?;
        let prefix = format!("{}.lto.", output.to_string_lossy());
        remove_files_starting_with(Path::new("."), &prefix)
            .map_err(|e| format!("{prefix}*: {e}"))?;
    }
    Ok(report)
}

/// An order for the linker to lay things out in, so that what each set of features needs is one stretch: `before`, which is
/// such a file already, and then those. It is a wish. The table is made from what the linker did.
pub fn make_order(link: &Link<'_>, before: &[u8]) -> Result<Vec<u8>> {
    let linked = read(link.linked)?;
    let (_, graph) = graph_of(link, &linked)?;
    let needs = needs(&graph)?;
    let mut named: Vec<(&Vec<usize>, &str)> = Vec::new();
    for (node, needed_by) in graph
        .nodes
        .iter()
        .zip(&needs.of)
        .filter(|n| n.0.can_be_left_out)
    {
        if let (Some(needed_by), Some(name)) = (needed_by, &node.name) {
            named.push((needed_by, name));
        }
    }
    // Stable: within a set, the order they are in.
    named.sort_by_key(|n| n.0);
    let mut out = before.to_vec();
    if out.last().is_some_and(|&b| b != b'\n') {
        out.push(b'\n');
    }
    for (_, name) in named {
        // The names are Latin-1 here.
        out.extend(name.chars().map(|c| c as u8));
        out.push(b'\n');
    }
    Ok(out)
}

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
