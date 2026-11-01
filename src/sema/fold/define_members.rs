use super::folder::{Folded, Folder};
use super::inputs::DefineValue;
use super::{Constant, Decision, literal_constant};
use crate::atom::{Atom, known};
use crate::hir::{Chain, ExprId, ExprKind, MemberKey};
use crate::hir_from_data::DataValue;

/// What the transpiler prints in place of a read of a member of an object or array define: `CONFIG.a` with `CONFIG` defined as `{"a": 1}`.
#[derive(Copy, Clone)]
pub(super) struct DefineMember<'s> {
    pub(super) value: DefineValue<'s>,
    /// `--define` or bunfig.toml names the define, so `bun run` has the member in place of the read too.
    pub(super) is_user_defined: bool,
}

fn define_value_of<'s>(data: &'s DataValue<'s>) -> DefineValue<'s> {
    match Decision::of_data(data) {
        Decision::Constant(constant) => DefineValue::Constant(constant),
        _ => DefineValue::Data(data),
    }
}

/// `bun_js_parser::defines::own_member`
fn own_member<'s>(object: &'s DataValue<'s>, name: Atom) -> Option<DefineValue<'s>> {
    match *object {
        DataValue::Object(entries) if name != known::__proto__ => {
            let entry = entries.iter().rev().find(|entry| entry.0 == name)?;
            Some(define_value_of(&entry.1))
        }
        DataValue::Array(items) if name == known::length => {
            Some(DefineValue::Constant(Constant::Number(items.len() as f64)))
        }
        _ => None,
    }
}

/// `bun_js_parser::defines::own_item`
fn own_item<'s>(object: &'s DataValue<'s>, index: f64) -> Option<DefineValue<'s>> {
    let DataValue::Array(items) = *object else {
        return None;
    };
    let is_in_range = index >= 0.0 && index < items.len() as f64;
    (is_in_range && index % 1.0 == 0.0).then(|| define_value_of(&items[index as usize]))
}

impl<'s> Folder<'_, 's> {
    /// Nothing is stored or deleted there, and nothing is called with the object as `this`.
    fn is_plain_read(&self, access: ExprId) -> bool {
        if self.is_assignment_target(access) || self.is_delete_operand(access) {
            return false;
        }
        let outermost = self.find_outermost_cast(access);
        match self
            .parent_expr(outermost)
            .map(|parent| self.hir[parent].kind)
        {
            Some(ExprKind::Call(call) | ExprKind::TaggedTemplate(call)) => {
                self.hir[call].callee != outermost
            }
            _ => true,
        }
    }

    /// The value of an object or array define, or a member of one, that stands in place of `object`.
    fn find_define_with_members(&self, object: ExprId) -> Option<DefineMember<'s>> {
        let object = self.hir.skip_type_assertions(object);
        let define = match self.define_members.get(&object) {
            Some(&member) => member,
            None => {
                let &state = self.path_states.get(&object)?;
                DefineMember {
                    value: self.inputs.value_of(state)?,
                    is_user_defined: self.inputs.is_user_defined(state),
                }
            }
        };
        matches!(define.value, DefineValue::Data(_)).then_some(define)
    }

    /// The transpiler has the value of a define in place of the object, and reads the member out of that value where the value alone
    /// says what the read gives: the member is its own, the key is a name or a literal in the source, and nothing but a read is
    /// done with the member. `P::read_member_of_define` is that rule.
    pub(super) fn fold_define_member(
        &mut self,
        e: ExprId,
        object: ExprId,
        key: MemberKey,
        chain: Chain,
    ) -> Option<Folded> {
        let define = self.find_define_with_members(object)?;
        let DefineValue::Data(data) = define.value else {
            return None;
        };
        if chain != Chain::No || !self.is_plain_read(e) {
            return None;
        }
        let hir = self.hir;
        let value = match key {
            MemberKey::Name(name)
                if hir.is_name_resolved_by_transpiler(e, self.atoms.bytes(name)) =>
            {
                own_member(data, name)?
            }
            MemberKey::Computed(index) => match literal_constant(hir, hir[index].kind)? {
                Constant::Number(index) => own_item(data, index)?,
                _ => return None,
            },
            MemberKey::Name(_) | MemberKey::PrivateName(_) => return None,
        };
        let decision = match value {
            DefineValue::Constant(constant) => Decision::Constant(constant),
            DefineValue::Data(data) => Decision::Data(data),
            DefineValue::GlobalPath(_)
            | DefineValue::RuntimeValue(_)
            | DefineValue::RuntimeConstant(_) => return None,
        };
        if !define.is_user_defined {
            self.mark_folded_by_build_alone(e);
        }
        if let Decision::Data(_) = decision {
            self.conditions.insert(e, true);
        }
        self.define_members
            .insert(e, DefineMember { value, ..define });
        Some(self.decide(e, decision))
    }
}
