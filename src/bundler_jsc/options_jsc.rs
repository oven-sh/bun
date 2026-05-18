//! `from_js` bridges for `bun.options.{Target,Format,Loader}` and `CompileTarget`.
//! Keeps `src/bundler/` free of `JSValue`/`JSGlobalObject` references.

use bun_bundler::options;
// `bun_bundler::options` re-exports `Target`/`Loader` but not `Format`; pull it
// from the lower-tier source crate directly.
use bun_core::ZigString;
use bun_jsc::ComptimeStringMapExt as _;
use bun_options_types::bundle_enums::Format;
use bun_options_types::compile_target::CompileTarget;

use crate::{JSGlobalObject, JSValue, JsResult};

pub fn target_from_js(
    global: &JSGlobalObject,
    value: JSValue,
) -> JsResult<Option<bun_ast::Target>> {
    if !value.is_string() {
        return Err(global.throw_invalid_arguments(format_args!("target must be a string")));
    }
    bun_ast::Target::MAP.from_js(global, value)
}

pub fn format_from_js(global: &JSGlobalObject, format: JSValue) -> JsResult<Option<Format>> {
    if format.is_undefined_or_null() {
        return Ok(None);
    }

    if !format.is_string() {
        return Err(global.throw_invalid_arguments(format_args!("format must be a string")));
    }

    let Some(v) = Format::MAP.from_js(global, format)? else {
        return Err(global
            .throw_invalid_arguments(format_args!("Invalid format - must be esm, cjs, or iife")));
    };
    Ok(Some(v))
}

pub fn loader_from_js(
    global: &JSGlobalObject,
    loader: JSValue,
) -> JsResult<Option<bun_ast::Loader>> {
    if loader.is_undefined_or_null() {
        return Ok(None);
    }

    if !loader.is_string() {
        return Err(global.throw_invalid_arguments(format_args!("loader must be a string")));
    }

    let mut zig_str = ZigString::init(b"");
    loader.to_zig_string(&mut zig_str, global)?;
    if zig_str.len == 0 {
        return Ok(None);
    }

    let slice = zig_str.to_slice();

    let Some(v) = bun_ast::Loader::from_string(slice.slice()) else {
        return Err(global.throw_invalid_arguments(format_args!(
            "invalid loader - must be js, jsx, tsx, ts, css, file, toml, yaml, wasm, bunsh, json, or md"
        )));
    };
    Ok(Some(v))
}

// ── CompileTarget ──────────────────────────────────────────────────────────
pub fn compile_target_from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<CompileTarget> {
    let slice = value.to_slice(global)?;
    if !slice.slice().starts_with(b"bun-") {
        return Err(global.throw_invalid_arguments(format_args!(
            "Expected compile target to start with 'bun-', got {}",
            bstr::BStr::new(slice.slice())
        )));
    }

    compile_target_from_slice(global, slice.slice())
}

pub fn compile_target_from_slice(
    global: &JSGlobalObject,
    slice_with_bun_prefix: &[u8],
) -> JsResult<CompileTarget> {
    let slice = &slice_with_bun_prefix[b"bun-".len()..];
    let Ok(target_parsed) = CompileTarget::try_from(slice) else {
        return Err(global.throw_invalid_arguments(format_args!(
            "Unknown compile target: {}",
            bstr::BStr::new(slice_with_bun_prefix)
        )));
    };
    if !target_parsed.is_supported() {
        return Err(global.throw_invalid_arguments(format_args!(
            "Unsupported compile target: {}",
            bstr::BStr::new(slice_with_bun_prefix)
        )));
    }

    Ok(target_parsed)
}

// ported from: src/bundler_jsc/options_jsc.zig
