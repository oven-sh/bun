use std::cmp::Reverse;

use bun_core::strings::{index_of, index_of_char_usize, last_index_of_char};
use bun_sema::fold::FoldedValue;
use bun_sema::hir::{ClassId, ExprId, ExprKind, FnId, PatKind, StmtId, StmtKind};

use crate::lower::FileLowering;

impl FileLowering<'_, '_, '_, '_> {
    // An error at the top level of a file quotes what failed, as one in a function does, so an executable keeps that text too.
    // It is each statement of the file without the functions that are written in it: a function has its own text, which is kept only where the program can enter it.
    // A function in a list that takes values stays: `const [f = () => 1] = null` quotes the whole list.
    // For each piece, how far it starts behind the piece before it, and its length, in the text without types: seven bits a byte, the lowest first.
    // A piece of no length says that a statement begins there. Pieces that touch are kept as one, and what failed is looked for in the line of the piece.
    // In a file that a minifier has written that is every statement of the file, so far into a line the pieces are told apart now and then.
    pub(super) fn find_text_of_body(&self) -> Vec<u8> {
        let hir = self.hir;
        let in_lists = self.find_functions_in_lists();
        let is_in_list = |&(start, end): &(u32, u32)| {
            let behind = in_lists.partition_point(|in_list| in_list.0 <= start);
            behind > 0 && end <= in_lists[behind - 1].1
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
            let begins_statement = start == end;
            if !begins_statement
                && is_only_space_and_comments(&hir.text[start as usize..end as usize])
            {
                return;
            }
            let start = self.type_ranges.map_offset(start);
            let end = self.type_ranges.map_offset(end);
            if (start < end || begins_statement) && start >= end_of_last {
                push_number(&mut packed, start - end_of_last);
                push_number(&mut packed, end - start);
                end_of_last = end;
            }
        };
        // Where the line begins, or the last statement in it that was told apart.
        let mut start_of_stretch = 0;
        let mut end_of_searched = 0;
        for statement in hir.ids(hir.body) {
            let start = hir[statement].start.max(end_of_searched);
            let in_front = &hir.text[end_of_searched as usize..start as usize];
            if let Some(line_feed) = last_index_of_char(in_front, b'\n') {
                start_of_stretch = end_of_searched + line_feed as u32 + 1;
            }
            end_of_searched = start;
            if start - start_of_stretch >= FAR_INTO_A_LINE {
                add(start, start);
                start_of_stretch = start;
            }
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

    // Where each starts and ends, in order and apart.
    fn find_functions_in_lists(&self) -> Vec<(u32, u32)> {
        let transpiled = self.transpiled.as_ref();
        let functions = transpiled.map_or(&[][..], |transpiled| transpiled.printed_functions());
        if !functions.iter().any(|function| function.is_in_list) {
            return Vec::new();
        }
        let places = self.find_places_of_text_from_printer();
        let mut in_lists: Vec<(u32, u32)> = functions
            .iter()
            .zip(places)
            .filter(|(function, _)| function.is_in_list)
            .filter_map(|(_, place)| place.map(|(start, end, _)| (start, end)))
            .collect();
        in_lists.sort_unstable_by_key(|&(start, end)| (start, Reverse(end)));
        // One that lies in another.
        in_lists.dedup_by(|in_list, around| in_list.1 <= around.1);
        in_lists
    }

    // Nothing quotes a statement that only gives names to functions and to data. A table or a long string at the top level of a file is not held twice.
    fn may_fail_in_body(&self, statement: StmtId) -> bool {
        let hir = self.hir;
        if self.decisions().is_dead_stmt(statement) {
            return false;
        }
        let left_out = self.inputs.library_functions.left_out_declarations();
        match hir[statement].kind {
            StmtKind::Class(class) => {
                !left_out.is_class_left_out(self.file, class)
                    || self.is_checked_though_left_out(class)
            }
            StmtKind::Enum(_) | StmtKind::Module(_)
                if left_out.is_statement_left_out(self.file, statement) =>
            {
                false
            }
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
                let is_left_out = left_out.is_declarator_left_out(self.file, declaration);
                let declaration = &hir[declaration];
                let value = declaration.init.some().map(|value| hir[value].kind);
                match value {
                    Some(ExprKind::Class(class)) if is_left_out => {
                        return self.is_checked_though_left_out(class);
                    }
                    _ if is_left_out => return false,
                    _ => {}
                }
                let is_name = matches!(hir[declaration.pat].kind, PatKind::Ident(_));
                !is_name
                    || !(declaration.init.is_none() || self.is_function_or_data(declaration.init))
            }),
            _ => true,
        }
    }

    // `FunctionLowering::lower_checks_of_left_out_class`
    fn is_checked_though_left_out(&self, class: ClassId) -> bool {
        let left_out = self.inputs.library_functions.left_out_declarations();
        let mut members = self.hir[class].members.iter();
        left_out.is_heritage_check_kept(self.file, class)
            || members.any(|member| left_out.is_key_conversion_kept(self.file, member))
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

const FAR_INTO_A_LINE: u32 = 4096;

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
