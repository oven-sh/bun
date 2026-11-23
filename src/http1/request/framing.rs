use bun_core::strings::{self, eql_case_insensitive_ascii_check_length as eql_ignoring_case};

use super::head::BLANKS;
use super::{Request, RequestError, RequestOptions};
use crate::byte_sets::NOT_COMMA;

const MAX_CONTENT_LENGTH_DIGITS: usize = 18;
const MAX_CONTENT_LENGTH: u64 = (1 << 59) - 1;

/// How the body of a request ends (RFC 9112 §6.3).
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Framing {
    ContentLength,
    Chunked,
    UntilEof,
    /// llhttp rejects it after the request is dispatched.
    Invalid,
}

#[derive(Default)]
struct TransferEncoding {
    is_present: bool,
    has_value: bool,
    follows_content_length: bool,
    /// The last coding is `chunked`.
    is_chunked: bool,
    has_more_after_chunked: bool,
    has_many_codings: bool,
    /// The last element, which is empty after a comma, is `chunked`.
    ends_in_chunked: bool,
}

impl TransferEncoding {
    fn of(request: &Request<'_>) -> Self {
        let mut this = Self::default();
        if !request.may_have(b"transfer-encoding") {
            return this;
        }
        let (mut has_coding, mut has_content_length) = (false, false);
        for field in request.fields() {
            has_content_length |= eql_ignoring_case(field.name, b"content-length");
            if !eql_ignoring_case(field.name, b"transfer-encoding") {
                continue;
            }
            this.is_present = true;
            this.follows_content_length |= has_content_length;
            this.has_more_after_chunked |= this.is_chunked;
            let mut list = (!field.value.is_empty()).then_some(field.value);
            while let Some(elements) = list {
                let (element, rest) = elements.split_at(NOT_COMMA.short_prefix_len(elements));
                list = rest.strip_prefix(b",");
                let coding = strings::trim(element, BLANKS);
                this.has_value = true;
                this.ends_in_chunked = eql_ignoring_case(coding, b"chunked");
                if !coding.is_empty() {
                    this.has_more_after_chunked |= this.is_chunked;
                    this.has_many_codings |= has_coding;
                    this.is_chunked = this.ends_in_chunked;
                    has_coding = true;
                }
            }
        }
        this
    }
}

impl<'a> Request<'a> {
    /// The value that all `Content-Length` fields have.
    pub(super) fn content_length(&self) -> Result<Option<&'a [u8]>, RequestError> {
        let mut values = self.values(b"content-length");
        match values.next() {
            Some(first) if first.is_empty() || values.any(|other| other != first) => {
                Err(RequestError::InvalidContentLength)
            }
            first => Ok(first),
        }
    }

    pub(super) fn decide_framing<const IS_NODE: bool>(
        &mut self,
        has_content_length: bool,
        options: &RequestOptions,
    ) -> Result<Framing, RequestError> {
        let mut encoding = TransferEncoding::of(self);
        let is_lenient = options.has_lenient_transfer_encoding;
        // llhttp takes an empty field for none, but rejects one after `Content-Length` by its name.
        let is_ignored =
            IS_NODE && !encoding.has_value && (!encoding.follows_content_length || is_lenient);
        if !encoding.is_present || is_ignored {
            return Ok(Framing::ContentLength);
        }
        if is_lenient {
            encoding.has_more_after_chunked = false;
            encoding.is_chunked = encoding.ends_in_chunked;
        }
        if has_content_length
            || encoding.has_more_after_chunked
            || !IS_NODE && (self.is_http_1_0() || encoding.has_many_codings || !encoding.is_chunked)
        {
            return Err(RequestError::InvalidTransferEncoding);
        }
        // https://github.com/nodejs/llhttp/blob/v9.4.1/src/native/http.c#L41-L50
        if !encoding.is_chunked && (self.is_connect() || self.is_upgrade()) {
            self.ends_connection = !self.is_connect();
            return Ok(Framing::ContentLength);
        }
        self.has_transfer_encoding = true;
        Ok(match encoding.is_chunked {
            true => Framing::Chunked,
            false if is_lenient => Framing::UntilEof,
            false => Framing::Invalid,
        })
    }
}

pub(super) fn parse_content_length(value: &[u8]) -> Option<u64> {
    let add =
        |length: u64, byte: &u8| Some(length * 10 + u64::from(char::from(*byte).to_digit(10)?));
    if value.len() > MAX_CONTENT_LENGTH_DIGITS {
        return None;
    }
    (value.iter().try_fold(0, add)).filter(|&length| length <= MAX_CONTENT_LENGTH)
}
