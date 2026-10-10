//! What the options of a project say about the globals of its files, without a file of the project being read: which
//! libraries it has, which packages of types, and whether it checks its JavaScript.
//!
//! The project of a file is the one that `Projects::owner_of` finds under
//! `PlanOptions::only_in_a_project_that_includes`. It is found otherwise: the configuration files by asking for them,
//! directory by directory, and what a project includes by its patterns. No directory is listed.

use crate::host::{Asking, from_native};
use crate::{installed_major, lacks_its_packages};
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::config::{self, Asked, Roots};
use bun_sema::program::libs_referenced_by;
use bun_sema::resolve::{Host, Options, ancestors, inside, is_same_path, join};
use bun_sema::session::Session;
use bun_sema::util::FxHashMap;
use bun_threading::Guarded;
use std::sync::{Arc, OnceLock};

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
    roots: Roots,
    /// The configuration files.
    references: Vec<Vec<u8>>,
    options: Options,
    /// Made when a file of the project asks. `None`: what it depends on is not installed, so what its files can use is
    /// not known.
    outline: OnceLock<Option<Arc<Outline>>>,
}

/// The outlines of the projects of a run. Each is made when a file of it is first asked about.
pub struct Outlines {
    host: Asking,
    cwd: Vec<u8>,
    /// By directory.
    nearest: Guarded<FxHashMap<Vec<u8>, Option<Vec<u8>>>>,
    /// By configuration file. `None`: it cannot be read.
    projects: Guarded<FxHashMap<Vec<u8>, Arc<OnceLock<Option<Arc<Project>>>>>>,
    /// By configuration file: `Outlines::reached_from`.
    reached: Guarded<FxHashMap<Vec<u8>, Arc<Vec<Arc<Project>>>>>,
}

impl Outlines {
    /// `cwd`: a native path.
    pub fn new(cwd: &[u8]) -> Outlines {
        let cwd = from_native(cwd);
        Outlines {
            host: Asking::new(&cwd),
            cwd,
            nearest: Default::default(),
            projects: Default::default(),
            reached: Default::default(),
        }
    }

    /// Of the project that includes the file at `path`, a native path. `None`: there is none, or `Project::outline`.
    pub fn of(&self, path: &[u8]) -> Option<Arc<Outline>> {
        let path = from_native(path);
        let nearest = self.nearest_to(dirname::<Posix>(&path));
        let mut config = nearest.or_else(|| self.nearest_to(&self.cwd))?;
        let host = self.asking(false);
        let file = Asked::new(&path);
        loop {
            let has_it = |it: &Arc<Project>| it.roots.has(&file, &|path| host.is_file(path));
            // What it references is read only if it has not got the file itself.
            let own = self.load(&config).filter(has_it);
            let owner = own.or_else(|| {
                self.reached_from(&config)
                    .iter()
                    .find(|it| has_it(it))
                    .cloned()
            });
            if let Some(owner) = owner {
                let outline = || self.outline(&owner.options);
                return owner.outline.get_or_init(outline).clone();
            }
            // `getAncestorConfigFileName`
            let above = self.nearest_to(ancestors(dirname::<Posix>(&config)).nth(1)?)?;
            config = above;
        }
    }

    /// The `N` of each `/// <reference lib="N" />` in the `index.d.ts` of the package at `path`, of `Outline::types`.
    pub fn libs_referenced_by(&self, path: &[u8]) -> Vec<Vec<u8>> {
        libs_referenced_by(&self.host, &inside(path, b"index.d.ts"))
    }

    fn asking(&self, lists: bool) -> Asking {
        Asking { lists, ..self.host }
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
            let names = [&b"tsconfig.json"[..], b"jsconfig.json"];
            found = (names.iter().map(|name| inside(directory, name))).find(|it| host.is_file(it));
            if found.is_some() || directory.ends_with(b"/node_modules") {
                break;
            }
        }
        let mut nearest = self.nearest.lock();
        for directory in asked {
            nearest.insert(directory.to_vec(), found.clone());
        }
        found
    }

    /// The project of `config`, then those that it references, directly or not, in the order in which
    /// `Projects::find_project_with` asks them for a file.
    fn reached_from(&self, config: &[u8]) -> Arc<Vec<Arc<Project>>> {
        if let Some(known) = self.reached.lock().get(config) {
            return Arc::clone(known);
        }
        let is_case_sensitive = self.host.is_case_sensitive();
        let mut all = Vec::new();
        let mut seen: Vec<Vec<u8>> = Vec::new();
        // Those to look at, the next one last.
        let mut pending = vec![config.to_vec()];
        while let Some(config) = pending.pop() {
            if (seen.iter()).any(|it| is_same_path(it, &config, is_case_sensitive)) {
                continue;
            }
            let project = self.load(&config);
            seen.push(config);
            let Some(project) = project else {
                continue;
            };
            pending.extend(project.references.iter().rev().cloned());
            all.push(project);
        }
        let all = Arc::new(all);
        let mut reached = self.reached.lock();
        reached.insert(config.to_vec(), Arc::clone(&all));
        all
    }

    fn load(&self, config: &[u8]) -> Option<Arc<Project>> {
        let known = self.projects.lock().get(config).cloned();
        let project = known.unwrap_or_else(|| {
            let mut projects = self.projects.lock();
            Arc::clone(projects.entry(config.to_vec()).or_default())
        });
        // One thread reads it. The others wait: they have nothing to lint before they know.
        let read = || self.read(config).map(Arc::new);
        project.get_or_init(read).clone()
    }

    fn read(&self, config: &[u8]) -> Option<Project> {
        let host = self.asking(false);
        let over = |_: bool| -> Vec<_> { installed_major(&host, config).into_iter().collect() };
        let project = config::load_overriding(&host, &Session::new(), config, &over).ok()?;
        Some(Project {
            roots: project.roots(&host),
            references: (project.references.iter())
                .map(|it| config::resolve_config_file_name_of_project_reference(&it.path))
                .collect(),
            options: project.options,
            outline: OnceLock::new(),
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
