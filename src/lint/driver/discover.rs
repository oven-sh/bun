//! Finds the files to lint: ESLint's `findFiles`.
//!
//! An argument is a file, a directory or a pattern. A file is used as is. A directory means everything in it that the
//! configuration has `files` for. Directories are listed on all threads, one level of the tree at a time, and a
//! directory the configuration ignores isn't entered.

use crate::configs::{Flavor, Loaded, Loader, inherit_frameworks, read_frameworks};
use crate::embedded::Framework;
use crate::fmt::Exclusions;
use crate::gitignore::{self, Files};
use crate::run::{Environment, Fatal, Pool};
use crate::{Linter, fs, paths};
use bun_core::strings;
use bun_lint::glob::{Minimatch, MinimatchOptions};
use bun_lint::js_plugin::{Host, Route};
use bun_lint::linter::config::{Dotfiles, Seen};
use bun_lint::linter::{FileConfig, ResolvedConfig};
use bun_lint::modules::Listed;
use bun_lint::rule::Frameworks;
use bun_threading::Guarded;
use std::borrow::Cow;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};

/// A file's status under the configuration: ESLint's `getConfigStatus`.
#[derive(Clone)]
pub(crate) enum Status {
    Matched(Arc<ResolvedConfig>),
    Ignored,
    External,
    Unconfigured,
}

impl From<FileConfig> for Status {
    fn from(config: FileConfig) -> Status {
        match config {
            FileConfig::Matched(config) => Status::Matched(config),
            FileConfig::Ignored => Status::Ignored,
            FileConfig::External => Status::External,
            FileConfig::Unconfigured => Status::Unconfigured,
        }
    }
}

/// A file to lint, or one that was passed on the command line but isn't linted.
pub(crate) struct Target {
    pub(crate) path: Vec<u8>,
    /// Size in bytes when it was found.
    pub(crate) size: u64,
    pub(crate) loaded: Arc<Loaded>,
    pub(crate) status: Status,
}

impl Target {
    /// Its [`Framework`], if its embedded scripts are what gets linted.
    pub(crate) fn framework(&self) -> Option<Framework> {
        self.loaded.framework(&self.path)
    }

    /// How it's linted.
    pub(crate) fn route(&self) -> Route {
        match &self.status {
            Status::Matched(config) => self.loaded.routes(config, &self.path),
            _ => Route::Native,
        }
    }
}

/// A pattern, relative to the directory being searched.
enum Matcher {
    /// `**`
    Everything,
    Pattern(Minimatch),
}

impl Matcher {
    fn new(relative: &[u8]) -> Matcher {
        match relative {
            b"**" => Matcher::Everything,
            relative => {
                // `src/!(a).js` is searched for as `!(a).js`. Without `nonegate`, minimatch would read that as the
                // negation of `(a).js`.
                let (dot, nonegate) = (true, true);
                Matcher::Pattern(Minimatch::with(
                    relative,
                    MinimatchOptions {
                        dot,
                        nonegate,
                        ..MinimatchOptions::default()
                    },
                ))
            }
        }
    }

    /// True if something in the directory could match.
    fn matches_partially(&self, relative: &[u8]) -> bool {
        match self {
            Matcher::Everything => true,
            Matcher::Pattern(pattern) => pattern.may_match_inside(relative),
        }
    }

    fn matches(&self, relative: &[u8]) -> bool {
        match self {
            Matcher::Everything => true,
            Matcher::Pattern(pattern) => pattern.matches(relative),
        }
    }
}

/// An argument that is a directory or a pattern.
struct Wanted {
    /// Absolute.
    pattern: Vec<u8>,
    /// As written.
    raw: Vec<u8>,
    /// True if it's a pattern. ESLint 8 lints everything a pattern matches, but in a directory only what it has `files`
    /// for.
    is_glob: bool,
}

/// ESLint's `GlobSearch`, plus the directory.
struct Search {
    base_path: Vec<u8>,
    /// [`dotfiles_for`] of the arguments.
    dotfiles: Dotfiles,
    patterns: Vec<Wanted>,
}

/// ESLint 8's `dotfilesPattern`: checks whether a path segment in `argument` starts with a dot and is neither `.` nor
/// `..`.
fn dotfiles_for(argument: &[u8]) -> Dotfiles {
    let is_dotfile =
        |name: &[u8]| matches!(name, [b'.', next, ..] if !matches!(next, b'.' | b'\\'));
    match strings::split(argument, b"/").any(is_dotfile) {
        true => Dotfiles::Linted,
        false => Dotfiles::AsConfigured,
    }
}

/// A directory on the path from a search's starting directory to a listed directory.
struct Trail {
    /// Its real path, with symlinks resolved.
    real: Vec<u8>,
    /// The directory it was found in. `None` if the search starts here.
    above: Option<Arc<Trail>>,
}

impl Trail {
    /// True if the directory at the real path `real` is on this path.
    fn has(&self, real: &[u8]) -> bool {
        std::iter::successors(Some(self), |it| it.above.as_deref()).any(|it| it.real == real)
    }
}

/// A directory to list.
struct Directory {
    path: Vec<u8>,
    trail: Arc<Trail>,
    /// Relative to the directory being searched. Empty for that directory.
    relative: Vec<u8>,
    /// Its parent directory's configuration or, for the directory being searched, its own.
    inherited: Arc<Loaded>,
    /// `inherited`'s [`Seen`] for this directory, if it's already known.
    seen: Option<Seen>,
    /// The ignore files in its parent directories and, for the directory being searched, also its own. They're only
    /// read where they apply.
    ignores: Files,
    /// True if `inherited` ignores it. It's then only read for the oxlint configuration files in and below it, each of
    /// which is the only config consulted for the files it's nearest to.
    is_hidden: bool,
    /// [`Loader::detect_frameworks`] of the parent directory, or of the directory itself if it's the search root.
    frameworks: Frameworks,
}

fn no_files_found(pattern: &[u8]) -> Fatal {
    Fatal(
        [
            b"No files matching the pattern \"",
            pattern,
            b"\" were found.\nPlease check for typing mistakes in the pattern.",
        ]
        .concat(),
    )
}

/// The error Node's `fs.statSync(path)` throws.
fn cannot_follow(code: &str, label: &str, path: &[u8]) -> Fatal {
    let path = paths::to_native(path.to_vec());
    let parts = [
        code.as_bytes(),
        b": ",
        label.as_bytes(),
        b", stat '",
        &path,
        b"'",
    ];
    Fatal(parts.concat())
}

/// ESLint 8's `statSafeSync`: `None` if nothing exists at `path`.
fn eslint_8_stat_error(error: &bun_sys::Error, path: &[u8]) -> Option<Fatal> {
    let (code, label) = error.uv_code_label()?;
    (error.get_errno() != bun_sys::E::ENOENT).then(|| cannot_follow(code, label, path))
}

/// ESLint's `assertConfigurationExists`, for the file at `path`.
fn config_file_missing(path: &[u8]) -> Fatal {
    let path = paths::to_native(path.to_vec());
    let start: &[u8] = b"Could not find config file.\n  No eslint.config.* was found next to ";
    Fatal([start, &path[..], b" or in a parent directory."].concat())
}

fn all_files_ignored(pattern: &[u8]) -> Fatal {
    let text = br#"You are linting "$", but all of the files matching the glob pattern "$" are ignored.

If you don't want to lint these files, remove the pattern "$" from the list of arguments.

If you do want to lint these files, explicitly list one or more of the files from this glob that you'd like to lint to see more details about why they are ignored.

  * If the file is ignored because of a matching ignore pattern, check global ignores in your config file.
    https://eslint.org/docs/latest/use/configure/ignore

  * If the file is ignored because no matching configuration was supplied, check file patterns in your config file.
    https://eslint.org/docs/latest/use/configure/configuration-files#specify-files-with-arbitrary-extensions

  * If the file is ignored because it is located outside of the base path, change the location of your config file to be in a parent directory."#;
    Fatal(bun_core::strings::replace_owned(text, b"$", pattern))
}

/// ESLint's `globMatch`: true if any file at all matches.
fn matches_any_file(base_path: &[u8], matcher: &Matcher) -> bool {
    let mut pending = vec![(base_path.to_vec(), Vec::new())];
    while let Some((path, relative)) = pending.pop() {
        for entry in fs::list(&path).map_or_else(Vec::new, |it| it.entries) {
            let relative = if relative.is_empty() {
                entry.name.clone()
            } else {
                paths::join(&relative, &entry.name)
            };
            if entry.is_directory {
                if matcher.matches_partially(&relative) {
                    pending.push((paths::join(&path, &entry.name), relative));
                }
            } else if matcher.matches(&relative) {
                return true;
            }
        }
    }
    false
}

/// ESLint's `globSearch`. Adds the files to `found`. Returns the index of the first pattern that didn't match any file
/// with a configuration.
fn search(
    loader: &Loader,
    pool: &Pool,
    search: &Search,
    exclusions: &Exclusions,
    are_all_in_repositories: &(dyn Fn() -> bool + Sync),
    found: &mut Vec<Target>,
) -> Result<Option<usize>, Fatal> {
    let matchers: Vec<Matcher> = (search.patterns.iter())
        .map(|it| Matcher::new(&paths::relative(&search.base_path, &it.pattern)))
        .collect();
    let matches_everything = (matchers.iter()).all(|it| matches!(it, Matcher::Everything));
    let dotfiles = search.dotfiles;
    let is_matched: Vec<AtomicBool> = matchers.iter().map(|_| AtomicBool::new(false)).collect();
    let registry = loader.linter.registry();
    let (mut all_found, mut failure) = (
        Guarded::new(std::mem::take(found)),
        Guarded::new(None::<Fatal>),
    );
    let mut level = Vec::new();
    if fs::kind(&search.base_path) == Some(fs::Kind::Directory) {
        let inherited = loader.for_directory(&search.base_path)?;
        // From here on, a directory is only listed if it isn't ignored. ESLint always lists the starting directory,
        // because the base path can be further down.
        let is_hidden = (inherited.config).is_directory_ignored(&search.base_path, dotfiles)
            && !inherited.config.is_outside(&search.base_path);
        let name = paths::basename(&search.base_path);
        if (!is_hidden || loader.looks_for_configurations_in(&inherited, name))
            && let Some(ignores) =
                loader.ignore_files_at(&search.base_path, &inherited, are_all_in_repositories)
        {
            let real = fs::real_path(&search.base_path);
            if loader.collects_tsconfigs() {
                (loader.searched_from.lock()).push(search.base_path.clone());
            }
            level.push(Directory {
                path: search.base_path.clone(),
                trail: Arc::new(Trail {
                    real: real.unwrap_or_else(|| search.base_path.clone()),
                    above: None,
                }),
                relative: Vec::new(),
                seen: None,
                ignores,
                frameworks: loader.detect_frameworks(&inherited, &search.base_path),
                inherited,
                is_hidden,
            });
        }
    }
    while !level.is_empty() && failure.lock().is_none() {
        let mut next = Guarded::new(Vec::new());
        pool.for_each(level.len(), 1, &|index| {
            let directory = &level[index];
            let Some(mut listing) = fs::list(&directory.path) else {
                return;
            };
            let entries = std::mem::take(&mut listing.entries);
            if loader.collects_tsconfigs() {
                // TypeScript reads one even if an ignore file excludes it. The consumer knows whether file names are
                // case-sensitive here.
                let names = [&b"tsconfig.json"[..], b"jsconfig.json"];
                let files = entries.iter().filter(|it| !it.is_directory);
                for file in
                    files.filter(|it| names.iter().any(|name| it.name.eq_ignore_ascii_case(name)))
                {
                    (loader.tsconfigs.lock()).push(paths::join(&directory.path, &file.name));
                }
            }
            let own = match directory.relative.is_empty() {
                true => Ok(Arc::clone(&directory.inherited)),
                false => {
                    let files = entries
                        .iter()
                        .filter(|it| !it.is_directory)
                        .map(|it| &it.name[..]);
                    loader.for_listed_directory(&directory.path, files, &directory.inherited)
                }
            };
            let own = match own {
                Ok(own) => own,
                Err(error) => {
                    failure.lock().get_or_insert(error);
                    return;
                }
            };
            // ESLint looks up the configuration for anything that isn't a directory, whatever its name.
            let lacks_file = loader.lacks_eslint_config_file(&own);
            if lacks_file && let Some(file) = entries.iter().find(|it| !it.is_directory) {
                let path = paths::join(&directory.path, &file.name);
                failure.lock().get_or_insert(config_file_missing(&path));
                return;
            }
            let is_hidden = directory.is_hidden && Arc::ptr_eq(&own, &directory.inherited);
            // The listing already tells us whether there's a package.json, so most directories inherit the answer.
            let has_package = || entries.iter().any(|it| it.name == b"package.json");
            let detects = !directory.relative.is_empty() && own.flavor == Flavor::BuiltIn;
            let decides = detects && has_package();
            let own_frameworks = decides.then(|| read_frameworks(&directory.path)).flatten();
            let is_repository_root = detects
                && entries
                    .iter()
                    .any(|it| matches!(&it.name[..], b".git" | b".jj"));
            let frameworks =
                inherit_frameworks(directory.frameworks, own_frameworks, is_repository_root);
            let reads_ignore_files = loader.reads_ignore_files(&own);
            let mut ignores = directory.ignores.clone();
            if reads_ignore_files && !loader.reads_ignore_files(&directory.inherited) {
                // Ignore files start to apply here.
                match loader.ignore_files_at(&directory.path, &own, are_all_in_repositories) {
                    Some(own) => ignores = own,
                    None => return,
                }
            } else if reads_ignore_files && !directory.relative.is_empty() {
                let has = |name: &[u8]| entries.iter().any(|it| it.name == name);
                ignores = ignores.and_in(&directory.path, loader.ignore_file_name(&own), has);
            }
            let (mut files, mut directories) = (Vec::new(), Vec::new());
            let seen = match &directory.seen {
                Some(seen) if Arc::ptr_eq(&own, &directory.inherited) => seen,
                _ => &own.config.see(&directory.path),
            };
            let within = own.config.within(&directory.path, seen);
            let mut within = within.with_frameworks(frameworks);
            for mut entry in entries {
                let path = paths::join(&directory.path, &entry.name);
                let (mut real, mut is_loop) = (None, false);
                // ESLint treats a link as a file, and finds out what it is when it reads it. ESLint 8 and oxlint
                // resolve the link and follow it. As in the `ignore` crate, which oxlint walks with, a loop is a link
                // to one of the directories on the path from the search's starting directory.
                if entry.is_link && own.flavor != Flavor::Eslint {
                    match fs::link_target_kind(&path) {
                        Ok(Some(fs::Kind::Directory)) => {
                            let Some(end) = fs::real_path(&path) else {
                                continue;
                            };
                            is_loop = directory.trail.has(&end);
                            if is_loop && own.flavor != Flavor::EslintRc {
                                continue;
                            }
                            (real, entry.is_directory) = (Some(end), true);
                        }
                        Ok(_) => {}
                        Err(error) => {
                            // ESLint 8 throws regardless of the link's name.
                            if own.flavor == Flavor::EslintRc
                                && let Some(thrown) = eslint_8_stat_error(&error, &path)
                            {
                                failure.lock().get_or_insert(thrown);
                                return;
                            }
                            // A dangling link is skipped.
                            continue;
                        }
                    }
                }
                if reads_ignore_files && ignores.is_ignored(&path, entry.is_directory) {
                    continue;
                }
                if exclusions.matches(&loader.environment().cwd, &path) {
                    continue;
                }
                let relative = match directory.relative.is_empty() {
                    _ if !entry.is_directory && matches_everything => Vec::new(),
                    true => entry.name.clone(),
                    false => paths::join(&directory.relative, &entry.name),
                };
                if entry.is_directory {
                    if !matchers.iter().any(|it| it.matches_partially(&relative)) {
                        continue;
                    }
                    let cwd = &loader.environment().cwd[..];
                    let is_hidden = is_hidden
                        || within.is_directory_ignored(&path, dotfiles)
                        || lacks_file && !paths::is_at_or_inside(cwd, &path);
                    if !is_hidden || loader.looks_for_configurations_in(&own, &entry.name) {
                        // ESLint 8 keeps following the loop until the system returns ELOOP.
                        if is_loop {
                            let label = "too many symbolic links encountered";
                            failure
                                .lock()
                                .get_or_insert(cannot_follow("ELOOP", label, &path));
                            return;
                        }
                        let real =
                            real.unwrap_or_else(|| paths::join(&directory.trail.real, &entry.name));
                        directories.push(Directory {
                            seen: Some(within.see_child(&path)),
                            path,
                            trail: Arc::new(Trail {
                                real,
                                above: Some(Arc::clone(&directory.trail)),
                            }),
                            relative,
                            inherited: Arc::clone(&own),
                            ignores: ignores.clone(),
                            is_hidden,
                            frameworks,
                        });
                    }
                    continue;
                }
                if is_hidden {
                    continue;
                }
                // The file's configuration as a file in a directory, and as a file selected by an ESLint 8 pattern.
                let (mut config, mut selected) = (None, None);
                let wanted = matchers.iter().zip(&search.patterns).zip(&is_matched);
                for ((matcher, wanted), is_matched) in wanted {
                    let selects = wanted.is_glob && own.flavor == Flavor::EslintRc;
                    let config = if selects { &mut selected } else { &mut config };
                    // The rest only matters until the pattern is known to match something.
                    if (config.is_some() && is_matched.load(Ordering::Relaxed))
                        || !matcher.matches(&relative)
                    {
                        continue;
                    }
                    let config = config
                        .get_or_insert_with(|| within.get(registry, &path, dotfiles, selects));
                    if matches!(config, FileConfig::Matched(_)) {
                        is_matched.store(true, Ordering::Relaxed);
                    }
                }
                if let Some(FileConfig::Matched(config)) = selected.or(config)
                    && let Some(size) = listing.size_of(&entry.name)
                {
                    files.push(Target {
                        path,
                        size,
                        loaded: Arc::clone(&own),
                        status: Status::Matched(config),
                    });
                }
            }
            if !files.is_empty() {
                all_found.lock().append(&mut files);
            }
            if !directories.is_empty() {
                next.lock().append(&mut directories);
            }
        });
        level = std::mem::take(next.get_mut());
    }
    *found = std::mem::take(all_found.get_mut());
    match failure.get_mut().take() {
        Some(error) => Err(error),
        None => Ok(is_matched.iter().position(|it| !it.load(Ordering::Relaxed))),
    }
}

/// Returns what ESLint 8 and 9's `new FileEnumerator({ extensions }).iterateFiles(patterns)` yields. It searches from
/// the working directory using ESLint 8's configuration files, regardless of the run's own configuration and command
/// line. Sorted by path. `Err` has the message of the error it throws.
pub(crate) fn list_as_eslint_8(
    (linter, environment, js_plugins): (&Linter, &Environment, &Host),
    pool: &Pool,
    patterns: &[&[u8]],
    extensions: &[&[u8]],
) -> Result<Vec<Listed>, Vec<u8>> {
    let options = crate::cli::Options {
        ext: Some(extensions.iter().map(|it| it.to_vec()).collect()),
        ..Default::default()
    };
    let loader = Loader::for_eslint_8(linter, &options, environment, js_plugins);
    let patterns: Vec<Vec<u8>> = patterns.iter().map(|it| it.to_vec()).collect();
    let mut targets = find_files(&loader, pool, &patterns, true).map_err(|error| error.0)?;
    bun_lint::utils::sort::sort_by(&mut targets, |a, b| a.path.cmp(&b.path));
    // `ConfigurationNotFoundError`
    let mut directories = targets.iter().map(|it| paths::dirname(&it.path));
    let has_none = |it: &&[u8]| !paths::ancestors(it).any(crate::eslintrc::has_eslintrc_file);
    if let Some(directory) = directories.find(has_none) {
        return Err([b"No ESLint configuration found in ", directory, b"."].concat());
    }
    let listed = targets.into_iter().filter_map(|it| {
        let is_ignored = match it.status {
            Status::Matched(_) => false,
            Status::Ignored => true,
            Status::External | Status::Unconfigured => return None,
        };
        Some(Listed {
            path: it.path,
            is_ignored,
        })
    });
    Ok(listed.collect())
}

/// Splits the arguments in `patterns` into those that select files and those that exclude files. An argument excludes
/// files if it starts with `!` and no file or directory has that name, as in `bun fmt`. ESLint rejects these arguments
/// and oxlint ignores them. If every argument is an exclusion, oxfmt searches the working directory, so a run with an
/// oxlint config does too.
fn split_exclusions<'p>(
    loader: &Loader,
    patterns: &'p [Vec<u8>],
) -> (Cow<'p, [Vec<u8>]>, Exclusions) {
    let mut exclusions = Exclusions::default();
    if !patterns.iter().any(|it| it.starts_with(b"!")) {
        return (Cow::Borrowed(patterns), exclusions);
    }
    let cwd = &loader.environment().cwd;
    let mut selecting = Vec::new();
    for raw_pattern in patterns {
        let pattern = paths::from_native(raw_pattern);
        match pattern.strip_prefix(b"!") {
            Some(rest) if fs::kind(&paths::resolve(cwd, &pattern)).is_none() => {
                exclusions.push(rest)
            }
            _ => selecting.push(raw_pattern.clone()),
        }
    }
    if selecting.is_empty()
        && (loader.for_directory(cwd)).is_ok_and(|it| it.flavor == Flavor::Oxlint)
    {
        selecting.push(b".".to_vec());
    }
    (Cow::Owned(selecting), exclusions)
}

/// ESLint's `findFiles`. `patterns` is the list of arguments. The files are in no particular order, without duplicates.
pub(crate) fn find_files(
    loader: &Loader,
    pool: &Pool,
    patterns: &[Vec<u8>],
    error_on_unmatched_pattern: bool,
) -> Result<Vec<Target>, Fatal> {
    let cwd = &loader.environment().cwd;
    let first = patterns.first();
    let (patterns, exclusions) = split_exclusions(loader, patterns);
    let patterns = &patterns[..];
    if let (true, Some(first)) = (patterns.is_empty() && error_on_unmatched_pattern, first) {
        return Err(no_files_found(first));
    }
    let mut found = Vec::new();
    let mut searches = vec![Search {
        base_path: cwd.clone(),
        dotfiles: Dotfiles::AsConfigured,
        patterns: Vec::new(),
    }];
    let is_for_eslint_8 = |base_path: &[u8]| {
        let loaded = loader.for_directory(base_path);
        loaded.is_ok_and(|it| it.flavor == Flavor::EslintRc)
    };
    let mut add = |base_path: Vec<u8>, wanted: Wanted| {
        // Other configurations ignore it, so their arguments are searched together.
        let dotfiles = match dotfiles_for(&wanted.raw) {
            Dotfiles::Linted if is_for_eslint_8(&base_path) => Dotfiles::Linted,
            _ => Dotfiles::AsConfigured,
        };
        let at = searches
            .iter()
            .position(|it| it.base_path == base_path && it.dotfiles == dotfiles)
            .unwrap_or_else(|| {
                searches.push(Search {
                    base_path,
                    dotfiles,
                    patterns: Vec::new(),
                });
                searches.len() - 1
            });
        searches[at].patterns.push(wanted);
    };
    // This has to happen before any configuration lookup.
    for pattern in patterns {
        let path = paths::resolve(cwd, &paths::from_native(pattern));
        match fs::kind(&path) {
            Some(fs::Kind::File) => loader.name(paths::dirname(&path)),
            Some(fs::Kind::Directory) => loader.name(&path),
            None => {}
        }
    }
    let (mut missing, mut excluded_argument) = (None, None);
    for pattern in patterns {
        let pattern = paths::from_native(pattern);
        let path = paths::resolve(cwd, &pattern);
        let existing = fs::kind_and_size(&path);
        if existing.is_none()
            && let Err(error) = fs::link_target_kind(&path)
            && let Some(thrown) = eslint_8_stat_error(&error, &path)
            && is_for_eslint_8(paths::dirname(&path))
        {
            return Err(thrown);
        }
        match existing {
            Some((fs::Kind::File, _)) if exclusions.matches(cwd, &path) => {
                excluded_argument.get_or_insert(pattern);
            }
            Some((fs::Kind::File, size)) => {
                let loaded = loader.for_directory(paths::dirname(&path))?;
                if loader.lacks_eslint_config_file(&loaded) {
                    return Err(config_file_missing(&path));
                }
                let status = match loader.ignores_named_file(&pattern, &path, &loaded) {
                    true => Status::Ignored,
                    false => loader.config_of(&loaded, &path).into(),
                };
                found.push(Target {
                    path,
                    size,
                    loaded,
                    status,
                });
            }
            Some((fs::Kind::Directory, _)) => {
                let everything = paths::join(&path, b"**");
                add(
                    path,
                    Wanted {
                        pattern: everything,
                        raw: pattern,
                        is_glob: false,
                    },
                )
            }
            None if bun_glob::scan::is_glob(&pattern) => add(
                paths::resolve(cwd, &bun_glob::scan::glob_parent(&pattern)),
                Wanted {
                    pattern: path,
                    raw: pattern,
                    is_glob: true,
                },
            ),
            None => {
                missing.get_or_insert(pattern);
            }
        }
    }
    if let Some(missing) = missing
        && error_on_unmatched_pattern
    {
        return Err(no_files_found(&missing));
    }
    if let Some(excluded_argument) = excluded_argument
        && error_on_unmatched_pattern
    {
        return Err(all_files_ignored(&excluded_argument));
    }
    let mut unmatched = None;
    let wanted = || searches.iter().filter(|it| !it.patterns.is_empty());
    let are_all_in_repositories = LazyLock::new(|| {
        let named = found
            .iter()
            .filter(|it| !matches!(it.status, Status::Ignored));
        (found.is_empty() && wanted().count() == 1)
            || gitignore::are_all_in_repositories(
                wanted().map(|it| &it.base_path[..]),
                named.map(|it| paths::dirname(&it.path)),
            )
    });
    let mut searched = Vec::new();
    for (index, it) in searches
        .iter()
        .enumerate()
        .filter(|it| !it.1.patterns.is_empty())
    {
        if let Some(pattern) = search(
            loader,
            pool,
            it,
            &exclusions,
            &|| *are_all_in_repositories,
            &mut searched,
        )? {
            unmatched.get_or_insert((index, pattern));
        }
    }
    drop(are_all_in_repositories);
    found.append(&mut searched);
    if let Some((index, pattern)) = unmatched
        && error_on_unmatched_pattern
    {
        let (search, wanted) = (&searches[index], &searches[index].patterns[pattern]);
        let matcher = Matcher::new(&paths::relative(&search.base_path, &wanted.pattern));
        return Err(match matches_any_file(&search.base_path, &matcher) {
            true => all_files_ignored(&wanted.raw),
            false => no_files_found(&wanted.raw),
        });
    }
    bun_lint::utils::sort::sort_by(&mut found, |a, b| a.path.cmp(&b.path));
    found.dedup_by(|a, b| a.path == b.path);
    Ok(found)
}

/// Returns the `files` that [`find_files`] would find if they were on disk. `files` are absolute paths, each with the
/// size of its text. `--staged` reads them from the index. A file is included if it's an argument, is inside a
/// directory argument, or matches a pattern, and neither the config nor an ignore file excludes it.
pub(crate) fn find_files_not_on_disk<'f>(
    loader: &Loader,
    patterns: &[Vec<u8>],
    files: impl Iterator<Item = (&'f [u8], u64)>,
) -> Result<Vec<Target>, Fatal> {
    let cwd = &loader.environment().cwd;
    let (patterns, exclusions) = split_exclusions(loader, patterns);
    // A search doesn't enter an excluded directory.
    let is_excluded = |file: &[u8]| paths::ancestors(file).any(|it| exclusions.matches(cwd, it));
    let is_wanted = |file: &[u8]| {
        !is_excluded(file)
            && patterns.iter().any(|pattern| {
                let pattern = paths::from_native(pattern);
                let resolved = paths::resolve(cwd, &pattern);
                if paths::is_at_or_inside(&resolved, file) {
                    return true;
                }
                let base_path = paths::resolve(cwd, &bun_glob::scan::glob_parent(&pattern));
                bun_glob::scan::is_glob(&pattern)
                    && paths::inside(&base_path, file).is_some_and(|relative| {
                        Matcher::new(&paths::relative(&base_path, &resolved)).matches(relative)
                    })
            })
    };
    let mut found = Vec::new();
    for (file, size) in files.filter(|it| is_wanted(it.0)) {
        let directory = paths::dirname(file);
        let loaded = loader.for_directory(directory)?;
        if loader.lacks_eslint_config_file(&loaded) {
            return Err(config_file_missing(file));
        }
        let is_ignored = (loader.ignore_files_at(directory, &loaded, &|| true)).is_none_or(|it| {
            it.is_ignored(file, false)
                || paths::ancestors(directory).any(|above| it.is_ignored(above, true))
        });
        if !is_ignored && let FileConfig::Matched(config) = loader.config_of(&loaded, file) {
            found.push(Target {
                path: file.to_vec(),
                size,
                loaded,
                status: Status::Matched(config),
            });
        }
    }
    Ok(found)
}
