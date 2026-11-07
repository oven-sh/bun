//! The resolver's answers and errors as JS values.

use ::bstr::BStr;
use bun_core as bstr;
use bun_dns::Error;
use bun_dns_resolver::addr_info::AddrInfo;
use bun_dns_resolver::reply::{Address, Addresses, AnyReply, Caa, Mx, Naptr, Reply, Soa, Srv};
use bun_dns_resolver::{Answer, Host, NameInfo};
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{JSGlobalObject, JSValue, JsResult, StringJsc, SystemError, bun_string_jsc};

use crate::dns_jsc::options_jsc::result_to_js;

#[inline]
fn utf8_to_js(global: &JSGlobalObject, bytes: &[u8]) -> JsResult<JSValue> {
    bun_string_jsc::create_utf8_for_js(global, bytes)
}

fn array_of<T>(
    global: &JSGlobalObject,
    items: &[T],
    mut to_js: impl FnMut(&T, &JSGlobalObject) -> JsResult<JSValue>,
) -> JsResult<JSValue> {
    let array = JSValue::create_empty_array(global, items.len())?;
    for (i, item) in items.iter().enumerate() {
        array.put_index(global, i as u32, to_js(item, global)?)?;
    }
    Ok(array)
}

fn names_to_js(names: &[Vec<u8>], global: &JSGlobalObject) -> JsResult<JSValue> {
    array_of(global, names, |name, global| utf8_to_js(global, name))
}

/// `{ address, ttl }`.
fn address_to_js(address: &Address, global: &JSGlobalObject) -> JsResult<JSValue> {
    let object = JSValue::create_empty_object(global, 2);
    let text = bun_core::ip_address::format(address.address);
    object.put(global, b"address", utf8_to_js(global, &text)?);
    let ttl = address.ttl.map(|ttl| JSValue::js_number(f64::from(ttl)));
    object.put(global, b"ttl", ttl.unwrap_or(JSValue::UNDEFINED));
    Ok(object)
}

fn caa_to_js(caa: &Caa, global: &JSGlobalObject) -> JsResult<JSValue> {
    let object = JSValue::create_empty_object(global, 2);
    object.put(
        global,
        b"critical",
        JSValue::js_number(f64::from(caa.critical)),
    );
    let property = bstr::StringView::borrow_utf8(&caa.tag);
    object.put_may_be_index(global, &property, utf8_to_js(global, &caa.value)?)?;
    Ok(object)
}

fn srv_to_js(srv: &Srv, global: &JSGlobalObject) -> JsResult<JSValue> {
    let object = JSValue::create_empty_object(global, 4);
    object.put(
        global,
        b"priority",
        JSValue::js_number(f64::from(srv.priority)),
    );
    object.put(global, b"weight", JSValue::js_number(f64::from(srv.weight)));
    object.put(global, b"port", JSValue::js_number(f64::from(srv.port)));
    object.put(global, b"name", utf8_to_js(global, &srv.target)?);
    Ok(object)
}

fn mx_to_js(mx: &Mx, global: &JSGlobalObject) -> JsResult<JSValue> {
    let object = JSValue::create_empty_object(global, 2);
    object.put(
        global,
        b"priority",
        JSValue::js_number(f64::from(mx.preference)),
    );
    object.put(global, b"exchange", utf8_to_js(global, &mx.exchange)?);
    Ok(object)
}

fn naptr_to_js(naptr: &Naptr, global: &JSGlobalObject) -> JsResult<JSValue> {
    let object = JSValue::create_empty_object(global, 6);
    object.put(
        global,
        b"preference",
        JSValue::js_number(f64::from(naptr.preference)),
    );
    object.put(global, b"order", JSValue::js_number(f64::from(naptr.order)));
    object.put(global, b"flags", utf8_to_js(global, &naptr.flags)?);
    object.put(global, b"service", utf8_to_js(global, &naptr.services)?);
    object.put(global, b"regexp", utf8_to_js(global, &naptr.regexp)?);
    object.put(
        global,
        b"replacement",
        utf8_to_js(global, &naptr.replacement)?,
    );
    Ok(object)
}

fn soa_to_js(soa: &Soa, global: &JSGlobalObject) -> JsResult<JSValue> {
    let object = JSValue::create_empty_object(global, 7);
    object.put(global, b"serial", JSValue::js_number(f64::from(soa.serial)));
    object.put(
        global,
        b"refresh",
        JSValue::js_number(f64::from(soa.refresh)),
    );
    object.put(global, b"retry", JSValue::js_number(f64::from(soa.retry)));
    object.put(global, b"expire", JSValue::js_number(f64::from(soa.expire)));
    object.put(
        global,
        b"minttl",
        JSValue::js_number(f64::from(soa.minimum)),
    );
    object.put(global, b"nsname", utf8_to_js(global, &soa.mname)?);
    object.put(global, b"hostmaster", utf8_to_js(global, &soa.rname)?);
    Ok(object)
}

/// `dns.resolveAny()`'s array: every record as an object with its `type`.
struct AnyRecords<'a> {
    global: &'a JSGlobalObject,
    array: JSValue,
    len: u32,
}

impl AnyRecords<'_> {
    /// A bare string goes under `value`.
    fn push(&mut self, record: JSValue, type_name: &'static str) -> JsResult<()> {
        let global = self.global;
        let object = if record.is_string() {
            let object = JSValue::create_empty_object(global, 2);
            object.put(global, b"value", record);
            object
        } else {
            record
        };
        object.put(
            global,
            b"type",
            bstr::String::static_(type_name).to_js(global)?,
        );
        self.array.put_index(global, self.len, object)?;
        self.len += 1;
        Ok(())
    }

    fn extend<T>(
        &mut self,
        records: Option<&[T]>,
        type_name: &'static str,
        to_js: impl Fn(&T, &JSGlobalObject) -> JsResult<JSValue>,
    ) -> JsResult<()> {
        for record in records.unwrap_or_default() {
            self.push(to_js(record, self.global)?, type_name)?;
        }
        Ok(())
    }
}

fn any_to_js(any: &AnyReply, global: &JSGlobalObject) -> JsResult<JSValue> {
    let mut records = AnyRecords {
        global,
        array: JSValue::create_empty_array(global, 0)?,
        len: 0,
    };
    let name_to_js = |name: &Vec<u8>, global: &JSGlobalObject| utf8_to_js(global, name);
    fn list(reply: &Option<Addresses>) -> Option<&[Address]> {
        reply.as_ref().map(|it| it.addresses.as_slice())
    }
    records.extend(list(&any.a), "A", address_to_js)?;
    records.extend(list(&any.aaaa), "AAAA", address_to_js)?;
    records.extend(any.mx.as_deref(), "MX", mx_to_js)?;
    records.extend(any.ns.as_deref(), "NS", name_to_js)?;
    if let Some(txt) = any.txt.as_ref().filter(|txt| !txt.is_empty()) {
        let object = JSValue::create_empty_object(global, 2);
        object.put(global, b"entries", names_to_js(txt, global)?);
        records.push(object, "TXT")?;
    }
    records.extend(any.srv.as_deref(), "SRV", srv_to_js)?;
    records.extend(any.ptr.as_deref(), "PTR", name_to_js)?;
    records.extend(any.naptr.as_deref(), "NAPTR", naptr_to_js)?;
    records.extend(
        any.soa.as_ref().map(core::slice::from_ref),
        "SOA",
        soa_to_js,
    )?;
    records.extend(any.caa.as_deref(), "CAA", caa_to_js)?;
    Ok(records.array)
}

fn reply_to_js(reply: &Reply, global: &JSGlobalObject) -> JsResult<JSValue> {
    match reply {
        Reply::Addresses(addresses) => array_of(global, &addresses.addresses, address_to_js),
        Reply::Any(any) => any_to_js(any, global),
        Reply::Caa(caa) => array_of(global, caa, caa_to_js),
        Reply::Mx(mx) => array_of(global, mx, mx_to_js),
        Reply::Naptr(naptr) => array_of(global, naptr, naptr_to_js),
        Reply::Names(names) => names_to_js(names, global),
        Reply::Soa(soa) => soa_to_js(soa, global),
        Reply::Srv(srv) => array_of(global, srv, srv_to_js),
        Reply::Txt(strings) => array_of(global, strings, |string, global| {
            names_to_js(core::slice::from_ref(string), global)
        }),
    }
}

fn addr_info_to_js(info: &AddrInfo, global: &JSGlobalObject) -> JsResult<JSValue> {
    array_of(global, &info.nodes, |node, global| {
        result_to_js(
            &bun_dns::GetAddrInfoResult {
                address: bun_dns::Address::from_ip(node.address, node.port),
                ttl: node.ttl,
            },
            global,
        )
    })
}

/// `[node, service]`.
fn name_info_to_js(info: &NameInfo, global: &JSGlobalObject) -> JsResult<JSValue> {
    let array = JSValue::create_empty_array(global, 2)?;
    array.put_index(global, 0, utf8_to_js(global, &info.node)?)?;
    let service = match &info.service {
        Some(service) => utf8_to_js(global, service)?,
        None => JSValue::UNDEFINED,
    };
    array.put_index(global, 1, service)?;
    Ok(array)
}

/// True of an answer that has records, none of them of the type asked for, which is reported as `ENOTFOUND`.
pub(crate) fn is_empty(answer: &Answer) -> bool {
    match answer {
        Answer::Reply(Reply::Caa(list)) => list.is_empty(),
        Answer::Reply(Reply::Mx(list)) => list.is_empty(),
        Answer::Reply(Reply::Naptr(list)) => list.is_empty(),
        Answer::Reply(Reply::Srv(list)) => list.is_empty(),
        Answer::Reply(Reply::Txt(list)) => list.is_empty(),
        Answer::AddrInfo(info) => info.nodes.is_empty(),
        _ => false,
    }
}

pub(crate) fn answer_to_js(answer: &Answer, global: &JSGlobalObject) -> JsResult<JSValue> {
    match answer {
        Answer::Reply(reply) => reply_to_js(reply, global),
        Answer::AddrInfo(info) => addr_info_to_js(info, global),
        Answer::Host(Host { aliases, .. }) => names_to_js(aliases, global),
        Answer::NameInfo(info) => name_info_to_js(info, global),
    }
}

// ── Error ──────────────────────────────────────────────────────────────────
pub(crate) struct ErrorDeferred {
    pub errno: Error,
    pub syscall: &'static [u8],
    pub hostname: Option<bstr::String>,
    pub promise: bun_jsc::JSPromiseStrong,
}

impl ErrorDeferred {
    fn init(
        errno: Error,
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
            errno: self.errno.errno(),
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

    /// `context` is the context of the script that asked. Once it has stopped the
    /// error is not reported: closing a resolver's channel fails every pending
    /// query with `EDESTRUCTION`, and that is how a `Bun.ModuleGraph`'s
    /// resolver goes when the graph is disposed.
    pub(crate) fn reject_later(
        self: Box<Self>,
        global_this: &JSGlobalObject,
        context: bun_jsc::ContextId,
    ) {
        let vm = global_this.bun_vm();
        // Worker terminate's `stop_dns_for_vm_teardown` fires EDESTRUCTION with
        // `is_shutting_down` already set: there is nobody to reject for.
        if vm.is_shutting_down() {
            return;
        }
        vm.as_mut()
            .enqueue_task(bun_event_loop::Task::from_boxed(Box::new(
                ErrorDeferredTask {
                    asking: context,
                    deferred: self,
                    global_this: bun_ptr::BackRef::new(global_this),
                },
            )));
    }
}

/// [`ErrorDeferred::reject_later`]'s hop to the next turn of the loop.
pub(crate) struct ErrorDeferredTask {
    /// The context of the script that asked; it may stop before the task runs.
    asking: bun_jsc::ContextId,
    deferred: Box<ErrorDeferred>,
    // LIFETIMES.tsv row 1403: JSC_BORROW — the global outlives the
    // enqueued task (VM-owned), so a `BackRef` captures the invariant.
    global_this: bun_ptr::BackRef<JSGlobalObject>,
}

impl ErrorDeferredTask {
    #[allow(clippy::boxed_local, reason = "reclaim point for the boxed task")]
    pub(crate) fn run(self: Box<Self>) -> JsResult<()> {
        let Self {
            asking,
            deferred,
            global_this,
        } = *self;
        let global = global_this.get();
        // For the script that asked: once its context has stopped the error goes to nobody.
        let _context = global.bun_vm().enter_context(asking);
        deferred.reject(global)
    }
}

impl bun_event_loop::Taskable for ErrorDeferredTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::DnsErrorDeferred;
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract — boxed in `reject_later`.
        drop(unsafe { bun_core::heap::take(this) });
    }
    /// `run` enters the asking script's context itself.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

// Drop: hostname (bun_core::String) and promise (JSPromiseStrong) drop their own resources;
// the allocation itself is handled by Box drop at the call site.

pub(crate) fn error_to_deferred(
    this: Error,
    syscall: &'static [u8],
    hostname: Option<&[u8]>,
    promise: &mut bun_jsc::JSPromiseStrong,
) -> Box<ErrorDeferred> {
    let host_string: Option<bstr::String> = hostname.map(bstr::String::clone_utf8);
    let taken = core::mem::take(promise);
    ErrorDeferred::init(this, syscall, host_string, taken)
}

/// `SystemError` fields for a resolver failure, in the shape `node:dns`
/// reports them: `code`/`errno` derived from the DNS error, message
/// `"<syscall> <CODE> <hostname>"`, plus `syscall` and `hostname`.
/// `fetch()`/`Bun.connect` reuse this so a failed name lookup surfaces the
/// same error the resolver APIs do.
pub(crate) fn system_error_with_syscall_and_hostname(
    this: Error,
    syscall: &'static [u8],
    hostname: &[u8],
) -> SystemError {
    let code = this.code();
    SystemError {
        errno: this.errno(),
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
    this: Error,
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
    system_error_with_syscall_and_hostname(Error::ENOTFOUND, b"getaddrinfo", hostname)
        .to_error_instance(global_this)
}

pub(crate) fn canonicalize_ip<'a>(
    cx: &mut JsScope<'a>,
    (address, address_value): (&[u8], JsLocal<'a>),
) -> JsResult<JSValue> {
    bun_jsc::mark_binding!();
    let global_this = cx.global();

    let Some(canonical) = bun_boringssl::canonicalize_ip(address) else {
        return Ok(JSValue::UNDEFINED);
    };
    if *address == *canonical {
        return Ok(address_value.to_js());
    }

    bun_string_jsc::create_utf8_for_js(global_this, &canonical)
}
