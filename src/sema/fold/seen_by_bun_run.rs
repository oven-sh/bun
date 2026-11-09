use super::folder::Folder;
use crate::hir::{BinOp, ExprId, ExprKind, File};
use crate::util::FxHashMap;

/// The node that the parser has where another is written: the member of a literal in place of a read, the operand in place of an
/// operator that it decides. `ExprId::NONE`: the node stays as it is written.
#[derive(Copy, Clone)]
struct InPlace {
    node: ExprId,
    /// `node` followed to its end, for the build: it reads what is there, whoever puts it there.
    for_build: ExprId,
    /// The same for `bun run` with the flags of the build, and under minify syntax.
    in_bun_run: ExprId,
    under_minify_syntax: ExprId,
}

#[derive(Default)]
pub(super) struct SeenByBunRun(FxHashMap<ExprId, InPlace>);

impl SeenByBunRun {
    /// Whether `bun run` has other nodes in place under minify syntax than with the flags of the build.
    pub(super) fn differs_under_minify_syntax(&self) -> bool {
        let mut noted = self.0.values();
        noted.any(|it| it.in_bun_run != it.under_minify_syntax)
    }

    /// The operands that `bun run` has in place of `? :`, `&&`, `||` and `??` with the flags of the build, in ascending order.
    pub(super) fn find_operands_alone_in_bun_run(&self, hir: &File<'_>) -> Vec<usize> {
        let is_operator = |e: ExprId| match hir[e].kind {
            ExprKind::Binary { op, .. } => matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish),
            ExprKind::Cond { .. } => true,
            _ => false,
        };
        let in_place = self.0.iter().filter(|it| it.1.in_bun_run.is_some());
        let operands = in_place.filter(|it| is_operator(*it.0));
        let mut operands: Vec<usize> = operands.map(|it| it.1.node.idx()).collect();
        operands.sort_unstable();
        operands
    }
}

impl Folder<'_, '_> {
    /// The node as the program writes it. The parser asks it so before it puts anything in place: whether `?.` starts a chain,
    /// whether a key stands in brackets, whether `typeof` stands over a name, whether a read is one of the listed globals.
    #[inline]
    pub(super) fn as_written(&self, e: ExprId) -> ExprId {
        self.hir.skip_type_assertions(e)
    }

    #[inline]
    fn find_noted(&self, e: ExprId) -> Option<&InPlace> {
        match self.hir[e].kind {
            ExprKind::Dot { .. }
            | ExprKind::Index { .. }
            | ExprKind::Binary { .. }
            | ExprKind::Cond { .. } => self.seen_by_bun_run.0.get(&e),
            _ => None,
        }
    }

    /// What the build has where `e` is written.
    pub(super) fn find_in_place(&self, e: ExprId) -> ExprId {
        let e = self.as_written(e);
        let in_place = self.find_noted(e).and_then(|it| it.for_build.some());
        in_place.unwrap_or(e)
    }

    /// What `bun run` has where `e` is written: with the flags of the build, or under minify syntax where that is asked.
    pub(super) fn seen_by_bun_run(&self, e: ExprId) -> ExprId {
        let e = self.as_written(e);
        let seen = self
            .find_noted(e)
            .map(|it| match self.assumes_minify_syntax.get() {
                true => it.under_minify_syntax,
                false => it.in_bun_run,
            });
        seen.and_then(ExprId::some).unwrap_or(e)
    }

    /// `member` stands where `read` is written: for `bun run` where `is_in_place` holds, and for the build.
    pub(super) fn note_member_in_place(
        &mut self,
        read: ExprId,
        member: ExprId,
        is_in_place: impl Fn(&Self) -> bool,
    ) {
        self.note_in_place(read, member, true, is_in_place);
    }

    /// `operand` stands where `operator` is written, where the parser leaves nothing else of it: for `bun run` where `is_in_place`
    /// holds, and for the build where it holds under minify syntax.
    pub(super) fn note_operand_in_place(
        &mut self,
        operator: ExprId,
        operand: ExprId,
        is_in_place: impl Fn(&Self) -> bool,
    ) {
        self.note_in_place(operator, operand, false, is_in_place);
    }

    fn note_in_place(
        &mut self,
        e: ExprId,
        node: ExprId,
        is_read_by_build: bool,
        is_in_place: impl Fn(&Self) -> bool,
    ) {
        let seen_if_in_place = |folder: &Self| match is_in_place(folder) {
            true => folder.seen_by_bun_run(node),
            false => ExprId::NONE,
        };
        let in_bun_run = seen_if_in_place(self);
        let under_minify_syntax = match self.inputs.minifies_syntax {
            true => in_bun_run,
            false => self.holds_under_minify_syntax(seen_if_in_place),
        };
        if !is_read_by_build && under_minify_syntax.is_none() && in_bun_run.is_none() {
            return;
        }
        let in_place = InPlace {
            node,
            for_build: self.find_in_place(node),
            in_bun_run,
            under_minify_syntax,
        };
        self.seen_by_bun_run.0.insert(e, in_place);
    }
}
