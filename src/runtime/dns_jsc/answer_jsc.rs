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

pub(crate) fn array<T>(
    global: &JSGlobalObject,
    list: impl IntoIterator<Item = T>,
    mut to_js: impl FnMut(T) -> JsResult<JSValue>,
) -> JsResult<JSValue> {
    let heap = JsHeap::from_global(global);
    let array = heap.create_array(list, |heap, it| Ok(JsLocal::new(heap, to_js(it)?)));
    to_js_result(array, global)
}

pub(crate) fn to_js_result<T>(
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
        /// The option of `resolve4()` and `resolve6()`.
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
    let (asked, mut scratch) = (records.asked(), Vec::new());
    let heap = JsHeap::from_global(global);
    let name_of = |kind| {
        let type_name = heap.try_create_latin1_string(<&'static str>::from(kind).as_bytes());
        type_name.map_err(|err| err.into_js_error(global))
    };
    let mut to_js =
        |record, type_name| record_to_js(record, type_name, asked, api, &mut scratch, global);
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
            let has_type = api != Api::Bun && matches!(kind, MX | SRV | CAA);
            let type_name = has_type.then(|| name_of(kind)).transpose()?;
            return array(global, records.of(kind), |it| to_js(it, type_name));
        }
    }

    let all = JSValue::create_empty_array(global, 0)?;
    let mut len = 0;
    // Unlike Node.js, this lists A next to a CNAME and gives TLSA the `type` that Node.js documents.
    for kind in [CNAME, A, AAAA, MX, NS, TXT, SRV, PTR, NAPTR, SOA, TLSA, CAA] {
        let max = match kind {
            CNAME | SOA => 1,
            _ => usize::MAX,
        };
        let mut records = records.of(kind).take(max).peekable();
        let type_name = records.peek().map(|_| name_of(kind)).transpose()?;
        for record in records {
            all.put_index(global, len, to_js(record, type_name)?)?;
            len += 1;
        }
    }
    Ok(all)
}

/// `scratch` is overwritten.
fn record_to_js<'a>(
    record: Record<'_>,
    type_name: Option<JsLocal<'a, JSString>>,
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
        Api::Node { .. } => to_js_result(heap.try_create_latin1_string(bytes), global),
    };
    let mut name = |name: Name<'_>| {
        name.write_to(scratch);
        utf8(scratch)
    };
    let object = match record {
        Record::Address(Address { ip, ttl }) => {
            let address = local(utf8(&IpText::new(ip)))?;
            AddressRecord {
                address,
                ttl,
                type_name,
            }
            .into_js(heap)
        }
        Record::Name(it) if !is_any => return name(it),
        Record::Name(it) => {
            let value = local(name(it))?;
            NameRecord { value, type_name }.into_js(heap)
        }
        Record::Mx {
            preference,
            exchange,
        } => MxRecord {
            exchange: local(name(exchange))?,
            priority: preference,
            type_name,
        }
        .into_js(heap),
        Record::Txt(strings) if !is_any => return array(global, strings, octets),
        Record::Txt(strings) => {
            let entries = local(array(global, strings, octets))?;
            TxtRecord { entries, type_name }.into_js(heap)
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
            type_name,
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
            // UTF-8 (RFC 3403 §3). Node.js refuses what is not ASCII.
            regexp: local(utf8(regexp))?,
            replacement: local(name(replacement))?,
            order,
            preference,
            type_name,
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
            type_name,
        }
        .into_js(heap),
        Record::Tlsa {
            cert_usage,
            selector,
            matching_type,
            data,
        } => TlsaRecord {
            cert_usage,
            selector,
            r#match: matching_type,
            data: local(ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global, data))?,
            type_name,
        }
        .into_js(heap),
        Record::Caa { flags, tag, value } => {
            let critical = flags;
            let object = to_js_result(
                CaaRecord {
                    critical,
                    type_name,
                }
                .into_js(heap),
                global,
            )?;
            // `type` tells the records of ANY apart.
            if !(is_any && tag == b"type") {
                let property = bstr::StringView::borrow_utf8(tag);
                object.put_may_be_index(global, &property, octets(value)?)?;
            }
            return Ok(object);
        }
    };
    let object = to_js_result(object, global)?;
    // Node.js has the key without a value.
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
    // JavaScriptCore defines no `stack` for an error without frames.
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
