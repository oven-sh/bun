use std::io::Write as _;

use bun_alloc::Arena;
use bun_ast::Log;
use bun_core::String as BunString;
use bun_core::output::{ColorDepth, Source as OutputSource};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue};

use crate::JsResult;

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum OutputColorFormat {
    Ansi,
    Ansi16,
    Ansi16m,
    Ansi256,
    Css,
    Hex,
    HexUpper,
    Hsl,
    Lab,
    Number,
    Rgb,
    Rgba,
    RgbArray,
    RgbaArray,
    RgbObject,
    RgbaObject,
}

impl bun_jsc::FromJsEnum for OutputColorFormat {
    fn from_js_value(
        v: JSValue,
        global: &JSGlobalObject,
        property_name: &'static str,
    ) -> JsResult<Self> {
        use bun_jsc::ComptimeStringMapExt as _;
        match OUTPUT_COLOR_FORMAT_MAP.from_js(global, v)? {
            Some(e) => Ok(e),
            None => {
                // List the accepted spellings straight from the lookup map so the
                // error message can't drift from what the parser actually accepts.
                let n = OUTPUT_COLOR_FORMAT_MAP.len();
                let mut one_of = std::string::String::from("'");
                for (i, key) in OUTPUT_COLOR_FORMAT_MAP.keys().enumerate() {
                    one_of.push_str(std::str::from_utf8(key).expect("map keys are ASCII"));
                    one_of.push('\'');
                    if i + 2 < n {
                        one_of.push_str(", '");
                    } else if i + 2 == n {
                        one_of.push_str(" or '");
                    }
                }
                Err(global.throw_invalid_arguments(format_args!(
                    "{property_name} must be one of {one_of}"
                )))
            }
        }
    }
}

bun_core::comptime_string_map! {
    pub(crate) static OUTPUT_COLOR_FORMAT_MAP: OutputColorFormat = {
        b"[r,g,b,a]" => OutputColorFormat::RgbaArray,
        b"[rgb]" => OutputColorFormat::RgbArray,
        b"[rgba]" => OutputColorFormat::RgbaArray,
        b"{r,g,b}" => OutputColorFormat::RgbObject,
        b"{rgb}" => OutputColorFormat::RgbObject,
        b"{rgba}" => OutputColorFormat::RgbaObject,
        b"ansi_256" => OutputColorFormat::Ansi256,
        b"ansi-256" => OutputColorFormat::Ansi256,
        b"ansi_16" => OutputColorFormat::Ansi16,
        b"ansi-16" => OutputColorFormat::Ansi16,
        b"ansi_16m" => OutputColorFormat::Ansi16m,
        b"ansi-16m" => OutputColorFormat::Ansi16m,
        b"ansi-24bit" => OutputColorFormat::Ansi16m,
        b"ansi-truecolor" => OutputColorFormat::Ansi16m,
        b"ansi" => OutputColorFormat::Ansi,
        b"ansi256" => OutputColorFormat::Ansi256,
        b"css" => OutputColorFormat::Css,
        b"hex" => OutputColorFormat::Hex,
        b"HEX" => OutputColorFormat::HexUpper,
        b"hsl" => OutputColorFormat::Hsl,
        b"lab" => OutputColorFormat::Lab,
        b"number" => OutputColorFormat::Number,
        b"rgb" => OutputColorFormat::Rgb,
        b"rgba" => OutputColorFormat::Rgba,
    };
}

fn color_int_from_js(
    global: &JSGlobalObject,
    input: JSValue,
    property: &'static str,
) -> JsResult<i32> {
    if input.is_empty() || input.is_undefined() || !input.is_number() {
        return Err(global.throw_invalid_argument_type("color", property, "integer"));
    }
    // CSS spec says to clamp values to their valid range so we'll respect that here
    Ok(input.coerce::<i32>(global)?.clamp(0, 255))
}

// https://github.com/tmux/tmux/blob/dae2868d1227b95fd076fb4a5efa6256c7245943/colour.c#L44-L55
pub mod ansi256 {
    use std::io::Write as _;

    const Q2C: [u32; 6] = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff];

    fn sqdist(r_: u32, g_: u32, b_: u32, r: u32, g: u32, b: u32) -> u32 {
        (r_.wrapping_sub(r))
            .wrapping_mul(r_.wrapping_sub(r))
            .wrapping_add((g_.wrapping_sub(g)).wrapping_mul(g_.wrapping_sub(g)))
            .wrapping_add((b_.wrapping_sub(b)).wrapping_mul(b_.wrapping_sub(b)))
    }

    fn to_6_cube(v: u32) -> u32 {
        if v < 48 {
            return 0;
        }
        if v < 114 {
            return 1;
        }
        (v - 35) / 40
    }

    fn get(r: u32, g: u32, b: u32) -> u32 {
        let qr = to_6_cube(r);
        let cr = Q2C[usize::try_from(qr).expect("int cast")];
        let qg = to_6_cube(g);
        let cg = Q2C[usize::try_from(qg).expect("int cast")];
        let qb = to_6_cube(b);
        let cb = Q2C[usize::try_from(qb).expect("int cast")];

        if cr == r && cg == g && cb == b {
            return 16u32
                .wrapping_add(36u32.wrapping_mul(qr))
                .wrapping_add(6u32.wrapping_mul(qg))
                .wrapping_add(qb);
        }

        let grey_avg = (r.wrapping_add(g).wrapping_add(b)) / 3;
        let grey_idx = if grey_avg > 238 {
            23
        } else {
            // tmux does this in signed int, where (2 - 3) / 10 truncates to 0.
            // Wrapping on u32 would send the palette index into the hundreds of
            // millions for any average below 3.
            grey_avg.saturating_sub(3) / 10
        };
        let grey = 8u32.wrapping_add(10u32.wrapping_mul(grey_idx));

        let d = sqdist(cr, cg, cb, r, g, b);
        if sqdist(grey, grey, grey, r, g, b) < d {
            232u32.wrapping_add(grey_idx)
        } else {
            16u32
                .wrapping_add(36u32.wrapping_mul(qr))
                .wrapping_add(6u32.wrapping_mul(qg))
                .wrapping_add(qb)
        }
    }

    const TABLE_256: [u8; 256] = [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 4, 4, 4, 12, 12, 2, 6, 4, 4, 12,
        12, 2, 2, 6, 4, 12, 12, 2, 2, 2, 6, 12, 12, 10, 10, 10, 10, 14, 12, 10, 10, 10, 10, 10, 14,
        1, 5, 4, 4, 12, 12, 3, 8, 4, 4, 12, 12, 2, 2, 6, 4, 12, 12, 2, 2, 2, 6, 12, 12, 10, 10, 10,
        10, 14, 12, 10, 10, 10, 10, 10, 14, 1, 1, 5, 4, 12, 12, 1, 1, 5, 4, 12, 12, 3, 3, 8, 4, 12,
        12, 2, 2, 2, 6, 12, 12, 10, 10, 10, 10, 14, 12, 10, 10, 10, 10, 10, 14, 1, 1, 1, 5, 12, 12,
        1, 1, 1, 5, 12, 12, 1, 1, 1, 5, 12, 12, 3, 3, 3, 7, 12, 12, 10, 10, 10, 10, 14, 12, 10, 10,
        10, 10, 10, 14, 9, 9, 9, 9, 13, 12, 9, 9, 9, 9, 13, 12, 9, 9, 9, 9, 13, 12, 9, 9, 9, 9, 13,
        12, 11, 11, 11, 11, 7, 12, 10, 10, 10, 10, 10, 14, 9, 9, 9, 9, 9, 13, 9, 9, 9, 9, 9, 13, 9,
        9, 9, 9, 9, 13, 9, 9, 9, 9, 9, 13, 9, 9, 9, 9, 9, 13, 11, 11, 11, 11, 11, 15, 0, 0, 0, 0,
        0, 0, 8, 8, 8, 8, 8, 8, 7, 7, 7, 7, 7, 7, 15, 15, 15, 15, 15, 15,
    ];

    pub(crate) fn get16(r: u32, g: u32, b: u32) -> u8 {
        let val = get(r, g, b);
        TABLE_256[(val & 0xff) as usize]
    }

    pub(crate) type Buffer = [u8; 24];

    /// Takes the channels directly so the pure escape-sequence builder
    /// doesn't depend on `bun_css::values::color`.
    pub(crate) fn from(red: u8, green: u8, blue: u8, buf: &mut Buffer) -> &[u8] {
        let val = get(red as u32, green as u32, blue as u32);
        // 0x1b is the escape character
        buf[0] = 0x1b;
        buf[1] = b'[';
        buf[2] = b'3';
        buf[3] = b'8';
        buf[4] = b';';
        buf[5] = b'5';
        buf[6] = b';';
        let extra_len = {
            let mut cursor = &mut buf[7..];
            let before = cursor.len();
            write!(cursor, "{}m", val).expect("unreachable");
            before - cursor.len()
        };
        &buf[0..7 + extra_len]
    }
}

/// A missing color component (CSS Color 4's `none`, or the hue of an achromatic
/// color) is stored as NaN, and behaves as zero outside of interpolation. Printing
/// it as `NaN` would produce a string no CSS parser accepts.
fn zero_if_none(component: f32) -> f32 {
    if component.is_nan() { 0.0 } else { component }
}

pub fn js_function_color(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    use bun_ast::symbol::Map as SymbolMap;
    use bun_core::ZigStringSlice;
    use bun_css as css;
    use bun_css::CssColor;
    use bun_css::values::color::{HSL, LAB, RGBA, SRGB};
    use bun_jsc::StringJsc as _;

    let args = frame.arguments_as_array::<2>();
    if args[0].is_undefined() {
        return Err(global.throw_invalid_argument_type(
            "color",
            "input",
            "string, number, or object",
        ));
    }

    let log = Log::init();

    let unresolved_format: OutputColorFormat = 'brk: {
        if !args[1].is_empty_or_undefined_or_null() {
            if !args[1].is_string() {
                return Err(global.throw_invalid_argument_type("color", "format", "string"));
            }

            break 'brk args[1].to_enum::<OutputColorFormat>(global, "format")?;
        }

        break 'brk OutputColorFormat::Css;
    };
    let input: ZigStringSlice;

    let parsed_color: css::CssColorParseResult = 'brk: {
        if args[0].is_number() {
            let number: i64 = args[0].to_int64();
            // The color is the low 32 bits, LSB-first: blue, green, red,
            // alpha (one byte each).
            let int: u32 = number as u32;
            let blue = (int & 0xff) as u8;
            let green = ((int >> 8) & 0xff) as u8;
            let red = ((int >> 16) & 0xff) as u8;
            // A 24-bit 0xRRGGBB number has no alpha byte and means an opaque
            // color; only values wider than 24 bits carry alpha in the top byte.
            let alpha = if int > 0x00ff_ffff {
                (int >> 24) as u8
            } else {
                255
            };

            break 'brk Ok(CssColor::Rgba(RGBA {
                alpha,
                red,
                green,
                blue,
            }));
        } else if args[0].js_type().is_array_like() {
            match args[0].get_length(global)? {
                3 => {
                    let r = color_int_from_js(global, args[0].get_index(global, 0)?, "[0]")?;
                    let g = color_int_from_js(global, args[0].get_index(global, 1)?, "[1]")?;
                    let b = color_int_from_js(global, args[0].get_index(global, 2)?, "[2]")?;
                    break 'brk Ok(CssColor::Rgba(RGBA {
                        alpha: 255,
                        red: u8::try_from(r).expect("int cast"),
                        green: u8::try_from(g).expect("int cast"),
                        blue: u8::try_from(b).expect("int cast"),
                    }));
                }
                4 => {
                    let r = color_int_from_js(global, args[0].get_index(global, 0)?, "[0]")?;
                    let g = color_int_from_js(global, args[0].get_index(global, 1)?, "[1]")?;
                    let b = color_int_from_js(global, args[0].get_index(global, 2)?, "[2]")?;
                    let a = color_int_from_js(global, args[0].get_index(global, 3)?, "[3]")?;
                    break 'brk Ok(CssColor::Rgba(RGBA {
                        alpha: u8::try_from(a).expect("int cast"),
                        red: u8::try_from(r).expect("int cast"),
                        green: u8::try_from(g).expect("int cast"),
                        blue: u8::try_from(b).expect("int cast"),
                    }));
                }
                _ => {
                    return Err(global.throw(format_args!("Expected array length 3 or 4")));
                }
            }
        } else if args[0].is_object() {
            let r = color_int_from_js(
                global,
                args[0].get(global, b"r")?.unwrap_or(JSValue::ZERO),
                "r",
            )?;
            let g = color_int_from_js(
                global,
                args[0].get(global, b"g")?.unwrap_or(JSValue::ZERO),
                "g",
            )?;
            let b = color_int_from_js(
                global,
                args[0].get(global, b"b")?.unwrap_or(JSValue::ZERO),
                "b",
            )?;

            let a: Option<u8> = if let Some(a_value) = args[0].get_truthy(global, b"a")? {
                'brk2: {
                    if a_value.is_number() {
                        // CSS spec says to clamp values to their valid range so we'll respect that here
                        break 'brk2 Some(
                            u8::try_from(((a_value.as_number() * 255.0) as i64).clamp(0, 255))
                                .unwrap(),
                        );
                    }
                    break 'brk2 None;
                }
            } else {
                None
            };
            if global.has_exception() {
                return Ok(JSValue::ZERO);
            }

            break 'brk Ok(CssColor::Rgba(RGBA {
                alpha: a.unwrap_or(255),
                red: u8::try_from(r).expect("int cast"),
                green: u8::try_from(g).expect("int cast"),
                blue: u8::try_from(b).expect("int cast"),
            }));
        }

        input = args[0].to_slice(global)?;

        // MimallocArena::new() calls mi_heap_new(), so defer creation to the
        // paths that actually allocate.
        let arena = Arena::new();
        let mut parser_input = css::ParserInput::new(input.slice(), &arena);
        let mut parser = css::Parser::new(
            &mut parser_input,
            None,
            css::css_parser::ParserOpts::default(),
            None,
        );
        break 'brk CssColor::parse(&mut parser);
    };

    match parsed_color {
        Err(err) => {
            if log.msgs.is_empty() {
                return Ok(JSValue::NULL);
            }

            let kind_name = match err.basic().kind {
                css::BasicParseErrorKind::unexpected_token(_) => "unexpected_token",
                css::BasicParseErrorKind::end_of_input => "end_of_input",
                css::BasicParseErrorKind::at_rule_invalid(_) => "at_rule_invalid",
                css::BasicParseErrorKind::at_rule_body_invalid => "at_rule_body_invalid",
                css::BasicParseErrorKind::qualified_rule_invalid => "qualified_rule_invalid",
            };
            return Err(global.throw(format_args!("color() failed to parse {}", kind_name)));
        }
        Ok(result) => {
            let format: OutputColorFormat = if unresolved_format == OutputColorFormat::Ansi {
                match OutputSource::color_depth() {
                    // No color terminal, therefore return an empty string
                    ColorDepth::None => return Ok(JSValue::js_empty_string(global)),
                    ColorDepth::C16 => OutputColorFormat::Ansi16,
                    ColorDepth::C16m => OutputColorFormat::Ansi16m,
                    ColorDepth::C256 => OutputColorFormat::Ansi256,
                }
            } else {
                unresolved_format
            };

            'formatted: {
                let mut str: BunString = 'color: {
                    match format {
                        // resolved above.
                        OutputColorFormat::Ansi => unreachable!(),

                        // Use the CSS printer.
                        OutputColorFormat::Css => break 'formatted,

                        tag @ (OutputColorFormat::Number
                        | OutputColorFormat::Rgb
                        | OutputColorFormat::Rgba
                        | OutputColorFormat::Hex
                        | OutputColorFormat::HexUpper
                        | OutputColorFormat::Ansi16
                        | OutputColorFormat::Ansi16m
                        | OutputColorFormat::Ansi256
                        | OutputColorFormat::RgbaObject
                        | OutputColorFormat::RgbObject
                        | OutputColorFormat::RgbaArray
                        | OutputColorFormat::RgbArray) => {
                            let srgba: SRGB = match &result {
                                CssColor::Float(float) => match &**float {
                                    css::FloatColor::Rgb(rgb) => *rgb,
                                    other => other.into_srgb(),
                                },
                                CssColor::Rgba(rgba) => rgba.into_srgb(),
                                CssColor::Lab(lab) => lab.into_srgb(),
                                _ => break 'formatted,
                            };
                            let rgba = srgba.into_rgba();
                            match tag {
                                OutputColorFormat::RgbaObject => {
                                    let object = JSValue::create_empty_object(global, 4);
                                    object.put(global, b"r", JSValue::js_number(rgba.red as f64));
                                    object.put(global, b"g", JSValue::js_number(rgba.green as f64));
                                    object.put(global, b"b", JSValue::js_number(rgba.blue as f64));
                                    object.put(
                                        global,
                                        b"a",
                                        JSValue::js_number(rgba.alpha_f32() as f64),
                                    );
                                    return Ok(object);
                                }
                                OutputColorFormat::RgbObject => {
                                    let object = JSValue::create_empty_object(global, 3);
                                    object.put(global, b"r", JSValue::js_number(rgba.red as f64));
                                    object.put(global, b"g", JSValue::js_number(rgba.green as f64));
                                    object.put(global, b"b", JSValue::js_number(rgba.blue as f64));
                                    return Ok(object);
                                }
                                OutputColorFormat::RgbArray => {
                                    let object = JSValue::create_empty_array(global, 3)?;
                                    object.put_index(
                                        global,
                                        0,
                                        JSValue::js_number(rgba.red as f64),
                                    )?;
                                    object.put_index(
                                        global,
                                        1,
                                        JSValue::js_number(rgba.green as f64),
                                    )?;
                                    object.put_index(
                                        global,
                                        2,
                                        JSValue::js_number(rgba.blue as f64),
                                    )?;
                                    return Ok(object);
                                }
                                OutputColorFormat::RgbaArray => {
                                    let object = JSValue::create_empty_array(global, 4)?;
                                    object.put_index(
                                        global,
                                        0,
                                        JSValue::js_number(rgba.red as f64),
                                    )?;
                                    object.put_index(
                                        global,
                                        1,
                                        JSValue::js_number(rgba.green as f64),
                                    )?;
                                    object.put_index(
                                        global,
                                        2,
                                        JSValue::js_number(rgba.blue as f64),
                                    )?;
                                    object.put_index(
                                        global,
                                        3,
                                        JSValue::js_number(rgba.alpha as f64),
                                    )?;
                                    return Ok(object);
                                }
                                OutputColorFormat::Number => {
                                    let mut int: u32 = 0;
                                    int |= (rgba.red as u32) << 16;
                                    int |= (rgba.green as u32) << 8;
                                    int |= rgba.blue as u32;
                                    return Ok(JSValue::js_number(int as f64));
                                }
                                OutputColorFormat::Hex => {
                                    break 'color BunString::create_format(format_args!(
                                        "#{:02x}{:02x}{:02x}",
                                        rgba.red, rgba.green, rgba.blue
                                    ));
                                }
                                OutputColorFormat::HexUpper => {
                                    break 'color BunString::create_format(format_args!(
                                        "#{:02X}{:02X}{:02X}",
                                        rgba.red, rgba.green, rgba.blue
                                    ));
                                }
                                OutputColorFormat::Rgb => {
                                    break 'color BunString::create_format(format_args!(
                                        "rgb({}, {}, {})",
                                        rgba.red, rgba.green, rgba.blue
                                    ));
                                }
                                OutputColorFormat::Rgba => {
                                    break 'color BunString::create_format(format_args!(
                                        "rgba({}, {}, {}, {})",
                                        rgba.red,
                                        rgba.green,
                                        rgba.blue,
                                        rgba.alpha_f32()
                                    ));
                                }
                                OutputColorFormat::Ansi16 => {
                                    let index = ansi256::get16(
                                        rgba.red as u32,
                                        rgba.green as u32,
                                        rgba.blue as u32,
                                    );
                                    // 16-color SGR: 30..=37 for the first eight, 90..=97
                                    // for their bright variants. The 38;5;{index} form
                                    // only a 256-color terminal reads is ansi-256's job.
                                    let sgr = if index < 8 { 30 + index } else { 82 + index };
                                    let mut buf = [0u8; 8];
                                    buf[0..2].copy_from_slice(b"\x1b[");
                                    let extra_len = {
                                        let mut cursor = &mut buf[2..];
                                        let before = cursor.len();
                                        write!(cursor, "{}m", sgr).expect("unreachable");
                                        before - cursor.len()
                                    };
                                    break 'color BunString::clone_latin1(&buf[0..2 + extra_len]);
                                }
                                OutputColorFormat::Ansi16m => {
                                    // true color ansi
                                    let mut buf = [0u8; 48];
                                    // 0x1b is the escape character
                                    buf[0] = 0x1b;
                                    buf[1] = b'[';
                                    buf[2] = b'3';
                                    buf[3] = b'8';
                                    buf[4] = b';';
                                    buf[5] = b'2';
                                    buf[6] = b';';
                                    let additional_len = {
                                        let mut cursor = &mut buf[7..];
                                        let before = cursor.len();
                                        write!(
                                            cursor,
                                            "{};{};{}m",
                                            rgba.red, rgba.green, rgba.blue
                                        )
                                        .expect("unreachable");
                                        before - cursor.len()
                                    };

                                    break 'color BunString::clone_latin1(
                                        &buf[0..7 + additional_len],
                                    );
                                }
                                OutputColorFormat::Ansi256 => {
                                    // ANSI escape sequence
                                    let mut buf: ansi256::Buffer = [0u8; 24];
                                    let val =
                                        ansi256::from(rgba.red, rgba.green, rgba.blue, &mut buf);
                                    break 'color BunString::clone_latin1(val);
                                }
                                _ => unreachable!(),
                            }
                        }

                        OutputColorFormat::Hsl => {
                            let hsl: HSL = match &result {
                                CssColor::Float(float) => match &**float {
                                    css::FloatColor::Hsl(hsl) => *hsl,
                                    other => other.into_hsl(),
                                },
                                CssColor::Rgba(rgba) => rgba.into_hsl(),
                                CssColor::Lab(lab) => lab.into_hsl(),
                                _ => break 'formatted,
                            };

                            // Saturation and lightness are stored as 0..1 but hsl()
                            // takes percentages. A missing component (an achromatic
                            // hue, or `none`) is a zero value in a concrete color.
                            break 'color BunString::create_format(format_args!(
                                "hsl({}, {}%, {}%)",
                                zero_if_none(hsl.h),
                                zero_if_none(hsl.s) * 100.0,
                                zero_if_none(hsl.l) * 100.0
                            ));
                        }
                        OutputColorFormat::Lab => {
                            let lab: LAB = match &result {
                                CssColor::Float(float) => float.into_lab(),
                                CssColor::Lab(lab) => match &**lab {
                                    css::LabColor::Lab(lab_) => *lab_,
                                    other => other.into_lab(),
                                },
                                CssColor::Rgba(rgba) => rgba.into_lab(),
                                _ => break 'formatted,
                            };

                            // lab() is space-separated and takes lightness as a
                            // percentage, matching what the CSS printer emits.
                            break 'color BunString::create_format(format_args!(
                                "lab({}% {} {})",
                                zero_if_none(lab.l) * 100.0,
                                zero_if_none(lab.a),
                                zero_if_none(lab.b)
                            ));
                        }
                    }
                };

                return str.transfer_to_js(global);
            }

            // Fallback to CSS string output
            let arena = Arena::new();
            let mut dest: Vec<u8> = Vec::new();

            let symbols = SymbolMap::init_list(Default::default());
            let mut printer = css::Printer::new(
                &arena,
                bun_alloc::ArenaVec::<u8>::new_in(&arena),
                &mut dest,
                &css::PrinterOptions::default(),
                None,
                None,
                &symbols,
            );

            if let Err(err) = result.to_css(&mut printer) {
                return Err(global.throw(format_args!("color() internal error: {}", err.name())));
            }
            drop(printer);

            return bun_jsc::bun_string_jsc::create_utf8_for_js(global, &dest);
        }
    }
}
