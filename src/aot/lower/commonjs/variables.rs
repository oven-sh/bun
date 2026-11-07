use bun_sema::atom::known;
use bun_sema::bind::{Binding, Bound, CodeUnit, CommonJsVariable, Parent, ScopeKind};
use bun_sema::fold::{Decisions, FoldedValue};
use bun_sema::hir::{self, BinOp, Chain, ExprId, ExprKind, StmtId, StmtKind, UnOp};
use bun_sema::import_sites::WHERE_FILE_LIES;
use bun_sema::program::FileId;
use bun_sema::util::FxHashMap;
use smallvec::SmallVec;

use crate::builtins::id::BuiltinId;
use crate::builtins::resolve::{
    ModuleField, ModuleObjectOwner, ModuleObjectUse, redeclares_what_wrapper_hands_in,
};
use crate::builtins::table::{self, Platforms, Scope};
use crate::builtins::{Mutability, Resolved, ResolvedBuiltins};
use crate::ir::generated::CommonJsParameter;
use crate::ir::{FunctionKey, PropertyKeyId, TypeId, ValueId, VariableId, VariableKey};
use crate::load::contents::entry_points::is_relative_path;
use crate::load::contents::worker_entries::{
    join_to_url_of_module, read_file_url, resolve_paths, with_forward_slashes, write_url_of_module,
    write_url_of_path,
};
use crate::load::module_paths::with_separators_of_host;
use crate::load::sources::parsed_source;
use crate::lower::member::PropertyName;
use crate::lower::scope::{ArgumentsObject, ScopeSlot};
use crate::lower::{FileLowering, FunctionLowering, module};
use crate::module_keys::is_name_of_text;
use crate::modules::{ModuleKind, ModuleRef, Shape, SpelledModule};

const fn variable_of(parameter: CommonJsParameter) -> CommonJsVariable {
    match parameter {
        CommonJsParameter::Exports => CommonJsVariable::Exports,
        CommonJsParameter::Require => CommonJsVariable::Require,
        CommonJsParameter::Module => CommonJsVariable::Module,
        CommonJsParameter::Filename => CommonJsVariable::Filename,
        CommonJsParameter::Dirname => CommonJsVariable::Dirname,
    }
}

pub(in crate::lower) const WRAPPER_PARAMETERS: [CommonJsVariable; CommonJsParameter::COUNT] = {
    let mut variables = [CommonJsVariable::Exports; CommonJsParameter::COUNT];
    let mut index = 0;
    while index < variables.len() {
        variables[index] = variable_of(CommonJsParameter::ALL[index]);
        index += 1;
    }
    variables
};

pub(in crate::lower) fn wrapper_parameter_index(variable: CommonJsVariable) -> u32 {
    let mut parameters = WRAPPER_PARAMETERS.iter();
    let index = parameters.position(|&parameter| parameter == variable);
    index.expect("every CommonJS variable is a wrapper parameter") as u32
}

pub(in crate::lower) fn undeclared_wrapper_parameters(
    bound: &Bound<'_>,
) -> impl Iterator<Item = CommonJsVariable> {
    let redeclared = bound.runtime.redeclared_commonjs_variables();
    let parameters = WRAPPER_PARAMETERS.into_iter();
    parameters.filter(move |&variable| !redeclared.iter().any(|entry| entry.1 == variable))
}

#[derive(Copy, Clone, PartialEq, Eq, Default, Debug)]
pub(in crate::lower) enum BodyForm {
    #[default]
    NotCommonJs,
    Plain,
    Wrapped,
}

#[derive(Copy, Clone, Default, Debug)]
pub(in crate::lower) struct CommonJsState {
    form: BodyForm,
    keeps_first_exports: bool,
    has_source_path: bool,
    names_source_path: bool,
    is_seen_by_direct_eval: [bool; 3],
}

#[derive(Copy, Clone)]
enum VariableSource {
    WrapperParameter,
    MappedWrapperParameter,
    ModuleValue(BuiltinId),
    ModuleExports,
    FirstExports,
    NoObject,
    ImportMetaMember(&'static [u8]),
    ModuleVariable,
    SourcePath,
    FreeName,
}

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn is_commonjs_module(&self) -> bool {
        match self.inputs.modules.kind(self.file) {
            ModuleKind::CommonJs => true,
            ModuleKind::SourceText | ModuleKind::Data | ModuleKind::RuntimeSource => false,
            ModuleKind::Runtime | ModuleKind::External => {
                unreachable!("a module of this kind has no file")
            }
        }
    }

    fn may_replace_exports(&self, module_name: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let Parent::Expr(access) = bound.parent_of_expr(module_name) else {
            return true;
        };
        let key = hir.member_key(access);
        if !key.is_some_and(|(object, _)| object == module_name) {
            return true;
        }
        match self.builtins.of_expr(access) {
            Some(Resolved::Builtin(path)) if path.id == BuiltinId::ModuleObjectExports => {
                let written = bound.outermost_type_assertion(hir, access);
                let is_deleted = matches!(bound.parent_of_expr(written), Parent::Expr(user)
                    if matches!(hir[user].kind, ExprKind::Unary { op: UnOp::Delete, .. }));
                is_deleted || bound.is_stored_to(hir, access)
            }
            Some(Resolved::Builtin(_)) => false,
            Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => true,
        }
    }

    fn compute_state(&self) -> CommonJsState {
        let (hir, bound) = (self.hir, self.bound);
        let has_source_path = self.inputs.sources.has_source_path(self.file);
        let mut answers = hir.texts_of_data_files.iter();
        let knows_where_files_lie = answers.any(|it| {
            self.queries
                .atom_bytes(it.path)
                .starts_with(WHERE_FILE_LIES)
        });
        let names_source_path = has_source_path
            && (knows_where_files_lie
                || bound.ident_bindings().iter().any(|&(name, binding)| {
                    matches!(
                        binding,
                        Binding::CommonJs(CommonJsVariable::Filename | CommonJsVariable::Dirname)
                    ) && !self.decisions().is_dead_expr(name)
                }));
        if !self.is_commonjs_module() {
            let mut evals = bound.runtime.eval_scopes().iter();
            let has_direct_eval = evals.any(|&(call, _)| !self.decisions().is_dead_expr(call));
            let is_seen_by_direct_eval = VARIABLES_OF_ES_MODULE.map(|variable| {
                has_direct_eval
                    && bound.ident_bindings().iter().any(|&(name, binding)| {
                        binding == Binding::CommonJs(variable)
                            && !self.decisions().is_dead_expr(name)
                    })
            });
            return CommonJsState {
                has_source_path,
                names_source_path,
                is_seen_by_direct_eval,
                ..CommonJsState::default()
            };
        }
        if keeps_wrapper(hir, bound, self.decisions(), self.builtins) {
            return CommonJsState {
                form: BodyForm::Wrapped,
                keeps_first_exports: false,
                has_source_path,
                names_source_path: names_source_path
                    || (has_source_path && reads_paths_out_of_sight(bound, self.decisions())),
                ..CommonJsState::default()
            };
        }
        let own_module = ModuleRef::File(self.file);
        let assigns_exports =
            |statement: StmtId| matches!(hir[statement].kind, StmtKind::ExportAssign(_));
        let mut replaces_exports = self.inputs.modules.keeps_module_object(own_module)
            || self.inputs.modules.may_be_mocked(own_module)
            || self.inputs.modules.may_be_evicted(own_module)
            || hir.ids(hir.body).any(assigns_exports)
            || bound.export_assignments_in_namespaces(hir).next().is_some();
        let mut names_exports = false;
        let analysis = &self.compiled.analysis;
        for binding in analysis.bindings_read_without_expression(hir, bound) {
            names_exports |= binding == Binding::CommonJs(CommonJsVariable::Exports);
            replaces_exports |= binding == Binding::CommonJs(CommonJsVariable::Module);
        }
        for &(name, binding) in bound.ident_bindings() {
            if self.decisions().is_dead_expr(name) {
                continue;
            }
            match binding {
                Binding::CommonJs(CommonJsVariable::Exports) => names_exports = true,
                Binding::CommonJs(CommonJsVariable::Module) => {
                    replaces_exports |= self.may_replace_exports(name);
                }
                Binding::CommonJs(
                    CommonJsVariable::Require
                    | CommonJsVariable::Filename
                    | CommonJsVariable::Dirname,
                )
                | Binding::Symbol(_)
                | Binding::Arguments(_)
                | Binding::Free => {}
            }
        }
        CommonJsState {
            form: BodyForm::Plain,
            keeps_first_exports: replaces_exports
                && names_exports
                && !self.inputs.modules.runs_again(self.file),
            has_source_path,
            names_source_path,
            ..CommonJsState::default()
        }
    }

    pub(in crate::lower) fn body_form(&self) -> BodyForm {
        self.modules.commonjs.form
    }

    fn has_values_of_each_run(&self) -> bool {
        self.body_form() == BodyForm::Plain && self.inputs.modules.runs_again(self.file)
    }

    fn find_plain_source(&self, variable: CommonJsVariable) -> VariableSource {
        let modules = self.inputs.modules;
        match variable {
            CommonJsVariable::Exports => match modules.shape(ModuleRef::File(self.file)) {
                Shape::Names | Shape::EsModule => VariableSource::NoObject,
                Shape::Value | Shape::AsToday if self.has_values_of_each_run() => {
                    VariableSource::WrapperParameter
                }
                Shape::Value | Shape::AsToday if self.modules.commonjs.keeps_first_exports => {
                    VariableSource::FirstExports
                }
                Shape::Value | Shape::AsToday => VariableSource::ModuleExports,
            },
            CommonJsVariable::Filename | CommonJsVariable::Dirname if self.has_source_path() => {
                VariableSource::SourcePath
            }
            _ => VariableSource::ModuleValue(builtin_of(variable)),
        }
    }

    fn find_source(&self, variable: CommonJsVariable) -> VariableSource {
        match self.body_form() {
            BodyForm::Wrapped => {
                return match self.scopes.arguments_object(CodeUnit::File) {
                    ArgumentsObject::Mapped => VariableSource::MappedWrapperParameter,
                    ArgumentsObject::None | ArgumentsObject::Unmapped => {
                        VariableSource::WrapperParameter
                    }
                };
            }
            BodyForm::Plain => return self.find_plain_source(variable),
            BodyForm::NotCommonJs => {}
        }
        match variable {
            CommonJsVariable::Module | CommonJsVariable::Exports => VariableSource::FreeName,
            CommonJsVariable::Filename | CommonJsVariable::Dirname
                if is_stored(self, variable)
                    || self.bound.import_meta_may_be_modified()
                    || is_seen_by_direct_eval(self, variable) =>
            {
                VariableSource::ModuleVariable
            }
            CommonJsVariable::Require
                if is_stored(self, variable) || is_seen_by_direct_eval(self, variable) =>
            {
                VariableSource::ModuleVariable
            }
            CommonJsVariable::Require if self.bound.import_meta_may_be_modified() => {
                VariableSource::ModuleValue(builtin_of(variable))
            }
            CommonJsVariable::Filename | CommonJsVariable::Dirname if self.has_source_path() => {
                VariableSource::SourcePath
            }
            CommonJsVariable::Require | CommonJsVariable::Filename | CommonJsVariable::Dirname => {
                let path = self.builtins.commonjs_variable(variable);
                match path.map(|path| (path.id, path.mutability)) {
                    Some((id, Mutability::AlwaysLocked)) => VariableSource::ModuleValue(id),
                    Some((_, Mutability::ConstantUnlessWritten | Mutability::ChangesOnItsOwn))
                    | None => VariableSource::ImportMetaMember(import_meta_member_name(variable)),
                }
            }
        }
    }

    fn find_path_text(&self, owner: FileId, builtin: BuiltinId) -> Option<Vec<u8>> {
        let is_commonjs = self.inputs.modules.kind(owner) == ModuleKind::CommonJs;
        let path = self.inputs.sources.public_path(owner);
        let is_commonjs_text = is_name_of_text(path) && is_commonjs;
        find_text_in_path(path, is_commonjs_text, builtin)
    }

    pub(in crate::lower) fn find_text_made_of_own_path(
        &self,
        expression: ExprId,
    ) -> Option<Vec<u8>> {
        let hir = self.hir;
        let expression = self.skip_type_syntax(expression);
        match hir[expression].kind {
            ExprKind::String(text) => Some(self.queries.atom_bytes(text).to_vec()),
            ExprKind::Dot {
                obj,
                name,
                chain: Chain::No,
                ..
            } => {
                let is_as_loaded =
                    matches!(hir[self.skip_type_syntax(obj)].kind, ExprKind::ImportMeta)
                        && !self.bound.import_meta_may_be_modified()
                        && self.decisions().constant(hir, expression) == FoldedValue::Unknown;
                if !is_as_loaded {
                    return None;
                }
                let path = self.find_path_text(self.file, BuiltinId::ImportMetaPath)?;
                if bun_core::strings::contains_char(&path, b'?') {
                    return None;
                }
                match name {
                    known::meta_dir | known::meta_dirname => {
                        self.find_path_text(self.file, BuiltinId::ImportMetaDir)
                    }
                    known::path | known::meta_filename => Some(path),
                    known::url => write_url_of_path(&path),
                    _ => None,
                }
            }
            ExprKind::Binary {
                op: BinOp::Add,
                left,
                right,
            } => {
                let mut text = self.find_text_made_of_own_path(left)?;
                text.extend(self.find_text_made_of_own_path(right)?);
                Some(text)
            }
            ExprKind::Template { exprs } => {
                let mut parts = hir.template_parts(expression).iter();
                let mut text = Vec::new();
                for substitution in hir.ids(exprs) {
                    text.extend_from_slice(self.queries.atom_bytes(parts.next()?.cooked?));
                    text.extend(self.find_text_made_of_own_path(substitution)?);
                }
                text.extend_from_slice(self.queries.atom_bytes(parts.next()?.cooked?));
                Some(text)
            }
            _ => None,
        }
    }

    fn has_source_path(&self) -> bool {
        self.modules.commonjs.has_source_path
    }

    fn find_source_path_text(&self, variable: CommonJsVariable) -> Option<Vec<u8>> {
        let is_folder = match variable {
            CommonJsVariable::Filename => false,
            CommonJsVariable::Dirname => true,
            CommonJsVariable::Require | CommonJsVariable::Module | CommonJsVariable::Exports => {
                return None;
            }
        };
        if !self.has_source_path() {
            return None;
        }
        let path = self.inputs.sources.source_path(self.file)?;
        Some(match is_folder {
            true => directory_of_source(&path).to_vec(),
            false => {
                let source = parsed_source(self.queries.files(), self.file);
                let with_query = source.and_then(|source| source.file_with_query.as_ref());
                [&path[..], with_query.map_or(&b""[..], |it| &it.query)].concat()
            }
        })
    }

    pub(in crate::lower) fn find_spellings_of_source_directory(&self) -> SmallVec<[Vec<u8>; 2]> {
        let mut spellings = SmallVec::new();
        let Some(text) = self.find_source_path_text_if_named(CommonJsVariable::Dirname) else {
            return spellings;
        };
        let is_windows = self.inputs.options.platform.contains(Platforms::WINDOWS);
        let joined = with_separators_of_host(&text, is_windows);
        let is_other_text = joined != text;
        spellings.push(text);
        if is_other_text {
            spellings.push(joined);
        }
        spellings
    }

    pub(in crate::lower) fn find_paths_joined_out_of_own_directory(
        &self,
        candidates: &[SpelledModule],
    ) -> Vec<(Vec<u8>, usize)> {
        let mut found: Vec<(Vec<u8>, usize)> = Vec::new();
        if !self.has_source_path() {
            return found;
        }
        let is_windows = self.inputs.options.platform.contains(Platforms::WINDOWS);
        let mut directories: SmallVec<[Vec<u8>; 3]> = SmallVec::new();
        directories.extend(self.find_path_text(self.file, BuiltinId::ImportMetaDir));
        directories.extend(self.find_spellings_of_source_directory());
        let spelling_of = |it: &SpelledModule| self.queries.atom_bytes(it.spelling).to_vec();
        let as_written = |it: &SpelledModule| (spelling_of(it), Some(it.module));
        let mut stands_for: FxHashMap<Vec<u8>, Option<ModuleRef>> =
            candidates.iter().map(as_written).collect();
        for directory in &directories {
            let directory = with_forward_slashes(directory.clone());
            for (place, candidate) in candidates.iter().enumerate() {
                let parts = [directory.clone(), spelling_of(candidate)];
                let Some(joined) = resolve_paths(&parts) else {
                    continue;
                };
                let joined = with_separators_of_host(&joined, is_windows);
                let seen = match directories.iter().find(|it| joined.starts_with(it)) {
                    Some(cut) => {
                        let rest = with_forward_slashes(joined[cut.len()..].to_vec());
                        [&b"."[..], &rest].concat()
                    }
                    None => joined,
                };
                match stands_for.get_mut(&seen) {
                    Some(module) if *module == Some(candidate.module) => {}
                    Some(module) => *module = None,
                    None => {
                        stands_for.insert(seen.clone(), Some(candidate.module));
                        found.push((seen, place));
                    }
                }
            }
        }
        found.retain(|(seen, _)| stands_for[seen].is_some());
        found
    }

    pub(in crate::lower) fn has_source_path_of(&self, module: ModuleRef) -> bool {
        matches!(module, ModuleRef::File(file) if self.inputs.sources.has_source_path(file))
    }

    pub(in crate::lower) fn find_url_of_source(&self, module: ModuleRef) -> Option<Vec<u8>> {
        let ModuleRef::File(file) = module else {
            return None;
        };
        if !self.inputs.reads_source_paths {
            return None;
        }
        write_url_of_path(&self.inputs.sources.source_path(file)?)
    }

    pub(in crate::lower) fn find_url_and_name_joined_to_own_url(
        &self,
        spelled: &SpelledModule,
        is_url: bool,
    ) -> [Option<Vec<u8>>; 2] {
        let ModuleRef::File(file) = spelled.module else {
            return [None, None];
        };
        let name = self.queries.atom_bytes(spelled.spelling);
        let sources = self.inputs.sources;
        let joined = match is_relative_path(name) {
            true => join_to_url_of_module(sources.public_path(self.file), name),
            false => None,
        };
        let is_windows = self.inputs.options.platform.contains(Platforms::WINDOWS);
        [write_url_of_module(sources.public_path(file)), joined].map(|url| match is_url {
            true => url,
            false => Some(with_separators_of_host(&read_file_url(&url?)?, is_windows)),
        })
    }

    fn find_source_path_text_if_named(&self, variable: CommonJsVariable) -> Option<Vec<u8>> {
        match self.modules.commonjs.names_source_path {
            true => self.find_source_path_text(variable),
            false => None,
        }
    }

    pub(in crate::lower) fn names_source_path(&self, expression: ExprId) -> bool {
        self.has_source_path()
            && matches!(self.hir[expression].kind, ExprKind::Ident(_))
            && matches!(
                self.bound.binding(expression),
                Binding::CommonJs(CommonJsVariable::Filename | CommonJsVariable::Dirname)
            )
    }
}

pub(in crate::lower) fn find_wrapper_path(
    builtins: &ResolvedBuiltins,
    builtin: BuiltinId,
) -> Option<(CommonJsVariable, SmallVec<[BuiltinId; 4]>)> {
    let mut properties = SmallVec::new();
    let mut entry = builtin;
    loop {
        let variable = WRAPPER_PARAMETERS.into_iter().find(|&variable| {
            let path = builtins.commonjs_variable(variable);
            path.is_some_and(|path| path.id == entry)
        });
        if let Some(variable) = variable {
            return Some((variable, properties));
        }
        properties.push(entry);
        entry = table::entry(entry).holder?;
    }
}

fn directory_of_source(path: &[u8]) -> &[u8] {
    let separator = if cfg!(windows) { b'\\' } else { b'/' };
    let first = bun_core::strings::index_of_char_usize(path, separator);
    match bun_core::strings::last_index_of_char(path, separator) {
        Some(last) if Some(last) == first => &path[..=last],
        Some(last) => &path[..last],
        None => b"",
    }
}

fn find_text_in_path(path: &[u8], is_commonjs_text: bool, builtin: BuiltinId) -> Option<Vec<u8>> {
    let holds = |separator| bun_core::strings::contains_char(path, separator);
    let separator = match path {
        _ if is_commonjs_text => b'/',
        [b'/', ..] if !holds(b'\\') => b'/',
        [drive, b':', b'\\', ..] if drive.is_ascii_alphabetic() && !holds(b'/') => b'\\',
        _ => return None,
    };
    match builtin {
        BuiltinId::ImportMetaPath => Some(path.to_vec()),
        BuiltinId::ImportMetaDir => {
            let end = bun_core::strings::last_index_of_char(path, separator);
            if separator == b'\\' && end == Some(2) {
                return None;
            }
            Some(path[..end.or_else(|| is_commonjs_text.then_some(0))?].to_vec())
        }
        _ => None,
    }
}

fn reads_paths_out_of_sight(bound: &Bound<'_>, decisions: &Decisions<'_>) -> bool {
    let mut redeclared = bound.runtime.redeclared_commonjs_variables().iter();
    let mut direct_evals = bound.runtime.eval_scopes().iter();
    let mut scopes = bound.scopes.iter();
    bound.file_uses_arguments()
        || redeclared.any(|entry| {
            matches!(
                entry.1,
                CommonJsVariable::Filename | CommonJsVariable::Dirname
            )
        })
        || direct_evals.any(|&(call, _)| !decisions.is_dead_expr(call))
        || scopes.any(|scope| matches!(scope.kind, ScopeKind::With(_)))
}

pub(in crate::lower) fn keeps_wrapper(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    builtins: &ResolvedBuiltins,
) -> bool {
    if bound.file_uses_arguments() || redeclares_what_wrapper_hands_in(hir, bound) {
        return true;
    }
    let mut direct_evals = bound.runtime.eval_scopes().iter();
    if direct_evals.any(|&(call, _)| !decisions.is_dead_expr(call)) {
        return true;
    }
    let mut scopes = bound.scopes.iter();
    if scopes.any(|scope| matches!(scope.kind, ScopeKind::With(_))) {
        return true;
    }
    let mut stores = bound.runtime.unbound_name_stores().iter();
    stores.any(|&(target, _)| match bound.binding(target) {
        _ if decisions.is_dead_expr(target) => false,
        Binding::CommonJs(CommonJsVariable::Exports) => {
            !builtins.is_stored_with_module_exports(target)
        }
        Binding::CommonJs(
            CommonJsVariable::Require
            | CommonJsVariable::Module
            | CommonJsVariable::Filename
            | CommonJsVariable::Dirname,
        ) => true,
        Binding::Symbol(_) | Binding::Arguments(_) | Binding::Free => false,
    })
}

pub(in crate::lower) fn prepare(file: &mut FileLowering<'_, '_, '_, '_>) {
    file.modules.commonjs = file.compute_state();
}

const fn builtin_of(variable: CommonJsVariable) -> BuiltinId {
    match variable {
        CommonJsVariable::Require => BuiltinId::ModuleRequire,
        CommonJsVariable::Module => BuiltinId::ModuleObject,
        CommonJsVariable::Exports => BuiltinId::ModuleObjectExports,
        CommonJsVariable::Filename => BuiltinId::ImportMetaPath,
        CommonJsVariable::Dirname => BuiltinId::ImportMetaDir,
    }
}

fn is_stored(file: &FileLowering<'_, '_, '_, '_>, variable: CommonJsVariable) -> bool {
    let mut stores = file.bound.runtime.unbound_name_stores().iter();
    stores.any(|&(target, _)| {
        file.bound.binding(target) == Binding::CommonJs(variable)
            && !file.decisions().is_dead_expr(target)
    })
}

const VARIABLES_OF_ES_MODULE: [CommonJsVariable; 3] = [
    CommonJsVariable::Require,
    CommonJsVariable::Filename,
    CommonJsVariable::Dirname,
];

fn is_seen_by_direct_eval(file: &FileLowering<'_, '_, '_, '_>, variable: CommonJsVariable) -> bool {
    variables_seen_by_direct_eval(file).any(|seen| seen == variable)
}

pub(in crate::lower) fn variables_seen_by_direct_eval(
    file: &FileLowering<'_, '_, '_, '_>,
) -> impl Iterator<Item = CommonJsVariable> + use<> {
    let is_seen = file.modules.commonjs.is_seen_by_direct_eval;
    let variables = VARIABLES_OF_ES_MODULE.into_iter().zip(is_seen);
    variables.filter_map(|(variable, is_seen)| is_seen.then_some(variable))
}

pub(in crate::lower) fn path_variable_key(
    file: &FileLowering<'_, '_, '_, '_>,
    variable: CommonJsVariable,
) -> VariableKey {
    let file = file.file;
    VariableKey::ModulePath { file, variable }
}

fn ensure_path_variable(
    file: &mut FileLowering<'_, '_, '_, '_>,
    variable: CommonJsVariable,
) -> VariableId {
    let file_id = file.file;
    file.ensure_variable(VariableKey::ModulePath {
        file: file_id,
        variable,
    })
}

fn import_meta_member_name(variable: CommonJsVariable) -> &'static [u8] {
    match variable {
        CommonJsVariable::Require => b"require",
        CommonJsVariable::Filename => b"path",
        CommonJsVariable::Dirname => b"dir",
        CommonJsVariable::Module | CommonJsVariable::Exports => {
            unreachable!("import.meta has no member for this variable")
        }
    }
}

fn text_key(file: &mut FileLowering<'_, '_, '_, '_>, text: &[u8]) -> PropertyKeyId {
    let text = file.intern_bytes(text);
    file.text_key(text)
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn emit_value_of_module(&mut self, owner: FileId, builtin: BuiltinId) -> ValueId {
        if let Some(text) = self.file.find_path_text(owner, builtin) {
            return self.emit_text(&text);
        }
        let module = self.file.fragment.declare_module(ModuleRef::File(owner));
        let member: &[u8] = match builtin {
            BuiltinId::ImportMetaPath => b"path",
            BuiltinId::ImportMetaDir => b"dir",
            _ => return self.builder.module_builtin(builtin, module),
        };
        let meta = self.builder.module_builtin(BuiltinId::ImportMeta, module);
        let key = text_key(self.file, member);
        self.emit_get(meta, PropertyName::Constant(key))
    }

    pub(super) fn try_lower_module_field(&mut self, access: ExprId) -> Option<ValueId> {
        let file = &*self.file;
        let mention = file.builtins.module_object_mention(access)?;
        let ModuleObjectUse::Field(field) = mention.object_use else {
            return None;
        };
        let (sources, modules) = (file.inputs.sources, file.inputs.modules);
        let main = modules.find_commonjs_main(sources.entry_points());
        let owner = match mention.owner {
            ModuleObjectOwner::OwnFile if file.body_form() == BodyForm::Plain => file.file,
            ModuleObjectOwner::EntryPoint => main?,
            ModuleObjectOwner::OwnFile | ModuleObjectOwner::Related => return None,
        };
        if modules.keeps_module_object(ModuleRef::File(owner)) {
            return None;
        }
        let location = match field {
            ModuleField::Loaded => return Some(self.builder.boolean(true)),
            ModuleField::Id if main.is_none() => return None,
            ModuleField::Id if main == Some(owner) => return Some(self.emit_text(b".")),
            ModuleField::Id | ModuleField::Filename => BuiltinId::ImportMetaPath,
            ModuleField::Path => BuiltinId::ImportMetaDir,
        };
        Some(self.emit_value_of_module(owner, location))
    }

    pub(in crate::lower) fn find_exports_type(&mut self, file: FileId) -> Option<TypeId> {
        let layout = self.file.module_exports_layout(file)?;
        Some(self.file.fragment.types.intern_layout(layout))
    }

    fn expect_module_value(&mut self, builtin: BuiltinId, value: ValueId) -> ValueId {
        if builtin == BuiltinId::ModuleObjectExports
            && let Some(expected) = self.find_exports_type(self.file.file)
        {
            return self.expect_type(value, expected);
        }
        self.expect_builtin(value, builtin)
    }

    fn expect_variable(&mut self, variable: CommonJsVariable, value: ValueId) -> ValueId {
        if variable == CommonJsVariable::Exports
            && let Some(expected) = self.find_exports_type(self.file.file)
        {
            return self.expect_type(value, expected);
        }
        let path = self.file.builtins.commonjs_variable(variable);
        match path.map(|path| (path.id, path.mutability)) {
            Some((id, Mutability::AlwaysLocked | Mutability::ConstantUnlessWritten)) => {
                self.expect_builtin(value, id)
            }
            Some((_, Mutability::ChangesOnItsOwn)) | None => value,
        }
    }

    pub(crate) fn get_commonjs_variable(&mut self, variable: CommonJsVariable) -> ValueId {
        self.get_variable(variable, false)
    }

    pub(crate) fn get_commonjs_variable_for_typeof(
        &mut self,
        variable: CommonJsVariable,
    ) -> ValueId {
        self.get_variable(variable, true)
    }

    pub(super) fn is_function_of_file_that_runs_again(&self) -> bool {
        self.key != FunctionKey::ModuleBody(self.file.file) && self.file.has_values_of_each_run()
    }

    fn find_source(&self, variable: CommonJsVariable) -> VariableSource {
        match variable {
            CommonJsVariable::Module | CommonJsVariable::Require
                if self.is_function_of_file_that_runs_again() =>
            {
                VariableSource::WrapperParameter
            }
            _ => self.file.find_source(variable),
        }
    }

    fn get_variable(&mut self, variable: CommonJsVariable, is_for_type_of: bool) -> ValueId {
        let value = match self.find_source(variable) {
            VariableSource::WrapperParameter => {
                let scope = module::file_scope(self.file);
                self.get_slot(scope, ScopeSlot::CommonJs(variable))
            }
            VariableSource::MappedWrapperParameter => {
                let index = wrapper_parameter_index(variable);
                self.get_mapped_argument(CodeUnit::File, index)
            }
            VariableSource::ModuleValue(builtin) => {
                return self.emit_value_of_module(self.file.file, builtin);
            }
            VariableSource::ModuleExports => self.get_own_exports(),
            VariableSource::FirstExports => {
                let first = ensure_path_variable(self.file, variable);
                self.builder.get_module_variable(first)
            }
            VariableSource::NoObject => return self.builder.boolean(true),
            VariableSource::ImportMetaMember(name) => {
                let meta = self.emit_value_of_module(self.file.file, BuiltinId::ImportMeta);
                let key = text_key(self.file, name);
                self.emit_get(meta, PropertyName::Constant(key))
            }
            VariableSource::ModuleVariable => {
                let variable = ensure_path_variable(self.file, variable);
                return self.builder.get_module_variable(variable);
            }
            VariableSource::SourcePath => return self.emit_path_of_own_file(variable),
            VariableSource::FreeName => {
                return self.emit_free_name_get(variable.name(), is_for_type_of);
            }
        };
        self.expect_variable(variable, value)
    }

    pub(crate) fn set_commonjs_variable(&mut self, variable: CommonJsVariable, value: ValueId) {
        match self.find_source(variable) {
            VariableSource::WrapperParameter => {
                let scope = module::file_scope(self.file);
                self.set_slot(scope, ScopeSlot::CommonJs(variable), value);
            }
            VariableSource::MappedWrapperParameter => {
                let index = wrapper_parameter_index(variable);
                self.set_mapped_argument(CodeUnit::File, index, value);
            }
            VariableSource::SourcePath => {
                unreachable!("a file that stores to the name has a variable or a parameter for it")
            }
            VariableSource::ModuleValue(_) | VariableSource::ImportMetaMember(_) => {
                debug_assert!(
                    !self.file.is_commonjs_module(),
                    "a file that stores to the name keeps its wrapper"
                );
                let meta = self.emit_value_of_module(self.file.file, BuiltinId::ImportMeta);
                let key = text_key(self.file, import_meta_member_name(variable));
                self.emit_set(meta, PropertyName::Constant(key), value);
            }
            VariableSource::ModuleExports | VariableSource::NoObject => {}
            VariableSource::FirstExports | VariableSource::ModuleVariable => {
                let variable = ensure_path_variable(self.file, variable);
                self.builder.put_module_variable(variable, value);
            }
            VariableSource::FreeName => {
                self.emit_free_name_set(variable.name(), value);
            }
        }
    }

    pub(super) fn store_first_exports(&mut self, first_exports: ValueId) {
        if self.file.modules.commonjs.keeps_first_exports {
            let variable = ensure_path_variable(self.file, CommonJsVariable::Exports);
            self.builder.put_module_variable(variable, first_exports);
        }
    }

    pub(super) fn emit_passed_value(&mut self, variable: CommonJsVariable) -> ValueId {
        match self.file.find_source_path_text_if_named(variable) {
            Some(text) => self.emit_text(&text),
            None => self.emit_value_of_module(self.file.file, builtin_of(variable)),
        }
    }

    fn emit_path_of_own_file(&mut self, variable: CommonJsVariable) -> ValueId {
        match self.file.find_source_path_text(variable) {
            Some(text) => self.emit_text(&text),
            None => self.emit_value_of_module(self.file.file, builtin_of(variable)),
        }
    }

    pub(in crate::lower) fn emit_own_directories(&mut self) -> SmallVec<[ValueId; 2]> {
        let mut directories = SmallVec::new();
        if !self.file.has_source_path() {
            directories.push(self.get_commonjs_variable(CommonJsVariable::Dirname));
            return directories;
        }
        directories.push(self.emit_value_of_module(self.file.file, BuiltinId::ImportMetaDir));
        for text in self.file.find_spellings_of_source_directory() {
            directories.push(self.emit_text(&text));
        }
        directories
    }

    pub(in crate::lower) fn initialize_path_variables(&mut self) {
        for variable in VARIABLES_OF_ES_MODULE {
            match self.file.find_source(variable) {
                VariableSource::ModuleVariable => {}
                _ => continue,
            }
            if let Some(text) = self.file.find_source_path_text_if_named(variable) {
                let value = self.emit_text(&text);
                self.set_commonjs_variable(variable, value);
                continue;
            }
            let meta = self.emit_value_of_module(self.file.file, BuiltinId::ImportMeta);
            let key = text_key(self.file, import_meta_member_name(variable));
            let value = self.emit_get(meta, PropertyName::Constant(key));
            self.set_commonjs_variable(variable, value);
        }
    }

    pub(crate) fn emit_module_builtin(&mut self, builtin: BuiltinId) -> ValueId {
        debug_assert_eq!(
            table::entry(builtin).scope,
            Scope::Module,
            "a built-in of the realm is a Builtin value"
        );
        let path = match self.file.is_commonjs_module() {
            true => find_wrapper_path(self.file.builtins, builtin),
            false => None,
        };
        let Some((variable, properties)) = path else {
            return self.emit_value_of_module(self.file.file, builtin);
        };
        let mut value = self.get_commonjs_variable(variable);
        for &property in properties.iter().rev() {
            let key = self.file.text_key_of_name(table::entry(property).name);
            value = self.emit_get(value, PropertyName::Constant(key));
            value = self.expect_module_value(property, value);
        }
        value
    }
}

pub(super) fn emit_entry_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    variable: CommonJsVariable,
) -> ValueId {
    debug_assert_eq!(
        lowering.file.body_form(),
        BodyForm::Wrapped,
        "no other body has a wrapper"
    );
    debug_assert_eq!(
        lowering.key,
        FunctionKey::WrappedModuleBody(lowering.file.file),
        "the wrapper's parameters are entry values of the function that holds the text"
    );
    let index = wrapper_parameter_index(variable);
    let value = lowering.builder.parameter(index);
    lowering.expect_variable(variable, value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_of_a_module_is_a_text_of_the_build() {
        let path = |path: &[u8]| find_text_in_path(path, false, BuiltinId::ImportMetaPath);
        let url = |of: &[u8]| write_url_of_path(&path(of)?);
        let text = |text: &[u8]| Some(text.to_vec());

        assert_eq!(url(b"/a/b.js"), text(b"file:///a/b.js"));
        assert_eq!(url(br"C:\a\b.js"), text(b"file:///C:/a/b.js"));
    }

    #[test]

    fn path_and_folder_of_a_module_are_texts_of_the_build() {
        let path = |path: &[u8]| find_text_in_path(path, false, BuiltinId::ImportMetaPath);
        let folder = |path: &[u8]| find_text_in_path(path, false, BuiltinId::ImportMetaDir);
        let text = |text: &[u8]| Some(text.to_vec());

        assert_eq!(path(b"/$bunfs/root/a/b.js"), text(b"/$bunfs/root/a/b.js"));
        assert_eq!(folder(b"/$bunfs/root/a/b.js"), text(b"/$bunfs/root/a"));
        assert_eq!(path(br"B:\~BUN\root\a\b.js"), text(br"B:\~BUN\root\a\b.js"));
        assert_eq!(folder(br"B:\~BUN\root\a\b.js"), text(br"B:\~BUN\root\a"));
        assert_eq!(folder(br"B:\~BUN\root\b.js"), text(br"B:\~BUN\root"));

        for left_to_the_run_time in [
            &br"/a\b.js"[..],
            br"B:\~BUN/root\b.js",
            b"B:/~BUN/root/b.js",
            br"1:\b.js",
            b"data:text/javascript,1",
        ] {
            assert_eq!(path(left_to_the_run_time), None);
            assert_eq!(folder(left_to_the_run_time), None);
        }
        assert_eq!(folder(br"B:\b.js"), None);

        let of_text = |builtin| find_text_in_path(b"data:text/javascript,1", true, builtin);
        assert_eq!(
            of_text(BuiltinId::ImportMetaPath),
            text(b"data:text/javascript,1")
        );
        assert_eq!(of_text(BuiltinId::ImportMetaDir), text(b"data:text"));
        assert_eq!(
            find_text_in_path(b"blob:1", true, BuiltinId::ImportMetaDir),
            text(b"")
        );
    }
}
