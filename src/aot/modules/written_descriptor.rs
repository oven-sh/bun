use bun_sema::atom::Interner;
use bun_sema::fold::{Constant, Decisions, FoldedValue};
use bun_sema::hir::{ExprId, ExprKind, File, PropKey, PropKind};

#[cfg(test)]
mod tests;

/// What ToPropertyDescriptor reads from an object literal. A flag is `None` where the literal does not name it.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct WrittenDescriptor {
    pub(crate) part: DescribedPart,
    pub(crate) is_enumerable: Option<bool>,
    pub(crate) is_configurable: Option<bool>,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum DescribedPart {
    Data {
        value: Option<ExprId>,
        is_writable: Option<bool>,
    },
    Accessor {
        getter: Option<ExprId>,
        setter: Option<ExprId>,
    },
}

impl WrittenDescriptor {
    /// `None`: the text does not say what the built-in reads, or the built-in throws.
    /// Otherwise nothing in the literal but `value`, `get` and `set` is more than a constant, and each of the three is written once at most.
    pub(crate) fn read(
        atoms: &Interner<'_>,
        hir: &File<'_>,
        decisions: &Decisions<'_>,
        descriptor: ExprId,
    ) -> Option<WrittenDescriptor> {
        let ExprKind::Object(properties) = hir[hir.skip_type_assertions(descriptor)].kind else {
            return None;
        };
        let flag = |value: ExprId| match decisions.constant(hir, hir.skip_type_assertions(value)) {
            FoldedValue::Constant(Constant::Boolean(flag)) => Some(flag),
            FoldedValue::Constant(Constant::Undefined | Constant::Null) => Some(false),
            FoldedValue::Constant(
                Constant::Number(_) | Constant::String(_) | Constant::BigInt(_),
            )
            | FoldedValue::ConstantOutsideDeadZone(_)
            | FoldedValue::Unknown => None,
        };
        let [mut value, mut getter, mut setter] = [None; 3];
        let [mut is_writable, mut is_enumerable, mut is_configurable] = [None; 3];
        for property in properties.iter().map(|property| hir[property]) {
            let PropKey::Name(name) = property.key else {
                return None;
            };
            match property.kind {
                PropKind::Init | PropKind::Shorthand | PropKind::Method => {}
                PropKind::Spread | PropKind::Getter | PropKind::Setter => return None,
            }
            let part = match atoms.bytes(name) {
                b"value" => &mut value,
                b"get" => &mut getter,
                b"set" => &mut setter,
                b"writable" => {
                    is_writable = Some(flag(property.value)?);
                    continue;
                }
                b"enumerable" => {
                    is_enumerable = Some(flag(property.value)?);
                    continue;
                }
                b"configurable" => {
                    is_configurable = Some(flag(property.value)?);
                    continue;
                }
                _ => return None,
            };
            if part.replace(property.value).is_some() {
                return None;
            }
        }
        let is_data = value.is_some() || is_writable.is_some();
        let is_accessor = getter.is_some() || setter.is_some();
        let part = match (is_accessor, is_data) {
            (true, true) => return None,
            (true, false) => DescribedPart::Accessor { getter, setter },
            (false, true | false) => DescribedPart::Data { value, is_writable },
        };
        Some(WrittenDescriptor {
            part,
            is_enumerable,
            is_configurable,
        })
    }
}
