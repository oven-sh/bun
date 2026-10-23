use bun_sema::atom::{Atom, written_name};
use bun_sema::fold::Decision;
use bun_sema::hir::{BinOp, Chain, ExprFlags, ExprId, ExprKind, FnBody, FnId, MemberKey, StmtKind};

use super::Callee;
use crate::builtins::Resolved;
use crate::builtins::id::BuiltinId;
use crate::ir::{BlockId, StringId, ValueId};
use crate::lower::member::{self, KeyConversion, PropertyName};
use crate::lower::{
    FileLowering, FunctionLowering, commonjs, expression, function, module, private_names, scope,
};

pub(in crate::lower) fn lower_callee(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    callee: ExprId,
    exit: Option<BlockId>,
) -> Callee {
    lower_expected_callee(lowering, callee, exit, None)
}

// A built-in that the signature of the call names says more than the type the checker has for the callee.
pub(super) fn lower_expected_callee(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    callee: ExprId,
    exit: Option<BlockId>,
    expected: Option<BuiltinId>,
) -> Callee {
    let mut lowered = lower_callee_by_decision(lowering, callee, exit, expected);
    if let Some(builtin) = expected {
        lowered.function = lowering.expect_builtin(lowered.function, builtin);
    }
    lowered
}

fn lower_callee_by_decision(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    callee: ExprId,
    exit: Option<BlockId>,
    expected: Option<BuiltinId>,
) -> Callee {
    let hir = lowering.file.hir;
    let inner = expression::skip_type_syntax(lowering.file, callee);
    match lowering.file.decisions().decision(inner) {
        Decision::Unknown => {}
        Decision::GlobalPath(path) => {
            lowering.set_position(hir[inner].pos);
            return lower_global_path_callee(lowering, inner, path);
        }
        Decision::Constant(_) | Decision::Data(_) | Decision::DeferredData => {
            return Callee {
                function: expression::lower_expression(lowering, inner),
                this: None,
                key: None,
                name: None,
            };
        }
    }
    let is_parenthesized = hir.expr_flags(inner).contains(ExprFlags::PARENTHESIZED);
    if expression::is_chain_root(lowering.file, inner) && (exit.is_none() || is_parenthesized) {
        return lower_chain_callee(lowering, inner, expected);
    }
    lower_callee_with_exit(lowering, callee, inner, exit, expected)
}

fn finish_callee(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    callee: ExprId,
    function: ValueId,
    expected: Option<BuiltinId>,
) -> ValueId {
    match expected {
        Some(_) => function,
        None => expression::finish_expression(lowering, callee, function),
    }
}

// JSC reports a call at the end of its callee, which the source map takes back to this token.
pub(in crate::lower) fn last_mapped_position(
    file: &FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
) -> u32 {
    let hir = file.hir;
    let mut last = expression::skip_type_syntax(file, expression);
    loop {
        let next = match hir[last].kind {
            ExprKind::Index { index, .. } => index,
            ExprKind::Binary { right, .. } => right,
            ExprKind::Assign { value, .. } => value,
            ExprKind::Cond { branches, .. } => hir.branches(branches).no,
            ExprKind::Await(operand) => operand,
            ExprKind::New(site) if hir[site].close_pos == u32::MAX => hir[site].callee,
            ExprKind::Fn(function) => match last_expression_of_body(file, function) {
                Some(expression) => expression,
                None => return hir[last].end - 1,
            },
            ExprKind::Dot { .. } => return hir.name_pos(last),
            ExprKind::Call(site) | ExprKind::New(site) => return hir[site].close_pos,
            ExprKind::Array(_) | ExprKind::Object(_) => return hir[last].end - 1,
            _ => return hir[last].pos,
        };
        last = expression::skip_type_syntax(file, next);
    }
}

// An operation JSC records no position for is reported at the last position recorded before it, which belongs to the end of the operand.
pub(in crate::lower) fn last_reported_position(
    file: &FileLowering<'_, '_, '_, '_>,
    operand: ExprId,
) -> u32 {
    let hir = file.hir;
    let mut last = expression::skip_type_syntax(file, operand);
    loop {
        let next = match hir[last].kind {
            ExprKind::Call(site) => return last_mapped_position(file, hir[site].callee),
            ExprKind::New(_) => return super::construct_position(file, last),
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                return last_mapped_position(file, obj);
            }
            ExprKind::Cond { branches, .. } => hir.branches(branches).no,
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma,
                right,
                ..
            } => right,
            ExprKind::Assign { value, .. } => value,
            ExprKind::Await(awaited) => awaited,
            _ => return hir[last].pos,
        };
        last = expression::skip_type_syntax(file, next);
    }
}

fn last_expression_of_body(file: &FileLowering<'_, '_, '_, '_>, function: FnId) -> Option<ExprId> {
    let hir = file.hir;
    let statement = match hir[function].body {
        FnBody::None => return None,
        FnBody::Expr(body) => return Some(body),
        FnBody::Block(statements) => hir.ids(statements).last()?,
    };
    match hir[statement].kind {
        StmtKind::Expr(value) | StmtKind::Throw(value) => Some(value),
        StmtKind::Return(value) => value.is_some().then_some(value),
        _ => None,
    }
}

pub(super) fn find_callee_name(
    file: &mut FileLowering<'_, '_, '_, '_>,
    callee: ExprId,
) -> Option<StringId> {
    let hir = file.hir;
    let inner = expression::skip_type_syntax(file, callee);
    if let ExprKind::Ident(name) = hir[inner].kind {
        return Some(file.intern_binding_name(file.bound.binding(inner), name));
    }
    let mut path = Vec::new();
    if append_written_path(file, inner, &mut path) {
        return Some(file.intern_bytes(&path));
    }
    match hir.member_key(inner) {
        Some((_, MemberKey::Name(name))) => Some(file.intern_atom(name)),
        Some((_, MemberKey::PrivateName(name))) => {
            let text = written_name(file.queries.atom_bytes(name));
            Some(file.intern_bytes(text))
        }
        Some((_, MemberKey::Computed(_))) | None => None,
    }
}

/// `a.b.c`, `this.#x`, `a?.b[key]`: a callee that consists of names, as plain Bun quotes it in "a.b.c is not a function".
/// Answers false, with `path` in any state, for anything else and for what is too long to be worth its bytes in the executable.
fn append_written_path(
    file: &FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
    path: &mut Vec<u8>,
) -> bool {
    const LONGEST_PATH: usize = 80;
    let hir = file.hir;
    let optional = |chain| {
        if chain == Chain::Start {
            &b"?."[..]
        } else {
            &b""[..]
        }
    };
    let inner = expression::skip_type_syntax(file, expression);
    match hir[inner].kind {
        ExprKind::Ident(name) => append_identifier(file, inner, name, path),
        ExprKind::This => path.extend_from_slice(b"this"),
        ExprKind::Super => path.extend_from_slice(b"super"),
        ExprKind::Dot {
            obj, name, chain, ..
        } => {
            if !append_written_path(file, obj, path) {
                return false;
            }
            path.extend_from_slice(if chain == Chain::Start { b"?." } else { b"." });
            path.extend_from_slice(written_name(file.queries.atom_bytes(name)));
        }
        ExprKind::Index { obj, index, chain } => {
            let ExprKind::Ident(key) = hir[index].kind else {
                return false;
            };
            if !append_written_path(file, obj, path) {
                return false;
            }
            path.extend_from_slice(optional(chain));
            path.push(b'[');
            append_identifier(file, index, key, path);
            path.push(b']');
        }
        _ => return false,
    }
    path.len() <= LONGEST_PATH
}

fn append_identifier(
    file: &FileLowering<'_, '_, '_, '_>,
    identifier: ExprId,
    name: Atom,
    path: &mut Vec<u8>,
) {
    if !file.append_short_binding_name(file.bound.binding(identifier), path) {
        path.extend_from_slice(file.queries.atom_bytes(name));
    }
}

fn lower_global_path_callee(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    inner: ExprId,
    path: &[Atom],
) -> Callee {
    let last = expression::lower_global_path_holder(lowering, path);
    let name = Some(lowering.file.intern_atom(last.name));
    if let Some(builtin) = find_locked_builtin(lowering.file, inner) {
        return Callee {
            function: expression::emit_locked_builtin(lowering, builtin),
            this: last.holder,
            key: None,
            name,
        };
    }
    let (function, key) = match last.holder {
        Some(holder) => {
            let key = lowering.file.atom_key(last.name);
            let function = member::emit_get(lowering, holder, PropertyName::Constant(key));
            (function, Some(key))
        }
        None => {
            let function = expression::emit_free_name_get(lowering, last.name, false);
            (function, None)
        }
    };
    Callee {
        function: expression::expect_resolved_path(lowering, inner, function),
        this: last.holder,
        key,
        name,
    }
}

fn lower_chain_callee(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    inner: ExprId,
    expected: Option<BuiltinId>,
) -> Callee {
    let own_exit = lowering.create_block();
    let join = lowering.create_block();
    let function_variable = lowering.builder.create_variable(None);
    let this_variable = lowering.builder.create_variable(None);

    let lowered = lower_callee_with_exit(lowering, inner, inner, Some(own_exit), expected);
    let this = match lowered.this {
        Some(this) => this,
        None => lowering.builder.undefined(),
    };
    lowering
        .builder
        .write_variable(function_variable, lowered.function);
    lowering.builder.write_variable(this_variable, this);
    lowering.jump(join);

    lowering.continue_in(own_exit);
    let undefined = lowering.builder.undefined();
    lowering
        .builder
        .write_variable(function_variable, undefined);
    lowering.builder.write_variable(this_variable, undefined);
    lowering.jump(join);

    lowering.continue_in(join);
    Callee {
        function: lowering.builder.read_variable(function_variable),
        this: Some(lowering.builder.read_variable(this_variable)),
        key: None,
        name: lowered.name,
    }
}

fn lower_callee_with_exit(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    callee: ExprId,
    inner: ExprId,
    exit: Option<BlockId>,
    expected: Option<BuiltinId>,
) -> Callee {
    match lowering.file.hir.member_key(inner) {
        Some((object, member_key)) => {
            lower_member_callee(lowering, inner, object, member_key, exit, expected)
        }
        None => lower_plain_callee(lowering, callee, inner, exit, expected),
    }
}

fn lower_member_callee(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
    object: ExprId,
    member_key: MemberKey,
    exit: Option<BlockId>,
    expected: Option<BuiltinId>,
) -> Callee {
    let hir = lowering.file.hir;
    let name = find_callee_name(lowering.file, access);
    if let Some(builtin) = find_locked_builtin(lowering.file, access) {
        let this = expression::lower_expression(lowering, object);
        return Callee {
            function: expression::emit_locked_builtin(lowering, builtin),
            this: Some(this),
            key: None,
            name,
        };
    }
    if matches!(hir[object].kind, ExprKind::Super) {
        let this = function::get_this(lowering);
        let reference = member::lower_reference(lowering, access, KeyConversion::AtAccess);
        lowering.set_position(hir[access].pos);
        return Callee {
            function: member::get_reference(lowering, &reference),
            this: Some(this),
            key: None,
            name,
        };
    }
    if matches!(member_key, MemberKey::PrivateName(_)) {
        let base = member::lower_member_base(lowering, access, object, exit);
        return Callee {
            function: private_names::emit_private_get(lowering, base, access),
            this: Some(base),
            key: None,
            name,
        };
    }
    if let Some(function) = module::lower_namespace_member(lowering, access) {
        return Callee {
            function,
            this: Some(module::lower_namespace_receiver(lowering, object)),
            key: None,
            name,
        };
    }
    if let Some(function) = commonjs::lower_export_member(lowering, access) {
        return Callee {
            function,
            this: Some(commonjs::lower_export_receiver(lowering, access)),
            key: None,
            name,
        };
    }
    let (base, property) = member::lower_member_operands(lowering, access, exit);
    let function = member::emit_member_read(lowering, access, base, property);
    let function = finish_callee(lowering, access, function, expected);
    let function = expression::expect_resolved_path(lowering, access, function);
    let key = match property {
        PropertyName::Constant(key) => Some(key),
        PropertyName::Computed(_) => None,
    };
    Callee {
        function,
        this: Some(base),
        key,
        name,
    }
}

fn lower_plain_callee(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    callee: ExprId,
    inner: ExprId,
    exit: Option<BlockId>,
    expected: Option<BuiltinId>,
) -> Callee {
    let hir = lowering.file.hir;
    if !matches!(hir[inner].kind, ExprKind::Ident(_)) {
        return Callee {
            function: expression::lower_chain_base(lowering, callee, exit),
            this: None,
            key: None,
            name: None,
        };
    }
    let name = find_callee_name(lowering.file, inner);
    if let Some(builtin) = find_locked_builtin(lowering.file, inner) {
        return Callee {
            function: expression::emit_locked_builtin(lowering, builtin),
            this: None,
            key: None,
            name,
        };
    }
    lowering.set_position(hir[inner].pos);
    let (function, this) = scope::lower_identifier_callee(lowering, inner);
    Callee {
        function: finish_callee(lowering, inner, function, expected),
        this,
        key: None,
        name,
    }
}

fn find_locked_builtin(
    file: &FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
) -> Option<BuiltinId> {
    match file.builtins.of_expr(expression) {
        Some(Resolved::Builtin(path)) => path.locked_builtin(),
        Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => None,
    }
}
