use bun_sema::bind::FnOwner;
use bun_sema::hir::{self, ExprId, IdList, PatKind, Span, StmtId, StmtKind, VarDeclId, VarKind};
use smallvec::SmallVec;

use super::FunctionLowering;
use super::call::{self};
use super::control::{CleanupLanding, CleanupPath};
use super::member::PropertyName;
use crate::builtins::id::BuiltinId;
use crate::ir::generated::BlockRole;
use crate::ir::{Edge, FunctionKey, LocalVariable, ValueId};
use crate::modules::ModuleKind;

const HAS_AWAIT_STATE: &str = "a scope with an asynchronous resource has its await state";

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

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn lower_statements_with_resources(&mut self, statements: IdList<StmtId>) {
        let hir = self.file.hir;
        let decisions = self.file.decisions();
        let is_async = hir.ids(statements).any(|statement| {
            !decisions.is_dead_stmt(statement)
                && find_resource_declarations(hir, statement)
                    .is_some_and(|declarations| has_async_resource(hir, declarations))
        });
        let mut scope = self.begin_resource_scope(is_async);
        for statement in hir.ids(statements) {
            if decisions.is_dead_stmt(statement) {
                continue;
            }
            let Some(declarations) = find_resource_declarations(hir, statement) else {
                self.lower_statement(statement);
                continue;
            };
            for declaration in declarations.iter() {
                self.lower_resource_declaration(&mut scope, declaration);
            }
        }
        end_resource_scope(self, scope);
    }

    pub(in crate::lower) fn lower_head_resources(
        &mut self,
        declarations: Span<VarDeclId>,
        body: &mut dyn FnMut(&mut FunctionLowering<'_, '_, '_, '_, '_>),
    ) {
        let is_async = has_async_resource(self.file.hir, declarations);
        let mut scope = self.begin_resource_scope(is_async);
        for declaration in declarations.iter() {
            self.lower_resource_declaration(&mut scope, declaration);
        }
        body(self);
        end_resource_scope(self, scope);
    }

    pub(crate) fn lower_loop_resource(
        &mut self,
        declaration: VarDeclId,
        value: ValueId,
        body: &mut dyn FnMut(&mut FunctionLowering<'_, '_, '_, '_, '_>),
    ) {
        let kind = self.file.hir[declaration].kind;
        let is_async = get_dispose_hint(kind) == Some(DisposeHint::Async);
        let mut scope = self.begin_resource_scope(is_async);
        add_resource(self, &mut scope, declaration, value, None);
        body(self);
        end_resource_scope(self, scope);
    }

    fn begin_resource_scope(&mut self, is_async: bool) -> ResourceScope {
        let awaits = is_async.then(|| {
            let builder = &mut self.builder;
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

    fn lower_resource_declaration(&mut self, scope: &mut ResourceScope, declaration: VarDeclId) {
        let hir = self.file.hir;
        let decl = hir[declaration];
        let pattern = hir[decl.pat];
        let (PatKind::Ident(name), Some(initializer)) = (pattern.kind, decl.init.some()) else {
            return;
        };
        let binding = self.file.bound.initialized_binding(decl.pat);
        let key = self.file.function_name_key(binding, name, pattern.pos);
        let name = PropertyName::Constant(key);
        let value = self.lower_named_evaluation(initializer, name);
        self.set_position(pattern.pos);
        add_resource(self, scope, declaration, value, Some(initializer));
    }

    fn emit_disposal(
        &mut self,
        resource: Resource,
        awaits: Option<AwaitState>,
        follows_async_resource: bool,
        is_last: bool,
        path: CleanupPath,
    ) {
        let position = self.find_disposal_position();
        self.set_position(position.unwrap_or(resource.position));
        let pending = match path {
            CleanupPath::Normal => None,
            CleanupPath::Throw { thrown } => Some(thrown),
            CleanupPath::Rethrow => unreachable!("a resource scope takes the thrown value"),
        };
        let trailing = match resource.hint {
            DisposeHint::Async if is_last => awaits,
            DisposeHint::Async | DisposeHint::Sync => None,
        };
        if resource.hint == DisposeHint::Sync && follows_async_resource {
            self.emit_pending_await(awaits.expect(HAS_AWAIT_STATE));
        }

        let done = self.create_block();
        let skipped = self.create_block();
        let method = self.branch_if_undefined(resource.method, skipped);
        // What a method throws is thrown again by the scope: that `throw` is the one whose frames are listed if nobody catches it.
        let handler = self.begin_handler(BlockRole::CatchHandler, None);
        let this = Some(resource.value);
        let result = call::emit_call(self, method, this, &[]);
        if resource.hint == DisposeHint::Async {
            let state = awaits.expect(HAS_AWAIT_STATE);
            let yes = self.builder.boolean(true);
            self.builder.write_variable(state.has_awaited, yes);
            self.emit_await(result);
        }
        self.end_handler(handler);
        self.jump(done);

        self.continue_in(handler.block());
        let error = self.builder.catch_value();
        let error = match pending {
            Some(suppressed) => self.builder.new_suppressed_error(error, suppressed),
            None => error,
        };
        if let Some(state) = trailing {
            self.emit_pending_await(state);
        }
        self.emit_throw(error);

        self.continue_in(skipped);
        if resource.hint == DisposeHint::Async {
            let state = awaits.expect(HAS_AWAIT_STATE);
            let yes = self.builder.boolean(true);
            self.builder.write_variable(state.needs_await, yes);
        }
        self.jump(done);

        self.continue_in(done);
        if let Some(state) = trailing {
            self.emit_pending_await(state);
        }
    }

    // JSC records the calls that dispose behind the body, which the source map takes back to the last token of the function, or to a `)` or `]` that is printed right behind the function.
    fn find_disposal_position(&mut self) -> Option<u32> {
        if let Some(found) = self.disposal_position {
            return found;
        }
        let file = &*self.file;
        let found = match self.key {
            FunctionKey::Source(source) if file.runs_as_written() => {
                file.find_end_of_function(source.function)
            }
            _ if file.is_shown_without_source_map() => None,
            FunctionKey::Source(source) => {
                let behind = match file.bound.fns[source.function.idx()].owner {
                    FnOwner::Expr(owner) => file.find_closing_token_behind(owner),
                    _ => None,
                };
                behind.or_else(|| file.last_mapped_function_position(source.function))
            }
            FunctionKey::ModuleBody(_) | FunctionKey::WrappedModuleBody(_)
                if file.inputs.modules.kind(file.file) == ModuleKind::CommonJs =>
            {
                file.last_mapped_list_position(file.hir.body)
            }
            _ => None,
        };
        self.disposal_position = Some(found);
        found
    }

    fn emit_pending_await(&mut self, state: AwaitState) {
        let check = self.create_block();
        let wait = self.create_block();
        let done = self.create_block();

        let needs_await = self.builder.read_variable(state.needs_await);
        self.builder
            .branch(needs_await, Edge::to(check), Edge::to(done));

        self.continue_in(check);
        let has_awaited = self.builder.read_variable(state.has_awaited);
        self.builder
            .branch(has_awaited, Edge::to(done), Edge::to(wait));

        self.continue_in(wait);
        let undefined = self.builder.undefined();
        self.emit_await(undefined);
        let no = self.builder.boolean(false);
        self.builder.write_variable(state.needs_await, no);
        self.jump(done);

        self.continue_in(done);
    }
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
    let method = lowering.emit_builtin_call(helper, &[value]);
    lowering.begin_cleanup(BlockRole::DisposalCleanup, Some(value));
    scope.resources.push(Resource {
        value,
        method,
        hint,
        position: lowering.position(),
    });
    let mapped = lowering.file.hir[decl.pat].pos;
    lowering.bind_pattern(decl.pat, value, source, mapped);
}

#[allow(clippy::needless_pass_by_value)] // the end of the scope
fn end_resource_scope(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, scope: ResourceScope) {
    let mut follows_async_resource = false;
    for (index, &resource) in scope.resources.iter().enumerate().rev() {
        let (awaits, is_last) = (scope.awaits, index == 0);
        lowering.end_cleanup_per_exit(CleanupLanding::TakesValue, &mut |lowering, path| {
            lowering.emit_disposal(resource, awaits, follows_async_resource, is_last, path);
        });
        follows_async_resource |= resource.hint == DisposeHint::Async;
    }
}
