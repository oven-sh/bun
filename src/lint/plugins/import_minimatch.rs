#![allow(dead_code)] // until every rule of the plugin is written
//! How the rules of eslint-plugin-import call minimatch 3.1.5 with options, or with the working directory.
//! `minimatch(path, pattern)` alone is `Pattern::new(pattern, Options::MINIMATCH_3).matches(path)`.

use bun_core::strings;
use bun_glob::{Options as GlobOptions, Pattern};
use bun_lint::options::{Json, Object};
use bun_lint::paths;
use std::sync::OnceLock;

/// `new Minimatch(pattern, options)`
pub(crate) struct Glob {
    pattern: Pattern,
    /// `matchBase`
    matches_base: bool,
}

impl Glob {
    fn new(written: &[u8], options: GlobOptions, matches_base: bool) -> Glob {
        // Where `\` separates the names of a path, it does so in a pattern.
        let written = paths::from_native(strings::trim_js_whitespace(written));
        Glob {
            pattern: Pattern::new(&written, options),
            matches_base,
        }
    }

    /// `minimatch(path, pattern, patternOptions || { nocomment: true })` for an element of `pathGroups`.
    pub(crate) fn of_path_group(group: Object) -> Glob {
        let options = group.object("patternOptions");
        let is_set = |key: &str| options.get(key).is_some_and(Json::is_truthy);
        let asked = GlobOptions {
            nocomment: !group.has("patternOptions") || is_set("nocomment"),
            nonegate: is_set("nonegate"),
            dot: is_set("dot"),
            ..GlobOptions::MINIMATCH_3
        };
        let pattern = group.str("pattern").unwrap_or_default().as_bytes();
        Glob::new(pattern, asked, is_set("matchBase"))
    }

    /// `minimatch(path, pattern, { matchBase: true })`
    pub(crate) fn matching_base(pattern: &[u8]) -> Glob {
        Glob::new(pattern, GlobOptions::MINIMATCH_3, true)
    }

    /// `match`. `path` is separated by `/`.
    pub(crate) fn matches(&self, path: &[u8]) -> bool {
        match self.matches_base {
            true => self.pattern.matches_base(path),
            false => self.pattern.matches(path),
        }
    }
}

/// `globs.some((glob) => minimatch(path, glob) || minimatch(path, join(process.cwd(), glob)))`
pub(crate) struct GlobsFromCwd {
    written: Vec<Box<[u8]>>,
    /// Each as it is written, and in the working directory. All files of a run have the same working directory.
    read: OnceLock<Vec<[Pattern; 2]>>,
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
        let read = |pattern: Vec<u8>| Pattern::new(&pattern, GlobOptions::MINIMATCH_3);
        let join = paths::join_normalized;
        let both = |it: &[u8]| [read(paths::portable(cwd, it)), read(join(cwd, it))];
        let all = || self.written.iter().map(|it| both(it)).collect::<Vec<_>>();
        let mut globs = self.read.get_or_init(all).iter().flatten();
        globs.any(|it| it.matches(path))
    }
}
