//! Port of `react_compiler_lowering/build_hir.rs` reading `bun_ast` directly.
//!
//! Upstream is one 7.4k-line file; here it is split by function group so the
//! port can be sharded and reviewed independently. The split is purely
//! organisational — function bodies, names, and call graph stay 1:1 with
//! upstream so `/sync-react-compiler` can re-port hunk by hunk.
//!
//! | upstream lines | submodule |
//! |---|---|
//! | 1–662, 4362–5509 | `helpers` (loc/op converters, `lower_identifier`, member-expr, assignment, optional-chain) |
//! | 663–2303, 6553–6713 | `expr` (`lower_expression`, `lower_reorderable_expression`) |
//! | 2304–4256 | `stmt` (`lower_statement`, `lower_block_statement*`) |
//! | 5510–6241, 6469–6552 | `function` (`lower_function*`, `lower_inner`, object-method) |
//! | 6242–6468 | `jsx` (`lower_jsx_*`) |
//! | 4257–4361, 5985–6241 | this file: `lower()` entry + `lower_inner()` driver |

use crate::collections::{IndexMap, IndexSet};
use crate::diagnostics::{
    CompilerDiagnostic, CompilerDiagnosticDetail, CompilerError, ErrorCategory,
};
use crate::hir::{
    AstAlloc, BlockKind, Effect, EvaluationOrder, HirFunction, HirVec, IdentifierId,
    InstructionKind, InstructionValue, ParamPattern, Place, PrimitiveValue, ReactFunctionType,
    ReturnVariant, SourceLocation, SpreadPattern, StoreStr, Terminal, VariableBinding,
    environment::Environment,
};
use bun_ast::expr::Data as ExprData;
use bun_ast::stmt::Data as StmtData;
use bun_ast::{self as ast, Expr, G, Loc, Ref, Stmt, StmtOrExpr, b};

use super::find_context_identifiers::find_context_identifiers;
use super::hir_builder::{
    HirBuilder, convert_loc, create_temporary_place, is_always_reserved_word,
    reserved_identifier_diagnostic,
};
use crate::program::Host;

mod expr;
mod function;
mod helpers;
mod jsx;
mod stmt;

use expr::lower_expression;
use helpers::*;

pub(super) use super::hir_builder::FunctionNode;

#[allow(
    clippy::disallowed_types,
    reason = "vendored react_compiler_hir HashSet<BindingId> contract"
)]
type RefSet = std::collections::HashSet<Ref>;

/// Port of upstream `lower()` (build_hir.rs:4257).
pub fn lower(
    func: &FunctionNode<'_>,
    _id: Option<&str>,
    host: &dyn Host,
    env: &mut Environment,
    import_bindings: &IndexMap<Ref, VariableBinding>,
) -> Result<HirFunction, CompilerError> {
    // Extract params, body, generator, is_async, loc, scope_id, and the AST function's own id
    // Note: `id` param may include inferred names (e.g., from `const Foo = () => {}`),
    // but the HIR function's `id` field should only include the function's own AST id
    // (FunctionDeclaration.id or FunctionExpression.id, NOT arrow functions).
    let loc = convert_loc(func.loc());
    let ast_id = func
        .name_ref()
        .map(|r| host.symbols()[r.inner_index() as usize].original_name);

    // Bun has no `node_id`-keyed scope table; the top-level function's scope
    // is a child of `module_scope`, and `G::Fn` does not retain a back-link.
    // The only consumers of `function_scope`/`component_scope` on the builder
    // are the fbt-name local-binding check and `is_scope_within_compiled_function`,
    // both of which behave correctly with `module_scope` for a top-level call.
    let scope = host.module_scope();

    // `validate_ts_this_parameters_in_function_range`: Bun's parser strips
    // `this` parameters before this pass runs, so the upstream check is a
    // no-op here.

    // `build_identifier_loc_index`: not ported — Bun has no `node_id`; callers
    // read `Ref` + `Loc` straight off the AST node via `convert_loc`.

    // Pre-compute context identifiers: variables captured across function boundaries
    let context_identifiers = find_context_identifiers(func, host, env)?;

    // For top-level functions, context is empty (no captured refs)
    let context_map: IndexMap<Ref, Option<SourceLocation>> = IndexMap::new();

    let (hir_func, _used_refs, _child_bindings) = lower_inner(
        func,
        ast_id,
        loc,
        host,
        env,
        None, // no pre-existing bindings for top-level
        None, // no pre-existing used_refs for top-level
        &context_map,
        scope,
        scope, // component_scope = function_scope for top-level
        &context_identifiers,
        import_bindings,
        true, // is_top_level
    )?;

    Ok(hir_func)
}

/// Port of upstream `lower_inner()` (build_hir.rs:5985).
#[allow(clippy::too_many_arguments)]
pub(super) fn lower_inner<'h>(
    func: &FunctionNode<'_>,
    id: Option<StoreStr>,
    loc: Option<SourceLocation>,
    host: &'h dyn Host,
    env: &'h mut Environment,
    parent_bindings: Option<IndexMap<Ref, IdentifierId>>,
    parent_used_refs: Option<IndexSet<Ref>>,
    context_map: &IndexMap<Ref, Option<SourceLocation>>,
    function_scope: &'h ast::Scope,
    component_scope: &'h ast::Scope,
    context_identifiers: &RefSet,
    import_bindings: &IndexMap<Ref, VariableBinding>,
    is_top_level: bool,
) -> Result<(HirFunction, IndexSet<Ref>, IndexMap<Ref, IdentifierId>), CompilerError> {
    // `validate_ts_this_parameter`: Bun's parser strips `this` parameters
    // before this pass runs, so the upstream check is a no-op here.

    let params = func.args();
    let body_stmts = func.body().stmts.slice();
    let generator = func.is_generator();
    let is_async = func.is_async();
    let has_rest_arg = func.has_rest_arg();

    let mut builder = HirBuilder::new(
        env,
        host,
        function_scope,
        component_scope,
        context_identifiers.clone(),
        parent_bindings,
        Some(context_map.clone()),
        None,
        parent_used_refs,
    );
    builder.set_import_bindings(import_bindings.clone());

    // Enter the function's own lexical scopes so `resolve_ref` walks from the
    // right starting point (parser keys `FunctionArgs` at the open-paren loc
    // and `FunctionBody` at the body's `{` loc).
    builder.push_scope(func.args_loc());
    builder.push_scope(func.body().loc);

    // Build context places from the captured refs
    let mut context: HirVec<Place> = AstAlloc::vec();
    for (&ref_, ctx_loc) in context_map {
        let identifier = builder.resolve_binding(ref_)?;
        context.push(Place {
            identifier,
            effect: Effect::Unknown,
            reactive: false,
            loc: *ctx_loc,
        });
    }

    // Process parameters
    let mut hir_params: HirVec<ParamPattern> = AstAlloc::vec();
    let last = params.len().saturating_sub(1);
    for (i, param) in params.iter().enumerate() {
        let is_rest = has_rest_arg && i == last;
        let param_loc = convert_loc(param.binding.loc);

        if is_rest {
            // Create a temporary place for the spread param
            let place = build_temporary_place(&mut builder, param_loc);
            hir_params.push(ParamPattern::Spread(SpreadPattern {
                place: place.clone(),
            }));
            // Delegate the assignment of the rest argument
            stmt::lower_assignment_binding(
                &mut builder,
                param_loc,
                InstructionKind::Let,
                &param.binding,
                place,
                AssignmentStyle::Assignment,
            )?;
            continue;
        }

        match (&param.binding.data, &param.default) {
            (b::B::BIdentifier(ident), None) => {
                let name = builder.ref_name(ident.r#ref)?;
                if is_always_reserved_word(&name) {
                    return Err(CompilerError::from(reserved_identifier_diagnostic(&name)));
                }
                let binding = builder.resolve_identifier(ident.r#ref, param_loc)?;
                match binding {
                    VariableBinding::Identifier { identifier, .. } => {
                        builder.set_identifier_declaration_loc(identifier, &param_loc);
                        let place = Place {
                            identifier,
                            effect: Effect::Unknown,
                            reactive: false,
                            loc: param_loc,
                        };
                        hir_params.push(ParamPattern::Place(place));
                    }
                    _ => {
                        builder.record_diagnostic(
                            CompilerDiagnostic::new(
                                ErrorCategory::Invariant,
                                "Could not find binding",
                                Some(format!(
                                    "[BuildHIR] Could not find binding for param `{}`",
                                    name
                                )),
                            )
                            .with_detail(
                                CompilerDiagnosticDetail::Error {
                                    loc: param_loc,
                                    message: Some("Could not find binding".to_string()),
                                    identifier_name: None,
                                },
                            ),
                        );
                    }
                }
            }
            _ => {
                let place = build_temporary_place(&mut builder, param_loc);
                promote_temporary(&mut builder, place.identifier);
                hir_params.push(ParamPattern::Place(place.clone()));
                let value = match &param.default {
                    Some(default) => helpers::lower_assignment_pattern_default(
                        &mut builder,
                        param_loc,
                        place,
                        default,
                    )?,
                    None => place,
                };
                stmt::lower_assignment_binding(
                    &mut builder,
                    param_loc,
                    InstructionKind::Let,
                    &param.binding,
                    value,
                    AssignmentStyle::Assignment,
                )?;
            }
        }
    }

    // Lower the body
    let mut directives: HirVec<StoreStr> = AstAlloc::vec();
    let expr_body = arrow_expression_body(func);
    match expr_body {
        Some(expr) => {
            let fallthrough = builder.reserve(BlockKind::Block);
            let value = lower_expression_to_temporary(&mut builder, expr)?;
            builder.terminate_with_continuation(
                Terminal::Return {
                    value,
                    return_variant: ReturnVariant::Implicit,
                    id: EvaluationOrder(0),
                    loc: None,
                    effects: None,
                },
                fallthrough,
            );
        }
        None => {
            for s in body_stmts {
                if let StmtData::SDirective(d) = &s.data {
                    directives.push(d.value);
                }
            }
            // Use lower_block_statement_with_scope to get hoisting support for the function body.
            // Pass the function scope since in Babel, a function body BlockStatement shares
            // the function's scope (node_to_scope maps the function node, not the block).
            stmt::lower_block_statement_with_scope(&mut builder, body_stmts)?;
        }
    }

    // Emit final Return(Void, undefined)
    let undefined_value = InstructionValue::Primitive {
        value: PrimitiveValue::Undefined,
        loc: None,
    };
    let return_value = lower_value_to_temporary(&mut builder, undefined_value)?;
    builder.terminate(
        Terminal::Return {
            value: return_value,
            return_variant: ReturnVariant::Void,
            id: EvaluationOrder(0),
            loc: None,
            effects: None,
        },
        None,
    );

    builder.pop_scope();
    builder.pop_scope();

    // Build the HIR
    let (hir_body, instructions, used_refs, child_bindings) = builder.build()?;

    // Create the returns place
    let returns = create_temporary_place(env, loc);

    Ok((
        HirFunction {
            loc,
            id,
            name_hint: None,
            fn_type: if is_top_level {
                env.fn_type
            } else {
                ReactFunctionType::Other
            },
            params: hir_params,
            return_type_annotation: None,
            returns,
            context,
            body: hir_body,
            instructions,
            generator,
            is_async,
            directives,
            aliasing_effects: None,
        },
        used_refs,
        child_bindings,
    ))
}

/// Bun's `E::Arrow` always carries a `G::FnBody`; an expression body is encoded
/// as a single `SReturn` with `prefer_expr` set. Detect that shape so the
/// upstream `FunctionBody::Expression` arm is preserved (emits `Implicit`
/// return variant instead of `Explicit`).
fn arrow_expression_body<'a>(func: &FunctionNode<'a>) -> Option<&'a Expr> {
    let FunctionNode::Arrow(a) = func else {
        return None;
    };
    if !a.prefer_expr {
        return None;
    }
    let stmts = a.body.stmts.slice();
    if stmts.len() != 1 {
        return None;
    }
    if let StmtData::SReturn(r) = &stmts[0].data {
        return r.value.as_ref();
    }
    None
}

// =============================================================================
// gather_captured_context (build_hir.rs:6772)
// =============================================================================

/// Gather captured context variables for a nested function.
///
/// Walks through all identifier references (via `reference_to_binding`) and checks
/// which ones resolve to bindings declared in scopes between the function's parent scope
/// and the component scope. These are "free variables" that become the function's `context`.
///
/// Bun has no `node_id`-keyed reference index, so this walks the function body
/// directly: every `EIdentifier` whose `Ref` resolves to a non-module-level
/// local binding and is not declared inside the function is captured. The
/// scope chain between the function and `_component_scope` is implicit —
/// any non-module-level binding referenced from inside is necessarily declared
/// in that chain (Bun assigns a fresh `Ref` per declaration site).
///
/// `enclosing_scope` is the lexical scope at the inner function's declaration
/// site (the outer builder's `current_scope()`); it seeds the walker's scope
/// stack so `RefTag::SourceContentsSlice` references resolve to the same
/// `Symbol` refs the outer builder sees.
pub(super) fn gather_captured_context<'h>(
    host: &'h dyn Host,
    func: &FunctionNode<'_>,
    enclosing_scope: &'h ast::Scope,
    _component_scope: &ast::Scope,
) -> IndexMap<Ref, Option<SourceLocation>> {
    let mut walker = CaptureWalker {
        host,
        scope_stack: vec![enclosing_scope],
        declared: RefSet::default(),
        referenced: Vec::new(),
    };
    walker.push_scope(func.args_loc());
    walker.push_scope(func.body().loc);
    walker.walk_args(func.args());
    walker.walk_stmts(func.body().stmts.slice());

    let module_scope = host.module_scope();
    let symbols = host.symbols();

    // Collect the earliest (lowest source position) reference location for each
    // captured binding. Using the minimum position makes the result independent of
    // ref_node_id_to_binding iteration order, matching the behavior the TS compiler
    // gets from Babel's position-ordered traversal.
    #[allow(
        clippy::disallowed_types,
        reason = "vendored react_compiler_hir HashMap<BindingId, _> contract"
    )]
    let mut captured: std::collections::HashMap<Ref, (i32, Option<SourceLocation>)> =
        std::collections::HashMap::new();

    for (ref_, ref_loc) in walker.referenced {
        if !ref_.is_symbol() {
            continue;
        }
        if walker.declared.contains(&ref_) {
            continue;
        }
        let Some(sym) = symbols.get(ref_.inner_index() as usize) else {
            continue;
        };
        use ast::symbol::Kind as Sk;
        if matches!(
            sym.kind,
            Sk::Unbound | Sk::Arguments | Sk::Import | Sk::TsEnum | Sk::TsNamespace
        ) {
            continue;
        }
        if let Some(member) = module_scope.members.get(sym.original_name.slice()) {
            if member.ref_ == ref_ {
                continue;
            }
        }
        let pos = ref_loc.start;
        let loc = convert_loc(ref_loc);
        captured
            .entry(ref_)
            .and_modify(|(min_pos, existing_loc)| {
                if pos < *min_pos {
                    *min_pos = pos;
                    *existing_loc = loc;
                }
            })
            .or_insert((pos, loc));
    }

    // Sort captured entries by source position so context declarations appear
    // in source order, matching the TS compiler's position-ordered traversal.
    let mut sorted: Vec<_> = captured.into_iter().collect();
    sorted.sort_unstable_by_key(|(_, (pos, _))| *pos);

    sorted
        .into_iter()
        .map(|(ref_, (_, loc))| (ref_, loc))
        .collect()
}

struct CaptureWalker<'h> {
    host: &'h dyn Host,
    scope_stack: Vec<&'h ast::Scope>,
    declared: RefSet,
    referenced: Vec<(Ref, Loc)>,
}

impl<'h> CaptureWalker<'h> {
    fn push_scope(&mut self, loc: Loc) {
        let next = self
            .host
            .scope_for_loc(loc)
            .unwrap_or_else(|| self.current_scope());
        self.scope_stack.push(next);
    }

    fn pop_scope(&mut self) {
        debug_assert!(self.scope_stack.len() > 1, "pop_scope underflow");
        self.scope_stack.pop();
    }

    fn current_scope(&self) -> &'h ast::Scope {
        *self.scope_stack.last().expect("scope_stack never empty")
    }

    fn resolve_ref(&self, ref_: Ref) -> Ref {
        use bun_ast::base::RefTag;
        if ref_.tag() == RefTag::Symbol {
            return ref_;
        }
        let name = self.host.ref_name(ref_);
        let mut scope = Some(self.current_scope());
        while let Some(s) = scope {
            if let Some(member) = s.members.get(name) {
                return member.ref_;
            }
            scope = s.parent.as_deref();
        }
        ref_
    }

    fn record_decl(&mut self, ref_: Ref) {
        if ref_.is_valid() {
            self.declared.insert(self.resolve_ref(ref_));
        }
    }

    fn record_ref(&mut self, ref_: Ref, loc: Loc) {
        if ref_.is_valid() {
            self.referenced.push((self.resolve_ref(ref_), loc));
        }
    }

    fn walk_binding_decl(&mut self, binding: &ast::Binding) {
        match &binding.data {
            b::B::BIdentifier(id) => self.record_decl(id.r#ref),
            b::B::BArray(arr) => {
                for item in arr.items() {
                    self.walk_binding_decl(&item.binding);
                    if let Some(default) = &item.default_value {
                        self.walk_expr(default);
                    }
                }
            }
            b::B::BObject(obj) => {
                for prop in obj.properties() {
                    if prop.flags.contains(ast::flags::Property::IsComputed) {
                        self.walk_expr(&prop.key);
                    }
                    self.walk_binding_decl(&prop.value);
                    if let Some(default) = &prop.default_value {
                        self.walk_expr(default);
                    }
                }
            }
            b::B::BMissing(_) => {}
        }
    }

    fn walk_args(&mut self, args: &[G::Arg]) {
        for arg in args {
            self.walk_binding_decl(&arg.binding);
            if let Some(default) = &arg.default {
                self.walk_expr(default);
            }
        }
    }

    fn walk_fn(&mut self, func: &G::Fn) {
        if let Some(name) = &func.name {
            self.record_decl(name.ref_);
        }
        if func.arguments_ref.is_valid() {
            self.record_decl(func.arguments_ref);
        }
        self.push_scope(func.open_parens_loc);
        self.push_scope(func.body.loc);
        self.walk_args(func.args.slice());
        self.walk_stmts(func.body.stmts.slice());
        self.pop_scope();
        self.pop_scope();
    }

    fn walk_stmts(&mut self, stmts: &[Stmt]) {
        for s in stmts {
            self.walk_stmt(s);
        }
    }

    fn walk_stmt(&mut self, stmt: &Stmt) {
        let stmt_loc = stmt.loc;
        match &stmt.data {
            StmtData::SBlock(b) => {
                self.push_scope(stmt_loc);
                self.walk_stmts(b.stmts.slice());
                self.pop_scope();
            }
            StmtData::SExpr(e) => self.walk_expr(&e.value),
            StmtData::SLocal(l) => {
                for decl in l.decls.iter() {
                    self.walk_binding_decl(&decl.binding);
                    if let Some(value) = &decl.value {
                        self.walk_expr(value);
                    }
                }
            }
            StmtData::SReturn(r) => {
                if let Some(v) = &r.value {
                    self.walk_expr(v);
                }
            }
            StmtData::SThrow(t) => self.walk_expr(&t.value),
            StmtData::SIf(i) => {
                self.walk_expr(&i.test_);
                self.walk_stmt(&i.yes);
                if let Some(no) = &i.no {
                    self.walk_stmt(no);
                }
            }
            StmtData::SFor(f) => {
                self.push_scope(stmt_loc);
                if let Some(init) = &f.init {
                    self.walk_stmt(init);
                }
                if let Some(test) = &f.test_ {
                    self.walk_expr(test);
                }
                if let Some(update) = &f.update {
                    self.walk_expr(update);
                }
                self.walk_stmt(&f.body);
                self.pop_scope();
            }
            StmtData::SForIn(f) => {
                self.push_scope(stmt_loc);
                self.walk_stmt(&f.init);
                self.walk_expr(&f.value);
                self.walk_stmt(&f.body);
                self.pop_scope();
            }
            StmtData::SForOf(f) => {
                self.push_scope(stmt_loc);
                self.walk_stmt(&f.init);
                self.walk_expr(&f.value);
                self.walk_stmt(&f.body);
                self.pop_scope();
            }
            StmtData::SWhile(w) => {
                self.walk_expr(&w.test_);
                self.walk_stmt(&w.body);
            }
            StmtData::SDoWhile(d) => {
                self.walk_stmt(&d.body);
                self.walk_expr(&d.test_);
            }
            StmtData::SSwitch(s) => {
                self.walk_expr(&s.test_);
                self.push_scope(s.body_loc);
                for case in s.cases.slice() {
                    if let Some(v) = &case.value {
                        self.walk_expr(v);
                    }
                    self.walk_stmts(case.body.slice());
                }
                self.pop_scope();
            }
            StmtData::STry(t) => {
                self.push_scope(stmt_loc);
                self.walk_stmts(t.body.slice());
                self.pop_scope();
                if let Some(catch) = &t.catch_ {
                    self.push_scope(catch.loc);
                    if let Some(binding) = &catch.binding {
                        self.walk_binding_decl(binding);
                    }
                    self.push_scope(catch.body_loc);
                    self.walk_stmts(catch.body.slice());
                    self.pop_scope();
                    self.pop_scope();
                }
                if let Some(finally) = &t.finally {
                    self.push_scope(finally.loc);
                    self.walk_stmts(finally.stmts.slice());
                    self.pop_scope();
                }
            }
            StmtData::SLabel(l) => self.walk_stmt(&l.stmt),
            StmtData::SWith(w) => {
                self.walk_expr(&w.value);
                self.push_scope(w.body_loc);
                self.walk_stmt(&w.body);
                self.pop_scope();
            }
            StmtData::SFunction(f) => {
                if let Some(name) = &f.func.name {
                    self.record_decl(name.ref_);
                }
                self.walk_fn(&f.func);
            }
            StmtData::SClass(c) => {
                if let Some(name) = &c.class.class_name {
                    self.record_decl(name.ref_);
                }
            }
            StmtData::SExportDefault(e) => match &e.value {
                StmtOrExpr::Stmt(s) => self.walk_stmt(s),
                StmtOrExpr::Expr(ex) => self.walk_expr(ex),
            },
            _ => {}
        }
    }

    fn walk_expr(&mut self, e: &Expr) {
        match &e.data {
            ExprData::EIdentifier(id) => self.record_ref(id.ref_, e.loc),
            ExprData::EImportIdentifier(id) => self.record_ref(id.ref_, e.loc),
            ExprData::EBinary(bin) => {
                self.walk_expr(&bin.left);
                self.walk_expr(&bin.right);
            }
            ExprData::EUnary(u) => self.walk_expr(&u.value),
            ExprData::EArrow(a) => {
                self.push_scope(a.body.loc);
                self.push_scope(a.body.loc);
                self.walk_args(a.args.slice());
                self.walk_stmts(a.body.stmts.slice());
                self.pop_scope();
                self.pop_scope();
            }
            ExprData::EFunction(f) => self.walk_fn(&f.func),
            ExprData::EClass(_) => {}
            ExprData::EArray(a) => {
                for item in a.items.iter() {
                    self.walk_expr(item);
                }
            }
            ExprData::EObject(o) => {
                for p in o.properties.iter() {
                    if p.flags.contains(ast::flags::Property::IsComputed) {
                        if let Some(key) = &p.key {
                            self.walk_expr(key);
                        }
                    }
                    if let Some(value) = &p.value {
                        self.walk_expr(value);
                    }
                    if let Some(init) = &p.initializer {
                        self.walk_expr(init);
                    }
                }
            }
            ExprData::ESpread(s) => self.walk_expr(&s.value),
            ExprData::EIf(c) => {
                self.walk_expr(&c.test_);
                self.walk_expr(&c.yes);
                self.walk_expr(&c.no);
            }
            ExprData::EDot(d) => self.walk_expr(&d.target),
            ExprData::EIndex(i) => {
                self.walk_expr(&i.target);
                self.walk_expr(&i.index);
            }
            ExprData::ECall(c) => {
                self.walk_expr(&c.target);
                for a in c.args.iter() {
                    self.walk_expr(a);
                }
            }
            ExprData::ENew(n) => {
                self.walk_expr(&n.target);
                for a in n.args.iter() {
                    self.walk_expr(a);
                }
            }
            ExprData::EImport(i) => {
                self.walk_expr(&i.expr);
                self.walk_expr(&i.options);
            }
            ExprData::EAwait(a) => self.walk_expr(&a.value),
            ExprData::EYield(y) => {
                if let Some(v) = &y.value {
                    self.walk_expr(v);
                }
            }
            ExprData::ETemplate(t) => {
                if let Some(tag) = &t.tag {
                    self.walk_expr(tag);
                }
                for part in t.parts() {
                    self.walk_expr(&part.value);
                }
            }
            ExprData::EJsxElement(j) => {
                if let Some(tag) = &j.tag {
                    self.walk_expr(tag);
                }
                for p in j.properties.iter() {
                    if let Some(value) = &p.value {
                        self.walk_expr(value);
                    }
                    if let Some(init) = &p.initializer {
                        self.walk_expr(init);
                    }
                }
                for child in j.children.iter() {
                    self.walk_expr(child);
                }
            }
            ExprData::EInlinedEnum(ie) => self.walk_expr(&ie.value),
            _ => {}
        }
    }
}
