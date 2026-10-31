//! Attaches every comment to a node before printing starts. This is Prettier's `attachComments`.
//!
//! 1. The parser has already recorded the nodes around each comment ([`bun_lint::ast::comments::Comment`]).
//!    [`surrounding_nodes`] converts them to the nodes the printers use.
//! 2. [`rules`] has the special cases from Prettier's `handle-comments.js`.
//! 3. Any other comment is attached by its position in the line: a comment on its own line becomes a leading comment of
//!    the following node, and a comment at the end of a line becomes a trailing comment of the preceding node.
//!
//! Nothing here searches the tree. The only source text the rules read is the byte at an offset the lexer recorded, to
//! tell which token comes before or after a comment.

mod debug;
mod flow;
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

/// Prettier's `comment.marker`. It distinguishes dangling comments of one node that are printed in different places.
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
    /// Before the `mixins` keyword of Flow's `declare class`.
    Mixins,
    /// In the `</>` of a fragment, which is a node for Prettier. A comment in the `<>` has no marker.
    ClosingFragment,
    /// The comment is inside an ignored node, so it's copied along with the node's source text. Prettier doesn't attach
    /// such a comment at all.
    InIgnoredNode,
}

/// The thing a comment is attached to.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub(crate) enum Owner<'a> {
    Node(AstNodes<'a>),
    /// An identifier or a literal key, given by its start offset. For Prettier it's an `Identifier` or `Literal` node.
    Name(u32),
    /// The parentheses after a `/** @type {T} */` cast: the expression inside them and the offset of the `(`. For
    /// Prettier it's Babel's `ParenthesizedExpression` node.
    CastParens(Expr<'a>, u32),
}

#[derive(Copy, Clone, Debug)]
pub(crate) struct Attachment<'a> {
    pub(crate) owner: Owner<'a>,
    pub(crate) placement: Placement,
    pub(crate) marker: Marker,
    /// Prettier's `comment.unignore`: a `prettier-ignore` comment that doesn't apply to its owner.
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
    /// Sorted start offsets of the owners that aren't next to their comment, or don't contain their dangling comment.
    /// If a node's span contains neither a comment nor one of these offsets, nothing inside it owns a comment.
    pub(crate) relocated_owner_starts: Vec<u32>,
    pub(crate) has_ignore_comments: bool,
}

#[derive(Copy, Clone)]
pub(crate) struct Options {
    /// Prettier would parse this file with Babel instead of typescript-estree. Their trees differ in a few places.
    pub(crate) has_babel_tree: bool,
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

/// True if only spaces and tabs separate two consecutive comments.
fn are_on_same_line(first: Comment<'_>, second: Comment<'_>) -> bool {
    first.next_token_start() == second.next_token_start() && !second.has_newline_before()
}

/// Prettier's `isOwnLineComment` and `isEndOfLineComment`. A run of comments on one line that share the same preceding
/// (or following) node is classified as a whole.
///
/// Caches the run of the last comment looked up, so a long run is walked once instead of once per comment.
struct TextPositions {
    /// The comments from `.0` to `.1` are a run with the same preceding node.
    with_same_preceding_node: (usize, usize),
    /// Same, for the following node.
    with_same_following_node: (usize, usize),
}

impl TextPositions {
    const NOTHING_CACHED: TextPositions = TextPositions {
        with_same_preceding_node: (1, 0),
        with_same_following_node: (1, 0),
    };

    fn of<'a>(
        &mut self,
        file: &'a File<'a>,
        nodes: &[SurroundingNodes<'a>],
        id: usize,
    ) -> TextPosition {
        let comment = |id: usize| file.comment(id as u32);
        let (first, last) = self.with_same_preceding_node;
        if !(first <= id && id <= last) {
            let is_in_run = |id: usize| {
                are_on_same_line(comment(id - 1), comment(id))
                    && nodes[id - 1].preceding_node == nodes[id].preceding_node
            };
            let (mut first, mut last) = (id, id);
            if nodes[id].preceding_node.is_some() {
                while first > 0 && is_in_run(first) {
                    first -= 1;
                }
                while last + 1 < nodes.len() && is_in_run(last + 1) {
                    last += 1;
                }
            }
            self.with_same_preceding_node = (first, last);
        }
        if comment(self.with_same_preceding_node.0).has_newline_before() {
            return TextPosition::OwnLine;
        }
        let (first, last) = self.with_same_following_node;
        if !(first <= id && id <= last) {
            let mut last = id;
            while nodes[id].following_node.is_some()
                && last + 1 < nodes.len()
                && are_on_same_line(comment(last), comment(last + 1))
                && nodes[last + 1].following_node == nodes[id].following_node
            {
                last += 1;
            }
            self.with_same_following_node = (id, last);
        }
        match comment(self.with_same_following_node.1).has_newline_after() {
            true => TextPosition::EndOfLine,
            false => TextPosition::Remaining,
        }
    }
}

/// The default for a comment that no rule handles. Returns `None` for a comment between two nodes on the same line,
/// which [`break_ties`] decides.
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

/// Prettier's `breakTies`. `ties` are consecutive comments between the same two nodes on one line. The ones at the end
/// that are separated from the following node only by whitespace and `(` become its leading comments. The rest become
/// trailing comments of the preceding node.
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

/// True if an ignore comment that trails `owner` applies to it in the oxfmt flavor. For Prettier every comment of a
/// node counts. For oxfmt the comment has to come right after the node, with nothing but separators between them, and
/// end its line.
///
/// ```js
/// a  +  b; // prettier-ignore            is copied
/// f(a  +  b /* prettier-ignore */);      is formatted: the comment doesn't end its line
/// (a  +  b) // prettier-ignore           is formatted: a `)` is between the two
///   .c;
/// ```
fn trailing_ignore_comment_counts_for_oxfmt<'a>(
    cx: &AttachContext<'a, '_>,
    comment: Comment<'a>,
    owner: Owner<'a>,
    text_position: TextPosition,
) -> bool {
    let text = cx.file.text();
    let owner_end = match owner {
        // `span_of` returns an empty span for a name.
        Owner::Name(start) => {
            let name = text.get(start as usize..).unwrap_or_default();
            start as usize + bun_lint::tokens::token_len(name)
        }
        _ => cx.file.without_semicolon(cx.span_of(owner)).end as usize,
    };
    let between = (text.get(owner_end..comment.prev_token_end() as usize)).unwrap_or_default();
    text_position == TextPosition::EndOfLine
        && (between.iter()).all(|byte| matches!(byte, b' ' | b'\t' | b'=' | b':' | b',' | b';'))
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
    let mut text_positions = TextPositions::NOTHING_CACHED;
    for (id, comment) in file.comments_by_id().enumerate() {
        // The common case. See `AttachContext::list_elements_around`.
        if nodes[id].is_before_list_element
            && comment.has_newline_before()
            && let Some(following_node) = nodes[id].following_node
        {
            let ignores_owner = comment.is_ignore_comment(options.flavor);
            attached.has_ignore_comments |= ignores_owner;
            attached.attachments[id] = Attachment {
                ignores_owner,
                ..Attachment::leading(following_node)
            };
            continue;
        }
        let context = CommentContext {
            comment,
            is_ignore_comment: comment.is_ignore_comment(options.flavor),
            text_position: text_positions.of(file, &nodes, id),
            nodes: nodes[id],
            is_last_comment: id + 1 == nodes.len(),
        };
        attached.has_ignore_comments |= context.is_ignore_comment;
        let mut ignored_node = None;
        // `handleClosureTypeCastComments` is the only rule that doesn't check the enclosing node.
        let has_no_rule = context.nodes.is_before_list_element
            && (context.text_position != TextPosition::EndOfLine
                || !comment.looks_like_type_cast());
        let attachment = match has_no_rule {
            true => None,
            false => rules::handle_comment(&cx, &context, &mut ignored_node),
        }
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
            ..
        } = nodes[id];
        let nearby = [
            enclosing_node,
            preceding_node,
            following_node,
            Some(program),
        ];
        // `class A // comment ⏎ {}`: the comment dangles from the body but isn't inside it.
        let is_outside_of_owner = attachment.placement == Placement::Dangling
            && !cx.span_of(attachment.owner).contains(comment.span());
        if is_outside_of_owner || !nearby.contains(&Some(attachment.owner)) {
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
    if options.flavor.is_oxfmt() && attached.has_ignore_comments {
        for (id, comment) in file.comments_by_id().enumerate() {
            let attachment = &mut attached.attachments[id];
            if attachment.ignores_owner
                && attachment.placement == Placement::Trailing
                && !trailing_ignore_comment_counts_for_oxfmt(
                    &cx,
                    comment,
                    attachment.owner,
                    text_positions.of(file, &nodes, id),
                )
            {
                attachment.ignores_owner = false;
                attachment.is_unignored = true;
            }
        }
    }
    let ignored_starts = attached.ignored_nodes.iter().map(|node| cx.start_of(*node));
    attached.relocated_owner_starts.extend(ignored_starts);
    // `let a: /* comment */ | B`: the comment belongs to `B`, but the printers reach `B` through the union `| B`, which
    // doesn't contain the comment.
    let starts_in_unions = (attached.attachments.iter())
        .filter(|attachment| cx.is_only_member_of_union(attachment.owner))
        .map(|attachment| cx.start_of(attachment.owner));
    attached.relocated_owner_starts.extend(starts_in_unions);
    crate::sort::sort(&mut attached.relocated_owner_starts);
    attached
}
