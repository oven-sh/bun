//! `Bun.QR` — QR code generation.

use bun_jsc::{CallFrame, JSGlobalObject, JSUint8Array, JSValue, JsResult};
use bun_qr::{DecodeError, Ecc, EncodeError, QrCode, Segment, VERSION_MAX, VERSION_MIN};

use crate::image::{Image, codec_png, codecs};
use crate::node::StringOrBuffer;

pub(crate) fn create(global: &JSGlobalObject) -> JSValue {
    bun_jsc::create_host_function_object(
        global,
        &[
            ("generate", __jsc_host_generate, 1),
            ("parse", __jsc_host_parse, 1),
        ],
    )
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum OutputFormat {
    Object,
    Svg,
    Text,
    DataUrl,
    Image,
}

struct Options {
    ecc: Ecc,
    min_version: u8,
    max_version: u8,
    mask: Option<u8>,
    boost_ecc: bool,
    border: u32,
    format: OutputFormat,
    invert: bool,
    light: Vec<u8>,
    dark: Vec<u8>,
    scale: u32,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            ecc: Ecc::Medium,
            min_version: VERSION_MIN,
            max_version: VERSION_MAX,
            mask: None,
            boost_ecc: true,
            border: 2,
            format: OutputFormat::Object,
            invert: false,
            light: b"#ffffff".to_vec(),
            dark: b"#000000".to_vec(),
            scale: 8,
        }
    }
}

/// Minimal `#rgb` / `#rrggbb` / `#rrggbbaa` → 0xRRGGBBAA. Non-hex CSS colors
/// return None; the SVG path passes them through verbatim and the image path
/// falls back to black/white.
fn css_color_to_rgba(s: &[u8]) -> Option<u32> {
    let b = s.strip_prefix(b"#")?;
    let hex = |b: u8| -> Option<u32> {
        Some(match b {
            b'0'..=b'9' => u32::from(b - b'0'),
            b'a'..=b'f' => u32::from(b - b'a' + 10),
            b'A'..=b'F' => u32::from(b - b'A' + 10),
            _ => return None,
        })
    };
    match b.len() {
        3 => {
            let r = hex(b[0])?;
            let g = hex(b[1])?;
            let bl = hex(b[2])?;
            Some((r * 17) << 24 | (g * 17) << 16 | (bl * 17) << 8 | 0xFF)
        }
        6 | 8 => {
            let mut v: u32 = 0;
            for &c in b {
                v = (v << 4) | hex(c)?;
            }
            Some(if b.len() == 6 { (v << 8) | 0xFF } else { v })
        }
        _ => None,
    }
}

fn ecc_name(ecc: Ecc) -> &'static str {
    match ecc {
        Ecc::Low => "L",
        Ecc::Medium => "M",
        Ecc::Quartile => "Q",
        Ecc::High => "H",
    }
}

fn parse_options(global: &JSGlobalObject, value: JSValue) -> JsResult<Options> {
    let mut opts = Options::default();
    if !value.is_object() {
        return Ok(opts);
    }

    if let Some(ec) = value.get(global, "errorCorrection")? {
        if ec.is_string() {
            let s = ec.to_slice(global)?;
            opts.ecc = match s.slice() {
                b"L" | b"l" | b"low" => Ecc::Low,
                b"M" | b"m" | b"medium" => Ecc::Medium,
                b"Q" | b"q" | b"quartile" => Ecc::Quartile,
                b"H" | b"h" | b"high" => Ecc::High,
                other => {
                    return Err(global.throw_type_error(format_args!(
                        "errorCorrection must be one of \"L\", \"M\", \"Q\", \"H\" (got {:?})",
                        bstr::BStr::new(other)
                    )));
                }
            };
        } else if !ec.is_undefined_or_null() {
            return Err(
                global.throw_type_error(format_args!("errorCorrection must be a string"))
            );
        }
    }

    if let Some(v) = value.get(global, "minVersion")? {
        if v.is_number() {
            let n = v.coerce_to_int64(global)?;
            if !(i64::from(VERSION_MIN)..=i64::from(VERSION_MAX)).contains(&n) {
                return Err(global.throw_range_error(
                    n,
                    bun_jsc::RangeErrorOptions {
                        min: i64::from(VERSION_MIN),
                        max: i64::from(VERSION_MAX),
                        field_name: b"options.minVersion",
                        ..Default::default()
                    },
                ));
            }
            opts.min_version = n as u8;
        }
    }

    if let Some(v) = value.get(global, "maxVersion")? {
        if v.is_number() {
            let n = v.coerce_to_int64(global)?;
            if !(i64::from(VERSION_MIN)..=i64::from(VERSION_MAX)).contains(&n) {
                return Err(global.throw_range_error(
                    n,
                    bun_jsc::RangeErrorOptions {
                        min: i64::from(VERSION_MIN),
                        max: i64::from(VERSION_MAX),
                        field_name: b"options.maxVersion",
                        ..Default::default()
                    },
                ));
            }
            opts.max_version = n as u8;
        }
    }

    if let Some(v) = value.get(global, "mask")? {
        if v.is_number() {
            let n = v.coerce_to_int64(global)?;
            if !(0..=7).contains(&n) {
                return Err(global.throw_range_error(
                    n,
                    bun_jsc::RangeErrorOptions {
                        min: 0,
                        max: 7,
                        field_name: b"options.mask",
                        ..Default::default()
                    },
                ));
            }
            opts.mask = Some(n as u8);
        }
    }

    if let Some(v) = value.get_boolean_loose(global, "boostErrorCorrection")? {
        opts.boost_ecc = v;
    }

    if let Some(v) = value.get(global, "border")? {
        if v.is_number() {
            let n = v.coerce_to_int64(global)?;
            if !(0..=1024).contains(&n) {
                return Err(global.throw_range_error(
                    n,
                    bun_jsc::RangeErrorOptions {
                        min: 0,
                        max: 1024,
                        field_name: b"options.border",
                        ..Default::default()
                    },
                ));
            }
            opts.border = n as u32;
        }
    }

    if let Some(v) = value.get(global, "format")? {
        if v.is_string() {
            let s = v.to_slice(global)?;
            opts.format = match s.slice() {
                b"object" => OutputFormat::Object,
                b"svg" => OutputFormat::Svg,
                b"text" | b"terminal" | b"ansi" => OutputFormat::Text,
                b"data-url" | b"dataURL" | b"url" => OutputFormat::DataUrl,
                b"image" | b"png" => OutputFormat::Image,
                other => {
                    return Err(global.throw_type_error(format_args!(
                        "format must be one of \"object\", \"svg\", \"text\", \"data-url\", \"image\" (got {:?})",
                        bstr::BStr::new(other)
                    )));
                }
            };
        }
    }

    if let Some(v) = value.get_boolean_loose(global, "invert")? {
        opts.invert = v;
    }

    if let Some(v) = value.get(global, "scale")? {
        if v.is_number() {
            let n = v.coerce_to_int64(global)?;
            if !(1..=1024).contains(&n) {
                return Err(global.throw_range_error(
                    n,
                    bun_jsc::RangeErrorOptions {
                        min: 1,
                        max: 1024,
                        field_name: b"options.scale",
                        ..Default::default()
                    },
                ));
            }
            opts.scale = n as u32;
        }
    }

    if let Some(v) = value.get(global, "light")? {
        if v.is_string() {
            opts.light = v.to_slice(global)?.slice().to_vec();
        }
    }
    if let Some(v) = value.get(global, "dark")? {
        if v.is_string() {
            opts.dark = v.to_slice(global)?.slice().to_vec();
        }
    }

    Ok(opts)
}

#[cold]
fn encode_err_to_js(global: &JSGlobalObject, err: EncodeError) -> bun_jsc::JsError {
    match err {
        EncodeError::DataTooLong {
            max_bits,
            need_bits,
        } => global.throw_range_error(
            need_bits as i64,
            bun_jsc::RangeErrorOptions {
                max: max_bits as i64,
                field_name: b"data bit length",
                msg: b"Input is too long to encode as a QR code at the requested error correction level and version",
                ..Default::default()
            },
        ),
        EncodeError::InvalidVersion => global.throw_range_error(
            0i64,
            bun_jsc::RangeErrorOptions {
                min: i64::from(VERSION_MIN),
                max: i64::from(VERSION_MAX),
                field_name: b"version",
                ..Default::default()
            },
        ),
        EncodeError::InvalidMask => global.throw_range_error(
            0i64,
            bun_jsc::RangeErrorOptions {
                min: 0,
                max: 7,
                field_name: b"mask",
                ..Default::default()
            },
        ),
        EncodeError::InvalidVersionRange => global.throw_invalid_arguments(format_args!(
            "options.minVersion must be <= options.maxVersion"
        )),
    }
}

/// `Bun.QR.generate(data, options?)`
#[bun_jsc::host_fn]
pub fn generate(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [data_value, opts_value] = frame.arguments_as_array::<2>();

    if data_value.is_empty_or_undefined_or_null() {
        return Err(global.throw_invalid_arguments(format_args!(
            "Bun.QR.generate expects a string or BufferSource as the first argument"
        )));
    }

    // Resolve options first so userland getter exceptions surface before the
    // input buffer is borrowed.
    let opts = parse_options(global, opts_value)?;

    let Some(buffer) = StringOrBuffer::from_js(global, data_value)? else {
        return Err(global.throw_invalid_arguments(format_args!(
            "Bun.QR.generate expects a string or BufferSource as the first argument"
        )));
    };
    let input: &[u8] = buffer.slice();

    // Strings try numeric/alnum modes; buffers are byte-mode only.
    let segs: Vec<Segment> = if data_value.is_string() {
        Segment::make_segments(input)
    } else {
        vec![Segment::make_bytes(input)]
    };

    let qr = match QrCode::encode_segments(
        &segs,
        opts.ecc,
        opts.min_version,
        opts.max_version,
        opts.mask,
        opts.boost_ecc,
    ) {
        Ok(qr) => qr,
        Err(e) => return Err(encode_err_to_js(global, e)),
    };

    match opts.format {
        OutputFormat::Svg => {
            let svg = bun_qr::to_svg(&qr, opts.border, &opts.light, &opts.dark);
            bun_jsc::bun_string_jsc::create_utf8_for_js(global, &svg)
        }
        OutputFormat::DataUrl => {
            let svg = bun_qr::to_svg(&qr, opts.border, &opts.light, &opts.dark);
            let b64 = bun_base64::encode_alloc(&svg);
            let mut out = Vec::with_capacity(b"data:image/svg+xml;base64,".len() + b64.len());
            out.extend_from_slice(b"data:image/svg+xml;base64,");
            out.extend_from_slice(&b64);
            bun_jsc::bun_string_jsc::create_utf8_for_js(global, &out)
        }
        OutputFormat::Text => {
            let txt = bun_qr::to_text(&qr, opts.border, opts.invert);
            bun_jsc::bun_string_jsc::create_utf8_for_js(global, txt.as_bytes())
        }
        OutputFormat::Image => {
            let light = css_color_to_rgba(&opts.light).unwrap_or(0xFFFFFFFF);
            let dark = css_color_to_rgba(&opts.dark).unwrap_or(0x000000FF);
            let (rgba, w, h) = bun_qr::to_rgba(&qr, opts.border, opts.scale, light, dark);
            let enc = match codec_png::encode_indexed(&rgba, w, h, -1, 2, false, None) {
                Ok(e) => e,
                Err(codecs::Error::OutOfMemory) => return Err(global.throw_out_of_memory()),
                Err(_) => {
                    return Err(global.throw_type_error(format_args!(
                        "Failed to encode QR code as PNG"
                    )));
                }
            };
            // SAFETY: `enc.bytes` is valid for `len` bytes while `enc` is live.
            let png: Vec<u8> = unsafe { enc.bytes.as_ref() }.to_vec();
            drop(enc);
            Ok(Image::from_owned_bytes_js(global, png))
        }
        OutputFormat::Object => {
            let obj = JSValue::create_empty_object(global, 5);
            obj.put(
                global,
                b"version",
                JSValue::js_number(f64::from(qr.version())),
            );
            obj.put(global, b"size", JSValue::js_number(f64::from(qr.size())));
            obj.put(
                global,
                b"errorCorrection",
                bun_jsc::bun_string_jsc::create_utf8_for_js(global, ecc_name(qr.ecc()).as_bytes())?,
            );
            obj.put(global, b"mask", JSValue::js_number(f64::from(qr.mask())));
            let modules = qr.into_modules().into_boxed_slice();
            obj.put(global, b"matrix", JSUint8Array::from_bytes(global, modules));
            Ok(obj)
        }
    }
}

#[cold]
fn decode_err_to_js(global: &JSGlobalObject, err: DecodeError) -> bun_jsc::JsError {
    global.throw_type_error(format_args!("Failed to decode QR code: {}", err))
}

/// `Bun.QR.parse(input)` — decode a QR module matrix back to its payload.
///
/// Accepts the object returned by `generate()` (`{matrix, size}`), or a bare
/// `Uint8Array` whose length is a perfect square with side 21..177.
#[bun_jsc::host_fn]
pub fn parse(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [input_value] = frame.arguments_as_array::<1>();

    if input_value.is_empty_or_undefined_or_null() {
        return Err(global.throw_invalid_arguments(format_args!(
            "Bun.QR.parse expects a QR matrix ({{matrix, size}}) or Uint8Array"
        )));
    }

    let (matrix_value, declared_size) = if input_value.is_object() {
        let m = input_value.get(global, "matrix")?;
        if let Some(m) = m {
            let size = match input_value.get(global, "size")? {
                Some(v) if v.is_number() => Some(v.coerce_to_int64(global)?),
                _ => None,
            };
            (m, size)
        } else {
            (input_value, None)
        }
    } else {
        (input_value, None)
    };

    let Some(ab) = matrix_value.as_array_buffer(global) else {
        return Err(global.throw_invalid_arguments(format_args!(
            "Bun.QR.parse expects matrix to be a Uint8Array or ArrayBuffer"
        )));
    };
    let modules = ab.byte_slice();

    let size = match declared_size {
        Some(n) => {
            if !(21..=177).contains(&n) {
                return Err(global.throw_range_error(
                    n,
                    bun_jsc::RangeErrorOptions {
                        min: 21,
                        max: 177,
                        field_name: b"size",
                        ..Default::default()
                    },
                ));
            }
            n as usize
        }
        None => {
            let len = modules.len();
            let root = (len as f64).sqrt() as usize;
            if root * root != len {
                return Err(global.throw_invalid_arguments(format_args!(
                    "Bun.QR.parse: matrix length {} is not a perfect square; pass {{matrix, size}}",
                    len
                )));
            }
            root
        }
    };

    let decoded = match bun_qr::decode_matrix(modules, size) {
        Ok(d) => d,
        Err(e) => return Err(decode_err_to_js(global, e)),
    };

    let obj = JSValue::create_empty_object(global, 5);
    obj.put(
        global,
        b"text",
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, &decoded.bytes)?,
    );
    obj.put(
        global,
        b"bytes",
        JSUint8Array::from_bytes(global, decoded.bytes.into_boxed_slice()),
    );
    obj.put(
        global,
        b"version",
        JSValue::js_number(f64::from(decoded.version)),
    );
    obj.put(
        global,
        b"errorCorrection",
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, ecc_name(decoded.ecc).as_bytes())?,
    );
    obj.put(global, b"mask", JSValue::js_number(f64::from(decoded.mask)));
    Ok(obj)
}
