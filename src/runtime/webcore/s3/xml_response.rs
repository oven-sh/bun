//! S3 answers in XML; its responses are read through the XML parser (the
//! `{ name, attributes, children }` node shape, whose text is exact) and the
//! few strings wanted are copied out.

use bun_ast::E;
use bun_ast::expr::Data;
use bun_parsers::xml::{self, XML};

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
pub(crate) struct ErrorBody {
    pub code: Option<Box<[u8]>>,
    pub message: Option<Box<[u8]>>,
}

pub(crate) fn parse_error(body: &[u8]) -> Option<ErrorBody> {
    parse(body, |root| {
        (root.name == b"Error").then(|| ErrorBody {
            code: root.child_nonempty_text(b"Code"),
            message: root.child_nonempty_text(b"Message"),
        })
    })
    .flatten()
}
