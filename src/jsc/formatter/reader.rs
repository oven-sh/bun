//! The reads the console formatter makes on its own account. They run no user code.

use crate::{JSGlobalObject, JSPropertyIteratorOptions, JSType, JSValue, JsResult, ProxyField};

/// Mirrors `BunBuiltinNames::ReactField`.
#[repr(u8)]
#[derive(Clone, Copy)]
pub(super) enum Field {
    Typeof = 0,
    Type = 1,
    Key = 2,
    Props = 3,
    Children = 4,
}

/// An own data property of a React element. `None` for an accessor, an inherited property, `undefined`, a Proxy or a module namespace export.
pub(super) fn field(
    global: &JSGlobalObject,
    object: JSValue,
    field: Field,
) -> JsResult<Option<JSValue>> {
    let value = crate::cpp::Bun__FormatterReads__ownData(global, object, field as u8)?;
    Ok((value != JSValue::PROPERTY_DOES_NOT_EXIST && !value.is_undefined()).then_some(value))
}

/// `value.$$typeof`, which marks a React element.
pub(super) fn react_typeof(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<JSValue>> {
    field(global, value, Field::Typeof)
}

/// The innermost target of a chain of Proxies, or the first revoked Proxy in it. No trap runs.
pub(super) fn through_proxies(mut value: JSValue) -> JSValue {
    while value.is_cell() && value.js_type() == JSType::ProxyObject {
        let handler = value.get_proxy_internal_field(ProxyField::Handler);
        if handler.is_empty() || handler.is_undefined_or_null() {
            break;
        }
        value = value.get_proxy_internal_field(ProxyField::Target);
    }
    value
}

/// Whether the props listing gave an accessor (its `GetterSetter` cell) and not a value.
pub(super) fn is_accessor(value: JSValue) -> bool {
    value.is_cell()
        && matches!(
            value.js_type(),
            JSType::GetterSetter | JSType::CustomGetterSetter
        )
}

/// Lists the props of a React element: own names in order, an accessor as its `GetterSetter` cell.
pub(super) const PROPS: JSPropertyIteratorOptions = JSPropertyIteratorOptions {
    skip_empty_name: true,
    include_value: true,
    own_properties_only: true,
    observable: false,
    only_non_index_properties: false,
    include_symbols: false,
};
