//! c-ares replies and errors as JS values.

use core::iter::successors;

use ::bstr::BStr;
use bun_cares_sys::c_ares_draft as c_ares;
use bun_core as bstr;
use bun_core::CStrRef;
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{
    JSGlobalObject, JSPromiseStrong, JSValue, JsResult, StringJsc, SystemError, bun_string_jsc,
};
use c_ares::{RecordType, Reply};

use crate::dns_jsc::options_jsc::{address_to_js, result_to_js};

fn number(value: impl Into<f64>) -> JSValue {
    JSValue::js_number(value.into())
}

fn object(global: &JSGlobalObject, properties: &[(&[u8], JSValue)]) -> JSValue {
    let object = JSValue::create_empty_object(global, properties.len());
    for &(key, value) in properties {
        object.put(global, key, value);
    }
    object
}

fn array<T>(
    global: &JSGlobalObject,
    list: impl Iterator<Item = T> + Clone,
    mut to_js: impl FnMut(T) -> JsResult<JSValue>,
) -> JsResult<JSValue> {
    let array = JSValue::create_empty_array(global, list.clone().count())?;
    for (index, item) in (0..).zip(list) {
        array.put_index(global, index, to_js(item)?)?;
    }
    Ok(array)
}

pub(crate) fn reply_to_js(reply: &Reply, global: &JSGlobalObject) -> JsResult<JSValue> {
    let utf8 = |bytes: &[u8]| bun_string_jsc::create_utf8_for_js(global, bytes);
    let c_str = |string: CStrRef<'_>| utf8(string.to_cstr().to_bytes());
    macro_rules! records {
        ($head:expr, $to_js:expr) => {
            array(global, successors(Some($head.get()), |r| r.next), $to_js)
        };
    }
    match reply {
        Reply::Addresses(host) => {
            let addresses = host.hostent.get().addresses().enumerate();
            array(global, addresses, |(index, ip)| {
                let address = address_to_js(&bun_dns::Address::from_ip(ip, 0), global)?;
                let ttl = host.ttls.get(index).copied();
                let ttl = ttl.map_or(JSValue::UNDEFINED, number);
                Ok(object(global, &[(b"address", address), (b"ttl", ttl)]))
            })
        }
        Reply::Aliases(host) => array(global, host.get().aliases(), c_str),
        Reply::Cname(host) => array(global, host.get().h_name.into_iter(), c_str),
        Reply::Names(names) => array(global, names.iter(), |name| {
            name.as_deref().map_or(Ok(JSValue::UNDEFINED), utf8)
        }),
        Reply::AddrInfo(info) => array(global, info.get().nodes(), |node| {
            let result = bun_dns::GetAddrInfoResult {
                address: bun_dns::Address::from_bytes(node.address_bytes()),
                ttl: node.ttl,
            };
            result_to_js(&result, global)
        }),
        Reply::Caa(caa) => records!(caa, |caa| {
            let object = JSValue::create_empty_object(global, 2);
            object.put(global, b"critical", number(caa.critical));
            let property = bstr::StringView::borrow_utf8(caa.property_bytes());
            object.put_may_be_index(global, &property, utf8(caa.value_bytes())?)?;
            Ok(object)
        }),
        Reply::Srv(srv) => records!(srv, |srv| Ok(object(
            global,
            &[
                (b"priority", number(srv.priority)),
                (b"weight", number(srv.weight)),
                (b"port", number(srv.port)),
                (b"name", c_str(srv.host)?),
            ],
        ))),
        Reply::Mx(mx) => records!(mx, |mx| Ok(object(
            global,
            &[
                (b"priority", number(mx.priority)),
                (b"exchange", c_str(mx.host)?),
            ],
        ))),
        Reply::Txt(txt) => records!(txt, |txt| {
            JSValue::create_array_from_slice(global, &[utf8(txt.txt_bytes())?])
        }),
        Reply::Naptr(naptr) => records!(naptr, |naptr| Ok(object(
            global,
            &[
                (b"preference", number(naptr.preference)),
                (b"order", number(naptr.order)),
                (b"flags", c_str(naptr.flags)?),
                (b"service", c_str(naptr.service)?),
                (b"regexp", c_str(naptr.regexp)?),
                (b"replacement", c_str(naptr.replacement)?),
            ],
        ))),
        Reply::Soa(soa) => {
            let soa = soa.get();
            Ok(object(
                global,
                &[
                    (b"serial", number(soa.serial)),
                    (b"refresh", number(soa.refresh)),
                    (b"retry", number(soa.retry)),
                    (b"expire", number(soa.expire)),
                    (b"minttl", number(soa.minttl)),
                    (b"nsname", c_str(soa.nsname)?),
                    (b"hostmaster", c_str(soa.hostmaster)?),
                ],
            ))
        }
        Reply::Any(replies) => {
            let records = JSValue::create_empty_array(global, 0)?;
            let mut len = 0;
            let mut append = |record: RecordType, mut value: JSValue| {
                if value.is_string() {
                    value = object(global, &[(b"value", value)]);
                }
                let name = bstr::String::static_(<&'static str>::from(record));
                value.put(global, b"type", name.to_js(global)?);
                records.put_index(global, len, value)?;
                len += 1;
                JsResult::Ok(())
            };
            for (record, reply) in replies {
                let value = match reply {
                    Reply::Txt(txt) => {
                        let entries = records!(txt, |txt| utf8(txt.txt_bytes()))?;
                        object(global, &[(b"entries", entries)])
                    }
                    reply => reply_to_js(reply, global)?,
                };
                if value.is_array() {
                    let mut items = value.array_iterator(global)?;
                    while let Some(item) = items.next()? {
                        append(*record, item)?;
                    }
                } else {
                    append(*record, value)?;
                }
            }
            Ok(records)
        }
    }
}

/// Once `context`, whose script asked, has stopped, the error is not reported.
pub(crate) fn reject_later(
    promise: JSPromiseStrong,
    err: c_ares::Error,
    syscall: &'static [u8],
    hostname: Option<&[u8]>,
    global_this: &JSGlobalObject,
    context: bun_jsc::ContextId,
) {
    let vm = global_this.bun_vm();
    if vm.is_shutting_down() {
        return;
    }
    let mut error = system_error(err, syscall, hostname);
    // With the `DNS_` prefix, which `node:dns` strips.
    error.code = bstr::String::static_(err.code());
    vm.enqueue_task(bun_event_loop::Task::from_boxed(Box::new(
        ErrorDeferredTask {
            promise,
            error,
            global_this: bun_ptr::BackRef::new(global_this),
            context,
        },
    )));
}

pub(crate) struct ErrorDeferredTask {
    promise: JSPromiseStrong,
    error: SystemError,
    global_this: bun_ptr::BackRef<JSGlobalObject>,
    context: bun_jsc::ContextId,
}

impl ErrorDeferredTask {
    #[allow(clippy::boxed_local, reason = "reclaim point for the boxed task")]
    pub(crate) fn run(self: Box<Self>) -> JsResult<()> {
        let Self {
            mut promise,
            error,
            global_this,
            context,
        } = *self;
        let global = global_this.get();
        let _context = global.bun_vm().enter_context(context);
        let instance = error.to_error_instance_with_async_stack(global, promise.get());
        let instance = name_dns_exception(instance, global)?;
        promise.reject(global, Ok(instance))
    }
}

impl bun_event_loop::BoxedTask for ErrorDeferredTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::DnsErrorDeferred;
    fn release_unrun(self: Box<Self>) {}
    /// `run` enters the asking script's context itself.
    fn context(&self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

fn name_dns_exception(instance: JSValue, global_this: &JSGlobalObject) -> JsResult<JSValue> {
    let name = bstr::String::static_("DNSException").to_js(global_this)?;
    instance.put(global_this, b"name", name);
    Ok(instance)
}

fn system_error(
    this: c_ares::Error,
    syscall: &'static [u8],
    hostname: Option<&[u8]>,
) -> SystemError {
    let code = &this.code()["DNS_".len()..];
    let name = BStr::new(syscall);
    SystemError {
        errno: this.errno(),
        code: bstr::String::static_(code),
        message: match hostname.map(BStr::new) {
            Some(hostname) => bstr::String::create_format(format_args!("{name} {code} {hostname}")),
            None => bstr::String::create_format(format_args!("{name} {code}")),
        },
        syscall: bstr::String::static_(syscall),
        hostname: bstr::String::clone_utf8(hostname.unwrap_or_default()),
        ..Default::default()
    }
}

pub(crate) fn error_to_js_with_syscall(
    this: c_ares::Error,
    global_this: &JSGlobalObject,
    syscall: &'static [u8],
) -> JsResult<JSValue> {
    let instance = system_error(this, syscall, None).to_error_instance(global_this);
    name_dns_exception(instance, global_this)
}

/// The shape `node:dns` reports, for `fetch()` and `Bun.connect` too.
pub(crate) fn system_error_with_syscall_and_hostname(
    this: c_ares::Error,
    syscall: &'static [u8],
    hostname: &[u8],
) -> SystemError {
    system_error(this, syscall, Some(hostname))
}

pub(crate) fn error_to_js_with_syscall_and_hostname(
    this: c_ares::Error,
    global_this: &JSGlobalObject,
    syscall: &'static [u8],
    hostname: &[u8],
) -> JsResult<JSValue> {
    let instance = system_error(this, syscall, Some(hostname)).to_error_instance(global_this);
    name_dns_exception(instance, global_this)
}

/// Thrown before uSockets' synchronous `getaddrinfo` can block on a name that can never resolve.
pub(crate) fn not_a_hostname_error(global_this: &JSGlobalObject, hostname: &[u8]) -> JSValue {
    system_error_with_syscall_and_hostname(c_ares::Error::ENOTFOUND, b"getaddrinfo", hostname)
        .to_error_instance(global_this)
}

pub(crate) fn canonicalize_ip<'a>(
    cx: &mut JsScope<'a>,
    (address, address_value): (&[u8], JsLocal<'a>),
) -> JsResult<JSValue> {
    bun_jsc::mark_binding!();
    let global_this = cx.global();

    let mut ip_addr = [0u8; bun_boringssl::INET6_ADDRSTRLEN + 1];
    let Some(slice) = bun_boringssl::canonicalize_ip(address, &mut ip_addr) else {
        return Ok(JSValue::UNDEFINED);
    };
    if address == slice {
        return Ok(address_value.to_js());
    }

    bun_string_jsc::create_utf8_for_js(global_this, slice)
}
