use bun_sema::hir::{BinOp, ExprId, ExprKind, PropId, PropKey, PropKind, Span};
use smallvec::SmallVec;

use crate::lower::FunctionLowering;

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn lower_properties_for_effect(&mut self, properties: Span<PropId>) {
        let hir = self.file.hir;
        for property in properties.iter() {
            if let PropKey::Computed(key) = hir[property].key {
                let key = self.lower_expression(key);
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
