//! oxfmt's `sortTailwindcss`: sorts the Tailwind CSS classes in a string into the order in which Tailwind emits their
//! rules.
//!
//! A port of `prettier-plugin-tailwindcss`'s `sortClasses` and `sortClassList`, which oxfmt calls. Only Tailwind
//! knows the order, and Tailwind is JavaScript, so the formatter's caller supplies it through [`Orders`].

use bun_core::strings;
use bun_lint::regex::Regex;
use rustc_hash::FxHashSet;
use std::borrow::Cow;
use std::sync::atomic::{AtomicBool, Ordering};

/// A class's position among the classes it was looked up with. Lower sorts earlier. `None` means Tailwind doesn't
/// know the class.
pub type Rank = Option<u32>;

/// The source of the class order.
pub trait Orders: std::fmt::Debug + Send + Sync + std::panic::RefUnwindSafe {
    /// Returns the rank of each of `classes`, which are separated by single spaces, or `None` if the ranks aren't
    /// known yet.
    fn ranks_of(&self, classes: &[u8]) -> Option<Vec<Rank>>;

    /// True if there's a Tailwind to query.
    fn has_tailwind(&self) -> bool;
}

/// Names and name patterns. A pattern is written `"/^tw/"`.
#[derive(Debug, Default)]
pub struct Names {
    names: Vec<Vec<u8>>,
    patterns: Vec<Regex>,
}

/// It's immutable once built.
impl std::panic::RefUnwindSafe for Names {}

impl Names {
    /// The plugin's `parseRegex`, applied to each entry of `list`.
    pub fn new(list: Vec<Vec<u8>>) -> Names {
        let mut all = Names::default();
        for it in list {
            let pattern = it.strip_prefix(b"/").and_then(|rest| {
                let slash = strings::last_index_of_char(rest, b'/')?;
                Regex::from_bytes(&rest[..slash], &rest[slash + 1..]).ok()
            });
            match pattern {
                Some(pattern) => all.patterns.push(pattern),
                None => all.names.push(it),
            }
        }
        all
    }

    pub fn is_empty(&self) -> bool {
        self.names.is_empty() && self.patterns.is_empty()
    }

    /// The entries that aren't patterns.
    pub fn names(&self) -> &[Vec<u8>] {
        &self.names
    }

    /// True if `name` is one of the plain names. oxfmt's own rules don't support patterns.
    pub fn has_name(&self, name: &[u8]) -> bool {
        self.names.iter().any(|it| it == name)
    }

    pub fn has_pattern_for(&self, name: &[u8]) -> bool {
        self.patterns.iter().any(|it| it.test(name))
    }

    /// The plugin's `hasMatch`
    pub fn has(&self, name: &[u8]) -> bool {
        self.has_name(name) || self.has_pattern_for(name)
    }
}

/// The position of `@prettier/plugin-oxc` among the plugins. It parses TypeScript, and JavaScript that isn't embedded
/// in HTML.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum Oxc {
    #[default]
    Absent,
    /// It's listed before the plugin that sorts classes, which reads its tree.
    Before,
    /// It's listed after that plugin and overrides it, so nothing is sorted in the files that it parses.
    After,
}

/// `sortTailwindcss`, for one file.
#[derive(Debug)]
pub struct Tailwind {
    /// The functions whose arguments are classes.
    pub functions: Names,
    /// The attributes whose values are classes, besides `class` and `className`.
    pub attributes: Names,
    pub preserves_whitespace: bool,
    pub preserves_duplicates: bool,
    /// Sorting was turned on by `prettier-plugin-tailwindcss` in a Prettier config, so where oxfmt has its own rules,
    /// the plugin's apply instead.
    pub follows_plugin: bool,
    pub oxc: Oxc,
    pub orders: Box<dyn Orders>,
    /// See [`Tailwind::has_missed`].
    pub has_missed: AtomicBool,
}

/// How to treat the two ends of a text with classes.
#[derive(Clone, Copy, Debug)]
pub struct Ends {
    /// The first class is attached to whatever precedes the text, so it stays in place.
    pub ignores_first: bool,
    /// The last class is attached to whatever follows the text.
    pub ignores_last: bool,
    /// Whitespace at the start can be removed. If false, it collapses to one space.
    pub collapses_start: bool,
    pub collapses_end: bool,
}

/// The cleanups applied to a class list besides sorting.
#[derive(Clone, Copy, Debug)]
pub struct Tidies {
    pub collapses_white_space: bool,
    pub removes_duplicates: bool,
}

impl Ends {
    /// Nothing significant on either side.
    pub const FREE: Ends = Ends {
        ignores_first: false,
        ignores_last: false,
        collapses_start: true,
        collapses_end: true,
    };
}

/// True for `...` and `…`, which represent further classes.
fn is_rest(class: &[u8]) -> bool {
    class == b"..." || class == "…".as_bytes()
}

/// Suffixes that can follow the classes after `@apply`.
const IMPORTANT: [&[u8]; 4] = [
    b"!important",
    b"#{!important}",
    b"#{'!important'}",
    b"#{\"!important\"}",
];

impl Tailwind {
    /// Returns `params`, the text after `@apply`, with its classes sorted, or `None` if it has no classes. A port of
    /// oxfmt's `write_apply_prelude`, which follows the plugin's `transformCss`.
    pub fn sorted_apply_params(&self, params: &[u8]) -> Option<Vec<u8>> {
        let params = strings::trim_js_whitespace(params);
        // Less's `~"a b"`
        let escaped = (*b"\"'").into_iter().find_map(|quote| {
            let inner = params.strip_prefix(&[b'~', quote])?;
            Some((quote, inner.strip_suffix(&[quote])?))
        });
        let important = IMPORTANT.into_iter().find_map(|tail| {
            let classes = params.strip_suffix(tail)?;
            (strings::trim_js_whitespace_end(classes).len() < classes.len())
                .then_some((classes, tail))
        });
        let (classes, tail) = match (escaped, important) {
            (Some((_, inner)), _) => (inner, None),
            (None, Some((classes, tail))) => (classes, Some(tail)),
            (None, None) => (params, None),
        };
        let classes = strings::trim_js_whitespace(classes);
        if classes.is_empty() {
            return None;
        }
        let mut sorted = Vec::with_capacity(params.len());
        if let Some((quote, _)) = escaped {
            sorted.extend([b'~', quote]);
        }
        sorted.extend_from_slice(&self.sorted(classes));
        sorted.extend(escaped.map(|it| it.0));
        if let Some(tail) = tail {
            sorted.push(b' ');
            sorted.extend_from_slice(tail);
        }
        Some(sorted)
    }

    /// True if the order of some classes wasn't known yet. Those classes were left unsorted, so the output must be
    /// discarded.
    pub fn has_missed(&self) -> bool {
        self.has_missed.load(Ordering::Relaxed)
    }

    /// `sortClasses(text, { env })`
    pub fn sorted<'t>(&self, text: &'t [u8]) -> Cow<'t, [u8]> {
        self.sorted_between(text, Ends::FREE)
    }

    /// `sortClasses(text, { env, ignoreFirst, ignoreLast, collapseWhitespace })`
    pub fn sorted_between<'t>(&self, text: &'t [u8], ends: Ends) -> Cow<'t, [u8]> {
        self.sorted_with(text, ends, self.tidies())
    }

    /// The cleanups that the options allow.
    pub fn tidies(&self) -> Tidies {
        Tidies {
            collapses_white_space: !self.preserves_whitespace,
            removes_duplicates: !self.preserves_duplicates,
        }
    }

    /// Same as `sorted_between`, for callers that want fewer cleanups than the options allow.
    pub fn sorted_with<'t>(&self, text: &'t [u8], ends: Ends, tidies: Tidies) -> Cow<'t, [u8]> {
        if text.is_empty() || strings::contains(text, b"{{") {
            return Cow::Borrowed(text);
        }
        let collapses_whitespace = tidies.collapses_white_space;
        if collapses_whitespace && text.iter().all(u8::is_ascii_whitespace) {
            return Cow::Borrowed(&b" "[..]);
        }
        // `text.split(/([\t\r\f\n ]+)/)`: a class, whitespace, a class, and so on. The first and the last class can
        // be empty.
        let (mut classes, mut white_space): (Vec<&[u8]>, Vec<&[u8]>) = (Vec::new(), Vec::new());
        let mut rest = text;
        loop {
            let len = rest
                .iter()
                .take_while(|byte| !byte.is_ascii_whitespace())
                .count();
            let (class, after) = rest.split_at(len);
            classes.push(class);
            if after.is_empty() {
                break;
            }
            let len = after
                .iter()
                .take_while(|byte| byte.is_ascii_whitespace())
                .count();
            let (separator, after) = after.split_at(len);
            white_space.push(if collapses_whitespace {
                &b" "[..]
            } else {
                separator
            });
            rest = after;
        }
        if classes.last().is_some_and(|class| class.is_empty()) {
            classes.pop();
        }
        let (mut classes, mut white_space) = (&classes[..], &white_space[..]);
        let (mut prefix, mut suffix) = (Vec::new(), Vec::new());
        if ends.ignores_first {
            if let [first, rest @ ..] = classes {
                prefix.extend_from_slice(first);
                classes = rest;
            }
            if let [first, rest @ ..] = white_space {
                prefix.extend_from_slice(first);
                white_space = rest;
            }
        }
        if ends.ignores_last {
            if let [rest @ .., last] = white_space {
                suffix.extend_from_slice(last);
                white_space = rest;
            }
            if let [rest @ .., last] = classes {
                suffix.extend_from_slice(last);
                classes = rest;
            }
        }
        let ranks = match classes {
            [] => Some(Vec::new()),
            _ => self.orders.ranks_of(&classes.join(&b" "[..])),
        };
        let Some(ranks) = ranks.filter(|ranks| ranks.len() == classes.len()) else {
            self.has_missed.store(true, Ordering::Relaxed);
            return Cow::Borrowed(text);
        };

        // `sortClassList`
        let mut ordered: Vec<(&[u8], Rank)> = classes.iter().copied().zip(ranks).collect();
        crate::sort::sort_by(&mut ordered[..], |a, z| {
            is_rest(a.0).cmp(&is_rest(z.0)).then(a.1.cmp(&z.1))
        });
        // Only the first occurrence of a class that Tailwind knows is kept.
        let mut seen = FxHashSet::default();
        let is_removed: Vec<bool> = ordered
            .iter()
            .map(|&(class, rank)| {
                let is_seen = seen.contains(class);
                if rank.is_some() && tidies.removes_duplicates {
                    seen.insert(class);
                }
                is_seen
            })
            .collect();
        // A removed class takes the whitespace before it with it.
        let mut white_space = (white_space.iter().copied().enumerate())
            .filter(|(index, _)| is_removed.get(index + 1) != Some(&true))
            .map(|(_, separator)| separator);
        let mut result = Vec::with_capacity(text.len());
        for (&(class, _), _) in ordered.iter().zip(&is_removed).filter(|it| !*it.1) {
            result.extend_from_slice(class);
            result.extend_from_slice(white_space.next().unwrap_or_default());
        }
        if !collapses_whitespace {
            return Cow::Owned([prefix, result, suffix].concat());
        }
        // Whitespace at either end collapses to one space or to nothing. The plugin trims what JavaScript counts as
        // whitespace, which deletes a class that's a no-break space.
        let mut sorted = prefix.trim_ascii_end().to_vec();
        if sorted.len() < prefix.len() {
            sorted.push(b' ');
        }
        if !ends.collapses_start && result.trim_ascii_start().len() < result.len() {
            sorted.push(b' ');
        }
        sorted.extend_from_slice(result.trim_ascii());
        if !ends.collapses_end && result.trim_ascii_end().len() < result.len() {
            sorted.push(b' ');
        }
        if suffix.trim_ascii_start().len() < suffix.len() {
            sorted.push(b' ');
        }
        sorted.extend_from_slice(suffix.trim_ascii_start());
        Cow::Owned(sorted)
    }
}
