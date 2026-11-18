use super::Cfg;
use crate::ir::{Block, Function, Table, Value};

/// A block in the tree of dominators. Ranks are positions in the order from one, and zero is a root above the entries.
#[derive(Clone, Copy)]
pub(crate) struct Ancestry {
    pub(crate) parent: u32,
    /// An ancestor from which any other is a logarithmic number of steps away: Myers, "An Applicative Random-Access
    /// Stack". It is the parent, or what two jumps from the parent reach.
    pub(crate) jump: u32,
    depth: u32,
}

/// A forest: entries, and blocks that several entries reach independently, are roots.
#[derive(Default)]
pub struct Dominators {
    parent: Table<Block, Block>,
    jump: Table<Block, Block>,
    first_child: Table<Block, Block>,
    next_sibling: Table<Block, Block>,
    first_root: Option<Block>,
    /// When a walk of the forest enters and leaves the block.
    interval: Table<Block, (u32, u32)>,
    pre_order: Vec<Block>,
    by_rank: Vec<Ancestry>,
}

const ROOT: Ancestry = Ancestry {
    parent: 0,
    jump: 0,
    depth: 0,
};

fn child_of(tree: &[Ancestry], parent: u32) -> Ancestry {
    let above = tree[parent as usize];
    let jumped = tree[above.jump as usize];
    let are_even = above.depth - jumped.depth == jumped.depth - tree[jumped.jump as usize].depth;
    Ancestry {
        parent,
        jump: if are_even { jumped.jump } else { parent },
        depth: above.depth + 1,
    }
}

#[inline]
fn common_ancestor(tree: &[Ancestry], mut a: u32, mut b: u32) -> u32 {
    const SHORT_WALK: u32 = 8;
    for _ in 0..SHORT_WALK {
        if a == b {
            return a;
        }
        if a > b {
            a = tree[a as usize].parent;
        } else {
            b = tree[b as usize].parent;
        }
    }
    distant_common_ancestor(tree, a, b)
}

fn distant_common_ancestor(tree: &[Ancestry], mut a: u32, mut b: u32) -> u32 {
    if tree[a as usize].depth < tree[b as usize].depth {
        core::mem::swap(&mut a, &mut b);
    }
    let depth = tree[b as usize].depth;
    while tree[a as usize].depth > depth {
        let Ancestry { parent, jump, .. } = tree[a as usize];
        a = if tree[jump as usize].depth >= depth {
            jump
        } else {
            parent
        };
    }
    while a != b {
        let (left, right) = (tree[a as usize], tree[b as usize]);
        (a, b) = if left.jump != right.jump {
            (left.jump, right.jump)
        } else {
            (left.parent, right.parent)
        };
    }
    a
}

/// A block in a depth-first search, in which blocks are numbered from one as they are entered.
#[derive(Clone, Copy)]
struct Vertex {
    block: Block,
    parent: u32,
    semidominator: u32,
    /// In the tree of the search, once the vertex has its semidominator.
    ancestor: u32,
    /// Of the vertices below `ancestor` down to this.
    least_semidominator: u32,
}

fn search(function: &Function, numbers: &mut Table<Block, u32>) -> Vec<Vertex> {
    let vertex = |block, number, parent| Vertex {
        block,
        parent,
        semidominator: parent,
        ancestor: parent,
        least_semidominator: number,
    };
    let mut vertices = vec![vertex(Block::NONE, 0, 0)];
    let entries = function.entries().iter();
    let mut pending: Vec<(Block, u32)> = entries.map(|entry| (entry.block, 0)).collect();
    while let Some((block, parent)) = pending.pop() {
        if numbers[block] == 0 {
            let number = vertices.len() as u32;
            numbers[block] = number;
            vertices.push(vertex(block, number, parent));
            let targets = function.successors(block).map(|edge| function.target(edge));
            pending.extend(targets.map(|target| (target, number)));
        }
    }
    vertices
}

/// Their ranks, in the order of the blocks. Georgiadis, Tarjan and Werneck, "Finding Dominators in Practice".
fn nearest_dominators(function: &Function, cfg: &Cfg) -> Vec<u32> {
    let mut numbers = function.block_table(0);
    let mut vertices = search(function, &mut numbers);
    let mut path = Vec::new();
    for number in (1..vertices.len()).rev() {
        let mut least = vertices[number].parent;
        for &edge in cfg.predecessors(vertices[number].block) {
            let source = numbers[function.source(edge)] as usize;
            let mut at = source;
            while vertices[at].ancestor as usize > number {
                path.push(at);
                at = vertices[at].ancestor as usize;
            }
            while let Some(below) = path.pop() {
                let (above, below) = (
                    vertices[vertices[below].ancestor as usize],
                    &mut vertices[below],
                );
                below.least_semidominator =
                    below.least_semidominator.min(above.least_semidominator);
                below.ancestor = above.ancestor;
            }
            least = least.min(vertices[source].least_semidominator);
        }
        (
            vertices[number].semidominator,
            vertices[number].least_semidominator,
        ) = (least, least);
    }
    let mut tree = vec![ROOT];
    let mut nearest = vec![0; cfg.order().len()];
    for vertex in &vertices[1..] {
        let mut above = vertex.parent;
        while above > vertex.semidominator {
            let Ancestry { parent, jump, .. } = tree[above as usize];
            above = if jump > vertex.semidominator {
                jump
            } else {
                parent
            };
        }
        tree.push(child_of(&tree, above));
        if let Some(dominator) = vertices[above as usize].block.expand() {
            nearest[cfg.position(vertex.block) as usize] = cfg.position(dominator) + 1;
        }
    }
    nearest
}

impl Dominators {
    pub fn new(function: &Function, cfg: &Cfg) -> Self {
        let mut dominators = Self::default();
        dominators.compute(function, cfg);
        dominators
    }

    pub fn compute(&mut self, function: &Function, cfg: &Cfg) {
        let tree = &mut self.by_rank;
        tree.clear();
        tree.push(ROOT);
        if cfg.loops().values().all(|data| data.is_natural) {
            for (rank, &block) in (1..).zip(cfg.order()) {
                let sources = cfg.predecessors(block).iter();
                let common = sources
                    .map(|&edge| cfg.position(function.source(edge)) + 1)
                    .take_while(|&source| source < rank)
                    .reduce(|a, b| common_ancestor(tree, a, b));
                tree.push(child_of(tree, common.unwrap_or(0)));
            }
        } else {
            for parent in nearest_dominators(function, cfg) {
                tree.push(child_of(tree, parent));
            }
        }

        let count = function.block_count();
        self.parent.refill(count, Block::NONE);
        self.jump.refill(count, Block::NONE);
        self.first_child.refill(count, Block::NONE);
        self.next_sibling.refill(count, Block::NONE);
        let block_at = |rank: u32| {
            rank.checked_sub(1)
                .map_or(Block::NONE, |position| cfg.order()[position as usize])
        };
        let mut first_root = Block::NONE;
        for (&block, ancestry) in cfg.order().iter().zip(&tree[1..]).rev() {
            (self.parent[block], self.jump[block]) =
                (block_at(ancestry.parent), block_at(ancestry.jump));
            let first = match self.parent[block].expand() {
                Some(parent) => &mut self.first_child[parent],
                None => &mut first_root,
            };
            self.next_sibling[block] = core::mem::replace(first, block);
        }
        self.first_root = first_root.expand();
        self.number(count);
    }

    fn number(&mut self, count: usize) {
        self.interval.refill(count, (u32::MAX, 0));
        self.pre_order.clear();
        let mut next = self.first_root;
        while let Some(mut block) = next {
            self.interval[block].0 = self.pre_order.len() as u32;
            self.pre_order.push(block);
            next = self.first_child[block].expand();
            while next.is_none() {
                self.interval[block].1 = self.pre_order.len() as u32;
                next = self.next_sibling[block].expand();
                match self.parent[block].expand() {
                    Some(parent) if next.is_none() => block = parent,
                    _ => break,
                }
            }
        }
    }

    /// The nearest block that dominates `block`, other than itself.
    #[inline]
    pub fn parent(&self, block: Block) -> Option<Block> {
        self.parent[block].expand()
    }

    pub fn children(&self, block: Block) -> impl Iterator<Item = Block> {
        core::iter::successors(self.first_child[block].expand(), |&child| {
            self.next_sibling[child].expand()
        })
    }

    /// The blocks that one block dominates follow it directly.
    pub fn pre_order(&self) -> &[Block] {
        &self.pre_order
    }

    /// The position in `pre_order` after the last block that `block` dominates.
    #[inline]
    pub fn end_of_subtree(&self, block: Block) -> u32 {
        self.interval[block].1
    }

    /// A block dominates itself.
    #[inline]
    pub fn dominates(&self, a: Block, b: Block) -> bool {
        let ((start, end), (position, _)) = (self.interval[a], self.interval[b]);
        (start..end).contains(&position)
    }

    #[inline]
    pub fn strictly_dominates(&self, a: Block, b: Block) -> bool {
        a != b && self.dominates(a, b)
    }

    /// Whether the value can be used at the end of the block.
    #[inline]
    pub fn is_available_after(&self, function: &Function, value: Value, block: Block) -> bool {
        function
            .block_of(value)
            .expand()
            .is_none_or(|home| self.dominates(home, block))
    }

    pub fn common_dominator(&self, mut a: Block, b: Block) -> Option<Block> {
        while !self.dominates(a, b) {
            a = match self.jump[a].expand() {
                Some(jump) if !self.dominates(jump, b) => jump,
                _ => self.parent(a)?,
            };
        }
        Some(a)
    }

    pub(crate) fn by_rank(&self) -> &[Ancestry] {
        &self.by_rank
    }
}
