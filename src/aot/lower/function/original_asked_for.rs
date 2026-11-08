use bun_sema::atom::{Atom, known};
use bun_sema::bind::Decl;
use bun_sema::fold::{Constant, FoldedValue, TreeNode, push_children};
use bun_sema::hir::{
    BinOp, Branches, Chain, ExprId, ExprKind, FnBody, FnId, IdList, PatId, PropKey, StmtId,
    StmtKind, VarKind,
};
use bun_sema::import_sites::{
    WORDS_THAT_MOCK_LOOKS_FOR_IN_FACTORY as WORDS, may_spell_word_that_mock_looks_for,
    names_word_that_mock_looks_for as names_word,
};

use crate::ir::generated::SourceRange;
use crate::lower::FileLowering;

fn find_whether_true(decided: Constant) -> Option<bool> {
    match decided {
        Constant::Boolean(value) => Some(value),
        Constant::Undefined | Constant::Null => Some(false),
        Constant::Number(value) => Some(value != 0.0 && !value.is_nan()),
        Constant::String(_) | Constant::BigInt(_) => None,
    }
}

fn stands_outside(written: &[u8], start: u32, sought: &[u8], ranges: &[&[(u32, u32)]]) -> bool {
    let mut from = 0;
    while let Some(found) = bun_core::strings::index_of(&written[from..], sought) {
        let place = start + (from + found) as u32;
        let mut all = ranges.iter().flat_map(|it| it.iter());
        if !all.any(|it| it.0 <= place && place < it.1) {
            return true;
        }
        from += found + 1;
    }
    false
}

#[derive(Default)]
pub(super) struct OriginalsAskedFor {
    pub(super) may_be_own: bool,
    pub(super) names: Vec<Atom>,
}

impl FileLowering<'_, '_, '_, '_> {
    fn is_dropped_whole(&self, dead: StmtId) -> bool {
        let hir = self.hir;
        let mut stack = vec![dead];
        while let Some(statement) = stack.pop() {
            if statement.is_none() {
                continue;
            }
            match hir[statement].kind {
                StmtKind::Empty
                | StmtKind::Expr(_)
                | StmtKind::Throw(_)
                | StmtKind::Return(_)
                | StmtKind::Break(_)
                | StmtKind::Continue(_)
                | StmtKind::Class(_)
                | StmtKind::Debugger
                | StmtKind::Interface(_)
                | StmtKind::TypeAlias(_) => {}
                StmtKind::Fn(_) if statement != dead => {}
                StmtKind::Var(declarations) => {
                    if declarations.iter().any(|it| hir[it].kind == VarKind::Var) {
                        return false;
                    }
                }
                StmtKind::Block(statements) => stack.extend(hir.ids(statements)),
                StmtKind::Try {
                    block,
                    handler,
                    finalizer,
                    ..
                } => stack.extend([block, handler, finalizer]),
                StmtKind::If { yes, no, .. } => stack.extend([yes, no]),
                StmtKind::While { body, .. }
                | StmtKind::DoWhile { body, .. }
                | StmtKind::Labeled { body, .. } => stack.push(body),
                StmtKind::For { init, body, .. } => stack.extend([init, body]),
                StmtKind::ForIn { left, body, .. } | StmtKind::ForOf { left, body, .. } => {
                    stack.extend([left, body]);
                }
                _ => return false,
            }
        }
        let (start, end) = (hir[dead].loc.pos, hir[dead].loc.end);
        let mut comments = hir.comments.iter();
        !comments.any(|it| start <= it.pos && it.pos < end && self.has_mark(it.pos))
    }

    fn has_mark(&self, comment: u32) -> bool {
        self.hir.text.get(comment as usize + 2) == Some(&b'!')
    }

    fn find_consts_in_front_of_all_else(&self, function: FnId) -> Vec<PatId> {
        let hir = self.hir;
        let mut names = Vec::new();
        let FnBody::Block(statements) = hir[function].body else {
            return names;
        };
        for statement in hir.ids(statements) {
            let StmtKind::Var(declarations) = hir[statement].kind else {
                break;
            };
            if declarations.iter().any(|it| hir[it].kind != VarKind::Const) {
                break;
            }
            names.extend(declarations.iter().map(|it| hir[it].pat));
        }
        names
    }

    fn find_value_that_printer_prints(
        &mut self,
        written: ExprId,
        consts_that_printer_writes_out: &[PatId],
    ) -> Option<Constant> {
        let hir = self.hir;
        let decisions = self.decisions();
        let folded = decisions.constant(hir, written);
        if folded != FoldedValue::Unknown
            && !decisions.is_constant_under_minify_syntax(hir, written)
        {
            return None;
        }
        match folded {
            FoldedValue::Constant(printed) => Some(printed),
            FoldedValue::ConstantOutsideDeadZone(printed) => {
                let mut stack = vec![TreeNode::Expr(written)];
                while let Some(node) = stack.pop() {
                    if let TreeNode::Expr(part) = node
                        && let ExprKind::Ident(_) = hir[part].kind
                    {
                        let symbol = self.symbol_named_by(part)?;
                        let mut declarations = self.bound.symbol(symbol).decls.iter();
                        let is_written_out = declarations.all(|it| {
                            matches!(*it, Decl::Var(name) if consts_that_printer_writes_out.contains(&name))
                        });
                        if !is_written_out {
                            return None;
                        }
                    }
                    push_children(hir, node, &mut stack);
                }
                Some(printed)
            }
            FoldedValue::Unknown => self.find_enum_member_read(written),
        }
    }

    fn find_side_that_printer_keeps(
        &mut self,
        test: ExprId,
        consts_that_printer_writes_out: &[PatId],
    ) -> Option<bool> {
        let hir = self.hir;
        if let ExprKind::Dot {
            obj,
            name: known::hot,
            chain: Chain::No,
            ..
        } = hir[hir.skip_type_assertions(test)].kind
            && matches!(
                hir[hir.skip_type_assertions(obj)].kind,
                ExprKind::ImportMeta
            )
        {
            return Some(false);
        }
        let decided = self.find_value_that_printer_prints(test, consts_that_printer_writes_out);
        decided.and_then(find_whether_true)
    }

    fn find_name_that_search_reads(
        &mut self,
        argument: ExprId,
        consts_that_printer_writes_out: &[PatId],
    ) -> Option<Atom> {
        let hir = self.hir;
        let mut first = hir.skip_type_assertions(argument);
        loop {
            match self.find_value_that_printer_prints(first, consts_that_printer_writes_out) {
                Some(Constant::String(name)) => return Some(name),
                Some(_) => return None,
                None => {}
            }
            let ExprKind::Binary {
                op: BinOp::Add,
                left,
                ..
            } = hir[first].kind
            else {
                return None;
            };
            first = left;
        }
    }

    fn note_statements_behind_a_jump(&self, list: IdList<StmtId>, dropped: &mut Vec<StmtId>) {
        let hir = self.hir;
        let mut is_behind = false;
        for statement in hir.ids(list) {
            if is_behind && self.is_dropped_whole(statement) {
                dropped.push(statement);
            }
            is_behind |= matches!(
                hir[statement].kind,
                StmtKind::Return(_)
                    | StmtKind::Throw(_)
                    | StmtKind::Break(_)
                    | StmtKind::Continue(_)
            );
        }
    }

    pub(super) fn find_originals_asked_for(
        &mut self,
        function: FnId,
        text: SourceRange,
    ) -> OriginalsAskedFor {
        let own = OriginalsAskedFor {
            may_be_own: true,
            names: Vec::new(),
        };
        let mut asked = OriginalsAskedFor::default();
        if !self.inputs.modules.is_any_module_named_by_mock() {
            return asked;
        }
        let hir = self.hir;
        let Some(written) = hir.text.get(text.start as usize..text.end as usize) else {
            return own;
        };
        if !may_spell_word_that_mock_looks_for(written) {
            return asked;
        }
        let comments = hir.comments.iter().filter(|it| !self.has_mark(it.pos));
        let mut not_printed: Vec<(u32, u32)> = comments.map(|it| (it.pos, it.end)).collect();
        let mut functions_with_statements: Vec<(u32, u32)> = Vec::new();
        let mut dropped: Vec<StmtId> = Vec::new();
        let mut read_by_their_values: Vec<(u32, u32)> = Vec::new();
        let consts = self.find_consts_in_front_of_all_else(function);
        not_printed.push((text.start, self.parameters_position(function)));
        let mut stack = vec![TreeNode::Function(function)];
        while let Some(node) = stack.pop() {
            match node {
                TreeNode::Stmt(statement) => {
                    if let StmtKind::Block(list) = hir[statement].kind {
                        self.note_statements_behind_a_jump(list, &mut dropped);
                    }
                    if dropped.contains(&statement)
                        || matches!(
                            hir[statement].kind,
                            StmtKind::Interface(_) | StmtKind::TypeAlias(_)
                        )
                    {
                        not_printed.push((hir[statement].loc.pos, hir[statement].loc.end));
                        continue;
                    }
                    if let StmtKind::If { test, yes, no } = hir[statement].kind
                        && let Some(is_true) = self.find_side_that_printer_keeps(test, &consts)
                    {
                        let (live, dead) = if is_true { (yes, no) } else { (no, yes) };
                        not_printed.push((hir[test].pos, hir[test].end));
                        if dead.is_some() && self.is_dropped_whole(dead) {
                            not_printed.push((hir[dead].loc.pos, hir[dead].loc.end));
                        } else if dead.is_some() {
                            stack.push(TreeNode::Stmt(dead));
                        }
                        if live.is_some() {
                            stack.push(TreeNode::Stmt(live));
                        }
                        continue;
                    }
                }
                TreeNode::Expr(expr) => {
                    if !matches!(hir[expr].kind, ExprKind::String(_))
                        && let Some(printed) = self.find_value_that_printer_prints(expr, &consts)
                    {
                        if matches!(printed, Constant::String(text) if names_word(self.queries.atom_bytes(text)))
                        {
                            return own;
                        }
                        not_printed.push((hir[expr].pos, hir[expr].end));
                        continue;
                    }
                    match hir[expr].kind {
                        ExprKind::String(value) => {
                            if names_word(self.queries.atom_bytes(value)) {
                                return own;
                            }
                            read_by_their_values.push((hir[expr].pos, hir[expr].end));
                        }
                        ExprKind::Template { exprs } => {
                            let mut values = hir.ids(hir.template_texts(exprs));
                            if values.any(|it| names_word(self.queries.atom_bytes(it))) {
                                return own;
                            }
                            let mut start = hir[expr].pos;
                            for hole in hir.ids(exprs) {
                                read_by_their_values.push((start, hir[hole].pos));
                                start = hir[hole].end;
                            }
                            read_by_their_values.push((start, hir[expr].end));
                        }
                        ExprKind::Regex { .. } => {
                            read_by_their_values.push((hir[expr].pos, hir[expr].end));
                        }
                        ExprKind::Object(properties) => {
                            for property in properties.iter() {
                                let PropKey::Name(name) = hir[property].key else {
                                    continue;
                                };
                                if names_word(self.queries.atom_bytes(name)) {
                                    return own;
                                }
                                let value = hir[property].value;
                                if value.is_some() {
                                    read_by_their_values.push((hir[property].pos, hir[value].pos));
                                }
                            }
                        }
                        ExprKind::Cond { test, branches } => {
                            if let Some(is_true) = self.find_side_that_printer_keeps(test, &consts)
                            {
                                let Branches { yes, no } = hir.branches(branches);
                                let (live, dead) = if is_true { (yes, no) } else { (no, yes) };
                                not_printed.push((hir[test].pos, hir[test].end));
                                not_printed.push((hir[dead].pos, hir[dead].end));
                                stack.push(TreeNode::Expr(live));
                                continue;
                            }
                        }
                        ExprKind::As { expr: inner, .. }
                        | ExprKind::Satisfies { expr: inner, .. } => {
                            not_printed.push((hir[inner].end, hir[expr].end));
                        }
                        _ => {}
                    }
                    if let ExprKind::Call(id) = hir[expr].kind {
                        let callee = hir.skip_type_assertions(hir[id].callee);
                        let first = hir.ids(hir[id].args).next();
                        if let ExprKind::Ident(name) | ExprKind::Dot { name, .. } = hir[callee].kind
                            && let called = self.queries.atom_bytes(name)
                            && WORDS[1..].iter().any(|word| called.ends_with(word))
                            && hir[id].chain == Chain::No
                            && let Some(first) = first
                            && let Some(module) = self.find_name_that_search_reads(first, &consts)
                        {
                            let whole = hir
                                .text
                                .get(hir[callee].pos as usize..hir[callee].end as usize);
                            let place =
                                whole.and_then(|it| bun_core::strings::last_index_of(it, called));
                            let Some(place) = place else {
                                return own;
                            };
                            let place = hir[callee].pos + place as u32;
                            asked.names.push(module);
                            not_printed.push((place, place + called.len() as u32));
                        }
                    }
                }
                TreeNode::Function(inner) => {
                    if let FnBody::Block(list) = hir[inner].body {
                        let whole = self.compute_text_range(inner);
                        functions_with_statements.push((whole.start, whole.end));
                        self.note_statements_behind_a_jump(list, &mut dropped);
                    }
                }
                TreeNode::Class(_) | TreeNode::Pattern(_) => {}
            }
            push_children(hir, node, &mut stack);
        }
        for comment in hir.comments.iter().filter(|it| self.has_mark(it.pos)) {
            let mut lists = functions_with_statements.iter();
            if !lists.any(|it| it.0 <= comment.pos && comment.pos < it.1) {
                not_printed.push((comment.pos, comment.end));
            }
        }
        let mut words = WORDS.iter();
        if words.any(|word| stands_outside(written, text.start, word, &[&not_printed]))
            || stands_outside(
                written,
                text.start,
                b"\\",
                &[&not_printed, &read_by_their_values],
            )
        {
            return own;
        }
        asked
    }
}
