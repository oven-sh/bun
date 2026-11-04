//! `cursorOffset`: Prettier's `main/get-cursor-node.js` applied to the HTML tree, and the marks that
//! `main/ast-to-doc.js` puts around the output of the nodes next to the cursor.

use super::ast::{Id, Kind, Span, Tree};
use crate::cursor::Region;

/// A node in Prettier's sense.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Target {
    Node(Id),
    /// An attribute or a comment in a start tag.
    InStartTag(Span),
    /// The `init` of an `@let` declaration.
    LetInitializer(Id),
}

/// The cursor's position.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Cursor {
    /// There's no cursor.
    Nowhere,
    /// In a node without children.
    In(Target),
    /// `None` means the start or the end of the text.
    Between {
        before: Option<Target>,
        after: Option<Target>,
    },
}

fn span_of(tree: &Tree<'_>, target: Target) -> Span {
    match target {
        Target::Node(id) => tree[id].span,
        Target::InStartTag(span) => span,
        Target::LetInitializer(id) => tree[id].name_span,
    }
}

/// `getChildren`, in the order of the visitor keys.
fn for_each_child(tree: &Tree<'_>, target: Target, visit: &mut dyn FnMut(Target)) {
    let Target::Node(id) = target else {
        return;
    };
    match tree[id].kind {
        Kind::Element => {
            tree.attrs(id)
                .iter()
                .for_each(|attr| visit(Target::InStartTag(attr.span)));
            tree.start_tag_comments(id)
                .iter()
                .for_each(|comment| visit(Target::InStartTag(comment.span)));
        }
        Kind::AngularLetDeclaration => visit(Target::LetInitializer(id)),
        _ => {}
    }
    tree.children(id)
        .for_each(|child| visit(Target::Node(child)));
    tree.parameters(id)
        .into_iter()
        .for_each(|parameters| visit(Target::Node(parameters)));
}

/// `getCursorLocation`. `tree` must be as parsed, before preprocessing.
pub(crate) fn locate(tree: &Tree<'_>, offset: u32) -> Cursor {
    // The nodes that contain the cursor, each after its parent.
    let mut containing = vec![Target::Node(tree.root)];
    let mut index = 0;
    while let Some(&node) = containing.get(index) {
        for_each_child(tree, node, &mut |child| {
            let span = span_of(tree, child);
            if span.start <= offset && offset <= span.end {
                containing.push(child);
            }
        });
        index += 1;
    }
    if let Some(&innermost) = containing.last() {
        let mut is_leaf = true;
        for_each_child(tree, innermost, &mut |_| is_leaf = false);
        if is_leaf {
            return Cursor::In(innermost);
        }
    }
    let (mut before, mut after): (Option<Target>, Option<Target>) = (None, None);
    while let Some(node) = containing
        .pop()
        .filter(|_| before.is_none() || after.is_none())
    {
        let (has_before, has_after) = (before.is_some(), after.is_some());
        for_each_child(tree, node, &mut |child| {
            let span = span_of(tree, child);
            if !has_before
                && span.end <= offset
                && before.is_none_or(|it| span.end > span_of(tree, it).end)
            {
                before = Some(child);
            }
            if !has_after
                && span.start >= offset
                && after.is_none_or(|it| span.start < span_of(tree, it).start)
            {
                after = Some(child);
            }
        });
    }
    Cursor::Between { before, after }
}

impl Cursor {
    /// Returns the part of the text that the marks enclose. `tree` must be as printed, because that's when Prettier
    /// reads the nodes' spans.
    pub(crate) fn region(self, tree: &Tree<'_>) -> Option<Region> {
        let span = |target: Target| {
            let span = span_of(tree, target);
            bun_lint::span::Span::new(span.start, span.end)
        };
        match self {
            Cursor::Nowhere => None,
            Cursor::In(node) => Some(Region::Node(span(node))),
            Cursor::Between { before, after } => Some(Region::Between {
                before: before.map(span),
                after: after.map(span),
            }),
        }
    }
}
