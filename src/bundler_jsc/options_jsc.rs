//! `from_js` bridges for `bun.options.{Target,Format,Loader}` and `CompileTarget`.
//! Keeps `src/bundler/` free of `JSValue`/`JSGlobalObject` references.

use bun_bundler::options;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use bun_options_types::CompileTarget;
use bun_str::ZigString;

pub fn target_from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<options::Target>> {
    if !value.is_string() {
        return global.throw_invalid_arguments(format_args!("target must be a string"));
    }
    // TODO(port): ComptimeStringMap::from_js bridge (extension trait over phf::Map)
    options::Target::MAP.from_js(global, value)
}

pub fn format_from_js(global: &JSGlobalObject, format: JSValue) -> JsResult<Option<options::Format>> {
    if format.is_undefined_or_null() {
        return Ok(None);
    }

    if !format.is_string() {
        return global.throw_invalid_arguments(format_args!("format must be a string"));
    }

    // TODO(port): ComptimeStringMap::from_js bridge (extension trait over phf::Map)
    let Some(v) = options::Format::MAP.from_js(global, format)? else {
        return global.throw_invalid_arguments(format_args!(
            "Invalid format - must be esm, cjs, or iife"
        ));
    };
    Ok(Some(v))
}

pub fn loader_from_js(global: &JSGlobalObject, loader: JSValue) -> JsResult<Option<options::Loader>> {
    if loader.is_undefined_or_null() {
        return Ok(None);
    }

    if !loader.is_string() {
        return global.throw_invalid_arguments(format_args!("loader must be a string"));
    }

    let mut zig_str = ZigString::init(b"");
    loader.to_zig_string(&mut zig_str, global)?;
    if zig_str.len() == 0 {
        return Ok(None);
    }

    let slice = zig_str.to_slice();

    let Some(v) = options::Loader::from_string(slice.slice()) else {
        return global.throw_invalid_arguments(format_args!(
            "invalid loader - must be js, jsx, tsx, ts, css, file, toml, yaml, wasm, bunsh, json, or md"
        ));
    };
    Ok(Some(v))
}

// ── CompileTarget ──────────────────────────────────────────────────────────
pub fn compile_target_from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<CompileTarget> {
    let slice = value.to_slice(global)?;
    if !slice.slice().starts_with(b"bun-") {
        return global.throw_invalid_arguments(format_args!(
            "Expected compile target to start with 'bun-', got {}",
            bstr::BStr::new(slice.slice())
        ));
    }

    compile_target_from_slice(global, slice.slice())
}

pub fn compile_target_from_slice(
    global: &JSGlobalObject,
    slice_with_bun_prefix: &[u8],
) -> JsResult<CompileTarget> {
    let slice = &slice_with_bun_prefix[b"bun-".len()..];
    let Ok(target_parsed) = CompileTarget::try_from(slice) else {
        return global.throw_invalid_arguments(format_args!(
            "Unknown compile target: {}",
            bstr::BStr::new(slice_with_bun_prefix)
        ));
    };
    if !target_parsed.is_supported() {
        return global.throw_invalid_arguments(format_args!(
            "Unsupported compile target: {}",
            bstr::BStr::new(slice_with_bun_prefix)
        ));
    }

    Ok(target_parsed)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler_jsc/options_jsc.zig (70 lines)
//   confidence: medium
//   todos:      2
//   notes:      Target/Format MAP.from_js needs ComptimeStringMap→phf extension trait in bun_jsc; throw_invalid_arguments assumed to return JsResult<T>
// ──────────────────────────────────────────────────────────────────────────
