//! `.gitignore` and other files in its format. ESLint doesn't read them. oxlint does, so they apply
//! when the config is an `.oxlintrc.json` and when there's no config. Prettier only reads the ones in
//! the working directory.
//!
//! This module finds the files and tracks which directory each file's lines belong to.
//! [`bun_lint::ignore`] decides what a line matches.

use crate::{fs, paths};
use bun_core::strings;
use bun_lint::ignore::{IgnoreOptions, IgnoreRules, Verdict};
use bun_sema::util::FxHashSet;
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
    has_braces: true,
    ignores_case: false,
};

/// As Prettier reads them, with the package `ignore`: the braces are taken as they are, and
/// `readme.md` is `README.md` too.
const OF_PRETTIER: IgnoreOptions = IgnoreOptions {
    has_braces: false,
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
    rules.refused().first().cloned()
}

/// `chain` and `file`, whose lines are relative to `directory`.
pub(crate) fn with_file(chain: Chain, directory: &[u8], file: &[u8], is_for_oxc: bool) -> Chain {
    match fs::read(file) {
        Ok(text) => with_text(chain, directory, &text, is_for_oxc),
        Err(_) => chain,
    }
}

/// Where the repository with the `.git` at `dot_git` has `info/exclude`, as the crate `ignore` finds it. In a working tree of
/// `git worktree add`, `.git` is a file. That of a submodule names a directory without `commondir`, and nothing is read. A path
/// that is not absolute is taken from where the process is, not from the repository.
fn common_directory(dot_git: Vec<u8>, kind: fs::Kind) -> Option<Vec<u8>> {
    if kind == fs::Kind::Directory {
        return Some(dot_git);
    }
    let first_line = |file: &[u8]| {
        let mut text = fs::read(file).ok()?;
        if let Some(end) = strings::index_of_char(&text, b'\n') {
            text.truncate(end as usize);
        }
        if text.ends_with(b"\r") {
            text.pop();
        }
        Some(text)
    };
    let pointer = first_line(&dot_git)?;
    let git_directory = pointer.strip_prefix(b"gitdir: ")?;
    let common = first_line(&paths::join(git_directory, b"commondir"))?;
    Some(match common.starts_with(b".") {
        true => paths::join(git_directory, &common),
        false => common,
    })
}

/// True if `directory` is the top of a Git or Jujutsu repository.
pub(crate) fn is_root(directory: &[u8]) -> bool {
    [&b".git"[..], b".jj"]
        .iter()
        .any(|name| bun_sys::exists(&paths::join(directory, name)))
}

/// oxc's `all_paths_have_vcs_boundary`. `searched`: where the searches of a run start. One that is ignored is not searched, and
/// does not count. `named`: the directories of the files that are arguments.
pub(crate) fn are_all_in_repositories<'p>(
    mut searched: impl Iterator<Item = &'p [u8]>,
    mut named: impl Iterator<Item = &'p [u8]>,
) -> bool {
    let mut known: FxHashSet<&[u8]> = FxHashSet::default();
    let mut is_in_one = |directory: &'p [u8]| {
        let root = paths::ancestors(directory).find(|it| known.contains(it) || is_root(it));
        let shortest = root.map_or(usize::MAX, <[u8]>::len);
        known.extend(paths::ancestors(directory).take_while(|it| it.len() >= shortest));
        root.is_some()
    };
    let is_left_out = |it: &[u8]| OfGit::above_and_in(it, true).is_directory_ignored_anywhere(it);
    searched.all(|it| is_in_one(it) || is_left_out(it)) && named.all(is_in_one)
}

/// `.gitignore` and `info/exclude` for a search of oxlint or oxfmt, as the crate `ignore` reads them.
#[derive(Clone, Default)]
pub(crate) struct OfGit {
    ignores: Chain,
    /// `info/exclude`. Every `.gitignore` comes first.
    excludes: Chain,
    /// What is above the root of a repository does not count in it.
    stops_at_roots: bool,
}

impl OfGit {
    /// For a search that starts in `directory`. `None`: they have it, or a directory that it is in, so it is not searched.
    /// With one search of the run that is in no repository, no root stops any of them.
    pub(crate) fn for_search(
        directory: &[u8],
        are_all_in_repositories: impl FnOnce() -> bool,
    ) -> Option<Self> {
        let own = Self::above_and_in(directory, true);
        if own.is_directory_ignored_anywhere(directory) {
            return None;
        }
        Some(match own.stops_at_roots && !are_all_in_repositories() {
            true => Self::above_and_in(directory, false),
            false => own,
        })
    }

    /// The files in `directory` and above it, up to the root of the repository. Outside of one, all the way up.
    pub(crate) fn above_and_in(directory: &[u8], stops_at_roots: bool) -> Self {
        let mut directories: Vec<&[u8]> = paths::ancestors(directory).collect();
        let nearest = directories.iter().position(|it| is_root(it));
        let stops_at_roots = stops_at_roots && nearest.is_some();
        if let Some(nearest) = nearest.filter(|_| stops_at_roots) {
            directories.truncate(nearest + 1);
        }
        let mut files = Self {
            stops_at_roots,
            ..Self::default()
        };
        for (index, directory) in directories.iter().enumerate().rev() {
            let can_be_root = nearest.is_some_and(|nearest| nearest <= index);
            files = files.and_in(directory, |name| can_be_root || name == b".gitignore");
        }
        files
    }

    /// The same with the files in `directory`, which the search has come to. `has`: whether an entry of it can be called so.
    pub(crate) fn and_in(mut self, directory: &[u8], has: impl Fn(&[u8]) -> bool) -> Self {
        let own = |chain, file: &[u8]| with_file(chain, directory, file, true);
        let dot_git = has(b".git").then(|| paths::join(directory, b".git"));
        let kind = match &dot_git {
            Some(dot_git) if self.stops_at_roots => fs::kind(dot_git),
            // Where no root stops it, the crate does not look at what `.git` is.
            Some(_) => Some(fs::Kind::Directory),
            None => None,
        };
        let has_jj = || has(b".jj") && bun_sys::exists(&paths::join(directory, b".jj"));
        if self.stops_at_roots && (kind.is_some() || has_jj()) {
            (self.ignores, self.excludes) = (None, None);
        }
        if let (Some(dot_git), Some(kind)) = (dot_git, kind)
            && let Some(common) = common_directory(dot_git, kind)
        {
            self.excludes = own(self.excludes, &paths::join(&common, b"info/exclude"));
        }
        if has(b".gitignore") {
            self.ignores = own(self.ignores, &paths::join(directory, b".gitignore"));
        }
        self
    }

    fn decide(&self, path: &[u8], is_directory: bool) -> Option<bool> {
        decide(&self.ignores, path, is_directory, false)
            .or_else(|| decide(&self.excludes, path, is_directory, false))
    }

    /// Whether `path` is ignored, if the directory that it is in is not.
    pub(crate) fn is_ignored(&self, path: &[u8], is_directory: bool) -> bool {
        self.decide(path, is_directory).unwrap_or(false)
    }

    /// Whether the directory at `path` is ignored, or one that it is in.
    pub(crate) fn is_directory_ignored_anywhere(&self, path: &[u8]) -> bool {
        paths::ancestors(path).any(|directory| self.is_ignored(directory, true))
    }
}

/// The files that a search of `bun lint` asks, in the order of the crate `ignore`, with which oxlint walks: wherever they are,
/// those with the name that it is given come before those of Git.
#[derive(Clone, Default)]
pub(crate) struct Files {
    pub(crate) named: Chain,
    of_git: OfGit,
}

impl Files {
    /// What counts in `directory`, which is where a search starts. `name`: `.eslintignore`, or what `--ignore-path` has. The
    /// root of a repository does not end the way up for it. Above `directory` it is joined to each directory, so a path is
    /// found too, and an absolute one is read for each. From `directory` on it is looked for among the entries.
    pub(crate) fn above_and_in(directory: &[u8], name: Option<&[u8]>, of_git: OfGit) -> Self {
        let mut named = None;
        if let Some(name) = name {
            let is_path = strings::contains_char(name, b'/');
            let directories: Vec<&[u8]> = paths::ancestors(directory)
                .skip(usize::from(is_path))
                .collect();
            for directory in directories.iter().rev() {
                named = with_file(named, directory, &paths::resolve(directory, name), true);
            }
        }
        Self { named, of_git }
    }

    /// The same with the files in `directory`, which the search has come to. `has`: whether an entry of it is called so.
    pub(crate) fn and_in(
        mut self,
        directory: &[u8],
        name: Option<&[u8]>,
        has: impl Fn(&[u8]) -> bool,
    ) -> Self {
        if let Some(name) = name.filter(|it| has(it)) {
            let file = paths::join(directory, name);
            self.named = with_file(self.named, directory, &file, true);
        }
        self.of_git = self.of_git.and_in(directory, has);
        self
    }

    /// Whether `path` is ignored, if the directory that it is in is not.
    pub(crate) fn is_ignored(&self, path: &[u8], is_directory: bool) -> bool {
        decide(&self.named, path, is_directory, false)
            .or_else(|| self.of_git.decide(path, is_directory))
            .unwrap_or(false)
    }
}

/// Whether `file` has a line for `argument`, a file that oxlint is to lint. It asks the crate `ignore` with both as they are
/// spelled, `Gitignore::new(file).matched(argument, false)`: where `argument` does not start with the directory in `file`, the
/// lines are compared with all of it.
pub(crate) fn has_argument(cwd: &[u8], file: &[u8], argument: &[u8]) -> bool {
    let Ok(text) = fs::read(&paths::resolve(cwd, file)) else {
        return false;
    };
    let mut root = &file[..strings::last_index_of_char(file, b'/').unwrap_or(0)];
    while let [rest @ .., b'/'] = root {
        root = rest;
    }
    let root = root.strip_prefix(b"./").unwrap_or(root);
    // `Gitignore::strip`
    let mut path = argument.strip_prefix(b"./").unwrap_or(argument);
    if root != b"."
        && strings::contains_char(path, b'/')
        && let Some(rest) = path.strip_prefix(root)
    {
        path = rest.strip_prefix(b"/").unwrap_or(rest);
    }
    IgnoreRules::from_text(&text, OF_OXC).verdict(path, false) == Verdict::Ignored
}

/// Whether `path` is ignored, if the directory that it is in is not. The nearest file that says
/// anything about it decides, and in that file the last line.
pub(crate) fn is_ignored(chain: &Chain, path: &[u8], is_directory: bool) -> bool {
    let is_in_search = false;
    decide(chain, path, is_directory, is_in_search).unwrap_or(false)
}

/// The same for what a search of `bun fmt` comes to. There oxfmt hands the crate `ignore` a path that is not in the directory
/// of the file as it is: a pattern without a `/` finds the name. About an argument that is not in the directory it does not ask.
pub(crate) fn is_ignored_in_search(chain: &Chain, path: &[u8], is_directory: bool) -> bool {
    let is_in_search = true;
    decide(chain, path, is_directory, is_in_search).unwrap_or(false)
}

/// Whether `below` is `above`, or inside of it.
fn is_at_or_above(above: &[u8], below: &[u8]) -> bool {
    above == below || paths::inside(above, below).is_some()
}

/// `None`: no file says anything about it.
fn decide(chain: &Chain, path: &[u8], is_directory: bool, is_in_search: bool) -> Option<bool> {
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
                    return Some(true);
                }
                Some(&from_outside[..])
            }
            None if is_in_search => Some(path),
            None => None,
        };
        if let Some(inside) = inside.filter(|it| !it.is_empty()) {
            match ignores.rules.verdict(inside, is_directory) {
                Verdict::Ignored => return Some(true),
                Verdict::Kept => return Some(false),
                Verdict::Unmentioned => {}
            }
        }
        next = ignores.above.as_ref();
    }
    None
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
