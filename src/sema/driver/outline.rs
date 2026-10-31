//! Derives what determines the globals in a project's files from its options, without reading any of those files: its
//! libraries, its type packages, and whether it checks its JavaScript.
//!
//! A file's project is the one that `Projects::owner_of` finds under `PlanOptions::requires_including_project`.
//! It's found differently here. Configuration files are found by probing directory by directory, or taken from a caller
//! that has already listed the directories. What a project includes is decided from its patterns.

use crate::host::{UncachedDisk, from_native};
use crate::{has_no_installed_dependencies, installed_typescript, major_of_typescript_at};
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::config::{self, Roots, SplitFilePath};
use bun_sema::json::Json;
use bun_sema::program::libs_referenced_by;
use bun_sema::resolve::{
    CachedConfig, Host, Options, ancestors, contains_path, inside, is_same_path, join,
};
use bun_sema::session::Session;
use bun_sema::util::{FxHashMap, FxHashSet};
use bun_threading::Guarded;
use std::sync::{Arc, OnceLock, Weak};

pub struct Outline {
    /// In the checker's format.
    pub config_path: Vec<u8>,
    /// `lib`, or by default the libraries that `target` implies, as the `N` of each `lib.N.d.ts`. The libraries these
    /// refer to aren't included.
    pub libs: Vec<Vec<u8>>,
    /// The entries of `types`, with `*` expanded to the packages it matches, each with its location.
    pub types: Vec<(Vec<u8>, Vec<u8>)>,
    /// `checkJs`
    pub checks_javascript: bool,
}

struct Project {
    roots: Roots,
    /// The referenced projects' configuration files.
    references: Vec<Vec<u8>>,
    options: Options,
    /// Built the first time a file of the project needs it. `None`: the project's dependencies aren't installed, so the
    /// globals its files can use are unknown.
    outline: OnceLock<Option<Arc<Outline>>>,
    /// `Outlines::reached_from`. `Outlines::projects` keeps them alive.
    reached: OnceLock<Vec<Weak<Project>>>,
}

/// The slot a project is read into by the first thread that needs it. `None`: it can't be read.
type ProjectSlot = Arc<OnceLock<Option<Arc<Project>>>>;

/// The outlines of a run's projects. Each is built the first time one of its files is queried.
pub struct Outlines {
    host: UncachedDisk<'static>,
    /// `Host::extended_config`
    extended: Guarded<FxHashMap<Vec<u8>, CachedConfig>>,
    /// `major_of_typescript_at`, by the directory of an installed TypeScript.
    majors: Guarded<FxHashMap<Vec<u8>, Option<(Vec<u8>, Json)>>>,
    cwd: Vec<u8>,
    /// The caller has listed every directory below one of these that contains a queried file, and the directories in
    /// between.
    listed_below: Vec<Vec<u8>>,
    /// The configuration files found in those listings.
    listed: FxHashSet<Vec<u8>>,
    /// By directory.
    nearest: Guarded<FxHashMap<Vec<u8>, Option<Vec<u8>>>>,
    /// By directory: `Outlines::above`.
    above: Guarded<FxHashMap<Vec<u8>, Arc<Vec<(Vec<u8>, ProjectSlot)>>>>,
    /// By configuration file.
    projects: Guarded<FxHashMap<Vec<u8>, ProjectSlot>>,
}

impl Outlines {
    /// All paths are native. `listed_below`, `listed`: a caller that has already searched these directories for the
    /// files it queries passes the `tsconfig.json` and `jsconfig.json` files it saw, so the system isn't queried for
    /// them again.
    pub fn new(cwd: &[u8], listed_below: &[Vec<u8>], listed: &[Vec<u8>]) -> Outlines {
        let cwd = from_native(cwd);
        let host = UncachedDisk::new(&cwd);
        // On a case-insensitive file system, `Tsconfig.json` counts too.
        let normalized_config_path = |path: &Vec<u8>| {
            let mut path = from_native(path);
            let name = path.len().saturating_sub(b"tsconfig.json".len());
            if !host.is_case_sensitive {
                path[name..].make_ascii_lowercase();
            }
            path
        };
        Outlines {
            host,
            extended: Default::default(),
            majors: Default::default(),
            cwd,
            listed_below: listed_below.iter().map(|it| from_native(it)).collect(),
            listed: listed.iter().map(normalized_config_path).collect(),
            nearest: Default::default(),
            above: Default::default(),
            projects: Default::default(),
        }
    }

    /// Returns the outline of the project that includes the file at `path`, a native path. `None`: there's no such
    /// project, or see `Project::outline`.
    pub fn of(&self, path: &[u8]) -> Option<Arc<Outline>> {
        let path = from_native(path);
        let host = self.uncached_host(false);
        let file = SplitFilePath::new(&path);
        let includes_file = |it: &Arc<Project>| it.roots.has(&file, &|path| host.is_file(path));
        for (config, project_slot) in self.above(dirname::<Posix>(&path)).iter() {
            let Some(project) = self.read_into(project_slot, config) else {
                continue;
            };
            // Its references are only read if it doesn't include the file itself.
            let owner = match includes_file(project) {
                true => Some(Arc::clone(project)),
                false => {
                    let reached = project.reached.get_or_init(|| self.reached_from(project));
                    reached.iter().filter_map(Weak::upgrade).find(includes_file)
                }
            };
            if let Some(owner) = owner {
                let outline = || self.outline(&owner.options);
                return owner.outline.get_or_init(outline).clone();
            }
        }
        None
    }

    /// Returns the configuration files to try for a file in `directory`, in order: the nearest, then
    /// `getAncestorConfigFileName`. Doesn't read any of them.
    fn above(&self, directory: &[u8]) -> Arc<Vec<(Vec<u8>, ProjectSlot)>> {
        if let Some(known) = self.above.lock().get(directory) {
            return Arc::clone(known);
        }
        let mut all = Vec::new();
        let nearest = self.nearest_to(directory);
        let mut next = nearest.or_else(|| self.nearest_to(&self.cwd));
        while let Some(config) = next {
            let parent = ancestors(dirname::<Posix>(&config)).nth(1);
            next = parent.and_then(|it| self.nearest_to(it));
            let project_slot = self.project_slot_of(&config);
            all.push((config, project_slot));
        }
        let all = Arc::new(all);
        let mut above = self.above.lock();
        above.insert(directory.to_vec(), Arc::clone(&all));
        all
    }

    /// Returns the `N` of each `/// <reference lib="N" />` in the `index.d.ts` of the package at `path`, which comes
    /// from `Outline::types`.
    pub fn libs_referenced_by(&self, path: &[u8]) -> Vec<Vec<u8>> {
        libs_referenced_by(&self.host, &inside(path, b"index.d.ts"))
    }

    fn uncached_host(&self, lists: bool) -> UncachedDisk<'_> {
        UncachedDisk {
            lists,
            extended: Some(&self.extended),
            ..self.host
        }
    }

    /// `config::find_config`
    fn nearest_to(&self, directory: &[u8]) -> Option<Vec<u8>> {
        let host = self.uncached_host(false);
        let mut visited = Vec::new();
        let mut found = None;
        for directory in ancestors(directory) {
            if let Some(known) = self.nearest.lock().get(directory) {
                found.clone_from(known);
                break;
            }
            visited.push(directory);
            let is_case_sensitive = host.is_case_sensitive();
            let mut above = self.listed_below.iter();
            let is_listed = above.any(|it| contains_path(it, directory, is_case_sensitive));
            let names = [&b"tsconfig.json"[..], b"jsconfig.json"];
            let mut configs = names.iter().map(|name| inside(directory, name));
            found = configs.find(|it| match is_listed {
                true => self.listed.contains(it),
                false => host.is_file(it),
            });
            if found.is_some() || directory.ends_with(b"/node_modules") {
                break;
            }
        }
        if visited.is_empty() {
            return found;
        }
        let mut nearest = self.nearest.lock();
        for directory in visited {
            nearest.insert(directory.to_vec(), found.clone());
        }
        found
    }

    /// Returns the projects that `project` references, directly or indirectly, in the order in which
    /// `Projects::find_project_with` searches them for a file.
    fn reached_from(&self, project: &Project) -> Vec<Weak<Project>> {
        let is_case_sensitive = self.host.is_case_sensitive();
        let mut all = Vec::new();
        let mut seen = vec![project.options.config_path.clone()];
        // The configuration files still to visit, next one last.
        let mut pending: Vec<Vec<u8>> = project.references.iter().rev().cloned().collect();
        while let Some(config) = pending.pop() {
            if (seen.iter()).any(|it| is_same_path(it, &config, is_case_sensitive)) {
                continue;
            }
            let project_slot = self.project_slot_of(&config);
            if let Some(project) = self.read_into(&project_slot, &config) {
                pending.extend(project.references.iter().rev().cloned());
                all.push(Arc::downgrade(project));
            }
            seen.push(config);
        }
        all
    }

    fn project_slot_of(&self, config: &[u8]) -> ProjectSlot {
        let mut projects = self.projects.lock();
        match projects.get(config) {
            Some(known) => Arc::clone(known),
            None => Arc::clone(projects.entry(config.to_vec()).or_default()),
        }
    }

    /// One thread reads it. The others wait, because they have nothing to lint until they know.
    fn read_into<'p>(
        &self,
        project_slot: &'p ProjectSlot,
        config: &[u8],
    ) -> Option<&'p Arc<Project>> {
        let read = || self.read(config).map(Arc::new);
        project_slot.get_or_init(read).as_ref()
    }

    fn read(&self, config: &[u8]) -> Option<Project> {
        let host = self.uncached_host(false);
        let major = installed_typescript(&host, config).and_then(|package| {
            if let Some(known) = self.majors.lock().get(&package) {
                return known.clone();
            }
            let major = major_of_typescript_at(&host, &package);
            self.majors.lock().insert(package, major.clone());
            major
        });
        let overrides = |_: bool| -> Vec<_> { major.clone().into_iter().collect() };
        let project = config::load_overriding(&host, &Session::new(), config, &overrides).ok()?;
        Some(Project {
            roots: project.roots(&host),
            references: (project.references.iter())
                .map(|it| config::resolve_config_file_name_of_project_reference(&it.path))
                .collect(),
            options: project.options,
            outline: OnceLock::new(),
            reached: OnceLock::new(),
        })
    }

    fn outline(&self, options: &Options) -> Option<Arc<Outline>> {
        if has_no_installed_dependencies(&self.uncached_host(false), &options.config_path) {
            return None;
        }
        Some(Arc::new(Outline {
            config_path: options.config_path.clone(),
            libs: options.libs.clone(),
            types: self.types_of(options)?,
            checks_javascript: options.check_js == Some(true),
        }))
    }

    /// `Outline::types`. Returns `None` if an entry of `types` isn't installed (2688). This only checks that a
    /// directory or a declaration file with that name exists where `ResolveTypeReferenceDirective` looks for it. The
    /// program finds out what's in it if it's ever loaded.
    fn types_of(&self, options: &Options) -> Option<Vec<(Vec<u8>, Vec<u8>)>> {
        let host = self.uncached_host(true);
        let names = options.types.as_deref().unwrap_or_default();
        let roots = match names.is_empty() {
            true => Vec::new(),
            false => options.effective_type_roots(),
        };
        let is_installed =
            |path: &Vec<u8>| host.is_dir(path) || host.is_file(&[&path[..], b".d.ts"].concat());
        let mut all = Vec::new();
        for name in names {
            if name == b"*" {
                for root in &roots {
                    let packages = host.list_dir(root).into_iter();
                    let packages = packages.filter(|it| !it.starts_with(b"."));
                    all.extend(packages.map(|it| (it.clone(), inside(root, &it))));
                }
                continue;
            }
            let in_roots = roots.iter().map(|root| join(root, name));
            let installed = ancestors(&options.base_dir).flat_map(|directory| {
                let packages = inside(directory, b"node_modules");
                [
                    join(&packages, name),
                    join(&inside(&packages, b"@types"), name),
                ]
            });
            let relative_to_base = name
                .starts_with(b".")
                .then(|| join(&options.base_dir, name));
            let found = in_roots
                .chain(relative_to_base)
                .chain(installed)
                .find(is_installed)?;
            all.push((name.clone(), found));
        }
        Some(all)
    }
}
