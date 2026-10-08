//! A question about a node that its ancestors answer, asked of many nodes.

use crate::ast::Node;
use rustc_hash::FxHashMap;

/// How far up it goes before it looks at what is known. Few nodes of ordinary code are further from what decides about them,
/// and for these nothing is kept.
const PLAIN_STEPS: usize = 32;

/// Walks up from a node until an ancestor decides, as `node.ancestors().find_map(..)` does, and remembers the answers for the
/// nodes it passes. To walk up from each link of `a + a + ..`, `a.b.b ..`, `a, a, ..` or `if .. else if ..` takes quadratic time.
/// With this, all the walks of a file together take time in proportion to the number of walks and of nodes.
///
/// One memo is for one question: the answer may depend on nothing but the node.
pub struct AncestorMemo<'a, T> {
    known: FxHashMap<Node<'a>, Option<T>>,
}

impl<T> Default for AncestorMemo<'_, T> {
    #[inline]
    fn default() -> Self {
        AncestorMemo {
            known: FxHashMap::default(),
        }
    }
}

impl<'a, T: Copy> AncestorMemo<'a, T> {
    /// `decide(child, parent)` is called with `node` and its parent, then with the parent and its parent, and so on, up to the
    /// file as `parent`, until it answers. `None` if it never does. What it answers for a `child` is also the answer for
    /// everything below from where the walk gets to `child`.
    pub fn find(
        &mut self,
        node: Node<'a>,
        decide: impl FnMut(Node<'a>, Node<'a>) -> Option<T>,
    ) -> Option<T> {
        self.find_with(node, Node::parent, decide)
    }

    /// [`AncestorMemo::find`] for a walk on which `up` says what the parent of a node is, such as
    /// [`estree_parent`](super::estree_parent). It has to be the same for every call.
    pub fn find_with(
        &mut self,
        node: Node<'a>,
        up: impl Fn(Node<'a>) -> Node<'a>,
        mut decide: impl FnMut(Node<'a>, Node<'a>) -> Option<T>,
    ) -> Option<T> {
        let mut child = node;
        let mut steps = 0;
        let answer = loop {
            if matches!(child, Node::File(_)) {
                break None;
            }
            if steps >= PLAIN_STEPS
                && let Some(&known) = self.known.get(&child)
            {
                break known;
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
            let mut passed = node;
            for step in 0..steps {
                if step >= PLAIN_STEPS {
                    self.known.insert(passed, answer);
                }
                passed = up(passed);
            }
        }
        answer
    }
}
