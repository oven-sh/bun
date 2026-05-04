use core::cmp::Ordering;

use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult};
use bun_semver::{Query, SlicedString, Version};
use bun_str::{strings, ZigString};

pub fn create(global: &JSGlobalObject) -> JSValue {
    let object = JSValue::create_empty_object(global, 2);

    object.put(
        global,
        ZigString::static_(b"satisfies"),
        JSFunction::create(
            global,
            "satisfies",
            satisfies,
            2,
            Default::default(),
        ),
    );

    object.put(
        global,
        ZigString::static_(b"order"),
        JSFunction::create(
            global,
            "order",
            order,
            2,
            Default::default(),
        ),
    );

    object
}

#[bun_jsc::host_fn]
pub fn order(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // PERF(port): was ArenaAllocator + stackFallback(512) — profile in Phase B
    // (allocator params dropped; to_slice() owns its buffer and Drops)

    let arguments = frame.arguments_old(2).slice();
    if arguments.len() < 2 {
        return global.throw(format_args!("Expected two arguments"));
    }

    let left_arg = arguments[0];
    let right_arg = arguments[1];

    let left_string = left_arg.to_js_string(global)?;
    let right_string = right_arg.to_js_string(global)?;

    let left = left_string.to_slice(global);
    let right = right_string.to_slice(global);

    if !strings::is_all_ascii(left.slice()) {
        return Ok(JSValue::js_number(0));
    }
    if !strings::is_all_ascii(right.slice()) {
        return Ok(JSValue::js_number(0));
    }

    let left_result = Version::parse(SlicedString::init(left.slice(), left.slice()));
    let right_result = Version::parse(SlicedString::init(right.slice(), right.slice()));

    if !left_result.valid {
        return global.throw(format_args!(
            "Invalid SemVer: {}\n",
            bstr::BStr::new(left.slice())
        ));
    }

    if !right_result.valid {
        return global.throw(format_args!(
            "Invalid SemVer: {}\n",
            bstr::BStr::new(right.slice())
        ));
    }

    let left_version = left_result.version.max();
    let right_version = right_result.version.max();

    Ok(
        match left_version.order_without_build(right_version, left.slice(), right.slice()) {
            Ordering::Equal => JSValue::js_number(0),
            Ordering::Greater => JSValue::js_number(1),
            Ordering::Less => JSValue::js_number(-1),
        },
    )
}

#[bun_jsc::host_fn]
pub fn satisfies(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    // PERF(port): was ArenaAllocator + stackFallback(512) — profile in Phase B
    // (allocator params dropped; to_slice()/Query own their buffers and Drop)

    let arguments = frame.arguments_old(2).slice();
    if arguments.len() < 2 {
        return global.throw(format_args!("Expected two arguments"));
    }

    let left_arg = arguments[0];
    let right_arg = arguments[1];

    let left_string = left_arg.to_js_string(global)?;
    let right_string = right_arg.to_js_string(global)?;

    let left = left_string.to_slice(global);
    let right = right_string.to_slice(global);

    if !strings::is_all_ascii(left.slice()) {
        return Ok(JSValue::FALSE);
    }
    if !strings::is_all_ascii(right.slice()) {
        return Ok(JSValue::FALSE);
    }

    let left_result = Version::parse(SlicedString::init(left.slice(), left.slice()));
    if left_result.wildcard != bun_semver::Wildcard::None {
        return Ok(JSValue::FALSE);
    }

    let left_version = left_result.version.min();

    // TODO(port): narrow error set — Zig `try Query.parse(allocator, ...)` (allocator dropped)
    let right_group = Query::parse(
        right.slice(),
        SlicedString::init(right.slice(), right.slice()),
    )?;

    let right_version = right_group.get_exact_version();

    if let Some(right_version) = right_version {
        return Ok(JSValue::from(left_version.eql(right_version)));
    }

    Ok(JSValue::from(
        right_group.satisfies(left_version, right.slice(), left.slice()),
    ))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/semver_jsc/SemverObject.zig (139 lines)
//   confidence: medium
//   todos:      1
//   notes:      arena/stack-fallback dropped (non-AST); ZigString::static_ used for keyword collision; Wildcard::None enum path assumed
// ──────────────────────────────────────────────────────────────────────────
