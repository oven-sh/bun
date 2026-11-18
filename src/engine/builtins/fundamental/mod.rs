//! `Object`, `Reflect`, `Proxy`, `Symbol` and `Boolean`.

mod boolean;
mod object_constructor;
pub(crate) mod object_prototype;
mod proxy;
mod reflect;
mod symbol;

use bun_engine_vm::{
    ClonedArguments, MappedArguments, PropertyCondition, PropertyDescriptor, ProxyObject,
    RealmSlot, RealmWatchpoint,
};

use crate::prelude::*;
use crate::watchpoints::Conditions;

pub(crate) fn initialize_slot(cx: &Cx, slot: RealmSlot) -> bool {
    use RealmSlot::*;
    match slot {
        object_constructor => self::object_constructor::initialize(cx),
        object_prototype_has_own_property => {
            self::object_prototype::initialize_has_own_property(cx)
        }
        object_prototype_to_string => self::object_prototype::initialize_to_string(cx),
        object_prototype_value_of => self::object_prototype::initialize_value_of(cx),
        data_descriptor_shape | accessor_descriptor_shape => PropertyDescriptor::create_shapes(cx),
        direct_arguments_shape | scoped_arguments_shape => MappedArguments::create_shapes(cx),
        cloned_arguments_shape => {
            (cx.global()).init_cloned_arguments_shape(ClonedArguments::create_shape(cx));
        }
        reflect_object => reflect::initialize(cx),
        reflect_construct => reflect::initialize_construct(cx),
        proxy_constructor => proxy::initialize(cx),
        proxy_shape | callable_proxy_shape => ProxyObject::create_shapes(cx),
        private_validate_proxy_get
        | private_validate_proxy_has
        | private_validate_proxy_set
        | private_throw_falsy_proxy_set => proxy::initialize_helpers(cx),
        revocable_proxy_shape => proxy::initialize_revocable_shape(cx),
        symbol_prototype | symbol_constructor | symbol_object_shape => symbol::initialize(cx),
        boolean_prototype | boolean_constructor | boolean_object_shape => boolean::initialize(cx),
        _ => return false,
    }
    true
}

pub(crate) fn add_conditions(
    cx: &Cx,
    which: RealmWatchpoint,
    conditions: &mut Conditions<'_>,
) -> bool {
    let prototype = cx.object_prototype();
    match which {
        RealmWatchpoint::ObjectPrototypeChainIsSane => {
            conditions.no_elements(&prototype, Value::NULL);
        }
        RealmWatchpoint::PropertyDescriptorFields => {
            use names::{configurable, enumerable, get, set, value, writable};
            for name in [enumerable, configurable, value, writable, get, set] {
                conditions.add(&prototype, || PropertyCondition::absence(&prototype, name));
            }
        }
        _ => return false,
    }
    true
}
