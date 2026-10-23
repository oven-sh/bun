use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, Decl, FnOwner, Parent, SymbolId};
use bun_sema::hir::{ExprId, ExprKind, FnBody, FnId, PatKind, PropKey, StmtId, StmtKind};
use smallvec::SmallVec;

use super::member::{self, PropertyName};
use super::{FileLowering, FunctionLowering, control, expression, function, known_call, scope};
use crate::builtins::Resolved;
use crate::builtins::id::BuiltinId;
use crate::ir::{BlockId, Edge, ValueId};
use crate::known_helpers::Shape;
use crate::statistics::StatisticId;

#[derive(Copy, Clone)]
struct Parameter {
    symbol: SymbolId,
    name: Atom,
}

#[derive(Copy, Clone)]
struct NamedBuiltin {
    path: ExprId,
    builtin: BuiltinId,
}

pub(in crate::lower) fn emit_fast_path(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    source: FnId,
) {
    let helpers = lowering.file.inputs.known_helpers;
    let Some(known) = helpers.function(lowering.file.file, source) else {
        return;
    };
    lowering.file.count(StatisticId::KnownHelperFunctions, 1);
    match known.shape {
        Shape::CreateBindingReusesDescriptor => {
            if let [_, getter] = known.functions[..] {
                emit_live_binding(lowering, source, getter);
            }
        }
        Shape::ExportStarBindsNamesTheTargetLacks => {
            known_call::emit_export_star_fast_path(lowering, source);
        }
        _ => {}
    }
}

fn find_parameters(
    file: &FileLowering<'_, '_, '_, '_>,
    source: FnId,
) -> Option<SmallVec<[Parameter; 4]>> {
    let (hir, bound) = (file.hir, file.bound);
    let mut parameters = SmallVec::new();
    for parameter in hir[source].params.iter() {
        let pattern = hir[parameter].pat;
        let PatKind::Ident(name) = hir[pattern].kind else {
            return None;
        };
        let symbol = bound.declared_symbol(Decl::Param(pattern)).some()?;
        parameters.push(Parameter { symbol, name });
    }
    Some(parameters)
}

fn get_parameter(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    parameter: Parameter,
) -> ValueId {
    scope::get_binding(lowering, Binding::Symbol(parameter.symbol), parameter.name)
}

fn find_statements(file: &FileLowering<'_, '_, '_, '_>, source: FnId) -> SmallVec<[StmtId; 8]> {
    match file.hir[source].body {
        FnBody::Block(statements) => file.hir.ids(statements).collect(),
        FnBody::Expr(_) | FnBody::None => SmallVec::new(),
    }
}

fn find_first_initializer(
    file: &FileLowering<'_, '_, '_, '_>,
    statement: StmtId,
) -> Option<ExprId> {
    let StmtKind::Var(declarations) = file.hir[statement].kind else {
        return None;
    };
    let declaration = declarations.iter().next()?;
    file.hir[declaration].init.some()
}

fn find_callee(file: &FileLowering<'_, '_, '_, '_>, call: ExprId) -> Option<ExprId> {
    let ExprKind::Call(site) = file.hir[expression::skip_type_syntax(file, call)].kind else {
        return None;
    };
    Some(expression::skip_type_syntax(file, file.hir[site].callee))
}

fn find_property_name(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FnId,
) -> Option<PropertyName> {
    let FnOwner::Expr(expression) = file.bound.fns[function.idx()].owner else {
        return None;
    };
    let Parent::Prop(property) = file.bound.parent_of_expr(expression) else {
        return None;
    };
    let PropKey::Name(name) = file.hir.runtime_property_key(property) else {
        return None;
    };
    Some(PropertyName::Constant(member::name_key(file, name)))
}

fn names_builtin(file: &FileLowering<'_, '_, '_, '_>, named: NamedBuiltin) -> bool {
    match file.builtins.of_expr(named.path) {
        Some(Resolved::Builtin(path)) => path.id == named.builtin,
        Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => false,
    }
}

fn require(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    condition: ValueId,
    written_body: BlockId,
) {
    let passed = lowering.create_block();
    lowering
        .builder
        .branch(condition, Edge::to(passed), Edge::to(written_body));
    lowering.continue_in(passed);
}

// A fast path stands in for calls of built-ins, and the program may have put other functions in their places.
fn require_unchanged_builtin(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    named: NamedBuiltin,
    written_body: BlockId,
) {
    let value = expression::lower_expression(lowering, named.path);
    let builtin = expression::emit_locked_builtin(lowering, named.builtin);
    let is_unchanged = lowering.builder.strict_eq(value, builtin);
    require(lowering, is_unchanged, written_body);
}

fn emit_live_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    source: FnId,
    getter: FnId,
) {
    let [_, description, _, definition] = find_statements(lowering.file, source)[..] else {
        return;
    };
    let StmtKind::Expr(definition) = lowering.file.hir[definition].kind else {
        return;
    };
    let Some(description) = find_first_initializer(lowering.file, description) else {
        return;
    };
    let describe = find_callee(lowering.file, description);
    let define = find_callee(lowering.file, definition);
    let (Some(describe), Some(define)) = (describe, define) else {
        return;
    };
    let builtins = [
        NamedBuiltin {
            path: describe,
            builtin: BuiltinId::ObjectGetOwnPropertyDescriptor,
        },
        NamedBuiltin {
            path: define,
            builtin: BuiltinId::ObjectDefineProperty,
        },
    ];
    if !builtins
        .iter()
        .all(|&named| names_builtin(lowering.file, named))
    {
        return;
    }
    let Some(name) = find_property_name(lowering.file, getter) else {
        return;
    };
    let Some(parameters) = find_parameters(lowering.file, source) else {
        return;
    };
    let [target, module, source_key, target_key] = parameters[..] else {
        return;
    };

    let written_body = lowering.create_unlikely_block();
    for named in builtins {
        require_unchanged_builtin(lowering, named, written_body);
    }
    lowering.set_position(lowering.file.hir[definition].pos);
    let target = get_parameter(lowering, target);
    let module = get_parameter(lowering, module);
    let source_key = get_parameter(lowering, source_key);
    let target_key = get_parameter(lowering, target_key);
    let getter = function::lower_function_expression(lowering, getter, Some(name));
    let is_defined = lowering
        .builder
        .try_define_live_binding(target, module, source_key, target_key, getter);
    require(lowering, is_defined, written_body);
    control::emit_empty_return(lowering);
    lowering.continue_in(written_body);
}
