#[cfg(test)]
mod tests;

use core::cmp::Reverse;

use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, Bound, CodeUnit, CommonJsVariable, Decl, Parent, SymbolId};
use bun_sema::check::aot::ObjectOrigin;
use bun_sema::fold::{Constant, Decisions, FoldedValue};
use bun_sema::hir::{
    self, Call, ExprId, ExprKind, Flags, FnId, FnKind, MemberKey, PropKey, PropKind, StmtId,
    StmtKind,
};
use bun_sema::program::{FileId, Files, Sym};
use rustc_hash::FxHashSet;

use super::OwnFields;
use super::object_types::can_be_field;
use crate::builtins::ResolvedBuiltins;
use crate::builtins::id::BuiltinId;
use crate::ir::generated::{Field, FieldForm, Layout, LayoutKind, LimitId};
use crate::ir::{DeclaredType, LayoutId, LayoutKey};
use crate::lower::{CheckerTypeId, FileLowering, member, positions};
use crate::modules::{ModuleKind, ModuleRef, Shape};

fn find_name_position(hir: &hir::File<'_>, declaration: Decl) -> Option<u32> {
    match declaration {
        Decl::Enum(declaration) => Some(hir[declaration].name_pos),
        Decl::Module(declaration) => Some(hir[declaration].name_pos),
        Decl::Fn(function) => Some(hir[function].name_pos),
        Decl::Class(class) => Some(hir[class].name_pos),
        _ => None,
    }
}

fn find_container_position(file: &FileLowering<'_, '_, '_, '_>, symbol: Sym) -> u32 {
    let declarations = file.queries.files().decls_of(symbol);
    let mut own_declarations = declarations.iter().filter(|entry| entry.0 == file.file);
    let position = own_declarations.find_map(|entry| find_name_position(file.hir, entry.1));
    position.unwrap_or(0)
}

pub(in crate::lower) fn container_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    container: SymbolId,
) -> LayoutId {
    let symbol = file.queries.canonical_symbol(file.file, container);
    file.fragment.declare_layout(LayoutKey::Container(symbol))
}

fn is_file_symbol(file: &FileLowering<'_, '_, '_, '_>, symbol: Sym) -> bool {
    file.queries.files().bound(symbol.file).file_symbol == symbol.id
}

fn has_exports_object(file: &FileLowering<'_, '_, '_, '_>, module: FileId) -> bool {
    match file.inputs.modules.shape(ModuleRef::File(module)) {
        Shape::Value | Shape::AsToday => true,
        Shape::EsModule | Shape::Names => false,
    }
}

// The layout of the object that the body of a CommonJS module begins with as its `exports`, where its exports are one value.
pub(crate) fn module_exports_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    module: FileId,
) -> Option<LayoutId> {
    let modules = file.inputs.modules;
    if !modules.has_record(module)
        || modules.kind(module) != ModuleKind::CommonJs
        || modules.is_library(module)
        || !has_exports_object(file, module)
    {
        return None;
    }
    let bound = file.queries.files().bound(module);
    // `arguments.callee` is the function that holds the text of the module.
    if bound.file_uses_arguments() {
        return None;
    }
    let file_symbol = bound.file_symbol;
    if file_symbol.is_none() {
        return None;
    }
    // A file symbol that declarations of other files merge into is defined by no file alone.
    let symbol = file.queries.canonical_symbol(module, file_symbol);
    if symbol.file != module || symbol.id != file_symbol {
        return None;
    }
    let layout = file.fragment.declare_layout(LayoutKey::Container(symbol));
    let has_fields = !super::own_fields(file, layout).as_slice().is_empty();
    has_fields.then_some(layout)
}

pub(crate) fn module_type_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> Option<LayoutId> {
    let ObjectOrigin::Symbol(symbol) = file.queries.object_origin(ty) else {
        return None;
    };
    if !is_file_symbol(file, symbol) {
        return None;
    }
    module_exports_layout(file, symbol.file)
}

struct ModuleText<'x, 's> {
    files: &'x Files<'s>,
    hir: &'x hir::File<'s>,
    bound: &'x Bound<'s>,
    decisions: &'x Decisions<'s>,
    builtins: &'x ResolvedBuiltins,
    is_this_exports: bool,
}

#[derive(Copy, Clone)]
struct Assignment {
    node: ExprId,
    is_plain: bool,
    value: ExprId,
}

// `form` is `None` where the text does not say which form the property gets.
#[derive(Copy, Clone)]
struct Creation {
    name: Atom,
    form: Option<FieldForm>,
    is_deferred: bool,
    end: u32,
    start: u32,
}

fn find_code_unit(text: &ModuleText<'_, '_>, expression: ExprId) -> Option<CodeUnit> {
    let bound = text.bound;
    let mut child = expression;
    loop {
        let statement = match bound.parent_of_expr(child) {
            Parent::Expr(parent) => {
                child = parent;
                continue;
            }
            Parent::Prop(property) | Parent::PropKey(property) | Parent::MethodKey(property) => {
                child = bound.prop_owner[property.idx()];
                continue;
            }
            Parent::Stmt(statement) => statement,
            Parent::VarInit(declaration) => bound.var_stmt[declaration.idx()],
            Parent::File => return Some(CodeUnit::File),
            Parent::FnBody(function) => return Some(CodeUnit::Function(function)),
            Parent::ParamDefault(parameter) => {
                return Some(CodeUnit::Function(bound.param_fn[parameter.idx()]));
            }
            Parent::MemberInit(member) => return Some(CodeUnit::FieldInitializer(member)),
            _ => return None,
        };
        let scope = bound.scope_of_stmt(statement);
        return scope.is_some().then(|| bound.code_unit(scope));
    }
}

fn find_enclosing_unit(text: &ModuleText<'_, '_>, function: FnId) -> CodeUnit {
    let bound = text.bound;
    let mut next = bound.fns[function.idx()].scope.some();
    while let Some(scope) = next {
        let unit = bound.code_unit(scope);
        if unit != CodeUnit::Function(function) {
            return unit;
        }
        next = bound.runtime_parent_scope(text.hir, scope).some();
    }
    CodeUnit::File
}

fn reads_this_of_file(text: &ModuleText<'_, '_>, this: ExprId) -> bool {
    let Some(mut unit) = find_code_unit(text, this) else {
        return false;
    };
    while let CodeUnit::Function(function) = unit {
        if text.hir[function].kind != FnKind::Arrow {
            return false;
        }
        unit = find_enclosing_unit(text, function);
    }
    unit == CodeUnit::File
}

fn is_called_where_written(text: &ModuleText<'_, '_>, function: FnId) -> bool {
    let hir = text.hir;
    !hir[function]
        .flags
        .intersects(Flags::ASYNC | Flags::GENERATOR)
        && text
            .bound
            .get_immediately_invoked_function_expression(hir, function)
            .is_some()
}

fn runs_in_text_order(text: &ModuleText<'_, '_>, node: ExprId) -> bool {
    let Some(mut unit) = find_code_unit(text, node) else {
        return false;
    };
    while let CodeUnit::Function(function) = unit {
        if !is_called_where_written(text, function) {
            return false;
        }
        unit = find_enclosing_unit(text, function);
    }
    unit == CodeUnit::File
}

fn names_exports_object(text: &ModuleText<'_, '_>, expression: ExprId) -> bool {
    text.builtins.builtin_of_expression(expression) == Some(BuiltinId::ModuleObjectExports)
}

fn is_exports_object(text: &ModuleText<'_, '_>, expression: ExprId) -> bool {
    let expression = text.hir.skip_type_assertions(expression);
    if matches!(text.hir[expression].kind, ExprKind::This) {
        return text.is_this_exports && reads_this_of_file(text, expression);
    }
    names_exports_object(text, expression)
}

fn find_assignment(text: &ModuleText<'_, '_>, target: ExprId) -> Option<Assignment> {
    let Parent::Expr(parent) = text.bound.parent_of_expr(target) else {
        return None;
    };
    let ExprKind::Assign {
        op,
        target: assigned,
        value,
    } = text.hir.exprs.get(parent.idx())?.kind
    else {
        return None;
    };
    (assigned == target).then_some(Assignment {
        node: parent,
        is_plain: op.is_none(),
        value,
    })
}

fn find_constant(text: &ModuleText<'_, '_>, expression: ExprId) -> Option<Constant> {
    let expression = text.hir.skip_type_assertions(expression);
    match text.decisions.constant(text.hir, expression) {
        FoldedValue::Constant(constant) => Some(constant),
        FoldedValue::ConstantOutsideDeadZone(_) | FoldedValue::Unknown => None,
    }
}

fn find_constant_name(text: &ModuleText<'_, '_>, key: ExprId) -> Option<Atom> {
    match find_constant(text, key)? {
        Constant::String(name) => Some(name),
        _ => None,
    }
}

fn find_constant_flag(text: &ModuleText<'_, '_>, value: ExprId) -> Option<bool> {
    match find_constant(text, value)? {
        Constant::Boolean(flag) => Some(flag),
        Constant::Undefined | Constant::Null => Some(false),
        Constant::Number(_) | Constant::String(_) | Constant::BigInt(_) => None,
    }
}

fn with_part(form: FieldForm, part: FieldForm, has_part: bool) -> FieldForm {
    match has_part {
        true => form | part,
        false => form.without(part),
    }
}

// What ToPropertyDescriptor reads from an object literal.
fn find_defined_form(text: &ModuleText<'_, '_>, descriptor: ExprId) -> Option<FieldForm> {
    let hir = text.hir;
    let ExprKind::Object(properties) = hir[hir.skip_type_assertions(descriptor)].kind else {
        return None;
    };
    let mut form =
        FieldForm::IS_READ_ONLY | FieldForm::IS_NOT_ENUMERABLE | FieldForm::IS_NOT_CONFIGURABLE;
    let mut is_accessor = false;
    let mut is_data = false;
    for property in properties.iter().map(|property| hir[property]) {
        let PropKey::Name(name) = property.key else {
            return None;
        };
        match property.kind {
            PropKind::Init | PropKind::Shorthand | PropKind::Method => {}
            PropKind::Spread | PropKind::Getter | PropKind::Setter => return None,
        }
        match text.files.atoms.bytes(name) {
            b"value" => is_data = true,
            b"get" | b"set" => is_accessor = true,
            b"writable" => {
                is_data = true;
                let is_writable = find_constant_flag(text, property.value)?;
                form = with_part(form, FieldForm::IS_READ_ONLY, !is_writable);
            }
            b"enumerable" => {
                let is_enumerable = find_constant_flag(text, property.value)?;
                form = with_part(form, FieldForm::IS_NOT_ENUMERABLE, !is_enumerable);
            }
            b"configurable" => {
                let is_configurable = find_constant_flag(text, property.value)?;
                form = with_part(form, FieldForm::IS_NOT_CONFIGURABLE, !is_configurable);
            }
            b"__proto__" => return None,
            _ => {}
        }
    }
    match (is_accessor, is_data) {
        (true, true) => None,
        (true, false) => Some(form.without(FieldForm::IS_READ_ONLY) | FieldForm::IS_ACCESSOR),
        (false, true | false) => Some(form),
    }
}

fn create_creation(
    text: &ModuleText<'_, '_>,
    name: Atom,
    form: Option<FieldForm>,
    node: ExprId,
) -> Creation {
    Creation {
        name,
        form,
        is_deferred: !runs_in_text_order(text, node),
        end: text.hir[node].end,
        start: text.hir[node].pos,
    }
}

fn find_definition(text: &ModuleText<'_, '_>, expression: ExprId, call: &Call) -> Option<Creation> {
    let hir = text.hir;
    if call.args.len() != 3 {
        return None;
    }
    let callee = text
        .builtins
        .builtin_of_expression(hir.skip_type_assertions(call.callee))?;
    let defines_property = matches!(
        callee,
        BuiltinId::ObjectDefineProperty | BuiltinId::ReflectDefineProperty
    );
    if !defines_property || !is_exports_object(text, hir.id_at(call.args, 0)) {
        return None;
    }
    let name = find_constant_name(text, hir.id_at(call.args, 1))?;
    let form = find_defined_form(text, hir.id_at(call.args, 2));
    Some(create_creation(text, name, form, expression))
}

fn find_stored_name(text: &ModuleText<'_, '_>, key: MemberKey) -> Option<Atom> {
    match key {
        MemberKey::Name(name) => Some(name),
        MemberKey::Computed(computed) => find_constant_name(text, computed),
        MemberKey::PrivateName(_) => None,
    }
}

fn has_export_assignment(bound: &Bound<'_>) -> bool {
    let exports = bound.symbol(bound.file_symbol).exports;
    let Some(assigned) = bound.lookup(exports, known::export_equals) else {
        return false;
    };
    let mut declarations = bound.symbol(assigned).decls.iter();
    declarations.any(|declaration| matches!(declaration, Decl::ExportExpr(_)))
}

fn stores_object_variable(text: &ModuleText<'_, '_>) -> bool {
    let mut stores = text.bound.runtime.unbound_name_stores().iter();
    stores.any(|&(target, _)| match text.bound.binding(target) {
        Binding::CommonJs(CommonJsVariable::Exports | CommonJsVariable::Module) => {
            !text.decisions.is_dead_expr(target)
        }
        Binding::CommonJs(
            CommonJsVariable::Require | CommonJsVariable::Filename | CommonJsVariable::Dirname,
        )
        | Binding::Symbol(_)
        | Binding::Arguments(_)
        | Binding::Free => false,
    })
}

// `None`: the module puts another object in place of the one its body starts with, so the names land there.
fn collect_creations(text: &ModuleText<'_, '_>) -> Option<Vec<Creation>> {
    let (hir, bound) = (text.hir, text.bound);
    if has_export_assignment(bound) || stores_object_variable(text) {
        return None;
    }
    let mut creations = Vec::new();
    for expression in (0..hir.exprs.len() as u32).map(ExprId) {
        if let ExprKind::Call(call) = hir[expression].kind {
            creations.extend(find_definition(text, expression, &hir[call]));
            continue;
        }
        let Some((object, key)) = hir.member_key(expression) else {
            continue;
        };
        if !bound.is_write_access(hir, expression) || text.decisions.is_dead_expr(expression) {
            continue;
        }
        let assignment = find_assignment(text, expression);
        if names_exports_object(text, expression) {
            let keeps_object =
                assignment.is_some_and(|it| it.is_plain && is_exports_object(text, it.value));
            if !keeps_object {
                return None;
            }
            continue;
        }
        if !is_exports_object(text, object) {
            continue;
        }
        let Some(name) = find_stored_name(text, key) else {
            continue;
        };
        // The value is evaluated before the store.
        let node = assignment.map_or(expression, |it| it.node);
        creations.push(create_creation(
            text,
            name,
            Some(FieldForm::default()),
            node,
        ));
    }
    Some(creations)
}

struct Replacement {
    module_name: ExprId,
    exports_name: Option<ExprId>,
    value: ExprId,
    start: u32,
    end: u32,
}

fn find_plain_store(text: &ModuleText<'_, '_>, expression: ExprId) -> Option<(ExprId, ExprId)> {
    let hir = text.hir;
    match hir[hir.skip_type_assertions(expression)].kind {
        ExprKind::Assign {
            op: None,
            target,
            value,
        } => Some((hir.skip_type_assertions(target), value)),
        _ => None,
    }
}

// The `module` of a `module.exports` that is written so.
fn find_module_name(text: &ModuleText<'_, '_>, access: ExprId) -> Option<ExprId> {
    let (object, _) = text.hir.member_key(access)?;
    names_exports_object(text, access).then(|| text.hir.skip_type_assertions(object))
}

fn names_variable(text: &ModuleText<'_, '_>, name: ExprId, variable: CommonJsVariable) -> bool {
    matches!(text.hir[name].kind, ExprKind::Ident(_))
        && text.bound.binding(name) == Binding::CommonJs(variable)
}

// `module.exports = value` or `exports = module.exports = value` as a statement of the body.
fn find_replacement(text: &ModuleText<'_, '_>, statement: StmtId) -> Option<Replacement> {
    let hir = text.hir;
    let StmtKind::Expr(expression) = hir[statement].kind else {
        return None;
    };
    if text.decisions.is_dead_stmt(statement) {
        return None;
    }
    let (start, end) = (hir[expression].pos, hir[expression].end);
    let (target, value) = find_plain_store(text, expression)?;
    if let Some(module_name) = find_module_name(text, target) {
        return Some(Replacement {
            module_name,
            exports_name: None,
            value,
            start,
            end,
        });
    }
    if !names_variable(text, target, CommonJsVariable::Exports) {
        return None;
    }
    let (inner_target, value) = find_plain_store(text, value)?;
    Some(Replacement {
        module_name: find_module_name(text, inner_target)?,
        exports_name: Some(target),
        value,
        start,
        end,
    })
}

// A function declaration can be called from the first statement on. Any other function is made where it is written.
fn runs_behind_its_position(text: &ModuleText<'_, '_>, mention: ExprId) -> bool {
    let Some(mut unit) = find_code_unit(text, mention) else {
        return false;
    };
    let mut outermost = None;
    while let CodeUnit::Function(function) = unit {
        outermost = Some(function);
        unit = find_enclosing_unit(text, function);
    }
    unit == CodeUnit::File
        && outermost.is_none_or(|function| text.hir[function].kind != FnKind::Decl)
}

fn is_evaluated_behind(
    text: &ModuleText<'_, '_>,
    replacement: &Replacement,
    mention: ExprId,
) -> bool {
    let hir = text.hir;
    let position = hir[mention].pos;
    if position >= replacement.end {
        return runs_behind_its_position(text, mention);
    }
    // A function that is the value itself is not called before it is stored.
    let value = hir.skip_type_assertions(replacement.value);
    position >= replacement.start && matches!(hir[value].kind, ExprKind::Fn(_))
}

// A body that returns in front of the statement exports the object it began with.
fn can_return_in_front_of(text: &ModuleText<'_, '_>, replacement: &Replacement) -> bool {
    let (hir, bound) = (text.hir, text.bound);
    (0..hir.stmts.len() as u32).map(StmtId).any(|statement| {
        let scope = bound.scope_of_stmt(statement);
        matches!(hir[statement].kind, StmtKind::Return(_))
            && hir[statement].loc.pos < replacement.start
            && !text.decisions.is_dead_stmt(statement)
            && (scope.is_none() || bound.code_unit(scope) == CodeUnit::File)
    })
}

// Everything that the text says of the exports comes behind a statement that puts a value in their place.
fn replaces_exports_first(text: &ModuleText<'_, '_>) -> bool {
    let (hir, bound) = (text.hir, text.bound);
    let mut statements = hir.ids(hir.body);
    let Some(replacement) = statements.find_map(|statement| find_replacement(text, statement))
    else {
        return false;
    };
    if can_return_in_front_of(text, &replacement) {
        return false;
    }
    (0..hir.exprs.len() as u32).map(ExprId).all(|mention| {
        let variable = match hir[mention].kind {
            ExprKind::This => return !(text.is_this_exports && reads_this_of_file(text, mention)),
            ExprKind::Ident(_) => match bound.binding(mention) {
                Binding::CommonJs(
                    variable @ (CommonJsVariable::Exports | CommonJsVariable::Module),
                ) => variable,
                _ => return true,
            },
            _ => return true,
        };
        if text.decisions.is_dead_expr(mention)
            || mention == replacement.module_name
            || Some(mention) == replacement.exports_name
        {
            return true;
        }
        let names_replaced_value = match variable {
            CommonJsVariable::Exports => replacement.exports_name.is_some(),
            _ => match bound.parent_of_expr(mention) {
                Parent::Expr(access) => hir
                    .member_key(access)
                    .is_some_and(|(object, _)| object == mention),
                _ => false,
            },
        };
        names_replaced_value && is_evaluated_behind(text, &replacement, mention)
    })
}

// `false`: nobody can see the object, so the body does not make it. A module that is required while its body runs shows it.
pub(crate) fn begins_with_exports_object(
    file: &FileLowering<'_, '_, '_, '_>,
    module: FileId,
) -> bool {
    let own_module = ModuleRef::File(module);
    let modules = file.inputs.modules;
    if modules.half(own_module) || modules.keeps_module_object(own_module) {
        return true;
    }
    let files = file.queries.files();
    let (Some(compiled), Some(inputs)) = (files.compiled(module), file.inputs.files[module.idx()])
    else {
        return true;
    };
    let text = ModuleText {
        files,
        hir: files.hir(module),
        bound: files.bound(module),
        decisions: &compiled.analysis.decisions,
        builtins: inputs.builtins,
        is_this_exports: !compiled.analysis.has_esm_syntax,
    };
    !replaces_exports_first(&text)
}

// The fields are in the order in which the body creates the properties, which is the one order of keys that a creating store goes on from without a call.
fn compute_exports_fields(file: &mut FileLowering<'_, '_, '_, '_>, module: FileId) -> OwnFields {
    let files = file.queries.files();
    let (Some(compiled), Some(inputs)) = (files.compiled(module), file.inputs.files[module.idx()])
    else {
        return OwnFields::default().finish();
    };
    let text = ModuleText {
        files,
        hir: files.hir(module),
        bound: files.bound(module),
        decisions: &compiled.analysis.decisions,
        builtins: inputs.builtins,
        is_this_exports: !compiled.analysis.has_esm_syntax,
    };
    let mut creations = collect_creations(&text).unwrap_or_default();
    creations.sort_by_key(|it| (it.is_deferred, it.end, Reverse(it.start)));

    let limit = file.inputs.limits.get(LimitId::FieldsInKeyOrder);
    let mut created_names = FxHashSet::default();
    let mut fields = OwnFields::default();
    for creation in creations {
        if !created_names.insert(creation.name) {
            continue;
        }
        let Some(form) = creation.form else {
            continue;
        };
        let key = file.atom_key(creation.name);
        if !can_be_field(file, key) {
            continue;
        }
        if fields.as_slice().len() as u64 >= limit {
            if module == file.file {
                file.gave_up(LimitId::FieldsInKeyOrder, 0);
            }
            break;
        }
        fields.add(Field {
            key: Some(key),
            declared: DeclaredType::untyped(),
            form,
            ..Field::default()
        });
    }
    fields.finish()
}

pub(super) fn compute_container_fields(
    file: &mut FileLowering<'_, '_, '_, '_>,
    symbol: Sym,
) -> OwnFields {
    if is_file_symbol(file, symbol) {
        return compute_exports_fields(file, symbol.file);
    }
    if symbol.file != file.file {
        return OwnFields::default();
    }
    let bound = file.bound;
    let limit = file.inputs.limits.get(LimitId::FieldsInKeyOrder);
    let mut fields = OwnFields::default();
    for &(name, export) in bound.table(bound.symbol(symbol.id).exports) {
        if !bound.has_runtime_value(export) {
            continue;
        }
        let key = member::name_key(file, name);
        if !can_be_field(file, key) {
            continue;
        }
        if fields.as_slice().len() as u64 >= limit {
            let position = find_container_position(file, symbol);
            file.gave_up(LimitId::FieldsInKeyOrder, position);
            break;
        }
        let mut declarations = bound.symbol(export).decls.iter();
        let is_enum_member = declarations.any(|decl| matches!(decl, Decl::EnumMember(_)));
        let declared = match is_enum_member {
            true => DeclaredType::untyped(),
            false => positions::binding_position(file, export),
        };
        fields.add(Field {
            key: Some(key),
            declared,
            ..Field::default()
        });
    }
    fields.finish()
}

pub(super) fn define_container_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    layout: LayoutId,
    symbol: Sym,
) {
    debug_assert!(
        symbol.file == file.file,
        "a container is defined by its file"
    );
    let name = file.bound.symbol(symbol.id).name;
    // The exports of a module are an ordinary object to every pass that looks at the kind.
    let is_module_exports = is_file_symbol(file, symbol);
    let kind = match is_module_exports {
        true => LayoutKind::Record,
        false => LayoutKind::Container,
    };
    let definition = Layout {
        kind,
        name: (name.is_some() && !is_module_exports)
            .then(|| file.intern_binding_name(Binding::Symbol(symbol.id), name)),
        module: Some(file.module_id()),
        position: find_container_position(file, symbol),
        fields: super::own_fields(file, layout).as_slice().to_vec(),
        ..Layout::default()
    };
    // The body of the module makes the object, and a field is there because the module puts something under its name.
    file.fragment.note_allocation(layout);
    for key in definition.fields.iter().filter_map(|field| field.key) {
        file.fragment.note_write(key);
    }
    file.fragment.define_layout(layout, definition);
}
