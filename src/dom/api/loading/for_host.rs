//! For the host of a page.

use bun_web::net::embedder::ClientId;

use super::*;

/// For the document of a window that has the realm of its opener.
pub(crate) fn lend_client(heap: &JsHeap<'_>, doc: &Doc, client: ClientId, opener: &Doc) {
    doc.loading().lent_client.replace(Client::find(client));
    doc.set_edge(heap, Edge::SourceOwner, opener.to_js());
}
