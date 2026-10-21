//! The module graph for cross-file rules. This is the implementation of `bun_lint::modules::Modules`.
//!
//! ```ignore
//! let store = Store::new(cwd);
//! let graph = Graph::new(&store);
//! // On any thread, for each file:
//! file.set_modules(&graph);
//! linter.lint(&file, ..);
//! // After every file is linted. This is a no-op if no rule recorded anything.
//! for path in graph.complete(&|count, work| pool.for_each(count, 1, work)) {
//!     // Lint the file at `path` again, with the cross-file rules.
//! }
//! ```
//!
//! Specifiers are resolved the way `bun check` resolves them, with the `tsconfig.json` closest to the file. That covers
//! `paths`, `./a.js` for `./a.ts`, `exports` and `imports` in `package.json`, and symbolic links. Each directory is
//! listed only once. For oxlint, specifiers are resolved the way Node.js resolves them, after `paths`. See
//! [`AsRequire::as_import`].

#![forbid(unsafe_code)]
#![deny(clippy::iter_over_hash_type)]

use bun_core::strings;
use bun_glob::{BunGlobWalker, Pattern};
use bun_lint::ast::File;
use bun_lint::language::{LanguageOptions, Parser};
use bun_lint::modules::{
    Declaration, Flavor, Import, ListFiles, Listed, Lookup, MakeRecord, ModuleId, Modules, Reader,
    Record, Request, RequestKind, ResolveBy, Resolved, requests_of,
};
use bun_lint::paths::{is_absolute, relative};
use bun_sema::atom::Interner;
use bun_sema::bind::{BindOptions, Recycled, bind_for_lint_in};
use bun_sema::config::{
    Project, find_config, find_config_file, load_overriding,
    resolve_config_file_name_of_project_reference, without_config,
};
use bun_sema::hir::ResolutionMode;
use bun_sema::json::Json;
use bun_sema::resolve::{AsRequire, Host, Resolver, ScriptKind, ancestors, join, typescript_path};
use bun_sema::session::Session;
use bun_sema::util::{FxHashMap, ShardedMap};
use bun_sema_driver::host::{AlreadyRead, Disk, from_argument, from_native};
use bun_threading::Guarded;
use smallvec::SmallVec;
use std::any::Any;
use std::borrow::Cow;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};

/// The data a [`Graph`] borrows from. It costs nothing until a rule queries it.
pub struct Store {
    session: Session,
    disk: OnceLock<Disk>,
    already_read: OnceLock<AlreadyRead>,
    cwd: Vec<u8>,
    /// If no tsconfig.json is configured, use the one nearest to the file, like TypeScript, instead of the one in
    /// `cwd`, like eslint-import-resolver-typescript.
    uses_nearest_tsconfig: bool,
    /// `--tsconfig`. oxlint uses it to resolve the imports of every file outside `node_modules`, and doesn't look for
    /// any other.
    tsconfig: Option<Vec<u8>>,
}

impl Store {
    /// `cwd` is a directory on the file system that the files are on.
    pub fn new(cwd: &[u8]) -> Store {
        Store {
            session: Session::new(),
            disk: OnceLock::new(),
            already_read: OnceLock::new(),
            cwd: from_native(cwd),
            uses_nearest_tsconfig: false,
            tsconfig: None,
        }
    }

    /// `path` is the path as given on the command line.
    pub fn with_tsconfig(self, path: &[u8]) -> Store {
        let path = from_argument(&self.cwd, path);
        Store {
            tsconfig: Some(resolve_config_file_name_of_project_reference(&path)),
            ..self
        }
    }

    /// For a run without an ESLint or oxlint config. See `uses_nearest_tsconfig`.
    pub fn with_nearest_tsconfig(self) -> Store {
        Store {
            uses_nearest_tsconfig: true,
            ..self
        }
    }

    /// Makes the store read the files in `already_read` from memory instead of from disk. Call it before any rule
    /// queries the store.
    pub fn provide(&self, already_read: AlreadyRead) {
        let _ = self.already_read.set(already_read);
    }

    fn disk(&self) -> &Disk {
        self.disk.get_or_init(|| {
            let already_read = self.already_read.get().cloned().unwrap_or_default();
            Disk::with_already_read(1, already_read, &self.cwd).started_in(&self.cwd)
        })
    }
}

/// A file's imports, before the files are assigned IDs.
struct Recorded<'h> {
    path: Vec<u8>,
    /// The path that each request resolves to, with its declaration and kind.
    requests: Vec<(Cow<'h, [u8]>, Declaration, RequestKind)>,
    is_always_checked: bool,
    /// The path it's linted under, if it's one of the linted files.
    linted_as: Option<Vec<u8>>,
    /// If `linted_as` is a symbolic link: the paths that the requests resolve to from the link's location.
    found_from_link: Vec<Vec<u8>>,
}

#[derive(Default)]
struct Complete {
    ids: FxHashMap<Vec<u8>, ModuleId>,
    paths: Vec<Vec<u8>>,
    imports: Vec<Vec<Import>>,
    components: Vec<u32>,
}

/// The extensions that oxlint tries, in oxlint's order.
const EXTENSIONS: [&[u8]; 8] = [
    b".js", b".mjs", b".cjs", b".jsx", b".ts", b".mts", b".cts", b".tsx",
];

struct ProjectResolver<'h> {
    resolver: Resolver<'h>,
    /// `baseUrl`, which TypeScript 7 dropped but ESLint's and oxlint's resolvers still support.
    base_url: Option<Vec<u8>>,
    /// The raw value from the config.
    es_module_interop: bool,
}

/// Caches for lookups that are repeated often.
#[derive(Default)]
struct Caches<'h> {
    /// Keyed by the `tsconfig.json` path. An empty key means there's none.
    resolvers: ShardedMap<Vec<u8>, ProjectResolver<'h>>,
    /// Maps a directory to the `tsconfig.json` path for its files. With [`Store::tsconfig`], the key is a file.
    configs: ShardedMap<Vec<u8>, Vec<u8>>,
    /// Caches [`Graph::scopes_in`] and [`Graph::scopes_of`].
    scopes: ShardedMap<Vec<u8>, Vec<Scope>>,
    /// Caches [`Graph::configs_of_typescript_resolver`], keyed by the directory and the projects, and
    /// [`Graph::listed_projects`], keyed by the projects.
    typescript_configs: ShardedMap<Vec<u8>, Vec<Vec<u8>>>,
    /// The resolution of a non-relative specifier, keyed by the `tsconfig.json`, the directory, the kind of import and
    /// the specifier.
    non_relative: ShardedMap<Vec<u8>, Option<(Vec<u8>, bool)>>,
    /// Maps a path to its real path, with symbolic links followed.
    real_paths: ShardedMap<Vec<u8>, Vec<u8>>,
    /// The closest `package.json`, by directory.
    packages: ShardedMap<Vec<u8>, Option<Json>>,
    /// For [`Modules::record_exports`]. Keyed by the real path, followed by a `\0` for a script that isn't the first in
    /// its file. `None` means the file can't be parsed.
    records: ShardedMap<Vec<u8>, Option<Record>>,
    /// For [`Modules::facts`]. Keyed by the path and the parse options.
    facts: ShardedMap<Vec<u8>, Option<Box<dyn Any + Send + Sync>>>,
}

pub struct Graph<'h> {
    store: &'h Store,
    /// Created on first use, because most runs have no cross-file rule and the tables are large.
    caches: OnceLock<Box<Caches<'h>>>,
    loading: Guarded<()>,
    recorded: Guarded<Vec<Recorded<'h>>>,
    record_maker: OnceLock<MakeRecord>,
    lister: OnceLock<ListFiles<'h>>,
    /// [`Modules::resolve_by`]
    resolver: OnceLock<ResolveBy>,
    /// [`Modules::follow_packages`]
    follows_packages: AtomicBool,
    /// [`Flavor::Oxlint`]
    follows_oxlint: AtomicBool,
    complete: OnceLock<Complete>,
}

/// Parses `text` as the file at `path`, binds it without type information, and calls `then` with the file, which has
/// `modules` set. Returns `None` if the code is nested too deeply.
fn with_file<R>(
    path: &[u8],
    text: &[u8],
    language: &LanguageOptions,
    modules: Option<&dyn Modules>,
    then: impl for<'a> FnOnce(&'a File<'a>) -> R,
) -> Option<R> {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let arena = session.arena();
    let how = language.parse_options(path);
    let mut hir = bun_sema_parser::summarize_as(
        how.dialect,
        arena,
        path,
        how.script_kind,
        text,
        &atoms,
        how.experimental_decorators,
        how.every_file_is_a_module,
    );
    hir.text = Cow::Borrowed(text);
    let bind_options = BindOptions {
        emit_standard_class_fields: true,
        before_es2020: false,
        before_es2017: false,
    };
    let mut recycled = Recycled::for_current_thread();
    let bound = bind_for_lint_in(&hir, bind_options, &atoms, &mut recycled);
    if hir.ran_out_of_stack || bound.ran_out_of_stack {
        return None;
    }
    let file = File::new(path, &hir, bound, &atoms, language, None);
    if let Some(modules) = modules {
        file.set_modules(modules);
    }
    Some(then(&file))
}

/// Calls the function with every index below the count, on any number of threads.
pub type Parallel<'p> = &'p dyn Fn(usize, &(dyn Fn(usize) + Sync));

/// The set of files a `tsconfig.json` applies to, as decided by oxc-resolver, which oxlint uses. TypeScript decides
/// this differently.
struct Scope {
    /// Empty if the config can't be read. It then applies to every file.
    config: Vec<u8>,
    /// `baseUrl`, or else the config's directory.
    base: Vec<u8>,
    files: Vec<Vec<u8>>,
    /// Absolute patterns. The flag is true if the pattern ends in a `*`, in which case it only matches JavaScript and
    /// TypeScript files.
    include: Vec<(Pattern, bool)>,
    exclude: Vec<Pattern>,
    allows_js: bool,
}

impl Scope {
    const BROKEN: Scope = Scope {
        config: Vec::new(),
        base: Vec::new(),
        files: Vec::new(),
        include: Vec::new(),
        exclude: Vec::new(),
        allows_js: false,
    };

    fn new(project: &Project) -> Scope {
        let directory = directory_of(&project.config_path);
        let absolute = |relative_path: &[u8]| match relative_path.strip_prefix(b"${configDir}") {
            Some(rest) => join(directory, rest.strip_prefix(b"/").unwrap_or(rest)),
            None => join(directory, relative_path),
        };
        let pattern = |config_glob: &Vec<u8>| {
            let mut path = absolute(config_glob);
            // A last segment without a `.` or a wildcard is treated as a directory.
            let last = &path[directory_of(&path).len()..];
            if !strings::contains_any(last, b".*?") {
                path.extend_from_slice(b"/**/*");
            }
            (
                Pattern::new(&bun_glob::pattern::of_fast_glob(&path)),
                path.ends_with(b"*"),
            )
        };
        let patterns =
            |config_globs: &[Vec<u8>]| config_globs.iter().map(pattern).collect::<Vec<_>>();
        let raw_config = &project.written;
        let everything = [b"**/*".to_vec()];
        let include = match (&raw_config.include, &raw_config.files) {
            (Some(include), _) => &include[..],
            (None, Some(_)) => &[],
            (None, None) => &everything[..],
        };
        let allow_js = (project.raw_compiler_options.iter()).find(|it| it.0 == b"allowJs");
        let base_url = (project.raw_compiler_options.iter()).find(|it| it.0 == b"baseUrl");
        Scope {
            config: project.config_path.clone(),
            base: (base_url.and_then(|it| it.1.as_str()))
                .unwrap_or(directory)
                .to_vec(),
            files: (raw_config.files.iter().flatten())
                .map(|it| absolute(it))
                .collect(),
            include: patterns(include),
            exclude: (patterns(raw_config.exclude.as_deref().unwrap_or_default()).into_iter())
                .map(|it| it.0)
                .collect(),
            allows_js: allow_js.is_some_and(|it| it.1 == Json::Bool(true)),
        }
    }

    fn has(&self, path: &[u8]) -> bool {
        if self.config.is_empty() || self.files.iter().any(|it| it == path) {
            return true;
        }
        let extension =
            strings::last_index_of_char(path, b'.').map_or(&b""[..], |dot| &path[dot + 1..]);
        let is_js = matches!(extension, b"js" | b"jsx" | b"mjs" | b"cjs");
        if is_js && !self.allows_js {
            return false;
        }
        let is_script = is_js || matches!(extension, b"ts" | b"tsx" | b"mts" | b"cts");
        let mut include = self.include.iter().filter(|it| is_script || !it.1);
        include.any(|it| it.0.matches(path)) && !self.exclude.iter().any(|it| it.matches(path))
    }
}

fn directory_of(path: &[u8]) -> &[u8] {
    match strings::last_index_of_char(path, b'/') {
        Some(0) | None => b"/",
        Some(slash) => &path[..slash],
    }
}

fn is_in_package(path: &[u8]) -> bool {
    strings::contains(path, b"/node_modules/")
}

/// oxlint treats any other file as if it didn't exist.
fn is_read_by_oxlint(path: &[u8]) -> bool {
    let others: [&[u8]; 3] = [b".vue", b".astro", b".svelte"];
    EXTENSIONS
        .iter()
        .chain(&others)
        .any(|it| path.ends_with(it))
}

impl<'h> Graph<'h> {
    pub fn new(store: &'h Store) -> Graph<'h> {
        Graph {
            store,
            caches: OnceLock::new(),
            loading: Guarded::new(()),
            recorded: Guarded::new(Vec::new()),
            record_maker: OnceLock::new(),
            lister: OnceLock::new(),
            resolver: OnceLock::new(),
            follows_packages: AtomicBool::new(false),
            follows_oxlint: AtomicBool::new(false),
            complete: OnceLock::new(),
        }
    }

    /// Sets the function that implements [`Modules::list_files`]. Without it no files are found.
    pub fn list_files_by(&self, lister: ListFiles<'h>) {
        let _ = self.lister.set(lister);
    }

    fn caches(&self) -> &Caches<'h> {
        self.caches.get_or_init(Box::default)
    }

    /// Returns a module's path as stored here: in the checker's format, where a drive's root is `/C:`.
    fn stored_path(&self, module: ModuleId) -> &[u8] {
        self.complete
            .get()
            .and_then(|it| it.paths.get(module.0 as usize))
            .map_or(&[], |it| &it[..])
    }

    fn load_project(&self, config: &[u8], directory: &[u8]) -> Project {
        let flag = |name: &[u8]| (name.to_vec(), Json::Bool(true));
        let word = |name: &[u8], word: &[u8]| (name.to_vec(), Json::String(word.to_vec()));
        // These override the project's options. JavaScript is linted too, and the resolvers emulated here ignore
        // TypeScript's resolution options.
        //
        // oxlint's `condition_names` are `module` and `import`.
        let conditions = match self.flavor().resolves_as_node() {
            true => vec![Json::String(b"module".to_vec())],
            false => Vec::new(),
        };
        let overrides = || {
            vec![
                flag(b"allowJs"),
                flag(b"resolveJsonModule"),
                flag(b"allowImportingTsExtensions"),
                word(b"module", b"esnext"),
                word(b"moduleResolution", b"bundler"),
                (
                    b"customConditions".to_vec(),
                    Json::Array(conditions.clone()),
                ),
            ]
        };
        let (disk, session) = (self.store.disk(), &self.store.session);
        let loaded = (!config.is_empty()).then(|| {
            load_overriding(&WithoutListings(disk), session, config, &|_| overrides()).ok()
        });
        loaded.flatten().unwrap_or_else(|| {
            // Pass a file, so that the directory isn't searched for files.
            without_config(
                &WithoutListings(disk),
                directory,
                Json::Object(overrides()),
                vec![b"index.ts".to_vec()],
            )
        })
    }

    /// Returns the `tsconfig.json` in `directory`, if there is one, preceded by the configs it references, because
    /// oxlint checks those first. References of references aren't followed.
    fn scopes_in(&self, directory: &[u8]) -> &[Scope] {
        match self.caches().scopes.get_ref(directory) {
            Some(scopes) => scopes,
            None => self.load_scopes(directory, &join(directory, b"tsconfig.json")),
        }
    }

    /// The same for the config at `config`, whatever its file name.
    fn scopes_of(&self, config: &[u8]) -> &[Scope] {
        match self.caches().scopes.get_ref(config) {
            Some(scopes) => scopes,
            None => self.load_scopes(config, config),
        }
    }

    fn load_scopes(&self, key: &[u8], config: &[u8]) -> &[Scope] {
        let caches = self.caches();
        let _loading = self.loading.lock();
        if let Some(scopes) = caches.scopes.get_ref(key) {
            return scopes;
        }
        let disk = WithoutListings(self.store.disk());
        let load = |config: &[u8]| {
            let project = load_overriding(&disk, &self.store.session, config, &|_| Vec::new());
            project.ok().map(|it| Scope::new(&it))
        };
        let project = (disk.is_file(config))
            .then(|| load_overriding(&disk, &self.store.session, config, &|_| Vec::new()).ok());
        let scopes = project.flatten().map_or_else(Vec::new, |project| {
            let referenced = project.references.iter();
            let referenced =
                referenced.map(|it| load(&resolve_config_file_name_of_project_reference(&it.path)));
            let own = Some(Scope::new(&project));
            let all: Option<Vec<Scope>> = referenced.chain([own]).collect();
            all.unwrap_or_else(|| vec![Scope::BROKEN])
        });
        caches.scopes.insert_ref(key.to_vec(), scopes)
    }

    /// Returns the `tsconfig.json`, or else the `jsconfig.json`, in `directory`.
    fn config_in(&self, directory: &[u8]) -> Option<Vec<u8>> {
        let names = [&b"tsconfig.json"[..], b"jsconfig.json"];
        let mut paths = names.iter().map(|name| join(directory, name));
        paths.find(|it| self.store.disk().is_file(it))
    }

    /// eslint-import-resolver-typescript 4's `normalizeOptions`: returns the configs that its `project` option lists.
    fn listed_projects(&self, projects: &[&[u8]]) -> &[Vec<u8>] {
        let key = [&b"\0"[..], &projects.join(&b"\0"[..])[..]].concat();
        if let Some(listed) = self.caches().typescript_configs.get_ref(&key[..]) {
            return listed;
        }
        let (cwd, disk) = (&self.store.cwd[..], self.store.disk());
        let mut named: Vec<Vec<u8>> = Vec::new();
        for project in projects {
            if !strings::contains_any(project, b"*?[{(!") {
                named.push(join(cwd, project));
                continue;
            }
            // Match hidden entries and directories too.
            let is_ignored = |name: &[u8]| name == b"node_modules";
            let (cwd, is_ignored) = (typescript_path(cwd), Some(is_ignored as fn(&[u8]) -> bool));
            let walker = BunGlobWalker::init_with_cwd(
                project, cwd, true, true, false, false, false, is_ignored,
            );
            let Ok(Ok(mut walker)) = walker else {
                continue;
            };
            let mut matches = bun_glob::walk::Iterator::new(&mut walker);
            if matches!(matches.init(), Ok(Ok(()))) {
                while let Ok(Ok(Some(path))) = matches.next() {
                    named.push(from_native(&path.into_vec()));
                }
            }
        }
        // `tryFile`
        let try_file = |path: Vec<u8>| match disk.is_file(&path) {
            true => Some(path),
            false => self.config_in(&path),
        };
        let listed = named.into_iter().filter_map(try_file).collect();
        self.caches().typescript_configs.insert_ref(key, listed)
    }

    /// Returns the configs whose `paths` eslint-import-resolver-typescript 4 tries for `from`'s imports, in its order.
    /// An empty path means no config. `projects` is its `project` option.
    fn configs_of_typescript_resolver(&self, projects: &[&[u8]], from: &[u8]) -> &[Vec<u8>] {
        let directory = directory_of(from);
        let key = [directory, b"\0", &projects.join(&b"\0"[..])[..]].concat();
        if let Some(configs) = self.caches().typescript_configs.get_ref(&key[..]) {
            return configs;
        }
        let mut listed = self.listed_projects(projects).to_vec();
        // `computeAffinity`
        let distance = |config: &Vec<u8>| {
            let (mut a, mut b) = (
                strings::split(directory_of(config), b"/"),
                strings::split(directory, b"/"),
            );
            let (mut left, mut right) = (a.next(), b.next());
            while left.is_some() && left == right {
                (left, right) = (a.next(), b.next());
            }
            left.iter().count() + a.count() + right.iter().count() + b.count()
        };
        bun_lint::utils::sort::sort_by_key(&mut listed, distance);
        listed.dedup();
        let applies_to_file =
            |it: &Vec<u8>| self.scopes_of(it).last().is_some_and(|own| own.has(from));
        let chosen = match listed.len() {
            0 if self.store.uses_nearest_tsconfig => {
                let mut above = bun_lint::paths::ancestors(directory);
                above
                    .find_map(|it| self.config_in(it))
                    .into_iter()
                    .collect()
            }
            0 => self.config_in(&self.store.cwd).into_iter().collect(),
            1 => listed,
            _ => match listed.iter().position(applies_to_file) {
                Some(at) => vec![listed.swap_remove(at)],
                None => listed,
            },
        };
        let mut configs = Vec::new();
        for config in chosen {
            // `references: "auto"`
            let referenced = self
                .scopes_of(&config)
                .split_last()
                .map_or(&[][..], |it| it.1);
            let contains_directory = |it: &&Scope| {
                let rest = directory.strip_prefix(&it.base[..]);
                !it.config.is_empty() && rest.is_some_and(|it| matches!(it, [] | [b'/', ..]))
            };
            configs.extend(
                referenced
                    .iter()
                    .find(contains_directory)
                    .map(|it| it.config.clone()),
            );
            configs.push(config);
        }
        if configs.is_empty() {
            configs.push(Vec::new());
        }
        self.caches().typescript_configs.insert_ref(key, configs)
    }

    /// Returns the `tsconfig.json` that applies to the imports of the file `from`, or an empty path if there's none.
    fn config_of(&self, from: &[u8]) -> &[u8] {
        let directory = directory_of(from);
        if !self.flavor().resolves_as_node() {
            let caches = self.caches();
            return match caches.configs.get_ref(directory) {
                Some(config) => config,
                None => {
                    let found = find_config(self.store.disk(), directory).unwrap_or_default();
                    caches.configs.insert_ref(directory.to_vec(), found)
                }
            };
        }
        if let Some(config) = &self.store.tsconfig {
            let scopes = self.scopes_of(config).split_last();
            let Some((own, referenced)) = scopes.filter(|_| !is_in_package(from)) else {
                return b"";
            };
            if referenced.is_empty() {
                return &own.config;
            }
            let caches = self.caches();
            return match caches.configs.get_ref(from) {
                Some(config) => config,
                None => {
                    let file_scope = referenced.iter().find(|it| it.has(from)).unwrap_or(own);
                    let config = file_scope.config.clone();
                    caches.configs.insert_ref(from.to_vec(), config)
                }
            };
        }
        for directory in ancestors(directory) {
            if let Some(scope) = self.scopes_in(directory).iter().find(|it| it.has(from)) {
                return &scope.config;
            }
            if directory.ends_with(b"/node_modules") {
                break;
            }
        }
        b""
    }

    /// Returns the resolver for the files that the config at `config` applies to. An empty `config` means no config.
    /// `directory` is the directory of one of those files.
    fn resolver_of(&self, config: &[u8], directory: &[u8]) -> &ProjectResolver<'h> {
        let caches = self.caches();
        if let Some(resolver) = caches.resolvers.get_ref(config) {
            return resolver;
        }
        // One thread reads a config while the others that need it wait.
        let _loading = self.loading.lock();
        if let Some(resolver) = caches.resolvers.get_ref(config) {
            return resolver;
        }
        let store: &'h Store = self.store;
        let mut project = self.load_project(config, directory);
        let raw_option = |name: &[u8]| {
            let mut options = project.raw_compiler_options.iter();
            options.find(|it| it.0 == name).map(|it| &it.1)
        };
        let base_url = raw_option(b"baseUrl")
            .and_then(Json::as_str)
            .map(<[u8]>::to_vec);
        let es_module_interop = raw_option(b"esModuleInterop") == Some(&Json::Bool(true));
        if let Some(base_url) = &base_url {
            project.options.paths_base_dir.clone_from(base_url);
        }
        let project = store.session.keep(project);
        let resolver = Resolver::new(&store.session, store.disk(), &project.options);
        let resolver = ProjectResolver {
            resolver,
            base_url,
            es_module_interop,
        };
        caches.resolvers.insert_ref(config.to_vec(), resolver)
    }

    /// `configured_paths` is the `paths` option, whose entries are relative to the working directory.
    fn resolve_as_require(
        &self,
        (specifier, from): (&[u8], &[u8]),
        extensions: &[&[u8]],
        configured_paths: &[&[u8]],
        module_directories: &[&[u8]],
    ) -> Option<Vec<u8>> {
        let (cwd, disk) = (&self.store.cwd[..], self.store.disk());
        // `resolve`'s `loadpkg` walks up from where the file would be until it finds a `package.json`. On a relative
        // path it never gets past `.` and overflows the stack there, so nothing is found in that entry or in any later
        // one.
        let terminates = |path: &[u8], configured_path: &[u8]| {
            let candidate = join(path, specifier);
            let directory = directory_of(&candidate);
            let is_end = |it: &[u8]| {
                it.ends_with(b"/node_modules") || disk.is_file(&join(it, b"package.json"))
            };
            let below = ancestors(directory).take_while(|it| !cwd.starts_with(it));
            is_absolute(configured_path)
                || !disk.is_dir(directory)
                || below.chain([cwd]).any(is_end)
        };
        let paths = configured_paths.iter().map(|it| (join(cwd, it), *it));
        let paths: SmallVec<[Vec<u8>; 2]> = (paths
            .take_while(|it| terminates(&it.0, it.1))
            .map(|it| it.0))
        .collect();
        let paths: SmallVec<[&[u8]; 2]> = paths.iter().map(Vec::as_slice).collect();
        let how = AsRequire {
            extensions,
            module_directories,
            paths: &paths,
            through_paths: false,
            as_import: false,
            base_url: None,
        };
        // No TypeScript config applies here.
        let plain = self.resolver_of(b"", cwd);
        let (found, at) = (plain.resolver).resolve_as_require(specifier, from, &how)?;
        // `path.join(configured_paths, specifier)`
        let is_relative = at
            .and_then(|at| configured_paths.get(at))
            .is_some_and(|it| !is_absolute(it));
        Some(match is_relative {
            true => relative(cwd, &found),
            false => found,
        })
    }

    /// Resolves what eslint-import-resolver-typescript finds and TypeScript doesn't: a file by its full name, whatever
    /// its extension, or with one of `extensions` appended. This also goes through `paths` and `baseUrl`.
    fn resolve_other_file(
        &self,
        config: &[u8],
        (specifier, from): (&[u8], &[u8]),
        extensions: &[&[u8]],
    ) -> Option<Vec<u8>> {
        let ProjectResolver {
            resolver, base_url, ..
        } = self.resolver_of(config, directory_of(from));
        let how = AsRequire {
            extensions,
            module_directories: &[b"node_modules"],
            paths: &[],
            through_paths: true,
            as_import: false,
            base_url: None,
        };
        let from_base_url = || {
            let base_url = base_url
                .as_ref()
                .filter(|_| !specifier.starts_with(b".") && !specifier.starts_with(b"/"))?;
            resolver.resolve_as_require(&join(base_url, specifier), from, &how)
        };
        let found = resolver.resolve_as_require(specifier, from, &how);
        Some(found.or_else(from_base_url)?.0)
    }

    /// Returns the path that identifies the file linted as `path`. oxlint follows links. eslint-plugin-import
    /// identifies a linted file by its name, so a link to another file is a separate module.
    fn identity_path(&self, path: &[u8]) -> Vec<u8> {
        let path = from_native(path);
        match self.flavor() {
            Flavor::Oxlint => self.store.disk().realpath(&path),
            Flavor::EslintPluginImport => path,
        }
    }

    fn flavor(&self) -> Flavor {
        if self.follows_oxlint.load(Ordering::Relaxed) {
            Flavor::Oxlint
        } else {
            Flavor::EslintPluginImport
        }
    }

    /// Returns the path, and true if it was found in a `node_modules`.
    fn resolve_path(
        &self,
        from: &[u8],
        specifier: &[u8],
        is_require: bool,
    ) -> Option<(Cow<'h, [u8]>, bool)> {
        // No system allows a path that long, and the lookup walks up directory by directory.
        if specifier.len() > 4096 {
            return None;
        }
        if let (Flavor::EslintPluginImport, Some(by)) = (self.flavor(), self.resolver.get()) {
            let found = (by.resolve)(self, typescript_path(from), specifier, is_require)?;
            return Some((Cow::Owned(join(&self.store.cwd, &found)), false));
        }
        self.resolve_any_path(self.config_of(from), from, specifier, is_require)
            .filter(|it| !self.flavor().resolves_as_node() || is_read_by_oxlint(&it.0))
    }

    fn resolve_any_path(
        &self,
        config: &[u8],
        from: &[u8],
        specifier: &[u8],
        is_require: bool,
    ) -> Option<(Cow<'h, [u8]>, bool)> {
        let is_relative = specifier.starts_with(b"./")
            || specifier.starts_with(b"../")
            || matches!(specifier, b"." | b"..");
        if is_relative {
            if self.flavor().resolves_as_node()
                && let Some(found) = self.resolve_relative_as_node(from, specifier)
            {
                return found.map(|it| (Cow::Owned(it), false));
            }
            return self.resolve_with_project(config, from, specifier, is_require);
        }
        // A non-relative specifier resolves the same way in every file of a directory with the same `tsconfig.json`,
        // and it's slow to resolve.
        let key = [
            config,
            b"\0",
            directory_of(from),
            if is_require { b"\0r\0" } else { b"\0i\0" },
            specifier,
        ]
        .concat();
        let found = match self.caches().non_relative.get_ref(&key[..]) {
            Some(found) => found,
            None => {
                let found = self
                    .resolve_with_project(config, from, specifier, is_require)
                    .map(|it| (it.0.into_owned(), it.1));
                self.caches().non_relative.insert_ref(key, found)
            }
        };
        found.as_ref().map(|it| (Cow::Owned(it.0.clone()), it.1))
    }

    /// Resolves a relative specifier the way oxlint does, without going through TypeScript's resolution. The outer
    /// `None` means this fast path can't decide.
    fn resolve_relative_as_node(&self, from: &[u8], specifier: &[u8]) -> Option<Option<Vec<u8>>> {
        let disk = self.store.disk();
        let base = join(directory_of(from), specifier);
        let file = |path: Vec<u8>| disk.is_file(&path).then_some(path);
        let aliases: [(&[u8], [&[u8]; 2]); 3] = [
            (b".js", [b".js", b".ts"]),
            (b".mjs", [b".mjs", b".mts"]),
            (b".cjs", [b".cjs", b".cts"]),
        ];
        let found = match aliases.iter().find(|it| base.ends_with(it.0)) {
            Some((specifier_extension, tried)) => tried.iter().find_map(|it| {
                file([&base[..base.len() - specifier_extension.len()], it].concat())
            }),
            None => {
                let as_file = || {
                    file(base.clone()).or_else(|| {
                        EXTENSIONS
                            .iter()
                            .find_map(|it| file([&base[..], it].concat()))
                    })
                };
                let mut found = if specifier.ends_with(b"/") {
                    None
                } else {
                    as_file()
                };
                if found.is_none() && disk.is_dir(&base) {
                    // A `package.json` with an entry point isn't handled here.
                    let has_entry_point = |text: Cow<[u8]>| {
                        let manifest = bun_lint::json::parse(&text);
                        manifest.is_none_or(|it| {
                            it.get(b"module").or_else(|| it.get(b"main")).is_some()
                        })
                    };
                    let manifest = join(&base, b"package.json");
                    if disk.is_file(&manifest) && disk.read(&manifest).is_none_or(has_entry_point) {
                        return None;
                    }
                    found = EXTENSIONS
                        .iter()
                        .find_map(|it| file([&base[..], b"/index", it].concat()));
                }
                found
            }
        };
        Some(found.map(|path| self.real(path)))
    }

    fn resolve_with_project(
        &self,
        config: &[u8],
        from: &[u8],
        specifier: &[u8],
        is_require: bool,
    ) -> Option<(Cow<'h, [u8]>, bool)> {
        let mode = if is_require {
            ResolutionMode::Require
        } else {
            ResolutionMode::Import
        };
        let ProjectResolver {
            resolver, base_url, ..
        } = self.resolver_of(config, directory_of(from));
        let base_url = base_url
            .as_ref()
            .filter(|_| !specifier.starts_with(b".") && !specifier.starts_with(b"/"));
        // TypeScript resolves to the types. oxlint reads the code.
        if self.flavor().resolves_as_node() {
            let how = AsRequire {
                extensions: &EXTENSIONS,
                module_directories: &[b"node_modules"],
                paths: &[],
                through_paths: true,
                as_import: true,
                base_url: base_url.map(Vec::as_slice),
            };
            let code = self.real(resolver.resolve_as_require(specifier, from, &how)?.0);
            let is_external = is_in_package(&code);
            return Some((Cow::Owned(code), is_external));
        }
        let found = resolver
            .resolve_module_name(specifier, from, mode)
            .or_else(|| resolver.resolve_module_name(&join(base_url?, specifier), from, mode))?;
        Some((
            Cow::Borrowed(found.file_name),
            found.is_external_library_import,
        ))
    }

    /// Returns `path` with symbolic links followed.
    fn real(&self, path: Vec<u8>) -> Vec<u8> {
        match self.caches().real_paths.get_ref(&path[..]) {
            Some(real) => real.clone(),
            None => {
                let real = self.store.disk().realpath(&path);
                self.caches().real_paths.insert_ref(path, real).clone()
            }
        }
    }

    fn make_record(
        &self,
        path: Vec<u8>,
        requests: &[Request],
        is_always_checked: bool,
        linted_as: Option<Vec<u8>>,
    ) -> Recorded<'h> {
        let resolved = requests.iter().filter_map(|it| {
            let declaration = Declaration {
                specifier: it.specifier.into(),
                line: it.line,
                is_dynamic: it.kind == RequestKind::Dynamic,
                is_only_importing_types: it.is_only_importing_types,
            };
            let resolved = self
                .resolve_path(&path, it.specifier, it.kind == RequestKind::Other)?
                .0;
            (!(it.may_reexport_itself && *resolved == *path)).then_some((
                resolved,
                declaration,
                it.kind,
            ))
        });
        let link = linted_as.as_deref().map(from_native);
        let found_from = |link: Vec<u8>| {
            let found = requests.iter().filter_map(|it| {
                self.resolve_path(&link, it.specifier, it.kind == RequestKind::Other)
            });
            found.map(|it| it.0.into_owned()).collect()
        };
        Recorded {
            requests: resolved.collect(),
            found_from_link: link
                .filter(|it| *it != path)
                .map_or_else(Vec::new, found_from),
            path,
            is_always_checked,
            linted_as,
        }
    }

    /// Reads the imports of the file at `path`, which isn't linted.
    fn read(&self, path: &[u8]) -> Option<Recorded<'h>> {
        let text = self.store.disk().read(path)?;
        if let (Flavor::EslintPluginImport, Some(by)) = (self.flavor(), self.resolver.get())
            && !(by.is_known)(typescript_path(path), &text)
        {
            return Some(self.make_record(path.to_vec(), &[], false, None));
        }
        // Accept anything that can be parsed.
        let is_oxlint = self.flavor() == Flavor::Oxlint;
        let language = LanguageOptions {
            parser: Parser::TypeScript,
            experimental_decorators: true,
            is_oxlint,
            rejects_what_parser_rejects: !is_oxlint,
            ..LanguageOptions::default()
        };
        with_file(path, &text, &language, None, |file| {
            // Like eslint-plugin-import, treat a file that can't be parsed as having no imports.
            let mut requests = if self.is_unparsable(file) {
                Vec::new()
            } else {
                requests_of(file, self.flavor())
            };
            let record = self.cache_record(path.to_vec(), file);
            // For a package, only its re-exports matter.
            if is_in_package(path) && !self.follows_packages.load(Ordering::Relaxed) {
                let is_exported = |specifier: &[u8]| {
                    record.is_some_and(|it| {
                        let mut indirect = it.indirect_export_entries.iter();
                        it.star_export_entries.iter().any(|it| **it == *specifier)
                            || indirect.any(|it| *it.module_request == *specifier)
                    })
                };
                requests.retain(|it| is_exported(it.specifier));
            }
            self.make_record(path.to_vec(), &requests, false, None)
        })
    }

    /// True if `file` is treated as unparsable. oxlint also rejects a file that parses but has an early error.
    fn is_unparsable<'a>(&self, file: &'a File<'a>) -> bool {
        match self.flavor() {
            Flavor::Oxlint => bun_lint::linter::parse_error(file).is_some(),
            Flavor::EslintPluginImport => file.has_parse_errors(),
        }
    }

    /// Creates and caches the [`Record`] of `file`, which is at `path`, if a rule needs records and it isn't cached
    /// yet.
    fn cache_record<'a>(&self, path: Vec<u8>, file: &'a File<'a>) -> Option<&Record> {
        let make = self.record_maker.get()?;
        let cached = match self.caches().records.get_ref(&path[..]) {
            Some(cached) => cached,
            None => {
                let record = (!self.is_unparsable(file)).then(|| make(file));
                self.caches().records.insert_ref(path, record)
            }
        };
        cached.as_ref()
    }

    /// True if the file at `path`, which isn't linted, should be read.
    fn should_read(&self, path: &[u8]) -> bool {
        ScriptKind::from_file_name(path).is_some()
            && (self.record_maker.get().is_some()
                || self.follows_packages.load(Ordering::Relaxed)
                || !is_in_package(path))
    }

    /// Call this once, after every file is linted. Returns the files to lint again now that [`Modules::is_complete`] is
    /// true, each by the path it was linted under.
    pub fn complete(&self, parallel: Parallel) -> Vec<Vec<u8>> {
        let mut pending = std::mem::take(&mut *self.recorded.lock());
        if pending.is_empty() {
            return Vec::new();
        }
        let mut all = Complete::default();
        // Per module: whether it's been read, whether it's always checked, and the paths it's linted under.
        let (mut is_known, mut is_always_checked, mut linted_as) =
            (Vec::new(), Vec::new(), Vec::new());
        while !pending.is_empty() {
            let mut unknown: Vec<ModuleId> = Vec::new();
            for record in pending.drain(..) {
                let module = all.intern(&record.path);
                let mut imports: Vec<Import> = Vec::new();
                // Maps a module to its index in `imports`. Only filled once there are more than a few.
                let mut positions: FxHashMap<ModuleId, usize> = FxHashMap::default();
                for (target, declaration, kind) in record.requests {
                    let target = all.intern(&target);
                    if imports.len() > 16 && positions.len() < imports.len() {
                        positions.extend(
                            imports
                                .iter()
                                .enumerate()
                                .skip(positions.len())
                                .map(|(at, it)| (it.module, at)),
                        );
                    }
                    let existing = match positions.is_empty() {
                        true => imports.iter_mut().find(|it| it.module == target),
                        false => positions.get(&target).and_then(|at| imports.get_mut(*at)),
                    };
                    match (kind, existing) {
                        (RequestKind::Other, _) => {}
                        // Like eslint-plugin-import: the last dynamic import replaces the others.
                        (RequestKind::Dynamic, Some(existing)) => {
                            existing.declarations = SmallVec::from_iter([declaration])
                        }
                        (RequestKind::Static, Some(existing)) => {
                            existing.declarations.push(declaration)
                        }
                        (_, None) => imports.push(Import {
                            module: target,
                            declarations: SmallVec::from_iter([declaration]),
                        }),
                    }
                    unknown.push(target);
                }
                unknown.extend(record.found_from_link.iter().map(|it| all.intern(it)));
                for list in [&mut is_known, &mut is_always_checked] {
                    list.resize(all.paths.len(), false);
                }
                linted_as.resize(all.paths.len(), Vec::new());
                let at = module.0 as usize;
                is_known[at] = true;
                // A file that has several names through links is linted under each name.
                linted_as[at].extend(record.linted_as);
                is_always_checked[at] |= record.is_always_checked;
                all.imports.resize_with(all.paths.len(), Vec::new);
                // Several rules may have recorded the same file. One of them may count type imports.
                let type_import_count = |imports: &[Import]| {
                    let declarations = imports.iter().flat_map(|it| &it.declarations);
                    declarations.filter(|it| it.is_only_importing_types).count()
                };
                let recorded_imports = &all.imports[at];
                let is_the_same = recorded_imports.len() == imports.len()
                    && recorded_imports
                        .iter()
                        .zip(&imports)
                        .all(|(a, b)| a.module == b.module);
                if !is_the_same || type_import_count(&imports) < type_import_count(recorded_imports)
                {
                    all.imports[at] = imports;
                }
            }
            unknown.sort_unstable();
            unknown.dedup();
            unknown.retain(|it| {
                !std::mem::replace(&mut is_known[it.0 as usize], true)
                    && self.should_read(&all.paths[it.0 as usize])
            });
            let mut read = Guarded::new(Vec::new());
            parallel(unknown.len(), &|at| {
                if let Some(record) = self.read(&all.paths[unknown[at].0 as usize]) {
                    read.lock().push(record);
                }
            });
            pending = std::mem::take(read.get_mut());
        }
        all.find_components();
        let mut sizes = vec![0u32; all.paths.len()];
        all.components
            .iter()
            .for_each(|&it| sizes[it as usize] += 1);
        let counts_self_imports = self.flavor().counts_self_imports();
        let imports_itself = |at: usize| {
            let is_value =
                |it: &Import| !it.declarations.iter().all(|it| it.is_only_importing_types);
            counts_self_imports
                && all.imports[at]
                    .iter()
                    .any(|it| it.module.0 as usize == at && is_value(it))
        };
        let is_checked = |at: usize| {
            is_always_checked[at] || sizes[all.components[at] as usize] > 1 || imports_itself(at)
        };
        let to_relint = linted_as
            .into_iter()
            .enumerate()
            .filter(|it| is_checked(it.0))
            .flat_map(|it| it.1)
            .collect();
        let _ = self.complete.set(all);
        to_relint
    }
}

impl Complete {
    fn intern(&mut self, path: &[u8]) -> ModuleId {
        if let Some(&existing_id) = self.ids.get(path) {
            return existing_id;
        }
        let id = ModuleId(self.paths.len() as u32);
        self.ids.insert(path.to_vec(), id);
        self.paths.push(path.to_vec());
        id
    }

    /// Tarjan's algorithm on the value imports.
    fn find_components(&mut self) {
        const UNSEEN: u32 = u32::MAX;
        let count = self.paths.len();
        self.imports.resize_with(count, Vec::new);
        let (mut index, mut low, mut is_on_stack) =
            (vec![UNSEEN; count], vec![0u32; count], vec![false; count]);
        let (mut stack, mut calls): (Vec<u32>, Vec<(u32, u32)>) = (Vec::new(), Vec::new());
        let (mut next_index, mut next_component) = (0, 0);
        self.components = vec![0; count];
        for root in 0..count as u32 {
            if index[root as usize] != UNSEEN {
                continue;
            }
            calls.push((root, 0));
            while let Some(top) = calls.last_mut() {
                let (at, edge) = *top;
                let here = at as usize;
                if edge == 0 {
                    (index[here], low[here], is_on_stack[here]) = (next_index, next_index, true);
                    next_index += 1;
                    stack.push(at);
                }
                if let Some(import) = self.imports[here].get(edge as usize) {
                    top.1 += 1;
                    let to = import.module.0 as usize;
                    if import
                        .declarations
                        .iter()
                        .all(|it| it.is_only_importing_types)
                    {
                        continue;
                    }
                    if index[to] == UNSEEN {
                        calls.push((to as u32, 0));
                    } else if is_on_stack[to] {
                        low[here] = low[here].min(index[to]);
                    }
                    continue;
                }
                calls.pop();
                if let Some(&(caller, _)) = calls.last() {
                    low[caller as usize] = low[caller as usize].min(low[here]);
                }
                if low[here] == index[here] {
                    while let Some(member) = stack.pop() {
                        is_on_stack[member as usize] = false;
                        self.components[member as usize] = next_component;
                        if member == at {
                            break;
                        }
                    }
                    next_component += 1;
                }
            }
        }
    }
}

impl Modules for Graph<'_> {
    fn is_complete(&self) -> bool {
        self.complete.get().is_some()
    }

    fn record(&self, path: &[u8], requests: &[Request], is_always_checked: bool, flavor: Flavor) {
        self.follows_oxlint
            .store(flavor == Flavor::Oxlint, Ordering::Relaxed);
        let identity_path = self.identity_path(path);
        let record = self.make_record(
            identity_path,
            requests,
            is_always_checked,
            Some(path.to_vec()),
        );
        self.recorded.lock().push(record);
    }

    fn resolve_by(&self, make: &dyn Fn() -> ResolveBy) {
        self.resolver.get_or_init(make);
    }

    fn record_exports<'a>(&self, file: &'a File<'a>, make: MakeRecord) {
        // Only oxlint's rules keep records. They call this before `record`, and `cache_record` reads the flavor.
        self.follows_oxlint.store(true, Ordering::Relaxed);
        let _ = self.record_maker.set(make);
        let mut real = self.store.disk().realpath(&from_native(file.path()));
        if file.is_later_script() {
            real.push(0);
        }
        self.cache_record(real, file);
    }

    fn follow_packages(&self) {
        self.follows_packages.store(true, Ordering::Relaxed);
    }

    fn record_of(&self, module: ModuleId) -> Option<&Record> {
        let (path, records) = (self.stored_path(module), &self.caches().records);
        // For a file with several scripts, oxlint uses the last one that can be parsed.
        let later_script_record = || records.get_ref(&[path, b"\0"].concat()[..])?.as_ref();
        let has_scripts = ScriptKind::from_file_name(path).is_none();
        (has_scripts.then(later_script_record).flatten())
            .or_else(|| records.get_ref(path)?.as_ref())
    }

    fn find(&self, path: &[u8]) -> Option<ModuleId> {
        self.complete
            .get()?
            .ids
            .get(&self.identity_path(path))
            .copied()
    }

    fn resolve(&self, from: &[u8], specifier: &[u8], is_require: bool) -> Option<Resolved> {
        // Resolve from the file's own name, even if that's a link.
        let from = from_native(from);
        let (path, is_external) = self.resolve_path(&from, specifier, is_require)?;
        Some(Resolved {
            module: *self.complete.get()?.ids.get(&path[..])?,
            is_external,
        })
    }

    fn resolve_file(
        &self,
        from: &[u8],
        specifier: &[u8],
        is_require: bool,
        lookup: &Lookup,
    ) -> Option<Vec<u8>> {
        let from = from_native(from);
        let found = match lookup {
            // No system allows a path that long.
            _ if specifier.len() > 4096 => return None,
            Lookup::TypeScript(projects) => {
                // `removeQuerystring`
                let end = strings::last_index_of_char(specifier, b'?').unwrap_or(specifier.len());
                let specifier = &specifier[..end];
                let is_directory_specifier =
                    specifier.starts_with(b".") && specifier.ends_with(b"/");
                if is_directory_specifier
                    && !self
                        .store
                        .disk()
                        .is_dir(&join(directory_of(&from), specifier))
                {
                    return None;
                }
                let real = self.store.disk().realpath(&from);
                let configs = self.configs_of_typescript_resolver(projects, &from);
                // A name that exists as a file resolves to that file before any extension is tried. A name with a
                // script extension can resolve to another script.
                let name = &specifier
                    [strings::last_index_of_char(specifier, b'/').map_or(0, |it| it + 1)..];
                let is_script = ScriptKind::from_file_name(name).is_some();
                let is_exact_name =
                    |it: &Vec<u8>| it.strip_suffix(name).is_some_and(|it| it.ends_with(b"/"));
                let found = configs.iter().find_map(|config| {
                    let other = |extensions: &[&[u8]]| {
                        self.resolve_other_file(config, (specifier, &from), extensions)
                    };
                    let exact_file = (!is_script && name.len() < specifier.len())
                        .then(|| other(&[]))
                        .flatten();
                    if let Some(exact_file) = exact_file.filter(is_exact_name) {
                        return Some((Cow::Owned(exact_file), false));
                    }
                    let found = self.resolve_any_path(config, &real, specifier, is_require);
                    let added: &[&[u8]] = match is_script {
                        true => &[b".json", b".node"],
                        false => &[
                            b".ts", b".tsx", b".d.ts", b".js", b".jsx", b".json", b".node",
                        ],
                    };
                    found.or_else(|| Some((Cow::Owned(other(added)?), false)))
                });
                // TypeScript doesn't append `.json` or `.node` to a name. Such a file is preferred to a directory.
                let named = join(directory_of(&from), specifier);
                let is_in_directory = |it: &[u8]| {
                    let rest = it.strip_prefix(&named[..]);
                    let may_be_file = specifier.starts_with(b".") && !specifier.ends_with(b"/");
                    may_be_file && rest.is_some_and(|it| it.starts_with(b"/"))
                };
                match found {
                    Some(found) if is_in_directory(&found.0) => {
                        let endings = [&b".json"[..], b".node"];
                        let mut files = endings.iter().map(|it| [&named[..], *it].concat());
                        let file = files.find(|it| self.store.disk().is_file(it));
                        file.unwrap_or_else(|| found.0.into_owned())
                    }
                    found => found?.0.into_owned(),
                }
            }
            Lookup::Node(extensions) => {
                self.resolve_as_require((specifier, &from), extensions, &[], &[b"node_modules"])?
            }
            Lookup::NodeWith {
                extensions,
                paths,
                module_directories,
            } => {
                self.resolve_as_require((specifier, &from), extensions, paths, module_directories)?
            }
        };
        Some(typescript_path(&found).to_vec())
    }

    fn cwd(&self) -> &[u8] {
        typescript_path(&self.store.cwd)
    }

    fn exists(&self, path: &[u8]) -> bool {
        let (path, disk) = (from_native(path), self.store.disk());
        disk.is_file(&path) || disk.is_dir(&path)
    }

    fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
        self.store.disk().read(&from_native(path))
    }

    fn list_files(&self, patterns: &[&[u8]], extensions: &[&[u8]]) -> Result<Vec<Listed>, Vec<u8>> {
        (self.lister.get()).map_or_else(|| Ok(Vec::new()), |list| list(patterns, extensions))
    }

    fn facts(
        &self,
        path: &[u8],
        language: &LanguageOptions,
        reader: &Reader,
    ) -> Option<&(dyn Any + Send + Sync)> {
        let how = [
            language.parser as u8,
            language.scope_source_type() as u8,
            u8::from(language.without_module_syntax.is_some()),
            u8::from(language.jsx),
            u8::from(language.experimental_decorators),
            u8::from(language.eslint_8.is_some()),
        ];
        let edition = language.ecma_version.to_le_bytes();
        let key = [path, &how, &edition].concat();
        let cached = match self.caches().facts.get_ref(&key[..]) {
            Some(cached) => cached,
            None => {
                let text = self.store.disk().read(&from_native(path));
                let text = text.filter(|it| (reader.should_parse)(it));
                let made = text.and_then(|it| with_file(path, &it, language, None, reader.read));
                self.caches().facts.insert_ref(key, made)
            }
        };
        cached.as_deref()
    }

    fn es_module_interop(&self, directory: &[u8]) -> bool {
        let directory = from_native(directory);
        let config = find_config_file(self.store.disk(), &directory).unwrap_or_default();
        self.resolver_of(&config, &directory).es_module_interop
    }

    fn is_path_of(&self, module: ModuleId, path: &[u8]) -> bool {
        self.stored_path(module) == self.store.disk().with_on_disk_casing(&from_native(path))
    }

    fn path(&self, module: ModuleId) -> &[u8] {
        typescript_path(self.stored_path(module))
    }

    fn imports(&self, module: ModuleId) -> &[Import] {
        self.complete
            .get()
            .and_then(|it| it.imports.get(module.0 as usize))
            .map_or(&[], |it| &it[..])
    }

    fn component(&self, module: ModuleId) -> u32 {
        self.complete
            .get()
            .and_then(|it| it.components.get(module.0 as usize))
            .copied()
            .unwrap_or(u32::MAX)
    }

    fn package_json(&self, path: &[u8]) -> Option<&Json> {
        let path = from_native(path);
        let directory = directory_of(&path);
        if let Some(cached) = self.caches().packages.get_ref(directory) {
            return cached.as_ref();
        }
        let disk = self.store.disk();
        let found = ancestors(directory).find_map(|it| {
            let file = join(it, b"package.json");
            let text = disk.is_file(&file).then(|| disk.read(&file))??;
            bun_lint::json::parse(&text).filter(|it| it.as_object().is_some())
        });
        (self.caches().packages)
            .insert_ref(directory.to_vec(), found)
            .as_ref()
    }
}

/// A view of the disk for reading a `tsconfig.json` when only its options matter. Its `include` doesn't match anything,
/// and no directory is searched.
struct WithoutListings<'d>(&'d Disk);

impl Host for WithoutListings<'_> {
    fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
        self.0.read(path)
    }
    fn is_file(&self, path: &[u8]) -> bool {
        self.0.is_file(path)
    }
    fn is_dir(&self, path: &[u8]) -> bool {
        self.0.is_dir(path)
    }
    fn realpath(&self, path: &[u8]) -> Vec<u8> {
        self.0.realpath(path)
    }
    fn list_dir(&self, _: &[u8]) -> Vec<Vec<u8>> {
        Vec::new()
    }
    fn entries(&self, _: &[u8]) -> (Vec<Vec<u8>>, Vec<Vec<u8>>) {
        (Vec::new(), Vec::new())
    }
    fn is_case_sensitive(&self) -> bool {
        self.0.is_case_sensitive()
    }
    fn script_kind(&self, path: &[u8]) -> Option<ScriptKind> {
        self.0.script_kind(path)
    }
    fn extra_file_extensions(&self) -> &[(Vec<u8>, ScriptKind)] {
        self.0.extra_file_extensions()
    }
    fn scripts_of_page(&self, page: &[u8]) -> Vec<Vec<u8>> {
        self.0.scripts_of_page(page)
    }
    fn parse<'s>(
        &self,
        arena: &'s bun_sema::session::Arena,
        path: &[u8],
        text: &[u8],
        atoms: &Interner<'s>,
        options: bun_sema::resolve::ParseOptions,
    ) -> bun_sema::hir::File<'s> {
        self.0.parse(arena, path, text, atoms, options)
    }
    fn parse_package_json(&self, arena: &bun_sema::session::Arena, text: &[u8]) -> Option<Json> {
        self.0.parse_package_json(arena, text)
    }
    /// Runs on the current thread. It may belong to a pool, and then all of the pool's threads could end up waiting for
    /// each other.
    fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
        (0..count).for_each(work);
    }
}
