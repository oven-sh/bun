//! JavaScript values in, `bun_appkit` types out; `bun_appkit` errors in,
//! JavaScript exceptions out.

use bun_appkit::dynamic::{DynValue, Enc, Signature, StructKind};
use bun_appkit::view::{Column, ImageScaling, ImageSource, TextAlign};
use bun_appkit::{
    ActivationPolicy, Color, Design, DynObject, Font, Insets, Kind, Named, NsStr, Point, Positive,
    Prop, Rect, Size, SystemColor, Weight,
};
use bun_core::OwnedString;
use bun_jsc::{ErrorCode, JSBigInt, JSGlobalObject, JSType, JSValue, JsError, JsResult, StringJsc};

use super::objc::{ObjCClass, ObjCObject, ObjCSelector};

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
        Utf8(match self.ns() {
            NsStr::Utf16(w) => String::from_utf16_lossy(w),
            NsStr::Latin1(b) => b.iter().map(|&c| char::from(c)).collect(),
            NsStr::Utf8(s) => s.to_owned(),
        })
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

pub(crate) fn str_to_js(global: &JSGlobalObject, text: &str) -> JsResult<JSValue> {
    bun_core::String::borrow_utf8(text.as_bytes()).to_js(global)
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
    let bad =
        || global.throw_invalid_arguments(format_args!("{what} must be a positive number or null"));
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
        Err(e) => Err(global
            .err(ErrorCode::INVALID_ARG_VALUE, format_args!("{what}: {e}"))
            .throw()),
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
            let name = if name == "normal" {
                "regular"
            } else {
                name.as_str()
            };
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
pub(crate) fn one_of<T: Named>(
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
pub(crate) fn optional_one_of<T: Named>(
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
pub(crate) fn activation_policy(
    global: &JSGlobalObject,
    value: JSValue,
) -> JsResult<ActivationPolicy> {
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
        b"textAlign" => {
            Prop::TextAlign(optional_one_of(global, value, what)?.unwrap_or(TextAlign::Natural))
        }
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
        b"scaling" => {
            Prop::Scaling(optional_one_of(global, value, what)?.unwrap_or(ImageScaling::Down))
        }
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
        b"rows" => Prop::Rows(Box::new(super::view::JsRows(rows(global, value, what)?))),
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
        b"clearColor" => Prop::ClearColor(color(global, value, what)?),
        b"preferredFPS" => Prop::PreferredFps(
            optional_number(global, value, what)?.map(|fps| fps.clamp(1.0, 240.0) as usize),
        ),
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

/// An `Error` whose `name` is `name`, for failures scripts want to tell apart
/// with `instanceof`-free checks (`e.name === "GpuCompileError"`).
fn named_error(global: &JSGlobalObject, name: &'static str, err: &bun_appkit::Error) -> JsError {
    let instance = global.create_error_instance(format_args!("{err}"));
    match bun_core::String::static_(name).to_js(global) {
        Ok(name) => instance.put(global, b"name", name),
        Err(err) => return err,
    }
    global.throw_value(instance)
}

/// The JavaScript exception for a `bun_appkit` error.
pub(crate) fn throw(global: &JSGlobalObject, err: &bun_appkit::Error) -> JsError {
    use bun_appkit::Error as E;
    match err {
        E::Load(_) => global
            .err(ErrorCode::APPKIT_UNAVAILABLE, format_args!("{err}"))
            .throw(),
        E::UnknownProp(_) | E::NotAContainer(_) => global
            .err(ErrorCode::INVALID_ARG_TYPE, format_args!("{err}"))
            .throw(),
        E::WouldCycle
        | E::BaselineAlignOnVerticalStack
        | E::BadColor(_)
        | E::BadSelector(_)
        | E::UnknownSymbol(_)
        | E::BadImageData => global
            .err(ErrorCode::INVALID_ARG_VALUE, format_args!("{err}"))
            .throw(),
        E::AlreadyHasChild(_)
        | E::ChildHasParent
        | E::NotAChild
        | E::RestoreNameInUse(_)
        | E::WrongThread
        | E::WindowClosed
        | E::ActivationPolicyRefused(_) => global
            .err(ErrorCode::INVALID_STATE, format_args!("{err}"))
            .throw(),
        E::BadImageFile(path) => {
            let instance = global.create_error_instance(format_args!("{err}"));
            match bun_core::String::borrow_utf8(path.as_bytes()).to_js(global) {
                Ok(path) => instance.put(global, b"path", path),
                Err(err) => return err,
            }
            global.throw_value(instance)
        }
        E::NoGpu => global.throw_type_error(format_args!("Metal is not available on this machine")),
        E::ShaderCompile { .. } | E::Pipeline { .. } => named_error(global, "GpuCompileError", err),
        E::GpuExecution { .. } => named_error(global, "GpuExecutionError", err),
        E::OutOfBounds { .. }
        | E::IndexOutOfRange { .. }
        | E::InlineBytesTooLarge(_)
        | E::ZeroSize(_) => {
            global.throw_value(global.create_range_error_instance(format_args!("{err}")))
        }
        E::FrameState { .. }
        | E::NoPipeline
        | E::NoDrawable
        | E::TextureNotReadable
        | E::BufferNotAccessible
        | E::InvalidState(_) => global
            .err(ErrorCode::INVALID_STATE, format_args!("{err}"))
            .throw(),
        E::NoSuchFunction { .. }
        | E::Unsupported(_)
        | E::NoClass(_)
        | E::Unrecognized { .. }
        | E::ArgCount { .. }
        | E::ArgType { .. }
        | E::UnsupportedSignature { .. }
        | E::Consumed
        | E::NotInitialized => global.throw_type_error(format_args!("{err}")),
        E::ObjectReleased => global
            .err(ErrorCode::INVALID_STATE, format_args!("{err}"))
            .throw(),
    }
}

/// `Ok` or the JavaScript exception for the error.
pub(crate) fn check<T>(global: &JSGlobalObject, result: bun_appkit::Result<T>) -> JsResult<T> {
    result.map_err(|e| throw(global, &e))
}

// ─────────────────────── the dynamic Objective-C bridge ──────────────────────

/// `value` itself, or the target of a `Proxy` (how `appkit.ts` dresses the
/// wrappers up for property-style sends).
fn through_proxy(value: JSValue) -> JSValue {
    if value.js_type() == JSType::ProxyObject {
        value.get_proxy_target()
    } else {
        value
    }
}

/// The `ObjCObject` wrapper `value` is or proxies.
pub(crate) fn objc_object<'a>(value: JSValue) -> Option<&'a ObjCObject> {
    through_proxy(value).as_class_ref::<ObjCObject>()
}

/// The `ObjCClass` wrapper `value` is or proxies.
pub(crate) fn objc_class<'a>(value: JSValue) -> Option<&'a ObjCClass> {
    through_proxy(value).as_class_ref::<ObjCClass>()
}

fn objc_selector<'a>(value: JSValue) -> Option<&'a ObjCSelector> {
    value.as_class_ref::<ObjCSelector>()
}

/// What kind of JavaScript value this is, for a message.
fn js_kind(value: JSValue) -> &'static str {
    if objc_object(value).is_some() {
        "an ObjCObject"
    } else if objc_class(value).is_some() {
        "an ObjCClass"
    } else if objc_selector(value).is_some() {
        "an ObjCSelector"
    } else if value.is_null() {
        "null"
    } else if value.is_undefined() {
        "undefined"
    } else if value.is_boolean() {
        "a boolean"
    } else if value.is_number() {
        "a number"
    } else if value.is_string() {
        "a string"
    } else if value.is_big_int() {
        "a bigint"
    } else if value.is_symbol() {
        "a symbol"
    } else if value.is_callable() {
        "a function"
    } else if value.is_array() {
        "an array"
    } else {
        "an object"
    }
}

/// A plain `{}`: an ordinary object whose prototype is `Object.prototype`
/// or `null`, so class instances (a `View` passed where its `.native` was
/// meant) are refused rather than read as dictionaries.
fn is_plain_object(global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
    if !matches!(value.js_type(), JSType::Object | JSType::FinalObject) {
        return Ok(false);
    }
    let prototype = value.get_prototype(global)?;
    Ok(prototype.is_null() || prototype == global.object_prototype())
}

/// 2^53: integers up to this magnitude are exact as JavaScript numbers.
const SAFE_INTEGER_U64: u64 = 1 << 53;
const SAFE_INTEGER: f64 = SAFE_INTEGER_U64 as f64;

/// The Foundation object for a JavaScript value, the way `objc.ns()` and
/// `id`-typed arguments box: strings, numbers, booleans, bigints, arrays and
/// plain objects (recursively; `null` members become `NSNull`), wrappers as
/// themselves. `None` for `null` / `undefined`.
pub(crate) fn ns_value(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
) -> JsResult<Option<DynObject>> {
    ns_value_at(global, value, what, 0)
}

fn ns_value_at(
    global: &JSGlobalObject,
    value: JSValue,
    what: core::fmt::Arguments<'_>,
    depth: usize,
) -> JsResult<Option<DynObject>> {
    if depth > bun_appkit::dynamic::PLAIN_DEPTH {
        return Err(global.throw_type_error(format_args!(
            "{what}: nested too deeply (or cyclic) to convert to a Foundation object"
        )));
    }
    if value.is_undefined_or_null() {
        return Ok(None);
    }
    if let Some(o) = objc_object(value) {
        return check(global, o.object().try_clone()).map(Some);
    }
    if let Some(c) = objc_class(value) {
        return Ok(Some(c.class().to_object()));
    }
    let object = if value.is_string() {
        let s = JsStr::new(global, value, what)?;
        DynObject::string(s.ns())
    } else if value.is_number() {
        DynObject::number(value.as_number())
    } else if value.is_boolean() {
        DynObject::boolean(value.as_boolean())
    } else if value.is_big_int() {
        match JSBigInt::from_js(value) {
            Some(big) if value.is_big_int_in_int64_range(i64::MIN, i64::MAX) => {
                DynObject::integer(big.to_int64())
            }
            _ => {
                return Err(global.throw_type_error(format_args!(
                    "{what}: bigint does not fit a 64-bit NSNumber"
                )));
            }
        }
    } else if value.is_array() {
        let mut items = Vec::new();
        let mut iter = value.array_iterator(global)?;
        while let Some(item) = iter.next()? {
            items.push(match ns_value_at(global, item, what, depth + 1)? {
                Some(o) => o,
                None => check(global, DynObject::null())?,
            });
        }
        DynObject::array(&items)
    } else if is_plain_object(global, value)? {
        let Some(object) = value.get_object() else {
            return Ok(None);
        };
        let mut entries = Vec::new();
        let mut iter = bun_jsc::JSPropertyIterator::init(
            global,
            object,
            bun_jsc::PropertyIteratorOptions {
                skip_empty_name: false,
                include_value: true,
            },
        )?;
        while let Some(key) = iter.next()? {
            let key = JsStr(OwnedString::new(key));
            let key = check(global, DynObject::string(key.ns()))?;
            let value = match ns_value_at(global, iter.value, what, depth + 1)? {
                Some(o) => o,
                None => check(global, DynObject::null())?,
            };
            entries.push((key, value));
        }
        DynObject::dictionary(&entries)
    } else {
        return Err(global.throw_type_error(format_args!(
            "{what}: cannot convert {} to a Foundation object",
            js_kind(value)
        )));
    };
    check(global, object).map(Some)
}

/// Converts argument `index` of the message `sig` describes, typed by the
/// method's encoding `enc` (never by the JavaScript value).
pub(crate) fn dyn_arg(
    global: &JSGlobalObject,
    sig: &Signature,
    index: usize,
    enc: &Enc,
    value: JSValue,
) -> JsResult<DynValue> {
    let method = sig.method();
    let mismatch = || {
        throw(
            global,
            &bun_appkit::Error::ArgType {
                method: method.to_owned(),
                index,
                expected: enc.to_string(),
                got: js_kind(value).to_owned(),
            },
        )
    };
    let unsupported = |what: &str| {
        throw(
            global,
            &bun_appkit::Error::UnsupportedSignature {
                method: method.to_owned(),
                what: what.to_owned(),
            },
        )
    };
    let nil = value.is_undefined_or_null();
    Ok(match enc {
        Enc::Object => {
            if nil {
                DynValue::Nil
            } else if let Some(o) = objc_object(value) {
                DynValue::Object(check(global, o.object().try_clone())?)
            } else if let Some(c) = objc_class(value) {
                DynValue::Class(c.class())
            } else if value.is_string() {
                let s = JsStr::new(global, value, format_args!("{method} argument {index}"))?;
                DynValue::Object(check(global, DynObject::string(s.ns()))?)
            } else if value.is_boolean() {
                DynValue::Bool(value.as_boolean())
            } else if value.is_number() {
                DynValue::F64(value.as_number())
            } else {
                match ns_value(global, value, format_args!("{method} argument {index}"))? {
                    Some(o) => DynValue::Object(o),
                    None => DynValue::Nil,
                }
            }
        }
        Enc::Block if nil => DynValue::Nil,
        Enc::Block => return Err(unsupported("block arguments are not supported yet")),
        Enc::Class => {
            if nil {
                DynValue::Nil
            } else if let Some(c) = objc_class(value) {
                DynValue::Class(c.class())
            } else if let Some(o) = objc_object(value)
                && let Some(c) = o.object().as_class()
            {
                DynValue::Class(c)
            } else {
                return Err(mismatch());
            }
        }
        Enc::Sel => {
            if nil {
                DynValue::Nil
            } else if let Some(sel) = objc_selector(value) {
                DynValue::Sel(sel.name().to_owned())
            } else if value.is_string() {
                DynValue::Sel(
                    JsStr::new(global, value, format_args!("{method} argument {index}"))?
                        .to_utf8()
                        .into_string(),
                )
            } else {
                return Err(mismatch());
            }
        }
        Enc::Bool if value.is_boolean() => DynValue::Bool(value.as_boolean()),
        Enc::Int { bits, signed } => {
            let (min, max): (i128, i128) = if *signed {
                (-(1i128 << (bits - 1)), (1i128 << (bits - 1)) - 1)
            } else {
                (0, (1i128 << bits) - 1)
            };
            let out_of_range = |got: &dyn core::fmt::Display| {
                throw(
                    global,
                    &bun_appkit::Error::ArgType {
                        method: method.to_owned(),
                        index,
                        expected: format!("{enc} from {min} to {max}"),
                        got: got.to_string(),
                    },
                )
            };
            if value.is_number() {
                let n = value.as_number();
                if !n.is_finite() || n.fract() != 0.0 {
                    return Err(throw(
                        global,
                        &bun_appkit::Error::ArgType {
                            method: method.to_owned(),
                            index,
                            expected: enc.to_string(),
                            got: format!("{n}"),
                        },
                    ));
                }
                if (n as i128) < min || (n as i128) > max {
                    return Err(out_of_range(&n));
                }
                if n.abs() > SAFE_INTEGER {
                    return Err(throw(
                        global,
                        &bun_appkit::Error::ArgType {
                            method: method.to_owned(),
                            index,
                            expected: format!("{enc}; pass a bigint for values above 2^53"),
                            got: format!("{n}"),
                        },
                    ));
                }
                if *signed {
                    DynValue::I64(n as i64)
                } else {
                    DynValue::U64(n as u64)
                }
            } else if value.is_big_int() {
                let Some(big) = JSBigInt::from_js(value) else {
                    return Err(mismatch());
                };
                if *signed {
                    if !value.is_big_int_in_int64_range(min as i64, max as i64) {
                        return Err(out_of_range(&"a bigint outside it"));
                    }
                    DynValue::I64(big.to_int64())
                } else {
                    if !value.is_big_int_in_uint64_range(0, max as u64) {
                        return Err(out_of_range(&"a bigint outside it"));
                    }
                    DynValue::U64(value.to_uint64_no_truncate())
                }
            } else {
                return Err(mismatch());
            }
        }
        Enc::F32 | Enc::F64 if value.is_number() => DynValue::F64(value.as_number()),
        Enc::CString => {
            if nil {
                DynValue::Nil
            } else if value.is_string() {
                DynValue::Str(
                    JsStr::new(global, value, format_args!("{method} argument {index}"))?
                        .to_utf8()
                        .into_string(),
                )
            } else {
                return Err(mismatch());
            }
        }
        Enc::Pointer if nil => DynValue::Nil,
        Enc::Pointer => return Err(unsupported("pointer arguments are not supported yet")),
        Enc::Struct(kind) if value.is_object() => {
            let what = format_args!("{method} argument {index}");
            let field = |name: &'static str| -> JsResult<f64> {
                match value.get(global, name)? {
                    Some(v) => number(global, v, format_args!("{what}.{name}")),
                    None => Err(mismatch()),
                }
            };
            match kind {
                StructKind::Rect => {
                    match (value.get(global, "origin")?, value.get(global, "size")?) {
                        (Some(origin), Some(size)) if origin.is_object() && size.is_object() => {
                            let sub = |obj: JSValue,
                                       part: &'static str,
                                       name: &'static str|
                             -> JsResult<f64> {
                                match obj.get(global, name)? {
                                    Some(v) => {
                                        number(global, v, format_args!("{what}.{part}.{name}"))
                                    }
                                    None => Err(mismatch()),
                                }
                            };
                            DynValue::Rect(Rect {
                                origin: Point {
                                    x: sub(origin, "origin", "x")?,
                                    y: sub(origin, "origin", "y")?,
                                },
                                size: Size {
                                    width: sub(size, "size", "width")?,
                                    height: sub(size, "size", "height")?,
                                },
                            })
                        }
                        _ => DynValue::Rect(Rect::new(
                            field("x")?,
                            field("y")?,
                            field("width")?,
                            field("height")?,
                        )),
                    }
                }
                StructKind::Point => DynValue::Point(Point {
                    x: field("x")?,
                    y: field("y")?,
                }),
                StructKind::Size => DynValue::Size(Size {
                    width: field("width")?,
                    height: field("height")?,
                }),
                StructKind::Insets => DynValue::Insets(Insets {
                    top: field("top")?,
                    left: field("left")?,
                    bottom: field("bottom")?,
                    right: field("right")?,
                }),
                StructKind::Affine => DynValue::Affine([
                    field("a")?,
                    field("b")?,
                    field("c")?,
                    field("d")?,
                    field("tx")?,
                    field("ty")?,
                ]),
                StructKind::Range => {
                    let index = |name: &'static str| -> JsResult<usize> {
                        let bad = |got: &dyn core::fmt::Display| {
                            throw(
                                global,
                                &bun_appkit::Error::ArgType {
                                    method: method.to_owned(),
                                    index,
                                    expected: format!(
                                        "{enc} with {name} an integer from 0 to 2^53, or a bigint up to {}",
                                        u64::MAX
                                    ),
                                    got: format!("{name} {got}"),
                                },
                            )
                        };
                        let Some(v) = value.get(global, name)? else {
                            return Err(mismatch());
                        };
                        if v.is_big_int() {
                            if !v.is_big_int_in_uint64_range(0, u64::MAX) {
                                return Err(bad(&"a bigint outside that"));
                            }
                            return Ok(v.to_uint64_no_truncate() as usize);
                        }
                        let n = number(global, v, format_args!("{what}.{name}"))?;
                        if n < 0.0 || n.fract() != 0.0 || n > SAFE_INTEGER {
                            return Err(bad(&n));
                        }
                        Ok(n as usize)
                    };
                    DynValue::Range(bun_appkit::geometry::Range {
                        location: index("location")?,
                        length: index("length")?,
                    })
                }
            }
        }
        Enc::Other(e) => {
            return Err(unsupported(&format!(
                "argument type {e} is not supported yet"
            )));
        }
        _ => return Err(mismatch()),
    })
}

/// A number when that is exact, else a bigint.
fn i64_to_js(global: &JSGlobalObject, v: i64) -> JsResult<JSValue> {
    if v.unsigned_abs() <= SAFE_INTEGER_U64 {
        Ok(JSValue::js_number(v as f64))
    } else {
        JSValue::from_int64_no_truncate(global, v)
    }
}

fn u64_to_js(global: &JSGlobalObject, v: u64) -> JsResult<JSValue> {
    if v <= SAFE_INTEGER_U64 {
        Ok(JSValue::js_number(v as f64))
    } else {
        JSValue::from_uint64_no_truncate(global, v)
    }
}

fn fields_to_js(global: &JSGlobalObject, fields: &[(&[u8], f64)]) -> JSValue {
    let object = JSValue::create_empty_object(global, fields.len());
    for (name, v) in fields {
        object.put(global, *name, JSValue::js_number(*v));
    }
    object
}

/// A message result for JavaScript. Objects are wrapped as they are; use
/// `objc.js()` to unpack Foundation values.
pub(crate) fn dyn_to_js(global: &JSGlobalObject, value: DynValue) -> JsResult<JSValue> {
    Ok(match value {
        DynValue::Nil => JSValue::NULL,
        DynValue::Void => JSValue::UNDEFINED,
        DynValue::Object(o) => ObjCObject::wrap(global, o),
        DynValue::Class(c) => ObjCClass::wrap(global, c),
        DynValue::Sel(name) | DynValue::Str(name) => str_to_js(global, &name)?,
        DynValue::Bool(b) => JSValue::js_boolean(b),
        DynValue::I64(v) => i64_to_js(global, v)?,
        DynValue::U64(v) => u64_to_js(global, v)?,
        DynValue::F64(v) => JSValue::js_number(v),
        DynValue::Rect(r) => {
            let object = JSValue::create_empty_object(global, 2);
            object.put(
                global,
                b"origin",
                fields_to_js(global, &[(b"x", r.origin.x), (b"y", r.origin.y)]),
            );
            object.put(
                global,
                b"size",
                fields_to_js(
                    global,
                    &[(b"width", r.size.width), (b"height", r.size.height)],
                ),
            );
            object
        }
        DynValue::Point(p) => fields_to_js(global, &[(b"x", p.x), (b"y", p.y)]),
        DynValue::Size(s) => fields_to_js(global, &[(b"width", s.width), (b"height", s.height)]),
        DynValue::Range(r) => {
            let object = JSValue::create_empty_object(global, 2);
            object.put(global, b"location", u64_to_js(global, r.location as u64)?);
            object.put(global, b"length", u64_to_js(global, r.length as u64)?);
            object
        }
        DynValue::Insets(i) => fields_to_js(
            global,
            &[
                (b"top", i.top),
                (b"left", i.left),
                (b"bottom", i.bottom),
                (b"right", i.right),
            ],
        ),
        DynValue::Affine(m) => fields_to_js(
            global,
            &[
                (b"a", m[0]),
                (b"b", m[1]),
                (b"c", m[2]),
                (b"d", m[3]),
                (b"tx", m[4]),
                (b"ty", m[5]),
            ],
        ),
        DynValue::Pointer(0) => JSValue::NULL,
        DynValue::Pointer(p) => JSValue::from_uint64_no_truncate(global, p as u64)?,
    })
}
