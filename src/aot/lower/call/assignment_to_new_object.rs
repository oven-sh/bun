use bun_sema::hir::{Call, ExprId, ExprKind};
use smallvec::SmallVec;

use crate::builtins::id::BuiltinId;
use crate::ir::ValueId;
use crate::lower::FunctionLowering;
use crate::lower::expression::Tail;

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn lower_assignment_to_new_object(
        &mut self,
        call: ExprId,
        site: Call,
        tail: Tail<'_>,
    ) -> Option<ValueId> {
        let hir = self.file.hir;
        let arguments: SmallVec<[ExprId; 4]> = hir.ids(site.args).collect();
        let (&target, sources) = arguments.split_first()?;
        let &first = sources.first()?;
        let is_spread = |&argument: &ExprId| matches!(hir[argument].kind, ExprKind::Spread(_));
        let is_empty_literal =
            matches!(hir[target].kind, ExprKind::Object(properties) if properties.is_empty());
        if !is_empty_literal
            || arguments.iter().any(is_spread)
            || !self.file.has_names_known_only_at_run_time(first)
        {
            return None;
        }

        self.emit_locked_builtin(BuiltinId::ObjectAssign);
        let mut written: SmallVec<[ValueId; 4]> = SmallVec::new();
        written.push(self.builder.undefined());
        for &source in sources {
            written.push(self.lower_expression(source));
        }
        self.convert_arguments(call, &mut written);
        let outer = self
            .builder
            .set_tail_position(matches!(tail, Tail::Yes { .. }));
        self.set_position(self.file.call_position(site));
        let made = if let &[_, only] = written.as_slice() {
            self.builder.copy_object(only, &[], &[], true)
        } else {
            written[0] = self.builder.new_dictionary();
            self.emit_builtin_call(BuiltinId::ObjectAssign, &written)
        };
        self.builder.set_tail_position(outer);
        self.set_position(hir[call].pos);
        Some(self.claim_call_result(call, made))
    }
}
