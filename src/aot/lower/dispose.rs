mod disposal;

use bun_sema::hir::{self, ExprId, IdList, PatKind, Span, StmtId, StmtKind, VarDeclId, VarKind};
use smallvec::SmallVec;

use super::control::{self, CleanupLanding};
use super::member::{self, PropertyName};
use super::{FunctionLowering, call, expression, pattern, statement};
use crate::builtins::id::BuiltinId;
use crate::ir::generated::BlockRole;
use crate::ir::{LocalVariable, ValueId};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum DisposeHint {
    Sync,
    Async,
}

#[derive(Copy, Clone)]
struct AwaitState {
    needs_await: LocalVariable,
    has_awaited: LocalVariable,
}

#[derive(Copy, Clone)]
struct Resource {
    value: ValueId,
    method: ValueId,
    hint: DisposeHint,
    position: u32,
}

struct ResourceScope {
    awaits: Option<AwaitState>,
    resources: SmallVec<[Resource; 2]>,
}

#[derive(Copy, Clone)]
struct Disposal {
    resource: Resource,
    awaits: Option<AwaitState>,
    follows_async_resource: bool,
    is_last: bool,
}

fn get_dispose_hint(kind: VarKind) -> Option<DisposeHint> {
    match kind {
        VarKind::Using => Some(DisposeHint::Sync),
        VarKind::AwaitUsing => Some(DisposeHint::Async),
        VarKind::Var | VarKind::Let | VarKind::Const => None,
    }
}

pub(in crate::lower) fn find_resource_declarations(
    hir: &hir::File<'_>,
    statement: StmtId,
) -> Option<Span<VarDeclId>> {
    let StmtKind::Var(declarations) = hir[statement.some()?].kind else {
        return None;
    };
    let first = declarations.iter().next()?;
    get_dispose_hint(hir[first].kind).map(|_| declarations)
}

fn has_async_resource(hir: &hir::File<'_>, declarations: Span<VarDeclId>) -> bool {
    let mut kinds = declarations.iter().map(|declaration| hir[declaration].kind);
    kinds.any(|kind| get_dispose_hint(kind) == Some(DisposeHint::Async))
}

pub(in crate::lower) fn lower_statements_with_resources(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statements: IdList<StmtId>,
) {
    let hir = lowering.file.hir;
    let decisions = lowering.file.decisions();
    let is_async = hir.ids(statements).any(|statement| {
        !decisions.is_dead_stmt(statement)
            && find_resource_declarations(hir, statement)
                .is_some_and(|declarations| has_async_resource(hir, declarations))
    });
    let mut scope = begin_resource_scope(lowering, is_async);
    for statement in hir.ids(statements) {
        if decisions.is_dead_stmt(statement) {
            continue;
        }
        let Some(declarations) = find_resource_declarations(hir, statement) else {
            statement::lower_statement(lowering, statement);
            continue;
        };
        for declaration in declarations.iter() {
            lower_resource_declaration(lowering, &mut scope, declaration);
        }
    }
    end_resource_scope(lowering, scope);
}

pub(in crate::lower) fn lower_head_resources(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    declarations: Span<VarDeclId>,
    body: &mut dyn FnMut(&mut FunctionLowering<'_, '_, '_, '_, '_>),
) {
    let is_async = has_async_resource(lowering.file.hir, declarations);
    let mut scope = begin_resource_scope(lowering, is_async);
    for declaration in declarations.iter() {
        lower_resource_declaration(lowering, &mut scope, declaration);
    }
    body(lowering);
    end_resource_scope(lowering, scope);
}

pub(crate) fn lower_loop_resource(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    declaration: VarDeclId,
    value: ValueId,
    body: &mut dyn FnMut(&mut FunctionLowering<'_, '_, '_, '_, '_>),
) {
    let kind = lowering.file.hir[declaration].kind;
    let is_async = get_dispose_hint(kind) == Some(DisposeHint::Async);
    let mut scope = begin_resource_scope(lowering, is_async);
    add_resource(lowering, &mut scope, declaration, value, None);
    body(lowering);
    end_resource_scope(lowering, scope);
}

fn begin_resource_scope(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    is_async: bool,
) -> ResourceScope {
    let awaits = is_async.then(|| {
        let builder = &mut lowering.builder;
        let state = AwaitState {
            needs_await: builder.create_variable(None),
            has_awaited: builder.create_variable(None),
        };
        let no = builder.boolean(false);
        builder.write_variable(state.needs_await, no);
        builder.write_variable(state.has_awaited, no);
        state
    });
    ResourceScope {
        awaits,
        resources: SmallVec::new(),
    }
}

fn lower_resource_declaration(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    scope: &mut ResourceScope,
    declaration: VarDeclId,
) {
    let hir = lowering.file.hir;
    let decl = hir[declaration];
    let pattern = hir[decl.pat];
    let (PatKind::Ident(name), Some(initializer)) = (pattern.kind, decl.init.some()) else {
        return;
    };
    let key = member::name_key(lowering.file, name);
    let name = PropertyName::Constant(key);
    let value = expression::lower_named_evaluation(lowering, initializer, name);
    lowering.set_position(pattern.pos);
    add_resource(lowering, scope, declaration, value, Some(initializer));
}

fn add_resource(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    scope: &mut ResourceScope,
    declaration: VarDeclId,
    value: ValueId,
    source: Option<ExprId>,
) {
    let decl = lowering.file.hir[declaration];
    let Some(hint) = get_dispose_hint(decl.kind) else {
        unreachable!("add_resource takes a using declaration");
    };
    let helper = match hint {
        DisposeHint::Sync => BuiltinId::CompilerHelpersGetDisposeMethod,
        DisposeHint::Async => BuiltinId::CompilerHelpersGetAsyncDisposeMethod,
    };
    let method = call::emit_builtin_call(lowering, helper, &[value]);
    control::begin_cleanup(lowering, BlockRole::DisposalCleanup, Some(value));
    scope.resources.push(Resource {
        value,
        method,
        hint,
        position: lowering.position(),
    });
    pattern::bind_pattern(lowering, decl.pat, value, source);
}

#[allow(clippy::needless_pass_by_value)] // the end of the scope
fn end_resource_scope(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, scope: ResourceScope) {
    let mut follows_async_resource = false;
    for (index, &resource) in scope.resources.iter().enumerate().rev() {
        let disposal = Disposal {
            resource,
            awaits: scope.awaits,
            follows_async_resource,
            is_last: index == 0,
        };
        let landing = CleanupLanding::TakesValue;
        control::end_cleanup_per_exit(lowering, landing, &mut |lowering, path| {
            disposal::emit_disposal(lowering, disposal, path);
        });
        follows_async_resource |= resource.hint == DisposeHint::Async;
    }
}
