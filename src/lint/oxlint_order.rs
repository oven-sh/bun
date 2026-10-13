//! In which order oxlint prints what its rules report about a file.
//!
//! It sorts nothing: what is reported first is printed first. This is how it runs (`execute_rules`): first `run_once` of
//! each rule, by the number of the rule; then the nodes, in the order in which a walk enters them, each with the rules that
//! are called with its kind of node, by their numbers; then the calls of Jest, each with the rules by their numbers. What
//! tsgolint reports comes last.
//!
//! The rules here run in another way, so what they report is put in that order afterwards, in a file about which something
//! is reported: [`ranks`]. It has the four parts one after the other, and the rules of the first by their numbers. For the
//! second, [`Places`] finds the node again that oxlint's rule is called with.

mod table;
mod visited;

use crate::ast::{File, Packed};
use crate::context::Diagnostic;
use crate::rule::When::Entering;
use crate::rule::{Meta, Plugin, When};
use crate::span::Span;
use crate::utils::sort;
use bun_core::strings;
use bun_wyhash::hash_const;
use rustc_hash::FxHashMap;
use std::sync::LazyLock;
use table::{KINDS, RULES};
use visited::Places;

/// Kinds of node of oxc: a bit for each place in [`KINDS`].
#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub(crate) struct Kinds([u64; 3]);

impl Kinds {
    #[inline]
    fn has(&self, kind: u8) -> bool {
        let word = self.0.get(kind as usize / 64).copied().unwrap_or(0);
        (word >> (kind % 64)) & 1 != 0
    }

    fn insert(&mut self, kind: u8) {
        if let Some(word) = self.0.get_mut(kind as usize / 64) {
            *word |= 1 << (kind % 64);
        }
    }

    #[inline]
    fn is_empty(&self) -> bool {
        self.0 == [0; 3]
    }

    /// All of them are among `others`.
    #[inline]
    fn are_among(&self, others: &Kinds) -> bool {
        let both = self.0.iter().zip(others.0);
        both.into_iter().all(|(mine, theirs)| mine & !theirs == 0)
    }
}

/// What oxlint does with a rule.
#[derive(Copy, Clone)]
pub(crate) struct Order {
    pub(crate) when: When,
    /// Its place among all the rules, by the plugin and the name. A rule that oxlint has not comes after its rules.
    pub(crate) number: u16,
    /// For [`Entering`]: the kinds of node that it is called with.
    pub(crate) kinds: Kinds,
}

pub(crate) fn of(rule: &Meta) -> Order {
    let key = key(rule.plugin, rule.name.as_bytes());
    let found = TABLE.rules.binary_search_by_key(&key, |it| it.key);
    match found.ok().and_then(|at| TABLE.rules.get(at)) {
        Some(it) => it.order,
        None => Order {
            when: Entering,
            number: u16::MAX,
            kinds: Kinds::default(),
        },
    }
}

/// The place in [`KINDS`] of the kind of node that oxc calls `name`. `None`: no rule is called with it.
fn kind_named(name: &str) -> Option<u8> {
    TABLE.kinds.get(name.as_bytes()).copied()
}

/// Whether what `rule` reports stays in the order in which the rule here reports it. oxlint's goes through a hash table of oxc,
/// and the rule here follows it.
pub(crate) fn keeps_its_order(rule: &Meta) -> bool {
    rule.plugin == Plugin::Eslint && rule.name == "no-undef"
}

fn key(plugin: Plugin, name: &[u8]) -> u32 {
    hash_const(hash_const(0, plugin.prefix().as_bytes()), name) as u32
}

struct Rule {
    /// [`key`], by which they are sorted.
    key: u32,
    order: Order,
}

/// [`RULES`] and [`KINDS`], taken apart.
struct Table {
    rules: Vec<Rule>,
    /// Where each name is in [`KINDS`].
    kinds: FxHashMap<&'static [u8], u8>,
}

static TABLE: LazyLock<Table> = LazyLock::new(|| {
    let rank = |plugin: Plugin| RULES.iter().position(|it| it.0 == plugin.in_oxlint());
    let mut all = Vec::new();
    for (plugin, when, words) in RULES {
        let mut kinds = Kinds::default();
        for word in strings::split(words.as_bytes(), b" ") {
            if !word.first().is_some_and(u8::is_ascii_digit) {
                all.push((rank(*plugin), word, *plugin, *when, kinds));
                continue;
            }
            let number =
                |digits: &[u8]| digits.iter().fold(0, |it, digit| it * 10 + (digit - b'0'));
            kinds = Kinds::default();
            strings::split(word, b",").for_each(|it| kinds.insert(number(it)));
        }
    }
    sort::sort_unstable_by_key(&mut all, |it| (it.0, it.1));
    let mut rules: Vec<Rule> = (all.iter().zip(0u16..))
        .map(|(it, number)| Rule {
            key: key(it.2, it.1),
            order: Order {
                when: it.3,
                number,
                kinds: it.4,
            },
        })
        .collect();
    sort::sort_unstable_by_key(&mut rules, |it| it.key);
    Table {
        rules,
        kinds: strings::split(KINDS.as_bytes(), b" ").zip(0..).collect(),
    }
});

/// What [`ranks`] asks about a rule that has reported.
#[derive(Copy, Clone)]
pub(crate) struct Ran {
    pub(crate) when: When,
    pub(crate) kinds: Kinds,
    /// [`keeps_its_order`]
    pub(crate) keeps_its_order: bool,
}

// Where the parts of a key start, from the last. What decides among what one rule reports about one node is in the low 32 bits.
/// The rule: they are in the order of oxlint's numbers, and there are fewer than `1 << 15`.
const RULE: u32 = 32;
/// The how manyth of the nodes with its span the node is, from the outside.
const DEPTH: u32 = RULE + 15;
/// What is left of `u32::MAX` after the end of the node, so that the longer comes first.
const END: u32 = DEPTH + 15;
const START: u32 = END + 32;
/// The part of the run.
const PART: u32 = START + 32;
/// Deeper than any node: what is reported stands in for a node that is not found.
const DEEPEST: u128 = (1 << 15) - 1;

/// For each place in `order`, which has the places in `diagnostics` by where they start: the how manyth oxlint reports it, from 1.
/// `ran`: about the rule with that index.
pub(crate) fn ranks<'a>(
    file: &'a File<'a>,
    diagnostics: &[Diagnostic],
    order: &[u32],
    ran: &dyn Fn(u16) -> Option<Ran>,
) -> Vec<u32> {
    let key = |part: u128, start: u32, end: u32| {
        (part << PART) | (u128::from(start) << START) | (u128::from(end) << END)
    };
    let mut places = Places::new(file);
    // The node of each of the second part, and which of the nodes of oxc that it stands for.
    let mut nodes: Vec<Option<(Packed, u8)>> = vec![None; order.len()];
    let mut keys: Vec<(u128, u32)> = Vec::with_capacity(order.len());
    // What `ran` has said about each rule. Far fewer rules report than there are reports.
    let mut asked: Vec<Option<Option<Ran>>> = Vec::new();
    for ((place, at), node) in (0u32..).zip(order).zip(&mut nodes) {
        let Some(it) = diagnostics.get(*at as usize) else {
            continue;
        };
        let details = it.details.as_deref();
        // What is about the file as a whole, at no place in it, is the first of its part.
        let start = details.and_then(|it| it.start_position.as_ref());
        let has_place = start.is_none_or(|it| it.line != 0);
        let (by_place, as_reported) = (u128::from(place), u128::from(*at));
        if asked.len() <= it.rule as usize {
            asked.resize(it.rule as usize + 1, None);
        }
        let ran = match asked.get_mut(it.rule as usize) {
            Some(known) => *known.get_or_insert_with(|| ran(it.rule)),
            None => None,
        };
        let key = match ran.map(|it| it.when) {
            Some(When::Once) if ran.is_some_and(|it| it.keeps_its_order) => {
                key(0, it.rule.into(), has_place.into()) | as_reported
            }
            Some(When::Once) => key(0, it.rule.into(), has_place.into()) | by_place,
            Some(When::AtTheEnd) => key(2, 0, has_place.into()) | by_place,
            Some(When::Last) => key(3, 0, has_place.into()) | by_place,
            _ if !has_place => key(1, 0, 0) | by_place,
            _ => {
                let stated = details.and_then(|it| it.listened_on);
                let kinds = ran.map_or_else(Kinds::default, |it| it.kinds);
                let found = places.of(it.rule, &kinds, stated.unwrap_or(it.span), it.node);
                *node = found.node;
                let depth = found.node.map_or(DEEPEST, |it| it.1.into());
                // A rule that says which node it is goes through the node as oxlint's does.
                let within = stated.map_or(by_place, |_| as_reported);
                key(1, found.span.start, u32::MAX - found.span.end)
                    | (depth << DEPTH)
                    | (u128::from(it.rule) << RULE)
                    | within
            }
        };
        keys.push((key, place));
    }
    keys.sort_unstable();
    // Nodes that are in each other and are written from the same place to the same place.
    let node_of = |it: &(u128, u32)| nodes.get(it.1 as usize).copied().flatten();
    for same in keys.chunk_by_mut(|a, b| a.0 >> END == b.0 >> END) {
        let first = same.first().and_then(node_of).map(|it| it.0);
        let is_first = |it: &(u128, u32)| node_of(it).is_none_or(|it| Some(it.0) == first);
        if same.iter().all(is_first) {
            continue;
        }
        for it in same.iter_mut() {
            if let Some(node) = node_of(it) {
                let span = Span::new((it.0 >> START) as u32, u32::MAX - (it.0 >> END) as u32);
                let depth = u128::from(visited::depth(file, node, span)).min(DEEPEST - 1);
                it.0 = (it.0 & !(DEEPEST << DEPTH)) | (depth << DEPTH);
            }
        }
        same.sort_unstable();
    }
    let mut ranks = vec![0; order.len()];
    for (it, rank) in keys.iter().zip(1..) {
        if let Some(of_place) = ranks.get_mut(it.1 as usize) {
            *of_place = rank;
        }
    }
    ranks
}
