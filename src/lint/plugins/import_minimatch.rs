//! minimatch as eslint-plugin-import's rules call it.

use bun_lint::glob::{Minimatch, MinimatchOptions};
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
    pub(crate) fn of_path_group(group: Object) -> Glob {
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

/// `globs.some((glob) => minimatch(path, glob) || minimatch(path, join(process.cwd(), glob)))`
pub(crate) struct GlobsFromCwd {
    written: Vec<Box<[u8]>>,
    /// Each glob twice: as written, and joined to the cwd. Parsed once, because every file in a run has the same cwd.
    parsed: OnceLock<Vec<[Glob; 2]>>,
}

impl GlobsFromCwd {
    pub(crate) fn new(written: &[&str]) -> GlobsFromCwd {
        GlobsFromCwd {
            written: written.iter().map(|it| it.as_bytes().into()).collect(),
            parsed: OnceLock::new(),
        }
    }

    /// `path` uses `/` as its separator.
    pub(crate) fn matches(&self, cwd: &[u8], path: &[u8]) -> bool {
        let join = paths::join_normalized;
        let both = |it: &[u8]| {
            [
                Glob::new(&paths::portable(cwd, it)),
                Glob::new(&join(cwd, it)),
            ]
        };
        let all = || self.written.iter().map(|it| both(it)).collect::<Vec<_>>();
        let mut globs = self.parsed.get_or_init(all).iter().flatten();
        globs.any(|it| it.matches(path))
    }
}
