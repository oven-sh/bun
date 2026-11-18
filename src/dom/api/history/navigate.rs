//! <https://html.spec.whatwg.org/#navigate>

use super::*;
use crate::api::frames::Frame;
use crate::api::on_behalf::{allow_load, delay_load};
use crate::api::trusted;
use crate::api::uievents::{Modifiers, MouseEvent};

pub(super) use bun_web::host::Source;

#[derive(Clone)]
pub(super) struct Post {
    pub(super) form_data: Option<JSValue>,
    pub(super) sent: bun_web::host::Post,
}

/// The caller keeps the values alive.
#[derive(Clone, Default)]
pub(super) struct Options<'a> {
    pub(super) replace: bool,
    /// If this is the target.
    pub(super) replace_in: Option<&'a Window>,
    /// Even if the URL is the same.
    pub(super) push: bool,
    pub(super) source: Source,
    pub(super) element: Option<&'a Element>,
    pub(super) is_by_user: bool,
    pub(super) has_activation: bool,
    pub(super) has_text_activation: bool,
    pub(super) post: Option<Post>,
    pub(super) download: Option<DomString>,
    pub(super) navigation_state: Option<Serialized>,
    /// If it is another window.
    pub(super) initiator: Option<&'a Window>,
    pub(super) is_by_other_origin: bool,
    pub(super) srcdoc: Option<DomString>,
    /// What the element of the frame hears if a `javascript:` URL comes to nothing.
    pub(super) fires_load_otherwise: Option<bool>,
    pub(super) noopener: Option<bool>,
    pub(super) referrer_policy: Option<DomString>,
}

pub(super) fn is_self(target: &str) -> bool {
    target.is_empty() || target.eq_ignore_ascii_case("_self")
}

pub(super) fn is_above(target: &str) -> bool {
    target.eq_ignore_ascii_case("_parent") || target.eq_ignore_ascii_case("_top")
}

impl<'a> Options<'a> {
    pub(super) fn in_other_scope<'b>(self) -> Options<'b> {
        let [replace_in, initiator] =
            [self.replace_in, self.initiator].map(|it| Window::from_value(it?.to_js()));
        let Options {
            replace,
            push,
            source,
            is_by_user,
            has_activation,
            has_text_activation,
            post,
            download,
            navigation_state,
            is_by_other_origin,
            srcdoc,
            fires_load_otherwise,
            noopener,
            referrer_policy,
            ..
        } = self;
        let element = self.element.and_then(|it| Element::from_value(it.to_js()));
        Options {
            replace,
            replace_in,
            push,
            source,
            element,
            is_by_user,
            has_activation,
            has_text_activation,
            post,
            download,
            navigation_state,
            initiator,
            is_by_other_origin,
            srcdoc,
            fires_load_otherwise,
            noopener,
            referrer_policy,
        }
    }

    pub(super) fn follow_rel(&mut self, element: &'a Element) {
        let rel = element.attr(atom!("rel")).unwrap_or_default();
        let has = |keyword: &str| rel.tokens().any(|it| it.eq_ignore_ascii_case(keyword));
        if has("noreferrer") {
            self.referrer_policy = Some("no-referrer".into());
        }
        self.noopener = if has("noreferrer") || has("noopener") {
            Some(true)
        } else {
            has("opener").then_some(false)
        };
    }
}

impl History {
    pub(super) fn navigate<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        url: &str,
        mut options: Options<'a>,
        target: &str,
    ) {
        let window = self.window();
        if options.initiator.is_none() {
            options.has_activation = window.has_activation();
            options.has_text_activation =
                options.has_activation || window.host().arrival().has_text_activation;
        }
        if !is_self(target) && options.download.is_none() {
            let found = host::navigate_other(cx, window, target, Some(url), &options, false);
            if let host::Target::Window(_) = found {
                return;
            }
            if !is_above(target) {
                let is_detached = options.noopener.unwrap_or_else(|| {
                    matches!(found, host::Target::Unknown) || target.eq_ignore_ascii_case("_blank")
                });
                window.consume_activation(cx);
                host::open(
                    cx,
                    window,
                    url,
                    target,
                    if is_detached { "noopener" } else { "" },
                    &options,
                );
                return;
            }
        }
        if window.is_unloading() || !self.is_active() {
            return;
        }
        self.navigations.update(|it| it + 1);
        let old = window.url();
        let is_by_same_origin = !options.is_by_other_origin;
        options.replace |= options
            .replace_in
            .is_some_and(|it| core::ptr::eq(it, window))
            || url == old && is_by_same_origin && !options.push
            || window.host().is_initial();
        if let Some(escaped) = url.strip_prefix("javascript:") {
            return self.run_javascript_url(cx, escaped, &options);
        }
        let is_plain =
            options.post.is_none() && options.download.is_none() && options.srcdoc.is_none();
        let (document, fragment) = split_fragment(url);
        let fragment = fragment.filter(|_| is_plain && document == split_fragment(&old).0);
        if fragment.is_none() {
            window.host().cancel_navigation();
        }
        let directive = fragment
            .and_then(|it| strings::index_of(it.as_bytes(), b":~:"))
            .map(|it| url.split_at(document.len() + 1 + it));
        let url = directive.map_or(url, |it| it.0);
        let state = options
            .navigation_state
            .clone()
            .or_else(|| fragment.and_then(|_| self.current().borrow().navigation_state.clone()));
        if let Some(navigation) = window
            .navigation()
            .filter(|_| is_by_same_origin || fragment.is_some())
        {
            let intent = Intent {
                state: state.clone(),
                is_by_user: options.is_by_user,
                form_data: options.post.as_ref().and_then(|it| it.form_data),
                download: options.download.clone(),
                element: options.element,
                ..Intent::new(
                    if options.replace {
                        NavigationType::Replace
                    } else {
                        NavigationType::Push
                    },
                    url,
                    fragment.is_some(),
                )
            };
            if !navigation.fire(cx, intent) {
                return;
            }
        }
        if fragment.is_none() {
            return self.leave(cx, url, &options);
        }
        Ui::of(window.document())
            .and_then(Ui::container)
            .into_iter()
            .for_each(|it| it.went_to_fragment(cx));
        self.commit(cx, url, options.replace, None, state);
        let event = PopStateEvent::new(window.realm(&cx.heap), JSValue::NULL);
        dispatch_now(cx, window, event);
        self.fire_hash_change(old, url.into());
        self.text_directives.replace(
            directive
                .filter(|_| is_by_same_origin)
                .map(|it| it.1[3..].into()),
        );
        self.scroll_to_fragment(cx, true);
    }

    fn leave<'a>(&'a self, cx: &mut Cx<'a>, url: &str, options: &Options<'a>) {
        if options.download.is_none() && self.window().host().may_unload() == Some(false) {
            self.abort_navigation(cx);
        } else if self.is_active() {
            host::navigate(self.window(), url, options, None);
        }
    }

    pub(super) fn abort_navigation<'a>(&'a self, cx: &mut Cx<'a>) {
        self.window()
            .navigation()
            .into_iter()
            .for_each(|it| it.abort(cx));
    }

    fn run_javascript_url<'a>(&'a self, cx: &mut Cx<'a>, escaped: &str, options: &Options<'a>) {
        let source =
            DomString::from_utf8(&lossy(&bun_web::url::percent_decode(escaped.as_bytes())));
        let (serial, opens) = (self.navigations.get(), self.opens.get());
        delay_load(cx, self.window().document());
        let fires_load_otherwise = options.fires_load_otherwise;
        queue_task(
            self.window(),
            [options
                .initiator
                .map_or(JSValue::UNDEFINED, |it| it.to_js())],
            move |cx, window, [initiator]| {
                let (initiator, container) = (
                    Window::from_value(initiator),
                    window.context().and_then(Context::container),
                );
                let give_up = |cx: &mut Cx<'_>| {
                    container
                        .map(|it| it.to_js())
                        .and_then(Frame::from_value)
                        .zip(fires_load_otherwise)
                        .into_iter()
                        .for_each(|(it, fires)| it.finished(cx, fires))
                };
                allow_load(cx, window.document());
                if serial != History::of(&cx.heap, window).navigations.get() {
                    return;
                }
                if opens != History::of(&cx.heap, window).opens.get() {
                    return give_up(cx);
                }
                let was_navigating = window.host().is_being_left();
                let source = trusted::source_of_javascript_url(cx, window.document(), source);
                let result = source.map_or(JSValue::UNDEFINED, |it| {
                    host::run_javascript_url(cx, window, &it, initiator)
                });
                if result.is_string_literal()
                    && !window.is_in(Phase::ABOUT_TO_SUBMIT)
                    && (was_navigating || !window.host().is_being_left())
                {
                    let markup = DomString::from_js(cx, JsLocal::new(&cx.heap, result))
                        .map_err(|it| cx.catch(it))
                        .unwrap_or_default();
                    host::navigate(
                        window,
                        &window.url(),
                        &Options {
                            replace: true,
                            initiator,
                            ..Default::default()
                        },
                        Some(markup.to_utf8().into_owned()),
                    );
                } else {
                    give_up(cx);
                }
            },
        );
        if let Some(around) = Ui::of(self.window().document())
            .and_then(Ui::container)
            .and_then(|it| Window::of(it.around().doc()))
        {
            delay_load(cx, around.document());
            queue_task(around, [around.document().to_js()], |cx, _, [doc]| {
                Doc::from_value(doc)
                    .into_iter()
                    .for_each(|it| allow_load(cx, it))
            });
        }
    }

    pub(super) fn reload<'a>(&'a self, cx: &mut Cx<'a>, state: Option<Serialized>) {
        let window = self.window();
        if window.is_unloading() || !self.is_active() {
            return;
        }
        let (entry, url) = (self.current().borrow().clone(), window.url());
        let intent = Intent {
            state: state.clone().or_else(|| entry.navigation_state.clone()),
            ..Intent::new(NavigationType::Reload, &url, false)
        };
        if window.navigation().is_some_and(|it| !it.fire(cx, intent)) {
            return;
        }
        if state.is_some() {
            window.host().history_changed(
                HistoryEntry {
                    navigation_state: state,
                    ..entry
                },
                HistoryChange::Update,
            );
        }
        if window.host().may_unload() == Some(false) {
            return self.abort_navigation(cx);
        }
        window.host().reload();
    }
}

/// <https://html.spec.whatwg.org/#get-an-element's-target>
pub(crate) fn target_of_base(doc: &Doc) -> Option<DomString> {
    doc.elements_with_objects()
        .filter(|it| it.is_html(atom!("base")))
        .find_map(|it| it.attr(atom!("target")))
}

pub(super) fn without_dangling_markup(target: DomString) -> DomString {
    let has = |any: &[u8]| {
        target
            .units()
            .any(|it| u8::try_from(it).is_ok_and(|it| strings::contains_char(any, it)))
    };
    if has(b"\t\n\r") && has(b"<") {
        "_blank".into()
    } else {
        target
    }
}

/// <https://html.spec.whatwg.org/#following-hyperlinks-2>
fn follow_link<'a>(cx: &mut Cx<'a>, link: &'a Element, event: &'a Event, _: &'a Node, _: JSValue) {
    let href = link
        .attr(atom!("href"))
        .or_else(|| link.attr_ns(&Ns::XLink, &Atom::of(atom!("href"))));
    let (Some(href), Some(window)) = (
        href,
        link.doc().window().and_then(|it| it.downcast::<Window>()),
    ) else {
        return;
    };
    if looks_like(cx, link, Looks::EDITABLE) || link.is_html(atom!("area")) && !link.is_connected()
    {
        return;
    }
    let Some(url) = window.resolve(cx, &href) else {
        return;
    };
    let opening = Modifiers::SHIFT
        | if IS_MAC {
            Modifiers::META
        } else {
            Modifiers::CONTROL
        };
    let opens_window = event.is_trusted()
        && event
            .downcast::<MouseEvent>()
            .is_some_and(|it| it.modifiers().intersects(opening));
    let target = if opens_window {
        "_blank".into()
    } else {
        without_dangling_markup(
            link.attr(atom!("target"))
                .filter(|it| !it.is_empty())
                .or_else(|| target_of_base(link.doc()))
                .unwrap_or_default(),
        )
    };
    let referrer_policy = link
        .attr(atom!("referrerpolicy"))
        .map(|it| it.to_ascii_lowercase());
    let mut options = Options {
        source: Source::Link,
        element: Some(link),
        is_by_user: event.is_trusted(),
        download: link.attr(atom!("download")),
        referrer_policy,
        ..Default::default()
    };
    options.follow_rel(link);
    for ping in link.attr(atom!("ping")).unwrap_or_default().tokens() {
        window
            .resolve(cx, &ping)
            .into_iter()
            .for_each(|it| window.host().ping(it, url.clone()));
    }
    let history = History::of(&cx.heap, window);
    if !url.starts_with("javascript:")
        && options.download.is_none()
        && !matches!(split_fragment(&url), (document, Some(_)) if !is_self(&target.to_utf8()) || document == split_fragment(&window.url()).0)
    {
        history.planned.forget(&target);
    }
    history.navigate(cx, &url, options, &target.to_utf8());
}

pub(crate) static LINK_STEPS: Steps = Steps {
    activate: Some(follow_link),
    ..Steps::NONE
};
