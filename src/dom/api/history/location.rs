//! <https://html.spec.whatwg.org/#the-location-interface>

use super::navigate::{Options, Source};
use super::*;
use crate::api::core::url::{Part, Url};
use crate::api::storage::DOMStringList;

/// The parts that have been asked for, and what they are of.
#[derive(Default)]
pub(crate) struct Location(RefCell<(DomString, [Option<DomString>; 9])>);

macro_rules! parts {
    ($($name:ident $part:ident)*) => {
        paste::paste! { impl Location {$(
            pub(crate) fn [<get_ $name>]<'a>(&'a self, _: &mut Cx<'a>) -> Result<'a, DomString> {
                Ok(self.part(Part::$part))
            }

            pub(crate) fn [<set_ $name>]<'a>(&'a self, cx: &mut Cx<'a>, value: DomString) -> Result<'a> {
                self.change(cx, Part::$part, value)
            }
        )*} }
    };
}
parts!(protocol Protocol host Host hostname Hostname port Port pathname Pathname search Search hash Hash);

fn starts_with_scheme(text: &DomString) -> bool {
    let mut units = text
        .units()
        .filter(|it| !matches!(it, 9 | 10 | 13))
        .take_while(|it| *it != b':'.into())
        .map(|it| u8::try_from(it).unwrap_or(0));
    units.next().is_some_and(|it| it.is_ascii_alphabetic())
        && units.all(|it| it.is_ascii_alphanumeric() || matches!(it, b'+' | b'.' | b'-'))
}

impl Location {
    pub(super) fn new<'a>(heap: &JsHeap<'a>, window: &'a Window) -> &'a Location {
        unsafe extern "C" {
            safe fn Bun__DOM__finishLocation(global: &bun_jsc::JSGlobalObject, location: JSValue);
        }
        let location = js_Location::create(window.realm(heap), Location::default());
        js_Location::set_window(location, window.to_js());
        Bun__DOM__finishLocation(global_of(window.realm(heap)), location.to_js());
        location
    }

    fn window(&self) -> &Window {
        js_Location::window(self)
            .and_then(Window::from_value)
            .expect("it is set first")
    }

    fn url(&self) -> Url {
        Url::from_href(if self.window().is_disposed() {
            Atom::of(atom!("about:blank")).to_dom_string()
        } else {
            self.window().document().url()
        })
    }

    fn part(&self, part: Part) -> DomString {
        let (url, mut known) = (self.url(), self.0.borrow_mut());
        if known.0 != *url.href() {
            *known = (url.href().clone(), Default::default());
        }
        known.1[part as usize]
            .get_or_insert_with(|| url.part(part))
            .clone()
    }

    fn go<'a>(&'a self, cx: &mut Cx<'a>, url: &str, replace: bool) -> Result<'a> {
        let (window, source) = (self.window(), host::caller(cx, self.window()));
        let options = Options {
            replace: replace || !window.is_in(Phase::COMPLETELY_LOADED) && !source.has_activation(),
            source: Source::Script,
            ..Default::default()
        };
        if core::ptr::eq(source, window) {
            History::of(&cx.heap, window).navigate(cx, url, options, "");
        } else if !window
            .context()
            .filter(|_| window.cluster().is_some_and(|it| it.has(source)))
            .is_some_and(|it| host::navigate_from(it, source, url, &options))
        {
            return Err(dom_error(
                &cx.heap,
                DomError::SecurityError,
                "The current window does not have permission to navigate the target frame.",
            ));
        }
        Ok(())
    }

    fn go_to<'a>(&'a self, cx: &mut Cx<'a>, url: &DomString, replace: bool) -> Result<'a> {
        if self.window().is_disposed() {
            return Ok(());
        }
        match host::caller(cx, self.window()).resolve(cx, url) {
            Some(resolved) => self.go(cx, &resolved, replace),
            None => Err(cx.heap.dom_exception(
                DomError::SyntaxError,
                format_args!("'{}' is not a valid URL.", url.to_utf8()),
            )),
        }
    }

    fn change<'a>(&'a self, cx: &mut Cx<'a>, part: Part, value: DomString) -> Result<'a> {
        if self.window().is_disposed() {
            return Ok(());
        }
        if part == Part::Protocol && !starts_with_scheme(&value) {
            return Err(cx.heap.dom_exception(
                DomError::SyntaxError,
                format_args!("'{}' is an invalid protocol.", value.to_utf8()),
            ));
        }
        let url = self.url();
        let has_host = !url.part(Part::Host).is_empty();
        let has_opaque_path =
            !has_host && url.part(Part::Pathname).units().next() != Some(b'/'.into());
        if has_opaque_path && !matches!(part, Part::Hash | Part::Search | Part::Protocol)
            || part == Part::Port && (!has_host || url.part(Part::Protocol).eq_str("file:"))
        {
            return Ok(());
        }
        let changed = url.with_part(
            part,
            &if part == Part::Hash && value.is_empty() {
                "#".into()
            } else {
                value
            },
        );
        let goes = match part {
            Part::Protocol => matches!(changed.part(part).ascii(), Some("http:" | "https:")),
            Part::Hash => changed.part(part) != url.part(part),
            _ => true,
        };
        if goes {
            self.go(cx, &changed.href().to_utf8(), false)
        } else {
            Ok(())
        }
    }

    pub(crate) fn get_ancestor_origins<'a>(&'a self, cx: &mut Cx<'a>) -> JSValue {
        let is_active = !self.window().is_disposed();
        let known = if is_active {
            js_Location::origins(self)
        } else {
            js_Location::no_origins(self)
        };
        known.unwrap_or_else(|| {
            let origins = if is_active {
                self.window().host().ancestor_origins()
            } else {
                Vec::new()
            };
            let list = DOMStringList::new(
                self.realm(&cx.heap),
                origins.iter().map(|it| DomString::from_utf8(it)).collect(),
            )
            .to_js();
            if is_active {
                js_Location::set_origins(self, list)
            } else {
                js_Location::set_no_origins(self, list)
            }
            list
        })
    }

    pub(crate) fn get_href<'a>(&'a self, _: &mut Cx<'a>) -> Result<'a, DomString> {
        Ok(self.url().into_href())
    }

    pub(crate) fn set_href<'a>(&'a self, cx: &mut Cx<'a>, url: &DomString) -> Result<'a> {
        self.go_to(cx, url, false)
    }

    pub(crate) fn get_origin<'a>(&'a self, cx: &mut Cx<'a>) -> Result<'a, JSValue> {
        if self.part(Part::Protocol).eq_str("about:") {
            Ok(DomString::from("null").to_js(&cx.heap).to_js())
        } else {
            self.url().origin(cx)
        }
    }

    pub(crate) fn assign<'a>(&'a self, cx: &mut Cx<'a>, url: &DomString) -> Result<'a> {
        self.go_to(cx, url, false)
    }

    pub(crate) fn replace<'a>(&'a self, cx: &mut Cx<'a>, url: &DomString) -> Result<'a> {
        self.go_to(cx, url, true)
    }

    pub(crate) fn reload<'a>(&'a self, cx: &mut Cx<'a>) {
        History::of(&cx.heap, self.window()).reload(cx, None);
    }
}
