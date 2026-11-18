//! Markup for a copy of a document that is printed or saved.

use bun_jsc::bindgen::{self, JsScope};
use bun_markup::Text as Buffer;

use super::serialize::{
    for_paper, has_raw_text, is_void, push_attribute, push_comment, push_tag_name, push_text,
    push_value,
};
use crate::api::core::{NodeFlags as F, *};
use crate::api::{cssom, frames};
use crate::name::{Map, Set};
use bun_web::page::{Resource, printed_from};

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Purpose<'r> {
    Print,
    /// In which resources are known by their URLs.
    Archive,
    /// Beside a folder with the resources.
    Save(&'r str),
}

fn name_of_file(url: &str) -> String {
    let path = bun_web::url::Url::parse(url.as_bytes())
        .map(|it| bun_web::url::percent_decode(it.path()))
        .unwrap_or_default();
    let name = bun_ui::protocol::Text::lossy(
        bun_core::strings::tokenize(&path, b"/")
            .last()
            .unwrap_or_default(),
    );
    let name: String = name
        .chars()
        .take(100)
        .map(|it| {
            if it.is_alphanumeric() || matches!(it, '.' | '-') {
                it
            } else {
                '_'
            }
        })
        .collect();
    Some(name.trim_matches('.'))
        .filter(|it| !it.is_empty())
        .unwrap_or("saved_resource")
        .into()
}

/// What the markup refers to.
#[derive(Default)]
pub(crate) struct Parts {
    pub(crate) resources: Vec<Resource>,
    pub(crate) frames: Vec<(u32, String)>,
    names_of_urls: Map<String, String>,
    taken_names: Set<String>,
    listed: Set<(u32, String)>,
}

impl Parts {
    /// The name of the file.
    fn add(&mut self, page: u32, url: String, destination: &str) -> &str {
        let name = self.names_of_urls.entry(url.clone()).or_insert_with(|| {
            let name = name_of_file(&url);
            if self.taken_names.insert(name.to_lowercase()) {
                name
            } else {
                format!("({}){name}", self.resources.len())
            }
        });
        if self.listed.insert((page, url.clone())) {
            self.resources.push(Resource {
                page,
                url,
                destination: destination.into(),
                name: name.clone(),
            });
        }
        name
    }
}

struct Copier<'c, 'a> {
    cx: &'c mut JsScope<'a>,
    doc: &'a Doc,
    page: u32,
    purpose: Purpose<'c>,
    parts: &'c mut Parts,
    of_frames: Vec<(crate::tree::NodeId, DomString)>,
    out: Buffer,
}

fn destination_of(element: &Element, attribute: Known) -> Option<&'static str> {
    Some(match (element.html_tag(), attribute) {
        (atom!("img") | atom!("input"), atom!("src"))
        | (atom!("video"), atom!("poster"))
        | (atom!("body") | atom!("table") | atom!("td") | atom!("th"), atom!("background")) => {
            "image"
        }
        (atom!("script"), atom!("src")) => "script",
        (atom!("link"), atom!("href")) => {
            let kinds = element.attr(atom!("rel"))?.to_ascii_lowercase();
            kinds
                .tokens()
                .find_map(|it| {
                    if it.eq_str("stylesheet") {
                        Some("style")
                    } else {
                        it.eq_str("icon").then_some("image")
                    }
                })
                .unwrap_or("")
        }
        (atom!("a") | atom!("area"), atom!("href"))
        | (atom!("form"), atom!("action"))
        | (
            atom!("audio") | atom!("video") | atom!("source") | atom!("embed") | atom!("track"),
            atom!("src"),
        ) => "",
        (atom!("object"), atom!("data")) => "",
        _ => return None,
    })
}

impl<'a> Copier<'_, 'a> {
    fn is_left_out(&self, element: &Element) -> bool {
        match element.html_tag() {
            atom!("script") => !matches!(self.purpose, Purpose::Save(_)),
            atom!("noscript") => {
                !matches!(self.purpose, Purpose::Save(_)) && self.doc.is(DocFlags::HAS_PAGE)
            }
            atom!("meta") => {
                element.has_attr(atom!("charset")) || element.has_attr(atom!("http-equiv"))
            }
            atom!("base") => true,
            _ => false,
        }
    }

    fn place(&mut self, url: DomString, destination: &'static str) -> DomString {
        let Some(url) = self
            .doc
            .parse_url(self.cx, &url)
            .filter(|_| url.units().next() != Some(b'#'.into()))
            .map(|it| it.into_href())
        else {
            return url;
        };
        let text = url.to_utf8().into_owned();
        if destination.is_empty() || text.starts_with("data:") {
            return url;
        }
        let name = self.parts.add(self.page, text, destination);
        match self.purpose {
            Purpose::Save(folder) => DomString::from_utf8(&format!("./{folder}/{name}")),
            _ => url,
        }
    }

    /// Whether children and an end tag follow.
    fn start_tag(&mut self, element: &'a Element) -> bool {
        if element.has(F::STYLE_DIRTY) {
            element.flush_style(self.cx);
        }
        let mut changed = Vec::new();
        if let Some(markup) = self.of_frames.iter().find(|it| it.0 == element.id()) {
            changed.extend([
                (atom!("src"), None),
                (atom!("srcdoc"), Some(markup.1.clone())),
            ]);
        } else {
            changed.extend(
                [atom!("srcset"), atom!("integrity"), atom!("crossorigin")].map(|it| (it, None)),
            );
            for name in [
                atom!("src"),
                atom!("href"),
                atom!("poster"),
                atom!("background"),
                atom!("action"),
                atom!("data"),
            ] {
                if let Some((destination, url)) =
                    destination_of(element, name).zip(element.attr(name))
                {
                    changed.push((name, Some(self.place(url, destination))));
                }
            }
        }
        let out = &mut self.out;
        out.push_byte(b'<');
        element.arena().read(|engine| {
            let Some(own) = engine.tree.element(element.id()) else {
                return;
            };
            push_tag_name(out, own);
            for it in own.attributes.iter().filter(|it| it.is_visible()) {
                match changed
                    .iter()
                    .position(|new| it.space.is_none() && it.local == new.0)
                {
                    Some(at) => changed
                        .remove(at)
                        .1
                        .iter()
                        .for_each(|value| push_attribute(out, it, value)),
                    None => {
                        _ = engine
                            .script_value(element.id(), it, |value| push_attribute(out, it, value))
                    }
                }
            }
        });
        for (name, value) in changed.iter().filter_map(|it| Some((it.0, it.1.as_ref()?))) {
            out.push_byte(b' ');
            out.push_str(name.as_str());
            push_value(out, value);
        }
        out.push_byte(b'>');
        if element.is_html(atom!("head")) && element.root() == &**self.doc {
            out.push_str("<meta http-equiv=\"Content-Type\" content=\"text/html; charset=UTF-8\">");
        }
        !is_void(element.html_tag())
    }

    fn end_tag(&mut self, element: &'a Element) {
        self.out.push_str("</");
        element.arena().read(|engine| {
            engine
                .tree
                .element(element.id())
                .map(|it| push_tag_name(&mut self.out, it))
        });
        self.out.push_byte(b'>');
    }

    fn rules_of_scripts(&mut self, scope: &'a Node) {
        let rules = cssom::rules_without_markup(&self.cx.heap, scope);
        if !rules.is_empty() {
            let rules = bun_core::strings::split(&rules, b"</")
                .collect::<Vec<_>>()
                .join(&b"<\\/"[..]);
            [
                "<style>".into(),
                DomString::from_utf8(crate::values::text(&rules)).chars(),
                "</style>".into(),
            ]
            .into_iter()
            .for_each(|it| self.out.push(it));
        }
    }

    fn enter(&mut self, element: &'a Element) -> &'a Node {
        match element.shadow_root().filter(|it| !it.has(F::USER_AGENT)) {
            Some(root) => {
                self.out.push_str("<template shadowrootmode=\"open\">");
                root
            }
            None if element.kind() == Kind::Template => element.contents(self.cx),
            None => element,
        }
    }

    fn copy(&mut self) {
        let (mut parent, mut next): (&Node, _) = (self.doc, self.doc.first_child());
        loop {
            while let Some(node) = next {
                next = node.next_sibling();
                if let Some(text) = node.as_text() {
                    text.with_data(|it| {
                        push_text(&mut self.out, it, has_raw_text(parent, parent.html_tag()))
                    });
                } else if let Some(element) = node.as_element() {
                    if !self.is_left_out(element) && self.start_tag(element) {
                        parent = self.enter(element);
                        next = parent.first_child();
                    }
                } else if node.kind() == Kind::Comment {
                    node.with_inert(|it| push_comment(&mut self.out, &it.data));
                }
            }
            let Some(element) = parent
                .as_element()
                .or_else(|| parent.edge_node(Edge::Host)?.as_element())
            else {
                return;
            };
            if parent.has(F::SHADOW_ROOT) {
                self.rules_of_scripts(parent);
                self.out.push_str("</template>");
                (parent, next) = (element, element.first_child());
                continue;
            }
            if self.doc.body() == Some(element) {
                self.rules_of_scripts(self.doc);
            }
            self.end_tag(element);
            let Some(outer) = element.parent() else {
                return;
            };
            (parent, next) = (outer, element.next_sibling());
        }
    }
}

/// `page` is the one that fetches for `doc`.
pub(crate) fn snapshot<'a>(
    cx: &mut JsScope<'a>,
    doc: &'a Doc,
    page: u32,
    purpose: Purpose<'_>,
    parts: &mut Parts,
) -> bindgen::Result<'a, DomString> {
    let (mut in_frames, mut on_paper) = (Vec::new(), Vec::new());
    for (element, inner) in
        frames::entry::windows_in_this_process(doc).filter(|it| it.0.is_html(atom!("iframe")))
    {
        if let Some(apart) =
            frames::entry::page_apart_from(element).filter(|_| purpose == Purpose::Print)
        {
            on_paper.push((element.id(), DomString::from_utf8(&printed_from(apart))));
            continue;
        }
        let own = inner.map(|it| it.page).filter(|it| *it != 0);
        let markup = inner
            .map(|it| snapshot(cx, it.document(), own.unwrap_or(page), purpose, parts))
            .transpose()?
            .unwrap_or_default();
        match own.filter(|_| purpose == Purpose::Print) {
            Some(own) => {
                parts.frames.push((own, markup.to_utf8().into_owned()));
                on_paper.push((element.id(), DomString::from_utf8(&printed_from(own))));
            }
            None => in_frames.push((element.id(), markup)),
        }
    }
    if purpose == Purpose::Print {
        return for_paper(cx, doc, [&on_paper, &in_frames]);
    }
    let mut copier = Copier {
        cx,
        doc,
        page,
        purpose,
        parts,
        of_frames: in_frames,
        out: Buffer::default(),
    };
    if !doc.quirks() {
        copier.out.push_str("<!DOCTYPE html>");
    }
    let url = bun_core::strings::split(doc.url().to_utf8().as_bytes(), b"--")
        .map(crate::values::text)
        .collect::<Vec<_>>()
        .join("-%2D");
    copier.out.push_str(&format!(
        "\n<!-- saved from url=({:04}){url} -->\n",
        url.len()
    ));
    copier.copy();
    Ok(DomString::from_chars(copier.out.chars()))
}
