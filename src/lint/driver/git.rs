//! `--staged` and `--changed` for `bun lint` and `bun fmt`. Both get their list of files from git.
//!
//! Git runs in the working directory and inherits this process's environment. In a hook, that environment tells git
//! where the index is. These calls start no program that `git diff --name-only` wouldn't start itself: no pager, no
//! external diff, no textconv, no submodule scan, no fetch.

use crate::args::{UsageError, error};
use crate::run::{Environment, Fatal};
use crate::{fs, paths};
use bun_core::strings;
use bun_sema::util::FxHashSet;
use std::borrow::Cow;

/// Which files to ask git for.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Only {
    /// `--staged`
    Staged,
    /// `--changed`, or `--changed=<ref>`.
    Changed(Option<Vec<u8>>),
}

/// One git invocation.
pub struct Command<'c> {
    /// Arguments after `git`.
    pub args: &'c [&'c [u8]],
    /// Written to git's stdin.
    pub input: &'c [u8],
    pub cwd: &'c [u8],
}

impl Command<'_> {
    /// Set on top of this process's environment. Stops a partial clone from fetching the objects it's missing.
    pub const VARIABLES: [(&'static [u8], &'static [u8]); 1] = [(b"GIT_NO_LAZY_FETCH", b"1")];
}

/// Result of a git invocation that ran.
pub struct Finished {
    /// The exit code was 0.
    pub is_ok: bool,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

/// Why git couldn't run.
pub enum NotRun {
    /// `git` isn't in `PATH`.
    NotFound,
    Failed(Vec<u8>),
}

/// `git diff` that prints NUL-terminated paths relative to the repository root, whatever the user's git config says.
const DIFF: [&[u8]; 10] = [
    b"--no-optional-locks",
    b"-c",
    b"diff.relative=false",
    b"diff",
    b"--name-only",
    b"-z",
    b"--no-renames",
    b"--ignore-submodules=all",
    b"--no-ext-diff",
    b"--no-textconv",
];

/// Added, modified or type-changed files. Leaves out deleted and conflicted ones.
const IS_THERE: &[u8] = b"--diff-filter=AMT";

/// Refs to try for the default branch, each with the short name used in error messages.
const DEFAULT_BRANCHES: [(&[u8], &str); 3] = [
    (b"refs/remotes/origin/HEAD", "origin/HEAD"),
    (b"refs/heads/main", "main"),
    (b"refs/heads/master", "master"),
];

impl Only {
    /// Applies one flag. `name` is `staged` or `changed`.
    pub(crate) fn set(
        into: &mut Option<Only>,
        name: &[u8],
        value: Option<&[u8]>,
        is_on: bool,
    ) -> Result<(), UsageError> {
        let only = match name {
            b"staged" => Only::Staged,
            _ => Only::Changed(value.filter(|it| !it.is_empty()).map(<[u8]>::to_vec)),
        };
        match into {
            // `--no-staged`
            _ if !is_on => *into = into.take().filter(|it| *it != only),
            Some(other) if other.flag() != only.flag() => {
                return error(&[b"--staged and --changed cannot be used together"]);
            }
            _ => *into = Some(only),
        }
        Ok(())
    }

    pub(crate) fn flag(&self) -> &'static str {
        match self {
            Only::Staged => "--staged",
            Only::Changed(_) => "--changed",
        }
    }

    /// Error for combining this with `flag`, which makes the run read stdin. There's no file list to filter then.
    pub(crate) fn refusal_of_stdin(&self, flag: &str) -> Vec<u8> {
        format!("{} and {flag} cannot be used together", self.flag()).into_bytes()
    }
}

/// An error that starts with `first`, with git's stderr indented below it.
fn in_the_words_of_git(first: &str, finished: &Finished) -> Fatal {
    let mut text = first.as_bytes().to_vec();
    for line in strings::split(&finished.stderr, b"\n").map(<[u8]>::trim_ascii_end) {
        if !line.is_empty() {
            text.extend_from_slice(b"\n  ");
            text.extend_from_slice(line);
        }
    }
    Fatal(text)
}

/// The object ID git printed. `None` if git failed or printed anything else.
fn object_id(finished: &Finished) -> Option<&[u8]> {
    let id = finished.stdout.trim_ascii();
    (finished.is_ok && !id.is_empty() && id.iter().all(u8::is_ascii_hexdigit)).then_some(id)
}

/// The files git listed for `--staged` or `--changed`.
pub(crate) struct Files<'e> {
    only: &'e Only,
    environment: &'e Environment<'e>,
    /// The root of the work tree. It comes from `getcwd`, so there are no links in it.
    top: Vec<u8>,
    /// Absolute paths, in `top`.
    named: FxHashSet<Vec<u8>>,
    /// Files with unstaged changes. Only filled in for a `--staged` run that writes files.
    partly_staged: FxHashSet<Vec<u8>>,
}

impl<'e> Files<'e> {
    /// `writes` is true if the run writes files.
    #[optimize(size)]
    pub(crate) fn read(
        only: &'e Only,
        writes: bool,
        environment: &'e Environment<'e>,
    ) -> Result<Files<'e>, Fatal> {
        let mut files = Files {
            only,
            environment,
            top: Vec::new(),
            named: FxHashSet::default(),
            partly_staged: FxHashSet::default(),
        };
        let flag = only.flag();
        // `--show-toplevel` is only here to fail where there's no work tree, like inside `.git`. `--show-cdup` is the
        // relative path from here to the root, so it doesn't matter how `cwd` is spelled.
        let found = files.git(&[b"rev-parse", b"--show-toplevel", b"--show-cdup"], b"")?;
        if !found.is_ok {
            let first = format!("{flag} needs a git repository");
            return Err(in_the_words_of_git(&first, &found));
        }
        let printed = found.stdout.strip_suffix(b"\n").unwrap_or(&found.stdout);
        let up =
            strings::last_index_of_char(printed, b'\n').map_or(printed, |at| &printed[at + 1..]);
        let top = paths::resolve(&environment.cwd, &paths::from_native(up));
        files.top.clone_from(&top);
        match only {
            Only::Staged => {
                files.named = files.diff(&top, &[b"--cached", IS_THERE])?;
                if writes {
                    files.partly_staged = files.diff(&top, &[])?;
                }
            }
            Only::Changed(since) => {
                let since = match since {
                    Some(since) => files.commit(since)?,
                    None => files.where_it_left_the_default_branch()?,
                };
                files.named = files.diff(&top, &[IS_THERE, &since, b"--"])?;
                let up: &[u8] = if up.is_empty() { b"." } else { up };
                files.named.extend(files.names(
                    &top,
                    &[
                        b"--literal-pathspecs",
                        b"ls-files",
                        b"--others",
                        b"--exclude-standard",
                        b"--full-name",
                        b"-z",
                        b"--",
                        up,
                    ],
                )?);
            }
        }
        Ok(files)
    }

    fn git(&self, args: &[&[u8]], input: &[u8]) -> Result<Finished, Fatal> {
        let command = Command {
            args,
            input,
            cwd: &self.environment.cwd,
        };
        (self.environment.run_git)(&command).map_err(|why| match why {
            NotRun::NotFound => {
                let flag = self.only.flag();
                Fatal(
                    format!("Cannot find git in PATH\n  {flag} asks git for the files")
                        .into_bytes(),
                )
            }
            NotRun::Failed(why) => Fatal([&b"Cannot run git\n  "[..], &why].concat()),
        })
    }

    /// Runs git and parses its output, which is NUL-terminated paths relative to `top`.
    fn names(&self, top: &[u8], args: &[&[u8]]) -> Result<FxHashSet<Vec<u8>>, Fatal> {
        let finished = self.git(args, b"")?;
        if !finished.is_ok {
            let first = format!("{} cannot read the git repository", self.only.flag());
            return Err(in_the_words_of_git(&first, &finished));
        }
        let names = strings::split(&finished.stdout, b"\0").filter(|it| !it.is_empty());
        Ok(names.map(|it| paths::join(top, it)).collect())
    }

    fn diff(&self, top: &[u8], args: &[&[u8]]) -> Result<FxHashSet<Vec<u8>>, Fatal> {
        self.names(top, &[&DIFF[..], args].concat())
    }

    /// Resolves `written` to a commit ID. Later git calls only get the ID, because they could parse `written` as a flag
    /// or a range.
    fn commit(&self, written: &[u8]) -> Result<Vec<u8>, Fatal> {
        let unknown = || {
            let rest = b"\" is not a branch, tag or commit in this repository";
            Fatal([b"\"", written, rest].concat())
        };
        if written.starts_with(b"-") {
            return Err(unknown());
        }
        let name = [written, b"^{commit}"].concat();
        let found = self.git(&[b"rev-parse", b"--verify", b"--quiet", &name], b"")?;
        object_id(&found).map(<[u8]>::to_vec).ok_or_else(unknown)
    }

    /// The merge base of `HEAD` and the default branch.
    fn where_it_left_the_default_branch(&self) -> Result<Vec<u8>, Fatal> {
        for (branch, _) in DEFAULT_BRANCHES {
            if let Some(id) = object_id(&self.git(&[b"merge-base", b"HEAD", branch], b"")?) {
                return Ok(id.to_vec());
            }
        }
        if self.commit(b"HEAD").is_err() {
            return Err(Fatal(
                b"--changed has nothing to compare with, because this repository has no commits\n  Use --staged for the files that you have added".to_vec(),
            ));
        }
        let [first, second, third] = DEFAULT_BRANCHES.map(|it| it.1);
        Err(Fatal(
            format!("--changed cannot find the default branch\n  It tried {first}, {second} and {third}. Name a branch or a commit with --changed=<ref>")
                .into_bytes(),
        ))
    }

    /// `path` (absolute) as the lists spell it. An argument can reach the work tree through a link: `/tmp/repo/a.js` on macOS,
    /// or `$PWD/a.js` in a shell that got here through one. Only the directory is resolved, because a link to a file doesn't
    /// count as that file. A path in `top` is taken as it is, so an ordinary run resolves nothing.
    fn as_listed<'p>(&self, path: &'p [u8]) -> Cow<'p, [u8]> {
        if paths::inside(&self.top, path).is_some() {
            return Cow::Borrowed(path);
        }
        match fs::real_path(paths::dirname(path)) {
            Some(directory) => Cow::Owned(paths::join(&directory, paths::basename(path))),
            None => Cow::Borrowed(path),
        }
    }

    /// Whether git listed the file at `path` (absolute). A symlink doesn't count, even if it points to a file.
    pub(crate) fn has(&self, path: &[u8]) -> bool {
        self.named.contains(&*self.as_listed(path))
            && matches!(fs::link_kind_and_size(path), Some((fs::LinkKind::File, _)))
    }

    /// True if writing `path` and staging it again would also stage changes the user didn't stage.
    pub(crate) fn is_partly_staged(&self, path: &[u8]) -> bool {
        self.partly_staged.contains(&*self.as_listed(path))
    }

    /// Message for a run with no files left. `verb` is what the run does to files, like "lint".
    pub(crate) fn nothing_left(&self, verb: &str) -> String {
        match self.only {
            Only::Staged => format!("No staged files to {verb}"),
            Only::Changed(_) => format!("No changed files to {verb}"),
        }
    }

    /// Explains why `files` (absolute paths, all [partly staged](Files::is_partly_staged)) weren't written. `done` is
    /// what didn't happen to them, like "fixed".
    #[optimize(size)]
    pub(crate) fn refusal_to_write(&self, files: &mut [Vec<u8>], done: &str) -> Vec<u8> {
        bun_lint::utils::sort::sort_unstable(files);
        let shown = files
            .iter()
            .map(|it| paths::relative(&self.environment.cwd, it));
        let way_out: &[u8] =
            b"\n  Stage the rest with git add, or put it away with git stash --keep-index. Then run this again.";
        let said: &[u8] = b" both staged and unstaged changes, so ";
        match files.len() {
            1 => [
                &shown.collect::<Vec<_>>().concat()[..],
                b" has",
                said,
                b"it was not ",
                done.as_bytes(),
                way_out,
            ]
            .concat(),
            count => {
                let mut text = [
                    count.to_string().as_bytes(),
                    b" files have",
                    said,
                    b"they were not ",
                    done.as_bytes(),
                ]
                .concat();
                for name in shown {
                    text.extend_from_slice(b"\n  ");
                    text.extend_from_slice(&name);
                }
                text.extend_from_slice(way_out);
                text
            }
        }
    }

    /// Re-stages `written`: absolute paths of files that were fully staged and that this run rewrote. Same as `git add`,
    /// except that paths are never treated as patterns and there can be any number of them.
    pub(crate) fn stage(&self, written: &[Vec<u8>]) -> Result<(), Fatal> {
        if *self.only != Only::Staged || written.is_empty() {
            return Ok(());
        }
        let mut input = Vec::new();
        for path in written {
            let path = self.as_listed(path);
            input.extend_from_slice(&paths::relative(&self.environment.cwd, &path));
            input.push(0);
        }
        let finished = self.git(&[b"update-index", b"-z", b"--stdin"], &input)?;
        match finished.is_ok {
            true => Ok(()),
            false => Err(in_the_words_of_git(
                "Cannot stage the files that were written\n  Stage them with git add",
                &finished,
            )),
        }
    }
}
