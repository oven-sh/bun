//! `Bun.highlight`: `html()` and the `Theme` class, over `bun_format::highlight`.

use crate::node::StringOrBuffer;
use bun_core::output::{ColorDepth, Source as OutputSource};
use bun_format::highlight::{
    self, AnsiStyles, Color, Font, Language, PartialStyle, Scratch, Span, Token,
};
use bun_jsc::bun_string_jsc;
use bun_jsc::{
    CallFrame, JSGlobalObject, JSPropertyIterator, JSPropertyIteratorOptions, JSValue, JsResult,
    RangeErrorOptions,
};

pub(crate) fn create(global: &JSGlobalObject) -> JSValue {
    let object = bun_jsc::create_host_function_object(global, &[("html", __jsc_host_html, 2)]);
    object.put(
        global,
        b"Theme",
        bun_jsc::codegen::js::get_constructor::<Theme>(global),
    );
    object
}

/// Returns `None` for a language that Bun doesn't highlight.
fn language_from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<Language>> {
    if !value.is_string() {
        return Err(global.throw_invalid_argument_type_value("language", "string", value));
    }
    Ok(Language::from_name(&value.to_utf8(global)?))
}

/// Highlights `code` and returns what `then` makes of the code and its tokens, as a string. Without a language there are
/// no tokens.
fn with_tokens(
    global: &JSGlobalObject,
    code: JSValue,
    language: Option<Language>,
    then: impl FnOnce(&[u8], &[Span]) -> Vec<u8>,
) -> JsResult<JSValue> {
    let Some(code) = StringOrBuffer::from_js(global, code)? else {
        return Err(global.throw_invalid_argument_type_value(
            "code",
            "string, TypedArray or ArrayBuffer",
            code,
        ));
    };
    let code = code.slice();
    if code.len() > u32::MAX as usize {
        return Err(global.throw_range_error(
            code.len() as i64,
            RangeErrorOptions {
                max: i64::from(u32::MAX),
                field_name: b"code.byteLength",
                ..Default::default()
            },
        ));
    }
    let mut scratch = Scratch::default();
    let tokens = language.map(|it| highlight::highlight(code, it, &mut scratch));
    bun_string_jsc::owned_utf8_into_js(global, then(code, tokens.unwrap_or_default()))
}

/// `Bun.highlight.html(code, language)`
#[bun_jsc::host_fn]
fn html(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [code, language] = frame.arguments_as_array::<2>();
    let Some(language) = language_from_js(global, language)? else {
        return Ok(JSValue::NULL);
    };
    with_tokens(global, code, Some(language), |code, spans| {
        let mut out = Vec::new();
        highlight::write_html(code, spans, &mut out);
        out
    })
}

fn color_from_js(global: &JSGlobalObject, name: &[u8], value: JSValue) -> JsResult<Color> {
    if !value.is_string() {
        return Err(global.throw_invalid_property_type_value(name, b"string", value));
    }
    match bun_css_jsc::color_js::parse_rgb(&value.to_utf8(global)?) {
        Some([r, g, b]) => Ok(Color::Rgb(r, g, b)),
        None => Err(global.throw_invalid_argument_property_value(
            name,
            Some("an opaque CSS color"),
            value,
        )),
    }
}

/// `"#ff0000"` or `{ color, bold, italic, underline, strikethrough }`
fn style_from_js(global: &JSGlobalObject, name: &[u8], value: JSValue) -> JsResult<PartialStyle> {
    const FONTS: [(&str, Font); 4] = [
        ("bold", Font::BOLD),
        ("italic", Font::ITALIC),
        ("underline", Font::UNDERLINE),
        ("strikethrough", Font::STRIKETHROUGH),
    ];
    let mut style = PartialStyle::default();
    if !value.is_object() {
        style.color = Some(color_from_js(global, name, value)?);
        return Ok(style);
    }
    if let Some(color) = value.get(global, "color")?
        && !color.is_undefined()
    {
        style.color = Some(color_from_js(global, name, color)?);
    }
    for (property, font) in FONTS {
        if let Some(is_on) = value.get_boolean_strict(global, property)? {
            style.font_given |= font;
            style.font.set(font, is_on);
        }
    }
    Ok(style)
}

enum Styles {
    /// The caller didn't pass any. Dark or light, whichever suits where the code is shown.
    Auto,
    Dark,
    Light,
    Custom(Box<highlight::Theme>),
}

fn styles_from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Styles> {
    if value.is_undefined() {
        return Ok(Styles::Auto);
    }
    if value.is_string() {
        return match &*value.to_utf8(global)? {
            b"dark" => Ok(Styles::Dark),
            b"light" => Ok(Styles::Light),
            _ => Err(global.throw_invalid_argument_value_custom(
                b"styles",
                value,
                b"must be \"dark\", \"light\" or an object",
            )),
        };
    }
    let Some(object) = value.get_object() else {
        return Err(global.throw_invalid_argument_type_value("styles", "string or object", value));
    };
    let (mut foreground, mut background) = (None, None);
    let mut styles = [PartialStyle::default(); Token::COUNT];
    let properties =
        JSPropertyIterator::init(global, object, JSPropertyIteratorOptions::new(true, true))?;
    while let Some((name, value)) = properties.next()? {
        if value.is_undefined() {
            continue;
        }
        let name = name.to_utf8();
        match (&*name, Token::from_name(&name)) {
            (b"foreground", _) => foreground = Some(color_from_js(global, &name, value)?),
            (b"background", _) => background = Some(color_from_js(global, &name, value)?),
            (_, Some(token)) => styles[token as usize] = style_from_js(global, &name, value)?,
            (_, None) => {
                return Err(global.throw_invalid_arguments(format_args!(
                    "\"{}\" is not a token that a theme can style",
                    bstr::BStr::new(&*name)
                )));
            }
        }
    }
    Ok(Styles::Custom(Box::new(highlight::Theme::new(
        foreground, background, &styles,
    ))))
}

/// Takes the values of `process.stdout.getColorDepth()`.
fn color_depth_from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<ColorDepth> {
    if value.is_undefined() {
        return Ok(OutputSource::color_depth());
    }
    match value.is_number().then(|| value.as_number()) {
        Some(1.0) => Ok(ColorDepth::None),
        Some(4.0) => Ok(ColorDepth::C16),
        Some(8.0) => Ok(ColorDepth::C256),
        Some(24.0) => Ok(ColorDepth::C16m),
        _ => Err(global.throw_invalid_argument_property_value(
            b"colorDepth",
            Some("1, 4, 8 or 24"),
            value,
        )),
    }
}

/// `new Bun.highlight.Theme(styles?, { colorDepth }?)`
#[bun_jsc::JsClass]
pub(crate) struct Theme {
    styles: Styles,
    ansi: AnsiStyles,
}

impl Theme {
    pub(crate) fn constructor(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<Box<Theme>> {
        let [styles, options] = frame.arguments_as_array::<2>();
        let styles = styles_from_js(global, styles)?;
        let depth = match options.is_undefined() {
            true => JSValue::UNDEFINED,
            false if !options.is_object() => {
                return Err(global.throw_invalid_argument_type_value("options", "object", options));
            }
            false => (options.get(global, "colorDepth")?).unwrap_or(JSValue::UNDEFINED),
        };
        let depth = color_depth_from_js(global, depth)?;
        let theme = match &styles {
            Styles::Custom(theme) => theme,
            Styles::Light => highlight::Theme::built_in(true, depth),
            Styles::Dark => highlight::Theme::built_in(false, depth),
            Styles::Auto => {
                highlight::Theme::built_in(bun_md::root::detect_light_background(), depth)
            }
        };
        let ansi = AnsiStyles::new(theme, depth);
        Ok(Box::new(Theme { styles, ansi }))
    }

    /// `theme.ansi(code, language)`
    #[bun_jsc::host_fn(method)]
    pub(crate) fn ansi(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let [code, language] = frame.arguments_as_array::<2>();
        let Some(language) = language_from_js(global, language)? else {
            return Ok(JSValue::NULL);
        };
        let language = self.ansi.has_colors().then_some(language);
        with_tokens(global, code, language, |code, spans| {
            let mut out = Vec::new();
            highlight::write_ansi(code, spans, &self.ansi, &mut out);
            out
        })
    }

    /// `theme.css()`
    #[bun_jsc::host_fn(method)]
    pub(crate) fn css(&self, global: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        let mut out = Vec::new();
        match &self.styles {
            Styles::Custom(theme) => highlight::write_css(theme, &mut out),
            Styles::Dark => highlight::write_css(&highlight::Theme::DARK, &mut out),
            Styles::Light => highlight::write_css(&highlight::Theme::LIGHT, &mut out),
            Styles::Auto => {
                highlight::write_css(&highlight::Theme::LIGHT, &mut out);
                out.extend_from_slice(b"@media (prefers-color-scheme: dark) {\n");
                highlight::write_css(&highlight::Theme::DARK, &mut out);
                out.extend_from_slice(b"}\n");
            }
        }
        bun_string_jsc::owned_utf8_into_js(global, out)
    }
}
