//! JSC bridges for c-ares reply structs. Keeps `src/cares_sys/` free of
//! `JSValue`/`JSGlobalObject`/`CallFrame` types — the original methods on
//! each `struct_ares_*_reply` are aliased to the free fns here.

use core::ffi::c_int;

use ::bstr::BStr;
use bun_cares_sys::c_ares_draft as c_ares;
use bun_core::{self as bstr, strings};
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
    this: &c_ares::struct_hostent,
    global_this: &JSGlobalObject,
    lookup_name: &'static [u8], // PERF: could be monomorphized per lookup name — profile if hot
) -> JsResult<JSValue> {
    if lookup_name == b"cname" {
        // A cname lookup always returns a single record but we follow the common API here.
        let Some(name) = this.name() else {
            return JSValue::create_empty_array(global_this, 0);
        };
        return bun_string_jsc::to_js_array(global_this, &[bstr::String::borrow_utf8(name)]);
    }

    if !this.has_aliases() {
        return JSValue::create_empty_array(global_this, 0);
    }

    let array = JSValue::create_empty_array(global_this, this.aliases().count())?;

    for (i, alias) in (0u32..).zip(this.aliases()) {
        array.put_index(global_this, i, utf8_to_js(global_this, alias)?)?;
    }

    Ok(array)
}

// ── hostent_with_ttls ──────────────────────────────────────────────────────
pub(crate) fn hostent_with_ttls_to_js_response(
    this: &c_ares::hostent_with_ttls,
    global_this: &JSGlobalObject,
    lookup_name: &'static [u8], // PERF: could be monomorphized per lookup name — profile if hot
) -> JsResult<JSValue> {
    if lookup_name == b"a" || lookup_name == b"aaaa" {
        let hostent = &*this.hostent;
        if !hostent.has_addr_list() {
            return JSValue::create_empty_array(global_this, 0);
        }

        let array = JSValue::create_empty_array(global_this, hostent.addresses().count())?;

        for (count, addr) in (0u32..).zip(hostent.addresses()) {
            let addr_string = {
                let ip: std::net::IpAddr = if hostent.addrtype() == c_ares::AF::INET6 {
                    <[u8; 16]>::try_from(addr)
                        .map_or(std::net::Ipv6Addr::UNSPECIFIED, std::net::Ipv6Addr::from)
                        .into()
                } else {
                    <[u8; 4]>::try_from(addr)
                        .map_or(std::net::Ipv4Addr::UNSPECIFIED, std::net::Ipv4Addr::from)
                        .into()
                };
                let address = bun_dns::Address::from_ip(ip, 0);
                match address_to_js(&address, global_this) {
                    Ok(v) => v,
                    Err(_) => return Ok(global_this.throw_out_of_memory_value()),
                }
            };

            let ttl: Option<c_int> = this.ttls.get(count as usize).copied();
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
        }

        Ok(array)
    } else {
        // Callers guarantee only "a"/"aaaa" reach here.
        unreachable!("Unsupported hostent_with_ttls record type");
    }
}

// ── NameInfo ───────────────────────────────────────────────────────────────
pub(crate) fn nameinfo_to_js_response(
    this: &c_ares::NameInfo<'_>,
    global_this: &JSGlobalObject,
) -> JsResult<JSValue> {
    let array = JSValue::create_empty_array(global_this, 2)?; // [node, service]

    if let Some(node) = this.node {
        array.put_index(global_this, 0, utf8_to_js(global_this, node)?)?;
    } else {
        array.put_index(global_this, 0, JSValue::UNDEFINED)?;
    }

    if let Some(service) = this.service {
        array.put_index(global_this, 1, utf8_to_js(global_this, service)?)?;
    } else {
        array.put_index(global_this, 1, JSValue::UNDEFINED)?;
    }

    Ok(array)
}

// ── AddrInfo ───────────────────────────────────────────────────────────────
pub(crate) fn addr_info_to_js_array(
    addr_info: &c_ares::AddrInfo,
    global_this: &JSGlobalObject,
) -> JsResult<JSValue> {
    let array = JSValue::create_empty_array(global_this, addr_info.nodes().count())?;

    for (j, this_node) in (0u32..).zip(addr_info.nodes()) {
        debug_assert!(
            this_node.family == c_ares::AF::INET || this_node.family == c_ares::AF::INET6
        );
        let address = bun_dns::Address::from_sockaddr_bytes(this_node.sockaddr_bytes())
            .unwrap_or_else(|| {
                bun_dns::Address::from_ip(std::net::Ipv4Addr::UNSPECIFIED.into(), 0)
            });
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
    }

    Ok(array)
}

// ── shared walk → JS array helper ──────────────────────────────────────────
//
// Every `struct_ares_*_reply` is an intrusive singly-linked list; the two-pass
// walk (count, then `create_empty_array` + `put_index`) is done once here.

fn cares_list_to_js_array<'a, T: 'a>(
    iter: impl Iterator<Item = &'a T> + Clone,
    global_this: &JSGlobalObject,
    mut to_js: impl FnMut(&T, &JSGlobalObject) -> JsResult<JSValue>,
) -> JsResult<JSValue> {
    let array = JSValue::create_empty_array(global_this, iter.clone().count())?;

    for (i, node) in (0u32..).zip(iter) {
        array.put_index(global_this, i, to_js(node, global_this)?)?;
    }

    Ok(array)
}

// ── struct_ares_caa_reply ──────────────────────────────────────────────────
pub(crate) fn caa_reply_to_js_response(
    this: &c_ares::struct_ares_caa_reply,
    global_this: &JSGlobalObject,
    _lookup_name: &'static [u8],
) -> JsResult<JSValue> {
    cares_list_to_js_array(this.iter(), global_this, caa_reply_to_js)
}

fn caa_reply_to_js(
    this: &c_ares::struct_ares_caa_reply,
    global_this: &JSGlobalObject,
) -> JsResult<JSValue> {
    let obj = JSValue::create_empty_object(global_this, 2);

    obj.put(
        global_this,
        b"critical",
        JSValue::js_number(this.critical as f64),
    );

    let property = bstr::String::borrow_utf8(this.property_bytes());
    let value = this.value_bytes();
    obj.put_may_be_index(global_this, &property, utf8_to_js(global_this, value)?)?;

    Ok(obj)
}

// ── struct_ares_srv_reply ──────────────────────────────────────────────────
pub(crate) fn srv_reply_to_js_response(
    this: &c_ares::struct_ares_srv_reply,
    global_this: &JSGlobalObject,
    _lookup_name: &'static [u8],
) -> JsResult<JSValue> {
    cares_list_to_js_array(this.iter(), global_this, srv_reply_to_js)
}

fn srv_reply_to_js(
    this: &c_ares::struct_ares_srv_reply,
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

    obj.put(
        global_this,
        b"name",
        utf8_to_js(global_this, this.host_bytes())?,
    );

    Ok(obj)
}

// ── struct_ares_mx_reply ───────────────────────────────────────────────────
pub(crate) fn mx_reply_to_js_response(
    this: &c_ares::struct_ares_mx_reply,
    global_this: &JSGlobalObject,
    _lookup_name: &'static [u8],
) -> JsResult<JSValue> {
    cares_list_to_js_array(this.iter(), global_this, mx_reply_to_js)
}

fn mx_reply_to_js(
    this: &c_ares::struct_ares_mx_reply,
    global_this: &JSGlobalObject,
) -> JsResult<JSValue> {
    let obj = JSValue::create_empty_object(global_this, 2);
    obj.put(
        global_this,
        b"priority",
        JSValue::js_number(this.priority as f64),
    );

    obj.put(
        global_this,
        b"exchange",
        utf8_to_js(global_this, this.host_bytes())?,
    );

    Ok(obj)
}

// ── struct_ares_txt_reply ──────────────────────────────────────────────────
pub(crate) fn txt_reply_to_js_response(
    this: &c_ares::struct_ares_txt_reply,
    global_this: &JSGlobalObject,
    _lookup_name: &'static [u8],
) -> JsResult<JSValue> {
    cares_list_to_js_array(this.iter(), global_this, txt_reply_to_js)
}

fn txt_reply_to_js(
    this: &c_ares::struct_ares_txt_reply,
    global_this: &JSGlobalObject,
) -> JsResult<JSValue> {
    let array = JSValue::create_empty_array(global_this, 1)?;
    let value = this.txt_bytes();
    array.put_index(global_this, 0, utf8_to_js(global_this, value)?)?;
    Ok(array)
}

fn txt_reply_to_js_for_any(
    this: &c_ares::struct_ares_txt_reply,
    global_this: &JSGlobalObject,
    _lookup_name: &'static [u8],
) -> JsResult<JSValue> {
    let array = cares_list_to_js_array(this.iter(), global_this, |node, g| {
        utf8_to_js(g, node.txt_bytes())
    })?;
    let obj = JSValue::create_empty_object(global_this, 1);
    obj.put(global_this, b"entries", array);
    Ok(obj)
}

// ── struct_ares_naptr_reply ────────────────────────────────────────────────
pub(crate) fn naptr_reply_to_js_response(
    this: &c_ares::struct_ares_naptr_reply,
    global_this: &JSGlobalObject,
    _lookup_name: &'static [u8],
) -> JsResult<JSValue> {
    cares_list_to_js_array(this.iter(), global_this, naptr_reply_to_js)
}

fn naptr_reply_to_js(
    this: &c_ares::struct_ares_naptr_reply,
    global_this: &JSGlobalObject,
) -> JsResult<JSValue> {
    let obj = JSValue::create_empty_object(global_this, 6);

    obj.put(
        global_this,
        b"preference",
        JSValue::js_number(this.preference as f64),
    );
    obj.put(global_this, b"order", JSValue::js_number(this.order as f64));

    obj.put(
        global_this,
        b"flags",
        utf8_to_js(global_this, this.flags_bytes())?,
    );
    obj.put(
        global_this,
        b"service",
        utf8_to_js(global_this, this.service_bytes())?,
    );
    obj.put(
        global_this,
        b"regexp",
        utf8_to_js(global_this, this.regexp_bytes())?,
    );
    obj.put(
        global_this,
        b"replacement",
        utf8_to_js(global_this, this.replacement_bytes())?,
    );

    Ok(obj)
}

// ── struct_ares_soa_reply ──────────────────────────────────────────────────
pub(crate) fn soa_reply_to_js_response(
    this: &c_ares::struct_ares_soa_reply,
    global_this: &JSGlobalObject,
    _lookup_name: &'static [u8],
) -> JsResult<JSValue> {
    // PERF: a stack-fallback buffer + arena bulk-free could help — profile if hot
    soa_reply_to_js(this, global_this)
}

fn soa_reply_to_js(
    this: &c_ares::struct_ares_soa_reply,
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

    obj.put(
        global_this,
        b"nsname",
        utf8_to_js(global_this, this.nsname_bytes())?,
    );
    obj.put(
        global_this,
        b"hostmaster",
        utf8_to_js(global_this, this.hostmaster_bytes())?,
    );

    Ok(obj)
}

// ── struct_any_reply ───────────────────────────────────────────────────────
pub(crate) fn any_reply_to_js_response(
    this: &c_ares::struct_any_reply,
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

fn any_reply_to_js(
    this: &c_ares::struct_any_reply,
    global_this: &JSGlobalObject,
) -> JsResult<JSValue> {
    // The field set is expanded manually here. Keep in lockstep with
    // `c_ares::struct_any_reply`'s fields.
    let len: usize = this.a_reply.is_some() as usize
        + this.aaaa_reply.is_some() as usize
        + this.mx_reply.is_some() as usize
        + this.ns_reply.is_some() as usize
        + this.txt_reply.is_some() as usize
        + this.srv_reply.is_some() as usize
        + this.ptr_reply.is_some() as usize
        + this.naptr_reply.is_some() as usize
        + this.soa_reply.is_some() as usize
        + this.caa_reply.is_some() as usize;

    let array = JSValue::create_empty_array(global_this, len)?;
    let mut i: u32 = 0;

    if let Some(reply) = this.a_reply.as_deref() {
        let response = hostent_with_ttls_to_js_response(reply, global_this, b"a")?;
        any_reply_append_all(global_this, array, &mut i, response, b"a")?;
    }
    if let Some(reply) = this.aaaa_reply.as_deref() {
        let response = hostent_with_ttls_to_js_response(reply, global_this, b"aaaa")?;
        any_reply_append_all(global_this, array, &mut i, response, b"aaaa")?;
    }
    if let Some(reply) = this.mx_reply.as_deref() {
        let response = mx_reply_to_js_response(reply, global_this, b"mx")?;
        any_reply_append_all(global_this, array, &mut i, response, b"mx")?;
    }
    if let Some(reply) = this.ns_reply.as_deref() {
        let response = hostent_to_js_response(reply, global_this, b"ns")?;
        any_reply_append_all(global_this, array, &mut i, response, b"ns")?;
    }
    if let Some(reply) = this.txt_reply.as_deref() {
        // txt is the only reply type with the `to_js_for_any` shape (an `entries`
        // wrapper object) instead of the plain `to_js_response` shape.
        let response = txt_reply_to_js_for_any(reply, global_this, b"txt")?;
        any_reply_append_all(global_this, array, &mut i, response, b"txt")?;
    }
    if let Some(reply) = this.srv_reply.as_deref() {
        let response = srv_reply_to_js_response(reply, global_this, b"srv")?;
        any_reply_append_all(global_this, array, &mut i, response, b"srv")?;
    }
    if let Some(reply) = this.ptr_reply.as_deref() {
        let response = hostent_to_js_response(reply, global_this, b"ptr")?;
        any_reply_append_all(global_this, array, &mut i, response, b"ptr")?;
    }
    if let Some(reply) = this.naptr_reply.as_deref() {
        let response = naptr_reply_to_js_response(reply, global_this, b"naptr")?;
        any_reply_append_all(global_this, array, &mut i, response, b"naptr")?;
    }
    if let Some(reply) = this.soa_reply.as_deref() {
        let response = soa_reply_to_js_response(reply, global_this, b"soa")?;
        any_reply_append_all(global_this, array, &mut i, response, b"soa")?;
    }
    if let Some(reply) = this.caa_reply.as_deref() {
        let response = caa_reply_to_js_response(reply, global_this, b"caa")?;
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
    fn init(
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

    fn reject(mut self, global_this: &JSGlobalObject) -> JsResult<()> {
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
            hostname: self.hostname.take().unwrap_or(bstr::String::EMPTY),
            ..Default::default()
        };

        let instance =
            system_error.to_error_instance_with_async_stack(global_this, self.promise.get());
        instance.put(
            global_this,
            b"name",
            bstr::String::static_("DNSException").to_js(global_this)?,
        );

        // `self` (and thus self.promise / self.hostname) drops at scope exit;
        // hostname was `take()`n above to avoid double-deref.
        self.promise.reject(global_this, Ok(instance))
    }

    pub(crate) fn reject_later(self: Box<Self>, global_this: &JSGlobalObject) {
        struct Context {
            deferred: Box<ErrorDeferred>,
            // LIFETIMES.tsv row 1403: JSC_BORROW — the global outlives the
            // enqueued task (VM-owned), so a `BackRef` captures the invariant.
            global_this: bun_ptr::BackRef<JSGlobalObject>,
        }
        impl bun_event_loop::ManagedTask::RunOnce for Context {
            fn run(self) -> bun_event_loop::JsResult<()> {
                let global = self.global_this.get();
                self.deferred.reject(global)
            }
        }

        let vm = global_this.bun_vm();
        // Worker terminate's `stop_dns_for_vm_teardown` fires EDESTRUCTION with
        // `is_shutting_down` already set; the task queue is about to be
        // drained-without-run, so enqueuing would only defer dropping the
        // `Context` and its `JSPromiseStrong`. Drop now while JSC is still
        // live so the Strong handle releases cleanly.
        if vm.is_shutting_down() {
            return;
        }

        let context = Box::new(Context {
            deferred: self,
            global_this: bun_ptr::BackRef::new(global_this),
        });
        // TODO(@heimskr): new custom Task type
        vm.as_mut()
            .enqueue_task(bun_jsc::ManagedTask::ManagedTask::new_boxed(context));
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
        bstr::String::static_("DNSException").to_js(global_this)?,
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
        bstr::String::static_("DNSException").to_js(global_this)?,
    );
    Ok(instance)
}

/// Thrown before uSockets' synchronous `getaddrinfo` can block on a name that can never resolve.
pub(crate) fn not_a_hostname_error(global_this: &JSGlobalObject, hostname: &[u8]) -> JSValue {
    system_error_with_syscall_and_hostname(c_ares::Error::ENOTFOUND, b"getaddrinfo", hostname)
        .to_error_instance(global_this)
}

// ── canonicalizeIP host fn ─────────────────────────────────────────────────
// `#[bun_jsc::host_fn(export = ...)]` emits the C-ABI shim under that link name.
#[bun_jsc::host_fn(export = "Bun__canonicalizeIP")]
fn bun_canonicalize_ip(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    bun_jsc::mark_binding!();

    let arguments = callframe.arguments();

    if arguments.is_empty() {
        return Err(global_this.throw_invalid_arguments(format_args!(
            "canonicalizeIP() expects a string but received no arguments."
        )));
    }

    let addr_arg = arguments[0].to_utf8(global_this)?;
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
