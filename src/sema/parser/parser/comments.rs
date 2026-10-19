//! `Options::attach_comments`: finds the nodes around each comment while parsing.
//!
//! For every comment this fills in `enclosing_node`, `preceding_node` and `following_node` of [`Comment`].
//!
//! How it works: the parser calls [`Parser::finish_node`] each time it finishes a node. A comment is "pending" from the
//! moment the lexer scans it until a node that contains it is finished. Nodes finish from the inside out, so the first
//! such node is the smallest one: the enclosing node. While a comment is pending, every finished node that ends before
//! it is a candidate for the preceding node, and every finished node that starts after it is a candidate for the
//! following node. The closest candidate wins, and the larger one if two are equally close.
//!
//! A finished node is only compared with the closest pending comment before it. Say comment 1 is before comment 2,
//! which is before the node. Either the enclosing node of 2 starts after 1, and then that node is closer to 1. Or it's
//! the enclosing node of 1 too, and then 1 takes the following node of 2 if nothing starts between them. So nested code
//! with a comment at each level takes linear time.
//!
//! This only compares offsets. It knows nothing about the grammar.
//!
//! All of it is behind the [`Parser`]'s `COMMENTS` parameter, so callers that don't need these nodes run code compiled
//! without it.

use super::{Checkpoint, Parser};
use bun_sema::atom::Atom;
use bun_sema::hir::*;

/// A finished node that could be the preceding or the following node of a comment.
#[derive(Copy, Clone, Default)]
struct Candidate {
    node: NodeOrName,
    start: u32,
    end: u32,
}

impl Candidate {
    #[inline(always)]
    fn is_none(self) -> bool {
        self.node == NodeOrName::None
    }

    /// An identifier can be reported both as a name and as the node that consists of it. The node wins.
    #[inline(always)]
    fn is_name_of(self, other: Candidate) -> bool {
        matches!(self.node, NodeOrName::Name(_))
            && matches!(other.node, NodeOrName::Node(_))
            && (self.start, self.end) == (other.start, other.end)
    }

    /// Both end before the comment. The better one ends later. If they end at the same offset, one contains the other,
    /// and the outer one is better.
    #[inline(always)]
    fn is_better_preceding_node_than(self, other: Candidate) -> bool {
        if self.is_name_of(other) {
            return false;
        }
        other.is_none()
            || self.end > other.end
            || (self.end == other.end && self.start <= other.start)
    }

    /// Both start after the comment. The better one starts earlier, or is the outer one.
    #[inline(always)]
    fn is_better_following_node_than(self, other: Candidate) -> bool {
        if self.is_name_of(other) {
            return false;
        }
        other.is_none()
            || self.start < other.start
            || (self.start == other.start && self.end >= other.end)
    }

    #[inline(always)]
    fn is_inside(self, start: u32, end: u32) -> bool {
        self.start >= start && self.end <= end
    }
}

/// The comments between two tokens, whose enclosing node isn't finished yet. Nodes start and end at tokens, so all of
/// these comments have the same surrounding nodes.
#[derive(Copy, Clone)]
struct PendingComments {
    first_id: u32,
    count: u32,
    /// Where the first one starts.
    start: u32,
    preceding: Candidate,
    following: Candidate,
}

/// The index of the last element of a growing list that meets a condition. Each call only looks at the elements added
/// since the previous call, so a long run of elements that don't meet the condition isn't rescanned every time.
#[derive(Default)]
struct LastMatch {
    checked_len: usize,
    index: Option<usize>,
}

impl LastMatch {
    fn update<T>(&mut self, list: &[T], meets_condition: impl Fn(&T) -> bool) -> Option<usize> {
        self.truncate(list.len());
        let added = list.get(self.checked_len..).unwrap_or_default();
        if let Some(position) = added.iter().rposition(meets_condition) {
            self.index = Some(self.checked_len + position);
        }
        self.checked_len = list.len();
        self.index
    }

    /// Call when the list is truncated to `len` elements.
    #[inline(always)]
    fn truncate(&mut self, len: usize) {
        if self.checked_len > len {
            *self = LastMatch::default();
        }
    }
}

#[derive(Default)]
pub(crate) struct CommentTracker {
    /// Sorted by id, which is source order.
    pending: Vec<PendingComments>,
    /// See `finish_list!`. The last pending comments, in reverse order. Empty at any other time.
    set_aside: Vec<PendingComments>,
    /// How many of the lexer's comments have been added to `pending` so far.
    tracked_count: u32,
    /// The previous value of every pending comment that was changed or removed, so that a rollback can restore it.
    undo_log: Vec<PendingComments>,
    /// Start and end of the last identifier that was parsed as a name.
    last_name: (u32, u32),
    /// The last node that changed a pending comment, and the length of `undo_log` before it did. See
    /// [`Parser::unfinish_node`].
    last_finished: (NodeOrName, usize),
    /// A hole in an array literal and the `{}` of `<a>{}</a>` are zero-width expressions.
    last_expr_with_width: LastMatch,
    last_non_empty_stmt: LastMatch,
}

impl CommentTracker {
    /// Restores the pending comments to what they were when `undo_log` had `len` entries, except for the comments from
    /// `discarded_from` on.
    fn undo_until(&mut self, len: usize, discarded_from: u32) {
        while self.undo_log.len() > len {
            let Some(previous) = self.undo_log.pop() else {
                break;
            };
            if previous.first_id >= discarded_from {
                continue;
            }
            let pending = &mut self.pending;
            match pending.binary_search_by_key(&previous.first_id, |comments| comments.first_id) {
                Ok(index) => pending[index] = previous,
                Err(index) => pending.insert(index, previous),
            }
        }
        self.last_finished = (NodeOrName::None, 0);
    }

    /// The fast path. Most finished nodes that matter are either after the last pending comments, or before them and no
    /// closer to the comments before those. In both cases only one candidate of the last pending comments can change.
    /// Returns false for any other node.
    #[inline(always)]
    fn update_only_last_pending_comments(&mut self, finished: Candidate) -> bool {
        let Some((last, earlier)) = self.pending.split_last_mut() else {
            return false;
        };
        let is_after_last = finished.start > last.start;
        // The earlier comments already have a following node that starts before `finished`, so `finished` isn't closer
        // to them.
        let is_only_before_last = finished.end <= last.start
            && (earlier.last()).is_none_or(|comments| {
                !comments.following.is_none() && comments.following.start < finished.start
            });
        if !is_after_last && !is_only_before_last {
            return false;
        }
        self.last_finished = (finished.node, self.undo_log.len());
        let is_better = match is_after_last {
            true => finished.is_better_following_node_than(last.following),
            false => finished.is_better_preceding_node_than(last.preceding),
        };
        if is_better {
            self.undo_log.push(*last);
            match is_after_last {
                true => last.following = finished,
                false => last.preceding = finished,
            }
        }
        true
    }

    /// The slow path, for a node that [`CommentTracker::update_only_last_pending_comments`] returned false for. The
    /// node isn't empty. `comments` is all of the file's comments so far.
    #[inline(never)]
    fn update_all_pending_comments(&mut self, finished: Candidate, comments: &mut [Comment]) {
        let Candidate { node, start, end } = finished;
        self.last_finished = (node, self.undo_log.len());
        let CommentTracker {
            pending, undo_log, ..
        } = self;

        // `pending` is in source order: comments before the node, inside it, and after it.
        let after_node = match pending.last() {
            Some(last) if last.start >= end => {
                pending.partition_point(|comment| comment.start < end)
            }
            _ => pending.len(),
        };
        // The preceding node of a later comment ends at least as late as that of an earlier one. So if the node isn't
        // better for one comment, it isn't better for the comments after it either. Without this, a long list in which
        // every element has a comment would take quadratic time, because its elements are finished after the whole
        // list.
        for comment in pending.get_mut(after_node..).unwrap_or_default() {
            if !finished.is_better_preceding_node_than(comment.preceding) {
                break;
            }
            undo_log.push(*comment);
            comment.preceding = finished;
        }

        let mut index = after_node;
        while index > 0 && pending[index - 1].start >= start {
            index -= 1;
        }
        if index < after_node {
            // A candidate outside the enclosing node isn't one of its children.
            let child_or_none = |candidate: Candidate| match candidate.is_inside(start, end) {
                true => candidate.node,
                false => NodeOrName::None,
            };
            let mut following = Candidate::default();
            for comment in pending.drain(index..after_node).rev() {
                undo_log.push(comment);
                if !comment.following.is_none() {
                    following = comment.following;
                }
                let ids = comment.first_id as usize..(comment.first_id + comment.count) as usize;
                for resolved in comments.get_mut(ids).unwrap_or_default() {
                    resolved.enclosing_node = node;
                    resolved.preceding_node = child_or_none(comment.preceding);
                    resolved.following_node = child_or_none(following);
                }
            }
        }

        if let Some(comment) = index.checked_sub(1).and_then(|last| pending.get_mut(last))
            && finished.is_better_following_node_than(comment.following)
        {
            undo_log.push(*comment);
            comment.following = finished;
        }
    }

    /// Drops the comments from `first_id` on. They're added again when the next node is finished.
    fn discard_comments_from(&mut self, first_id: u32) {
        let keep_len = (self.pending).partition_point(|comments| comments.first_id < first_id);
        self.pending.truncate(keep_len);
        self.tracked_count = first_id;
    }
}

/// The part of a [`Checkpoint`] that belongs to the [`CommentTracker`].
#[derive(Copy, Clone, Default)]
pub(crate) struct CommentCheckpoint {
    tracked_count: u32,
    undo_log_len: u32,
    last_name: (u32, u32),
}

/// An element of one of the parser's temporary stacks. List elements such as properties and parameters stay on a stack
/// until the whole list is parsed, and only then get their ids.
pub(crate) trait ListElement {
    /// Returns the node at `index` of its list, with its start and end, or `None` if this kind of element isn't a node.
    fn as_node(&self, index: u32, file: &FileBuilder) -> Option<(NodeData, u32, u32)>;
}

macro_rules! list_elements {
    ($($ty:ty => |$element:ident, $index:ident, $file:ident| $node:expr,)*) => {
        $(impl ListElement for $ty {
            #[inline(always)]
            fn as_node(&self, $index: u32, $file: &FileBuilder) -> Option<(NodeData, u32, u32)> {
                let $element = self;
                $node
            }
        })*
    };
}

list_elements! {
    VarDecl => |decl, index, file| {
        let start = file.pats.get(decl.pat.idx())?.pos;
        Some((NodeData::VarDecl(VarDeclId(index)), start, decl.loc.end))
    },
    Param => |param, index, _file| Some((NodeData::Param(ParamId(index)), param.pos, param.loc.end)),
    TypeParam => |param, index, _file| {
        Some((NodeData::TypeParam(TypeParamId(index)), param.start, param.end))
    },
    Prop => |prop, index, _file| Some((NodeData::Prop(PropId(index)), prop.start, prop.end)),
    Member => |member, index, _file| {
        Some((NodeData::Member(MemberId(index)), member.start, member.loc.end))
    },
    Case => |case, index, _file| Some((NodeData::Case(CaseId(index)), case.pos, case.end)),
    PatProp => |prop, index, _file| Some((NodeData::PatProp(PatPropId(index)), prop.pos, prop.end)),
    PatElem => |elem, index, _file| Some((NodeData::PatElem(PatElemId(index)), elem.start, elem.end)),
    EnumMember => |member, index, _file| {
        Some((NodeData::EnumMember(EnumMemberId(index)), member.pos, member.loc.end))
    },
    ImportSpec => |spec, index, _file| {
        Some((NodeData::ImportSpec(ImportSpecId(index)), spec.start, spec.end))
    },
    ExportSpec => |spec, index, _file| {
        Some((NodeData::ExportSpec(ExportSpecId(index)), spec.start, spec.end))
    },
    TupleElem => |elem, index, _file| {
        Some((NodeData::TupleElem(TupleElemId(index)), elem.start, elem.end))
    },
    u32 => |_element, _index, _file| None,
    Modifier => |_element, _index, _file| None,
    (Atom, u32) => |_element, _index, _file| None,
}

/// Calls [`Parser::finish_node`] for the `len` elements that `take_span!` just moved into the list `$field`, starting
/// at index `start`. The elements are in source order, so if the first one starts too late to matter, they all do.
///
/// At this point the whole list's comments are pending. Finishing an element removes the comments inside it from
/// `pending`, which shifts everything after them. So the elements are finished last to first, and the comments after a
/// finished element are set aside, since no earlier element is closer to them. That way removals always happen at the
/// end, and a list of thousands of elements with comments takes linear time.
macro_rules! finish_list {
    ($p:expr, $field:ident, $start:expr, $len:expr) => {{
        use $crate::parser::comments::ListElement;
        let (start, len): (u32, u32) = ($start, $len);
        if COMMENTS {
            let first = ($p.f.$field.get(start as usize)).and_then(|it| it.as_node(start, &$p.f));
            if first.is_some_and(|(_, node_start, _)| node_start <= $p.lx.max_relevant_node_start) {
                $p.finish_list_elements(start, len, |file, index| {
                    (file.$field.get(index as usize)).and_then(|it| it.as_node(index, file))
                });
            }
        }
    }};
}
pub(crate) use finish_list;

impl<const GENERAL: bool, const COMMENTS: bool> Parser<'_, GENERAL, COMMENTS> {
    /// Must be called for every node, before the node is pushed to its list. This is on the hot path. It's one
    /// comparison unless the node can affect a pending comment.
    #[inline(always)]
    pub(crate) fn finish_node(&mut self, node: NodeData, start: u32, end: u32) {
        if COMMENTS && start <= self.lx.max_relevant_node_start {
            self.update_pending_comments(NodeOrName::Node(node), start, end);
        }
    }

    #[inline(always)]
    pub(crate) fn finish_statement(&mut self, id: StmtId, kind: &StmtKind, start: u32, end: u32) {
        if COMMENTS && start <= self.lx.max_relevant_node_start {
            self.update_pending_comments_for_statement(id, kind, start, end);
        }
    }

    /// Call after consuming an identifier that is a name. Names are fields of nodes in the HIR, but nodes in ESTree.
    #[inline(always)]
    pub(crate) fn finish_name(&mut self, start: u32, end: u32) {
        if !COMMENTS {
            return;
        }
        if start <= self.lx.max_relevant_node_start {
            self.update_pending_comments(NodeOrName::Name(start), start, end);
        }
        self.comments.last_name = (start, end);
    }

    /// True if the last call to [`Parser::finish_name`] was for a name that ends at `end`.
    #[inline(always)]
    pub(crate) fn has_finished_name_that_ends_at(&self, end: u32) -> bool {
        COMMENTS && self.comments.last_name.1 == end
    }

    /// Undoes [`Parser::finish_node`] for the most recently finished node.
    ///
    /// Call it when the parser removes that node because it turns out to be something else. For example, the `a` of
    /// `a: b` is parsed as an expression before the `:` shows that it's a label. The removed node's id will be reused,
    /// so no comment may keep it. Also call it for a node that stays but isn't a node in ESTree, or has a different
    /// range there.
    #[inline(always)]
    pub(crate) fn unfinish_node(&mut self, node: NodeData) {
        if COMMENTS && self.comments.last_finished.0 == NodeOrName::Node(node) {
            self.undo_last_finished_node();
        }
    }

    /// Removes the last expression, which nothing refers to.
    #[inline(always)]
    pub(crate) fn pop_expr(&mut self) -> Option<Expr> {
        let last = self.f.exprs.len().saturating_sub(1);
        if COMMENTS {
            self.unfinish_node(NodeData::Expr(ExprId(last as u32)));
            self.comments.last_expr_with_width.truncate(last);
        }
        if (self.f.far_names.last()).is_some_and(|it| it.0.idx() == last) {
            self.f.far_names.pop();
        }
        self.f.exprs.pop()
    }

    /// Removes the last type, which nothing refers to.
    #[inline(always)]
    pub(crate) fn pop_type(&mut self) -> Option<TypeNode> {
        let last = TypeNodeId(self.f.types.len().saturating_sub(1) as u32);
        self.unfinish_node(NodeData::Type(last));
        self.f.types.pop()
    }

    /// The same for a word that was parsed as a name and turns out to be a keyword: `import type a = b`.
    #[inline(always)]
    pub(crate) fn unfinish_name(&mut self, start: u32) {
        if !COMMENTS {
            return;
        }
        if self.comments.last_finished.0 == NodeOrName::Name(start) {
            self.undo_last_finished_node();
        }
        if self.comments.last_name.0 == start {
            self.comments.last_name = (0, 0);
        }
    }

    #[cold]
    #[inline(never)]
    fn undo_last_finished_node(&mut self) {
        (self.comments).undo_until(self.comments.last_finished.1, u32::MAX);
        self.lx.max_relevant_node_start = u32::MAX;
    }

    #[inline(always)]
    pub(crate) fn add_pat(&mut self, kind: PatKind, start: u32, end: u32) -> PatId {
        self.finish_node(NodeData::Pat(PatId(self.f.pats.len() as u32)), start, end);
        self.f.pat(kind, start, end)
    }

    #[cold]
    #[inline(never)]
    fn update_pending_comments_for_statement(
        &mut self,
        id: StmtId,
        // Not by value, because the copy would sit in the frame of `Parser::statement` at every nesting level.
        kind: &StmtKind,
        start: u32,
        end: u32,
    ) {
        let kind = *kind;
        // Prettier never attaches a comment to a stray `;` in a statement list.
        if !self.options.attach_comments || matches!(kind, StmtKind::Empty) {
            return;
        }
        // It does attach to a `;` that is the body of another statement, as in `while (a) /* comment */;`.
        let bodies = match kind {
            StmtKind::If { yes, no, .. } => [yes, no],
            StmtKind::For { body, .. }
            | StmtKind::ForIn { body, .. }
            | StmtKind::ForOf { body, .. }
            | StmtKind::While { body, .. }
            | StmtKind::DoWhile { body, .. }
            | StmtKind::Labeled { body, .. } => [body, StmtId::NONE],
            // `with (a) b` is stored as a block of `a` and `b`.
            StmtKind::Block(statements)
                if (self.f.with_bodies.last()).is_some_and(|&(body_start, body_end)| {
                    body_start > start && body_end == end
                }) =>
            {
                [
                    self.f.ids(statements).last().unwrap_or(StmtId::NONE),
                    StmtId::NONE,
                ]
            }
            _ => [StmtId::NONE; 2],
        };
        for body in bodies {
            if let Some(&Stmt {
                kind: StmtKind::Empty,
                start,
                loc,
                ..
            }) = self.f.stmts.get(body.idx())
            {
                self.update_pending_comments(
                    NodeOrName::Node(NodeData::Stmt(body)),
                    start,
                    loc.end,
                );
            }
        }
        let end = self.end_without_semicolon(kind, end);
        self.update_pending_comments(NodeOrName::Node(NodeData::Stmt(id)), start, end);
    }

    /// Prettier treats the `;` that terminates a JavaScript statement as outside the statement, so a comment right
    /// before the `;` comes after the statement. Such a comment has recorded where the statement's last real token
    /// ends.
    fn end_without_semicolon(&self, mut kind: StmtKind, end: u32) -> u32 {
        if self.lx.src.get((end as usize).wrapping_sub(1)) != Some(&b';') {
            return end;
        }
        // Statements like `if (a) b;` end where their last child statement ends.
        loop {
            let last_child = match kind {
                StmtKind::Debugger
                | StmtKind::Expr(_)
                | StmtKind::Var(_)
                | StmtKind::Return(_)
                | StmtKind::DoWhile { .. }
                | StmtKind::Throw(_)
                | StmtKind::Break(_)
                | StmtKind::Continue(_)
                | StmtKind::Import(_)
                | StmtKind::ExportNamed(_)
                | StmtKind::ExportStar { .. }
                | StmtKind::ExportDefault(_) => break,
                StmtKind::If { yes, no, .. } if no.is_none() => yes,
                StmtKind::If { no: body, .. }
                | StmtKind::For { body, .. }
                | StmtKind::ForIn { body, .. }
                | StmtKind::ForOf { body, .. }
                | StmtKind::While { body, .. }
                | StmtKind::Labeled { body, .. } => body,
                // `with (a) b;` is stored as a block of `a` and `b;`. A real block ends with `}`, so it isn't affected.
                StmtKind::Block(statements) => match self.f.ids(statements).last() {
                    Some(last) => last,
                    None => return end,
                },
                _ => return end,
            };
            match self.f.stmts.get(last_child.idx()) {
                Some(statement) => kind = statement.kind,
                None => return end,
            }
        }
        let last_comment = self.lx.comments.iter().rfind(|comment| comment.pos < end);
        match last_comment {
            Some(comment)
                if comment.next_token_start + 1 == end
                    && self.lx.src.get(comment.next_token_start as usize) == Some(&b';') =>
            {
                comment.prev_token_end
            }
            _ => end,
        }
    }

    /// Call before moving a finished node's end. The comments after it aren't processed until the next node is
    /// finished, and by then they'd be inside this one.
    #[inline(always)]
    pub(crate) fn before_node_grows(&mut self) {
        if COMMENTS && self.options.attach_comments {
            self.add_new_pending_comments(Candidate::default());
        }
    }

    /// Adds the comments that the lexer has scanned since the last call. `finished` is the node being finished.
    #[inline(always)]
    fn add_new_pending_comments(&mut self, finished: Candidate) {
        if self.comments.tracked_count as usize != self.lx.comments.len() {
            self.add_pending_comments_since(self.comments.tracked_count as usize, finished);
        }
    }

    #[inline(never)]
    fn add_pending_comments_since(&mut self, first_new: usize, finished: Candidate) {
        // The usual case, `a; // comment`: the node being finished ends at the token before the comments. No node ends
        // later, and this one contains every node that ended there earlier, so it's the preceding node. The caller sets
        // it.
        // This doesn't apply to an expression or a type: [`Parser::unfinish_node`] would leave the comments without the
        // previous best node. The only other node that gets unfinished is the inner statement of `namespace a.b {}`,
        // and the outer one ends at the same offset.
        if let Some(first) = self.lx.comments.get(first_new)
            && first.prev_token_end == finished.end
            && finished.start < finished.end
            && matches!(finished.node, NodeOrName::Node(node)
                if !matches!(node, NodeData::Expr(_) | NodeData::Type(_)))
            && (self.lx.comments.last())
                .is_some_and(|last| last.next_token_start == first.next_token_start)
        {
            self.comments.pending.push(PendingComments {
                first_id: first_new as u32,
                count: (self.lx.comments.len() - first_new) as u32,
                start: first.pos,
                preceding: Candidate::default(),
                following: Candidate::default(),
            });
            self.comments.tracked_count = self.lx.comments.len() as u32;
            return;
        }
        self.add_pending_comments_after_any_node(first_new);
    }

    /// No node was finished since the lexer scanned the comments, so the best preceding node so far is the most
    /// recently finished node, which is the last element of one of the node lists.
    #[inline(never)]
    fn add_pending_comments_after_any_node(&mut self, first_new: usize) {
        fn last_index<T>(list: &[T]) -> u32 {
            list.len().saturating_sub(1) as u32
        }
        let file = &self.f;
        let last_expr = (self.comments.last_expr_with_width).update(&file.exprs, |e| e.pos < e.end);
        let last_stmt = (self.comments.last_non_empty_stmt).update(&file.stmts, |statement| {
            !matches!(statement.kind, StmtKind::Empty)
        });
        let (name_start, name_end) = self.comments.last_name;
        // A list element can end with a name: the `B` of `<B>(/* comment */ c) => d` is a type parameter.
        macro_rules! last_elements {
            ($($field:ident)*) => {
                [$((file.$field.last())
                    .and_then(|element| element.as_node(last_index(&file.$field), file))),*]
            };
        }
        let best_node_before = |comment_start: u32| {
            let mut best = Candidate::default();
            let consider = |best: &mut Candidate, node: NodeOrName, start: u32, end: u32| {
                let candidate = Candidate { node, start, end };
                if start < end
                    && end <= comment_start
                    && candidate.is_better_preceding_node_than(*best)
                {
                    *best = candidate;
                }
            };
            // The name comes first so that a node with the same range replaces it.
            consider(
                &mut best,
                NodeOrName::Name(name_start),
                name_start,
                name_end,
            );
            if let Some((index, e)) =
                last_expr.and_then(|index| Some((index, file.exprs.get(index)?)))
            {
                let node = NodeData::Expr(ExprId(index as u32));
                consider(&mut best, NodeOrName::Node(node), e.pos, e.end);
            }
            if let Some((index, statement)) =
                last_stmt.and_then(|index| Some((index, file.stmts.get(index)?)))
            {
                let node = NodeData::Stmt(StmtId(index as u32));
                consider(
                    &mut best,
                    NodeOrName::Node(node),
                    statement.start,
                    statement.loc.end,
                );
            }
            if let Some(ty) = file.types.last() {
                let node = NodeData::Type(TypeNodeId(last_index(&file.types)));
                consider(&mut best, NodeOrName::Node(node), ty.pos, ty.end);
            }
            if let Some(pat) = file.pats.last() {
                let node = NodeData::Pat(PatId(last_index(&file.pats)));
                consider(&mut best, NodeOrName::Node(node), pat.pos, pat.end);
            }
            if matches!(best.node, NodeOrName::Name(_)) {
                let last_list_elements = last_elements!(
                    var_decls params type_params props members cases pat_props pat_elems
                    enum_members import_specs export_specs tuple_elems
                );
                for (node, start, end) in last_list_elements.into_iter().flatten() {
                    consider(&mut best, NodeOrName::Node(node), start, end);
                }
            }
            best
        };
        let mut new_comments = self.lx.comments.get(first_new..).unwrap_or_default();
        let mut first_id = first_new as u32;
        while let Some(first) = new_comments.first() {
            let count = (new_comments.iter())
                .take_while(|comment| comment.next_token_start == first.next_token_start)
                .count();
            self.comments.pending.push(PendingComments {
                first_id,
                count: count as u32,
                start: first.pos,
                preceding: best_node_before(first.pos),
                following: Candidate::default(),
            });
            new_comments = new_comments.get(count..).unwrap_or_default();
            first_id += count as u32;
        }
        self.comments.tracked_count = self.lx.comments.len() as u32;
    }

    /// Called when a node from `start` to `end` is finished. The call is cold for `bun lint` and `bun check`, which
    /// never make it. The work is in a separate function so that it isn't optimized as cold code.
    #[cold]
    #[inline(never)]
    fn update_pending_comments(&mut self, node: NodeOrName, start: u32, end: u32) {
        if self.options.attach_comments {
            self.update_pending_comments_for_node(node, start, end);
        }
    }

    #[inline(never)]
    fn update_pending_comments_for_node(&mut self, node: NodeOrName, start: u32, end: u32) {
        let finished = Candidate { node, start, end };
        self.add_new_pending_comments(finished);
        if start < end && self.comments.update_only_last_pending_comments(finished) {
            return self.update_max_relevant_node_start();
        }
        if start < end {
            (self.comments).update_all_pending_comments(finished, &mut self.lx.comments);
        }
        self.update_max_relevant_node_start();
    }

    /// See `finish_list!`. Not inlined, because lists are finished in recursive functions and inlining would add this
    /// function's stack usage to every nesting level.
    #[inline(never)]
    pub(crate) fn finish_list_elements(
        &mut self,
        start: u32,
        len: u32,
        as_node: impl Fn(&FileBuilder, u32) -> Option<(NodeData, u32, u32)>,
    ) {
        for index in (start..start + len).rev() {
            if let Some((node, node_start, node_end)) = as_node(&self.f, index) {
                self.finish_node(node, node_start, node_end);
                // A hole in an array has zero width and doesn't count as a comment's neighbor:
                // `[a, , /* comment */ b]`.
                if node_start < node_end {
                    self.set_aside_pending_comments_after(node_start);
                }
            }
        }
        self.put_back_pending_comments();
    }

    fn set_aside_pending_comments_after(&mut self, start: u32) {
        let CommentTracker {
            pending, set_aside, ..
        } = &mut self.comments;
        while let Some(comments) = pending.pop_if(|comments| comments.start >= start) {
            set_aside.push(comments);
        }
        self.update_max_relevant_node_start();
    }

    fn put_back_pending_comments(&mut self) {
        let CommentTracker {
            pending, set_aside, ..
        } = &mut self.comments;
        pending.extend(set_aside.drain(..).rev());
        self.update_max_relevant_node_start();
    }

    /// A node that starts after the following node of the last pending comment isn't inside, before or directly after
    /// any pending comment, so [`Parser::finish_node`] can skip it.
    fn update_max_relevant_node_start(&mut self) {
        self.lx.max_relevant_node_start = match self.comments.pending.last() {
            None => 0,
            Some(comment) if comment.following.is_none() => u32::MAX,
            Some(comment) => comment.following.start,
        };
    }

    /// Call at the end of the file. The comments that are still pending aren't inside any node.
    pub(crate) fn resolve_top_level_comments(&mut self) {
        if !COMMENTS || !self.options.attach_comments {
            return;
        }
        self.add_new_pending_comments(Candidate::default());
        let mut following = NodeOrName::None;
        for comment in self.comments.pending.drain(..).rev() {
            if !comment.following.is_none() {
                following = comment.following.node;
            }
            let ids = comment.first_id as usize..(comment.first_id + comment.count) as usize;
            for resolved in self.lx.comments.get_mut(ids).unwrap_or_default() {
                resolved.enclosing_node = NodeOrName::None;
                resolved.preceding_node = comment.preceding.node;
                resolved.following_node = following;
            }
        }
        self.comments.undo_log.clear();
        self.comments.last_finished = (NodeOrName::None, 0);
    }

    #[inline(always)]
    pub(crate) fn comment_checkpoint(&self) -> CommentCheckpoint {
        if !COMMENTS {
            return CommentCheckpoint::default();
        }
        CommentCheckpoint {
            tracked_count: self.comments.tracked_count,
            undo_log_len: self.comments.undo_log.len() as u32,
            last_name: self.comments.last_name,
        }
    }

    pub(crate) fn rollback_comments(&mut self, to: &Checkpoint) {
        if !COMMENTS || !self.options.attach_comments {
            return;
        }
        // Comments that were first seen after the checkpoint will be seen again. There can be thousands, so drop them
        // without restoring them first.
        (self.comments).discard_comments_from(to.comments.tracked_count);
        (self.comments).undo_until(to.comments.undo_log_len as usize, to.comments.tracked_count);
        self.comments
            .last_expr_with_width
            .truncate(self.f.exprs.len());
        self.comments
            .last_non_empty_stmt
            .truncate(self.f.stmts.len());
        self.comments.last_name = to.comments.last_name;
        self.lx.max_relevant_node_start = u32::MAX;
    }
}
