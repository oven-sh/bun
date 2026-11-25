//! `from_js`/`to_js` for `GetAddrInfo` and its nested option types, plus
//! `results_to_js`. The pure types stay in `src/dns/`.

use bun_jsc::bindgen::JsHeap;
use bun_jsc::{JSGlobalObject, JSValue, JsResult, StringJsc as _};

use bun_dns::OptionsFromJsError as FromJSError;
use bun_dns::address_to_string;
use bun_dns::{
    BACKEND_LABEL, Backend, FAMILY_MAP, Family, GetAddrInfoResult as GaiResult, Options, Order,
    PROTOCOL_MAP, Protocol, SOCKET_TYPE_MAP, SocketType,
};

use crate::dns_jsc::answer_jsc::thrown;
use crate::generated_bindgen::answer_jsc::LookupAddress;
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

/// The addresses alone. Node.js drops the zone id too, without which a link-local address cannot be reached.
pub(crate) fn addresses_to_js(
    list: &[GaiResult],
    order: Order,
    global: &JSGlobalObject,
) -> JsResult<JSValue> {
    let is_first = |it: &&GaiResult| match order {
        Order::Verbatim => true,
        Order::Ipv4first => it.address.family() == super::netc::AF_INET as _,
        Order::Ipv6first => it.address.family() == super::netc::AF_INET6 as _,
    };
    let sorted = (list.iter().filter(is_first)).chain(list.iter().filter(|it| !is_first(it)));
    let array = JSValue::create_empty_array(global, list.len())?;
    for (index, item) in (0..).zip(sorted) {
        let address = address_to_string(&item.address).into_js(global)?;
        array.put_index(global, index, address)?;
    }
    Ok(array)
}

pub(crate) fn result_to_js(this: &GaiResult, global: &JSGlobalObject) -> JsResult<JSValue> {
    let result = LookupAddress {
        address: address_to_string(&this.address),
        family: match this.address.family() {
            f if f == super::netc::AF_INET as _ => 4,
            f if f == super::netc::AF_INET6 as _ => 6,
            _ => 0,
        },
        ttl: this.ttl,
    };
    thrown(result.into_js(JsHeap::from_global(global)), global)
}
