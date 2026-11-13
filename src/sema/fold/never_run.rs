use super::Decisions;
use crate::atom::{Atom, known};
use crate::bind::{Binding, BindingKind, Bound, ClassOwner, FnOwner, Parent, PatParent};
use crate::hir::{
    BinOp, ExprFlags, ExprId, ExprKind, File, Flags, FnBody, FnId, IdList, PatId, PatKind, StmtId,
    StmtKind, UnOp, VarDeclId, VarKind,
};
use crate::module_format::{EsmSyntax, file_esm_syntax, find_scope_below_file};
use std::cell::OnceCell;

/// What `bun run` prints of a statement that never runs. `should_keep_stmt_in_dead_control_flow` of the parser decides it.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Left {
    Nothing,
    /// Only the names of `var` declarations, which the parser declares at the end of the file.
    VarsAtEndOfFile,
    /// A statement where it stands. An `if` around it stays, with its test.
    InPlace,
}

#[derive(Copy, Clone)]
enum EsmSyntaxOfFile<'a> {
    Known(bool),
    Asked(&'a OnceCell<bool>),
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Print {
    /// Not at all, or nothing here says that it does.
    No,
    Live,
    /// Behind a `return` or another jump: as written, in the statement here, which the parser keeps or drops as one.
    Whole(StmtId),
    /// In a branch that never runs: the parser keeps of each list of statements what `Left` says.
    Filtered,
}

/// What `bun run` prints of a branch that never runs, and of what stands behind a `return` or another jump.
#[derive(Copy, Clone)]
pub struct NeverRun<'a, 's> {
    hir: &'a File<'s>,
    bound: &'a Bound<'s>,
    esm_syntax: EsmSyntaxOfFile<'a>,
}

impl<'a, 's> NeverRun<'a, 's> {
    pub fn new(hir: &'a File<'s>, bound: &'a Bound<'s>, has_esm_syntax: bool) -> NeverRun<'a, 's> {
        NeverRun {
            hir,
            bound,
            esm_syntax: EsmSyntaxOfFile::Known(has_esm_syntax),
        }
    }

    pub(super) fn asking_for_esm_syntax(
        hir: &'a File<'s>,
        bound: &'a Bound<'s>,
        has_esm_syntax: &'a OnceCell<bool>,
    ) -> NeverRun<'a, 's> {
        NeverRun {
            hir,
            bound,
            esm_syntax: EsmSyntaxOfFile::Asked(has_esm_syntax),
        }
    }

    fn has_esm_syntax(&self) -> bool {
        match self.esm_syntax {
            EsmSyntaxOfFile::Known(has_esm_syntax) => has_esm_syntax,
            EsmSyntaxOfFile::Asked(asked) => {
                *asked.get_or_init(|| file_esm_syntax(self.hir) != EsmSyntax::None)
            }
        }
    }

    #[inline]
    pub fn prints_nothing(&self, statement: StmtId) -> bool {
        self.left(statement) == Left::Nothing
    }

    /// Whether `bun run` prints an `if` for this branch of it that never runs. It then prints the test as well.
    #[inline]
    pub fn keeps_its_if(&self, statement: StmtId) -> bool {
        self.left(statement) == Left::InPlace
    }

    pub fn left(&self, statement: StmtId) -> Left {
        let hir = self.hir;
        let Some(node) = hir.stmts.get(statement.idx()) else {
            return Left::Nothing;
        };
        match node.kind {
            StmtKind::Empty
            | StmtKind::Debugger
            | StmtKind::Expr(_)
            | StmtKind::Class(_)
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Enum(_)
            | StmtKind::Return(_)
            | StmtKind::Throw(_)
            | StmtKind::Break(_)
            | StmtKind::Continue(_) => Left::Nothing,
            StmtKind::Var(declarations) => {
                let binds_a_name = |declaration: VarDeclId| {
                    let declaration = hir[declaration];
                    declaration.kind == VarKind::Var
                        && !declaration.flags.contains(Flags::AMBIENT)
                        && binds_a_name(hir, declaration.pat)
                };
                match declarations.iter().any(binds_a_name) {
                    false => Left::Nothing,
                    true if self.is_moved_to_end_of_file(statement) => Left::VarsAtEndOfFile,
                    true => Left::InPlace,
                }
            }
            StmtKind::Fn(function) => {
                let is_written = !matches!(hir[function].body, FnBody::None)
                    && !hir[function].flags.contains(Flags::AMBIENT);
                match is_written && !self.becomes_let(statement) {
                    true => Left::InPlace,
                    false => Left::Nothing,
                }
            }
            StmtKind::Block(list) => self.most_left(hir.ids(list)),
            StmtKind::If { yes, no, .. } => self.most_left([yes, no].into_iter()),
            StmtKind::While { body, .. }
            | StmtKind::DoWhile { body, .. }
            | StmtKind::Labeled { body, .. } => self.left(body),
            StmtKind::For {
                init: head, body, ..
            }
            | StmtKind::ForIn {
                left: head, body, ..
            }
            | StmtKind::ForOf {
                left: head, body, ..
            } => self.most_left([head, body].into_iter()),
            StmtKind::Try {
                block,
                handler,
                finalizer,
                ..
            } => self.most_left([block, handler, finalizer].into_iter()),
            _ => Left::InPlace,
        }
    }

    fn most_left(&self, statements: impl Iterator<Item = StmtId>) -> Left {
        let mut most = Left::Nothing;
        for statement in statements {
            most = most.max(self.left(statement));
            if most == Left::InPlace {
                break;
            }
        }
        most
    }

    /// Where `should_keep_stmt_in_dead_control_flow` stops. The parser has taken the values of a `var` away there.
    pub fn first_left_in_place(&self, statement: StmtId) -> Option<StmtId> {
        let hir = self.hir;
        match hir.stmts.get(statement.idx())?.kind {
            StmtKind::Block(list) => self.first_left_among(hir.ids(list)),
            StmtKind::If { yes, no, .. } => self.first_left_among([yes, no].into_iter()),
            StmtKind::While { body, .. }
            | StmtKind::DoWhile { body, .. }
            | StmtKind::Labeled { body, .. } => self.first_left_in_place(body),
            StmtKind::For {
                init: head, body, ..
            }
            | StmtKind::ForIn {
                left: head, body, ..
            }
            | StmtKind::ForOf {
                left: head, body, ..
            } => self.first_left_among([head, body].into_iter()),
            StmtKind::Try {
                block,
                handler,
                finalizer,
                ..
            } => self.first_left_among([block, handler, finalizer].into_iter()),
            _ => (self.left(statement) == Left::InPlace).then_some(statement),
        }
    }

    fn first_left_among(&self, mut statements: impl Iterator<Item = StmtId>) -> Option<StmtId> {
        statements.find_map(|it| self.first_left_in_place(it))
    }

    /// `maybe_relocate_vars_to_top_level`: a `var` of the file below a scope is declared at the end of the file.
    fn is_moved_to_end_of_file(&self, statement: StmtId) -> bool {
        let Some(mut scope) = find_scope_below_file(self.hir, self.bound, statement) else {
            return false;
        };
        loop {
            match self.bound.parent_of_stmt(scope) {
                Parent::Stmt(above) => scope = above,
                Parent::File => return true,
                _ => return false,
            }
        }
    }

    /// Whether `bun run` writes `let f = function() {}` in front: `P::lowers_block_level_function` and `visit_stmts`.
    pub fn becomes_let(&self, statement: StmtId) -> bool {
        let hir = self.hir;
        let Some(StmtKind::Fn(function)) = hir.stmts.get(statement.idx()).map(|it| it.kind) else {
            return false;
        };
        let written = &hir[function];
        let is_plain = matches!(written.body, FnBody::Block(_))
            && !(written.flags).intersects(Flags::ASYNC | Flags::GENERATOR | Flags::AMBIENT);
        if !is_plain {
            return false;
        }
        let Some(scope) = self.find_scope_of_block_function(statement) else {
            return false;
        };
        let is_lowered = written.name == known::arguments
            || self.is_strict_to_parser(function)
            || self.is_var_blocked(statement, written.name);
        is_lowered && !self.holds_direct_eval(scope)
    }

    /// The text of the block's scope that the parser has visited when it decides. `None` for a function of no block.
    fn find_scope_of_block_function(&self, statement: StmtId) -> Option<(u32, u32)> {
        let (hir, bound) = (self.hir, self.bound);
        let whole = |statement: StmtId| (hir[statement].start, hir[statement].loc.end);
        let Parent::Stmt(above) = bound.parent_of_stmt(statement) else {
            return None;
        };
        Some(match hir[above].kind {
            StmtKind::Block(_) => whole(above),
            StmtKind::Switch { expr, .. } => {
                let last = self.find_clause_of(above, statement)?;
                let last = hir.ids(last).last().unwrap_or(statement);
                (hir[expr].end, hir[last].loc.end)
            }
            _ => whole(statement),
        })
    }

    fn find_clause_of(&self, switch: StmtId, statement: StmtId) -> Option<IdList<StmtId>> {
        let hir = self.hir;
        let StmtKind::Switch { cases, .. } = hir[switch].kind else {
            return None;
        };
        let mut clauses = cases.iter().map(|case| hir[case].body);
        clauses.find(|&clause| hir.ids(clause).any(|it| it == statement))
    }

    fn holds_direct_eval(&self, (start, end): (u32, u32)) -> bool {
        let hir = self.hir;
        let mut evals = self.bound.runtime.eval_scopes().iter();
        evals.any(|&(call, _)| (start..end).contains(&hir[call].pos))
    }

    fn is_strict_to_parser(&self, function: FnId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let mut around = bound.fns[function.idx()].enclosing;
        let is_strict_by_syntax = match hir.fns.get(around.idx()) {
            Some(around) => around.is_strict_by_syntax,
            None => hir.is_strict_by_syntax,
        };
        if is_strict_by_syntax {
            return true;
        }
        loop {
            let body = match hir.fns.get(around.idx()) {
                Some(around) => around.body,
                None => FnBody::Block(hir.body),
            };
            if matches!(body, FnBody::Block(list) if self.begins_with_use_strict(list)) {
                return true;
            }
            if hir.fns.get(around.idx()).is_none() {
                return self.has_esm_syntax();
            }
            around = bound.fns[around.idx()].enclosing;
        }
    }

    /// The parser reads a directive by its value, also where it is written with an escape or between parentheses.
    fn begins_with_use_strict(&self, list: IdList<StmtId>) -> bool {
        let hir = self.hir;
        for statement in hir.ids(list) {
            let text = match hir[statement].kind {
                StmtKind::Directive { expr, .. } | StmtKind::Expr(expr) => expr,
                StmtKind::Interface(_) | StmtKind::TypeAlias(_) => continue,
                _ => return false,
            };
            match hir[text].kind {
                ExprKind::String(value)
                    if !hir.expr_flags(text).contains(ExprFlags::TEMPLATE_LITERAL) =>
                {
                    if value == known::use_strict {
                        return true;
                    }
                }
                _ => return false,
            }
        }
        false
    }

    /// `hoist_symbols`: no `var` where a `let`, a `const`, a `class` or a function of a block has the name in between.
    fn is_var_blocked(&self, function_statement: StmtId, name: Atom) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let Parent::Stmt(mut inner) = bound.parent_of_stmt(function_statement) else {
            return false;
        };
        loop {
            let declares = |statement: StmtId| self.declares_lexically(statement, name);
            let declares_in_block = |statement: StmtId| {
                declares(statement)
                    || matches!(hir[statement].kind, StmtKind::Fn(function)
                        if hir[function].name == name
                            && !matches!(hir[function].body, FnBody::None)
                            && !hir[function].flags.contains(Flags::AMBIENT))
            };
            let above = match bound.parent_of_stmt(inner) {
                Parent::Stmt(above) => above,
                Parent::FnBody(function) => {
                    return matches!(hir[function].body, FnBody::Block(list) if hir.ids(list).any(declares));
                }
                Parent::Module(module) => return hir.ids(hir[module].body).any(declares),
                Parent::File => return hir.ids(hir.body).any(declares),
                _ => return false,
            };
            let is_blocked = match hir[above].kind {
                StmtKind::Block(list) => hir.ids(list).any(declares_in_block),
                StmtKind::Switch { cases, .. } => {
                    (cases.iter()).any(|it| hir.ids(hir[it].body).any(declares_in_block))
                }
                StmtKind::For { init: head, .. }
                | StmtKind::ForIn { left: head, .. }
                | StmtKind::ForOf { left: head, .. } => declares(head),
                StmtKind::Try { param, handler, .. } if handler == inner => {
                    let parameter = hir.var_decls.get(param.idx()).map(|it| it.pat);
                    parameter.is_some_and(|pattern| {
                        !matches!(hir[pattern].kind, PatKind::Ident(_))
                            && binds_name(hir, pattern, name)
                    })
                }
                _ => false,
            };
            if is_blocked {
                return true;
            }
            inner = above;
        }
    }

    fn declares_lexically(&self, statement: StmtId, name: Atom) -> bool {
        let hir = self.hir;
        match hir.stmts.get(statement.idx()).map(|it| it.kind) {
            Some(StmtKind::Var(declarations)) => declarations.iter().any(|declaration| {
                let declaration = hir[declaration];
                declaration.kind != VarKind::Var
                    && !declaration.flags.contains(Flags::AMBIENT)
                    && binds_name(hir, declaration.pat, name)
            }),
            Some(StmtKind::Class(class)) => {
                hir[class].name == name && !hir[class].flags.contains(Flags::AMBIENT)
            }
            Some(StmtKind::Enum(declared)) => {
                hir[declared].name == name && !hir[declared].flags.contains(Flags::AMBIENT)
            }
            _ => false,
        }
    }
}

impl NeverRun<'_, '_> {
    /// Whether `bun run` prints an expression that the build leaves out. `true` only where the model is sure of it.
    pub fn is_printed(&self, decisions: &Decisions<'_>, expression: ExprId) -> bool {
        let print = self.print_of_expression(decisions, expression);
        matches!(print, Print::Whole(_) | Print::Filtered)
    }

    pub fn is_statement_printed(&self, decisions: &Decisions<'_>, statement: StmtId) -> bool {
        let print = self.print_of_statement(decisions, statement);
        matches!(print, Print::Whole(_) | Print::Filtered)
    }

    fn print_of_expression(&self, decisions: &Decisions<'_>, mut expression: ExprId) -> Print {
        let (hir, bound) = (self.hir, self.bound);
        loop {
            if !decisions.is_dead_expr(expression) {
                return Print::No;
            }
            match bound.parent_of_expr(expression) {
                Parent::Expr(above) if self.prints_operand(above, expression) => expression = above,
                Parent::Prop(property) | Parent::PropKey(property) => {
                    let Some(&literal) = bound.prop_owner.get(property.idx()) else {
                        return Print::No;
                    };
                    expression = literal;
                }
                Parent::Stmt(statement) => {
                    return self.print_of_head(decisions, statement, expression);
                }
                Parent::Case(case) => {
                    return self.print_of_statement(decisions, bound.case_stmt[case.idx()]);
                }
                Parent::VarInit(declaration) => {
                    return self.print_of_declaration(decisions, declaration);
                }
                Parent::ParamDefault(parameter) => {
                    return self.print_of_function(decisions, bound.param_fn[parameter.idx()]);
                }
                Parent::PatPropDefault(property) => {
                    return self.print_of_pattern(decisions, hir[property].value);
                }
                Parent::PatElemDefault(element) => {
                    return self.print_of_pattern(decisions, hir[element].pat);
                }
                Parent::FnBody(function) => {
                    return match self.print_of_function(decisions, function) {
                        Print::Whole(kept) => Print::Whole(kept),
                        _ => Print::No,
                    };
                }
                _ => return Print::No,
            }
        }
    }

    /// The parser folds an operator of which it knows an operand, and drops what has no effect in front of a comma.
    fn prints_operand(&self, operator: ExprId, operand: ExprId) -> bool {
        let hir = self.hir;
        match hir[operator].kind {
            ExprKind::Call(call) | ExprKind::New(call) => !hir[call].is_pure,
            ExprKind::Unary { op, .. } => {
                matches!(op, UnOp::Plus | UnOp::Minus | UnOp::BitNot)
                    || !self.may_know_truth(operand)
            }
            ExprKind::Binary { op, left, right } => match op {
                BinOp::And | BinOp::Or | BinOp::Nullish => !self.may_know_truth(left),
                BinOp::Comma => operand == right,
                BinOp::Add => !self.may_know_truth(left) || !self.may_know_truth(right),
                _ => true,
            },
            ExprKind::Cond { test, .. } => !self.may_know_truth(test),
            ExprKind::Array(_)
            | ExprKind::Object(_)
            | ExprKind::Assign { .. }
            | ExprKind::Spread(_)
            | ExprKind::Await(_)
            | ExprKind::Yield { .. }
            | ExprKind::Dot { .. }
            | ExprKind::Index { .. }
            | ExprKind::Template { .. }
            | ExprKind::As { .. }
            | ExprKind::Satisfies { .. }
            | ExprKind::AsConst(_)
            | ExprKind::NonNull(_) => true,
            _ => false,
        }
    }

    fn print_of_pattern(&self, decisions: &Decisions<'_>, mut pattern: PatId) -> Print {
        let bound = self.bound;
        loop {
            match bound.pat_parent.get(pattern.idx()).copied() {
                Some(PatParent::Prop(above, _) | PatParent::Elem(above, _)) => pattern = above,
                Some(PatParent::Param(parameter)) => {
                    return self.print_of_function(decisions, bound.param_fn[parameter.idx()]);
                }
                Some(PatParent::Var(declaration)) => {
                    return self.print_of_declaration(decisions, declaration);
                }
                Some(PatParent::None) | None => return Print::No,
            }
        }
    }

    /// Of a `var` the parser keeps only the names, in a branch that never runs and where its check stops.
    fn print_of_declaration(&self, decisions: &Decisions<'_>, declaration: VarDeclId) -> Print {
        let (hir, bound) = (self.hir, self.bound);
        let statement = bound.var_stmt[declaration.idx()];
        let print = self.print_of_statement(decisions, statement);
        if matches!(hir[statement].kind, StmtKind::Try { .. }) {
            return print;
        }
        match print {
            Print::Whole(kept) if self.first_left_in_place(kept) != Some(statement) => print,
            Print::Filtered if hir[declaration].kind != VarKind::Var => print,
            _ => Print::No,
        }
    }

    fn print_of_function(&self, decisions: &Decisions<'_>, function: FnId) -> Print {
        let bound = self.bound;
        match bound.fns[function.idx()].owner {
            FnOwner::Stmt(statement) => self.print_of_statement(decisions, statement),
            FnOwner::Expr(expression) => self.print_of_expression(decisions, expression),
            FnOwner::Member(member) => {
                match bound
                    .member_class(member)
                    .map(|class| bound.class_owner[class.idx()])
                {
                    Some(ClassOwner::Stmt(statement)) => {
                        self.print_of_statement(decisions, statement)
                    }
                    Some(ClassOwner::Expr(expression)) => {
                        self.print_of_expression(decisions, expression)
                    }
                    None => Print::No,
                }
            }
            FnOwner::None | FnOwner::Type(_) => Print::No,
        }
    }

    fn print_of_head(&self, decisions: &Decisions<'_>, statement: StmtId, held: ExprId) -> Print {
        let hir = self.hir;
        let print = self.print_of_statement(decisions, statement);
        if print != Print::Filtered {
            return match print {
                Print::Whole(_) => print,
                _ => Print::No,
            };
        }
        let is_kept = match hir[statement].kind {
            StmtKind::If { test, yes, no } => {
                !self.may_know_truth(test) || (self.keeps_its_if(yes) && self.keeps_its_if(no))
            }
            StmtKind::While { test, .. } | StmtKind::For { test, .. } if test == held => {
                !self.may_know_truth(test)
            }
            StmtKind::Expr(_)
            | StmtKind::DoWhile { .. }
            | StmtKind::For { .. }
            | StmtKind::ForIn { .. }
            | StmtKind::ForOf { .. }
            | StmtKind::Switch { .. }
            | StmtKind::With { .. } => true,
            _ => false,
        };
        match is_kept {
            true => Print::Filtered,
            false => Print::No,
        }
    }

    fn print_of_statement(&self, decisions: &Decisions<'_>, statement: StmtId) -> Print {
        let (hir, bound) = (self.hir, self.bound);
        if !decisions.is_dead_stmt(statement) {
            return Print::Live;
        }
        let parent = bound.parent_of_stmt(statement);
        let (around, list) = match parent {
            Parent::File => (Print::Live, Some(hir.body)),
            Parent::FnBody(function) => {
                let list = match hir[function].body {
                    FnBody::Block(list) => Some(list),
                    _ => None,
                };
                (self.print_of_function(decisions, function), list)
            }
            Parent::Stmt(above) => {
                let list = match hir[above].kind {
                    StmtKind::Block(list) => Some(list),
                    StmtKind::Switch { .. } => self.find_clause_of(above, statement),
                    _ => None,
                };
                (self.print_of_statement(decisions, above), list)
            }
            _ => (Print::No, None),
        };
        if let Parent::Stmt(above) = parent
            && matches!(hir[above].kind, StmtKind::For { init: head, .. }
                | StmtKind::ForIn { left: head, .. }
                | StmtKind::ForOf { left: head, .. } if head == statement)
            && self.left(statement) == Left::Nothing
        {
            return match around {
                Print::Live => Print::No,
                print => print,
            };
        }
        let is_let_in_front = || list.is_some() && self.becomes_let(statement);
        let left_as_one = || match is_let_in_front() || self.left(statement) == Left::InPlace {
            true => Print::Whole(statement),
            false => Print::No,
        };
        let is_behind_jump = || {
            let before = list.into_iter().flat_map(|list| hir.ids(list));
            { before }.take_while(|&it| it != statement).any(|it| {
                matches!(
                    hir[it].kind,
                    StmtKind::Return(_)
                        | StmtKind::Throw(_)
                        | StmtKind::Break(_)
                        | StmtKind::Continue(_)
                )
            })
        };
        let test_of_if_around = match parent {
            Parent::Stmt(above) => match hir[above].kind {
                StmtKind::If { test, yes, no } if yes == statement || no == statement => Some(test),
                _ => None,
            },
            _ => None,
        };
        match around {
            Print::No => Print::No,
            Print::Filtered => match is_let_in_front() || self.left(statement) == Left::InPlace {
                true => Print::Filtered,
                false => Print::No,
            },
            Print::Live => match test_of_if_around {
                Some(_) if !decisions.is_dead_stmt_in_bun_run(statement) => Print::No,
                Some(_) if self.keeps_its_if(statement) => Print::Filtered,
                Some(_) => Print::No,
                None if is_behind_jump() => left_as_one(),
                None => Print::No,
            },
            Print::Whole(kept) => match test_of_if_around {
                Some(test) if !self.may_know_truth(test) => Print::Whole(kept),
                Some(_) if self.keeps_its_if(statement) => Print::Filtered,
                Some(_) => Print::No,
                None if is_behind_jump() => left_as_one(),
                None => Print::Whole(kept),
            },
        }
    }

    /// `false` only for what the parser cannot compute. The fold keeps no values for code that never runs.
    fn may_know_truth(&self, test: ExprId) -> bool {
        let hir = self.hir;
        let test = hir.skip_type_assertions(test);
        match hir[test].kind {
            ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                !self.reads_variable(test)
            }
            ExprKind::Call(call) => hir[call].is_pure || !self.reads_variable(hir[call].callee),
            ExprKind::Binary { op, left, right } => match op {
                BinOp::EqEq
                | BinOp::NotEq
                | BinOp::EqEqEq
                | BinOp::NotEqEq
                | BinOp::Lt
                | BinOp::Le
                | BinOp::Gt
                | BinOp::Ge
                | BinOp::In
                | BinOp::Instanceof => self.may_know_truth(left) && self.may_know_truth(right),
                _ => true,
            },
            ExprKind::Await(_) | ExprKind::Yield { .. } => false,
            _ => true,
        }
    }

    fn reads_variable(&self, mut read: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        loop {
            read = hir.skip_type_assertions(read);
            match hir[read].kind {
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => read = obj,
                ExprKind::Ident(_) => {
                    let Binding::Symbol(symbol) = bound.binding(read) else {
                        return false;
                    };
                    return matches!(
                        bound.binding_kind(symbol),
                        BindingKind::Var
                            | BindingKind::Let
                            | BindingKind::Parameter
                            | BindingKind::SimpleCatchParameter
                            | BindingKind::Function
                            | BindingKind::FunctionName
                            | BindingKind::Class
                            | BindingKind::ClassInnerName
                    );
                }
                _ => return false,
            }
        }
    }
}

fn binds_a_name(hir: &File<'_>, pattern: PatId) -> bool {
    match hir[pattern].kind {
        PatKind::Missing => false,
        PatKind::Ident(_) => true,
        PatKind::Object(props) => (props.iter()).any(|prop| binds_a_name(hir, hir[prop].value)),
        PatKind::Array(elements) => {
            (elements.iter()).any(|element| binds_a_name(hir, hir[element].pat))
        }
    }
}

fn binds_name(hir: &File<'_>, pattern: PatId, name: Atom) -> bool {
    match hir[pattern].kind {
        PatKind::Missing => false,
        PatKind::Ident(bound) => bound == name,
        PatKind::Object(props) => (props.iter()).any(|prop| binds_name(hir, hir[prop].value, name)),
        PatKind::Array(elements) => {
            (elements.iter()).any(|element| binds_name(hir, hir[element].pat, name))
        }
    }
}
