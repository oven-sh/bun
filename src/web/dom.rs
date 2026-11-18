//! What the DOM does for what hosts a page in this process. The values are those of `realm`.

use bun_jsc::{JSGlobalObject, JSValue};

use crate::channel::{Endpoint, LooseBitmap};
use crate::host::{Clipped, Host};
use crate::net::embedder::ClientId;
use crate::page::{About, Change, Order, Outcome, Query};
use crate::service::{Running, Start};

pub struct Opening {
    pub host: Host,
    /// What has to be alive for `host`.
    pub host_needs: JSValue,
    /// 0 for none
    pub page: u32,
    pub context: u32,
    pub surface: u32,
    /// It shares objects with the documents of its origin in the group of `context`.
    pub has_relatives: bool,
    pub font_scope: Option<u32>,
    pub about: About,
}

impl Opening {
    pub fn new(host: Host, host_needs: JSValue) -> Opening {
        Opening {
            host,
            host_needs,
            page: 0,
            context: 0,
            surface: 0,
            has_relatives: false,
            font_scope: None,
            about: About {
                url: "about:blank".into(),
                ..Default::default()
            },
        }
    }
}

/// What may become of the realm of a page that is gone.
#[derive(Default)]
pub struct Left {
    /// Other documents use its modules.
    pub is_needed: bool,
    /// Their scripts may have its promises.
    pub is_reachable: bool,
    /// One that is no longer needed.
    pub released: Option<JSValue>,
}

unsafe extern "Rust" {
    #[link_name = "__bun_dom_obey"]
    pub safe fn obey(page: u32, order: Order);
    #[link_name = "__bun_dom_answer"]
    pub safe fn answer(page: u32, query: Query) -> Option<Outcome>;
    #[link_name = "__bun_dom_read_clipboard"]
    pub safe fn read_clipboard(is_selection: bool) -> Clipped;
    #[link_name = "__bun_dom_write_clipboard"]
    pub safe fn write_clipboard(texts: Vec<(String, String)>, is_selection: bool);
    #[link_name = "__bun_dom_write_image_to_clipboard"]
    pub safe fn write_image_to_clipboard(
        texts: Vec<(String, String)>,
        image: LooseBitmap,
        then: Box<dyn FnOnce()>,
    );
    #[link_name = "__bun_dom_can_paste"]
    pub safe fn can_paste() -> bool;
    #[link_name = "__bun_dom_change_context"]
    pub safe fn change_context(context: u32, change: Change);
    /// For the realm of the document that `context` shows.
    #[link_name = "__bun_dom_window_to_take_over"]
    pub safe fn window_to_take_over(context: u32) -> JSValue;
    /// `global` is the global object, if the window is to be that. The result controls the page.
    #[link_name = "__bun_dom_open_page"]
    pub safe fn open_page(
        realm: &JSGlobalObject,
        opening: Opening,
        global: Option<JSValue>,
    ) -> JSValue;
    /// In the realm of `opener`.
    #[link_name = "__bun_dom_open_page_beside"]
    pub safe fn open_page_beside(
        opener: u32,
        opening: Opening,
        client: ClientId,
    ) -> Option<JSValue>;
    #[link_name = "__bun_dom_follow_response"]
    pub safe fn follow_response(page: u32, links: &[u8]);
    #[link_name = "__bun_dom_window_of"]
    pub safe fn window_of(controls: JSValue) -> JSValue;
    #[link_name = "__bun_dom_leave_relatives"]
    pub safe fn leave_relatives(controls: JSValue) -> Left;
    #[link_name = "__bun_dom_element_of_frame"]
    pub safe fn element_of_frame(page: u32, frame: u32) -> JSValue;
    #[link_name = "__bun_dom_adopt_port"]
    pub safe fn adopt_port(realm: &JSGlobalObject, port: Endpoint) -> JSValue;
    #[link_name = "__bun_dom_release_port"]
    pub safe fn release_port(realm: &JSGlobalObject, port: JSValue) -> Option<Endpoint>;
    #[link_name = "__bun_dom_start_service_worker"]
    pub(crate) safe fn start_service_worker(start: Start) -> Option<Running>;
}
