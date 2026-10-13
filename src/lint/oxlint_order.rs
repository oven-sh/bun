//! In which order oxlint prints what its rules report about a file.
//!
//! It sorts nothing: what is reported first is printed first. This is how it runs (`execute_rules`): first `run_once` of
//! each rule, by the number of the rule; then the nodes, in the order in which a walk enters them, each with the rules that
//! are called with its kind of node, by their numbers; then the calls of Jest, each with the rules by their numbers. What
//! tsgolint reports comes last.
//!
//! The rules here run in another way, so what they report is put in that order afterwards, in a file about which something
//! is reported. `Linter::lint` has the four parts one after the other, and the rules of the first by their numbers. For the
//! second, [`place`] finds the node again that oxlint's rule is called with.

mod table;
mod visited;

use crate::rule::When::Entering;
use crate::rule::{Meta, Plugin, When};
use crate::utils::sort;
use bun_core::strings;
use bun_wyhash::hash_const;
use std::sync::LazyLock;
use table::{KINDS, RULES};
pub(crate) use visited::place;

/// What oxlint does with a rule.
#[derive(Copy, Clone)]
pub(crate) struct Order {
    pub(crate) when: When,
    /// Its place among all the rules, by the plugin and the name. A rule that oxlint has not comes after its rules.
    pub(crate) number: u16,
    /// For [`Entering`]: the kinds of node that it is called with, as places in [`KINDS`].
    pub(crate) kinds: &'static [u8],
}

pub(crate) fn of(rule: &Meta) -> Order {
    let table: &'static Table = &TABLE;
    let key = key(rule.plugin, rule.name.as_bytes());
    let found = table.rules.binary_search_by_key(&key, |it| it.key);
    match found.ok().and_then(|at| table.rules.get(at)) {
        Some(it) => Order {
            when: it.when,
            number: it.number,
            kinds: table
                .lists
                .get(it.kinds.0 as usize..it.kinds.1 as usize)
                .unwrap_or_default(),
        },
        None => Order {
            when: Entering,
            number: u16::MAX,
            kinds: &[],
        },
    }
}

/// The place in [`KINDS`] of the kind of node that oxc calls `name`. `None`: no rule is called with it.
fn kind_named(name: &str) -> Option<u8> {
    let found = TABLE.kinds.binary_search(&name.as_bytes());
    found.ok().map(|at| at as u8)
}

/// What oxc calls the kind of node at `place` in [`KINDS`].
fn name_of_kind(place: u8) -> &'static [u8] {
    TABLE.kinds.get(place as usize).copied().unwrap_or_default()
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
    when: When,
    number: u16,
    /// From where to where in [`Table::lists`].
    kinds: (u16, u16),
}

/// [`RULES`] and [`KINDS`], taken apart.
struct Table {
    rules: Vec<Rule>,
    lists: Vec<u8>,
    kinds: Vec<&'static [u8]>,
}

static TABLE: LazyLock<Table> = LazyLock::new(|| {
    let rank = |plugin: Plugin| RULES.iter().position(|it| it.0 == plugin.in_oxlint());
    let (mut all, mut lists) = (Vec::new(), Vec::new());
    for (plugin, when, words) in RULES {
        let mut kinds = (0, 0);
        for word in strings::split(words.as_bytes(), b" ") {
            if !word.first().is_some_and(u8::is_ascii_digit) {
                all.push((rank(*plugin), word, *plugin, *when, kinds));
                continue;
            }
            let first = lists.len() as u16;
            let number =
                |digits: &[u8]| digits.iter().fold(0, |it, digit| it * 10 + (digit - b'0'));
            lists.extend(strings::split(word, b",").map(number));
            kinds = (first, lists.len() as u16);
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
        lists,
        kinds: strings::split(KINDS.as_bytes(), b" ").collect(),
    }
});
