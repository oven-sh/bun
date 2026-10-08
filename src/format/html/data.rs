//! What is known about the elements of HTML: `ml_parser/html_tags.ts` of `angular-html-parser`, and the tables
//! that Prettier takes from `html-ua-styles`, `@prettier/html-tags`, `html-element-attributes` and
//! `@prettier/html-event-attributes`.

use super::lexer::ContentType;

/// The value of the CSS property `display`, as far as anything depends on it.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum Display {
    None,
    Block,
    ListItem,
    InlineBlock,
    /// It starts with `table` and is not `table-cell`.
    Table,
    TableCell,
    /// `inline` and everything else.
    Inline,
}

impl Display {
    /// The display that a comment asks for.
    pub(crate) fn from_name(name: &[u8]) -> Display {
        match name {
            b"none" => Display::None,
            b"block" => Display::Block,
            _ if name.starts_with(b"table") => Display::Table,
            _ => Display::Inline,
        }
    }

    /// `isBlockLikeCssDisplay`
    pub(crate) fn is_block_like(self) -> bool {
        matches!(self, Display::Block | Display::ListItem | Display::Table | Display::TableCell)
    }
}

/// `HtmlTagDefinition`
#[derive(Debug)]
pub(crate) struct TagDefinition {
    closed_by_children: &'static [&'static [u8]],
    pub(crate) implicit_namespace_prefix: Option<&'static [u8]>,
    pub(crate) content_type: ContentType,
    pub(crate) closed_by_parent: bool,
    pub(crate) is_void: bool,
    pub(crate) ignore_first_lf: bool,
    pub(crate) prevent_namespace_inheritance: bool,
    pub(crate) can_self_close: bool,
}

impl TagDefinition {
    pub(crate) fn is_closed_by_child(&self, name: &[u8]) -> bool {
        self.is_void || self.closed_by_children.iter().any(|it| it.eq_ignore_ascii_case(name))
    }
}

const KNOWN: TagDefinition = TagDefinition {
    closed_by_children: &[],
    implicit_namespace_prefix: None,
    content_type: ContentType::ParsableData,
    closed_by_parent: false,
    is_void: false,
    ignore_first_lf: false,
    prevent_namespace_inheritance: false,
    can_self_close: false,
};

pub(crate) static DEFAULT_TAG_DEFINITION: TagDefinition = TagDefinition {
    can_self_close: true,
    ..KNOWN
};

/// `getHtmlTagDefinition`
pub(crate) fn tag_definition(name: &[u8]) -> &'static TagDefinition {
    const fn closed_by(children: &'static [&'static [u8]], closed_by_parent: bool) -> TagDefinition {
        TagDefinition {
            closed_by_children: children,
            closed_by_parent,
            ..KNOWN
        }
    }
    const fn namespace(prefix: &'static [u8], prevent_namespace_inheritance: bool) -> TagDefinition {
        TagDefinition {
            implicit_namespace_prefix: Some(prefix),
            prevent_namespace_inheritance,
            ..KNOWN
        }
    }
    const fn content(content_type: ContentType, ignore_first_lf: bool) -> TagDefinition {
        TagDefinition {
            content_type,
            ignore_first_lf,
            ..KNOWN
        }
    }
    static KNOWN_ELEMENT: TagDefinition = KNOWN;
    static VOID: TagDefinition = TagDefinition {
        is_void: true,
        closed_by_parent: true,
        ..KNOWN
    };
    static P: TagDefinition = closed_by(
        &[
            b"address",
            b"article",
            b"aside",
            b"blockquote",
            b"div",
            b"dl",
            b"fieldset",
            b"footer",
            b"form",
            b"h1",
            b"h2",
            b"h3",
            b"h4",
            b"h5",
            b"h6",
            b"header",
            b"hgroup",
            b"hr",
            b"main",
            b"nav",
            b"ol",
            b"p",
            b"pre",
            b"section",
            b"table",
            b"ul",
        ],
        true,
    );
    static THEAD: TagDefinition = closed_by(&[b"tbody", b"tfoot"], false);
    static TBODY: TagDefinition = closed_by(&[b"tbody", b"tfoot"], true);
    static TFOOT: TagDefinition = closed_by(&[b"tbody"], true);
    static TR: TagDefinition = closed_by(&[b"tr"], true);
    static TD: TagDefinition = closed_by(&[b"td", b"th"], true);
    static SVG: TagDefinition = namespace(b"svg", false);
    static FOREIGN_OBJECT: TagDefinition = namespace(b"svg", true);
    static MATH: TagDefinition = namespace(b"math", false);
    static LI: TagDefinition = closed_by(&[b"li"], true);
    static DT: TagDefinition = closed_by(&[b"dt", b"dd"], false);
    static DD: TagDefinition = closed_by(&[b"dt", b"dd"], true);
    static RB: TagDefinition = closed_by(&[b"rb", b"rt", b"rtc", b"rp"], true);
    static RTC: TagDefinition = closed_by(&[b"rb", b"rtc", b"rp"], true);
    static OPTGROUP: TagDefinition = closed_by(&[b"optgroup"], true);
    static OPTION: TagDefinition = closed_by(&[b"option", b"optgroup"], true);
    static PRE: TagDefinition = content(ContentType::ParsableData, true);
    static RAW: TagDefinition = content(ContentType::RawText, false);
    static TITLE: TagDefinition = content(ContentType::EscapableRawText, false);
    static TEXTAREA: TagDefinition = content(ContentType::EscapableRawText, true);
    match name {
        b"base" | b"meta" | b"area" | b"embed" | b"link" | b"img" | b"input" | b"param" | b"hr" | b"br" | b"source"
        | b"track" | b"wbr" | b"col" => &VOID,
        b"p" => &P,
        b"thead" => &THEAD,
        b"tbody" => &TBODY,
        b"tfoot" => &TFOOT,
        b"tr" => &TR,
        b"td" | b"th" => &TD,
        b"svg" => &SVG,
        b"foreignObject" => &FOREIGN_OBJECT,
        b"math" => &MATH,
        b"li" => &LI,
        b"dt" => &DT,
        b"dd" => &DD,
        b"rb" | b"rt" | b"rp" => &RB,
        b"rtc" => &RTC,
        b"optgroup" => &OPTGROUP,
        b"option" => &OPTION,
        b"pre" | b"listing" => &PRE,
        b"style" | b"script" => &RAW,
        b"title" => &TITLE,
        b"textarea" => &TEXTAREA,
        _ if KNOWN_ELEMENTS.binary_search(&name).is_ok() => &KNOWN_ELEMENT,
        _ => &DEFAULT_TAG_DEFINITION,
    }
}

/// `HTML_TAGS.has(name)`
pub(crate) fn is_html_tag(name: &[u8]) -> bool {
    HTML_TAGS.binary_search(&name).is_ok()
}

/// `htmlEventAttributes.has(name)`
pub(crate) fn is_event_attribute(name: &[u8]) -> bool {
    HTML_EVENT_ATTRIBUTES.binary_search(&name).is_ok()
}

/// Whether the element with the name `element` is known, and has an attribute with the name `attribute`.
pub(crate) fn is_attribute_of_element(element: &[u8], attribute: &[u8]) -> bool {
    attributes_of_element(element).is_some_and(|attributes| {
        attributes.binary_search(&attribute).is_ok()
            || attributes_of_element(b"*").is_some_and(|attributes| attributes.binary_search(&attribute).is_ok())
    })
}

/// `CSS_DISPLAY_TAGS[name]`
pub(crate) fn css_display_of_tag(name: &[u8]) -> Option<Display> {
    Some(match name {
        b"area" | b"base" | b"basefont" | b"datalist" | b"head" | b"link" | b"meta" | b"noembed"
        | b"noframes" | b"rp" | b"style" | b"title" => Display::None,
        b"address" | b"article" | b"aside" | b"blockquote" | b"body" | b"center" | b"dd"
        | b"details" | b"dialog" | b"dir" | b"div" | b"dl" | b"dt" | b"fieldset" | b"figcaption"
        | b"figure" | b"footer" | b"form" | b"h1" | b"h2" | b"h3" | b"h4" | b"h5" | b"h6" | b"header"
        | b"hgroup" | b"hr" | b"html" | b"legend" | b"listing" | b"main" | b"menu" | b"nav" | b"ol"
        | b"optgroup" | b"option" | b"p" | b"param" | b"plaintext" | b"pre" | b"script" | b"search"
        | b"section" | b"source" | b"summary" | b"track" | b"ul" | b"xmp" => Display::Block,
        b"rt" | b"ruby" | b"slot" | b"template" => Display::Inline,
        b"li" => Display::ListItem,
        b"caption" | b"col" | b"colgroup" | b"table" | b"tbody" | b"tfoot" | b"thead" | b"tr" => Display::Table,
        b"td" | b"th" => Display::TableCell,
        b"audio" | b"button" | b"input" | b"marquee" | b"meter" | b"object" | b"progress"
        | b"select" | b"video" => Display::InlineBlock,
        _ => return None,
    })
}

/// Whether `CSS_WHITE_SPACE_TAGS[name]` starts with `pre`.
pub(crate) fn is_pre_tag(name: &[u8]) -> bool {
    matches!(name, b"listing" | b"plaintext" | b"pre" | b"textarea" | b"xmp")
}

/// `@prettier/html-tags`, sorted.
const HTML_TAGS: [&[u8]; 151] = [
    b"a", b"abbr", b"acronym", b"address", b"applet", b"area", b"article", b"aside", b"audio", b"b",
    b"base", b"basefont", b"bdi", b"bdo", b"bgsound", b"big", b"blink", b"blockquote", b"body",
    b"br", b"button", b"canvas", b"caption", b"center", b"cite", b"code", b"col", b"colgroup",
    b"command", b"content", b"data", b"datalist", b"dd", b"del", b"details", b"dfn", b"dialog",
    b"dir", b"div", b"dl", b"dt", b"em", b"embed", b"fencedframe", b"fieldset", b"figcaption",
    b"figure", b"font", b"footer", b"form", b"frame", b"frameset", b"geolocation", b"h1", b"h2",
    b"h3", b"h4", b"h5", b"h6", b"head", b"header", b"hgroup", b"hr", b"html", b"i", b"iframe",
    b"image", b"img", b"input", b"ins", b"isindex", b"kbd", b"keygen", b"label", b"legend", b"li",
    b"link", b"listing", b"main", b"map", b"mark", b"marquee", b"math", b"menu", b"menuitem",
    b"meta", b"meter", b"multicol", b"nav", b"nextid", b"nobr", b"noembed", b"noframes", b"noscript",
    b"object", b"ol", b"optgroup", b"option", b"output", b"p", b"param", b"picture", b"plaintext",
    b"pre", b"progress", b"q", b"rb", b"rbc", b"rp", b"rt", b"rtc", b"ruby", b"s", b"samp",
    b"script", b"search", b"section", b"select", b"selectedcontent", b"shadow", b"slot", b"small",
    b"source", b"spacer", b"span", b"strike", b"strong", b"style", b"sub", b"summary", b"sup",
    b"svg", b"table", b"tbody", b"td", b"template", b"textarea", b"tfoot", b"th", b"thead", b"time",
    b"title", b"tr", b"track", b"tt", b"u", b"ul", b"var", b"video", b"wbr", b"xmp",
];

/// `@prettier/html-event-attributes`, sorted.
const HTML_EVENT_ATTRIBUTES: [&[u8]; 90] = [
    b"onabort", b"onafterprint", b"onauxclick", b"onbeforeinput", b"onbeforematch", b"onbeforeprint",
    b"onbeforetoggle", b"onbeforeunload", b"onblur", b"oncancel", b"oncanplay", b"oncanplaythrough",
    b"onchange", b"onclick", b"onclose", b"oncommand", b"oncontextlost", b"oncontextmenu",
    b"oncontextrestored", b"oncopy", b"oncuechange", b"oncut", b"ondblclick", b"ondrag",
    b"ondragend", b"ondragenter", b"ondragleave", b"ondragover", b"ondragstart", b"ondrop",
    b"ondurationchange", b"onemptied", b"onended", b"onerror", b"onfocus", b"onformdata",
    b"onhashchange", b"oninput", b"oninvalid", b"onkeydown", b"onkeypress", b"onkeyup",
    b"onlanguagechange", b"onload", b"onloadeddata", b"onloadedmetadata", b"onloadstart",
    b"onmessage", b"onmessageerror", b"onmousedown", b"onmouseenter", b"onmouseleave",
    b"onmousemove", b"onmouseout", b"onmouseover", b"onmouseup", b"onoffline", b"ononline",
    b"onpagehide", b"onpagereveal", b"onpageshow", b"onpageswap", b"onpaste", b"onpause", b"onplay",
    b"onplaying", b"onpopstate", b"onprogress", b"onratechange", b"onrejectionhandled", b"onreset",
    b"onresize", b"onscroll", b"onscrollend", b"onsecuritypolicyviolation", b"onseeked",
    b"onseeking", b"onselect", b"onslotchange", b"onstalled", b"onstorage", b"onsubmit",
    b"onsuspend", b"ontimeupdate", b"ontoggle", b"onunhandledrejection", b"onunload",
    b"onvolumechange", b"onwaiting", b"onwheel",
];

/// The names of elements that Angular's schema has and that have no definition of their own, sorted.
const KNOWN_ELEMENTS: [&[u8]; 94] = [
    b"[element]", b"[htmlelement]", b"a", b"abbr", b"address", b"article", b"aside", b"audio", b"b",
    b"bdi", b"bdo", b"blockquote", b"body", b"button", b"canvas", b"caption", b"cite", b"code",
    b"colgroup", b"content", b"data", b"datalist", b"del", b"details", b"dfn", b"dialog", b"dir",
    b"div", b"dl", b"em", b"fieldset", b"figcaption", b"figure", b"font", b"footer", b"form",
    b"frame", b"frameset", b"geolocation", b"h1", b"h2", b"h3", b"h4", b"h5", b"h6", b"head",
    b"header", b"hgroup", b"html", b"i", b"iframe", b"ins", b"kbd", b"keygen", b"label", b"legend",
    b"main", b"map", b"mark", b"marquee", b"media", b"menu", b"menuitem", b"meter", b"nav",
    b"noscript", b"object", b"ol", b"output", b"picture", b"progress", b"q", b"ruby", b"s", b"samp",
    b"search", b"section", b"select", b"selectedcontent", b"slot", b"small", b"span", b"strong",
    b"sub", b"summary", b"sup", b"table", b"template", b"time", b"u", b"ul", b"unknown", b"var",
    b"video",
];

/// `html-element-attributes`: the attributes of the element with the name, sorted. `*`: of all elements.
fn attributes_of_element(name: &[u8]) -> Option<&'static [&'static [u8]]> {
    Some(match name {
        b"*" => &[
            b"accesskey", b"autocapitalize", b"autocorrect", b"autofocus", b"class",
            b"contenteditable", b"dir", b"draggable", b"enterkeyhint", b"exportparts", b"hidden",
            b"id", b"inert", b"inputmode", b"is", b"itemid", b"itemprop", b"itemref", b"itemscope",
            b"itemtype", b"lang", b"nonce", b"part", b"popover", b"slot", b"spellcheck", b"style",
            b"tabindex", b"title", b"translate", b"writingsuggestions",
        ],
        b"a" => &[
            b"charset", b"coords", b"download", b"href", b"hreflang", b"name", b"ping",
            b"referrerpolicy", b"rel", b"rev", b"shape", b"target", b"type",
        ],
        b"applet" => &[
            b"align", b"alt", b"archive", b"code", b"codebase", b"height", b"hspace", b"name",
            b"object", b"vspace", b"width",
        ],
        b"area" => &[
            b"alt", b"coords", b"download", b"href", b"hreflang", b"nohref", b"ping",
            b"referrerpolicy", b"rel", b"shape", b"target", b"type",
        ],
        b"audio" => &[
            b"autoplay", b"controls", b"crossorigin", b"loop", b"muted", b"preload", b"src",
        ],
        b"base" => &[
            b"href", b"target",
        ],
        b"basefont" | b"font" => &[
            b"color", b"face", b"size",
        ],
        b"blockquote" | b"q" => &[
            b"cite",
        ],
        b"body" => &[
            b"alink", b"background", b"bgcolor", b"link", b"text", b"vlink",
        ],
        b"br" => &[
            b"clear",
        ],
        b"button" => &[
            b"command", b"commandfor", b"disabled", b"form", b"formaction", b"formenctype",
            b"formmethod", b"formnovalidate", b"formtarget", b"name", b"popovertarget",
            b"popovertargetaction", b"type", b"value",
        ],
        b"canvas" => &[
            b"height", b"width",
        ],
        b"caption" | b"div" | b"h1" | b"h2" | b"h3" | b"h4" | b"h5" | b"h6" | b"legend" | b"p" => &[
            b"align",
        ],
        b"col" | b"colgroup" => &[
            b"align", b"char", b"charoff", b"span", b"valign", b"width",
        ],
        b"data" => &[
            b"value",
        ],
        b"del" | b"ins" => &[
            b"cite", b"datetime",
        ],
        b"details" => &[
            b"name", b"open",
        ],
        b"dialog" => &[
            b"closedby", b"open",
        ],
        b"dir" | b"dl" | b"menu" => &[
            b"compact",
        ],
        b"embed" => &[
            b"height", b"src", b"type", b"width",
        ],
        b"fieldset" => &[
            b"disabled", b"form", b"name",
        ],
        b"form" => &[
            b"accept", b"accept-charset", b"action", b"autocomplete", b"enctype", b"method", b"name",
            b"novalidate", b"target",
        ],
        b"frame" => &[
            b"frameborder", b"longdesc", b"marginheight", b"marginwidth", b"name", b"noresize",
            b"scrolling", b"src",
        ],
        b"frameset" => &[
            b"cols", b"rows",
        ],
        b"head" => &[
            b"profile",
        ],
        b"hr" => &[
            b"align", b"noshade", b"size", b"width",
        ],
        b"html" => &[
            b"manifest", b"version",
        ],
        b"iframe" => &[
            b"align", b"allow", b"allowfullscreen", b"allowpaymentrequest", b"allowusermedia",
            b"frameborder", b"height", b"loading", b"longdesc", b"marginheight", b"marginwidth",
            b"name", b"referrerpolicy", b"sandbox", b"scrolling", b"src", b"srcdoc", b"width",
        ],
        b"img" => &[
            b"align", b"alt", b"border", b"crossorigin", b"decoding", b"fetchpriority", b"height",
            b"hspace", b"ismap", b"loading", b"longdesc", b"name", b"referrerpolicy", b"sizes",
            b"src", b"srcset", b"usemap", b"vspace", b"width",
        ],
        b"input" => &[
            b"accept", b"align", b"alpha", b"alt", b"autocomplete", b"checked", b"colorspace",
            b"dirname", b"disabled", b"form", b"formaction", b"formenctype", b"formmethod",
            b"formnovalidate", b"formtarget", b"height", b"ismap", b"list", b"max", b"maxlength",
            b"min", b"minlength", b"multiple", b"name", b"pattern", b"placeholder", b"popovertarget",
            b"popovertargetaction", b"readonly", b"required", b"size", b"src", b"step", b"type",
            b"usemap", b"value", b"width",
        ],
        b"isindex" => &[
            b"prompt",
        ],
        b"label" => &[
            b"for", b"form",
        ],
        b"li" => &[
            b"type", b"value",
        ],
        b"link" => &[
            b"as", b"blocking", b"charset", b"color", b"crossorigin", b"disabled", b"fetchpriority",
            b"href", b"hreflang", b"imagesizes", b"imagesrcset", b"integrity", b"media",
            b"referrerpolicy", b"rel", b"rev", b"sizes", b"target", b"type",
        ],
        b"map" | b"slot" => &[
            b"name",
        ],
        b"meta" => &[
            b"charset", b"content", b"http-equiv", b"media", b"name", b"scheme",
        ],
        b"meter" => &[
            b"high", b"low", b"max", b"min", b"optimum", b"value",
        ],
        b"object" => &[
            b"align", b"archive", b"border", b"classid", b"codebase", b"codetype", b"data",
            b"declare", b"form", b"height", b"hspace", b"name", b"standby", b"type",
            b"typemustmatch", b"usemap", b"vspace", b"width",
        ],
        b"ol" => &[
            b"compact", b"reversed", b"start", b"type",
        ],
        b"optgroup" => &[
            b"disabled", b"label",
        ],
        b"option" => &[
            b"disabled", b"label", b"selected", b"value",
        ],
        b"output" => &[
            b"for", b"form", b"name",
        ],
        b"param" => &[
            b"name", b"type", b"value", b"valuetype",
        ],
        b"pre" => &[
            b"width",
        ],
        b"progress" => &[
            b"max", b"value",
        ],
        b"script" => &[
            b"async", b"blocking", b"charset", b"crossorigin", b"defer", b"fetchpriority",
            b"integrity", b"language", b"nomodule", b"referrerpolicy", b"src", b"type",
        ],
        b"select" => &[
            b"autocomplete", b"disabled", b"form", b"multiple", b"name", b"required", b"size",
        ],
        b"source" => &[
            b"height", b"media", b"sizes", b"src", b"srcset", b"type", b"width",
        ],
        b"style" => &[
            b"blocking", b"media", b"type",
        ],
        b"table" => &[
            b"align", b"bgcolor", b"border", b"cellpadding", b"cellspacing", b"frame", b"rules",
            b"summary", b"width",
        ],
        b"tbody" | b"tfoot" | b"thead" => &[
            b"align", b"char", b"charoff", b"valign",
        ],
        b"td" | b"th" => &[
            b"abbr", b"align", b"axis", b"bgcolor", b"char", b"charoff", b"colspan", b"headers",
            b"height", b"nowrap", b"rowspan", b"scope", b"valign", b"width",
        ],
        b"template" => &[
            b"shadowrootclonable", b"shadowrootcustomelementregistry", b"shadowrootdelegatesfocus",
            b"shadowrootmode", b"shadowrootserializable",
        ],
        b"textarea" => &[
            b"autocomplete", b"cols", b"dirname", b"disabled", b"form", b"maxlength", b"minlength",
            b"name", b"placeholder", b"readonly", b"required", b"rows", b"wrap",
        ],
        b"time" => &[
            b"datetime",
        ],
        b"tr" => &[
            b"align", b"bgcolor", b"char", b"charoff", b"valign",
        ],
        b"track" => &[
            b"default", b"kind", b"label", b"src", b"srclang",
        ],
        b"ul" => &[
            b"compact", b"type",
        ],
        b"video" => &[
            b"autoplay", b"controls", b"crossorigin", b"height", b"loop", b"muted", b"playsinline",
            b"poster", b"preload", b"src", b"width",
        ],
        _ => return None,
    })
}

