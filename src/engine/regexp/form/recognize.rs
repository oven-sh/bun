use bun_engine_text::AllocError;

use super::scan::Members;
use super::{Atom, Form, Kind, Repetition};
use crate::set::{Latin1Set, Set, SetBuilder};
use crate::surrogate::{self, ASTRAL, SURROGATES};
use crate::tree::{Node, NodeId, SetId, Span, Tree, UNBOUNDED};

const CR: u32 = 0x0d;
const LF: u32 = 0x0a;
const MOST_LINE_ENDINGS: usize = 8;

/// What matches one unit.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Single {
    Character { c: u32, ignore_case: bool },
    Set(SetId),
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct Repeated {
    single: Single,
    is_run: bool,
}

impl Form {
    pub(crate) fn of(tree: &Tree) -> Result<Option<Form>, AllocError> {
        if tree.is_sticky() || tree.group_count() > 0 {
            return Ok(None);
        }
        let root = tree.root();
        if let Node::Text { chars, ignore_case } = tree[root]
            && let Some(atom) = atom(tree, &tree[chars], ignore_case)?
        {
            return Ok(Some(Form(Kind::Atom(atom))));
        }
        if let Some(kind) = line_ending(tree, root)? {
            return Ok(Some(Form(kind)));
        }
        let Some((repeated, at_start, at_end)) = placed_repetition(tree, root) else {
            return Ok(None);
        };
        let Some(set) = units_of(tree, repeated.single)? else {
            return Ok(None);
        };
        let repetition = Repetition {
            members: Members::new(set),
            is_run: repeated.is_run,
        };
        Ok(Some(Form(match at_start || at_end {
            true => Kind::AtEdges {
                repetition,
                at_start,
                at_end,
            },
            false => Kind::Anywhere(repetition),
        })))
    }
}

fn atom(tree: &Tree, chars: &[u32], ignore_case: bool) -> Result<Option<Atom>, AllocError> {
    let has_case = |c| tree.case_equivalence().equivalents(c).next().is_some();
    let is_lone = |c| (SURROGATES.first..=SURROGATES.last).contains(&c);
    if (ignore_case && chars.iter().any(|&c| has_case(c)))
        || (tree.is_unicode_aware() && chars.iter().any(|&c| is_lone(c)))
    {
        return Ok(None);
    }
    let mut utf16 = Vec::new();
    let pairs = chars.iter().filter(|&&c| c >= ASTRAL.first).count();
    utf16
        .try_reserve_exact(chars.len() + pairs)
        .map_err(|_| AllocError)?;
    for &c in chars {
        match u16::try_from(c) {
            Ok(unit) => utf16.push(unit),
            Err(_) => utf16.extend([surrogate::lead_of(c), surrogate::trail_of(c)]),
        }
    }
    let mut latin1 = None;
    if chars.iter().all(|&c| c <= 0xff) {
        let mut narrow = Vec::new();
        narrow
            .try_reserve_exact(chars.len())
            .map_err(|_| AllocError)?;
        narrow.extend(chars.iter().map(|&c| c as u8));
        latin1 = Some(narrow.into_boxed_slice());
    }
    Ok(Some(Atom {
        latin1,
        utf16: utf16.into_boxed_slice(),
        starts_with_pair: chars[0] >= ASTRAL.first,
    }))
}

/// Alternatives that match one unit each, or CR LF before any that matches CR.
fn line_ending(tree: &Tree, root: NodeId) -> Result<Option<Kind>, AllocError> {
    let text = |id| match tree[id] {
        Node::Text { chars, .. } => &tree[chars],
        _ => &[],
    };
    let is_optional = |id, c| match tree[id] {
        Node::Repeat {
            body,
            min: 0,
            max: 1,
            greedy: true,
            ..
        } => text(body) == [c],
        _ => false,
    };
    let alternatives = match tree[root] {
        Node::Alternation(alternatives) => &tree[alternatives],
        _ => &[root],
    };
    if alternatives.len() > MOST_LINE_ENDINGS {
        return Ok(None);
    }
    let (mut units, mut has_pair) = (Set::EMPTY, false);
    for &id in alternatives {
        let mut more = Set::EMPTY;
        match pair(tree, id) {
            Some((a, b)) if text(a) == [CR] && is_optional(b, LF) => {
                more = Set::from_latin1(Latin1Set::of(b"\r"))
            }
            Some((a, b)) if is_optional(a, CR) && text(b) == [LF] => {
                more = Set::from_latin1(Latin1Set::of(b"\n"))
            }
            None if text(id) == [CR, LF] => {}
            _ => {
                let Some(set) = single(tree, id)
                    .map(|it| units_of(tree, it))
                    .transpose()?
                    .flatten()
                else {
                    return Ok(None);
                };
                units = units.union(&set)?;
                continue;
            }
        }
        if !has_pair && units.contains(CR) {
            return Ok(None);
        }
        has_pair = true;
        units = units.union(&more)?;
    }
    Ok(if has_pair && units.contains(CR) {
        Some(Kind::LineBreak(Members::new(units)))
    } else if has_pair && units.single() == Some(LF) {
        Some(Kind::LineFeed)
    } else {
        None
    })
}

fn pair(tree: &Tree, id: NodeId) -> Option<(NodeId, NodeId)> {
    match tree[id] {
        Node::Sequence(terms) => both(tree, terms),
        _ => None,
    }
}

fn both(tree: &Tree, nodes: Span<NodeId>) -> Option<(NodeId, NodeId)> {
    match tree[nodes] {
        [a, b] => Some((a, b)),
        _ => None,
    }
}

/// With whether it is tied to the start and to the end of the input.
fn placed_repetition(tree: &Tree, id: NodeId) -> Option<(Repeated, bool, bool)> {
    let anchored = |id| {
        let (a, b) = pair(tree, id)?;
        match (tree[a], tree[b]) {
            (Node::InputStart, _) => Some((repeated(tree, b)?, true, false)),
            (_, Node::InputEnd) => Some((repeated(tree, a)?, false, true)),
            _ => None,
        }
    };
    match tree[id] {
        Node::Sequence(_) => anchored(id),
        Node::Alternation(alternatives) => {
            let (a, b) = both(tree, alternatives)?;
            let (a, b) = (anchored(a)?, anchored(b)?);
            (a.0 == b.0 && a.1 != b.1).then_some((a.0, true, true))
        }
        _ => Some((repeated(tree, id)?, false, false)),
    }
}

fn repeated(tree: &Tree, id: NodeId) -> Option<Repeated> {
    let (id, is_run) = match tree[id] {
        Node::Repeat {
            body,
            min: 1,
            max: UNBOUNDED,
            greedy: true,
            ..
        } => (body, true),
        _ => (id, false),
    };
    let single = single(tree, id)?;
    Some(Repeated { single, is_run })
}

fn single(tree: &Tree, id: NodeId) -> Option<Single> {
    match tree[id] {
        Node::Set(set) => Some(Single::Set(set)),
        Node::Text { chars, ignore_case } => match tree[chars] {
            [c] => Some(Single::Character { c, ignore_case }),
            _ => None,
        },
        _ => None,
    }
}

/// Nothing if it takes a look at the neighbours of a unit.
fn units_of(tree: &Tree, single: Single) -> Result<Option<Set>, AllocError> {
    let set = match single {
        Single::Set(set) => tree[set].try_clone()?,
        Single::Character { c, ignore_case } => {
            let mut builder = SetBuilder::default();
            builder.add(c)?;
            builder.finish(ignore_case.then(|| tree.case_equivalence()))?
        }
    };
    let reads_pairs = tree.is_unicode_aware()
        && (set.intersects_range(SURROGATES) || set.intersects_range(ASTRAL));
    Ok((!reads_pairs).then_some(set))
}
