use super::folder::Folder;
use crate::hir::{BinOp, ExprId, ExprKind, File};
use crate::util::FxHashMap;

/// The node that the parser has where another is written. `ExprId::NONE`: the node stays as it is written.
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
    /// The node as written: what the parser asks before it puts anything in place (a `?.`, a key, `typeof` of a name).
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
            | ExprKind::Cond { .. }
            | ExprKind::New(_)
            | ExprKind::Unary { .. } => self.seen_by_bun_run.0.get(&e),
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

    /// Whether a question reads what stands at `e` by its kind: no name, call, read or value that says all of it.
    pub(super) fn is_read_by_shape(&self, e: ExprId) -> bool {
        !matches!(
            self.hir[self.find_in_place(e)].kind,
            ExprKind::Ident(_)
                | ExprKind::Call(_)
                | ExprKind::Dot { .. }
                | ExprKind::Index { .. }
                | ExprKind::Assign { .. }
                | ExprKind::This
                | ExprKind::Await(_)
                | ExprKind::Yield { .. }
                | ExprKind::Number(_)
                | ExprKind::True
                | ExprKind::False
                | ExprKind::Null
        )
    }

    /// `member` stands where `read` is written: for `bun run` where `is_in_place` holds, and for the build.
    pub(super) fn note_member_in_place(
        &mut self,
        read: ExprId,
        member: ExprId,
        is_in_place: impl Fn(&Self) -> bool,
    ) {
        self.note_in_place(read, member, |folder| is_in_place(folder).then_some(member));
    }

    /// `operand` stands where `operator` is written, for `bun run` where `is_in_place` holds: nothing else is left of it.
    pub(super) fn note_operand_in_place(
        &mut self,
        operator: ExprId,
        operand: ExprId,
        is_in_place: impl Fn(&Self) -> bool,
    ) {
        self.note_seen_in_place(operator, |folder| is_in_place(folder).then_some(operand));
    }

    /// What `find` gives stands where `e` is written, for `bun run` with the flags that it is asked under.
    pub(super) fn note_seen_in_place(&mut self, e: ExprId, find: impl Fn(&Self) -> Option<ExprId>) {
        self.note_in_place(e, ExprId::NONE, find);
    }

    fn note_in_place(
        &mut self,
        e: ExprId,
        read_by_build: ExprId,
        find: impl Fn(&Self) -> Option<ExprId>,
    ) {
        let seen = |folder: &Self| {
            let node = find(folder);
            (
                node,
                node.map_or(ExprId::NONE, |node| folder.seen_by_bun_run(node)),
            )
        };
        let (node, in_bun_run) = seen(self);
        let (node_under_minify_syntax, under_minify_syntax) = match self.inputs.minifies_syntax {
            true => (node, in_bun_run),
            false => self.holds_under_minify_syntax(seen),
        };
        let node = node.or(node_under_minify_syntax);
        let Some(node) = node.or_else(|| read_by_build.some()) else {
            return;
        };
        let read_by_build = read_by_build.some().or(node_under_minify_syntax);
        let in_place = InPlace {
            node,
            for_build: read_by_build.map_or(ExprId::NONE, |node| self.find_in_place(node)),
            in_bun_run,
            under_minify_syntax,
        };
        self.seen_by_bun_run.0.insert(e, in_place);
    }
}
