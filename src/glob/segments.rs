//! What minimatch 10.2.6 does with a path that is split at its slashes: at most 2 x parts x names tests of a name.

use crate::braces;
use crate::node::Program;
use crate::read_minimatch;
use crate::unit::{Subject, Text};
use bun_collections::StringHashMap;
use bun_collections::smallvec::SmallVec;
use bun_core::strings;

// ───────────────────────────── a name of a pattern ─────────────────────────────

pub(crate) enum Part {
    /// `**`
    GlobStar,
    /// Without magic.
    Literal(Box<[u8]>),
    /// `*`
    Star,
    /// `*.js`: what follows the stars.
    StarExt(Box<[u8]>),
    /// `??`, `??.js`: the length of all of it in UTF-16 code units, and what follows the question marks.
    QuestionMarks(usize, Box<[u8]>),
    /// `*.*`
    StarDotStar,
    /// `.*`
    DotStar,
    Name(Program),
    /// It can match nothing, or the reference throws.
    Never,
}

fn is_dots(name: &[u8]) -> bool {
    matches!(name, b"." | b"..")
}

/// A name that neither `*` nor `**` takes. `dot`: the option.
fn is_left_out(name: &[u8], dot: bool) -> bool {
    match dot {
        true => is_dots(name),
        false => name.starts_with(b"."),
    }
}

impl Part {
    fn test(&self, name: &[u8], dot: bool) -> bool {
        match self {
            Part::GlobStar | Part::Never => false,
            Part::Literal(literal) => name == &literal[..],
            Part::Star => !name.is_empty() && !is_left_out(name, dot),
            Part::StarExt(ext) => name.ends_with(ext) && (dot || !name.starts_with(b".")),
            Part::QuestionMarks(len, ext) => {
                Text::UTF16.count_units(name) == *len
                    && !is_left_out(name, dot)
                    && name.ends_with(ext)
            }
            Part::StarDotStar => !is_left_out(name, dot) && strings::contains_char(name, b'.'),
            Part::DotStar => !is_dots(name) && name.starts_with(b"."),
            Part::Name(program) => program.matches(Subject::of(name)),
        }
    }
}

// ───────────────────────────── a path ─────────────────────────────

type Names<'p> = SmallVec<[&'p [u8]; 16]>;

/// `slashSplit`: `path.split(/\/+/)`
fn split_path(path: &[u8]) -> Names<'_> {
    let mut names = Names::new();
    let mut rest = path;
    while let Some(slash) = strings::index_of_char_usize(rest, b'/') {
        names.push(&rest[..slash]);
        rest = &rest[slash..];
        rest = &rest[rest.iter().take_while(|b| **b == b'/').count()..];
    }
    names.push(rest);
    names
}

/// A path that many patterns are matched with: split once. Separated by `/`.
pub struct Candidate<'p> {
    whole: &'p [u8],
    /// The path, if its names are separated by one slash each.
    text: Option<&'p [u8]>,
    names: Names<'p>,
    /// Where the last name is that no `**` takes, with the option `dot` and without.
    last_dots: Option<usize>,
    last_hidden: Option<usize>,
}

impl<'p> Candidate<'p> {
    pub fn new(path: &'p [u8]) -> Candidate<'p> {
        let names = split_path(path);
        Candidate {
            whole: path,
            text: (!strings::contains(path, b"//")).then_some(path),
            last_dots: names.iter().rposition(|it| is_dots(it)),
            last_hidden: names.iter().rposition(|it| it.starts_with(b".")),
            names,
        }
    }

    /// The path as it is.
    pub fn path(&self) -> &'p [u8] {
        self.whole
    }
}

// ───────────────────────────── a pattern ─────────────────────────────

/// A pattern without braces.
pub(crate) struct Expansion {
    parts: Vec<Part>,
    /// Where the first `**` is, and the last one.
    globstars: Option<(usize, usize)>,
    /// The parts at the start that are without magic, joined by slashes: what matches starts with them.
    head: Vec<u8>,
    /// What the last part ends with, and so what matches, unless that ends with a slash.
    tail: Vec<u8>,
    /// The longest run of characters without magic in the parts between these, which is somewhere in what matches.
    inner: Vec<u8>,
}

impl Expansion {
    fn new(parts: Vec<Part>) -> Expansion {
        let is_globstar = |part: &Part| matches!(part, Part::GlobStar);
        let literals = parts.iter().map_while(|it| match it {
            Part::Literal(literal) => Some(&literal[..]),
            _ => None,
        });
        let literals: Vec<&[u8]> = literals.collect();
        let tail = match parts.last() {
            Some(Part::Literal(end) | Part::StarExt(end)) => &end[..],
            _ => b"",
        };
        // What neither of them covers.
        let before_tail = parts.len() - usize::from(!tail.is_empty());
        let between = parts.get(literals.len()..before_tail).unwrap_or_default();
        let literals_between = between.iter().map(|it| match it {
            Part::Literal(literal) => &literal[..],
            Part::Name(program) => program.longest_literal(),
            _ => b"",
        });
        Expansion {
            inner: literals_between
                .max_by_key(|it| it.len())
                .unwrap_or_default()
                .to_vec(),
            head: literals.join(&b'/'),
            tail: tail.to_vec(),
            globstars: parts
                .iter()
                .position(is_globstar)
                .zip(parts.iter().rposition(is_globstar)),
            parts,
        }
    }

    /// What a path that matches starts with, up to a slash or to its end. Empty: it does not say.
    pub(crate) fn head(&self) -> &[u8] {
        &self.head
    }

    /// Whether `path` can match, as far as that shows without looking at its names.
    #[inline]
    fn can_match(&self, path: &[u8]) -> bool {
        // Most heads are empty and most tails are a few bytes, which are compared without a call.
        let ends_with_tail = || {
            path.len() >= self.tail.len()
                && path
                    .iter()
                    .rev()
                    .zip(self.tail.iter().rev())
                    .all(|(a, b)| a == b)
        };
        (self.head.is_empty()
            || path.starts_with(&self.head)
                && matches!(path.get(self.head.len()), None | Some(b'/')))
            && (ends_with_tail() || path.last() == Some(&b'/'))
            && (self.inner.is_empty() || strings::contains(path, &self.inner))
    }

    /// Apart from `matches`: most paths are turned away by `can_match`, and do not pay for what this sets up.
    #[inline(never)]
    fn matches_names(&self, path: &Candidate<'_>, partial: bool, dot: bool) -> bool {
        match self.globstars {
            Some(globstars) => match_globstar(path, &self.parts, globstars, partial, dot),
            None => match_plain(&path.names, &self.parts, partial, dot),
        }
    }
}

/// `/\{(?:(?!\{).)*\}/.test(pattern)`
fn has_braces(pattern: &[u8]) -> bool {
    let mut is_open = false;
    let mut rest = pattern;
    while let [byte, after @ ..] = rest {
        match byte {
            b'{' => is_open = true,
            b'}' if is_open => return true,
            _ if bun_core::lexer::starts_with_line_break(rest) => is_open = false,
            _ => {}
        }
        rest = after;
    }
    false
}

/// Braces, split, `levelOneOptimize`, parts. `pattern`: without the `!` at its start. `None`: beyond a limit of `braces.rs`.
pub(crate) fn read(pattern: &[u8], dot: bool) -> Option<Vec<Expansion>> {
    let mut globs = match has_braces(pattern) {
        true => braces::expand(pattern)?,
        false => vec![pattern.to_vec()],
    };
    if globs.len() > 1 {
        let mut seen = StringHashMap::<()>::new();
        globs.retain(|glob| !bun_core::handle_oom(seen.get_or_put(glob)).found_existing);
    }
    let expansion = |glob: &Vec<u8>| {
        let mut names: Vec<&[u8]> = Vec::new();
        for name in split_path(glob) {
            let previous = names.last().copied();
            if name == b"**" && previous.is_some_and(|it| it == b"**") {
                continue;
            }
            if name == b".."
                && let Some(previous) = previous
                && !previous.is_empty()
                && !matches!(previous, b".." | b"." | b"**")
            {
                names.pop();
                continue;
            }
            names.push(name);
        }
        if names.is_empty() {
            names.push(b"");
        }
        let parts = names.into_iter().map(|it| read_minimatch::part(it, dot));
        Expansion::new(parts.collect())
    };
    Some(globs.iter().map(expansion).collect())
}

// ───────────────────────────── matching ─────────────────────────────

const MAX_GLOBSTAR_RECURSION: usize = 200;

/// `#matchOne`. `partial`: it is enough that the path matches the start of the pattern.
fn match_plain(file: &[&[u8]], pattern: &[Part], partial: bool, dot: bool) -> bool {
    let common = file.len().min(pattern.len());
    let fits = match (file.len() == common, pattern.len() == common) {
        (true, true) => true,
        (true, false) => partial,
        // `a/*` matches `a/b/`.
        _ => common + 1 == file.len() && file[common].is_empty(),
    };
    // From the end: paths differ less in what they start with.
    fits && (file[..common].iter().zip(&pattern[..common]).rev())
        .all(|(name, part)| part.test(name, dot))
}

/// `#matchGlobStarBodySections`
struct Sections<'a> {
    file: &'a [&'a [u8]],
    /// What is between the `**`, each with the last position at which it is looked for.
    sections: &'a [(&'a [Part], isize)],
    partial: bool,
    dot: bool,
    saw_tail: bool,
    /// Where the last name is that stops a `**`.
    last_stop: Option<usize>,
    /// What `(section, position)` gave. 0: not known. Made when the first `Some(false)` comes back.
    memo: Vec<u8>,
}

impl Sections<'_> {
    /// Every position in `from..to`, which a loop has passed, would have gone the same way from there on.
    fn remember(&mut self, k: usize, from: usize, to: usize, result: Option<bool>) -> Option<bool> {
        let width = self.file.len() + 2;
        if let Some(cells) = self
            .memo
            .get_mut(k * width + from..k * width + to.min(width))
        {
            cells.fill(match result {
                Some(false) => 1,
                Some(true) => 2,
                None => 3,
            });
        }
        result
    }

    /// `None`: no match, and no later position can match either. Recursion: one level for a section, at most `MAX_GLOBSTAR_RECURSION`.
    fn run(&mut self, k: usize, from: usize) -> Option<bool> {
        let (file, width) = (self.file, self.file.len() + 2);
        let Some(&(section, last)) = self.sections.get(k) else {
            return Some(match from < file.len() {
                true => self.last_stop.is_none_or(|it| it < from),
                false => self.saw_tail,
            });
        };
        let mut at = from;
        while at as isize <= last {
            match self.memo.get(k * width + at) {
                None | Some(0) => {}
                Some(known) => {
                    let result = (*known != 3).then_some(*known == 2);
                    return self.remember(k, from, at, result);
                }
            }
            let end = (at + section.len()).min(file.len());
            if match_plain(&file[at.min(end)..end], section, self.partial, self.dot)
                && k < MAX_GLOBSTAR_RECURSION
            {
                let rest = self.run(k + 1, at + section.len());
                if rest != Some(false) {
                    return self.remember(k, from, at + 1, rest);
                }
                if self.memo.is_empty() {
                    self.memo =
                        vec![0; self.sections.len().min(MAX_GLOBSTAR_RECURSION + 1) * width];
                }
            }
            if file.get(at).is_some_and(|name| is_left_out(name, self.dot)) {
                return self.remember(k, from, at + 1, Some(false));
            }
            at += 1;
        }
        self.remember(k, from, at + 1, self.partial.then_some(true))
    }
}

/// `#matchGlobstar`
fn match_globstar(
    candidate: &Candidate<'_>,
    pattern: &[Part],
    (first, last): (usize, usize),
    partial: bool,
    dot: bool,
) -> bool {
    let file = &candidate.names[..];
    let is_globstar = |part: &Part| matches!(part, Part::GlobStar);
    if !partial && first + (pattern.len() - 1 - last) > file.len() {
        return false;
    }
    let (head, body, tail) = match partial {
        true => (&pattern[..first], &pattern[first + 1..], &pattern[..0]),
        false => (
            &pattern[..first],
            &pattern[(first + 1).min(last)..last],
            &pattern[last + 1..],
        ),
    };
    if !head.is_empty() && !match_plain(&file[..head.len().min(file.len())], head, partial, dot) {
        return false;
    }
    let at = head.len();
    let mut tail_len = 0;
    if !tail.is_empty() {
        if tail.len() + at > file.len() {
            return false;
        }
        let start = file.len() - tail.len();
        if match_plain(&file[start..], tail, partial, dot) {
            tail_len = tail.len();
        } else {
            // `a/**/*` matches `a/b/`.
            if file.last().is_some_and(|it| !it.is_empty()) || at + tail.len() == file.len() {
                return false;
            }
            if !match_plain(&file[start - 1..], tail, partial, dot) {
                return false;
            }
            tail_len = tail.len() + 1;
        }
    }
    if body.is_empty() {
        let between = &file[at.min(file.len() - tail_len)..file.len() - tail_len];
        return !between.iter().any(|name| is_left_out(name, dot))
            && (partial || tail_len > 0 || !between.is_empty());
    }
    let sections: SmallVec<[&[Part]; 4]> = body.split(is_globstar).collect();
    // How many parts are before each section.
    let mut before: SmallVec<[usize; 4]> = SmallVec::new();
    let mut count = 0;
    for section in &sections {
        before.push(count);
        count += section.len();
    }
    // The last position at which each section is looked for. minimatch takes the counts in reverse order.
    let file_len = (file.len() - tail_len) as isize;
    let with_last: SmallVec<[(&[Part], isize); 4]> = (sections.iter().zip(before.iter().rev()))
        .map(|(section, before)| (*section, file_len - (before + section.len()) as isize))
        .collect();
    let mut sections = Sections {
        file,
        sections: &with_last,
        partial,
        dot,
        saw_tail: tail_len > 0,
        last_stop: match dot {
            true => candidate.last_dots,
            false => candidate.last_hidden,
        },
        memo: Vec::new(),
    };
    sections.run(0, at) == Some(true)
}

/// Whether one of `set` matches. `partial`: the argument of `match`.
#[inline]
pub(crate) fn matches(set: &[Expansion], path: &Candidate<'_>, partial: bool, dot: bool) -> bool {
    let text = path.text.filter(|_| !partial);
    set.iter().any(|it| {
        text.is_none_or(|text| it.can_match(text)) && it.matches_names(path, partial, dot)
    })
}
