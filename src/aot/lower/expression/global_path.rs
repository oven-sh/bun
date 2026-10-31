#[cfg(test)]
mod tests;

use bun_ast::Target;
use bun_resolve_builtins::{Alias, Cfg};
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{
    Binding, BindingKind, ClassOwner, CodeUnit, CommonJsVariable, Decl, FnOwner, ImplicitReference,
    ImplicitReferenceKind, Parent, PatParent, ScopeId, SymbolId,
};
use bun_sema::fold::{Decision, NamedPath, is_removed_where_never_run};
use bun_sema::hir::{
    BinOp, Call, Chain, ExprId, ExprKind, FnId, ImportEqualsTarget, MemberKey, NodeData, StmtId,
    StmtKind, UnOp, rare,
};
use smallvec::SmallVec;

use crate::builtins::id::BuiltinId;
use crate::builtins::{Resolved, SourceDialect};
use crate::diagnostic_codes::Code;
use crate::ir::generated::ECMAMode;
use crate::ir::{FunctionKey, ValueId};
use crate::load;
use crate::lower::captures::Capture;
use crate::lower::member::PropertyName;
use crate::lower::module::file_scope;
use crate::lower::scope::{ArgumentsObject, BindingForm, BindingRef, ScopeSlot, Storage};
use crate::lower::{FileLowering, FunctionLowering};

#[derive(Copy, Clone, Debug)]
pub(in crate::lower) struct GlobalPathMember {
    pub(in crate::lower) holder: Option<ValueId>,
    pub(in crate::lower) name: Atom,
}

/// Why the build stops at the name or the path of a define: what the program does with it there, or what the first name of the value is there.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) enum DefineStop {
    Read,
    Called,
    TypeOf,
    Deleted,
    DeletedInStrictMode,
    StoredTo,
    StoredToInStrictMode,
    /// `bun run` counts no use of the first name of the value, and the file declares that name with `let` or `const` below its top level.
    LetOrConstBelowTopLevel,
    /// `bun run` counts no use of the first name of the value, and that name is an import that TypeScript drops: nothing else in the file uses it.
    UnusedImport,
    /// The first name of the value is a `let`, a `const`, a class or an enum that is declared in code that never runs. `bun run` may remove such a declaration: the name is then what lies further out.
    DeclarationNeverRuns,
}

impl FileLowering<'_, '_, '_, '_> {
    // The call that `site` is the callee of, below nothing but type syntax. A tagged template is no such call.
    fn find_call_of_callee(&self, site: ExprId) -> Option<Call> {
        let (hir, bound) = (self.hir, self.bound);
        let mut callee = site;
        while let Parent::Expr(parent) = bound.parent_of_expr(callee)
            && parent.is_some()
        {
            match hir[parent].kind {
                ExprKind::Call(call) => {
                    let call = hir[call];
                    return (call.callee == callee).then_some(call);
                }
                _ if hir.type_assertion_operand(parent) == Some(callee) => callee = parent,
                _ => return None,
            }
        }
        None
    }

    // `site` is the callee of a call that is no `f?.()`.
    fn is_callee_of_call(&self, site: ExprId) -> bool {
        let call = self.find_call_of_callee(site);
        call.is_some_and(|call| call.chain == Chain::No)
    }

    // A call of a name whose define value is `eval` is a direct eval. So is that of a path unless `head` is free, where `bun run` writes `(0, eval)`.
    fn calls_eval_by_name(&self, site: ExprId, names: &[Atom], head: Binding) -> bool {
        let is_name = matches!(self.hir[site].kind, ExprKind::Ident(_));
        let is_written_as_name = is_name || head != Binding::Free;
        names == [known::eval] && is_written_as_name && self.is_callee_of_call(site)
    }

    // `site` is the callee of a call whose one argument is a string that names a built-in module. `require.resolve` answers such a name as it is asked, whatever files the program has.
    fn asks_for_builtin_module(&self, site: ExprId) -> bool {
        let hir = self.hir;
        let call = self.find_call_of_callee(site);
        let Some(call) = call.filter(|call| call.chain == Chain::No) else {
            return false;
        };
        let mut arguments = hir.ids(call.args);
        let (Some(argument), None) = (arguments.next(), arguments.next()) else {
            return false;
        };
        let ExprKind::String(name) = hir[self.skip_type_syntax(argument)].kind else {
            return false;
        };
        let name = self.queries.atom_bytes(name);
        Alias::get(name, Target::Bun, Cfg::default()).is_some_and(|alias| alias.node_builtin)
    }

    // The build finds the files that a program loads in the calls of `require` that the text spells, and a call through a define is none of them.
    fn calls_require_of_file(&self, site: ExprId, named: &NamedPath<'_>) -> bool {
        match (named.head.binding, named.names) {
            (Binding::CommonJs(CommonJsVariable::Require), [_, known::resolve]) => {
                !self.asks_for_builtin_module(site)
            }
            (Binding::CommonJs(CommonJsVariable::Require), _) => true,
            (Binding::CommonJs(CommonJsVariable::Module), [_, member, ..]) => {
                *member == known::require && self.is_commonjs_module()
            }
            _ => false,
        }
    }

    // Whether `bun run` may print what a define gives `site` as the callee of a call, as it prints `a` of `(0, a)`, `1 && a` or `[a][0]` there.
    fn may_be_printed_as_callee(&self, site: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let mut child = site;
        while let Parent::Expr(parent) = bound.parent_of_expr(child)
            && parent.is_some()
        {
            match hir[parent].kind {
                ExprKind::Call(call) => return hir[call].callee == child,
                ExprKind::Binary {
                    op: BinOp::Comma | BinOp::And | BinOp::Or | BinOp::Nullish,
                    right,
                    ..
                } if right == child => {}
                ExprKind::Cond { test, .. } if test != child => {}
                ExprKind::Index { obj, .. } if obj == child => {}
                ExprKind::Array(_) => {}
                _ if hir.type_assertion_operand(parent) == Some(child) => {}
                _ => return false,
            }
            child = parent;
        }
        false
    }

    // `name` is what the file calls `feature` of "bun:bundle".
    fn imports_feature_flag_as(&self, name: Atom) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        hir.imports.iter().any(|import| {
            import.spec == known::bun_bundle
                && !import.type_only
                && bound.parent_of_stmt(import.stmt) == Parent::File
                && import.named.iter().any(|specifier| {
                    let specifier = hir[specifier];
                    !specifier.type_only
                        && specifier.imported == known::feature
                        && specifier.local == name
                })
        })
    }

    // `bun run` answers a call of `feature` of "bun:bundle" itself. The binder steps over that import, so only a call tells it from a global.
    fn calls_feature_flag(&self, site: ExprId, names: &[Atom]) -> bool {
        let &[name] = names else {
            return false;
        };
        self.may_be_printed_as_callee(site) && self.imports_feature_flag_as(name)
    }

    // `bun run` keeps a function of a block, a branch or a label of sloppy code in a block of its own: outside it the name is what lies further out.
    fn is_function_of_block_or_label(&self, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let hoisted = bound.runtime.annex_b_functions();
        if hoisted.iter().any(|function| function.var_symbol == symbol) {
            return true;
        }
        // Only a file with a declaration as the body of a statement has a function behind a label.
        if hir.rare_syntax & rare::DECLARATION_AS_BODY == 0 {
            return false;
        }
        let is_behind_label = |function: FnId| {
            let FnOwner::Stmt(statement) = bound.fns[function.idx()].owner else {
                return false;
            };
            match bound.parent_of_stmt(statement) {
                Parent::Stmt(label) if label.is_some() => {
                    matches!(hir[label].kind, StmtKind::Labeled { .. })
                }
                _ => false,
            }
        };
        let mut functions = (0..hir.fns.len() as u32).map(FnId);
        functions.any(|function| {
            is_behind_label(function) && bound.declared_symbol(Decl::Fn(function)) == symbol
        })
    }

    // The statement of a clause of `switch` that `site` is in. `None`: it is in none, or in a class, among parameters or in the default of a pattern.
    fn find_statement_of_clause(&self, site: ExprId, switch: StmtId) -> Option<StmtId> {
        let bound = self.bound;
        let mut around = bound.parent_of_expr(site);
        loop {
            around = match around {
                Parent::Expr(expression) if expression.is_some() => {
                    bound.parent_of_expr(expression)
                }
                Parent::VarInit(declarator) => Parent::Stmt(bound.var_stmt[declarator.idx()]),
                Parent::Prop(property)
                | Parent::PropKey(property)
                | Parent::MethodKey(property) => Parent::Expr(bound.prop_owner[property.idx()]),
                Parent::FnBody(function) => match bound.fns[function.idx()].owner {
                    FnOwner::Expr(expression) => Parent::Expr(expression),
                    FnOwner::Stmt(statement) => Parent::Stmt(statement),
                    FnOwner::None | FnOwner::Member(_) | FnOwner::Type(_) => return None,
                },
                Parent::Stmt(statement) if statement.is_some() => {
                    let outer = bound.parent_of_stmt(statement);
                    if outer == Parent::Stmt(switch) {
                        return Some(statement);
                    }
                    outer
                }
                _ => return None,
            };
        }
    }

    // `bun run` declares a function of a clause of a `switch` with `let`: outside that clause the name is in its dead zone until the clause has run.
    fn is_function_of_another_clause(&self, site: ExprId, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let mut declarations = bound.symbol(symbol).decls.iter();
        declarations.any(|&declaration| {
            let Decl::Fn(function) = declaration else {
                return false;
            };
            let FnOwner::Stmt(declared) = bound.fns[function.idx()].owner else {
                return false;
            };
            let Parent::Stmt(switch) = bound.parent_of_stmt(declared) else {
                return false;
            };
            let StmtKind::Switch { cases, .. } = hir[switch].kind else {
                return false;
            };
            let Some(statement) = self.find_statement_of_clause(site, switch) else {
                return true;
            };
            let mut clauses = cases.iter().map(|case| hir[case].body);
            let clause = clauses.find(|&clause| hir.ids(clause).any(|it| it == declared));
            clause.is_none_or(|clause| !hir.ids(clause).any(|it| it == statement))
        })
    }

    // The statement that declares a variable, a class or an enum. `None`: `declaration` is a parameter, the parameter of a `catch` clause, a class expression or no such declaration.
    fn find_declaring_statement(&self, declaration: Decl) -> Option<StmtId> {
        let (hir, bound) = (self.hir, self.bound);
        match declaration {
            Decl::Var(mut pattern) | Decl::Require(mut pattern) => loop {
                match bound.pat_parent[pattern.idx()] {
                    PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => pattern = outer,
                    PatParent::Var(declarator) => break bound.var_stmt[declarator.idx()].some(),
                    PatParent::Param(_) | PatParent::None => break None,
                }
            },
            Decl::Class(class) => match bound.class_owner[class.idx()] {
                ClassOwner::Stmt(statement) => statement.some(),
                ClassOwner::Expr(_) => None,
            },
            Decl::Enum(enumeration) => hir[enumeration].stmt.some(),
            _ => None,
        }
    }

    // A statement that the build added to the tree, as `load::test_runner_names` does in a test run: what `bun run` prints says nothing of it.
    fn has_no_text(&self, statement: StmtId) -> bool {
        let text = self.hir[statement].loc;
        text.pos == text.end
    }

    // Whether `bun run` prints what declares the name at `declaration`. `None`: no `let`, `const`, class or enum statement of the text declares it.
    fn is_printed_by_bun_run(&self, declaration: Decl) -> Option<bool> {
        let hir = self.hir;
        let transpiled = self.transpiled.as_ref()?;
        let statement = self.find_declaring_statement(declaration)?;
        if self.has_no_text(statement) {
            return None;
        }
        match declaration {
            Decl::Var(pattern) | Decl::Require(pattern) => {
                // A `var` stays wherever it is declared. A `catch` clause and the head of a loop are printed with what they declare.
                let is_lexical = matches!(hir[statement].kind, StmtKind::Var(_))
                    && is_removed_where_never_run(hir, statement)
                    && !self.is_in_loop_head(statement);
                is_lexical.then(|| transpiled.has_binding_at(hir[pattern].pos))
            }
            Decl::Class(class) => Some(transpiled.has_statement_at(hir[class].text_start)),
            Decl::Enum(enumeration) => Some(transpiled.has_binding_at(hir[enumeration].name_pos)),
            _ => None,
        }
    }

    // `bun run` prints a name where the define applies at `head` and nothing that declares the variable: the name is then what lies further out.
    fn is_printed_without_its_declaration(
        &self,
        head: &ImplicitReference,
        declarations: &[Decl],
    ) -> bool {
        let NodeData::Expr(root) = head.node else {
            return false;
        };
        let position = self.hir[root].pos;
        let transpiled = self.transpiled.as_ref();
        if !transpiled.is_some_and(|transpiled| transpiled.has_identifier_at(position)) {
            return false;
        }
        let mut is_left_out = false;
        for &declaration in declarations {
            match self.is_printed_by_bun_run(declaration) {
                Some(true) => return false,
                Some(false) => is_left_out = true,
                None => {}
            }
        }
        is_left_out
    }

    // `bun run` removes a `let`, a `const`, a class or an enum in code that never runs, also where only its transpiler knows that it never runs.
    fn is_declared_in_code_that_never_runs(
        &self,
        head: &ImplicitReference,
        symbol: SymbolId,
    ) -> bool {
        let (hir, decisions) = (self.hir, self.decisions());
        let declarations = self.bound.symbol(symbol).decls;
        let is_never_reached = declarations.iter().any(|&declaration| {
            let statement = self.find_declaring_statement(declaration);
            statement.is_some_and(|statement| {
                decisions.is_dead_stmt(statement) && is_removed_where_never_run(hir, statement)
            })
        });
        is_never_reached || self.is_printed_without_its_declaration(head, declarations)
    }

    // `bun run` counts no use of the first name of a dotted path, nor of a name that it finds behind a member of a namespace or of an enum.
    fn find_stop_at_define_head(
        &self,
        site: ExprId,
        named: &NamedPath<'_>,
        usage: DefineStop,
    ) -> Option<DefineStop> {
        let Binding::Symbol(symbol) = named.head.binding else {
            return None;
        };
        if self.is_function_of_block_or_label(symbol)
            || self.is_function_of_another_clause(site, symbol)
        {
            return Some(usage);
        }
        let counts_no_use =
            named.names.len() > 1 || self.bound.is_define_head_behind_member(&named.head);
        let unused_imports = self.compiled.analysis.unused_import_symbols;
        if unused_imports.binary_search(&symbol).is_ok() {
            return Some(match counts_no_use {
                true => DefineStop::UnusedImport,
                false => usage,
            });
        }
        let kind = self.bound.binding_kind(symbol);
        let may_be_left_out = counts_no_use
            && matches!(kind, BindingKind::Let | BindingKind::Const)
            && self.bound.symbol_scope(symbol) != file_scope(self);
        if may_be_left_out {
            return Some(DefineStop::LetOrConstBelowTopLevel);
        }
        let never_runs = self.is_declared_in_code_that_never_runs(&named.head, symbol);
        never_runs.then_some(DefineStop::DeclarationNeverRuns)
    }

    // The head of a `for` holds statements that `bun run` does not visit as statements.
    fn is_in_loop_head(&self, statement: StmtId) -> bool {
        let Parent::Stmt(parent) = self.bound.parent_of_stmt(statement) else {
            return false;
        };
        match self.hir[parent].kind {
            StmtKind::For { init, .. } => init == statement,
            StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } => left == statement,
            _ => false,
        }
    }

    // `bun run` evaluates such an expression also where nothing uses its value.
    fn is_evaluated_unused(&self, expression: ExprId) -> bool {
        let (hir, decisions) = (self.hir, self.decisions());
        let expression = self.skip_type_syntax(expression);
        if decisions.is_dead_expr(expression)
            || !matches!(decisions.decision(expression), Decision::Unknown)
        {
            return false;
        }
        match hir[expression].kind {
            ExprKind::Call(call) => !hir[call].is_pure,
            ExprKind::Assign { .. } | ExprKind::Await(_) | ExprKind::Yield { .. } => true,
            ExprKind::Unary { op, .. } => matches!(
                op,
                UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec
            ),
            _ => false,
        }
    }

    // `bun run` leaves `site` out for certain: the name that it prints for the value of a define is all of a statement, or all that `void` is applied to. Nothing is read there.
    fn is_left_out_unused(&self, site: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let mut child = site;
        loop {
            let parent = match bound.parent_of_expr(child) {
                Parent::Expr(parent) if parent.is_some() => parent,
                Parent::Stmt(statement) if statement.is_some() => {
                    return matches!(hir[statement].kind, StmtKind::Expr(_))
                        && !self.is_in_loop_head(statement);
                }
                _ => return false,
            };
            match hir[parent].kind {
                ExprKind::Unary { op: UnOp::Void, .. } => return true,
                _ if hir.type_assertion_operand(parent) == Some(child) => child = parent,
                _ => return false,
            }
        }
    }

    // `simplify_unused_expr` of src/js_parser/scan/scan_side_effects.rs, asked from below: whether `bun run` may leave `site` out as unused.
    fn may_be_left_out_unused(&self, site: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let mut child = site;
        loop {
            let parent = match bound.parent_of_expr(child) {
                Parent::Expr(parent) if parent.is_some() => parent,
                Parent::Stmt(statement) if statement.is_some() => {
                    return matches!(hir[statement].kind, StmtKind::Expr(_))
                        && !self.is_in_loop_head(statement);
                }
                _ => return false,
            };
            match hir[parent].kind {
                ExprKind::Unary { op: UnOp::Void, .. } => return true,
                ExprKind::Binary {
                    op: BinOp::Comma,
                    left,
                    ..
                } if left == child => return true,
                // A test is left out only together with everything that it decides.
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish,
                    left,
                    right,
                } if left == child && self.is_evaluated_unused(right) => {
                    return false;
                }
                ExprKind::Cond { test, branches } if test == child => {
                    let branches = hir.branches(branches);
                    if self.is_evaluated_unused(branches.yes)
                        || self.is_evaluated_unused(branches.no)
                    {
                        return false;
                    }
                }
                ExprKind::Array(items)
                    if hir
                        .ids(items)
                        .any(|item| matches!(hir[item].kind, ExprKind::Spread(_))) =>
                {
                    return false;
                }
                ExprKind::Unary {
                    op: UnOp::Not | UnOp::Typeof,
                    ..
                }
                | ExprKind::Binary {
                    op:
                        BinOp::Comma
                        | BinOp::And
                        | BinOp::Or
                        | BinOp::Nullish
                        | BinOp::EqEqEq
                        | BinOp::NotEqEq,
                    ..
                }
                | ExprKind::Cond { .. }
                | ExprKind::Array(_) => {}
                _ if hir.type_assertion_operand(parent) == Some(child) => {}
                _ => return false,
            }
            child = parent;
        }
    }

    // The fold applied a define of a dotted value where the binder recorded `head`: at the root of the record, or at an access of a path below it.
    fn is_head_of_dotted_value(&self, head: &ImplicitReference) -> bool {
        let NodeData::Expr(root) = head.node else {
            return false;
        };
        let (bound, decisions) = (self.bound, self.decisions());
        let mut site = root;
        loop {
            if let Decision::NamedPath(applied) = decisions.decision(site)
                && applied.head == *head
            {
                return applied.names.len() > 1;
            }
            match bound.parent_of_expr(site) {
                Parent::Expr(parent) if parent.is_some() => site = parent,
                _ => return false,
            }
        }
    }

    // Outside a CommonJS module `bun run` declares these only where the code names one. Whatever may name one counts, so `false` is its answer too.
    fn may_declare_commonjs_variable(&self, variable: CommonJsVariable) -> bool {
        match variable {
            CommonJsVariable::Module | CommonJsVariable::Exports => return false,
            CommonJsVariable::Require | CommonJsVariable::Filename | CommonJsVariable::Dirname => {}
        }
        let (hir, bound, decisions) = (self.hir, self.bound, self.decisions());
        let named = Binding::CommonJs(variable);
        let is_spelled = bound.ident_bindings().iter().any(|&(identifier, binding)| {
            binding == named
                && bound.is_evaluated_ident(identifier)
                && matches!(decisions.decision(identifier), Decision::Unknown)
        });
        let is_required = variable == CommonJsVariable::Require
            && hir
                .import_equals
                .iter()
                .any(|import| matches!(import.target, ImportEqualsTarget::Require(_)));
        let heads = bound.runtime.implicit_references().iter();
        let mut heads = heads.take_while(|head| head.kind == ImplicitReferenceKind::DefineHead);
        is_spelled
            || is_required
            || heads.any(|head| head.binding == named && !self.is_head_of_dotted_value(head))
    }

    /// For a dotted value that begins with a CommonJS name, outside a CommonJS module: whether `bun run` declares that name, which is free otherwise.
    fn finds_declared_commonjs_name(&self, named: &NamedPath<'_>) -> Option<bool> {
        let Binding::CommonJs(variable) = named.head.binding else {
            return None;
        };
        if named.names.len() < 2 || self.is_commonjs_module() {
            return None;
        }
        Some(self.may_declare_commonjs_variable(variable))
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn lower_global_path(&mut self, expression: ExprId, path: &[Atom]) -> ValueId {
        // The callee of `(0, NAME)()` is read here, and `bun run` calls what a define gives NAME.
        if self.file.calls_feature_flag(expression, path) {
            self.report_define_stop(expression, path, DefineStop::Called);
        }
        match self.file.builtins.of_pure_expr(expression) {
            Some(Resolved::Builtin(builtin)) if builtin.locked_builtin().is_some() => {
                self.emit_locked_builtin(builtin.id)
            }
            Some(Resolved::Builtin(_) | Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_))
            | None => {
                let member = self.lower_global_path_holder(path);
                let value = self.emit_global_path_member(member.holder, member.name);
                self.expect_resolved_path(expression, value)
            }
        }
    }

    pub(in crate::lower) fn lower_global_path_holder(&mut self, path: &[Atom]) -> GlobalPathMember {
        let (&name, holders) = path.split_last().expect("a global path names a global");
        let mut holder = None;
        for &holder_name in holders {
            holder = Some(self.emit_global_path_member(holder, holder_name));
        }
        GlobalPathMember { holder, name }
    }

    pub(super) fn lower_named_path(
        &mut self,
        expression: ExprId,
        named: &NamedPath<'_>,
    ) -> ValueId {
        let stop = self.find_define_stop(expression, named, DefineStop::Read);
        if stop.is_some() {
            self.report_define_without_support(expression, named, DefineStop::Read);
            return self.builder.undefined();
        }
        if self.file.is_left_out_unused(expression) {
            return self.builder.undefined();
        }
        let member = self.lower_named_path_holder(named);
        match member.holder {
            Some(holder) => self.emit_global_path_member(Some(holder), member.name),
            None => self.get_define_head(named),
        }
    }

    /// `lower_global_path_holder` for a path whose first name the binder found where the define applies. A path of one name has no holder.
    pub(in crate::lower) fn lower_named_path_holder(
        &mut self,
        named: &NamedPath<'_>,
    ) -> GlobalPathMember {
        let (&name, holders) = named
            .names
            .split_last()
            .expect("a named path has a first name");
        let Some((_, members)) = holders.split_first() else {
            return GlobalPathMember { holder: None, name };
        };
        let mut holder = self.get_define_head(named);
        for &member in members {
            holder = self.emit_global_path_member(Some(holder), member);
        }
        GlobalPathMember {
            holder: Some(holder),
            name,
        }
    }

    /// The first name of `named` where the define applies, read from the `with` object or evaluated text that has the name, else through its binding.
    pub(in crate::lower) fn get_define_head(&mut self, named: &NamedPath<'_>) -> ValueId {
        let head = named.head;
        if let Some(value) = self.get_dynamic_define_head(&head) {
            return value;
        }
        let binding = self.binding_of_define_head(named);
        match binding {
            // As for an identifier that names the constant: the type of `const zero = 0` does not say that it holds the integer. The read stays for its dead zone.
            Binding::Symbol(symbol) if self.file.is_constant_zero(symbol) => {
                self.get_binding_without_expression(binding, head.name);
                self.builder.integer(0)
            }
            Binding::Symbol(_) | Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => {
                self.get_binding_without_expression(binding, head.name)
            }
        }
    }

    // What the first name of `named` is read through where neither a `with` object nor evaluated text has the name.
    fn binding_of_define_head(&self, named: &NamedPath<'_>) -> Binding {
        match self.file.finds_declared_commonjs_name(named) {
            Some(false) => Binding::Free,
            Some(true) | None => named.head.binding,
        }
    }

    // The scope walk plans where a binding is kept from the identifiers that name it, and no identifier spells the first name of a define.
    fn reaches_define_head(&self, named: &NamedPath<'_>) -> bool {
        let file = &*self.file;
        let (hir, bound, plan) = (file.hir, file.bound, &file.scopes);
        let stored = match self.binding_of_define_head(named) {
            Binding::Free => return true,
            Binding::Arguments(CodeUnit::File) if !plan.has_wrapper_parameters() => return true,
            Binding::Arguments(unit) => {
                BindingRef::Slot(bound.top_scope(hir, unit), ScopeSlot::ArgumentsBinding)
            }
            Binding::CommonJs(_) if !plan.has_wrapper_parameters() => return true,
            Binding::CommonJs(variable) => {
                let slot = match plan.arguments_object(CodeUnit::File) {
                    ArgumentsObject::Mapped => ScopeSlot::Arguments,
                    ArgumentsObject::None | ArgumentsObject::Unmapped => {
                        ScopeSlot::CommonJs(variable)
                    }
                };
                BindingRef::Slot(file_scope(file), slot)
            }
            Binding::Symbol(symbol) => match plan.form(symbol) {
                // The body of the file keeps its copy of such an import to itself where the walk found no other function that names the import.
                BindingForm::Import => {
                    let is_copy_of_body = plan.imported_copies_of_body().contains(&symbol);
                    let local = self.scopes.find_local(BindingRef::Symbol(symbol));
                    return !is_copy_of_body || local.is_some();
                }
                BindingForm::Callee { function } => {
                    BindingRef::Slot(bound.fns[function.idx()].scope, ScopeSlot::Callee)
                }
                BindingForm::MappedArgument { unit, .. } => {
                    BindingRef::Slot(bound.top_scope(hir, unit), ScopeSlot::Arguments)
                }
                // No value is kept for a dropped import, and the binder finds no member of a namespace or of an enum for the first name of a define.
                BindingForm::NotAValue | BindingForm::ContainerMember { .. } => return false,
                BindingForm::Stored if plan.is_initialized_holder(self.key, symbol) => return true,
                BindingForm::Stored => BindingRef::Symbol(symbol),
            },
        };
        self.reaches_stored(stored)
    }

    // Whether `get_stored` finds the binding: in a local, in what the function copied when it was made, in a variable of the module, or in an environment that the function made or was made with.
    fn reaches_stored(&self, binding: BindingRef) -> bool {
        if self.scopes.find_local(binding).is_some() {
            return true;
        }
        let captures = self.file.scopes.captures(self.key);
        if captures.binary_search(&Capture::Value(binding)).is_ok() {
            return true;
        }
        let placement = self.file.scopes.placement(binding);
        match placement.map(|placement| placement.storage) {
            Some(Storage::Variable(_)) => true,
            Some(Storage::Field { scope, .. }) => {
                self.runs_code_of_scope(scope)
                    || captures.binary_search(&Capture::Environment(scope)).is_ok()
            }
            Some(Storage::Local) | None => false,
        }
    }

    // The scope belongs to the code that this function runs: the function has entered it wherever that code names what the scope declares.
    fn runs_code_of_scope(&self, scope: ScopeId) -> bool {
        match (self.file.bound.code_unit(scope), self.key) {
            (CodeUnit::File, FunctionKey::ModuleBody(_) | FunctionKey::WrappedModuleBody(_)) => {
                true
            }
            (CodeUnit::Function(function), FunctionKey::Source(source)) => {
                source.function == function
            }
            _ => false,
        }
    }

    // The functions of Bun's own modules are created in the scope of the global object, below the `let` and `const` bindings of scripts, so a script that declares `let process` does not shadow the global there.
    fn sees_script_bindings(&self) -> bool {
        match self.file.source.dialect() {
            SourceDialect::Program => true,
            SourceDialect::Runtime => false,
        }
    }

    pub(in crate::lower) fn emit_free_name_get(
        &mut self,
        name: Atom,
        is_for_type_of: bool,
    ) -> ValueId {
        if !is_for_type_of {
            self.report_global_without_support(name);
        }
        let key = self.file.atom_key(name);
        let is_free_name = self.sees_script_bindings();
        let global = self.builder.builtin(BuiltinId::GlobalThis, false);
        self.builder
            .prop_get(global, key, is_free_name, is_for_type_of)
    }

    fn report_global_without_support(&mut self, name: Atom) {
        let text = self.file.queries.atom_bytes(name);
        if text == b"ShadowRealm" && self.sees_script_bindings() {
            let span = self.file.span_at(self.position());
            self.file
                .diagnostics
                .report(Code::UnsupportedOption, span, &[text]);
        }
    }

    /// The stop that stays where the program does `usage` with `site`, to which a define gives `named`. `None`: the build can do there what `bun run` does, through the binding of the first name.
    pub(in crate::lower) fn find_define_stop(
        &self,
        site: ExprId,
        named: &NamedPath<'_>,
        usage: DefineStop,
    ) -> Option<DefineStop> {
        let file = &*self.file;
        if let Some(stop) = file.find_stop_at_define_head(site, named, usage) {
            return Some(stop);
        }
        match (usage, named.head.binding, named.names) {
            (DefineStop::Called, ..)
                if file.calls_eval_by_name(site, named.names, named.head.binding)
                    || file.calls_require_of_file(site, named) =>
            {
                Some(DefineStop::Called)
            }
            (DefineStop::Read | DefineStop::Called, Binding::Free, names)
                if file.calls_feature_flag(site, names) =>
            {
                Some(DefineStop::Called)
            }
            // What a file has under one of the five names of CommonJS goes by the stores that its text spells.
            (DefineStop::StoredTo, Binding::CommonJs(_), [_]) => Some(DefineStop::StoredTo),
            // In strict code a store to `eval` or to `arguments` and `delete` of a name are SyntaxErrors under `bun run`: nothing of the file runs.
            (DefineStop::StoredTo, _, [known::eval | known::arguments])
                if self.mode() == ECMAMode::Strict =>
            {
                Some(DefineStop::StoredToInStrictMode)
            }
            (DefineStop::Deleted, _, [_]) if self.mode() == ECMAMode::Strict => {
                Some(DefineStop::DeletedInStrictMode)
            }
            _ => self.find_stop_at_use_of_define_head(site, named, usage),
        }
    }

    // The stops that ask more than what the program does at `site`. A read that `bun run` leaves out for certain reads nothing here either.
    fn find_stop_at_use_of_define_head(
        &self,
        site: ExprId,
        named: &NamedPath<'_>,
        usage: DefineStop,
    ) -> Option<DefineStop> {
        let file = &*self.file;
        let (takes_value, reads_head) = match usage {
            DefineStop::Read if file.is_left_out_unused(site) => (false, false),
            DefineStop::Read | DefineStop::TypeOf => (true, true),
            DefineStop::Called => (false, true),
            DefineStop::Deleted
            | DefineStop::DeletedInStrictMode
            | DefineStop::StoredTo
            | DefineStop::StoredToInStrictMode
            | DefineStop::LetOrConstBelowTopLevel
            | DefineStop::UnusedImport
            | DefineStop::DeclarationNeverRuns => (false, false),
        };
        let stays = file.finds_declared_commonjs_name(named) == Some(true)
            || (takes_value && file.may_be_left_out_unused(site))
            || (reads_head && !self.reaches_define_head(named));
        stays.then_some(usage)
    }

    // `site` is the name or the path that a define replaces with `named`, and `usage` what the program does with it there. The message names the stop that stays there, if one does.
    pub(in crate::lower) fn report_define_without_support(
        &mut self,
        site: ExprId,
        named: &NamedPath<'_>,
        usage: DefineStop,
    ) {
        let stop = self.find_define_stop(site, named, usage).unwrap_or(usage);
        self.report_define_stop(site, named.names, stop);
    }

    /// `find_define_stop` for a callee whose define has `Decision::GlobalPath`: the stops of a call that stay where the first name is free too.
    pub(in crate::lower) fn report_eval_called_through_define(
        &mut self,
        site: ExprId,
        path: &[Atom],
    ) {
        let file = &*self.file;
        if file.calls_eval_by_name(site, path, Binding::Free) || file.calls_feature_flag(site, path)
        {
            self.report_define_stop(site, path, DefineStop::Called);
        }
    }

    // The message shows the define as a command line has it, `key=value`, and how a string is written there: the key is read off `site`, and `names` is the value.
    fn report_define_stop(&mut self, site: ExprId, names: &[Atom], stop: DefineStop) {
        let file = &mut *self.file;
        // `bun run` applies no define to evaluated text, which stays with the interpreter where the fold has replaced an expression of it.
        if file.inputs.sources.kind(file.file) == load::SourceKind::EvaluatedText {
            return;
        }
        let hir = file.hir;
        let mut key: SmallVec<[&[u8]; 4]> = SmallVec::new();
        let mut root = file.skip_type_syntax(site);
        while let Some((object, MemberKey::Name(name))) = hir.member_key(root) {
            key.push(file.queries.atom_bytes(name));
            root = file.skip_type_syntax(object);
        }
        let root: &[u8] = match hir[root].kind {
            ExprKind::Ident(name) => file.queries.atom_bytes(name),
            _ => b"import.meta",
        };
        key.push(root);
        key.reverse();
        let key = key.join(&b'.');
        let (&head, _) = names.split_first().expect("a define path has a first name");
        let head = file.queries.atom_bytes(head);
        let value: SmallVec<[&[u8]; 4]> = (names.iter())
            .map(|&name| file.queries.atom_bytes(name))
            .collect();
        let value = value.join(&b'.');
        let reason: &[u8] = match stop {
            DefineStop::Read => b"is read",
            DefineStop::Called => b"is called",
            DefineStop::TypeOf => b"is an operand of typeof",
            DefineStop::Deleted => b"is deleted",
            DefineStop::DeletedInStrictMode => b"is deleted in strict mode",
            DefineStop::StoredTo => b"is stored to",
            DefineStop::StoredToInStrictMode => b"is stored to in strict mode",
            DefineStop::LetOrConstBelowTopLevel => {
                b"is a let or const that is not at the top level of the file"
            }
            DefineStop::UnusedImport => b"is an import that the file uses nowhere else",
            DefineStop::DeclarationNeverRuns => {
                b"is a let, const, class or enum in code that never runs"
            }
        };
        let is_about_head = matches!(
            stop,
            DefineStop::LetOrConstBelowTopLevel
                | DefineStop::UnusedImport
                | DefineStop::DeclarationNeverRuns
        );
        let subject = match is_about_head {
            true => [b"\"".as_slice(), head, b"\""].concat(),
            false => key.clone(),
        };
        let option = [
            b"--define ".as_slice(),
            key.as_slice(),
            b"=",
            value.as_slice(),
            b" where ",
            subject.as_slice(),
            b" ",
            reason,
            b". The value is read as a name. A string needs quotes: --define '",
            key.as_slice(),
            b"=\"",
            value.as_slice(),
            b"\"'",
        ]
        .concat();
        let span = file.span_of(NodeData::Expr(site));
        file.diagnostics
            .report(Code::UnsupportedOption, span, &[&option]);
    }

    pub(in crate::lower) fn emit_free_name_set(&mut self, name: Atom, value: ValueId) {
        let key = self.file.atom_key(name);
        let mode = self.mode();
        let is_free_name = self.sees_script_bindings();
        let global = self.builder.builtin(BuiltinId::GlobalThis, false);
        self.file.fragment.note_write(key);
        self.builder
            .prop_set(global, key, mode, value, is_free_name);
    }

    pub(in crate::lower) fn emit_free_name_delete(&mut self, name: Atom) -> ValueId {
        let key = self.file.atom_key(name);
        let mode = self.mode();
        let is_free_name = self.sees_script_bindings();
        let global = self.builder.builtin(BuiltinId::GlobalThis, false);
        self.builder.prop_delete(global, key, mode, is_free_name)
    }

    fn emit_global_path_member(&mut self, holder: Option<ValueId>, name: Atom) -> ValueId {
        match holder {
            Some(holder) => {
                let key = self.file.atom_key(name);
                self.emit_get(holder, PropertyName::Constant(key))
            }
            None => self.emit_free_name_get(name, false),
        }
    }
}
