//! What `bun_runtime` implements.

use bun_jsc::webcore_types::Blob;
use bun_jsc::{AbortSignalRef, JSGlobalObject, JSValue, JsResult};

use crate::Bytes;
use crate::headers::HeaderList;
use crate::net::body::Data;

pub enum ResponseBody {
    Blob(Data),
    Stream(JSValue),
}

pub struct TakenResponse {
    pub status: u16,
    pub status_text: Bytes,
    pub headers: HeaderList,
    pub body: ResponseBody,
}

crate::wire! {
    /// A `Blob` or a `File` that is in no realm.
    #[derive(Clone)]
    pub struct LooseBlob {
        pub data: Data,
        pub mime: Bytes,
        pub name_of_file: Option<Bytes>,
        pub modified: f64,
        pub was_chosen_by_user: bool,
    }
}

unsafe extern "Rust" {
    /// From any thread. The id is what a serialized value has.
    #[link_name = "__bun_web_loosen_blob"]
    pub(crate) safe fn loosen_blob(id: &[u8; 16]) -> Option<LooseBlob>;
    #[link_name = "__bun_web_retain_blob"]
    pub(crate) safe fn retain_blob(global: &JSGlobalObject, blob: LooseBlob) -> [u8; 16];
    #[link_name = "__bun_web_size_of_blob"]
    pub safe fn size_of_blob(blob: &Blob) -> u64;
    #[link_name = "__bun_web_create_blob"]
    pub safe fn create_blob(global: &JSGlobalObject, bytes: Vec<u8>, mime: &[u8]) -> JSValue;
    #[link_name = "__bun_web_create_file"]
    pub safe fn create_file(
        global: &JSGlobalObject,
        bytes: Vec<u8>,
        name: &[u8],
        mime: &[u8],
        modified: f64,
    ) -> JSValue;
    #[link_name = "__bun_web_create_chosen_file"]
    pub(crate) safe fn create_chosen_file(
        global: &JSGlobalObject,
        path: &[u8],
        stat: &bun_sys::Stat,
    ) -> JSValue;
    /// A `File` that `path` is read for when it is read.
    #[link_name = "__bun_web_create_snapshot"]
    pub safe fn create_snapshot(
        global: &JSGlobalObject,
        path: Vec<u8>,
        stat: &bun_sys::Stat,
        name: &[u8],
    ) -> JSValue;
    #[link_name = "__bun_web_revoke_blob_url"]
    pub(crate) safe fn revoke_blob_url(url: &[u8]);
    /// A URL that the module loader of the runtime resolves.
    #[link_name = "__bun_web_lend_module"]
    pub safe fn lend_module(global: &JSGlobalObject, source: Vec<u8>) -> Vec<u8>;
    #[link_name = "__bun_web_reclaim_module"]
    pub safe fn reclaim_module(url: &[u8]);
    #[link_name = "__bun_web_resolve_blob_url"]
    pub(crate) safe fn resolve_blob_url(url: &[u8]) -> Option<Blob>;
    #[link_name = "__bun_web_create_headers"]
    pub safe fn create_headers(global: &JSGlobalObject, headers: &HeaderList) -> JSValue;
    #[link_name = "__bun_web_create_request"]
    pub(crate) safe fn create_request(
        global: &JSGlobalObject,
        url: &[u8],
        method: &[u8],
        headers: &HeaderList,
        body: JSValue,
        signal: AbortSignalRef,
    ) -> JsResult<JSValue>;
    #[link_name = "__bun_web_create_response"]
    pub safe fn create_response(
        global: &JSGlobalObject,
        status: u16,
        status_text: &[u8],
        headers: &HeaderList,
        body: JSValue,
    ) -> JsResult<JSValue>;
    /// `None` if it is not a `Response` that can be used.
    #[link_name = "__bun_web_take_response"]
    pub(crate) safe fn take_response(
        global: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<Option<TakenResponse>>;
    #[link_name = "__bun_web_create_certificate_chain"]
    pub safe fn create_certificate_chain(
        global: &JSGlobalObject,
        certificate: &[u8],
        issuers: &[Box<[u8]>],
    ) -> JsResult<JSValue>;
    #[link_name = "__bun_web_map_resource"]
    pub(crate) safe fn map_resource(path: &[u8]) -> Option<&'static [u8]>;
}
