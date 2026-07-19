//! JSC bridges for c-ares reply structs. Keeps `src/cares_sys/` free of
//! `JSValue`/`JSGlobalObject`/`CallFrame` types — the original methods on
//! each `struct_ares_*_reply` are aliased to the free fns here.

use core::ffi::c_int;

use ::bstr::BStr;
use bun_cares_sys::c_ares_draft as c_ares;
use bun_core::{self as bstr, strings};
use bun_dns::V4Mapped;
use bun_jsc::{
    CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc, SystemError, bun_string_jsc,
};

use crate::dns_jsc::options_jsc::{address_to_js, result_to_js};

/// Create a JS string directly from UTF-8 bytes.
#[inline]
fn utf8_to_js(global: &JSGlobalObject, bytes: &[u8]) -> JsResult<JSValue> {
    bun_string_jsc::create_utf8_for_js(global, bytes)
}

// ── struct_hostent ─────────────────────────────────────────────────────────
pub(crate) fn hostent_to_js_response(
    this: &mut c_ares::struct_hostent,
    global_this: &JSGlobalObject,
    lookup_name: &'static [u8], // PERF: could be monomorphized per lookup name — profile if hot
) -> JsResult<JSValue> {
    if lookup_name == b"cname" {
        // A cname lookup always returns a single record but we follow the common API here.
        if this.h_name.is_null() {
            return JSValue::create_empty_array(global_this, 0);
        }
        // SAFETY: h_name is non-null NUL-terminated C string from c-ares.
        let name = unsafe { bun_core::ffi::cstr(this.h_name) }.to_bytes();
        return bun_string_jsc::to_js_array(global_this, &[bstr::String::borrow_utf8(name)]);
    }

    if this.h_aliases.is_null() {
        return JSValue::create_empty_array(global_this, 0);
    }

    let mut count: u32 = 0;
    // SAFETY: h_aliases is a non-null NULL-terminated array of C strings.
    while unsafe { !(*this.h_aliases.add(count as usize)).is_null() } {
        count += 1;
    }

    let array = JSValue::create_empty_array(global_this, count as usize)?;
    count = 0;

    loop {
        // SAFETY: h_aliases is a non-null NULL-terminated array of C strings.
        let alias = unsafe { *this.h_aliases.add(count as usize) };
        if alias.is_null() {
            break;
        }
        // SAFETY: alias is a non-null NUL-terminated C string from c-ares.
        let alias_slice = unsafe { bun_core::ffi::cstr(alias) }.to_bytes();
        array.put_index(global_this, count, utf8_to_js(global_this, alias_slice)?)?;
        count += 1;
    }

    Ok(array)
}

// ── hostent_with_ttls ──────────────────────────────────────────────────────
pub(crate) fn hostent_with_ttls_to_js_response(
    this: &mut c_ares::hostent_with_ttls,
    global_this: &JSGlobalObject,
    lookup_name: &'static [u8], // PERF: could be monomorphized per lookup name — profile if hot
) -> JsResult<JSValue> {
    if lookup_name == b"a" || lookup_name == b"aaaa" {
        // SAFETY: this.hostent is a c-ares-owned hostent pointer (non-null on success path).
        let hostent = unsafe { &*this.hostent };
        if hostent.h_addr_list.is_null() {
            return JSValue::create_empty_array(global_this, 0);
        }

        let mut count: u32 = 0;
        // SAFETY: h_addr_list is a non-null NULL-terminated array of address bytes.
        while unsafe { !(*hostent.h_addr_list.add(count as usize)).is_null() } {
            count += 1;
        }

        let array = JSValue::create_empty_array(global_this, count as usize)?;
        count = 0;

        loop {
            // SAFETY: h_addr_list is a non-null NULL-terminated array of address bytes.
            let addr = unsafe { *hostent.h_addr_list.add(count as usize) };
            if addr.is_null() {
                break;
            }
            // bun_dns::Address (= bun_sys::net::Address) only exposes init_posix,
            // so build a sockaddr_in/in6 on the stack and copy through that.
            let addr_string = {
                // h_addrtype is c_short on Windows, c_int on POSIX; widen for the compare.
                #[allow(clippy::useless_conversion)]
                let address = if i32::from(hostent.h_addrtype) == c_ares::AF::INET6 {
                    // SAFETY: addr points to ≥16 bytes for AF_INET6.
                    let bytes: [u8; 16] = unsafe { *(addr as *const [u8; 16]) };
                    let mut sa6: super::netc::sockaddr_in6 = bun_core::ffi::zeroed();
                    sa6.sin6_family = super::netc::AF_INET6 as _;
                    sa6.sin6_addr.s6_addr = bytes;
                    // SAFETY: &sa6 is a valid sockaddr_in6.
                    unsafe { bun_dns::Address::init_posix((&raw const sa6).cast()) }
                } else {
                    // SAFETY: addr points to ≥4 bytes for AF_INET.
                    let bytes: [u8; 4] = unsafe { *(addr as *const [u8; 4]) };
                    let mut sa4: super::netc::sockaddr_in = bun_core::ffi::zeroed();
                    sa4.sin_family = super::netc::AF_INET as _;
                    sa4.sin_addr.s_addr = u32::from_ne_bytes(bytes);
                    // SAFETY: &sa4 is a valid sockaddr_in.
                    unsafe { bun_dns::Address::init_posix((&raw const sa4).cast()) }
                };
                match address_to_js(&address, global_this) {
                    Ok(v) => v,
                    Err(_) => return Ok(global_this.throw_out_of_memory_value()),
                }
            };

            let ttl: Option<c_int> = if (count as usize) < this.ttls.len() {
                Some(this.ttls[count as usize])
            } else {
                None
            };
            let result_object = JSValue::create_empty_object(global_this, 2);
            result_object.put(global_this, b"address", addr_string);
            result_object.put(
                global_this,
                b"ttl",
                if let Some(val) = ttl {
                    JSValue::js_number(val as f64)
                } else {
                    JSValue::UNDEFINED
                },
            );
            array.put_index(global_this, count, result_object)?;
            count += 1;
        }

        Ok(array)
    } else {
        // Callers guarantee only "a"/"aaaa" reach here.
        unreachable!("Unsupported hostent_with_ttls record type");
    }
}

// ── struct_nameinfo ────────────────────────────────────────────────────────
pub(crate) fn nameinfo_to_js_response(
    this: &mut c_ares::struct_nameinfo,
    global_this: &JSGlobalObject,
) -> JsResult<JSValue> {
    let array = JSValue::create_empty_array(global_this, 2)?; // [node, service]

    if !this.node.is_null() {
        // SAFETY: node is a non-null NUL-terminated C string from c-ares.
        let node_slice = unsafe { bun_core::ffi::cstr(this.node.cast()) }.to_bytes();
        array.put_index(global_this, 0, utf8_to_js(global_this, node_slice)?)?;
    } else {
        array.put_index(global_this, 0, JSValue::UNDEFINED)?;
    }

    if !this.service.is_null() {
        // SAFETY: service is a non-null NUL-terminated C string from c-ares.
        let service_slice = unsafe { bun_core::ffi::cstr(this.service.cast()) }.to_bytes();
        array.put_index(global_this, 1, utf8_to_js(global_this, service_slice)?)?;
    } else {
        array.put_index(global_this, 1, JSValue::UNDEFINED)?;
    }

    Ok(array)
}

// ── AddrInfo ───────────────────────────────────────────────────────────────

/// SAFETY: `head` must be null or the head of a c-ares-owned `AddrInfo_node` chain
/// that stays alive for `'a`.
// LIFETIMES.tsv rows 254/256: AddrInfo.node / AddrInfo_node.next are FFI → *mut AddrInfo_node.
unsafe fn nodes<'a>(
    head: *mut c_ares::AddrInfo_node,
) -> impl Iterator<Item = &'a c_ares::AddrInfo_node> {
    let mut current = head;
    core::iter::from_fn(move || {
        // SAFETY: caller contract: `current` is null or a live node of the chain.
        let node = unsafe { current.as_ref() }?;
        current = node.next;
        Some(node)
    })
}

fn node_to_js(
    node: &c_ares::AddrInfo_node,
    map_v4: bool,
    global_this: &JSGlobalObject,
) -> JsResult<JSValue> {
    // bun_dns::Address::init_posix copies from the raw sockaddr by family,
    // so we hand it `node.addr` directly after asserting a known family.
    debug_assert!(node.family == c_ares::AF::INET || node.family == c_ares::AF::INET6);
    // SAFETY: addr is non-null sockaddr_in/in6 for AF_INET/AF_INET6 (c-ares contract).
    let address = unsafe { bun_dns::Address::init_posix(node.addr.cast()) };
    let address = match map_v4 {
        true => address.to_v4_mapped().unwrap_or(address),
        false => address,
    };
    result_to_js(
        &bun_dns::GetAddrInfoResult {
            address,
            ttl: node.ttl,
        },
        global_this,
    )
}

pub(crate) fn addr_info_to_js_array(
    addr_info: &mut c_ares::AddrInfo,
    v4_mapped: V4Mapped,
    global_this: &JSGlobalObject,
) -> JsResult<JSValue> {
    let head = addr_info.node;
    if head.is_null() {
        return JSValue::create_empty_array(global_this, 0);
    }

    if v4_mapped == V4Mapped::Off {
        // SAFETY: `head` is non-null (checked above); c-ares owns the linked list.
        let array = JSValue::create_empty_array(global_this, unsafe { (*head).count() } as usize)?;
        // SAFETY: same; the chain outlives this call.
        for (j, node) in (0_u32..).zip(unsafe { nodes(head) }) {
            array.put_index(global_this, j, node_to_js(node, false, global_this)?)?;
        }
        return Ok(array);
    }

    let count_family = |family: c_int| {
        // SAFETY: `head` is non-null; the chain outlives this call.
        unsafe { nodes(head) }
            .filter(|n| n.family == family)
            .count()
    };
    let v6_count = count_family(c_ares::AF::INET6);
    // Without AI_ALL the IPv4 addresses are only mapped when the name has no IPv6 one.
    let keep_v4 = v4_mapped == V4Mapped::All || v6_count == 0;
    let v4_count = match keep_v4 {
        true => count_family(c_ares::AF::INET),
        false => 0,
    };

    let array = JSValue::create_empty_array(global_this, v6_count + v4_count)?;
    let mut j: u32 = 0;
    // Native IPv6 first, then the mapped IPv4 addresses, matching glibc's order.
    // SAFETY: `head` is non-null; the chain outlives this call.
    for node in unsafe { nodes(head) }.filter(|n| n.family == c_ares::AF::INET6) {
        array.put_index(global_this, j, node_to_js(node, false, global_this)?)?;
        j += 1;
    }
    if keep_v4 {
        // SAFETY: same.
        for node in unsafe { nodes(head) }.filter(|n| n.family == c_ares::AF::INET) {
            array.put_index(global_this, j, node_to_js(node, true, global_this)?)?;
            j += 1;
        }
    }

    Ok(array)
}

// ── shared count-then-walk → JS array helper ───────────────────────────────
//
// Every `struct_ares_*_reply` is an intrusive singly-linked list with a
// `.next: *mut Self` field. The two-pass walk (count, then
// `create_empty_array` + `put_index`) is done once generically here.
// The trait is `unsafe` because impls promise `next()`
// is either null or a valid pointer into the same c-ares-owned list.

/// SAFETY: impls must return null or a valid pointer into the same
/// c-ares-owned linked list.
unsafe trait CAresLinked {
    fn next(&self) -> *mut Self;
}

macro_rules! impl_cares_linked {
    ($($t:ty),+ $(,)?) => {$(
        // SAFETY: `.next` is the c-ares-owned intrusive list pointer.
        unsafe impl CAresLinked for $t {
            #[inline]
            fn next(&self) -> *mut Self { self.next }
        }
    )+};
}

impl_cares_linked!(
    c_ares::struct_ares_caa_reply,
    c_ares::struct_ares_srv_reply,
    c_ares::struct_ares_mx_reply,
    c_ares::struct_ares_txt_reply,
    c_ares::struct_ares_naptr_reply,
);

fn cares_list_to_js_array<T: CAresLinked>(
    head: &mut T,
    global_this: &JSGlobalObject,
    mut to_js: impl FnMut(&mut T, &JSGlobalObject) -> JsResult<JSValue>,
) -> JsResult<JSValue> {
    let mut count: usize = 0;
    let mut p: *mut T = head;
    while !p.is_null() {
        // SAFETY: `p` walks the c-ares-owned linked list (CAresLinked invariant).
        unsafe { p = (*p).next() };
        count += 1;
    }

    let array = JSValue::create_empty_array(global_this, count)?;

    p = head;
    let mut i: u32 = 0;
    while !p.is_null() {
        // SAFETY: `p` walks the c-ares-owned linked list (CAresLinked invariant).
        let node = unsafe { &mut *p };
        array.put_index(global_this, i, to_js(node, global_this)?)?;
        p = node.next();
        i += 1;
    }

    Ok(array)
}

// ── struct_ares_caa_reply ──────────────────────────────────────────────────
pub(crate) fn caa_reply_to_js_response(
    this: &mut c_ares::struct_ares_caa_reply,
    global_this: &JSGlobalObject,
    _lookup_name: &'static [u8],
) -> JsResult<JSValue> {
    cares_list_to_js_array(this, global_this, caa_reply_to_js)
}

pub(crate) fn caa_reply_to_js(
    this: &mut c_ares::struct_ares_caa_reply,
    global_this: &JSGlobalObject,
) -> JsResult<JSValue> {
    let obj = JSValue::create_empty_object(global_this, 2);

    obj.put(
        global_this,
        b"critical",
        JSValue::js_number(this.critical as f64),
    );

    let property = this.property_bytes();
    let value = this.value_bytes();
    obj.put(global_this, property, utf8_to_js(global_this, value)?);

    Ok(obj)
}

// ── struct_ares_srv_reply ──────────────────────────────────────────────────
pub(crate) fn srv_reply_to_js_response(
    this: &mut c_ares::struct_ares_srv_reply,
    global_this: &JSGlobalObject,
    _lookup_name: &'static [u8],
) -> JsResult<JSValue> {
    cares_list_to_js_array(this, global_this, srv_reply_to_js)
}

pub(crate) fn srv_reply_to_js(
    this: &mut c_ares::struct_ares_srv_reply,
    global_this: &JSGlobalObject,
) -> JsResult<JSValue> {
    let obj = JSValue::create_empty_object(global_this, 4);

    obj.put(
        global_this,
        b"priority",
        JSValue::js_number(this.priority as f64),
    );
    obj.put(
        global_this,
        b"weight",
        JSValue::js_number(this.weight as f64),
    );
    obj.put(global_this, b"port", JSValue::js_number(this.port as f64));

    // SAFETY: host is a non-null NUL-terminated C string from c-ares.
    let host = unsafe { bun_core::ffi::cstr(this.host.cast()) }.to_bytes();
    obj.put(global_this, b"name", utf8_to_js(global_this, host)?);

    Ok(obj)
}

// ── struct_ares_mx_reply ───────────────────────────────────────────────────
pub(crate) fn mx_reply_to_js_response(
    this: &mut c_ares::struct_ares_mx_reply,
    global_this: &JSGlobalObject,
    _lookup_name: &'static [u8],
) -> JsResult<JSValue> {
    cares_list_to_js_array(this, global_this, mx_reply_to_js)
}

pub(crate) fn mx_reply_to_js(
    this: &mut c_ares::struct_ares_mx_reply,
    global_this: &JSGlobalObject,
) -> JsResult<JSValue> {
    let obj = JSValue::create_empty_object(global_this, 2);
    obj.put(
        global_this,
        b"priority",
        JSValue::js_number(this.priority as f64),
    );

    // SAFETY: host is a non-null NUL-terminated C string from c-ares.
    let host = unsafe { bun_core::ffi::cstr(this.host.cast()) }.to_bytes();
    obj.put(global_this, b"exchange", utf8_to_js(global_this, host)?);

    Ok(obj)
}

// ── struct_ares_txt_reply ──────────────────────────────────────────────────
pub(crate) fn txt_reply_to_js_response(
    this: &mut c_ares::struct_ares_txt_reply,
    global_this: &JSGlobalObject,
    _lookup_name: &'static [u8],
) -> JsResult<JSValue> {
    cares_list_to_js_array(this, global_this, txt_reply_to_js)
}

pub(crate) fn txt_reply_to_js(
    this: &mut c_ares::struct_ares_txt_reply,
    global_this: &JSGlobalObject,
) -> JsResult<JSValue> {
    let array = JSValue::create_empty_array(global_this, 1)?;
    let value = this.txt_bytes();
    array.put_index(global_this, 0, utf8_to_js(global_this, value)?)?;
    Ok(array)
}

pub(crate) fn txt_reply_to_js_for_any(
    this: &mut c_ares::struct_ares_txt_reply,
    global_this: &JSGlobalObject,
    _lookup_name: &'static [u8],
) -> JsResult<JSValue> {
    let array =
        cares_list_to_js_array(this, global_this, |node, g| utf8_to_js(g, node.txt_bytes()))?;
    let obj = JSValue::create_empty_object(global_this, 1);
    obj.put(global_this, b"entries", array);
    Ok(obj)
}

// ── struct_ares_naptr_reply ────────────────────────────────────────────────
pub(crate) fn naptr_reply_to_js_response(
    this: &mut c_ares::struct_ares_naptr_reply,
    global_this: &JSGlobalObject,
    _lookup_name: &'static [u8],
) -> JsResult<JSValue> {
    cares_list_to_js_array(this, global_this, naptr_reply_to_js)
}

pub(crate) fn naptr_reply_to_js(
    this: &mut c_ares::struct_ares_naptr_reply,
    global_this: &JSGlobalObject,
) -> JsResult<JSValue> {
    let obj = JSValue::create_empty_object(global_this, 6);

    obj.put(
        global_this,
        b"preference",
        JSValue::js_number(this.preference as f64),
    );
    obj.put(global_this, b"order", JSValue::js_number(this.order as f64));

    // SAFETY: flags is a non-null NUL-terminated C string from c-ares.
    let flags = unsafe { bun_core::ffi::cstr(this.flags.cast()) }.to_bytes();
    obj.put(global_this, b"flags", utf8_to_js(global_this, flags)?);

    // SAFETY: service is a non-null NUL-terminated C string from c-ares.
    let service = unsafe { bun_core::ffi::cstr(this.service.cast()) }.to_bytes();
    obj.put(global_this, b"service", utf8_to_js(global_this, service)?);

    // SAFETY: regexp is a non-null NUL-terminated C string from c-ares.
    let regexp = unsafe { bun_core::ffi::cstr(this.regexp.cast()) }.to_bytes();
    obj.put(global_this, b"regexp", utf8_to_js(global_this, regexp)?);

    // SAFETY: replacement is a non-null NUL-terminated C string from c-ares.
    let replacement = unsafe { bun_core::ffi::cstr(this.replacement.cast()) }.to_bytes();
    obj.put(
        global_this,
        b"replacement",
        utf8_to_js(global_this, replacement)?,
    );

    Ok(obj)
}

// ── struct_ares_soa_reply ──────────────────────────────────────────────────
pub(crate) fn soa_reply_to_js_response(
    this: &mut c_ares::struct_ares_soa_reply,
    global_this: &JSGlobalObject,
    _lookup_name: &'static [u8],
) -> JsResult<JSValue> {
    // PERF: a stack-fallback buffer + arena bulk-free could help — profile if hot
    soa_reply_to_js(this, global_this)
}

pub(crate) fn soa_reply_to_js(
    this: &mut c_ares::struct_ares_soa_reply,
    global_this: &JSGlobalObject,
) -> JsResult<JSValue> {
    let obj = JSValue::create_empty_object(global_this, 7);

    obj.put(
        global_this,
        b"serial",
        JSValue::js_number(this.serial as f64),
    );
    obj.put(
        global_this,
        b"refresh",
        JSValue::js_number(this.refresh as f64),
    );
    obj.put(global_this, b"retry", JSValue::js_number(this.retry as f64));
    obj.put(
        global_this,
        b"expire",
        JSValue::js_number(this.expire as f64),
    );
    obj.put(
        global_this,
        b"minttl",
        JSValue::js_number(this.minttl as f64),
    );

    // SAFETY: nsname is a non-null NUL-terminated C string from c-ares.
    let nsname = unsafe { bun_core::ffi::cstr(this.nsname.cast()) }.to_bytes();
    obj.put(global_this, b"nsname", utf8_to_js(global_this, nsname)?);

    // SAFETY: hostmaster is a non-null NUL-terminated C string from c-ares.
    let hostmaster = unsafe { bun_core::ffi::cstr(this.hostmaster.cast()) }.to_bytes();
    obj.put(
        global_this,
        b"hostmaster",
        utf8_to_js(global_this, hostmaster)?,
    );

    Ok(obj)
}

// ── struct_any_reply ───────────────────────────────────────────────────────
pub(crate) fn any_reply_to_js_response(
    this: &mut c_ares::struct_any_reply,
    global_this: &JSGlobalObject,
    _lookup_name: &'static [u8],
) -> JsResult<JSValue> {
    // PERF: a stack-fallback buffer + arena bulk-free could help — profile if hot
    any_reply_to_js(this, global_this)
}

fn any_reply_append(
    global_this: &JSGlobalObject,
    array: JSValue,
    i: &mut u32,
    response: JSValue,
    lookup_name: &'static [u8],
) -> JsResult<()> {
    let transformed = if response.is_string() {
        let obj = JSValue::create_empty_object(global_this, 1);
        obj.put(global_this, b"value", response);
        obj
    } else {
        debug_assert!(response.is_object());
        response
    };

    // PERF: the ASCII-uppercase of lookup_name could be precomputed — profile if hot
    let mut upper = [0u8; 16];
    let upper = &mut upper[..lookup_name.len()];
    for (dst, &src) in upper.iter_mut().zip(lookup_name) {
        *dst = src.to_ascii_uppercase();
    }

    transformed.put(
        global_this,
        b"type",
        bstr::String::ascii(upper).to_js(global_this)?,
    );
    array.put_index(global_this, *i, transformed)?;
    *i += 1;
    Ok(())
}

fn any_reply_append_all(
    global_this: &JSGlobalObject,
    array: JSValue,
    i: &mut u32,
    response: JSValue,
    lookup_name: &'static [u8],
) -> JsResult<()> {
    // The caller computes `response` (via either `*_to_js_response` or, for txt,
    // `txt_reply_to_js_for_any`) and passes it in directly — see any_reply_to_js below.
    if response.is_array() {
        let mut iterator = response.array_iterator(global_this)?;
        while let Some(item) = iterator.next()? {
            any_reply_append(global_this, array, i, item, lookup_name)?;
        }
    } else {
        any_reply_append(global_this, array, i, response, lookup_name)?;
    }
    Ok(())
}

pub(crate) fn any_reply_to_js(
    this: &mut c_ares::struct_any_reply,
    global_this: &JSGlobalObject,
) -> JsResult<JSValue> {
    // The field set is expanded manually here. Keep in lockstep with
    // `c_ares::struct_any_reply`'s fields.
    let len: usize = this.a_reply.is_some() as usize
        + this.aaaa_reply.is_some() as usize
        + (!this.mx_reply.is_null()) as usize
        + (!this.ns_reply.is_null()) as usize
        + (!this.txt_reply.is_null()) as usize
        + (!this.srv_reply.is_null()) as usize
        + (!this.ptr_reply.is_null()) as usize
        + (!this.naptr_reply.is_null()) as usize
        + (!this.soa_reply.is_null()) as usize
        + (!this.caa_reply.is_null()) as usize;

    let array = JSValue::create_empty_array(global_this, len)?;
    let mut i: u32 = 0;

    if let Some(reply) = this.a_reply.as_deref_mut() {
        let response = hostent_with_ttls_to_js_response(reply, global_this, b"a")?;
        any_reply_append_all(global_this, array, &mut i, response, b"a")?;
    }
    if let Some(reply) = this.aaaa_reply.as_deref_mut() {
        let response = hostent_with_ttls_to_js_response(reply, global_this, b"aaaa")?;
        any_reply_append_all(global_this, array, &mut i, response, b"aaaa")?;
    }
    if !this.mx_reply.is_null() {
        // SAFETY: non-null c-ares-owned linked list head.
        let response = mx_reply_to_js_response(unsafe { &mut *this.mx_reply }, global_this, b"mx")?;
        any_reply_append_all(global_this, array, &mut i, response, b"mx")?;
    }
    if !this.ns_reply.is_null() {
        // SAFETY: non-null c-ares-owned hostent.
        let response = hostent_to_js_response(unsafe { &mut *this.ns_reply }, global_this, b"ns")?;
        any_reply_append_all(global_this, array, &mut i, response, b"ns")?;
    }
    if !this.txt_reply.is_null() {
        // SAFETY: non-null c-ares-owned linked list head.
        // txt is the only reply type with the `to_js_for_any` shape (an `entries`
        // wrapper object) instead of the plain `to_js_response` shape.
        let response =
            txt_reply_to_js_for_any(unsafe { &mut *this.txt_reply }, global_this, b"txt")?;
        any_reply_append_all(global_this, array, &mut i, response, b"txt")?;
    }
    if !this.srv_reply.is_null() {
        // SAFETY: non-null c-ares-owned linked list head.
        let response =
            srv_reply_to_js_response(unsafe { &mut *this.srv_reply }, global_this, b"srv")?;
        any_reply_append_all(global_this, array, &mut i, response, b"srv")?;
    }
    if !this.ptr_reply.is_null() {
        // SAFETY: non-null c-ares-owned hostent.
        let response =
            hostent_to_js_response(unsafe { &mut *this.ptr_reply }, global_this, b"ptr")?;
        any_reply_append_all(global_this, array, &mut i, response, b"ptr")?;
    }
    if !this.naptr_reply.is_null() {
        // SAFETY: non-null c-ares-owned linked list head.
        let response =
            naptr_reply_to_js_response(unsafe { &mut *this.naptr_reply }, global_this, b"naptr")?;
        any_reply_append_all(global_this, array, &mut i, response, b"naptr")?;
    }
    if !this.soa_reply.is_null() {
        // SAFETY: non-null c-ares-owned soa reply.
        let response =
            soa_reply_to_js_response(unsafe { &mut *this.soa_reply }, global_this, b"soa")?;
        any_reply_append_all(global_this, array, &mut i, response, b"soa")?;
    }
    if !this.caa_reply.is_null() {
        // SAFETY: non-null c-ares-owned linked list head.
        let response =
            caa_reply_to_js_response(unsafe { &mut *this.caa_reply }, global_this, b"caa")?;
        any_reply_append_all(global_this, array, &mut i, response, b"caa")?;
    }

    Ok(array)
}

// ── Error ──────────────────────────────────────────────────────────────────
pub(crate) struct ErrorDeferred {
    pub errno: c_ares::Error,
    pub syscall: &'static [u8],
    pub hostname: Option<bstr::String>,
    pub promise: bun_jsc::JSPromiseStrong,
}

impl ErrorDeferred {
    pub(crate) fn init(
        errno: c_ares::Error,
        syscall: &'static [u8],
        hostname: Option<bstr::String>,
        promise: bun_jsc::JSPromiseStrong,
    ) -> Box<ErrorDeferred> {
        Box::new(ErrorDeferred {
            errno,
            syscall,
            hostname,
            promise,
        })
    }

    pub(crate) fn reject(mut self, global_this: &JSGlobalObject) -> JsResult<()> {
        let code = self.errno.code();
        let message = if let Some(hostname) = &self.hostname {
            bstr::String::create_format(format_args!(
                "{} {} {}",
                BStr::new(self.syscall),
                BStr::new(&code[4..]),
                hostname
            ))
        } else {
            bstr::String::create_format(format_args!(
                "{} {}",
                BStr::new(self.syscall),
                BStr::new(&code[4..])
            ))
        };
        let system_error = SystemError {
            errno: self.errno as i32,
            code: bstr::String::static_(code),
            message,
            syscall: bstr::String::clone_utf8(self.syscall),
            hostname: self.hostname.take().unwrap_or(bstr::String::empty()),
            ..Default::default()
        };

        let instance =
            system_error.to_error_instance_with_async_stack(global_this, self.promise.get());
        instance.put(
            global_this,
            b"name",
            bstr::String::static_(b"DNSException").to_js(global_this)?,
        );

        // `self` (and thus self.promise / self.hostname) drops at scope exit;
        // hostname was `take()`n above to avoid double-deref.
        Ok(self.promise.reject(global_this, Ok(instance))?)
    }

    pub(crate) fn reject_later(self: Box<Self>, global_this: &JSGlobalObject) {
        struct Context {
            deferred: Box<ErrorDeferred>,
            // LIFETIMES.tsv row 1403: JSC_BORROW — the global outlives the
            // enqueued task (VM-owned), so a `BackRef` captures the invariant.
            global_this: bun_ptr::BackRef<JSGlobalObject>,
        }
        impl Context {
            // `bun_event_loop::ManagedTask::new` expects
            // `fn(*mut T) -> bun_event_loop::JsResult<()>` (low-tier `ErasedJsError`).
            fn callback(this: *mut Context) -> bun_event_loop::JsResult<()> {
                // SAFETY: `this` is the heap-allocated pointer passed to ManagedTask::new
                // below; ManagedTask::run calls us exactly once with that pointer.
                let this = unsafe { bun_core::heap::take(this) };
                let global = this.global_this.get();
                this.deferred.reject(global).map_err(Into::into)
            }
        }

        let vm = global_this.bun_vm();
        // Worker terminate's `close_dns_for_terminate` fires EDESTRUCTION with
        // `is_shutting_down` already set; the task queue is about to be
        // drained-without-run and ManagedTask has no cleanup here, so enqueuing
        // would leak the `Context` and its `JSPromiseStrong` box. Drop now while
        // JSC is still live so the Strong handle releases cleanly.
        if vm.is_shutting_down() {
            return;
        }

        let context = bun_core::heap::into_raw(Box::new(Context {
            deferred: self,
            global_this: bun_ptr::BackRef::new(global_this),
        }));
        // TODO(@heimskr): new custom Task type
        // SAFETY: `bun_vm()` returns a non-null VM pointer (VM-owned for the lifetime of
        // the JSGlobalObject).
        vm.as_mut()
            .enqueue_task(bun_jsc::ManagedTask::ManagedTask::new(
                context,
                Context::callback,
            ));
    }
}

// Drop: hostname (bun_core::String) and promise (JSPromiseStrong) drop their own resources;
// the allocation itself is handled by Box drop at the call site.

pub(crate) fn error_to_deferred(
    this: c_ares::Error,
    syscall: &'static [u8],
    hostname: Option<&[u8]>,
    promise: &mut bun_jsc::JSPromiseStrong,
) -> Box<ErrorDeferred> {
    let host_string: Option<bstr::String> = hostname.map(bstr::String::clone_utf8);
    let taken = core::mem::take(promise);
    ErrorDeferred::init(this, syscall, host_string, taken)
}

pub(crate) fn error_to_js_with_syscall(
    this: c_ares::Error,
    global_this: &JSGlobalObject,
    syscall: &'static [u8],
) -> JsResult<JSValue> {
    let code = this.code();
    let instance = SystemError {
        errno: this as i32,
        code: bstr::String::static_(&code[4..]),
        syscall: bstr::String::static_(syscall),
        message: bstr::String::create_format(format_args!(
            "{} {}",
            BStr::new(syscall),
            BStr::new(&code[4..])
        )),
        ..Default::default()
    }
    .to_error_instance(global_this);
    instance.put(
        global_this,
        b"name",
        bstr::String::static_(b"DNSException").to_js(global_this)?,
    );
    Ok(instance)
}

/// `SystemError` fields for a resolver failure, in the shape `node:dns`
/// reports them: `code`/`errno` derived from the DNS error, message
/// `"<syscall> <CODE> <hostname>"`, plus `syscall` and `hostname`.
/// `fetch()`/`Bun.connect` reuse this so a failed name lookup surfaces the
/// same error the resolver APIs do.
pub(crate) fn system_error_with_syscall_and_hostname(
    this: c_ares::Error,
    syscall: &'static [u8],
    hostname: &[u8],
) -> SystemError {
    let code = this.code();
    SystemError {
        errno: this as i32,
        code: bstr::String::static_(&code[4..]),
        message: bstr::String::create_format(format_args!(
            "{} {} {}",
            BStr::new(syscall),
            BStr::new(&code[4..]),
            BStr::new(hostname)
        )),
        syscall: bstr::String::static_(syscall),
        hostname: bstr::String::clone_utf8(hostname),
        ..Default::default()
    }
}

pub(crate) fn error_to_js_with_syscall_and_hostname(
    this: c_ares::Error,
    global_this: &JSGlobalObject,
    syscall: &'static [u8],
    hostname: &[u8],
) -> JsResult<JSValue> {
    let instance = system_error_with_syscall_and_hostname(this, syscall, hostname)
        .to_error_instance(global_this);
    instance.put(
        global_this,
        b"name",
        bstr::String::static_(b"DNSException").to_js(global_this)?,
    );
    Ok(instance)
}

// ── canonicalizeIP host fn ─────────────────────────────────────────────────
// `#[bun_jsc::host_fn(export = ...)]` emits the C-ABI shim under that link name.
#[bun_jsc::host_fn(export = "Bun__canonicalizeIP")]
pub(crate) fn bun_canonicalize_ip(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    bun_jsc::mark_binding!();

    let arguments = callframe.arguments();

    if arguments.is_empty() {
        return Err(global_this.throw_invalid_arguments(format_args!(
            "canonicalizeIP() expects a string but received no arguments."
        )));
    }

    let addr_arg = arguments[0].to_slice(global_this)?;
    let addr_str = addr_arg.slice();

    // CIDR not allowed
    if strings::index_of_char(addr_str, b'/').is_some() {
        return Ok(JSValue::UNDEFINED);
    }

    let mut ip_addr = [0u8; bun_boringssl::INET6_ADDRSTRLEN + 1];
    let Some(slice) = bun_boringssl::canonicalize_ip(addr_str, &mut ip_addr) else {
        return Ok(JSValue::UNDEFINED);
    };
    if addr_str == slice {
        return Ok(arguments[0]);
    }

    bun_string_jsc::create_utf8_for_js(global_this, slice)
}
