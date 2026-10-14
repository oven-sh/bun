//! Attaches every comment to a node before printing starts. This is Prettier's `attachComments`.
//!
//! 1. The parser has already recorded the nodes around each comment ([`bun_lint::ast::comments::Comment`]).
//!    [`surrounding_nodes`] converts them to the nodes the printers use.
//! 2. [`rules`] has the special cases from Prettier's `handle-comments.js`.
//! 3. Any other comment is attached by its position in the line: a comment on its own line becomes a leading comment of the
//!    following node, and a comment at the end of a line becomes a trailing comment of the preceding node.
//!
//! Nothing here searches the tree or scans the source text.

mod debug;
mod rules;
mod surrounding_nodes;

use super::ast_nodes::AstNodes;
use super::comments::{Comment, CommentExt};
use crate::options::Flavor;
use bun_lint::ast::{Expr, File};
pub(crate) use debug::list;
use surrounding_nodes::{AttachContext, SurroundingNodes};

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[repr(u8)]
pub(crate) enum Placement {
    Leading,
    Trailing,
    Dangling,
}

/// Prettier's `comment.marker`. It tells apart the dangling comments of one node that are printed in different places.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub(crate) enum Marker {
    #[default]
    None,
    /// `(a /* comment */) => b`
    CommentBeforeArrow,
    /// Before the `implements` keyword of a class.
    Implements,
    /// Before the `extends` keyword of a class or an interface.
    Extends,
    /// The comment is inside an ignored node, so it is copied along with the node's source text. Prettier does not attach such
    /// a comment at all.
    InIgnoredNode,
}

/// The thing a comment is attached to.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub(crate) enum Owner<'a> {
    Node(AstNodes<'a>),
    /// An identifier or a literal key, given by its start offset. For Prettier it is an `Identifier` or `Literal` node.
    Name(u32),
    /// The parentheses after a `/** @type {T} */` cast: the expression inside them and the offset of the `(`. For Prettier it is
    /// Babel's `ParenthesizedExpression` node.
    CastParens(Expr<'a>, u32),
}

#[derive(Copy, Clone, Debug)]
pub(crate) struct Attachment<'a> {
    pub(crate) owner: Owner<'a>,
    pub(crate) placement: Placement,
    pub(crate) marker: Marker,
    /// Prettier's `comment.unignore`: a `prettier-ignore` comment that does not apply to its owner.
    pub(crate) is_unignored: bool,
    /// A `prettier-ignore` comment that applies to its owner.
    pub(crate) ignores_owner: bool,
}

impl<'a> Attachment<'a> {
    fn new(owner: Owner<'a>, placement: Placement) -> Self {
        Attachment {
            owner,
            placement,
            marker: Marker::None,
            is_unignored: false,
            ignores_owner: false,
        }
    }

    fn leading(owner: Owner<'a>) -> Self {
        Self::new(owner, Placement::Leading)
    }

    fn trailing(owner: Owner<'a>) -> Self {
        Self::new(owner, Placement::Trailing)
    }

    fn dangling(owner: Owner<'a>) -> Self {
        Self::new(owner, Placement::Dangling)
    }

    fn dangling_with_marker(owner: Owner<'a>, marker: Marker) -> Self {
        Attachment {
            marker,
            ..Self::dangling(owner)
        }
    }
}

#[derive(Default)]
pub(crate) struct Attached<'a> {
    /// Indexed by comment id.
    pub(crate) attachments: Vec<Attachment<'a>>,
    /// Prettier's `node.prettierIgnore`: nodes that are ignored because of a comment attached to a different node.
    pub(crate) ignored_nodes: Vec<Owner<'a>>,
    /// Start offsets of the owners that are not next to their comment. Sorted.
    pub(crate) relocated_owner_starts: Vec<u32>,
    pub(crate) has_ignore_comments: bool,
}

#[derive(Copy, Clone)]
pub(crate) struct Options {
    /// Prettier would parse this file with Babel instead of typescript-estree. Their trees differ in a few places.
    pub(crate) has_tree_of_babel: bool,
    pub(crate) experimental_ternaries: bool,
    pub(crate) flavor: Flavor,
}

/// Prettier's `comment.placement`.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum TextPosition {
    /// Only whitespace before the comment on its line.
    OwnLine,
    /// Code before the comment and only whitespace after it.
    EndOfLine,
    /// Code after the comment on its line.
    Remaining,
}

/// Everything a rule can look at.
struct CommentContext<'a> {
    comment: Comment<'a>,
    is_ignore_comment: bool,
    text_position: TextPosition,
    nodes: SurroundingNodes<'a>,
    is_last_comment: bool,
}

/// Whether only spaces and tabs separate two consecutive comments.
fn are_on_same_line(first: Comment<'_>, second: Comment<'_>) -> bool {
    first.next_token_start() == second.next_token_start() && !second.has_newline_before()
}

/// Prettier's `isOwnLineComment` and `isEndOfLineComment`. A run of comments on one line that share the same preceding (or
/// following) node is classified as a whole.
fn text_position<'a>(
    file: &'a File<'a>,
    nodes: &[SurroundingNodes<'a>],
    id: usize,
) -> TextPosition {
    let comment = |id: usize| file.comment(id as u32);
    let mut first = id;
    while nodes[id].preceding_node.is_some()
        && first > 0
        && nodes[first - 1].preceding_node == nodes[id].preceding_node
        && are_on_same_line(comment(first - 1), comment(first))
    {
        first -= 1;
    }
    if comment(first).has_newline_before() {
        return TextPosition::OwnLine;
    }
    let mut last = id;
    while nodes[id].following_node.is_some()
        && last + 1 < nodes.len()
        && nodes[last + 1].following_node == nodes[id].following_node
        && are_on_same_line(comment(last), comment(last + 1))
    {
        last += 1;
    }
    match comment(last).has_newline_after() {
        true => TextPosition::EndOfLine,
        false => TextPosition::Remaining,
    }
}

/// The default for a comment that no rule handles. Returns `None` for a comment between two nodes on the same line, which
/// [`break_ties`] decides.
fn attach_by_text_position<'a>(
    text_position: TextPosition,
    nodes: &SurroundingNodes<'a>,
    program: Owner<'a>,
) -> Option<Attachment<'a>> {
    Some(
        match (text_position, nodes.preceding_node, nodes.following_node) {
            (TextPosition::Remaining, Some(_), Some(_)) => return None,
            (TextPosition::OwnLine, _, Some(following_node)) => Attachment::leading(following_node),
            (_, Some(preceding_node), _) => Attachment::trailing(preceding_node),
            (_, None, Some(following_node)) => Attachment::leading(following_node),
            (_, None, None) => Attachment::dangling(nodes.enclosing_node.unwrap_or(program)),
        },
    )
}

/// Prettier's `breakTies`. `ties` are consecutive comments between the same two nodes on one line. The ones at the end that
/// are separated from the following node only by whitespace and `(` become its leading comments. The rest become trailing
/// comments of the preceding node.
fn break_ties<'a>(
    cx: &AttachContext<'a, '_>,
    ties: &mut Vec<usize>,
    nodes: &[SurroundingNodes<'a>],
    attachments: &mut [Attachment<'a>],
) {
    let Some(&SurroundingNodes {
        preceding_node: Some(preceding_node),
        following_node: Some(following_node),
        ..
    }) = ties.first().and_then(|first| nodes.get(*first))
    else {
        return ties.clear();
    };
    let mut gap_end = cx.start_of(following_node);
    let mut first_leading = ties.len();
    while first_leading > 0 {
        let comment = cx.file.comment(ties[first_leading - 1] as u32).span();
        if !cx.is_gap(comment.end, gap_end) {
            break;
        }
        gap_end = comment.start;
        first_leading -= 1;
    }
    for (index, id) in ties.drain(..).enumerate() {
        (attachments[id].owner, attachments[id].placement) = match index < first_leading {
            true => (preceding_node, Placement::Trailing),
            false => (following_node, Placement::Leading),
        };
    }
}

/// `cast_parens`: see [`super::comments::cast_parens`].
pub(crate) fn attach<'a>(
    file: &'a File<'a>,
    cast_parens: &[u32],
    options: Options,
) -> Attached<'a> {
    let cx = AttachContext::new(file, cast_parens, options);
    let program = cx.program();
    let nodes = cx.surrounding_nodes_of_all_comments();
    let mut attached = Attached {
        attachments: vec![Attachment::dangling(program); nodes.len()],
        ..Attached::default()
    };
    let mut ties: Vec<usize> = Vec::new();
    for (id, comment) in file.comments_by_id().enumerate() {
        let context = CommentContext {
            comment,
            is_ignore_comment: comment.is_ignore_comment(options.flavor),
            text_position: text_position(file, &nodes, id),
            nodes: nodes[id],
            is_last_comment: id + 1 == nodes.len(),
        };
        attached.has_ignore_comments |= context.is_ignore_comment;
        let mut ignored_node = None;
        let attachment = rules::handle_comment(&cx, &context, &mut ignored_node)
            .or_else(|| attach_by_text_position(context.text_position, &context.nodes, program));
        attached.attachments[id].is_unignored = ignored_node.is_some();
        attached.attachments[id].ignores_owner =
            context.is_ignore_comment && ignored_node.is_none();
        attached.ignored_nodes.extend(ignored_node);
        let Some(attachment) = attachment else {
            let starts_new_run = (ties.last())
                .is_some_and(|last| nodes[*last].following_node != nodes[id].following_node);
            if starts_new_run {
                break_ties(&cx, &mut ties, &nodes, &mut attached.attachments);
            }
            ties.push(id);
            continue;
        };
        let SurroundingNodes {
            enclosing_node,
            preceding_node,
            following_node,
        } = nodes[id];
        let nearby = [
            enclosing_node,
            preceding_node,
            following_node,
            Some(program),
        ];
        if !nearby.contains(&Some(attachment.owner)) {
            (attached.relocated_owner_starts).push(cx.start_of(attachment.owner));
        }
        // `interface A {⏎ // prettier-ignore ⏎}`: for oxfmt a comment in an empty node ignores nothing.
        let is_unignored = ignored_node.is_some()
            || attachment.is_unignored
            || (options.flavor.is_oxfmt() && attachment.placement == Placement::Dangling);
        attached.attachments[id] = Attachment {
            is_unignored,
            ignores_owner: context.is_ignore_comment && !is_unignored,
            ..attachment
        };
    }
    break_ties(&cx, &mut ties, &nodes, &mut attached.attachments);
    let ignored_starts = attached.ignored_nodes.iter().map(|node| cx.start_of(*node));
    attached.relocated_owner_starts.extend(ignored_starts);
    crate::sort::sort(&mut attached.relocated_owner_starts);
    attached
}
