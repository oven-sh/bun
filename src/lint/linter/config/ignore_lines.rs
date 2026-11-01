//! `ignorePatterns` from `.oxlintrc.json`, from ESLint 8 config files, and from a bunfig.toml without a config file. All
//! are lists of `.gitignore`-style lines.
//! [`crate::ignore`] does the matching. This module calls it the way each tool does.

use crate::ignore::{IgnoreOptions, IgnoreRules, Verdict};

pub(super) struct IgnoreLines {
    rules: IgnoreRules,
    /// They're from an `.oxlintrc.json`.
    is_oxlint: bool,
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
            is_oxlint: true,
        }
    }

    /// Returns lines that are matched like those of a `.gitignore` that oxlint reads. That's how bunfig.toml's
    /// `ignorePatterns` are matched with an oxlint config too.
    pub(super) fn of_bunfig(lines: &[&[u8]]) -> IgnoreLines {
        IgnoreLines {
            is_oxlint: false,
            ..IgnoreLines::of_oxlint(lines)
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
            is_oxlint: false,
        }
    }

    /// True if `path` is ignored. `path` is relative to the directory that the lines belong to, and ends with a slash
    /// if it's a directory. `is_ignored` is the verdict so far, which is kept if no line matches.
    pub(super) fn is_ignored(&self, path: &[u8], is_ignored: bool) -> bool {
        let (path, is_directory) = match path.strip_suffix(b"/") {
            Some(directory) => (directory, true),
            None => (path, false),
        };
        let verdict = match self.is_oxlint && self.rules.has_exceptions() {
            // This lets a `!` line un-ignore a file inside an ignored directory, which isn't possible in a
            // `.gitignore`.
            true => self.rules.verdict_with_parents(path, is_directory),
            // The caller has already checked the parent directories, outermost first. Without a `!` line they can't
            // change the verdict.
            false => self.rules.verdict(path, is_directory),
        };
        match verdict {
            // A directory in which a `!` line could match still has to be read.
            Verdict::Ignored => {
                !(self.is_oxlint && is_directory && self.rules.may_keep_inside(path))
            }
            Verdict::Unignored => false,
            Verdict::Unmentioned => is_ignored,
        }
    }
}
