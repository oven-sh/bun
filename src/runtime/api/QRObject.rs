//! `Bun.QR` — QR code generation and matrix decoding.

use bun_css::values::color::RGBA;
use bun_css_jsc::js_color_input_to_rgba;
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

bun_core::comptime_string_map! {
    static OUTPUT_FORMAT_MAP: OutputFormat = {
        b"object" => OutputFormat::Object,
        b"svg" => OutputFormat::Svg,
        b"text" => OutputFormat::Text,
        b"terminal" => OutputFormat::Text,
        b"ansi" => OutputFormat::Text,
        b"data-url" => OutputFormat::DataUrl,
        b"dataURL" => OutputFormat::DataUrl,
        b"url" => OutputFormat::DataUrl,
        b"image" => OutputFormat::Image,
        b"png" => OutputFormat::Image,
    };
}

bun_core::comptime_string_map! {
    static ECC_MAP: Ecc = {
        b"L" => Ecc::Low,
        b"l" => Ecc::Low,
        b"low" => Ecc::Low,
        b"M" => Ecc::Medium,
        b"m" => Ecc::Medium,
        b"medium" => Ecc::Medium,
        b"Q" => Ecc::Quartile,
        b"q" => Ecc::Quartile,
        b"quartile" => Ecc::Quartile,
        b"H" => Ecc::High,
        b"h" => Ecc::High,
        b"high" => Ecc::High,
    };
}

const WHITE: RGBA = RGBA {
    red: 255,
    green: 255,
    blue: 255,
    alpha: 255,
};
const BLACK: RGBA = RGBA {
    red: 0,
    green: 0,
    blue: 0,
    alpha: 255,
};

struct Options {
    ecc: Ecc,
    min_version: u8,
    max_version: u8,
    mask: Option<u8>,
    boost_ecc: bool,
    border: u32,
    format: OutputFormat,
    invert: bool,
    light: RGBA,
    dark: RGBA,
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
            light: WHITE,
            dark: BLACK,
            scale: 8,
        }
    }
}

fn rgba_pack(c: RGBA) -> u32 {
    (u32::from(c.red) << 24) | (u32::from(c.green) << 16) | (u32::from(c.blue) << 8) | u32::from(c.alpha)
}

/// `#rrggbb` (opaque) or `#rrggbbaa`, for SVG `fill=`.
struct HexColor {
    buf: [u8; 9],
    len: usize,
}

impl HexColor {
    fn new(c: RGBA) -> Self {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let mut buf = [0u8; 9];
        buf[0] = b'#';
        for (i, ch) in [c.red, c.green, c.blue, c.alpha].into_iter().enumerate() {
            buf[1 + i * 2] = HEX[usize::from(ch >> 4)];
            buf[2 + i * 2] = HEX[usize::from(ch & 0xF)];
        }
        Self {
            buf,
            len: if c.alpha == 255 { 7 } else { 9 },
        }
    }
    fn as_bytes(&self) -> &[u8] {
        &self.buf[..self.len]
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

fn int_option(
    global: &JSGlobalObject,
    value: JSValue,
    name: &'static str,
    field_name: &'static [u8],
    min: i64,
    max: i64,
) -> JsResult<Option<i64>> {
    let Some(v) = value.get(global, name)? else {
        return Ok(None);
    };
    if !v.is_number() {
        return Ok(None);
    }
    let n = v.coerce_to_int64(global)?;
    if !(min..=max).contains(&n) {
        return Err(global.throw_range_error(
            n,
            bun_jsc::RangeErrorOptions {
                min,
                max,
                field_name,
                ..Default::default()
            },
        ));
    }
    Ok(Some(n))
}

fn color_option(
    global: &JSGlobalObject,
    value: JSValue,
    name: &'static str,
) -> JsResult<Option<RGBA>> {
    let Some(v) = value.get(global, name)? else {
        return Ok(None);
    };
    if v.is_undefined_or_null() {
        return Ok(None);
    }
    match js_color_input_to_rgba(global, v)? {
        Some(c) => Ok(Some(c)),
        None => Err(global.throw_type_error(format_args!(
            "options.{} must be a color accepted by Bun.color",
            name
        ))),
    }
}

fn parse_options(global: &JSGlobalObject, value: JSValue) -> JsResult<Options> {
    let mut opts = Options::default();
    if !value.is_object() {
        return Ok(opts);
    }

    if let Some(ecc) = value.get_optional_enum_from_map(
        global,
        "errorCorrection",
        &ECC_MAP,
        r#""L", "M", "Q" or "H""#,
    )? {
        opts.ecc = ecc;
    }
    if let Some(format) = value.get_optional_enum_from_map(
        global,
        "format",
        &OUTPUT_FORMAT_MAP,
        r#""object", "svg", "text", "data-url" or "image""#,
    )? {
        opts.format = format;
    }

    let vmin = i64::from(VERSION_MIN);
    let vmax = i64::from(VERSION_MAX);
    if let Some(n) = int_option(global, value, "minVersion", b"options.minVersion", vmin, vmax)? {
        opts.min_version = n as u8;
    }
    if let Some(n) = int_option(global, value, "maxVersion", b"options.maxVersion", vmin, vmax)? {
        opts.max_version = n as u8;
    }
    if let Some(n) = int_option(global, value, "mask", b"options.mask", 0, 7)? {
        opts.mask = Some(n as u8);
    }
    if let Some(n) = int_option(global, value, "border", b"options.border", 0, 1024)? {
        opts.border = n as u32;
    }
    if let Some(n) = int_option(global, value, "scale", b"options.scale", 1, 1024)? {
        opts.scale = n as u32;
    }

    if let Some(v) = value.get_boolean_loose(global, "boostErrorCorrection")? {
        opts.boost_ecc = v;
    }
    if let Some(v) = value.get_boolean_loose(global, "invert")? {
        opts.invert = v;
    }

    if let Some(c) = color_option(global, value, "light")? {
        opts.light = c;
    }
    if let Some(c) = color_option(global, value, "dark")? {
        opts.dark = c;
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
            i64::try_from(need_bits).unwrap_or(i64::MAX),
            bun_jsc::RangeErrorOptions {
                max: i64::try_from(max_bits).unwrap_or(i64::MAX),
                field_name: b"data bit length",
                msg: b"Input is too long to encode as a QR code",
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
        EncodeError::InvalidEci => {
            global.throw_invalid_arguments(format_args!("invalid ECI assignment"))
        }
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

    // Strings try numeric/alnum modes; buffers are byte-mode only. The
    // constructors reject input longer than any symbol can hold before
    // touching the payload.
    let encoded = (if data_value.is_string() {
        Segment::make_segments(input)
    } else {
        Segment::make_bytes(input).map(|seg| vec![seg])
    })
    .and_then(|segs: Vec<Segment>| {
        QrCode::encode_segments(
            &segs,
            opts.ecc,
            opts.min_version,
            opts.max_version,
            opts.mask,
            opts.boost_ecc,
        )
    });
    let qr = match encoded {
        Ok(qr) => qr,
        Err(e) => return Err(encode_err_to_js(global, e)),
    };

    match opts.format {
        OutputFormat::Svg => {
            let light = HexColor::new(opts.light);
            let dark = HexColor::new(opts.dark);
            let svg = bun_qr::to_svg(&qr, opts.border, light.as_bytes(), dark.as_bytes());
            bun_jsc::bun_string_jsc::create_utf8_for_js(global, &svg)
        }
        OutputFormat::DataUrl => {
            const PREFIX: &[u8] = b"data:image/svg+xml;base64,";
            let light = HexColor::new(opts.light);
            let dark = HexColor::new(opts.dark);
            let svg = bun_qr::to_svg(&qr, opts.border, light.as_bytes(), dark.as_bytes());
            let b64 = bun_base64::encode_alloc(&svg);
            let mut out = Vec::with_capacity(PREFIX.len() + b64.len());
            out.extend_from_slice(PREFIX);
            out.extend_from_slice(&b64);
            bun_jsc::bun_string_jsc::create_utf8_for_js(global, &out)
        }
        OutputFormat::Text => {
            let txt = bun_qr::to_text(&qr, opts.border, opts.invert);
            bun_jsc::bun_string_jsc::create_utf8_for_js(global, txt.as_bytes())
        }
        OutputFormat::Image => {
            let dim_px =
                (u64::from(qr.size()) + 2 * u64::from(opts.border)) * u64::from(opts.scale);
            let px = dim_px * dim_px;
            if px > codecs::DEFAULT_MAX_PIXELS {
                return Err(global.throw_range_error(
                    px as i64,
                    bun_jsc::RangeErrorOptions {
                        max: codecs::DEFAULT_MAX_PIXELS as i64,
                        field_name: b"output pixel count",
                        msg: b"QR image too large; reduce options.scale or options.border",
                        ..Default::default()
                    },
                ));
            }
            let (rgba, w, h) = bun_qr::to_rgba(
                &qr,
                opts.border,
                opts.scale,
                rgba_pack(opts.light),
                rgba_pack(opts.dark),
            );
            let enc = match codec_png::encode_indexed(&rgba, w, h, -1, 2, false, None) {
                Ok(e) => e,
                Err(codecs::Error::OutOfMemory) => return Err(global.throw_out_of_memory()),
                Err(_) => {
                    return Err(
                        global.throw_type_error(format_args!("Failed to encode QR code as PNG"))
                    );
                }
            };
            // SAFETY: `enc.bytes` is valid for its length while `enc` is live.
            let png: Vec<u8> = unsafe { enc.bytes.as_ref() }.to_vec();
            drop(enc);
            Ok(Image::from_owned_bytes_js(global, png))
        }
        OutputFormat::Object => {
            let ec = bun_jsc::bun_string_jsc::create_utf8_for_js(global, ecc_name(qr.ecc()).as_bytes())?;
            let obj = JSValue::create_empty_object(global, 5);
            obj.put(global, b"version", JSValue::js_number(f64::from(qr.version())));
            obj.put(global, b"size", JSValue::js_number(f64::from(qr.size())));
            obj.put(global, b"errorCorrection", ec);
            obj.put(global, b"mask", JSValue::js_number(f64::from(qr.mask())));
            // Last: the typed-array constructor opens a throw scope, and the
            // host_fn epilogue is what checks it.
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
/// `BufferSource` whose length is a perfect square with side 21..=177.
#[bun_jsc::host_fn]
pub fn parse(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [input_value] = frame.arguments_as_array::<1>();

    if input_value.is_empty_or_undefined_or_null() {
        return Err(global.throw_invalid_arguments(format_args!(
            "Bun.QR.parse expects a QR matrix ({{matrix, size}}) or BufferSource"
        )));
    }

    let (matrix_value, declared_size) = match input_value.get(global, "matrix")? {
        Some(m) if input_value.is_object() && !m.is_undefined_or_null() => {
            let size = int_option(global, input_value, "size", b"size", 21, 177)?;
            (m, size)
        }
        _ => (input_value, None),
    };

    let Some(ab) = matrix_value.as_array_buffer(global) else {
        return Err(global.throw_invalid_arguments(format_args!(
            "Bun.QR.parse expects matrix to be a BufferSource"
        )));
    };
    let modules = ab.byte_slice();

    let size = match declared_size {
        Some(n) => n as usize,
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

    let text = bun_jsc::bun_string_jsc::create_utf8_for_js(global, &decoded.bytes)?;
    let ec = bun_jsc::bun_string_jsc::create_utf8_for_js(global, ecc_name(decoded.ecc).as_bytes())?;
    let obj = JSValue::create_empty_object(global, 5);
    obj.put(global, b"text", text);
    obj.put(global, b"version", JSValue::js_number(f64::from(decoded.version)));
    obj.put(global, b"errorCorrection", ec);
    obj.put(global, b"mask", JSValue::js_number(f64::from(decoded.mask)));
    // Last: the typed-array constructor opens a throw scope, and the
    // host_fn epilogue is what checks it.
    obj.put(
        global,
        b"bytes",
        JSUint8Array::from_bytes(global, decoded.bytes.into_boxed_slice()),
    );
    Ok(obj)
}
