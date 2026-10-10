//! Which module imports which, for the rules that are about several files: what is behind `bun_lint::modules::Modules`.
//!
//! ```ignore
//! let store = Store::new(cwd);
//! let graph = Graph::new(&store);
//! // On any thread, for each file:
//! file.set_modules(&graph);
//! linter.lint(&file, ..);
//! // When all are linted. Nothing happens if no rule has recorded anything.
//! for path in graph.complete(&|count, work| pool.for_each(count, 1, work)) {
//!     // Lint the file at `path` again, with the rules that are about several files.
//! }
//! ```
//!
//! Specifiers are resolved as `bun check` resolves them, with the `tsconfig.json` that is closest to the file: `paths`, `./a.js`
//! for `./a.ts`, `exports` and `imports` of `package.json`, symbolic links. Directories are listed once.

#![forbid(unsafe_code)]

use bun_core::strings;
use bun_lint::ast::File;
use bun_lint::language::{LanguageOptions, Parser};
use bun_lint::modules::{
    Declaration, Flavor, Import, Lookup, MakeRecord, ModuleId, Modules, Reader, Record, Request,
    RequestKind, Resolved, requests_of,
};
use bun_lint::paths::{is_absolute, relative};
use bun_sema::atom::Interner;
use bun_sema::bind::{BindOptions, Recycled, bind_for_lint_in};
use bun_sema::config::{Project, find_config, load_overriding, without_config};
use bun_sema::hir::ResolutionMode;
use bun_sema::json::Json;
use bun_sema::resolve::{AsRequire, Host, Resolver, ScriptKind, ancestors, join, typescript_path};
use bun_sema::session::Session;
use bun_sema::util::{FxHashMap, ShardedMap};
use bun_sema_driver::host::{Disk, from_native};
use bun_threading::Guarded;
use smallvec::SmallVec;
use std::any::Any;
use std::borrow::Cow;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};

/// What a [`Graph`] borrows from. It costs nothing until a rule asks for something.
pub struct Store {
    session: Session,
    disk: OnceLock<Disk>,
    cwd: Vec<u8>,
}

impl Store {
    /// `cwd`: a directory of the file system that the files are in.
    pub fn new(cwd: &[u8]) -> Store {
        Store {
            session: Session::new(),
            disk: OnceLock::new(),
            cwd: from_native(cwd),
        }
    }

    fn disk(&self) -> &Disk {
        self.disk
            .get_or_init(|| Disk::with_already_read(1, FxHashMap::default(), &self.cwd))
    }
}

/// What a file imports, before the files have numbers.
struct Recorded<'h> {
    path: Vec<u8>,
    /// What each request resolves to.
    requests: Vec<(Cow<'h, [u8]>, Declaration, RequestKind)>,
    is_always_checked: bool,
    /// The path that it is linted under, if it is one of the files that are linted.
    linted_as: Option<Vec<u8>>,
}

#[derive(Default)]
struct Complete {
    ids: FxHashMap<Vec<u8>, ModuleId>,
    paths: Vec<Vec<u8>>,
    imports: Vec<Vec<Import>>,
    components: Vec<u32>,
}

/// The extensions that oxlint tries, in its order.
const EXTENSIONS: [&[u8]; 8] = [
    b".js", b".mjs", b".cjs", b".jsx", b".ts", b".mts", b".cts", b".tsx",
];

struct ProjectResolver<'h> {
    resolver: Resolver<'h>,
    /// `baseUrl`, which TypeScript 7 no longer has, and which the resolvers of ESLint and oxlint know.
    base_url: Option<Vec<u8>>,
    /// As it is written.
    es_module_interop: bool,
}

/// What is found once and asked for often.
#[derive(Default)]
struct Known<'h> {
    /// By the path of the `tsconfig.json`. Empty: there is none.
    resolvers: ShardedMap<Vec<u8>, ProjectResolver<'h>>,
    /// The path of the `tsconfig.json` for the files of a directory.
    configs: ShardedMap<Vec<u8>, Vec<u8>>,
    /// What a specifier that is not relative means: by the directory, how it is imported, and the specifier.
    not_relative: ShardedMap<Vec<u8>, Option<(Vec<u8>, bool)>>,
    /// Paths with symbolic links followed.
    real_paths: ShardedMap<Vec<u8>, Vec<u8>>,
    /// The closest `package.json`, by directory.
    packages: ShardedMap<Vec<u8>, Option<Json>>,
    /// [`Modules::record_exports`]: by the path, with symbolic links followed. `None`: it cannot be parsed.
    records: ShardedMap<Vec<u8>, Option<Record>>,
    /// [`Modules::facts`]: by the path and how it is parsed.
    facts: ShardedMap<Vec<u8>, Option<Box<dyn Any + Send + Sync>>>,
}

pub struct Graph<'h> {
    store: &'h Store,
    /// Made when a rule asks: most runs have no such rule, and the tables are large.
    known: OnceLock<Box<Known<'h>>>,
    loading: Guarded<()>,
    recorded: Guarded<Vec<Recorded<'h>>>,
    record_maker: OnceLock<MakeRecord>,
    /// [`Modules::follow_packages`]
    follows_packages: AtomicBool,
    /// [`Flavor::Oxlint`]
    follows_oxlint: AtomicBool,
    complete: OnceLock<Complete>,
}

/// Parses `text` as the file at `path`, binds it, without types, and calls `then` with the file, which has `modules`. `None` if the
/// code is nested too deeply.
pub fn with_file<R>(
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
    let mut recycled = Recycled::of_this_thread();
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

fn directory_of(path: &[u8]) -> &[u8] {
    match strings::last_index_of_char(path, b'/') {
        Some(0) | None => b"/",
        Some(slash) => &path[..slash],
    }
}

fn is_in_package(path: &[u8]) -> bool {
    strings::contains(path, b"/node_modules/")
}

/// Of any other file oxlint knows as little as of one that does not exist.
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
            known: OnceLock::new(),
            loading: Guarded::new(()),
            recorded: Guarded::new(Vec::new()),
            record_maker: OnceLock::new(),
            follows_packages: AtomicBool::new(false),
            follows_oxlint: AtomicBool::new(false),
            complete: OnceLock::new(),
        }
    }

    fn known(&self) -> &Known<'h> {
        self.known.get_or_init(Box::default)
    }

    fn load_project(&self, config: &[u8], directory: &[u8]) -> Project {
        let flag = |name: &[u8]| (name.to_vec(), Json::Bool(true));
        // Whatever the project says: what is linted is also JavaScript.
        let over = || {
            vec![
                flag(b"allowJs"),
                flag(b"resolveJsonModule"),
                flag(b"allowImportingTsExtensions"),
            ]
        };
        let (disk, session) = (self.store.disk(), &self.store.session);
        let loaded = (!config.is_empty())
            .then(|| load_overriding(&WithoutListings(disk), session, config, &|_| over()).ok());
        loaded.flatten().unwrap_or_else(|| {
            let mut options = over();
            options.push((b"module".to_vec(), Json::String(b"esnext".to_vec())));
            options.push((
                b"moduleResolution".to_vec(),
                Json::String(b"bundler".to_vec()),
            ));
            // With a file, so that the directory is not searched for files.
            without_config(
                &WithoutListings(disk),
                directory,
                Json::Object(options),
                vec![b"index.ts".to_vec()],
            )
        })
    }

    /// The resolver for the files in `directory`.
    fn resolver(&self, directory: &[u8]) -> &ProjectResolver<'h> {
        let known = self.known();
        let config = match known.configs.get_ref(directory) {
            Some(config) => config,
            None => {
                let found = find_config(self.store.disk(), directory).unwrap_or_default();
                known.configs.insert_ref(directory.to_vec(), found)
            }
        };
        self.resolver_of(config, directory)
    }

    /// The resolver for the files that the configuration at `config` is for. Empty: none is. `directory`: one of
    /// theirs.
    fn resolver_of(&self, config: &[u8], directory: &[u8]) -> &ProjectResolver<'h> {
        let known = self.known();
        if let Some(resolver) = known.resolvers.get_ref(config) {
            return resolver;
        }
        // One thread reads a configuration, the others that need it wait.
        let _loading = self.loading.lock();
        if let Some(resolver) = known.resolvers.get_ref(config) {
            return resolver;
        }
        let store: &'h Store = self.store;
        let mut project = self.load_project(config, directory);
        let written = |name: &[u8]| {
            let mut options = project.raw_compiler_options.iter();
            options.find(|it| it.0 == name).map(|it| &it.1)
        };
        let base_url = written(b"baseUrl")
            .and_then(Json::as_str)
            .map(<[u8]>::to_vec);
        let es_module_interop = written(b"esModuleInterop") == Some(&Json::Bool(true));
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
        known.resolvers.insert_ref(config.to_vec(), resolver)
    }

    /// `written`: `paths`, which are from the working directory.
    fn resolve_as_require(
        &self,
        (specifier, from): (&[u8], &[u8]),
        extensions: &[&[u8]],
        written: &[&[u8]],
        module_directories: &[&[u8]],
    ) -> Option<Vec<u8>> {
        let (cwd, disk) = (&self.store.cwd[..], self.store.disk());
        // `loadpkg` of `resolve` goes up from where the file would be until there is a `package.json`. On a relative
        // path it never comes further than `.`, and runs out of stack there: nothing is found, in it or after it.
        let ends = |path: &[u8], as_written: &[u8]| {
            let candidate = join(path, specifier);
            let directory = directory_of(&candidate);
            let is_end = |it: &[u8]| {
                it.ends_with(b"/node_modules") || disk.is_file(&join(it, b"package.json"))
            };
            let below = ancestors(directory).take_while(|it| !cwd.starts_with(it));
            is_absolute(as_written) || !disk.is_dir(directory) || below.chain([cwd]).any(is_end)
        };
        let paths = written.iter().map(|it| (join(cwd, it), *it));
        let paths: SmallVec<[Vec<u8>; 2]> =
            (paths.take_while(|it| ends(&it.0, it.1)).map(|it| it.0)).collect();
        let paths: SmallVec<[&[u8]; 2]> = paths.iter().map(Vec::as_slice).collect();
        let how = AsRequire {
            extensions,
            module_directories,
            paths: &paths,
        };
        // No configuration of TypeScript has a say.
        let plain = self.resolver_of(b"", cwd);
        let (found, at) = (plain.resolver).resolve_as_require(specifier, from, &how)?;
        // `path.join(written, specifier)`
        let is_relative = at
            .and_then(|at| written.get(at))
            .is_some_and(|it| !is_absolute(it));
        Some(match is_relative {
            true => relative(cwd, &found),
            false => found,
        })
    }

    /// The path by which the file that is linted as `path` is known. oxlint follows links. eslint-plugin-import knows a
    /// file that is linted by its name: one that is a link to another is a module of its own.
    fn known_as(&self, path: &[u8]) -> Vec<u8> {
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

    /// The path, and whether it was found in a `node_modules`.
    fn resolve_path(
        &self,
        from: &[u8],
        specifier: &[u8],
        is_require: bool,
    ) -> Option<(Cow<'h, [u8]>, bool)> {
        // No system has a path that long, and what looks for one goes up directory by directory.
        if specifier.len() > 4096 {
            return None;
        }
        self.resolve_any_path(from, specifier, is_require)
            .filter(|it| !self.flavor().resolves_as_node() || is_read_by_oxlint(&it.0))
    }

    fn resolve_any_path(
        &self,
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
            return self.resolve_with_project(from, specifier, is_require);
        }
        // What is not relative means the same in all the files of a directory, and takes long to find.
        let key = [
            directory_of(from),
            if is_require { b"\0r\0" } else { b"\0i\0" },
            specifier,
        ]
        .concat();
        let found = match self.known().not_relative.get_ref(&key[..]) {
            Some(found) => found,
            None => {
                let found = self
                    .resolve_with_project(from, specifier, is_require)
                    .map(|it| (it.0.into_owned(), it.1));
                self.known().not_relative.insert_ref(key, found)
            }
        };
        found.as_ref().map(|it| (Cow::Owned(it.0.clone()), it.1))
    }

    /// A relative specifier as oxlint resolves it, without the detour over what TypeScript finds. The outer `None`: it is not
    /// decided here.
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
            Some((written, tried)) => tried
                .iter()
                .find_map(|it| file([&base[..base.len() - written.len()], it].concat())),
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
                    if disk.is_file(&join(&base, b"package.json")) {
                        return None;
                    }
                    found = EXTENSIONS
                        .iter()
                        .find_map(|it| file([&base[..], b"/index", it].concat()));
                }
                found
            }
        };
        Some(
            found.map(|path| match self.known().real_paths.get_ref(&path[..]) {
                Some(real) => real.clone(),
                None => {
                    let real = disk.realpath(&path);
                    self.known().real_paths.insert_ref(path, real).clone()
                }
            }),
        )
    }

    fn resolve_with_project(
        &self,
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
        } = self.resolver(directory_of(from));
        let from_base_url = || {
            let base_url = base_url
                .as_ref()
                .filter(|_| !specifier.starts_with(b".") && !specifier.starts_with(b"/"))?;
            resolver.resolve_module_name(&join(base_url, specifier), from, mode)
        };
        let found = resolver
            .resolve_module_name(specifier, from, mode)
            .or_else(from_base_url)?;
        let path = match self.flavor().resolves_as_node() {
            true => self.as_node_finds(specifier, found.file_name)?,
            false => Cow::Borrowed(found.file_name),
        };
        Some((path, found.is_external_library_import))
    }

    /// `found`: what TypeScript finds for `specifier`. Which of the files with that name and another extension does oxlint find?
    fn as_node_finds(&self, specifier: &[u8], found: &'h [u8]) -> Option<Cow<'h, [u8]>> {
        let Some(extension) = EXTENSIONS.iter().find(|it| found.ends_with(it)) else {
            return Some(Cow::Borrowed(found));
        };
        let stem = &found[..found.len() - extension.len()];
        let is_declaration = stem.ends_with(b".d") && extension.ends_with(b"ts");
        if is_declaration && specifier.ends_with(&found[stem.len() - 2..]) {
            return Some(Cow::Borrowed(found));
        }
        let stem = if is_declaration {
            &stem[..stem.len() - 2]
        } else {
            stem
        };
        let written = EXTENSIONS.iter().find(|it| specifier.ends_with(it));
        let tried: &[&[u8]] = match written.copied() {
            Some(b".js") => &[b".js", b".ts"],
            Some(b".mjs") => &[b".mjs", b".mts"],
            Some(b".cjs") => &[b".cjs", b".cts"],
            Some(_) => written.map_or(&[], std::slice::from_ref),
            None => &EXTENSIONS,
        };
        let disk = self.store.disk();
        tried.iter().find_map(|it| {
            if !is_declaration && it == extension {
                return Some(Cow::Borrowed(found));
            }
            let path = [stem, it].concat();
            disk.is_file(&path).then_some(Cow::Owned(path))
        })
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
            (!(it.may_be_itself && *resolved == *path)).then_some((resolved, declaration, it.kind))
        });
        Recorded {
            requests: resolved.collect(),
            path,
            is_always_checked,
            linted_as,
        }
    }

    /// Reads the file at `path`, which is not linted, for what it imports.
    fn read(&self, path: &[u8]) -> Option<Recorded<'h>> {
        let text = self.store.disk().read(path)?;
        // Whatever can be parsed.
        let language = LanguageOptions {
            parser: Parser::TypeScript,
            experimental_decorators: true,
            ..LanguageOptions::default()
        };
        with_file(path, &text, &language, None, |file| {
            // As eslint-plugin-import: nothing is known of a file that cannot be parsed.
            let mut requests = if file.has_parse_errors() {
                Vec::new()
            } else {
                requests_of(file, self.flavor())
            };
            let record = self.keep_record(path.to_vec(), file);
            // Of a package only what it exports is of interest.
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

    /// Makes the [`Record`] of `file`, which is at `path`, if a rule wants them and it is not known.
    fn keep_record<'a>(&self, path: Vec<u8>, file: &'a File<'a>) -> Option<&Record> {
        let make = self.record_maker.get()?;
        let known = match self.known().records.get_ref(&path[..]) {
            Some(known) => known,
            None => {
                let record = (!file.has_parse_errors()).then(|| make(file));
                self.known().records.insert_ref(path, record)
            }
        };
        known.as_ref()
    }

    /// Whether the file at `path`, which is not linted, is read.
    fn is_read(&self, path: &[u8]) -> bool {
        ScriptKind::from_file_name(path).is_some()
            && (self.record_maker.get().is_some()
                || self.follows_packages.load(Ordering::Relaxed)
                || !is_in_package(path))
    }

    /// To be called once, when all files are linted. Returns the files to lint again, now that [`Modules::is_complete`], each by the
    /// path that it was linted under.
    pub fn complete(&self, parallel: Parallel) -> Vec<Vec<u8>> {
        let mut pending = std::mem::take(&mut *self.recorded.lock());
        if pending.is_empty() {
            return Vec::new();
        }
        let mut all = Complete::default();
        // Which modules are known, and which of them are linted and checked in any case.
        let (mut is_known, mut is_always_checked, mut linted_as) =
            (Vec::new(), Vec::new(), Vec::new());
        while !pending.is_empty() {
            let mut unknown: Vec<ModuleId> = Vec::new();
            for record in pending.drain(..) {
                let module = all.intern(&record.path);
                let mut imports: Vec<Import> = Vec::new();
                // Where each module is in `imports`, as soon as they are more than a few.
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
                        // As eslint-plugin-import: the last of these replaces the others.
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
                for list in [&mut is_known, &mut is_always_checked] {
                    list.resize(all.paths.len(), false);
                }
                linted_as.resize(all.paths.len(), Vec::new());
                let at = module.0 as usize;
                is_known[at] = true;
                // A file to which links give several names is linted under each of them.
                linted_as[at].extend(record.linted_as);
                is_always_checked[at] |= record.is_always_checked;
                all.imports.resize_with(all.paths.len(), Vec::new);
                all.imports[at] = imports;
            }
            unknown.sort_unstable();
            unknown.dedup();
            unknown.retain(|it| {
                !std::mem::replace(&mut is_known[it.0 as usize], true)
                    && self.is_read(&all.paths[it.0 as usize])
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
        let again = linted_as
            .into_iter()
            .enumerate()
            .filter(|it| is_checked(it.0))
            .flat_map(|it| it.1)
            .collect();
        let _ = self.complete.set(all);
        again
    }
}

impl Complete {
    fn intern(&mut self, path: &[u8]) -> ModuleId {
        if let Some(&known) = self.ids.get(path) {
            return known;
        }
        let id = ModuleId(self.paths.len() as u32);
        self.ids.insert(path.to_vec(), id);
        self.paths.push(path.to_vec());
        id
    }

    /// Tarjan's algorithm, over the imports of values.
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
        let known_as = self.known_as(path);
        let record = self.make_record(known_as, requests, is_always_checked, Some(path.to_vec()));
        self.recorded.lock().push(record);
    }

    fn record_exports<'a>(&self, file: &'a File<'a>, make: MakeRecord) {
        let _ = self.record_maker.set(make);
        let real = self.store.disk().realpath(&from_native(file.path()));
        self.keep_record(real, file);
    }

    fn follow_packages(&self) {
        self.follows_packages.store(true, Ordering::Relaxed);
    }

    fn record_of(&self, module: ModuleId) -> Option<&Record> {
        self.known().records.get_ref(self.path(module))?.as_ref()
    }

    fn find(&self, path: &[u8]) -> Option<ModuleId> {
        self.complete.get()?.ids.get(&self.known_as(path)).copied()
    }

    fn resolve(&self, from: &[u8], specifier: &[u8], is_require: bool) -> Option<Resolved> {
        let from = self.known_as(from);
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
            Lookup::TypeScript => {
                let from = self.store.disk().realpath(&from);
                (self.resolve_path(&from, specifier, is_require)?.0).into_owned()
            }
            _ if specifier.len() > 4096 => return None,
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

    fn facts(
        &self,
        path: &[u8],
        language: &LanguageOptions,
        reader: &Reader,
    ) -> Option<&(dyn Any + Send + Sync)> {
        let how = [
            language.parser as u8,
            language.scope_source_type() as u8,
            u8::from(language.jsx),
            u8::from(language.experimental_decorators),
            u8::from(language.eslint_8.is_some()),
        ];
        let edition = language.ecma_version.to_le_bytes();
        let key = [path, &how, &edition].concat();
        let known = match self.known().facts.get_ref(&key[..]) {
            Some(known) => known,
            None => {
                let text = self.store.disk().read(&from_native(path));
                let text = text.filter(|it| (reader.wants)(it));
                let made = text.and_then(|it| with_file(path, &it, language, None, reader.read));
                self.known().facts.insert_ref(key, made)
            }
        };
        known.as_deref()
    }

    fn es_module_interop(&self, directory: &[u8]) -> bool {
        self.resolver(&from_native(directory)).es_module_interop
    }

    fn path(&self, module: ModuleId) -> &[u8] {
        self.complete
            .get()
            .and_then(|it| it.paths.get(module.0 as usize))
            .map_or(&[], |it| &it[..])
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
        if let Some(known) = self.known().packages.get_ref(directory) {
            return known.as_ref();
        }
        let disk = self.store.disk();
        let found = ancestors(directory).find_map(|it| {
            let file = join(it, b"package.json");
            let text = disk.is_file(&file).then(|| disk.read(&file))??;
            bun_lint::json::parse(&text).filter(|it| it.as_object().is_some())
        });
        (self.known().packages)
            .insert_ref(directory.to_vec(), found)
            .as_ref()
    }
}

/// The disk, for reading a `tsconfig.json` of which only the options matter: its `include` finds nothing, and no directory is
/// searched.
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
    /// On this thread: it can be one of a pool, all of whose threads would wait for each other.
    fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
        (0..count).for_each(work);
    }
}
