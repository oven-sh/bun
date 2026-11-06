use bun_sema::bind::{Binding, Decl, Parent, PatParent, SymbolId};
use bun_sema::fold::{Constant, Decision, FoldedValue};
use bun_sema::hir::{
    BinOp, ExprId, ExprKind, Flags, FnBody, FnId, IdList, MemberKey, PatKind, PropKey, PropKind,
    StmtId, StmtKind, UnOp, VarDeclId, VarKind,
};
use smallvec::{SmallVec, smallvec};

use crate::lower::FileLowering;
use crate::lower::scope::{BindingRef, Storage};
use crate::lower::transpiled::{Rewrite, TranspiledFile};

// What Bun's transpiler prints in place of a name.
#[derive(Copy, Clone)]
pub(in crate::lower) enum Printed {
    Initializer(ExprId),
    // A function that a block declares. The transpiler declares it as a `let` variable at the start of the block, with a function expression that has no name.
    Function(FnId),
}

impl FileLowering<'_, '_, '_, '_> {
    // The value of an expression that does nothing when it is evaluated.
    fn find_constant(&self, expression: ExprId) -> Option<Constant> {
        if let Decision::Constant(constant) = self.decisions().decision(expression) {
            return Some(constant);
        }
        match self.decisions().constant(self.hir, expression) {
            FoldedValue::Constant(constant) => Some(constant),
            FoldedValue::ConstantOutsideDeadZone(constant) if self.reads_variable(expression) => {
                Some(constant)
            }
            FoldedValue::ConstantOutsideDeadZone(_) | FoldedValue::Unknown => None,
        }
    }

    fn reads_variable(&self, expression: ExprId) -> bool {
        matches!(self.hir[expression].kind, ExprKind::Ident(_))
            && matches!(self.bound.binding(expression), Binding::Symbol(_))
    }

    // Evaluating the expression does nothing. `bun run` leaves such an expression out where nothing takes its value.
    fn does_nothing(&self, expression: ExprId) -> bool {
        let hir = self.hir;
        let mut pending: SmallVec<[ExprId; 4]> = smallvec![expression];
        while let Some(expression) = pending.pop() {
            if self.find_constant(expression).is_some() || self.reads_variable(expression) {
                continue;
            }
            match hir[expression].kind {
                ExprKind::This | ExprKind::Fn(_) => {}
                ExprKind::Unary {
                    op: UnOp::Not | UnOp::Typeof | UnOp::Void,
                    operand,
                } => pending.push(operand),
                ExprKind::Binary {
                    op:
                        BinOp::EqEqEq
                        | BinOp::NotEqEq
                        | BinOp::And
                        | BinOp::Or
                        | BinOp::Nullish
                        | BinOp::Comma,
                    left,
                    right,
                } => pending.extend([left, right]),
                _ => return false,
            }
        }
        true
    }

    fn find_truthiness(&self, expression: ExprId) -> Option<bool> {
        match self.find_constant(expression)? {
            Constant::Undefined | Constant::Null => Some(false),
            Constant::Boolean(value) => Some(value),
            Constant::Number(value) => Some(value != 0.0 && !value.is_nan()),
            Constant::String(text) => Some(!self.queries.atom_bytes(text).is_empty()),
            Constant::BigInt(_) => None,
        }
    }

    // `[a][0]` and `{ a }.a`: the `a`.
    fn find_only_member(&self, object: ExprId, key: MemberKey) -> Option<ExprId> {
        let hir = self.hir;
        match hir[self.skip_type_syntax(object)].kind {
            ExprKind::Array(elements) if elements.len() == 1 => {
                let is_first = match key {
                    MemberKey::Name(name) => self.queries.atom_bytes(name) == b"0",
                    MemberKey::Computed(index) => {
                        matches!(self.find_constant(index), Some(Constant::Number(0.0)))
                    }
                    MemberKey::PrivateName(_) => false,
                };
                is_first.then(|| hir.id_at(elements, 0))
            }
            ExprKind::Object(properties) if properties.len() == 1 => {
                let property = hir[properties.iter().next()?];
                let is_named = matches!(property.kind, PropKind::Init | PropKind::Shorthand)
                    && matches!((property.key, key), (PropKey::Name(written), MemberKey::Name(read)) if written == read)
                    && !matches!(property.key, PropKey::Name(name) if self.queries.atom_bytes(name) == b"__proto__");
                is_named.then_some(property.value)
            }
            _ => None,
        }
    }

    // Evaluating the expression reads the variable and does nothing else.
    fn yields_variable(&self, expression: ExprId, symbol: SymbolId) -> bool {
        let hir = self.hir;
        let mut current = expression;
        loop {
            current = self.skip_type_syntax(current);
            let next = match hir[current].kind {
                ExprKind::Ident(_) => {
                    return self.bound.binding(current) == Binding::Symbol(symbol);
                }
                ExprKind::Binary { op, left, right } => {
                    let is_right_the_value = match op {
                        BinOp::Comma => self.does_nothing(left),
                        BinOp::And => self.find_truthiness(left) == Some(true),
                        BinOp::Or => self.find_truthiness(left) == Some(false),
                        BinOp::Nullish => matches!(
                            self.find_constant(left),
                            Some(Constant::Undefined | Constant::Null)
                        ),
                        _ => false,
                    };
                    is_right_the_value.then_some(right)
                }
                ExprKind::Cond { test, branches } => {
                    let branches = hir.branches(branches);
                    self.find_truthiness(test).map(|is_true| match is_true {
                        true => branches.yes,
                        false => branches.no,
                    })
                }
                ExprKind::Index { .. } | ExprKind::Dot { .. } => hir
                    .member_key(current)
                    .and_then(|(object, key)| self.find_only_member(object, key)),
                _ => None,
            };
            match next {
                Some(next) => current = next,
                None => return false,
            }
        }
    }

    // The declarations do nothing but hand the value on. The variable that holds it behind them.
    fn find_holder_behind_declarations(
        &self,
        declarations: impl Iterator<Item = VarDeclId>,
        mut symbol: SymbolId,
    ) -> Option<SymbolId> {
        let hir = self.hir;
        for declaration in declarations {
            let decl = hir[declaration];
            if decl.flags.contains(Flags::AMBIENT) {
                continue;
            }
            let is_plain = matches!(hir[decl.pat].kind, PatKind::Ident(_))
                && matches!(decl.kind, VarKind::Var | VarKind::Let | VarKind::Const)
                && !decl.flags.contains(Flags::EXPORT);
            if !is_plain {
                return None;
            }
            let Some(initializer) = decl.init.some() else {
                continue;
            };
            if self.find_constant(initializer).is_some() {
                continue;
            }
            match self.bound.initialized_binding(decl.pat) {
                Binding::Symbol(next) if self.yields_variable(initializer, symbol) => symbol = next,
                _ => return None,
            }
        }
        Some(symbol)
    }

    fn is_empty(&self, statement: StmtId) -> bool {
        let hir = self.hir;
        let mut pending: SmallVec<[StmtId; 4]> = smallvec![statement];
        while let Some(statement) = pending.pop() {
            match hir[statement].kind {
                _ if self.decisions().is_dead_stmt(statement) => {}
                StmtKind::Empty => {}
                StmtKind::Block(statements) => pending.extend(hir.ids(statements)),
                _ => return false,
            }
        }
        true
    }

    // The statements do nothing up to a `return` of the variable.
    fn return_variable_at_once(&self, statements: IdList<StmtId>, mut symbol: SymbolId) -> bool {
        let hir = self.hir;
        let mut lists: SmallVec<[IdList<StmtId>; 4]> = smallvec![statements];
        let mut arm = None;
        loop {
            let statement = match arm.take() {
                Some(arm) => arm,
                None => {
                    let Some(list) = lists.last_mut() else {
                        return false;
                    };
                    if list.len == 0 {
                        lists.pop();
                        continue;
                    }
                    let first = hir.id_at(*list, 0);
                    *list = IdList::new(list.start + 1, list.len - 1);
                    first
                }
            };
            if self.decisions().is_dead_stmt(statement) {
                continue;
            }
            match hir[statement].kind {
                StmtKind::Empty
                | StmtKind::Directive { .. }
                | StmtKind::Interface(_)
                | StmtKind::TypeAlias(_)
                | StmtKind::Fn(_) => {}
                StmtKind::Expr(expression) if self.does_nothing(expression) => {}
                StmtKind::Return(value) => {
                    return value.is_some() && self.yields_variable(value, symbol);
                }
                StmtKind::Var(declarations) => {
                    match self.find_holder_behind_declarations(declarations.iter(), symbol) {
                        Some(holder) => symbol = holder,
                        None => return false,
                    }
                }
                StmtKind::Block(statements) => lists.push(statements),
                StmtKind::If { test, yes, no } => match self.find_truthiness(test) {
                    Some(true) => arm = Some(yes),
                    Some(false) => arm = no.some(),
                    None => {
                        let is_left_out = self.does_nothing(test)
                            && self.is_empty(yes)
                            && no.some().is_none_or(|no| self.is_empty(no));
                        if !is_left_out {
                            return false;
                        }
                    }
                },
                _ => return false,
            }
        }
    }

    fn find_statements_around(&self, statement: StmtId) -> Option<IdList<StmtId>> {
        let hir = self.hir;
        match self.bound.parent_of_stmt(statement) {
            Parent::FnBody(function) => match hir[function].body {
                FnBody::Block(statements) => Some(statements),
                FnBody::None | FnBody::Expr(_) => None,
            },
            Parent::Stmt(parent) => match hir[parent].kind {
                StmtKind::Block(statements) => Some(statements),
                StmtKind::Switch { cases, .. } => {
                    let mut bodies = cases.iter().map(|case| hir[case].body);
                    bodies.find(|&body| hir.ids(body).any(|it| it == statement))
                }
                _ => None,
            },
            _ => None,
        }
    }

    // Behind the initializer the function does nothing but return its value, and nothing else reads the variable later.
    // This is read from the program and from what the build has decided about it, not from what the transpiler prints.
    fn is_returned_at_once(&self, declaration: VarDeclId) -> bool {
        let hir = self.hir;
        let decl = hir[declaration];
        // In a row of variables that are each named after the one before, only the first is asked about the rest of the row.
        if let ExprKind::Ident(_) = hir[self.skip_type_syntax(decl.init)].kind {
            return false;
        }
        let Binding::Symbol(symbol) = self.bound.initialized_binding(decl.pat) else {
            return false;
        };
        let placement = self.scopes.placement(BindingRef::Symbol(symbol));
        if !placement.is_some_and(|placement| placement.storage == Storage::Local) {
            return false;
        }
        let statement = self.bound.var_stmt[declaration.idx()];
        let (StmtKind::Var(declarations), Some(around)) =
            (hir[statement].kind, self.find_statements_around(statement))
        else {
            return false;
        };
        let later_declarations = declarations.iter().skip_while(|&it| it != declaration);
        let Some(holder) = self.find_holder_behind_declarations(later_declarations.skip(1), symbol)
        else {
            return false;
        };
        let Some(index) = hir.ids(around).position(|it| it == statement) else {
            return false;
        };
        let passed = index as u32 + 1;
        let later = IdList::new(around.start + passed, around.len - passed);
        self.return_variable_at_once(later, holder)
    }

    // What Bun's transpiler prints in place of the name of a constant, of the only use of a `let` or `const` variable or of a function that a block declares.
    // An initializer that replaces a name ends in front of the name, so following names to their initializers comes to an end.
    // A function may be declared behind the name: `last_mapped_position_in` enters none that it is in already.
    pub(in crate::lower) fn find_printed_in_place(&self, name: ExprId) -> Option<Printed> {
        let hir = self.hir;
        let transpiled = self.transpiled.as_ref()?;
        if transpiled.has_identifier_at(hir[name].pos) {
            return None;
        }
        let Binding::Symbol(symbol) = self.bound.binding(name) else {
            return None;
        };
        match *self.bound.symbol(symbol).decls {
            [Decl::Var(pattern) | Decl::Require(pattern)] => {
                let PatParent::Var(declaration) = self.bound.pat_parent[pattern.idx()] else {
                    return None;
                };
                // A name in code that the transpiler drops is gone too. Its declaration stays.
                let is_replaced = hir[declaration].loc.end <= hir[name].pos
                    && (!transpiled.has_binding_at(hir[pattern].pos)
                        || matches!(transpiled.find_rewrite(name), Some(Rewrite::Operand(_))));
                let initializer = hir[declaration].init.some().filter(|_| is_replaced);
                initializer.map(Printed::Initializer)
            }
            ref functions => {
                let mut functions = functions.iter().rev();
                let last = functions.find_map(|&declaration| match declaration {
                    Decl::Fn(function) if !matches!(hir[function].body, FnBody::None) => {
                        Some(function)
                    }
                    _ => None,
                });
                last.filter(|&last| !transpiled.has_binding_at(hir[last].name_pos))
                    .map(Printed::Function)
            }
        }
    }

    pub(in crate::lower) fn find_printed_initializer(&self, name: ExprId) -> Option<ExprId> {
        match self.find_printed_in_place(name)? {
            Printed::Initializer(initializer) => Some(initializer),
            Printed::Function(_) => None,
        }
    }

    // The transpiler prints no declaration of the variable.
    pub(in crate::lower) fn is_initializer_moved(&self, declaration: VarDeclId) -> bool {
        let position = self.hir[self.hir[declaration].pat].pos;
        let is_printed = |transpiled: &TranspiledFile| transpiled.has_binding_at(position);
        !self.transpiled.as_ref().is_none_or(is_printed)
    }

    // `const a = f(); const b = a; return b;` is printed `return f();`. The position of that `return`.
    pub(in crate::lower) fn find_return_printed_with(&self, declaration: VarDeclId) -> Option<u32> {
        let transpiled = self.transpiled.as_ref()?;
        let position = transpiled.find_return_that_evaluates(self.hir[declaration].init)?;
        self.is_returned_at_once(declaration).then_some(position)
    }

    pub(in crate::lower) fn is_replaced_by_its_value(&self, declaration: VarDeclId) -> bool {
        let initializer = self.hir[declaration].init;
        self.is_initializer_moved(declaration)
            && initializer.is_some()
            && self.is_literal_operand(initializer)
    }
}
