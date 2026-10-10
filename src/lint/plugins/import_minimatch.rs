#![allow(dead_code)] // until every rule of the plugin is written
//! How the rules of eslint-plugin-import call minimatch 3.1.5 with options, or with the working directory.
//! `minimatch(path, pattern)` alone is `Pattern::new(pattern, Options::MINIMATCH).matches(path)`.

use bun_core::strings;
use bun_glob::{Options as GlobOptions, Pattern};
use bun_lint::options::{Json, Object};
use bun_lint::paths;
use std::sync::OnceLock;

/// The options of minimatch that are known here.
#[derive(Copy, Clone, Default)]
struct Asked {
    nocomment: bool,
    nonegate: bool,
    dot: bool,
    match_base: bool,
}

/// `new Minimatch(pattern, options)`
pub(crate) struct Glob {
    pattern: Pattern,
    /// `matchBase`, for a pattern without a `/`: it is about the last name of a path.
    matches_base: bool,
}

impl Glob {
    /// `Minimatch`, `make`, `parseNegate`
    fn new(written: &[u8], options: Asked) -> Glob {
        // Where `\` separates the names of a path, it does so in a pattern.
        let written = paths::from_native(strings::trim_js_whitespace(written));
        // Otherwise a pattern that starts with `#` is a comment, and one that starts with `!` is negated.
        let shield: &[u8] = match &written[..] {
            [b'#', ..] if options.nocomment => b"\\",
            // It opens a group, which `\!(` does not. Braces, here empty, are expanded after a negation is read.
            [b'!', b'(', ..] if options.nonegate => b"{,}",
            [b'!', ..] if options.nonegate => b"\\",
            _ => b"",
        };
        let mode = match options.dot {
            true => GlobOptions::MINIMATCH_DOT,
            false => GlobOptions::MINIMATCH,
        };
        Glob {
            pattern: Pattern::new(&[shield, &written[..]].concat(), mode),
            // The empty pattern is about the whole path.
            matches_base: options.match_base
                && !written.is_empty()
                && !strings::contains_char(&written, b'/'),
        }
    }

    /// `minimatch(path, pattern, patternOptions || { nocomment: true })` for an element of `pathGroups`.
    pub(crate) fn of_path_group(group: Object) -> Glob {
        let options = group.object("patternOptions");
        let is_set = |key: &str| options.get(key).is_some_and(Json::is_truthy);
        let asked = Asked {
            nocomment: !group.has("patternOptions") || is_set("nocomment"),
            nonegate: is_set("nonegate"),
            dot: is_set("dot"),
            match_base: is_set("matchBase"),
        };
        Glob::new(group.str("pattern").unwrap_or_default().as_bytes(), asked)
    }

    /// `minimatch(path, pattern, { matchBase: true })`
    pub(crate) fn matching_base(pattern: &[u8]) -> Glob {
        let asked = Asked {
            match_base: true,
            ..Asked::default()
        };
        Glob::new(pattern, asked)
    }

    /// `match`. `path` is separated by `/`.
    pub(crate) fn matches(&self, path: &[u8]) -> bool {
        if !self.matches_base {
            return self.pattern.matches(path);
        }
        // The last name that is not empty. `path.basename` leaves out a drive: `a:b` is a name here.
        let names = strings::trim_right(path, b"/");
        let start = strings::last_index_of_char(names, b'/').map_or(0, |slash| slash + 1);
        self.pattern.matches(&names[start..])
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
        let read = |pattern: Vec<u8>| {
            let trimmed = strings::trim_js_whitespace(&pattern);
            Pattern::new(trimmed, GlobOptions::MINIMATCH)
        };
        let join = paths::join_normalized;
        let both = |it: &[u8]| [read(paths::portable(cwd, it)), read(join(cwd, it))];
        let all = || self.written.iter().map(|it| both(it)).collect::<Vec<_>>();
        let mut globs = self.read.get_or_init(all).iter().flatten();
        globs.any(|it| it.matches(path))
    }
}
