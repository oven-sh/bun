use crate::a11y::is_valid_aria_property;
use crate::react::is_jsx;
use crate::util_version::{Version, get_react_version_from_context};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::get_identifier_name;
use std::borrow::Cow;

/// Disallow usage of unknown DOM property.
pub struct NoUnknownProperty {
    ignore: Vec<Box<[u8]>>,
    require_data_lowercase: bool,
}

const INVALID_PROP_ON_TAG: Message = Message::new(
    "invalidPropOnTag",
    "Invalid property '{{name}}' found on tag '{{tagName}}', but it is only allowed on: {{allowedTags}}",
);
const UNKNOWN_PROP_WITH_STANDARD_NAME: Message =
    Message::new("unknownPropWithStandardName", "Unknown property '{{name}}' found, use '{{standardName}}' instead");
const UNKNOWN_PROP: Message = Message::new("unknownProp", "Unknown property '{{name}}' found");
const DATA_LOWERCASE_REQUIRED: Message = Message::new(
    "dataLowercaseRequired",
    "React does not recognize data-* props with uppercase characters on a DOM element. Found '{{name}}', use '{{lowerCaseName}}' instead",
);
const OXLINT_INVALID_PROP_ON_TAG: Message = Message::new("", "Invalid property found");
const OXLINT_DATA_LOWERCASE_REQUIRED: Message =
    Message::new("", "React does not recognize data-* props with uppercase characters on a DOM element");
const OXLINT_UNKNOWN_PROP: Message = Message::new("", "Unknown property found");
const USE_STANDARD_NAME: Message = Message::new("", "Use '{{x1}}' instead");

/// The elements that an attribute is for, in the order in which oxlint lists them. The attributes are sorted.
static ATTRIBUTE_TAGS_MAP: [(&str, &[&str]); 70] = [
    ("abbr", &["td", "th"]),
    (
        "align",
        &[
            "table", "th", "colgroup", "img", "caption", "hr", "tfoot", "thead", "tr", "col", "iframe", "td", "applet",
            "tbody",
        ],
    ),
    ("allowFullScreen", &["video", "iframe"]),
    ("as", &["link"]),
    ("autoPictureInPicture", &["video"]),
    ("charset", &["meta"]),
    ("checked", &["input"]),
    ("closedby", &["dialog"]),
    ("controls", &["audio", "video"]),
    ("controlsList", &["audio", "video"]),
    ("credentialless", &["iframe"]),
    ("crossOrigin", &["audio", "script", "link", "image", "video", "img"]),
    ("disablePictureInPicture", &["video"]),
    ("disableRemotePlayback", &["audio", "video"]),
    ("displaystyle", &["math"]),
    ("download", &["a", "area"]),
    ("fetchPriority", &["script", "img", "link"]),
    (
        "fill",
        &[
            "tspan", "set", "animateColor", "line", "svg", "path", "text", "ellipse", "use", "marker", "tref", "rect",
            "polygon", "symbol", "g", "mask", "textPath", "altGlyph", "animateMotion", "polyline", "circle",
            "animateTransform", "animate",
        ],
    ),
    ("focusable", &["svg"]),
    ("imageSizes", &["link"]),
    ("imageSrcSet", &["link"]),
    ("loop", &["audio", "video"]),
    ("mozAllowFullScreen", &["video", "iframe"]),
    ("muted", &["audio", "video"]),
    ("noModule", &["script"]),
    ("onAbort", &["audio", "video"]),
    ("onCanPlay", &["audio", "video"]),
    ("onCanPlayThrough", &["audio", "video"]),
    ("onCancel", &["dialog"]),
    ("onClose", &["dialog"]),
    ("onDurationChange", &["audio", "video"]),
    ("onEmptied", &["audio", "video"]),
    ("onEncrypted", &["audio", "video"]),
    ("onEnded", &["audio", "video"]),
    ("onError", &["img", "iframe", "video", "picture", "audio", "link", "source", "script"]),
    ("onLoad", &["iframe", "link", "body", "script", "source", "object", "img", "picture"]),
    ("onLoadStart", &["audio", "video"]),
    ("onLoadedData", &["audio", "video"]),
    ("onLoadedMetadata", &["audio", "video"]),
    ("onPause", &["audio", "video"]),
    ("onPlay", &["audio", "video"]),
    ("onPlaying", &["audio", "video"]),
    ("onProgress", &["audio", "video"]),
    ("onRateChange", &["audio", "video"]),
    ("onResize", &["audio", "video"]),
    ("onSeeked", &["audio", "video"]),
    ("onSeeking", &["audio", "video"]),
    ("onStalled", &["audio", "video"]),
    ("onSuspend", &["audio", "video"]),
    ("onTimeUpdate", &["audio", "video"]),
    ("onVolumeChange", &["audio", "video"]),
    ("onWaiting", &["audio", "video"]),
    ("playsInline", &["video"]),
    ("popoverTarget", &["input", "button"]),
    ("popoverTargetAction", &["input", "button"]),
    ("poster", &["video"]),
    ("precedence", &["link", "style"]),
    ("preload", &["audio", "video"]),
    ("property", &["meta"]),
    ("returnValue", &["dialog"]),
    ("scrolling", &["iframe"]),
    ("shadowrootclonable", &["template"]),
    ("shadowrootdelegatesfocus", &["template"]),
    ("shadowrootmode", &["template"]),
    ("shadowrootserializable", &["template"]),
    ("transform-origin", &["rect"]),
    ("valign", &["tfoot", "col", "tr", "th", "td", "colgroup", "thead", "tbody"]),
    ("viewBox", &["symbol", "svg", "marker", "pattern", "view"]),
    ("webkitAllowFullScreen", &["video", "iframe"]),
    ("webkitDirectory", &["input"]),
];

/// What upstream has in place of an entry of [`ATTRIBUTE_TAGS_MAP`], the elements in the order in which it lists them.
/// No elements: it has no such entry.
static UPSTREAM_ATTRIBUTE_TAGS_MAP: [(&str, &[&str]); 17] = [
    ("abbr", &["th", "td"]),
    (
        "align",
        &[
            "applet", "caption", "col", "colgroup", "hr", "iframe", "img", "table", "tbody", "td", "tfoot", "th",
            "thead", "tr",
        ],
    ),
    ("allowFullScreen", &["iframe", "video"]),
    ("closedby", &[]),
    ("credentialless", &[]),
    ("crossOrigin", &["script", "img", "video", "audio", "link", "image"]),
    ("fetchPriority", &[]),
    (
        "fill",
        &[
            "altGlyph", "circle", "ellipse", "g", "line", "marker", "mask", "path", "polygon", "polyline", "rect",
            "svg", "symbol", "text", "textPath", "tref", "tspan", "use", "animate", "animateColor", "animateMotion",
            "animateTransform", "set",
        ],
    ),
    ("mozAllowFullScreen", &["iframe", "video"]),
    ("onError", &["audio", "video", "img", "link", "source", "script", "picture", "iframe"]),
    ("onLoad", &["script", "img", "link", "picture", "iframe", "object", "source"]),
    ("popoverTarget", &[]),
    ("popoverTargetAction", &[]),
    ("precedence", &[]),
    ("valign", &["tr", "td", "th", "thead", "tbody", "tfoot", "colgroup", "col"]),
    ("viewBox", &["marker", "pattern", "svg", "symbol", "view"]),
    ("webkitAllowFullScreen", &["iframe", "video"]),
];

/// The names that both know. Like the two tables after it, it is sorted without regard to case, and no two of its names
/// differ in case alone.
static DOM_PROPERTIES_NAMES: [&str; 560] = [
    "accentHeight", "accept", "acceptCharset", "accessKey", "accumulate", "action", "additive", "alignmentBaseline",
    "allow", "alphabetic", "alt", "amplitude", "arabicForm", "as", "ascent", "async", "attributeName", "attributeType",
    "autoCapitalize", "autoComplete", "autoCorrect", "autoFocus", "autoPictureInPicture", "autoPlay", "autoSave",
    "azimuth", "baseFrequency", "baselineShift", "baseProfile", "bbox", "begin", "bias", "border", "buffered", "by",
    "calcMode", "capHeight", "capture", "cellPadding", "cellSpacing", "challenge", "children", "cite", "classID",
    "className", "clip", "clipPath", "clipPathUnits", "clipRule", "code", "codeBase", "color", "colorInterpolation",
    "colorInterpolationFilters", "colorProfile", "colorRendering", "cols", "colSpan", "content", "contentEditable",
    "contentScriptType", "contentStyleType", "contextMenu", "controls", "controlsList", "coords", "crossOrigin", "csp",
    "cursor", "cx", "cy", "d", "dangerouslySetInnerHTML", "data", "dateTime", "decelerate", "decoding", "default",
    "defaultChecked", "defaultValue", "defer", "descent", "diffuseConstant", "dir", "direction", "disabled",
    "disablePictureInPicture", "disableRemotePlayback", "display", "divisor", "dominantBaseline", "draggable", "dur",
    "dx", "dy", "edgeMode", "elevation", "enableBackground", "encType", "end", "enterKeyHint", "exponent",
    "exportParts", "fill", "fillOpacity", "fillRule", "filter", "filterRes", "filterUnits", "floodColor",
    "floodOpacity", "fontFamily", "fontSize", "fontSizeAdjust", "fontStretch", "fontStyle", "fontVariant", "fontWeight",
    "form", "formAction", "format", "formEncType", "formMethod", "formNoValidate", "formTarget", "fr", "frameBorder",
    "from", "fx", "fy", "g1", "g2", "glyphName", "glyphOrientationHorizontal", "glyphOrientationVertical", "glyphRef",
    "gradientTransform", "gradientUnits", "hanging", "headers", "height", "hidden", "high", "horizAdvX", "horizOriginX",
    "href", "hrefLang", "htmlFor", "httpEquiv", "icon", "id", "ideographic", "imageRendering", "imageSizes",
    "imageSrcSet", "importance", "in", "in2", "inert", "inputMode", "integrity", "intercept", "isMap", "itemID",
    "itemProp", "itemRef", "itemScope", "itemType", "k", "k1", "k2", "k3", "k4", "kernelMatrix", "kernelUnitLength",
    "kerning", "key", "keyParams", "keyPoints", "keySplines", "keyTimes", "keyType", "kind", "label", "lang",
    "language", "lengthAdjust", "letterSpacing", "lightingColor", "limitingConeAngle", "list", "loading", "local",
    "loop", "low", "manifest", "marginHeight", "marginWidth", "markerEnd", "markerHeight", "markerMid", "markerStart",
    "markerUnits", "markerWidth", "mask", "maskContentUnits", "maskUnits", "mathematical", "max", "maxLength", "media",
    "mediaGroup", "method", "min", "minLength", "mode", "multiple", "muted", "name", "nonce", "noValidate",
    "numOctaves", "offset", "onAbort", "onAbortCapture", "onAnimationEnd", "onAnimationEndCapture",
    "onAnimationIteration", "onAnimationStart", "onAnimationStartCapture", "onAuxClick", "onAuxClickCapture",
    "onBeforeInput", "onBeforeInputCapture", "onBeforeToggle", "onBlur", "onBlurCapture", "onCanPlay",
    "onCanPlayCapture", "onCanPlayThrough", "onCanPlayThroughCapture", "onChange", "onChangeCapture", "onClick",
    "onClickCapture", "onCompositionEnd", "onCompositionEndCapture", "onCompositionStart", "onCompositionStartCapture",
    "onCompositionUpdate", "onCompositionUpdateCapture", "onContextMenu", "onContextMenuCapture", "onCopy",
    "onCopyCapture", "onCut", "onCutCapture", "onDoubleClick", "onDoubleClickCapture", "onDrag", "onDragCapture",
    "onDragEnd", "onDragEndCapture", "onDragEnter", "onDragEnterCapture", "onDragExit", "onDragExitCapture",
    "onDragLeave", "onDragLeaveCapture", "onDragOver", "onDragOverCapture", "onDragStart", "onDragStartCapture",
    "onDrop", "onDropCapture", "onDurationChange", "onDurationChangeCapture", "onEmptied", "onEmptiedCapture",
    "onEncrypted", "onEncryptedCapture", "onEnded", "onEndedCapture", "onError", "onErrorCapture", "onFocus",
    "onFocusCapture", "onGotPointerCaptureCapture", "onInput", "onInputCapture", "onInvalid", "onInvalidCapture",
    "onKeyDown", "onKeyDownCapture", "onKeyPress", "onKeyPressCapture", "onKeyUp", "onKeyUpCapture", "onLoad",
    "onLoadCapture", "onLoadedData", "onLoadedDataCapture", "onLoadedMetadata", "onLoadedMetadataCapture",
    "onLoadStart", "onLoadStartCapture", "onLostPointerCapture", "onLostPointerCaptureCapture", "onMouseDown",
    "onMouseDownCapture", "onMouseEnter", "onMouseLeave", "onMouseMove", "onMouseMoveCapture", "onMouseOut",
    "onMouseOutCapture", "onMouseOver", "onMouseOverCapture", "onMouseUp", "onMouseUpCapture", "onPaste",
    "onPasteCapture", "onPause", "onPauseCapture", "onPlay", "onPlayCapture", "onPlaying", "onPlayingCapture",
    "onPointerCancel", "onPointerCancelCapture", "onPointerDown", "onPointerDownCapture", "onPointerEnter",
    "onPointerEnterCapture", "onPointerLeave", "onPointerLeaveCapture", "onPointerMove", "onPointerMoveCapture",
    "onPointerOut", "onPointerOutCapture", "onPointerOver", "onPointerOverCapture", "onPointerUp", "onPointerUpCapture",
    "onProgress", "onProgressCapture", "onRateChange", "onRateChangeCapture", "onReset", "onResetCapture", "onResize",
    "onScroll", "onScrollCapture", "onSeeked", "onSeekedCapture", "onSeeking", "onSeekingCapture", "onSelect",
    "onSelectCapture", "onStalled", "onStalledCapture", "onSubmit", "onSubmitCapture", "onSuspend", "onSuspendCapture",
    "onTimeUpdate", "onTimeUpdateCapture", "onToggle", "onTouchCancel", "onTouchCancelCapture", "onTouchEnd",
    "onTouchEndCapture", "onTouchMove", "onTouchMoveCapture", "onTouchStart", "onTouchStartCapture", "onTransitionEnd",
    "onTransitionEndCapture", "onVolumeChange", "onVolumeChangeCapture", "onWaiting", "onWaitingCapture", "onWheel",
    "onWheelCapture", "opacity", "open", "operator", "optimum", "order", "orient", "orientation", "origin", "overflow",
    "overlinePosition", "overlineThickness", "paintOrder", "panose1", "part", "path", "pathLength", "pattern",
    "patternContentUnits", "patternTransform", "patternUnits", "ping", "placeholder", "pointerEvents", "points",
    "pointsAtX", "pointsAtY", "pointsAtZ", "popover", "poster", "preload", "preserveAlpha", "preserveAspectRatio",
    "primitiveUnits", "profile", "property", "r", "radioGroup", "radius", "readOnly", "ref", "referrerPolicy", "refX",
    "refY", "rel", "repeatCount", "repeatDur", "required", "requiredExtensions", "requiredFeatures", "restart",
    "result", "results", "reversed", "role", "rotate", "rows", "rowSpan", "rx", "ry", "sandbox", "scale", "scope",
    "seamless", "security", "seed", "selected", "shape", "shapeRendering", "size", "sizes", "slope", "slot", "spacing",
    "span", "specularConstant", "specularExponent", "speed", "spellCheck", "spreadMethod", "src", "srcDoc", "srcLang",
    "srcSet", "start", "startOffset", "stdDeviation", "stemh", "stemv", "step", "stitchTiles", "stopColor",
    "stopOpacity", "strikethroughPosition", "strikethroughThickness", "string", "stroke", "strokeDasharray",
    "strokeDashoffset", "strokeLinecap", "strokeLinejoin", "strokeMiterlimit", "strokeOpacity", "strokeWidth", "style",
    "summary", "suppressContentEditableWarning", "suppressHydrationWarning", "surfaceScale", "systemLanguage",
    "tabIndex", "tableValues", "target", "targetX", "targetY", "textAnchor", "textDecoration", "textLength",
    "textRendering", "title", "to", "transform", "transformOrigin", "translate", "type", "u1", "u2",
    "underlinePosition", "underlineThickness", "unicode", "unicodeBidi", "unicodeRange", "unitsPerEm", "useMap",
    "vAlphabetic", "value", "values", "vectorEffect", "version", "vertAdvY", "vertOriginX", "vertOriginY", "vHanging",
    "vIdeographic", "viewBox", "viewTarget", "visibility", "vMathematical", "width", "widths", "wmode", "wordSpacing",
    "wrap", "writingMode", "x", "x1", "x2", "xChannelSelector", "xHeight", "xlinkActuate", "xlinkArcrole", "xlinkHref",
    "xlinkRole", "xlinkShow", "xlinkTitle", "xlinkType", "xmlBase", "xmlLang", "xmlns", "xmlnsXlink", "xmlSpace", "y",
    "y1", "y2", "yChannelSelector", "z", "zoomAndPan",
];

/// The names that only oxlint knows, or looks for before it looks in [`DOM_ATTRIBUTES_TO_CAMEL`].
static OXLINT_NAMES: [&str; 15] = [
    "hreflang", "maskType", "onFullscreenChange", "onFullscreenChangeCapture", "onFullscreenError",
    "onFullscreenErrorCapture", "onScrollEnd", "onScrollEndCapture", "onTransitionCancel", "onTransitionCancelCapture",
    "onTransitionRun", "onTransitionRunCapture", "onTransitionStart", "onTransitionStartCapture", "rendering-intent",
];

/// The names that only upstream knows, or looks for after it has looked in [`DOM_ATTRIBUTES_TO_CAMEL`].
static ESLINT_NAMES: [&str; 7] = [
    "allowTransparency", "fetchPriority", "onGotPointerCapture", "popoverTarget", "popoverTargetAction", "precedence",
    "rendering-intent",
];

static DOM_ATTRIBUTES_TO_CAMEL: [(&str, &str); 92] = [
    ("accent-height", "accentHeight"),
    ("accept-charset", "acceptCharset"),
    ("alignment-baseline", "alignmentBaseline"),
    ("arabic-form", "arabicForm"),
    ("baseline-shift", "baselineShift"),
    ("cap-height", "capHeight"),
    ("class", "className"),
    ("clip-path", "clipPath"),
    ("clip-rule", "clipRule"),
    ("color-interpolation", "colorInterpolation"),
    ("color-interpolation-filters", "colorInterpolationFilters"),
    ("color-profile", "colorProfile"),
    ("color-rendering", "colorRendering"),
    ("crossorigin", "crossOrigin"),
    ("dominant-baseline", "dominantBaseline"),
    ("enable-background", "enableBackground"),
    ("fetchpriority", "fetchPriority"),
    ("fill-opacity", "fillOpacity"),
    ("fill-rule", "fillRule"),
    ("flood-color", "floodColor"),
    ("flood-opacity", "floodOpacity"),
    ("font-family", "fontFamily"),
    ("font-size", "fontSize"),
    ("font-size-adjust", "fontSizeAdjust"),
    ("font-stretch", "fontStretch"),
    ("font-style", "fontStyle"),
    ("font-variant", "fontVariant"),
    ("font-weight", "fontWeight"),
    ("for", "htmlFor"),
    ("glyph-name", "glyphName"),
    ("glyph-orientation-horizontal", "glyphOrientationHorizontal"),
    ("glyph-orientation-vertical", "glyphOrientationVertical"),
    ("horiz-adv-x", "horizAdvX"),
    ("horiz-origin-x", "horizOriginX"),
    ("http-equiv", "httpEquiv"),
    ("image-rendering", "imageRendering"),
    ("letter-spacing", "letterSpacing"),
    ("lighting-color", "lightingColor"),
    ("marker-end", "markerEnd"),
    ("marker-mid", "markerMid"),
    ("marker-start", "markerStart"),
    ("mask-type", "maskType"),
    ("nomodule", "noModule"),
    ("overline-position", "overlinePosition"),
    ("overline-thickness", "overlineThickness"),
    ("paint-order", "paintOrder"),
    ("panose-1", "panose1"),
    ("pointer-events", "pointerEvents"),
    ("popovertarget", "popoverTarget"),
    ("popovertargetaction", "popoverTargetAction"),
    ("rendering-intent", "renderingIntent"),
    ("shape-rendering", "shapeRendering"),
    ("stop-color", "stopColor"),
    ("stop-opacity", "stopOpacity"),
    ("strikethrough-position", "strikethroughPosition"),
    ("strikethrough-thickness", "strikethroughThickness"),
    ("stroke-dasharray", "strokeDasharray"),
    ("stroke-dashoffset", "strokeDashoffset"),
    ("stroke-linecap", "strokeLinecap"),
    ("stroke-linejoin", "strokeLinejoin"),
    ("stroke-miterlimit", "strokeMiterlimit"),
    ("stroke-opacity", "strokeOpacity"),
    ("stroke-width", "strokeWidth"),
    ("text-anchor", "textAnchor"),
    ("text-decoration", "textDecoration"),
    ("text-rendering", "textRendering"),
    ("underline-position", "underlinePosition"),
    ("underline-thickness", "underlineThickness"),
    ("unicode-bidi", "unicodeBidi"),
    ("unicode-range", "unicodeRange"),
    ("units-per-em", "unitsPerEm"),
    ("v-alphabetic", "vAlphabetic"),
    ("v-hanging", "vHanging"),
    ("v-ideographic", "vIdeographic"),
    ("v-mathematical", "vMathematical"),
    ("vector-effect", "vectorEffect"),
    ("vert-adv-y", "vertAdvY"),
    ("vert-origin-x", "vertOriginX"),
    ("vert-origin-y", "vertOriginY"),
    ("word-spacing", "wordSpacing"),
    ("writing-mode", "writingMode"),
    ("x-height", "xHeight"),
    ("xlink:actuate", "xlinkActuate"),
    ("xlink:arcrole", "xlinkArcrole"),
    ("xlink:href", "xlinkHref"),
    ("xlink:role", "xlinkRole"),
    ("xlink:show", "xlinkShow"),
    ("xlink:title", "xlinkTitle"),
    ("xlink:type", "xlinkType"),
    ("xml:base", "xmlBase"),
    ("xml:lang", "xmlLang"),
    ("xml:space", "xmlSpace"),
];

/// oxlint has not the last two.
const DOM_PROPERTIES_IGNORE_CASE: [&str; 7] = [
    "charset",
    "allowFullScreen",
    "webkitAllowFullScreen",
    "mozAllowFullScreen",
    "webkitDirectory",
    "popoverTarget",
    "popoverTargetAction",
];

/// What `table`, which is sorted, has for `key`.
fn get<T: Copy>(table: &[(&str, T)], key: &[u8]) -> Option<T> {
    let at = table.binary_search_by(|it| it.0.as_bytes().cmp(key)).ok()?;
    table.get(at).map(|it| it.1)
}

/// The name of `table` that is `name` but for the case of its letters of ASCII.
fn find_in_any_case(table: &[&'static str], name: &[u8]) -> Option<&'static str> {
    let name = || name.iter().map(u8::to_ascii_lowercase);
    let at = table.binary_search_by(|it| it.bytes().map(|byte| byte.to_ascii_lowercase()).cmp(name())).ok()?;
    table.get(at).copied()
}

/// The elements that the attribute `name` is for, if it is not for all.
fn allowed_tags(name: &[u8], is_oxlint: bool) -> Option<&'static [&'static str]> {
    let tags = get(&ATTRIBUTE_TAGS_MAP, name)?;
    if is_oxlint {
        return Some(tags);
    }
    Some(get(&UPSTREAM_ATTRIBUTE_TAGS_MAP, name).unwrap_or(tags)).filter(|it| !it.is_empty())
}

/// Whether the React of `version` has `name`, which is in a table: upstream's `getDOMPropertyNames`.
fn is_in_react(name: &[u8], version: &mut dyn FnMut() -> Version) -> bool {
    match name {
        b"allowTransparency" => version() < (16, 1, 0),
        b"precedence" => version() >= (19, 0, 0),
        _ => !strings::contains(name, b"Pointer") || version() >= (16, 4, 0),
    }
}

/// Upstream's `getStandardName`: `name` itself, if it is known. `folded` is `name` in another case.
fn get_standard_name(
    name: &[u8],
    folded: &[u8],
    is_oxlint: bool,
    version: &mut dyn FnMut() -> Version,
) -> Option<&'static str> {
    // oxlint asks for no version.
    let mut exists = |it: &&'static str| is_oxlint || is_in_react(it.as_bytes(), version);
    let shared = find_in_any_case(&DOM_PROPERTIES_NAMES, folded).filter(&mut exists);
    if shared.is_some_and(|it| it.as_bytes() == name) {
        return shared;
    }
    // Only oxlint knows `mask-type`.
    let camel = get(&DOM_ATTRIBUTES_TO_CAMEL, name).filter(|it| is_oxlint || *it != "maskType");
    if !is_oxlint && camel.is_some() {
        return camel;
    }
    let own: &[&'static str] = if is_oxlint { &OXLINT_NAMES } else { &ESLINT_NAMES };
    let own = find_in_any_case(own, folded).filter(exists);
    if own.is_some_and(|it| it.as_bytes() == name) {
        return own;
    }
    shared.or(own).or(camel)
}

/// `data-a`, `data-a-b`. Not `data-xml..` in any case, not `data-a:b`.
fn is_valid_data_attr(name: &[u8], is_oxlint: bool) -> bool {
    name.strip_prefix(b"data-").is_some_and(|data_name| {
        // Upstream takes `data-`.
        !(is_oxlint && data_name.is_empty())
            && !data_name.get(..3).is_some_and(|it| it.eq_ignore_ascii_case(b"xml"))
            && !strings::contains_char(data_name, b':')
    })
}

/// It starts with a small letter of ASCII and has no hyphen.
fn matches_html_tag_conventions(tag: &[u8]) -> bool {
    tag.first().is_some_and(u8::is_ascii_lowercase) && !strings::contains_char(tag, b'-')
}

fn any_char(name: &[u8], is_it: impl Fn(char) -> bool) -> bool {
    strings::wtf8_codepoints(name).filter_map(|it| char::from_u32(it.1)).any(is_it)
}

impl Rule for NoUnknownProperty {
    const META: Meta = Meta::plugin(Plugin::React, "no-unknown-property", Kind::Suggestion)
        .fixable(Fixable::Code)
        .has_suggestions()
        .recommended();
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    /// The version of React, once it has been asked for.
    type State<'a> = Option<Version>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoUnknownProperty {
            ignore: options.strings("ignore").into_iter().map(|it| it.as_bytes().into()).collect(),
            require_data_lowercase: options.bool_or("requireDataLowercase", false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Option<Version>> {
        (!file.language().is_oxlint || is_jsx(file)).then_some(None)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let (attributes, file, is_oxlint) = (jsx.attrs(), cx.file(), cx.language().is_oxlint);
        let Some(tag) = jsx.tag().filter(|_| !attributes.is_empty()) else {
            return;
        };
        let el_type = match (tag.tag(), get_identifier_name(jsx)) {
            (ExprTag::Dot, _) => return,
            (_, Some(name)) => name.bytes(),
            // oxlint has no name for `<this>` and passes over `<a:b>`, of which upstream looks at the `data-*`.
            (_, None) if is_oxlint => return,
            (ExprTag::This, None) => b"this".as_slice(),
            (_, None) => &b""[..],
        };
        let is_fbt = matches!(el_type, b"fbt" | b"fbs");
        // The name of a component. `fbt` and `fbs` are something else altogether. Upstream looks at their `data-*`.
        if is_oxlint {
            let starts_with_lowercase = match el_type.first() {
                Some(first) if first.is_ascii() => first.is_ascii_lowercase(),
                _ => {
                    strings::contains_char(el_type, b'-')
                        && strings::wtf8_first_codepoint(el_type)
                            .and_then(char::from_u32)
                            .is_some_and(char::is_lowercase)
                }
            };
            if !starts_with_lowercase || is_fbt {
                return;
            }
        }
        let is_valid_html_tag = !is_fbt
            && matches_html_tag_conventions(el_type)
            && !attributes.iter().filter_map(Prop::key).any(|key| key.is("is"));
        if !is_valid_html_tag && !self.require_data_lowercase {
            return;
        }
        for attribute in attributes {
            let Some((key, mut actual_name)) = attribute.key().and_then(|key| Some((key, key.name()?.bytes()))) else {
                continue;
            };
            // Upstream takes the text, which can have blanks and comments: `a : b`.
            if !is_oxlint && strings::contains_char(actual_name, b':') {
                actual_name = file.slice(key.span(file));
            }
            if self.ignore.iter().any(|it| **it == *actual_name) {
                continue;
            }
            if is_valid_data_attr(actual_name, is_oxlint) {
                if !self.require_data_lowercase {
                    continue;
                }
                // oxlint points at the name, as everywhere below, and goes by the properties of the characters.
                if is_oxlint && any_char(actual_name, char::is_uppercase) {
                    cx.report(key.span(file), OXLINT_DATA_LOWERCASE_REQUIRED)
                        .help_with(|| format!("Use '{}' instead", bstr::BStr::new(&actual_name.to_ascii_lowercase())));
                } else if !is_oxlint && !text::is_lower_case(actual_name) {
                    cx.report(attribute, DATA_LOWERCASE_REQUIRED)
                        .data("name", actual_name)
                        .data("lowerCaseName", text::to_lower_case(actual_name));
                }
                continue;
            }
            // oxlint has not these two.
            let is_aria = is_valid_aria_property(actual_name)
                || (!is_oxlint && matches!(actual_name, b"aria-colindextext" | b"aria-rowindextext"));
            if !is_valid_html_tag || is_aria {
                continue;
            }
            // For upstream the sign for kelvin is a `k` in another case.
            let folded = match is_oxlint || actual_name.is_ascii() {
                true => Cow::Borrowed(actual_name),
                false => text::to_lower_case(actual_name),
            };
            let in_any_case = DOM_PROPERTIES_IGNORE_CASE.iter().take(if is_oxlint { 5 } else { 7 });
            let name = in_any_case.map(|it| it.as_bytes()).find(|it| it.eq_ignore_ascii_case(&folded));
            let name = name.unwrap_or(actual_name);
            if let Some(tags) = allowed_tags(name, is_oxlint) {
                if tags.iter().any(|it| it.as_bytes() == el_type) {
                    continue;
                }
                if is_oxlint {
                    cx.report(key.span(file), OXLINT_INVALID_PROP_ON_TAG).help_with(|| {
                        let prop = bstr::BStr::new(actual_name);
                        format!("Property '{prop}' is only allowed on: {}", tags.join(", "))
                    });
                } else {
                    cx.report(attribute, INVALID_PROP_ON_TAG)
                        .data("name", actual_name)
                        .data("tagName", el_type)
                        .data("allowedTags", tags.join(", "));
                }
                continue;
            }
            let state = &mut cx.state;
            let mut version = || *state.get_or_insert_with(|| get_react_version_from_context(file));
            let standard_name = get_standard_name(name, &folded, is_oxlint, &mut version);
            if standard_name.is_some_and(|it| it.as_bytes() == name) {
                continue;
            }
            let span = key.span(file);
            // oxlint suggests what upstream fixes.
            match (standard_name, is_oxlint) {
                (Some(prop), true) => cx
                    .report(span, OXLINT_UNKNOWN_PROP)
                    .help_with(|| format!("Use '{prop}' instead"))
                    .suggest_with(USE_STANDARD_NAME, &[("x1", prop.as_bytes())], |fixer| fixer.replace(span, prop)),
                (None, true) => cx.report(span, OXLINT_UNKNOWN_PROP).help("Remove unknown property"),
                (Some(standard_name), false) => cx
                    .report(attribute, UNKNOWN_PROP_WITH_STANDARD_NAME)
                    .data("name", actual_name)
                    .data("standardName", standard_name)
                    .fix(|fixer| fixer.replace(span, standard_name)),
                (None, false) => cx.report(attribute, UNKNOWN_PROP).data("name", actual_name),
            };
        }
    }
}
