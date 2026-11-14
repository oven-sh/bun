use bun_sema::hir::{BinOp, Call, ExprId, ExprKind};
use smallvec::SmallVec;

use crate::builtins::id::BuiltinId;
use crate::ir::ValueId;
use crate::lower::FunctionLowering;
use crate::lower::expression::Tail;

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn lower_assignment_to_new_object(
        &mut self,
        call: ExprId,
        site: Call,
        tail: Tail<'_>,
    ) -> Option<ValueId> {
        let hir = self.file.hir;
        let sources = self.find_empty_literal_sources(site)?;

        self.emit_locked_builtin(BuiltinId::ObjectAssign);
        let mut written: SmallVec<[ValueId; 4]> = SmallVec::new();
        written.push(self.builder.undefined());
        for source in sources {
            written.push(self.lower_expression(source));
        }
        self.convert_arguments(call, &mut written);
        let is_tail = matches!(tail, Tail::Yes { .. });
        self.set_position(self.file.call_position(site));
        let made = self.emit_assignment_to_new_object(&written[1..], is_tail);
        self.set_position(hir[call].pos);
        Some(self.claim_call_result(call, made))
    }

    /// `__assign({}, source)`, where `__assign` is most likely `Object.assign` by then.
    pub(super) fn lower_call_of_assign_helper(
        &mut self,
        call: ExprId,
        site: Call,
    ) -> Option<ValueId> {
        let hir = self.file.hir;
        let target = hir.ids(site.args).next()?;
        let is_empty_literal =
            matches!(hir[target].kind, ExprKind::Object(properties) if properties.is_empty());
        if !is_empty_literal || !self.names_assign_helper(site.callee) {
            return None;
        }
        self.find_empty_literal_sources(site)?;
        let lowered = self.lower_call_operands(call, site);
        self.guard_builtin(
            lowered.callee.function,
            BuiltinId::ObjectAssign,
            lowered.slow_path,
        );
        let sources: SmallVec<[ValueId; 4]> = lowered.arguments[1..].into();
        let made = self.emit_assignment_to_new_object(&sources, false);
        let made = self.claim_call_result(call, made);
        Some(self.finish_with_slow_path(lowered, made))
    }

    fn names_assign_helper(&self, callee: ExprId) -> bool {
        let hir = self.file.hir;
        let callee = self.file.skip_type_syntax(callee);
        match hir[callee].kind {
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => self.names_assign_helper(right),
            ExprKind::Dot { name, .. } => self.file.queries.atom_bytes(name) == b"__assign",
            ExprKind::Ident(name) => matches!(
                self.file.queries.atom_bytes(name),
                b"__assign" | b"assign" | b"_assign" | b"objectAssign" | b"_objectAssign"
            ),
            _ => false,
        }
    }

    fn find_empty_literal_sources(&mut self, site: Call) -> Option<SmallVec<[ExprId; 4]>> {
        let hir = self.file.hir;
        let mut arguments = hir.ids(site.args);
        let target = arguments.next()?;
        let sources: SmallVec<[ExprId; 4]> = arguments.collect();
        let &first = sources.first()?;
        let is_spread = |&argument: &ExprId| matches!(hir[argument].kind, ExprKind::Spread(_));
        let is_empty_literal =
            matches!(hir[target].kind, ExprKind::Object(properties) if properties.is_empty());
        (is_empty_literal
            && !sources.iter().any(is_spread)
            && self.file.has_names_known_only_at_run_time(first))
        .then_some(sources)
    }

    /// Copies the first source and assigns the others to the copy.
    fn emit_assignment_to_new_object(&mut self, sources: &[ValueId], is_tail: bool) -> ValueId {
        let outer = self
            .builder
            .set_tail_position(is_tail && sources.len() == 1);
        let mut made = self.builder.copy_object(sources[0], &[], &[], true);
        if sources.len() > 1 {
            let mut written: SmallVec<[ValueId; 4]> = sources.into();
            written[0] = made;
            self.builder.set_tail_position(is_tail);
            made = self.emit_builtin_call(BuiltinId::ObjectAssign, &written);
        }
        self.builder.set_tail_position(outer);
        made
    }
}
