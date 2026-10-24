use bun_sema::bind::{Binding, Bound, CodeUnit, CommonJsVariable, Parent, ScopeKind};
use bun_sema::fold::Decisions;
use bun_sema::hir::{ExprId, ExprKind, StmtId, StmtKind, UnOp};
use bun_sema::program::FileId;
use smallvec::SmallVec;

use super::{ReadPurpose, exports};
use crate::builtins::id::BuiltinId;
use crate::builtins::resolve::{ModuleField, ModuleObjectOwner, ModuleObjectUse};
use crate::builtins::table::{self, Scope};
use crate::builtins::{BuiltinPath, Mutability, Resolved, ResolvedBuiltins};
use crate::ir::generated::CommonJsParameter;
use crate::ir::{FunctionKey, PropertyKeyId, Type, TypeId, ValueId, VariableId, VariableKey};
use crate::lower::member::{self, PropertyName};
use crate::lower::scope::{self, ArgumentsObject, ScopeSlot};
use crate::lower::{FileLowering, FunctionLowering, expression, layouts, module};
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
    let index = WRAPPER_PARAMETERS
        .iter()
        .position(|&parameter| parameter == variable);
    index.expect("every CommonJS variable is a wrapper parameter") as u32
}

// `var exports` at the top of the file is the wrapper's parameter under a symbol of its own.
pub(in crate::lower) fn undeclared_wrapper_parameters(
    bound: &Bound<'_>,
) -> impl Iterator<Item = CommonJsVariable> {
    let redeclared = bound.runtime.redeclared_commonjs_variables();
    WRAPPER_PARAMETERS
        .into_iter()
        .filter(move |&variable| !redeclared.iter().any(|entry| entry.1 == variable))
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

pub(in crate::lower) fn is_commonjs_module(file: &FileLowering<'_, '_, '_, '_>) -> bool {
    match file.inputs.modules.kind(file.file) {
        ModuleKind::CommonJs => true,
        ModuleKind::SourceText | ModuleKind::Data | ModuleKind::RuntimeSource => false,
        ModuleKind::Runtime | ModuleKind::External => {
            unreachable!("a module of this kind has no file")
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
    if bound
        .scopes
        .iter()
        .any(|scope| matches!(scope.kind, ScopeKind::With(_)))
    {
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

// `module` stands where a value is wanted, or `module.exports` is stored to.
fn may_replace_exports(file: &FileLowering<'_, '_, '_, '_>, module_name: ExprId) -> bool {
    let (hir, bound) = (file.hir, file.bound);
    let Parent::Expr(access) = bound.parent_of_expr(module_name) else {
        return true;
    };
    if !hir
        .member_key(access)
        .is_some_and(|(object, _)| object == module_name)
    {
        return true;
    }
    match file.builtins.of_expr(access) {
        Some(Resolved::Builtin(path)) if path.id == BuiltinId::ModuleObjectExports => {
            let is_deleted = matches!(bound.parent_of_expr(access), Parent::Expr(user)
                if matches!(hir[user].kind, ExprKind::Unary { op: UnOp::Delete, .. }));
            is_deleted || bound.is_write_access(hir, access)
        }
        Some(Resolved::Builtin(_)) => false,
        Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => true,
    }
}

fn compute_state(file: &FileLowering<'_, '_, '_, '_>) -> CommonJsState {
    if !is_commonjs_module(file) {
        return CommonJsState::default();
    }
    let (hir, bound) = (file.hir, file.bound);
    if keeps_wrapper(bound, file.decisions(), file.builtins) {
        return CommonJsState {
            form: BodyForm::Wrapped,
            keeps_first_exports: false,
        };
    }
    let own_module = ModuleRef::File(file.file);
    let assigns_exports =
        |statement: StmtId| matches!(hir[statement].kind, StmtKind::ExportAssign(_));
    let mut replaces_exports = file.inputs.modules.keeps_module_object(own_module)
        || hir.ids(hir.body).any(assigns_exports);
    let mut names_exports = false;
    for &(name, binding) in bound.ident_bindings() {
        if file.decisions().is_dead_expr(name) {
            continue;
        }
        match binding {
            Binding::CommonJs(CommonJsVariable::Exports) => names_exports = true,
            Binding::CommonJs(CommonJsVariable::Module) => {
                replaces_exports |= may_replace_exports(file, name);
            }
            Binding::CommonJs(
                CommonJsVariable::Require | CommonJsVariable::Filename | CommonJsVariable::Dirname,
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

pub(super) fn prepare(file: &mut FileLowering<'_, '_, '_, '_>) {
    file.modules.commonjs = compute_state(file);
}

pub(in crate::lower) fn body_form(file: &FileLowering<'_, '_, '_, '_>) -> BodyForm {
    file.modules.commonjs.form
}

pub(super) fn keeps_first_exports(file: &FileLowering<'_, '_, '_, '_>) -> bool {
    file.modules.commonjs.keeps_first_exports
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

fn find_plain_source(
    file: &FileLowering<'_, '_, '_, '_>,
    variable: CommonJsVariable,
) -> VariableSource {
    match variable {
        CommonJsVariable::Exports => match exports::own_shape(file) {
            Shape::Names | Shape::EsModule => VariableSource::NoObject,
            Shape::Value | Shape::AsToday if keeps_first_exports(file) => {
                VariableSource::FirstExports
            }
            Shape::Value | Shape::AsToday => VariableSource::ModuleExports,
        },
        _ => VariableSource::ModuleValue(builtin_of(variable)),
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
    scope::ensure_variable(
        file,
        VariableKey::ModulePath {
            file: file_id,
            variable,
        },
    )
}

fn find_source(file: &FileLowering<'_, '_, '_, '_>, variable: CommonJsVariable) -> VariableSource {
    match body_form(file) {
        BodyForm::Wrapped => {
            return match file.scopes.arguments_object(CodeUnit::File) {
                ArgumentsObject::Mapped => VariableSource::MappedWrapperParameter,
                ArgumentsObject::None | ArgumentsObject::Unmapped => {
                    VariableSource::WrapperParameter
                }
            };
        }
        BodyForm::Plain => return find_plain_source(file, variable),
        BodyForm::NotCommonJs => {}
    }
    match variable {
        CommonJsVariable::Module | CommonJsVariable::Exports => VariableSource::FreeName,
        // `bun run` declares `var __filename = import.meta.path`. Only a store to either tells the variable from the member.
        CommonJsVariable::Filename | CommonJsVariable::Dirname
            if is_stored(file, variable) || file.bound.import_meta_may_be_modified() =>
        {
            VariableSource::ModuleVariable
        }
        CommonJsVariable::Require | CommonJsVariable::Filename | CommonJsVariable::Dirname => {
            match file.builtins.commonjs_variable(variable) {
                Some(BuiltinPath {
                    id,
                    mutability: Mutability::AlwaysLocked,
                }) => VariableSource::ModuleValue(id),
                Some(BuiltinPath {
                    mutability: Mutability::ConstantUnlessWritten | Mutability::ChangesOnItsOwn,
                    ..
                })
                | None => VariableSource::ImportMetaMember(import_meta_member_name(variable)),
            }
        }
    }
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

// The path of a file and its folder, as the record of the file has them.
fn find_path_text(
    file: &FileLowering<'_, '_, '_, '_>,
    owner: FileId,
    builtin: BuiltinId,
) -> Option<Vec<u8>> {
    let path = file.inputs.sources.module_paths(owner).public_path;
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

fn emit_value_of_module(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    owner: FileId,
    builtin: BuiltinId,
) -> ValueId {
    if let Some(text) = find_path_text(lowering.file, owner, builtin) {
        let text = lowering.file.intern_bytes(&text);
        return lowering.builder.string(text);
    }
    let module = lowering
        .file
        .fragment
        .declare_module(ModuleRef::File(owner));
    let member: &[u8] = match builtin {
        BuiltinId::ImportMetaPath => b"path",
        BuiltinId::ImportMetaDir => b"dir",
        _ => return lowering.builder.module_builtin(builtin, module),
    };
    let meta = lowering
        .builder
        .module_builtin(BuiltinId::ImportMeta, module);
    let key = text_key(lowering.file, member);
    member::emit_get(lowering, meta, PropertyName::Constant(key))
}

fn emit_module_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    builtin: BuiltinId,
) -> ValueId {
    let own_file = lowering.file.file;
    emit_value_of_module(lowering, own_file, builtin)
}

/// `module.id`, `.filename`, `.path` and `.loaded`, and the same of `require.main`: what the record of the module says, as long as nobody holds the object, who could store there.
pub(super) fn try_lower_module_field(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
) -> Option<ValueId> {
    let file = &*lowering.file;
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
        ModuleObjectOwner::OwnFile if body_form(file) == BodyForm::Plain => file.file,
        ModuleObjectOwner::EntryPoint => main?,
        ModuleObjectOwner::OwnFile | ModuleObjectOwner::Related => return None,
    };
    if modules.keeps_module_object(ModuleRef::File(owner)) {
        return None;
    }
    let location = match field {
        ModuleField::Loaded => return Some(lowering.builder.boolean(true)),
        // The first CommonJS file under an ES entry point is "." too.
        ModuleField::Id if main.is_none() => return None,
        ModuleField::Id if main == Some(owner) => {
            let text = lowering.file.intern_bytes(b".");
            return Some(lowering.builder.string(text));
        }
        ModuleField::Id | ModuleField::Filename => BuiltinId::ImportMetaPath,
        ModuleField::Path => BuiltinId::ImportMetaDir,
    };
    Some(emit_value_of_module(lowering, owner, location))
}

fn emit_import_meta(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>) -> ValueId {
    emit_module_value(lowering, BuiltinId::ImportMeta)
}

// Whoever holds the module object can put another object in place of the exports, so the layout is only expected.
fn find_own_exports_type(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>) -> Option<TypeId> {
    let file = lowering.file.file;
    let layout = layouts::module_exports_layout(lowering.file, file)?;
    Some(lowering.file.fragment.types.intern(Type::layout(layout)))
}

fn expect_module_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    builtin: BuiltinId,
    value: ValueId,
) -> ValueId {
    if builtin == BuiltinId::ModuleObjectExports
        && let Some(expected) = find_own_exports_type(lowering)
    {
        return lowering.expect_type(value, expected);
    }
    lowering.expect_builtin(value, builtin)
}

fn expect_variable(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    variable: CommonJsVariable,
    value: ValueId,
) -> ValueId {
    if variable == CommonJsVariable::Exports
        && let Some(expected) = find_own_exports_type(lowering)
    {
        return lowering.expect_type(value, expected);
    }
    match lowering.file.builtins.commonjs_variable(variable) {
        Some(BuiltinPath {
            id,
            mutability: Mutability::AlwaysLocked | Mutability::ConstantUnlessWritten,
        }) => lowering.expect_builtin(value, id),
        Some(BuiltinPath {
            mutability: Mutability::ChangesOnItsOwn,
            ..
        })
        | None => value,
    }
}

pub(super) fn get_variable(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    variable: CommonJsVariable,
    purpose: ReadPurpose,
) -> ValueId {
    match find_source(lowering.file, variable) {
        VariableSource::WrapperParameter => {
            let scope = module::file_scope(lowering.file);
            let value = scope::get_slot(lowering, scope, ScopeSlot::CommonJs(variable));
            expect_variable(lowering, variable, value)
        }
        VariableSource::MappedWrapperParameter => {
            let index = wrapper_parameter_index(variable);
            let value = scope::get_mapped_argument(lowering, CodeUnit::File, index);
            expect_variable(lowering, variable, value)
        }
        VariableSource::ModuleValue(builtin) => emit_module_value(lowering, builtin),
        VariableSource::ModuleExports => {
            let value = exports::get_own_exports(lowering);
            expect_variable(lowering, variable, value)
        }
        VariableSource::FirstExports => {
            let first = ensure_path_variable(lowering.file, variable);
            let value = lowering.builder.get_module_variable(first);
            expect_variable(lowering, variable, value)
        }
        // Only whether it is an object can be asked of it.
        VariableSource::NoObject => lowering.builder.boolean(true),
        VariableSource::ImportMetaMember(name) => {
            let meta = emit_import_meta(lowering);
            let key = text_key(lowering.file, name);
            let value = member::emit_get(lowering, meta, PropertyName::Constant(key));
            expect_variable(lowering, variable, value)
        }
        VariableSource::ModuleVariable => {
            let variable = ensure_path_variable(lowering.file, variable);
            lowering.builder.get_module_variable(variable)
        }
        VariableSource::FreeName => {
            let is_for_type_of = match purpose {
                ReadPurpose::Value => false,
                ReadPurpose::TypeofOperand => true,
            };
            expression::emit_free_name_get(lowering, variable.name(), is_for_type_of)
        }
    }
}

pub(super) fn set_variable(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    variable: CommonJsVariable,
    value: ValueId,
) {
    match find_source(lowering.file, variable) {
        VariableSource::WrapperParameter => {
            let scope = module::file_scope(lowering.file);
            scope::set_slot(lowering, scope, ScopeSlot::CommonJs(variable), value);
        }
        VariableSource::MappedWrapperParameter => {
            let index = wrapper_parameter_index(variable);
            scope::set_mapped_argument(lowering, CodeUnit::File, index, value);
        }
        VariableSource::ModuleValue(_) | VariableSource::ImportMetaMember(_) => {
            debug_assert!(
                !is_commonjs_module(lowering.file),
                "a file that stores to the name keeps its wrapper"
            );
            let meta = emit_import_meta(lowering);
            let key = text_key(lowering.file, import_meta_member_name(variable));
            member::emit_set(lowering, meta, PropertyName::Constant(key), value);
        }
        // `exports = module.exports = value`: the inner store has put the value where `exports` is read from.
        VariableSource::ModuleExports | VariableSource::NoObject => {}
        VariableSource::FirstExports | VariableSource::ModuleVariable => {
            let variable = ensure_path_variable(lowering.file, variable);
            lowering.builder.put_module_variable(variable, value);
        }
        VariableSource::FreeName => {
            expression::emit_free_name_set(lowering, variable.name(), value);
        }
    }
}

// `exports` goes on naming the object that the body begins with when `module.exports` comes to hold another value.
pub(super) fn store_first_exports(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    first_exports: ValueId,
) {
    if keeps_first_exports(lowering.file) {
        let variable = ensure_path_variable(lowering.file, CommonJsVariable::Exports);
        lowering
            .builder
            .put_module_variable(variable, first_exports);
    }
}

/// What the body of the module passes to the function that holds its text.
pub(super) fn emit_passed_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    variable: CommonJsVariable,
) -> ValueId {
    emit_module_value(lowering, builtin_of(variable))
}

pub(in crate::lower) fn initialize_path_variables(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
) {
    for variable in [CommonJsVariable::Filename, CommonJsVariable::Dirname] {
        match find_source(lowering.file, variable) {
            VariableSource::ModuleVariable => {}
            _ => continue,
        }
        let meta = emit_import_meta(lowering);
        let key = text_key(lowering.file, import_meta_member_name(variable));
        let value = member::emit_get(lowering, meta, PropertyName::Constant(key));
        set_variable(lowering, variable, value);
    }
}

pub(super) fn emit_entry_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    variable: CommonJsVariable,
) -> ValueId {
    debug_assert_eq!(
        body_form(lowering.file),
        BodyForm::Wrapped,
        "no other body has a wrapper"
    );
    debug_assert_eq!(
        lowering.key,
        FunctionKey::WrappedModuleBody(lowering.file.file),
        "the wrapper's parameters are entry values of the function that holds the text"
    );
    let value = lowering
        .builder
        .parameter(wrapper_parameter_index(variable));
    expect_variable(lowering, variable, value)
}

fn find_variable(
    file: &FileLowering<'_, '_, '_, '_>,
    builtin: BuiltinId,
) -> Option<CommonJsVariable> {
    WRAPPER_PARAMETERS.into_iter().find(|&variable| {
        let path = file.builtins.commonjs_variable(variable);
        path.is_some_and(|path| path.id == builtin)
    })
}

fn find_wrapper_path(
    file: &FileLowering<'_, '_, '_, '_>,
    builtin: BuiltinId,
) -> Option<(CommonJsVariable, SmallVec<[BuiltinId; 4]>)> {
    if !is_commonjs_module(file) {
        return None;
    }
    let mut properties = SmallVec::new();
    let mut entry = builtin;
    loop {
        if let Some(variable) = find_variable(file, entry) {
            return Some((variable, properties));
        }
        properties.push(entry);
        entry = table::entry(entry).holder?;
    }
}

pub(crate) fn emit_module_builtin(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    builtin: BuiltinId,
) -> ValueId {
    debug_assert_eq!(
        table::entry(builtin).scope,
        Scope::Module,
        "a built-in of the realm is a Builtin value"
    );
    let Some((variable, properties)) = find_wrapper_path(lowering.file, builtin) else {
        return emit_module_value(lowering, builtin);
    };
    let mut value = get_variable(lowering, variable, ReadPurpose::Value);
    for &property in properties.iter().rev() {
        let name = table::entry(property).name;
        debug_assert!(
            !table::is_symbol_name(name),
            "a member of a module value has a text name"
        );
        let key = text_key(lowering.file, table::text_of_name(name));
        value = member::emit_get(lowering, value, PropertyName::Constant(key));
        value = expect_module_value(lowering, property, value);
    }
    value
}
