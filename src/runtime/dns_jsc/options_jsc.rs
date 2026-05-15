//! `from_js`/`to_js` for `GetAddrInfo` and its nested option types, plus
//! `address_to_js`/`addr_info_to_js_array`. The pure types stay in `src/dns/`.

use bun_jsc::{
    ComptimeStringMapExt as _, JSGlobalObject, JSValue, JsError, JsResult, StringJsc as _,
};

use bun_dns::{
    BACKEND_LABEL, Backend, FAMILY_MAP, Family, GetAddrInfo, GetAddrInfoResult as GaiResult,
    Options, PROTOCOL_MAP, Protocol, ResultAny, SOCKET_TYPE_MAP, SocketType,
};
use bun_dns::{addr_info_count, address_to_string};
// PORT NOTE: Zig's `Options.FromJSError` is the error-set union of all the
// per-field `Invalid*` variants plus `JSError`. The Rust enum lives in
// `bun_dns` (which has no `bun_jsc` dep), so the `JsError → JSError` mapping is
// done locally via the `js()` helper below.
use bun_dns::OptionsFromJsError as FromJSError;

#[inline]
fn js<T>(r: JsResult<T>) -> Result<T, FromJSError> {
    r.map_err(|_: JsError| FromJSError::JSError)
}

pub fn options_from_js(value: JSValue, global: &JSGlobalObject) -> Result<Options, FromJSError> {
    if value.is_empty_or_undefined_or_null() {
        return Ok(Options::default());
    }

    if value.is_object() {
        let mut options = Options::default();

        if let Some(family) = js(value.get(global, "family"))? {
            options.family = family_from_js(family, global)?;
        }

        if let Some(socktype) = match js(value.get(global, "socketType"))? {
            some @ Some(_) => some,
            None => js(value.get(global, "socktype"))?,
        } {
            options.socktype = socket_type_from_js(socktype, global)?;
        }

        if let Some(protocol) = js(value.get(global, "protocol"))? {
            options.protocol = protocol_from_js(protocol, global)?;
        }

        if let Some(backend) = js(value.get(global, "backend"))? {
            options.backend = backend_from_js(backend, global)?;
        }

        if let Some(flags) = js(value.get(global, "flags"))? {
            if !flags.is_number() {
                return Err(FromJSError::InvalidFlags);
            }

            // TODO(port): Zig coerces to `std.c.AI` (packed struct of bools backed
            // by c_int). Options.flags in Rust should be an `AIFlags` bitflags
            // newtype; here we coerce to i32 and store/bit-test as u32.
            let flags_int: i32 = js(flags.coerce::<i32>(global))?;
            options.flags = flags_int;

            // hints & ~(AI_ADDRCONFIG | AI_ALL | AI_V4MAPPED)) !== 0
            let filter: u32 =
                !((bun_dns::AI_ALL | bun_dns::AI_ADDRCONFIG | bun_dns::AI_V4MAPPED) as u32);
            let int: u32 = flags_int as u32;
            if int & filter != 0 {
                return Err(FromJSError::InvalidFlags);
            }
        }

        return Ok(options);
    }

    Err(FromJSError::InvalidOptions)
}

pub fn family_from_js(value: JSValue, global: &JSGlobalObject) -> Result<Family, FromJSError> {
    if value.is_empty_or_undefined_or_null() {
        return Ok(Family::Unspecified);
    }

    if value.is_number() {
        return match js(value.coerce::<i32>(global))? {
            0 => Ok(Family::Unspecified),
            4 => Ok(Family::Inet),
            6 => Ok(Family::Inet6),
            _ => Err(FromJSError::InvalidFamily),
        };
    }

    if value.is_string() {
        // PORT NOTE: `Family.map` is a `ComptimeStringMap` ported as
        // `bun_dns::FAMILY_MAP: phf::Map`; `.from_js` comes from
        // `bun_jsc::ComptimeStringMapExt`.
        return match js(FAMILY_MAP.from_js(global, value))? {
            Some(f) => Ok(f),
            None => {
                if js(value.to_js_string(global))?.length() == 0 {
                    return Ok(Family::Unspecified);
                }
                Err(FromJSError::InvalidFamily)
            }
        };
    }

    Err(FromJSError::InvalidFamily)
}

pub fn socket_type_from_js(
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
            _ => Err(FromJSError::InvalidSocketType),
        };
    }

    if value.is_string() {
        return match js(SOCKET_TYPE_MAP.from_js(global, value))? {
            Some(s) => Ok(s),
            None => {
                if js(value.to_js_string(global))?.length() == 0 {
                    return Ok(SocketType::Unspecified);
                }
                Err(FromJSError::InvalidSocketType)
            }
        };
    }

    Err(FromJSError::InvalidSocketType)
}

pub fn protocol_from_js(value: JSValue, global: &JSGlobalObject) -> Result<Protocol, FromJSError> {
    if value.is_empty_or_undefined_or_null() {
        return Ok(Protocol::Unspecified);
    }

    if value.is_number() {
        return match value.to_int32() {
            0 => Ok(Protocol::Unspecified),
            6 => Ok(Protocol::Tcp),
            17 => Ok(Protocol::Udp),
            _ => Err(FromJSError::InvalidProtocol),
        };
    }

    if value.is_string() {
        return match js(PROTOCOL_MAP.from_js(global, value))? {
            Some(p) => Ok(p),
            None => {
                let str = js(value.to_js_string(global))?;
                if str.length() == 0 {
                    return Ok(Protocol::Unspecified);
                }
                Err(FromJSError::InvalidProtocol)
            }
        };
    }

    Err(FromJSError::InvalidProtocol)
}

pub fn backend_from_js(value: JSValue, global: &JSGlobalObject) -> Result<Backend, FromJSError> {
    if value.is_empty_or_undefined_or_null() {
        return Ok(Backend::default());
    }

    if value.is_string() {
        return match js(BACKEND_LABEL.from_js(global, value))? {
            Some(b) => Ok(b),
            None => {
                if js(value.to_js_string(global))?.length() == 0 {
                    return Ok(Backend::default());
                }
                Err(FromJSError::InvalidBackend)
            }
        };
    }

    Err(FromJSError::InvalidBackend)
}

pub fn result_any_to_js(this: &ResultAny, global: &JSGlobalObject) -> JsResult<Option<JSValue>> {
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
            let mut i: u32 = 0;
            let items: &[GaiResult] = list.as_slice();
            for item in items {
                array.put_index(global, i, result_to_js(item, global)?)?;
                i += 1;
            }
            break 'brk Some(array);
        }
    })
}

pub fn result_to_js(this: &GaiResult, global: &JSGlobalObject) -> JsResult<JSValue> {
    let obj = JSValue::create_empty_object(global, 3);
    obj.put(global, b"address", address_to_js(&this.address, global)?);
    obj.put(
        global,
        b"family",
        // PORT NOTE: `this.address.any.family` — Zig's std.net.Address stores a
        // sockaddr union under `.any` with a `.family` field. The Rust
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

pub fn address_to_js(
    // PORT NOTE: `*const std.net.Address` — `bun_dns::Address` is the
    // `bun_sys::net::Address` sockaddr wrapper.
    address: &bun_dns::Address,
    global: &JSGlobalObject,
) -> JsResult<JSValue> {
    let mut str = match address_to_string(address) {
        Ok(s) => s,
        Err(_) => return Err(global.throw_out_of_memory()),
    };
    str.transfer_to_js(global)
}

pub fn addr_info_to_js_array(
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
            // Zig field name is `.next`; libc crate uses `ai_next`.
            current = this_node.ai_next;
        }
    }

    Ok(array)
}

// (unused import in Zig: `JSError = bun.JSError` — dropped)
#[allow(unused_imports)]
use bun_dns::GetAddrInfo as _GetAddrInfo;

// ported from: src/runtime/dns_jsc/options_jsc.zig
