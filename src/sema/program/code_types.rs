use super::code_load::{CodeTarget, LoadKey, LoadedCode, ParsedCodeFile};
use super::*;
use crate::resolve::{CodeHost, CodeImportKind, HostPayload, is_declaration_file_name};

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
        let mut loaded = Files::load_parsed(
            arena,
            self.host,
            self.resolver,
            self.options,
            &self.atoms,
            key.path,
            false,
            specifies_esm,
            Ok(parse),
            (Some(self), Some(&mut *code)),
            &|_| (),
        );
        if let Some(declaration) = self.find_own_declaration(key, &loaded) {
            loaded.imports.push(declaration);
        }
        (Box::new(loaded), code, payload)
    }

    fn find_own_declaration(
        &self,
        key: LoadKey<'r>,
        loaded: &Loaded<'s, 'r>,
    ) -> Option<Resolution<'r>> {
        if loaded.module.role != FileRole::Inferred {
            return None;
        }
        let path = match key.loader == HostLoader::default() {
            true => self.resolver.declaration_file_of(key.path)?,
            false if self.is_in_place_of_typed_file(key) => key.path,
            false => return None,
        };
        Some(Resolution {
            spec: known::own_declaration,
            mode: ResolutionMode::None,
            path,
            number: NOT_NUMBERED,
            should_add_file: true,
            increases_depth: false,
            package_id: None,
            is_importable: true,
            unsupported_extension: None,
        })
    }

    pub(super) fn is_in_place_of_typed_file(&self, key: LoadKey<'_>) -> bool {
        key.loader != HostLoader::default()
            && self.host.loader_of_code_in_place_of_typed_file(key.path) == Some(key.loader)
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
        if current.project.is_some() || role == FileRole::TypesOnly {
            return current;
        }
        let governing = match code {
            Some(code) if code.analyzed.is_aot_source => {
                self.projects.governing_aot_source(self, path)
            }
            Some(_) => self.projects.governing_code(self, path),
            None => self.projects.governing(self, path),
        };
        match governing {
            Some(options) => TypesQuestion {
                resolver: self.project_resolvers.resolver_for(self.resolver, options),
                from: path,
                project: Some(options),
            },
            None => current,
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

pub(super) fn resolver_of_governed_module<'q, 's: 'r, 'r>(
    project_resolvers: &'q ProjectResolvers<'r>,
    program: &'q Resolver<'r>,
    module: &'q Module<'s>,
) -> (&'q Resolver<'r>, &'q [u8]) {
    let (resolver, from) = program.redirect_for_resolution(module.file_name());
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

    pub(super) fn answer_types_from_data_loader(
        &mut self,
        host: &dyn CodeHost,
        specifier: Atom,
        mode: ResolutionMode,
    ) -> bool {
        let Some(index) = self.find_target(specifier, mode) else {
            return false;
        };
        let key = self.targets[index as usize].key;
        if key.loader == HostLoader::default() || host.loads_as_code(key.path, key.loader) {
            return false;
        }
        self.types_answers.push((specifier, mode, index));
        true
    }

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
            && !(is_javascript_file(host, it.path) && strings::contains(it.path, b"/node_modules/"))
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
    let code_file = target.key.path;
    code_file == found
        || is_same_path(
            &host.realpath(found),
            &host.realpath(code_file),
            host.is_case_sensitive(),
        )
}

#[cfg(test)]
mod tests;
