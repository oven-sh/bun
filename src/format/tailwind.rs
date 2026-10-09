//! oxfmt's `sortTailwindcss`: the classes of Tailwind CSS in a string are put in the order in which Tailwind writes
//! their rules.
//!
//! A port of `sortClasses` and `sortClassList` of `prettier-plugin-tailwindcss`, which oxfmt calls. The order is known to
//! Tailwind alone, which is JavaScript, so whoever calls the formatter brings it: [`Orders`].

use bun_core::strings;
use rustc_hash::FxHashSet;
use std::borrow::Cow;
use std::sync::atomic::{AtomicBool, Ordering};

/// Where a class is among those that it has been asked with: the lower, the earlier. `None`: Tailwind does not know it.
pub type Rank = Option<u32>;

/// What is known about the order of classes.
pub trait Orders: std::fmt::Debug + Send + Sync + std::panic::RefUnwindSafe {
    /// The rank of each of `classes`, which have one blank between them. `None`: that is not known yet.
    fn ranks_of(&self, classes: &[u8]) -> Option<Vec<Rank>>;
}

/// `sortTailwindcss`, for one file.
#[derive(Debug)]
pub struct Tailwind {
    /// The functions whose arguments are classes.
    pub functions: Vec<Vec<u8>>,
    /// The attributes whose values are classes, besides `class` and `className`.
    pub attributes: Vec<Vec<u8>>,
    pub preserves_whitespace: bool,
    pub preserves_duplicates: bool,
    pub orders: Box<dyn Orders>,
    /// See [`Tailwind::has_missed`].
    pub has_missed: AtomicBool,
}

/// `/[\t\r\f\n ]/`
#[inline]
fn is_white_space(byte: u8) -> bool {
    byte.is_ascii_whitespace()
}

/// What stands for the classes that follow.
fn is_rest(class: &[u8]) -> bool {
    class == b"..." || class == "…".as_bytes()
}

/// What can follow the classes behind `@apply`.
const IMPORTANT: [&[u8]; 4] = [
    b"!important",
    b"#{!important}",
    b"#{'!important'}",
    b"#{\"!important\"}",
];

impl Tailwind {
    /// `params`, which are behind `@apply`, with the classes sorted. `None`: there are none. A port of oxfmt's
    /// `write_apply_prelude`, which follows the plugin's `transformCss`.
    pub fn sorted_to_apply(&self, params: &[u8]) -> Option<Vec<u8>> {
        use crate::text::{trim, trim_end};
        let params = trim(params);
        // `~"a b"` of Less
        let escaped = [b'"', b'\''].into_iter().find_map(|quote| {
            let inner = params.strip_prefix(&[b'~', quote])?;
            Some((quote, inner.strip_suffix(&[quote])?))
        });
        let important = IMPORTANT.into_iter().find_map(|tail| {
            let classes = params.strip_suffix(tail)?;
            (trim_end(classes).len() < classes.len()).then_some((classes, tail))
        });
        let (classes, tail) = match (escaped, important) {
            (Some((_, inner)), _) => (inner, None),
            (None, Some((classes, tail))) => (classes, Some(tail)),
            (None, None) => (params, None),
        };
        let classes = trim(classes);
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

    /// Whether the order of some classes was not known, so that they have been left as they are, and what has been
    /// printed is of no use.
    pub fn has_missed(&self) -> bool {
        self.has_missed.load(Ordering::Relaxed)
    }

    /// `sortClasses(text, { env })`
    pub fn sorted<'t>(&self, text: &'t [u8]) -> Cow<'t, [u8]> {
        if text.is_empty() || strings::contains(text, b"{{") {
            return Cow::Borrowed(text);
        }
        let collapses_whitespace = !self.preserves_whitespace;
        if collapses_whitespace && text.iter().all(|&byte| is_white_space(byte)) {
            return Cow::Borrowed(&b" "[..]);
        }
        // `text.split(/([\t\r\f\n ]+)/)`: a class, white space, a class, and so on. The first and the last class can be
        // empty.
        let (mut classes, mut white_space): (Vec<&[u8]>, Vec<&[u8]>) = (Vec::new(), Vec::new());
        let mut rest = text;
        loop {
            let len = rest
                .iter()
                .take_while(|&&byte| !is_white_space(byte))
                .count();
            let (class, behind) = rest.split_at(len);
            classes.push(class);
            if behind.is_empty() {
                break;
            }
            let len = behind
                .iter()
                .take_while(|&&byte| is_white_space(byte))
                .count();
            let (blanks, behind) = behind.split_at(len);
            white_space.push(if collapses_whitespace {
                &b" "[..]
            } else {
                blanks
            });
            rest = behind;
        }
        if classes.last().is_some_and(|class| class.is_empty()) {
            classes.pop();
        }
        let Some(ranks) = self
            .orders
            .ranks_of(&classes.join(&b" "[..]))
            .filter(|ranks| ranks.len() == classes.len())
        else {
            self.has_missed.store(true, Ordering::Relaxed);
            return Cow::Borrowed(text);
        };

        // `sortClassList`
        let mut ordered: Vec<(&[u8], Rank)> = classes.into_iter().zip(ranks).collect();
        crate::sort::sort_by(&mut ordered[..], |a, z| {
            is_rest(a.0).cmp(&is_rest(z.0)).then(a.1.cmp(&z.1))
        });
        // Of a class that Tailwind knows, the first stays.
        let mut seen = FxHashSet::default();
        let is_removed: Vec<bool> = ordered
            .iter()
            .map(|&(class, rank)| {
                let is_seen = seen.contains(class);
                if rank.is_some() && !self.preserves_duplicates {
                    seen.insert(class);
                }
                is_seen
            })
            .collect();
        // The white space before it goes with it.
        let mut white_space = (white_space.into_iter().enumerate())
            .filter(|(index, _)| is_removed.get(index + 1) != Some(&true))
            .map(|(_, blanks)| blanks);
        let mut result = Vec::with_capacity(text.len());
        for (&(class, _), _) in ordered.iter().zip(&is_removed).filter(|it| !*it.1) {
            result.extend_from_slice(class);
            result.extend_from_slice(white_space.next().unwrap_or_default());
        }
        match collapses_whitespace {
            true => Cow::Owned(crate::text::trim(&result).to_vec()),
            false => Cow::Owned(result),
        }
    }
}
