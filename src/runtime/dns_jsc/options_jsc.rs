//! `from_js`/`to_js` for `GetAddrInfo` and its nested option types, plus
//! `address_to_js`/`results_to_js`. The pure types stay in `src/dns/`.

use bun_jsc::{JSGlobalObject, JSValue, JsResult, StringJsc as _};

use bun_dns::OptionsFromJsError as FromJSError;
use bun_dns::address_to_string;
use bun_dns::{
    BACKEND_LABEL, Backend, FAMILY_MAP, Family, GetAddrInfoResult as GaiResult, Options,
    PROTOCOL_MAP, Protocol, SOCKET_TYPE_MAP, SocketType,
};

use crate::generated_bindgen::dns::{AddrInfoHint, LookupOptions};

pub(crate) fn options_from_js(value: &LookupOptions<'_>) -> Result<Options, FromJSError> {
    let mut options = Options::default();

    if let Some(family) = value.family {
        options.family = family_from_js(family)?;
    }

    if let Some(socktype) = value.socktype {
        options.socktype = socket_type_from_js(socktype)?;
    }

    if let Some(protocol) = value.protocol {
        options.protocol = protocol_from_js(protocol)?;
    }

    if let Some(backend) = value.backend {
        options.backend = backend_from_js(backend)?;
    }

    if let Some(flags) = value.flags {
        // Coerce to i32 and store/bit-test as u32.
        let flags_int: i32 = flags as i32;
        options.flags = flags_int;

        // hints & ~(AI_ADDRCONFIG | AI_ALL | AI_V4MAPPED)) !== 0
        let filter: u32 =
            !((bun_dns::AI_ALL | bun_dns::AI_ADDRCONFIG | bun_dns::AI_V4MAPPED) as u32);
        let int: u32 = flags_int as u32;
        if int & filter != 0 {
            return Err(FromJSError::InvalidFlags);
        }
    }

    Ok(options)
}

fn family_from_js(value: AddrInfoHint<'_>) -> Result<Family, FromJSError> {
    match value {
        AddrInfoHint::Number(number) => match number as i32 {
            0 => Ok(Family::Unspecified),
            4 => Ok(Family::Inet),
            6 => Ok(Family::Inet6),
            _ => Err(FromJSError::InvalidFamily),
        },
        AddrInfoHint::Label(b"") => Ok(Family::Unspecified),
        AddrInfoHint::Label(label) => FAMILY_MAP
            .get(label)
            .copied()
            .ok_or(FromJSError::InvalidFamily),
    }
}

fn socket_type_from_js(value: AddrInfoHint<'_>) -> Result<SocketType, FromJSError> {
    match value {
        AddrInfoHint::Number(number) => match number as i32 {
            0 => Ok(SocketType::Unspecified),
            1 => Ok(SocketType::Stream),
            2 => Ok(SocketType::Dgram),
            _ => Err(FromJSError::InvalidSocketType),
        },
        AddrInfoHint::Label(b"") => Ok(SocketType::Unspecified),
        AddrInfoHint::Label(label) => SOCKET_TYPE_MAP
            .get(label)
            .copied()
            .ok_or(FromJSError::InvalidSocketType),
    }
}

fn protocol_from_js(value: AddrInfoHint<'_>) -> Result<Protocol, FromJSError> {
    match value {
        AddrInfoHint::Number(number) => match number as i32 {
            0 => Ok(Protocol::Unspecified),
            6 => Ok(Protocol::Tcp),
            17 => Ok(Protocol::Udp),
            _ => Err(FromJSError::InvalidProtocol),
        },
        AddrInfoHint::Label(b"") => Ok(Protocol::Unspecified),
        AddrInfoHint::Label(label) => PROTOCOL_MAP
            .get(label)
            .copied()
            .ok_or(FromJSError::InvalidProtocol),
    }
}

fn backend_from_js(label: &[u8]) -> Result<Backend, FromJSError> {
    if label.is_empty() {
        return Ok(Backend::default());
    }
    BACKEND_LABEL
        .get(label)
        .copied()
        .ok_or(FromJSError::InvalidBackend)
}

pub(crate) fn results_to_js(list: &[GaiResult], global: &JSGlobalObject) -> JsResult<JSValue> {
    JSValue::create_array_from_iter(global, list.iter(), |item| result_to_js(item, global))
}

pub(crate) fn result_to_js(this: &GaiResult, global: &JSGlobalObject) -> JsResult<JSValue> {
    let obj = JSValue::create_empty_object(global, 3);
    obj.put(global, b"address", address_to_js(&this.address, global)?);
    obj.put(
        global,
        b"family",
        // `bun_sys::net::Address` exposes `.family() -> i32`.
        match this.address.family() {
            f if f == super::netc::AF_INET as _ => JSValue::js_number(4.0),
            f if f == super::netc::AF_INET6 as _ => JSValue::js_number(6.0),
            _ => JSValue::js_number(0.0),
        },
    );
    obj.put(global, b"ttl", JSValue::js_number(f64::from(this.ttl)));
    Ok(obj)
}

pub(crate) fn address_to_js(
    // `bun_dns::Address` is the `bun_sys::net::Address` sockaddr wrapper.
    address: &bun_dns::Address,
    global: &JSGlobalObject,
) -> JsResult<JSValue> {
    address_to_string(address).into_js(global)
}
