//! JS-side parsing of `fetch({ compress })`. The actual compression runs on
//! the HTTP thread (`bun_http::compress_body`) so it can reuse
//! `LibdeflateState`'s shared scratch buffer.

use crate::webcore::jsc::{JSGlobalObject, JSValue, JsResult};
use bun_jsc::ComptimeStringMapExt as _;

pub use bun_http::compress_body::{
    CompressEncoding, CompressOption, DEFAULT_BROTLI_QUALITY, DEFAULT_DEFLATE_LEVEL,
    DEFAULT_ZSTD_LEVEL,
};

bun_core::comptime_string_map! {
    static COMPRESS_ENCODING_MAP: CompressEncoding = {
        b"gzip" => CompressEncoding::Gzip,
        b"deflate" => CompressEncoding::Deflate,
        b"br" => CompressEncoding::Brotli,
        b"zstd" => CompressEncoding::Zstd,
    };
}

/// Parses `compress?: boolean | "gzip" | "deflate" | "br" | "zstd" | { encoding, level? }`.
/// Returns `Ok(None)` for `false` / `undefined` / `null`.
pub fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<CompressOption>> {
    if value.is_undefined_or_null() {
        return Ok(None);
    }
    if value.is_boolean() {
        return Ok(if value.as_boolean() {
            Some(CompressOption {
                encoding: CompressEncoding::Gzip,
                level: None,
            })
        } else {
            None
        });
    }
    if value.is_string() {
        return match COMPRESS_ENCODING_MAP.from_js(global, value)? {
            Some(encoding) => Ok(Some(CompressOption {
                encoding,
                level: None,
            })),
            None => Err(global.throw_invalid_arguments(format_args!(
                "fetch: 'compress' must be \"gzip\", \"deflate\", \"br\", or \"zstd\""
            ))),
        };
    }
    if value.is_object() {
        let encoding = match value.get(global, "encoding")? {
            Some(enc) if enc.is_string() => match COMPRESS_ENCODING_MAP.from_js(global, enc)? {
                Some(e) => e,
                None => {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "fetch: 'compress.encoding' must be \"gzip\", \"deflate\", \"br\", or \"zstd\""
                    )));
                }
            },
            other => {
                return Err(global.throw_invalid_argument_type_value(
                    b"compress.encoding",
                    b"string",
                    other.unwrap_or(JSValue::UNDEFINED),
                ));
            }
        };
        let level = match value.get(global, "level")? {
            Some(lvl) if !lvl.is_undefined_or_null() => {
                let (min, max, default) = match encoding {
                    CompressEncoding::Gzip | CompressEncoding::Deflate => {
                        (0, 12, DEFAULT_DEFLATE_LEVEL)
                    }
                    CompressEncoding::Brotli => (
                        bun_brotli::c::BROTLI_MIN_QUALITY,
                        bun_brotli::c::BROTLI_MAX_QUALITY,
                        DEFAULT_BROTLI_QUALITY,
                    ),
                    CompressEncoding::Zstd => (1, 22, DEFAULT_ZSTD_LEVEL),
                };
                Some(global.validate_integer_range::<i32>(
                    lvl,
                    default,
                    bun_jsc::IntegerRange {
                        min: i128::from(min),
                        max: i128::from(max),
                        field_name: b"compress.level",
                        always_allow_zero: false,
                    },
                )?)
            }
            _ => None,
        };
        return Ok(Some(CompressOption { encoding, level }));
    }
    Err(global.throw_invalid_argument_type_value(b"compress", b"boolean, string, or object", value))
}
