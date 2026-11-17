//! From markup to nodes, and back.

mod parser;
mod pending;
mod sanitizer;
mod serialize;
mod serialize_xml;
mod sink;
mod xml;

use core::cell::Cell;

use bun_jsc::JSString;
use bun_jsc::bindgen::{self, JsLocal, JsScope};
use bun_markup::html::{self, AttributeNamespace, Namespace};
use bun_markup::{Chars, Text as Buffer};

pub(crate) use parser::{DocumentParser, throws_on_markup_insertion};
use sanitizer::Safety;
pub(crate) use sanitizer::Sanitizer;
pub(crate) use serialize_xml::{WellFormed, outer_xml};
pub(crate) use xml::parse_document as parse_xml_document;

use crate::api::core::*;
use crate::api::support::*;
use crate::api::trusted::Trusted;
use crate::generated_bindgen::core::SetHTMLOptions;
use crate::generated_bindgen::markup::{
    DOMParser, DOMParserSupportedType, GetHTMLOptions, Markup, SetHTMLUnsafeOptions, XMLSerializer,
    js_DOMParser,
};
pub(crate) use sink::Recent;
use sink::{Client, Sink};

type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Str<'a> = JsLocal<'a, JSString>;
type Result<'a, T = ()> = bindgen::Result<'a, T>;

fn with_buffer(write: impl FnOnce(Buffer) -> Buffer) -> DomString {
    const MOST_KEPT: usize = 1 << 20;
    thread_local! {
        static BUFFER: Cell<Buffer> = const { Cell::new(Buffer::Latin1(Vec::new())) };
    }
    let mut buffer = write(BUFFER.take());
    let string = DomString::from_chars(buffer.chars());
    if buffer.len() <= MOST_KEPT {
        buffer.clear();
        BUFFER.set(buffer);
    }
    string
}

#[derive(Clone, Copy, Default)]
pub(crate) struct FragmentOptions {
    pub(crate) allows_shadow_roots: bool,
    pub(crate) starts_scripts: bool,
    /// Nothing in it loads or runs.
    pub(crate) is_inert: bool,
}

/// `registry_from`: what has the custom element registry.
pub(crate) fn parse_html_fragment<'a>(
    cx: Cx<'_, 'a>,
    context: &'a Element,
    markup: Chars<'_>,
    registry_from: &'a Node,
    options: FragmentOptions,
) -> &'a Node {
    let (doc, is_template) = (context.doc(), context.kind() == Kind::Template);
    let owner = if options.is_inert || is_template {
        doc.template_contents_owner(cx)
    } else {
        doc
    };
    let root: &Node = owner.create_fragment(&cx.heap);
    let namespace = match context.ns() {
        Ns::Html => Some(Namespace::Html),
        Ns::Svg => Some(Namespace::Svg),
        Ns::MathMl => Some(Namespace::MathMl),
        _ => None,
    };
    let encoding = if namespace == Some(Namespace::MathMl) {
        context.attr(atom!("encoding"))
    } else {
        None
    };
    let encoding = encoding.map(|value| html::Attribute {
        name: atom!("encoding").into(),
        namespace: AttributeNamespace::None,
        value,
    });
    let form = context
        .inclusive_ancestors()
        .find(|it| it.kind() == Kind::Form)
        .map(Node::to_js);
    let context = html::Context {
        node: context.to_js(),
        tag: sink::tag_of(context),
        namespace,
        attributes: encoding.into_iter().collect(),
        form,
    };
    let client = Client::Fragment {
        root,
        registry_from: (!is_template).then_some(registry_from),
        starts_scripts: options.starts_scripts,
    };
    let options = html::Options {
        scripting: doc.is(DocFlags::HAS_PAGE),
        allows_declarative_shadow_roots: options.allows_shadow_roots,
        allows_patches: !options.is_inert,
        keeps_mode: true,
    };
    without_collecting(cx, |cx| {
        html::parse_fragment(
            markup,
            &context,
            root.to_js(),
            options,
            &mut Sink::new(cx, doc, client),
        )
    });
    doc.report_bare(cx);
    root
}

/// Whether parsing makes one text node of it, as it is.
#[inline]
pub(crate) fn is_only_text(context: &Element, markup: &DomString) -> bool {
    use Kind::*;
    let Some(bytes) = markup.latin1() else {
        return false;
    };
    let is_markup = |it: &u8| matches!(it, b'<' | b'&' | b'\r' | 0);
    !bytes.first().is_some_and(is_markup)
        && bun_core::strings::index_of_any(bytes, b"<&\r\0").is_none()
        && context.ignores_case()
        && !matches!(context.kind(), Html | FrameSet | Template | TableCol)
}

/// <https://html.spec.whatwg.org/#fragment-parsing-algorithm-steps>
pub(crate) fn parse_fragment<'a>(
    cx: Cx<'_, 'a>,
    context: &'a Element,
    markup: &DomString,
    registry_from: &'a Node,
    options: FragmentOptions,
) -> Result<'a, &'a Node> {
    match context.doc().is_html_doc() {
        true => Ok(parse_html_fragment(
            cx,
            context,
            markup.chars(),
            registry_from,
            options,
        )),
        false => xml::parse_fragment(cx, context, markup, options.starts_scripts),
    }
}

#[derive(Clone, Copy, Default)]
pub(crate) struct DocumentOptions {
    pub(crate) allows_shadow_roots: bool,
    pub(crate) scripting: bool,
}

impl From<DocumentOptions> for html::Options {
    fn from(options: DocumentOptions) -> html::Options {
        html::Options {
            scripting: options.scripting,
            allows_declarative_shadow_roots: options.allows_shadow_roots,
            allows_patches: true,
            keeps_mode: false,
        }
    }
}

/// None of its scripts runs.
pub(crate) fn parse_html_document<'a>(
    cx: Cx<'_, 'a>,
    doc: &'a Doc,
    markup: &DomString,
    options: DocumentOptions,
) -> Result<'a> {
    let options = options.into();
    if doc.is(DocFlags::HAS_PAGE) {
        let parser = DocumentParser::create(&cx.heap, doc, options, false);
        parser.write(markup);
        parser.end();
        parser.run(cx);
        return Ok(());
    }
    let mut parser = html::Parser::new(options);
    parser.write(markup.chars());
    parser.end();
    without_collecting(cx, |cx| {
        let mut sink = Sink::new(cx, doc, Client::Inert);
        while !matches!(parser.run(&mut sink), html::Stop::Finished) {}
    });
    doc.report_bare(cx);
    Ok(())
}

/// <https://html.spec.whatwg.org/#fragment-serializing-algorithm-steps>
pub(crate) fn serialize_inner<'a>(cx: Cx<'_, 'a>, node: &'a Node) -> Result<'a, DomString> {
    match node.doc().is_html_doc() {
        true => Ok(serialize::inner_html(cx, node, None)),
        false => serialize_xml::inner_xml(cx, node),
    }
}

pub(crate) fn serialize_outer<'a>(cx: Cx<'_, 'a>, node: &'a Node) -> Result<'a, DomString> {
    match node.doc().is_html_doc() {
        true => Ok(serialize::outer_html(cx, node)),
        false => outer_xml(cx, node, WellFormed::Required),
    }
}

impl Markup {
    pub(crate) fn get_html<'a>(&'a self, cx: Cx<'_, 'a>, options: &GetHTMLOptions<'a>) -> Str<'a> {
        serialize::inner_html(cx, self, Some(options)).to_js(&cx.heap)
    }

    /// <https://html.spec.whatwg.org/#set-and-filter-html>
    fn set_and_filter<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        markup: Str<'a>,
        sanitizer: JsLocal<'a>,
        safety: Safety,
        starts_scripts: bool,
    ) -> Result<'a> {
        let (markup, sanitizer) = (
            DomString::from_js_string(&cx.heap, markup)?,
            sanitizer::from_option(cx, sanitizer, safety)?,
        );
        let Some(context) = self.host().unwrap_or(self).as_element() else {
            return Ok(());
        };
        if safety == Safety::Safe && matches!(context.kind(), Kind::Script | Kind::SvgScript) {
            return Ok(());
        }
        let options = FragmentOptions {
            allows_shadow_roots: true,
            starts_scripts,
            is_inert: sanitizer.is_some(),
        };
        let fragment = parse_html_fragment(cx, context, markup.chars(), self, options);
        if let Some(sanitizer) = sanitizer {
            sanitizer.sanitize(cx, fragment, safety);
        }
        let contents = self.as_element().map_or(&**self, |it| it.contents(cx));
        replace_all(cx, Some(fragment), contents);
        Ok(())
    }

    pub(crate) fn set_html<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        html: Str<'a>,
        options: &SetHTMLOptions<'a>,
    ) -> Result<'a> {
        self.set_and_filter(cx, html, options.sanitizer, Safety::Safe, false)
    }

    pub(crate) fn set_html_unsafe<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        html: JsLocal<'a>,
        options: &SetHTMLUnsafeOptions<'a>,
    ) -> Result<'a> {
        let html = Trusted::Html
            .string_for(
                cx,
                self,
                html,
                if self.is_element() {
                    "Element setHTMLUnsafe"
                } else {
                    "ShadowRoot setHTMLUnsafe"
                },
            )?
            .to_js(&cx.heap);
        self.set_and_filter(
            cx,
            html,
            options.sanitizer,
            Safety::Unsafe,
            options.run_scripts,
        )
    }
}

/// What is left may mean something else when it is parsed again.
pub(crate) fn without_scripts<'a>(
    cx: Cx<'_, 'a>,
    doc: &'a Doc,
    markup: &DomString,
) -> Result<'a, DomString> {
    const MAX_PASSES: usize = 16;
    let (context, everything) = (
        doc.template_contents_owner(cx)
            .create_html(&cx.heap, atom!("body")),
        cx.heap.create_empty_object().as_value(),
    );
    let (sanitizer, mut markup) = (
        sanitizer::from_option(cx, everything, Safety::Safe)?,
        markup.clone(),
    );
    for _ in 0..MAX_PASSES {
        let fragment = parse_html_fragment(
            cx,
            context,
            markup.chars(),
            context,
            FragmentOptions {
                is_inert: true,
                ..Default::default()
            },
        );
        sanitizer
            .iter()
            .for_each(|it| it.sanitize(cx, fragment, Safety::Safe));
        let before = core::mem::replace(&mut markup, serialize_inner(cx, fragment)?);
        if before == markup {
            return Ok(markup);
        }
    }
    Ok(DomString::default())
}

fn parse_and_filter<'a>(
    cx: Cx<'_, 'a>,
    markup: Str<'a>,
    sanitizer: JsLocal<'a>,
    safety: Safety,
) -> Result<'a, &'a Doc> {
    let (markup, sanitizer) = (
        DomString::from_js_string(&cx.heap, markup)?,
        sanitizer::from_option(cx, sanitizer, safety)?,
    );
    let doc = seams::current_document(cx)?.new_windowless(cx, Kind::HtmlDocument);
    doc.set_doc_flags(DocFlags::ALLOWS_SHADOW_ROOTS, true);
    parse_html_document(
        cx,
        doc,
        &markup,
        DocumentOptions {
            allows_shadow_roots: true,
            scripting: false,
        },
    )?;
    if let Some(sanitizer) = sanitizer {
        sanitizer.sanitize(cx, doc, safety);
    }
    Ok(doc)
}

impl Doc {
    pub(crate) fn parse_html<'a>(
        cx: Cx<'_, 'a>,
        html: Str<'a>,
        options: &SetHTMLOptions<'a>,
    ) -> Result<'a, &'a Doc> {
        parse_and_filter(cx, html, options.sanitizer, Safety::Safe)
    }

    pub(crate) fn parse_html_unsafe<'a>(
        cx: Cx<'_, 'a>,
        html: JsLocal<'a>,
        options: &SetHTMLOptions<'a>,
    ) -> Result<'a, &'a Doc> {
        let current = seams::current_document(cx)?;
        let html = Trusted::Html
            .string_for(cx, current, html, "Document parseHTMLUnsafe")?
            .to_js(&cx.heap);
        parse_and_filter(cx, html, options.sanitizer, Safety::Unsafe)
    }
}

impl DOMParser {
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: bindgen::ClassStructure<'a, Self>,
    ) -> Result<'a, &'a Self> {
        let doc = seams::current_document(cx)?;
        let parser = structure.create(&cx.heap, DOMParser::default());
        js_DOMParser::set_document(parser, Some(doc));
        Ok(parser)
    }

    pub(crate) fn parse_from_string<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        string: JsLocal<'a>,
        r#type: DOMParserSupportedType,
    ) -> Result<'a, &'a Doc> {
        let source = Trusted::Html.string_for(
            cx,
            js_DOMParser::document(self).expect("it was set"),
            string,
            "DOMParser parseFromString",
        )?;
        let of = js_DOMParser::document(self).expect("it was set");
        let doc = match r#type {
            DOMParserSupportedType::Html => of.new_windowless(cx, Kind::HtmlDocument),
            DOMParserSupportedType::TextXml => {
                of.new_xml_document(cx, Kind::XmlDocument, "text/xml")
            }
            DOMParserSupportedType::Xml => {
                of.new_xml_document(cx, Kind::XmlDocument, "application/xml")
            }
            DOMParserSupportedType::Xhtml => {
                of.new_xml_document(cx, Kind::XmlDocument, "application/xhtml+xml")
            }
            DOMParserSupportedType::Svg => {
                of.new_xml_document(cx, Kind::XmlDocument, "image/svg+xml")
            }
        };
        doc.set_url(of.url());
        doc.set_base_url(of.url());
        if doc.is_html_doc() {
            parse_html_document(cx, doc, &source, DocumentOptions::default())?;
        } else if let Err(message) = parse_xml_document(cx, doc, &source) {
            xml::report_error(cx, doc, &message);
        }
        Ok(doc)
    }
}

/// <https://xhr.spec.whatwg.org/#document-response>
pub(crate) fn parse_response<'a>(
    cx: Cx<'_, 'a>,
    of: &'a Doc,
    source: &DomString,
    content_type: &str,
    describe: impl FnOnce(&Doc),
) -> Result<'a, Option<&'a Doc>> {
    if content_type == "text/html" {
        let doc = of.new_windowless(cx, Kind::HtmlDocument);
        describe(doc);
        return parse_html_document(cx, doc, source, DocumentOptions::default())
            .map(|()| Some(doc));
    }
    let doc = of.new_xml_document(cx, Kind::XmlDocument, content_type);
    describe(doc);
    Ok(parse_xml_document(cx, doc, source).ok().map(|()| doc))
}

/// And its type.
pub(crate) fn serialize_document<'a>(
    cx: Cx<'_, 'a>,
    doc: &'a Doc,
) -> Result<'a, (DomString, &'static [u8])> {
    Ok(if doc.is_html_doc() {
        (serialize_inner(cx, doc)?, b"text/html")
    } else {
        (
            outer_xml(cx, doc, WellFormed::Optional)?,
            b"application/xml",
        )
    })
}

impl XMLSerializer {
    pub(crate) fn constructor() -> Self {
        Self::default()
    }

    pub(crate) fn serialize_to_string<'a>(
        &self,
        cx: Cx<'_, 'a>,
        root: &'a Node,
    ) -> Result<'a, Str<'a>> {
        Ok(outer_xml(cx, root, WellFormed::Optional)?.to_js(&cx.heap))
    }
}
