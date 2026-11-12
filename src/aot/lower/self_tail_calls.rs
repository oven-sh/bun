use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, Bound, Decl, PatParent, SymbolId, has_simple_parameter_list};
use bun_sema::fold::{TreeNode, push_children};
use bun_sema::hir::{
    self, BinOp, Branches, Call, Chain, ExprId, ExprKind, Flags, FnBody, FnId, FnKind, NodeData,
    PatKind, StmtKind, VarKind,
};
use bun_sema::import_sites::is_exported;
use smallvec::SmallVec;

use crate::ir::{BlockId, LocalVariable, PositionFlags, ValueId};
use crate::lower::FunctionLowering;
use crate::lower::call::Arguments;
use crate::lower::scope::{BindingRef, Storage};

pub(in crate::lower) struct SelfTailLoop {
    function: FnId,
    header: BlockId,
    parameters: SmallVec<[(SymbolId, Atom); 4]>,
}

pub(in crate::lower) fn function_held_by(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    symbol: SymbolId,
) -> Option<FnId> {
    let function = match bound.initializing_declaration(symbol)? {
        Decl::Fn(function) => function,
        Decl::Var(name) => {
            let PatParent::Var(declaration) = bound.pat_parent[name.idx()] else {
                return None;
            };
            let VarKind::Const = bound.variable_kind(hir, declaration) else {
                return None;
            };
            let initializer = hir.skip_type_assertions(hir[declaration].init.some()?);
            let ExprKind::Fn(function) = hir[initializer].kind else {
                return None;
            };
            function
        }
        _ => return None,
    };
    let is_only_a_name = bound.is_stable_binding(symbol)
        && !bound.is_visible_to_eval(symbol)
        && bound.symbol(symbol).parent.is_none();
    is_only_a_name.then_some(function)
}

pub(in crate::lower) fn function_named_by_call(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    site: &Call,
) -> Option<(FnId, SymbolId)> {
    let callee = hir.skip_type_assertions(site.callee);
    if site.chain != Chain::No || !matches!(hir[callee].kind, ExprKind::Ident(_)) {
        return None;
    }
    let Binding::Symbol(symbol) = bound.binding(callee) else {
        return None;
    };
    if bound.dynamic_lookup_scope(NodeData::Expr(callee)).is_some() {
        return None;
    }
    Some((function_held_by(hir, bound, symbol)?, symbol))
}

fn has_names_with_defaults(hir: &hir::File<'_>, function: FnId) -> bool {
    hir[function].params.iter().all(|parameter| {
        let node = hir[parameter];
        !node.flags.contains(Flags::REST) && matches!(hir[node.pat].kind, PatKind::Ident(_))
    })
}

fn is_never_undefined(hir: &hir::File<'_>, value: ExprId) -> bool {
    match hir[hir.skip_type_assertions(value)].kind {
        ExprKind::Number(_)
        | ExprKind::String(_)
        | ExprKind::BigInt(_)
        | ExprKind::Template { .. }
        | ExprKind::Array(_)
        | ExprKind::Object(_)
        | ExprKind::Null
        | ExprKind::True
        | ExprKind::False
        | ExprKind::New(_) => true,
        ExprKind::Binary { op, .. } => {
            !matches!(op, BinOp::Comma | BinOp::And | BinOp::Or | BinOp::Nullish)
        }
        _ => false,
    }
}

fn is_arithmetic(hir: &hir::File<'_>, value: ExprId) -> bool {
    match hir[hir.skip_type_assertions(value)].kind {
        ExprKind::Binary { op, .. } => matches!(
            op,
            BinOp::Add
                | BinOp::Sub
                | BinOp::Mul
                | BinOp::Div
                | BinOp::Rem
                | BinOp::Pow
                | BinOp::Shl
                | BinOp::Shr
                | BinOp::UShr
                | BinOp::BitAnd
                | BinOp::BitOr
                | BinOp::BitXor
        ),
        _ => false,
    }
}

fn is_quotient(hir: &hir::File<'_>, bound: &Bound<'_>, value: ExprId) -> bool {
    let value = hir.skip_type_assertions(value);
    match hir[value].kind {
        ExprKind::Binary { op: BinOp::Div, .. } => true,
        ExprKind::Binary {
            op: BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::Rem | BinOp::Pow,
            left,
            right,
        } => is_quotient(hir, bound, left) || is_quotient(hir, bound, right),
        ExprKind::Ident(_) => {
            let Binding::Symbol(symbol) = bound.binding(value) else {
                return false;
            };
            let Some(Decl::Var(name)) = bound.initializing_declaration(symbol) else {
                return false;
            };
            let PatParent::Var(declaration) = bound.pat_parent[name.idx()] else {
                return false;
            };
            let initializer = hir[declaration].init;
            matches!(bound.variable_kind(hir, declaration), VarKind::Const)
                && initializer.is_some()
                && hir[initializer].end <= hir[value].pos
                && is_quotient(hir, bound, initializer)
        }
        _ => false,
    }
}

fn push_tail_calls(hir: &hir::File<'_>, value: ExprId, calls: &mut SmallVec<[ExprId; 4]>) {
    if value.is_none() {
        return;
    }
    match hir[value].kind {
        ExprKind::Call(_) => calls.push(value),
        ExprKind::Cond { branches, .. } => {
            let Branches { yes, no } = hir.branches(branches);
            push_tail_calls(hir, yes, calls);
            push_tail_calls(hir, no, calls);
        }
        ExprKind::Binary {
            op: BinOp::Comma | BinOp::And | BinOp::Or | BinOp::Nullish,
            right,
            ..
        } => push_tail_calls(hir, right, calls),
        _ => {}
    }
}

fn collect_tail_calls(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    function: FnId,
) -> Option<(SmallVec<[ExprId; 4]>, usize)> {
    let mut calls = SmallVec::new();
    let mut number_of_calls = 0;
    let mut pending: Vec<TreeNode> = Vec::new();
    match hir[function].body {
        FnBody::Block(statements) => pending.extend(hir.ids(statements).map(TreeNode::Stmt)),
        FnBody::Expr(expression) => {
            push_tail_calls(hir, expression, &mut calls);
            pending.push(TreeNode::Expr(expression));
        }
        FnBody::None => return None,
    }
    while let Some(node) = pending.pop() {
        match node {
            TreeNode::Function(_) | TreeNode::Class(_) => return None,
            TreeNode::Stmt(statement) => match hir[statement].kind {
                StmtKind::Return(value) => push_tail_calls(hir, value, &mut calls),
                StmtKind::Var(declarations) => {
                    for declaration in declarations.iter() {
                        match bound.variable_kind(hir, declaration) {
                            VarKind::Let | VarKind::Const => {}
                            VarKind::Var | VarKind::Using | VarKind::AwaitUsing => return None,
                        }
                    }
                }
                StmtKind::Fn(_) | StmtKind::Class(_) | StmtKind::Enum(_) | StmtKind::Module(_) => {
                    return None;
                }
                _ => {}
            },
            TreeNode::Expr(expression) => match hir[expression].kind {
                ExprKind::This
                | ExprKind::Super
                | ExprKind::NewTarget(_)
                | ExprKind::Fn(_)
                | ExprKind::Class(_)
                | ExprKind::Await(_)
                | ExprKind::Yield { .. } => return None,
                ExprKind::Ident(_)
                    if matches!(bound.binding(expression), Binding::Arguments(_)) =>
                {
                    return None;
                }
                ExprKind::Call(_) if bound.eval_scope(expression).is_some() => return None,
                ExprKind::Call(site) => {
                    let named = function_named_by_call(hir, bound, &hir[site]);
                    number_of_calls += usize::from(named.is_some_and(|it| it.0 == function));
                }
                _ => {}
            },
            TreeNode::Pattern(_) => {}
        }
        push_children(hir, node, &mut pending);
    }
    Some((calls, number_of_calls))
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn begin_self_tail_loop(&mut self, function: FnId) {
        if !self.file.scopes.calls_itself(function) {
            return;
        }
        let Some((parameters, modified)) = self.find_self_tail_loop(function) else {
            return;
        };
        let header = self.create_block();
        self.builder.declare_loop_header(header, &modified);
        self.jump(header);
        self.builder.switch_to(header);
        self.builder.loop_hint();
        self.self_tail_loop = Some(SelfTailLoop {
            function,
            header,
            parameters,
        });
    }

    pub(in crate::lower) fn end_self_tail_loop(&mut self) {
        if let Some(entered) = self.self_tail_loop.take() {
            self.builder.seal(entered.header);
        }
    }

    fn find_self_tail_loop(
        &mut self,
        function: FnId,
    ) -> Option<(
        SmallVec<[(SymbolId, Atom); 4]>,
        SmallVec<[LocalVariable; 8]>,
    )> {
        let (hir, bound) = (self.file.hir, self.file.bound);
        let written = hir[function];
        let top = bound.fns[function.idx()].scope;
        let is_plain = matches!(written.kind, FnKind::Decl | FnKind::Expr | FnKind::Arrow)
            && written.is_strict
            && !written.flags.intersects(Flags::ASYNC | Flags::GENERATOR)
            && (has_simple_parameter_list(hir, function) || has_names_with_defaults(hir, function));
        if !is_plain || self.file.scopes.has_environment(top) {
            return None;
        }
        let mut parameters: SmallVec<[(SymbolId, Atom); 4]> = SmallVec::new();
        let positions = self.file.function_positions(function);
        for (index, parameter) in written.params.iter().enumerate() {
            let node = hir[parameter];
            let PatKind::Ident(name) = hir[node.pat].kind else {
                return None;
            };
            let symbol = bound.declared_symbol(Decl::Param(node.pat));
            let placement = self.file.scopes.placement(BindingRef::Symbol(symbol))?;
            let is_promise = positions.parameters[index]
                .flags
                .contains(PositionFlags::IS_INT32_PROMISE);
            let is_named_twice = parameters.iter().any(|&(other, _)| other == symbol);
            if placement.storage != Storage::Local || is_promise || is_named_twice {
                return None;
            }
            parameters.push((symbol, name));
        }
        let mut is_modified: SmallVec<[bool; 4]> = parameters
            .iter()
            .map(|&(symbol, _)| !bound.is_stable_binding(symbol))
            .collect();
        let (calls, number_of_calls) = collect_tail_calls(hir, bound, function)?;
        let mut number_of_jumps = 0;
        let mut computes_argument = false;
        let mut passes_quotient = false;
        for call in calls {
            let ExprKind::Call(site) = hir[call].kind else {
                continue;
            };
            let site = hir[site];
            if !self.is_call_of(function, &site) {
                continue;
            }
            number_of_jumps += 1;
            let mut arguments = hir.ids(site.args);
            for (index, parameter) in written.params.iter().enumerate() {
                let argument = arguments.next();
                let is_passed_on = self.is_passed_on(argument, parameters[index].0);
                is_modified[index] |= !is_passed_on;
                computes_argument |= argument.is_some_and(|argument| is_arithmetic(hir, argument));
                passes_quotient |=
                    argument.is_some_and(|argument| is_quotient(hir, bound, argument));
                let default = hir[parameter].default;
                if default.is_some() {
                    let held = if is_passed_on {
                        Some(default)
                    } else {
                        argument
                    };
                    let takes_default = held.is_none_or(|held| !is_never_undefined(hir, held));
                    if takes_default || !bound.is_stable_binding(parameters[index].0) {
                        return None;
                    }
                }
            }
        }
        let has_invariant = is_modified.contains(&false);
        let keeps_types = number_of_jumps == number_of_calls && !passes_quotient;
        if !computes_argument || !(has_invariant || keeps_types) {
            return None;
        }
        let mut modified: SmallVec<[LocalVariable; 8]> = SmallVec::new();
        for (index, &(symbol, _)) in parameters.iter().enumerate() {
            if is_modified[index] {
                let local = self.scopes.find_local(BindingRef::Symbol(symbol))?;
                modified.push(local.variable);
            }
        }
        Some((parameters, modified))
    }

    fn is_passed_on(&self, argument: Option<ExprId>, parameter: SymbolId) -> bool {
        let (hir, bound) = (self.file.hir, self.file.bound);
        argument.is_some_and(|argument| {
            matches!(hir[argument].kind, ExprKind::Ident(_))
                && matches!(bound.binding(argument), Binding::Symbol(named) if named == parameter)
        })
    }

    fn is_call_of(&self, function: FnId, site: &Call) -> bool {
        let (hir, bound) = (self.file.hir, self.file.bound);
        let Some((called, symbol)) = function_named_by_call(hir, bound, site) else {
            return false;
        };
        let may_be_mocked = self.file.inputs.options.runs_tests && is_exported(hir, bound, symbol);
        let has_spread = hir
            .ids(site.args)
            .any(|argument| matches!(hir[argument].kind, ExprKind::Spread(_)));
        called == function && !has_spread && !may_be_mocked
    }

    pub(in crate::lower) fn try_lower_self_tail_call(&mut self, site: Call) -> Option<ValueId> {
        let function = self.self_tail_loop.as_ref()?.function;
        if !self.is_call_of(function, &site) {
            return None;
        }
        let hir = self.file.hir;
        let Arguments::Values(values) = self.lower_arguments(site.args) else {
            unreachable!("a call with a spread argument is no jump");
        };
        let entered = self.self_tail_loop.take()?;
        let mut arguments = hir.ids(site.args);
        for (index, &(symbol, name)) in entered.parameters.iter().enumerate() {
            let source = arguments.next();
            let is_unchanged = self.file.bound.is_stable_binding(symbol);
            if is_unchanged && self.is_passed_on(source, symbol) {
                continue;
            }
            let value = match values.get(index) {
                Some(&value) => value,
                None => self.builder.undefined(),
            };
            self.store_parameter(symbol, name, value, source);
        }
        self.jump(entered.header);
        self.self_tail_loop = Some(entered);
        self.begin_unreachable_block();
        Some(self.builder.undefined())
    }
}
