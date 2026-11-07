use super::*;
use crate::config;
use crate::resolve::node_module_path_parts;
use std::sync::OnceLock;

pub(super) struct Projects<'s> {
    session: &'s Session,
    by_directory: ShardedMap<Vec<u8>, Governing<'s>>,
    by_config_path: ShardedMap<Vec<u8>, ConfigAnswer<'s>>,
    lenient_by_package: ShardedMap<Vec<u8>, &'s Options>,
    lenient_template: OnceLock<Options>,
    aot_sources_by_directory: ShardedMap<Vec<u8>, Option<ConfigAnswer<'s>>>,
    naming_types: Guarded<Vec<&'s Options>>,
}

#[derive(Copy, Clone)]
enum ConfigAnswer<'s> {
    Program,
    Project(&'s Options),
    Solution(&'s Solution),
    Unreadable,
}

#[derive(Copy, Clone)]
enum Governing<'s> {
    EveryFile(Option<&'s Options>),
    FileByFile(&'s Solution),
}

struct Solution {
    projects: Vec<ReferencedProject>,
}

struct ReferencedProject {
    files: FxHashSet<Vec<u8>>,
    options: Option<Options>,
}

impl Solution {
    fn governing(&self, path: &[u8], is_case_sensitive: bool) -> Option<&Options> {
        let path = to_path(path, is_case_sensitive);
        let mut projects = self.projects.iter();
        projects
            .find(|project| project.files.contains(&*path))?
            .options
            .as_ref()
    }
}

impl<'s> Projects<'s> {
    pub(super) fn new(session: &'s Session) -> Projects<'s> {
        Projects {
            session,
            by_directory: ShardedMap::default(),
            by_config_path: ShardedMap::default(),
            lenient_by_package: ShardedMap::default(),
            lenient_template: OnceLock::new(),
            aot_sources_by_directory: ShardedMap::default(),
            naming_types: Guarded::new(Vec::new()),
        }
    }

    pub(super) fn naming_types(&self) -> Vec<&'s Options> {
        let mut projects = self.naming_types.lock().clone();
        projects.shared_sort_unstable_by(|a, b| a.config_path.cmp(&b.config_path));
        projects.dedup_by(|a, b| a.config_path == b.config_path);
        projects
    }

    pub(super) fn governing_code(
        &self,
        context: &CodeLoadContext<'_, 's, '_>,
        path: &[u8],
    ) -> Option<&'s Options> {
        Some(self.note_types(self.governing(context, path)?))
    }

    fn note_types(&self, project: &'s Options) -> &'s Options {
        let lists_types = project.types.as_ref().is_some_and(|it| !it.is_empty());
        if lists_types && !project.config_path.is_empty() {
            let mut naming_types = self.naming_types.lock();
            if !naming_types.iter().any(|&it| std::ptr::eq(it, project)) {
                naming_types.push(project);
            }
        }
        project
    }

    pub(super) fn governing_aot_source(
        &self,
        context: &CodeLoadContext<'_, 's, '_>,
        path: &[u8],
    ) -> Option<&'s Options> {
        let directory = dirname::<Posix>(path);
        let stated = match self.aot_sources_by_directory.get_ref(directory) {
            Some(&known) => known,
            None => {
                let found = self.find_package_options(context, directory);
                *(self.aot_sources_by_directory).insert_ref(directory.to_vec(), found)
            }
        };
        match stated {
            Some(ConfigAnswer::Program) => None,
            Some(ConfigAnswer::Project(options)) => Some(self.note_types(options)),
            _ => self.governing_code(context, path),
        }
    }

    fn find_package_options(
        &self,
        context: &CodeLoadContext<'_, 's, '_>,
        directory: &[u8],
    ) -> Option<ConfigAnswer<'s>> {
        if context.resolver.is_under_tsconfig_override(directory) {
            return None;
        }
        let manifest_path = config::find_package_with_compiler_options(context.host, directory)?;
        if let Some(&known) = self.by_config_path.get_ref(&manifest_path) {
            return Some(known);
        }
        let program = &context.options.config_path;
        let answer = match is_same_path(&manifest_path, program, context.is_case_sensitive) {
            true => ConfigAnswer::Program,
            false => {
                let scratch = Session::new();
                let project = config::load_for_aot_package(context.host, &scratch, &manifest_path);
                let options = governing_options(context, project.options);
                ConfigAnswer::Project(self.session.keep(options))
            }
        };
        Some(*self.by_config_path.insert_ref(manifest_path, answer))
    }

    pub(super) fn governing(
        &self,
        context: &CodeLoadContext<'_, 's, '_>,
        path: &[u8],
    ) -> Option<&'s Options> {
        let directory = dirname::<Posix>(path);
        let nearest = match self.by_directory.get_ref(directory) {
            Some(&known) => known,
            None => {
                let found = self.find_project(context, directory);
                *self.by_directory.insert_ref(directory.to_vec(), found)
            }
        };
        match nearest {
            Governing::EveryFile(options) => options,
            Governing::FileByFile(solution) => solution.governing(path, context.is_case_sensitive),
        }
    }

    fn find_project(
        &self,
        context: &CodeLoadContext<'_, 's, '_>,
        directory: &[u8],
    ) -> Governing<'s> {
        if context.resolver.is_under_tsconfig_override(directory) {
            return Governing::EveryFile(None);
        }
        let config_path = config::find_config(context.host, directory);
        match config_path.map(|it| self.load(context, &it)) {
            Some(ConfigAnswer::Program) => Governing::EveryFile(None),
            Some(ConfigAnswer::Project(options)) => Governing::EveryFile(Some(options)),
            Some(ConfigAnswer::Solution(solution)) => Governing::FileByFile(solution),
            Some(ConfigAnswer::Unreadable) | None => {
                let package_directory = installed_package_directory(directory);
                Governing::EveryFile(package_directory.map(|it| self.lenient(context.options, it)))
            }
        }
    }

    fn load(&self, context: &CodeLoadContext<'_, 's, '_>, config_path: &[u8]) -> ConfigAnswer<'s> {
        if let Some(&known) = self.by_config_path.get_ref(config_path) {
            return known;
        }
        let answer = self.read_options(context, config_path);
        *self.by_config_path.insert_ref(config_path.to_vec(), answer)
    }

    fn read_options(
        &self,
        context: &CodeLoadContext<'_, 's, '_>,
        config_path: &[u8],
    ) -> ConfigAnswer<'s> {
        let program = context.options;
        if is_same_path(config_path, &program.config_path, context.is_case_sensitive) {
            return ConfigAnswer::Program;
        }
        let scratch = Session::new();
        let Ok(project) = config::load_options_for_build(context.host, &scratch, config_path)
        else {
            return ConfigAnswer::Unreadable;
        };
        if project.errors.iter().any(|error| error.is_unreadable) {
            return ConfigAnswer::Unreadable;
        }
        if !project.references.is_empty()
            && let Some(solution) = read_solution(context, config_path)
        {
            return ConfigAnswer::Solution(self.session.keep(solution));
        }
        ConfigAnswer::Project(
            self.session
                .keep(governing_options(context, project.options)),
        )
    }

    fn lenient(&self, program: &Options, package_directory: &[u8]) -> &'s Options {
        if let Some(&known) = self.lenient_by_package.get_ref(package_directory) {
            return known;
        }
        let template = self
            .lenient_template
            .get_or_init(|| lenient_options(program, b""));
        let options = self
            .session
            .keep(lenient_options(template, package_directory));
        *self
            .lenient_by_package
            .insert_ref(package_directory.to_vec(), options)
    }
}

fn governing_options(context: &CodeLoadContext<'_, '_, '_>, project: Options) -> Options {
    let program = context.options;
    let mut options = Options {
        current_directory: program.current_directory.clone(),
        lib_dir: program.lib_dir.clone(),
        ..project
    };
    let given = &context.inputs.code.custom_conditions;
    options.custom_conditions.extend_from_slice(given);
    if context.resolver.transpiles_by_working_directory() {
        options.transpile_as(program);
    }
    options
}

fn read_solution(context: &CodeLoadContext<'_, '_, '_>, config_path: &[u8]) -> Option<Solution> {
    let (host, program) = (context.host, context.options);
    let is_case_sensitive = context.is_case_sensitive;
    let nearest = config::load_for_build(host, &Session::new(), config_path).ok()?;
    if !nearest.only_has_references() {
        return None;
    }
    let referenced = config::load_referenced_projects_for_build(host, &nearest);
    let projects = referenced.into_iter().filter_map(|project| {
        let files = project
            .files
            .iter()
            .map(|it| to_path(it, is_case_sensitive).into_owned());
        let is_program = is_same_path(
            &project.config_path,
            &program.config_path,
            is_case_sensitive,
        );
        let options = match is_program {
            true => None,
            false => {
                let path = &project.config_path;
                let stated = config::load_options_for_build(host, &Session::new(), path).ok()?;
                Some(governing_options(context, stated.options))
            }
        };
        Some(ReferencedProject {
            files: files.collect(),
            options,
        })
    });
    Some(Solution {
        projects: projects.collect(),
    })
}

fn installed_package_directory(directory: &[u8]) -> Option<&[u8]> {
    let (_, _, end) = node_module_path_parts(&inside(directory, b""))?;
    Some(&directory[..end.min(directory.len())])
}

pub(super) fn lenient_options(program: &Options, package_directory: &[u8]) -> Options {
    Options {
        strict_null_checks: false,
        no_implicit_any: false,
        specifies_no_implicit_any: false,
        no_implicit_this: false,
        strict_function_types: false,
        strict_bind_call_apply: false,
        strict_builtin_iterator_return: false,
        strict_property_initialization: false,
        use_unknown_in_catch_variables: false,
        exact_optional_property_types: false,
        no_unchecked_indexed_access: false,
        no_property_access_from_index_signature: false,
        no_implicit_returns: false,
        no_implicit_override: false,
        no_fallthrough_cases_in_switch: false,
        no_unused_locals: false,
        no_unused_parameters: false,
        no_unchecked_side_effect_imports: false,
        isolated_modules: false,
        isolated_modules_reported: false,
        verbatim_module_syntax: false,
        erasable_syntax_only: false,
        isolated_declarations: false,
        rewrite_relative_import_extensions: false,
        forbids_synthetic_default_imports: false,
        allow_unreachable_code: Some(true),
        allow_unused_labels: Some(true),
        allow_umd_global_access: true,
        allow_importing_ts_extensions: true,
        base_dir: package_directory.to_vec(),
        paths_base_dir: package_directory.to_vec(),
        paths: Arc::default(),
        base_url: Vec::new(),
        root_dirs: Vec::new(),
        out_dir: Vec::new(),
        root_dir: Vec::new(),
        declaration_dir: Vec::new(),
        config_path: Vec::new(),
        has_config_file: false,
        files: Vec::new(),
        file_specs: Vec::new(),
        include_specs: Vec::new(),
        errors: Vec::new(),
        problems: Vec::new(),
        referenced_outputs: Vec::new(),
        referenced_projects: FxHashMap::default(),
        referenced_options: Vec::new(),
        project_files: None,
        own_roots: None,
        ..program.clone()
    }
}

impl<'s> Files<'s> {
    #[inline]
    pub fn module_options(&self, file: FileId) -> &'s Options {
        match self.code_graph.is_compile_build {
            true => self.compiler_options_for_file(file),
            false => self.options,
        }
    }

    #[inline]
    pub(super) fn usage_options(&self, usage: impl Usage) -> &'s Options {
        match usage.importer() {
            Some(file) => self.module_options(file),
            None => self.options,
        }
    }
}

#[cfg(test)]
mod tests;
