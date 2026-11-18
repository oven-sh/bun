//! <https://html.spec.whatwg.org/#the-style-element>, and what it shares with links.

use core::convert::Infallible;
use core::pin::Pin;

use super::*;
use crate::api::cssom::{self, CSSStyleSheet};

const MAX_IMPORTS: u32 = 1000;

#[derive(Default)]
pub(super) struct Owner {
    text: RefCell<Option<DomString>>,
    pub(super) is_parser_inserted: Cell<bool>,
    pub(super) is_explicitly_enabled: Cell<bool>,
    was_asked_for_sheet: Cell<bool>,
    /// What a link that is no style sheet has last fetched.
    pub(super) hint: RefCell<Bytes>,
    /// Changes when what is being loaded is no longer wanted.
    serial: Cell<u32>,
}

impl Owner {
    pub(super) fn of(node: &Node) -> &Owner {
        node.extra()
    }

    pub(super) fn restart(&self) -> u32 {
        self.serial.update(|it| it.wrapping_add(1));
        self.serial.get()
    }
}

pub(super) fn still_wanted<'a>(heap: &JsHeap<'a>, node: JSValue, serial: u32) -> Option<&'a Node> {
    Node::from_js(heap, node).filter(|it| Owner::of(it).serial.get() == serial)
}

fn set_sheet<'a>(cx: Cx<'_, 'a>, node: &'a Node, sheet: &'a CSSStyleSheet) {
    let title = attribute(node, atom!("title")).unwrap_or_default();
    cssom::add_sheet(
        cx,
        node,
        sheet,
        &utf8(attribute(node, atom!("media"))),
        title,
        Owner::of(node).is_explicitly_enabled.get(),
    );
}

pub(super) fn note_title<'a>(cx: Cx<'_, 'a>, node: &'a Node) {
    if node.root().as_doc().is_some() {
        cssom::prefer_sheets_titled(
            cx,
            node.doc(),
            attribute(node, atom!("title")).unwrap_or_default(),
            false,
        );
    }
}

/// <https://drafts.csswg.org/css-syntax/#determine-the-fallback-encoding>
fn set_fetched<'a>(
    cx: Cx<'_, 'a>,
    doc: &'a Doc,
    sheet: &'a CSSStyleSheet,
    resource: &Resource,
    environment: Option<Encoding>,
) {
    let fallback = Encoding::declared_in_css(&resource.bytes)
        .or(environment)
        .unwrap_or_else(|| doc.encoding());
    cssom::sheet_fetched(cx, doc, sheet, resource, fallback);
}

/// <https://drafts.csswg.org/css-values-5/#request-url-modifiers>
#[optimize(size)]
pub(super) fn request_of_sheet(
    client: &Client,
    url: Url,
    destination: Destination,
    modifiers: &[u8],
) -> Request {
    let value = |name: &[u8]| {
        let mut all =
            strings::split(modifiers, b")").filter_map(|it| strings::split_once_char(it, b'('));
        Some(strings::trim(
            all.find(|it| it.0.trim_ascii().eq_ignore_ascii_case(name))?
                .1
                .trim_ascii(),
            b"\"",
        ))
    };
    let mut request = new_request(
        client,
        url,
        destination,
        value(b"cross-origin")
            .map(Cors::parse)
            .or_else(|| (destination == Destination::Font).then_some(Cors::Anonymous)),
        InitiatorType::Css,
    );
    request.metadata.integrity = value(b"integrity").unwrap_or_default().into();
    request.referrer_policy = value(b"referrer-policy")
        .and_then(|it| ReferrerPolicy::parse(&it.to_ascii_lowercase()))
        .unwrap_or_default();
    request
}

struct Import {
    sheet: Anchor,
    /// `None` if only what it imports has to follow.
    loading: Option<Receiver<Option<Resource>>>,
    encoding: Option<Encoding>,
}

/// What the imports of a sheet and theirs share.
struct Importing {
    budget: Cell<u32>,
    blocks_rendering: bool,
}

#[optimize(size)]
fn start_imports<'a>(
    cx: Cx<'_, 'a>,
    doc: &'a Doc,
    sheet: &'a CSSStyleSheet,
    Importing {
        budget,
        blocks_rendering,
    }: &Importing,
) -> Vec<Import> {
    let Some(client) = doc.client(&cx.heap) else {
        return Vec::new();
    };
    let requests: Vec<_> = cssom::update_imports(&cx.heap, doc, sheet, budget.get()).collect();
    budget.update(|it| it.saturating_sub(requests.len() as u32));
    let starting = requests.into_iter().map(|it| {
        let request = it.url.map(|url| {
            let mut request = request_of_sheet(&client, url, Destination::Style, &it.modifiers);
            request.blocks_rendering = *blocks_rendering;
            if let Some(referrer) = it.referrer {
                request.referrer = Some(referrer);
                request.referrer_policy = request
                    .referrer_policy
                    .or(it.referrer_policy)
                    .or(ReferrerPolicy::StrictOriginWhenCrossOrigin);
            }
            request
        });
        let (client, is_quirky) = (Rc::clone(&client), doc.quirks());
        let loading = (!it.is_loaded).then(|| {
            start_for(doc, async move {
                client.load(request?, Purpose::Use, is_quirky).await
            })
        });
        Import {
            sheet: Anchor::new(doc, it.sheet.to_js()),
            loading,
            encoding: it.encoding,
        }
    });
    starting.collect()
}

fn sheet<'a>(heap: &JsHeap<'a>, value: JSValue) -> &'a CSSStyleSheet {
    CSSStyleSheet::from_js(heap, value).expect("it was anchored as a sheet")
}

/// Whether all have arrived.
#[optimize(size)]
fn finish_imports(
    imports: Vec<Import>,
    importing: Rc<Importing>,
) -> Pin<Box<dyn Future<Output = bool>>> {
    let all = imports.into_iter().map(
        move |Import {
                  sheet: anchor,
                  loading,
                  encoding,
              }| {
            let importing = Rc::clone(&importing);
            async move {
                let resource = match loading {
                    Some(loading) => Some(loading.await??),
                    None => None,
                };
                let shared = Rc::clone(&importing);
                let next = anchor.soon(move |cx, doc, it| {
                    let sheet = sheet(&cx.heap, it);
                    if let Some(it) = resource {
                        set_fetched(cx, doc, sheet, &it, encoding);
                    }
                    start_imports(cx, doc, sheet, &shared)
                });
                finish_imports(next.await?, importing).await.then_some(())
            }
        },
    );
    let all = all
        .map(|it| async { Ok::<_, Infallible>(it.await) })
        .collect();
    Box::pin(async { exec::try_all(all).await.is_ok_and(|it| !it.contains(&None)) })
}

fn load_imports<'a>(
    cx: Cx<'_, 'a>,
    doc: &'a Doc,
    sheet: &'a CSSStyleSheet,
    blocks_rendering: bool,
) -> impl Future<Output = bool> + use<> {
    let importing = Rc::new(Importing {
        budget: Cell::new(MAX_IMPORTS),
        blocks_rendering,
    });
    finish_imports(start_imports(cx, doc, sheet, &importing), importing)
}

#[optimize(size)]
pub(crate) fn imports_changed<'a>(cx: Cx<'_, 'a>, doc: &'a Doc, changed: &'a CSSStyleSheet) {
    if !doc.is_fully_active() {
        return;
    }
    delay_load(doc);
    let (loading, anchor) = (
        load_imports(cx, doc, changed, false),
        Anchor::new(doc, changed.to_js()),
    );
    spawn_for(doc, async move {
        loading.await;
        anchor
            .soon(|cx, doc, it| {
                (
                    cssom::imports_loaded(cx, sheet(&cx.heap, it)),
                    allow_load(doc),
                )
            })
            .await;
    });
}

fn blocks_by_default(heap: &JsHeap<'_>, node: &Node) -> bool {
    let doc = node.doc();
    Owner::of(node).is_parser_inserted.get()
        && doc.parser(heap).is_some()
        && !links::has_type(node, "alternate")
        && doc.matches_media(attribute(node, atom!("media")))
}

fn blocks_rendering(heap: &JsHeap<'_>, node: &Node) -> bool {
    allows_render_blockers(node.doc())
        && (asks_to_block_rendering(node) || blocks_by_default(heap, node))
}

/// The first frame and the scripts of the parser wait for it.
fn block_on<'a>(
    cx: Cx<'_, 'a>,
    node: &'a Node,
    loading: impl Future<Output = Option<()>> + 'static,
) {
    block_on_boxed(cx, node, Box::pin(loading));
}

#[optimize(size)]
fn block_on_boxed<'a>(
    cx: Cx<'_, 'a>,
    node: &'a Node,
    loading: bun_web::exec::LocalFuture<'static, Option<()>>,
) {
    let doc = node.doc();
    let blocking =
        blocks_by_default(&cx.heap, node).then(|| Rc::clone(&doc.loading().blocking_sheets));
    blocking.iter().for_each(|it| it.add());
    delay_load(doc);
    block_rendering(&cx.heap, node);
    let anchor = Anchor::new(doc, node.to_js());
    spawn_for(doc, async move {
        loading.await;
        blocking.iter().for_each(|it| it.remove());
        anchor
            .soon(|cx, doc, node| (unblock_rendering(cx, doc, node), allow_load(doc)))
            .await;
    });
}

fn load_or_error(is_ok: bool) -> Known {
    if is_ok { atom!("load") } else { atom!("error") }
}

/// <https://html.spec.whatwg.org/#update-a-style-block>
#[optimize(size)]
fn update_style<'a>(cx: Cx<'_, 'a>, style: &'a Element) {
    let (it, doc) = (Owner::of(style), style.doc());
    let is_css = style
        .with_attr(atom!("type"), |it| {
            it.is_empty() || it.eq_ignore_ascii_case("text/css")
        })
        .unwrap_or(true);
    let text = (style.is_connected() && is_css).then(|| style.child_text_content());
    if text == *it.text.borrow()
        && !it.was_asked_for_sheet.take()
        && !cssom::sheet_of(&cx.heap, style).is_some_and(cssom::has_parsed_rules)
    {
        return;
    }
    it.text.replace(text.clone());
    let Some(text) = text else {
        return cssom::remove_sheet(cx, style);
    };
    if !text.is_empty()
        && doc.is_fully_active()
        && !source::allows_inline_style(&cx.heap, style, &text)
    {
        fire_later(doc, style, atom!("error"));
        return cssom::remove_sheet(cx, style);
    }
    if doc.is_fully_active() {
        note_title(cx, style);
    }
    let text = text.to_utf8();
    let made = cssom::create_sheet(
        &cx.heap,
        doc,
        text.as_bytes(),
        doc.base_url().to_utf8().as_bytes(),
    );
    set_sheet(cx, style, made);
    if !doc.is_fully_active() {
        return;
    }
    let serial = it.restart();
    if !strings::contains_char(text.as_bytes(), b'@') {
        return fire_later(doc, style, atom!("load"));
    }
    let blocks_rendering = blocks_rendering(&cx.heap, style);
    let (loading, anchor, made) = (
        load_imports(cx, doc, made, blocks_rendering),
        Anchor::new(doc, style.to_js()),
        Strong::create(made.to_js(), doc.global()),
    );
    block_on(cx, style, async move {
        let is_ok = loading.await;
        let finishing = anchor.soon(move |cx, doc, style| {
            cssom::imports_loaded(cx, sheet(&cx.heap, made.get()));
            if let Some(it) = still_wanted(&cx.heap, style, serial) {
                fire_later(doc, it, load_or_error(is_ok));
            }
        });
        finishing.await
    });
}

fn create_linked<'a>(
    cx: Cx<'_, 'a>,
    link: &'a Node,
    url: &Url,
    resource: Option<&Resource>,
) -> &'a CSSStyleSheet {
    let made = cssom::create_linked_sheet(
        &cx.heap,
        link.doc(),
        url.href(),
        &utf8(attribute(link, atom!("media"))),
    );
    if let Some(it) = resource {
        set_fetched(
            cx,
            link.doc(),
            made,
            it,
            Encoding::for_label(&utf8(attribute(link, atom!("charset")))),
        );
    }
    made
}

fn may_import(css: &[u8]) -> bool {
    !css.is_ascii()
        || strings::split(css, b"@")
            .skip(1)
            .any(|it| matches!(it.first(), Some(b'i' | b'I' | b'\\')))
}

/// <https://html.spec.whatwg.org/#link-type-stylesheet>
#[optimize(size)]
pub(super) fn load_linked<'a>(
    cx: Cx<'_, 'a>,
    link: &'a Node,
    client: Rc<Client>,
    url: Url,
    serial: u32,
) {
    let doc = link.doc();
    let mut request = request_for(
        &client,
        link,
        url.clone(),
        Destination::Style,
        cors_of(link),
    );
    request.metadata.is_parser_inserted = Owner::of(link).is_parser_inserted.get();
    let key = Bytes::from([&*preload_key(&request), &request.metadata.integrity].concat());
    let known = doc.loading().fetched_sheets.borrow().get(&key).cloned();
    let in_url = || {
        client
            .sheet_in_url(&request)
            .filter(|it| !may_import(&it.bytes))
    };
    if let Some(known) = known
        .filter(|_| client.may_reuse_for(&request))
        .or_else(in_url)
    {
        let made = create_linked(cx, link, &url, Some(&known));
        set_sheet(cx, link, made);
        return fire_later(doc, link, atom!("load"));
    }
    let blocks_rendering = blocks_rendering(&cx.heap, link);
    request.blocks_rendering = blocks_rendering;
    let (anchor, is_quirky) = (Anchor::new(doc, link.to_js()), doc.quirks());
    block_on(cx, link, async move {
        let resource = client.load(request, Purpose::Use, is_quirky).await;
        let parsing = anchor.soon(move |cx, doc, link| {
            let link = still_wanted(&cx.heap, link, serial)?;
            let made = create_linked(cx, link, &url, resource.as_ref());
            let imports = resource.map(|it| {
                if doc.ready_state() != ReadyState::Complete
                    && it.url == url
                    && !may_import(&it.bytes)
                {
                    doc.loading().fetched_sheets.borrow_mut().insert(key, it);
                }
                load_imports(cx, doc, made, blocks_rendering)
            });
            Some((Strong::create(made.to_js(), doc.global()), imports))
        });
        let (made, imports) = parsing.await??;
        let is_ok = match imports {
            Some(imports) => imports.await,
            None => false,
        };
        let finishing = anchor.soon(move |cx, doc, link| {
            let link = still_wanted(&cx.heap, link, serial)?;
            set_sheet(cx, link, sheet(&cx.heap, made.get()));
            fire_later(doc, link, load_or_error(is_ok));
            Some(())
        });
        finishing.await?
    });
}

#[optimize(size)]
pub(super) fn owner_removed<'a>(cx: Cx<'_, 'a>, node: &'a Node, is_move: bool) {
    if is_move {
        return cssom::owner_moved(cx, node, false);
    }
    Owner::of(node).restart();
    Owner::of(node).text.take();
    Owner::of(node).hint.take();
    cssom::remove_sheet(cx, node);
}

pub(super) fn is_inserted_by_parser(heap: &JsHeap<'_>, node: &Node) -> bool {
    let is_inserting = node
        .doc()
        .parser(heap)
        .is_some_and(DocumentParser::is_inserting);
    Owner::of(node).is_parser_inserted.set(is_inserting);
    is_inserting
}

/// False if it is neither `media` nor `title`.
#[optimize(size)]
pub(super) fn describing_attribute_changed<'a>(
    cx: Cx<'_, 'a>,
    owner: &'a Element,
    change: &AttrChange<'_>,
) -> bool {
    match change.known() {
        atom!("title") => cssom::retitle(&cx.heap, owner, &change.new.cloned().unwrap_or_default()),
        atom!("media") => cssom::sheet_of(&cx.heap, owner)
            .into_iter()
            .for_each(|it| cssom::set_media(cx, it, &utf8(change.new.cloned()))),
        _ => return false,
    }
    true
}

pub(crate) const STYLE_STEPS: Steps = Steps {
    post_connection: Some(|cx, style, is_move| {
        if is_move {
            cssom::owner_moved(cx, style, true);
        } else if !is_inserted_by_parser(&cx.heap, style) || !style.is_html(atom!("style")) {
            update_style(cx, style);
        }
    }),
    removed: Some(|cx, style, _, is_move| owner_removed(cx, style, is_move)),
    children_changed: Some(|cx, style, _| {
        if !(style.is_html(atom!("style")) && style.has(NodeFlags::BEING_PARSED)) {
            update_style(cx, style);
        }
    }),
    finished_parsing: Some(update_style),
    attribute_changed: Some(|cx, style, change| {
        if !describing_attribute_changed(cx, style, change) && change.is(atom!("type")) {
            update_style(cx, style);
        }
    }),
    ..Steps::NONE
};

/// It is no element, so that [`instruction_moved`] is called instead.
pub(crate) const INSTRUCTION_STEPS: Steps = Steps {
    parent_changed: Some(|_, _, _| {}),
    ..Steps::NONE
};

/// <https://drafts.csswg.org/cssom/#requirements-on-user-agents-implementing-the-xml-stylesheet-processing-instruction>
pub(crate) fn instruction_moved<'a>(cx: Cx<'_, 'a>, it: &'a Node, old_parent: Option<&'a Node>) {
    if !it.with_inert(|it| it.name.local.as_utf8() == "xml-stylesheet")
        || !old_parent
            .or_else(|| it.parent())
            .is_some_and(|it| it.as_doc().is_some())
    {
        return;
    }
    if old_parent.is_some() {
        owner_removed(cx, it, false)
    } else {
        links::update(cx, it)
    }
}

impl LinkStyle {
    pub(crate) fn get_sheet<'a>(&'a self, heap: &JsHeap<'a>) -> Option<&'a CSSStyleSheet> {
        Owner::of(self).was_asked_for_sheet.set(true);
        cssom::sheet_of(heap, self)
    }
}

impl OwnStyle {
    pub(crate) fn get_disabled<'a>(&'a self, cx: Cx<'_, 'a>) -> bool {
        cssom::sheet_of(&cx.heap, self).is_some_and(|it| it.get_disabled(cx))
    }

    pub(crate) fn set_disabled<'a>(&'a self, cx: Cx<'_, 'a>, value: bool) {
        cssom::sheet_of(&cx.heap, self).inspect(|it| it.set_disabled(cx, value));
    }
}
