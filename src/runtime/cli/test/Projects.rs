//! `[[test.projects]]`: each project's files share one global that loads `[test] preload`, then the project's `preload`.

use bun_options_types::context::TestProject;
use bun_resolver::fs::FileSystem;

/// Index into `[[test.projects]]` plus one. `BASE_KEY` matches no project.
pub(crate) type ProjectKey = u32;

pub(crate) const BASE_KEY: ProjectKey = 0;

struct Prepared {
    test_match: Vec<bun_glob::Prepared<&'static [u8]>>,
    preloads: &'static [Box<[u8]>],
}

pub(crate) struct TestProjects {
    base_preloads: &'static [Box<[u8]>],
    projects: Vec<Prepared>,
}

impl TestProjects {
    /// Both slices are fields of the process-lifetime CLI context.
    pub(crate) fn init(
        preloads: &'static [Box<[u8]>],
        projects: &'static [TestProject],
    ) -> TestProjects {
        TestProjects {
            base_preloads: preloads,
            projects: projects
                .iter()
                .map(|p| Prepared {
                    test_match: p
                        .test_match
                        .iter()
                        .map(|g| bun_glob::Prepared::new(&**g))
                        .collect(),
                    preloads: &p.preloads,
                })
                .collect(),
        }
    }

    /// The first project whose `testMatch` matches, else `BASE_KEY`.
    pub(crate) fn key_for(&self, abs_path: &[u8]) -> ProjectKey {
        if self.projects.is_empty() {
            return BASE_KEY;
        }
        let rel_path =
            bun_paths::resolve_path::relative(FileSystem::instance().top_level_dir, abs_path);
        for (i, project) in self.projects.iter().enumerate() {
            if project
                .test_match
                .iter()
                .any(|pattern| pattern.r#match(rel_path).matches())
            {
                return ProjectKey::try_from(i + 1).expect("fewer than u32::MAX projects");
            }
        }
        BASE_KEY
    }

    /// `[test] preload`, then the project's own `preload`.
    pub(crate) fn preloads_for(&self, key: ProjectKey) -> Vec<Box<[u8]>> {
        let project = match key {
            BASE_KEY => &[][..],
            _ => self.projects[key as usize - 1].preloads,
        };
        let mut out: Vec<Box<[u8]>> = Vec::with_capacity(self.base_preloads.len() + project.len());
        out.extend(self.base_preloads.iter().cloned());
        out.extend(project.iter().cloned());
        out
    }

    /// Stable partition by key, so the `--randomize` or `--shard` order inside a project is kept.
    pub(crate) fn group(&self, files: &mut [bun_ptr::Interned]) {
        if self.projects.is_empty() {
            return;
        }
        files.sort_by_cached_key(|f| self.key_for(f.as_bytes()));
    }
}
