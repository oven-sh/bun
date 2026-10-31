use bun_core::strings::{index_of, index_of_char_usize};
use bun_sema::fold::FoldedValue;
use bun_sema::hir::{ExprId, ExprKind, FnId, PatKind, StmtId, StmtKind};

use crate::lower::FileLowering;

impl FileLowering<'_, '_, '_, '_> {
    // An error at the top level of a file quotes what failed, as one in a function does, so an executable keeps that text too.
    // It is each statement of the file without the functions that are written in it: a function has its own text, which is kept only where the program can enter it.
    // A function in a list that takes values stays: `const [f = () => 1] = null` quotes the whole list.
    // For each piece, how far it starts behind the piece before it, and its length, in the text without types: seven bits a byte, the lowest first.
    pub(super) fn find_text_of_body(&self) -> Vec<u8> {
        let hir = self.hir;
        let lists = self.find_lists_that_hold_functions();
        let is_in_list = |&(start, end): &(u32, u32)| {
            let behind = lists.partition_point(|list| list.0 <= start);
            behind > 0 && end <= lists[behind - 1].1
        };
        let mut functions: Vec<(u32, u32)> = (0..hir.fns.len() as u32)
            .map(FnId)
            .filter(|function| self.bound.fns[function.idx()].enclosing.is_none())
            .filter_map(|function| {
                let end = self.find_end_of_function(function)?;
                Some((hir[function].text_start, end))
            })
            .filter(|function| !is_in_list(function))
            .collect();
        functions.sort_unstable();
        let mut functions = functions.into_iter().peekable();

        let mut packed = Vec::new();
        let mut end_of_last = 0;
        let mut add = |start: u32, end: u32| {
            if is_only_space_and_comments(&hir.text[start as usize..end as usize]) {
                return;
            }
            let start = self.type_ranges.map_offset(start);
            let end = self.type_ranges.map_offset(end);
            if start < end && start >= end_of_last {
                push_number(&mut packed, start - end_of_last);
                push_number(&mut packed, end - start);
                end_of_last = end;
            }
        };
        for statement in hir.ids(hir.body) {
            if !self.may_fail_in_body(statement) {
                continue;
            }
            let statement = &hir[statement];
            let (mut start, end) = (statement.start, statement.loc.end);
            while functions.next_if(|function| function.1 <= start).is_some() {}
            while let Some(function) = functions.next_if(|function| function.0 < end) {
                if function.0 > start {
                    add(start, function.0);
                }
                start = start.max(function.1);
            }
            if start < end {
                add(start, end);
            }
        }
        packed
    }

    // From `[` to behind `]`, in order and apart.
    fn find_lists_that_hold_functions(&self) -> Vec<(u32, u32)> {
        let transpiled = self.transpiled.as_ref();
        let starts =
            transpiled.map_or(&[][..], |transpiled| transpiled.lists_that_hold_functions());
        if starts.is_empty() {
            return Vec::new();
        }
        let hir = self.hir;
        let starts_list = |position: u32| starts.binary_search(&position).is_ok();
        let patterns = hir.pats.iter().filter_map(|pattern| {
            let is_list = matches!(pattern.kind, PatKind::Array(_)) && starts_list(pattern.pos);
            is_list.then_some((pattern.pos, pattern.end))
        });
        let assigned = hir.exprs.iter().filter_map(|expression| {
            let is_list =
                matches!(expression.kind, ExprKind::Array(_)) && starts_list(expression.pos);
            is_list.then_some((expression.pos, expression.end))
        });
        let mut lists: Vec<(u32, u32)> = patterns.chain(assigned).collect();
        lists.sort_unstable();
        // One in a body that lies in another.
        lists.dedup_by(|list, around| list.1 <= around.1);
        lists
    }

    // Nothing quotes a statement that only gives names to functions and to data. A table or a long string at the top level of a file is not held twice.
    fn may_fail_in_body(&self, statement: StmtId) -> bool {
        let hir = self.hir;
        if self.decisions().is_dead_stmt(statement) {
            return false;
        }
        match hir[statement].kind {
            StmtKind::Empty
            | StmtKind::Fn(_)
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Import(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportAsNamespace(_) => false,
            StmtKind::Expr(expression) | StmtKind::ExportDefault(expression) => {
                !self.is_function_or_data(expression)
            }
            StmtKind::Var(declarations) => declarations.iter().any(|declaration| {
                let declaration = &hir[declaration];
                let is_name = matches!(hir[declaration.pat].kind, PatKind::Ident(_));
                !is_name
                    || !(declaration.init.is_none() || self.is_function_or_data(declaration.init))
            }),
            _ => true,
        }
    }

    fn is_function_or_data(&self, expression: ExprId) -> bool {
        let expression = self.skip_type_syntax(expression);
        let decisions = self.decisions();
        matches!(self.hir[expression].kind, ExprKind::Fn(_))
            || decisions.is_data_literal(expression)
            || matches!(
                decisions.constant(self.hir, expression),
                FoldedValue::Constant(_)
            )
    }
}

// What stands between two methods of a class. It begins where a token has ended, so `/` begins a comment here.
fn is_only_space_and_comments(mut text: &[u8]) -> bool {
    loop {
        text = text.trim_ascii_start();
        let end_of_comment = match text {
            [] => return true,
            [b'/', b'/', ..] => index_of_char_usize(text, b'\n'),
            [b'/', b'*', rest @ ..] => index_of(rest, b"*/").map(|at| at + 3),
            _ => return false,
        };
        match end_of_comment {
            Some(end) => text = &text[end + 1..],
            None => return true,
        }
    }
}

fn push_number(bytes: &mut Vec<u8>, mut number: u32) {
    while number >= 0x80 {
        bytes.push(number as u8 | 0x80);
        number >>= 7;
    }
    bytes.push(number as u8);
}
