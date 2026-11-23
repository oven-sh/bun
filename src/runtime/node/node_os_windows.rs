//! CPU and network interface lists for `node:os` and `process.report`.

use core::fmt::Arguments;
use core::net::IpAddr;

use bun_core::{String as BunString, StringView, fmt as bun_fmt};
use bun_jsc::bindgen::JsScope;
use bun_jsc::bun_string_jsc::create_utf8_for_js;
use bun_jsc::{JSGlobalObject, JSValue, JsResult, SystemError};
use bun_sys::windows::cpu::{Processor, processors};
use bun_sys::windows_format::adapter_addresses::{Interface, InterfaceAddress};
use bun_sys::windows_format::cpu_time::ProcessorTimes;

use super::os::CPUTimes;

impl From<ProcessorTimes> for CPUTimes {
    fn from(times: ProcessorTimes) -> Self {
        Self {
            user: times.user,
            nice: 0,
            sys: times.sys,
            idle: times.idle,
            irq: times.irq,
        }
    }
}

fn put_cpu_fields(global: &JSGlobalObject, cpu: JSValue, processor: &Processor) -> JsResult<()> {
    let model = match &processor.model {
        Some(model) => create_utf8_for_js(global, model)?,
        None => global.common_strings().unknown(),
    };
    cpu.put(global, b"model", model);
    let speed = JSValue::js_number(processor.speed_mhz.unwrap_or(0).into());
    cpu.put(global, b"speed", speed);
    Ok(())
}

/// `None` if the system query fails.
pub(crate) fn cpus(global: &JSGlobalObject) -> JsResult<Option<JSValue>> {
    let Some(processors) = processors() else {
        return Ok(None);
    };
    let cpus = JSValue::create_array_from_iter(global, processors, |processor| {
        let cpu = JSValue::create_empty_object(global, 3);
        put_cpu_fields(global, cpu, &processor)?;
        let times = CPUTimes::from(processor.times).to_value(global);
        cpu.put(global, b"times", times);
        Ok(cpu)
    });
    cpus.map(Some)
}

fn create_report_cpus(global: &JSGlobalObject) -> JsResult<JSValue> {
    let Some(processors) = processors() else {
        return JSValue::create_empty_array(global, 0);
    };
    JSValue::create_array_from_iter(global, processors, |processor| {
        let cpu = JSValue::create_empty_object(global, 7);
        put_cpu_fields(global, cpu, &processor)?;
        CPUTimes::from(processor.times).put_fields(cpu, global);
        Ok(cpu)
    })
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Os__createReportCpus(global: &JSGlobalObject) -> JSValue {
    bun_jsc::to_js_host_fn_result(global, create_report_cpus(global))
}

/// `args` is an IP address with an optional prefix length, which fits the buffer.
fn format_address(global: &JSGlobalObject, args: Arguments<'_>) -> JsResult<JSValue> {
    create_utf8_for_js(global, bun_fmt::buf_print_infallible(&mut [0; 64], args))
}

fn put_address_fields(
    global: &JSGlobalObject,
    entry: JSValue,
    address: &InterfaceAddress,
) -> JsResult<()> {
    let ip = format_address(global, format_args!("{}", address.ip))?;
    entry.put(global, b"address", ip);
    let netmask = format_address(global, format_args!("{}", address.netmask()))?;
    entry.put(global, b"netmask", netmask);
    let family = match address.ip {
        IpAddr::V4(_) => global.common_strings().ipv4(),
        IpAddr::V6(_) => global.common_strings().ipv6(),
    };
    entry.put(global, b"family", family);
    Ok(())
}

fn put_mac(global: &JSGlobalObject, entry: JSValue, interface: &Interface) -> JsResult<()> {
    let mac = create_utf8_for_js(global, &bun_fmt::mac_address_lower(interface.mac))?;
    entry.put(global, b"mac", mac);
    Ok(())
}

fn put_scope_id(global: &JSGlobalObject, entry: JSValue, address: &InterfaceAddress) {
    if let Some(scope_id) = address.scope_id {
        entry.put(global, b"scopeid", JSValue::js_number(scope_id.into()));
    }
}

pub(crate) fn network_interfaces(cx: &mut JsScope<'_>) -> JsResult<JSValue> {
    let global = cx.global();
    let interfaces = bun_sys::windows::network_interfaces().map_err(|errno| {
        let err = SystemError {
            message: BunString::static_("uv_interface_addresses failed"),
            code: BunString::static_("ERR_SYSTEM_ERROR"),
            errno: bun_errno::errno_to_uv(errno),
            syscall: BunString::static_("uv_interface_addresses"),
            ..Default::default()
        };
        global.throw_value(err.to_error_instance(global))
    })?;

    let interfaces_by_name = JSValue::create_empty_object(global, 8);
    for interface in &interfaces {
        // The OS picks the interface name, so it can be an array index like "0".
        let name = StringView::from_bytes(&interface.name);
        let entries = match interfaces_by_name.get_own(global, &name)? {
            Some(entries) => entries,
            None => {
                let entries = JSValue::create_empty_array(global, 0)?;
                interfaces_by_name.put_may_be_index(global, &name, entries)?;
                entries
            }
        };
        let first_index = u32::try_from(entries.get_length(global)?).expect("int cast");

        for (index, address) in (first_index..).zip(&interface.addresses) {
            let entry = JSValue::create_empty_object(global, 7);
            put_address_fields(global, entry, address)?;
            put_mac(global, entry, interface)?;
            entry.put(global, b"internal", interface.is_loopback.into());
            let cidr = format_args!("{}/{}", address.ip, address.prefix_len);
            entry.put(global, b"cidr", format_address(global, cidr)?);
            put_scope_id(global, entry, address);
            entries.put_index(global, index, entry)?;
        }
    }
    Ok(interfaces_by_name)
}

fn create_report_network_interfaces(global: &JSGlobalObject) -> JsResult<JSValue> {
    let interfaces = bun_sys::windows::network_interfaces().unwrap_or_default();
    let addresses = interfaces.iter().flat_map(|interface| {
        interface
            .addresses
            .iter()
            .map(move |address| (interface, address))
    });

    let entries = JSValue::create_empty_array(global, 0)?;
    for (index, (interface, address)) in (0..).zip(addresses) {
        let entry = JSValue::create_empty_object(global, 7);
        let name = create_utf8_for_js(global, &interface.name)?;
        entry.put(global, b"name", name);
        entry.put(global, b"internal", interface.is_loopback.into());
        put_address_fields(global, entry, address)?;
        put_scope_id(global, entry, address);
        put_mac(global, entry, interface)?;
        entries.put_index(global, index, entry)?;
    }
    Ok(entries)
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Os__createReportNetworkInterfaces(global: &JSGlobalObject) -> JSValue {
    bun_jsc::to_js_host_fn_result(global, create_report_network_interfaces(global))
}
