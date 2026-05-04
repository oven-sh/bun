//! `from_js`/`to_js` for `GetAddrInfo` and its nested option types, plus
//! `address_to_js`/`addr_info_to_js_array`. The pure types stay in `src/dns/`.

use bun_jsc::{JSGlobalObject, JSValue, JsResult, ZigString};

use bun_dns::{addr_info_count, address_to_string};
use bun_dns::get_addr_info::{
    Backend, Family, GetAddrInfo, Options, Protocol, Result as GaiResult, SocketType,
};
// TODO(port): FromJSError is an error set defined on Options in src/dns/; it must
// include the JSC `JsError` variants (via `From<bun_jsc::JsError>`) plus the
// Invalid* variants below. Backend has its own narrower FromJSError.
use bun_dns::get_addr_info::options::FromJSError;
use bun_dns::get_addr_info::backend::FromJSError as BackendFromJSError;

pub fn options_from_js(value: JSValue, global: &JSGlobalObject) -> Result<Options, FromJSError> {
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
                return Err(FromJSError::InvalidFlags);
            }

            // TODO(port): Zig coerces to `std.c.AI` (packed struct of bools backed
            // by c_int). Options.flags in Rust should be an `AIFlags` bitflags
            // newtype; here we coerce to i32 and store/bit-test as u32.
            let flags_int: i32 = flags.coerce::<i32>(global)?;
            options.flags = flags_int;

            // hints & ~(AI_ADDRCONFIG | AI_ALL | AI_V4MAPPED)) !== 0
            let filter: u32 = !((libc::AI_ALL | libc::AI_ADDRCONFIG | libc::AI_V4MAPPED) as u32);
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
        return match value.coerce::<i32>(global)? {
            0 => Ok(Family::Unspecified),
            4 => Ok(Family::Inet),
            6 => Ok(Family::Inet6),
            _ => Err(FromJSError::InvalidFamily),
        };
    }

    if value.is_string() {
        // TODO(port): Family::MAP is a ComptimeStringMap (phf::Map) with a
        // `.from_js(global, value) -> JsResult<Option<Family>>` helper.
        return match Family::MAP.from_js(global, value)? {
            Some(f) => Ok(f),
            None => {
                if value.to_js_string(global)?.length() == 0 {
                    return Ok(Family::Unspecified);
                }
                Err(FromJSError::InvalidFamily)
            }
        };
    }

    Err(FromJSError::InvalidFamily)
}

pub fn socket_type_from_js(value: JSValue, global: &JSGlobalObject) -> Result<SocketType, FromJSError> {
    if value.is_empty_or_undefined_or_null() {
        // Default to .stream
        return Ok(SocketType::Stream);
    }

    if value.is_number() {
        return match value.to::<i32>() {
            0 => Ok(SocketType::Unspecified),
            1 => Ok(SocketType::Stream),
            2 => Ok(SocketType::Dgram),
            _ => Err(FromJSError::InvalidSocketType),
        };
    }

    if value.is_string() {
        return match SocketType::MAP.from_js(global, value)? {
            Some(s) => Ok(s),
            None => {
                if value.to_js_string(global)?.length() == 0 {
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
        return match value.to::<i32>() {
            0 => Ok(Protocol::Unspecified),
            6 => Ok(Protocol::Tcp),
            17 => Ok(Protocol::Udp),
            _ => Err(FromJSError::InvalidProtocol),
        };
    }

    if value.is_string() {
        return match Protocol::MAP.from_js(global, value)? {
            Some(p) => Ok(p),
            None => {
                let str = value.to_js_string(global)?;
                if str.length() == 0 {
                    return Ok(Protocol::Unspecified);
                }
                Err(FromJSError::InvalidProtocol)
            }
        };
    }

    Err(FromJSError::InvalidProtocol)
}

pub fn backend_from_js(value: JSValue, global: &JSGlobalObject) -> Result<Backend, BackendFromJSError> {
    if value.is_empty_or_undefined_or_null() {
        return Ok(Backend::DEFAULT);
    }

    if value.is_string() {
        return match Backend::LABEL.from_js(global, value)? {
            Some(b) => Ok(b),
            None => {
                if value.to_js_string(global)?.length() == 0 {
                    return Ok(Backend::DEFAULT);
                }
                Err(BackendFromJSError::InvalidBackend)
            }
        };
    }

    Err(BackendFromJSError::InvalidBackend)
}

pub fn result_any_to_js(
    this: &bun_dns::get_addr_info::result::Any,
    global: &JSGlobalObject,
) -> JsResult<Option<JSValue>> {
    use bun_dns::get_addr_info::result::Any;
    Ok(match this {
        Any::Addrinfo(addrinfo) => {
            // LIFETIMES.tsv: GetAddrInfo.Result.Any.addrinfo is FFI → *mut libc::addrinfo
            // (nullable raw pointer, no Option wrapper).
            let addrinfo: *mut libc::addrinfo = *addrinfo;
            if addrinfo.is_null() {
                return Ok(None);
            }
            // SAFETY: addrinfo is a non-null *mut libc::addrinfo owned by the
            // resolver; valid for the duration of this call.
            Some(addr_info_to_js_array(unsafe { &*addrinfo }, global)?)
        }
        Any::List(list) => 'brk: {
            let array = JSValue::create_empty_array(global, list.len() as u32)?;
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
    obj.put(global, ZigString::static_("address"), address_to_js(&this.address, global)?);
    obj.put(
        global,
        ZigString::static_("family"),
        // TODO(port): `this.address.any.family` — Zig's std.net.Address stores a
        // sockaddr union under `.any` with a `.family` field. The Rust
        // `bun_dns::Address` type should expose an equivalent accessor.
        match this.address.any.family {
            f if f == libc::AF_INET as _ => JSValue::js_number(4),
            f if f == libc::AF_INET6 as _ => JSValue::js_number(6),
            _ => JSValue::js_number(0),
        },
    );
    obj.put(global, ZigString::static_("ttl"), JSValue::js_number(this.ttl));
    Ok(obj)
}

pub fn address_to_js(
    // TODO(port): `*const std.net.Address` — the Rust port of bun_dns defines the
    // concrete Address type (sockaddr wrapper); using that here.
    address: &bun_dns::Address,
    global: &JSGlobalObject,
) -> JsResult<JSValue> {
    let mut str = match address_to_string(address) {
        Ok(s) => s,
        Err(_) => return Err(global.throw_out_of_memory()),
    };
    Ok(str.transfer_to_js(global))
}

pub fn addr_info_to_js_array(addr_info: &libc::addrinfo, global: &JSGlobalObject) -> JsResult<JSValue> {
    let array = JSValue::create_empty_array(global, addr_info_count(addr_info))?;

    {
        let mut j: u32 = 0;
        let mut current: *const libc::addrinfo = addr_info;
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
use bun_dns::get_addr_info as _GetAddrInfo;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/dns_jsc/options_jsc.zig (209 lines)
//   confidence: medium
//   todos:      4
//   notes:      ComptimeStringMap `.from_js` helpers + std.c.AI bitflags + std.net.Address shape need Phase-B wiring in bun_dns
// ──────────────────────────────────────────────────────────────────────────
