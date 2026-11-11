//! A cache for a query that's answered by a node's ancestors and is run for many nodes.

use crate::ast::Node;
use rustc_hash::FxHashMap;

/// The number of steps a walk takes before it starts checking the cache. In ordinary code few nodes are further than
/// this from the ancestor that decides, and nothing is cached for the rest.
const PLAIN_STEPS: usize = 32;

/// Walks up from a node until an ancestor decides, like `node.ancestors().find_map(..)`, and caches the answer for the
/// nodes it passes. Walking up from each link of `a + a + ..`, `a.b.b ..`, `a, a, ..` or `if .. else if ..` takes
/// quadratic time. With this cache, all of a file's walks together take time proportional to the number of walks plus
/// the number of nodes.
///
/// Use one memo per query. The answer must depend only on the node.
pub struct AncestorMemo<'a, T> {
    far: Far<'a>,
    /// The answers found by walks longer than [`PLAIN_STEPS`].
    answers: Vec<Option<T>>,
}

/// Maps the nodes that walks passed after their first [`PLAIN_STEPS`] steps to the index of their answer. It isn't
/// generic over the answer type, so it's compiled once instead of once per query.
#[derive(Default)]
struct Far<'a> {
    known: FxHashMap<Node<'a>, u32>,
}

impl<'a> Far<'a> {
    #[inline(never)]
    fn get(&self, node: Node<'a>) -> Option<u32> {
        self.known.get(&node).copied()
    }

    /// Stores `index` as the answer for the nodes that a walk of `steps` steps from `node` passed after the first
    /// [`PLAIN_STEPS`].
    #[cold]
    #[inline(never)]
    fn remember(
        &mut self,
        node: Node<'a>,
        steps: usize,
        index: u32,
        up: &dyn Fn(Node<'a>) -> Node<'a>,
    ) {
        let mut current = node;
        for step in 0..steps {
            if step >= PLAIN_STEPS {
                self.known.insert(current, index);
            }
            current = up(current);
        }
    }
}

impl<T> Default for AncestorMemo<'_, T> {
    #[inline]
    fn default() -> Self {
        AncestorMemo {
            far: Far::default(),
            answers: Vec::new(),
        }
    }
}

impl<'a, T: Copy> AncestorMemo<'a, T> {
    /// Calls `decide(child, parent)` with `node` and its parent, then with the parent and its parent, and so on up to
    /// the file as `parent`, until it returns an answer. Returns `None` if it never does. The answer for a `child` is
    /// also the answer for every node below it whose walk reaches `child`.
    #[inline]
    pub fn find(
        &mut self,
        node: Node<'a>,
        decide: impl FnMut(Node<'a>, Node<'a>) -> Option<T>,
    ) -> Option<T> {
        self.find_with(node, Node::parent, decide)
    }

    /// [`AncestorMemo::find`] for a walk where `up` returns a node's parent, such as
    /// [`estree_parent`](super::estree_parent). Every call must pass the same `up`.
    #[inline]
    pub fn find_with(
        &mut self,
        node: Node<'a>,
        up: impl Fn(Node<'a>) -> Node<'a>,
        mut decide: impl FnMut(Node<'a>, Node<'a>) -> Option<T>,
    ) -> Option<T> {
        let mut child = node;
        let mut steps = 0;
        let mut known = None;
        let answer = loop {
            if matches!(child, Node::File(_)) {
                break None;
            }
            if steps >= PLAIN_STEPS {
                known = self.far.get(child);
                if let Some(known) = known {
                    break self.answers.get(known as usize).copied().flatten();
                }
            }
            let parent = up(child);
            let answer = decide(child, parent);
            if answer.is_some() {
                break answer;
            }
            child = parent;
            steps += 1;
        };
        if steps > PLAIN_STEPS {
            self.remember(node, steps, (known, answer), &up);
        }
        answer
    }

    /// `known` is `answer`'s index, if it already has one.
    #[cold]
    #[inline(never)]
    fn remember(
        &mut self,
        node: Node<'a>,
        steps: usize,
        (known, answer): (Option<u32>, Option<T>),
        up: &dyn Fn(Node<'a>) -> Node<'a>,
    ) {
        let index = known.unwrap_or(self.answers.len() as u32);
        if known.is_none() {
            self.answers.push(answer);
        }
        self.far.remember(node, steps, index, up);
    }
}
