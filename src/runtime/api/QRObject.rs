//! `Bun.QR` — QR code generation and matrix decoding.

use bun_css::values::color::RGBA;
use bun_css_jsc::js_color_input_to_css_color;
use bun_jsc::{CallFrame, JSGlobalObject, JSUint8Array, JSValue, JsResult};
use bun_qr::{DecodeError, Ecc, EncodeError, QrCode, Segment, VERSION_MAX, VERSION_MIN};

use crate::image::{Image, codecs};
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
        b"data-url" => OutputFormat::DataUrl,
        b"image" => OutputFormat::Image,
    };
}

bun_core::comptime_string_map! {
    static ECC_MAP: Ecc = {
        b"L" => Ecc::Low,
        b"M" => Ecc::Medium,
        b"Q" => Ecc::Quartile,
        b"H" => Ecc::High,
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

const MAX_BORDER: i128 = 1024;
const MAX_SCALE: i128 = 1024;

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

fn rgba_array(c: RGBA) -> [u8; 4] {
    [c.red, c.green, c.blue, c.alpha]
}

fn ecc_name(ecc: Ecc) -> &'static str {
    match ecc {
        Ecc::Low => "L",
        Ecc::Medium => "M",
        Ecc::Quartile => "Q",
        Ecc::High => "H",
    }
}

/// The value of an option that is set. Absent, `undefined` and `null` all
/// mean "keep the default".
fn option_value(
    global: &JSGlobalObject,
    object: JSValue,
    name: &'static str,
) -> JsResult<Option<JSValue>> {
    Ok(object.get(global, name)?.filter(|v| !v.is_null()))
}

/// Reads an integer option. Unset or `NaN` yields `default`; any other
/// non-number or a non-integer throws a TypeError; out of range throws a
/// RangeError.
fn int_option<T: bun_core::Integer>(
    global: &JSGlobalObject,
    object: JSValue,
    name: &'static str,
    field_name: &'static [u8],
    default: T,
    min: i128,
    max: i128,
) -> JsResult<T> {
    let value = option_value(global, object, name)?.unwrap_or_default();
    global.validate_integer_range::<T>(
        value,
        default,
        bun_jsc::IntegerRange {
            min,
            max,
            field_name,
            always_allow_zero: false,
        },
    )
}

/// [`int_option`] for an option whose default is "not set": the inputs that
/// [`int_option`] maps to its default map to `None` here.
fn optional_int_option<T: bun_core::Integer>(
    global: &JSGlobalObject,
    object: JSValue,
    name: &'static str,
    field_name: &'static [u8],
    min: i128,
    max: i128,
) -> JsResult<Option<T>> {
    let Some(value) = option_value(global, object, name)? else {
        return Ok(None);
    };
    if value.get_number().is_some_and(f64::is_nan) {
        return Ok(None);
    }
    Ok(Some(global.validate_integer_range::<T>(
        value,
        T::ZERO,
        bun_jsc::IntegerRange {
            min,
            max,
            field_name,
            always_allow_zero: false,
        },
    )?))
}

/// A set value is truthy-coerced.
fn bool_option(
    global: &JSGlobalObject,
    value: JSValue,
    name: &'static str,
) -> JsResult<Option<bool>> {
    Ok(option_value(global, value, name)?.map(JSValue::to_boolean))
}

fn color_option(
    global: &JSGlobalObject,
    value: JSValue,
    name: &'static str,
) -> JsResult<Option<RGBA>> {
    let Some(v) = option_value(global, value, name)? else {
        return Ok(None);
    };
    let Some(color) = js_color_input_to_css_color(global, v)? else {
        return Err(global.throw_type_error(format_args!(
            "options.{name} must be a color accepted by Bun.color"
        )));
    };
    match RGBA::try_from_css_color(&color) {
        Some(rgba) => Ok(Some(rgba)),
        None => Err(global.throw_type_error(format_args!(
            "options.{name} must be a concrete color; currentColor, light-dark() and system colors have no fixed value"
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

    let vmin = i128::from(VERSION_MIN);
    let vmax = i128::from(VERSION_MAX);
    opts.min_version = int_option(
        global,
        value,
        "minVersion",
        b"options.minVersion",
        opts.min_version,
        vmin,
        vmax,
    )?;
    opts.max_version = int_option(
        global,
        value,
        "maxVersion",
        b"options.maxVersion",
        opts.max_version,
        vmin,
        vmax,
    )?;
    opts.border = int_option(
        global,
        value,
        "border",
        b"options.border",
        opts.border,
        0,
        MAX_BORDER,
    )?;
    opts.scale = int_option(
        global,
        value,
        "scale",
        b"options.scale",
        opts.scale,
        1,
        MAX_SCALE,
    )?;
    // No numeric default: an unset mask means "choose by penalty score".
    opts.mask = optional_int_option::<u8>(global, value, "mask", b"options.mask", 0, 7)?;

    if let Some(v) = bool_option(global, value, "boostErrorCorrection")? {
        opts.boost_ecc = v;
    }
    if let Some(v) = bool_option(global, value, "invert")? {
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
        // `parse_options` range-checks version and mask, so only DataTooLong
        // is reachable from JS here.
        EncodeError::DataTooLong { .. }
        | EncodeError::InvalidVersion
        | EncodeError::InvalidMask => global
            .err(bun_jsc::ErrCode::OUT_OF_RANGE, format_args!("{}", err))
            .throw(),
        EncodeError::InvalidVersionRange => global.throw_invalid_arguments(format_args!(
            "options.minVersion must be <= options.maxVersion"
        )),
    }
}

/// `Bun.QR.generate(data, options?)`
#[bun_jsc::host_fn]
fn generate(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
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
    let encoded = (match buffer {
        StringOrBuffer::Buffer(_) => Segment::make_bytes(input).map(|seg| vec![seg]),
        _ => Segment::make_segments(input),
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
            let svg = bun_qr::to_svg(
                &qr,
                opts.border,
                rgba_array(opts.light),
                rgba_array(opts.dark),
            );
            bun_jsc::bun_string_jsc::create_utf8_for_js(global, &svg)
        }
        OutputFormat::DataUrl => {
            const PREFIX: &[u8] = b"data:image/svg+xml;base64,";
            let svg = bun_qr::to_svg(
                &qr,
                opts.border,
                rgba_array(opts.light),
                rgba_array(opts.dark),
            );
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
                return Err(global
                    .err(
                        bun_jsc::ErrCode::OUT_OF_RANGE,
                        format_args!(
                            "A {dim_px}x{dim_px} pixel QR image exceeds the limit of {} pixels. Reduce options.scale or options.border",
                            codecs::DEFAULT_MAX_PIXELS
                        ),
                    )
                    .throw());
            }
            // 1-bit indexed PNG: the matrix is the index plane, `light`/`dark` the palette.
            let (bits, dim) = bun_qr::to_bitmap(&qr, opts.border, opts.scale);
            let palette = [rgba_array(opts.light), rgba_array(opts.dark)];
            let enc = match codecs::png::encode_bilevel(&bits, dim, dim, palette) {
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
            let ec =
                bun_jsc::bun_string_jsc::create_utf8_for_js(global, ecc_name(qr.ecc()).as_bytes())?;
            let (version, size, mask) = (qr.version(), qr.size(), qr.mask());
            let matrix = JSUint8Array::from_bytes(global, qr.into_modules().into_boxed_slice())?;
            let obj = JSValue::create_empty_object(global, 5);
            obj.put(global, b"version", JSValue::js_number(f64::from(version)));
            obj.put(global, b"size", JSValue::js_number(f64::from(size)));
            obj.put(global, b"errorCorrection", ec);
            obj.put(global, b"mask", JSValue::js_number(f64::from(mask)));
            obj.put(global, b"matrix", matrix);
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
fn parse(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [input_value] = frame.arguments_as_array::<1>();

    if input_value.is_empty_or_undefined_or_null() {
        return Err(global.throw_invalid_arguments(format_args!(
            "Bun.QR.parse expects a QR matrix ({{matrix, size}}) or BufferSource"
        )));
    }

    let (matrix_value, declared_size) = match input_value.get(global, "matrix")? {
        Some(m) if input_value.is_object() && !m.is_null() => {
            let size = optional_int_option::<usize>(
                global,
                input_value,
                "size",
                b"size",
                i128::from(bun_qr::SIZE_MIN),
                i128::from(bun_qr::SIZE_MAX),
            )?;
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
        Some(n) => n,
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
    let bytes = JSUint8Array::from_bytes(global, decoded.bytes.into_boxed_slice())?;
    let obj = JSValue::create_empty_object(global, 5);
    obj.put(global, b"text", text);
    obj.put(
        global,
        b"version",
        JSValue::js_number(f64::from(decoded.version)),
    );
    obj.put(global, b"errorCorrection", ec);
    obj.put(global, b"mask", JSValue::js_number(f64::from(decoded.mask)));
    obj.put(global, b"bytes", bytes);
    Ok(obj)
}
