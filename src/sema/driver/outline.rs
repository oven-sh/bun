//! What the options of a project say about the globals of its files, without a file of the project being read: which
//! libraries it has, which packages of types, and whether it checks its JavaScript.
//!
//! The project of a file is the one that `Projects::owner_of` finds under
//! `PlanOptions::only_in_a_project_that_includes`. It is found otherwise: the configuration files by asking for them,
//! directory by directory, or of who has listed the directories; what a project includes by its patterns.

use crate::host::{Asking, from_native};
use crate::{
    Graph, Listed, installed_typescript, lacks_its_packages, major_of_typescript_at,
    project_that_checks,
};
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::config::{self, Asked, Roots};
use bun_sema::json::Json;
use bun_sema::program::libs_referenced_by;
use bun_sema::resolve::{
    Host, Kept, Options, ancestors, contains_path, inside, is_same_path, join,
    output_declaration_file_name,
};
use bun_sema::session::Session;
use bun_sema::util::{FxHashMap, FxHashSet};
use bun_threading::Guarded;
use std::sync::{Arc, OnceLock, Weak};

pub struct Outline {
    /// In the checker's format.
    pub config_path: Vec<u8>,
    /// `lib`, or else what `target` stands for: the `N` of each `lib.N.d.ts`. What these refer to is not among them.
    pub libs: Vec<Vec<u8>>,
    /// The entries of `types`, with the packages that a `*` stands for, each with where it is.
    pub types: Vec<(Vec<u8>, Vec<u8>)>,
    /// `checkJs`
    pub checks_javascript: bool,
}

struct Project {
    parsed: Arc<config::Project>,
    roots: Roots,
    /// The configuration files.
    references: Vec<Vec<u8>>,
    /// Made when a file of the project asks. `None`: what it depends on is not installed, so what its files can use is
    /// not known.
    outline: OnceLock<Option<Arc<Outline>>>,
    /// `Outlines::reached_from`. `Outlines::projects` keeps them.
    reached: OnceLock<Reached>,
}

struct Reached {
    /// The same reference graph validator used by checking, including permitted circular edges.
    is_valid: bool,
    projects: Vec<Weak<Project>>,
}

/// Where a project is read into, by the first that asks for it. `None`: it cannot be read.
type Place = Arc<OnceLock<Option<Arc<Project>>>>;

/// The outlines of the projects of a run. Each is made when a file of it is first asked about.
pub struct Outlines {
    host: Asking<'static>,
    /// `Host::extended_config`
    extended: Guarded<FxHashMap<Vec<u8>, Kept>>,
    /// By the directory of an installed TypeScript: `major_of_typescript_at`.
    majors: Guarded<FxHashMap<Vec<u8>, Option<(Vec<u8>, Json)>>>,
    cwd: Vec<u8>,
    /// Every directory below one of these in which a file is asked about has been listed, and the directories between.
    listed_below: Vec<Vec<u8>>,
    /// The configuration files that were there.
    listed: FxHashSet<Vec<u8>>,
    /// By directory.
    nearest: Guarded<FxHashMap<Vec<u8>, Option<Vec<u8>>>>,
    /// By directory: `Outlines::above`.
    above: Guarded<FxHashMap<Vec<u8>, Arc<Vec<(Vec<u8>, Place)>>>>,
    /// By configuration file.
    projects: Guarded<FxHashMap<Vec<u8>, Place>>,
}

impl Outlines {
    /// All are native paths. `listed_below`, `listed`: who has searched these directories for the files that are asked
    /// about says which `tsconfig.json` and `jsconfig.json` it has come by, and the system is not asked for them again.
    pub fn new(cwd: &[u8], listed_below: &[Vec<u8>], listed: &[Vec<u8>]) -> Outlines {
        let cwd = from_native(cwd);
        let host = Asking::new(&cwd);
        // Where the case of a name does not count, `Tsconfig.json` is one.
        let as_it_is_asked_for = |path: &Vec<u8>| {
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
            listed: listed.iter().map(as_it_is_asked_for).collect(),
            nearest: Default::default(),
            above: Default::default(),
            projects: Default::default(),
        }
    }

    /// Of the project that includes the file at `path`, a native path. `None`: there is none, or `Project::outline`.
    pub fn of(&self, path: &[u8]) -> Option<Arc<Outline>> {
        let path = from_native(path);
        let host = self.asking(false);
        let file = Asked::new(&path);
        let has_it = |it: &Arc<Project>| it.roots.has(&file, &|path| host.is_file(path));
        for (config, _) in self.above(dirname::<Posix>(&path)).iter() {
            let owner = project_that_checks(config, host.is_case_sensitive(), |config| {
                let place = self.place_of(config);
                let project = self.read_into(&place, config)?;
                let listed = has_it(project).then(|| {
                    // Declarations are read by both projects. A source that a reference includes
                    // is read through its declaration output in this project.
                    let reached = project.reached.get_or_init(|| self.reached_from(project));
                    let redirects = reached.is_valid
                        && output_declaration_file_name(&path, None).is_some()
                        && reached
                            .projects
                            .iter()
                            .filter_map(Weak::upgrade)
                            .any(|it| has_it(&it));
                    (Listed::AsConfigured, redirects)
                });
                Some((listed, project.references.clone()))
            });
            if let Some(owner) = owner {
                let place = self.place_of(&owner);
                let owner = self.read_into(&place, &owner)?;
                if !owner
                    .reached
                    .get_or_init(|| self.reached_from(owner))
                    .is_valid
                {
                    return None;
                }
                let outline = || self.outline(&owner.parsed.options);
                return owner.outline.get_or_init(outline).clone();
            }
        }
        None
    }

    /// The configuration files that are asked for a file in `directory`, in that order: the nearest, then
    /// `getAncestorConfigFileName`. None is read for it.
    fn above(&self, directory: &[u8]) -> Arc<Vec<(Vec<u8>, Place)>> {
        if let Some(known) = self.above.lock().get(directory) {
            return Arc::clone(known);
        }
        let mut all = Vec::new();
        let nearest = self.nearest_to(directory);
        let mut next = nearest.or_else(|| self.nearest_to(&self.cwd));
        while let Some(config) = next {
            let parent = ancestors(dirname::<Posix>(&config)).nth(1);
            next = parent.and_then(|it| self.nearest_to(it));
            let place = self.place_of(&config);
            all.push((config, place));
        }
        let all = Arc::new(all);
        let mut above = self.above.lock();
        above.insert(directory.to_vec(), Arc::clone(&all));
        all
    }

    /// The `N` of each `/// <reference lib="N" />` in the `index.d.ts` of the package at `path`, of `Outline::types`.
    pub fn libs_referenced_by(&self, path: &[u8]) -> Vec<Vec<u8>> {
        libs_referenced_by(&self.host, &inside(path, b"index.d.ts"))
    }

    fn asking(&self, lists: bool) -> Asking<'_> {
        Asking {
            lists,
            extended: Some(&self.extended),
            ..self.host
        }
    }

    /// `config::find_config`
    fn nearest_to(&self, directory: &[u8]) -> Option<Vec<u8>> {
        let host = self.asking(false);
        let mut asked = Vec::new();
        let mut found = None;
        for directory in ancestors(directory) {
            if let Some(known) = self.nearest.lock().get(directory) {
                found.clone_from(known);
                break;
            }
            asked.push(directory);
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
        if asked.is_empty() {
            return found;
        }
        let mut nearest = self.nearest.lock();
        for directory in asked {
            nearest.insert(directory.to_vec(), found.clone());
        }
        found
    }

    /// The projects that `project` references, directly or not. This is a membership set:
    /// `project_that_checks` owns the order in which a file's project is selected.
    fn reached_from(&self, project: &Project) -> Reached {
        let host = self.asking(false);
        let mut load = |config: &[u8]| {
            let place = self.place_of(config);
            self.read_into(&place, config)
                .map(|it| Arc::clone(&it.parsed))
        };
        // This host lists no sources. The graph is used only for reference validity and reachability;
        // Roots::has supplies file membership without loading a program.
        let mut graph = Graph::new(&host, &mut load);
        graph.create_build_tasks(Arc::clone(&project.parsed));
        graph.setup_build_tasks(&project.parsed.config_path);
        let projects = graph
            .projects
            .iter()
            .filter(|it| {
                !is_same_path(
                    &it.project.config_path,
                    &project.parsed.config_path,
                    host.is_case_sensitive(),
                )
            })
            .filter_map(|it| {
                let place = self.place_of(&it.project.config_path);
                self.read_into(&place, &it.project.config_path)
                    .map(Arc::downgrade)
            })
            .collect();
        Reached {
            is_valid: graph.errors.is_empty(),
            projects,
        }
    }

    fn place_of(&self, config: &[u8]) -> Place {
        let mut projects = self.projects.lock();
        match projects.get(config) {
            Some(known) => Arc::clone(known),
            None => Arc::clone(projects.entry(config.to_vec()).or_default()),
        }
    }

    /// One thread reads it. The others wait: they have nothing to lint before they know.
    fn read_into<'p>(&self, place: &'p Place, config: &[u8]) -> Option<&'p Arc<Project>> {
        let read = || self.read(config).map(Arc::new);
        place.get_or_init(read).as_ref()
    }

    fn read(&self, config: &[u8]) -> Option<Project> {
        let host = self.asking(false);
        let major = installed_typescript(&host, config).and_then(|package| {
            if let Some(known) = self.majors.lock().get(&package) {
                return known.clone();
            }
            let major = major_of_typescript_at(&host, &package);
            self.majors.lock().insert(package, major.clone());
            major
        });
        let over = |_: bool| -> Vec<_> { major.clone().into_iter().collect() };
        let project = config::load_overriding(&host, &Session::new(), config, &over).ok()?;
        Some(Project {
            roots: project.roots(&host),
            references: (project.references.iter())
                .map(|it| config::resolve_config_file_name_of_project_reference(&it.path))
                .collect(),
            parsed: Arc::new(project),
            outline: OnceLock::new(),
            reached: OnceLock::new(),
        })
    }

    fn outline(&self, options: &Options) -> Option<Arc<Outline>> {
        if lacks_its_packages(&self.asking(false), &options.config_path) {
            return None;
        }
        Some(Arc::new(Outline {
            config_path: options.config_path.clone(),
            libs: options.libs.clone(),
            types: self.types_of(options)?,
            checks_javascript: options.check_js == Some(true),
        }))
    }

    /// `Outline::types`. `None`: an entry of `types` is not installed (2688). Where `ResolveTypeReferenceDirective`
    /// looks for it, there is a directory or a declaration file of its name: that is all that is asked. What is in it,
    /// the program finds out if it is ever loaded.
    fn types_of(&self, options: &Options) -> Option<Vec<(Vec<u8>, Vec<u8>)>> {
        let host = self.asking(true);
        let names = options.types.as_deref().unwrap_or_default();
        let roots = match names.is_empty() {
            true => Vec::new(),
            false => options.effective_type_roots(),
        };
        let is_there =
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
            let beside = name
                .starts_with(b".")
                .then(|| join(&options.base_dir, name));
            let found = in_roots.chain(beside).chain(installed).find(is_there)?;
            all.push((name.clone(), found));
        }
        Some(all)
    }
}
