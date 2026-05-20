use core::fmt::Write as _;
use std::io::Write as _;

use bun_alloc::Arena;
use bun_ast::Log;
use bun_core::String as BunString;
use bun_core::output::{ColorDepth, Source as OutputSource};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue};

use crate::JsResult;

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum OutputColorFormat {
    Ansi,
    Ansi16,
    Ansi16m,
    Ansi256,
    Css,
    Hex,
    HexUpper, // Zig: `HEX`
    Hsl,
    Lab,
    Number,
    Rgb,
    Rgba,
    RgbArray,   // Zig: `@"[rgb]"`
    RgbaArray,  // Zig: `@"[rgba]"`
    RgbObject,  // Zig: `@"{rgb}"`
    RgbaObject, // Zig: `@"{rgba}"`
}

impl bun_jsc::FromJsEnum for OutputColorFormat {
    fn from_js_value(
        v: JSValue,
        global: &JSGlobalObject,
        property_name: &'static str,
    ) -> JsResult<Self> {
        use bun_jsc::ComptimeStringMapExt as _;
        match Self::MAP.from_js(global, v)? {
            Some(e) => Ok(e),
            None => Err(global.throw_invalid_argument_type(
                "color",
                property_name,
                "OutputColorFormat string",
            )),
        }
    }
}

impl OutputColorFormat {
    pub const MAP: phf::Map<&'static [u8], OutputColorFormat> = phf::phf_map! {
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
            (grey_avg.wrapping_sub(3)) / 10
        };
        let grey = 8u32.wrapping_add(10u32.wrapping_mul(grey_idx));

        let d = sqdist(cr, cg, cb, r, g, b);
        let idx = if sqdist(grey, grey, grey, r, g, b) < d {
            232u32.wrapping_add(grey_idx)
        } else {
            16u32
                .wrapping_add(36u32.wrapping_mul(qr))
                .wrapping_add(6u32.wrapping_mul(qg))
                .wrapping_add(qb)
        };
        idx
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

    pub fn get16(r: u32, g: u32, b: u32) -> u8 {
        let val = get(r, g, b);
        TABLE_256[(val & 0xff) as usize]
    }

    pub type Buffer = [u8; 24];

    /// Zig signature took `RGBA`; here we take the channels directly so the
    /// pure escape-sequence builder doesn't depend on `bun_css::values::color`.
    pub fn from(red: u8, green: u8, blue: u8, buf: &mut Buffer) -> &[u8] {
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

    let mut log = Log::init();

    let unresolved_format: OutputColorFormat = 'brk: {
        if !args[1].is_empty_or_undefined_or_null() {
            if !args[1].is_string() {
                return Err(global.throw_invalid_argument_type("color", "format", "string"));
            }

            break 'brk args[1].to_enum::<OutputColorFormat>(global, "format")?;
        }

        break 'brk OutputColorFormat::Css;
    };
    let mut input = ZigStringSlice::EMPTY;

    let parsed_color: css::CssColorParseResult = 'brk: {
        if args[0].is_number() {
            let number: i64 = args[0].to_int64();
            // Zig: packed struct(u32) { blue: u8, green: u8, red: u8, alpha: u8 }
            let int: u32 = number.rem_euclid(u32::MAX as i64).unsigned_abs() as u32;
            let blue = (int & 0xff) as u8;
            let green = ((int >> 8) & 0xff) as u8;
            let red = ((int >> 16) & 0xff) as u8;
            let alpha = ((int >> 24) & 0xff) as u8;

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
                        break 'brk2 Some(
                            u8::try_from(((a_value.as_number() * 255.0) as i64).rem_euclid(256))
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
                alpha: if let Some(a) = a { a } else { 255 },
                red: u8::try_from(r).expect("int cast"),
                green: u8::try_from(g).expect("int cast"),
                blue: u8::try_from(b).expect("int cast"),
            }));
        }

        input = args[0].to_slice(global)?;

        // Zig used ArenaAllocator + stackFallback(4096) (free init); MimallocArena::new()
        // calls mi_heap_new(), so defer creation to the paths that actually allocate.
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

            // TODO(port): Zig used `@tagName(err.basic().kind)`; `BasicParseErrorKind`
            // currently lacks `IntoStaticStr` in bun_css — falls back to Display until
            // the derive lands.
            return Err(global.throw(format_args!("color() failed to parse {}", err.basic().kind)));
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
                                    // TODO(port): inline else over FloatColor variants → trait `IntoColor<SRGB>`
                                    other => other.into_srgb(),
                                },
                                CssColor::Rgba(rgba) => rgba.into_srgb(),
                                CssColor::Lab(lab) => {
                                    // TODO(port): inline else over LabColor variants → trait `IntoColor<SRGB>`
                                    lab.into_srgb()
                                }
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
                                    let ansi_16_color = ansi256::get16(
                                        rgba.red as u32,
                                        rgba.green as u32,
                                        rgba.blue as u32,
                                    );
                                    // 16-color ansi, foreground text color
                                    break 'color BunString::clone_latin1(&[
                                        // 0x1b is the escape character
                                        // 38 is the foreground color code
                                        // 5 is the 16-color mode
                                        // {d} is the color index
                                        0x1b,
                                        b'[',
                                        b'3',
                                        b'8',
                                        b';',
                                        b'5',
                                        b';',
                                        ansi_16_color,
                                        b'm',
                                    ]);
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
                                    // TODO(port): inline else over FloatColor variants → trait `IntoColor<HSL>`
                                    other => other.into_hsl(),
                                },
                                CssColor::Rgba(rgba) => rgba.into_hsl(),
                                CssColor::Lab(lab) => {
                                    // TODO(port): inline else over LabColor variants → trait `IntoColor<HSL>`
                                    lab.into_hsl()
                                }
                                _ => break 'formatted,
                            };

                            break 'color BunString::create_format(format_args!(
                                "hsl({}, {}, {})",
                                hsl.h, hsl.s, hsl.l
                            ));
                        }
                        OutputColorFormat::Lab => {
                            let lab: LAB = match &result {
                                CssColor::Float(float) => {
                                    // TODO(port): inline else over FloatColor variants → trait `IntoColor<LAB>`
                                    float.into_lab()
                                }
                                CssColor::Lab(lab) => match &**lab {
                                    css::LabColor::Lab(lab_) => *lab_,
                                    // TODO(port): inline else over LabColor variants → trait `IntoColor<LAB>`
                                    other => other.into_lab(),
                                },
                                CssColor::Rgba(rgba) => rgba.into_lab(),
                                _ => break 'formatted,
                            };

                            break 'color BunString::create_format(format_args!(
                                "lab({}, {}, {})",
                                lab.l, lab.a, lab.b
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
            // TODO(port): css::Printer::new signature — Zig passes (allocator, ArrayList, writer, opts, null, null, &symbols)
            let mut printer = css::Printer::new(
                &arena,
                bun_alloc::ArenaVec::<u8>::new_in(&arena),
                &mut dest,
                css::PrinterOptions::default(),
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

// ported from: src/css_jsc/color_js.zig
