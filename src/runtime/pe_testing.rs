//! `bun:internal-for-testing` hook running `PEFile::add_linked_addon` on caller-supplied images.

use bun_exe_format::pe;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc};

pub fn link_addon(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let args = frame.arguments();
    if args.len() < 3 {
        return Err(global.throw_not_enough_arguments("linkAddon", 3, args.len()));
    }

    let Some(host_buf) = args[0].as_array_buffer(global) else {
        return Err(global.throw_invalid_argument_type("linkAddon", "host", "Uint8Array"));
    };
    let Some(addon_buf) = args[1].as_array_buffer(global) else {
        return Err(global.throw_invalid_argument_type("linkAddon", "addon", "Uint8Array"));
    };
    let name = bun_core::String::from_js(args[2], global)?;
    let name_utf8 = name.to_owned_slice();
    // Stands in for the exe's exported trampoline, which a synthetic host does not have.
    let exception_handler = match args.get(3) {
        Some(value) if value.is_number() => value.to_u32(),
        _ => 0,
    };

    let result = JSValue::create_empty_object(global, 5);
    let put_err = |kind: &str, e: pe::Error| -> JsResult<JSValue> {
        let msg = format!("{}: {}", kind, e);
        result.put(
            global,
            b"error",
            bun_jsc::bun_string_jsc::create_utf8_for_js(global, msg.as_bytes())?,
        );
        Ok(result)
    };
    let put_output = |host: &pe::PEFile| -> JsResult<()> {
        let bytes = host.as_bytes().to_vec().into_boxed_slice();
        result.put(
            global,
            b"output",
            JSValue::create_buffer_from_box(global, bytes)?,
        );
        Ok(())
    };

    let mut host = match pe::PEFile::init(host_buf.byte_slice()) {
        Ok(h) => h,
        Err(e) => return put_err("host", e),
    };

    let linked =
        match host.add_linked_addon(addon_buf.byte_slice(), 0, &name_utf8, exception_handler) {
            Ok(l) => l,
            Err(e) => return put_err("addon", e),
        };
    let Some(linked) = linked else {
        // Tests compare this against their input to check a skip leaves the host untouched.
        result.put(global, b"skipped", JSValue::js_boolean(true));
        put_output(&host)?;
        return Ok(result);
    };

    let meta = pe::serialize_linked_addons(core::slice::from_ref(&linked));
    if let Err(e) = host.add_linked_addon_section(core::slice::from_ref(&linked)) {
        return put_err("bunL", e);
    }
    if let Err(e) = host.validate() {
        return put_err("validate", e);
    }

    result.put(global, b"skipped", JSValue::js_boolean(false));
    put_output(&host)?;
    result.put(
        global,
        b"metadata",
        JSValue::create_buffer_from_box(global, meta.into_boxed_slice())?,
    );
    result.put(
        global,
        b"rvaBase",
        JSValue::js_number_from_uint64(linked.rva_base as u64),
    );
    Ok(result)
}
