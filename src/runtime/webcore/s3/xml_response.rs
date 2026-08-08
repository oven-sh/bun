//! S3 answers in XML; its responses are read through the XML parser (the
//! `{ name, attributes, children }` node shape, whose text is exact).

use bun_ast::E;
use bun_ast::expr::Data;
use bun_parsers::xml::{self, XML};

use crate::api::RecycledArena;

/// One element of a parsed response.
#[derive(Clone, Copy)]
pub(crate) struct Node<'a> {
    pub(crate) name: &'a [u8],
    children: &'a [E::JsonValue],
    arena: &'a bun_alloc::Arena,
}

impl<'a> Node<'a> {
    fn of(value: &'a E::JsonValue, arena: &'a bun_alloc::Arena) -> Option<Node<'a>> {
        let element = value.as_object()?;
        Some(Node {
            name: element.get(b"name")?.as_str()?,
            children: element
                .get(b"children")
                .and_then(E::JsonValue::as_array)
                .map_or(&[], E::ArrayJSON::items),
            arena,
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
            .filter_map(move |child| Node::of(child, self.arena))
            .filter(move |child| child.name == name)
    }

    /// The element's character data, exactly (entities and CDATA decoded,
    /// whitespace kept); empty for an element with element children.
    pub(crate) fn text(self) -> &'a [u8] {
        match self.children {
            [] => b"",
            [only] => only.as_str().unwrap_or(b""),
            // Character data interrupted by comments / PIs.
            runs => {
                use bun_alloc::ArenaVecExt as _;
                let mut joined = bun_alloc::ArenaVec::new_in(self.arena);
                for run in runs {
                    let Some(run) = run.as_str() else {
                        return b"";
                    };
                    joined.extend_from_slice(run);
                }
                joined.into_bump_slice()
            }
        }
    }

    pub(crate) fn child_text(self, name: &[u8]) -> Option<&'a [u8]> {
        self.child(name).map(Node::text)
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

/// Parses `body` and hands its root element to `f` (or `None` if it is not
/// a well-formed XML document). Everything a `Node` lends lives until `f`
/// returns.
pub(crate) fn with_document<R>(body: &[u8], f: impl FnOnce(Option<Node<'_>>) -> R) -> R {
    // The parser's positions are 32-bit.
    if body.is_empty() || body.len() > i32::MAX as usize {
        return f(None);
    }
    let recycle = RecycledArena::take();
    let arena = recycle.arena();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(arena);
    let _ast_scope = ast_memory_allocator.enter();
    let mut log = bun_ast::Log::init();
    let source = bun_ast::Source::init_path_string(b"response.xml", body);
    let options = xml::Options {
        compact: false,
        encoding: xml::InputEncoding::Bytes,
    };
    let root = match XML::parse(&source, &mut log, arena, options) {
        Ok(bun_ast::Expr {
            data: Data::EObjectJSON(root),
            ..
        }) => root,
        _ => return f(None),
    };
    let root = E::JsonValue::Object(root);
    f(Node::of(&root, arena))
}

/// The (non-empty) `<Code>` and `<Message>` of an S3 `<Error>` document;
/// `None` if the body is not one.
#[allow(clippy::type_complexity)]
pub(crate) fn with_error<R>(
    body: &[u8],
    f: impl FnOnce(Option<(Option<&[u8]>, Option<&[u8]>)>) -> R,
) -> R {
    with_document(body, |root| match root {
        Some(error) if error.name == b"Error" => f(Some((
            error.child_text(b"Code").filter(|code| !code.is_empty()),
            error
                .child_text(b"Message")
                .filter(|message| !message.is_empty()),
        ))),
        _ => f(None),
    })
}
