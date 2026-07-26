//! Rust equivalent of the TypeScript `FindContextIdentifiers` pass.
//!
//! Determines which bindings need StoreContext/LoadContext semantics by
//! walking the AST with scope tracking to find variables that cross
//! function boundaries.

use crate::diagnostics::CompilerError;
use crate::diagnostics::CompilerErrorDetail;
use crate::diagnostics::ErrorCategory;
use crate::diagnostics::SourceLocation;
use crate::hir::environment::Environment;
use bun_ast::expr::Data;
use bun_ast::stmt::Data as StmtData;
use bun_ast::{self as ast, AssignTarget, Expr, G, Loc, OpCode, Ref, Stmt, StmtOrExpr, b::B};

use super::FunctionNode;
use super::hir_builder::convert_loc;
use crate::program::Host;

#[allow(
    clippy::disallowed_types,
    reason = "vendored react_compiler_hir HashSet<BindingId> contract"
)]
type RefSet = std::collections::HashSet<Ref>;
#[allow(
    clippy::disallowed_types,
    reason = "vendored react_compiler_hir HashMap<BindingId, _> contract"
)]
type RefMap<V> = std::collections::HashMap<Ref, V>;

#[derive(Default)]
struct BindingInfo {
    reassigned: bool,
    reassigned_by_inner_fn: bool,
    referenced_by_inner_fn: bool,
}

struct ContextIdentifierVisitor<'a> {
    host: &'a dyn Host,
    env: &'a mut Environment,
    /// Lexical scope stack for resolving `RefTag::SourceContentsSlice`
    /// references to their declaring `Symbol` ref (this pass runs before the
    /// parser's visit pass that would normally rewrite them).
    scope_stack: Vec<&'a ast::Scope>,
    /// Stack of inner function scopes encountered during traversal.
    /// Empty when at the top level of the function being compiled.
    function_stack: Vec<()>,
    binding_info: RefMap<BindingInfo>,
    /// Function-nesting depth at which each `Ref` was declared. Absent ⇒
    /// declared outside the function being compiled. Bun resolves every
    /// reference to a `Ref` at parse time, so the upstream `ScopeInfo`
    /// ancestor walk reduces to comparing this depth against the reference's
    /// depth (see `is_captured_by_function`).
    decl_depth: RefMap<u32>,
    /// References observed at depth ≥ 1; resolved against `decl_depth` after
    /// the walk so hoisted (`var`/`function`) declarations seen later still
    /// classify correctly.
    inner_references: Vec<(Ref, u32)>,
    inner_reassignments: Vec<(Ref, u32)>,
    error: Option<CompilerError>,
}

impl<'a> ContextIdentifierVisitor<'a> {
    fn depth(&self) -> u32 {
        self.function_stack.len() as u32
    }

    fn push_function_scope(&mut self) {
        self.function_stack.push(());
    }

    fn pop_function_scope(&mut self) {
        self.function_stack.pop();
    }

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

    fn current_scope(&self) -> &'a ast::Scope {
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
            self.decl_depth.insert(self.resolve_ref(ref_), self.depth());
        }
    }

    fn check_captured_reference(&mut self, ref_: Ref) {
        if !ref_.is_valid() {
            return;
        }
        let fn_depth = match self.function_stack.last() {
            Some(_) => self.depth(),
            None => return,
        };
        self.inner_references
            .push((self.resolve_ref(ref_), fn_depth));
    }

    fn handle_reassignment_identifier(&mut self, ref_: Ref) {
        if !ref_.is_valid() {
            return;
        }
        let ref_ = self.resolve_ref(ref_);
        let info = self.binding_info.entry(ref_).or_default();
        info.reassigned = true;
        if self.function_stack.last().is_some() {
            self.inner_reassignments.push((ref_, self.depth()));
        }
    }

    fn walk_binding_decl(&mut self, binding: &ast::Binding) {
        match &binding.data {
            B::BIdentifier(id) => self.record_decl(id.r#ref),
            B::BArray(arr) => {
                for item in arr.items() {
                    self.walk_binding_decl(&item.binding);
                    if let Some(default) = &item.default_value {
                        self.walk_expr(default);
                    }
                }
            }
            B::BObject(obj) => {
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
            B::BMissing(_) => {}
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
        self.push_function_scope();
        self.push_scope(func.open_parens_loc);
        self.push_scope(func.body.loc);
        if let Some(name) = &func.name {
            self.record_decl(name.ref_);
        }
        if func.arguments_ref.is_valid() {
            self.record_decl(func.arguments_ref);
        }
        self.walk_args(func.args.slice());
        self.walk_stmts(func.body.stmts.slice());
        self.pop_scope();
        self.pop_scope();
        self.pop_function_scope();
    }

    fn walk_class(&mut self, class: &G::Class) {
        if let Some(extends) = &class.extends {
            self.walk_expr(extends);
        }
        for d in class.ts_decorators.iter() {
            self.walk_expr(d);
        }
        for prop in class.properties.slice() {
            if let Some(block) = prop.class_static_block_ref() {
                // Intentional deviation: upstream's AstWalker skips class bodies
                // entirely, but static blocks are function-scoped per spec.
                self.push_function_scope();
                for s in block.stmts.iter() {
                    self.walk_stmt(s);
                }
                self.pop_function_scope();
                continue;
            }
            for d in prop.ts_decorators.iter() {
                self.walk_expr(d);
            }
            if prop.flags.contains(ast::flags::Property::IsComputed) {
                if let Some(key) = &prop.key {
                    self.walk_expr(key);
                }
            }
            if let Some(value) = &prop.value {
                self.walk_expr(value);
            }
            if let Some(init) = &prop.initializer {
                self.walk_expr(init);
            }
        }
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
                // Record the declaration name AFTER walk_fn so the enclosing
                // depth wins the last-write into decl_depth (walk_fn re-records
                // func.name at the inner depth, which is correct only for
                // function *expressions*).
                self.walk_fn(&f.func);
                if let Some(name) = &f.func.name {
                    self.record_decl(name.ref_);
                }
            }
            StmtData::SClass(c) => {
                if let Some(name) = &c.class.class_name {
                    self.record_decl(name.ref_);
                }
                self.walk_class(&c.class);
            }
            StmtData::SExportDefault(e) => match &e.value {
                StmtOrExpr::Stmt(s) => self.walk_stmt(s),
                StmtOrExpr::Expr(ex) => self.walk_expr(ex),
            },
            StmtData::SExportEquals(e) => self.walk_expr(&e.value),
            StmtData::SNamespace(n) => self.walk_stmts(n.stmts.slice()),
            StmtData::SEnum(e) => {
                for v in e.values.slice() {
                    if let Some(value) = &v.value {
                        self.walk_expr(value);
                    }
                }
            }
            StmtData::SLazyExport(_)
            | StmtData::SBreak(_)
            | StmtData::SContinue(_)
            | StmtData::SComment(_)
            | StmtData::SDirective(_)
            | StmtData::SEmpty(_)
            | StmtData::SDebugger(_)
            | StmtData::STypeScript(_)
            | StmtData::SImport(_)
            | StmtData::SExportClause(_)
            | StmtData::SExportFrom(_)
            | StmtData::SExportStar(_) => {}
        }
    }

    #[allow(
        clippy::large_stack_frames,
        reason = "expr::Data variants are arena-backed StoreRef; live residency is bounded"
    )]
    fn walk_expr(&mut self, e: &Expr) {
        match &e.data {
            Data::EObjectJSON(_) | Data::EArrayJSON(_) => {}
            Data::EIdentifier(id) => self.check_captured_reference(id.ref_),
            Data::EImportIdentifier(id) => self.check_captured_reference(id.ref_),

            Data::EBinary(b) => {
                if !matches!(b.op.binary_assign_target(), AssignTarget::None) {
                    if self.error.is_none() {
                        if let Err(error) = walk_lval_for_reassignment(self, &b.left) {
                            self.error = Some(error);
                        }
                    }
                }
                self.walk_expr(&b.left);
                self.walk_expr(&b.right);
            }
            Data::EUnary(u) => {
                if matches!(
                    u.op,
                    OpCode::UnPreInc | OpCode::UnPreDec | OpCode::UnPostInc | OpCode::UnPostDec
                ) {
                    if let Data::EIdentifier(ident) = &u.value.data {
                        self.handle_reassignment_identifier(ident.ref_);
                    }
                }
                self.walk_expr(&u.value);
            }

            Data::EArrow(a) => {
                self.push_function_scope();
                self.push_scope(a.body.loc);
                self.push_scope(a.body.loc);
                self.walk_args(a.args.slice());
                self.walk_stmts(a.body.stmts.slice());
                self.pop_scope();
                self.pop_scope();
                self.pop_function_scope();
            }
            Data::EFunction(f) => {
                self.walk_fn(&f.func);
            }
            Data::EClass(c) => {
                if let Some(name) = &c.class_name {
                    self.record_decl(name.ref_);
                }
                self.walk_class(c);
            }

            Data::EArray(a) => {
                for item in a.items.iter() {
                    self.walk_expr(item);
                }
            }
            Data::EObject(o) => {
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
            Data::ESpread(s) => self.walk_expr(&s.value),
            Data::EIf(c) => {
                self.walk_expr(&c.test_);
                self.walk_expr(&c.yes);
                self.walk_expr(&c.no);
            }
            Data::EDot(d) => self.walk_expr(&d.target),
            Data::EIndex(i) => {
                self.walk_expr(&i.target);
                self.walk_expr(&i.index);
            }
            Data::ECall(c) => {
                self.walk_expr(&c.target);
                for a in c.args.iter() {
                    self.walk_expr(a);
                }
            }
            Data::ENew(n) => {
                self.walk_expr(&n.target);
                for a in n.args.iter() {
                    self.walk_expr(a);
                }
            }
            Data::EImport(i) => {
                self.walk_expr(&i.expr);
                self.walk_expr(&i.options);
            }
            Data::EAwait(a) => self.walk_expr(&a.value),
            Data::EYield(y) => {
                if let Some(v) = &y.value {
                    self.walk_expr(v);
                }
            }
            Data::ETemplate(t) => {
                if let Some(tag) = &t.tag {
                    self.walk_expr(tag);
                }
                for part in t.parts() {
                    self.walk_expr(&part.value);
                }
            }
            Data::EJsxElement(j) => {
                if let Some(tag) = &j.tag {
                    self.walk_expr(tag);
                }
                for p in j.properties.iter() {
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
                for child in j.children.iter() {
                    self.walk_expr(child);
                }
            }
            Data::EInlinedEnum(e) => self.walk_expr(&e.value),

            Data::EPrivateIdentifier(_)
            | Data::ECommonjsExportIdentifier(_)
            | Data::EBoolean(_)
            | Data::EBranchBoolean(_)
            | Data::ENumber(_)
            | Data::EBigInt(_)
            | Data::EString(_)
            | Data::ERequireString(_)
            | Data::ERequireResolveString(_)
            | Data::ERequireCallTarget
            | Data::ERequireResolveCallTarget
            | Data::ERegExp(_)
            | Data::EMissing(_)
            | Data::EThis(_)
            | Data::ESuper(_)
            | Data::ENull(_)
            | Data::EUndefined(_)
            | Data::ENewTarget(_)
            | Data::EImportMeta(_)
            | Data::EImportMetaMain(_)
            | Data::ERequireMain
            | Data::ESpecial(_)
            | Data::ENameOfSymbol(_) => {}
        }
    }
}

/// Recursively walk an LVal pattern to find all reassignment target identifiers.
fn walk_lval_for_reassignment(
    visitor: &mut ContextIdentifierVisitor<'_>,
    pattern: &Expr,
) -> Result<(), CompilerError> {
    match &pattern.data {
        Data::EIdentifier(ident) => {
            visitor.handle_reassignment_identifier(ident.ref_);
        }
        Data::EImportIdentifier(ident) => {
            visitor.handle_reassignment_identifier(ident.ref_);
        }
        Data::EArray(pat) => {
            for element in pat.items.iter() {
                if !matches!(element.data, Data::EMissing(_)) {
                    walk_lval_for_reassignment(visitor, element)?;
                }
            }
        }
        Data::EObject(pat) => {
            for prop in pat.properties.iter() {
                match prop.kind {
                    G::PropertyKind::Spread => {
                        if let Some(value) = &prop.value {
                            walk_lval_for_reassignment(visitor, value)?;
                        }
                    }
                    _ => {
                        if let Some(value) = &prop.value {
                            walk_lval_for_reassignment(visitor, value)?;
                        }
                    }
                }
            }
        }
        Data::EBinary(pat) if pat.op == OpCode::BinAssign => {
            walk_lval_for_reassignment(visitor, &pat.left)?;
        }
        Data::ESpread(pat) => {
            walk_lval_for_reassignment(visitor, &pat.value)?;
        }
        Data::EDot(_) | Data::EIndex(_) => {
            // Interior mutability - not a variable reassignment
        }
        _ => {
            record_unsupported_lval(
                visitor.env,
                expr_type_name(&pattern.data),
                convert_loc(pattern.loc),
            )?;
        }
    }
    Ok(())
}

fn expr_type_name(data: &Data) -> &'static str {
    match data {
        Data::EBinary(_) => "BinaryExpression",
        Data::EUnary(_) => "UnaryExpression",
        Data::ECall(_) => "CallExpression",
        _ => "Expression",
    }
}

/// Record the TS-faithful Todo for an unsupported assignment-target wrapper
/// node, mirroring the TypeScript `FindContextIdentifiers` pass. TS throws
/// immediately (CompilerError.throwTodo in handleAssignment's default case),
/// aborting before BuildHIR ever runs or logs, so this must return Err rather
/// than record-and-continue: otherwise Rust emits HIR debug entries for a
/// function TS never lowered.
fn record_unsupported_lval(
    env: &mut Environment,
    type_name: &str,
    loc: Option<SourceLocation>,
) -> Result<(), CompilerError> {
    let _ = env;
    let mut err = CompilerError::new();
    err.push_error_detail(CompilerErrorDetail {
        category: ErrorCategory::Todo,
        reason: format!(
            "[FindContextIdentifiers] Cannot handle Object destructuring assignment target {type_name}"
        ),
        description: None,
        loc,
        suggestions: None,
    });
    Err(err)
}

/// Check if a binding declared at `binding_scope` is captured by a function at `function_scope`.
/// Returns true if the binding is declared above the function (in the parent scope or higher).
fn is_captured_by_function(decl_depth: Option<u32>, fn_depth: u32) -> bool {
    match decl_depth {
        Some(d) => d < fn_depth,
        None => true,
    }
}

/// Find context identifiers for a function: variables that are captured across
/// function boundaries and need StoreContext/LoadContext semantics.
///
/// A binding is a context identifier if:
/// - It is reassigned from inside a nested function (`reassignedByInnerFn`), OR
/// - It is reassigned AND referenced from inside a nested function
///   (`reassigned && referencedByInnerFn`)
///
/// This is the Rust equivalent of the TypeScript `FindContextIdentifiers` pass.
pub(crate) fn find_context_identifiers(
    func: &FunctionNode<'_>,
    host: &dyn Host,
    env: &mut Environment,
) -> Result<RefSet, CompilerError> {
    let mut visitor = ContextIdentifierVisitor {
        host,
        env,
        scope_stack: vec![host.module_scope()],
        function_stack: Vec::new(),
        binding_info: RefMap::default(),
        decl_depth: RefMap::default(),
        inner_references: Vec::new(),
        inner_reassignments: Vec::new(),
        error: None,
    };

    // Walk params and body (like Babel's func.traverse())
    visitor.push_scope(func.args_loc());
    visitor.push_scope(func.body().loc);
    visitor.walk_args(func.args());
    visitor.walk_stmts(func.body().stmts.slice());

    if let Some(error) = visitor.error {
        return Err(error);
    }

    // Supplement the walker-based analysis with referenceToBinding data.
    // The AST walker doesn't visit identifiers inside type annotations,
    // but Babel's traverse (used by TS findContextIdentifiers) does.
    // Bun's parser strips type annotations before this pass runs, so the
    // upstream supplemental scan over `ref_node_id_to_binding` is a no-op
    // here and is omitted.

    // Resolve deferred inner-function references/reassignments against the
    // collected declaration depths.
    for (ref_, fn_depth) in core::mem::take(&mut visitor.inner_references) {
        if is_captured_by_function(visitor.decl_depth.get(&ref_).copied(), fn_depth) {
            let info = visitor.binding_info.entry(ref_).or_default();
            info.referenced_by_inner_fn = true;
        }
    }
    for (ref_, fn_depth) in core::mem::take(&mut visitor.inner_reassignments) {
        if is_captured_by_function(visitor.decl_depth.get(&ref_).copied(), fn_depth) {
            let info = visitor.binding_info.entry(ref_).or_default();
            info.reassigned_by_inner_fn = true;
        }
    }

    // Collect results
    Ok(visitor
        .binding_info
        .into_iter()
        .filter(|(_, info)| {
            info.reassigned_by_inner_fn || (info.reassigned && info.referenced_by_inner_fn)
        })
        .map(|(id, _)| id)
        .collect())
}
