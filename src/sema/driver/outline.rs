//! What the options of a project say about the globals of its files, without a file of the project being read: which
//! libraries it has, which packages of types, and whether it checks its JavaScript.
//!
//! The project of a file is the one that `Projects::owner_of` finds under
//! `PlanOptions::only_in_a_project_that_includes`. It is found otherwise: the configuration files by asking for them,
//! directory by directory, and what a project includes by its patterns. No directory is listed.

use crate::host::{Asking, Disk, from_native};
use crate::{installed_major, lacks_its_packages};
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::config::{self, Roots};
use bun_sema::program::{libs_referenced_by, types_of};
use bun_sema::resolve::{Host, ancestors, inside, is_same_path};
use bun_sema::session::Session;
use bun_sema::util::FxHashMap;
use bun_threading::Guarded;
use std::sync::{Arc, OnceLock};

pub struct Outline {
    /// In the checker's format.
    pub config_path: Vec<u8>,
    /// `lib`, or else what `target` stands for: the `N` of each `lib.N.d.ts`. What these refer to is not among them.
    pub libs: Vec<Vec<u8>>,
    /// The entries of `types`, with the packages that a `*` stands for, each with the file that it is resolved to.
    pub types: Vec<(Vec<u8>, Vec<u8>)>,
    /// `checkJs`
    pub checks_javascript: bool,
}

struct Project {
    roots: Roots,
    /// The configuration files.
    references: Vec<Vec<u8>>,
    /// `None`: what it depends on is not installed, so what its files can use is not known.
    outline: Option<Arc<Outline>>,
}

/// The outlines of the projects of a run. Each is made when a file of it is first asked about.
pub struct Outlines {
    disk: Disk,
    cwd: Vec<u8>,
    /// By directory.
    nearest: Guarded<FxHashMap<Vec<u8>, Option<Vec<u8>>>>,
    /// By configuration file. `None`: it cannot be read.
    projects: Guarded<FxHashMap<Vec<u8>, Arc<OnceLock<Option<Arc<Project>>>>>>,
}

impl Outlines {
    /// `cwd`: a native path.
    pub fn new(cwd: &[u8]) -> Outlines {
        let cwd = from_native(cwd);
        Outlines {
            disk: Disk::with_already_read(1, Default::default(), &cwd),
            cwd,
            nearest: Default::default(),
            projects: Default::default(),
        }
    }

    /// Of the project that includes the file at `path`, a native path. `None`: there is none, or `Project::outline`.
    pub fn of(&self, path: &[u8]) -> Option<Arc<Outline>> {
        let path = from_native(path);
        let nearest = self.nearest_to(dirname::<Posix>(&path));
        let mut config = nearest.or_else(|| self.nearest_to(&self.cwd))?;
        loop {
            if let Some(owner) = self.project_with(&config, &path) {
                return owner.outline.clone();
            }
            // `getAncestorConfigFileName`
            let above = self.nearest_to(ancestors(dirname::<Posix>(&config)).nth(1)?)?;
            config = above;
        }
    }

    /// The `N` of each `/// <reference lib="N" />` in the file at `path`, which is of `Outline::types`.
    pub fn libs_referenced_by(&self, path: &[u8]) -> Vec<Vec<u8>> {
        libs_referenced_by(&self.asking(false), path)
    }

    fn asking(&self, lists: bool) -> Asking<'_> {
        let disk = &self.disk;
        Asking { disk, lists }
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

    /// `Projects::find_project_with`: `config`, or else the first of the projects that it references, directly or not,
    /// that has the file.
    fn project_with(&self, config: &[u8], path: &[u8]) -> Option<Arc<Project>> {
        let host = self.asking(false);
        let is_case_sensitive = host.is_case_sensitive();
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
            if project.roots.has(path, &|it| host.is_file(it)) {
                return Some(project);
            }
        }
        None
    }

    fn load(&self, config: &[u8]) -> Option<Arc<Project>> {
        let known = self.projects.lock().get(config).cloned();
        let project = known.unwrap_or_else(|| {
            let mut projects = self.projects.lock();
            projects.entry(config.to_vec()).or_default().clone()
        });
        // One thread reads it. The others wait: they have nothing to lint before they know.
        let read = || self.read(config).map(Arc::new);
        project.get_or_init(read).clone()
    }

    fn read(&self, config: &[u8]) -> Option<Project> {
        let host = self.asking(false);
        let over = |_: bool| -> Vec<_> { installed_major(&host, config).into_iter().collect() };
        let project = config::load_overriding(&host, &Session::new(), config, &over).ok()?;
        let outline = || {
            let types = types_of(&self.asking(true), &project.options)?;
            Some(Arc::new(Outline {
                config_path: config.to_vec(),
                libs: project.options.libs.clone(),
                types,
                checks_javascript: project.options.check_js == Some(true),
            }))
        };
        Some(Project {
            roots: project.roots(&host),
            references: (project.references.iter())
                .map(|it| config::resolve_config_file_name_of_project_reference(&it.path))
                .collect(),
            outline: match lacks_its_packages(&host, config) {
                true => None,
                false => outline(),
            },
        })
    }
}
