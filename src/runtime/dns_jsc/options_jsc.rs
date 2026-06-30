//! `from_js`/`to_js` for `GetAddrInfo` and its nested option types, plus
//! `address_to_js`/`addr_info_to_js_array`. The pure types stay in `src/dns/`.

use bun_jsc::{
    ComptimeStringMapExt as _, JSGlobalObject, JSValue, JsError, JsResult, StringJsc as _,
};

use bun_dns::OptionsFromJsError as Invalid;
use bun_dns::{
    BACKEND_LABEL, Backend, FAMILY_MAP, Family, GetAddrInfoResult as GaiResult, Options,
    PROTOCOL_MAP, Protocol, ResultAny, SOCKET_TYPE_MAP, SocketType,
};
use bun_dns::{addr_info_count, address_to_string};

/// From-JS parse failure for `GetAddrInfo` options: a real pending JS error,
/// or a validation failure (`bun_dns::OptionsFromJsError`, which is JSC-free).
pub(crate) enum FromJSError {
    Js(JsError),
    Invalid(Invalid),
}
impl From<JsError> for FromJSError {
    fn from(e: JsError) -> Self {
        Self::Js(e)
    }
}
impl From<Invalid> for FromJSError {
    fn from(e: Invalid) -> Self {
        Self::Invalid(e)
    }
}

pub(crate) fn options_from_js(
    value: JSValue,
    global: &JSGlobalObject,
) -> Result<Options, FromJSError> {
    if value.is_empty_or_undefined_or_null() {
        return Ok(Options::default());
    }

    if value.is_object() {
        let mut options = Options::default();

        if let Some(family) = value.get(global, "family")? {
            options.family = family_from_js(family, global)?;
        }

        if let Some(socktype) = match value.get(global, "socketType")? {
            some @ Some(_) => some,
            None => value.get(global, "socktype")?,
        } {
            options.socktype = socket_type_from_js(socktype, global)?;
        }

        if let Some(protocol) = value.get(global, "protocol")? {
            options.protocol = protocol_from_js(protocol, global)?;
        }

        if let Some(backend) = value.get(global, "backend")? {
            options.backend = backend_from_js(backend, global)?;
        }

        if let Some(flags) = value.get(global, "flags")? {
            if !flags.is_number() {
                return Err(Invalid::InvalidFlags.into());
            }

            // Coerce to i32 and store/bit-test as u32.
            let flags_int: i32 = flags.coerce::<i32>(global)?;
            options.flags = flags_int;

            // hints & ~(AI_ADDRCONFIG | AI_ALL | AI_V4MAPPED)) !== 0
            let filter: u32 =
                !((bun_dns::AI_ALL | bun_dns::AI_ADDRCONFIG | bun_dns::AI_V4MAPPED) as u32);
            let int: u32 = flags_int as u32;
            if int & filter != 0 {
                return Err(Invalid::InvalidFlags.into());
            }
        }

        return Ok(options);
    }

    Err(Invalid::InvalidOptions.into())
}

pub(crate) fn family_from_js(
    value: JSValue,
    global: &JSGlobalObject,
) -> Result<Family, FromJSError> {
    if value.is_empty_or_undefined_or_null() {
        return Ok(Family::Unspecified);
    }

    if value.is_number() {
        return match value.coerce::<i32>(global)? {
            0 => Ok(Family::Unspecified),
            4 => Ok(Family::Inet),
            6 => Ok(Family::Inet6),
            _ => Err(Invalid::InvalidFamily.into()),
        };
    }

    if value.is_string() {
        // `Family.map` is a `ComptimeStringMap` ported as
        // `bun_dns::FAMILY_MAP` (a `comptime_string_map!`); `.from_js` comes
        // from `bun_jsc::ComptimeStringMapExt`.
        return match FAMILY_MAP.from_js(global, value)? {
            Some(f) => Ok(f),
            None => {
                if value.to_js_string(global)?.length() == 0 {
                    return Ok(Family::Unspecified);
                }
                Err(Invalid::InvalidFamily.into())
            }
        };
    }

    Err(Invalid::InvalidFamily.into())
}

pub(crate) fn socket_type_from_js(
    value: JSValue,
    global: &JSGlobalObject,
) -> Result<SocketType, FromJSError> {
    if value.is_empty_or_undefined_or_null() {
        // Default to .stream
        return Ok(SocketType::Stream);
    }

    if value.is_number() {
        return match value.to_int32() {
            0 => Ok(SocketType::Unspecified),
            1 => Ok(SocketType::Stream),
            2 => Ok(SocketType::Dgram),
            _ => Err(Invalid::InvalidSocketType.into()),
        };
    }

    if value.is_string() {
        return match SOCKET_TYPE_MAP.from_js(global, value)? {
            Some(s) => Ok(s),
            None => {
                if value.to_js_string(global)?.length() == 0 {
                    return Ok(SocketType::Unspecified);
                }
                Err(Invalid::InvalidSocketType.into())
            }
        };
    }

    Err(Invalid::InvalidSocketType.into())
}

pub(crate) fn protocol_from_js(
    value: JSValue,
    global: &JSGlobalObject,
) -> Result<Protocol, FromJSError> {
    if value.is_empty_or_undefined_or_null() {
        return Ok(Protocol::Unspecified);
    }

    if value.is_number() {
        return match value.to_int32() {
            0 => Ok(Protocol::Unspecified),
            6 => Ok(Protocol::Tcp),
            17 => Ok(Protocol::Udp),
            _ => Err(Invalid::InvalidProtocol.into()),
        };
    }

    if value.is_string() {
        return match PROTOCOL_MAP.from_js(global, value)? {
            Some(p) => Ok(p),
            None => {
                let str = value.to_js_string(global)?;
                if str.length() == 0 {
                    return Ok(Protocol::Unspecified);
                }
                Err(Invalid::InvalidProtocol.into())
            }
        };
    }

    Err(Invalid::InvalidProtocol.into())
}

pub(crate) fn backend_from_js(
    value: JSValue,
    global: &JSGlobalObject,
) -> Result<Backend, FromJSError> {
    if value.is_empty_or_undefined_or_null() {
        return Ok(Backend::default());
    }

    if value.is_string() {
        return match BACKEND_LABEL.from_js(global, value)? {
            Some(b) => Ok(b),
            None => {
                if value.to_js_string(global)?.length() == 0 {
                    return Ok(Backend::default());
                }
                Err(Invalid::InvalidBackend.into())
            }
        };
    }

    Err(Invalid::InvalidBackend.into())
}

pub(crate) fn result_any_to_js(
    this: &ResultAny,
    global: &JSGlobalObject,
) -> JsResult<Option<JSValue>> {
    Ok(match this {
        ResultAny::Addrinfo(addrinfo) => {
            // LIFETIMES.tsv: GetAddrInfo.Result.Any.addrinfo is FFI → *mut libc::addrinfo
            // (nullable raw pointer, no Option wrapper).
            let addrinfo: *mut super::netc::addrinfo = *addrinfo;
            if addrinfo.is_null() {
                return Ok(None);
            }
            // SAFETY: addrinfo is a non-null *mut libc::addrinfo owned by the
            // resolver; valid for the duration of this call.
            Some(addr_info_to_js_array(unsafe { &*addrinfo }, global)?)
        }
        ResultAny::List(list) => 'brk: {
            let array = JSValue::create_empty_array(global, list.len())?;
            let items: &[GaiResult] = list.as_slice();
            for (i, item) in (0_u32..).zip(items.iter()) {
                array.put_index(global, i, result_to_js(item, global)?)?;
            }
            break 'brk Some(array);
        }
    })
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
    let mut str = match address_to_string(address) {
        Ok(s) => s,
        Err(_) => return Err(global.throw_out_of_memory()),
    };
    str.transfer_to_js(global)
}

pub(crate) fn addr_info_to_js_array(
    addr_info: &super::netc::addrinfo,
    global: &JSGlobalObject,
) -> JsResult<JSValue> {
    let array = JSValue::create_empty_array(global, addr_info_count(addr_info) as usize)?;

    {
        let mut j: u32 = 0;
        let mut current: *const super::netc::addrinfo = addr_info;
        // SAFETY: `current` walks the getaddrinfo(3) singly-linked result list;
        // each node and its `ai_next` are valid until freeaddrinfo is called by
        // the owner (which outlives this call).
        while let Some(this_node) = unsafe { current.as_ref() } {
            if let Some(result) = GaiResult::from_addr_info(this_node) {
                array.put_index(global, j, result_to_js(&result, global)?)?;
                j += 1;
            }
            current = this_node.ai_next;
        }
    }

    Ok(array)
}
