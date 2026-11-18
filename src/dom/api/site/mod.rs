//! What a site is, and what it may ask for.

mod cookies;
mod errors;
mod locks;
mod origin;
mod permissions;
mod reporting;

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_jsc::JSValue;
use bun_jsc::bindgen::{self, Callable, ClassStructure, JsHeap, JsInterface, JsLocal, JsScope};
use bun_web::client::Client;
use bun_web::held::Held;

pub(crate) use errors::{DerivedException, QuotaExceededError, quota_exceeded};
pub(crate) use locks::Lock;
pub(crate) use origin::DomOrigin;
pub(crate) use permissions::{Notification, PermissionStatus, fire_at_notification};
pub(crate) use reporting::{ReportingObserver, SecurityPolicyViolationEvent};

use crate::api::core::url::Url;
use crate::api::core::*;
use crate::api::events::{Event, EventInit, Trusted, WindowTarget, dispatch, event_init, fire};
use crate::api::realm::{Kept, client_of, queue_task, realm_of};
use crate::api::support::report_exception;
use crate::generated_bindgen::site::*;

type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Result<'a, T = ()> = bindgen::Result<'a, T>;

fn active_client<'a>(heap: &JsHeap<'a>, realm: &JsHeap<'a>) -> Result<'a, Rc<Client>> {
    client_of(realm).ok_or_else(|| {
        dom_error(
            heap,
            DomError::InvalidStateError,
            "The document is not active.",
        )
    })
}

fn client_with_origin<'a>(
    heap: &JsHeap<'a>,
    realm: &JsHeap<'a>,
    api: &str,
) -> Result<'a, Rc<Client>> {
    let client = active_client(heap, realm)?;
    if client.origin().is_opaque() {
        return Err(dom_error(
            heap,
            DomError::SecurityError,
            &format!("Access to the {api} API is denied in this context."),
        ));
    }
    Ok(client)
}

/// Queries are in UTF-8, whatever the encoding of the document.
fn parse_url(heap: &JsHeap<'_>, url: &DomString) -> Option<DomString> {
    let base = match WindowTarget::of_realm(heap).and_then(WindowTarget::doc) {
        Some(doc) => doc.base_url(),
        None => DomString::from_latin1(client_of(heap)?.url().href()),
    };
    Url::parse(heap, url, Some(&base)).map(Url::into_href)
}

fn text(bytes: &[u8]) -> DomString {
    let mut text = StringBuilder::with_capacity(bytes.len());
    for chunk in bytes.utf8_chunks() {
        text.push_str(chunk.valid());
        if !chunk.invalid().is_empty() {
            text.push_unit(0xfffd);
        }
    }
    text.finish()
}

fn frozen<'a>(
    heap: &JsHeap<'a>,
    values: impl IntoIterator<Item = JSValue, IntoIter: ExactSizeIterator>,
) -> Result<'a, JSValue> {
    Ok(heap
        .freeze_array(heap.create_array(values, |heap, it| Ok(JsLocal::new(heap, it)))?)?
        .to_js())
}

/// The objects that messages from outside are for, until their realms stop.
#[derive(Default)]
struct Addressees(RefCell<Vec<(u32, Held<Kept>)>>);

impl Addressees {
    fn add(&self, cx: Cx<'_, '_>, id: u32, object: JSValue) {
        let kept = Kept::new(cx, object);
        let mut all = self.0.borrow_mut();
        all.retain(|it| it.1.borrow().is_some());
        all.push((id, realm_of(&cx.heap).hold(kept)));
    }

    fn remove(&self, id: u32) {
        self.0.borrow_mut().retain(|it| it.0 != id);
    }

    fn queue_task(&self, id: u32, steps: impl for<'a> FnOnce(Cx<'_, 'a>, JsLocal<'a>) + 'static) {
        let found = self
            .0
            .borrow()
            .iter()
            .find(|it| it.0 == id)
            .map(|it| Rc::clone(&it.1));
        if let Some(kept) = found
            .as_ref()
            .map(|it| it.borrow())
            .as_ref()
            .and_then(|it| it.as_ref())
        {
            kept.queue_task(steps);
        }
    }
}

macro_rules! one_per_realm {
    ($realm:expr, $class:ident, $js:ident) => {{
        let realm = $realm;
        $class::of_realm(realm).unwrap_or_else(|| {
            let made = $js::create(realm, Default::default());
            made.set_of_realm(realm);
            made
        })
    }};
}
use one_per_realm;

impl NavigatorOfSite {
    pub(crate) fn get_permissions<'a>(&'a self, heap: &JsHeap<'a>) -> &'a Permissions {
        one_per_realm!(self.realm(heap), Permissions, js_Permissions)
    }

    pub(crate) fn get_locks<'a>(&'a self, heap: &JsHeap<'a>) -> &'a WebLockManager {
        one_per_realm!(self.realm(heap), WebLockManager, js_WebLockManager)
    }
}
