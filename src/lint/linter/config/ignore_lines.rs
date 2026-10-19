//! `ignorePatterns` from `.oxlintrc.json` and from ESLint 8 config files. Both are lists of `.gitignore`-style lines.
//! [`crate::ignore`] does the matching. This module calls it the way each tool does.

use crate::ignore::{IgnoreOptions, IgnoreRules, Verdict};

pub(super) struct IgnoreLines {
    rules: IgnoreRules,
    /// Otherwise they're ESLint 8's.
    is_of_oxlint: bool,
}

impl IgnoreLines {
    /// `GitignoreBuilder::add_line` for each line. oxlint silently skips a line that's rejected.
    pub(super) fn of_oxlint(lines: &[&[u8]]) -> IgnoreLines {
        let options = IgnoreOptions {
            has_braces: true,
            ignores_case: false,
        };
        IgnoreLines {
            rules: IgnoreRules::from_lines(lines.iter().copied(), options),
            is_of_oxlint: true,
        }
    }

    /// `ignore({ allowRelativePaths: true }).add(lines)`: `IgnorePattern.createIgnore` in `@eslint/eslintrc`.
    pub(super) fn of_eslint_8(lines: &[&[u8]]) -> IgnoreLines {
        let options = IgnoreOptions {
            has_braces: false,
            ignores_case: true,
        };
        IgnoreLines {
            rules: IgnoreRules::from_lines(lines.iter().copied(), options),
            is_of_oxlint: false,
        }
    }

    /// True if `path` is ignored. `path` is relative to the directory that the lines belong to, and ends with a slash
    /// if it's a directory. `is_ignored` is the verdict so far, which is kept if no line matches.
    pub(super) fn is_ignored(&self, path: &[u8], is_ignored: bool) -> bool {
        let (path, is_directory) = match path.strip_suffix(b"/") {
            Some(directory) => (directory, true),
            None => (path, false),
        };
        let verdict = match self.is_of_oxlint && self.rules.has_exceptions() {
            // This lets a `!` line un-ignore a file inside an ignored directory, which isn't possible in a
            // `.gitignore`.
            true => self.rules.verdict_or_of_parents(path, is_directory),
            // The caller has already checked the parent directories, outermost first. Without a `!` line they can't
            // change the verdict.
            false => self.rules.verdict(path, is_directory),
        };
        match verdict {
            // A directory in which a `!` line could match still has to be read.
            Verdict::Ignored => {
                !(self.is_of_oxlint && is_directory && self.rules.may_keep_inside(path))
            }
            Verdict::Kept => false,
            Verdict::Unmentioned => is_ignored,
        }
    }
}
