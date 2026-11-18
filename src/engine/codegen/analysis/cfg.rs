//! The order of blocks, their predecessors and the loops they form.

use crate::ir::{Block, Edge, Entity, Function, Table, entities};

entities! {
    Loop = "loop";
}

#[derive(Clone, Copy)]
pub struct LoopData {
    pub header: Block,
    pub parent: Loop,
    /// One for an outermost loop.
    pub depth: u32,
    /// Control enters through the header only.
    pub is_natural: bool,
    first: u32,
    end: u32,
}

impl LoopData {
    /// Those of its blocks in the order.
    #[inline]
    pub fn positions(&self) -> core::ops::Range<u32> {
        self.first..self.end
    }
}

#[derive(Clone, Copy)]
struct Search {
    /// The depth on the path from the entry, from one. Zero once the block is left.
    depth: u32,
    /// Of the innermost loop around the block, not counting one that the block itself heads.
    header: Block,
    /// If it has other entries: a header further out, up to which all have other entries.
    beyond: Block,
    is_visited: bool,
    is_header: bool,
    has_other_entries: bool,
}

const UNREACHED: u32 = u32::MAX;

#[derive(Default)]
pub struct Cfg {
    order: Vec<Block>,
    position: Table<Block, u32>,
    predecessors: Vec<Edge>,
    predecessors_end: Table<Block, u32>,
    loops: Table<Loop, LoopData>,
    loop_of: Table<Block, Loop>,
    search: Table<Block, Search>,
    stack: Vec<(Block, u32)>,
    post_order: Vec<Block>,
    first_member: Table<Block, Block>,
    next_member: Table<Block, Block>,
}

impl Cfg {
    pub fn new(function: &Function) -> Self {
        let mut cfg = Self::default();
        cfg.compute(function);
        cfg
    }

    pub fn compute(&mut self, function: &Function) {
        self.search(function);
        self.arrange(function);
        self.collect_predecessors(function);
    }

    /// The reachable blocks, each after those that dominate it, and those of a loop together with the header first.
    #[inline]
    pub fn order(&self) -> &[Block] {
        &self.order
    }

    #[inline]
    pub fn position(&self, block: Block) -> u32 {
        self.position[block]
    }

    #[inline]
    pub fn is_reachable(&self, block: Block) -> bool {
        self.position[block] != UNREACHED
    }

    /// The edges from reachable blocks.
    #[inline]
    pub fn predecessors(&self, block: Block) -> &[Edge] {
        let start = block
            .index()
            .checked_sub(1)
            .map_or(0, |before| self.predecessors_end[Block::from_index(before)]);
        &self.predecessors[start as usize..self.predecessors_end[block] as usize]
    }

    /// Goes against the order.
    #[inline]
    pub fn is_backward(&self, function: &Function, edge: Edge) -> bool {
        self.position[function.target(edge)] <= self.position[function.source(edge)]
    }

    /// An outer loop comes before those in it.
    pub fn loops(&self) -> &Table<Loop, LoopData> {
        &self.loops
    }

    /// The innermost loop that includes the block.
    #[inline]
    pub fn loop_of(&self, block: Block) -> Loop {
        self.loop_of[block]
    }

    #[inline]
    pub fn loop_headed_by(&self, block: Block) -> Option<Loop> {
        self.loop_of[block]
            .expand()
            .filter(|&found| self.loops[found].header == block)
    }

    #[inline]
    pub fn depth(&self, block: Block) -> u32 {
        self.loop_of[block]
            .expand()
            .map_or(0, |found| self.loops[found].depth)
    }

    #[inline]
    pub fn includes(&self, outer: Loop, block: Block) -> bool {
        let data = &self.loops[outer];
        (data.first..data.end).contains(&self.position[block])
    }

    pub fn blocks_of(&self, outer: Loop) -> &[Block] {
        let data = &self.loops[outer];
        &self.order[data.first as usize..data.end as usize]
    }

    /// Wei, Mao, Zou and Chen, "A New Algorithm for Identifying Loops in Decompilation".
    fn search(&mut self, function: &Function) {
        let unseen = Search {
            depth: 0,
            header: Block::NONE,
            beyond: Block::NONE,
            is_visited: false,
            is_header: false,
            has_other_entries: false,
        };
        self.search.refill(function.block_count(), unseen);
        self.post_order.clear();
        for entry in function.entries().iter().rev() {
            self.enter(function, entry.block);
            while let Some((block, remaining)) = self.stack.last_mut() {
                let block = *block;
                if *remaining == 0 {
                    self.stack.pop();
                    self.search[block].depth = 0;
                    self.post_order.push(block);
                    if let Some(&(parent, _)) = self.stack.last() {
                        self.add_header(parent, self.search[block].header);
                    }
                    continue;
                }
                *remaining -= 1;
                let target = function.target(function.successor(block, *remaining as usize));
                if self.search[target].is_visited {
                    self.meet_again(block, target);
                } else {
                    self.enter(function, target);
                }
            }
        }
    }

    fn enter(&mut self, function: &Function, block: Block) {
        self.stack
            .push((block, function.successors(block).len() as u32));
        self.search[block].is_visited = true;
        self.search[block].depth = self.stack.len() as u32;
    }

    fn meet_again(&mut self, block: Block, target: Block) {
        if self.search[target].depth != 0 {
            self.search[target].is_header = true;
            return self.add_header(block, target);
        }
        let innermost = self.search[target].header;
        let mut header = innermost;
        while !header.is_none() && self.search[header].depth == 0 {
            let entered = &mut self.search[header];
            if !core::mem::replace(&mut entered.has_other_entries, true) {
                entered.beyond = entered.header;
            }
            header = entered.beyond;
        }
        let mut passed = innermost;
        while passed != header {
            passed = core::mem::replace(&mut self.search[passed].beyond, header);
        }
        self.add_header(block, header);
    }

    fn add_header(&mut self, mut block: Block, mut header: Block) {
        if block == header || header.is_none() {
            return;
        }
        while let Some(known) = self.search[block].header.expand() {
            if known == header {
                return;
            }
            if self.search[known].depth < self.search[header].depth {
                self.search[block].header = header;
                (block, header) = (header, known);
            } else {
                block = known;
            }
        }
        self.search[block].header = header;
    }

    fn arrange(&mut self, function: &Function) {
        let count = function.block_count();
        self.position.refill(count, UNREACHED);
        self.loop_of.refill(count, Loop::NONE);
        self.loops.clear();
        self.order.clear();
        self.first_member.refill(count, Block::NONE);
        self.next_member.refill(count, Block::NONE);
        let mut first_outside = Block::NONE;
        for &block in &self.post_order {
            let first = match self.search[block].header.expand() {
                Some(header) => &mut self.first_member[header],
                None => &mut first_outside,
            };
            self.next_member[block] = core::mem::replace(first, block);
        }

        let (mut block, mut current) = (first_outside, Loop::NONE);
        loop {
            while block.is_none() {
                let Some(finished) = current.expand() else {
                    return;
                };
                let data = &mut self.loops[finished];
                data.end = self.order.len() as u32;
                (block, current) = (self.next_member[data.header], data.parent);
            }
            let position = self.order.len() as u32;
            self.position[block] = position;
            self.order.push(block);
            if self.search[block].is_header {
                current = self.loops.push(LoopData {
                    header: block,
                    parent: current,
                    depth: current
                        .expand()
                        .map_or(0, |parent| self.loops[parent].depth)
                        + 1,
                    is_natural: !self.search[block].has_other_entries,
                    first: position,
                    end: position,
                });
                self.loop_of[block] = current;
                block = self.first_member[block];
            } else {
                self.loop_of[block] = current;
                block = self.next_member[block];
            }
        }
    }

    fn collect_predecessors(&mut self, function: &Function) {
        self.predecessors_end.refill(function.block_count(), 0);
        for &block in &self.order {
            for edge in function.successors(block) {
                self.predecessors_end[function.target(edge)] += 1;
            }
        }
        let mut total = 0;
        for count in self.predecessors_end.values_mut() {
            total += core::mem::replace(count, total);
        }
        self.predecessors.clear();
        self.predecessors.resize(total as usize, Edge::NONE);
        for &block in &self.order {
            for edge in function.successors(block) {
                let next = &mut self.predecessors_end[function.target(edge)];
                self.predecessors[*next as usize] = edge;
                *next += 1;
            }
        }
    }

    /// Returns whether there were any. What was computed stays valid.
    pub fn remove_unreachable_blocks(&self, function: &mut Function) -> bool {
        let mut removed_any = false;
        for block in self.position.keys() {
            if !self.is_reachable(block) && !function.is_removed(block) {
                function.remove_block(block);
                removed_any = true;
            }
        }
        removed_any
    }
}
