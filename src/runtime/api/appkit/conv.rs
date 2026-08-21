//! JavaScript values in, `bun_appkit` types out; `bun_appkit` errors in,
//! JavaScript exceptions out.

use bun_appkit::view::{Column, ImageScaling, ImageSource, TextAlign};
use bun_appkit::{
    ActivationPolicy, Color, Design, Font, Insets, Kind, Named, NsStr, Positive, Prop, SystemColor,
    Weight,
};
use bun_core::OwnedString;
use bun_jsc::{JSGlobalObject, JSValue, JsError, JsResult, StringJsc};

/// A JavaScript string held alive so AppKit can read its characters in place.
pub(crate) struct JsStr(OwnedString);

impl JsStr {
    /// `what` names the value in the TypeError when `value` is not a string.
    pub(crate) fn new(
        global: &JSGlobalObject,
        value: JSValue,
        what: core::fmt::Arguments<'_>,
    ) -> JsResult<JsStr> {
        if !value.is_string() {
            return Err(global.throw_invalid_arguments(format_args!("{what} must be a string")));
        }
        Ok(JsStr(OwnedString::new(bun_core::String::from_js(
            value, global,
        )?)))
    }

    /// Anything, via `String(value)`.
    pub(crate) fn coerce(global: &JSGlobalObject, value: JSValue) -> JsResult<JsStr> {
        Ok(JsStr(OwnedString::new(bun_core::String::from_js(
            value, global,
        )?)))
    }

    pub(crate) fn ns(&self) -> NsStr<'_> {
        let s: &bun_core::String = &self.0;
        debug_assert!(!s.is_utf8(), "JsStr is always WTF-backed");
        if s.is_utf16() {
            NsStr::Utf16(s.utf16())
        } else {
            NsStr::Latin1(s.latin1())
        }
    }

    /// Transcodes once; a lone surrogate becomes U+FFFD.
    pub(crate) fn to_utf8(&self) -> Utf8 {
        Utf8(
            String::from_utf8(self.0.to_utf8_bytes())
                .unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned()),
        )
    }
}

/// A JavaScript string transcoded to UTF-8.
#[derive(Default)]
pub(crate) struct Utf8(String);

impl Utf8 {
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }

    pub(crate) fn into_string(self) -> String {
        self.0
    }
}

impl PartialEq<&str> for Utf8 {
    fn eq(&self, other: &&str) -> bool {
        self.0 == *other
    }
}

impl PartialEq<Utf8> for &str {
    fn eq(&self, other: &Utf8) -> bool {
        *self == other.0
    }
}

impl core::ops::Deref for Utf8 {
    type Target = str;
    fn deref(&self) -> &str {
        self.as_str()
    }
}

impl core::fmt::Display for Utf8 {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(self.as_str())
    }
}

pub(crate) fn utf16_to_js(global: &JSGlobalObject, text: &[u16]) -> JsResult<JSValue> {
    bun_core::String::borrow_utf16(text).to_js(global)
}

/// `null` (JavaScript's "reset") reads as `None`.
pub(crate) fn optional_string(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
) -> JsResult<Option<JsStr>> {
    if value.is_undefined_or_null() {
        return Ok(None);
    }
    if !value.is_string() {
        return Err(global.throw_invalid_arguments(format_args!("{what} must be a string or null")));
    }
    JsStr::new(global, value, what).map(Some)
}

pub(crate) fn number(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
) -> JsResult<f64> {
    if !value.is_number() {
        return Err(global.throw_invalid_arguments(format_args!("{what} must be a number")));
    }
    finite(global, value.as_number(), what)
}

/// `null` (JavaScript's "reset") reads as `None`.
pub(crate) fn optional_number(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
) -> JsResult<Option<f64>> {
    if value.is_undefined_or_null() {
        return Ok(None);
    }
    if !value.is_number() {
        return Err(global.throw_invalid_arguments(format_args!("{what} must be a number or null")));
    }
    finite(global, value.as_number(), what).map(Some)
}

fn finite(global: &JSGlobalObject, n: f64, what: core::fmt::Arguments<'_>) -> JsResult<f64> {
    if !n.is_finite() {
        return Err(global.throw_invalid_arguments(format_args!("{what} must be a finite number")));
    }
    Ok(n)
}

/// `NSWindow` raises (and the process aborts) unless every frame edge lies in
/// `[i32::MIN, i32::MAX]`, and auto-layout grows the window to fit its content, so
/// every length or coordinate that reaches AppKit is capped well inside that.
pub(crate) const MAX_POINTS: f64 = 1.0e7;

/// A screen length or coordinate: finite and at most [`MAX_POINTS`] in magnitude.
pub(crate) fn points(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
) -> JsResult<f64> {
    if value.is_number() {
        let n = value.as_number();
        if n.is_finite() && n.abs() <= MAX_POINTS {
            return Ok(n);
        }
    }
    Err(global.throw_invalid_arguments(format_args!(
        "{what} must be a finite number no larger than {MAX_POINTS}"
    )))
}

/// `null` (JavaScript's "reset") reads as `None`.
pub(crate) fn optional_points(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
) -> JsResult<Option<f64>> {
    if value.is_undefined_or_null() {
        return Ok(None);
    }
    if value.is_number() {
        let n = value.as_number();
        if n.is_finite() && n.abs() <= MAX_POINTS {
            return Ok(Some(n));
        }
    }
    Err(global.throw_invalid_arguments(format_args!(
        "{what} must be null or a finite number no larger than {MAX_POINTS}"
    )))
}

/// A value greater than zero; `0`, `null` and `undefined` read as `None` ("automatic").
pub(crate) fn positive(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
) -> JsResult<Option<Positive>> {
    if value.is_undefined_or_null() {
        return Ok(None);
    }
    let bad = || global.throw_invalid_arguments(format_args!("{what} must be a positive number or null"));
    if !value.is_number() {
        return Err(bad());
    }
    let n = value.as_number();
    if n == 0.0 {
        return Ok(None);
    }
    Positive::new(n).map(Some).ok_or_else(bad)
}

/// [`positive`] for a screen length: also at most [`MAX_POINTS`].
pub(crate) fn positive_points(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
) -> JsResult<Option<Positive>> {
    match positive(global, value, what)? {
        Some(p) if p.get() > MAX_POINTS => Err(global.throw_invalid_arguments(format_args!(
            "{what} must be a positive number no larger than {MAX_POINTS} or null"
        ))),
        other => Ok(other),
    }
}

pub(crate) fn boolean(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
) -> JsResult<bool> {
    if !value.is_boolean() {
        return Err(global.throw_invalid_arguments(format_args!("{what} must be a boolean")));
    }
    Ok(value.as_boolean())
}

pub(crate) fn optional_boolean(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
) -> JsResult<Option<bool>> {
    if value.is_undefined_or_null() {
        return Ok(None);
    }
    if !value.is_boolean() {
        return Err(
            global.throw_invalid_arguments(format_args!("{what} must be a boolean or null"))
        );
    }
    Ok(Some(value.as_boolean()))
}

/// A colour string, or `null` for none.
pub(crate) fn color(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
) -> JsResult<Option<Color>> {
    if value.is_undefined_or_null() {
        return Ok(None);
    }
    if !value.is_string() {
        return Err(
            global.throw_invalid_arguments(format_args!("{what} must be a color string or null"))
        );
    }
    let s = JsStr::new(global, value, what)?;
    match Color::parse(&s.to_utf8()) {
        Ok(c) => Ok(Some(c)),
        Err(e) => Err(global.throw_invalid_arguments(format_args!("{what}: {e}"))),
    }
}

/// A number (point size), a `{ size, weight, design, italic }` object, or `null`.
pub(crate) fn font(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
) -> JsResult<Option<Font>> {
    if value.is_undefined_or_null() {
        return Ok(None);
    }
    if value.is_number() {
        return Ok(Some(Font {
            size: positive_points(global, value, what)?,
            ..Font::default()
        }));
    }
    if !value.is_object() {
        return Err(global.throw_invalid_arguments(format_args!(
            "{what} must be a number, a {{ size, weight, design, italic }} object or null"
        )));
    }
    let mut font = Font::default();
    if let Some(size) = value.get(global, "size")? {
        font.size = positive_points(global, size, format_args!("{what}.size"))?;
    }
    if let Some(weight) = value.get(global, "weight")? {
        font.weight = if weight.is_number() {
            Weight::from_css(number(global, weight, format_args!("{what}.weight"))?)
        } else if weight.is_string() {
            let name = JsStr::new(global, weight, format_args!("{what}.weight"))?.to_utf8();
            let name = if name == "normal" { "regular" } else { name.as_str() };
            Weight::from_name(name).ok_or_else(|| {
                global.throw_invalid_arguments(format_args!(
                    "{what}.weight: unknown weight \"{name}\""
                ))
            })?
        } else {
            return Err(global.throw_invalid_arguments(format_args!(
                "{what}.weight must be a number from 100 to 900 or a weight name"
            )));
        };
    }
    if let Some(design) = value.get(global, "design")? {
        font.design = one_of::<Design>(global, design, format_args!("{what}.design"))?;
    }
    if let Some(italic) = value.get(global, "italic")? {
        font.italic = boolean(global, italic, format_args!("{what}.italic"))?;
    }
    Ok(Some(font))
}

/// A number for all edges, `{ top, left, bottom, right }`, `{ x, y }`, `[vertical, horizontal]`,
/// or `None` for null.
fn insets(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
) -> JsResult<Option<Insets>> {
    if value.is_undefined_or_null() {
        return Ok(None);
    }
    if value.is_number() {
        return Ok(Some(Insets::uniform(points(global, value, what)?.max(0.0))));
    }
    let (top, left, bottom, right) = if value.is_array() {
        if value.get_length(global)? != 2 {
            return Err(global.throw_invalid_arguments(format_args!(
                "{what} array form is [vertical, horizontal]"
            )));
        }
        let v = points(
            global,
            value.get_index(global, 0)?,
            format_args!("{what}[0]"),
        )?;
        let h = points(
            global,
            value.get_index(global, 1)?,
            format_args!("{what}[1]"),
        )?;
        (v, h, v, h)
    } else if value.is_object() {
        let edge = |name: &'static str| -> JsResult<Option<f64>> {
            match value.get(global, name)? {
                Some(v) => points(global, v, format_args!("{what}.{name}")).map(Some),
                None => Ok(None),
            }
        };
        let x = edge("x")?;
        let y = edge("y")?;
        (
            edge("top")?.or(y).unwrap_or(0.0),
            edge("left")?.or(x).unwrap_or(0.0),
            edge("bottom")?.or(y).unwrap_or(0.0),
            edge("right")?.or(x).unwrap_or(0.0),
        )
    } else {
        return Err(global.throw_invalid_arguments(format_args!(
            "{what} must be a number, an [vertical, horizontal] pair or a {{ top, left, bottom, right }} object"
        )));
    };
    Ok(Some(Insets {
        top: top.max(0.0),
        left: left.max(0.0),
        bottom: bottom.max(0.0),
        right: right.max(0.0),
    }))
}

/// A string naming one of `T`'s variants; the TypeError lists them all.
fn one_of<T: Named>(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
) -> JsResult<T> {
    if value.is_string() {
        let name = JsStr::new(global, value, what)?.to_utf8();
        if let Some(v) = T::from_name(&name) {
            return Ok(v);
        }
    }
    let mut names = String::new();
    for (i, (name, _)) in T::ALL.iter().enumerate() {
        if i > 0 {
            names.push_str(if i + 1 == T::ALL.len() { " or " } else { ", " });
        }
        names.push('"');
        names.push_str(name);
        names.push('"');
    }
    Err(global.throw_invalid_arguments(format_args!("{what} must be {names}")))
}

/// `null` (JavaScript's "reset") reads as `None`.
fn optional_one_of<T: Named>(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
) -> JsResult<Option<T>> {
    if value.is_undefined_or_null() {
        Ok(None)
    } else {
        one_of(global, value, what).map(Some)
    }
}

/// `app.activationPolicy` / the argument to `app.start()`.
pub(crate) fn activation_policy(global: &JSGlobalObject, value: JSValue) -> JsResult<ActivationPolicy> {
    one_of::<ActivationPolicy>(global, value, format_args!("app.activationPolicy"))
}

fn string_array(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
) -> JsResult<Vec<JsStr>> {
    if value.is_undefined_or_null() {
        return Ok(Vec::new());
    }
    if !value.is_array() {
        return Err(
            global.throw_invalid_arguments(format_args!("{what} must be an array of strings"))
        );
    }
    let mut out = Vec::new();
    let mut iter = value.array_iterator(global)?;
    let mut i = 0usize;
    while let Some(item) = iter.next()? {
        let s = if item.is_string() {
            JsStr::new(global, item, format_args!("{what}[{i}]"))?
        } else if item.is_number() || item.is_boolean() {
            JsStr::coerce(global, item)?
        } else {
            return Err(
                global.throw_invalid_arguments(format_args!("{what}[{i}] must be a string"))
            );
        };
        out.push(s);
        i += 1;
    }
    Ok(out)
}

/// Converts `value` for property `key` of a `kind` view and hands the typed
/// prop to `apply` while the JavaScript strings it borrows are still alive.
pub(crate) fn with_prop<R>(
    global: &JSGlobalObject,
    kind: Kind,
    key: &[u8],
    value: JSValue,
    apply: impl FnOnce(Prop<'_>) -> R,
) -> JsResult<R> {
    let kind_name = kind.name();
    let key_name = bstr::BStr::new(key);
    let what = format_args!("{kind_name}.{key_name}");
    let prop = match key {
        b"hidden" => Prop::Hidden(optional_boolean(global, value, what)?.unwrap_or(false)),
        b"alpha" => Prop::Alpha(optional_number(global, value, what)?.unwrap_or(1.0)),
        b"tooltip" => {
            let s = optional_string(global, value, what)?;
            return Ok(apply(Prop::Tooltip(s.as_ref().map(JsStr::ns))));
        }
        b"id" => {
            let s = optional_string(global, value, what)?;
            return Ok(apply(Prop::Identifier(s.as_ref().map(JsStr::ns))));
        }
        b"width" => Prop::Width(optional_points(global, value, what)?),
        b"height" => Prop::Height(optional_points(global, value, what)?),
        b"minWidth" => Prop::MinWidth(optional_points(global, value, what)?),
        b"maxWidth" => Prop::MaxWidth(optional_points(global, value, what)?),
        b"minHeight" => Prop::MinHeight(optional_points(global, value, what)?),
        b"maxHeight" => Prop::MaxHeight(optional_points(global, value, what)?),
        b"grow" => {
            let grow = if value.is_boolean() {
                f64::from(u8::from(value.as_boolean()))
            } else {
                optional_number(global, value, what)?.unwrap_or(0.0)
            };
            Prop::Grow(grow.max(0.0))
        }
        b"background" => Prop::Background(color(global, value, what)?),
        b"cornerRadius" => Prop::CornerRadius(optional_points(global, value, what)?.unwrap_or(0.0)),
        b"border" => {
            if value.is_undefined_or_null() {
                Prop::Border {
                    width: 0.0,
                    color: None,
                }
            } else if value.is_number() {
                Prop::Border {
                    width: points(global, value, what)?.max(0.0),
                    color: Some(Color::System(SystemColor::Separator)),
                }
            } else if value.is_object() {
                let width = match value.get(global, "width")? {
                    Some(w) => points(global, w, format_args!("{what}.width"))?.max(0.0),
                    None => 1.0,
                };
                let color = match value.get(global, "color")? {
                    Some(c) => color(global, c, format_args!("{what}.color"))?,
                    None => Some(Color::System(SystemColor::Separator)),
                };
                Prop::Border { width, color }
            } else {
                return Err(global.throw_invalid_arguments(format_args!(
                    "{what} must be a number, a {{ width, color }} object or null"
                )));
            }
        }
        b"spacing" => Prop::Spacing(optional_points(global, value, what)?),
        b"padding" => Prop::Padding(insets(global, value, what)?),
        b"align" => Prop::Align(optional_one_of(global, value, what)?),
        b"distribution" => Prop::Distribution(optional_one_of(global, value, what)?),
        b"minLength" => Prop::MinLength(positive_points(global, value, what)?),
        b"text" | b"title" => {
            let s = optional_string(global, value, what)?;
            return Ok(apply(Prop::Text(
                s.as_ref().map_or(NsStr::Utf8(""), JsStr::ns),
            )));
        }
        b"value" if kind.value_is_text() => {
            let s = optional_string(global, value, what)?;
            return Ok(apply(Prop::Text(
                s.as_ref().map_or(NsStr::Utf8(""), JsStr::ns),
            )));
        }
        b"value" => Prop::Number(optional_number(global, value, what)?.unwrap_or(0.0)),
        b"font" => Prop::Font(font(global, value, what)?),
        b"color" => Prop::Color(color(global, value, what)?),
        b"textAlign" => Prop::TextAlign(optional_one_of(global, value, what)?.unwrap_or(TextAlign::Natural)),
        b"selectable" => Prop::Selectable(optional_boolean(global, value, what)?),
        b"lineLimit" => Prop::LineLimit(
            optional_number(global, value, what)?.map(|lines| lines.max(0.0) as usize),
        ),
        b"enabled" => Prop::Enabled(optional_boolean(global, value, what)?.unwrap_or(true)),
        b"editable" => Prop::Editable(optional_boolean(global, value, what)?.unwrap_or(true)),
        b"kind" => Prop::ButtonKind(optional_one_of(global, value, what)?),
        b"symbol" => {
            let s = optional_string(global, value, what)?;
            return Ok(apply(Prop::Symbol(s.as_ref().map(JsStr::ns))));
        }
        b"keyEquivalent" => {
            let s = optional_string(global, value, what)?;
            return Ok(apply(Prop::KeyEquivalent(
                s.as_ref().map(JsStr::ns).filter(|key| !key.is_empty()),
            )));
        }
        b"checked" => Prop::Checked(optional_boolean(global, value, what)?.unwrap_or(false)),
        b"placeholder" => {
            let s = optional_string(global, value, what)?;
            return Ok(apply(Prop::Placeholder(s.as_ref().map(JsStr::ns))));
        }
        b"continuous" => Prop::Continuous(optional_boolean(global, value, what)?),
        b"min" => Prop::Min(optional_number(global, value, what)?),
        b"max" => Prop::Max(optional_number(global, value, what)?),
        b"step" => Prop::Step(positive(global, value, what)?),
        b"items" => {
            let owned = string_array(global, value, what)?;
            let items: Vec<NsStr<'_>> = owned.iter().map(JsStr::ns).collect();
            return Ok(apply(Prop::Items(items)));
        }
        b"selectedIndex" => Prop::SelectedIndex(
            optional_number(global, value, what)?.map(|i| (i >= 0.0).then_some(i as usize)),
        ),
        b"indeterminate" => Prop::Indeterminate(optional_boolean(global, value, what)?),
        b"running" => Prop::Running(optional_boolean(global, value, what)?),
        b"spinner" => Prop::Spinner(optional_boolean(global, value, what)?),
        b"image" => return image(global, value, what, apply),
        b"scaling" => Prop::Scaling(optional_one_of(global, value, what)?.unwrap_or(ImageScaling::Down)),
        b"tint" => Prop::Tint(color(global, value, what)?),
        b"size" => Prop::SymbolSize(positive_points(global, value, what)?),
        b"vertical" => Prop::Vertical(optional_boolean(global, value, what)?),
        b"scrollBars" => {
            let (horizontal, vertical) = if value.is_undefined_or_null() {
                (None, None)
            } else if value.is_boolean() {
                (Some(value.as_boolean()), Some(value.as_boolean()))
            } else if value.is_string() {
                let (h, v) = match JsStr::new(global, value, what)?.to_utf8().as_str() {
                    "none" => (false, false),
                    "horizontal" => (true, false),
                    "vertical" => (false, true),
                    "both" => (true, true),
                    other => {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "{what} must be \"none\", \"horizontal\", \"vertical\" or \"both\", got \"{other}\""
                        )));
                    }
                };
                (Some(h), Some(v))
            } else if value.is_object() {
                let flag = |name: &'static str| -> JsResult<Option<bool>> {
                    match value.get(global, name)? {
                        Some(v) => optional_boolean(global, v, format_args!("{what}.{name}")),
                        None => Ok(None),
                    }
                };
                (flag("horizontal")?, flag("vertical")?)
            } else {
                return Err(global.throw_invalid_arguments(format_args!(
                    "{what} must be a {{ horizontal, vertical }} object, a boolean or null"
                )));
            };
            Prop::ScrollBars {
                horizontal,
                vertical,
            }
        }
        b"columns" => return columns(global, value, what, apply),
        b"rows" => {
            let owned = rows(global, value, what)?;
            let rows: Vec<Vec<NsStr<'_>>> =
                owned.iter().map(|r| r.iter().map(JsStr::ns).collect()).collect();
            return Ok(apply(Prop::Rows(rows)));
        }
        b"selectedIndexes" => {
            let mut indexes = Vec::new();
            if !value.is_undefined_or_null() {
                if !value.is_array() {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "{what} must be an array of row indexes"
                    )));
                }
                let mut iter = value.array_iterator(global)?;
                while let Some(item) = iter.next()? {
                    let i = number(global, item, format_args!("{what}[]"))?;
                    if i >= 0.0 {
                        indexes.push(i as usize);
                    }
                }
            }
            Prop::SelectedIndexes(indexes)
        }
        b"multiple" => Prop::Multiple(optional_boolean(global, value, what)?.unwrap_or(false)),
        b"headerVisible" => Prop::HeaderVisible(optional_boolean(global, value, what)?),
        b"alternatingRows" => {
            Prop::AlternatingRows(optional_boolean(global, value, what)?.unwrap_or(false))
        }
        b"rowHeight" => Prop::RowHeight(positive_points(global, value, what)?),
        _ => {
            return Err(global.throw_invalid_arguments(format_args!(
                "{kind_name} has no property \"{key_name}\""
            )));
        }
    };
    Ok(apply(prop))
}

fn image<R>(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
    apply: impl FnOnce(Prop<'_>) -> R,
) -> JsResult<R> {
    if value.is_undefined_or_null() {
        return Ok(apply(Prop::Image(ImageSource::None)));
    }
    if let Some(buffer) = value.as_array_buffer(global) {
        return Ok(apply(Prop::Image(ImageSource::Data(buffer.byte_slice()))));
    }
    if !value.is_object() {
        return Err(global.throw_invalid_arguments(format_args!(
            "{what} must be {{ symbol }}, {{ file }}, {{ data }} or null"
        )));
    }
    if let Some(symbol) = value.get(global, "symbol")? {
        let s = JsStr::new(global, symbol, format_args!("{what}.symbol"))?;
        return Ok(apply(Prop::Image(ImageSource::Symbol(s.ns()))));
    }
    if let Some(file) = value.get(global, "file")? {
        let s = JsStr::new(global, file, format_args!("{what}.file"))?;
        return Ok(apply(Prop::Image(ImageSource::File(s.ns()))));
    }
    if let Some(data) = value.get(global, "data")? {
        let Some(buffer) = data.as_array_buffer(global) else {
            return Err(global.throw_invalid_arguments(format_args!(
                "{what}.data must be an ArrayBuffer or a typed array"
            )));
        };
        return Ok(apply(Prop::Image(ImageSource::Data(buffer.byte_slice()))));
    }
    Err(global.throw_invalid_arguments(format_args!(
        "{what} must be {{ symbol }}, {{ file }}, {{ data }} or null"
    )))
}

fn columns<R>(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
    apply: impl FnOnce(Prop<'_>) -> R,
) -> JsResult<R> {
    struct Owned {
        id: JsStr,
        title: JsStr,
        width: Option<Positive>,
    }
    let mut owned: Vec<Owned> = Vec::new();
    if !value.is_undefined_or_null() {
        if !value.is_array() {
            return Err(global.throw_invalid_arguments(format_args!(
                "{what} must be an array of strings or {{ id, title, width }} objects"
            )));
        }
        let mut iter = value.array_iterator(global)?;
        let mut i = 0usize;
        while let Some(item) = iter.next()? {
            if item.is_string() {
                owned.push(Owned {
                    id: JsStr::new(global, item, format_args!("{what}[{i}]"))?,
                    title: JsStr::new(global, item, format_args!("{what}[{i}]"))?,
                    width: None,
                });
            } else if item.is_object() {
                let Some(title) = item.get(global, "title")? else {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "{what}[{i}].title must be a string"
                    )));
                };
                let title = JsStr::new(global, title, format_args!("{what}[{i}].title"))?;
                let id = match item.get(global, "id")? {
                    Some(id) => JsStr::new(global, id, format_args!("{what}[{i}].id"))?,
                    None => JsStr(OwnedString::new(title.0.dupe_ref())),
                };
                let width = match item.get(global, "width")? {
                    Some(w) => positive_points(global, w, format_args!("{what}[{i}].width"))?,
                    None => None,
                };
                owned.push(Owned { id, title, width });
            } else {
                return Err(global.throw_invalid_arguments(format_args!(
                    "{what}[{i}] must be a string or a {{ id, title, width }} object"
                )));
            }
            i += 1;
        }
    }
    let columns: Vec<Column<'_>> = owned
        .iter()
        .map(|c| Column {
            id: c.id.ns(),
            title: c.title.ns(),
            width: c.width,
        })
        .collect();
    Ok(apply(Prop::Columns(columns)))
}

fn rows(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
) -> JsResult<Vec<Vec<JsStr>>> {
    let mut out = Vec::new();
    if value.is_undefined_or_null() {
        return Ok(out);
    }
    if !value.is_array() {
        return Err(global.throw_invalid_arguments(format_args!("{what} must be an array of rows")));
    }
    let mut iter = value.array_iterator(global)?;
    let mut i = 0usize;
    while let Some(row) = iter.next()? {
        if row.is_array() {
            out.push(string_array(global, row, format_args!("{what}[{i}]"))?);
        } else if row.is_string() || row.is_number() {
            out.push(string_array_from_one(global, row)?);
        } else {
            return Err(global.throw_invalid_arguments(format_args!(
                "{what}[{i}] must be an array of cell strings"
            )));
        }
        i += 1;
    }
    Ok(out)
}

fn string_array_from_one(global: &JSGlobalObject, value: JSValue) -> JsResult<Vec<JsStr>> {
    Ok(vec![JsStr::coerce(global, value)?])
}

/// The JavaScript exception for a `bun_appkit` error.
pub(crate) fn throw(global: &JSGlobalObject, err: &bun_appkit::Error) -> JsError {
    use bun_appkit::Error as E;
    match err {
        E::Load(_) => {
            let instance = global.create_error_instance(format_args!("{err}"));
            match bun_core::String::static_("ERR_APPKIT_UNAVAILABLE").to_js(global) {
                Ok(code) => instance.put(global, b"code", code),
                Err(err) => return err,
            }
            global.throw_value(instance)
        }
        E::UnknownProp(_)
        | E::NotAContainer(_)
        | E::AlreadyHasChild(_)
        | E::ChildHasParent
        | E::WouldCycle
        | E::NotAChild
        | E::BaselineAlignOnVerticalStack
        | E::BadColor(_)
        | E::BadSelector(_)
        | E::UnknownSymbol(_)
        | E::BadImageFile(_)
        | E::BadImageData
        | E::RestoreNameInUse(_) => global.throw_invalid_arguments(format_args!("{err}")),
        E::WrongThread | E::WindowClosed | E::ActivationPolicyRefused(_) => {
            global.throw(format_args!("{err}"))
        }
    }
}

/// `Ok` or the JavaScript exception for the error.
pub(crate) fn check<T>(global: &JSGlobalObject, result: bun_appkit::Result<T>) -> JsResult<T> {
    result.map_err(|e| throw(global, &e))
}
