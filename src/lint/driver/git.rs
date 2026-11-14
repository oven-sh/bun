//! `--staged` and `--changed` for `bun lint` and `bun fmt`. Both get their list of files from git. `--staged` also
//! reads a file's text from git if the index and the disk differ.
//!
//! Git runs in the working directory and inherits this process's environment. In a hook, that environment tells git
//! where the index is. These calls start no program that `git diff --name-only` wouldn't start itself: no pager, no
//! external diff, no textconv, no submodule scan, no fetch.

use crate::args::{UsageError, error};
use crate::embedded::Framework;
use crate::run::{Environment, Fatal};
use crate::{fs, paths};
use bun_core::strings;
use bun_sema::resolve::ScriptKind;
use bun_sema::util::{FxHashMap, FxHashSet};
use bun_sema_driver::host::{AlreadyRead, as_read, from_native};
use bun_threading::Guarded;
use std::borrow::Cow;
use std::sync::atomic::{AtomicBool, Ordering};

/// Selects the files to ask git for.
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
const DIFF: [&[u8]; 9] = [
    b"--no-optional-locks",
    b"-c",
    b"diff.relative=false",
    b"diff",
    b"-z",
    b"--no-renames",
    b"--ignore-submodules=all",
    b"--no-ext-diff",
    b"--no-textconv",
];

/// Added, modified or type-changed files. Skips deleted and conflicted ones.
const EXISTING_FILES_FILTER: &[u8] = b"--diff-filter=AMT";

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
    pub(crate) fn stdin_conflict_error(&self, flag: &str) -> Vec<u8> {
        format!("{} and {flag} cannot be used together", self.flag()).into_bytes()
    }
}

/// An error that starts with `first`, with git's stderr indented below it.
fn with_git_stderr(first: &str, finished: &Finished) -> Fatal {
    let mut text = first.as_bytes().to_vec();
    for line in strings::split(&finished.stderr, b"\n").map(<[u8]>::trim_ascii_end) {
        if !line.is_empty() {
            text.extend_from_slice(b"\n  ");
            text.extend_from_slice(line);
        }
    }
    Fatal(text)
}

/// Returns the blob `stored`, converted to the line endings a checkout would write. Git can store LF for a file that it
/// checks out with CRLF (`eol=crlf`, `core.autocrlf`). Every other file in the run is read as checked out, so this one
/// has to match. Asking git whether it converts the file costs another call, so this looks at the file at `path` on
/// disk instead: it's converted if every line there ends in CRLF.
fn with_checkout_line_endings(path: &[u8], stored: &[u8]) -> Vec<u8> {
    let is_converted = !strings::contains_char(stored, b'\r')
        && matches!(fs::link_kind_and_size(path), Some((fs::LinkKind::File, _)))
        && fs::read(path).is_ok_and(|on_disk| {
            let converted = strings::count(&on_disk, b"\r\n");
            converted > 0 && converted == strings::count_char(&on_disk, b'\n')
        });
    match is_converted {
        true => strings::split(stored, b"\n")
            .collect::<Vec<_>>()
            .join(&b"\r\n"[..]),
        false => stored.to_vec(),
    }
}

/// Returns the object ID git printed. `None` if git failed or printed anything else.
fn object_id(finished: &Finished) -> Option<&[u8]> {
    let id = finished.stdout.trim_ascii();
    (finished.is_ok && !id.is_empty() && id.iter().all(u8::is_ascii_hexdigit)).then_some(id)
}

/// Returns the last part of `path`, which is absolute and uses `/`. [`paths::basename`] is a slower loop over bytes.
fn file_name(path: &[u8]) -> &[u8] {
    strings::last_index_of_char(path, b'/').map_or(path, |at| &path[at + 1..])
}

/// The files git listed for `--staged` or `--changed`.
pub(crate) struct Files<'e> {
    only: &'e Only,
    environment: &'e Environment<'e>,
    /// Absolute paths. Git names a file by its real path, below a root that comes from `getcwd`.
    listed_paths: FxHashSet<Vec<u8>>,
    /// The file names in `listed_paths`.
    names: FxHashSet<Vec<u8>>,
    /// False after a [search](Files::searched) that went through no symlink: its paths are spelled like the lists.
    resolves: AtomicBool,
    /// For a directory that was resolved: its real path if a symlink leads to it, `None` if the path is the real one.
    real_directories: Guarded<FxHashMap<Vec<u8>, Option<Vec<u8>>>>,
    /// For `--staged`: index contents of files that differ on disk or were deleted there, keyed by absolute path.
    /// Covers the files in `listed_paths` and, in a run that follows imports, every file they could import.
    index_contents: FxHashMap<Vec<u8>, Vec<u8>>,
    /// Files in `listed_paths` that a disk search can't find, because they were deleted after staging or are no longer
    /// regular files.
    not_on_disk: Vec<Vec<u8>>,
}

impl<'e> Files<'e> {
    #[optimize(size)]
    pub(crate) fn read(
        only: &'e Only,
        environment: &'e Environment<'e>,
        follows_imports: bool,
    ) -> Result<Files<'e>, Fatal> {
        let mut files = Files {
            only,
            environment,
            listed_paths: FxHashSet::default(),
            names: FxHashSet::default(),
            resolves: AtomicBool::new(true),
            real_directories: Guarded::new(FxHashMap::default()),
            index_contents: FxHashMap::default(),
            not_on_disk: Vec::new(),
        };
        let flag = only.flag();
        // `--show-toplevel` is only here to fail where there's no work tree, like inside `.git`. `--show-cdup` is the
        // relative path from here to the root, so it doesn't matter how `cwd` is spelled.
        let found = files.git(&[b"rev-parse", b"--show-toplevel", b"--show-cdup"], b"")?;
        if !found.is_ok {
            let first = format!("{flag} needs a git repository");
            return Err(with_git_stderr(&first, &found));
        }
        let printed = found.stdout.strip_suffix(b"\n").unwrap_or(&found.stdout);
        let up =
            strings::last_index_of_char(printed, b'\n').map_or(printed, |at| &printed[at + 1..]);
        let top = paths::resolve(&environment.cwd, &paths::from_native(up));
        match only {
            Only::Staged => {
                files.listed_paths = files.diff(&top, &[b"--cached", EXISTING_FILES_FILTER])?;
                if !files.listed_paths.is_empty() {
                    files.read_index(&top, follows_imports)?;
                }
            }
            Only::Changed(since) => {
                let since = match since {
                    Some(since) => files.commit(since)?,
                    None => files.merge_base_with_default_branch()?,
                };
                files.listed_paths = files.diff(&top, &[EXISTING_FILES_FILTER, &since, b"--"])?;
                let up: &[u8] = if up.is_empty() { b"." } else { up };
                files.listed_paths.extend(files.names(
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
        let names: FxHashSet<&[u8]> = files.listed_paths.iter().map(|it| file_name(it)).collect();
        files.names = names.into_iter().map(<[u8]>::to_vec).collect();
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
            return Err(self.unreadable(&finished));
        }
        let names = strings::split(&finished.stdout, b"\0").filter(|it| !it.is_empty());
        Ok(names.map(|it| paths::join(top, it)).collect())
    }

    fn diff(&self, top: &[u8], args: &[&[u8]]) -> Result<FxHashSet<Vec<u8>>, Fatal> {
        self.names(top, &[&DIFF[..], &[b"--name-only"], args].concat())
    }

    fn unreadable(&self, finished: &Finished) -> Fatal {
        let first = format!("{} cannot read the git repository", self.only.flag());
        with_git_stderr(&first, finished)
    }

    /// Fills in `index_contents`. An index entry that's a symlink doesn't count as a file, whatever it is on disk.
    fn read_index(&mut self, top: &[u8], follows_imports: bool) -> Result<(), Fatal> {
        let finished = self.git(&[&DIFF[..], &[b"--raw", b"--no-abbrev"]].concat(), b"")?;
        if !finished.is_ok {
            return Err(self.unreadable(&finished));
        }
        // Each entry is `:<mode in the index> <mode on disk> <ID in the index> <zeros> <status>`, NUL, the path, NUL.
        let mut parts = strings::split(&finished.stdout, b"\0");
        let (mut not_regular_files, mut blobs_to_read) = (FxHashSet::default(), Vec::new());
        while let Some(entry) = parts.next().filter(|it| !it.is_empty()) {
            let mut fields = strings::split(entry, b" ");
            let (Some(mode), Some(mode_on_disk), Some(id), Some(name)) =
                (fields.next(), fields.next(), fields.next(), parts.next())
            else {
                return Err(self.unreadable(&finished));
            };
            let path = paths::join(top, name);
            // A conflicted file has one entry with a zero mode and a second entry for "our" side. Skip both.
            if !mode.starts_with(b":100") || not_regular_files.contains(&path) {
                self.listed_paths.remove(&path);
                not_regular_files.insert(path);
                continue;
            }
            let can_be_imported = follows_imports
                && (ScriptKind::from_file_name(name).is_some()
                    || name.ends_with(b".json")
                    || Framework::of(name).is_some());
            let is_listed = self.listed_paths.contains(&path);
            if is_listed && !mode_on_disk.starts_with(b"100") {
                self.not_on_disk.push(path.clone());
            }
            if can_be_imported || is_listed {
                blobs_to_read.push((path, id));
            }
        }
        if blobs_to_read.is_empty() {
            return Ok(());
        }
        let ids: Vec<&[u8]> = blobs_to_read.iter().map(|it| it.1).collect();
        let input = [&ids.join(&b'\n')[..], b"\n"].concat();
        let read = self.git(&[b"cat-file", b"--batch"], &input)?;
        let mut rest = &read.stdout[..];
        for (path, id) in blobs_to_read {
            // The output is `<ID> blob <size>`, a line break, the content, a line break. In a partial clone it can be
            // `<ID> missing`.
            let content = strings::split_once_char(rest, b'\n').and_then(|(first, after)| {
                let size = strings::rsplit_once_char(first, b' ')?.1;
                after.split_at_checked(bun_core::fmt::parse_decimal::<usize>(size)?)
            });
            let Some((content, after)) = content.filter(|_| read.is_ok) else {
                let display_path = paths::relative(&self.environment.cwd, &path);
                let (display_path, id) = (bstr::BStr::new(&display_path), bstr::BStr::new(id));
                let first =
                    format!("--staged cannot read what is staged of {display_path} (blob {id})");
                return Err(with_git_stderr(&first, &read));
            };
            let content = with_checkout_line_endings(&path, content);
            self.index_contents.insert(path, content);
            rest = after.get(1..).unwrap_or_default();
        }
        Ok(())
    }

    /// Resolves `revision` to a commit ID. Later git calls only get the ID, because they could parse `revision` as a
    /// flag or a range.
    fn commit(&self, revision: &[u8]) -> Result<Vec<u8>, Fatal> {
        let unknown = || {
            let rest = b"\" is not a branch, tag or commit in this repository";
            Fatal([b"\"", revision, rest].concat())
        };
        if revision.starts_with(b"-") {
            return Err(unknown());
        }
        let name = [revision, b"^{commit}"].concat();
        let found = self.git(&[b"rev-parse", b"--verify", b"--quiet", &name], b"")?;
        object_id(&found).map(<[u8]>::to_vec).ok_or_else(unknown)
    }

    /// Returns the merge base of `HEAD` and the default branch.
    fn merge_base_with_default_branch(&self) -> Result<Vec<u8>, Fatal> {
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

    /// Takes what a file search went through: `links` are symlinks to directories, each with its real path.
    pub(crate) fn searched(&self, links: Vec<(Vec<u8>, Vec<u8>)>, named_a_file: bool) {
        // The search doesn't resolve a file that an argument names, so that path can go through a symlink too.
        let resolves = named_a_file || !links.is_empty();
        self.resolves.store(resolves, Ordering::Relaxed);
        let links = links.into_iter().map(|(link, real)| (link, Some(real)));
        self.real_directories.lock().extend(links);
    }

    /// Like [`Files::searched`], for a search that follows no symlink and doesn't resolve its `arguments`.
    #[optimize(size)]
    pub(crate) fn searched_unresolved(&self, arguments: &[Vec<u8>]) {
        // Only the working directory is known to be real.
        let cwd = &self.environment.cwd;
        let is_elsewhere = |it: &Vec<u8>| paths::resolve(cwd, &paths::from_native(it)) != *cwd;
        self.searched(Vec::new(), arguments.iter().any(is_elsewhere));
    }

    /// Returns `path` (absolute) spelled the way the lists spell it. An argument can reach the work tree through a
    /// symlink: `/tmp/repo/a.js` on macOS, or `$PWD/a.js` in a shell that got here through one. Only the directory is
    /// resolved, because a symlink to a file doesn't count as that file. A search says if it met one, so an ordinary
    /// run resolves nothing.
    fn as_listed<'p>(&self, path: &'p [u8]) -> Cow<'p, [u8]> {
        // A path that is listed or in the index is that file, even if a directory in it is now a symlink.
        let is_as_listed = !self.resolves.load(Ordering::Relaxed)
            || self.listed_paths.contains(path)
            || self.index_contents.contains_key(path);
        if is_as_listed {
            return Cow::Borrowed(path);
        }
        match self.real_directory(paths::dirname(path)) {
            Some(real) => Cow::Owned(paths::join(&real, file_name(path))),
            None => Cow::Borrowed(path),
        }
    }

    /// Returns the real path of `directory` (absolute) if it has a symlink in it. Each directory is resolved once.
    #[optimize(size)]
    fn real_directory(&self, directory: &[u8]) -> Option<Vec<u8>> {
        if let Some(real) = self.real_directories.lock().get(directory) {
            return real.clone();
        }
        let real = fs::real_path(directory).filter(|it| it != directory);
        (self.real_directories.lock()).insert(directory.to_vec(), real.clone());
        real
    }

    /// True if git listed the file at `path` (absolute). A symlink there doesn't count, even if it points to a file.
    pub(crate) fn has(&self, path: &[u8]) -> bool {
        // Few files are named like a listed one, so few directories are resolved after a search that met a symlink.
        self.names.contains(file_name(path))
            && self.listed_paths.contains(&*self.as_listed(path))
            && matches!(fs::link_kind_and_size(path), Some((fs::LinkKind::File, _)))
    }

    /// True if `path` (absolute) is the path that git has for a listed file, not another path to that file.
    pub(crate) fn is_git_path(&self, path: &[u8]) -> bool {
        self.listed_paths.contains(path)
    }

    /// Returns the staged files that exist only in the index, not on disk: absolute paths, each with the size of its
    /// text.
    pub(crate) fn not_on_disk(&self) -> impl Iterator<Item = (&[u8], u64)> {
        (self.not_on_disk.iter())
            .filter_map(|path| Some((&path[..], self.index_contents.get(path)?.len() as u64)))
    }

    /// True if writing `path` and staging it again would also stage changes the user didn't stage.
    pub(crate) fn is_partly_staged(&self, path: &[u8]) -> bool {
        self.staged_text(path).is_some()
    }

    /// Returns the text that will be committed for a [partly staged](Files::is_partly_staged) file. The file on disk
    /// differs.
    pub(crate) fn staged_text(&self, path: &[u8]) -> Option<&[u8]> {
        if self.index_contents.is_empty() {
            return None;
        }
        (self.index_contents.get(&*self.as_listed(path))).map(Vec::as_slice)
    }

    /// Returns the symlinks that lead to the directories in `real_directories`, each with its real path.
    #[optimize(size)]
    fn links(&self) -> Vec<(Vec<u8>, Vec<u8>)> {
        let resolved = self.real_directories.lock();
        let behind_links = resolved.iter().filter(|it| it.1.is_some());
        let behind_links: Vec<Vec<u8>> = behind_links.map(|it| it.0.clone()).collect();
        drop(resolved);
        let (mut links, mut seen) = (Vec::new(), FxHashSet::default());
        for directory in &behind_links {
            // The directories above it are behind the symlink too, up to the symlink itself.
            let behind = paths::ancestors(directory)
                .take_while(|it| seen.insert(*it))
                .map_while(|it| Some((it, self.real_directory(it)?)));
            for (directory, real) in behind {
                let above = self.real_directory(paths::dirname(directory));
                if above.is_none_or(|it| paths::join(&it, file_name(directory)) != real) {
                    links.push((directory.to_vec(), real));
                }
            }
        }
        links
    }

    /// Converts `index_contents` for code that follows imports, so an imported file is read as it will be committed,
    /// even if it isn't staged itself.
    #[optimize(size)]
    pub(crate) fn already_read(&self, keeps_byte_order_marks: bool) -> AlreadyRead {
        let read = |path: &[u8], text: &[u8]| {
            let text = as_read(path, text.to_vec(), keeps_byte_order_marks);
            (from_native(path), text)
        };
        let files = self.index_contents.iter();
        let mut files: AlreadyRead = files.map(|(path, text)| read(path, text)).collect();
        // A file behind a symlink to a directory names what it imports through that symlink.
        let links = (!files.is_empty()).then(|| self.links());
        for (link, real) in links.into_iter().flatten() {
            files.extend(self.index_contents.iter().filter_map(|(listed, text)| {
                let through = paths::join(&link, paths::inside(&real, listed)?);
                // Below a nearer symlink, or a directory that became one, the path is another file.
                let is_same = !self.index_contents.contains_key(&through)
                    && (self.real_directory(paths::dirname(&through)))
                        .is_none_or(|it| it == paths::dirname(listed));
                is_same.then(|| read(&through, text))
            }));
        }
        files
    }

    /// Message for a run with no files left. `verb` is what the run does to files, like "lint".
    pub(crate) fn no_files_message(&self, verb: &str) -> String {
        match self.only {
            Only::Staged => format!("No staged files to {verb}"),
            Only::Changed(_) => format!("No changed files to {verb}"),
        }
    }

    /// Explains why `files` (absolute paths, all [partly staged](Files::is_partly_staged)) weren't written. `done` is
    /// what didn't happen to them, like "fixed".
    #[optimize(size)]
    pub(crate) fn partly_staged_error(&self, files: &mut [Vec<u8>], done: &str) -> Vec<u8> {
        bun_lint::utils::sort::sort_unstable(files);
        let relative_paths = files
            .iter()
            .map(|it| paths::relative(&self.environment.cwd, it));
        let remedy: &[u8] =
            b"\n  Stage the rest with git add, or put it away with git stash --keep-index. Then run this again.";
        let reason: &[u8] = b" both staged and unstaged changes, so ";
        match files.len() {
            1 => [
                &relative_paths.collect::<Vec<_>>().concat()[..],
                b" has",
                reason,
                b"it was not ",
                done.as_bytes(),
                remedy,
            ]
            .concat(),
            count => {
                let mut text = [
                    count.to_string().as_bytes(),
                    b" files have",
                    reason,
                    b"they were not ",
                    done.as_bytes(),
                ]
                .concat();
                for name in relative_paths {
                    text.extend_from_slice(b"\n  ");
                    text.extend_from_slice(&name);
                }
                text.extend_from_slice(remedy);
                text
            }
        }
    }

    /// Re-stages `rewritten_files`: absolute paths of files that were fully staged and that this run rewrote. Same as
    /// `git add`, except that paths are never treated as patterns and there can be any number of them.
    pub(crate) fn stage(&self, rewritten_files: &[Vec<u8>]) -> Result<(), Fatal> {
        if *self.only != Only::Staged || rewritten_files.is_empty() {
            return Ok(());
        }
        let mut input = Vec::new();
        for path in rewritten_files {
            let path = self.as_listed(path);
            input.extend_from_slice(&paths::relative(&self.environment.cwd, &path));
            input.push(0);
        }
        let finished = self.git(&[b"update-index", b"-z", b"--stdin"], &input)?;
        match finished.is_ok {
            true => Ok(()),
            false => Err(with_git_stderr(
                "Cannot stage the files that were written\n  Stage them with git add",
                &finished,
            )),
        }
    }
}

/// Returns the text a run reads for the file at `path` (absolute): the staged text if there is one, otherwise the file
/// on disk.
pub(crate) fn read(only: Option<&Files>, path: &[u8]) -> bun_sys::Result<Vec<u8>> {
    match only.and_then(|it| it.staged_text(path)) {
        Some(text) if text.len() as u64 > bun_lint::fix::MAX_STRING_LENGTH => Err(
            bun_sys::Error::from_code(bun_sys::E::EFBIG, bun_sys::Tag::read),
        ),
        Some(text) => Ok(text.to_vec()),
        None => fs::read(path),
    }
}
