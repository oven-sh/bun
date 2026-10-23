use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, BindingStability, Decl};
use bun_sema::hir::{
    ClassId, ExprId, Flags, FnBody, FnId, NodeData, PatId, PatKind, StmtId, VarDeclId, VarKind,
};

use crate::ir::generated::TypeSiteKind;
use crate::lower::member::{self, PropertyName};
use crate::lower::{
    FunctionLowering, class, commonjs, convert, expression, pattern, positions, scope,
};

pub(crate) fn lower_variable_declaration(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    declaration: VarDeclId,
) {
    let (hir, bound) = (lowering.file.hir, lowering.file.bound);
    let decl = hir[declaration];
    if decl.flags.contains(Flags::AMBIENT) || is_unread_export(lowering, decl.pat) {
        return;
    }
    let left_out = lowering
        .file
        .inputs
        .library_functions
        .left_out_declarations();
    if left_out.is_declarator_left_out(lowering.file.file, declaration) {
        return;
    }
    let Some(initializer) = decl.init.some() else {
        match bound.variable_kind(hir, declaration) {
            VarKind::Let => initialize_let_to_undefined(lowering, decl.pat),
            VarKind::Var | VarKind::Const | VarKind::Using | VarKind::AwaitUsing => {}
        }
        return;
    };
    if initialize_holder(lowering, decl.pat, initializer) {
        return;
    }
    let dynamic_scope = bound.dynamic_lookup_scope(NodeData::Pat(decl.pat));
    let target = dynamic_scope.map(|_| scope::resolve_pattern_target(lowering, decl.pat));
    let value = match hir[decl.pat].kind {
        // `export const f = function () {}` in a namespace is the store `N.f = function () {}`, which names nothing.
        PatKind::Ident(_) if is_container_member(lowering, decl.pat) => {
            expression::lower_expression(lowering, initializer)
        }
        PatKind::Ident(name) => {
            let binding = bound.initialized_binding(decl.pat);
            let key = member::function_name_key(lowering.file, binding, name);
            let name = PropertyName::Constant(key);
            expression::lower_named_evaluation(lowering, initializer, name)
        }
        // The pattern takes each name from where the module keeps it, and nothing from what the call yields.
        PatKind::Object(_)
            if commonjs::find_destructured_module(lowering.file, initializer).is_some() =>
        {
            expression::lower_expression(lowering, initializer)
        }
        PatKind::Missing | PatKind::Object(_) | PatKind::Array(_) => {
            let value = expression::lower_expression(lowering, initializer);
            let position =
                positions::annotation_position(lowering.file, decl.ty, TypeSiteKind::Variable);
            lowering.set_position(hir[decl.pat].pos);
            convert::convert_initializer(lowering, value, position, Some(initializer))
        }
    };
    match target {
        Some(target) => {
            lowering.set_position(hir[decl.pat].pos);
            scope::set_identifier_target(lowering, &target, value, Some(initializer));
        }
        None => pattern::bind_pattern(lowering, decl.pat, value, Some(initializer)),
    }
}

// `const a = require(K)`, where every use of `a` is bound to what the module exports.
fn initialize_holder(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    pattern: PatId,
    initializer: ExprId,
) -> bool {
    let file = &*lowering.file;
    let PatKind::Ident(name) = file.hir[pattern].kind else {
        return false;
    };
    let Binding::Symbol(symbol) = file.bound.initialized_binding(pattern) else {
        return false;
    };
    if file.inputs.modules.holder(file.file, symbol).is_none() {
        return false;
    }
    let held = expression::lower_expression(lowering, initializer);
    lowering.set_position(lowering.file.hir[pattern].pos);
    scope::initialize_converted_symbol(lowering, symbol, name, held);
    true
}

fn is_unread_export(lowering: &FunctionLowering<'_, '_, '_, '_, '_>, pattern: PatId) -> bool {
    let file = &*lowering.file;
    let unread_exports = file.inputs.modules.unread_exports(file.file);
    if unread_exports.is_empty() {
        return false;
    }
    match file.hir[pattern].kind {
        PatKind::Ident(_) => {
            let symbol = file.bound.declared_symbol(Decl::Var(pattern));
            unread_exports.binary_search(&symbol).is_ok()
        }
        PatKind::Missing | PatKind::Object(_) | PatKind::Array(_) => false,
    }
}

fn is_container_member(lowering: &FunctionLowering<'_, '_, '_, '_, '_>, pattern: PatId) -> bool {
    let bound = lowering.file.bound;
    let symbol = bound.declared_symbol(Decl::Var(pattern));
    bound.binding_stability(symbol) == BindingStability::ContainerMember
}

fn initialize_let_to_undefined(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    pattern: PatId,
) {
    let bound = lowering.file.bound;
    let PatKind::Ident(name) = lowering.file.hir[pattern].kind else {
        return;
    };
    if is_container_member(lowering, pattern) {
        return;
    }
    let symbol = bound.declared_symbol(Decl::Var(pattern));
    let undefined = lowering.builder.undefined();
    scope::initialize_binding(lowering, Binding::Symbol(symbol), name, undefined);
}

pub(super) fn lower_function_statement(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statement: StmtId,
    function: FnId,
) {
    let Some(implicit_block) = lowering.file.bound.own_scope(statement).some() else {
        return lower_function_declaration(lowering, function);
    };
    scope::enter_scope(lowering, implicit_block);
    lower_function_declaration(lowering, function);
    scope::leave_scope(lowering, implicit_block);
}

fn lower_function_declaration(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, function: FnId) {
    let (hir, bound) = (lowering.file.hir, lowering.file.bound);
    if matches!(hir[function].body, FnBody::None) {
        return;
    }
    let name = hir[function].name;
    store_namespace_export(lowering, Decl::Fn(function), name);
    let copies = bound.runtime.annex_b_functions();
    let Ok(index) = copies.binary_search_by_key(&function, |copy| copy.function) else {
        return;
    };
    let copy = copies[index];
    let value = scope::get_binding(lowering, Binding::Symbol(copy.block_symbol), name);
    scope::set_binding(lowering, Binding::Symbol(copy.var_symbol), name, value);
}

pub(super) fn lower_class_statement(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statement: StmtId,
    class: ClassId,
) {
    let hir = lowering.file.hir;
    if hir[class].flags.contains(Flags::AMBIENT) {
        return;
    }
    let left_out = lowering
        .file
        .inputs
        .library_functions
        .left_out_declarations();
    if left_out.is_class_left_out(lowering.file.file, class) {
        return;
    }
    class::lower_class_declaration(lowering, class);
    lowering.set_position(hir[statement].start);
    store_namespace_export(lowering, Decl::Class(class), hir[class].name);
}

fn store_namespace_export(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    declaration: Decl,
    name: Atom,
) {
    let bound = lowering.file.bound;
    let Some(binding) = bound.declared_symbol(declaration).some() else {
        return;
    };
    let member = bound.export_symbol_of_value_symbol_if_exported(binding);
    if member == binding {
        return;
    }
    let value = scope::get_binding(lowering, Binding::Symbol(binding), name);
    scope::initialize_binding(lowering, Binding::Symbol(member), name, value);
}
