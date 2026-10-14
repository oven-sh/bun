//! What is live once some features are excluded. The same for every object format.
//!
//! A node refers to other nodes through relocations. A function that holds feature markers is split further, into basic
//! BLOCKS, so that the code behind an excluded marker stops counting as a reference to anything.

use super::{Nodes, Result};

pub(super) struct Block {
    pub(super) start: u64,
    pub(super) end: u64,
    /// The blocks that can run after this one. Unused if the block ends in a marker.
    pub(super) succ: Vec<u32>,
    pub(super) marker: Option<BlockMarker>,
}

/// The block ends in a marker: `yes` follows if the feature is present, `no` if it is excluded.
pub(super) struct BlockMarker {
    pub(super) id: u32,
    pub(super) yes: Option<u32>,
    pub(super) no: u32,
}

/// The blocks of the functions that are split.
#[derive(Default)]
pub(super) struct Blocks {
    pub(super) all: Vec<Block>,
    /// Per node that is split: its first block, and how many it has. In the order the functions were split.
    pub(super) of: Vec<(usize, (usize, usize))>,
}

impl Blocks {
    pub(super) fn of(&self, node: usize) -> Option<(usize, usize)> {
        self.of.iter().find(|f| f.0 == node).map(|f| f.1)
    }

    /// Of the blocks `first..first + count`, the last that starts at or below `address`, or the first.
    pub(super) fn at(&self, (first, count): (usize, usize), address: u64) -> usize {
        let after = self.all[first..first + count].partition_point(|b| b.start <= address);
        first + after.saturating_sub(1)
    }
}

pub(super) trait Image {
    fn nodes(&self) -> &Nodes;
    fn blocks(&self) -> &Blocks;
    /// Calls `touch` with every address that the bytes in `[start, end)` refer to.
    fn references(&self, start: u64, end: u64, touch: &mut dyn FnMut(u64)) -> Result<()>;
}

#[derive(Clone, Copy)]
pub(super) enum Excluded<'a> {
    /// Follow both sides of every marker, which is what the linker saw.
    BothSides,
    Features(&'a [u32]),
}

pub(super) struct Liveness {
    pub(super) node: Vec<bool>,
    pub(super) block: Vec<bool>,
}

enum Work {
    Node(usize),
    Block(usize),
}

/// Marks everything that is reached from `roots`.
pub(super) fn mark(image: &dyn Image, roots: &[u64], excluded: Excluded<'_>) -> Result<Liveness> {
    let (nodes, blocks) = (image.nodes(), image.blocks());
    let mut live = Liveness {
        node: vec![false; nodes.len()],
        block: vec![false; blocks.all.len()],
    };
    let mut work = Vec::new();

    let touch = |address: u64, live: &mut Liveness, work: &mut Vec<Work>| {
        let Some(n) = nodes.find(address) else { return };
        if let Some(of) = blocks.of(n) {
            let b = blocks.at(of, address);
            if !live.block[b] {
                live.block[b] = true;
                live.node[n] = true;
                work.push(Work::Block(b));
            }
        } else if !live.node[n] {
            live.node[n] = true;
            work.push(Work::Node(n));
        }
    };
    let enter = |b: u32, live: &mut Liveness, work: &mut Vec<Work>| {
        if !live.block[b as usize] {
            live.block[b as usize] = true;
            work.push(Work::Block(b as usize));
        }
    };

    for &root in roots {
        touch(root, &mut live, &mut work);
    }
    while let Some(item) = work.pop() {
        let (start, end) = match item {
            Work::Node(n) => (nodes.addr[n], nodes.end(n)),
            Work::Block(b) => (blocks.all[b].start, blocks.all[b].end),
        };
        image.references(start, end, &mut |address| {
            touch(address, &mut live, &mut work)
        })?;
        let Work::Block(b) = item else { continue };
        match (&blocks.all[b].marker, excluded) {
            (None, _) => blocks.all[b]
                .succ
                .iter()
                .for_each(|&next| enter(next, &mut live, &mut work)),
            (Some(m), Excluded::BothSides) => {
                m.yes
                    .into_iter()
                    .chain([m.no])
                    .for_each(|next| enter(next, &mut live, &mut work));
            }
            (Some(m), Excluded::Features(out)) if out.contains(&m.id) => {
                enter(m.no, &mut live, &mut work)
            }
            (Some(m), Excluded::Features(_)) => m
                .yes
                .into_iter()
                .for_each(|next| enter(next, &mut live, &mut work)),
        }
    }
    Ok(live)
}
