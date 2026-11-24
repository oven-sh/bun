//! Replies and errors as JS values.

use ::bstr::BStr;
use bun_core as bstr;
use bun_core::ip_address::{self, IpText};
use bun_dns_client::{Address, Error, Name, Record, RecordType, Records, Reply};
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::bun_string_jsc::create_utf8_for_js;
use bun_jsc::{JSGlobalObject, JSPromiseStrong, JSValue, JsResult, StringJsc, SystemError};

use crate::dns_jsc::options_jsc::result_to_js;

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
    let utf8 = |bytes: &[u8]| create_utf8_for_js(global, bytes);
    match reply {
        Reply::Records(records) => records_to_js(records, global),
        Reply::Addresses(addresses) => array(global, addresses.iter(), |address| {
            let result = bun_dns::GetAddrInfoResult {
                address: bun_dns::Address::from_ip(address.ip, 0),
                ttl: address.ttl,
            };
            result_to_js(&result, global)
        }),
        Reply::Names(names) => array(global, names.iter(), |name| utf8(name)),
        Reply::NameInfo { host, service } => {
            let host = utf8(host)?;
            let service = service.as_deref().map_or(Ok(JSValue::UNDEFINED), utf8)?;
            JSValue::create_array_from_slice(global, &[host, service])
        }
    }
}

fn records_to_js(records: &Records, global: &JSGlobalObject) -> JsResult<JSValue> {
    let mut text = Vec::new();
    let mut to_js = |record| record_to_js(record, &mut text, global);
    match records.asked() {
        RecordType::ANY => {}
        RecordType::CNAME => return array(global, records.of(RecordType::CNAME).take(1), to_js),
        RecordType::SOA => {
            let first = records.of(RecordType::SOA).next();
            return first.map_or(Ok(JSValue::UNDEFINED), to_js);
        }
        kind => return array(global, records.of(kind), to_js),
    }

    use RecordType::*;
    let all = JSValue::create_empty_array(global, 0)?;
    let mut len = 0;
    for kind in [A, AAAA, MX, NS, TXT, SRV, PTR, NAPTR, SOA, CAA] {
        let max = if kind == SOA { 1 } else { usize::MAX };
        for record in records.of(kind).take(max) {
            let value = match record {
                Record::Name(_) => object(global, &[(b"value", to_js(record)?)]),
                Record::Txt(_) => object(global, &[(b"entries", to_js(record)?)]),
                record => to_js(record)?,
            };
            let name = bstr::String::static_(<&'static str>::from(kind));
            value.put(global, b"type", name.to_js(global)?);
            all.put_index(global, len, value)?;
            len += 1;
        }
    }
    Ok(all)
}

/// `text` is for scratch.
fn record_to_js(
    record: Record<'_>,
    text: &mut Vec<u8>,
    global: &JSGlobalObject,
) -> JsResult<JSValue> {
    let utf8 = |bytes: &[u8]| create_utf8_for_js(global, bytes);
    let mut name = |name: Name<'_>| {
        name.write_to(text);
        utf8(text)
    };
    Ok(match record {
        Record::Address(Address { ip, ttl }) => object(
            global,
            &[(b"address", utf8(&IpText::new(ip))?), (b"ttl", number(ttl))],
        ),
        Record::Name(it) => name(it)?,
        Record::Mx {
            preference,
            exchange,
        } => object(
            global,
            &[
                (b"priority", number(preference)),
                (b"exchange", name(exchange)?),
            ],
        ),
        Record::Txt(strings) => array(global, strings, utf8)?,
        Record::Srv {
            priority,
            weight,
            port,
            target,
        } => object(
            global,
            &[
                (b"priority", number(priority)),
                (b"weight", number(weight)),
                (b"port", number(port)),
                (b"name", name(target)?),
            ],
        ),
        Record::Naptr {
            order,
            preference,
            flags,
            services,
            regexp,
            replacement,
        } => object(
            global,
            &[
                (b"preference", number(preference)),
                (b"order", number(order)),
                (b"flags", utf8(flags)?),
                (b"service", utf8(services)?),
                (b"regexp", utf8(regexp)?),
                (b"replacement", name(replacement)?),
            ],
        ),
        Record::Soa {
            mname,
            rname,
            serial,
            refresh,
            retry,
            expire,
            minimum,
        } => object(
            global,
            &[
                (b"serial", number(serial)),
                (b"refresh", number(refresh)),
                (b"retry", number(retry)),
                (b"expire", number(expire)),
                (b"minttl", number(minimum)),
                (b"nsname", name(mname)?),
                (b"hostmaster", name(rname)?),
            ],
        ),
        Record::Caa { flags, tag, value } => {
            let object = JSValue::create_empty_object(global, 2);
            object.put(global, b"critical", number(flags));
            let property = bstr::StringView::borrow_utf8(tag);
            object.put_may_be_index(global, &property, utf8(value)?)?;
            object
        }
    })
}

/// Once `context`, whose script asked, has stopped, the error is not reported.
pub(crate) fn reject_later(
    promise: JSPromiseStrong,
    err: Error,
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

fn system_error(this: Error, syscall: &'static [u8], hostname: Option<&[u8]>) -> SystemError {
    let code = &this.code()["DNS_".len()..];
    let name = BStr::new(syscall);
    SystemError {
        errno: this as i32,
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

/// The shape `node:dns` reports, for `fetch()` and `Bun.connect` too.
pub(crate) fn system_error_with_syscall_and_hostname(
    this: Error,
    syscall: &'static [u8],
    hostname: &[u8],
) -> SystemError {
    system_error(this, syscall, Some(hostname))
}

pub(crate) fn error_to_js_with_syscall_and_hostname(
    this: Error,
    global_this: &JSGlobalObject,
    syscall: &'static [u8],
    hostname: &[u8],
) -> JsResult<JSValue> {
    let instance = system_error(this, syscall, Some(hostname)).to_error_instance(global_this);
    name_dns_exception(instance, global_this)
}

/// The `getaddrinfo <CODE> <hostname>` error for what getaddrinfo(3) returned. `None` for 0.
pub(crate) fn getaddrinfo_error(status: i32, hostname: &[u8]) -> Option<SystemError> {
    let error = bun_dns::getaddrinfo_error(status)?;
    let mut err = system_error_with_syscall_and_hostname(error, b"getaddrinfo", hostname);
    err.errno = bun_dns::getaddrinfo_uv_errno(status).unwrap_or(err.errno);
    Some(err)
}

/// Thrown before uSockets' synchronous `getaddrinfo` can block on a name that can never resolve.
pub(crate) fn not_a_hostname_error(global_this: &JSGlobalObject, hostname: &[u8]) -> JSValue {
    let mut err =
        system_error_with_syscall_and_hostname(Error::ENOTFOUND, b"getaddrinfo", hostname);
    err.errno = bun_dns::UV_EAI_NONAME;
    err.to_error_instance(global_this)
}

/// The address that libuv's `uv_inet_pton` reads, without the zone id of an IPv6 address.
pub(crate) fn canonicalize_ip<'a>(
    cx: &mut JsScope<'a>,
    (address, address_value): (&[u8], JsLocal<'a>),
) -> JsResult<JSValue> {
    bun_jsc::mark_binding!();
    let global_this = cx.global();

    let Some(canonical) = ip_address::parse_uv_inet_pton(address).map(IpText::new) else {
        return Ok(JSValue::UNDEFINED);
    };
    if *address == *canonical {
        return Ok(address_value.to_js());
    }

    create_utf8_for_js(global_this, &canonical)
}
