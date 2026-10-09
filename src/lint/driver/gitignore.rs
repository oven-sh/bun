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
    /// Anything else: a pattern for `bun_glob`. What it matches starts with `prefix`. `is_for_names`:
    /// it has no slash, and so is for a name in any directory.
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

/// `pattern` for `bun_glob`, to which a `!` at the start negates and `\n` is a line break. `has_groups`: `{a,b}` is `a` or
/// `b`. Otherwise braces are taken as they are.
fn for_bun_glob(pattern: &[u8], has_groups: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(pattern.len() + 2);
    if pattern.starts_with(b"!") {
        out.push(b'\\');
    }
    let mut rest = pattern;
    while let [byte, after @ ..] = rest {
        rest = after;
        match (byte, after) {
            (b'\\', [escaped, after @ ..]) => {
                if !escaped.is_ascii_alphanumeric() {
                    out.push(b'\\');
                }
                out.push(*escaped);
                rest = after;
                continue;
            }
            (b'{' | b'}', _) if !has_groups => out.push(b'\\'),
            _ => {}
        }
        out.push(*byte);
    }
    out
}

impl Pattern {
    /// `has_groups`: `{a,b}` is `a` or `b`.
    fn new(line: &[u8], has_groups: bool) -> Pattern {
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
                pattern: for_bun_glob(middle, has_groups),
                is_for_names: true,
            },
            _ => Matcher::Pattern {
                prefix: if has_slash(name) {
                    from_here[..strings::index_of_any(from_here, SPECIAL).unwrap_or(0)].to_vec()
                } else {
                    Vec::new()
                },
                pattern: for_bun_glob(from_here, has_groups),
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
            } => bun_glob::r#match(pattern, name).matches(),
            Matcher::Pattern {
                prefix, pattern, ..
            } => path.starts_with(prefix) && bun_glob::r#match(pattern, path).matches(),
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
    /// Upper and lower case are the same. The patterns are in lower case.
    ignores_case: bool,
    above: Option<Arc<Ignores>>,
}

impl Ignores {
    fn new(directory: &[u8], patterns: Vec<Pattern>, ignores_case: bool, above: Chain) -> Ignores {
        let mut ignores = Ignores {
            directory: directory.to_vec(),
            patterns: Vec::new(),
            by_name: FxHashMap::default(),
            by_path: FxHashMap::default(),
            by_extension: FxHashMap::default(),
            others: Vec::new(),
            ignores_case,
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

    /// Whether one of the `..` that `path` starts with is ignored. To the package `ignore` they are directories like any other:
    /// `.*` has them, and so all that is not in the directory of the file.
    fn ignores_a_way_up(&self, path: &[u8]) -> bool {
        let ups = strings::split(path, b"/")
            .take_while(|name| *name == b"..")
            .count();
        (1..=ups).any(|up| {
            path.get(..3 * up - 1)
                .and_then(|above| self.last_match(above, b"..", true))
                .is_some_and(|pattern| !pattern.is_negated)
        })
    }
}

pub(crate) type Chain = Option<Arc<Ignores>>;

/// `chain` and the patterns in `text`, which are relative to `directory`.
///
/// `is_for_oxc`: as oxlint and oxfmt read them: `{a,b}` is `a` or `b`. Otherwise as Prettier does, with the package
/// `ignore`: the braces are taken as they are, and `readme.md` is `README.md` too.
pub(crate) fn with_text(chain: Chain, directory: &[u8], text: &[u8], is_for_oxc: bool) -> Chain {
    // Git, the package `ignore` and the crate `ignore` pass over a byte order mark.
    let lines = strings::split(strings::without_utf8_bom(text), b"\n")
        .map(|line| line.strip_suffix(b"\r").unwrap_or(line));
    let patterns: Vec<Pattern> = lines
        .filter(|line| !line.trim_ascii().is_empty() && !line.starts_with(b"#"))
        .map(|line| match is_for_oxc {
            true => Pattern::new(line, true),
            false => Pattern::new(&line.to_ascii_lowercase(), false),
        })
        .collect();
    if patterns.is_empty() {
        return chain;
    }
    Some(Arc::new(Ignores::new(
        directory,
        patterns,
        !is_for_oxc,
        chain,
    )))
}

/// `chain` and `file`, whose patterns are relative to `directory`.
pub(crate) fn with_file(chain: Chain, directory: &[u8], file: &[u8], is_for_oxc: bool) -> Chain {
    match fs::read(file) {
        Ok(text) => with_text(chain, directory, &text, is_for_oxc),
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
    let is_in_search = false;
    decide(chain, path, is_directory, is_in_search)
}

/// The same for what a search of `bun format` comes to. There oxfmt hands the crate `ignore` a path that is not in the directory
/// of the file as it is: a pattern without a `/` finds the name. About an argument that is not in the directory it does not ask.
pub(crate) fn is_ignored_in_search(chain: &Chain, path: &[u8], is_directory: bool) -> bool {
    let is_in_search = true;
    decide(chain, path, is_directory, is_in_search)
}

fn is_at_or_above(outer: &[u8], inner: &[u8]) -> bool {
    outer == inner || paths::inside(outer, inner).is_some()
}

fn decide(chain: &Chain, path: &[u8], is_directory: bool, is_in_search: bool) -> bool {
    let mut next = chain.as_ref();
    while let Some(ignores) = next {
        let directory = &ignores.directory[..];
        let from_outside;
        let inside = match paths::inside(directory, path) {
            Some(inside) => Some(inside),
            // No pattern is about the directory of the file, or about one that it is in.
            None if is_at_or_above(path, directory) => None,
            // Prettier asks the package `ignore` about `../src/a.js`, in which a pattern without a `/` finds the name.
            None if ignores.ignores_case => {
                from_outside = paths::relative(directory, path);
                if ignores.ignores_a_way_up(&from_outside) {
                    return true;
                }
                Some(&from_outside[..])
            }
            None if is_in_search => Some(path),
            None => None,
        };
        if let Some(inside) = inside {
            let name = paths::basename(inside);
            let in_lower_case;
            let (inside, name) =
                match ignores.ignores_case && inside.iter().any(u8::is_ascii_uppercase) {
                    true => {
                        in_lower_case = inside.to_ascii_lowercase();
                        (&in_lower_case[..], paths::basename(&in_lower_case))
                    }
                    false => (inside, name),
                };
            if let Some(pattern) = ignores.last_match(inside, name, is_directory) {
                return !pattern.is_negated;
            }
        }
        next = ignores.above.as_ref();
    }
    false
}

/// Whether the directory at `path` is ignored, or one that it is in.
pub(crate) fn is_directory_ignored_anywhere(chain: &Chain, path: &[u8]) -> bool {
    let directories: Vec<&[u8]> = paths::ancestors(path).collect();
    directories
        .iter()
        .rev()
        .any(|directory| is_ignored(chain, directory, true))
}

/// Whether the file at `path` is ignored, or a directory that it is in: for a file that was not
/// come to by way of its directories.
pub(crate) fn is_file_ignored_anywhere(chain: &Chain, path: &[u8]) -> bool {
    is_directory_ignored_anywhere(chain, paths::dirname(path)) || is_ignored(chain, path, false)
}
