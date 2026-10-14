//! In which order oxlint prints what its rules report about a file.
//!
//! It sorts nothing: what is reported first is printed first. This is how it runs (`execute_rules`): first `run_once` of
//! each rule, by the number of the rule; then the nodes, in the order in which a walk enters them, each with the rules that
//! are called with its kind of node, by their numbers; then the calls of Jest, each with the rules by their numbers. What
//! tsgolint reports comes last.
//!
//! The rules here run in another way, so what they report is put in that order afterwards, in a file about which something
//! is reported: [`in_run_order`]. It has the four parts one after the other, and the rules of the first by their numbers. For the
//! second, [`Places`] finds the node again that oxlint's rule is called with.

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
use visited::{Place, Places};

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

    #[inline]
    fn has_any_of(&self, others: &Kinds) -> bool {
        let both = self.0.iter().zip(others.0);
        both.into_iter().any(|(mine, theirs)| mine & theirs != 0)
    }

    /// All of them are among `others`.
    #[inline]
    fn are_among(&self, others: &Kinds) -> bool {
        let both = self.0.iter().zip(others.0);
        both.into_iter().all(|(mine, theirs)| mine & !theirs == 0)
    }
}

/// With what oxlint calls a rule: the kinds of node, and what follows from them for the nodes here, so that one look at most
/// nodes tells whether the rule is called with them.
#[derive(Copy, Clone, Default)]
pub(crate) struct Called {
    kinds: Kinds,
    /// A bit for each `ExprTag` that is of one of the kinds wherever it is.
    exprs: u64,
    /// The same for those that are so in a file without JSX.
    exprs_without_jsx: u64,
    /// A bit for each `StmtTag`.
    stmts: u64,
    /// A bit for each `BinOp` and for each `UnOp`.
    binaries: u32,
    unaries: u32,
    /// It is called with a part of a node here: it takes more than a look.
    is_odd: bool,
}

/// What oxlint does with a rule.
#[derive(Copy, Clone)]
pub(crate) struct Ran {
    pub(crate) when: When,
    /// Its place among all the rules, by the plugin and the name. A rule that oxlint has not comes after its rules.
    pub(crate) number: u16,
    /// For [`Entering`]: the kinds of node that it is called with.
    kinds: Called,
    /// [`once`]
    once: Once,
    /// [`is_port`]
    is_port: bool,
}

impl Ran {
    /// A rule that nothing is known about is taken for one that is called with nodes.
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

/// The place in [`KINDS`] of the kind of node that oxc calls `name`. `None`: no rule is called with it.
fn kind_named(name: &str) -> Option<u8> {
    TABLE.kinds.get(name.as_bytes()).copied()
}

/// In which order a rule that oxlint runs once reports.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Once {
    /// It goes through the text.
    ByStart,
    /// It reports a function when it leaves it.
    ByEnd,
    /// It follows a hash table of oxc, or reports one sort of thing after the other. The rule here does the same.
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

/// Whether the rule here is made after oxlint's, and goes through a node as that does. One that is made after a rule for ESLint
/// may go through it in another way: what it reports about one node is put in the order of the text.
fn is_port(rule: &Meta) -> bool {
    rule.follows_oxlint
}

fn key(plugin: Plugin, name: &[u8]) -> u32 {
    hash_const(hash_const(0, plugin.prefix().as_bytes()), name) as u32
}

struct Rule {
    /// [`key`], by which they are sorted.
    key: u32,
    when: When,
    number: u16,
    kinds: Kinds,
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

/// Where in a run of oxlint it reports something: less for what is earlier. It says the same whichever rules run beside the one
/// that reports, so that what is reported when a file is linted again can be put among what was reported before.
pub(crate) type RunKey = (u64, u128);

/// Finds the call of Jest around what is reported, for what comes by where it starts.
struct Turns<'t> {
    /// `File::calls_in_turns`
    calls: &'t [(Span, u32)],
    /// How many of them have been come to.
    seen: usize,
    /// Those around where it is, from the outside in: where each ends, and its turn.
    open: Vec<(u32, u32)>,
}

impl Turns<'_> {
    fn leave_what_ends_by(&mut self, offset: u32) {
        while self.open.last().is_some_and(|it| it.0 <= offset) {
            self.open.pop();
        }
    }

    /// The turn of the innermost call around `label`. After all of them, if there is none.
    fn of(&mut self, label: Span) -> u32 {
        while let Some((call, turn)) = self.calls.get(self.seen)
            && call.start <= label.start
        {
            self.leave_what_ends_by(call.start);
            self.open.push((call.end, *turn));
            self.seen += 1;
        }
        self.leave_what_ends_by(label.start);
        let around = self.open.partition_point(|it| it.0 >= label.end);
        let innermost = around.checked_sub(1).and_then(|it| self.open.get(it));
        innermost.map_or(u32::MAX, |it| it.1)
    }
}

/// By where it starts, the longer first: the order in which a walk enters nodes.
fn as_entered(span: Span) -> u64 {
    (u64::from(span.start) << 32) | u64::from(u32::MAX - span.end)
}

// Where the parts of the key start that puts what is reported about the nodes that start at one place in order, from the last.
// In the low 32 bits is the place in the list.
/// What decides among what one rule reports about one node.
const WITHIN: u32 = 32;
/// The rule: they are in the order of oxlint's numbers, and there are fewer than `1 << 15`.
const RULE: u32 = WITHIN + 32;
/// The how manyth of the nodes with its span the node is, from the outside.
const DEPTH: u32 = RULE + 15;
/// What is left of `u32::MAX` after the end of the node.
const END: u32 = DEPTH + 15;
/// Deeper than any node: what is reported stands in for a node that is not found.
const DEEPEST: u128 = (1 << 15) - 1;

/// Two lists that are in order, as one.
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

/// Puts `nodes`, which are by where the node starts, in the order in which a walk enters the nodes, those of one node by the
/// rule. In the high half of each is where the node starts, in the low half the place in `diagnostics` and in `found`, which has
/// the nodes, each with what decides among what one rule reports about it.
fn sort_as_entered<'a>(
    file: &'a File<'a>,
    diagnostics: &[Diagnostic],
    found: &[(Place, u32)],
    nodes: &mut [u64],
) {
    let key = |at: u32, depth_of: &dyn Fn(&Place) -> u128| {
        let (it, (place, within)) = (diagnostics.get(at as usize)?, found.get(at as usize)?);
        Some(
            (u128::from(u32::MAX - place.span.end) << END)
                | (depth_of(place) << DEPTH)
                | (u128::from(it.rule) << RULE)
                | (u128::from(*within) << WITHIN)
                | u128::from(at),
        )
    };
    let node_of = |key: u128| found.get(key as u32 as usize).and_then(|it| it.0.node);
    let mut at_one_start: Vec<u128> = Vec::new();
    for places in nodes.chunk_by_mut(|a, b| a >> 32 == b >> 32) {
        if places.len() < 2 {
            continue;
        }
        let level = |it: &Place| it.node.map_or(DEEPEST, |it| it.1.into());
        at_one_start.clear();
        at_one_start.extend(places.iter().filter_map(|it| key(*it as u32, &level)));
        at_one_start.sort_unstable();
        // Nodes that are in each other and are written from the same place to the same place.
        let is_other_node = |pair: &[u128]| match pair {
            [a, b] => {
                a >> END == b >> END && node_of(*a).map(|it| it.0) != node_of(*b).map(|it| it.0)
            }
            _ => false,
        };
        if at_one_start
            .array_windows::<2>()
            .any(|it| is_other_node(it))
        {
            let depth = |it: &Place| match it.node {
                Some(node) => u128::from(visited::depth(file, node, it.span)).min(DEEPEST - 1),
                None => DEEPEST,
            };
            at_one_start.clear();
            at_one_start.extend(places.iter().filter_map(|it| key(*it as u32, &depth)));
            at_one_start.sort_unstable();
        }
        for (place, sorted) in places.iter_mut().zip(&at_one_start) {
            *place = u64::from(*sorted as u32);
        }
    }
}

/// The places in `diagnostics` in the order in which oxlint reports them, and if `wants_keys` the [`RunKey`] of each. `ran`: about
/// the rule with that index.
pub(crate) fn in_run_order<'a, 'r>(
    file: &'a File<'a>,
    diagnostics: &[Diagnostic],
    ran: &dyn Fn(u16) -> Option<&'r Ran>,
    wants_keys: bool,
) -> (Vec<u32>, Vec<RunKey>) {
    let unknown = Ran::unknown(Entering, u16::MAX);
    let mut places = Places::new(file);
    // The four parts of the run. Each with the place in `diagnostics` in the low 32 bits.
    let with_place = |key: u64, at: u32| (u128::from(key) << 32) | u128::from(at);
    let mut once: Vec<u128> = Vec::new();
    let mut nodes: Vec<u64> = Vec::with_capacity(diagnostics.len());
    let mut calls: Vec<u128> = Vec::new();
    let mut last: Vec<u128> = Vec::new();
    // For the second part: the node of each, and those for which it has to be searched.
    let nowhere = Place {
        span: Span::new(0, u32::MAX),
        node: None,
    };
    let mut found: Vec<(Place, u32)> = vec![(nowhere, 0); diagnostics.len()];
    let mut searched: Vec<u128> = Vec::new();
    // The number of the rule of each, for the keys.
    let mut numbers: Vec<u16> = Vec::with_capacity(if wants_keys { diagnostics.len() } else { 0 });
    // A rule reports all that it reports in a row.
    let mut rest = (0u32..).zip(&mut found);
    for of_rule in diagnostics.chunk_by(|a, b| a.rule == b.rule) {
        let ran = of_rule.first().and_then(|it| ran(it.rule));
        let ran = ran.unwrap_or(&unknown);
        if wants_keys {
            numbers.resize(numbers.len() + of_rule.len(), ran.number);
        }
        for (it, (at, place)) in of_rule.iter().zip(&mut rest) {
            let details = it.details.as_deref();
            // What is about the file as a whole, at no place in it, is the first of its part.
            let start = details.and_then(|it| it.start_position.as_ref());
            let has_place = u64::from(start.is_none_or(|it| it.line != 0));
            let by_place = (has_place << 32) | u64::from(it.span.start);
            match ran.when {
                // One that says with which node has a `run` as well, which reports this.
                When::Once if !it.states_node => {
                    let within = match ran.once {
                        Once::AsReported => u64::from(at),
                        Once::ByEnd => (has_place << 32) | u64::from(it.span.end),
                        Once::ByStart => by_place,
                    };
                    once.push(with_place((u64::from(it.rule) << 33) | within, at));
                }
                // Of a chain of calls it comes to the inner ones first.
                When::AtTheEnd => {
                    let label = (u64::from(it.span.start) << 32) | u64::from(it.span.end);
                    calls.push(with_place(label, at));
                }
                When::Last => last.push(with_place(by_place, at)),
                _ => {
                    // A rule that says which node it is goes through the node as oxlint's does.
                    place.1 = match it.states_node || ran.is_port {
                        true => at,
                        false => it.span.start,
                    };
                    let called = &ran.kinds;
                    let stated = details.and_then(|it| it.listened_on);
                    let label = stated.filter(|_| it.node.is_none()).unwrap_or(it.span);
                    let known = match it.node {
                        _ if has_place == 0 => Some(nowhere),
                        Some(node) => (places.at_a_look(called, node, it))
                            .or_else(|| places.of(it.rule, &called.kinds, label, it.node)),
                        // The name is the node.
                        None if it.states_node && stated.is_none() => Some(Place {
                            span: label,
                            node: None,
                        }),
                        None => places.of(it.rule, &called.kinds, label, None),
                    };
                    match known {
                        Some(known) => {
                            place.0 = known;
                            nodes.push((u64::from(known.span.start) << 32) | u64::from(at));
                        }
                        None => searched.push(with_place(as_entered(label), at)),
                    }
                }
            }
        }
    }
    nodes.sort_unstable();
    if !searched.is_empty() {
        searched.sort_unstable();
        let mut late: Vec<u64> = Vec::with_capacity(searched.len());
        // How many of `nodes` start no later than what is searched for.
        let mut before = 0;
        for (label, at) in (searched.into_iter()).map(|it| ((it >> 32) as u64, it as u32)) {
            let label = Span::new((label >> 32) as u32, u32::MAX - label as u32);
            while (nodes.get(before)).is_some_and(|it| (it >> 32) as u32 <= label.start) {
                before += 1;
            }
            // The last of them is close by.
            let near = before.checked_sub(1).and_then(|it| {
                let (start, at) = nodes.get(it).map(|it| ((it >> 32) as u32, *it as u32))?;
                let node = found.get(at as usize)?.0.node.map(|it| it.0);
                Some((start, node.or(diagnostics.get(at as usize)?.node)?))
            });
            let (Some(it), Some(place)) =
                (diagnostics.get(at as usize), found.get_mut(at as usize))
            else {
                continue;
            };
            let kinds = ran(it.rule).map_or_else(Kinds::default, |it| it.kinds.kinds);
            place.0 = places.search(it.rule, &kinds, label, near);
            late.push((u64::from(place.0.span.start) << 32) | u64::from(at));
        }
        late.sort_unstable();
        nodes = merged(&nodes, &late);
    }
    sort_as_entered(file, diagnostics, &found, &mut nodes);
    once.sort_unstable();
    last.sort_unstable();
    // Each of the calls with the rules by their numbers.
    calls.sort_unstable();
    let mut turn_of: Vec<u32> = Vec::new();
    if let Some(in_turns) = file.sink.calls_in_turns.get() {
        let mut turns = Turns {
            calls: in_turns,
            seen: 0,
            open: Vec::new(),
        };
        // The turn, the rule, where it starts, and the place in `diagnostics`.
        for call in &mut calls {
            let (label, at) = ((*call >> 32) as u64, *call as u32);
            let span = Span::new((label >> 32) as u32, label as u32);
            let rule = diagnostics.get(at as usize).map_or(0, |it| it.rule);
            *call = (u128::from(turns.of(span)) << 80)
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
    if wants_keys {
        let number_of = |at: u32| u128::from(numbers.get(at as usize).copied().unwrap_or(u16::MAX));
        let part = |part: u64, first: u32| (part << 32) | u64::from(first);
        keys.reserve(diagnostics.len());
        for key in &once {
            let within = (key >> 32) & ((1 << 33) - 1);
            keys.push((part(0, number_of(*key as u32) as u32), within));
        }
        for at in nodes.iter().map(|it| *it as u32) {
            let Some((place, within)) = found.get(at as usize) else {
                continue;
            };
            let depth = place.node.map_or(DEEPEST, |it| it.1.into());
            let rest = (u128::from(u32::MAX - place.span.end) << END)
                | (depth << DEPTH)
                | ((number_of(at) & DEEPEST) << RULE)
                | (u128::from(*within) << WITHIN);
            keys.push((part(1, place.span.start), rest));
        }
        let turns = turn_of.iter().chain(std::iter::repeat(&0));
        for (call, turn) in calls.iter().zip(turns) {
            let rule = number_of(*call as u32) << 64;
            keys.push((part(2, *turn), rule | (call >> 32)));
        }
        keys.extend(last.iter().map(|it| (part(3, 0), it >> 32)));
    }
    let places_of = |it: Vec<u128>| it.into_iter().map(|it| it as u32);
    let order = places_of(once)
        .chain(nodes.into_iter().map(|it| it as u32))
        .chain(places_of(calls))
        .chain(places_of(last));
    (order.collect(), keys)
}
