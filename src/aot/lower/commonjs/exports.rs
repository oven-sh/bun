use bun_sema::atom::{Atom, known};
use bun_sema::bind::{
    Binding, CodeUnit, CommonJsVariable, Decl, InitialState, ScopeId, SymbolId,
};
use bun_sema::check::aot::FunctionRef;
use bun_sema::hir::{ExprId, ExprKind, FnId, MemberKey, PatKind, PropKey, PropKind, StmtId};
use bun_sema::program::Sym;
use smallvec::SmallVec;

use super::variables::{self, BodyForm};
use crate::builtins::id::BuiltinId;
use crate::ir::generated::{ImportPhase, NullishAccess};
use crate::ir::{FunctionKey, ModuleId, ValueId, VariableId, VariableKey};
use crate::lower::captures::Capture;
use crate::lower::member::{self, PropertyName, Reference};
use crate::lower::scope::{self, BindingForm, BindingRef, Storage};
use crate::lower::{FileLowering, FunctionLowering, expression, function};
use crate::modules::{Member, ModuleRef, Shape, Site, SyntheticExportId, View};

pub(super) fn own_shape(file: &FileLowering<'_, '_, '_, '_>) -> Shape {
    file.inputs.modules.shape(ModuleRef::File(file.file))
}

fn top_scope_of(file: &FileLowering<'_, '_, '_, '_>, key: FunctionKey) -> Option<ScopeId> {
    let bound = file.bound;
    match key {
        FunctionKey::ModuleBody(_)
        | FunctionKey::WrappedModuleBody(_)
        | FunctionKey::FaceBody(_)
        | FunctionKey::CheckBody(_)
        | FunctionKey::Signature(_)
        | FunctionKey::ClassSignature(_) => None,
        FunctionKey::Source(source) => Some(bound.fns[source.function.idx()].scope),
        FunctionKey::ImplicitConstructor(class)
        | FunctionKey::InstanceInitializer(class)
        | FunctionKey::StaticInitializer(class) => Some(bound.class_scope[class.class.idx()]),
        FunctionKey::AccessorGetter { member, .. }
        | FunctionKey::AccessorSetter { member, .. }
        | FunctionKey::PrivateNameTest { member, .. } => {
            bound.member_class(member).map(|class| bound.class_scope[class.idx()])
        }
    }
}

/// The module that the code of the function belongs to: the file, or the inner module of a bundle that is written around it.
pub(super) fn current_module(lowering: &FunctionLowering<'_, '_, '_, '_, '_>) -> ModuleRef {
    let file = &*lowering.file;
    let modules = file.inputs.modules;
    let own_file = ModuleRef::File(file.file);
    if modules.inner_modules(file.file).is_empty() {
        return own_file;
    }
    let mut next = top_scope_of(file, lowering.key);
    while let Some(scope) = next {
        if let CodeUnit::Function(function) = file.bound.code_unit(scope)
            && let Some(inner) = modules.inner_module(file.file, function)
        {
            return inner;
        }
        next = file.bound.runtime_parent_scope(file.hir, scope).some();
    }
    own_file
}

pub(super) fn current_module_id(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>) -> ModuleId {
    let module = current_module(lowering);
    lowering.file.fragment.declare_module(module)
}

/// `return e` there ends the evaluation of a CommonJS module, and nobody gets `e`.
pub(super) fn drops_returned_value(lowering: &FunctionLowering<'_, '_, '_, '_, '_>) -> bool {
    match lowering.key {
        FunctionKey::ModuleBody(_) => variables::body_form(lowering.file) == BodyForm::Plain,
        _ => is_module_body(lowering),
    }
}

pub(super) fn is_module_body(lowering: &FunctionLowering<'_, '_, '_, '_, '_>) -> bool {
    let file = &*lowering.file;
    match lowering.key {
        FunctionKey::ModuleBody(_) => true,
        FunctionKey::Source(source) => {
            file.inputs.modules.inner_module(file.file, source.function).is_some()
        }
        FunctionKey::WrappedModuleBody(_)
        | FunctionKey::FaceBody(_)
        | FunctionKey::CheckBody(_)
        | FunctionKey::Signature(_)
        | FunctionKey::ClassSignature(_)
        | FunctionKey::ImplicitConstructor(_)
        | FunctionKey::InstanceInitializer(_)
        | FunctionKey::StaticInitializer(_)
        | FunctionKey::AccessorGetter { .. }
        | FunctionKey::AccessorSetter { .. }
        | FunctionKey::PrivateNameTest { .. } => false,
    }
}

/// The variable that holds `module.exports` of a module whose exports are one value.
pub(super) fn ensure_exports_variable(
    file: &mut FileLowering<'_, '_, '_, '_>,
    module: ModuleRef,
) -> Option<VariableId> {
    let key = match module {
        ModuleRef::File(file) => VariableKey::ModuleExports(file),
        ModuleRef::Inner { file, callback } => VariableKey::InnerModuleExports(FunctionRef {
            file,
            function: callback,
        }),
        ModuleRef::Face(_)
        | ModuleRef::Check(_)
        | ModuleRef::Runtime(_)
        | ModuleRef::External { .. } => return None,
    };
    Some(scope::ensure_variable(file, key))
}

pub(super) fn get_own_exports(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>) -> ValueId {
    let own_file = ModuleRef::File(lowering.file.file);
    let variable = ensure_exports_variable(lowering.file, own_file);
    let variable = variable.expect("a file has a variable for its exports");
    lowering.builder.get_module_variable(variable)
}

/// What `require` of an evaluated module answers. `None`: the module has no object, and nobody asks for one.
pub(super) fn emit_module_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    module: ModuleRef,
) -> Option<ValueId> {
    match lowering.file.inputs.modules.shape(module) {
        // `init_x()` of a bundle answers nothing: what the module exports are bindings of the file.
        Shape::EsModule if matches!(module, ModuleRef::Inner { .. }) => {
            Some(lowering.builder.undefined())
        }
        Shape::EsModule => {
            let module = lowering.file.fragment.declare_module(module);
            Some(lowering.builder.module_namespace(module, ImportPhase::Evaluation))
        }
        Shape::Value | Shape::AsToday if is_asked_of_module_object(lowering.file, module) => {
            let module = lowering.file.fragment.declare_module(module);
            let object = lowering.builder.module_builtin(BuiltinId::ModuleObject, module);
            let key = member::name_key(lowering.file, known::exports);
            Some(member::emit_get(lowering, object, PropertyName::Constant(key)))
        }
        Shape::Value | Shape::AsToday => {
            let variable = ensure_exports_variable(lowering.file, module)?;
            Some(lowering.builder.get_module_variable(variable))
        }
        Shape::Names => None,
    }
}

// The text of the module hands `module` to somebody, who can put an accessor in the place of `exports`:
// `Object.defineProperty(module, "exports", { get() { .. } })`. The object shows the variable until then.
fn is_asked_of_module_object(file: &FileLowering<'_, '_, '_, '_>, module: ModuleRef) -> bool {
    file.inputs.modules.commonjs().uses_module_object(module)
}

fn symbol_name(file: &FileLowering<'_, '_, '_, '_>, symbol: Sym) -> Atom {
    file.queries.files().bound(symbol.file).symbol(symbol.id).name
}

fn emit_checked_read(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    key: VariableKey,
    name: Atom,
) -> ValueId {
    let variable = scope::ensure_variable(lowering.file, key);
    let value = lowering.builder.get_module_variable(variable);
    let name = lowering.file.intern_atom(name);
    lowering.builder.check_initialized(value, name)
}

fn export_name(file: &FileLowering<'_, '_, '_, '_>, export: SyntheticExportId) -> Atom {
    file.inputs.modules.synthetic_export(export).name
}

// `None`: the member is a property of an object.
fn emit_member_read(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    member: Member,
) -> Option<ValueId> {
    Some(match member {
        Member::Variable(export) => {
            let key = VariableKey::SyntheticExport(export);
            let variable = scope::ensure_variable(lowering.file, key);
            lowering.builder.get_module_variable(variable)
        }
        Member::Copy(export) => {
            let name = export_name(lowering.file, export);
            emit_checked_read(lowering, VariableKey::Copy(export), name)
        }
        Member::Binding(symbol) if symbol.file == lowering.file.file => {
            let name = symbol_name(lowering.file, symbol);
            scope::get_binding(lowering, Binding::Symbol(symbol.id), name)
        }
        Member::Binding(symbol) => {
            let name = symbol_name(lowering.file, symbol);
            emit_checked_read(lowering, VariableKey::Symbol(symbol), name)
        }
        Member::Undefined | Member::Marker(false) => lowering.builder.undefined(),
        Member::Marker(true) => lowering.builder.boolean(true),
        Member::OnObject => return None,
    })
}

/// What an ES module gets under a name that it imports from a CommonJS module. `None`: the module does not have the name.
pub(super) fn read_imported_name(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    module: ModuleRef,
    name: Atom,
) -> Option<ValueId> {
    // The default of a module without the marker is what `module.exports` holds.
    if name == known::default && lowering.file.inputs.modules.marker(module) != Some(true) {
        return emit_module_value(lowering, module);
    }
    read_named_export(lowering, module, name)
}

/// What `require` of a module has under a name that no member access spells: a key of a pattern. `None`: the module never has
/// the name.
pub(super) fn read_named_export(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    module: ModuleRef,
    name: Atom,
) -> Option<ValueId> {
    let modules = lowering.file.inputs.modules;
    let member = match modules.member_named(module, name)? {
        Member::Undefined => return None,
        member => member,
    };
    if let Some(value) = emit_member_read(lowering, member) {
        return Some(value);
    }
    let object = emit_module_value(lowering, module)?;
    let key = member::name_key(lowering.file, name);
    Some(member::emit_get(lowering, object, PropertyName::Constant(key)))
}

fn find_root(file: &FileLowering<'_, '_, '_, '_>, access: ExprId) -> ExprId {
    let mut root = access;
    while let Some((object, _)) = file.hir.member_key(root) {
        root = expression::skip_type_syntax(file, object);
    }
    root
}

fn find_holder(file: &FileLowering<'_, '_, '_, '_>, name: ExprId) -> Option<(SymbolId, View)> {
    let ExprKind::Ident(_) = file.hir[name].kind else {
        return None;
    };
    let Binding::Symbol(symbol) = file.bound.binding(name) else {
        return None;
    };
    let view = file.inputs.modules.holder(file.file, symbol)?;
    Some((symbol, view))
}

// A closure that is made behind the initializer takes nothing of the holder along, and has nothing to test.
fn is_stored_for(lowering: &FunctionLowering<'_, '_, '_, '_, '_>, holder: SymbolId) -> bool {
    let binding = BindingRef::Symbol(holder);
    if lowering.scopes.find_local(binding).is_some() {
        return true;
    }
    let captures = lowering.file.scopes.captures(lowering.key);
    if captures.binary_search(&Capture::Value(binding)).is_ok() {
        return true;
    }
    match lowering.file.scopes.placement(binding).map(|placement| placement.storage) {
        Some(Storage::Field { .. } | Storage::Variable(_)) => true,
        Some(Storage::Local) | None => false,
    }
}

// What stands in front of the first dot does what it always did: a name may be in its dead zone, and a call of `require`
// evaluates the module. The answer is what a `var` holds, which may still be `undefined`, for the access to test.
// `exports`, `module.exports` and `this` of the module itself do nothing.
fn lower_root(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
) -> Option<ValueId> {
    let hir = lowering.file.hir;
    let root = find_root(lowering.file, access);
    if let ExprKind::Call(_) = hir[root].kind {
        expression::lower_expression_for_effect(lowering, root);
        return None;
    }
    let ExprKind::Ident(_) = hir[root].kind else {
        return None;
    };
    let Binding::Symbol(holder) = lowering.file.bound.binding(root) else {
        return None;
    };
    let is_read = match find_holder(lowering.file, root) {
        Some(_) => is_stored_for(lowering, holder),
        // A name that holds the one value of a module, whose members are variables all the same.
        None => {
            lowering.file.scopes.form(holder) == BindingForm::Stored
                && !is_inner_parameter(lowering, holder)
        }
    };
    if !is_read {
        return None;
    }
    lowering.set_position(hir[root].pos);
    let held = scope::lower_identifier(lowering, root);
    match lowering.file.bound.initial_state(holder) {
        InitialState::Undefined => Some(held),
        InitialState::Uninitialized | InitialState::Initialized => None,
    }
}

pub(in crate::lower) fn test_holder(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    holder: Option<ValueId>,
    access: NullishAccess,
) {
    if let Some(holder) = holder {
        lowering.builder.require_object_coercible(holder, access, None);
    }
}

/// What stands in front of a member that is bound to a variable is evaluated as it always was.
pub(super) fn check_member_root(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
) {
    let holder = lower_root(lowering, access);
    test_holder(lowering, holder, NullishAccess::Read);
}

fn find_bound_member(file: &FileLowering<'_, '_, '_, '_>, access: ExprId) -> Option<Member> {
    match file.inputs.modules.member(file.file, access)? {
        Member::OnObject => None,
        member => Some(member),
    }
}

pub(super) fn lower_export_member(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
) -> Option<ValueId> {
    let member = find_bound_member(lowering.file, access)?;
    let position = lowering.file.hir[access].pos;
    let holder = lower_root(lowering, access);
    lowering.set_position(position);
    test_holder(lowering, holder, NullishAccess::Read);
    emit_member_read(lowering, member)
}

// The module whose exports stand in front of the last dot of `R.N(..)`.
fn find_receiver_view(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
) -> Option<View> {
    let file = &*lowering.file;
    let (object, _) = file.hir.member_key(access)?;
    let object = expression::skip_type_syntax(file, object);
    if let Some((_, view)) = find_holder(file, object) {
        return Some(view);
    }
    if let ExprKind::Call(_) = file.hir[object].kind {
        return match file.inputs.modules.site(file.file, object)? {
            Site::Evaluate { target, .. } => Some(match file.inputs.modules.shape(target) {
                Shape::EsModule => View::Namespace(target),
                Shape::Names | Shape::Value | Shape::AsToday => {
                    View::Exports(target)
                }
            }),
            Site::AsToday => None,
        };
    }
    find_exports_mention(lowering, object).map(View::Exports)
}

/// `this` of a call of a bound member. A module without an object has only functions that do not look at it.
pub(super) fn lower_export_receiver(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
) -> ValueId {
    let receiver = match find_receiver_view(lowering, access) {
        Some(View::Namespace(module)) if lowering.file.inputs.modules.is_left_out(module) => None,
        Some(View::Namespace(module)) => {
            let module = lowering.file.fragment.declare_module(module);
            Some(lowering.builder.module_namespace(module, ImportPhase::Evaluation))
        }
        Some(View::Exports(module)) => emit_module_value(lowering, module),
        None => None,
    };
    receiver.unwrap_or_else(|| lowering.builder.undefined())
}

pub(super) fn lower_export_reference(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
) -> Option<Reference> {
    let member = find_bound_member(lowering.file, access)?;
    let holder = lower_root(lowering, access);
    Some(match member {
        Member::Variable(export) => Reference::ModuleVariable {
            variable: scope::ensure_variable(lowering.file, VariableKey::SyntheticExport(export)),
            holder,
        },
        // `exports.__esModule = true`, and `exports.n = void 0` in front of what makes `n` stand for another variable.
        Member::Undefined | Member::Marker(_) => Reference::Discarded { holder },
        Member::Copy(_) | Member::Binding(_) => {
            debug_assert!(false, "no store is bound to a copy or to a binding of the module");
            Reference::Discarded { holder }
        }
        Member::OnObject => unreachable!("find_bound_member leaves it to the object"),
    })
}

fn inner_parameter(
    file: &FileLowering<'_, '_, '_, '_>,
    callback: FnId,
    index: usize,
) -> Option<SymbolId> {
    let parameter = file.hir[callback].params.iter().nth(index)?;
    let pattern = file.hir[parameter].pat;
    let PatKind::Ident(_) = file.hir[pattern].kind else {
        return None;
    };
    Some(file.bound.declared_symbol(Decl::Param(pattern)))
}

/// `exports` and `module` of the callback of `__commonJS((exports, module) => { .. })`.
pub(super) fn inner_parameters(
    file: &FileLowering<'_, '_, '_, '_>,
    callback: FnId,
) -> [Option<SymbolId>; 2] {
    [inner_parameter(file, callback, 0), inner_parameter(file, callback, 1)]
}

fn is_inner_parameter(lowering: &FunctionLowering<'_, '_, '_, '_, '_>, symbol: SymbolId) -> bool {
    match current_module(lowering) {
        ModuleRef::Inner { callback, .. } => {
            inner_parameters(lowering.file, callback).contains(&Some(symbol))
        }
        ModuleRef::File(_)
        | ModuleRef::Face(_)
        | ModuleRef::Check(_)
        | ModuleRef::Runtime(_)
        | ModuleRef::External { .. } => false,
    }
}

fn names_symbol(file: &FileLowering<'_, '_, '_, '_>, name: ExprId, symbol: Option<SymbolId>) -> bool {
    matches!(file.hir[name].kind, ExprKind::Ident(_))
        && symbol.is_some_and(|symbol| file.bound.binding(name) == Binding::Symbol(symbol))
}

// `module.exports`, as it is written, of the module that the code belongs to.
fn find_module_exports_access(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
) -> Option<ModuleRef> {
    let file = &*lowering.file;
    let (object, key) = file.hir.member_key(access)?;
    if key != MemberKey::Name(known::exports) {
        return None;
    }
    match current_module(lowering) {
        module @ ModuleRef::Inner { callback, .. } => {
            let object = expression::skip_type_syntax(file, object);
            names_symbol(file, object, inner_parameter(file, callback, 1)).then_some(module)
        }
        module @ ModuleRef::File(_) => {
            let is_own = variables::body_form(file) == BodyForm::Plain
                && file.builtins.builtin_of_expression(access)
                    == Some(BuiltinId::ModuleObjectExports);
            is_own.then_some(module)
        }
        ModuleRef::Face(_)
        | ModuleRef::Check(_)
        | ModuleRef::Runtime(_)
        | ModuleRef::External { .. } => None,
    }
}

// `exports`, `module.exports` or `this` at the top of the module that the code belongs to.
fn find_exports_mention(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> Option<ModuleRef> {
    let file = &*lowering.file;
    if let Some(module) = find_module_exports_access(lowering, expression) {
        return Some(module);
    }
    let module = current_module(lowering);
    let is_mention = match (module, file.hir[expression].kind) {
        (ModuleRef::Inner { callback, .. }, ExprKind::Ident(_)) => {
            names_symbol(file, expression, inner_parameter(file, callback, 0))
        }
        // The table of built-ins also follows a stable `var u = exports`. It says nothing of a name that is stored to.
        (ModuleRef::File(_), ExprKind::Ident(_)) => {
            let names_exports = file.bound.binding(expression)
                == Binding::CommonJs(CommonJsVariable::Exports)
                || file.builtins.builtin_of_expression(expression)
                    == Some(BuiltinId::ModuleObjectExports);
            variables::body_form(file) == BodyForm::Plain && names_exports
        }
        (ModuleRef::File(_), ExprKind::This) => {
            variables::body_form(file) == BodyForm::Plain && function::is_this_of_module(lowering)
        }
        _ => false,
    };
    is_mention.then_some(module)
}

/// A read of `module.exports` is a read of the variable, and of one of the five names what the name stands for. The table of
/// built-ins has one entry for `exports` and `module.exports`, which are two places once one of them is stored to.
pub(super) fn try_lower_mention(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> Option<ValueId> {
    if let Some(value) = variables::try_lower_module_field(lowering, expression) {
        return Some(value);
    }
    if let Some(module) = find_module_exports_access(lowering, expression) {
        let value = emit_module_value(lowering, module);
        // Only whether it is an object can be asked of it.
        return Some(value.unwrap_or_else(|| lowering.builder.boolean(true)));
    }
    let file = &*lowering.file;
    if variables::body_form(file) != BodyForm::Plain {
        return None;
    }
    let ExprKind::Ident(_) = file.hir[expression].kind else {
        return None;
    };
    match file.bound.binding(expression) {
        Binding::CommonJs(variable) => {
            Some(variables::get_variable(lowering, variable, super::ReadPurpose::Value))
        }
        Binding::Symbol(_) | Binding::Arguments(_) | Binding::Free => None,
    }
}

/// `module.exports = value` stores the variable. Where the module has no object, the statement that stores is lowered as a whole.
pub(super) fn lower_module_exports_reference(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
) -> Option<Reference> {
    let module = find_module_exports_access(lowering, access)?;
    if is_asked_of_module_object(lowering.file, module) {
        return None;
    }
    Some(match lowering.file.inputs.modules.shape(module) {
        Shape::Value | Shape::AsToday => Reference::ModuleVariable {
            variable: ensure_exports_variable(lowering.file, module)?,
            holder: None,
        },
        Shape::Names | Shape::EsModule => Reference::Discarded { holder: None },
    })
}

/// `delete module.exports`: from then on `module.exports` reads `undefined`, and so does whoever requires the module.
pub(super) fn try_lower_exports_deletion(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
) -> Option<ValueId> {
    let module = find_module_exports_access(lowering, access)?;
    if is_asked_of_module_object(lowering.file, module) {
        return None;
    }
    let variable = match lowering.file.inputs.modules.shape(module) {
        Shape::Value | Shape::AsToday => ensure_exports_variable(lowering.file, module)?,
        Shape::Names | Shape::EsModule => return None,
    };
    let undefined = lowering.builder.undefined();
    lowering.builder.put_module_variable(variable, undefined);
    Some(lowering.builder.boolean(true))
}

fn find_described_value(file: &FileLowering<'_, '_, '_, '_>, descriptor: ExprId) -> Option<ExprId> {
    let hir = file.hir;
    let ExprKind::Object(properties) = hir[hir.skip_type_assertions(descriptor)].kind else {
        return None;
    };
    let mut described = properties.iter().map(|property| hir[property]);
    let value = described.find(|property| property.key == PropKey::Name(known::value))?;
    matches!(value.kind, PropKind::Init | PropKind::Shorthand).then_some(value.value)
}

/// `Object.defineProperty(exports, "n", { value: v })` where `n` is a variable, and the definition of the marker.
pub(super) fn try_lower_export_definition(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
) -> Option<ValueId> {
    let hir = lowering.file.hir;
    let member = find_bound_member(lowering.file, call)?;
    let ExprKind::Call(site) = hir[call].kind else {
        return None;
    };
    let arguments = hir[site].args;
    if arguments.len() != 3 {
        return None;
    }
    let described = find_described_value(lowering.file, hir.id_at(arguments, 2));
    match (member, described) {
        (Member::Variable(export), Some(described)) => {
            let value = expression::lower_expression(lowering, described);
            lowering.set_position(hir[call].pos);
            let key = VariableKey::SyntheticExport(export);
            let variable = scope::ensure_variable(lowering.file, key);
            lowering.builder.put_module_variable(variable, value);
        }
        (Member::Undefined | Member::Marker(_), Some(described)) => {
            expression::lower_expression_for_effect(lowering, described);
        }
        (Member::Undefined | Member::Marker(_), None) => {}
        (Member::Variable(_) | Member::Copy(_) | Member::Binding(_) | Member::OnObject, _) => {
            return None;
        }
    }
    // The call answers the object, which nobody looks at.
    Some(lowering.builder.boolean(true))
}

/// The module whose names the pattern takes, where `source` is a call of `require` that nobody reads as a value.
pub(super) fn find_destructured_module(
    file: &FileLowering<'_, '_, '_, '_>,
    source: ExprId,
) -> Option<ModuleRef> {
    let call = expression::skip_type_syntax(file, source);
    let ExprKind::Call(_) = file.hir[call].kind else {
        return None;
    };
    let modules = file.inputs.modules;
    match modules.site(file.file, call)? {
        Site::Evaluate { target, .. } if !modules.is_site_read_as_value(file.file, call) => {
            Some(target)
        }
        Site::Evaluate { .. } | Site::AsToday => None,
    }
}

fn find_plain_store(file: &FileLowering<'_, '_, '_, '_>, expression: ExprId) -> Option<(ExprId, ExprId)> {
    let expression = expression::skip_type_syntax(file, expression);
    match file.hir[expression].kind {
        ExprKind::Assign {
            op: None,
            target,
            value,
        } => Some((expression::skip_type_syntax(file, target), value)),
        _ => None,
    }
}

// `module.exports = value` and `exports = module.exports = value`: the module and the value.
fn find_exports_store(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> Option<(ModuleRef, ExprId)> {
    let file = &*lowering.file;
    let (target, value) = find_plain_store(file, expression)?;
    if let Some(module) = find_module_exports_access(lowering, target) {
        return Some((module, value));
    }
    let (inner_target, inner_value) = find_plain_store(file, value)?;
    let module = find_module_exports_access(lowering, inner_target)?;
    let names_exports = matches!(file.hir[target].kind, ExprKind::Ident(_))
        && find_exports_mention(lowering, target) == Some(module);
    names_exports.then_some((module, inner_value))
}

// `module.exports = { a, b: v, c() {} }`: all values, then the stores. A name that nobody reads has no variable.
fn lower_exported_literal(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    module: ModuleRef,
    literal: ExprId,
) -> bool {
    let hir = lowering.file.hir;
    let ExprKind::Object(properties) = hir[literal].kind else {
        return false;
    };
    let has_plain_keys = properties.iter().all(|property| {
        matches!(hir.runtime_property_key(property), PropKey::Name(_))
            && matches!(hir[property].kind, PropKind::Init | PropKind::Shorthand | PropKind::Method)
    });
    if !has_plain_keys {
        return false;
    }
    let mut stores: SmallVec<[(SyntheticExportId, ValueId); 8]> = SmallVec::new();
    for id in properties.iter() {
        let property = hir[id];
        let PropKey::Name(name) = hir.runtime_property_key(id) else {
            unreachable!("every key of the literal is a name");
        };
        lowering.set_position(property.pos);
        let member = lowering.file.inputs.modules.member_named(module, name);
        let Some(Member::Variable(export)) = member else {
            if property.kind != PropKind::Method {
                expression::lower_expression_for_effect(lowering, property.value);
            }
            continue;
        };
        let key = PropertyName::Constant(member::name_key(lowering.file, name));
        let value = match (property.kind, hir[property.value].kind) {
            // A method that uses `super` needs the object, so the module would have one.
            (PropKind::Method, ExprKind::Fn(method)) => {
                function::lower_function_expression(lowering, method, Some(key))
            }
            _ => expression::lower_named_evaluation(lowering, property.value, key),
        };
        stores.retain(|store| store.0 != export);
        stores.push((export, value));
    }
    lowering.set_position(hir[literal].pos);
    for (export, value) in stores {
        let key = VariableKey::SyntheticExport(export);
        let variable = scope::ensure_variable(lowering.file, key);
        lowering.builder.put_module_variable(variable, value);
    }
    true
}

/// A statement that stores `module.exports` of a module without an object: a literal gives each of its names its value.
pub(super) fn try_lower_exports_statement(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> bool {
    let Some((module, value)) = find_exports_store(lowering, expression) else {
        return false;
    };
    let value = expression::skip_type_syntax(lowering.file, value);
    match lowering.file.inputs.modules.shape(module) {
        Shape::Names => lower_exported_literal(lowering, module, value),
        Shape::Value | Shape::EsModule | Shape::AsToday => false,
    }
}

/// `export = value` of TypeScript is `module.exports = value` as a statement.
pub(super) fn try_lower_export_assignment(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ExprId,
) -> bool {
    let module = ModuleRef::File(lowering.file.file);
    let value = expression::skip_type_syntax(lowering.file, value);
    match lowering.file.inputs.modules.shape(module) {
        Shape::Names => lower_exported_literal(lowering, module, value),
        Shape::Value | Shape::EsModule | Shape::AsToday => false,
    }
}

/// The statement is `var require_x = __commonJS(..)` or another one that the graph of modules has taken all there is from.
pub(super) fn is_erased(file: &FileLowering<'_, '_, '_, '_>, statement: StmtId) -> bool {
    file.inputs.modules.erased(file.file, statement)
}
