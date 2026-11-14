use smallvec::SmallVec;

use super::Constant;
use super::evaluate::Value;
use super::folder::Folder;
use crate::bind::Binding;
use crate::hir::{Call, ExprId, ExprKind, UnOp};

#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum KnownConstruction {
    EmptyObject,
    ArrayOfArguments,
    Argument(ExprId),
    LeftOutWhereUnused,
}

impl KnownConstruction {
    pub(super) fn is_literal(self) -> bool {
        self != KnownConstruction::LeftOutWhereUnused
    }
}

impl Folder<'_, '_> {
    pub(super) fn find_known_construction(&self, call: Call) -> Option<KnownConstruction> {
        use KnownConstruction::{Argument, ArrayOfArguments, EmptyObject, LeftOutWhereUnused};
        let hir = self.hir;
        let callee = hir.skip_type_assertions(call.callee);
        let ExprKind::Ident(name) = hir[callee].kind else {
            return None;
        };
        if self.bound.static_binding(callee) != Some(Binding::Free) {
            return None;
        }
        let arguments = hir.ids(call.args).map(|it| hir.skip_type_assertions(it));
        let arguments: SmallVec<[ExprId; 2]> = arguments.collect();
        let items_of = |e: ExprId| match hir[e].kind {
            ExprKind::Array(items) => Some(items),
            _ => None,
        };
        let is_object_or_array =
            |e: ExprId| matches!(hir[e].kind, ExprKind::Object(_) | ExprKind::Array(_));
        let is_nullish = |e: ExprId| {
            matches!(
                self.find_literal_of_bun_run(e),
                Some(Constant::Null | Constant::Undefined)
            )
        };
        let left_out_if = |is_left_out: bool| is_left_out.then_some(LeftOutWhereUnused);
        match (self.atoms.bytes(name), &arguments[..]) {
            (b"Object", []) => Some(EmptyObject),
            (b"Object", &[only]) if is_object_or_array(only) => Some(Argument(only)),
            (b"Object", &[only]) if is_nullish(only) => Some(EmptyObject),
            (b"Array", []) => Some(ArrayOfArguments),
            (b"Array", &[only]) => {
                let is_no_number = is_object_or_array(only)
                    || matches!(self.find_kind_of_primitive(only), Some(kind) if kind != Kind::Number);
                is_no_number.then_some(ArrayOfArguments)
            }
            (b"Array", many) => {
                let has_spread = many
                    .iter()
                    .any(|&it| matches!(hir[it].kind, ExprKind::Spread(_)));
                (!has_spread).then_some(ArrayOfArguments)
            }
            (
                b"Set" | b"Map" | b"WeakSet" | b"WeakMap" | b"Date" | b"Headers" | b"Response"
                | b"TextEncoder" | b"TextDecoder",
                [],
            ) => Some(LeftOutWhereUnused),
            (b"Set" | b"Map" | b"WeakSet" | b"WeakMap", &[only]) if is_nullish(only) => {
                Some(LeftOutWhereUnused)
            }
            (b"Set", &[only]) => left_out_if(items_of(only).is_some()),
            (b"Map", &[only]) => left_out_if(items_of(only).is_some_and(|items| {
                hir.ids(items)
                    .all(|entry| items_of(hir.skip_type_assertions(entry)).is_some())
            })),
            (b"WeakSet" | b"WeakMap", &[only]) => {
                left_out_if(items_of(only).is_some_and(|items| items.is_empty()))
            }
            (b"Date" | b"Response", &[only]) => left_out_if(
                matches!(self.find_kind_of_primitive(only), Some(kind) if kind != Kind::BigInt),
            ),
            _ => None,
        }
    }

    fn find_literal_of_bun_run(&self, e: ExprId) -> Option<Constant> {
        match self.folded(e).value {
            Value::Known(value) if self.is_literal_to_bun_run(e) => {
                Some(self.evaluator.to_constant(value))
            }
            _ => None,
        }
    }

    fn find_kind_of_primitive(&self, e: ExprId) -> Option<Kind> {
        if let Some(literal) = self.find_literal_of_bun_run(e) {
            return Some(match literal {
                Constant::Number(_) => Kind::Number,
                Constant::BigInt(_) => Kind::BigInt,
                Constant::Undefined
                | Constant::Null
                | Constant::Boolean(_)
                | Constant::String(_) => Kind::Other,
            });
        }
        match self.hir[e].kind {
            ExprKind::Template { .. } => Some(Kind::Other),
            ExprKind::Unary {
                op: UnOp::Typeof | UnOp::Not | UnOp::Void,
                ..
            } => Some(Kind::Other),
            _ => None,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Kind {
    Number,
    BigInt,
    Other,
}
