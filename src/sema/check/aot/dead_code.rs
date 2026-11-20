use crate::bind::{Bound, Decl, Parent, PatParent};
use crate::check::Checker;
use crate::check::errors_aliases::Directives;
use crate::check::sink::Reported;
use crate::fold::Decisions;
use crate::hir::{
    ExprId, ExprKind, File, Flags, FnId, PatId, StmtKind, TypeNodeId, TypeNodeKind,
    is_parenthesized,
};
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

fn keep_outermost(ranges: &mut Vec<(u32, u32)>) {
    ranges.shared_sort_unstable();
    let mut max_end = 0;
    ranges.retain(|&(_, end)| {
        let is_nested = end <= max_end;
        max_end = max_end.max(end);
        !is_nested
    });
}

fn is_in_outermost(ranges: &[(u32, u32)], position: u32) -> bool {
    let after = ranges.partition_point(|&(start, _)| start <= position);
    after != 0 && position < ranges[after - 1].1
}

/// Whether the statement or expression right above `node` is dead.
fn is_in_dead_node(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    node: Node,
) -> bool {
    let known = match hir.data(node) {
        NodeData::Expr(e) => bound.parent_of_expr(e),
        NodeData::Stmt(s) if !bound.is_head_of_for(hir, s) => bound.parent_of_stmt(s),
        _ => Parent::None,
    };
    // The binder knows most of them, and the parents of the whole file aren't asked for.
    match known {
        Parent::File => return false,
        Parent::Expr(e) if !matches!(hir[e].kind, ExprKind::Assign { .. }) => {
            return decisions.is_dead_expr(e);
        }
        Parent::Stmt(s) if s.is_some() && !bound.is_head_of_for(hir, s) => {
            return decisions.is_dead_stmt(s);
        }
        _ => {}
    }
    let mut above = hir.parent(node);
    while above.is_some() {
        match hir.data(above) {
            NodeData::Stmt(statement) => return decisions.is_dead_stmt(statement),
            NodeData::Expr(expression) => return decisions.is_dead_expr(expression),
            _ => above = hir.parent(above),
        }
    }
    false
}

impl Checker<'_, '_> {
    pub(in crate::check) fn compute_dead_code_ranges(&mut self, file: FileId) {
        let mut ranges = std::mem::take(&mut self.dead_code.ranges);
        let mut sorted_ranges = std::mem::take(&mut self.dead_code.sorted_ranges);
        if self.is_in_compile_build(file) {
            self.collect_dead_code_ranges(file, &mut ranges);
        }
        sorted_ranges.extend_from_slice(&ranges);
        keep_outermost(&mut sorted_ranges);
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
        is_in_outermost(&self.dead_code.sorted_ranges, position)
    }

    /// `check_source_element` skips dead code, so nothing has resolved the types and the private members named there.
    /// tsc checks that code, which marks them as used.
    pub(in crate::check) fn resolve_names_in_dead_code(&mut self, file: FileId) {
        let options = self.module_options(file);
        if self.dead_code.sorted_ranges.is_empty()
            || !(options.no_unused_locals || options.no_unused_parameters)
        {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        for id in (0..hir.types.len() as u32).map(TypeNodeId) {
            if matches!(
                hir[id].kind,
                TypeNodeKind::Ref { .. } | TypeNodeKind::Typeof { .. }
            ) && !bound.is_unchecked_type(id.idx())
                && self.is_in_dead_code(hir[id].pos)
            {
                self.type_from_node(file, id);
            }
        }
        for id in (0..hir.exprs.len() as u32).map(ExprId) {
            if bound.is_unchecked(id.idx()) || !self.is_in_dead_code(hir[id].pos) {
                continue;
            }
            match hir[id].kind {
                ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::PrivateIdentifier(_) => {
                    self.type_of_expr(file, id);
                }
                // `({ a } = this)`. A build only checks a pattern in the walk of the file.
                ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } if target.is_some()
                    && matches!(hir[target].kind, ExprKind::Object(_) | ExprKind::Array(_))
                    && !is_parenthesized(hir, target)
                    && !self.is_assignment_element_with_initializer(file, id) =>
                {
                    let source = self.type_of_expr(file, value);
                    self.check_destructuring_assignment(file, target, source);
                }
                _ => {}
            }
        }
        for id in (0..hir.pats.len() as u32).map(PatId) {
            if let PatParent::Prop(pattern, _) = bound.pat_parent[id.idx()]
                && self.is_in_dead_code(hir[id].pos)
            {
                self.check_binding_element_accessibility(file, pattern, id);
            }
        }
    }

    fn collect_dead_code_ranges(&self, file: FileId, dead_code: &mut Vec<(u32, u32)>) {
        let Some(compiled) = self.files.compiled(file) else {
            return;
        };
        let (hir, bound) = (self.hir(file), self.bound(file));
        let decisions = &compiled.analysis.decisions;
        for id in decisions.dead_stmts() {
            let statement = &hir[id];
            if !matches!(statement.kind, StmtKind::Empty)
                && !is_in_dead_node(hir, bound, decisions, hir.node(id))
            {
                dead_code.push((statement.start, statement.loc.end));
            }
        }
        for id in decisions.dead_exprs_and_short_circuited_links() {
            if decisions.is_short_circuited_link(id)
                || !is_in_dead_node(hir, bound, decisions, hir.node(id))
            {
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
