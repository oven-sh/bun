// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Dominator and post-dominator tree computation.
//!
//! Port of Dominator.ts and ComputeUnconditionalBlocks.ts.
//! Uses the Cooper/Harvey/Kennedy algorithm from
//! https://www.cs.rice.edu/~keith/Embed/dom.pdf

use crate::diagnostics::{CompilerDiagnostic, ErrorCategory};

use crate::hir::visitors::each_terminal_successor;
use crate::hir::{BasicBlock, BlockId, HirFunction, Terminal};

const NONE: u32 = u32::MAX;

// =============================================================================
// Public types
// =============================================================================

/// From the least to the greatest id of the blocks of one function. A nested function has few of the environment's.
#[derive(Clone, Copy)]
struct BlockRange {
    first: u32,
    len: usize,
}

impl BlockRange {
    fn of(ids: &[BlockId]) -> Self {
        let Some(&BlockId(id)) = ids.first() else {
            return BlockRange { first: 0, len: 0 };
        };
        let (first, last) = ids.iter().fold((id, id), |(first, last), id| {
            (first.min(id.0), last.max(id.0))
        });
        BlockRange {
            first,
            len: (last - first) as usize + 1,
        }
    }

    #[inline]
    fn index(self, id: BlockId) -> Option<usize> {
        let index = id.0.wrapping_sub(self.first) as usize;
        (index < self.len).then_some(index)
    }
}

/// Stores the immediate post-dominator for each block.
pub struct PostDominator {
    /// The exit node (synthetic node representing function exit).
    pub exit: BlockId,
    range: BlockRange,
    /// By `BlockRange::index`. `NONE`: not a node.
    nodes: Vec<u32>,
}

impl PostDominator {
    /// Returns the immediate post-dominator of the given block, or None if
    /// the block post-dominates itself (i.e., it is the exit node).
    pub fn get(&self, id: BlockId) -> Result<Option<BlockId>, CompilerDiagnostic> {
        if id == self.exit {
            return Ok(None);
        }
        match self.range.index(id).map(|index| self.nodes[index]) {
            None | Some(NONE) => Err(crate::diagnostics::cold_invariant(
                "Unknown node in post-dominator tree",
                None,
                None,
            )
            .into()),
            Some(dominator) => Ok((dominator != id.0).then_some(BlockId(dominator))),
        }
    }
}

/// Some of the blocks of one function.
pub struct BlockSet {
    range: BlockRange,
    /// By `BlockRange::index`.
    has: Vec<bool>,
}

impl BlockSet {
    pub fn contains(&self, id: &BlockId) -> bool {
        self.range.index(*id).is_some_and(|index| self.has[index])
    }
}

/// The post-dominator frontier of each block.
pub struct PostDominatorFrontiers {
    range: BlockRange,
    frontiers: Groups,
}

impl PostDominatorFrontiers {
    pub fn get(&self, id: BlockId) -> Option<&[BlockId]> {
        self.range.index(id).map(|index| self.frontiers.get(index))
    }
}

/// A list for each of some consecutive numbers.
struct Groups {
    /// Where each list starts in `members`, and the end of the last.
    starts: Vec<u32>,
    members: Vec<BlockId>,
}

impl Groups {
    /// Each list has its members in the order of `pairs`.
    fn new(len: usize, pairs: &[(usize, BlockId)]) -> Self {
        let mut starts = vec![0; len + 1];
        for &(group, _) in pairs {
            starts[group + 1] += 1;
        }
        let mut end = 0;
        for start in &mut starts {
            end += *start;
            *start = end;
        }
        let mut ends = starts.clone();
        let mut members = vec![BlockId(NONE); pairs.len()];
        for &(group, member) in pairs {
            members[ends[group] as usize] = member;
            ends[group] += 1;
        }
        Groups { starts, members }
    }

    #[inline]
    fn get(&self, group: usize) -> &[BlockId] {
        &self.members[self.starts[group] as usize..self.starts[group + 1] as usize]
    }
}

// =============================================================================
// Graph representation
// =============================================================================

/// The reverse graph, of what reaches the exit. A node is its index in RPO: the exit is 0.
struct Graph {
    /// The block of each node after the exit.
    ids: Vec<BlockId>,
    /// Where the predecessors of each node start in `preds`, and the end of the last.
    pred_starts: Vec<u32>,
    preds: Vec<u32>,
}

// =============================================================================
// Post-dominator tree computation
// =============================================================================

/// Compute the post-dominator tree for a function.
///
/// If `include_throws_as_exit_node` is true, throw terminals are treated as
/// exit nodes (like return). Otherwise, only return terminals feed into exit.
pub fn compute_post_dominator_tree(
    func: &HirFunction,
    next_block_id_counter: u32,
    include_throws_as_exit_node: bool,
) -> Result<PostDominator, CompilerDiagnostic> {
    let exit = BlockId(next_block_id_counter);
    let ids = func.body.blocks.keys().as_slice();
    let range = BlockRange::of(ids);
    let graph = build_reverse_graph(func, range, include_throws_as_exit_node);
    let doms = compute_immediate_dominators(&graph)?;

    // When include_throws_as_exit_node is false, nodes that flow into a throw
    // terminal and don't reach the exit won't be in the node map. Add them
    // with themselves as dominator.
    let mut nodes = vec![NONE; range.len];
    if !include_throws_as_exit_node {
        for id in ids {
            nodes[(id.0 - range.first) as usize] = id.0;
        }
    }
    for (id, &dom) in graph.ids.iter().zip(&doms[1..]) {
        nodes[(id.0 - range.first) as usize] = match dom {
            0 => exit.0,
            dom => graph.ids[dom as usize - 1].0,
        };
    }

    Ok(PostDominator { exit, range, nodes })
}

/// Build the reverse graph from the HIR function.
///
/// Reverses all edges and adds a synthetic exit node that receives edges from
/// return (and optionally throw) terminals. The result is put into RPO order.
fn build_reverse_graph(
    func: &HirFunction,
    range: BlockRange,
    include_throws_as_exit_node: bool,
) -> Graph {
    let ids = func.body.blocks.keys().as_slice();
    let blocks = func.body.blocks.values().as_slice();
    let flows_into_exit = |block: &BasicBlock| match &block.terminal {
        Terminal::Return { .. } => true,
        Terminal::Throw { .. } => include_throws_as_exit_node,
        _ => false,
    };

    // By `BlockRange::index`.
    let mut places = vec![NONE; range.len];
    for (place, id) in ids.iter().enumerate() {
        places[(id.0 - range.first) as usize] = place as u32;
    }

    // DFS from exit to compute RPO
    let mut visited = vec![false; blocks.len()];
    let mut postorder = Vec::with_capacity(blocks.len());
    let mut stack = Vec::with_capacity(16);
    for (place, block) in blocks.iter().enumerate() {
        if !flows_into_exit(block) || std::mem::replace(&mut visited[place], true) {
            continue;
        }
        stack.push((place, block.preds.iter()));
        while let Some((place, successors)) = stack.last_mut() {
            match successors.next() {
                Some(successor) => {
                    let successor = places[(successor.0 - range.first) as usize] as usize;
                    if !std::mem::replace(&mut visited[successor], true) {
                        stack.push((successor, blocks[successor].preds.iter()));
                    }
                }
                None => {
                    postorder.push(*place);
                    stack.pop();
                }
            }
        }
    }

    // Reverse postorder
    postorder.reverse();

    // By `BlockRange::index`. `NONE`: it does not reach the exit, so that it is never processed.
    let mut nodes = places;
    nodes.fill(NONE);
    for (index, &place) in postorder.iter().enumerate() {
        nodes[(ids[place].0 - range.first) as usize] = index as u32 + 1;
    }

    let mut pred_starts = Vec::with_capacity(postorder.len() + 2);
    pred_starts.extend([0, 0]);
    let mut preds = Vec::with_capacity(postorder.len() * 2);
    for &place in &postorder {
        let block = &blocks[place];
        if flows_into_exit(block) {
            preds.push(0);
        }
        for successor in each_terminal_successor(&block.terminal) {
            match range.index(successor).map(|index| nodes[index]) {
                None | Some(NONE) => {}
                Some(node) => preds.push(node),
            }
        }
        pred_starts.push(preds.len() as u32);
    }

    Graph {
        ids: postorder.into_iter().map(|place| ids[place]).collect(),
        pred_starts,
        preds,
    }
}

// =============================================================================
// Dominator fixpoint (Cooper/Harvey/Kennedy)
// =============================================================================

fn compute_immediate_dominators(graph: &Graph) -> Result<Vec<u32>, CompilerDiagnostic> {
    let mut doms = vec![NONE; graph.ids.len() + 1];
    doms[0] = 0;

    let mut changed = true;
    while changed {
        changed = false;
        for (index, &id) in graph.ids.iter().enumerate() {
            let node = index + 1;
            let preds = graph.pred_starts[node] as usize..graph.pred_starts[node + 1] as usize;

            // Intersect the processed predecessors
            let mut new_idom = NONE;
            for &pred in &graph.preds[preds] {
                if doms[pred as usize] == NONE {
                    continue;
                }
                new_idom = match new_idom {
                    NONE => pred,
                    idom => intersect(pred, idom, &doms),
                };
            }
            if new_idom == NONE {
                return Err(no_processed_pred(id));
            }

            if doms[node] != new_idom {
                doms[node] = new_idom;
                changed = true;
            }
        }
    }
    Ok(doms)
}

fn intersect(mut a: u32, mut b: u32, doms: &[u32]) -> u32 {
    while a != b {
        while a > b {
            a = doms[a as usize];
        }
        while b > a {
            b = doms[b as usize];
        }
    }
    a
}

#[cold]
#[inline(never)]
fn no_processed_pred(id: BlockId) -> CompilerDiagnostic {
    CompilerDiagnostic::new(
        ErrorCategory::Invariant,
        format!(
            "At least one predecessor must have been visited for block {:?}",
            id
        ),
        None,
    )
}

// =============================================================================
// Post-dominator frontier
// =============================================================================

/// Computes the post-dominator frontier of each `target_id`. These are immediate
/// predecessors of nodes that post-dominate `target_id` from which execution may
/// not reach `target_id`. Intuitively, these are the earliest blocks from which
/// execution branches such that it may or may not reach the target block.
pub fn post_dominator_frontiers(
    func: &HirFunction,
    post_dominators: &PostDominator,
) -> Result<PostDominatorFrontiers, CompilerDiagnostic> {
    let range = post_dominators.range;
    let index_of = |id: BlockId| (id.0 - range.first) as usize;

    let mut edges = Vec::with_capacity(func.body.blocks.len() * 2);
    for (&block_id, block) in &func.body.blocks {
        for &pred in &block.preds {
            post_dominators.get(pred)?;
            edges.push((index_of(pred), block_id));
        }
    }
    let successors = Groups::new(range.len, &edges);

    let mut frontiers = edges;
    frontiers.clear();
    // By `BlockRange::index`: the last block that was put into the frontier of this one.
    let mut newest = vec![BlockId(NONE); range.len];
    for &pred in func.body.blocks.keys() {
        // `pred` is in the frontier of each successor and its post-dominators that are not `pred`'s.
        let end = post_dominators.get(pred)?.unwrap_or(pred);
        for &block_id in successors.get(index_of(pred)) {
            let mut target_id = block_id;
            while target_id != end && newest[index_of(target_id)] != pred {
                newest[index_of(target_id)] = pred;
                frontiers.push((index_of(target_id), pred));
                match post_dominators.get(target_id)? {
                    Some(next) if next != post_dominators.exit => target_id = next,
                    _ => break,
                }
            }
        }
    }
    Ok(PostDominatorFrontiers {
        range,
        frontiers: Groups::new(range.len, &frontiers),
    })
}

// =============================================================================
// Unconditional blocks
// =============================================================================

/// Compute the set of blocks that are unconditionally executed from the entry.
///
/// Port of ComputeUnconditionalBlocks.ts. Walks the immediate post-dominator
/// chain starting from the function entry. A block is unconditional if it lies
/// on this chain (meaning every path through the function must pass through it).
pub fn compute_unconditional_blocks(
    func: &HirFunction,
    next_block_id_counter: u32,
) -> Result<BlockSet, CompilerDiagnostic> {
    let dominators = compute_post_dominator_tree(func, next_block_id_counter, false)?;
    let range = dominators.range;
    let mut has = vec![false; range.len];
    let exit = dominators.exit;
    let mut current: Option<BlockId> = Some(func.body.entry);

    while let Some(block_id) = current {
        if block_id == exit {
            break;
        }
        current = dominators.get(block_id)?;
        crate::diagnostics::invariant(
            !std::mem::replace(&mut has[(block_id.0 - range.first) as usize], true),
            "Internal error: non-terminating loop in ComputeUnconditionalBlocks",
        )?;
    }

    Ok(BlockSet { range, has })
}
