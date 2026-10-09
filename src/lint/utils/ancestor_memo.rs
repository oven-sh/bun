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
    far: Far<'a>,
    /// What the walks that went far found.
    answers: Vec<Option<T>>,
}

/// The nodes that walks have passed far from where they began, each with the index of the answer. It knows nothing of
/// what the answers are, so that it is compiled once and not for each question.
#[derive(Default)]
struct Far<'a> {
    known: FxHashMap<Node<'a>, u32>,
}

impl<'a> Far<'a> {
    /// Walks on from `from` until `decide` says that it has an answer. The nodes it passes get the index of the answer:
    /// the one that is known already, which it returns, or else `next`. It also returns whether it has passed any.
    #[cold]
    #[inline(never)]
    fn walk(
        &mut self,
        from: Node<'a>,
        next: u32,
        up: &dyn Fn(Node<'a>) -> Node<'a>,
        decide: &mut dyn FnMut(Node<'a>, Node<'a>) -> bool,
    ) -> (Option<u32>, bool) {
        let mut child = from;
        let mut steps = 0usize;
        let known = loop {
            if matches!(child, Node::File(_)) {
                break None;
            }
            if let Some(&known) = self.known.get(&child) {
                break Some(known);
            }
            let parent = up(child);
            if decide(child, parent) {
                break None;
            }
            child = parent;
            steps += 1;
        };
        let mut passed = from;
        for _ in 0..steps {
            self.known.insert(passed, known.unwrap_or(next));
            passed = up(passed);
        }
        (known, steps > 0)
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
    /// `decide(child, parent)` is called with `node` and its parent, then with the parent and its parent, and so on, up to the
    /// file as `parent`, until it answers. `None` if it never does. What it answers for a `child` is also the answer for
    /// everything below from where the walk gets to `child`.
    #[inline]
    pub fn find(
        &mut self,
        node: Node<'a>,
        decide: impl FnMut(Node<'a>, Node<'a>) -> Option<T>,
    ) -> Option<T> {
        self.find_with(node, Node::parent, decide)
    }

    /// [`AncestorMemo::find`] for a walk on which `up` says what the parent of a node is, such as
    /// [`estree_parent`](super::estree_parent). It has to be the same for every call.
    #[inline]
    pub fn find_with(
        &mut self,
        node: Node<'a>,
        up: impl Fn(Node<'a>) -> Node<'a>,
        mut decide: impl FnMut(Node<'a>, Node<'a>) -> Option<T>,
    ) -> Option<T> {
        let mut child = node;
        for _ in 0..PLAIN_STEPS {
            if matches!(child, Node::File(_)) {
                return None;
            }
            let parent = up(child);
            let answer = decide(child, parent);
            if answer.is_some() {
                return answer;
            }
            child = parent;
        }
        self.find_far(child, &up, &mut decide)
    }

    #[cold]
    #[inline(never)]
    fn find_far(
        &mut self,
        from: Node<'a>,
        up: &dyn Fn(Node<'a>) -> Node<'a>,
        decide: &mut dyn FnMut(Node<'a>, Node<'a>) -> Option<T>,
    ) -> Option<T> {
        let mut answer = None;
        let next = self.answers.len() as u32;
        let (known, has_passed) = self.far.walk(from, next, up, &mut |child, parent| {
            answer = decide(child, parent);
            answer.is_some()
        });
        if let Some(known) = known {
            return self.answers.get(known as usize).copied().flatten();
        }
        if has_passed {
            self.answers.push(answer);
        }
        answer
    }
}
