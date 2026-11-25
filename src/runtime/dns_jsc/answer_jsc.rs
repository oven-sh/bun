//! Replies and errors as JS values.

use ::bstr::BStr;
use bun_core as bstr;
use bun_core::ip_address::{self, IpText};
use bun_dns_client::{Address, Error, Name, Record, RecordType, Records, Reply};
use bun_jsc::bindgen::{self, JsHeap, JsLocal, JsScope};
use bun_jsc::bun_string_jsc::create_utf8_for_js;
use bun_jsc::{
    ArrayBuffer, JSGlobalObject, JSPromise, JSString, JSType, JSValue, JsResult, StringJsc,
    SystemError,
};

use crate::dns_jsc::options_jsc::result_to_js;
use crate::generated_bindgen::answer_jsc::{
    AddressRecord, CaaRecord, MxRecord, NameRecord, NaptrRecord, SoaRecord, SrvRecord, TlsaRecord,
    TxtRecord,
};

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

pub(crate) fn thrown<T>(
    value: bindgen::Result<'_, JsLocal<'_, T>>,
    global: &JSGlobalObject,
) -> JsResult<JSValue> {
    (value.map(|it| it.to_js())).map_err(|err| err.into_js_error(global))
}

/// Whose conventions a value follows.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Api {
    Bun,
    /// https://github.com/nodejs/node/blob/v26.12.1/src/cares_wrap.cc#L318-L829
    Node {
        /// Whether an address comes with it.
        ttl: bool,
    },
}

pub(crate) fn reply_to_js(reply: &Reply, api: Api, global: &JSGlobalObject) -> JsResult<JSValue> {
    let utf8 = |bytes: &[u8]| create_utf8_for_js(global, bytes);
    match reply {
        Reply::Records(records) => records_to_js(records, api, global),
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

fn records_to_js(records: &Records, api: Api, global: &JSGlobalObject) -> JsResult<JSValue> {
    use RecordType::*;
    let (asked, mut text) = (records.asked(), Vec::new());
    let heap = JsHeap::from_global(global);
    let label = |kind| {
        let label = heap.try_create_latin1_string(<&'static str>::from(kind).as_bytes());
        label.map_err(|err| err.into_js_error(global))
    };
    let mut to_js = |record, label| record_to_js(record, label, asked, api, &mut text, global);
    match asked {
        ANY => {}
        A | AAAA if api == (Api::Node { ttl: false }) => {
            return array(global, records.addresses(), |it| {
                create_utf8_for_js(global, &IpText::new(it.ip))
            });
        }
        CNAME => return array(global, records.of(CNAME).take(1), |it| to_js(it, None)),
        SOA => {
            let first = records.of(SOA).next();
            return first.map_or(Ok(JSValue::UNDEFINED), |it| to_js(it, None));
        }
        kind => {
            let has_label = api != Api::Bun && matches!(kind, MX | SRV | CAA);
            let label = has_label.then(|| label(kind)).transpose()?;
            return array(global, records.of(kind), |it| to_js(it, label));
        }
    }

    let all = JSValue::create_empty_array(global, 0)?;
    let mut len = 0;
    // Node.js leaves out A if there is a CNAME, and the `type` that it documents for TLSA.
    for kind in [CNAME, A, AAAA, MX, NS, TXT, SRV, PTR, NAPTR, SOA, TLSA, CAA] {
        let max = match kind {
            CNAME | SOA => 1,
            _ => usize::MAX,
        };
        let mut records = records.of(kind).take(max).peekable();
        let label = records.peek().map(|_| label(kind)).transpose()?;
        for record in records {
            all.put_index(global, len, to_js(record, label)?)?;
            len += 1;
        }
    }
    Ok(all)
}

/// `kind` is for `type`. `scratch` is overwritten.
fn record_to_js<'a>(
    record: Record<'_>,
    kind: Option<JsLocal<'a, JSString>>,
    asked: RecordType,
    api: Api,
    scratch: &mut Vec<u8>,
    global: &'a JSGlobalObject,
) -> JsResult<JSValue> {
    let heap = JsHeap::from_global(global);
    let is_any = asked == RecordType::ANY;
    let local = |value: JsResult<JSValue>| value.map(|it| JsLocal::new(heap, it));
    let utf8 = |bytes: &[u8]| create_utf8_for_js(global, bytes);
    let octets = |bytes: &[u8]| match api {
        Api::Bun => utf8(bytes),
        Api::Node { .. } => thrown(heap.try_create_latin1_string(bytes), global),
    };
    let mut name = |name: Name<'_>| {
        name.write_to(scratch);
        utf8(scratch)
    };
    let object = match record {
        Record::Address(Address { ip, ttl }) => {
            let address = local(utf8(&IpText::new(ip)))?;
            AddressRecord { address, ttl, kind }.into_js(heap)
        }
        Record::Name(it) if !is_any => return name(it),
        Record::Name(it) => {
            let value = local(name(it))?;
            NameRecord { value, kind }.into_js(heap)
        }
        Record::Mx {
            preference,
            exchange,
        } => MxRecord {
            exchange: local(name(exchange))?,
            priority: preference,
            kind,
        }
        .into_js(heap),
        Record::Txt(strings) if !is_any => return array(global, strings, octets),
        Record::Txt(strings) => {
            let entries = local(array(global, strings, octets))?;
            TxtRecord { entries, kind }.into_js(heap)
        }
        Record::Srv {
            priority,
            weight,
            port,
            target,
        } => SrvRecord {
            name: local(name(target))?,
            port,
            priority,
            weight,
            kind,
        }
        .into_js(heap),
        Record::Naptr {
            order,
            preference,
            flags,
            services,
            regexp,
            replacement,
        } => NaptrRecord {
            flags: local(utf8(flags))?,
            service: local(utf8(services))?,
            // RFC 3402 §3.2. Node.js refuses what is not ASCII.
            regexp: local(utf8(regexp))?,
            replacement: local(name(replacement))?,
            order,
            preference,
            kind,
        }
        .into_js(heap),
        Record::Soa {
            mname,
            rname,
            serial,
            refresh,
            retry,
            expire,
            minimum,
        } => SoaRecord {
            nsname: local(name(mname))?,
            hostmaster: local(name(rname))?,
            serial,
            refresh,
            retry,
            expire,
            minttl: minimum,
            kind,
        }
        .into_js(heap),
        Record::Tlsa {
            usage,
            selector,
            matching,
            data,
        } => TlsaRecord {
            cert_usage: usage,
            selector,
            r#match: matching,
            data: local(ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global, data))?,
            kind,
        }
        .into_js(heap),
        Record::Caa { flags, tag, value } => {
            let critical = flags;
            let object = thrown(CaaRecord { critical, kind }.into_js(heap), global)?;
            if !(is_any && tag == b"type") {
                let property = bstr::StringView::borrow_utf8(tag);
                object.put_may_be_index(global, &property, octets(value)?)?;
            }
            return Ok(object);
        }
    };
    let object = thrown(object, global)?;
    if api != Api::Bun && matches!(asked, RecordType::NAPTR | RecordType::SOA) {
        object.put(global, b"type", JSValue::UNDEFINED);
    }
    Ok(object)
}

/// What `promise`, which a function of `Bun.dns` returned, is rejected with.
pub(crate) fn error_for_promise(
    err: Error,
    syscall: &'static [u8],
    hostname: Option<&[u8]>,
    promise: &JSPromise,
    global: &JSGlobalObject,
) -> JsResult<JSValue> {
    let mut error = system_error(err, syscall, hostname);
    error.code = bstr::String::static_(err.code());
    error.errno = err as i32;
    let message = error.message.clone();
    let instance = name_dns_exception(error.to_error_instance(global), global)?;
    // Without a frame, JavaScriptCore defines none.
    if !instance.prefer_async_stack_from_promise(global, promise) {
        let stack = bstr::String::create_format(format_args!("DNSException: {message}"));
        instance.put_non_enumerable(global, b"stack", stack.into_js(global)?);
    }
    Ok(instance)
}

pub(crate) fn prefer_async_stack<'a>(
    cx: &mut JsScope<'a>,
    error: JsLocal<'a>,
    promise: JsLocal<'a>,
) {
    if let Some(promise) = promise.to_js().as_promise() {
        let promise = JSPromise::opaque_ref(promise);
        (error.to_js()).prefer_async_stack_from_promise(cx.global(), promise);
    }
}

/// As Node.js has it.
pub(crate) fn code_without_prefix(error: Error) -> &'static str {
    &error.code()["DNS_".len()..]
}

fn name_dns_exception(instance: JSValue, global_this: &JSGlobalObject) -> JsResult<JSValue> {
    let name = bstr::String::static_("DNSException").to_js(global_this)?;
    instance.put(global_this, b"name", name);
    Ok(instance)
}

fn system_error(this: Error, syscall: &'static [u8], hostname: Option<&[u8]>) -> SystemError {
    let code = code_without_prefix(this);
    let name = BStr::new(syscall);
    SystemError {
        errno: match this {
            Error::ENOTFOUND => bun_dns::UV_EAI_NONAME,
            _ => this as i32,
        },
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

/// Thrown before uSockets' synchronous `getaddrinfo` can block on a name that can never resolve.
pub(crate) fn not_a_hostname_error(global_this: &JSGlobalObject, hostname: &[u8]) -> JSValue {
    system_error_with_syscall_and_hostname(Error::ENOTFOUND, b"getaddrinfo", hostname)
        .to_error_instance(global_this)
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
