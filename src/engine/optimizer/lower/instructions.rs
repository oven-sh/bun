//! What becomes of the nodes for operators, iteration and the like.

use bun_engine_codegen::ir::{Type, Value as Ssa};
use bun_engine_vm::TypeFlags;

use super::Lowering;
use crate::builder::{Built, Refusal};
use crate::graph::Kind;
use crate::runtime::operations::iteration::{
    CAN_ITERATE_BY_INDEX, CODE_POINT_STRING, GET_INDEX, HAS_OWN_NAME, NEXT_NAME,
};
use crate::runtime::operations::objects::HAS_INSTANCE;
use crate::runtime::operations::suspension::{
    ASYNC_RETURN, ASYNC_THROW, CREATE_ASYNC_GENERATOR, CREATE_GENERATOR, REQUEST_STEP,
};
use crate::runtime::operators::{BIGINT_ORDER, DOUBLE_TO_STRING, IS_CONSTRUCTOR, STRING_ORDER};

impl Lowering<'_> {
    pub(super) fn compute_for_operator(
        &mut self,
        kind: Kind,
        data: u32,
        first: Ssa,
        second: Ssa,
    ) -> Built<Ssa> {
        Ok(match kind {
            Kind::IsCallable => self.is_callable(first, self.graph.type_check_at(data)),
            Kind::IsConstructor => self.call_leaf(IS_CONSTRUCTOR, &[first], Type::I32),
            Kind::HasObjectTypeName => {
                self.has_object_type_name(first, self.graph.type_check_at(data))
            }
            Kind::PlainToBoolean => self.plain_to_boolean(first, self.graph.type_check_at(data)),
            Kind::PlainTypeof => self.plain_typeof(first, self.graph.type_check_at(data)),
            Kind::GenericEqualNull => self.generic_equal_null(first),
            Kind::GenericToBoolean => self.generic_to_boolean(first),
            Kind::GenericTypeof => self.generic_typeof(first),
            Kind::StringEqual => self.string_equal(first, second),
            Kind::AtomEqual => self.atom_equal(first, second),
            Kind::EqualsAtom => self.equals_atom(first, second, self.graph.type_check_at(data)),
            Kind::StringOrder => self.call_operation(STRING_ORDER, &[first, second]),
            Kind::BigIntOrder => self.call_leaf(BIGINT_ORDER, &[first, second], Type::I32),
            Kind::CompareWithUnit => self.compare_with_unit(data, first, second),
            Kind::PrimitiveCompare | Kind::GenericCompare => self.compare(data, first, second),
            Kind::QuietLooseEqual | Kind::GenericLooseEqual => {
                self.loose_equal(data, first, second)
            }
            Kind::GenericStrictEqual => self.strict_equal(data, first, second),
            Kind::Int32ToString => self.int32_to_string(first),
            Kind::DoubleToString => self.call_operation(DOUBLE_TO_STRING, &[first]),
            Kind::PrimitiveToString => {
                self.primitive_to_string(first, self.graph.type_check_at(data))
            }
            Kind::BigIntOperator => self.bigint_operator(data),
            Kind::PrimitiveOperator | Kind::GenericOperator => self.operator(data),
            Kind::OnlyUnit => self.only_unit(first, self.graph.type_check_at(data)),
            Kind::ExistingAtom => self.existing_atom(first, self.graph.type_check_at(data)),
            Kind::ExactInt32 => self.exact_int32(first, self.graph.type_check_at(data)),
            Kind::Convert => self.convert(first, data),
            Kind::ToObject => self.to_object(first, second),
            Kind::ToThis => self.to_this(first, second),
            Kind::NewInstance => self.allocate_object(data),
            Kind::CreateThis => self.create_this(first, data),
            Kind::LoadPrototype => self.load_prototype(first),
            Kind::InheritsFrom => self.inherits_from(first, second),
            Kind::GenericGetPrototypeOf => self.generic_get_prototype_of(first),
            Kind::CustomHasInstance => self.call_operation(HAS_INSTANCE, &self.operands()),
            Kind::HasTypeFlag => self.has_flag(first, TypeFlags::from_bits_retain(data)),
            Kind::LoadShape => self.shape_of(first),
            Kind::KeptNames => self.kept_names(first, data as usize),
            Kind::Concatenate => self.concatenate(data),
            Kind::GetIndex => self.call_operation(GET_INDEX, &[first, second]),
            Kind::CodePointString => self.call_operation(CODE_POINT_STRING, &[first, second]),
            Kind::NextEntry => self.next_entry(first, second, data != 0),
            Kind::CanIterateByIndex => self.call_quietly(CAN_ITERATE_BY_INDEX, &[first], Type::I32),
            Kind::InheritsArrayIteration => self.inherits_array_iteration(first, second),
            Kind::GetEnumerator => self.get_enumerator(first),
            Kind::NextName => self.call_operation_for_pair(NEXT_NAME, &self.operands()),
            Kind::HasOwnName => self.call_operation(HAS_OWN_NAME, &self.operands()),
            Kind::CreateGenerator if data == 0 => self.call_operation(CREATE_GENERATOR, &[first]),
            Kind::CreateGenerator => self.call_operation(CREATE_ASYNC_GENERATOR, &[first]),
            Kind::AsyncReturn => self.call_operation(ASYNC_RETURN, &[first, second]),
            Kind::AsyncThrow => self.call_operation(ASYNC_THROW, &[first, second]),
            Kind::RequestStep => self.call_operation(REQUEST_STEP, &self.operands()),
            Kind::ResumeGenerator => self.call(kind),
            // In a cycle that specializing has not found its way into.
            _ => return Err(Refusal::Unsupported),
        })
    }
}
