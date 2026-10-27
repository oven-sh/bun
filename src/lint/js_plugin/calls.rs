//! Computes which listeners are called with which node of a file, in ESLint's order, so `worker/main.js` only has to
//! walk a list.
//!
//! A file's listeners are grouped. A group holds every rule's listeners for one key, such as `Identifier`,
//! `CallExpression:exit`, `:matches(a, b) > c` or `onCodePathStart`. The list has two words per call of a group: the
//! node's number, or [`EVENT`] and the index of a code path analysis event, then the group's index.
//!
//! ESLint enters a node, visits its children, and leaves it. If several keys match a node, the less specific one comes
//! first: fewer attributes, then fewer identifiers, then the smaller text. Code path analysis events come before the
//! step that `code_path/estree.rs` assigns them.

use super::ast::{self, Numbered};
use super::layouts;
use super::wire::{self, ask};
use crate::ast::File;
use crate::code_path::estree::{self, Tree};
use crate::estree::{Dialect, NodeType};
use crate::selector::Selector;
use crate::utils::sort;
use bun_core::strings::Utf16OffsetTable;

const NONE: u32 = u32::MAX;
/// Set in a call's first word if the rest of the word is an event's index.
pub(super) const EVENT: u32 = 1 << 31;

/// A group's key: the thing its listeners listen for.
#[derive(Copy, Clone)]
enum Key<'s> {
    Enter(u8),
    Exit(u8),
    /// With the nodes that match it, ordered by number.
    Selector(&'s Selector, &'s [u32]),
    /// The event's kind. See `code_path/estree.rs`.
    Event(u8),
}

impl Key<'_> {
    /// The key ESLint uses to sort the keys that match a node.
    fn specificity(&self) -> (u32, u32, Vec<u8>) {
        let name = |node_type: u8| {
            (NodeType::ALL.get(usize::from(node_type))).map_or(&b""[..], |it| it.name().as_bytes())
        };
        match *self {
            Key::Enter(node_type) => (0, 1, name(node_type).to_vec()),
            Key::Exit(node_type) => (0, 1, [name(node_type), b":exit"].concat()),
            Key::Selector(selector, _) => (
                selector.attribute_count(),
                selector.identifier_count(),
                selector.source().to_vec(),
            ),
            Key::Event(_) => (0, 0, Vec::new()),
        }
    }
}

/// The groups that match a node when it's entered, or when it's left.
struct Phase {
    /// Indexed by type number: the type's group, or [`NONE`].
    by_type: [u32; 256],
    /// `(node, rank, group)` for the selectors, sorted.
    matches: Vec<(u32, u32, u32)>,
    is_empty: bool,
}

impl Phase {
    fn new() -> Phase {
        Phase {
            by_type: [NONE; 256],
            matches: Vec::new(),
            is_empty: true,
        }
    }

    /// Appends the calls for the node `id`.
    #[inline]
    fn call(&self, id: u32, node_type: u8, ranks: &[u32], out: &mut Vec<u32>) {
        let for_type = self.by_type[node_type as usize];
        if self.matches.is_empty() {
            if for_type != NONE {
                out.extend_from_slice(&[id, for_type]);
            }
            return;
        }
        let start = self.matches.partition_point(|it| it.0 < id);
        let mut for_type = Some(for_type).filter(|&it| it != NONE);
        for &(_, rank, group) in self.matches[start..].iter().take_while(|it| it.0 == id) {
            if let Some(it) = for_type.take_if(|it| ranks[*it as usize] < rank) {
                out.extend_from_slice(&[id, it]);
            }
            out.extend_from_slice(&[id, group]);
        }
        if let Some(it) = for_type {
            out.extend_from_slice(&[id, it]);
        }
    }

    fn has(&self, id: u32, node_type: u8) -> bool {
        self.by_type[node_type as usize] != NONE
            || self.matches.binary_search_by_key(&id, |it| it.0).is_ok()
    }
}

/// Appends the calls. `events` are the events from `code_path::estree::analyze`, four words each, if a group listens
/// for one. `wants_all_events` also includes the events that no group listens for, with [`NONE`] as the group.
fn write(tree: Tree, keys: &[Key], events: &[u32], wants_all_events: bool, out: &mut Vec<u32>) {
    // Each group's rank among the groups that match the same node.
    let mut sorted: Vec<u32> = (0..keys.len() as u32).collect();
    sort::sort_by_cached_key(&mut sorted, |&it| keys[it as usize].specificity());
    let mut ranks = vec![0; keys.len()];
    for (&group, rank) in sorted.iter().zip(0..) {
        ranks[group as usize] = rank;
    }

    let (mut enter, mut exit) = (Phase::new(), Phase::new());
    let mut by_event = [NONE; 8];
    for (key, group) in keys.iter().zip(0..) {
        match *key {
            Key::Enter(node_type) => enter.by_type[node_type as usize] = group,
            Key::Exit(node_type) => exit.by_type[node_type as usize] = group,
            Key::Selector(selector, matches) => {
                let phase = if selector.is_exit() {
                    &mut exit
                } else {
                    &mut enter
                };
                let rank = ranks[group as usize];
                phase
                    .matches
                    .extend(matches.iter().map(|&id| (id, rank, group)));
            }
            Key::Event(kind) => by_event[kind as usize & 7] = group,
        }
        match *key {
            Key::Enter(_) => enter.is_empty = false,
            Key::Exit(_) => exit.is_empty = false,
            Key::Selector(selector, _) if selector.is_exit() => exit.is_empty = false,
            Key::Selector(..) => enter.is_empty = false,
            Key::Event(_) => {}
        }
    }
    enter.matches.sort_unstable();
    exit.matches.sort_unstable();

    let types = tree.types;
    let count = types.len() as u32;
    if exit.is_empty && events.is_empty() && tree.twice.is_empty() {
        for (&node_type, id) in types.iter().zip(0..) {
            enter.call(id, node_type, &ranks, out);
        }
        return;
    }

    // Indexed by node number: the node's last descendant, or the node itself.
    let mut last: Vec<u32> = (0..count).collect();
    for id in (1..count as usize).rev() {
        let parent = tree.parents[id] as usize;
        last[parent] = last[parent].max(last[id]);
    }
    let mut events = events.as_chunks::<4>().0.iter().zip(0..).peekable();
    let has_events = events.peek().is_some();
    let mut step = 0;
    // The events that come before the next step.
    let mut emit = |out: &mut Vec<u32>| {
        while let Some((&[_, node_and_kind, ..], index)) = events.next_if(|it| it.0[0] == step) {
            let group = by_event[node_and_kind as usize & 7];
            if group != NONE || wants_all_events {
                out.extend_from_slice(&[EVENT | index, group]);
            }
        }
        step += 1;
    };
    let mut twice = tree.twice.iter().copied().peekable();
    // The nodes that have been entered but not left yet.
    let mut open: Vec<u32> = Vec::new();
    let leave = |id: u32, out: &mut Vec<u32>, emit: &mut dyn FnMut(&mut Vec<u32>)| {
        emit(out);
        exit.call(id, types[id as usize], &ranks, out);
    };
    for (&node_type, id) in types.iter().zip(0..) {
        while let Some(it) = open.pop_if(|it| last[*it as usize] < id) {
            leave(it, out, &mut emit);
        }
        emit(out);
        enter.call(id, node_type, &ranks, out);
        // espree has one node in two places, and ESLint visits it in both.
        if twice.next_if_eq(&id).is_some() {
            leave(id, out, &mut emit);
            emit(out);
            enter.call(id, node_type, &ranks, out);
        }
        if has_events || exit.has(id, node_type) {
            open.push(id);
        }
    }
    while let Some(it) = open.pop() {
        leave(it, out, &mut emit);
    }
    emit(out);
}

/// The selector numbers in the words sent with [`ask::LISTEN`].
pub(super) fn selector_numbers(words: &[u32]) -> impl Iterator<Item = u32> {
    let groups = words.get(1..).unwrap_or_default().as_chunks::<2>().0;
    groups.iter().filter(|it| it[0] == 2).map(|it| it[1])
}

/// State kept from earlier requests about the file.
pub(super) struct Known<'k, 'a> {
    pub(super) nodes: &'k mut Option<Numbered<'a>>,
    /// The result of [`estree::analyze`].
    pub(super) code_paths: &'k mut Option<Vec<u32>>,
}

/// Answers [`ask::LISTEN`]. `selectors` are the selectors for [`selector_numbers`].
pub(super) fn listen<'a>(
    file: &'a File<'a>,
    offsets: &Utf16OffsetTable,
    words: &[u32],
    selectors: &[Option<&Selector>],
    known: Known<'_, 'a>,
    out: &mut Vec<u8>,
) {
    let Some((&flags, groups)) = words.split_first() else {
        return;
    };
    let Known { nodes, code_paths } = known;
    // The nodes get the same numbers on every walk.
    let needs_walk = nodes.is_none()
        || !selectors.is_empty()
        || flags & (ask::LACKS_TREE | ask::WANTS_TREE) != 0;
    let writer = needs_walk.then(|| ast::walk(file, offsets, selectors));
    let Some(tree) =
        (writer.as_ref().map(|it| it.view())).or_else(|| nodes.as_ref().map(Numbered::view))
    else {
        return;
    };
    let mut matched = selectors
        .iter()
        .zip(writer.iter().flat_map(|it| it.matches()));
    let mut keys = Vec::new();
    for &[kind, number] in groups.as_chunks::<2>().0 {
        keys.push(match kind {
            0 => Key::Enter(number as u8),
            1 => Key::Exit(number as u8),
            2 => match matched.next() {
                Some((Some(selector), matches)) => Key::Selector(selector, matches),
                _ => return,
            },
            _ => Key::Event(number as u8),
        });
    }
    let has_events = keys.iter().any(|it| matches!(it, Key::Event(_)));
    let events = match has_events {
        true => {
            let all = code_paths.get_or_insert_with(|| estree::analyze(file, tree));
            let count = all.first().map_or(0, |it| *it as usize);
            all.get(4..4 + 4 * count).unwrap_or_default()
        }
        false => &[],
    };
    let mut calls = Vec::new();
    write(
        tree,
        &keys,
        events,
        flags & ask::WANTS_ALL_EVENTS != 0,
        &mut calls,
    );

    let sends_tree =
        flags & ask::WANTS_TREE != 0 || (flags & ask::LACKS_TREE != 0 && !calls.is_empty());
    let start = out.len();
    wire::words(out, &[calls.len() as u32, 0]);
    wire::words(out, &calls);
    if let Some(writer) = writer.as_ref().filter(|_| sends_tree) {
        let tree_start = out.len();
        let is_typescript_estree =
            Dialect::of(file) != Dialect::Espree && !file.language().is_oxlint;
        let alternates = match is_typescript_estree {
            true => layouts::alternates(writer.view()),
            false => Vec::new(),
        };
        writer.append(&alternates, out);
        let length = (out.len() - tree_start) as u32;
        out[start + 4..start + 8].copy_from_slice(&length.to_le_bytes());
    }
    if let Some(writer) = writer
        && nodes.is_none()
    {
        *nodes = Some(writer.into_numbered());
    }
}
