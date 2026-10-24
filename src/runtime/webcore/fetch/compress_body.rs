//! JS-side parsing of `fetch({ compress })`. The actual compression runs on
//! the HTTP thread (`bun_http::compress_body`) so it can reuse
//! `LibdeflateState`'s shared scratch buffer.

use crate::generated_bindgen::fetch::{CompressEncodingName, CompressInit};
use crate::webcore::jsc::{JSGlobalObject, JsResult};
use bun_core::comptime_string_map::ComptimeStringMap as _;

pub(crate) use bun_http::compress_body::{
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
pub(crate) fn from_js(
    global: &JSGlobalObject,
    value: CompressInit<'_>,
) -> JsResult<Option<CompressOption>> {
    let value = match value {
        CompressInit::Missing | CompressInit::Null | CompressInit::Flag(false) => return Ok(None),
        CompressInit::Flag(true) => {
            return Ok(Some(CompressOption {
                encoding: CompressEncoding::Gzip,
                level: None,
            }));
        }
        CompressInit::Name(name) => {
            return match COMPRESS_ENCODING_MAP.lookup(name.to_utf8().slice()) {
                Some(&encoding) => Ok(Some(CompressOption {
                    encoding,
                    level: None,
                })),
                None => Err(global.throw_invalid_arguments(format_args!(
                    "fetch: 'compress' must be \"gzip\", \"deflate\", \"br\", or \"zstd\""
                ))),
            };
        }
        CompressInit::Options(value) => value,
        CompressInit::Other(value) => {
            return Err(global.throw_invalid_argument_type_value(
                b"compress",
                b"boolean, string, or object",
                value.to_js(),
            ));
        }
    };
    let encoding = match value.encoding(global)? {
        CompressEncodingName::Name(enc) => {
            match COMPRESS_ENCODING_MAP.lookup(enc.to_utf8().slice()) {
                Some(&e) => e,
                None => {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "fetch: 'compress.encoding' must be \"gzip\", \"deflate\", \"br\", or \"zstd\""
                    )));
                }
            }
        }
        CompressEncodingName::Other(other) => {
            return Err(global.throw_invalid_argument_type_value(
                b"compress.encoding",
                b"string",
                other.to_js(),
            ));
        }
    };
    let level = match value.level(global)? {
        Some(lvl) => {
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
                lvl.to_js(),
                default,
                bun_jsc::IntegerRange {
                    min: i128::from(min),
                    max: i128::from(max),
                    field_name: b"compress.level",
                },
            )?)
        }
        None => None,
    };
    Ok(Some(CompressOption { encoding, level }))
}
