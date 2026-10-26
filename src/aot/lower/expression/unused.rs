use bun_sema::fold::Constant;
use bun_sema::hir::{BinOp, ExprId, ExprKind, PropId, PropKey, PropKind, Span, UnOp};
use smallvec::SmallVec;

use crate::builtins::{BuiltinId, Resolved, table};
use crate::compile::removable::is_read_left_out_by_bun_run;
use crate::lower::expression::find_constant;
use crate::lower::{FileLowering, FunctionLowering, operator};

impl FileLowering<'_, '_, '_, '_> {
    pub(super) fn is_read_left_out_by_bun_run(&self, expression: ExprId) -> bool {
        match self.builtins.of_expr(self.skip_type_syntax(expression)) {
            Some(Resolved::Builtin(path)) => is_read_left_out_by_bun_run(path.id),
            Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => false,
        }
    }

    // `"name" in object`, where the table has the member: the host looks for a member as it reads one.
    pub(super) fn find_member_looked_for(&self, expression: ExprId) -> Option<BuiltinId> {
        let ExprKind::Binary {
            op: BinOp::In,
            left,
            right,
        } = self.hir[expression].kind
        else {
            return None;
        };
        let Constant::String(name) = find_constant(self, left)? else {
            return None;
        };
        let Some(Resolved::Builtin(holder)) = self.builtins.of_expr(self.skip_type_syntax(right))
        else {
            return None;
        };
        let name = table::find_name(self.queries.atom_bytes(name))?;
        let member = table::own_member(table::canonical_id(holder.id), name)?;
        table::is_legal_builtin_constant(member).then_some(member)
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    // What is left of an expression whose value the build knows: the members of built-in objects that it reads, in the order in which it reads them.
    pub(in crate::lower) fn lower_member_reads(&mut self, expression: ExprId) {
        let hir = self.file.hir;
        let decisions = self.file.decisions();
        if expression.is_none()
            || decisions.is_dead_expr(expression)
            || !decisions.reads_member(expression)
            || !self.enter_nesting(hir[expression].pos)
        {
            return;
        }
        match hir[expression].kind {
            ExprKind::Unary {
                op: UnOp::Void,
                operand,
            } => self.lower_expression_for_effect(operand),
            ExprKind::Binary {
                op: BinOp::Comma,
                left,
                right,
            } => {
                self.lower_expression_for_effect(left);
                self.lower_member_reads(right);
            }
            ExprKind::Binary { op: BinOp::In, .. } => {
                match self.file.find_member_looked_for(expression) {
                    Some(member) => self.emit_locked_builtin(member),
                    None => operator::lower_binary(self, expression),
                };
            }
            ExprKind::Unary { operand, .. }
            | ExprKind::As { expr: operand, .. }
            | ExprKind::Satisfies { expr: operand, .. }
            | ExprKind::AsConst(operand)
            | ExprKind::NonNull(operand)
            | ExprKind::Instantiation { expr: operand, .. } => self.lower_member_reads(operand),
            ExprKind::Binary { left, right, .. } => {
                self.lower_member_reads(left);
                self.lower_member_reads(right);
            }
            ExprKind::Cond { test, branches } => {
                let branches = hir.branches(branches);
                self.lower_member_reads(test);
                self.lower_member_reads(branches.yes);
                self.lower_member_reads(branches.no);
            }
            _ => {
                if let Some(Resolved::Builtin(path)) = self.file.builtins.of_expr(expression)
                    && path.locked_builtin().is_some()
                {
                    self.emit_locked_builtin(path.id);
                }
            }
        }
        self.leave_nesting();
    }

    fn lower_properties_for_effect(&mut self, properties: Span<PropId>) {
        let hir = self.file.hir;
        for property in properties.iter() {
            // Bun's transpiler prints `key + ""` for the key.
            if let PropKey::Computed(key) = hir[property].key {
                let position = self.file.first_position(key);
                let key = self.lower_expression(key);
                self.set_position(position);
                self.builder.to_property_key(key);
            }
            match hir[property].kind {
                PropKind::Init | PropKind::Shorthand => {
                    self.lower_expression_for_effect(hir[property].value);
                }
                PropKind::Method | PropKind::Getter | PropKind::Setter => {}
                PropKind::Spread => {
                    unreachable!("an object with a spread is made as it is written")
                }
            }
        }
    }

    // What is evaluated of an expression that `Removable::find_simplified_expressions` lists.
    pub(super) fn lower_simplified_expression(&mut self, expression: ExprId) {
        let hir = self.file.hir;
        let mut parts: SmallVec<[ExprId; 4]> = SmallVec::new();
        match hir[expression].kind {
            ExprKind::Cond { test, .. } => parts.push(test),
            ExprKind::Unary { operand, .. } => parts.push(operand),
            ExprKind::Binary { op, left, right } => match op {
                BinOp::And | BinOp::Or | BinOp::Nullish => parts.push(left),
                _ => parts.extend([left, right]),
            },
            ExprKind::Call(site) | ExprKind::New(site) => parts.extend(hir.ids(hir[site].args)),
            ExprKind::Array(items) => parts.extend(hir.ids(items)),
            ExprKind::Object(properties) => return self.lower_properties_for_effect(properties),
            ExprKind::Jsx(_) => return self.lower_element_parts_for_effect(expression),
            _ => unreachable!("no part of such an expression is left out"),
        }
        for part in parts {
            self.lower_expression_for_effect(part);
        }
    }
}
