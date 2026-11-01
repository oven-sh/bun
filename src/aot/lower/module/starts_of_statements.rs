use bun_sema::bind::ClassOwner;
use bun_sema::hir::{
    self, BinOp, ExprId, ExprKind, FnBody, FnId, FnKind, IdList, StmtId, StmtKind,
};

use super::text_of_body::{FAR_INTO_A_LINE, LongLine, push_number};
use crate::lower::FileLowering;

impl FileLowering<'_, '_, '_, '_> {
    // An error quotes what failed, and that is looked for in the line of the place. A minifier leaves a whole function in one line, or a whole bundle that is wrapped in a function.
    // What is quoted is an expression, and no expression of a function holds the start of a statement of that function. It may hold those of a function that is written in it.
    // So in a long line this says now and then where a statement begins and whose it is, and only what stands between two of them is looked through.
    // A minifier also joins statements with commas: what follows a comma in a list of declarations counts as a statement, and so does what follows one between whole expressions.
    // For each, ascending: how far it lies behind the one before it, and how far behind the start of the text of its function, in the text without types. Nothing for the body of the file.
    // Seven bits a byte, the lowest first.
    pub(super) fn find_starts_of_statements_in_long_lines(&self) -> Vec<u8> {
        let hir = self.hir;
        let mut starts = Vec::new();
        Finder::new(hir, None, &mut starts).find_in_list(hir.body);
        for function in (0..hir.fns.len() as u32).map(FnId) {
            let Some(end) = self.find_end_of_function(function) else {
                continue;
            };
            // The text of a constructor is that of its class: `finish_constructor_header`.
            let class = match hir[function].kind {
                FnKind::Constructor => self.bound.function_class(function),
                _ => None,
            };
            let (start_of_text, end_of_text) = match class {
                Some(class) => {
                    let end = match self.bound.class_owner[class.idx()] {
                        ClassOwner::Expr(expression) => hir[expression].end,
                        ClassOwner::Stmt(statement) => hir[statement].loc.end,
                    };
                    (hir[class].text_start, end)
                }
                None => (hir[function].text_start, end),
            };
            if end_of_text.saturating_sub(start_of_text) < FAR_INTO_A_LINE {
                continue;
            }
            let mut finder = Finder::new(hir, Some(start_of_text), &mut starts);
            match hir[function].body {
                FnBody::None => {}
                FnBody::Block(statements) => finder.find_in_list(statements),
                FnBody::Expr(expression) => finder.find_behind_commas(expression),
            }
            // What the class has behind its constructor.
            let behind_the_constructor = end;
            if behind_the_constructor < end_of_text {
                finder.reach(behind_the_constructor, end_of_text);
            }
        }
        starts.sort_unstable();

        let mut packed = Vec::new();
        let mut last = 0;
        for (start, function) in starts {
            let start = self.type_ranges.map_offset(start);
            let function = function.map(|function| self.type_ranges.map_offset(function));
            if start > last && function.is_none_or(|function| function < start) {
                push_number(&mut packed, start - last);
                push_number(&mut packed, function.map_or(0, |function| start - function));
                last = start;
            }
        }
        packed
    }
}

struct Finder<'a, 's> {
    hir: &'a hir::File<'s>,
    // Where its text starts. None: the body of the file.
    function: Option<u32>,
    line: LongLine<'a>,
    starts: &'a mut Vec<(u32, Option<u32>)>,
    waiting: Vec<(ExprId, bool)>,
}

impl<'a, 's> Finder<'a, 's> {
    fn new(
        hir: &'a hir::File<'s>,
        function: Option<u32>,
        starts: &'a mut Vec<(u32, Option<u32>)>,
    ) -> Self {
        Finder {
            hir,
            function,
            line: LongLine::new(&hir.text, function.unwrap_or(0)),
            starts,
            waiting: Vec::new(),
        }
    }

    fn reach(&mut self, start: u32, end: u32) {
        if let Some(start) = self.line.tell_apart(start, end) {
            self.starts.push((start, self.function));
        }
    }

    fn find_in_list(&mut self, statements: IdList<StmtId>) {
        for statement in self.hir.ids(statements) {
            self.find(statement);
        }
    }

    fn find(&mut self, statement: StmtId) {
        if statement.is_none() {
            return;
        }
        self.reach(self.hir[statement].start, self.hir[statement].loc.end);
        self.find_inside(statement);
    }

    // The head of a `for` is quoted from its first word on, so nothing in it is told apart.
    fn find_inside(&mut self, statement: StmtId) {
        let hir = self.hir;
        match hir[statement].kind {
            StmtKind::Expr(expression)
            | StmtKind::Return(expression)
            | StmtKind::Throw(expression) => self.find_behind_commas(expression),
            StmtKind::Var(declarations) => {
                for (index, declaration) in declarations.iter().enumerate() {
                    let declaration = &hir[declaration];
                    if index > 0 {
                        self.reach(declaration.loc.pos, declaration.loc.end);
                    }
                    self.find_behind_commas(declaration.init);
                }
            }
            StmtKind::If { test, yes, no } => {
                self.find_behind_commas(test);
                self.find(yes);
                self.find(no);
            }
            StmtKind::For { body, .. }
            | StmtKind::ForIn { body, .. }
            | StmtKind::ForOf { body, .. }
            | StmtKind::Labeled { body, .. } => self.find(body),
            StmtKind::While { test, body } => {
                self.find_behind_commas(test);
                self.find(body);
            }
            StmtKind::DoWhile { body, test } => {
                self.find(body);
                self.find_behind_commas(test);
            }
            StmtKind::Block(statements) => self.find_in_list(statements),
            StmtKind::Switch { expr, cases } => {
                self.find_behind_commas(expr);
                for case in cases.iter() {
                    self.find_in_list(hir[case].body);
                }
            }
            StmtKind::Try {
                block,
                handler,
                finalizer,
                ..
            } => {
                self.find(block);
                self.find(handler);
                self.find(finalizer);
            }
            _ => {}
        }
    }

    // `a(), b && (c(), d())`: nothing that is quoted holds one of these commas, as a call holds those between its arguments.
    fn find_behind_commas(&mut self, expression: ExprId) {
        let hir = self.hir;
        self.waiting.push((expression, false));
        while let Some((expression, is_behind_comma)) = self.waiting.pop() {
            if expression.is_none() {
                continue;
            }
            if is_behind_comma {
                self.reach(
                    hir::start_of(hir, expression),
                    hir::end_of_expr(hir, expression),
                );
            }
            match hir[expression].kind {
                ExprKind::Binary { op, left, right }
                    if matches!(op, BinOp::Comma | BinOp::And | BinOp::Or | BinOp::Nullish) =>
                {
                    self.waiting.push((right, matches!(op, BinOp::Comma)));
                    self.waiting.push((left, false));
                }
                ExprKind::Cond { test, branches } => {
                    let branches = hir.branches(branches);
                    self.waiting.push((branches.no, false));
                    self.waiting.push((branches.yes, false));
                    self.waiting.push((test, false));
                }
                _ => {}
            }
        }
    }
}
