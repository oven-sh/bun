//! The markup that a document was loaded from, and the inline scripts that may run.

use bun_web::csp::Inline;

use super::*;
use crate::api::markup::parse_xml_document;
use crate::name::Set;

type Found = HashMap<DomString, ()>;

#[derive(Default)]
struct Source {
    /// What was not looked at yet. The parser at `Edge::SourceParser` has had what came before.
    unread: RefCell<Vec<DomString>>,
    scripts: RefCell<Found>,
    goes_on: Cell<bool>,
}

pub(super) fn remember(heap: &JsHeap<'_>, doc: &Doc, markup: &DomString) {
    let source = doc.extra::<Source>();
    source.unread.take();
    source.scripts.take();
    doc.clear_edge(heap, Edge::SourceParser);
    remember_more(heap, doc, markup);
}

pub(super) fn remember_more(heap: &JsHeap<'_>, doc: &Doc, markup: &DomString) {
    if !doc
        .client(heap)
        .is_some_and(|it| it.has_restricted_scripts())
    {
        doc.extra::<Source>()
            .unread
            .borrow_mut()
            .push(markup.clone());
    }
}

pub(super) fn set_goes_on(heap: &JsHeap<'_>, doc: &Doc, goes_on: bool) {
    let source = doc.extra::<Source>();
    source.goes_on.set(goes_on);
    if !goes_on && source.unread.borrow().is_empty() {
        doc.clear_edge(heap, Edge::SourceParser);
    }
}

fn is_script(node: &Node) -> bool {
    matches!(node.kind(), Kind::Script | Kind::SvgScript)
}

#[optimize(size)]
fn collect_one(element: &Element, is_open: bool, found: &mut Found) {
    const SCHEME: &str = "javascript:";
    if is_script(element) && !is_open && scripts::Type::of(element).is_some() {
        found.insert(element.child_text_content(), ());
    }
    for (name, value) in element.attrs() {
        if name.local.as_utf8().starts_with("on") {
            found.insert(value, ());
        } else if name.local.known() == atom!("href")
            && value
                .prefix(value.len().min(SCHEME.len() as u32))
                .eq_str(SCHEME)
        {
            found.insert(
                value.substring(SCHEME.len() as u32, value.len() - SCHEME.len() as u32),
                (),
            );
        } else if name.local.known() == atom!("content")
            && element.kind() == Kind::Meta
            && element.parent().is_some_and(|it| it.kind() == Kind::Head)
        {
            found.insert(DomString::concat(&[&"\0".into(), &value]), ());
        }
    }
}

#[optimize(size)]
fn collect<'a>(cx: Cx<'_, 'a>, root: &'a Node, found: &mut Found) {
    let mut roots = vec![root];
    while let Some(root) = roots.pop() {
        for element in root.inclusive_descendants().filter_map(Node::as_element) {
            roots.extend(element.template_contents(cx).map(|it| &**it));
            collect_one(element, false, found);
        }
    }
}

/// With `prunes`, only that is left of the tree which the parser may come back to.
#[optimize(size)]
fn collect_from_parser<'a>(
    cx: Cx<'_, 'a>,
    parser: &'a DocumentParser,
    prunes: bool,
    found: &mut Found,
) {
    let (mut needed, mut parents) = (Set::default(), Vec::new());
    for node in parser.kept_nodes() {
        let mut up = Some(node);
        while let Some(at) = up.filter(|it| needed.insert(it.id())) {
            up = at
                .parent()
                .or_else(|| at.as_fragment()?.edge_node(Edge::Host));
            parents.push(at);
        }
    }
    for parent in parents {
        let element = parent.as_element();
        element.inspect(|it| collect_one(it, is_script(it) && parser.is_open(it), found));
        let contents = element
            .and_then(|it| it.template_contents(cx))
            .map(|it| &**it)
            .filter(|it| !needed.contains(&it.id()));
        for parent in core::iter::once(parent).chain(contents) {
            let mut next = parent.first_child();
            while let Some(child) = next {
                next = child.next_sibling();
                if needed.contains(&child.id()) {
                    continue;
                }
                collect(cx, child, found);
                if prunes && !(is_script(parent) && child.as_text().is_some()) {
                    remove(cx, child, Observers::Suppress);
                }
            }
        }
    }
}

/// The parser is never told of the end, so that the start of a script does not pass for one.
#[optimize(size)]
fn read_html<'a>(
    cx: Cx<'_, 'a>,
    doc: &'a Doc,
    pieces: &[DomString],
    goes_on: bool,
    found: &mut Found,
) {
    let parser = doc
        .edge(Edge::SourceParser)
        .and_then(|it| DocumentParser::from_js(&cx.heap, it))
        .unwrap_or_else(|| {
            let copy = doc.new_windowless(cx, Kind::HtmlDocument);
            DocumentParser::for_copy(&cx.heap, copy)
        });
    match goes_on {
        true => doc.set_edge(&cx.heap, Edge::SourceParser, parser.to_js()),
        false => doc.clear_edge(&cx.heap, Edge::SourceParser),
    }
    pieces.iter().for_each(|it| parser.write(it));
    parser.run_on_copy(cx);
    collect_from_parser(cx, parser, goes_on, found);
    parser.to_js().ensure_still_alive();
}

/// Whether it was in the markup, as opposed to put into the document since: a script, an event handler, a `javascript:` URL, or
/// after a null character a policy.
#[optimize(size)]
pub(crate) fn came_with<'a>(cx: Cx<'_, 'a>, doc: &'a Doc, script: &DomString) -> bool {
    let owner = core::iter::successors(Some(doc), |it| {
        it.edge_node(Edge::SourceOwner).map(Node::doc)
    })
    .last()
    .unwrap_or(doc);
    let source = owner.extra::<Source>();
    let pieces = source.unread.take();
    if let Some(first) = pieces.first() {
        let mut found = source.scripts.take();
        if owner.is_html_doc() {
            read_html(cx, owner, &pieces, source.goes_on.get(), &mut found);
        } else {
            let copy =
                owner.new_xml_document(cx, Kind::XmlDocument, &owner.content_type().to_utf8());
            // What comes before an error is there.
            let _ = parse_xml_document(cx, copy, first);
            collect(cx, copy, &mut found);
            copy.to_js().ensure_still_alive();
        }
        source.scripts.replace(found);
    }
    source.scripts.borrow().contains_key(script)
}

/// <https://w3c.github.io/webappsec-csp/#should-block-inline>
fn policy_allows(
    client: &Client,
    kind: Inline,
    element: &Element,
    text: &DomString,
    nonce: &[u8],
) -> bool {
    client.csp_allows_inline(kind, || text.to_utf8(), nonce, true, element.to_js(), None)
}

fn allows_script<'a>(
    cx: Cx<'_, 'a>,
    element: &'a Element,
    text: &DomString,
    policy_allows: impl FnOnce(&Client) -> bool,
) -> bool {
    let Some(client) = element.doc().client(&cx.heap) else {
        return false;
    };
    policy_allows(&client) && client.trusts_inline_script(|| came_with(cx, element.doc(), text))
}

/// `parsed_at`: if the parser has inserted it.
pub(super) fn allows_inline_script<'a>(
    cx: Cx<'_, 'a>,
    script: &'a Element,
    text: &DomString,
    parsed_at: Option<(u32, u32)>,
) -> bool {
    allows_script(cx, script, text, |it| {
        it.csp_allows_inline(
            Inline::Script,
            || text.to_utf8(),
            &scripts::nonce_of(script),
            parsed_at.is_some(),
            script.to_js(),
            parsed_at,
        )
    })
}

pub(crate) fn allows_handler_attribute<'a>(
    cx: Cx<'_, 'a>,
    element: &'a Element,
    text: &DomString,
) -> bool {
    !element.doc().has_page()
        || allows_script(cx, element, text, |it| {
            policy_allows(it, Inline::ScriptAttribute, element, text, b"")
        })
}

pub(super) fn allows_inline_style(heap: &JsHeap<'_>, style: &Element, text: &DomString) -> bool {
    style.doc().client(heap).is_some_and(|it| {
        policy_allows(&it, Inline::Style, style, text, &utf8(Some(style.nonce())))
    })
}

pub(crate) fn allows_style_attribute(
    heap: &JsHeap<'_>,
    element: &Element,
    text: &DomString,
) -> bool {
    !element.doc().has_page() || document_allows_style_attribute(heap, element.doc(), element, text)
}

pub(crate) fn allows_plugin_without_url(heap: &JsHeap<'_>, element: &Element) -> bool {
    let check = |it: Rc<Client>| {
        let verdict = it.policies().csp.check_plugin_without_url();
        it.enforce(verdict, element.to_js())
    };
    element.doc().client(heap).is_none_or(check)
}

pub(crate) fn document_allows_style_attribute(
    heap: &JsHeap<'_>,
    doc: &Doc,
    element: &Element,
    text: &DomString,
) -> bool {
    doc.client(heap)
        .is_none_or(|it| policy_allows(&it, Inline::StyleAttribute, element, text, b""))
}
