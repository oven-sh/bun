//! The requests of an S3 multipart upload (CreateMultipartUpload,
//! CompleteMultipartUpload, AbortMultipartUpload) and the upload id they
//! share. The writer (`MultiPartUpload`) and `S3Client.createMultipartUpload`
//! / `completeMultipartUpload` / `abortMultipartUpload` send the same bytes
//! through this module.

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

/// The id S3 gives a multipart upload, as the `<UploadId>` text of the
/// CreateMultipartUpload response. Stored raw. Each query string it goes into
/// percent-encodes it.
#[derive(Default)]
pub(crate) struct UploadId(Box<[u8]>);

/// Room for `?partNumber=10000&uploadId=<encoded id>&x-id=UploadPart`.
pub(crate) const QUERY_BUFFER_LEN: usize = UploadId::MAX_LEN * 3 + 64;

impl UploadId {
    pub(crate) const MAX_LEN: usize = 2000;

    /// Accepts an id that is printable ASCII without `&`, `#` or `?`, up to
    /// [`Self::MAX_LEN`] bytes. That is every id S3 and the S3-compatible
    /// stores issue, and nothing that ends or splits a query value.
    pub(crate) fn parse(bytes: &[u8]) -> Option<UploadId> {
        let valid = !bytes.is_empty()
            && bytes.len() <= Self::MAX_LEN
            && bytes
                .iter()
                .all(|&b| b.is_ascii_graphic() && !matches!(b, b'&' | b'#' | b'?'));
        valid.then(|| UploadId(Box::from(bytes)))
    }

    pub(crate) fn as_raw(&self) -> &[u8] {
        &self.0
    }

    /// `?uploadId=<encoded>`: the query of CompleteMultipartUpload and
    /// AbortMultipartUpload.
    pub(crate) fn query<'b>(&self, buf: &'b mut [u8; QUERY_BUFFER_LEN]) -> &'b [u8] {
        let mut encoded = [0u8; Self::MAX_LEN * 3];
        let encoded = self.encode(&mut encoded);
        buf_print(buf, format_args!("?uploadId={}", BStr::new(encoded)))
            .expect("QUERY_BUFFER_LEN fits an encoded upload id")
    }

    /// `?partNumber=N&uploadId=<encoded>[&x-id=UploadPart]`: the query of
    /// UploadPart. The names are in byte order, as the header-signed
    /// canonical request requires.
    pub(crate) fn part_query<'b>(
        &self,
        buf: &'b mut [u8; QUERY_BUFFER_LEN],
        part_number: u16,
        x_id: bool,
    ) -> &'b [u8] {
        let mut encoded = [0u8; Self::MAX_LEN * 3];
        let encoded = self.encode(&mut encoded);
        let x_id = if x_id { "&x-id=UploadPart" } else { "" };
        buf_print(
            buf,
            format_args!(
                "?partNumber={}&uploadId={}{}",
                part_number,
                BStr::new(encoded),
                x_id
            ),
        )
        .expect("QUERY_BUFFER_LEN fits an encoded upload id")
    }

    fn encode<'b>(&self, buf: &'b mut [u8; Self::MAX_LEN * 3]) -> &'b [u8] {
        encode_uri_component::<true>(&self.0, buf).expect("3 bytes per input byte fit")
    }
}

/// The `<UploadId>` of an `<InitiateMultipartUploadResult>` document, if the
/// body is one and the id is one [`UploadId::parse`] accepts.
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

/// The body of CompleteMultipartUpload. Sorts `parts` by part number in
/// place, as S3 requires them in ascending order.
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

/// Appends `text` as XML character data: `&`, `<` and `>` become entities.
/// Quotes stay as they are, so an ordinary etag (`"hex"`) goes out verbatim.
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

/// `POST /key?uploads=`. The callback gets the response body: read the id
/// with [`parse_initiate_result`].
pub(crate) fn create_multipart_upload(
    credentials: &S3Credentials,
    context: &bun_jsc::ScriptExecutionContext,
    path: &[u8],
    options: CreateMultipartOptions<'_>,
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

/// `POST /key?uploadId=<id>` with the body of [`complete_body`]. The callback
/// is told about an `<Error>` document on a 200 as a failure.
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
