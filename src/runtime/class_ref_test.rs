//! The bodies of class_ref_test.bind.ts.

use bun_jsc::bindgen::{self, Callable, JsLocal, JsScope};

use crate::generated_bindgen::class_ref_test::{AddressOrAnything, AddressOrList};
use crate::socket::SocketAddress;

pub(crate) fn port_of(address: &SocketAddress) -> u16 {
    address.port()
}

pub(crate) fn port_of_or_null(address: Option<&SocketAddress>) -> Option<u16> {
    address.map(SocketAddress::port)
}

pub(crate) fn port_after_callback<'a>(
    cx: &mut JsScope<'a>,
    address: &'a SocketAddress,
    callback: JsLocal<'a, Callable>,
) -> bindgen::Result<'a, u16> {
    callback.call(cx, JsLocal::UNDEFINED, &[])?;
    Ok(address.port())
}

pub(crate) fn describe_address_or_list(value: AddressOrList<'_>) -> &'static str {
    match value {
        AddressOrList::Address(_) => "address",
        AddressOrList::List(_) => "list",
    }
}

pub(crate) fn is_address(value: AddressOrAnything<'_>) -> bool {
    matches!(value, AddressOrAnything::Address(_))
}

pub(crate) fn port_plus_number(address: &SocketAddress, more: u16) -> u32 {
    u32::from(address.port()) + u32::from(more)
}

pub(crate) fn port_plus_length(address: &SocketAddress, more: &[u8]) -> u32 {
    u32::from(address.port()) + more.len() as u32
}
