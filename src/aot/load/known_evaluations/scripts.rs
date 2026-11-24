use bun_sema::atom::{Atom, Interner, NAME_IN_GLOBAL_SCOPE, known};
use bun_sema::hir::{
    ExprId, ExprKind, FileBuilder, FnBody, FnId, FnKind, IdList, PatKind, StmtId, StmtKind,
};
use rustc_hash::FxHashSet;

use crate::engine::describe_regexp_syntax_error;

pub(super) struct Script {
    function: FnId,
    expressions_before: usize,
    start: u32,
    functions: Vec<(u32, u32)>,
}

const COMMONJS_NAMES: [Atom; 3] = [known::require, known::module, known::exports];

fn function_of(file: &FileBuilder, root: ExprId) -> Option<FnId> {
    match file[root].kind {
        ExprKind::Fn(function) => Some(function),
        _ => None,
    }
}

pub(super) fn last_statement(file: &FileBuilder, root: ExprId) -> Option<StmtId> {
    match file[function_of(file, root)?].body {
        FnBody::Block(statements) => file.ids(statements).last(),
        FnBody::None | FnBody::Expr(_) => None,
    }
}

impl Script {
    pub(super) fn find(
        file: &FileBuilder,
        expressions_before: usize,
        root: ExprId,
    ) -> Option<Script> {
        let function = function_of(file, root)?;
        let start = file[function].start;
        let mut functions: Vec<(u32, u32)> = Vec::new();
        for index in (0..file.fns.len() as u32).rev() {
            let nested = FnId(index);
            if file[nested].start < start {
                break;
            }
            if nested != function
                && let Some(end) = end_of_function(file, nested)
            {
                functions.push((file[nested].start, end));
            }
        }
        functions.sort_unstable_by_key(|it| (it.0, std::cmp::Reverse(it.1)));
        let mut end = 0;
        functions.retain(|it| {
            let is_outermost = it.0 >= end;
            end = end.max(it.1);
            is_outermost
        });
        Some(Script {
            function,
            expressions_before,
            start,
            functions,
        })
    }

    pub(super) fn is_to_compile(
        &self,
        file: &FileBuilder,
        atoms: &Interner<'_>,
        is_result_used: bool,
    ) -> bool {
        let function = &file[self.function];
        let FnBody::Block(statements) = function.body else {
            return false;
        };
        if function.kind != FnKind::Expr || function.name.is_some() || !function.params.is_empty() {
            return false;
        }
        if is_result_used {
            let last = file.ids(statements).last();
            if !last.is_some_and(|it| matches!(file[it].kind, StmtKind::Expr(_))) {
                return false;
            }
        }
        self.has_plain_expressions(file, atoms) && self.has_plain_declarations(file, statements)
    }

    fn has_plain_expressions(&self, file: &FileBuilder, atoms: &Interner<'_>) -> bool {
        let worker = atoms.intern(b"Worker");
        let names_declared = self.find_commonjs_names_declared(file);
        let expressions = &file.exprs[self.expressions_before..];
        expressions.iter().all(|it| match it.kind {
            ExprKind::Call(call) => {
                let is_eval = matches!(file[file[call].callee].kind, ExprKind::Ident(known::eval));
                !is_eval || self.is_in_function(it.pos)
            }
            ExprKind::Regex { pattern, flags } => {
                describe_regexp_syntax_error(atoms.bytes(pattern), atoms.bytes(flags)).is_none()
            }
            ExprKind::Ident(name) => name != worker && !names_declared.contains(&name),
            ExprKind::ImportCall { .. } | ExprKind::ImportMeta => false,
            ExprKind::NewTarget(_) | ExprKind::Super => false,
            _ => true,
        })
    }

    fn find_commonjs_names_declared(&self, file: &FileBuilder) -> Vec<Atom> {
        let patterns = file.pats.iter().rev().take_while(|it| it.pos >= self.start);
        let of_patterns = patterns.filter_map(|it| match it.kind {
            PatKind::Ident(name) => Some(name),
            _ => None,
        });
        let functions = file
            .fns
            .iter()
            .rev()
            .take_while(|it| it.start >= self.start);
        let of_functions = functions.map(|it| it.name);
        let names = of_patterns.chain(of_functions);
        names.filter(|it| COMMONJS_NAMES.contains(it)).collect()
    }

    fn has_plain_declarations(&self, file: &FileBuilder, statements: IdList<StmtId>) -> bool {
        let appended = file.stmts.iter().enumerate().rev();
        let appended = appended.take_while(|it| it.1.loc.end > self.start);
        let of_script: FxHashSet<StmtId> = file.ids(statements).collect();
        for (index, statement) in appended {
            match statement.kind {
                StmtKind::Return(_) if !self.is_in_function(statement.loc.pos) => return false,
                StmtKind::Fn(function) => {
                    let is_declared_here = !self.is_inside_another(file, function);
                    if is_declared_here && !of_script.contains(&StmtId(index as u32)) {
                        return false;
                    }
                    if is_declared_here && is_special(file[function].name) {
                        return false;
                    }
                }
                _ => {}
            }
        }
        let mut patterns = file.pats.iter().rev().take_while(|it| it.pos >= self.start);
        patterns.all(|it| match it.kind {
            PatKind::Ident(name) => !is_special(name) || self.is_in_function(it.pos),
            _ => true,
        })
    }

    fn is_in_function(&self, pos: u32) -> bool {
        let index = self.functions.partition_point(|it| it.0 <= pos);
        index
            .checked_sub(1)
            .is_some_and(|it| pos < self.functions[it].1)
    }

    fn is_inside_another(&self, file: &FileBuilder, function: FnId) -> bool {
        let start = file[function].start;
        let index = self.functions.partition_point(|it| it.0 < start);
        index
            .checked_sub(1)
            .is_some_and(|it| start < self.functions[it].1)
    }
}

fn is_special(name: Atom) -> bool {
    matches!(name, known::arguments | known::eval)
}

fn end_of_function(file: &FileBuilder, function: FnId) -> Option<u32> {
    match file[function].body {
        FnBody::None => None,
        FnBody::Expr(expression) => Some(file[expression].end),
        FnBody::Block(statements) => {
            let last = file.ids(statements).last();
            Some(last.map_or(file[function].anchor, |it| file[it].loc.end))
        }
    }
}

pub(super) fn rename_commonjs_names(
    file: &mut FileBuilder,
    atoms: &Interner<'_>,
    first: ExprId,
    root: ExprId,
) {
    for index in first.0..root.0 {
        let expression = ExprId(index);
        if let ExprKind::Ident(name) = file[expression].kind
            && COMMONJS_NAMES.contains(&name)
        {
            let text = [NAME_IN_GLOBAL_SCOPE, atoms.bytes(name)].concat();
            file[expression].kind = ExprKind::Ident(atoms.intern(&text));
        }
    }
}
