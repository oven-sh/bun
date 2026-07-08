//! `Bun.semver` — `{ satisfies, order }` host-function table.

use core::cmp::Ordering;

use bun_core::strings;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_semver::{SlicedString, Version, query};

pub fn create(global: &JSGlobalObject) -> JSValue {
    bun_jsc::create_host_function_object(
        global,
        &[
            ("satisfies", __jsc_host_satisfies, 2),
            ("order", __jsc_host_order, 2),
        ],
    )
}

/// node-semver's `SemVer` constructor `.trim()`s its input. JS
/// `String.prototype.trim()` removes ECMA-262 `WhiteSpace` + `LineTerminator`,
/// which includes non-ASCII code points (NBSP, BOM, Zs, LS/PS).
fn trim_semver_input(bytes: &[u8]) -> &[u8] {
    fn is_js_trimmed(c: char) -> bool {
        matches!(
            c as u32,
            0x0009 | 0x000A | 0x000B | 0x000C | 0x000D | 0x2028 | 0x2029 | 0xFEFF
        ) || strings::is_unicode_space_separator(c as u32)
    }
    match core::str::from_utf8(bytes) {
        Ok(s) => s.trim_matches(is_js_trimmed).as_bytes(),
        Err(_) => strings::trim(bytes, &strings::WHITESPACE_CHARS),
    }
}

#[bun_jsc::host_fn]
pub(crate) fn order(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    // `to_slice()` owns its buffer and frees it on Drop.

    let arguments = frame.arguments_old::<2>();
    let arguments = arguments.slice();
    if arguments.len() < 2 {
        return Err(global.throw(format_args!("Expected two arguments")));
    }

    let left_string = arguments[0].to_js_string(global)?;
    let right_string = arguments[1].to_js_string(global)?;

    let left = left_string.to_slice(global);
    let right = right_string.to_slice(global);

    let left_trimmed = trim_semver_input(left.slice());
    let right_trimmed = trim_semver_input(right.slice());

    let left_result = if strings::is_all_ascii(left_trimmed) {
        Version::parse(SlicedString::init(left_trimmed, left_trimmed))
    } else {
        return Err(global.throw(format_args!(
            "Invalid SemVer: {}\n",
            bstr::BStr::new(left.slice()),
        )));
    };

    let right_result = if strings::is_all_ascii(right_trimmed) {
        Version::parse(SlicedString::init(right_trimmed, right_trimmed))
    } else {
        return Err(global.throw(format_args!(
            "Invalid SemVer: {}\n",
            bstr::BStr::new(right.slice()),
        )));
    };

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
        match left_version.order_without_build(right_version, left_trimmed, right_trimmed) {
            Ordering::Equal => JSValue::js_number_from_int32(0),
            Ordering::Greater => JSValue::js_number_from_int32(1),
            Ordering::Less => JSValue::js_number_from_int32(-1),
        },
    )
}

#[bun_jsc::host_fn]
pub(crate) fn satisfies(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let arguments = frame.arguments_old::<2>();
    let arguments = arguments.slice();
    if arguments.len() < 2 {
        return Err(global.throw(format_args!("Expected two arguments")));
    }

    let left_string = arguments[0].to_js_string(global)?;
    let right_string = arguments[1].to_js_string(global)?;

    let left = left_string.to_slice(global);
    let right = right_string.to_slice(global);

    let left_trimmed = trim_semver_input(left.slice());
    let right_trimmed = trim_semver_input(right.slice());

    if !strings::is_all_ascii(left_trimmed) {
        return Ok(JSValue::FALSE);
    }
    if !strings::is_all_ascii(right_trimmed) {
        return Ok(JSValue::FALSE);
    }

    let left_result = Version::parse(SlicedString::init(left_trimmed, left_trimmed));
    if !left_result.valid || left_result.wildcard != query::token::Wildcard::None {
        return Ok(JSValue::FALSE);
    }

    let left_version = left_result.version.min();

    // `Query::parse` can only fail with OOM.
    let right_group = match query::parse(
        right_trimmed,
        SlicedString::init(right_trimmed, right_trimmed),
    ) {
        Ok(g) => g,
        Err(_) => return Err(global.throw_out_of_memory()),
    };

    if let Some(right_version) = right_group.get_exact_version() {
        return Ok(JSValue::js_boolean(left_version.eql(right_version)));
    }

    Ok(JSValue::js_boolean(right_group.satisfies(
        left_version,
        right_trimmed,
        left_trimmed,
    )))
}
