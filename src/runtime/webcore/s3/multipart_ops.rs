//! CreateMultipartUpload, CompleteMultipartUpload and AbortMultipartUpload,
//! shared by the writer (`MultiPartUpload`) and `S3Client`.

use core::ffi::c_void;
use std::io::Write as _;

use bstr::BStr;
use bun_collections::index_sort;
use bun_core::fmt::buf_print;
use bun_s3_signing::acl::ACL;
use bun_s3_signing::credentials::{S3Credentials, encode_uri_component};
use bun_s3_signing::storage_class::StorageClass;

use crate::webcore::s3::simple_request::{
    self as s3_simple_request, S3CommitResult, S3DeleteResult, S3DownloadResult,
    execute_simple_s3_request,
};
use crate::webcore::s3::xml_response;

/// The `<UploadId>` of a CreateMultipartUpload response, raw and percent-encoded.
#[derive(Default)]
pub(crate) struct UploadId {
    raw: Box<[u8]>,
    encoded: Box<[u8]>,
}

/// Room for `?partNumber=10000&uploadId=<encoded id>&x-id=UploadPart`.
pub(crate) const QUERY_BUFFER_LEN: usize = UploadId::MAX_ENCODED_LEN + 64;

impl UploadId {
    /// Of the percent-encoded id: each query built around it fits the
    /// signer's buffers.
    pub(crate) const MAX_ENCODED_LEN: usize = 2000;

    /// Printable ASCII, up to [`Self::MAX_ENCODED_LEN`] bytes once encoded.
    pub(crate) fn parse(raw: &[u8]) -> Option<UploadId> {
        if raw.is_empty() || !raw.iter().all(u8::is_ascii_graphic) {
            return None;
        }
        let mut buf = [0u8; Self::MAX_ENCODED_LEN];
        let encoded = encode_uri_component::<true>(raw, &mut buf).ok()?;
        Some(UploadId {
            raw: Box::from(raw),
            encoded: Box::from(encoded),
        })
    }

    pub(crate) fn as_raw(&self) -> &[u8] {
        &self.raw
    }

    /// `?uploadId=<encoded>`.
    pub(crate) fn query<'b>(&self, buf: &'b mut [u8; QUERY_BUFFER_LEN]) -> &'b [u8] {
        buf_print(buf, format_args!("?uploadId={}", BStr::new(&self.encoded)))
            .expect("QUERY_BUFFER_LEN fits an encoded upload id")
    }

    /// `?partNumber=N&uploadId=<encoded>[&x-id=UploadPart]`, names in byte order.
    pub(crate) fn part_query<'b>(
        &self,
        buf: &'b mut [u8; QUERY_BUFFER_LEN],
        part_number: u16,
        x_id: bool,
    ) -> &'b [u8] {
        let x_id = if x_id { "&x-id=UploadPart" } else { "" };
        buf_print(
            buf,
            format_args!(
                "?partNumber={}&uploadId={}{}",
                part_number,
                BStr::new(&self.encoded),
                x_id
            ),
        )
        .expect("QUERY_BUFFER_LEN fits an encoded upload id")
    }
}

/// The `<UploadId>` of an `<InitiateMultipartUploadResult>` body.
pub(crate) fn parse_initiate_result(body: &[u8]) -> Option<UploadId> {
    xml_response::parse(body, |root| {
        (root.name == b"InitiateMultipartUploadResult")
            .then(|| root.child_text(b"UploadId"))
            .flatten()
    })
    .flatten()
    .and_then(|id| UploadId::parse(&id))
}

/// One uploaded part, as CompleteMultipartUpload lists it.
pub(crate) struct UploadPartResult {
    pub(crate) number: u16,
    /// As the UploadPart response returned it, quotes included.
    pub(crate) etag: Box<[u8]>,
}

pub(crate) const MAX_PART_NUMBER: u16 = 10_000;

/// The body of CompleteMultipartUpload. Sorts `parts` by part number in place.
pub(crate) fn complete_body(parts: &mut [UploadPartResult]) -> Vec<u8> {
    index_sort::sort_slice_by(parts, |a, b| a.number.cmp(&b.number));
    let mut body = Vec::with_capacity(128 + parts.len() * 96);
    body.extend_from_slice(
        b"<?xml version=\"1.0\" encoding=\"UTF-8\"?><CompleteMultipartUpload xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\">",
    );
    for part in parts.iter() {
        write!(body, "<Part><PartNumber>{}</PartNumber><ETag>", part.number)
            .expect("infallible: in-memory write");
        append_xml_text(&mut body, &part.etag);
        body.extend_from_slice(b"</ETag></Part>");
    }
    body.extend_from_slice(b"</CompleteMultipartUpload>");
    body
}

/// XML character data: only `&`, `<` and `>` become entities.
fn append_xml_text(body: &mut Vec<u8>, text: &[u8]) {
    for &byte in text {
        match byte {
            b'&' => body.extend_from_slice(b"&amp;"),
            b'<' => body.extend_from_slice(b"&lt;"),
            b'>' => body.extend_from_slice(b"&gt;"),
            _ => body.push(byte),
        }
    }
}

/// What CreateMultipartUpload sets on the object it will create.
#[derive(Default)]
pub(crate) struct CreateMultipartOptions<'a> {
    pub(crate) content_type: Option<&'a [u8]>,
    pub(crate) content_disposition: Option<&'a [u8]>,
    pub(crate) content_encoding: Option<&'a [u8]>,
    pub(crate) acl: Option<ACL>,
    pub(crate) storage_class: Option<StorageClass>,
    pub(crate) request_payer: bool,
    /// As `S3SimpleRequestOptions::proxy_url`.
    pub(crate) proxy_url: Option<&'a [u8]>,
}

/// `POST /key?uploads=`. Read the id from the body with [`parse_initiate_result`].
pub(crate) fn create_multipart_upload(
    credentials: &S3Credentials,
    context: &bun_jsc::ScriptExecutionContext,
    path: &[u8],
    options: &CreateMultipartOptions<'_>,
    callback: fn(S3DownloadResult, *mut c_void) -> bun_jsc::JsResult<()>,
    callback_context: *mut c_void,
) -> bun_jsc::JsResult<()> {
    execute_simple_s3_request(
        credentials,
        context,
        s3_simple_request::S3RequestOptions {
            path,
            method: bun_http::Method::POST,
            proxy_url: options.proxy_url,
            body: b"",
            search_params: Some(b"?uploads="),
            content_type: options.content_type,
            content_disposition: options.content_disposition,
            content_encoding: options.content_encoding,
            acl: options.acl,
            storage_class: options.storage_class,
            request_payer: options.request_payer,
            ..Default::default()
        },
        s3_simple_request::S3Callback::Download(callback),
        callback_context,
    )
}

/// `POST /key?uploadId=<id>` with the body of [`complete_body`].
pub(crate) fn complete_multipart_upload(
    credentials: &S3Credentials,
    context: &bun_jsc::ScriptExecutionContext,
    path: &[u8],
    upload_id: &UploadId,
    body: &[u8],
    proxy_url: Option<&[u8]>,
    request_payer: bool,
    callback: fn(S3CommitResult, *mut c_void) -> bun_jsc::JsResult<()>,
    callback_context: *mut c_void,
) -> bun_jsc::JsResult<()> {
    let mut query = [0u8; QUERY_BUFFER_LEN];
    execute_simple_s3_request(
        credentials,
        context,
        s3_simple_request::S3RequestOptions {
            path,
            method: bun_http::Method::POST,
            proxy_url,
            body,
            search_params: Some(upload_id.query(&mut query)),
            request_payer,
            ..Default::default()
        },
        s3_simple_request::S3Callback::Commit(callback),
        callback_context,
    )
}

/// `DELETE /key?uploadId=<id>`.
pub(crate) fn abort_multipart_upload(
    credentials: &S3Credentials,
    context: &bun_jsc::ScriptExecutionContext,
    path: &[u8],
    upload_id: &UploadId,
    proxy_url: Option<&[u8]>,
    request_payer: bool,
    callback: fn(S3DeleteResult, *mut c_void) -> bun_jsc::JsResult<()>,
    callback_context: *mut c_void,
) -> bun_jsc::JsResult<()> {
    let mut query = [0u8; QUERY_BUFFER_LEN];
    execute_simple_s3_request(
        credentials,
        context,
        s3_simple_request::S3RequestOptions {
            path,
            method: bun_http::Method::DELETE,
            proxy_url,
            body: b"",
            search_params: Some(upload_id.query(&mut query)),
            request_payer,
            ..Default::default()
        },
        s3_simple_request::S3Callback::Delete(callback),
        callback_context,
    )
}
