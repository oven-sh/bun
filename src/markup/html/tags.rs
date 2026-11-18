use crate::Chars;

bitflags::bitflags! {
    /// The categories of <https://html.spec.whatwg.org/multipage/parsing.html>, for an element in the HTML namespace.
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct Kind: u32 {
        const SPECIAL = 1;
        const FORMATTING = 1 << 1;
        const SCOPE = 1 << 2;
        const LIST_SCOPE = 1 << 3;
        const BUTTON_SCOPE = 1 << 4;
        const TABLE_SCOPE = 1 << 5;
        const IMPLIED_END = 1 << 6;
        const HEADING = 1 << 8;
        const HEAD = 1 << 9;
        const TABLE_PART = 1 << 10;
        const ROW_GROUP = 1 << 11;
        const FOSTERS = 1 << 12;
        const LEAVES_FOREIGN = 1 << 13;
        const VOID = 1 << 14;
        const RAW_TEXT = 1 << 15;
        const FORM_ASSOCIATED = 1 << 16;
        /// `Sink::finished` hears of it.
        const REPORTS_END = 1 << 17;
        /// In the MathML namespace.
        const MATH_TEXT = 1 << 18;
        /// Of an element, not of a name.
        const HTML_INTEGRATION = 1 << 19;
    }
}

macro_rules! tags {
    ($($tag:ident $name:literal $($kind:ident)|*;)*) => {
        /// A tag name in lowercase.
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        #[repr(u8)]
        pub enum Tag {
            Other,
            $($tag,)*
        }

        impl Tag {
            pub const ALL: &[Tag] = &[Tag::Other, $(Tag::$tag,)*];
        }

        const NAMES: [&str; Tag::ALL.len()] = ["", $($name,)*];
        const KINDS: [Kind; Tag::ALL.len()] = [Kind::empty(), $(Kind::empty()$(.union(Kind::$kind))*,)*];
    };
}

tags! {
    A "a" FORMATTING;
    Abbr "abbr";
    Acronym "acronym";
    Address "address" SPECIAL;
    AnnotationXml "annotation-xml";
    Applet "applet" SPECIAL | SCOPE;
    Area "area" SPECIAL | VOID;
    Article "article" SPECIAL;
    Aside "aside" SPECIAL;
    Audio "audio" REPORTS_END;
    B "b" FORMATTING | LEAVES_FOREIGN;
    Base "base" SPECIAL | HEAD | VOID;
    Basefont "basefont" SPECIAL | HEAD | VOID;
    Bdi "bdi";
    Bdo "bdo";
    Bgsound "bgsound" SPECIAL | HEAD | VOID;
    Big "big" FORMATTING | LEAVES_FOREIGN;
    Blockquote "blockquote" SPECIAL | LEAVES_FOREIGN;
    Body "body" SPECIAL | LEAVES_FOREIGN;
    Br "br" SPECIAL | LEAVES_FOREIGN | VOID;
    Button "button" SPECIAL | BUTTON_SCOPE | FORM_ASSOCIATED;
    Canvas "canvas";
    Caption "caption" SPECIAL | SCOPE | TABLE_PART;
    Center "center" SPECIAL | LEAVES_FOREIGN;
    Cite "cite";
    Code "code" FORMATTING | LEAVES_FOREIGN;
    Col "col" SPECIAL | TABLE_PART | VOID;
    Colgroup "colgroup" SPECIAL | TABLE_PART;
    Data "data";
    Datalist "datalist";
    Dd "dd" SPECIAL | IMPLIED_END | LEAVES_FOREIGN;
    Del "del";
    Desc "desc";
    Details "details" SPECIAL;
    Dfn "dfn";
    Dialog "dialog";
    Dir "dir" SPECIAL;
    Div "div" SPECIAL | LEAVES_FOREIGN;
    Dl "dl" SPECIAL | LEAVES_FOREIGN;
    Dt "dt" SPECIAL | IMPLIED_END | LEAVES_FOREIGN;
    Em "em" FORMATTING | LEAVES_FOREIGN;
    Embed "embed" SPECIAL | LEAVES_FOREIGN | VOID;
    Fieldset "fieldset" SPECIAL | FORM_ASSOCIATED;
    Figcaption "figcaption" SPECIAL;
    Figure "figure" SPECIAL;
    Font "font" FORMATTING;
    Footer "footer" SPECIAL;
    ForeignObject "foreignobject";
    Form "form" SPECIAL;
    Frame "frame" SPECIAL | VOID;
    Frameset "frameset" SPECIAL;
    H1 "h1" SPECIAL | HEADING | LEAVES_FOREIGN;
    H2 "h2" SPECIAL | HEADING | LEAVES_FOREIGN;
    H3 "h3" SPECIAL | HEADING | LEAVES_FOREIGN;
    H4 "h4" SPECIAL | HEADING | LEAVES_FOREIGN;
    H5 "h5" SPECIAL | HEADING | LEAVES_FOREIGN;
    H6 "h6" SPECIAL | HEADING | LEAVES_FOREIGN;
    Head "head" SPECIAL | LEAVES_FOREIGN;
    Header "header" SPECIAL;
    Hgroup "hgroup" SPECIAL;
    Hr "hr" SPECIAL | LEAVES_FOREIGN | VOID;
    Html "html" SPECIAL | SCOPE | TABLE_SCOPE;
    I "i" FORMATTING | LEAVES_FOREIGN;
    Iframe "iframe" SPECIAL | RAW_TEXT;
    Image "image";
    Img "img" SPECIAL | LEAVES_FOREIGN | VOID | FORM_ASSOCIATED;
    Input "input" SPECIAL | VOID | FORM_ASSOCIATED;
    Ins "ins";
    Kbd "kbd";
    Keygen "keygen" SPECIAL | VOID;
    Label "label";
    Legend "legend";
    Li "li" SPECIAL | IMPLIED_END | LEAVES_FOREIGN;
    Link "link" SPECIAL | HEAD | VOID;
    Listing "listing" SPECIAL | LEAVES_FOREIGN;
    Main "main" SPECIAL;
    Malignmark "malignmark";
    Map "map";
    Mark "mark";
    Marquee "marquee" SPECIAL | SCOPE;
    Math "math";
    Menu "menu" SPECIAL | LEAVES_FOREIGN;
    Meta "meta" SPECIAL | HEAD | LEAVES_FOREIGN | VOID;
    Meter "meter";
    Mglyph "mglyph";
    Mi "mi" MATH_TEXT;
    Mn "mn" MATH_TEXT;
    Mo "mo" MATH_TEXT;
    Ms "ms" MATH_TEXT;
    Mtext "mtext" MATH_TEXT;
    Nav "nav" SPECIAL;
    Nobr "nobr" FORMATTING | LEAVES_FOREIGN;
    Noembed "noembed" SPECIAL | RAW_TEXT;
    Noframes "noframes" SPECIAL | HEAD | RAW_TEXT;
    Noscript "noscript" SPECIAL;
    Object "object" SPECIAL | SCOPE | FORM_ASSOCIATED | REPORTS_END;
    Ol "ol" SPECIAL | LIST_SCOPE | LEAVES_FOREIGN;
    Optgroup "optgroup" IMPLIED_END;
    Option "option" IMPLIED_END | REPORTS_END;
    Output "output" FORM_ASSOCIATED;
    P "p" SPECIAL | IMPLIED_END | LEAVES_FOREIGN;
    Param "param" SPECIAL | VOID;
    Picture "picture";
    Plaintext "plaintext" SPECIAL | RAW_TEXT;
    Pre "pre" SPECIAL | LEAVES_FOREIGN;
    Progress "progress";
    Q "q";
    Rb "rb" IMPLIED_END;
    Rp "rp" IMPLIED_END;
    Rt "rt" IMPLIED_END;
    Rtc "rtc" IMPLIED_END;
    Ruby "ruby" LEAVES_FOREIGN;
    S "s" FORMATTING | LEAVES_FOREIGN;
    Samp "samp";
    Script "script" SPECIAL | HEAD | RAW_TEXT | REPORTS_END;
    Search "search" SPECIAL;
    Section "section" SPECIAL;
    Select "select" SPECIAL | SCOPE | FORM_ASSOCIATED | REPORTS_END;
    SelectedContent "selectedcontent";
    Slot "slot";
    Small "small" FORMATTING | LEAVES_FOREIGN;
    Source "source" SPECIAL | VOID;
    Span "span" LEAVES_FOREIGN;
    Strike "strike" FORMATTING | LEAVES_FOREIGN;
    Strong "strong" FORMATTING | LEAVES_FOREIGN;
    Style "style" SPECIAL | HEAD | RAW_TEXT | REPORTS_END;
    Sub "sub" LEAVES_FOREIGN;
    Summary "summary" SPECIAL;
    Sup "sup" LEAVES_FOREIGN;
    Svg "svg";
    Table "table" SPECIAL | SCOPE | TABLE_SCOPE | FOSTERS | LEAVES_FOREIGN;
    Tbody "tbody" SPECIAL | TABLE_PART | ROW_GROUP | FOSTERS;
    Td "td" SPECIAL | SCOPE | TABLE_PART;
    Template "template" SPECIAL | SCOPE | TABLE_SCOPE | HEAD;
    Textarea "textarea" SPECIAL | FORM_ASSOCIATED | REPORTS_END;
    Tfoot "tfoot" SPECIAL | TABLE_PART | ROW_GROUP | FOSTERS;
    Th "th" SPECIAL | SCOPE | TABLE_PART;
    Thead "thead" SPECIAL | TABLE_PART | ROW_GROUP | FOSTERS;
    Time "time";
    Title "title" SPECIAL | HEAD | REPORTS_END;
    Tr "tr" SPECIAL | TABLE_PART | FOSTERS;
    Track "track" SPECIAL | VOID;
    Tt "tt" FORMATTING | LEAVES_FOREIGN;
    U "u" FORMATTING | LEAVES_FOREIGN;
    Ul "ul" SPECIAL | LIST_SCOPE | LEAVES_FOREIGN;
    Var "var" LEAVES_FOREIGN;
    Video "video" REPORTS_END;
    Wbr "wbr" SPECIAL | VOID;
    Xmp "xmp" SPECIAL | RAW_TEXT;
}

/// The characters of a name that has up to eight, all in ASCII, the first in the lowest byte.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct ShortName(pub(crate) u64);

impl ShortName {
    pub(super) const fn of_ascii(name: &[u8]) -> ShortName {
        let (mut packed, mut at) = (0, name.len());
        while at > 0 {
            at -= 1;
            packed = packed << 8 | name[at] as u64;
        }
        ShortName(packed)
    }

    pub fn new(name: Chars<'_>) -> Option<ShortName> {
        let is_short = name.len() <= 8 && name.units().all(|it| (1..0x80).contains(&it));
        is_short.then(|| {
            ShortName(
                name.units()
                    .rev()
                    .fold(0, |packed, it| packed << 8 | u64::from(it)),
            )
        })
    }

    /// A hash below `1 << bits`.
    #[inline(always)]
    pub const fn slot(self, bits: u32) -> usize {
        (self.0.wrapping_mul(0x9e37_79b9_7f4a_7c15) >> (64 - bits)) as usize
    }
}

const SLOT_BITS: u32 = 10;

static SHORT_NAMES: [ShortName; NAMES.len()] = {
    let (mut all, mut index) = ([ShortName(0); NAMES.len()], 0);
    while index < NAMES.len() {
        if NAMES[index].len() <= 8 {
            all[index] = ShortName::of_ascii(NAMES[index].as_bytes());
        }
        index += 1;
    }
    all
};

static BY_SHORT_NAME: [Tag; 1 << SLOT_BITS] = {
    let (mut slots, mut index) = ([Tag::Other; 1 << SLOT_BITS], 1);
    while index < NAMES.len() {
        if NAMES[index].len() <= 8 {
            let mut slot = ShortName::of_ascii(NAMES[index].as_bytes()).slot(SLOT_BITS);
            while !matches!(slots[slot], Tag::Other) {
                slot = (slot + 1) % slots.len();
            }
            slots[slot] = Tag::ALL[index];
        }
        index += 1;
    }
    slots
};

impl Tag {
    #[inline]
    pub(crate) fn from_short_name(name: ShortName) -> Tag {
        let mut slot = name.slot(SLOT_BITS);
        loop {
            let tag = BY_SHORT_NAME[slot];
            if SHORT_NAMES[tag as usize] == name || tag == Tag::Other {
                return tag;
            }
            slot = (slot + 1) % BY_SHORT_NAME.len();
        }
    }

    pub fn from_name(name: Chars<'_>) -> Tag {
        match ShortName::new(name) {
            Some(short) => Tag::from_short_name(short),
            None => Tag::ALL
                .iter()
                .find(|it| name.is(it.name().as_bytes()))
                .copied()
                .unwrap_or(Tag::Other),
        }
    }

    #[inline]
    pub const fn name(self) -> &'static str {
        NAMES[self as usize]
    }

    #[inline]
    pub const fn kind(self) -> Kind {
        KINDS[self as usize]
    }

    #[inline]
    pub const fn is(self, kind: Kind) -> bool {
        self.kind().intersects(kind)
    }
}

/// By the first letter, as bits.
const fn lengths_of(names: &[&str]) -> [u32; 26] {
    let (mut lengths, mut at) = ([0; 26], 0);
    while at < names.len() {
        lengths[(names[at].as_bytes()[0] - b'a') as usize] |= 1 << names[at].len();
        at += 1;
    }
    lengths
}

fn with_capitals(
    sorted: &'static [&'static str],
    lengths: &[u32; 26],
    lowercase: Chars<'_>,
) -> Option<&'static str> {
    let first = lowercase.units().next()?.wrapping_sub(b'a'.into());
    if lowercase.len() > 31 || lengths.get(usize::from(first))? >> lowercase.len() & 1 == 0 {
        return None;
    }
    let lower = |name: &'static str| name.bytes().map(|it| u16::from(it.to_ascii_lowercase()));
    let found = sorted.binary_search_by(|it| lower(it).cmp(lowercase.units()));
    found.ok().map(|index| sorted[index])
}

pub(crate) fn svg_tag_name(lowercase: Chars<'_>) -> Option<&'static str> {
    with_capitals(SVG_TAGS, &const { lengths_of(SVG_TAGS) }, lowercase)
}

pub(crate) fn svg_attribute_name(lowercase: Chars<'_>) -> Option<&'static str> {
    with_capitals(
        SVG_ATTRIBUTES,
        &const { lengths_of(SVG_ATTRIBUTES) },
        lowercase,
    )
}

#[rustfmt::skip]
const SVG_TAGS: &[&str] = &[
    "altGlyph", "altGlyphDef", "altGlyphItem", "animateColor", "animateMotion", "animateTransform", "clipPath",
    "feBlend", "feColorMatrix", "feComponentTransfer", "feComposite", "feConvolveMatrix", "feDiffuseLighting",
    "feDisplacementMap", "feDistantLight", "feDropShadow", "feFlood", "feFuncA", "feFuncB", "feFuncG", "feFuncR",
    "feGaussianBlur", "feImage", "feMerge", "feMergeNode", "feMorphology", "feOffset", "fePointLight",
    "feSpecularLighting", "feSpotLight", "feTile", "feTurbulence", "foreignObject", "glyphRef", "linearGradient",
    "radialGradient", "textPath",
];

#[rustfmt::skip]
const SVG_ATTRIBUTES: &[&str] = &[
    "attributeName", "attributeType", "baseFrequency", "baseProfile", "calcMode", "clipPathUnits",
    "diffuseConstant", "edgeMode", "filterUnits", "glyphRef", "gradientTransform", "gradientUnits", "kernelMatrix",
    "kernelUnitLength", "keyPoints", "keySplines", "keyTimes", "lengthAdjust", "limitingConeAngle", "markerHeight",
    "markerUnits", "markerWidth", "maskContentUnits", "maskUnits", "numOctaves", "pathLength",
    "patternContentUnits", "patternTransform", "patternUnits", "pointsAtX", "pointsAtY", "pointsAtZ",
    "preserveAlpha", "preserveAspectRatio", "primitiveUnits", "refX", "refY", "repeatCount", "repeatDur",
    "requiredExtensions", "requiredFeatures", "specularConstant", "specularExponent", "spreadMethod", "startOffset",
    "stdDeviation", "stitchTiles", "surfaceScale", "systemLanguage", "tableValues", "targetX", "targetY",
    "textLength", "viewBox", "viewTarget", "xChannelSelector", "yChannelSelector", "zoomAndPan",
];
