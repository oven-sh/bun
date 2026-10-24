use bun_sema::bind::{Binding, Bound, CodeUnit, CommonJsVariable, Parent, ScopeKind};
use bun_sema::fold::Decisions;
use bun_sema::hir::{ExprId, ExprKind, StmtId, StmtKind, UnOp};
use bun_sema::program::FileId;
use smallvec::SmallVec;

use crate::builtins::id::BuiltinId;
use crate::builtins::resolve::{ModuleField, ModuleObjectOwner, ModuleObjectUse};
use crate::builtins::table::{self, Scope};
use crate::builtins::{Mutability, Resolved, ResolvedBuiltins};
use crate::ir::generated::CommonJsParameter;
use crate::ir::{FunctionKey, PropertyKeyId, Type, TypeId, ValueId, VariableId, VariableKey};
use crate::lower::member::PropertyName;
use crate::lower::scope::{ArgumentsObject, ScopeSlot};
use crate::lower::{FileLowering, FunctionLowering, module};
use crate::modules::{ModuleKind, ModuleRef, Shape};

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

// `var exports` at the top of the file is the wrapper's parameter under a symbol of its own.
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
    /// The body has no parameters. Each of the five names is an operation, a constant or a variable of the module.
    Plain,
    /// The text of the file is a function of `this` and the five names, and the body of the module only calls it.
    Wrapped,
}

#[derive(Copy, Clone, Default, Debug)]
pub(in crate::lower) struct CommonJsState {
    form: BodyForm,
    // `module.exports` may come to hold another value than the object that `exports` names.
    keeps_first_exports: bool,
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
    FreeName,
}

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn is_commonjs_module(&self) -> bool {
        match self.inputs.modules.kind(self.file) {
            ModuleKind::CommonJs => true,
            ModuleKind::SourceText | ModuleKind::Data | ModuleKind::RuntimeSource => false,
            ModuleKind::Runtime | ModuleKind::External => {
                unreachable!("a module of this kind has no self")
            }
        }
    }

    // `module` stands where a value is wanted, or `module.exports` is stored to.
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
                let is_deleted = matches!(bound.parent_of_expr(access), Parent::Expr(user)
                    if matches!(hir[user].kind, ExprKind::Unary { op: UnOp::Delete, .. }));
                is_deleted || bound.is_write_access(hir, access)
            }
            Some(Resolved::Builtin(_)) => false,
            Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => true,
        }
    }

    fn compute_state(&self) -> CommonJsState {
        if !self.is_commonjs_module() {
            return CommonJsState::default();
        }
        let (hir, bound) = (self.hir, self.bound);
        if keeps_wrapper(bound, self.decisions(), self.builtins) {
            return CommonJsState {
                form: BodyForm::Wrapped,
                keeps_first_exports: false,
            };
        }
        let own_module = ModuleRef::File(self.file);
        let assigns_exports =
            |statement: StmtId| matches!(hir[statement].kind, StmtKind::ExportAssign(_));
        let mut replaces_exports = self.inputs.modules.keeps_module_object(own_module)
            || hir.ids(hir.body).any(assigns_exports);
        let mut names_exports = false;
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
            keeps_first_exports: replaces_exports && names_exports,
        }
    }

    pub(in crate::lower) fn body_form(&self) -> BodyForm {
        self.modules.commonjs.form
    }

    fn find_plain_source(&self, variable: CommonJsVariable) -> VariableSource {
        let modules = self.inputs.modules;
        match variable {
            CommonJsVariable::Exports => match modules.shape(ModuleRef::File(self.file)) {
                Shape::Names | Shape::EsModule => VariableSource::NoObject,
                Shape::Value | Shape::AsToday if self.modules.commonjs.keeps_first_exports => {
                    VariableSource::FirstExports
                }
                Shape::Value | Shape::AsToday => VariableSource::ModuleExports,
            },
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
            // `bun run` declares `var __filename = import.meta.path`. Only a store to either tells the variable from the member.
            CommonJsVariable::Filename | CommonJsVariable::Dirname
                if is_stored(self, variable) || self.bound.import_meta_may_be_modified() =>
            {
                VariableSource::ModuleVariable
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

    // The path of a file and its folder, as the record of the file has them.
    fn find_path_text(&self, owner: FileId, builtin: BuiltinId) -> Option<Vec<u8>> {
        let path = self.inputs.sources.module_paths(owner).public_path;
        if !path.starts_with(b"/") || bun_core::strings::contains_char(path, b'\\') {
            return None;
        }
        match builtin {
            BuiltinId::ImportMetaPath => Some(path.to_vec()),
            BuiltinId::ImportMetaDir => {
                let end = bun_core::strings::last_index_of_char(path, b'/')?;
                Some(path[..end].to_vec())
            }
            _ => None,
        }
    }

    fn find_wrapper_path(
        &self,
        builtin: BuiltinId,
    ) -> Option<(CommonJsVariable, SmallVec<[BuiltinId; 4]>)> {
        if !self.is_commonjs_module() {
            return None;
        }
        let mut properties = SmallVec::new();
        let mut entry = builtin;
        loop {
            let variable = WRAPPER_PARAMETERS.into_iter().find(|&variable| {
                let path = self.builtins.commonjs_variable(variable);
                path.is_some_and(|path| path.id == entry)
            });
            if let Some(variable) = variable {
                return Some((variable, properties));
            }
            properties.push(entry);
            entry = table::entry(entry).holder?;
        }
    }
}

/// Something in the text can only be said of a function that has the five names as parameters: a store to one of them, the `arguments` of the file, a name that is looked up at run time.
pub(in crate::lower) fn keeps_wrapper(
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    builtins: &ResolvedBuiltins,
) -> bool {
    if bound.file_uses_arguments() || !bound.runtime.redeclared_commonjs_variables().is_empty() {
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

/// Before anything of the file is lowered.
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

    /// `module.id`, `.filename`, `.path` and `.loaded`, and the same of `require.main`: what the record of the module says, as long as nobody holds the object, who could store there.
    pub(super) fn try_lower_module_field(&mut self, access: ExprId) -> Option<ValueId> {
        let file = &*self.file;
        let mention = file.builtins.module_object_mention(access)?;
        let ModuleObjectUse::Field(field) = mention.object_use else {
            return None;
        };
        let (sources, modules) = (file.inputs.sources, file.inputs.modules);
        // Which of several entry points has started the process is not known, and under an ES module `require.main` is undefined.
        let main = match sources.entry_points() {
            [entry_point] if modules.kind(entry_point.file) == ModuleKind::CommonJs => {
                Some(entry_point.file)
            }
            _ => None,
        };
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
            // The first CommonJS file under an ES entry point is "." too.
            ModuleField::Id if main.is_none() => return None,
            ModuleField::Id if main == Some(owner) => return Some(self.emit_text(b".")),
            ModuleField::Id | ModuleField::Filename => BuiltinId::ImportMetaPath,
            ModuleField::Path => BuiltinId::ImportMetaDir,
        };
        Some(self.emit_value_of_module(owner, location))
    }

    // Whoever holds the module object can put another object in place of the exports, so the layout is only expected.
    pub(in crate::lower) fn find_exports_type(&mut self, file: FileId) -> Option<TypeId> {
        let layout = self.file.module_exports_layout(file)?;
        Some(self.file.fragment.types.intern(Type::layout(layout)))
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

    fn get_variable(&mut self, variable: CommonJsVariable, is_for_type_of: bool) -> ValueId {
        let value = match self.file.find_source(variable) {
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
            // Only whether it is an object can be asked of it.
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
            VariableSource::FreeName => {
                return self.emit_free_name_get(variable.name(), is_for_type_of);
            }
        };
        self.expect_variable(variable, value)
    }

    pub(crate) fn set_commonjs_variable(&mut self, variable: CommonJsVariable, value: ValueId) {
        match self.file.find_source(variable) {
            VariableSource::WrapperParameter => {
                let scope = module::file_scope(self.file);
                self.set_slot(scope, ScopeSlot::CommonJs(variable), value);
            }
            VariableSource::MappedWrapperParameter => {
                let index = wrapper_parameter_index(variable);
                self.set_mapped_argument(CodeUnit::File, index, value);
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
            // `exports = module.exports = value`: the inner store has put the value where `exports` is read from.
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

    // `exports` goes on naming the object that the body begins with when `module.exports` comes to hold another value.
    pub(super) fn store_first_exports(&mut self, first_exports: ValueId) {
        if self.file.modules.commonjs.keeps_first_exports {
            let variable = ensure_path_variable(self.file, CommonJsVariable::Exports);
            self.builder.put_module_variable(variable, first_exports);
        }
    }

    /// What the body of the module passes to the function that holds its text.
    pub(super) fn emit_passed_value(&mut self, variable: CommonJsVariable) -> ValueId {
        self.emit_value_of_module(self.file.file, builtin_of(variable))
    }

    pub(in crate::lower) fn initialize_path_variables(&mut self) {
        for variable in [CommonJsVariable::Filename, CommonJsVariable::Dirname] {
            match self.file.find_source(variable) {
                VariableSource::ModuleVariable => {}
                _ => continue,
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
        let Some((variable, properties)) = self.file.find_wrapper_path(builtin) else {
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
