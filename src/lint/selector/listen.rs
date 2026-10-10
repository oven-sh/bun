//! The order in which ESLint comes to the nodes that selectors match.

use super::EsNode;
use crate::estree::VNode;
use smallvec::SmallVec;
use std::cmp::{Ordering, Reverse};

/// Where `a` is in the tree, seen from `b`.
enum Relation {
    Same,
    Above,
    Below,
    Before,
    After,
}

fn relation<'a>(a: VNode<'a>, b: VNode<'a>) -> Relation {
    if a == b {
        return Relation::Same;
    }
    let from_a: SmallVec<[VNode<'a>; 32]> =
        std::iter::successors(Some(a), |it| it.parent()).collect();
    let mut below: Option<VNode<'a>> = None;
    for at in std::iter::successors(Some(b), |it| it.parent()) {
        let Some(i) = from_a.iter().position(|it| *it == at) else {
            below = Some(at);
            continue;
        };
        // `at` is the innermost node that both are in.
        let (Some(towards_a), Some(towards_b)) =
            (i.checked_sub(1).and_then(|i| from_a.get(i)), below)
        else {
            return if i == 0 {
                Relation::Above
            } else {
                Relation::Below
            };
        };
        let mut first = None;
        at.for_each_child(|it| {
            if first.is_none() && (it == *towards_a || it == towards_b) {
                first = Some(it);
            }
        });
        return if first == Some(towards_b) {
            Relation::After
        } else {
            Relation::Before
        };
    }
    Relation::Same
}

/// Sorts what listeners have found in no particular order the way the reports of ESLint are sorted, if each listener reports
/// what it is called with.
///
/// An element of `matches` is a node and the index of the selector that it matches, in a list that [`Selector::compare`] sorts.
/// `is_exit`: [`Selector::is_exit`] of the selector at an index.
///
/// Reports are sorted by where they start anyway. What this adds is the order of those for the same range: `a` is a `Program`, an
/// `ExpressionStatement` and an `Identifier`.
///
/// [`Selector::compare`]: super::Selector::compare
/// [`Selector::is_exit`]: super::Selector::is_exit
pub fn sort_as_called(matches: &mut [(EsNode<'_>, usize)], is_exit: impl Fn(usize) -> bool) {
    crate::utils::sort::sort_by_cached_key(matches, |it| {
        let span = it.0.span();
        (span.start, Reverse(span.end))
    });
    for same in matches
        .chunk_by_mut(|a, b| a.0.span() == b.0.span())
        .filter(|it| it.len() > 1)
    {
        crate::utils::sort::sort_by(same, |a, b| {
            match (relation(a.0.node, b.0.node), is_exit(a.1), is_exit(b.1)) {
                (Relation::Same, a_is_exit, b_is_exit) => {
                    a_is_exit.cmp(&b_is_exit).then(a.1.cmp(&b.1))
                }
                (Relation::Above, false, _)
                | (Relation::Below, _, true)
                | (Relation::Before, ..) => Ordering::Less,
                (Relation::Above, true, _)
                | (Relation::Below, _, false)
                | (Relation::After, ..) => Ordering::Greater,
            }
        });
        // For espree both names of `import { a }` are one node, which is visited twice: all the listeners are called for the
        // first visit, then all for the second.
        for visits in same.chunk_by_mut(|a, b| a.0 == b.0) {
            let mut visit = 0;
            let numbered = (0..visits.len()).map(|i| {
                visit = if i > 0 && visits[i].1 == visits[i - 1].1 {
                    visit + 1
                } else {
                    0
                };
                (visit, visits[i])
            });
            let mut numbered: SmallVec<[(u32, (EsNode<'_>, usize)); 8]> = numbered.collect();
            if numbered.iter().any(|it| it.0 > 0) {
                crate::utils::sort::sort_by_key(&mut numbered, |it| it.0);
                visits
                    .iter_mut()
                    .zip(numbered)
                    .for_each(|(to, from)| *to = from.1);
            }
        }
    }
}
