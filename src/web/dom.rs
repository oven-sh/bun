//! What the DOM does for the host of a page. The values are those of `realm`.

use bun_jsc::{JSGlobalObject, JSValue};

use crate::channel::{Endpoint, Message};
use crate::net::embedder::ClientId;

#[derive(Clone, Copy)]
pub struct Sender<'a> {
    pub origin: &'a [u8],
    /// Which opaque origin it is.
    pub token: &'a [u8],
    pub window: JSValue,
}

unsafe extern "Rust" {
    /// What the Content Security Policy says about strings that become code.
    #[link_name = "__bun_dom_apply_policy"]
    pub safe fn apply_policy(realm: &JSGlobalObject, is_for_new_document: bool);
    /// As if the user had pressed something.
    #[link_name = "__bun_dom_activate"]
    pub safe fn activate(realm: &JSGlobalObject, window: JSValue);
    #[link_name = "__bun_dom_adopt_port"]
    pub safe fn adopt_port(realm: &JSGlobalObject, port: Endpoint) -> JSValue;
    #[link_name = "__bun_dom_release_port"]
    pub safe fn release_port(realm: &JSGlobalObject, port: JSValue) -> Option<Endpoint>;
    #[link_name = "__bun_dom_open_envelope"]
    pub safe fn open_envelope(envelope: JSValue) -> Option<Message>;
    #[link_name = "__bun_dom_deliver_message"]
    pub safe fn deliver_message(
        realm: &JSGlobalObject,
        window: JSValue,
        message: Message,
        sender: Sender<'_>,
    );
    #[link_name = "__bun_dom_fire_at_notification"]
    pub safe fn fire_at_notification(id: u32, event: &str);
    /// For the document of a window that has the realm of its opener.
    #[link_name = "__bun_dom_lend_client"]
    pub safe fn lend_client(document: JSValue, client: ClientId, document_of_opener: JSValue);
}
