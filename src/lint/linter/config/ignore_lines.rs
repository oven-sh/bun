//! `ignorePatterns` of an `.oxlintrc.json` and of the configuration files of ESLint 8: lines in the format of a `.gitignore`.
//! What a line matches is said by [`bun_glob::ignore`]. Here is who asks what.

use bun_glob::ignore::{IgnoreOptions, IgnoreRules, IgnoreSyntax, Verdict};

pub(super) struct IgnoreLines {
    rules: IgnoreRules,
    /// Otherwise of ESLint 8.
    is_of_oxlint: bool,
}

impl IgnoreLines {
    /// `GitignoreBuilder::add_line` for each. oxlint says nothing about a line that is refused: it is left out.
    pub(super) fn of_oxlint(lines: &[&[u8]]) -> IgnoreLines {
        let options = IgnoreOptions {
            syntax: IgnoreSyntax::Globset,
            ignores_case: false,
        };
        IgnoreLines {
            rules: IgnoreRules::from_lines(lines.iter().copied(), options),
            is_of_oxlint: true,
        }
    }

    /// `ignore({ allowRelativePaths: true }).add(lines)`: `IgnorePattern.createIgnore` of `@eslint/eslintrc`.
    pub(super) fn of_eslint_8(lines: &[&[u8]]) -> IgnoreLines {
        let options = IgnoreOptions {
            syntax: IgnoreSyntax::Npm5,
            ignores_case: true,
        };
        IgnoreLines {
            rules: IgnoreRules::from_lines(lines.iter().copied(), options),
            is_of_oxlint: false,
        }
    }

    /// Whether `path` is ignored. It is from the directory that the lines belong to, and ends with a slash if it is a directory.
    /// `is_ignored`: what has been said about it so far, which stays if the lines say nothing.
    pub(super) fn is_ignored(&self, path: &[u8], is_ignored: bool) -> bool {
        let (path, is_directory) = match path.strip_suffix(b"/") {
            Some(directory) => (directory, true),
            None => (path, false),
        };
        let verdict = match self.is_of_oxlint && self.rules.has_exceptions() {
            // So a `!` takes a file out of a directory that is ignored, which it cannot in a `.gitignore`.
            true => self.rules.verdict_or_of_parents(path, is_directory),
            // Whoever asks has asked about the directories that it is in, from the outermost. Without a `!` nothing is said of them.
            false => self.rules.verdict(path, is_directory),
        };
        match verdict {
            // A directory in which a `!` can match has to be read.
            Verdict::Ignored => {
                !(self.is_of_oxlint && is_directory && self.rules.may_keep_inside(path))
            }
            Verdict::Kept => false,
            Verdict::Unmentioned => is_ignored,
        }
    }
}
