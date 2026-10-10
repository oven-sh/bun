//! A pattern that has been read, in the syntax of Bun or of another tool.

use crate::matcher;
use crate::node::Program;
use crate::read_minimatch3;
use crate::read_picomatch;
use crate::segments::{self, Expansion};
use crate::unit::Subject;
use bun_core::strings;

pub use crate::segments::Candidate;

/// Whose patterns these are.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Syntax {
    /// [`crate::match`]: `Bun.Glob`, and `glob_match` of the crate `fast-glob`.
    Bun,
    /// minimatch 10.2.6.
    Minimatch,
    /// picomatch 2.3.2, which micromatch 4.0.8 and fast-glob 3.3.3 call.
    Picomatch,
    /// minimatch 3.1.5: `.*` takes `.` and `..`, `a/../b` is not folded, the pattern is trimmed.
    Minimatch3,
    /// `makeRe(pattern).test(path)` of minimatch 3.1.5: nothing is cut at a `/`, and a `**` keeps the `/` behind it.
    Minimatch3MakeRe,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Options {
    pub syntax: Syntax,
    /// `dot`: `*`, `?`, `**` and a class take a `.` at the start of a name. `Syntax::Bun` does not read it: there they do.
    pub dot: bool,
    /// `posix: true` of picomatch: `[!a]` is `[^a]`.
    pub posix: bool,
    /// Braces are expanded before the pattern is read, as fast-glob does. minimatch always does.
    pub expands_braces_first: bool,
}

impl Options {
    /// `bun_glob::match(pattern, path)`.
    pub const BUN: Options = Options {
        syntax: Syntax::Bun,
        dot: true,
        posix: false,
        expands_braces_first: false,
    };
    /// `new Minimatch(pattern, { dot: true })`: @eslint/config-array, the command line of ESLint, `.editorconfig`.
    pub const MINIMATCH_DOT: Options = Options {
        syntax: Syntax::Minimatch,
        dot: true,
        posix: false,
        expands_braces_first: true,
    };
    /// `minimatch(path, pattern)`: @trivago/prettier-plugin-sort-imports.
    pub const MINIMATCH: Options = Options {
        dot: false,
        ..Options::MINIMATCH_DOT
    };
    /// `minimatch(path, pattern, { dot: true })` of 3.1.5: eslint-plugin-import.
    pub const MINIMATCH_3_DOT: Options = Options {
        syntax: Syntax::Minimatch3,
        ..Options::MINIMATCH_DOT
    };
    /// `minimatch(path, pattern)` of 3.1.5: eslint-plugin-import.
    pub const MINIMATCH_3: Options = Options {
        dot: false,
        ..Options::MINIMATCH_3_DOT
    };
    /// `minimatch.makeRe(pattern).test(path)`: import/no-internal-modules.
    pub const MINIMATCH_3_MAKE_RE: Options = Options {
        syntax: Syntax::Minimatch3MakeRe,
        ..Options::MINIMATCH
    };
    /// `micromatch.isMatch(path, pattern, { dot: true })`: `overrides` of Prettier.
    pub const MICROMATCH_DOT: Options = Options {
        syntax: Syntax::Picomatch,
        dot: true,
        posix: false,
        expands_braces_first: false,
    };
    /// What fast-glob makes of a pattern with `{ dot: true }`: the command line of Prettier.
    pub const FAST_GLOB_DOT: Options = Options {
        posix: true,
        expands_braces_first: true,
        ..Options::MICROMATCH_DOT
    };
}

/// How a path is matched.
#[derive(Copy, Clone, Default, PartialEq, Eq, Debug)]
pub struct How {
    /// `flipNegate` of minimatch: a `!` at the start of the pattern is left out of the answer.
    pub flip_negate: bool,
    /// `match(path, true)` of minimatch: something in the directory `path` can match. Never `false` where the reference says `true`.
    pub partial: bool,
}

/// A pattern of picomatch, without braces if they are expanded first.
struct Alternative {
    written: Box<[u8]>,
    program: Program,
    is_negated: bool,
}

enum Kind {
    /// It can match nothing: a comment of minimatch, too long, too complex.
    Never,
    /// The empty pattern of minimatch, which matches the empty path.
    Empty,
    /// There is no second reading of Bun's syntax: it is `matcher::match`, behind two filters.
    Bun {
        pattern: Box<[u8]>,
        /// The names at the start that are without magic, joined by slashes: what matches starts with them.
        head: Box<[u8]>,
        /// What matches ends with.
        tail: Box<[u8]>,
    },
    /// One for each expansion of the braces, and the option `dot`.
    Minimatch(Vec<Expansion>, bool),
    /// `is_asked_directly`: as fast-glob asks the expressions themselves, without what `picomatch.test` puts before them.
    Picomatch {
        alternatives: Vec<Alternative>,
        is_asked_directly: bool,
    },
}

/// A pattern that has been read. `Send + Sync`. Matching allocates only for a group on a long path.
pub struct Pattern {
    kind: Kind,
    /// An odd number of `!` at its start.
    is_negated: bool,
}

/// minimatch and picomatch throw beyond it. They count UTF-16 units.
const MAX_PATTERN_LENGTH: usize = 65_536;

fn bun(pattern: &[u8]) -> Pattern {
    let bangs = pattern.iter().take_while(|b| **b == b'!').count();
    let head = match strings::index_of_any(pattern, b"*?[{\\") {
        _ if bangs > 0 => &b""[..],
        None => pattern,
        Some(magic) => {
            &pattern[..strings::last_index_of_char(&pattern[..magic], b'/').unwrap_or(0)]
        }
    };
    // What is behind a group can be part of one that is not closed. `**/` can be nothing.
    let tail = match strings::index_of_any(pattern, b"{}\\") {
        None if bangs == 0 => {
            let tail =
                &pattern[strings::last_index_of_any(pattern, b"*?]").map_or(0, |at| at + 1)..];
            tail.strip_prefix(b"/").unwrap_or(tail)
        }
        _ => &b""[..],
    };
    Pattern {
        kind: Kind::Bun {
            pattern: pattern.into(),
            head: head.into(),
            tail: tail.into(),
        },
        is_negated: bangs % 2 == 1,
    }
}

impl Pattern {
    /// Never fails. What the reference refuses, or what is beyond a limit, matches nothing.
    pub fn new(pattern: &[u8], options: Options) -> Pattern {
        let of = |kind: Kind| Pattern {
            kind,
            is_negated: false,
        };
        let pattern = match options.syntax {
            Syntax::Minimatch3 => strings::trim_js_whitespace(pattern),
            _ => pattern,
        };
        match options.syntax {
            Syntax::Bun => bun(pattern),
            _ if pattern.len() > MAX_PATTERN_LENGTH => of(Kind::Never),
            Syntax::Minimatch | Syntax::Minimatch3 if pattern.starts_with(b"#") => of(Kind::Never),
            Syntax::Minimatch | Syntax::Minimatch3 if pattern.is_empty() => of(Kind::Empty),
            Syntax::Minimatch | Syntax::Minimatch3 => {
                let bangs = pattern.iter().take_while(|b| **b == b'!').count();
                Pattern {
                    kind: match segments::read(&pattern[bangs..], options) {
                        Some(set) => Kind::Minimatch(set, options.dot),
                        None => Kind::Never,
                    },
                    is_negated: bangs % 2 == 1,
                }
            }
            // The `!` is in the expression.
            Syntax::Minimatch3MakeRe => of(Kind::Picomatch {
                alternatives: vec![Alternative {
                    written: Box::default(),
                    program: read_minimatch3::pattern(pattern, options.dot),
                    is_negated: false,
                }],
                is_asked_directly: true,
            }),
            // picomatch throws for the empty pattern.
            Syntax::Picomatch if pattern.is_empty() => of(Kind::Never),
            Syntax::Picomatch => {
                let written = match options.expands_braces_first {
                    true => read_picomatch::expand_for_fast_glob(pattern),
                    false => vec![pattern.to_vec()],
                };
                let alternative = |written: Vec<u8>| {
                    let (program, is_negated) =
                        read_picomatch::pattern(&written, options.dot, options.posix);
                    Alternative {
                        written: written.into(),
                        program,
                        is_negated,
                    }
                };
                let alternatives: Vec<Alternative> = written.into_iter().map(alternative).collect();
                Pattern {
                    is_negated: matches!(&alternatives[..], [only] if only.is_negated),
                    kind: Kind::Picomatch {
                        alternatives,
                        is_asked_directly: options.expands_braces_first,
                    },
                }
            }
        }
    }

    /// `GlobSet::new` of oxc for one element: `./` is dropped, a pattern without `/` is for a name in any directory.
    pub fn of_oxc_glob_set(written: &[u8]) -> Pattern {
        match written.strip_prefix(b"./") {
            Some(rest) => bun(rest),
            None if strings::contains_char(written, b'/') => bun(written),
            None => bun(&[b"**/", written].concat()),
        }
    }

    /// `path` is separated by `/`.
    pub fn matches(&self, path: &[u8]) -> bool {
        self.matches_with(path, How::default())
    }

    /// `matches` with the option `matchBase` of minimatch.
    pub fn matches_base(&self, path: &[u8]) -> bool {
        match &self.kind {
            Kind::Minimatch(set, dot) => {
                segments::matches_base(set, &Candidate::new(path), *dot) != self.is_negated
            }
            _ => self.matches(path),
        }
    }

    pub fn matches_with(&self, path: &[u8], how: How) -> bool {
        match &self.kind {
            // `match("/", true)`
            Kind::Minimatch(..) if how.partial && path == b"/" => true,
            Kind::Minimatch(..) | Kind::Empty => self.matches_candidate(&Candidate::new(path), how),
            _ => self.matches_path(path, how),
        }
    }

    #[inline]
    pub fn matches_candidate(&self, path: &Candidate<'_>, how: How) -> bool {
        match &self.kind {
            Kind::Empty => path.path().is_empty(),
            Kind::Minimatch(set, dot) => {
                let hit = segments::matches(set, path, how.partial, *dot);
                hit != (self.is_negated && !how.flip_negate)
            }
            _ => self.matches_path(path.path(), how),
        }
    }

    /// For a syntax that does not split the path.
    fn matches_path(&self, path: &[u8], how: How) -> bool {
        match &self.kind {
            // It does not say what can match in a directory, so anything can.
            Kind::Bun { .. } if how.partial => true,
            Kind::Bun { pattern, tail, .. } => {
                if !path.ends_with(tail) {
                    return false;
                }
                let result = matcher::r#match(pattern, path);
                result.matches() != (how.flip_negate && result.is_negated())
            }
            Kind::Picomatch { alternatives, .. } if how.partial => {
                let directory = Subject {
                    bytes: path,
                    slash: !path.is_empty() && !path.ends_with(b"/"),
                };
                alternatives
                    .iter()
                    .any(|it| it.is_negated || it.program.may_match_inside(directory))
            }
            // `picomatch.test`: the empty path matches nothing.
            Kind::Picomatch {
                is_asked_directly: false,
                ..
            } if path.is_empty() => false,
            Kind::Picomatch {
                alternatives,
                is_asked_directly,
            } => alternatives.iter().any(|it| {
                // `picomatch.test`: a path that is the pattern, letter for letter, matches, whatever the pattern means.
                if !is_asked_directly && path == &it.written[..] {
                    return true;
                }
                let hit = it.program.matches(Subject::of(path));
                match it.is_negated && !how.flip_negate {
                    // `^(?!^(?:..)$).*$`: `.` takes no line terminator.
                    true => !hit && !strings::contains_js_line_break(path),
                    false => hit,
                }
            }),
            Kind::Never | Kind::Empty | Kind::Minimatch(..) => false,
        }
    }

    /// `matches_with(directory, How { partial: true, flip_negate: false })`.
    pub fn may_match_inside(&self, directory: &[u8]) -> bool {
        self.matches_with(
            directory,
            How {
                partial: true,
                flip_negate: false,
            },
        )
    }

    /// What a path that matches starts with, up to a `/` or to its end: one of these. `None`: the pattern does not say.
    pub fn heads(&self) -> Option<Vec<&[u8]>> {
        let heads: Vec<&[u8]> = match &self.kind {
            _ if self.is_negated => return None,
            Kind::Bun { head, .. } => vec![&head[..]],
            Kind::Minimatch(set, _) => set.iter().map(Expansion::head).collect(),
            _ => return None,
        };
        heads.iter().all(|it| !it.is_empty()).then_some(heads)
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum UnclosedKind {
    Class,
    Braces,
    /// A `\` as the last byte.
    Escape,
}

/// What starts at byte `at` is not closed.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Unclosed {
    pub kind: UnclosedKind,
    pub at: usize,
}

/// `validate` of the crate `fast-glob` 1.1.1, with which oxlint and oxfmt refuse a pattern.
pub fn unclosed(pattern: &[u8]) -> Option<Unclosed> {
    // How many groups are open, and where the outermost of them starts.
    let (mut depth, mut outermost) = (0_usize, 0);
    let mut at = 0;
    while let Some(&byte) = pattern.get(at) {
        match byte {
            b'\\' if at + 1 == pattern.len() => {
                let kind = UnclosedKind::Escape;
                return Some(Unclosed { kind, at });
            }
            b'\\' => at += 1,
            b'[' => {
                let mut end = at + 1;
                end += usize::from(matches!(pattern.get(end), Some(b'!' | b'^')));
                // Here it is a character of the class.
                end += usize::from(pattern.get(end) == Some(&b']'));
                loop {
                    match pattern.get(end) {
                        None => {
                            let kind = UnclosedKind::Class;
                            return Some(Unclosed { kind, at });
                        }
                        Some(b']') => break,
                        Some(b'\\') => end += 2,
                        Some(_) => end += 1,
                    }
                }
                at = end;
            }
            b'{' => {
                if depth == 0 {
                    outermost = at;
                }
                depth += 1;
            }
            b'}' => depth = depth.saturating_sub(1),
            _ => {}
        }
        at += 1;
    }
    (depth > 0).then_some(Unclosed {
        kind: UnclosedKind::Braces,
        at: outermost,
    })
}
