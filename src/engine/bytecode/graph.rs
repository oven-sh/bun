//! Basic blocks.

use core::ops::Range;

use crate::bytes::Sink;
use crate::code::{Body, TooLarge};
use crate::effects::{EdgeKind, Resumption};
use crate::instruction::{Instructions, Opcode, RawInstruction};

/// In the order of the code. The first block is the entry.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct BlockIndex(pub u32);

impl BlockIndex {
    #[inline(always)]
    pub const fn index(self) -> usize {
        self.0 as usize
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Edge {
    /// At the other end.
    pub block: BlockIndex,
    pub kind: EdgeKind,
}

const NONE: u32 = u32::MAX;

#[derive(Clone, Copy)]
struct Block {
    start: u32,
    handler: u32,
    first_successor: u32,
    first_predecessor: u32,
}

/// A bit for each of 64 bytes of code.
#[derive(Clone, Copy, Default)]
struct Starts {
    of_blocks: u64,
    of_instructions_that_throw: u64,
    blocks_before: u32,
}

/// An instruction that ends a block wherever it stands.
#[derive(Clone, Copy)]
struct Exit {
    offset: u32,
    opcode: Opcode,
    only_target: Option<u32>,
}

impl Exit {
    #[inline(always)]
    fn for_each_target(self, body: &Body, resumption: Resumption, mut visit: impl FnMut(u32)) {
        if let Some(target) = self.only_target {
            visit(target);
        } else if resumption.branches(self.opcode) {
            let instruction = RawInstruction::read(body.padded_instructions(), self.offset);
            (instruction.expect("verified")).for_each_target(body, self.offset, visit);
        }
    }
}

/// Only the last instruction of a block jumps. Any may throw, all to the same handler.
#[derive(Default)]
pub struct Graph {
    starts: Vec<Starts>,
    /// And one that starts where the code ends.
    blocks: Vec<Block>,
    successors: Sink<Edge>,
    predecessors: Vec<Edge>,
    exits: Vec<Exit>,
    scratch: Vec<u32>,
}

pub(crate) fn refill<T: Copy>(vector: &mut Vec<T>, len: usize, value: T) -> Result<(), TooLarge> {
    vector.clear();
    vector.try_reserve(len).map_err(|_| TooLarge)?;
    vector.resize(len, value);
    Ok(())
}

impl Graph {
    /// Of verified code.
    pub fn new(body: &Body) -> Result<Graph, TooLarge> {
        let mut graph = Graph::default();
        graph.build(body, Resumption::Dispatched)?;
        (graph.exits, graph.scratch) = (Vec::new(), Vec::new());
        Ok(graph)
    }

    pub(crate) fn build(&mut self, body: &Body, resumption: Resumption) -> Result<(), TooLarge> {
        self.find_blocks(body, resumption)?;
        self.find_handlers(body)?;
        self.find_successors(body, resumption)?;
        self.find_predecessors()
    }

    fn find_blocks(&mut self, body: &Body, resumption: Resumption) -> Result<(), TooLarge> {
        let (code, size) = (body.padded_instructions(), body.instructions_size);
        refill(&mut self.starts, size as usize / 64 + 1, Starts::default())?;
        self.exits.clear();
        let starts = self.starts.as_mut_slice();
        let lead = |starts: &mut [Starts], offset: u32| {
            starts[offset as usize / 64].of_blocks |= 1 << (offset % 64);
        };
        lead(starts, 0);
        lead(starts, size);
        for handler in body.handlers() {
            lead(starts, handler.range.start);
            lead(starts, handler.range.end);
            lead(starts, handler.target);
        }
        let mut offset = 0;
        while offset < size {
            let (opcode, size) = Opcode::read(code, offset).expect("verified");
            starts[offset as usize / 64].of_instructions_that_throw |=
                u64::from(opcode.flow().can_throw()) << (offset % 64);
            if opcode.branches() | !opcode.flow().falls_through() {
                let exit = Exit {
                    offset,
                    opcode,
                    only_target: opcode.only_target(code, offset),
                };
                self.exits.try_reserve(1).map_err(|_| TooLarge)?;
                self.exits.push(exit);
                lead(starts, offset + size);
                exit.for_each_target(body, resumption, |target| lead(starts, target));
            }
            offset += size;
        }

        let mut count = 0;
        for starts in &mut *starts {
            starts.blocks_before = count;
            count += starts.of_blocks.count_ones();
        }
        self.blocks.clear();
        (self.blocks.try_reserve(count as usize)).map_err(|_| TooLarge)?;
        for (word, starts) in (0..).zip(starts) {
            let mut bits = starts.of_blocks;
            while bits != 0 {
                self.blocks.push(Block {
                    start: word * 64 + bits.trailing_zeros(),
                    handler: NONE,
                    first_successor: 0,
                    first_predecessor: 0,
                });
                bits &= bits - 1;
            }
        }
        Ok(())
    }

    fn throws(&self, range: Range<u32>) -> bool {
        let last = range.end - 1;
        (range.start / 64..=last / 64).any(|word| {
            let from = range.start.saturating_sub(word * 64);
            let to = (last - word * 64).min(63);
            self.starts[word as usize].of_instructions_that_throw << (63 - to) >> (63 - to + from)
                != 0
        })
    }

    fn find_handlers(&mut self, body: &Body) -> Result<(), TooLarge> {
        if body.handlers().is_empty() {
            return Ok(());
        }
        // Leads from a block that has a handler towards the next that has none.
        refill(&mut self.scratch, self.blocks.len(), 0)?;
        for handler in body.handlers() {
            let [mut block, end, target] = [handler.range.start, handler.range.end, handler.target]
                .map(|offset| self.block_at(offset).0);
            while block < end {
                let state = &mut self.blocks[block as usize];
                let skip = &mut self.scratch[block as usize];
                if state.handler == NONE {
                    state.handler = target;
                    *skip = end;
                    block += 1;
                } else {
                    let next = *skip;
                    *skip = next.max(end);
                    block = next;
                }
            }
        }
        Ok(())
    }

    fn find_successors(&mut self, body: &Body, resumption: Resumption) -> Result<(), TooLarge> {
        let mut successors = core::mem::take(&mut self.successors);
        successors.go_back(0);
        successors.has_room(2 * self.len());
        // The last block that was found to jump to each.
        let mut jumped_from = core::mem::take(&mut self.scratch);
        refill(&mut jumped_from, self.blocks.len(), NONE)?;
        let mut exits = 0;
        for index in 0..self.len() as u32 {
            self.blocks[index as usize].first_successor = successors.len() as u32;
            let range = self.range(BlockIndex(index));
            let mut falls_through = true;
            if let Some(&exit) = self.exits.get(exits)
                && exit.offset < range.end
            {
                exits += 1;
                falls_through = resumption.falls_through(exit.opcode.flow());
                exit.for_each_target(body, resumption, |target| {
                    let block = self.block_at(target);
                    if core::mem::replace(&mut jumped_from[block.index()], index) != index {
                        let kind = EdgeKind::Jump;
                        successors.push(Edge { block, kind });
                    }
                });
            }
            if falls_through {
                successors.push(Edge {
                    block: BlockIndex(index + 1),
                    kind: EdgeKind::FallThrough,
                });
            }
            if let Some(block) = self.handler(BlockIndex(index))
                && self.throws(range)
            {
                let kind = EdgeKind::Throw;
                successors.push(Edge { block, kind });
            }
        }
        successors.check()?;
        let end = self.len();
        self.blocks[end].first_successor = successors.len() as u32;
        self.successors = successors;
        self.scratch = jumped_from;
        Ok(())
    }

    fn find_predecessors(&mut self) -> Result<(), TooLarge> {
        for edge in &*self.successors {
            self.blocks[edge.block.index()].first_predecessor += 1;
        }
        let mut end = 0;
        for block in &mut self.blocks {
            end += block.first_predecessor;
            block.first_predecessor = end;
        }
        let Some(&any) = self.successors.first() else {
            self.predecessors.clear();
            return Ok(());
        };
        refill(&mut self.predecessors, self.successors.len(), any)?;
        for index in (0..self.len()).rev() {
            let first = self.blocks[index].first_successor as usize;
            let end = self.blocks[index + 1].first_successor as usize;
            for edge in self.successors[first..end].iter().rev() {
                let at = &mut self.blocks[edge.block.index()].first_predecessor;
                *at -= 1;
                self.predecessors[*at as usize] = Edge {
                    block: BlockIndex(index as u32),
                    kind: edge.kind,
                };
            }
        }
        Ok(())
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.blocks.len() - 1
    }

    pub fn blocks(&self) -> impl DoubleEndedIterator<Item = BlockIndex> + use<> {
        (0..self.len() as u32).map(BlockIndex)
    }

    /// The one that has the byte at `offset`.
    #[inline]
    pub fn block_at(&self, offset: u32) -> BlockIndex {
        let starts = &self.starts[offset as usize / 64];
        let up_to_here = starts.of_blocks << (63 - offset % 64);
        BlockIndex(starts.blocks_before + up_to_here.count_ones() - 1)
    }

    #[inline]
    pub fn range(&self, block: BlockIndex) -> Range<u32> {
        self.blocks[block.index()].start..self.blocks[block.index() + 1].start
    }

    #[inline]
    pub fn instructions<'a>(&self, body: &'a Body, block: BlockIndex) -> Instructions<'a> {
        Instructions::new(body.padded_instructions(), self.range(block))
    }

    /// Whether or not anything in the block throws.
    #[inline]
    pub fn handler(&self, block: BlockIndex) -> Option<BlockIndex> {
        let handler = self.blocks[block.index()].handler;
        (handler != NONE).then_some(BlockIndex(handler))
    }

    /// No edge comes twice.
    #[inline]
    pub fn successors(&self, block: BlockIndex) -> &[Edge] {
        let first = self.blocks[block.index()].first_successor;
        let end = self.blocks[block.index() + 1].first_successor;
        &self.successors[first as usize..end as usize]
    }

    #[inline]
    pub fn predecessors(&self, block: BlockIndex) -> &[Edge] {
        let first = self.blocks[block.index()].first_predecessor;
        let end = self.blocks[block.index() + 1].first_predecessor;
        &self.predecessors[first as usize..end as usize]
    }
}
