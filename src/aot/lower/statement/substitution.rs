use std::cell::Cell;

use bun_sema::bind::{Binding, Decl, Parent, PatParent, SymbolId};
use bun_sema::hir::{
    Chain, ExprId, ExprKind, Flags, FnBody, FnId, IdList, NameKind, PatKind, PropKey, PropKind,
    StmtId, StmtKind, UnOp, VarDeclId, VarKind,
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
    printed: &'a [(SymbolId, Printed)],
    budget: &'a Budget,
    // The name of the variable, once it has been reached.
    found: Cell<Option<ExprId>>,
}

// What Bun's transpiler prints in place of a name.
#[derive(Copy, Clone)]
pub(in crate::lower) enum Printed {
    Initializer(ExprId),
    // A function that a block declares. The transpiler declares it as a `let` variable at the start of the block, with a function expression that has no name.
    Function(FnId),
}

#[derive(Copy, Clone)]
struct Found {
    initializer: Printed,
    // The initializer, or what is printed in its place if it is such a name itself.
    written: Printed,
}

// The statements of one list around one of them.
#[derive(Copy, Clone)]
struct Siblings {
    earlier: IdList<StmtId>,
    all: IdList<StmtId>,
    is_block: bool,
}

// `substitute_single_use_symbol_in_stmt` of Bun's transpiler changes the syntax tree. This asks the same of a tree that stays as it is.
impl FileLowering<'_, '_, '_, '_> {
    // What Bun's transpiler prints in place of a name, which is the only use of a `let` or `const` variable or of a function that a block declares.
    pub(in crate::lower) fn find_printed_in_place(&self, name: ExprId) -> Option<Printed> {
        let steps = self
            .inputs
            .limits
            .get(LimitId::MaxStepsToPrintedInitializer);
        let budget = Budget(Cell::new(steps));
        Some(self.find_printed(name, &budget)?.initializer)
    }

    pub(in crate::lower) fn find_printed_initializer(&self, name: ExprId) -> Option<ExprId> {
        match self.find_printed_in_place(name)? {
            Printed::Initializer(initializer) => Some(initializer),
            Printed::Function(_) => None,
        }
    }

    // The name in whose place Bun's transpiler prints the initializer of a variable.
    pub(in crate::lower) fn find_name_replaced_by(&self, initializer: ExprId) -> Option<ExprId> {
        let hir = self.hir;
        let Parent::VarInit(declaration) = self.bound.parent_of_expr(initializer) else {
            return None;
        };
        let symbol = self.find_symbol_used_once(declaration)?;
        let siblings = self.find_siblings(self.bound.var_stmt[declaration.idx()])?;
        let steps = self
            .inputs
            .limits
            .get(LimitId::MaxStepsToPrintedInitializer);
        let budget = Budget(Cell::new(steps));
        for later in hir
            .ids(siblings.all)
            .skip(siblings.earlier.len as usize + 1)
        {
            if !budget.take_step() {
                return None;
            }
            if !self.is_printed(later) {
                continue;
            }
            let replacement = Replacement {
                symbol,
                is_access: false,
                can_be_removed: true,
                printed: &[],
                budget: &budget,
                found: Cell::new(None),
            };
            let target = self.find_first_expression(later)?;
            if self.substitute(target, &replacement, false) == Substitution::Success {
                let name = replacement.found.get()?;
                let printed = self.find_printed(name, &budget)?.initializer;
                let is_moved = matches!(printed, Printed::Initializer(moved) if moved == hir[declaration].init);
                return is_moved.then_some(name);
            }
            if !matches!(hir[later].kind, StmtKind::Var(_)) {
                return None;
            }
        }
        None
    }

    // The literal that Bun's transpiler prints in place of the name of a constant.
    pub(in crate::lower) fn find_printed_value(&self, name: ExprId) -> Option<ExprId> {
        let Binding::Symbol(symbol) = self.bound.binding(name) else {
            return None;
        };
        let &[Decl::Var(pattern)] = self.bound.symbol(symbol).decls else {
            return None;
        };
        let PatParent::Var(declaration) = self.bound.pat_parent[pattern.idx()] else {
            return None;
        };
        // The transpiler knows the value from the declaration on.
        let is_declared = self.hir[pattern].pos < self.hir[name].pos;
        (is_declared && self.is_named_by_its_value(declaration))
            .then_some(self.hir[declaration].init)
    }

    // At the top of a file the transpiler keeps the declaration.
    pub(in crate::lower) fn is_replaced_by_its_value(&self, declaration: VarDeclId) -> bool {
        let statement = self.bound.var_stmt[declaration.idx()];
        self.bound.parent_of_stmt(statement) != Parent::File
            && self.is_named_by_its_value(declaration)
    }

    fn is_named_by_its_value(&self, declaration: VarDeclId) -> bool {
        let statement = self.bound.var_stmt[declaration.idx()];
        let siblings = match self.bound.parent_of_stmt(statement) {
            Parent::File => self.find_among(self.hir.body, false, statement),
            _ => self.find_siblings(statement),
        };
        let Some(siblings) = siblings else {
            return false;
        };
        let steps = self
            .inputs
            .limits
            .get(LimitId::MaxStepsToPrintedInitializer);
        let budget = Budget(Cell::new(steps));
        self.is_printed_as_its_value(declaration, siblings, &budget)
    }

    fn find_printed(&self, name: ExprId, budget: &Budget) -> Option<Found> {
        let hir = self.hir;
        let Binding::Symbol(symbol) = self.bound.binding(name) else {
            return None;
        };
        if !self.scopes.is_used_once(symbol) {
            return None;
        }
        let statement = self.find_statement_around(name)?;
        let target = self.find_first_expression(statement)?;
        let mut printed: SmallVec<[(SymbolId, Printed); 4]> = SmallVec::new();
        let siblings = self.find_siblings(statement)?;
        let list = siblings.earlier;
        for index in (0..list.len).rev() {
            let earlier = hir.id_at(list, index as usize);
            let is_moved =
                siblings.is_block && self.find_function_moved_to_start(earlier).is_some();
            if is_moved || !self.is_printed(earlier) {
                continue;
            }
            let StmtKind::Var(declarations) = hir[earlier].kind else {
                return None;
            };
            for declaration in declarations.iter().rev() {
                if !budget.take_step() {
                    return None;
                }
                let before = Siblings {
                    earlier: IdList::new(list.start, index),
                    ..siblings
                };
                if self.is_printed_as_its_value(declaration, before, budget) {
                    continue;
                }
                let candidate = self.find_symbol_used_once(declaration)?;
                let initializer = hir[declaration].init;
                let written = self.find_written(initializer, budget);
                let replacement = Replacement {
                    symbol: candidate,
                    is_access: match written {
                        Printed::Initializer(written) => matches!(
                            hir[written].kind,
                            ExprKind::Dot { .. } | ExprKind::Index { .. }
                        ),
                        Printed::Function(_) => false,
                    },
                    can_be_removed: match written {
                        Printed::Initializer(written) => {
                            self.is_written_without_effects(written, budget)
                        }
                        Printed::Function(_) => true,
                    },
                    printed: &printed,
                    budget,
                    found: Cell::new(None),
                };
                if self.substitute(target, &replacement, false) != Substitution::Success {
                    return None;
                }
                let initializer = Printed::Initializer(initializer);
                if candidate == symbol {
                    return Some(Found {
                        initializer,
                        written,
                    });
                }
                printed.push((candidate, initializer));
            }
        }
        if !siblings.is_block {
            return None;
        }
        // One `let` statement declares them all, each where its name is declared first, with the last function of that name.
        let mut moved: SmallVec<[(SymbolId, FnId); 4]> = SmallVec::new();
        for declared in hir.ids(siblings.all).rev() {
            if !budget.take_step() {
                return None;
            }
            if let Some(function) = self.find_function_moved_to_start(declared) {
                moved.push((self.bound.fn_symbol[function.idx()], function));
            }
        }
        for index in 0..moved.len() {
            let (candidate, _) = moved[index];
            let is_first = !moved[index + 1..].iter().any(|later| later.0 == candidate);
            if !is_first {
                continue;
            }
            let last = moved.iter().find(|entry| entry.0 == candidate)?.1;
            let is_substituted = self.scopes.is_used_once(candidate)
                && !self.bound.is_visible_to_eval(candidate)
                && !self.runs_as_written();
            if !is_substituted {
                return None;
            }
            let replacement = Replacement {
                symbol: candidate,
                is_access: false,
                can_be_removed: true,
                printed: &printed,
                budget,
                found: Cell::new(None),
            };
            if self.substitute(target, &replacement, false) != Substitution::Success {
                return None;
            }
            let function = Printed::Function(last);
            if candidate == symbol {
                return Some(Found {
                    initializer: function,
                    written: function,
                });
            }
            printed.push((candidate, function));
        }
        None
    }

    // The function of a declaration that the transpiler moves to the start of the block around it.
    fn find_function_moved_to_start(&self, statement: StmtId) -> Option<FnId> {
        let StmtKind::Fn(function) = self.hir[statement].kind else {
            return None;
        };
        let declared = self.hir[function];
        let is_moved = !matches!(declared.body, FnBody::None)
            && !declared
                .flags
                .intersects(Flags::ASYNC | Flags::GENERATOR | Flags::AMBIENT);
        is_moved.then_some(function)
    }

    // The transpiler prints the value of such a constant wherever its name is written, and no declaration: a `const` with a literal, with nothing but `const` statements in front of it in its block.
    fn is_printed_as_its_value(
        &self,
        declaration: VarDeclId,
        siblings: Siblings,
        budget: &Budget,
    ) -> bool {
        let hir = self.hir;
        let is_constant =
            |declaration: VarDeclId| self.bound.variable_kind(hir, declaration) == VarKind::Const;
        let decl = hir[declaration];
        let is_literal = matches!(hir[decl.pat].kind, PatKind::Ident(_))
            && is_constant(declaration)
            && decl.init.is_some()
            && self.is_literal_operand(decl.init)
            && !matches!(
                hir[self.skip_type_syntax(decl.init)].kind,
                ExprKind::Binary { left, .. } if self.is_text(left)
            );
        let is_behind_moved_function = || {
            let mut all = hir.ids(siblings.all);
            siblings.is_block
                && all.any(|other| {
                    !budget.take_step() || self.find_function_moved_to_start(other).is_some()
                })
        };
        is_literal
            && hir.ids(siblings.earlier).rev().all(|earlier| {
                budget.take_step()
                    && match hir[earlier].kind {
                        StmtKind::Var(declarations) => declarations.iter().all(is_constant),
                        StmtKind::Directive { .. } => true,
                        _ => !self.is_printed(earlier),
                    }
            })
            && !is_behind_moved_function()
    }

    fn find_statement_around(&self, expression: ExprId) -> Option<StmtId> {
        let bound = self.bound;
        let mut child = expression;
        loop {
            child = match bound.parent_of_expr(child) {
                Parent::Expr(parent) => parent,
                Parent::Prop(property)
                | Parent::PropKey(property)
                | Parent::MethodKey(property) => bound.prop_owner[property.idx()],
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

    fn find_siblings(&self, statement: StmtId) -> Option<Siblings> {
        let hir = self.hir;
        let (list, is_block) = match self.bound.parent_of_stmt(statement) {
            Parent::Stmt(parent) => match hir[parent].kind {
                StmtKind::Block(list) => (list, true),
                StmtKind::Switch { cases, .. } => {
                    let start = hir[statement].start;
                    let (mut low, mut high) = (0, cases.len as usize);
                    while low < high {
                        let middle = low + (high - low) / 2;
                        match hir[cases.at(middle)].end <= start {
                            true => low = middle + 1,
                            false => high = middle,
                        }
                    }
                    if low == cases.len as usize {
                        return None;
                    }
                    (hir[cases.at(low)].body, true)
                }
                _ => return None,
            },
            Parent::FnBody(function) => match hir[function].body {
                FnBody::Block(list) => (list, false),
                FnBody::None | FnBody::Expr(_) => return None,
            },
            _ => return None,
        };
        self.find_among(list, is_block, statement)
    }

    fn find_among(
        &self,
        list: IdList<StmtId>,
        is_block: bool,
        statement: StmtId,
    ) -> Option<Siblings> {
        let siblings = &self.hir.ids[list.range()];
        let index = siblings.partition_point(|&sibling| StmtId::from(sibling) < statement);
        let is_found = siblings
            .get(index)
            .is_some_and(|&sibling| StmtId::from(sibling) == statement);
        is_found.then(|| Siblings {
            earlier: IdList::new(list.start, index as u32),
            all: list,
            is_block,
        })
    }

    fn find_written(&self, expression: ExprId, budget: &Budget) -> Printed {
        let inner = self.skip_unprinted_syntax(expression);
        match self.hir[inner].kind {
            ExprKind::Ident(_) => match self.find_printed(inner, budget) {
                Some(printed) => printed.written,
                None => Printed::Initializer(inner),
            },
            _ => Printed::Initializer(inner),
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
        !is_operand_replaced && self.can_be_removed_when_unused(written, budget)
    }

    // A list or an object literal does nothing if none of its parts does.
    fn can_be_removed_when_unused(&self, expression: ExprId, budget: &Budget) -> bool {
        let hir = self.hir;
        if !budget.take_step() {
            return false;
        }
        let Printed::Initializer(written) = self.find_written(expression, budget) else {
            return true;
        };
        match hir[written].kind {
            ExprKind::Missing => true,
            ExprKind::Array(elements) => {
                let mut elements = hir.ids(elements);
                elements.all(|element| self.can_be_removed_when_unused(element, budget))
            }
            ExprKind::Object(properties) => properties.iter().all(|property| {
                let property = hir[property];
                !matches!(property.key, PropKey::Computed(_))
                    && property.kind != PropKind::Spread
                    && (property.value.is_none()
                        || self.can_be_removed_when_unused(property.value, budget))
            }),
            _ => self.is_removed_when_unused(written),
        }
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
            replacement.found.set(Some(name));
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
            Some(Printed::Initializer(initializer)) => {
                self.substitute(initializer, replacement, true)
            }
            Some(Printed::Function(_)) if replacement.can_be_removed => Substitution::Continue,
            Some(Printed::Function(_)) => Substitution::Failure,
            // It is still a name when the transpiler looks for the variable.
            None if replacement.can_be_removed || self.is_literal_operand(name) => {
                Substitution::Continue
            }
            None => Substitution::Failure,
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
            ExprKind::TaggedTemplate(site) => {
                let site = hir[site];
                then(one(site.callee), true, &|| each(site.args))
            }
            ExprKind::Object(properties) => {
                let mut found = Substitution::Continue;
                for property in properties.iter() {
                    let property = hir[property];
                    if let PropKey::Computed(key) = property.key {
                        return match one(key) {
                            Substitution::Continue => Substitution::Failure,
                            found => found,
                        };
                    }
                    if matches!(
                        property.name_kind,
                        NameKind::ComputedString | NameKind::ComputedNumber
                    ) {
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
            && self.can_be_removed_when_unused(expression, replacement.budget))
            || self.is_literal_operand(expression);
        match changes_nothing {
            true => Substitution::Continue,
            false => Substitution::Failure,
        }
    }
}
