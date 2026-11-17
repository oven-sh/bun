//! For the host of a page.

use bun_web::net::embedder::ClientId;

use super::*;

#[unsafe(no_mangle)]
fn __bun_dom_lend_client(doc: JSValue, client: ClientId, opener: JSValue) {
    let heap = JsHeap::from_global(bun_ui::main_global());
    if let Some((doc, opener)) = Doc::from_js(heap, doc).zip(Doc::from_js(heap, opener)) {
        doc.loading().lent_client.replace(Client::find(client));
        doc.set_edge(heap, Edge::SourceOwner, opener.to_js());
    }
}
