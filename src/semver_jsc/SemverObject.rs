//! `Bun.semver` — `{ satisfies, order }` host-function table.

use core::cmp::Ordering;

use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult};
use bun_semver::{query, SlicedString, Version};
use bun_string::strings;

pub fn create(global: &JSGlobalObject) -> JSValue {
    let object = JSValue::create_empty_object(global, 2);

    object.put(
        global,
        b"satisfies",
        JSFunction::create(global, "satisfies", __jsc_host_satisfies, 2, Default::default()),
    );

    object.put(
        global,
        b"order",
        JSFunction::create(global, "order", __jsc_host_order, 2, Default::default()),
    );

    object
}

#[bun_jsc::host_fn]
pub fn order(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    // PERF(port): was ArenaAllocator + stackFallback(512) — profile in Phase B
    // (allocator params dropped; to_slice() owns its buffer and Drops)

    let arguments = frame.arguments_old::<2>();
    let arguments = arguments.slice();
    if arguments.len() < 2 {
        return Err(global.throw(format_args!("Expected two arguments")));
    }

    let left_string = arguments[0].to_js_string(global)?;
    let right_string = arguments[1].to_js_string(global)?;

    let left = left_string.to_slice(global);
    let right = right_string.to_slice(global);

    if !strings::is_all_ascii(left.slice()) {
        return Ok(JSValue::js_number_from_int32(0));
    }
    if !strings::is_all_ascii(right.slice()) {
        return Ok(JSValue::js_number_from_int32(0));
    }

    let left_result = Version::parse(SlicedString::init(left.slice(), left.slice()));
    let right_result = Version::parse(SlicedString::init(right.slice(), right.slice()));

    if !left_result.valid {
        return Err(global.throw(format_args!(
            "Invalid SemVer: {}\n",
            bstr::BStr::new(left.slice()),
        )));
    }

    if !right_result.valid {
        return Err(global.throw(format_args!(
            "Invalid SemVer: {}\n",
            bstr::BStr::new(right.slice()),
        )));
    }

    let left_version = left_result.version.max();
    let right_version = right_result.version.max();

    Ok(
        match left_version.order_without_build(right_version, left.slice(), right.slice()) {
            Ordering::Equal => JSValue::js_number_from_int32(0),
            Ordering::Greater => JSValue::js_number_from_int32(1),
            Ordering::Less => JSValue::js_number_from_int32(-1),
        },
    )
}

#[bun_jsc::host_fn]
pub fn satisfies(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    // PERF(port): was ArenaAllocator + stackFallback(512) — profile in Phase B

    let arguments = frame.arguments_old::<2>();
    let arguments = arguments.slice();
    if arguments.len() < 2 {
        return Err(global.throw(format_args!("Expected two arguments")));
    }

    let left_string = arguments[0].to_js_string(global)?;
    let right_string = arguments[1].to_js_string(global)?;

    let left = left_string.to_slice(global);
    let right = right_string.to_slice(global);

    if !strings::is_all_ascii(left.slice()) {
        return Ok(JSValue::FALSE);
    }
    if !strings::is_all_ascii(right.slice()) {
        return Ok(JSValue::FALSE);
    }

    let left_result = Version::parse(SlicedString::init(left.slice(), left.slice()));
    if left_result.wildcard != query::token::Wildcard::None {
        return Ok(JSValue::FALSE);
    }

    let left_version = left_result.version.min();

    // `Query::parse` can only fail with OOM (Zig: `try` propagates allocator error).
    let right_group = match query::parse(
        right.slice(),
        SlicedString::init(right.slice(), right.slice()),
    ) {
        Ok(g) => g,
        Err(_) => return Err(global.throw_out_of_memory()),
    };

    if let Some(right_version) = right_group.get_exact_version() {
        return Ok(JSValue::js_boolean(left_version.eql(right_version)));
    }

    Ok(JSValue::js_boolean(
        right_group.satisfies(left_version, right.slice(), left.slice()),
    ))
}

// ported from: src/semver_jsc/SemverObject.zig
