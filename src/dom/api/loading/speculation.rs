//! <https://html.spec.whatwg.org/#speculative-html-parsing>

use core::ops::ControlFlow::{self, Break, Continue};

use bun_web::client::preload_destination;

use super::links::{has_type, kind_of};
use super::scripts::Type;
use super::*;

struct Speculation<'a> {
    doc: &'a Doc,
    client: Rc<Client>,
    base: Url,
    has_base: bool,
    has_body: bool,
    hides_referrer: bool,
}

impl<'a> Speculation<'a> {
    fn resolve(&self, url: Option<DomString>) -> Option<Url> {
        self.doc
            .encoding()
            .parse_url(&url.filter(|it| !it.is_empty())?.to_utf8(), &self.base)
    }

    #[optimize(size)]
    fn fetch(
        &self,
        cx: Cx<'_, 'a>,
        element: &Element,
        url: Option<DomString>,
        destination: Destination,
        cors: Option<Cors>,
    ) {
        let Some(url) = self.resolve(url).filter(Url::is_http) else {
            return;
        };
        let mut request = request_for(
            &self.client,
            element,
            url,
            destination,
            cors_of(element).or(cors),
        );
        request.metadata.is_parser_inserted = true;
        let blocks_by_default = match element.kind() {
            Kind::Link => has_type(element, "stylesheet"),
            Kind::Script => {
                Type::of(element).is_some_and(|it| scripts::blocks_by_default(element, it))
                    || has_keyword(element, atom!("blocking"), "render")
            }
            _ => false,
        };
        request.blocks_rendering = blocks_by_default && !self.has_body;
        if self.hides_referrer && !element.has_attr(atom!("referrerpolicy")) {
            request.referrer_policy = ReferrerPolicy::NoReferrer;
        }
        start(
            self.doc.realm(&cx.heap),
            links::preload(Rc::clone(&self.client), self.doc, request),
        );
    }

    #[optimize(size)]
    fn visit_link(&self, cx: Cx<'_, 'a>, link: &'a Element) {
        let destination = if has_type(link, "stylesheet") {
            (!has_type(link, "alternate") && !link.has_attr(atom!("disabled")))
                .then_some(Destination::Style)
        } else if has_type(link, "preload") && !link.has_attr(atom!("imagesrcset")) {
            preload_destination(&kind_of(link), &utf8(link.attr(atom!("type"))))
                .filter(|it| *it != Destination::Empty)
        } else {
            None
        };
        if let Some(destination) =
            destination.filter(|_| self.doc.matches_media(link.attr(atom!("media"))))
        {
            self.fetch(cx, link, link.attr(atom!("href")), destination, None);
        }
    }

    /// What follows some of them may be fetched differently.
    #[optimize(size)]
    fn visit_meta(&mut self, meta: &Element) -> ControlFlow<()> {
        let is = |name, value: &str| {
            meta.with_attr(name, |it| it.eq_ignore_ascii_case(value)) == Some(true)
        };
        let is_about_referrer = is(atom!("name"), "referrer");
        self.hides_referrer |= is_about_referrer;
        let has_effect = meta.has_attr(atom!("http-equiv"))
            && !is(atom!("http-equiv"), "content-type")
            && !is(atom!("http-equiv"), "content-language");
        if has_effect || (is_about_referrer && !is(atom!("content"), "no-referrer")) {
            Break(())
        } else {
            Continue(())
        }
    }

    #[optimize(size)]
    fn visit(&mut self, cx: Cx<'_, 'a>, element: &'a Element) -> ControlFlow<()> {
        match element.kind() {
            Kind::SvgImage => self.fetch(
                cx,
                element,
                crate::api::svg::href(element),
                Destination::Image,
                None,
            ),
            Kind::SvgScript => self.fetch(
                cx,
                element,
                crate::api::svg::href(element),
                Destination::Script,
                None,
            ),
            Kind::Image
                if element.with_attr(atom!("loading"), |it| it.eq_ignore_ascii_case("lazy"))
                    != Some(true) =>
            {
                let source = crate::api::images::selected_url(cx, element);
                self.fetch(cx, element, source, Destination::Image, None);
            }
            // Its document has no environment to ask.
            Kind::Source if !self.doc.matches_media(element.attr(atom!("media"))) => {
                element.remove_attr(cx, atom!("srcset"));
            }
            Kind::Video => self.fetch(
                cx,
                element,
                element.attr(atom!("poster")),
                Destination::Image,
                None,
            ),
            Kind::Script => match Type::of(element) {
                Some(Type::Module) => self.fetch(
                    cx,
                    element,
                    element.attr(atom!("src")),
                    Destination::Script,
                    Some(Cors::Anonymous),
                ),
                Some(Type::Classic) if !element.has_attr(atom!("nomodule")) => self.fetch(
                    cx,
                    element,
                    element.attr(atom!("src")),
                    Destination::Script,
                    None,
                ),
                _ => {}
            },
            Kind::Link => self.visit_link(cx, element),
            Kind::Base if !self.has_base && element.has_attr(atom!("href")) => {
                self.has_base = true;
                if let Some(it) = self.resolve(element.attr(atom!("href"))) {
                    self.base = it;
                }
            }
            Kind::Meta => return self.visit_meta(element),
            Kind::Body => self.has_body = true,
            _ => {}
        }
        Continue(())
    }
}

#[optimize(size)]
pub(super) fn speculate<'a>(
    cx: Cx<'_, 'a>,
    doc: &'a Doc,
    parser: &'a DocumentParser,
) -> Option<()> {
    let (client, base) = (
        doc.client(&cx.heap).filter(|it| it.allows_speculation())?,
        Url::parse(doc.base_url().to_utf8().as_bytes())?,
    );
    let rest = parser.speculate(cx)?;
    let has_base = doc
        .elements_with_objects()
        .any(|it| it.kind() == Kind::Base && it.has_attr(atom!("href")));
    let mut speculation = Speculation {
        doc,
        client,
        base,
        has_base,
        has_body: !allows_render_blockers(doc),
        hides_referrer: false,
    };
    rest.shadow_including_objects()
        .filter_map(Node::as_element)
        .try_for_each(|it| speculation.visit(cx, it))
        .break_value()
}
