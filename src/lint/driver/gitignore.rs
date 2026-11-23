//! `.gitignore` and other files in its format. ESLint doesn't read them. oxlint does, so they apply when the config is
//! an `.oxlintrc.json` and when there's no config. Prettier only reads the ones in the working directory. With a
//! Prettier config, `bun fmt` reads those plus the `info/exclude` of the repository that contains the working
//! directory. Without another tool's config, it reads every `.gitignore`, like Git.
//!
//! This module finds the files and tracks which directory each file's lines belong to. [`bun_lint::ignore`] decides
//! what a line matches.

use crate::{fs, paths};
use bun_core::strings;
use bun_lint::ignore::{IgnoreOptions, IgnoreRules, Verdict};
use bun_sema::util::FxHashSet;
use std::sync::Arc;

/// The ignore files that apply in a directory: the ones in it and the ones above it.
pub(crate) struct Ignores {
    /// The lines are relative to this directory.
    directory: Vec<u8>,
    rules: IgnoreRules,
    /// Parsed and matched the way Prettier does it.
    matches_like_prettier: bool,
    /// From `info/exclude`, which doesn't apply to anything outside the working tree.
    is_info_exclude: bool,
    above: Option<Arc<Ignores>>,
}

impl Ignores {
    /// True if one of the leading `..` in `path` is ignored. The `ignore` package treats them like any other directory,
    /// so `.*` matches them, and with them everything outside the ignore file's directory.
    fn ignores_leading_dotdot(&self, path: &[u8]) -> bool {
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

/// How oxlint and oxfmt parse the lines, with the `ignore` crate: `{a,b}` means `a` or `b`.
const OXC_OPTIONS: IgnoreOptions = IgnoreOptions {
    has_braces: true,
    ignores_case: false,
};

/// How Prettier parses them, with the `ignore` package: braces are literal, and `readme.md` also matches `README.md`.
const PRETTIER_OPTIONS: IgnoreOptions = IgnoreOptions {
    has_braces: false,
    ignores_case: true,
};

fn with_rules(
    chain: Chain,
    directory: &[u8],
    rules: IgnoreRules,
    is_for_oxc: bool,
    is_info_exclude: bool,
) -> Chain {
    if rules.is_empty() {
        return chain;
    }
    Some(Arc::new(Ignores {
        directory: directory.to_vec(),
        rules,
        matches_like_prettier: !is_for_oxc,
        is_info_exclude,
        above: chain,
    }))
}

fn rules_of(text: &[u8], is_for_oxc: bool) -> IgnoreRules {
    IgnoreRules::from_text(
        text,
        if is_for_oxc {
            OXC_OPTIONS
        } else {
            PRETTIER_OPTIONS
        },
    )
}

/// Returns `chain` plus the lines of `text`, an ignore file's contents. They're relative to `directory`. With
/// `is_for_oxc` they're parsed like oxlint and oxfmt do, otherwise like Prettier does.
pub(crate) fn with_text(chain: Chain, directory: &[u8], text: &[u8], is_for_oxc: bool) -> Chain {
    let rules = rules_of(text, is_for_oxc);
    with_rules(chain, directory, rules, is_for_oxc, false)
}

/// Returns `chain` plus `lines`, which are oxlint or oxfmt arguments, or the elements of an array in one of their
/// config files. They're relative to `directory`.
pub(crate) fn with_lines<'l>(
    chain: Chain,
    directory: &[u8],
    lines: impl IntoIterator<Item = &'l [u8]>,
) -> Chain {
    let is_for_oxc = true;
    with_rules(
        chain,
        directory,
        IgnoreRules::from_lines(lines, OXC_OPTIONS),
        is_for_oxc,
        false,
    )
}

/// Returns the first of `lines` that oxlint and oxfmt reject.
pub(crate) fn rejected_line<'l>(lines: impl IntoIterator<Item = &'l [u8]>) -> Option<Box<[u8]>> {
    let rules = IgnoreRules::from_lines(lines, OXC_OPTIONS);
    rules.rejected().first().cloned()
}

/// Returns `chain` plus `file`, whose lines are relative to `directory`.
fn with_file(chain: Chain, directory: &[u8], file: &[u8], is_for_oxc: bool) -> Chain {
    match fs::read(file) {
        Ok(text) => with_text(chain, directory, &text, is_for_oxc),
        Err(_) => chain,
    }
}

/// Returns `chain` plus `text`, the contents of a repository's `info/exclude`. The lines are relative to `root`, the
/// root of the working tree.
pub(crate) fn with_excludes(chain: Chain, root: &[u8], text: &[u8], is_for_oxc: bool) -> Chain {
    let is_info_exclude = true;
    with_rules(
        chain,
        root,
        rules_of(text, is_for_oxc),
        is_for_oxc,
        is_info_exclude,
    )
}

/// Returns the directory that holds `info/exclude` for the repository with the `.git` at `dot_git`. In a submodule, and
/// in a working tree made by `git worktree add`, `.git` is a file. A submodule's points to a directory without
/// `commondir`, which holds `info/exclude` itself. With `is_for_oxc`, this copies the `ignore` crate: without
/// `commondir` nothing is read, and a relative path is resolved from the process's working directory, not from the
/// repository.
fn common_directory(dot_git: Vec<u8>, kind: fs::Kind, is_for_oxc: bool) -> Option<Vec<u8>> {
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
    if !is_for_oxc {
        let from = |directory: &[u8], it: &[u8]| paths::resolve(directory, &paths::from_native(it));
        let git_directory = from(paths::dirname(&dot_git), git_directory);
        return Some(
            match first_line(&paths::join(&git_directory, b"commondir")) {
                Some(common) => from(&git_directory, &common),
                None => git_directory,
            },
        );
    }
    let common = first_line(&paths::join(git_directory, b"commondir"))?;
    Some(match common.starts_with(b".") {
        true => paths::join(git_directory, &common),
        false => common,
    })
}

/// Returns the root of the working tree that contains `directory`, and the path of its repository's `info/exclude`.
fn exclude_file_above(directory: &[u8]) -> Option<(&[u8], Vec<u8>)> {
    let (root, dot_git, kind) = paths::ancestors(directory).find_map(|root| {
        let dot_git = paths::join(root, b".git");
        fs::kind(&dot_git).map(|kind| (root, dot_git, kind))
    })?;
    let common = common_directory(dot_git, kind, false)?;
    Some((root, paths::join(&common, b"info/exclude")))
}

/// Returns the `info/exclude` of the repository that contains `directory`, parsed like Prettier would. `Err` if the
/// file exists but can't be read.
pub(crate) fn excludes_above(directory: &[u8]) -> Result<Chain, (Vec<u8>, bun_sys::Error)> {
    let Some((root, file)) = exclude_file_above(directory) else {
        return Ok(None);
    };
    match fs::read(&file) {
        Ok(text) => Ok(with_excludes(None, root, &text, false)),
        Err(error) if error.get_errno() == bun_sys::E::ENOENT => Ok(None),
        Err(error) => Err((file, error)),
    }
}

/// If `file` is a repository's `info/exclude`, returns the root of its working tree. A repository can have several
/// working trees. The one that contains `cwd` wins.
pub(crate) fn root_of_exclude_file(file: &[u8], cwd: &[u8]) -> Option<Vec<u8>> {
    if !file.ends_with(b"/info/exclude") {
        return None;
    }
    if let Some((root, _)) = exclude_file_above(cwd).filter(|it| it.1 == file) {
        return Some(root.to_vec());
    }
    let dot_git = paths::dirname(paths::dirname(file));
    (paths::basename(dot_git) == b".git").then(|| paths::dirname(dot_git).to_vec())
}

/// True if `directory` is the top of a Git or Jujutsu repository.
pub(crate) fn is_root(directory: &[u8]) -> bool {
    [&b".git"[..], b".jj"]
        .iter()
        .any(|name| bun_sys::exists(&paths::join(directory, name)))
}

/// oxc's `all_paths_have_vcs_boundary`. `searched` holds the directories where the run's searches start. An ignored one
/// isn't searched, so it doesn't count. `argument_directories` holds the directories of the files passed as arguments.
pub(crate) fn are_all_in_repositories<'p>(
    mut searched: impl Iterator<Item = &'p [u8]>,
    mut argument_directories: impl Iterator<Item = &'p [u8]>,
) -> bool {
    let mut known: FxHashSet<&[u8]> = FxHashSet::default();
    let mut is_in_one = |directory: &'p [u8]| {
        let root = paths::ancestors(directory).find(|it| known.contains(it) || is_root(it));
        let shortest = root.map_or(usize::MAX, <[u8]>::len);
        known.extend(paths::ancestors(directory).take_while(|it| it.len() >= shortest));
        root.is_some()
    };
    let is_for_oxc = true;
    let is_skipped = |it: &[u8]| {
        GitIgnores::above_and_in(it, true, is_for_oxc).is_directory_ignored_anywhere(it)
    };
    searched.all(|it| is_in_one(it) || is_skipped(it)) && argument_directories.all(is_in_one)
}

/// `.gitignore` and `info/exclude` for a search like oxlint's and oxfmt's, read the way the `ignore` crate reads them.
#[derive(Clone, Default)]
pub(crate) struct GitIgnores {
    ignores: Chain,
    /// `info/exclude`. Every `.gitignore` takes precedence over it.
    excludes: Chain,
    /// Ignore files above a repository's root don't apply inside it.
    stops_at_roots: bool,
    /// Find `info/exclude` the way the crate does. See [`common_directory`].
    is_for_oxc: bool,
    /// Parse the lines the way Prettier does. See [`PRETTIER_OPTIONS`].
    reads_like_prettier: bool,
}

impl GitIgnores {
    /// For a search that starts in `directory`. `None` if `directory` or one of its parents is ignored, so it isn't
    /// searched. If any search in the run is outside a repository, repository roots stop none of them.
    pub(crate) fn for_search(
        directory: &[u8],
        is_for_oxc: bool,
        are_all_in_repositories: impl FnOnce() -> bool,
    ) -> Option<Self> {
        let own = Self::above_and_in(directory, true, is_for_oxc);
        if own.is_directory_ignored_anywhere(directory) {
            return None;
        }
        Some(match own.stops_at_roots && !are_all_in_repositories() {
            true => Self::above_and_in(directory, false, is_for_oxc),
            false => own,
        })
    }

    /// Reads the files in `directory` and above it, up to the repository root, or all the way up outside a repository.
    pub(crate) fn above_and_in(directory: &[u8], stops_at_roots: bool, is_for_oxc: bool) -> Self {
        Self {
            stops_at_roots,
            is_for_oxc,
            ..Self::default()
        }
        .with_all_above_and_in(directory, None)
    }

    /// Like [`GitIgnores::above_and_in`], for `bun fmt` without another tool's config. Lines are parsed the same way as
    /// in `.prettierignore`. Outside a repository, Git ignores nothing and Prettier only reads the file in `cwd`, so
    /// files above `cwd` are skipped.
    pub(crate) fn above_and_in_for_fmt(directory: &[u8], cwd: &[u8]) -> Self {
        Self {
            stops_at_roots: true,
            reads_like_prettier: true,
            ..Self::default()
        }
        .with_all_above_and_in(directory, Some(cwd))
    }

    /// Outside a repository, the walk up stops at `top`. If `directory` isn't inside `top`, only `directory` is read.
    fn with_all_above_and_in(mut self, directory: &[u8], top: Option<&[u8]>) -> Self {
        let mut directories: Vec<&[u8]> = paths::ancestors(directory).collect();
        let nearest = directories.iter().position(|it| is_root(it));
        self.stops_at_roots &= nearest.is_some();
        if let Some(nearest) = nearest.filter(|_| self.stops_at_roots) {
            directories.truncate(nearest + 1);
        } else if let Some(top) = top {
            let is_in_top = |it: &&&[u8]| paths::is_at_or_inside(top, it);
            directories.truncate(directories.iter().take_while(is_in_top).count().max(1));
        }
        for (index, directory) in directories.iter().enumerate().rev() {
            let can_be_root = nearest.is_some_and(|nearest| nearest <= index);
            self = self.and_in(directory, |name| can_be_root || name == b".gitignore");
        }
        self
    }

    /// Adds the files in `directory`, which the search has just entered. `has` returns whether the directory may have
    /// an entry with that name.
    pub(crate) fn and_in(mut self, directory: &[u8], has: impl Fn(&[u8]) -> bool) -> Self {
        let is_for_oxc = !self.reads_like_prettier;
        let own = |chain, file: &[u8]| with_file(chain, directory, file, is_for_oxc);
        let dot_git = has(b".git").then(|| paths::join(directory, b".git"));
        let kind = match &dot_git {
            Some(dot_git) if self.stops_at_roots || !self.is_for_oxc => fs::kind(dot_git),
            // When roots don't stop the walk, the crate doesn't check what `.git` is.
            Some(_) => Some(fs::Kind::Directory),
            None => None,
        };
        let has_jj = || has(b".jj") && bun_sys::exists(&paths::join(directory, b".jj"));
        if self.stops_at_roots && (kind.is_some() || has_jj()) {
            (self.ignores, self.excludes) = (None, None);
        }
        if let (Some(dot_git), Some(kind)) = (dot_git, kind)
            && let Some(common) = common_directory(dot_git, kind, self.is_for_oxc)
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

    /// True if `path` is ignored, assuming its parent directory isn't.
    pub(crate) fn is_ignored(&self, path: &[u8], is_directory: bool) -> bool {
        self.decide(path, is_directory).unwrap_or(false)
    }

    /// True if the directory at `path` or any directory above it is ignored.
    pub(crate) fn is_directory_ignored_anywhere(&self, path: &[u8]) -> bool {
        paths::ancestors(path).any(|directory| self.is_ignored(directory, true))
    }

    /// True if the file at `path` or any directory above it is ignored.
    pub(crate) fn is_file_ignored_anywhere(&self, path: &[u8]) -> bool {
        self.is_directory_ignored_anywhere(paths::dirname(path)) || self.is_ignored(path, false)
    }
}

/// The ignore files that a `bun lint` search consults, in the order of the `ignore` crate, which oxlint walks with.
/// Wherever they are, files with the custom name take precedence over Git's.
#[derive(Clone, Default)]
pub(crate) struct Files {
    pub(crate) named: Chain,
    git_ignores: GitIgnores,
}

impl Files {
    /// Reads what applies in `directory`, where a search starts. `name` is `.eslintignore` or the `--ignore-path`
    /// value. A repository root doesn't stop the walk up for it. Above `directory`, `name` is joined to each directory,
    /// so a relative path works too, and an absolute path is read once per directory. From `directory` down, it's
    /// looked up among the directory entries.
    pub(crate) fn above_and_in(
        directory: &[u8],
        name: Option<&[u8]>,
        git_ignores: GitIgnores,
        pipes: &fs::NamedPipes,
    ) -> Self {
        let mut named = None;
        if let Some(name) = name {
            let is_path = strings::contains_char(name, b'/');
            let directories: Vec<&[u8]> = paths::ancestors(directory)
                .skip(usize::from(is_path))
                .collect();
            for directory in directories.iter().rev() {
                if let Ok(text) = pipes.read(&paths::resolve(directory, name)) {
                    named = with_text(named, directory, &text, true);
                }
            }
        }
        Self { named, git_ignores }
    }

    /// Adds the files in `directory`, which the search has just entered. `has` returns whether the directory has an
    /// entry with that name.
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
        self.git_ignores = self.git_ignores.and_in(directory, has);
        self
    }

    /// True if `path` is ignored, assuming its parent directory isn't.
    pub(crate) fn is_ignored(&self, path: &[u8], is_directory: bool) -> bool {
        decide(&self.named, path, is_directory, false)
            .or_else(|| self.git_ignores.decide(path, is_directory))
            .unwrap_or(false)
    }
}

/// True if the ignore file `file`, whose contents are `text`, ignores `argument`, a file passed to oxlint on the
/// command line. oxlint calls the `ignore` crate with both paths as typed:
/// `Gitignore::new(file).matched(argument, false)`. If `argument` doesn't start with `file`'s directory, the lines are
/// matched against all of `argument`.
pub(crate) fn ignores_argument(text: &[u8], file: &[u8], argument: &[u8]) -> bool {
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
    IgnoreRules::from_text(text, OXC_OPTIONS).verdict(path, false) == Verdict::Ignored
}

/// True if `path` is ignored, assuming its parent directory isn't. The nearest file with a matching line decides, and
/// within that file the last matching line.
pub(crate) fn is_ignored(chain: &Chain, path: &[u8], is_directory: bool) -> bool {
    let is_in_search = false;
    decide(chain, path, is_directory, is_in_search).unwrap_or(false)
}

/// Same, for a path that a `bun fmt` search reaches. There oxfmt passes the `ignore` crate a path outside the ignore
/// file's directory unchanged, so a pattern without a `/` can match the name. It doesn't check an argument that's
/// outside the directory.
pub(crate) fn is_ignored_in_search(chain: &Chain, path: &[u8], is_directory: bool) -> bool {
    let is_in_search = true;
    decide(chain, path, is_directory, is_in_search).unwrap_or(false)
}

/// True if `below` is `above` or inside it.
fn is_at_or_above(above: &[u8], below: &[u8]) -> bool {
    above == below || paths::inside(above, below).is_some()
}

/// `None` if no file has a line that matches it.
fn decide(chain: &Chain, path: &[u8], is_directory: bool, is_in_search: bool) -> Option<bool> {
    let mut next = chain.as_ref();
    while let Some(ignores) = next {
        let directory = &ignores.directory[..];
        let from_outside;
        let inside = match paths::inside(directory, path) {
            Some(inside) => Some(inside),
            // No pattern applies to the ignore file's own directory or to its parents.
            None if is_at_or_above(path, directory) || ignores.is_info_exclude => None,
            // Prettier passes the `ignore` package `../src/a.js`, where a pattern without a `/` can match the name.
            None if ignores.matches_like_prettier => {
                from_outside = paths::relative(directory, path);
                if ignores.ignores_leading_dotdot(&from_outside) {
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
                Verdict::Unignored => return Some(false),
                Verdict::Unmentioned => {}
            }
        }
        next = ignores.above.as_ref();
    }
    None
}

/// True if the directory at `path` or any directory above it is ignored.
pub(crate) fn is_directory_ignored_anywhere(chain: &Chain, path: &[u8]) -> bool {
    let directories: Vec<&[u8]> = paths::ancestors(path).collect();
    directories
        .iter()
        .rev()
        .any(|directory| is_ignored(chain, directory, true))
}

/// True if the file at `path` or any directory above it is ignored. For a file that wasn't reached by walking its
/// parent directories.
pub(crate) fn is_file_ignored_anywhere(chain: &Chain, path: &[u8]) -> bool {
    is_directory_ignored_anywhere(chain, paths::dirname(path)) || is_ignored(chain, path, false)
}
