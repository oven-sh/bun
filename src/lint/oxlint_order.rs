//! Reproduces the order in which oxlint prints a file's diagnostics.
//!
//! oxlint doesn't sort them, so whatever is reported first is printed first. Its `execute_rules` runs in four phases.
//! First it calls each rule's `run_once`, in rule-number order. Then it visits the nodes in pre-order and calls, for
//! each node, the rules registered for that node kind, in rule-number order. Then it visits the Jest calls, each with
//! the rules in rule-number order. tsgolint's diagnostics come last.
//!
//! Our rules run differently, so [`in_run_order`] reorders the diagnostics afterwards, only for files that have any. It
//! emits the four phases one after the other, with the first sorted by rule number. For the second, [`NodeFinder`]
//! finds the node that oxlint's rule is called with.

mod table;
mod visited;

use crate::ast::File;
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
use visited::{CalledNode, NodeFinder};

/// A set of oxc node kinds, with one bit per index in [`KINDS`].
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

    #[inline]
    fn has_any_of(&self, others: &Kinds) -> bool {
        let both = self.0.iter().zip(others.0);
        both.into_iter().any(|(mine, theirs)| mine & theirs != 0)
    }

    /// True if this set is a subset of `others`.
    #[inline]
    fn is_subset_of(&self, others: &Kinds) -> bool {
        let both = self.0.iter().zip(others.0);
        both.into_iter().all(|(mine, theirs)| mine & !theirs == 0)
    }
}

/// The nodes oxlint calls a rule with: the oxc node kinds, plus masks derived from them for our own node tags, so that
/// for most nodes one bit test tells whether the rule is called with them.
#[derive(Copy, Clone, Default)]
pub(crate) struct Called {
    kinds: Kinds,
    /// One bit per `ExprTag` that maps to one of the kinds in every context.
    exprs: u64,
    /// The same for the tags that do so in a file without JSX.
    exprs_without_jsx: u64,
    /// One bit per `StmtTag`.
    stmts: u64,
    /// One bit per `BinOp`, and one per `UnOp`.
    binaries: u32,
    unaries: u32,
    /// True if the rule is called with something that's only part of one of our nodes, so a bit test isn't enough.
    needs_part_lookup: bool,
}

/// How oxlint runs a rule.
#[derive(Copy, Clone)]
pub(crate) struct Ran {
    pub(crate) when: When,
    /// Its position among all rules, sorted by plugin and name. A rule that oxlint doesn't have sorts after all of
    /// oxlint's.
    pub(crate) number: u16,
    /// For [`Entering`]: the node kinds it's called with.
    kinds: Called,
    /// [`once`]
    once: Once,
    /// [`is_port`]
    is_port: bool,
}

impl Ran {
    /// A rule that isn't in the table is treated as one that's called with nodes.
    pub(crate) fn unknown(when: When, number: u16) -> Ran {
        Ran {
            when,
            number,
            kinds: Called::default(),
            once: Once::ByStart,
            is_port: false,
        }
    }
}

pub(crate) fn of(rule: &Meta) -> Ran {
    let key = key(rule.plugin, rule.name.as_bytes());
    let found = TABLE.rules.binary_search_by_key(&key, |it| it.key);
    let (when, number, kinds) = match found.ok().and_then(|at| TABLE.rules.get(at)) {
        Some(it) => (it.when, it.number, visited::called(it.kinds)),
        None => (Entering, u16::MAX, Called::default()),
    };
    Ran {
        when,
        number,
        kinds,
        once: once(rule),
        is_port: is_port(rule),
    }
}

/// The index in [`KINDS`] of the oxc node kind `name`. `None` if no rule is called with it.
fn kind_named(name: &str) -> Option<u8> {
    TABLE.kinds.get(name.as_bytes()).copied()
}

/// The order in which a `run_once` rule reports.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Once {
    /// It reports in source order.
    ByStart,
    /// It reports a function when it leaves the function.
    ByEnd,
    /// It iterates over one of oxc's hash tables, or reports one kind of problem after another. Our rule reports in the
    /// same order.
    AsReported,
}

fn once(rule: &Meta) -> Once {
    let as_reported = match rule.plugin.in_oxlint() {
        Plugin::Eslint if rule.name == "max-statements" => return Once::ByEnd,
        Plugin::Eslint => rule.name == "no-undef",
        Plugin::Import => matches!(
            rule.name,
            "extensions" | "group-exports" | "no-duplicates" | "no-self-import"
        ),
        Plugin::Jest => rule.name == "no-export",
        Plugin::Node => rule.name == "exports-style",
        Plugin::React => rule.name == "only-export-components",
        _ => false,
    };
    if as_reported {
        Once::AsReported
    } else {
        Once::ByStart
    }
}

/// True if our rule is a port of oxlint's, so it walks a node the same way. A port of an ESLint rule may walk it
/// differently, so its reports about one node are sorted by source position.
fn is_port(rule: &Meta) -> bool {
    rule.follows_oxlint
}

fn key(plugin: Plugin, name: &[u8]) -> u32 {
    hash_const(hash_const(0, plugin.prefix().as_bytes()), name) as u32
}

struct Rule {
    /// [`key`]. The rules are sorted by it.
    key: u32,
    when: When,
    number: u16,
    kinds: Kinds,
}

/// [`RULES`] and [`KINDS`], parsed.
struct Table {
    rules: Vec<Rule>,
    /// Each name's index in [`KINDS`].
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
            when: it.3,
            number,
            kinds: it.4,
        })
        .collect();
    sort::sort_unstable_by_key(&mut rules, |it| it.key);
    Table {
        rules,
        kinds: strings::split(KINDS.as_bytes(), b" ").zip(0..).collect(),
    }
});

/// A sort key for when oxlint reports a diagnostic during a run. Earlier reports have smaller keys. The key doesn't
/// depend on which other rules run, so the diagnostics from linting a file again can be merged with the earlier ones.
pub(crate) type RunKey = (u64, u128);

/// Finds the Jest call around each diagnostic. Diagnostics must be looked up in order of their start.
struct Turns<'t> {
    /// `File::jest_calls_in_oxlint_order`
    calls: &'t [(Span, u32)],
    /// How many of `calls` have been reached.
    seen: usize,
    /// The calls enclosing the current position, outermost first: each one's end and turn.
    open: Vec<(u32, u32)>,
}

impl Turns<'_> {
    fn pop_calls_ending_by(&mut self, offset: u32) {
        while self.open.last().is_some_and(|it| it.0 <= offset) {
            self.open.pop();
        }
    }

    /// The turn of the innermost call around `label`. If there's none, `u32::MAX`, which sorts after every call.
    fn innermost_turn(&mut self, label: Span) -> u32 {
        while let Some((call, turn)) = self.calls.get(self.seen)
            && call.start <= label.start
        {
            self.pop_calls_ending_by(call.start);
            self.open.push((call.end, *turn));
            self.seen += 1;
        }
        self.pop_calls_ending_by(label.start);
        let enclosing_count = self.open.partition_point(|it| it.0 >= label.end);
        let innermost = enclosing_count
            .checked_sub(1)
            .and_then(|it| self.open.get(it));
        innermost.map_or(u32::MAX, |it| it.1)
    }
}

/// A key that sorts spans by start, longer first, which is pre-order.
fn preorder_key(span: Span) -> u64 {
    (u64::from(span.start) << 32) | u64::from(u32::MAX - span.end)
}

// Bit offsets of the fields in the key that orders the diagnostics whose nodes start at the same offset, least
// significant first. The low 32 bits hold the index into `diagnostics`.
/// The tie-breaker among one rule's reports about one node.
const WITHIN: u32 = 32;
/// The rule's index. Rules are in the order of oxlint's numbers, and there are fewer than `1 << 15`.
const RULE: u32 = WITHIN + 32;
/// The node's depth among the nodes that share its span, counted from the outermost.
const DEPTH: u32 = RULE + 15;
/// `u32::MAX` minus the node's end.
const END: u32 = DEPTH + 15;
/// Deeper than any node. Used when the node wasn't found and the diagnostic's own span replaces it.
const DEEPEST: u128 = (1 << 15) - 1;

/// Merges two sorted lists.
fn merged(a: &[u64], b: &[u64]) -> Vec<u64> {
    let mut all = Vec::with_capacity(a.len() + b.len());
    let (mut rest_of_a, mut rest_of_b) = (a, b);
    while let ([first_of_a, after_a @ ..], [first_of_b, after_b @ ..]) = (rest_of_a, rest_of_b) {
        if first_of_a <= first_of_b {
            all.push(*first_of_a);
            rest_of_a = after_a;
        } else {
            all.push(*first_of_b);
            rest_of_b = after_b;
        }
    }
    all.extend_from_slice(rest_of_a);
    all.extend_from_slice(rest_of_b);
    all
}

/// Sorts `nodes`, which is already sorted by node start, into pre-order, and within one node by rule. Each entry has
/// the node's start in its high half and the index into `diagnostics` and `found` in its low half. `found` has each
/// diagnostic's node and the tie-breaker among one rule's reports about that node.
fn sort_preorder<'a>(
    file: &'a File<'a>,
    diagnostics: &[Diagnostic],
    found: &[(CalledNode, u32)],
    nodes: &mut [u64],
) {
    let key = |at: u32, depth_of: &dyn Fn(&CalledNode) -> u128| {
        let (it, (target, within)) = (diagnostics.get(at as usize)?, found.get(at as usize)?);
        Some(
            (u128::from(u32::MAX - target.span.end) << END)
                | (depth_of(target) << DEPTH)
                | (u128::from(it.rule) << RULE)
                | (u128::from(*within) << WITHIN)
                | u128::from(at),
        )
    };
    let node_of = |key: u128| found.get(key as u32 as usize).and_then(|it| it.0.node);
    let mut same_start_keys: Vec<u128> = Vec::new();
    for same_start in nodes.chunk_by_mut(|a, b| a >> 32 == b >> 32) {
        if same_start.len() < 2 {
            continue;
        }
        let level = |it: &CalledNode| it.node.map_or(DEEPEST, |it| it.1.into());
        same_start_keys.clear();
        same_start_keys.extend(same_start.iter().filter_map(|it| key(*it as u32, &level)));
        same_start_keys.sort_unstable();
        // Nested nodes with identical spans.
        let is_other_node = |pair: &[u128]| match pair {
            [a, b] => {
                a >> END == b >> END && node_of(*a).map(|it| it.0) != node_of(*b).map(|it| it.0)
            }
            _ => false,
        };
        if same_start_keys
            .array_windows::<2>()
            .any(|it| is_other_node(it))
        {
            let depth = |it: &CalledNode| match it.node {
                Some(node) => u128::from(visited::depth(file, node, it.span)).min(DEEPEST - 1),
                None => DEEPEST,
            };
            same_start_keys.clear();
            same_start_keys.extend(same_start.iter().filter_map(|it| key(*it as u32, &depth)));
            same_start_keys.sort_unstable();
        }
        for (entry, sorted) in same_start.iter_mut().zip(&same_start_keys) {
            *entry = u64::from(*sorted as u32);
        }
    }
}

/// Returns the indices into `diagnostics` in the order oxlint reports them, and with `with_keys` also each one's
/// [`RunKey`]. `ran` returns the [`Ran`] of the rule with the given index.
pub(crate) fn in_run_order<'a, 'r>(
    file: &'a File<'a>,
    diagnostics: &[Diagnostic],
    ran: &dyn Fn(u16) -> Option<&'r Ran>,
    with_keys: bool,
) -> (Vec<u32>, Vec<RunKey>) {
    let unknown = Ran::unknown(Entering, u16::MAX);
    let mut finder = NodeFinder::new(file);
    // The four phases of the run. Each entry has the index into `diagnostics` in its low 32 bits.
    let with_index = |key: u64, at: u32| (u128::from(key) << 32) | u128::from(at);
    let mut once: Vec<u128> = Vec::new();
    let mut nodes: Vec<u64> = Vec::with_capacity(diagnostics.len());
    let mut calls: Vec<u128> = Vec::new();
    let mut last: Vec<u128> = Vec::new();
    // For the second phase: each diagnostic's node, and the diagnostics whose node still has to be searched for.
    let not_found = CalledNode {
        span: Span::new(0, u32::MAX),
        node: None,
    };
    let mut found: Vec<(CalledNode, u32)> = vec![(not_found, 0); diagnostics.len()];
    let mut searched: Vec<u128> = Vec::new();
    // Each diagnostic's rule number, for the keys.
    let mut numbers: Vec<u16> = Vec::with_capacity(if with_keys { diagnostics.len() } else { 0 });
    // Each rule's diagnostics are contiguous.
    let mut rest = (0u32..).zip(&mut found);
    for rule_diagnostics in diagnostics.chunk_by(|a, b| a.rule == b.rule) {
        let ran = rule_diagnostics.first().and_then(|it| ran(it.rule));
        let ran = ran.unwrap_or(&unknown);
        if with_keys {
            numbers.resize(numbers.len() + rule_diagnostics.len(), ran.number);
        }
        for (it, (at, slot)) in rule_diagnostics.iter().zip(&mut rest) {
            let details = it.details.as_deref();
            // A diagnostic about the whole file, with no position, comes first in its phase.
            let start = details.and_then(|it| it.start_position.as_ref());
            let has_position = u64::from(start.is_none_or(|it| it.line != 0));
            let by_position = (has_position << 32) | u64::from(it.span.start);
            match ran.when {
                // If the diagnostic states its node, the rule also has a `run`, and that's what reports it.
                When::Once if !it.has_explicit_node => {
                    let within = match ran.once {
                        Once::AsReported => u64::from(at),
                        Once::ByEnd => (has_position << 32) | u64::from(it.span.end),
                        Once::ByStart => by_position,
                    };
                    once.push(with_index((u64::from(it.rule) << 33) | within, at));
                }
                // In a chain of calls, oxlint reaches the inner calls first.
                When::AtTheEnd => {
                    let label = (u64::from(it.span.start) << 32) | u64::from(it.span.end);
                    calls.push(with_index(label, at));
                }
                When::Last => last.push(with_index(by_position, at)),
                _ => {
                    // A rule that states its node walks the node the same way oxlint's rule does.
                    slot.1 = match it.has_explicit_node || ran.is_port {
                        true => at,
                        false => it.span.start,
                    };
                    let called = &ran.kinds;
                    let stated = details.and_then(|it| it.listened_on);
                    let label = stated.filter(|_| it.node.is_none()).unwrap_or(it.span);
                    let known = match it.node {
                        _ if has_position == 0 => Some(not_found),
                        Some(node) => (finder.by_bit_test(called, node, it))
                            .or_else(|| finder.of(it.rule, &called.kinds, label, it.node)),
                        // `Report::called_with_name`: oxlint's node is the reported name, which isn't a node in our
                        // tree.
                        None if it.has_explicit_node && stated.is_none() => Some(CalledNode {
                            span: label,
                            node: None,
                        }),
                        None => finder.of(it.rule, &called.kinds, label, None),
                    };
                    match known {
                        Some(known) => {
                            slot.0 = known;
                            nodes.push((u64::from(known.span.start) << 32) | u64::from(at));
                        }
                        None => searched.push(with_index(preorder_key(label), at)),
                    }
                }
            }
        }
    }
    nodes.sort_unstable();
    if !searched.is_empty() {
        searched.sort_unstable();
        let mut searched_nodes: Vec<u64> = Vec::with_capacity(searched.len());
        // How many of `nodes` start at or before the span being searched for.
        let mut before = 0;
        for (label, at) in (searched.into_iter()).map(|it| ((it >> 32) as u64, it as u32)) {
            let label = Span::new((label >> 32) as u32, u32::MAX - label as u32);
            while (nodes.get(before)).is_some_and(|it| (it >> 32) as u32 <= label.start) {
                before += 1;
            }
            // The last of those is nearby, so the search can start there.
            let near = before.checked_sub(1).and_then(|it| {
                let (start, at) = nodes.get(it).map(|it| ((it >> 32) as u32, *it as u32))?;
                let node = found.get(at as usize)?.0.node.map(|it| it.0);
                Some((start, node.or(diagnostics.get(at as usize)?.node)?))
            });
            let (Some(it), Some(slot)) = (diagnostics.get(at as usize), found.get_mut(at as usize))
            else {
                continue;
            };
            let kinds = ran(it.rule).map_or_else(Kinds::default, |it| it.kinds.kinds);
            slot.0 = finder.search(it.rule, &kinds, label, near);
            searched_nodes.push((u64::from(slot.0.span.start) << 32) | u64::from(at));
        }
        searched_nodes.sort_unstable();
        nodes = merged(&nodes, &searched_nodes);
    }
    sort_preorder(file, diagnostics, &found, &mut nodes);
    once.sort_unstable();
    last.sort_unstable();
    // oxlint visits each Jest call with the rules in rule-number order.
    calls.sort_unstable();
    let mut turn_of: Vec<u32> = Vec::new();
    if let Some(in_turns) = file.sink.jest_calls_in_oxlint_order.get() {
        let mut turns = Turns {
            calls: in_turns,
            seen: 0,
            open: Vec::new(),
        };
        // Rebuild each key as: turn, rule, start, index into `diagnostics`.
        for call in &mut calls {
            let (label, at) = ((*call >> 32) as u64, *call as u32);
            let span = Span::new((label >> 32) as u32, label as u32);
            let rule = diagnostics.get(at as usize).map_or(0, |it| it.rule);
            *call = (u128::from(turns.innermost_turn(span)) << 80)
                | (u128::from(rule) << 64)
                | (u128::from(span.start) << 32)
                | u128::from(at);
        }
        calls.sort_unstable();
        turn_of.extend(calls.iter().map(|it| (it >> 80) as u32));
        for call in &mut calls {
            *call &= (1 << 64) - 1;
        }
    }
    let mut keys: Vec<RunKey> = Vec::new();
    if with_keys {
        let number_of = |at: u32| u128::from(numbers.get(at as usize).copied().unwrap_or(u16::MAX));
        let part = |part: u64, first: u32| (part << 32) | u64::from(first);
        keys.reserve(diagnostics.len());
        for key in &once {
            let within = (key >> 32) & ((1 << 33) - 1);
            keys.push((part(0, number_of(*key as u32) as u32), within));
        }
        for at in nodes.iter().map(|it| *it as u32) {
            let Some((target, within)) = found.get(at as usize) else {
                continue;
            };
            let depth = target.node.map_or(DEEPEST, |it| it.1.into());
            let rest = (u128::from(u32::MAX - target.span.end) << END)
                | (depth << DEPTH)
                | ((number_of(at) & DEEPEST) << RULE)
                | (u128::from(*within) << WITHIN);
            keys.push((part(1, target.span.start), rest));
        }
        let turns = turn_of.iter().chain(std::iter::repeat(&0));
        for (call, turn) in calls.iter().zip(turns) {
            let rule = number_of(*call as u32) << 64;
            keys.push((part(2, *turn), rule | (call >> 32)));
        }
        keys.extend(last.iter().map(|it| (part(3, 0), it >> 32)));
    }
    let indices_of = |it: Vec<u128>| it.into_iter().map(|it| it as u32);
    let order = indices_of(once)
        .chain(nodes.into_iter().map(|it| it as u32))
        .chain(indices_of(calls))
        .chain(indices_of(last));
    (order.collect(), keys)
}
