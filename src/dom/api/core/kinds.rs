//! What a node is: its interface and its steps.

use bun_jsc::bindgen::{Class, JsInterface};

use super::atoms::{Known, TEXTS, atom};
use super::steps::Steps;
use super::{Node, html};
use crate::generated_bindgen::canvas::js_HTMLCanvasElement;
use crate::generated_bindgen::core::*;
use crate::generated_bindgen::document::{js_HTMLDocument, js_XMLDocument};
use crate::generated_bindgen::forms::*;
use crate::generated_bindgen::html::*;
use crate::generated_bindgen::images::js_HTMLImageElement;
use crate::generated_bindgen::images::js_HTMLSourceElement;
use crate::generated_bindgen::interaction::{js_HTMLDetailsElement, js_HTMLDialogElement};
use crate::generated_bindgen::media::{
    js_HTMLAudioElement, js_HTMLTrackElement, js_HTMLVideoElement,
};
use crate::generated_bindgen::svg::*;

#[derive(Clone, Copy)]
pub(crate) struct Interface {
    pub(super) class: Class<Node>,
    pub(super) number: u32,
}

const fn interface<T: JsInterface<Struct = Node>>(class: Class<T>) -> Interface {
    Interface {
        class: class.widen(),
        number: T::NUMBER,
    }
}

macro_rules! kinds {
    ($($kind:ident [$($html:tt)*] [$($svg:tt)*] $class:ident, $steps:expr;)*) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
        #[repr(u8)]
        pub(crate) enum Kind { $($kind),* }

        impl Kind {
            pub(crate) const ALL: &[Kind] = &[$(Kind::$kind),*];
        }
        static INTERFACES: [Interface; Kind::ALL.len()] = [$(interface($class::CLASS)),*];
        static STEPS: [&Steps; Kind::ALL.len()] = [$(&$steps),*];
        static ONLY_TAGS: [Known; Kind::ALL.len()] = [$(if let [only] = [$(atom!($html),)* Known::Other].split_last().unwrap().1 { *only } else { Known::Other }),*];
        /// Of the HTML and of the SVG element with each name.
        static BY_TAG: [[Kind; 2]; TEXTS.len() + 1] = {
            let mut all = [[Kind::Unknown, Kind::SvgElement]; TEXTS.len() + 1];
            $($(all[atom!($html) as usize][0] = Kind::$kind;)* $(all[atom!($svg) as usize][1] = Kind::$kind;)*)*
            all
        };
    };
}

// The kind, the HTML tags, the SVG tags, the class, the steps.
kinds! {
    Text [] [] js_Text, Steps::NONE;
    CData [] [] js_CDATASection, Steps::NONE;
    Comment [] [] js_DomComment, Steps::NONE;
    Instruction [] [] js_ProcessingInstruction, crate::api::loading::INSTRUCTION_STEPS;
    Doctype [] [] js_DocumentType, Steps::NONE;
    Fragment [] [] js_DocumentFragment, Steps::NONE;
    ShadowRoot [] [] js_ShadowRoot, Steps::NONE;
    Attr [] [] js_Attr, Steps::NONE;
    Document [] [] js_Doc, Steps::NONE;
    HtmlDocument [] [] js_HTMLDocument, Steps::NONE;
    XmlDocument [] [] js_XMLDocument, Steps::NONE;
    Element [] [] js_DomElement, Steps::NONE;
    MathMl [] [] js_MathMLElement, Steps::NONE;
    SvgElement [] [] js_SVGElement, Steps::NONE;
    SvgSvg [] ["svg"] js_SVGSVGElement, crate::api::frames::plugins::SVG_STEPS;
    SvgA [] ["a"] js_SVGAElement, crate::api::history::LINK_STEPS;
    SvgForeignObject [] ["foreignObject"] js_SVGForeignObjectElement, Steps::NONE;
    SvgImage [] ["image"] js_SVGImageElement, crate::api::images::SVG_IMAGE_STEPS;
    SvgUse [] ["use"] js_SVGUseElement, crate::api::images::USE_STEPS;
    SvgSymbol [] ["symbol"] js_SVGSymbolElement, Steps::NONE;
    SvgG [] ["g"] js_SVGGElement, Steps::NONE;
    SvgDefs [] ["defs"] js_SVGDefsElement, Steps::NONE;
    SvgSwitch [] ["switch"] js_SVGSwitchElement, Steps::NONE;
    SvgCircle [] ["circle"] js_SVGCircleElement, Steps::NONE;
    SvgEllipse [] ["ellipse"] js_SVGEllipseElement, Steps::NONE;
    SvgLine [] ["line"] js_SVGLineElement, Steps::NONE;
    SvgRect [] ["rect"] js_SVGRectElement, Steps::NONE;
    SvgPath [] ["path"] js_SVGPathElement, Steps::NONE;
    SvgPolygon [] ["polygon"] js_SVGPolygonElement, Steps::NONE;
    SvgPolyline [] ["polyline"] js_SVGPolylineElement, Steps::NONE;
    SvgTextPath [] ["textPath"] js_SVGTextPathElement, Steps::NONE;
    SvgText [] ["text"] js_SVGTextElement, Steps::NONE;
    SvgTspan [] ["tspan"] js_SVGTSpanElement, Steps::NONE;
    SvgLinearGradient [] ["linearGradient"] js_SVGLinearGradientElement, Steps::NONE;
    SvgRadialGradient [] ["radialGradient"] js_SVGRadialGradientElement, Steps::NONE;
    SvgClipPath [] ["clipPath"] js_SVGClipPathElement, Steps::NONE;
    SvgFilter [] ["filter"] js_SVGFilterElement, Steps::NONE;
    SvgMask [] ["mask"] js_SVGMaskElement, Steps::NONE;
    SvgPattern [] ["pattern"] js_SVGPatternElement, Steps::NONE;
    SvgMarker [] ["marker"] js_SVGMarkerElement, Steps::NONE;
    SvgStop [] ["stop"] js_SVGStopElement, Steps::NONE;
    SvgScript [] ["script"] js_SVGScriptElement, crate::api::loading::SCRIPT_STEPS;
    SvgStyle [] ["style"] js_SVGStyleElement, crate::api::loading::STYLE_STEPS;
    SvgMpath [] ["mpath"] js_SVGMPathElement, Steps::NONE;
    SvgDesc [] ["desc"] js_SVGDescElement, Steps::NONE;
    SvgMetadata [] ["metadata"] js_SVGMetadataElement, Steps::NONE;
    SvgTitle [] ["title"] js_SVGTitleElement, Steps::NONE;
    SvgView [] ["view"] js_SVGViewElement, Steps::NONE;
    SvgFeMergeNode [] ["feMergeNode"] js_SVGFEMergeNodeElement, Steps::NONE;
    SvgFeDistantLight [] ["feDistantLight"] js_SVGFEDistantLightElement, Steps::NONE;
    SvgFePointLight [] ["fePointLight"] js_SVGFEPointLightElement, Steps::NONE;
    SvgFeSpotLight [] ["feSpotLight"] js_SVGFESpotLightElement, Steps::NONE;
    SvgFeBlend [] ["feBlend"] js_SVGFEBlendElement, Steps::NONE;
    SvgFeColorMatrix [] ["feColorMatrix"] js_SVGFEColorMatrixElement, Steps::NONE;
    SvgFeComponentTransfer [] ["feComponentTransfer"] js_SVGFEComponentTransferElement, Steps::NONE;
    SvgFeComposite [] ["feComposite"] js_SVGFECompositeElement, Steps::NONE;
    SvgFeConvolveMatrix [] ["feConvolveMatrix"] js_SVGFEConvolveMatrixElement, Steps::NONE;
    SvgFeDiffuseLighting [] ["feDiffuseLighting"] js_SVGFEDiffuseLightingElement, Steps::NONE;
    SvgFeDisplacementMap [] ["feDisplacementMap"] js_SVGFEDisplacementMapElement, Steps::NONE;
    SvgFeDropShadow [] ["feDropShadow"] js_SVGFEDropShadowElement, Steps::NONE;
    SvgFeFlood [] ["feFlood"] js_SVGFEFloodElement, Steps::NONE;
    SvgFeFuncA [] ["feFuncA"] js_SVGFEFuncAElement, Steps::NONE;
    SvgFeFuncB [] ["feFuncB"] js_SVGFEFuncBElement, Steps::NONE;
    SvgFeFuncG [] ["feFuncG"] js_SVGFEFuncGElement, Steps::NONE;
    SvgFeFuncR [] ["feFuncR"] js_SVGFEFuncRElement, Steps::NONE;
    SvgFeGaussianBlur [] ["feGaussianBlur"] js_SVGFEGaussianBlurElement, Steps::NONE;
    SvgFeImage [] ["feImage"] js_SVGFEImageElement, Steps::NONE;
    SvgFeMerge [] ["feMerge"] js_SVGFEMergeElement, Steps::NONE;
    SvgFeMorphology [] ["feMorphology"] js_SVGFEMorphologyElement, Steps::NONE;
    SvgFeOffset [] ["feOffset"] js_SVGFEOffsetElement, Steps::NONE;
    SvgFeSpecularLighting [] ["feSpecularLighting"] js_SVGFESpecularLightingElement, Steps::NONE;
    SvgFeTile [] ["feTile"] js_SVGFETileElement, Steps::NONE;
    SvgFeTurbulence [] ["feTurbulence"] js_SVGFETurbulenceElement, Steps::NONE;
    SvgAnimate [] ["animate"] js_SVGAnimateElement, crate::api::svg::ANIMATION_STEPS;
    SvgAnimateMotion [] ["animateMotion"] js_SVGAnimateMotionElement, crate::api::svg::ANIMATION_STEPS;
    SvgAnimateTransform [] ["animateTransform"] js_SVGAnimateTransformElement, crate::api::svg::ANIMATION_STEPS;
    SvgSet [] ["set"] js_SVGSetElement, crate::api::svg::ANIMATION_STEPS;
    HtmlElement ["abbr" "acronym" "address" "article" "aside" "b" "basefont" "bdi" "bdo" "big" "center" "cite" "code" "dd" "dfn" "dt" "em" "figcaption" "figure" "footer" "header" "hgroup" "i" "kbd" "main" "mark" "nav" "nobr" "noembed" "noframes" "noscript" "plaintext" "rb" "rp" "rt" "rtc" "ruby" "s" "samp" "search" "section" "small" "strike" "strong" "sub" "sup" "tt" "u" "var" "wbr"] [] js_HTMLElement, Steps::NONE;
    Unknown [] [] js_HTMLUnknownElement, Steps::NONE;
    Summary ["summary"] [] js_HTMLElement, crate::api::ui::details::SUMMARY_STEPS;
    FormAssociated [] [] js_HTMLElement, crate::api::forms::internals::STEPS;
    Anchor ["a"] [] js_HTMLAnchorElement, crate::api::history::LINK_STEPS;
    Area ["area"] [] js_HTMLAreaElement, crate::api::history::LINK_STEPS;
    Audio ["audio"] [] js_HTMLAudioElement, crate::api::media::MEDIA_STEPS;
    BR ["br"] [] js_HTMLBRElement, Steps::NONE;
    Base ["base"] [] js_HTMLBaseElement, html::BASE_STEPS;
    Body ["body"] [] js_HTMLBodyElement, html::BODY_STEPS;
    Button ["button"] [] js_HTMLButtonElement, crate::api::forms::button::STEPS;
    Canvas ["canvas"] [] js_HTMLCanvasElement, crate::api::canvas::CANVAS_STEPS;
    DList ["dl"] [] js_HTMLDListElement, Steps::NONE;
    Data ["data"] [] js_HTMLDataElement, Steps::NONE;
    DataList ["datalist"] [] js_HTMLDataListElement, crate::api::forms::option::DATALIST_STEPS;
    Details ["details"] [] js_HTMLDetailsElement, crate::api::ui::details::STEPS;
    Dialog ["dialog"] [] js_HTMLDialogElement, crate::api::ui::dialog::STEPS;
    Directory ["dir"] [] js_HTMLDirectoryElement, Steps::NONE;
    Div ["div"] [] js_HTMLDivElement, Steps::NONE;
    Embed ["embed"] [] js_HTMLEmbedElement, crate::api::frames::plugins::STEPS;
    FieldSet ["fieldset"] [] js_HTMLFieldSetElement, crate::api::forms::button::FIELDSET_STEPS;
    Font ["font"] [] js_HTMLFontElement, Steps::NONE;
    Form ["form"] [] js_HTMLFormElement, crate::api::forms::form::STEPS;
    Frame ["frame"] [] js_HTMLFrameElement, crate::api::frames::STEPS;
    FrameSet ["frameset"] [] js_HTMLFrameSetElement, Steps::NONE;
    HR ["hr"] [] js_HTMLHRElement, Steps::NONE;
    Head ["head"] [] js_HTMLHeadElement, Steps::NONE;
    Heading ["h1" "h2" "h3" "h4" "h5" "h6"] [] js_HTMLHeadingElement, Steps::NONE;
    Html ["html"] [] js_HTMLHtmlElement, Steps::NONE;
    IFrame ["iframe"] [] js_HTMLIFrameElement, crate::api::frames::STEPS;
    Image ["img"] [] js_HTMLImageElement, crate::api::images::IMG_STEPS;
    Input ["input"] [] js_HTMLInputElement, crate::api::forms::input::STEPS;
    LI ["li"] [] js_HTMLLIElement, Steps::NONE;
    Label ["label"] [] js_HTMLLabelElement, crate::api::forms::button::LABEL_STEPS;
    Legend ["legend"] [] js_HTMLLegendElement, crate::api::forms::button::LEGEND_STEPS;
    Link ["link"] [] js_HTMLLinkElement, crate::api::loading::LINK_STEPS;
    Map ["map"] [] js_HTMLMapElement, Steps::NONE;
    Marquee ["marquee"] [] js_HTMLMarqueeElement, Steps::NONE;
    Menu ["menu"] [] js_HTMLMenuElement, Steps::NONE;
    Meta ["meta"] [] js_HTMLMetaElement, html::META_STEPS;
    Meter ["meter"] [] js_HTMLMeterElement, crate::api::forms::gauge::STEPS;
    Mod ["del" "ins"] [] js_HTMLModElement, Steps::NONE;
    OList ["ol"] [] js_HTMLOListElement, Steps::NONE;
    Object ["object"] [] js_HTMLObjectElement, crate::api::frames::plugins::STEPS;
    OptGroup ["optgroup"] [] js_HTMLOptGroupElement, crate::api::forms::option::GROUP_STEPS;
    Option ["option"] [] js_HTMLOptionElement, crate::api::forms::option::STEPS;
    Output ["output"] [] js_HTMLOutputElement, crate::api::forms::button::OUTPUT_STEPS;
    Paragraph ["p"] [] js_HTMLParagraphElement, Steps::NONE;
    Param ["param"] [] js_HTMLParamElement, Steps::NONE;
    Picture ["picture"] [] js_HTMLPictureElement, Steps::NONE;
    Pre ["pre" "listing" "xmp"] [] js_HTMLPreElement, Steps::NONE;
    Progress ["progress"] [] js_HTMLProgressElement, crate::api::forms::gauge::STEPS;
    Quote ["blockquote" "q"] [] js_HTMLQuoteElement, Steps::NONE;
    Script ["script"] [] js_HTMLScriptElement, crate::api::loading::SCRIPT_STEPS;
    Select ["select"] [] js_HTMLSelectElement, crate::api::forms::select::STEPS;
    SelectedContent ["selectedcontent"] [] js_HTMLSelectedContentElement, crate::api::forms::option::SELECTED_CONTENT_STEPS;
    Slot ["slot"] [] js_HTMLSlotElement, html::SLOT_STEPS;
    Source ["source"] [] js_HTMLSourceElement, crate::api::images::SOURCE_STEPS;
    Span ["span"] [] js_HTMLSpanElement, Steps::NONE;
    Style ["style"] [] js_HTMLStyleElement, crate::api::loading::STYLE_STEPS;
    TableCaption ["caption"] [] js_HTMLTableCaptionElement, Steps::NONE;
    TableCell ["td" "th"] [] js_HTMLTableCellElement, Steps::NONE;
    TableCol ["col" "colgroup"] [] js_HTMLTableColElement, Steps::NONE;
    Table ["table"] [] js_HTMLTableElement, Steps::NONE;
    TableRow ["tr"] [] js_HTMLTableRowElement, Steps::NONE;
    TableSection ["tbody" "thead" "tfoot"] [] js_HTMLTableSectionElement, Steps::NONE;
    Template ["template"] [] js_HTMLTemplateElement, html::TEMPLATE_STEPS;
    TextArea ["textarea"] [] js_HTMLTextAreaElement, crate::api::forms::textarea::STEPS;
    Time ["time"] [] js_HTMLTimeElement, Steps::NONE;
    Title ["title"] [] js_HTMLTitleElement, html::TITLE_STEPS;
    Track ["track"] [] js_HTMLTrackElement, crate::api::media::TRACK_STEPS;
    UList ["ul"] [] js_HTMLUListElement, Steps::NONE;
    Video ["video"] [] js_HTMLVideoElement, crate::api::media::MEDIA_STEPS;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub(crate) enum NodeType {
    Element = 1,
    Attribute = 2,
    Text = 3,
    CData = 4,
    Instruction = 7,
    Comment = 8,
    Document = 9,
    Doctype = 10,
    Fragment = 11,
}

impl Kind {
    /// `Unknown` for a custom element too.
    #[inline]
    pub(crate) fn of_html(tag: Known) -> Kind {
        BY_TAG[tag as usize][0]
    }

    #[inline]
    pub(crate) fn of_svg(tag: Known) -> Kind {
        BY_TAG[tag as usize][1]
    }

    /// Of the HTML elements of this kind. `Other` if they can have several.
    #[inline(always)]
    pub(crate) fn only_tag(self) -> Known {
        ONLY_TAGS[self as usize]
    }

    pub(crate) fn interface(self) -> Interface {
        INTERFACES[self as usize]
    }

    #[inline]
    pub(crate) fn steps(self) -> &'static Steps {
        STEPS[self as usize]
    }

    #[inline(always)]
    pub(crate) fn is_element(self) -> bool {
        self >= Kind::Element
    }

    #[inline(always)]
    pub(crate) fn is_html(self) -> bool {
        self >= Kind::HtmlElement
    }

    #[inline(always)]
    pub(crate) fn is_svg(self) -> bool {
        (Kind::SvgElement..Kind::HtmlElement).contains(&self)
    }

    #[inline(always)]
    pub(crate) fn is_text(self) -> bool {
        self <= Kind::CData
    }

    #[inline(always)]
    pub(crate) fn is_character_data(self) -> bool {
        self <= Kind::Instruction
    }

    #[inline(always)]
    pub(crate) fn is_document(self) -> bool {
        (Kind::Document..=Kind::XmlDocument).contains(&self)
    }

    /// The engine has it among the children of its parent.
    #[inline(always)]
    pub(crate) fn is_linked(self) -> bool {
        self.is_element() || self.is_text()
    }

    #[inline]
    pub(crate) fn node_type(self) -> NodeType {
        match self {
            Kind::Text => NodeType::Text,
            Kind::CData => NodeType::CData,
            Kind::Comment => NodeType::Comment,
            Kind::Instruction => NodeType::Instruction,
            Kind::Doctype => NodeType::Doctype,
            Kind::Fragment | Kind::ShadowRoot => NodeType::Fragment,
            Kind::Attr => NodeType::Attribute,
            Kind::Document | Kind::HtmlDocument | Kind::XmlDocument => NodeType::Document,
            _ => NodeType::Element,
        }
    }
}
