//! The number of units that fixed counts add up to is limited.

use bun_engine_text::MAX_LENGTH;

use crate::Error;
use crate::tree::{Node, NodeId, Tree};

#[derive(Clone, Copy, Default)]
struct Lengths {
    /// A repeated group counts as nothing.
    min: u64,
    /// On the heaviest path, up to where it is furthest from the start.
    reach: u64,
    /// On the heaviest path, along with all that has to follow.
    total: u64,
}

impl Lengths {
    fn fixed(units: u64) -> Lengths {
        Lengths {
            min: units,
            reach: units,
            total: units,
        }
    }
}

const LIMIT: u64 = u32::MAX as u64;

#[cold]
pub(super) fn check(tree: &Tree) -> Result<(), Error> {
    let mut all: Vec<Lengths> = Vec::new();
    all.try_reserve_exact(tree.node_count())
        .map_err(|_| Error::OutOfMemory)?;
    let mut longest_alternative = 0;
    for (_, node) in tree.nodes() {
        let lengths = lengths_of(tree, node, &all);
        if lengths.reach > LIMIT {
            return Err(Error::MinimumLengthTooLarge);
        }
        longest_alternative = longest_alternative.max(lengths.min);
        all.push(lengths);
    }
    if longest_alternative > MAX_LENGTH as u64 && all[tree.root().index()].total > LIMIT {
        return Err(Error::MinimumLengthTooLarge);
    }
    Ok(())
}

fn lengths_of(tree: &Tree, node: Node, all: &[Lengths]) -> Lengths {
    let of = |id: NodeId| all[id.index()];
    let is_pair = |c: u32| c > 0xffff;
    match node {
        Node::Text { chars, .. } => {
            let pairs = tree[chars].iter().filter(|&&c| is_pair(c)).count();
            Lengths::fixed((chars.len() + pairs) as u64)
        }
        Node::Set(set) => {
            let first = tree[set].ranges().next();
            let has_only_pairs = first.is_some_and(|range| is_pair(range.first));
            Lengths::fixed(1 + u64::from(has_only_pairs && tree.is_unicode_aware()))
        }
        Node::Sequence(children) => {
            let min = tree[children].iter().map(|&child| of(child).min).sum();
            let (mut lengths, mut before) = (Lengths::fixed(min), 0);
            for &child in &tree[children] {
                let around = match tree[child] {
                    Node::Look { behind: false, .. } => before,
                    Node::Look { behind: true, .. } => min - before,
                    _ => min - of(child).min,
                };
                lengths.reach = lengths.reach.max(before + of(child).reach);
                lengths.total = lengths.total.max(around + of(child).total);
                before += of(child).min;
            }
            lengths
        }
        Node::Alternation(children) => {
            let children = tree[children].iter().map(|&child| of(child));
            let joined = children.reduce(|a, b| Lengths {
                min: a.min.min(b.min),
                reach: a.reach.max(b.reach),
                total: a.total.max(b.total),
            });
            joined.unwrap_or_default()
        }
        Node::Capture { body, .. } => of(body),
        Node::Repeat { body, min, .. } => match tree[body] {
            Node::Text { chars, .. } if chars.len() > 1 => Lengths { min: 0, ..of(body) },
            Node::Text { .. } | Node::Set(_) => Lengths::fixed(of(body).min * u64::from(min)),
            _ => Lengths { min: 0, ..of(body) },
        },
        Node::Look { body, behind, .. } => Lengths {
            min: 0,
            reach: if behind { 0 } else { of(body).reach },
            total: of(body).total,
        },
        _ => Lengths::default(),
    }
}
