//! `--staged` and `--changed`, for `bun lint` and `bun format`: the files that git names.
//!
//! Git runs in the working directory and with the environment of this process, which in a hook says where the index is.
//! It starts no program here that `git diff --name-only` does not start: no pager, no external diff, no conversion to text,
//! no look into a submodule, no fetch.

use crate::args::{UsageError, error};
use crate::run::{Environment, Fatal};
use crate::{fs, paths};
use bun_core::strings;
use bun_sema::util::FxHashSet;

/// Which files git is asked for.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Only {
    /// `--staged`
    Staged,
    /// `--changed`, or `--changed=<ref>`.
    Changed(Option<Vec<u8>>),
}

/// A call of git.
pub struct Command<'c> {
    /// What follows `git`.
    pub args: &'c [&'c [u8]],
    /// What it reads on standard input.
    pub input: &'c [u8],
    /// The working directory.
    pub cwd: &'c [u8],
}

impl Command<'_> {
    /// What its environment has beside that of this process. A clone that lacks objects does not go and get them.
    pub const VARIABLES: [(&'static [u8], &'static [u8]); 1] = [(b"GIT_NO_LAZY_FETCH", b"1")];
}

/// What has become of a call.
pub struct Finished {
    /// It has exited with 0.
    pub is_ok: bool,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

/// Why git has not run.
pub enum NotRun {
    /// `PATH` has no `git`.
    NotFound,
    Failed(Vec<u8>),
}

/// `git diff` that prints names from the top of the repository, each with a NUL behind it, whatever the configuration says.
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

/// Added, modified, or something else than before: not deleted, not in conflict.
const IS_THERE: &[u8] = b"--diff-filter=AMT";

/// Where the default branch is looked for, and how a person writes that.
const DEFAULT_BRANCHES: [(&[u8], &str); 3] = [
    (b"refs/remotes/origin/HEAD", "origin/HEAD"),
    (b"refs/heads/main", "main"),
    (b"refs/heads/master", "master"),
];

impl Only {
    /// Takes in the flag that is called `name`: `staged` or `changed`.
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

    /// Why there is nothing to narrow in a run that reads standard input, for which `flag` asks.
    pub(crate) fn refusal_of_stdin(&self, flag: &str) -> Vec<u8> {
        format!("{} and {flag} cannot be used together", self.flag()).into_bytes()
    }
}

/// `first`, and under it what git has said.
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

/// The one line that is the ID of an object.
fn object_id(finished: &Finished) -> Option<&[u8]> {
    let id = finished.stdout.trim_ascii();
    (finished.is_ok && !id.is_empty() && id.iter().all(u8::is_ascii_hexdigit)).then_some(id)
}

/// The files that git names.
pub(crate) struct Files<'e> {
    only: &'e Only,
    environment: &'e Environment<'e>,
    /// Absolute.
    named: FxHashSet<Vec<u8>>,
    /// Those that have changes beside what is staged. They are asked for in a run that writes what is staged.
    partly_staged: FxHashSet<Vec<u8>>,
}

impl<'e> Files<'e> {
    /// `writes`: the run writes files.
    pub(crate) fn read(
        only: &'e Only,
        writes: bool,
        environment: &'e Environment<'e>,
    ) -> Result<Files<'e>, Fatal> {
        let mut files = Files {
            only,
            environment,
            named: FxHashSet::default(),
            partly_staged: FxHashSet::default(),
        };
        let flag = only.flag();
        // The first fails where there are no files, as in `.git`. The second is the way from here, however this place is written.
        let found = files.git(&[b"rev-parse", b"--show-toplevel", b"--show-cdup"], b"")?;
        if !found.is_ok {
            let first = format!("{flag} needs a git repository");
            return Err(in_the_words_of_git(&first, &found));
        }
        let printed = found.stdout.strip_suffix(b"\n").unwrap_or(&found.stdout);
        let up =
            strings::last_index_of_char(printed, b'\n').map_or(printed, |at| &printed[at + 1..]);
        let top = paths::resolve(&environment.cwd, &paths::from_native(up));
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

    /// What a call prints: names from `top`, each with a NUL behind it.
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

    /// The ID of the commit that `written` names. Only that goes on to git: `written` could be read as a flag, or as a range.
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

    /// The last commit that `HEAD` has in common with the default branch.
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

    /// Whether git names the file at `path`, which is absolute. A link is not the file that it leads to.
    pub(crate) fn has(&self, path: &[u8]) -> bool {
        self.named.contains(path)
            && matches!(fs::link_kind_and_size(path), Some((fs::LinkKind::File, _)))
    }

    /// Whether to write the file at `path` and stage it would stage what its author has not.
    pub(crate) fn is_partly_staged(&self, path: &[u8]) -> bool {
        self.partly_staged.contains(path)
    }

    /// For a run that is left without a file. `verb`: what it does to files.
    pub(crate) fn nothing_left(&self, verb: &str) -> String {
        match self.only {
            Only::Staged => format!("No staged files to {verb}"),
            Only::Changed(_) => format!("No changed files to {verb}"),
        }
    }

    /// Why `files`, which are absolute and [partly staged](Files::is_partly_staged), are as they were. `done`: what they are not.
    pub(crate) fn refusal_to_write(&self, files: &mut [Vec<u8>], done: &str) -> Vec<u8> {
        files.sort_unstable();
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

    /// Stages `written` again, which are absolute, were staged as a whole, and have been written. It is `git add` for names
    /// that are no patterns, however many there are.
    pub(crate) fn stage(&self, written: &[Vec<u8>]) -> Result<(), Fatal> {
        if *self.only != Only::Staged || written.is_empty() {
            return Ok(());
        }
        let mut input = Vec::new();
        for path in written {
            input.extend_from_slice(&paths::relative(&self.environment.cwd, path));
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
