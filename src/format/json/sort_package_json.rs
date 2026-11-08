//! Sorts the keys of a `package.json`.
//!
//! There are two orders. Each is a table of the known keys and how to handle each key's value:
//! - `oxfmt.rs`: oxfmt's `sortPackageJson`.
//! - `npm.rs`: `prettier-plugin-packagejson`.
//!
//! Both tools parse the text into values, sort those, and write them back. That rewrites numbers and strings
//! (`12345678901234567890` becomes `12345678901234567000`) and drops all but one of the members that have the same key.
//!
//! Sorting here only moves members. It reorders the nodes of the formatter's tree, and the writer still prints every name and
//! every value from its source text, as it does without sorting:
//! - Numbers and strings stay as written. A key is decoded only to compare it.
//! - Members with the same key all stay, in source order.
//! - A key like `"10"` sorts like any other key. In the plugin's JavaScript objects such keys always come first.
//! - The text doesn't have to be strict JSON. Whatever the `json-stringify` parser accepts is sorted.
//!
//! One thing is removed, as in both tools: a duplicate string in a list like `keywords`.

mod npm;
mod oxfmt;

use super::parser::{Kind, Node, Tree};
use super::writer::cooked;
use bun_core::strings;
use bun_lint::utils::text::number_to_string;
use rustc_hash::{FxHashMap, FxHashSet};
use std::borrow::Cow;
use std::cmp::Ordering;
use std::sync::Arc;

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct SortPackageJson {
    /// oxfmt's `sortScripts`: also sort `scripts`, `betterScripts` and `wireit` by name.
    pub sort_scripts: bool,
    /// Sort like `prettier-plugin-packagejson` instead of oxfmt.
    pub plugin: Option<Arc<Plugin>>,
}

/// The settings of `prettier-plugin-packagejson`.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Plugin {
    /// `packageSortOrder`: these keys come before all others.
    pub first: Vec<Vec<u8>>,
    /// The working directory has `yarn.lock`, `.yarn/`, `.yarnrc.yml`, `pnpm-lock.yaml` or `pnpm-workspace.yaml`.
    pub has_yarn_or_pnpm_files: bool,
}

/// How to handle a key's value.
#[derive(Copy, Clone)]
enum Over {
    Nothing,
    /// In an array of strings, drop duplicates.
    Unique,
    /// The same, and sort them.
    UniqueSorted,
    /// These keys first, then the others by name. Then apply the properties.
    Keys(&'static [&'static str], Properties),
    /// Leave the keys where they are and apply the properties.
    In(Properties),
    /// [`Over::Keys`], for nested objects too.
    Deep(&'static [&'static str]),
    /// Apply this to every element of an array.
    Each(&'static Over),
    /// The same, or apply it to the value itself if that's an object.
    EachOrSelf(&'static Over),
    /// Sort the keys by name and apply this to every value.
    Values(&'static Over),
    /// Sort like the top level.
    Fields,
    /// Sort by name, with oxfmt's `sortScripts`.
    OxfmtScripts,
    // The rest is in `npm.rs`.
    Dependencies,
    DependenciesMeta,
    Scripts,
    Exports,
    EslintConfig,
    EslintRules,
    PrettierConfig,
    PnpmConfig,
    PnpmOverrides,
}

/// How to handle the values of some of an object's keys.
type Properties = &'static [(&'static str, Over)];

const AS_IS: Over = Over::Nothing;
const SORTED: Over = Over::Keys(&[], &[]);

/// A member of an object.
struct Member<'a> {
    /// Decoded.
    key: Cow<'a, [u8]>,
    /// The index of its name in the tree. Its value is the next node.
    name: u32,
}

/// The tree, before anything moves.
#[derive(Copy, Clone)]
struct Document<'a> {
    text: &'a [u8],
    nodes: &'a [Node],
}

impl<'a> Document<'a> {
    fn kind(self, index: u32) -> Option<Kind> {
        Some(self.nodes.get(index as usize)?.kind)
    }

    fn source(self, index: u32) -> &'a [u8] {
        let span = self.nodes.get(index as usize);
        span.and_then(|it| self.text.get(it.start as usize..it.end as usize))
            .unwrap_or_default()
    }

    /// The nodes directly in the container at `index`. In an object, names and values alternate.
    fn children(self, index: u32) -> impl Iterator<Item = u32> + use<'a> {
        let end = self.nodes.get(index as usize).map_or(0, |it| it.next);
        let mut at = index + 1;
        std::iter::from_fn(move || {
            let child = at;
            at = self.nodes.get(at as usize).filter(|_| at < end)?.next;
            Some(child)
        })
    }

    /// The elements of the array at `index`, or the values of the object.
    fn values(self, index: u32) -> impl Iterator<Item = u32> + use<'a> {
        let names = usize::from(self.kind(index) == Some(Kind::Object));
        self.children(index).skip(names).step_by(1 + names)
    }

    fn members(self, object: u32) -> Vec<Member<'a>> {
        let names = self.children(object).step_by(2);
        let member = |name| Member {
            key: self.key(name),
            name,
        };
        names.map(member).collect()
    }

    /// The decoded text between the quotes of the string or template at `index`.
    fn string(self, index: u32) -> Option<Cow<'a, [u8]>> {
        if !matches!(self.kind(index)?, Kind::String | Kind::Template) {
            return None;
        }
        let source = self.source(index);
        let raw = source.get(1..source.len().saturating_sub(1))?;
        Some(match strings::contains_char(raw, b'\\') {
            true => Cow::Owned(cooked(raw)),
            false => Cow::Borrowed(raw),
        })
    }

    /// The name at `index` as a JavaScript property key.
    fn key(self, index: u32) -> Cow<'a, [u8]> {
        let source = self.source(index);
        match self.kind(index) {
            Some(Kind::Number) => {
                Cow::Owned(number_to_string(bun_core::fmt::js_string_to_number(source)))
            }
            _ => self.string(index).unwrap_or(Cow::Borrowed(source)),
        }
    }

    /// The value of `key` in the object at `index`: the last one, as for `JSON.parse`. `None` if it isn't an object.
    fn get(self, index: u32, key: &[u8]) -> Option<u32> {
        if self.kind(index)? != Kind::Object {
            return None;
        }
        let names = self.children(index).step_by(2);
        names
            .filter(|&it| *self.key(it) == *key)
            .last()
            .map(|it| it + 1)
    }

    /// `Boolean(value)`
    fn is_truthy(self, index: u32) -> bool {
        let source = self.source(index);
        match self.kind(index) {
            Some(Kind::Object | Kind::Array) => true,
            Some(Kind::String | Kind::Template) => source.len() > 2,
            Some(Kind::Number) => bun_core::fmt::js_string_to_number(source) != 0.0,
            Some(Kind::Unary) => self.is_truthy(index + 1),
            Some(Kind::Identifier) => matches!(source, b"true" | b"Infinity"),
            Some(Kind::Hole) | None => false,
        }
    }
}

/// The state a step needs besides the value it sorts.
struct Context<'a> {
    document: Document<'a>,
    /// The known keys of the top level, in order.
    fields: Properties,
    /// The keys that come before those.
    first: &'a [Vec<u8>],
    /// The order "by name".
    by_name: fn(&[u8], &[u8]) -> Ordering,
    sorts_scripts: bool,
    /// See `npm.rs`.
    sorts_dependencies_like_npm: bool,
    has_sequential_script: bool,
}

fn sort_by(members: &mut [Member<'_>], mut compare: impl FnMut(&[u8], &[u8]) -> Ordering) {
    crate::sort::sort_by(members, |a, b| compare(&a.key, &b.key));
}

/// The keys in `first` come first, in that order. Then the others, by name.
fn sort_keys(members: &mut [Member<'_>], first: &[&str], context: &Context<'_>) {
    let rank = |key: &[u8]| first.iter().position(|it| it.as_bytes() == key);
    let rank = |key: &[u8]| rank(key).unwrap_or(first.len());
    sort_by(members, |a, b| {
        (rank(a).cmp(&rank(b))).then_with(|| (context.by_name)(a, b))
    });
}

/// `context.first`, then the known keys, then the others by name, with those that start with `_` last.
fn sort_fields(members: &mut [Member<'_>], context: &Context<'_>) {
    let mut ranks: FxHashMap<&[u8], usize> = FxHashMap::default();
    let first = context.first.iter().map(|it| &it[..]);
    let known = context.fields.iter().map(|it| it.0.as_bytes());
    for (rank, name) in first.chain(known).enumerate() {
        ranks.entry(name).or_insert(rank);
    }
    let rank = |key: &[u8]| {
        let known = ranks.get(key).copied().unwrap_or(usize::MAX);
        (known, key.starts_with(b"_"))
    };
    sort_by(members, |a, b| {
        (rank(a).cmp(&rank(b))).then_with(|| (context.by_name)(a, b))
    });
}

/// The new order of some containers' children.
#[derive(Default)]
struct Plan {
    /// Keyed by a container's index: its elements, or its members' names, in their new order.
    orders: FxHashMap<u32, Vec<u32>>,
    /// The dropped elements.
    removed: Vec<u32>,
}

impl Plan {
    /// Applies `over` to the value at `index`. Nested values wait in a list, so deep nesting costs heap and not stack.
    fn make(index: u32, over: Over, context: &Context<'_>) -> Plan {
        let mut plan = Plan::default();
        let mut pending = vec![(index, over)];
        while let Some((index, over)) = pending.pop() {
            match context.document.kind(index) {
                Some(Kind::Array) => plan.sort_array(index, over, context, &mut pending),
                Some(Kind::Object) => plan.sort_object(index, over, context, &mut pending),
                _ => {}
            }
        }
        plan
    }

    fn sort_array(
        &mut self,
        index: u32,
        over: Over,
        context: &Context<'_>,
        pending: &mut Vec<(u32, Over)>,
    ) {
        let elements = context.document.children(index);
        match over {
            Over::Each(over) | Over::EachOrSelf(over) => {
                pending.extend(elements.map(|it| (it, *over)));
            }
            Over::Unique | Over::UniqueSorted => {
                let strings = elements.map(|it| Some((context.document.string(it)?, it)));
                // An array with anything else in it is left alone.
                let Some(mut strings) = strings.collect::<Option<Vec<_>>>() else {
                    return;
                };
                let count = strings.len();
                let mut seen = FxHashSet::default();
                strings.retain(|(string, element)| {
                    let is_first = seen.insert(string.clone());
                    if !is_first {
                        self.removed.push(*element);
                    }
                    is_first
                });
                if matches!(over, Over::UniqueSorted) {
                    crate::sort::sort_by(&mut strings, |a, b| (context.by_name)(&a.0, &b.0));
                }
                if strings.len() < count || !strings.is_sorted_by_key(|it| it.1) {
                    let order = strings.iter().map(|it| it.1).collect();
                    self.orders.insert(index, order);
                }
            }
            _ => {}
        }
    }

    fn sort_object(
        &mut self,
        index: u32,
        over: Over,
        context: &Context<'_>,
        pending: &mut Vec<(u32, Over)>,
    ) {
        let over = match over {
            Over::EachOrSelf(over) => *over,
            over => over,
        };
        let mut members = context.document.members(index);
        let members = &mut members[..];
        let mut properties: Properties = &[];
        // Applied to the values of the keys that aren't in `properties`.
        let mut inner = Over::Nothing;
        match over {
            // For arrays.
            Over::Nothing
            | Over::Unique
            | Over::UniqueSorted
            | Over::Each(_)
            | Over::EachOrSelf(_) => {}
            Over::In(all) => properties = all,
            Over::Keys(first, all) => {
                sort_keys(members, first, context);
                properties = all;
            }
            Over::Deep(first) => {
                sort_keys(members, first, context);
                inner = over;
            }
            Over::Values(over) => {
                sort_keys(members, &[], context);
                inner = *over;
            }
            Over::Fields => {
                sort_fields(members, context);
                properties = context.fields;
            }
            Over::OxfmtScripts if context.sorts_scripts => sort_keys(members, &[], context),
            Over::OxfmtScripts => {}
            Over::Dependencies => npm::sort_dependencies(members, context),
            Over::DependenciesMeta => {
                npm::sort_by_package_name(members);
                inner = over;
            }
            Over::Scripts => npm::sort_scripts(members, context.has_sequential_script),
            Over::Exports => {
                npm::sort_exports(members);
                inner = over;
            }
            Over::EslintConfig => {
                sort_keys(members, npm::ESLINT_KEYS, context);
                properties = npm::ESLINT_PROPERTIES;
            }
            Over::EslintRules => npm::sort_eslint_rules(members),
            Over::PrettierConfig => {
                npm::sort_prettier_config(members);
                properties = npm::PRETTIER_OVERRIDES;
            }
            Over::PnpmConfig => {
                sort_keys(members, npm::PNPM_KEYS, context);
                properties = &[("overrides", Over::PnpmOverrides)];
                inner = Over::Deep(npm::PNPM_KEYS);
            }
            Over::PnpmOverrides => {
                sort_keys(members, npm::PNPM_KEYS, context);
                npm::sort_by_version(members);
                inner = Over::Deep(npm::PNPM_KEYS);
            }
        }
        for member in members.iter() {
            let matching_property = properties.iter().find(|it| it.0.as_bytes() == &*member.key);
            match matching_property.map_or(inner, |it| it.1) {
                Over::Nothing => {}
                over => pending.push((member.name + 1, over)),
            }
        }
        if !members.is_sorted_by_key(|it| it.name) {
            let order = members.iter().map(|it| it.name).collect();
            self.orders.insert(index, order);
        }
    }

    /// The nodes of `old` in their new order. A container is still followed by its contents.
    fn apply(mut self, old: &[Node]) -> Vec<Node> {
        crate::sort::sort(&mut self.removed);
        let removed_before = |index: u32| self.removed.partition_point(|it| *it < index) as u32;
        let mut nodes: Vec<Node> = Vec::with_capacity(old.len());
        // Ranges of `old` that have yet to be copied. The last one comes next.
        let mut ranges = vec![(0, old.len() as u32)];
        while let Some((mut at, end)) = ranges.pop() {
            while let Some(&(mut node)) = old.get(at as usize).filter(|_| at < end) {
                let (container, after) = (at, node.next);
                let len = after - at - (removed_before(after) - removed_before(at));
                node.next = nodes.len() as u32 + len;
                at += 1;
                let Some(order) = self.orders.get(&container) else {
                    nodes.push(node);
                    continue;
                };
                node.count = order.len() as u32;
                nodes.push(node);
                ranges.push((after, end));
                // A member ends where its value does.
                let last = u32::from(node.kind == Kind::Object);
                let range = |&child: &u32| {
                    let end = old.get((child + last) as usize).map_or(child, |it| it.next);
                    (child, end)
                };
                ranges.extend(order.iter().rev().map(range));
                break;
            }
        }
        nodes
    }
}

/// Sorts `tree`, which the `json-stringify` parser built from `text`.
pub(super) fn sort(text: &[u8], tree: &mut Tree, how: &SortPackageJson) {
    let document = Document {
        text,
        nodes: &tree.nodes,
    };
    let context = match &how.plugin {
        Some(plugin) => npm::context(document, plugin),
        None => oxfmt::context(document, how.sort_scripts),
    };
    let plan = Plan::make(0, Over::Fields, &context);
    if !plan.orders.is_empty() {
        tree.nodes = plan.apply(&tree.nodes);
    }
}
