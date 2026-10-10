//! `.gitignore` and the files in its format. ESLint does not read them. oxlint does, so they count
//! where an `.oxlintrc.json` is the configuration, and where there is none. Prettier reads those of
//! the working directory.
//!
//! Here is which files there are, and which directory their lines belong to. What a line matches is
//! said by [`bun_glob::ignore`].

use crate::{fs, paths};
use bun_core::strings;
use bun_glob::ignore::{IgnoreOptions, IgnoreRules, IgnoreSyntax, Verdict};
use std::sync::Arc;

/// The ignore files that count in a directory: those in it, and those above it.
pub(crate) struct Ignores {
    /// What the lines are relative to.
    directory: Vec<u8>,
    rules: IgnoreRules,
    /// As Prettier reads them.
    is_of_prettier: bool,
    above: Option<Arc<Ignores>>,
}

impl Ignores {
    /// Whether one of the `..` that `path` starts with is ignored. To the package `ignore` they are directories like any other:
    /// `.*` has them, and so all that is not in the directory of the file.
    fn ignores_a_way_up(&self, path: &[u8]) -> bool {
        let ups = strings::split(path, b"/")
            .take_while(|name| *name == b"..")
            .count();
        (1..=ups).any(|up| {
            path.get(..3 * up - 1)
                .is_some_and(|above| self.rules.verdict(above, true) == Verdict::Ignored)
        })
    }
}

pub(crate) type Chain = Option<Arc<Ignores>>;

/// As oxlint and oxfmt read the lines, with the crate `ignore`: `{a,b}` is `a` or `b`.
const OF_OXC: IgnoreOptions = IgnoreOptions {
    syntax: IgnoreSyntax::Globset,
    ignores_case: false,
};

/// As Prettier reads them, with the package `ignore`: the braces are taken as they are, and
/// `readme.md` is `README.md` too.
const OF_PRETTIER: IgnoreOptions = IgnoreOptions {
    syntax: IgnoreSyntax::Npm705,
    ignores_case: true,
};

fn with_rules(chain: Chain, directory: &[u8], rules: IgnoreRules, is_for_oxc: bool) -> Chain {
    if rules.is_empty() {
        return chain;
    }
    Some(Arc::new(Ignores {
        directory: directory.to_vec(),
        rules,
        is_of_prettier: !is_for_oxc,
        above: chain,
    }))
}

/// `chain` and the lines of `text`, which is what a file has. They are relative to `directory`.
/// `is_for_oxc`: as oxlint and oxfmt read them. Otherwise as Prettier does.
pub(crate) fn with_text(chain: Chain, directory: &[u8], text: &[u8], is_for_oxc: bool) -> Chain {
    let options = if is_for_oxc { OF_OXC } else { OF_PRETTIER };
    let rules = IgnoreRules::from_text(text, options);
    with_rules(chain, directory, rules, is_for_oxc)
}

/// `chain` and `lines`, which are arguments of oxlint or oxfmt, or the elements of an array in a
/// configuration file of theirs. They are relative to `directory`.
pub(crate) fn with_lines<'l>(
    chain: Chain,
    directory: &[u8],
    lines: impl IntoIterator<Item = &'l [u8]>,
) -> Chain {
    let is_for_oxc = true;
    with_rules(
        chain,
        directory,
        IgnoreRules::from_lines(lines, OF_OXC),
        is_for_oxc,
    )
}

/// The first of `lines` that oxlint and oxfmt do not take.
pub(crate) fn refused_line<'l>(lines: impl IntoIterator<Item = &'l [u8]>) -> Option<Box<[u8]>> {
    let rules = IgnoreRules::from_lines(lines, OF_OXC);
    rules.refused().first().map(|it| it.line.clone())
}

/// `chain` and `file`, whose lines are relative to `directory`.
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
/// anything about it decides, and in that file the last line.
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

/// Whether `below` is `above`, or inside of it.
fn is_at_or_above(above: &[u8], below: &[u8]) -> bool {
    above == below || paths::inside(above, below).is_some()
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
            None if ignores.is_of_prettier => {
                from_outside = paths::relative(directory, path);
                if ignores.ignores_a_way_up(&from_outside) {
                    return true;
                }
                Some(&from_outside[..])
            }
            None if is_in_search => Some(path),
            None => None,
        };
        if let Some(inside) = inside.filter(|it| !it.is_empty()) {
            match ignores.rules.verdict(inside, is_directory) {
                Verdict::Ignored => return true,
                Verdict::Kept => return false,
                Verdict::Unmentioned => {}
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
