//! Who keeps the client's JS object alive.

use core::marker::PhantomData;
use std::rc::Rc;

use bun_jsc::bindgen::JsWrapper;
use bun_jsc::{JSValue, JsCell, Strong, WrapperGuard};
use bun_ptr::RefPtr;
use bun_valkey::client::Attempt;

use super::JSValkeyClient;

/// The client's JS object, which something keeps alive for `'a`: the frame of a method call, or a [`Hold`].
#[derive(Copy, Clone)]
pub(crate) struct Object<'a>(JSValue, PhantomData<&'a ()>);

impl Object<'_> {
    pub(crate) fn to_js(self) -> JSValue {
        self.0
    }
}

impl<'a> From<JsWrapper<'a, JSValkeyClient>> for Object<'a> {
    fn from(this: JsWrapper<'a, JSValkeyClient>) -> Self {
        Self(this.to_js(), PhantomData)
    }
}

impl<'a> From<&'a WrapperGuard<'_, JSValkeyClient>> for Object<'a> {
    fn from(this: &'a WrapperGuard<'_, JSValkeyClient>) -> Self {
        Self(this.to_js(), PhantomData)
    }
}

/// Keeps the client and its object alive. Whatever will call back owns one.
pub(crate) struct Hold {
    /// The VM's teardown finalizes rooted objects too.
    pub(crate) client: RefPtr<JSValkeyClient>,
    object: Strong,
}

impl Hold {
    pub(crate) fn new(client: &JSValkeyClient, object: Object<'_>) -> Self {
        Self {
            client: client.ref_guard(),
            object: Strong::create(object.0, &client.global_object),
        }
    }

    pub(crate) fn object(&self) -> Object<'_> {
        Object(self.object.get(), PhantomData)
    }
}

/// From a dial until its close event.
pub(crate) struct Dial {
    pub(crate) hold: Rc<Hold>,
    pub(crate) attempt: Attempt,
    /// The error it failed with; none if it was only closed, by either side.
    pub(crate) failure: Option<Strong>,
}

/// The [`Dial`] of the open socket. It lends nothing: script can close the socket under an event.
#[derive(Default)]
pub(crate) struct SocketDial(JsCell<Option<Dial>>);

impl SocketDial {
    pub(crate) fn set(&self, dial: Dial) {
        self.0.set(Some(dial));
    }

    pub(crate) fn hold(&self) -> Option<Rc<Hold>> {
        Some(Rc::clone(&self.0.get().as_ref()?.hold))
    }

    pub(crate) fn fail(&self, error: Strong) {
        self.0.with_mut(|dial| {
            if let Some(dial) = dial {
                dial.failure = Some(error);
            }
        });
    }

    pub(crate) fn take(&self) -> Option<Dial> {
        self.0.take()
    }
}
