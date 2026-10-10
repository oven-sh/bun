//! Finds the files to lint: ESLint's `findFiles`.
//!
//! An argument is a file, a directory or a pattern. A file is taken as it is. A directory stands
//! for everything in it that the configuration has `files` for. Directories are listed on all
//! threads, one level of the tree at a time, and one that the configuration ignores is not entered.

use crate::configs::{Flavor, Loaded, Loader};
use crate::embedded::Framework;
use crate::gitignore::{self, Chain};
use crate::run::{Environment, Fatal, Pool};
use crate::{Linter, fs, paths};
use bun_core::strings;
use bun_glob::{Options, Pattern};
use bun_lint::js_plugin::{Host, Route};
use bun_lint::linter::config::Dotfiles;
use bun_lint::linter::{FileConfig, ResolvedConfig};
use bun_lint::modules::Listed;
use bun_threading::Guarded;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

/// What the configuration says about a file: ESLint's `getConfigStatus`.
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

/// A file to lint, or one that is named on the command line and is not linted.
pub(crate) struct Target {
    pub(crate) path: Vec<u8>,
    /// In bytes, when it was found.
    pub(crate) size: u64,
    pub(crate) loaded: Arc<Loaded>,
    pub(crate) status: Status,
}

impl Target {
    /// What kind of file with scripts in it this is, if these are what is linted.
    pub(crate) fn framework(&self) -> Option<Framework> {
        self.loaded.framework(&self.path)
    }

    /// How it is linted.
    pub(crate) fn route(&self) -> Route {
        match &self.status {
            Status::Matched(config) => self.loaded.routes(config, &self.path),
            _ => Route::Native,
        }
    }
}

/// A pattern, relative to the directory that is searched.
enum Matcher {
    /// `**`
    Everything,
    /// `new Minimatch(pattern, { dot: true })`
    Pattern(Pattern),
}

impl Matcher {
    fn new(relative: &[u8]) -> Matcher {
        match relative {
            b"**" => Matcher::Everything,
            relative => Matcher::Pattern(Pattern::new(relative, Options::MINIMATCH_DOT)),
        }
    }

    /// Whether something in the directory can match.
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
    /// As it is written.
    raw: Vec<u8>,
    /// It is a pattern. ESLint 8 lints all that one matches, and of a directory what it has `files` for.
    is_glob: bool,
}

/// ESLint's `GlobSearch`, with the directory.
struct Search {
    base_path: Vec<u8>,
    /// [`dotfiles_for`] the arguments.
    dotfiles: Dotfiles,
    patterns: Vec<Wanted>,
}

/// `dotfilesPattern` of ESLint 8: whether a name in `argument` starts with a dot, and is neither `.` nor `..`.
fn dotfiles_for(argument: &[u8]) -> Dotfiles {
    let is_one = |name: &[u8]| matches!(name, [b'.', next, ..] if !matches!(next, b'.' | b'\\'));
    match strings::split(argument, b"/").any(is_one) {
        true => Dotfiles::Linted,
        false => Dotfiles::AsConfigured,
    }
}

/// A directory on the way from where a search starts to one that is listed.
struct Way {
    /// Its path without links.
    real: Vec<u8>,
    /// The one that it was found in. `None`: the search starts here.
    above: Option<Arc<Way>>,
}

impl Way {
    /// Whether the directory at `real`, a path without links, is on the way.
    fn has(&self, real: &[u8]) -> bool {
        std::iter::successors(Some(self), |it| it.above.as_deref()).any(|it| it.real == real)
    }
}

/// A directory to list.
struct Directory {
    path: Vec<u8>,
    way: Arc<Way>,
    /// From the directory that is searched. Empty for that one.
    relative: Vec<u8>,
    /// The configuration of the directory that it is in or, for the one that is searched, its own.
    inherited: Arc<Loaded>,
    /// The ignore files above it or, for the one that is searched, also those in it. They are only
    /// read where they count.
    ignores: Chain,
    /// `inherited` ignores it. It is only read for the configuration files of oxlint in it and below it, each of which is asked
    /// alone about what it is nearest to.
    is_hidden: bool,
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

/// ESLint's `globMatch`: whether any file at all matches.
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

/// ESLint's `globSearch`. Adds the files to `found`. Returns the index of the first pattern that
/// has matched no file with a configuration.
fn search(
    loader: &Loader,
    pool: &Pool,
    search: &Search,
    found: &mut Vec<Target>,
) -> Result<Option<usize>, Fatal> {
    let matchers: Vec<Matcher> = (search.patterns.iter())
        .map(|it| Matcher::new(&paths::relative(&search.base_path, &it.pattern)))
        .collect();
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
        // From here on, a directory is only listed if it is not ignored.
        let is_hidden = (inherited.config).is_directory_ignored(&search.base_path, dotfiles);
        let name = paths::basename(&search.base_path);
        if !is_hidden || loader.looks_for_configurations_in(&inherited, name) {
            let real = fs::real_path(&search.base_path);
            level.push(Directory {
                path: search.base_path.clone(),
                way: Arc::new(Way {
                    real: real.unwrap_or_else(|| search.base_path.clone()),
                    above: None,
                }),
                relative: Vec::new(),
                ignores: loader.ignore_files_at(&search.base_path, &inherited),
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
            let is_hidden = directory.is_hidden && Arc::ptr_eq(&own, &directory.inherited);
            let reads_ignore_files = loader.reads_ignore_files(&own);
            let mut ignores = directory.ignores.clone();
            if reads_ignore_files && !loader.reads_ignore_files(&directory.inherited) {
                // They start to count here.
                ignores = loader.ignore_files_at(&directory.path, &own);
            } else if reads_ignore_files && !directory.relative.is_empty() {
                for name in loader
                    .ignore_file_names()
                    .iter()
                    .filter(|name| entries.iter().any(|it| it.name == **name))
                {
                    ignores = gitignore::with_file(
                        ignores,
                        &directory.path,
                        &paths::join(&directory.path, name),
                        true,
                    );
                }
            }
            let (mut files, mut directories) = (Vec::new(), Vec::new());
            for mut entry in entries {
                let path = paths::join(&directory.path, &entry.name);
                let mut real = None;
                // oxlint follows links. As for the crate `ignore`, with which it walks, a loop is a link to one of the
                // directories on the way from where the search starts.
                if entry.is_link
                    && own.flavor == Flavor::Oxlint
                    && fs::kind(&path) == Some(fs::Kind::Directory)
                {
                    real = fs::real_path(&path).filter(|real| !directory.way.has(real));
                    if real.is_none() {
                        continue;
                    }
                    entry.is_directory = true;
                }
                if reads_ignore_files && gitignore::is_ignored(&ignores, &path, entry.is_directory)
                {
                    continue;
                }
                let relative = match directory.relative.is_empty() {
                    true => entry.name.clone(),
                    false => paths::join(&directory.relative, &entry.name),
                };
                if entry.is_directory {
                    if !matchers.iter().any(|it| it.matches_partially(&relative)) {
                        continue;
                    }
                    let is_hidden =
                        is_hidden || own.config.is_directory_ignored_in(&path, dotfiles);
                    if !is_hidden || loader.looks_for_configurations_in(&own, &entry.name) {
                        let real =
                            real.unwrap_or_else(|| paths::join(&directory.way.real, &entry.name));
                        directories.push(Directory {
                            path,
                            way: Arc::new(Way {
                                real,
                                above: Some(Arc::clone(&directory.way)),
                            }),
                            relative,
                            inherited: Arc::clone(&own),
                            ignores: ignores.clone(),
                            is_hidden,
                        });
                    }
                    continue;
                }
                if is_hidden {
                    continue;
                }
                // What the configuration says about a file in a directory, and about one that a pattern of ESLint 8 selects.
                let (mut config, mut selected) = (None, None);
                let wanted = matchers.iter().zip(&search.patterns).zip(&is_matched);
                for ((matcher, wanted), is_matched) in wanted {
                    let selects = wanted.is_glob && own.flavor == Flavor::EslintRc;
                    let config = if selects { &mut selected } else { &mut config };
                    // The rest only matters as long as it is not known to match something.
                    if (config.is_some() && is_matched.load(Ordering::Relaxed))
                        || !matcher.matches(&relative)
                    {
                        continue;
                    }
                    let config = config.get_or_insert_with(|| {
                        match own.config.is_file_ignored_in(&path, dotfiles) {
                            true => FileConfig::Ignored,
                            false if selects => own.config.get_for_pattern(registry, &path),
                            false => own.config.get_unless_ignored(registry, &path),
                        }
                    });
                    if matches!(config, FileConfig::Matched(_)) {
                        is_matched.store(true, Ordering::Relaxed);
                    }
                }
                if let Some(FileConfig::Matched(config)) = selected.or(config) {
                    files.push(Target {
                        path,
                        size: listing.size_of(&entry.name),
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

/// What `new FileEnumerator({ extensions }).iterateFiles(patterns)` of ESLint 8 and 9 yields: from the working directory, by the
/// configuration files of ESLint 8, whatever configures the run and whatever its command line says. Sorted by path. `Err`: the
/// message of what it throws.
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
    let loader = Loader::of_eslint_8(linter, &options, environment, js_plugins);
    let patterns: Vec<Vec<u8>> = patterns.iter().map(|it| it.to_vec()).collect();
    let mut targets = find_files(&loader, pool, &patterns, true).map_err(|error| error.0)?;
    bun_lint::utils::sort::sort_by(&mut targets, |a, b| a.path.cmp(&b.path));
    // `ConfigurationNotFoundError`
    let mut directories = targets.iter().map(|it| paths::dirname(&it.path));
    let has_none = |it: &&[u8]| !paths::ancestors(it).any(crate::eslintrc::has_one);
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

/// ESLint's `findFiles`. `patterns`: the arguments. The files are in no particular order, and
/// each is there once.
pub(crate) fn find_files(
    loader: &Loader,
    pool: &Pool,
    patterns: &[Vec<u8>],
    error_on_unmatched_pattern: bool,
) -> Result<Vec<Target>, Fatal> {
    let cwd = &loader.environment().cwd;
    let mut found = Vec::new();
    let mut searches = vec![Search {
        base_path: cwd.clone(),
        dotfiles: Dotfiles::AsConfigured,
        patterns: Vec::new(),
    }];
    let mut add = |base_path: Vec<u8>, wanted: Wanted| {
        // It means nothing to other configurations: their arguments are searched for together.
        let is_for_eslint_8 = |base_path: &[u8]| {
            let loaded = loader.for_directory(base_path);
            loaded.is_ok_and(|it| it.flavor == Flavor::EslintRc)
        };
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
    let mut missing = None;
    for pattern in patterns {
        let pattern = paths::from_native(pattern);
        let path = paths::resolve(cwd, &pattern);
        match fs::kind_and_size(&path) {
            Some((fs::Kind::File, size)) => {
                let loaded = loader.for_directory(paths::dirname(&path))?;
                let status = match loader.ignores_named_file(&path, &loaded) {
                    true => Status::Ignored,
                    false => loaded.config.get(loader.linter.registry(), &path).into(),
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
    let mut unmatched = None;
    for (index, it) in searches
        .iter()
        .enumerate()
        .filter(|it| !it.1.patterns.is_empty())
    {
        if let Some(pattern) = search(loader, pool, it, &mut found)? {
            unmatched.get_or_insert((index, pattern));
        }
    }
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
