use bun_sema::atom::Atom;
use bun_sema::fold::Decision;
use bun_sema::hir::{Chain, ExprId, ExprKind, MemberKey};

use super::PropertyName;
use crate::ir::generated::{NullishAccess, RuntimeErrorKind};
use crate::ir::{TypeTable, ValueId, VariableId};
use crate::lower::scope::{self, IdentifierTarget};
use crate::lower::{FunctionLowering, commonjs, expression};

pub(in crate::lower) enum Reference {
    Identifier {
        target: IdentifierTarget,
        identifier: ExprId,
    },
    FreeName(Atom),
    Property {
        object: ValueId,
        name: PropertyName,
        access: Option<ExprId>,
    },
    Super {
        base: ValueId,
        name: PropertyName,
    },
    Private {
        object: ValueId,
        access: ExprId,
    },
    // What a module has under a name, or `module.exports`.
    ModuleVariable {
        variable: VariableId,
        holder: Option<ValueId>,
    },
    // Nobody can see what is stored there.
    Discarded {
        holder: Option<ValueId>,
    },
    Invalid,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) enum KeyConversion {
    AtAccess,
    Once,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn lower_reference(
        &mut self,
        target: ExprId,
        conversion: KeyConversion,
    ) -> Reference {
        let hir = self.file.hir;
        let target = self.file.skip_type_syntax(target);
        self.set_position(hir[target].pos);
        match hir[target].kind {
            ExprKind::Ident(_) => match self.file.decisions().decision(target) {
                Decision::GlobalPath(path) => {
                    let member = self.lower_global_path_holder(path);
                    match member.holder {
                        Some(object) => Reference::Property {
                            object,
                            name: PropertyName::Constant(self.file.atom_key(member.name)),
                            access: None,
                        },
                        None => Reference::FreeName(member.name),
                    }
                }
                Decision::Unknown
                | Decision::Constant(_)
                | Decision::Data(_)
                | Decision::DeferredData => Reference::Identifier {
                    target: self.resolve_identifier_target(target),
                    identifier: target,
                },
            },
            ExprKind::Dot {
                chain: Chain::No, ..
            }
            | ExprKind::Index {
                chain: Chain::No, ..
            } => lower_member_reference(self, target, conversion),
            ExprKind::Missing
            | ExprKind::PrivateIdentifier(_)
            | ExprKind::This
            | ExprKind::Super
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex { .. }
            | ExprKind::Template { .. }
            | ExprKind::TaggedTemplate(_)
            | ExprKind::Array(_)
            | ExprKind::Object(_)
            | ExprKind::Fn(_)
            | ExprKind::Class(_)
            | ExprKind::Dot {
                chain: Chain::Start | Chain::Continue,
                ..
            }
            | ExprKind::Index {
                chain: Chain::Start | Chain::Continue,
                ..
            }
            | ExprKind::Call(_)
            | ExprKind::New(_)
            | ExprKind::Unary { .. }
            | ExprKind::Binary { .. }
            | ExprKind::Assign { .. }
            | ExprKind::Cond { .. }
            | ExprKind::Spread(_)
            | ExprKind::Await(_)
            | ExprKind::Yield { .. }
            | ExprKind::As { .. }
            | ExprKind::Satisfies { .. }
            | ExprKind::AsConst(_)
            | ExprKind::NonNull(_)
            | ExprKind::Instantiation { .. }
            | ExprKind::Jsx(_)
            | ExprKind::ImportCall { .. }
            | ExprKind::ImportMeta
            | ExprKind::NewTarget(_)
            | ExprKind::JsxText(_) => {
                self.lower_expression_for_effect(target);
                self.set_position(hir[target].pos);
                self.emit_throw_runtime_error(RuntimeErrorKind::UnresolvableReference, None);
                Reference::Invalid
            }
        }
    }

    fn convert_key(
        &mut self,
        object: ValueId,
        name: PropertyName,
        conversion: KeyConversion,
    ) -> PropertyName {
        let key = match (conversion, name) {
            (KeyConversion::AtAccess, _) | (KeyConversion::Once, PropertyName::Constant(_)) => {
                return name;
            }
            (KeyConversion::Once, PropertyName::Computed(key)) => key,
        };
        let result = self.builder.create_variable(None);
        let join = self.create_block();
        let split = self.split_on_type(key, TypeTable::OBJECT);

        self.builder.switch_to(split.taken);
        self.builder
            .require_object_coercible(object, NullishAccess::Read, None);
        let converted = self.builder.to_property_key(split.taken_value);
        self.builder.write_variable(result, converted);
        self.jump(join);

        self.builder.switch_to(split.not_taken);
        self.builder.write_variable(result, split.not_taken_value);
        self.jump(join);

        self.continue_in(join);
        PropertyName::Computed(self.builder.read_variable(result))
    }

    pub(in crate::lower) fn get_reference(&mut self, reference: &Reference) -> ValueId {
        match *reference {
            Reference::Identifier { ref target, .. } => self.get_identifier_target(target),
            Reference::FreeName(name) => self.emit_free_name_get(name, false),
            Reference::Property {
                object,
                name,
                access,
            } => match access {
                Some(access) => super::emit_member_read(self, access, object, name),
                None => self.emit_get(object, name),
            },
            Reference::Super { base, name } => {
                let receiver = self.get_this();
                let (computed_key, key) = name.key_operands();
                self.builder.super_get(base, receiver, computed_key, key)
            }
            Reference::Private { object, access } => self.emit_private_get(object, access),
            Reference::ModuleVariable { variable, holder } => {
                self.test_holder(holder, NullishAccess::Read);
                self.builder.get_module_variable(variable)
            }
            Reference::Discarded { holder } => {
                self.test_holder(holder, NullishAccess::Read);
                self.builder.undefined()
            }
            Reference::Invalid => self.builder.undefined(),
        }
    }

    pub(in crate::lower) fn put_reference(
        &mut self,
        reference: &Reference,
        value: ValueId,
        source: Option<ExprId>,
    ) -> ValueId {
        match *reference {
            Reference::Identifier {
                ref target,
                identifier,
            } => {
                self.set_identifier_target(target, value, source);
                if scope::find_tested_local(self, identifier).is_some() {
                    return self.lower_identifier(identifier);
                }
            }
            Reference::FreeName(name) => self.emit_free_name_set(name, value),
            Reference::Property {
                object,
                name,
                access: Some(access),
            } => {
                let converted = self.convert_to_member(access, value, source);
                self.emit_set(object, name, converted);
                return converted;
            }
            Reference::Property {
                object,
                name,
                access: None,
            } => self.emit_set(object, name, value),
            Reference::Super { base, name } => {
                let receiver = self.get_this();
                let (computed_key, key) = name.key_operands();
                let mode = self.mode();
                self.builder
                    .super_set(mode, base, receiver, value, computed_key, key);
            }
            Reference::Private { object, access } => {
                self.emit_private_set(object, access, value, source);
            }
            Reference::ModuleVariable { variable, holder } => {
                self.test_holder(holder, NullishAccess::Write);
                self.builder.put_module_variable(variable, value);
            }
            Reference::Discarded { holder } => self.test_holder(holder, NullishAccess::Write),
            Reference::Invalid => {}
        }
        value
    }
}

fn lower_member_reference(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    target: ExprId,
    conversion: KeyConversion,
) -> Reference {
    let hir = lowering.file.hir;
    let Some((object, member)) = hir.member_key(target) else {
        unreachable!("lower_member_reference takes a Dot or an Index expression");
    };
    if matches!(member, MemberKey::PrivateName(_)) {
        let object = lowering.lower_expression(object);
        return Reference::Private {
            object,
            access: target,
        };
    }
    if let Some(reference) = commonjs::lower_export_reference(lowering, target) {
        lowering.set_position(hir[target].pos);
        return reference;
    }
    let conversion = match member {
        MemberKey::Name(_) | MemberKey::PrivateName(_) => KeyConversion::AtAccess,
        MemberKey::Computed(key) => match expression::find_constant(lowering.file, key) {
            Some(_) => KeyConversion::AtAccess,
            None => conversion,
        },
    };
    if matches!(hir[object].kind, ExprKind::Super) {
        let (home_kind, home) = lowering.get_home_object();
        let base = lowering.builder.get_super_base(home_kind, home);
        let name = lowering.lower_member_key(member);
        lowering.set_position(hir[target].pos);
        let name = lowering.convert_key(base, name, conversion);
        return Reference::Super { base, name };
    }
    let (object, name) = super::lower_member_operands(lowering, target, None);
    lowering.set_position(hir[target].pos);
    let name = lowering.convert_key(object, name, conversion);
    Reference::Property {
        object,
        name,
        access: Some(target),
    }
}
