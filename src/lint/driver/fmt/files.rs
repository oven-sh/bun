//! Finds the files to format: `expandPatterns` of Prettier's command line, and what it ignores.

use super::cli::Options;
use super::config::{Configs, Scope};
use crate::gitignore::{self, Chain};
use crate::run::{Fatal, Pool};
use crate::{fs, paths};
use bun_core::strings;
use bun_lint::linter::Glob;
use bun_sema::util::FxHashSet;
use bun_threading::Guarded;
use std::cmp::Ordering;
use std::sync::Arc;

/// A file to format.
pub(crate) struct Target {
    pub(crate) path: Vec<u8>,
    /// In bytes, when it was found.
    pub(crate) size: u64,
    pub(crate) scope: Arc<Scope>,
    /// It is in a directory that is an argument: nothing is said if there is no parser for it.
    pub(crate) ignores_unknown: bool,
    /// It is an argument itself, so nothing has been asked yet about the directories that it is in.
    pub(crate) is_named: bool,
}

/// What the arguments stand for, in the order in which Prettier comes to it.
pub(crate) enum Expanded {
    File(Target),
    /// For the user. The exit code is 2.
    Error(Vec<u8>),
}

/// What kind of file a name stands for.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Language {
    /// JavaScript or TypeScript.
    Supported,
    /// Prettier formats it. This formatter does not.
    Other,
    /// Prettier has no parser for it either.
    Unknown,
}

pub(crate) fn language_of(path: &[u8]) -> Language {
    let name = paths::basename(path);
    let extension = strings::last_index_of_char(name, b'.').map_or(&b""[..], |dot| &name[dot + 1..]);
    match extension {
        b"js" | b"mjs" | b"cjs" | b"jsx" | b"ts" | b"mts" | b"cts" | b"tsx" => Language::Supported,
        b"css" | b"scss" | b"less" | b"pcss" | b"postcss" | b"json" | b"jsonc" | b"json5" | b"jsonl" | b"md" | b"markdown" | b"mdx"
        | b"yaml" | b"yml" | b"html" | b"htm" | b"xhtml" | b"vue" | b"graphql" | b"gql" | b"graphqls" | b"hbs" | b"handlebars"
        | b"webmanifest" | b"importmap" | b"code-workspace" | b"es6" | b"jsm" | b"wxs" | b"wxss" | b"mjml" => Language::Other,
        _ if matches!(name, b".prettierrc" | b".babelrc" | b".swcrc" | b".jshintrc" | b".lintstagedrc" | b".stylelintrc" | b".clang-format") => {
            Language::Other
        }
        _ => Language::Unknown,
    }
}

/// `a.localeCompare(b)` for what is ASCII: punctuation, then digits, then letters, and `a` before
/// `A` only if nothing else differs.
fn collate(a: &[u8], b: &[u8]) -> Ordering {
    const ORDER: &[u8] = b"\t\n\r _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$0123456789";
    let primary = |byte: u8| match strings::index_of_char_usize(ORDER, byte) {
        Some(at) => at as u16,
        None if byte.is_ascii_alphabetic() => 100 + u16::from(byte.to_ascii_lowercase()),
        None => 300 + u16::from(byte),
    };
    let by_letter = a.iter().map(|it| primary(*it)).cmp(b.iter().map(|it| primary(*it)));
    by_letter.then_with(|| b.cmp(a))
}

/// A path, in the order of [`collate`].
#[derive(PartialEq, Eq)]
struct Collated(Vec<u8>);

impl Ord for Collated {
    fn cmp(&self, other: &Collated) -> Ordering {
        collate(&self.0, &other.0)
    }
}

impl PartialOrd for Collated {
    fn partial_cmp(&self, other: &Collated) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// Which files are left out.
pub(crate) struct Ignored {
    /// `.git`, `node_modules`, ..
    directories: Vec<&'static [u8]>,
    /// The arguments that start with `!`, from the working directory.
    negative: Vec<Glob>,
    /// `.gitignore`, `.prettierignore`: a file is ignored if one of them says so.
    files: Vec<Chain>,
    cwd: Vec<u8>,
}

impl Ignored {
    pub(crate) fn new(options: &Options, cwd: &[u8]) -> Ignored {
        let mut directories: Vec<&[u8]> = vec![b".git", b".sl", b".svn", b".hg", b".jj"];
        if !options.with_node_modules {
            directories.push(b"node_modules");
        }
        let default = [b".gitignore".to_vec(), b".prettierignore".to_vec()];
        let files = options.ignore_path.as_deref().unwrap_or(&default).iter().map(|file| {
            let file = paths::resolve(cwd, &paths::from_native(file));
            gitignore::with_file(None, paths::dirname(&file), &file)
        });
        Ignored {
            directories,
            negative: Vec::new(),
            files: files.filter(Option::is_some).collect(),
            cwd: cwd.to_vec(),
        }
    }

    /// `DirectoryIgnorer.shouldIgnore`
    fn is_in_ignored_directory(&self, path: &[u8]) -> bool {
        strings::split(&paths::relative(&self.cwd, path), b"/").any(|name| self.directories.contains(&name))
    }

    fn is_negated(&self, path: &[u8]) -> bool {
        !self.negative.is_empty() && {
            let relative = paths::relative(&self.cwd, path);
            self.negative.iter().any(|it| it.matches(&relative))
        }
    }

    /// For what is come to by way of its directories, none of which is ignored.
    fn ignores_entry(&self, path: &[u8], name: &[u8], is_directory: bool, config: &Chain) -> bool {
        (is_directory && self.directories.contains(&name))
            || self.is_negated(path)
            || self.files.iter().chain([config]).any(|chain| gitignore::is_ignored(chain, path, is_directory))
    }

    /// Prettier's `isIgnored`, for any file.
    pub(crate) fn ignores_file(&self, path: &[u8], config: &Chain) -> bool {
        self.files.iter().chain([config]).any(|chain| gitignore::is_file_ignored_anywhere(chain, path))
    }
}

struct Directory {
    path: Vec<u8>,
    /// Of the directory that it is in or, for the one that is searched, its own.
    above: Arc<Scope>,
    is_first: bool,
}

/// The files in `base` that `matches` says yes to, given the path from the working directory.
fn search(
    configs: &Configs,
    pool: &Pool,
    ignored: &Ignored,
    base: &[u8],
    matches: &(dyn Fn(&[u8]) -> bool + Sync),
    enters: &(dyn Fn(&[u8]) -> bool + Sync),
) -> Result<Vec<Target>, Fatal> {
    let (mut found, mut failure) = (Guarded::new(Vec::new()), Guarded::new(None::<Fatal>));
    let mut level = vec![Directory {
        path: base.to_vec(),
        above: configs.for_directory(base)?,
        is_first: true,
    }];
    while !level.is_empty() && failure.lock().is_none() {
        let mut next = Guarded::new(Vec::new());
        pool.for_each(level.len(), 1, &|index| {
            let directory = &level[index];
            let Some(mut listing) = fs::list(&directory.path) else {
                return;
            };
            let entries = std::mem::take(&mut listing.entries);
            let scope = match directory.is_first {
                true => Ok(Arc::clone(&directory.above)),
                false => configs.for_listed_directory(&directory.path, entries.iter().map(|it| &it.name[..]), &directory.above),
            };
            let scope = match scope {
                Ok(scope) => scope,
                Err(error) => {
                    failure.lock().get_or_insert(error);
                    return;
                }
            };
            let of_config = scope.config.as_ref().map_or(&None, |it| &it.ignores);
            let (mut files, mut directories) = (Vec::new(), Vec::new());
            // Links are not followed, and not formatted.
            for entry in entries.iter().filter(|it| !it.is_link) {
                let path = paths::join(&directory.path, &entry.name);
                if ignored.ignores_entry(&path, &entry.name, entry.is_directory, of_config) {
                    continue;
                }
                let relative = paths::relative(&ignored.cwd, &path);
                if entry.is_directory {
                    if enters(&relative) {
                        directories.push(Directory {
                            path,
                            above: Arc::clone(&scope),
                            is_first: false,
                        });
                    }
                } else if matches(&relative) {
                    files.push(Target {
                        path,
                        size: listing.size_of(&entry.name),
                        scope: Arc::clone(&scope),
                        ignores_unknown: false,
                        is_named: false,
                    });
                }
            }
            if !files.is_empty() {
                found.lock().append(&mut files);
            }
            if !directories.is_empty() {
                next.lock().append(&mut directories);
            }
        });
        level = std::mem::take(next.get_mut());
    }
    match failure.get_mut().take() {
        Some(error) => Err(error),
        None => Ok(std::mem::take(found.get_mut())),
    }
}

enum Entry {
    File(Vec<u8>, u64),
    Directory(Vec<u8>),
    Pattern,
}

/// Prettier's `expandPatterns`. `patterns`: the arguments.
pub(crate) fn expand(
    configs: &Configs,
    pool: &Pool,
    ignored: &mut Ignored,
    patterns: &[Vec<u8>],
    error_on_unmatched_pattern: bool,
) -> Result<Vec<Expanded>, Fatal> {
    let cwd = ignored.cwd.clone();
    let mut expanded = Vec::new();
    let mut entries: Vec<(Entry, Vec<u8>)> = Vec::new();
    for pattern in patterns {
        let pattern = paths::from_native(pattern);
        let path = paths::resolve(&cwd, &pattern);
        if ignored.is_in_ignored_directory(&path) {
            continue;
        }
        match fs::link_kind_and_size(&path) {
            Some((fs::LinkKind::Link, _)) => {
                if error_on_unmatched_pattern {
                    expanded.push(Expanded::Error([b"Explicitly specified pattern \"", &pattern[..], b"\" is a symbolic link."].concat()));
                }
            }
            Some((fs::LinkKind::File, size)) => entries.push((Entry::File(path, size), pattern)),
            Some((fs::LinkKind::Directory, _)) => entries.push((Entry::Directory(path), pattern)),
            None => match pattern.strip_prefix(b"!") {
                Some(negative) => ignored.negative.push(Glob::new(negative)),
                None => entries.push((Entry::Pattern, pattern)),
            },
        }
    }
    let ignored = &*ignored;
    let mut seen: FxHashSet<Vec<u8>> = FxHashSet::default();
    for (entry, input) in entries {
        // What the paths that `fast-glob` returns start with, which they are sorted by.
        let mut written_base: (Vec<u8>, Vec<u8>) = (Vec::new(), cwd.clone());
        let (mut found, nothing): (Vec<Target>, &[u8]) = match entry {
            Entry::File(path, size) => {
                let found = match ignored.is_negated(&path) {
                    true => Vec::new(),
                    false => vec![Target {
                        scope: configs.for_directory(paths::dirname(&path))?,
                        path,
                        size,
                        ignores_unknown: false,
                        is_named: true,
                    }],
                };
                (found, b"Explicitly specified file was ignored due to negative glob patterns")
            }
            Entry::Directory(path) => {
                let mut found = search(configs, pool, ignored, &path, &|_| true, &|_| true)?;
                found.iter_mut().for_each(|it| it.ignores_unknown = true);
                written_base = (paths::relative(&cwd, &path), path);
                (found, b"No supported files were found in the directory")
            }
            Entry::Pattern => {
                let glob = Glob::new(&input);
                let parent = paths::glob_parent(&input);
                let base = paths::resolve(&cwd, &parent);
                if parent != b"." {
                    written_base = (parent, base.clone());
                }
                let found = match fs::kind(&base) {
                    Some(fs::Kind::Directory) => {
                        search(configs, pool, ignored, &base, &|relative| glob.matches(relative), &|relative| glob.matches_partially(relative))?
                    }
                    _ => Vec::new(),
                };
                (found, b"No files matching the pattern were found")
            }
        };
        if found.is_empty() {
            if error_on_unmatched_pattern {
                expanded.push(Expanded::Error([nothing, b": \"", &input, b"\"."].concat()));
            }
            continue;
        }
        let key = |target: &Target| match &written_base.0[..] {
            b"" => paths::relative(&written_base.1, &target.path),
            written => paths::join(written, &paths::relative(&written_base.1, &target.path)),
        };
        found.sort_by_cached_key(|target| Collated(key(target)));
        for target in found {
            if seen.insert(target.path.clone()) {
                expanded.push(Expanded::File(target));
            }
        }
    }
    if expanded.is_empty() && error_on_unmatched_pattern {
        let patterns = patterns.join(&b' ');
        expanded.push(Expanded::Error([b"No matching files. Patterns: ", &patterns[..]].concat()));
    }
    Ok(expanded)
}
