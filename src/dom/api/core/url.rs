//! URLs, as strings.

use bun_core::WTFStringImplStruct as Impl;
use bun_jsc::bindgen::{self, JsHeap, JsScope};
use bun_jsc::{JSGlobalObject, JSValue};

use super::DomString;
use super::gc::global_of;

/// The tables in DesktopDOM.cpp are in this order.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub(crate) enum Part {
    Protocol,
    Username,
    Password,
    Host,
    Hostname,
    Port,
    Pathname,
    Search,
    Hash,
}

unsafe extern "C" {
    safe fn Bun__DOM__parseURL(
        global: &JSGlobalObject,
        url: &Impl,
        base: Option<&Impl>,
    ) -> Option<DomString>;
    safe fn Bun__DOM__partOfURL(url: &Impl, part: Part) -> DomString;
    safe fn Bun__DOM__urlWithPart(url: &Impl, part: Part, value: &Impl) -> DomString;
    safe fn Bun__DOM__originOfURL(global: &JSGlobalObject, url: &Impl) -> JSValue;
}

/// What the URL parser has made.
#[derive(Clone)]
pub(crate) struct Url(DomString);

impl Url {
    pub(crate) fn parse(
        heap: &JsHeap<'_>,
        url: &DomString,
        base: Option<&DomString>,
    ) -> Option<Url> {
        Bun__DOM__parseURL(global_of(heap), url.as_impl(), base.map(DomString::as_impl)).map(Url)
    }

    pub(crate) fn from_href(href: DomString) -> Url {
        Url(href)
    }

    pub(crate) fn href(&self) -> &DomString {
        &self.0
    }

    pub(crate) fn into_href(self) -> DomString {
        self.0
    }

    /// As the getters of `URL` have it.
    pub(crate) fn part(&self, part: Part) -> DomString {
        Bun__DOM__partOfURL(self.0.as_impl(), part)
    }

    /// As the setters of `URL` leave it.
    pub(crate) fn with_part(&self, part: Part, value: &DomString) -> Url {
        Url(Bun__DOM__urlWithPart(
            self.0.as_impl(),
            part,
            value.as_impl(),
        ))
    }

    pub(crate) fn origin<'a>(&self, cx: &mut JsScope<'a>) -> bindgen::Result<'a, JSValue> {
        let global = cx.global();
        Ok(bun_jsc::call_zero_is_throw(global, || {
            Bun__DOM__originOfURL(global, self.0.as_impl())
        })?)
    }
}
