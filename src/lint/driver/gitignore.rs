//! `.gitignore` and the files in its format. ESLint does not read them. oxlint does, so they count
//! where an `.oxlintrc.json` is the configuration, and where there is none. Prettier reads those of
//! the working directory.

use crate::{fs, paths};
use bun_core::strings;
use bun_sema::util::FxHashMap;
use std::sync::Arc;

enum Matcher {
    /// `name`, `name/`, `**/name`: whatever is called so, in any directory.
    Name(Vec<u8>),
    /// `*.ext`, `**/*.ext`: whatever ends so, in any directory.
    Suffix(Vec<u8>),
    /// `/name`, `a/b/name`: what is there, from the directory of the file.
    Path(Vec<u8>),
    /// `a/b/**`: what is in that directory. With the `/` behind it.
    Inside(Vec<u8>),
    /// `**/a/b`: what is there, from any directory. With a `/` before it.
    PathAnywhere(Vec<u8>),
    /// `**/a/b/**`: what is in such a directory. With a `/` before and behind it.
    InsideAnywhere(Vec<u8>),
    /// Anything else. What it matches starts with `prefix`. `is_for_names`: it has no slash, and so
    /// is for a name in any directory.
    Pattern {
        prefix: Vec<u8>,
        pattern: Vec<u8>,
        is_for_names: bool,
    },
}

struct Pattern {
    matcher: Matcher,
    /// It starts with `!`: what it matches is not ignored after all.
    is_negated: bool,
    /// It ends with `/`.
    is_for_directories: bool,
}

/// Whether the class that `pattern` starts with, behind its `[`, has `byte`, and what follows the
/// class. `None`: it is not closed.
fn class(pattern: &[u8], byte: u8) -> Option<(bool, &[u8])> {
    let (is_negated, mut rest) = match pattern {
        [b'!' | b'^', rest @ ..] => (true, rest),
        rest => (false, rest),
    };
    let (mut has, mut is_first) = (false, true);
    loop {
        rest = match rest {
            [b']', rest @ ..] if !is_first => return Some((has != is_negated, rest)),
            [b'\\', from, b'-', to, rest @ ..] | [from, b'-', to, rest @ ..] if *to != b']' => {
                has |= (*from..=*to).contains(&byte);
                rest
            }
            [b'\\', one, rest @ ..] | [one, rest @ ..] => {
                has |= *one == byte;
                rest
            }
            [] => return None,
        };
        is_first = false;
    }
}

/// Git's `wildmatch` with `WM_PATHNAME`: `*` and `?` stop at a `/`, `**` as a whole part of the
/// path does not. `stars`: how many more may be tried.
fn wildmatch(mut pattern: &[u8], mut text: &[u8], mut starts_part: bool, stars: u32) -> bool {
    loop {
        (pattern, text) = match (pattern, text) {
            ([], text) => return text.is_empty(),
            ([b'*', ..], _) if stars == 0 => return false,
            // No directory, or any number of them.
            ([b'*', b'*', b'/', rest @ ..], text) if starts_part => {
                let mut from = Some(text);
                while let Some(text) = from {
                    if wildmatch(rest, text, true, stars - 1) {
                        return true;
                    }
                    from = strings::index_of_char_usize(text, b'/').map(|slash| &text[slash + 1..]);
                }
                return false;
            }
            // Everything in the directory.
            ([b'*', b'*'], text) if starts_part => return !text.is_empty(),
            ([b'*', rest @ ..], text) => {
                let part = strings::index_of_char_usize(text, b'/').unwrap_or(text.len());
                return (0..=part)
                    .any(|skipped| wildmatch(rest, &text[skipped..], false, stars - 1));
            }
            ([b'?', pattern @ ..], [byte, text @ ..]) if *byte != b'/' => {
                starts_part = false;
                (pattern, text)
            }
            ([b'[', inside @ ..], [byte, text @ ..]) if *byte != b'/' => match class(inside, *byte)
            {
                Some((true, pattern)) => {
                    starts_part = false;
                    (pattern, text)
                }
                _ => return false,
            },
            ([b'\\', wanted, pattern @ ..], [byte, text @ ..])
            | ([wanted, pattern @ ..], [byte, text @ ..])
                if wanted == byte =>
            {
                starts_part = *byte == b'/';
                (pattern, text)
            }
            _ => return false,
        };
    }
}

impl Pattern {
    fn new(line: &[u8]) -> Pattern {
        let (is_negated, pattern) = match line.strip_prefix(b"!") {
            Some(rest) => (true, rest),
            None => (false, line),
        };
        let pattern = pattern.trim_ascii_end();
        let name = pattern.strip_suffix(b"/").unwrap_or(pattern);
        const SPECIAL: &[u8] = b"*?[]\\{}()!";
        let is_literal =
            |text: &[u8]| !text.is_empty() && strings::index_of_any(text, SPECIAL).is_none();
        let has_slash = |text: &[u8]| strings::contains_char(text, b'/');
        let from_here = name.strip_prefix(b"/").unwrap_or(name);
        // Without `**/` in front and `/**` behind.
        let (is_anywhere, middle) = from_here
            .strip_prefix(b"**/")
            .map_or_else(|| (!has_slash(name), from_here), |rest| (true, rest));
        let (is_inside, middle) = middle
            .strip_suffix(b"/**")
            .map_or((false, middle), |rest| (true, rest));
        let matcher = match (is_anywhere, is_inside, middle) {
            (true, false, middle) if is_literal(middle) && !has_slash(middle) => {
                Matcher::Name(middle.to_vec())
            }
            (true, false, [b'*', suffix @ ..]) if is_literal(suffix) && !has_slash(suffix) => {
                Matcher::Suffix(suffix.to_vec())
            }
            (true, false, middle) if is_literal(middle) => {
                Matcher::PathAnywhere([b"/", middle].concat())
            }
            (true, true, middle) if is_literal(middle) => {
                Matcher::InsideAnywhere([b"/", middle, b"/"].concat())
            }
            (false, false, middle) if is_literal(middle) => Matcher::Path(middle.to_vec()),
            (false, true, middle) if is_literal(middle) => Matcher::Inside([middle, b"/"].concat()),
            // `**/a*` is `a*`.
            (true, false, middle) if !has_slash(middle) => Matcher::Pattern {
                prefix: Vec::new(),
                pattern: middle.to_vec(),
                is_for_names: true,
            },
            _ => Matcher::Pattern {
                prefix: if has_slash(name) {
                    from_here[..strings::index_of_any(from_here, SPECIAL).unwrap_or(0)].to_vec()
                } else {
                    Vec::new()
                },
                pattern: from_here.to_vec(),
                is_for_names: !has_slash(name),
            },
        };
        Pattern {
            matcher,
            is_negated,
            is_for_directories: name.len() < pattern.len(),
        }
    }

    /// `path`: from the directory of the file that has the pattern. `name`: the last part of it.
    fn matches(&self, path: &[u8], name: &[u8], is_directory: bool) -> bool {
        match &self.matcher {
            _ if self.is_for_directories && !is_directory => false,
            Matcher::Name(wanted) => name == &wanted[..],
            Matcher::Suffix(suffix) => name.ends_with(suffix),
            Matcher::Path(wanted) => path == &wanted[..],
            Matcher::Inside(directory) => path.starts_with(directory),
            Matcher::PathAnywhere(wanted) => path.ends_with(wanted) || path == &wanted[1..],
            Matcher::InsideAnywhere(directory) => {
                path.starts_with(&directory[1..]) || strings::contains(path, directory)
            }
            Matcher::Pattern {
                pattern,
                is_for_names: true,
                ..
            } => wildmatch(pattern, name, true, 64),
            Matcher::Pattern {
                prefix, pattern, ..
            } => path.starts_with(prefix) && wildmatch(pattern, path, true, 64),
        }
    }
}

/// The ignore files that count in a directory: those in it, and those above it.
pub(crate) struct Ignores {
    /// What the patterns are relative to.
    directory: Vec<u8>,
    patterns: Vec<Pattern>,
    /// Where in `patterns` those are that are looked up and not tried: the names, the paths from
    /// the directory, and `*.ext` by `ext`. The first first.
    by_name: FxHashMap<Vec<u8>, Vec<u32>>,
    by_path: FxHashMap<Vec<u8>, Vec<u32>>,
    by_extension: FxHashMap<Vec<u8>, Vec<u32>>,
    /// Where the others are.
    others: Vec<u32>,
    above: Option<Arc<Ignores>>,
}

impl Ignores {
    fn new(directory: &[u8], patterns: Vec<Pattern>, above: Chain) -> Ignores {
        let mut ignores = Ignores {
            directory: directory.to_vec(),
            patterns: Vec::new(),
            by_name: FxHashMap::default(),
            by_path: FxHashMap::default(),
            by_extension: FxHashMap::default(),
            others: Vec::new(),
            above,
        };
        for (at, pattern) in patterns.iter().enumerate() {
            let at = at as u32;
            match &pattern.matcher {
                Matcher::Name(name) => ignores.by_name.entry(name.clone()).or_default().push(at),
                Matcher::Path(path) => ignores.by_path.entry(path.clone()).or_default().push(at),
                Matcher::Suffix(suffix) => match &suffix[..] {
                    [b'.', extension @ ..] if !strings::contains_char(extension, b'.') => {
                        ignores
                            .by_extension
                            .entry(extension.to_vec())
                            .or_default()
                            .push(at);
                    }
                    _ => ignores.others.push(at),
                },
                _ => ignores.others.push(at),
            }
        }
        ignores.patterns = patterns;
        ignores
    }

    /// The last pattern that matches, which decides. `path`: from the directory. `name`: the last
    /// part of it.
    fn last_match(&self, path: &[u8], name: &[u8], is_directory: bool) -> Option<&Pattern> {
        let last = |found: Option<&Vec<u32>>| {
            let applies = |at: &&u32| {
                is_directory
                    || self
                        .patterns
                        .get(**at as usize)
                        .is_some_and(|it| !it.is_for_directories)
            };
            found
                .and_then(|all| all.iter().rev().find(applies))
                .copied()
        };
        let extension = strings::last_index_of_char(name, b'.').map(|dot| &name[dot + 1..]);
        let mut best = last(self.by_name.get(name))
            .max(last(self.by_path.get(path)))
            .max(extension.and_then(|it| last(self.by_extension.get(it))));
        // Those before the best so far say nothing.
        let later = self.others.iter().rev().take_while(|at| Some(**at) > best);
        if let Some(at) = later.copied().find(|at| {
            self.patterns
                .get(*at as usize)
                .is_some_and(|it| it.matches(path, name, is_directory))
        }) {
            best = Some(at);
        }
        self.patterns.get(best? as usize)
    }
}

pub(crate) type Chain = Option<Arc<Ignores>>;

/// Adds `pattern` with each `{a,b}` in it replaced by one of `a` and `b`, in all ways.
fn expand_braces(pattern: &[u8], into: &mut Vec<Vec<u8>>) {
    let open = strings::index_of_char_usize(pattern, b'{')
        .filter(|&at| at == 0 || pattern[at - 1] != b'\\');
    let close =
        open.and_then(|open| Some(open + strings::index_of_char_usize(&pattern[open..], b'}')?));
    let (Some(open), Some(close), true) = (open, close, into.len() < 256) else {
        into.push(pattern.to_vec());
        return;
    };
    for alternative in strings::split(&pattern[open + 1..close], b",") {
        expand_braces(
            &[&pattern[..open], alternative, &pattern[close + 1..]].concat(),
            into,
        );
    }
}

/// `chain` and the patterns in `text`, which are relative to `directory`. `expands_braces`: `{a,b}`
/// is `a` or `b`, as for oxlint and oxfmt. Git and Prettier take the braces as they are.
pub(crate) fn with_text(
    chain: Chain,
    directory: &[u8],
    text: &[u8],
    expands_braces: bool,
) -> Chain {
    let lines = strings::split(text, b"\n").map(|line| line.strip_suffix(b"\r").unwrap_or(line));
    let mut patterns: Vec<Pattern> = Vec::new();
    for line in lines.filter(|line| !line.trim_ascii().is_empty() && !line.starts_with(b"#")) {
        // The last pattern that matches decides, so one after the other is one or the other.
        if expands_braces && strings::contains_char(line, b'{') {
            let mut expanded = Vec::new();
            expand_braces(line, &mut expanded);
            patterns.extend(expanded.iter().map(|it| Pattern::new(it)));
        } else {
            patterns.push(Pattern::new(line));
        }
    }
    if patterns.is_empty() {
        return chain;
    }
    Some(Arc::new(Ignores::new(directory, patterns, chain)))
}

/// `chain` and the file at `path`, whose patterns are relative to `directory`.
pub(crate) fn with_file(
    chain: Chain,
    directory: &[u8],
    path: &[u8],
    expands_braces: bool,
) -> Chain {
    match fs::read(path) {
        Ok(text) => with_text(chain, directory, &text, expands_braces),
        Err(_) => chain,
    }
}

/// What counts in `directory`, which is where a search starts: the files in it and above it, up to
/// the root of the repository. `names`: what they are called, the one that overrides the other
/// last.
pub(crate) fn above_and_in(directory: &[u8], names: &[&[u8]]) -> Chain {
    let is_root = |directory: &&[u8]| {
        [&b".git"[..], b".jj"]
            .iter()
            .any(|name| bun_sys::exists(&paths::join(directory, name)))
    };
    let mut directories: Vec<&[u8]> = paths::ancestors(directory).collect();
    // Outside of a repository, all the way up.
    if let Some(root) = directories.iter().position(is_root) {
        directories.truncate(root + 1);
    }
    let mut chain = None;
    if let Some(root) = directories.last() {
        chain = with_file(chain, root, &paths::join(root, b".git/info/exclude"), true);
    }
    for directory in directories.iter().rev() {
        for name in names {
            chain = with_file(chain, directory, &paths::join(directory, name), true);
        }
    }
    chain
}

/// Whether `path` is ignored, if the directory that it is in is not. The nearest file that says
/// anything about it decides, and in that file the last pattern.
pub(crate) fn is_ignored(chain: &Chain, path: &[u8], is_directory: bool) -> bool {
    let mut next = chain.as_ref();
    let name = paths::basename(path);
    while let Some(ignores) = next {
        if let Some(pattern) = paths::inside(&ignores.directory, path)
            .and_then(|inside| ignores.last_match(inside, name, is_directory))
        {
            return !pattern.is_negated;
        }
        next = ignores.above.as_ref();
    }
    false
}

/// Whether the file at `path` is ignored, or a directory that it is in: for a file that was not
/// come to by way of its directories.
pub(crate) fn is_file_ignored_anywhere(chain: &Chain, path: &[u8]) -> bool {
    let directories: Vec<&[u8]> = paths::ancestors(paths::dirname(path)).collect();
    directories
        .iter()
        .rev()
        .any(|directory| is_ignored(chain, directory, true))
        || is_ignored(chain, path, false)
}
