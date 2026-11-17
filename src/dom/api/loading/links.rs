//! <https://html.spec.whatwg.org/#the-link-element>

use bun_web::client::{ScriptType, preload_destination};

use super::sheets::Owner;
use super::*;
use crate::api::core::metadata::icons_changed;
use crate::api::cssom;
use crate::api::history::indicated_element;

pub(super) fn has_type(link: &Node, keyword: &str) -> bool {
    if link.as_element().is_some() {
        return has_keyword(link, atom!("rel"), keyword);
    }
    keyword == "stylesheet"
        || (keyword == "alternate"
            && attribute(link, atom!("alternate")).is_some_and(|it| it.eq_str("yes")))
}

pub(super) fn kind_of(link: &Node) -> Vec<u8> {
    utf8(attribute(link, atom!("as"))).to_ascii_lowercase()
}

/// <https://html.spec.whatwg.org/#link-type-expect>
#[optimize(size)]
pub(super) fn is_expecting<'a>(cx: Cx<'_, 'a>, link: &'a Node) -> bool {
    let doc = link.doc();
    let Some(parser) = doc
        .parser(&cx.heap)
        .filter(|_| has_type(link, "expect") && doc.matches_media(attribute(link, atom!("media"))))
    else {
        return false;
    };
    let url = doc.resolve(cx, &attribute(link, atom!("href")).unwrap_or_default());
    let own = Url::parse(doc.url().to_utf8().as_bytes());
    let Some(url) =
        url.filter(|it| own.is_some_and(|own| own.without_fragment() == it.without_fragment()))
    else {
        return false;
    };
    url.fragment().is_some_and(|it| {
        indicated_element(doc, &bstr::ByteSlice::to_str_lossy(it))
            .is_none_or(|it| parser.is_open(it))
    })
}

fn update_expectation<'a>(cx: Cx<'_, 'a>, link: &'a Node) {
    if link.doc().is_fully_active() && is_expecting(cx, link) {
        block_rendering(&cx.heap, link);
    }
}

#[optimize(size)]
fn announce(link: &Node, has_arrived: impl Future<Output = bool> + 'static) {
    let (anchor, hint) = (
        Anchor::new(link.doc(), link.to_js()),
        Owner::of(link).hint.borrow().clone(),
    );
    spawn_for(link.doc(), async move {
        let name = if has_arrived.await {
            atom!("load")
        } else {
            atom!("error")
        };
        let announcing = anchor.in_task(Box::new(move |cx, _, link| {
            Node::from_js(&cx.heap, link)
                .filter(|it| *Owner::of(it).hint.borrow() == hint)
                .map(|it| fire(cx, it, name, EventInit::default()));
        }));
        announcing.await;
    });
}

/// It is parsed when it arrives. Whether it does.
#[optimize(size)]
pub(super) fn preload(
    client: Rc<Client>,
    doc: &Doc,
    request: Request,
) -> impl Future<Output = bool> + use<> {
    let (anchor, is_quirky) = (
        (request.destination == Destination::Style).then(|| Anchor::new(doc, JSValue::UNDEFINED)),
        doc.quirks(),
    );
    async move {
        let Some(resource) = client.load(request, Purpose::Preload, is_quirky).await else {
            return false;
        };
        if let Some(anchor) = anchor {
            anchor
                .soon(move |_, doc, _| {
                    doc.engine(|engine, _| engine.prepare_sheet_from_utf8(&resource.bytes))
                })
                .await;
        }
        true
    }
}

#[optimize(size)]
fn module_type(kind: &[u8]) -> Option<ScriptType> {
    match kind {
        b"" | b"script" | b"worker" | b"sharedworker" | b"serviceworker" | b"audioworklet"
        | b"paintworklet" => Some(ScriptType::JavaScriptModule),
        b"json" => Some(ScriptType::JsonModule),
        b"style" => Some(ScriptType::CssModule),
        b"text" => Some(ScriptType::TextModule),
        _ => None,
    }
}

fn is_css(link: &Node) -> bool {
    let given = utf8(attribute(link, atom!("type")));
    given.is_empty()
        || strings::split(&given, b";")
            .next()
            .is_some_and(|it| it.trim_ascii_end().eq_ignore_ascii_case(b"text/css"))
}

#[optimize(size)]
pub(super) fn update<'a>(cx: Cx<'_, 'a>, link: &'a Node) {
    let (it, doc) = (Owner::of(link), link.doc());
    let (serial, last_hint) = (it.restart(), it.hint.take());
    let Some(client) = doc
        .client(&cx.heap)
        .filter(|_| doc.is_fully_active() && link.is_connected())
    else {
        return;
    };
    let kind = kind_of(link);
    let with_set = link
        .as_element()
        .filter(|it| kind == b"image" && it.has_attr(atom!("imagesrcset")));
    let href = with_set.map_or_else(
        || attribute(link, atom!("href")),
        |it| crate::api::images::preload_url(cx, it),
    );
    let Some(url) = href
        .filter(|it| !it.is_empty())
        .and_then(|it| doc.resolve(cx, &it))
    else {
        return cssom::remove_sheet(cx, link);
    };
    let is_alternate = has_type(link, "alternate");
    let is_named = !is_alternate
        || it.is_explicitly_enabled.get()
        || attribute(link, atom!("title")).is_some_and(|it| !it.is_empty());
    if has_type(link, "stylesheet")
        && is_css(link)
        && is_named
        && attribute(link, atom!("disabled")).is_none()
    {
        if !is_alternate {
            sheets::note_title(cx, link);
        }
        return sheets::load_linked(cx, link, client, url, serial);
    }
    cssom::remove_sheet(cx, link);
    if has_type(link, "icon")
        && client.csp_allows_request(&url, Destination::Image, &Default::default(), None)
    {
        icons_changed(cx, doc);
    }
    let matches_media = || doc.matches_media(attribute(link, atom!("media")));
    let is_new = |hint: &[&[u8]]| {
        it.hint.replace(hint.join(&b'\n').into());
        *it.hint.borrow() != last_hint
    };
    if has_type(link, "modulepreload") {
        if matches_media() && is_new(&[b"modulepreload", &kind, url.href()]) {
            let fetching = modules::Fetching {
                is_for_link: true,
                is_parser_inserted: it.is_parser_inserted.get(),
                ..scripts::fetching_of(link)
            };
            let loading = module_type(&kind)
                .filter(|_| doc.has_realm(&cx.heap) && !doc.is_of_program())
                .map(|it| modules::preload(doc.realm(&cx.heap), &url, it, fetching));
            announce(link, async {
                if let Some(loading) = loading {
                    loading.await
                } else {
                    false
                }
            });
        }
    } else if has_type(link, "preload") {
        if let Some(destination) = preload_destination(&kind, &utf8(attribute(link, atom!("type"))))
            .filter(|_| matches_media())
        {
            let mut request = request_for(&client, link, url, destination, cors_of(link));
            request.metadata.integrity = utf8(attribute(link, atom!("integrity")));
            request.metadata.is_parser_inserted = it.is_parser_inserted.get();
            if is_new(&[b"preload", &preload_key(&request)]) {
                announce(link, preload(client, doc, request));
            }
        }
    } else if has_type(link, "prefetch") && is_new(&[b"prefetch", url.href()]) {
        let request = request_for(&client, link, url, Destination::Empty, cors_of(link));
        announce(link, async {
            client
                .load(request, Purpose::Prefetch, false)
                .await
                .is_some()
        });
    }
}

pub(crate) const LINK_STEPS: Steps = Steps {
    post_connection: Some(|cx, link, is_move| {
        if is_move {
            return cssom::owner_moved(cx, link, true);
        }
        sheets::is_inserted_by_parser(&cx.heap, link);
        update(cx, link);
        update_expectation(cx, link);
    }),
    removed: Some(|cx, link, _, is_move| sheets::owner_removed(cx, link, is_move)),
    attribute_changed: Some(|cx, link, change| {
        if change.is(atom!("disabled")) {
            Owner::of(link)
                .is_explicitly_enabled
                .set(change.new.is_none());
        }
        let matters = matches!(
            change.known(),
            atom!("as")
                | atom!("crossorigin")
                | atom!("disabled")
                | atom!("href")
                | atom!("imagesizes")
                | atom!("imagesrcset")
                | atom!("rel")
                | atom!("type")
        );
        let may_match_now = change.is(atom!("media"))
            && !has_type(link, "stylesheet")
            && Owner::of(link).hint.borrow().is_empty();
        if ((!sheets::describing_attribute_changed(cx, link, change) && matters) || may_match_now)
            && change.old != change.new
        {
            update(cx, link);
        }
        update_expectation(cx, link);
    }),
    ..Steps::NONE
};
