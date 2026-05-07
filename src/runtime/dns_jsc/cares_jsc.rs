//! JSC bridges for c-ares reply structs. Keeps `src/cares_sys/` free of
//! `JSValue`/`JSGlobalObject`/`CallFrame` types — the original methods on
//! each `struct_ares_*_reply` are aliased to the free fns here.

use core::ffi::{c_char, c_int, CStr};

use ::bstr::BStr;
use bun_cares_sys::c_ares_draft as c_ares;
use bun_jsc::{bun_string_jsc, CallFrame, JSGlobalObject, JSValue, JsError, JsResult, StringJsc, SystemError};
use bun_str::{self as bstr, strings};

use crate::dns_jsc::options_jsc::{address_to_js, result_to_js};

/// Local shim for the missing `ZigString::to_js` extension — Zig's
/// `ZigString.fromUTF8(slice).toJS(global)` is equivalent to creating a JS
/// string directly from UTF-8 bytes.
#[inline]
fn utf8_to_js(global: &JSGlobalObject, bytes: &[u8]) -> JSValue {
    bun_string_jsc::create_utf8_for_js(global, bytes).unwrap_or(JSValue::UNDEFINED)
}

// ── struct_hostent ─────────────────────────────────────────────────────────
pub fn hostent_to_js_response(
    this: &mut c_ares::struct_hostent,
    global_this: &JSGlobalObject,
    lookup_name: &'static [u8], // PERF(port): was comptime monomorphization — profile in Phase B
) -> JsResult<JSValue> {
    if lookup_name == b"cname" {
        // A cname lookup always returns a single record but we follow the common API here.
        if this.h_name.is_null() {
            return JSValue::create_empty_array(global_this, 0);
        }
        // SAFETY: h_name is non-null NUL-terminated C string from c-ares.
        let name = unsafe { CStr::from_ptr(this.h_name) }.to_bytes();
        return bun_string_to_js_array(
            global_this,
            &[bstr::String::borrow_utf8(name)],
        );
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
        let alias_slice = unsafe { CStr::from_ptr(alias) }.to_bytes();
        array.put_index(
            global_this,
            count,
            utf8_to_js(global_this, alias_slice),
        )?;
        count += 1;
    }

    Ok(array)
}

// ── hostent_with_ttls ──────────────────────────────────────────────────────
pub fn hostent_with_ttls_to_js_response(
    this: &mut c_ares::hostent_with_ttls,
    global_this: &JSGlobalObject,
    lookup_name: &'static [u8], // PERF(port): was comptime monomorphization — profile in Phase B
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
            // PORT NOTE: Zig built std.net.Address via .initIp4/.initIp6. Rust
            // bun_dns::Address (= bun_sys::net::Address) only exposes init_posix,
            // so build a sockaddr_in/in6 on the stack and copy through that.
            let addr_string = {
                let address = if hostent.h_addrtype == c_ares::AF::INET6 {
                    // SAFETY: addr points to ≥16 bytes for AF_INET6.
                    let bytes: [u8; 16] = unsafe { *(addr as *const [u8; 16]) };
                    let mut sa6: libc::sockaddr_in6 = unsafe { core::mem::zeroed() };
                    sa6.sin6_family = libc::AF_INET6 as _;
                    sa6.sin6_addr.s6_addr = bytes;
                    // SAFETY: &sa6 is a valid sockaddr_in6.
                    unsafe { bun_dns::Address::init_posix((&sa6 as *const libc::sockaddr_in6).cast()) }
                } else {
                    // SAFETY: addr points to ≥4 bytes for AF_INET.
                    let bytes: [u8; 4] = unsafe { *(addr as *const [u8; 4]) };
                    let mut sa4: libc::sockaddr_in = unsafe { core::mem::zeroed() };
                    sa4.sin_family = libc::AF_INET as _;
                    sa4.sin_addr.s_addr = u32::from_ne_bytes(bytes);
                    // SAFETY: &sa4 is a valid sockaddr_in.
                    unsafe { bun_dns::Address::init_posix((&sa4 as *const libc::sockaddr_in).cast()) }
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
            // PORT NOTE: Zig used `JSValue.createObject2`. No such helper on
            // `bun_jsc::JSValue`; build via `create_empty_object` + `put`.
            let result_object = JSValue::create_empty_object(global_this, 2);
            result_object.put(global_this, b"address", addr_string);
            result_object.put(
                global_this,
                b"ttl",
                if let Some(val) = ttl { JSValue::js_number(val as f64) } else { JSValue::UNDEFINED },
            );
            array.put_index(global_this, count, result_object)?;
            count += 1;
        }

        Ok(array)
    } else {
        // Zig: @compileError — the comptime param guaranteed only "a"/"aaaa" reach here.
        unreachable!("Unsupported hostent_with_ttls record type");
    }
}

// ── struct_nameinfo ────────────────────────────────────────────────────────
pub fn nameinfo_to_js_response(
    this: &mut c_ares::struct_nameinfo,
    global_this: &JSGlobalObject,
) -> JsResult<JSValue> {
    let array = JSValue::create_empty_array(global_this, 2)?; // [node, service]

    if !this.node.is_null() {
        // SAFETY: node is a non-null NUL-terminated C string from c-ares.
        let node_slice = unsafe { CStr::from_ptr(this.node as *const c_char) }.to_bytes();
        array.put_index(global_this, 0, utf8_to_js(global_this, node_slice))?;
    } else {
        array.put_index(global_this, 0, JSValue::UNDEFINED)?;
    }

    if !this.service.is_null() {
        // SAFETY: service is a non-null NUL-terminated C string from c-ares.
        let service_slice = unsafe { CStr::from_ptr(this.service as *const c_char) }.to_bytes();
        array.put_index(global_this, 1, utf8_to_js(global_this, service_slice))?;
    } else {
        array.put_index(global_this, 1, JSValue::UNDEFINED)?;
    }

    Ok(array)
}

// ── AddrInfo ───────────────────────────────────────────────────────────────
pub fn addr_info_to_js_array(
    addr_info: &mut c_ares::AddrInfo,
    global_this: &JSGlobalObject,
) -> JsResult<JSValue> {
    // LIFETIMES.tsv rows 254/256: AddrInfo.node / AddrInfo_node.next are FFI → *mut AddrInfo_node.
    if addr_info.node.is_null() {
        return JSValue::create_empty_array(global_this, 0);
    }
    // SAFETY: node is non-null (checked above); c-ares owns the linked list.
    let array = JSValue::create_empty_array(global_this, unsafe { (*addr_info.node).count() } as usize)?;

    {
        let mut j: u32 = 0;
        let mut current: *mut c_ares::AddrInfo_node = addr_info.node;
        while !current.is_null() {
            // SAFETY: current is non-null (loop guard); c-ares owns the linked list.
            let this_node = unsafe { &*current };
            // PORT NOTE: Zig matched on family and union-viewed std.net.Address.
            // bun_dns::Address::init_posix copies from the raw sockaddr by family,
            // so we hand it `this_node.addr` directly after asserting a known family.
            debug_assert!(
                this_node.family == c_ares::AF::INET || this_node.family == c_ares::AF::INET6
            );
            // SAFETY: addr is non-null sockaddr_in/in6 for AF_INET/AF_INET6 (c-ares contract).
            let address = unsafe { bun_dns::Address::init_posix(this_node.addr.cast()) };
            array.put_index(
                global_this,
                j,
                result_to_js(
                    &bun_dns::GetAddrInfoResult {
                        address,
                        ttl: this_node.ttl,
                    },
                    global_this,
                )?,
            )?;
            j += 1;
            current = this_node.next;
        }
    }

    Ok(array)
}

// ── struct_ares_caa_reply ──────────────────────────────────────────────────
pub fn caa_reply_to_js_response(
    this: &mut c_ares::struct_ares_caa_reply,
    global_this: &JSGlobalObject,
    _lookup_name: &'static [u8],
) -> JsResult<JSValue> {
    // PERF(port): was stack-fallback + arena bulk-free — profile in Phase B
    let mut count: usize = 0;
    let mut caa: *mut c_ares::struct_ares_caa_reply = this;
    while !caa.is_null() {
        // SAFETY: caa walks the c-ares-owned linked list.
        unsafe { caa = (*caa).next };
        count += 1;
    }

    let array = JSValue::create_empty_array(global_this, count)?;

    caa = this;
    let mut i: u32 = 0;
    while !caa.is_null() {
        // SAFETY: caa walks the c-ares-owned linked list.
        let node = unsafe { &mut *caa };
        array.put_index(global_this, i, caa_reply_to_js(node, global_this))?;
        caa = node.next;
        i += 1;
    }

    Ok(array)
}

pub fn caa_reply_to_js(
    this: &mut c_ares::struct_ares_caa_reply,
    global_this: &JSGlobalObject,
) -> JSValue {
    let obj = JSValue::create_empty_object(global_this, 2);

    obj.put(global_this, b"critical", JSValue::js_number(this.critical as f64));

    // SAFETY: property is a c-ares-owned buffer of plength bytes.
    let property = unsafe { core::slice::from_raw_parts(this.property, this.plength as usize) };
    // SAFETY: value is a c-ares-owned buffer of length bytes.
    let value = unsafe { core::slice::from_raw_parts(this.value, this.length as usize) };
    obj.put(global_this, property, utf8_to_js(global_this, value));

    obj
}

// ── struct_ares_srv_reply ──────────────────────────────────────────────────
pub fn srv_reply_to_js_response(
    this: &mut c_ares::struct_ares_srv_reply,
    global_this: &JSGlobalObject,
    _lookup_name: &'static [u8],
) -> JsResult<JSValue> {
    // PERF(port): was stack-fallback + arena bulk-free — profile in Phase B
    let mut count: usize = 0;
    let mut srv: *mut c_ares::struct_ares_srv_reply = this;
    while !srv.is_null() {
        // SAFETY: srv walks the c-ares-owned linked list.
        unsafe { srv = (*srv).next };
        count += 1;
    }

    let array = JSValue::create_empty_array(global_this, count)?;

    srv = this;
    let mut i: u32 = 0;
    while !srv.is_null() {
        // SAFETY: srv walks the c-ares-owned linked list.
        let node = unsafe { &mut *srv };
        array.put_index(global_this, i, srv_reply_to_js(node, global_this))?;
        srv = node.next;
        i += 1;
    }

    Ok(array)
}

pub fn srv_reply_to_js(
    this: &mut c_ares::struct_ares_srv_reply,
    global_this: &JSGlobalObject,
) -> JSValue {
    let obj = JSValue::create_empty_object(global_this, 4);

    obj.put(global_this, b"priority", JSValue::js_number(this.priority as f64));
    obj.put(global_this, b"weight", JSValue::js_number(this.weight as f64));
    obj.put(global_this, b"port", JSValue::js_number(this.port as f64));

    // SAFETY: host is a non-null NUL-terminated C string from c-ares.
    let host = unsafe { CStr::from_ptr(this.host as *const c_char) }.to_bytes();
    obj.put(global_this, b"name", utf8_to_js(global_this, host));

    obj
}

// ── struct_ares_mx_reply ───────────────────────────────────────────────────
pub fn mx_reply_to_js_response(
    this: &mut c_ares::struct_ares_mx_reply,
    global_this: &JSGlobalObject,
    _lookup_name: &'static [u8],
) -> JsResult<JSValue> {
    // PERF(port): was stack-fallback + arena bulk-free — profile in Phase B
    let mut count: usize = 0;
    let mut mx: *mut c_ares::struct_ares_mx_reply = this;
    while !mx.is_null() {
        // SAFETY: mx walks the c-ares-owned linked list.
        unsafe { mx = (*mx).next };
        count += 1;
    }

    let array = JSValue::create_empty_array(global_this, count)?;

    mx = this;
    let mut i: u32 = 0;
    while !mx.is_null() {
        // SAFETY: mx walks the c-ares-owned linked list.
        let node = unsafe { &mut *mx };
        array.put_index(global_this, i, mx_reply_to_js(node, global_this))?;
        mx = node.next;
        i += 1;
    }

    Ok(array)
}

pub fn mx_reply_to_js(
    this: &mut c_ares::struct_ares_mx_reply,
    global_this: &JSGlobalObject,
) -> JSValue {
    let obj = JSValue::create_empty_object(global_this, 2);
    obj.put(global_this, b"priority", JSValue::js_number(this.priority as f64));

    // SAFETY: host is a non-null NUL-terminated C string from c-ares.
    let host = unsafe { CStr::from_ptr(this.host as *const c_char) }.to_bytes();
    obj.put(global_this, b"exchange", utf8_to_js(global_this, host));

    obj
}

// ── struct_ares_txt_reply ──────────────────────────────────────────────────
pub fn txt_reply_to_js_response(
    this: &mut c_ares::struct_ares_txt_reply,
    global_this: &JSGlobalObject,
    _lookup_name: &'static [u8],
) -> JsResult<JSValue> {
    // PERF(port): was stack-fallback + arena bulk-free — profile in Phase B
    let mut count: usize = 0;
    let mut txt: *mut c_ares::struct_ares_txt_reply = this;
    while !txt.is_null() {
        // SAFETY: txt walks the c-ares-owned linked list.
        unsafe { txt = (*txt).next };
        count += 1;
    }

    let array = JSValue::create_empty_array(global_this, count)?;

    txt = this;
    let mut i: u32 = 0;
    while !txt.is_null() {
        // SAFETY: txt walks the c-ares-owned linked list.
        let node = unsafe { &mut *txt };
        array.put_index(global_this, i, txt_reply_to_js(node, global_this)?)?;
        txt = node.next;
        i += 1;
    }

    Ok(array)
}

pub fn txt_reply_to_js(
    this: &mut c_ares::struct_ares_txt_reply,
    global_this: &JSGlobalObject,
) -> JsResult<JSValue> {
    let array = JSValue::create_empty_array(global_this, 1)?;
    // SAFETY: txt is a c-ares-owned buffer of `length` bytes.
    let value = unsafe { core::slice::from_raw_parts(this.txt, this.length as usize) };
    array.put_index(global_this, 0, utf8_to_js(global_this, value))?;
    Ok(array)
}

pub fn txt_reply_to_js_for_any(
    this: &mut c_ares::struct_ares_txt_reply,
    global_this: &JSGlobalObject,
    _lookup_name: &'static [u8],
) -> JsResult<JSValue> {
    let mut count: usize = 0;
    let mut txt: *mut c_ares::struct_ares_txt_reply = this;
    while !txt.is_null() {
        // SAFETY: txt walks the c-ares-owned linked list.
        unsafe { txt = (*txt).next };
        count += 1;
    }

    let array = JSValue::create_empty_array(global_this, count)?;

    txt = this;
    let mut i: u32 = 0;
    while !txt.is_null() {
        // SAFETY: txt walks the c-ares-owned linked list.
        let node = unsafe { &mut *txt };
        // SAFETY: txt is a c-ares-owned buffer of `length` bytes.
        let value = unsafe { core::slice::from_raw_parts(node.txt, node.length as usize) };
        array.put_index(global_this, i, utf8_to_js(global_this, value))?;
        txt = node.next;
        i += 1;
    }

    // PORT NOTE: Zig used `JSObject.create(.{ .entries = array }, global)`. No
    // anon-struct builder on `bun_jsc::JSObject`; use `create_empty_object` + `put`.
    let obj = JSValue::create_empty_object(global_this, 1);
    obj.put(global_this, b"entries", array);
    Ok(obj)
}

// ── struct_ares_naptr_reply ────────────────────────────────────────────────
pub fn naptr_reply_to_js_response(
    this: &mut c_ares::struct_ares_naptr_reply,
    global_this: &JSGlobalObject,
    _lookup_name: &'static [u8],
) -> JsResult<JSValue> {
    // PERF(port): was stack-fallback + arena bulk-free — profile in Phase B
    let mut count: usize = 0;
    let mut naptr: *mut c_ares::struct_ares_naptr_reply = this;
    while !naptr.is_null() {
        // SAFETY: naptr walks the c-ares-owned linked list.
        unsafe { naptr = (*naptr).next };
        count += 1;
    }

    let array = JSValue::create_empty_array(global_this, count)?;

    naptr = this;
    let mut i: u32 = 0;
    while !naptr.is_null() {
        // SAFETY: naptr walks the c-ares-owned linked list.
        let node = unsafe { &mut *naptr };
        array.put_index(global_this, i, naptr_reply_to_js(node, global_this))?;
        naptr = node.next;
        i += 1;
    }

    Ok(array)
}

pub fn naptr_reply_to_js(
    this: &mut c_ares::struct_ares_naptr_reply,
    global_this: &JSGlobalObject,
) -> JSValue {
    let obj = JSValue::create_empty_object(global_this, 6);

    obj.put(global_this, b"preference", JSValue::js_number(this.preference as f64));
    obj.put(global_this, b"order", JSValue::js_number(this.order as f64));

    // SAFETY: flags is a non-null NUL-terminated C string from c-ares.
    let flags = unsafe { CStr::from_ptr(this.flags as *const c_char) }.to_bytes();
    obj.put(global_this, b"flags", utf8_to_js(global_this, flags));

    // SAFETY: service is a non-null NUL-terminated C string from c-ares.
    let service = unsafe { CStr::from_ptr(this.service as *const c_char) }.to_bytes();
    obj.put(global_this, b"service", utf8_to_js(global_this, service));

    // SAFETY: regexp is a non-null NUL-terminated C string from c-ares.
    let regexp = unsafe { CStr::from_ptr(this.regexp as *const c_char) }.to_bytes();
    obj.put(global_this, b"regexp", utf8_to_js(global_this, regexp));

    // SAFETY: replacement is a non-null NUL-terminated C string from c-ares.
    let replacement = unsafe { CStr::from_ptr(this.replacement as *const c_char) }.to_bytes();
    obj.put(global_this, b"replacement", utf8_to_js(global_this, replacement));

    obj
}

// ── struct_ares_soa_reply ──────────────────────────────────────────────────
pub fn soa_reply_to_js_response(
    this: &mut c_ares::struct_ares_soa_reply,
    global_this: &JSGlobalObject,
    _lookup_name: &'static [u8],
) -> JsResult<JSValue> {
    // PERF(port): was stack-fallback + arena bulk-free — profile in Phase B
    Ok(soa_reply_to_js(this, global_this))
}

pub fn soa_reply_to_js(
    this: &mut c_ares::struct_ares_soa_reply,
    global_this: &JSGlobalObject,
) -> JSValue {
    let obj = JSValue::create_empty_object(global_this, 7);

    obj.put(global_this, b"serial", JSValue::js_number(this.serial as f64));
    obj.put(global_this, b"refresh", JSValue::js_number(this.refresh as f64));
    obj.put(global_this, b"retry", JSValue::js_number(this.retry as f64));
    obj.put(global_this, b"expire", JSValue::js_number(this.expire as f64));
    obj.put(global_this, b"minttl", JSValue::js_number(this.minttl as f64));

    // SAFETY: nsname is a non-null NUL-terminated C string from c-ares.
    let nsname = unsafe { CStr::from_ptr(this.nsname as *const c_char) }.to_bytes();
    obj.put(global_this, b"nsname", utf8_to_js(global_this, nsname));

    // SAFETY: hostmaster is a non-null NUL-terminated C string from c-ares.
    let hostmaster = unsafe { CStr::from_ptr(this.hostmaster as *const c_char) }.to_bytes();
    obj.put(global_this, b"hostmaster", utf8_to_js(global_this, hostmaster));

    obj
}

// ── struct_any_reply ───────────────────────────────────────────────────────
pub fn any_reply_to_js_response(
    this: &mut c_ares::struct_any_reply,
    global_this: &JSGlobalObject,
    _lookup_name: &'static [u8],
) -> JsResult<JSValue> {
    // PERF(port): was stack-fallback + arena bulk-free — profile in Phase B
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
        // PORT NOTE: Zig used `JSObject.create(.{ .value = response }, global)`. No
        // anon-struct builder on `bun_jsc::JSObject`; use `create_empty_object` + `put`.
        let obj = JSValue::create_empty_object(global_this, 1);
        obj.put(global_this, b"value", response);
        obj
    } else {
        debug_assert!(response.is_object());
        response
    };

    // PERF(port): was comptime ASCII-uppercase of lookup_name — profile in Phase B
    let mut upper = [0u8; 16];
    let upper = &mut upper[..lookup_name.len()];
    for (dst, &src) in upper.iter_mut().zip(lookup_name) {
        *dst = src.to_ascii_uppercase();
    }

    transformed.put(global_this, b"type", bstr::String::ascii(upper).to_js(global_this)?);
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
    // PORT NOTE: Zig used `reply: anytype` + `@hasDecl(.., "toJSForAny")` to dispatch between
    // `toJSForAny` (only `txt`) and `toJSResponse` (everything else). The caller now computes
    // `response` and passes it in directly — see any_reply_to_js below.
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

pub fn any_reply_to_js(
    this: &mut c_ares::struct_any_reply,
    global_this: &JSGlobalObject,
) -> JsResult<JSValue> {
    // TODO(port): @typeInfo reflection over struct_any_reply fields ending in "_reply".
    // Phase B must enumerate the actual *_reply fields on c_ares::struct_any_reply and
    // expand the two loops below per-field. Sketch (replace `any_reply_fields!` with the
    // manual expansion or a macro_rules! over the known field list):
    //
    //   for each field `${name}_reply: Option<&mut T>`:
    //     len += this.${name}_reply.is_some() as usize;
    //   ...
    //   if let Some(reply) = this.${name}_reply {
    //     let response = if name == "txt" {
    //       txt_reply_to_js_for_any(reply, global_this, b"txt")?
    //     } else {
    //       ${name}_reply_to_js_response(reply, global_this, b"${name}")?
    //     };
    //     any_reply_append_all(global_this, array, &mut i, response, b"${name}")?;
    //   }
    let array = JSValue::create_empty_array(global_this, {
        let mut len: usize = 0;
        // TODO(port): expand per *_reply field
        let _ = &mut len;
        let _ = &this;
        len
    })?;

    let mut i: u32 = 0;
    // TODO(port): expand per *_reply field
    let _ = &mut i;

    Ok(array)
}

// ── Error ──────────────────────────────────────────────────────────────────
pub struct ErrorDeferred {
    pub errno: c_ares::Error,
    pub syscall: &'static [u8],
    pub hostname: Option<bstr::String>,
    pub promise: bun_jsc::JSPromiseStrong,
}

impl ErrorDeferred {
    pub fn init(
        errno: c_ares::Error,
        syscall: &'static [u8],
        hostname: Option<bstr::String>,
        promise: bun_jsc::JSPromiseStrong,
    ) -> Box<ErrorDeferred> {
        Box::new(ErrorDeferred { errno, syscall, hostname, promise })
    }

    pub fn reject(mut self: Box<Self>, global_this: &JSGlobalObject) -> JsResult<()> {
        let code = self.errno.code();
        // TODO(port): bun.String.createFormat used Zig {f} spec for bun.String — verify Display impl
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
            path: bstr::String::empty(),
            fd: -1,
            dest: bstr::String::empty(),
        };

        // SAFETY: sole `&mut JSPromise` borrow; consumed immediately as `&JSPromise`.
        let instance = system_error.to_error_instance_with_async_stack(global_this, unsafe { self.promise.get() });
        instance.put(global_this, b"name", bstr::String::static_(b"DNSException").to_js(global_this)?);

        // `self` (and thus self.promise / self.hostname) drops at scope exit — matches
        // Zig's `defer this.deinit()`; hostname was `take()`n above to avoid double-deref.
        Ok(self.promise.reject(global_this, Ok(instance))?)
    }

    pub fn reject_later(self: Box<Self>, global_this: &JSGlobalObject) {
        struct Context {
            deferred: Box<ErrorDeferred>,
            // TODO(port): lifetime — LIFETIMES.tsv row 1403 says JSC_BORROW → `&JSGlobalObject`,
            // but this Box<Context> crosses an event-loop tick via enqueue_task (needs 'static).
            // Stored as raw and re-borrowed in callback; Phase B to reconcile with TSV.
            global_this: *const JSGlobalObject,
        }
        impl Context {
            // PORT NOTE: `bun_event_loop::ManagedTask::new` expects
            // `fn(*mut T) -> bun_event_loop::JsResult<()>` (low-tier `ErasedJsError`).
            fn callback(this: *mut Context) -> bun_event_loop::JsResult<()> {
                // SAFETY: `this` is the Box::into_raw'd pointer passed to ManagedTask::new
                // below; ManagedTask::run calls us exactly once with that pointer.
                let this = unsafe { Box::from_raw(this) };
                // SAFETY: global_this outlives the enqueued task (VM-owned).
                let global = unsafe { &*this.global_this };
                let _ = this.deferred.reject(global);
                Ok(())
            }
        }

        let context = Box::into_raw(Box::new(Context {
            deferred: self,
            global_this: global_this as *const _,
        }));
        // TODO(@heimskr): new custom Task type
        // SAFETY: `bun_vm()` returns a non-null VM pointer (VM-owned for the lifetime of
        // the JSGlobalObject).
        unsafe { &mut *global_this.bun_vm() }
            .enqueue_task(bun_jsc::ManagedTask::ManagedTask::new(context, Context::callback));
    }
}

// Drop: hostname (bun_str::String) and promise (JSPromiseStrong) drop their own resources.
// Zig's deinit() additionally did `bun.destroy(this)` — handled by Box drop at the call site.

pub fn error_to_deferred(
    this: c_ares::Error,
    syscall: &'static [u8],
    hostname: Option<&[u8]>,
    promise: &mut bun_jsc::JSPromiseStrong,
) -> Box<ErrorDeferred> {
    let host_string: Option<bstr::String> = hostname.map(bstr::String::clone_utf8);
    let taken = core::mem::take(promise);
    ErrorDeferred::init(this, syscall, host_string, taken)
}

pub fn error_to_js_with_syscall(
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
        hostname: bstr::String::empty(),
        path: bstr::String::empty(),
        fd: -1,
        dest: bstr::String::empty(),
    }
    .to_error_instance(global_this);
    instance.put(global_this, b"name", bstr::String::static_(b"DNSException").to_js(global_this)?);
    Ok(instance)
}

pub fn error_to_js_with_syscall_and_hostname(
    this: c_ares::Error,
    global_this: &JSGlobalObject,
    syscall: &'static [u8],
    hostname: &[u8],
) -> JsResult<JSValue> {
    let code = this.code();
    let instance = SystemError {
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
        path: bstr::String::empty(),
        fd: -1,
        dest: bstr::String::empty(),
    }
    .to_error_instance(global_this);
    instance.put(global_this, b"name", bstr::String::static_(b"DNSException").to_js(global_this)?);
    Ok(instance)
}

// ── canonicalizeIP host fn ─────────────────────────────────────────────────
// TODO(port): verify #[bun_jsc::host_fn] supports export_name; Zig used
// `@export(&jsc.toJSHostFn(Bun__canonicalizeIP_), .{ .name = "Bun__canonicalizeIP" })`.
#[bun_jsc::host_fn]
#[unsafe(export_name = "Bun__canonicalizeIP")]
pub fn bun_canonicalize_ip(
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
    // windows uses 65 bytes for ipv6 addresses and linux/macos uses 46
    const INET6_ADDRSTRLEN: usize = if cfg!(windows) { 65 } else { 46 };

    let addr_arg = arguments[0].to_slice(global_this)?;
    let addr_str = addr_arg.slice();
    if addr_str.len() >= INET6_ADDRSTRLEN {
        return Ok(JSValue::UNDEFINED);
    }

    // CIDR not allowed
    if strings::index_of_char(addr_str, b'/').is_some() {
        return Ok(JSValue::UNDEFINED);
    }

    let mut ip_binary = [0u8; 16]; // 16 bytes is enough for both IPv4 and IPv6

    // we need a null terminated string as input
    let mut ip_addr = [0u8; INET6_ADDRSTRLEN + 1];
    ip_addr[..addr_str.len()].copy_from_slice(addr_str);
    ip_addr[addr_str.len()] = 0;

    let mut af: c_int = c_ares::AF::INET;
    // get the binary representation of the IP
    // SAFETY: ip_addr is NUL-terminated; ip_binary is 16 bytes.
    if unsafe { c_ares::ares_inet_pton(af, ip_addr.as_ptr() as *const c_char, ip_binary.as_mut_ptr().cast()) } != 1 {
        af = c_ares::AF::INET6;
        // SAFETY: same as above.
        if unsafe { c_ares::ares_inet_pton(af, ip_addr.as_ptr() as *const c_char, ip_binary.as_mut_ptr().cast()) } != 1 {
            return Ok(JSValue::UNDEFINED);
        }
    }
    // ip_addr will contain the null-terminated string of the canonicalized IP
    // SAFETY: ip_binary holds a valid in_addr/in6_addr; ip_addr has INET6_ADDRSTRLEN+1 bytes.
    if unsafe {
        c_ares::ares_inet_ntop(
            af,
            ip_binary.as_ptr().cast(),
            ip_addr.as_mut_ptr(),
            core::mem::size_of_val(&ip_addr) as _,
        )
    }
    .is_null()
    {
        return Ok(JSValue::UNDEFINED);
    }
    // use the null-terminated size to return the string
    let slice = bun_str::slice_to_nul(&ip_addr);
    if addr_str == slice {
        return Ok(arguments[0]);
    }

    bun_string_jsc::create_utf8_for_js(global_this, slice)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/dns_jsc/cares_jsc.zig (612 lines)
//   confidence: medium
//   todos:      11
//   notes:      any_reply_to_js needs manual @typeInfo field expansion; bun_dns::Address/sockaddr types and JSObject::create_with builder are guessed; comptime lookup_name demoted to runtime &'static [u8].
// ──────────────────────────────────────────────────────────────────────────
