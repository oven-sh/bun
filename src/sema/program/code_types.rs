use super::code_load::{CodeTarget, LoadKey, LoadedCode, ParsedCodeFile};
use super::*;
use crate::resolve::{CodeImportKind, HostPayload, is_declaration_file_name};

impl<'a, 's: 'r, 'r> CodeLoadContext<'a, 's, 'r> {
    pub(super) fn answer_types_question(
        &self,
        arena: &'s Arena,
        key: LoadKey<'r>,
        parsed: ParsedCodeFile<'s, 'r>,
    ) -> (
        Box<Loaded<'s, 'r>>,
        Box<LoadedCode<'s, 'r>>,
        Option<HostPayload>,
    ) {
        let ParsedCodeFile {
            parse,
            specifies_esm,
            mut code,
            payload,
        } = parsed;
        let loaded = Files::load_parsed(
            arena,
            self.host,
            self.resolver,
            self.options,
            &self.atoms,
            key.path,
            false,
            specifies_esm,
            Ok(parse),
            Some(BuildFile {
                context: self,
                code: Some(&mut *code),
            }),
            &|_| (),
        );
        (Box::new(loaded), code, payload)
    }

    pub(super) fn types_file_parse_options(&self, path: &[u8]) -> ParseOptions {
        if is_declaration_file_name(path) {
            return self.options.for_parsing();
        }
        let project = self.projects.governing(self, path);
        ParseOptions {
            module_detection: ModuleDetection::Force,
            ..project.unwrap_or(self.options).for_parsing()
        }
    }

    pub(super) fn types_question<'q>(
        &'q self,
        role: FileRole,
        path: &'q [u8],
        code: Option<&LoadedCode<'s, 'r>>,
        current: TypesQuestion<'q, 's, 'r>,
    ) -> TypesQuestion<'q, 's, 'r> {
        let typed_source_path = code.and_then(|code| code.analyzed.typed_source_path);
        let (text_path, question) = match typed_source_path {
            Some(text_path) => {
                let (resolver, from) = self.resolver.redirect_for_resolution(text_path);
                let project = referenced_project_options(self.options, resolver);
                let question = TypesQuestion {
                    resolver,
                    from,
                    project,
                };
                (text_path, question)
            }
            None => (path, current),
        };
        if question.project.is_some() || role == FileRole::TypesOnly {
            return question;
        }
        let manifest = typed_source_path.and_then(|it| self.host.typed_version_manifest(it));
        let governing = match manifest {
            Some(manifest) => Some(self.projects.of_typed_version(self, &manifest)),
            None => self.projects.governing(self, text_path),
        };
        match governing {
            Some(options) => TypesQuestion {
                resolver: self.project_resolvers.resolver_for(self.resolver, options),
                from: text_path,
                project: Some(options),
            },
            None => question,
        }
    }

    pub(super) fn resolver_of_module<'q>(
        build: Option<&'q Self>,
        program: &'q Resolver<'r>,
        module: &'q Module<'s>,
    ) -> (&'q Resolver<'r>, &'q [u8]) {
        match build {
            Some(build) => resolver_of_governed_module(&build.project_resolvers, program, module),
            None => program.redirect_for_resolution(module.file_name()),
        }
    }
}

/// The resolver of the project that governs `module`.
pub(super) fn resolver_of_governed_module<'q, 's: 'r, 'r>(
    project_resolvers: &'q ProjectResolvers<'r>,
    program: &'q Resolver<'r>,
    module: &'q Module<'s>,
) -> (&'q Resolver<'r>, &'q [u8]) {
    let typed_source_path = module.compiled.and_then(|it| it.typed_source_path);
    let from_path = typed_source_path.unwrap_or_else(|| module.file_name());
    let (resolver, from) = program.redirect_for_resolution(from_path);
    match module.redirect_for_resolution {
        Some(options) if referenced_project_options(program.options(), resolver).is_none() => {
            (project_resolvers.resolver_for(program, options), from)
        }
        Some(_) | None => (resolver, from),
    }
}

impl<'s, 'r> LoadedCode<'s, 'r> {
    pub(super) fn answer_types_from_code(
        &mut self,
        role: FileRole,
        names: &[(Atom, ResolutionMode, bool)],
    ) -> bool {
        if role != FileRole::Inferred {
            return false;
        }
        let mut answered = FxHashSet::default();
        for &(specifier, mode, _) in names {
            if let Some(target) = self.find_target(specifier, mode)
                && answered.insert((specifier, mode))
            {
                self.types_answers.push((specifier, mode, target));
            }
        }
        true
    }

    /// TypeScript has found no file for the import.
    pub(super) fn answer_types_from_named_loader(&mut self, specifier: Atom, mode: ResolutionMode) {
        let Some(index) = self.find_target(specifier, mode) else {
            return;
        };
        if self.targets[index as usize].has_loader_attribute {
            self.types_answers.push((specifier, mode, index));
        }
    }

    pub(super) fn program_path(
        &self,
        host: &dyn Host,
        key: (Atom, ResolutionMode),
        found: &'r [u8],
    ) -> &'r [u8] {
        let Some(index) = self.find_target(key.0, key.1) else {
            return found;
        };
        let target = &self.targets[index as usize];
        match is_same_file(host, found, target) {
            true => target.key.path,
            false => found,
        }
    }

    pub(super) fn has_typed_version(
        &self,
        host: &dyn Host,
        key: (Atom, ResolutionMode),
        found: &[u8],
    ) -> bool {
        let Some(index) = self.find_target(key.0, key.1) else {
            return false;
        };
        let target = &self.targets[index as usize];
        target.typed_path.is_some() && is_same_file(host, found, target)
    }

    fn find_target(&self, specifier: Atom, mode: ResolutionMode) -> Option<u32> {
        let (matching, other) = match mode {
            ResolutionMode::Require => (CodeImportKind::Require, CodeImportKind::Import),
            ResolutionMode::Import | ResolutionMode::None => {
                (CodeImportKind::Import, CodeImportKind::Require)
            }
        };
        let targets = &self.targets_by_specifier;
        let target = targets.get(&(specifier, matching));
        target.or_else(|| targets.get(&(specifier, other))).copied()
    }
}

pub(super) fn predicted_type_files<'r>(
    host: &dyn Host,
    loaded: &Loaded<'_, 'r>,
) -> Vec<(&'r [u8], bool)> {
    let references = loaded.references.iter();
    let references = references.map(|&(path, is_lib, _, _)| (path, is_lib));
    let imports = loaded.imports.iter().filter(|it| {
        it.should_add_file
            && it.unsupported_extension.is_none()
            && !(is_javascript_file(host, it.path)
                && strings::contains(it.path, b"/node_modules/"))
    });
    let imports = imports.map(|it| (it.path, false));
    references.chain(imports).collect()
}

fn referenced_project_options<'s>(
    program_options: &'s Options,
    resolver: &Resolver<'_>,
) -> Option<&'s Options> {
    let options = resolver.options();
    let mut referenced = program_options.referenced_options.iter();
    referenced.find(|&it| std::ptr::eq(it, options))
}

fn is_same_file(host: &dyn Host, found: &[u8], target: &CodeTarget<'_>) -> bool {
    if target.key.loader != HostLoader::default() {
        return false;
    }
    if target.key.path == found || target.typed_path == Some(found) {
        return true;
    }
    let (types_file, is_case_sensitive) = (host.realpath(found), host.is_case_sensitive());
    let is_types_file =
        |path: &[u8]| is_same_path(&types_file, &host.realpath(path), is_case_sensitive);
    is_types_file(target.key.path) || target.typed_path.is_some_and(is_types_file)
}

#[cfg(test)]
mod tests;
