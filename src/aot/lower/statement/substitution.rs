use std::cell::Cell;

use bun_sema::bind::{Binding, Parent, SymbolId};
use bun_sema::hir::{
    Chain, ExprId, ExprKind, FnBody, IdList, NameKind, PatKind, PropKey, PropKind, StmtId,
    StmtKind, UnOp, VarDeclId, VarKind,
};
use smallvec::SmallVec;

use crate::ir::generated::LimitId;
use crate::lower::FileLowering;

// How many expressions and declarations one question may still look at. Behind the last the answer is that nothing is moved.
struct Budget(Cell<u64>);

impl Budget {
    fn take_step(&self) -> bool {
        let left = self.0.get();
        self.0.set(left.saturating_sub(1));
        left > 0
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Substitution {
    Continue,
    Success,
    Failure,
}

// A variable that is used once, on its way into the statement behind its declaration.
struct Replacement<'a> {
    symbol: SymbolId,
    is_access: bool,
    can_be_removed: bool,
    // The variables that are declared behind it, with their initializers. They are in the statement already.
    printed: &'a [(SymbolId, ExprId)],
    budget: &'a Budget,
}

#[derive(Copy, Clone)]
struct Printed {
    initializer: ExprId,
    // The initializer, or what is printed in its place if it is such a name itself.
    written: ExprId,
}

// `substitute_single_use_symbol_in_stmt` of Bun's transpiler changes the syntax tree. This asks the same of a tree that stays as it is.
impl FileLowering<'_, '_, '_, '_> {
    // The initializer that Bun's transpiler prints in place of a name, which is the only use of a `let` or `const` variable.
    pub(in crate::lower) fn find_printed_initializer(&self, name: ExprId) -> Option<ExprId> {
        let steps = self
            .inputs
            .limits
            .get(LimitId::MaxStepsToPrintedInitializer);
        let budget = Budget(Cell::new(steps));
        Some(self.find_printed(name, &budget)?.initializer)
    }

    fn find_printed(&self, name: ExprId, budget: &Budget) -> Option<Printed> {
        let hir = self.hir;
        let Binding::Symbol(symbol) = self.bound.binding(name) else {
            return None;
        };
        if !self.scopes.is_used_once(symbol) {
            return None;
        }
        let statement = self.find_statement_around(name)?;
        let target = self.find_first_expression(statement)?;
        let mut printed: SmallVec<[(SymbolId, ExprId); 4]> = SmallVec::new();
        let list = self.find_earlier_statements(statement)?;
        for index in (0..list.len).rev() {
            let earlier = hir.id_at(list, index as usize);
            if !self.is_printed(earlier) {
                continue;
            }
            let StmtKind::Var(declarations) = hir[earlier].kind else {
                return None;
            };
            for declaration in declarations.iter().rev() {
                if !budget.take_step() {
                    return None;
                }
                let before = IdList::new(list.start, index);
                if self.is_printed_as_its_value(declaration, before, budget) {
                    continue;
                }
                let candidate = self.find_symbol_used_once(declaration)?;
                let initializer = hir[declaration].init;
                let written = self.find_written(initializer, budget);
                let replacement = Replacement {
                    symbol: candidate,
                    is_access: matches!(
                        hir[written].kind,
                        ExprKind::Dot { .. } | ExprKind::Index { .. }
                    ),
                    can_be_removed: self.is_written_without_effects(written, budget),
                    printed: &printed,
                    budget,
                };
                if self.substitute(target, &replacement, false) != Substitution::Success {
                    return None;
                }
                if candidate == symbol {
                    return Some(Printed {
                        initializer,
                        written,
                    });
                }
                printed.push((candidate, initializer));
            }
        }
        None
    }

    // The transpiler prints the value of such a constant wherever its name is written, and no declaration: a `const` with a literal, with nothing but `const` statements in front of it in its block.
    fn is_printed_as_its_value(
        &self,
        declaration: VarDeclId,
        before: IdList<StmtId>,
        budget: &Budget,
    ) -> bool {
        let hir = self.hir;
        let is_constant =
            |declaration: VarDeclId| self.bound.variable_kind(hir, declaration) == VarKind::Const;
        let decl = hir[declaration];
        let is_literal = matches!(hir[decl.pat].kind, PatKind::Ident(_))
            && is_constant(declaration)
            && decl.init.is_some()
            && matches!(
                hir[self.skip_type_syntax(decl.init)].kind,
                ExprKind::Number(_)
                    | ExprKind::String(_)
                    | ExprKind::True
                    | ExprKind::False
                    | ExprKind::Null
            );
        is_literal
            && hir.ids(before).rev().all(|earlier| {
                budget.take_step()
                    && match hir[earlier].kind {
                        StmtKind::Var(declarations) => declarations.iter().all(is_constant),
                        _ => !self.is_printed(earlier),
                    }
            })
    }

    fn find_statement_around(&self, expression: ExprId) -> Option<StmtId> {
        let bound = self.bound;
        let mut child = expression;
        loop {
            child = match bound.parent_of_expr(child) {
                Parent::Expr(parent) => parent,
                Parent::Prop(property) => bound.prop_owner[property.idx()],
                Parent::Stmt(statement) => return Some(statement),
                Parent::VarInit(declaration) => return Some(bound.var_stmt[declaration.idx()]),
                _ => return None,
            };
        }
    }

    // The expression of a statement that is evaluated first, if the transpiler looks for the variable there.
    fn find_first_expression(&self, statement: StmtId) -> Option<ExprId> {
        let hir = self.hir;
        match hir[statement].kind {
            StmtKind::Expr(value)
            | StmtKind::Throw(value)
            | StmtKind::Return(value)
            | StmtKind::If { test: value, .. }
            | StmtKind::Switch { expr: value, .. } => value.some(),
            StmtKind::Var(declarations) => {
                let first = hir[declarations.iter().next()?];
                let is_name = matches!(hir[first.pat].kind, PatKind::Ident(_));
                first.init.some().filter(|_| is_name)
            }
            _ => None,
        }
    }

    fn find_earlier_statements(&self, statement: StmtId) -> Option<IdList<StmtId>> {
        let hir = self.hir;
        let list = match self.bound.parent_of_stmt(statement) {
            Parent::Stmt(parent) => match hir[parent].kind {
                StmtKind::Block(list) => list,
                _ => return None,
            },
            Parent::FnBody(function) => match hir[function].body {
                FnBody::Block(list) => list,
                FnBody::None | FnBody::Expr(_) => return None,
            },
            Parent::Case(case) => hir[case].body,
            _ => return None,
        };
        let siblings = &hir.ids[list.range()];
        let index = siblings.partition_point(|&sibling| StmtId::from(sibling) < statement);
        let is_found = siblings
            .get(index)
            .is_some_and(|&sibling| StmtId::from(sibling) == statement);
        is_found.then(|| IdList::new(list.start, index as u32))
    }

    fn find_written(&self, expression: ExprId, budget: &Budget) -> ExprId {
        let inner = self.skip_unprinted_syntax(expression);
        match self.hir[inner].kind {
            ExprKind::Ident(_) => match self.find_printed(inner, budget) {
                Some(printed) => printed.written,
                None => inner,
            },
            _ => inner,
        }
    }

    fn is_written_without_effects(&self, written: ExprId, budget: &Budget) -> bool {
        let is_operand_replaced = match self.hir[written].kind {
            ExprKind::Unary {
                op: UnOp::Typeof,
                operand,
            } => {
                let name = self.skip_type_syntax(operand);
                self.find_printed(name, budget).is_some()
            }
            _ => false,
        };
        !is_operand_replaced && self.is_removed_when_unused(written)
    }

    fn substitute_in_each(
        &self,
        expressions: IdList<ExprId>,
        replacement: &Replacement<'_>,
        is_in_initializer: bool,
    ) -> Substitution {
        for expression in self.hir.ids(expressions) {
            let found = self.substitute(expression, replacement, is_in_initializer);
            if found != Substitution::Continue {
                return found;
            }
        }
        Substitution::Continue
    }

    fn substitute_in_name(
        &self,
        name: ExprId,
        replacement: &Replacement<'_>,
        is_in_initializer: bool,
    ) -> Substitution {
        let Binding::Symbol(symbol) = self.bound.binding(name) else {
            return self.continue_behind(name, replacement);
        };
        if symbol == replacement.symbol {
            return Substitution::Success;
        }
        let listed = replacement.printed.iter().find(|entry| entry.0 == symbol);
        let initializer = match listed {
            Some(&(_, initializer)) => Some(initializer),
            None if is_in_initializer => self
                .find_printed(name, replacement.budget)
                .map(|printed| printed.initializer),
            None => None,
        };
        match initializer {
            Some(initializer) => self.substitute(initializer, replacement, true),
            None => self.continue_behind(name, replacement),
        }
    }

    fn substitute(
        &self,
        expression: ExprId,
        replacement: &Replacement<'_>,
        is_in_initializer: bool,
    ) -> Substitution {
        let hir = self.hir;
        if !replacement.budget.take_step() {
            return Substitution::Failure;
        }
        let inner = self.skip_unprinted_syntax(expression);
        let can_be_removed = replacement.can_be_removed;
        let one = |child: ExprId| self.substitute(child, replacement, is_in_initializer);
        let each = |children: IdList<ExprId>| {
            self.substitute_in_each(children, replacement, is_in_initializer)
        };
        let then =
            |first: Substitution, is_followed: bool, rest: &dyn Fn() -> Substitution| match first {
                Substitution::Continue if is_followed => rest(),
                found => found,
            };
        let found = match hir[inner].kind {
            ExprKind::Ident(_) => {
                return self.substitute_in_name(inner, replacement, is_in_initializer);
            }
            ExprKind::New(site) => {
                let site = hir[site];
                then(one(site.callee), can_be_removed, &|| each(site.args))
            }
            ExprKind::Call(site) => {
                let site = hir[site];
                let callee = self.skip_unprinted_syntax(site.callee);
                let is_replaced = matches!(hir[callee].kind, ExprKind::Ident(_))
                    && self.bound.binding(callee) == Binding::Symbol(replacement.symbol);
                // `const f = a.b; f()` does not pass `a` for `this`.
                match is_replaced && replacement.is_access {
                    true => Substitution::Continue,
                    false => {
                        let reaches_arguments = can_be_removed || site.chain == Chain::No;
                        then(one(site.callee), reaches_arguments, &|| each(site.args))
                    }
                }
            }
            ExprKind::Spread(operand) | ExprKind::Await(operand) => one(operand),
            ExprKind::Yield { value, .. } if value.is_some() => one(value),
            ExprKind::Unary { op, operand } => match op {
                UnOp::PreInc | UnOp::PostInc | UnOp::PreDec | UnOp::PostDec | UnOp::Delete => {
                    Substitution::Continue
                }
                _ => one(operand),
            },
            ExprKind::Dot { obj, .. } => one(obj),
            ExprKind::Index { obj, index, chain } => {
                then(one(obj), can_be_removed || chain == Chain::No, &|| {
                    one(index)
                })
            }
            ExprKind::Binary { left, right, .. } => then(one(left), true, &|| one(right)),
            ExprKind::Assign { op, target, value } => {
                if !self.is_removed_when_unused(target) || (op.is_some() && !can_be_removed) {
                    return Substitution::Failure;
                }
                one(value)
            }
            ExprKind::Cond { test, branches } => then(one(test), can_be_removed, &|| {
                let branches = hir.branches(branches);
                match (one(branches.yes), one(branches.no)) {
                    (Substitution::Success, _) | (_, Substitution::Success) => {
                        Substitution::Success
                    }
                    (Substitution::Continue, Substitution::Continue) => Substitution::Continue,
                    _ => Substitution::Failure,
                }
            }),
            ExprKind::Array(elements) => each(elements),
            ExprKind::Template { exprs } => each(exprs),
            ExprKind::Object(properties) => {
                let mut found = Substitution::Continue;
                for property in properties.iter() {
                    let property = hir[property];
                    let is_computed = matches!(property.key, PropKey::Computed(_))
                        || matches!(
                            property.name_kind,
                            NameKind::ComputedString | NameKind::ComputedNumber
                        );
                    if is_computed {
                        return Substitution::Failure;
                    }
                    let is_value = matches!(
                        property.kind,
                        PropKind::Init | PropKind::Shorthand | PropKind::Spread
                    );
                    if is_value && property.value.is_some() {
                        found = one(property.value);
                    }
                    if found != Substitution::Continue {
                        break;
                    }
                }
                found
            }
            _ => Substitution::Continue,
        };
        match found {
            Substitution::Continue => self.continue_behind(inner, replacement),
            found => found,
        }
    }

    // Whether the initializer may be evaluated behind the expression instead of in front of it.
    fn continue_behind(&self, expression: ExprId, replacement: &Replacement<'_>) -> Substitution {
        let changes_nothing = (replacement.can_be_removed
            && self.is_removed_when_unused(expression))
            || self.is_literal_operand(expression);
        match changes_nothing {
            true => Substitution::Continue,
            false => Substitution::Failure,
        }
    }
}
