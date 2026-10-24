use crate::bind::Decl;
use crate::check::Checker;
use crate::check::errors_aliases::Directives;
use crate::check::sink::Reported;
use crate::hir::{ExprId, Flags, FnId, StmtId, StmtKind};
use crate::node::{Node, NodeData};
use crate::program::FileId;
use crate::util::SharedSort;

#[derive(Default)]
pub(in crate::check) struct DeadCodeRanges {
    ranges: Vec<(u32, u32)>,
    sorted_ranges: Vec<(u32, u32)>,
}

fn is_in_ranges(ranges: &[(u32, u32)], position: u32) -> bool {
    (ranges.iter()).any(|&(start, end)| (start..end).contains(&position))
}

impl Checker<'_, '_> {
    fn is_dead_node(&self, file: FileId, node: Node) -> bool {
        let data = self.hir(file).data(node);
        if let NodeData::Stmt(statement) = data {
            return self.is_dead_statement(file, statement);
        }
        if let NodeData::Expr(expression) = data {
            return self.is_dead_expression(file, expression);
        }
        false
    }

    fn is_outermost_dead_node(&self, file: FileId, node: Node) -> bool {
        let hir = self.hir(file);
        let can_be_dead =
            |ancestor: Node| matches!(hir.data(ancestor), NodeData::Stmt(_) | NodeData::Expr(_));
        !self.is_dead_node(file, hir.find_ancestor(hir.parent(node), can_be_dead))
    }

    pub(in crate::check) fn compute_dead_code_ranges(&mut self, file: FileId) {
        let mut ranges = std::mem::take(&mut self.dead_code.ranges);
        let mut sorted_ranges = std::mem::take(&mut self.dead_code.sorted_ranges);
        if self.is_in_compile_build(file) {
            self.collect_dead_code_ranges(file, &mut ranges);
        }
        sorted_ranges.extend_from_slice(&ranges);
        sorted_ranges.shared_sort_unstable();
        let mut max_end = 0;
        sorted_ranges.retain(|&(_, end)| {
            let is_nested = end <= max_end;
            max_end = max_end.max(end);
            !is_nested
        });
        self.dead_code = DeadCodeRanges {
            ranges,
            sorted_ranges,
        };
    }

    pub(in crate::check) fn clear_dead_code_ranges(&mut self) {
        self.dead_code.ranges.clear();
        self.dead_code.sorted_ranges.clear();
    }

    pub(in crate::check) fn is_in_dead_code(&self, position: u32) -> bool {
        let ranges = &self.dead_code.sorted_ranges;
        let after = ranges.partition_point(|&(start, _)| start <= position);
        after != 0 && position < ranges[after - 1].1
    }

    fn collect_dead_code_ranges(&self, file: FileId, dead_code: &mut Vec<(u32, u32)>) {
        let hir = self.hir(file);
        for (index, statement) in hir.stmts.iter().enumerate() {
            let id = StmtId(index as u32);
            if self.is_dead_statement(file, id)
                && !matches!(statement.kind, StmtKind::Empty)
                && self.is_outermost_dead_node(file, hir.node(id))
            {
                dead_code.push((statement.start, statement.loc.end));
            }
        }
        for id in (0..hir.exprs.len() as u32).map(ExprId) {
            let is_never_evaluated = self.is_short_circuited_link(file, id)
                || self.is_dead_expression(file, id)
                    && self.is_outermost_dead_node(file, hir.node(id));
            if is_never_evaluated {
                dead_code.push((self.start_of(file, id), self.end_of_expr(file, id)));
            }
        }
    }

    pub(in crate::check) fn never_check_dead_code(&self, file: FileId) -> Vec<(u32, u32)> {
        if !self.is_in_compile_build(file) {
            return Vec::new();
        }
        let mut dead_code = self.dead_code.ranges.clone();
        self.push_imports_used_only_in_dead_code(file, &mut dead_code);
        self.push_replaced_functions(file, &mut dead_code);
        self.push_left_out_functions(&mut dead_code);
        for &(start, end) in &dead_code {
            self.never_check(start, end);
        }
        dead_code
    }

    fn push_replaced_functions(&self, file: FileId, dead_code: &mut Vec<(u32, u32)>) {
        let hir = self.hir(file);
        for (index, function) in hir.fns.iter().enumerate() {
            if function.flags.contains(Flags::REPLACED_BODY) {
                let node = hir.node(FnId(index as u32));
                dead_code.push((function.start, self.end_of_node(file, node)));
            }
        }
    }

    fn push_imports_used_only_in_dead_code(&self, file: FileId, dead_code: &mut Vec<(u32, u32)>) {
        let Some(compiled) = self.files.compiled(file) else {
            return;
        };
        let (hir, bound) = (self.hir(file), self.bound(file));
        for &symbol in compiled.analysis.imports_used_only_in_dead_code {
            for declaration in bound.symbol(symbol).decls {
                match *declaration {
                    Decl::ImportSpec(spec) => dead_code.push((hir[spec].start, hir[spec].end)),
                    Decl::ImportDefault(import) => {
                        let start = hir[import].default_pos;
                        dead_code.push((start, self.end_of_name_at(file, start)));
                    }
                    _ => {}
                }
            }
        }
    }

    pub(in crate::check) fn remove_diagnostics_in_dead_code(
        &mut self,
        file: FileId,
        dead_code: &[(u32, u32)],
    ) {
        if !dead_code.is_empty() {
            self.remove_diagnostics_in_unchecked_ranges(file);
        }
    }

    pub(in crate::check) fn remove_expected_errors_in_dead_code(
        &self,
        file: FileId,
        dead_code: &[(u32, u32)],
        directives: &mut Directives,
        expected_errors: &mut Vec<Reported>,
    ) {
        if expected_errors.is_empty() || dead_code.is_empty() {
            return;
        }
        let hir = self.hir(file);
        let above_dead_code: Vec<u32> = (dead_code.iter())
            .map(|&(start, _)| directives.preceding(file, hir, start))
            .collect();
        expected_errors.retain(|unused| {
            !is_in_ranges(dead_code, unused.start) && !above_dead_code.contains(&unused.start)
        });
    }
}
