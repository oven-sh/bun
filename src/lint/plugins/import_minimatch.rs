//! How the rules of eslint-plugin-import ask whether a pattern matches: what minimatch does around a pattern, which is Bun's.

use bun_core::strings;
use bun_glob::Pattern;
use bun_lint::options::{Json, Object};
use bun_lint::paths;
use std::borrow::Cow;
use std::sync::OnceLock;

/// The options that are not about the syntax, `dot` and `noext`.
#[derive(Copy, Clone, Default)]
struct Asked {
    dot: bool,
    nocomment: bool,
    nonegate: bool,
    flip_negate: bool,
    match_base: bool,
    nocase: bool,
    noext: bool,
}

/// `new Minimatch(pattern, options)`
pub(crate) struct Glob {
    /// Without the `!` at its start. `None`: a comment, which matches nothing.
    pattern: Option<Pattern>,
    is_negated: bool,
    /// `matchBase`, and it has no `/`: it is for the last name.
    is_for_name: bool,
    /// `nocase`: it is in lower case.
    folds_case: bool,
}

impl Glob {
    fn with(written: &[u8], asked: Asked) -> Glob {
        // Where `\` separates the names of a path, it does so in a pattern.
        let mut written = paths::from_native(strings::trim_js_whitespace(written));
        if asked.nocase {
            written.make_ascii_lowercase();
        }
        let bangs = match asked.nonegate {
            true => 0,
            false => written.iter().take_while(|it| **it == b'!').count(),
        };
        let text = match written.starts_with(b"!") && asked.nonegate {
            true => Cow::Owned([b"\\", &written[..]].concat()),
            false => Cow::Borrowed(&written[bangs..]),
        };
        let read = || match (asked.noext, asked.dot) {
            (true, _) => Pattern::new(&text),
            (false, true) => Pattern::with_extglob(&text),
            (false, false) => Pattern::without_dot(&text),
        };
        Glob {
            pattern: (asked.nocomment || !written.starts_with(b"#")).then(read),
            is_negated: bangs % 2 == 1 && !asked.flip_negate,
            is_for_name: asked.match_base && !strings::contains_char(&text, b'/'),
            folds_case: asked.nocase,
        }
    }

    /// `minimatch(path, pattern)`
    pub(crate) fn new(pattern: &[u8]) -> Glob {
        Glob::with(pattern, Asked::default())
    }

    /// `minimatch(path, pattern, patternOptions || { nocomment: true })` for an element of `pathGroups`.
    pub(crate) fn of_path_group(group: Object) -> Glob {
        let options = group.object("patternOptions");
        let is_set = |key: &str| options.get(key).is_some_and(Json::is_truthy);
        let asked = Asked {
            dot: is_set("dot"),
            nocomment: !group.has("patternOptions") || is_set("nocomment"),
            nonegate: is_set("nonegate"),
            flip_negate: is_set("flipNegate"),
            match_base: is_set("matchBase"),
            nocase: is_set("nocase"),
            noext: is_set("noext"),
        };
        Glob::with(group.str("pattern").unwrap_or_default().as_bytes(), asked)
    }

    /// `minimatch(path, pattern, { matchBase: true })`
    pub(crate) fn matching_base(pattern: &[u8]) -> Glob {
        let match_base = true;
        Glob::with(
            pattern,
            Asked {
                match_base,
                ..Asked::default()
            },
        )
    }

    /// `match`. `path` is separated by `/`.
    pub(crate) fn matches(&self, path: &[u8]) -> bool {
        let Some(pattern) = &self.pattern else {
            return false;
        };
        let path = match self.folds_case {
            true => Cow::Owned(path.to_ascii_lowercase()),
            false => Cow::Borrowed(path),
        };
        // `a` matches `a/`.
        let without_slash = path.strip_suffix(b"/");
        let hit = match self.is_for_name {
            true => pattern.matches(paths::file_name(&path)),
            false => pattern.matches(&path) || without_slash.is_some_and(|it| pattern.matches(it)),
        };
        hit != self.is_negated
    }
}

/// `globs.some((glob) => minimatch(path, glob) || minimatch(path, join(process.cwd(), glob)))`
pub(crate) struct GlobsFromCwd {
    written: Vec<Box<[u8]>>,
    /// Each as it is written, and in the working directory. All files of a run have the same working directory.
    read: OnceLock<Vec<[Glob; 2]>>,
}

impl GlobsFromCwd {
    pub(crate) fn new(written: &[&str]) -> GlobsFromCwd {
        GlobsFromCwd {
            written: written.iter().map(|it| it.as_bytes().into()).collect(),
            read: OnceLock::new(),
        }
    }

    /// `path` is separated by `/`.
    pub(crate) fn matches(&self, cwd: &[u8], path: &[u8]) -> bool {
        let join = paths::join_normalized;
        let both = |it: &[u8]| {
            [
                Glob::new(&paths::portable(cwd, it)),
                Glob::new(&join(cwd, it)),
            ]
        };
        let all = || self.written.iter().map(|it| both(it)).collect::<Vec<_>>();
        let mut globs = self.read.get_or_init(all).iter().flatten();
        globs.any(|it| it.matches(path))
    }
}
