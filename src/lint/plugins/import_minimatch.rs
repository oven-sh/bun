//! minimatch as eslint-plugin-import's rules call it.

use bun_glob::scan::is_glob;
use bun_lint::ast::File;
use bun_lint::glob::{Minimatch, MinimatchOptions, Under};
use bun_lint::options::{Json, Object};
use bun_lint::paths;
use std::sync::OnceLock;

/// `new Minimatch(pattern, options)`
pub(crate) struct Glob(Minimatch);

impl Glob {
    /// `minimatch(path, pattern)`
    pub(crate) fn new(pattern: &[u8]) -> Glob {
        Glob(Minimatch::new(pattern))
    }

    /// `minimatch(path, pattern, patternOptions || { nocomment: true })` for an element of `pathGroups`.
    pub(crate) fn for_path_group(group: Object) -> Glob {
        let options = group.object("patternOptions");
        let is_set = |key: &str| options.get(key).is_some_and(Json::is_truthy);
        let options = MinimatchOptions {
            dot: is_set("dot"),
            nocomment: !group.has("patternOptions") || is_set("nocomment"),
            nonegate: is_set("nonegate"),
            flip_negate: is_set("flipNegate"),
            match_base: is_set("matchBase"),
            nocase: is_set("nocase"),
            noext: is_set("noext"),
            is_version_3: true,
        };
        let pattern = group.str("pattern").unwrap_or_default();
        Glob(Minimatch::with(pattern.as_bytes(), options))
    }

    /// `minimatch(path, pattern, { matchBase: true })`
    pub(crate) fn matching_base(pattern: &[u8]) -> Glob {
        let options = MinimatchOptions {
            match_base: true,
            is_version_3: true,
            ..MinimatchOptions::default()
        };
        Glob(Minimatch::with(pattern, options))
    }

    /// `path` uses `/` as its separator.
    pub(crate) fn matches(&self, path: &[u8]) -> bool {
        self.0.matches(path)
    }
}

/// `new Minimatch(joined)` for `texts` that a rule joined to the working directory.
pub(crate) enum JoinedGlob {
    /// The working directory is a part of the pattern, as in the plugin. In a directory named `[app]` or `{a,b}` the
    /// pattern matches no file.
    Whole(Glob),
    /// The working directory is a path, whatever its name is, and only what the texts say is a pattern.
    BelowCwd(Under<Minimatch>),
}

impl JoinedGlob {
    /// `cwd` is the working directory if [`reads_cwd_as_path`].
    pub(crate) fn new(cwd: Option<&[u8]>, texts: &[&[u8]], joined: &[u8]) -> JoinedGlob {
        let Some(cwd) = cwd else {
            return JoinedGlob::Whole(Glob::new(joined));
        };
        let (directory, below) = Self::split(cwd, texts, joined);
        JoinedGlob::BelowCwd(Under::new(directory, Minimatch::new(below)))
    }

    /// `isGlob(joined)`
    pub(crate) fn is_glob(cwd: Option<&[u8]>, texts: &[&[u8]], joined: &[u8]) -> bool {
        is_glob(cwd.map_or(joined, |cwd| Self::split(cwd, texts, joined).1))
    }

    fn split<'j>(cwd: &[u8], texts: &[&[u8]], joined: &'j [u8]) -> (&'j [u8], &'j [u8]) {
        paths::split_joined(cwd, texts, paths::Style::of(cwd).separators(), joined)
    }

    /// `path` uses `/` as its separator.
    pub(crate) fn matches(&self, path: &[u8]) -> bool {
        match self {
            JoinedGlob::Whole(glob) => glob.matches(path),
            JoinedGlob::BelowCwd(glob) => {
                (glob.below(path)).is_some_and(|(glob, rest)| glob.matches(rest))
            }
        }
    }
}

/// True if `file` has no ESLint or oxlint config. No rule has to match the plugin then, so the working directory is a
/// path in each pattern that a rule joins to it, whatever bytes its name has. A glob as written still matches the
/// whole path of a file.
pub(crate) fn reads_cwd_as_path(file: &File) -> bool {
    file.language().has_no_foreign_config
}

/// `globs.some((glob) => minimatch(path, glob) || minimatch(path, join(process.cwd(), glob)))`
pub(crate) struct GlobsFromCwd {
    patterns: Vec<Box<[u8]>>,
    /// Each glob twice: as written, and joined to the cwd. Parsed once for a file with [`reads_cwd_as_path`] and once
    /// for one without, because every file in a run has the same cwd.
    parsed: [OnceLock<Vec<(Glob, JoinedGlob)>>; 2],
}

impl GlobsFromCwd {
    pub(crate) fn new(patterns: &[&str]) -> GlobsFromCwd {
        GlobsFromCwd {
            patterns: patterns.iter().map(|it| it.as_bytes().into()).collect(),
            parsed: Default::default(),
        }
    }

    /// `path` uses `/` as its separator. `file` is the file that the rule runs for.
    pub(crate) fn matches(&self, file: &File, cwd: &[u8], path: &[u8]) -> bool {
        let is_path = reads_cwd_as_path(file);
        let both = |it: &[u8]| {
            let written = paths::portable(cwd, it);
            let joined = paths::join_normalized(cwd, it);
            (
                Glob::new(&written),
                JoinedGlob::new(is_path.then_some(cwd), &[&written], &joined),
            )
        };
        let all = || self.patterns.iter().map(|it| both(it)).collect::<Vec<_>>();
        let globs = self.parsed[usize::from(is_path)].get_or_init(all);
        globs
            .iter()
            .any(|(written, joined)| written.matches(path) || joined.matches(path))
    }
}
