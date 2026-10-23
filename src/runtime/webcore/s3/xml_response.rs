//! S3 answers in XML; its responses are read through the XML parser (the
//! `{ name, attributes, children }` node shape, whose text is exact) and the
//! few strings wanted are copied out.

use std::io::Write as _;

use bun_ast::E;
use bun_ast::expr::Data;
use bun_parsers::xml::{self, XML};
use bun_s3_signing::error::S3Error;

/// One element of a parsed response.
#[derive(Clone, Copy)]
pub(crate) struct Node<'a> {
    pub(crate) name: &'a [u8],
    children: &'a [E::JsonValue],
}

impl<'a> Node<'a> {
    fn of(value: &'a E::JsonValue) -> Option<Node<'a>> {
        let element = value.as_object()?;
        Some(Node {
            name: element.get(b"name")?.as_str()?,
            children: element
                .get(b"children")
                .and_then(E::JsonValue::as_array)
                .map_or(&[], E::ArrayJSON::items),
        })
    }

    /// The child element `name` (the first, if repeated).
    pub(crate) fn child(self, name: &[u8]) -> Option<Node<'a>> {
        self.children(name).next()
    }

    /// Every child element called `name`, in document order.
    pub(crate) fn children<'n>(
        self,
        name: &'n [u8],
    ) -> impl Iterator<Item = Node<'a>> + use<'a, 'n> {
        self.children
            .iter()
            .filter_map(Node::of)
            .filter(move |child| child.name == name)
    }

    /// The element's character data, exactly (entities and CDATA decoded,
    /// whitespace kept), copied out; `None` for an element with element
    /// children.
    pub(crate) fn text(self) -> Option<Box<[u8]>> {
        match self.children {
            [] => Some(Box::default()),
            [only] => only.as_str().map(Box::from),
            // Character data interrupted by comments / PIs.
            runs => {
                let mut joined = Vec::new();
                for run in runs {
                    joined.extend_from_slice(run.as_str()?);
                }
                Some(joined.into_boxed_slice())
            }
        }
    }

    pub(crate) fn child_text(self, name: &[u8]) -> Option<Box<[u8]>> {
        self.child(name)?.text()
    }

    /// `child_text`, but an empty element counts as absent.
    pub(crate) fn child_nonempty_text(self, name: &[u8]) -> Option<Box<[u8]>> {
        self.child_text(name).filter(|text| !text.is_empty())
    }

    pub(crate) fn child_i64(self, name: &[u8]) -> Option<i64> {
        // All-ASCII-digit text is UTF-8.
        core::str::from_utf8(self.child_text(name)?.trim_ascii())
            .ok()?
            .parse()
            .ok()
    }

    pub(crate) fn child_bool(self, name: &[u8]) -> Option<bool> {
        match self.child_text(name)?.trim_ascii() {
            b"true" => Some(true),
            b"false" => Some(false),
            _ => None,
        }
    }
}

/// Parses `body` and maps its root element through `read`; `None` if it is
/// not a well-formed XML document. The parse lives in a throwaway arena, so
/// `read` copies out what it keeps.
pub(crate) fn parse<R>(body: &[u8], read: impl FnOnce(Node<'_>) -> R) -> Option<R> {
    // `CompleteMultipartUpload` streams keep-alive whitespace ahead of the
    // document (even ahead of an `<Error>` on a 200), which XML proper does
    // not allow before the declaration.
    let body = body.trim_ascii_start();
    // The parser's positions are 32-bit.
    if body.is_empty() || body.len() > i32::MAX as usize {
        return None;
    }
    let arena = bun_alloc::Arena::default();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let mut log = bun_ast::Log::init();
    let source = bun_ast::Source::init_path_string(b"response.xml", body);
    let options = xml::Options {
        compact: false,
        encoding: xml::InputEncoding::Bytes,
    };
    let Ok(bun_ast::Expr {
        data: Data::EObjectJSON(root),
        ..
    }) = XML::parse(&source, &mut log, &arena, options)
    else {
        return None;
    };
    let root = E::JsonValue::Object(root);
    Node::of(&root).map(read)
}

/// The `<Code>` and `<Message>` (each if present and non-empty) of an S3
/// `<Error>` document; `None` if the body is not one.
struct ErrorBody {
    code: Option<Box<[u8]>>,
    message: Option<Box<[u8]>>,
}

fn parse_error(body: &[u8]) -> Option<ErrorBody> {
    parse(body, |root| {
        (root.name == b"Error").then(|| ErrorBody {
            code: root.child_nonempty_text(b"Code"),
            message: root.child_nonempty_text(b"Message"),
        })
    })
    .flatten()
}

const UNEXPECTED: &[u8] = b"an unexpected error has occurred";

/// The error of a request that failed in transport; the failure's name is its code.
/// `status` is that of the response head, or 0 when none arrived before the failure.
pub(crate) fn transport_failure(cause: bun_http::Error, status: u32) -> S3Error<'static> {
    S3Error::from_response(cause.name().as_bytes(), UNEXPECTED, status)
}

/// "HTTP 403": the message of a failed response that has no body.
struct StatusLine {
    bytes: [u8; Self::MAX],
    len: usize,
}

impl StatusLine {
    const MAX: usize = "HTTP 4294967295".len();

    fn of(status: u32) -> Self {
        let mut bytes = [0u8; Self::MAX];
        let mut rest = &mut bytes[..];
        write!(rest, "HTTP {status}").expect("MAX fits the longest u32");
        let len = Self::MAX - rest.len();
        Self { bytes, len }
    }

    fn as_bytes(&self) -> &[u8] {
        &self.bytes[..self.len]
    }
}

/// What the body of a response that may be a failure says about it: S3's
/// `<Error>` document when the body is one, the body as text when it is
/// anything else (a proxy's page), nothing when it is empty (every HEAD).
pub(crate) struct FailedResponse {
    document: Option<ErrorBody>,
    /// Written by `error` when the status is all there is to say.
    status_line: Option<StatusLine>,
}

impl FailedResponse {
    /// Inlined: an empty body, which is all a missing key gets, then costs no call.
    #[inline]
    pub(crate) fn read(body: &[u8]) -> Self {
        let mut response = Self {
            document: None,
            status_line: None,
        };
        if !body.is_empty() {
            response.document = parse_error(body);
        }
        response
    }

    /// A request can answer 200 and still carry an `<Error>` document.
    pub(crate) fn is_error_document(&self) -> bool {
        self.document.is_some()
    }

    pub(crate) fn has_code(&self) -> bool {
        self.document
            .as_ref()
            .is_some_and(|document| document.code.is_some())
    }

    /// The error that the response with this `body` and `status` reports.
    pub(crate) fn error<'a>(&'a mut self, body: &'a [u8], status: u32) -> S3Error<'a> {
        let document = self.document.as_ref();
        let code = document
            .and_then(|document| document.code.as_deref())
            .unwrap_or(b"UnknownError");
        let message = match document.and_then(|document| document.message.as_deref()) {
            Some(message) => message,
            None if !body.is_empty() => body,
            None => {
                // The status is all the response says. A 2xx names no failure.
                self.status_line = (status >= 300).then(|| StatusLine::of(status));
                self.status_line
                    .as_ref()
                    .map_or(UNEXPECTED, StatusLine::as_bytes)
            }
        };
        S3Error::from_response(code, message, status)
    }
}
