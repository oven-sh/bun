//! `Options::attach_comments`: finds the nodes around each comment while parsing.
//!
//! For every comment this fills in `enclosing_node`, `preceding_node` and `following_node` of [`Comment`].
//!
//! How it works: the parser calls [`Parser::finish_node`] each time it finishes a node. A comment is "pending" from the
//! moment the lexer scans it until a node that contains it is finished. Nodes finish from the inside out, so the first
//! such node is the smallest one: the enclosing node. While a comment is pending, every finished node that ends before it
//! is a candidate for the preceding node, and every finished node that starts after it is a candidate for the following
//! node. The closest candidate wins, and the larger one if two are equally close.
//!
//! This only compares offsets. It knows nothing about the grammar.

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
    fn is_none(self) -> bool {
        self.node == NodeOrName::None
    }

    /// An identifier can be reported both as a name and as the node that consists of it. The node counts.
    fn is_name_of(self, other: Candidate) -> bool {
        matches!(self.node, NodeOrName::Name(_))
            && matches!(other.node, NodeOrName::Node(_))
            && (self.start, self.end) == (other.start, other.end)
    }

    /// Both end before the comment. The better one ends later. If they end at the same offset, one contains the other, and
    /// the outer one is better.
    fn is_better_preceding_node_than(self, other: Candidate) -> bool {
        if self.is_name_of(other) {
            return false;
        }
        other.is_none()
            || self.end > other.end
            || (self.end == other.end && self.start <= other.start)
    }

    /// Both start after the comment. The better one starts earlier, or is the outer one.
    fn is_better_following_node_than(self, other: Candidate) -> bool {
        if self.is_name_of(other) {
            return false;
        }
        other.is_none()
            || self.start < other.start
            || (self.start == other.start && self.end >= other.end)
    }

    fn is_inside(self, start: u32, end: u32) -> bool {
        self.start >= start && self.end <= end
    }
}

/// A comment whose enclosing node is not finished yet.
#[derive(Copy, Clone)]
struct PendingComment {
    id: u32,
    start: u32,
    preceding: Candidate,
    following: Candidate,
}

#[derive(Default)]
pub(crate) struct CommentTracker {
    /// Sorted by id, which is source order.
    pending: Vec<PendingComment>,
    /// How many comments of the lexer have been added to `pending` so far.
    tracked_count: u32,
    /// The previous value of every pending comment that was changed or removed, so that a rollback can restore it.
    undo_log: Vec<PendingComment>,
    /// Start and end of the last identifier that was parsed as a name.
    last_name: (u32, u32),
}

/// The part of a [`Checkpoint`] that belongs to the [`CommentTracker`].
#[derive(Copy, Clone, Default)]
pub(crate) struct CommentCheckpoint {
    tracked_count: u32,
    undo_log_len: u32,
    last_name: (u32, u32),
}

/// An element of one of the parser's temporary stacks. List elements such as properties and parameters stay on a stack until
/// the whole list is parsed, and only then get their ids.
pub(crate) trait ListElement {
    /// The node at `index` of its list, with its start and end. `None` if this kind of element is not a node.
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

/// Calls [`Parser::finish_node`] for the `len` elements that `take_span!` just moved into the list `$field`, starting at index
/// `start`. The elements are in source order, so if the first one starts too late to matter, they all do.
macro_rules! finish_list {
    ($p:expr, $field:ident, $start:expr, $len:expr) => {{
        use $crate::parser::comments::ListElement;
        let (start, len): (u32, u32) = ($start, $len);
        let first = ($p.f.$field.get(start as usize)).and_then(|it| it.as_node(start, &$p.f));
        if first.is_some_and(|(_, node_start, _)| node_start <= $p.lx.max_relevant_node_start) {
            for index in start..start + len {
                let node =
                    ($p.f.$field.get(index as usize)).and_then(|it| it.as_node(index, &$p.f));
                if let Some((node, node_start, node_end)) = node {
                    $p.finish_node(node, node_start, node_end);
                }
            }
        }
    }};
}
pub(crate) use finish_list;

impl<const GENERAL: bool> Parser<'_, GENERAL> {
    /// Must be called for every node, before the node is pushed to its list. This is on the hot path: it is one comparison
    /// unless the node can affect a pending comment.
    #[inline(always)]
    pub(crate) fn finish_node(&mut self, node: NodeData, start: u32, end: u32) {
        if start <= self.lx.max_relevant_node_start {
            self.update_pending_comments(NodeOrName::Node(node), start, end);
        }
    }

    #[inline(always)]
    pub(crate) fn finish_statement(&mut self, id: StmtId, kind: &StmtKind, start: u32, end: u32) {
        if start <= self.lx.max_relevant_node_start {
            self.update_pending_comments_for_statement(id, *kind, start, end);
        }
    }

    /// Call after consuming an identifier that is a name. Names are fields of nodes in the HIR, but nodes in ESTree.
    #[inline(always)]
    pub(crate) fn finish_name(&mut self, start: u32, end: u32) {
        if start <= self.lx.max_relevant_node_start {
            self.update_pending_comments(NodeOrName::Name(start), start, end);
        }
        self.comments.last_name = (start, end);
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
        kind: StmtKind,
        start: u32,
        end: u32,
    ) {
        // Prettier never attaches a comment to a stray `;` in a list of statements.
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

    /// Prettier treats the `;` that terminates a JavaScript statement as outside the statement, so a comment right before the
    /// `;` comes after the statement. Such a comment has recorded where the statement's last real token ends.
    fn end_without_semicolon(&mut self, mut kind: StmtKind, end: u32) -> u32 {
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
                // `with (a) b;` is stored as a block of `a` and `b;`. A real block ends with `}`, so it is not affected.
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
        self.add_new_pending_comments();
        let last_comment = (self.comments.pending.iter())
            .rfind(|comment| comment.start < end)
            .and_then(|comment| self.lx.comments.get(comment.id as usize));
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

    /// Adds the comments that the lexer has scanned since the last call. No node was finished in between, so the best
    /// preceding node so far is the most recently finished node, which is the last element of one of the node lists.
    fn add_new_pending_comments(&mut self) {
        let first_new = self.comments.tracked_count as usize;
        if first_new == self.lx.comments.len() {
            return;
        }
        fn candidate(node: NodeData, start: u32, end: u32) -> Candidate {
            Candidate {
                node: NodeOrName::Node(node),
                start,
                end,
            }
        }
        fn last_index<T>(list: &[T]) -> u32 {
            list.len().saturating_sub(1) as u32
        }
        let file = &self.f;
        let (name_start, name_end) = self.comments.last_name;
        // The name comes first so that a node with the same range replaces it.
        let last_finished = [
            Some(Candidate {
                node: NodeOrName::Name(name_start),
                start: name_start,
                end: name_end,
            }),
            (file.exprs.last()).map(|e| {
                candidate(
                    NodeData::Expr(ExprId(last_index(&file.exprs))),
                    e.pos,
                    e.end,
                )
            }),
            (file.stmts.iter().enumerate())
                .rfind(|(_, statement)| !matches!(statement.kind, StmtKind::Empty))
                .map(|(index, statement)| {
                    let id = StmtId(index as u32);
                    candidate(NodeData::Stmt(id), statement.start, statement.loc.end)
                }),
            (file.types.last()).map(|ty| {
                candidate(
                    NodeData::Type(TypeNodeId(last_index(&file.types))),
                    ty.pos,
                    ty.end,
                )
            }),
            (file.pats.last()).map(|pat| {
                candidate(
                    NodeData::Pat(PatId(last_index(&file.pats))),
                    pat.pos,
                    pat.end,
                )
            }),
        ];
        for id in first_new..self.lx.comments.len() {
            let start = self.lx.comments[id].pos;
            let mut preceding = Candidate::default();
            for candidate in last_finished.into_iter().flatten() {
                if candidate.start < candidate.end
                    && candidate.end <= start
                    && candidate.is_better_preceding_node_than(preceding)
                {
                    preceding = candidate;
                }
            }
            self.comments.pending.push(PendingComment {
                id: id as u32,
                start,
                preceding,
                following: Candidate::default(),
            });
        }
        self.comments.tracked_count = self.lx.comments.len() as u32;
    }

    /// A node from `start` to `end` was finished.
    #[cold]
    #[inline(never)]
    fn update_pending_comments(&mut self, node: NodeOrName, start: u32, end: u32) {
        if !self.options.attach_comments {
            return;
        }
        self.add_new_pending_comments();
        if start < end {
            let finished = Candidate { node, start, end };
            let CommentTracker {
                pending, undo_log, ..
            } = &mut self.comments;

            // `pending` is in source order, so from the back: comments after the node, inside it, and before it.
            let mut index = pending.len();
            while let Some(comment) = index.checked_sub(1).and_then(|last| pending.get_mut(last))
                && comment.start >= end
            {
                if finished.is_better_preceding_node_than(comment.preceding) {
                    undo_log.push(*comment);
                    comment.preceding = finished;
                }
                index -= 1;
            }

            let after_node = index;
            while index > 0 && pending[index - 1].start >= start {
                index -= 1;
            }
            for comment in pending.drain(index..after_node).rev() {
                undo_log.push(comment);
                // A candidate outside the enclosing node is not one of its children.
                let child_or_none = |candidate: Candidate| match candidate.is_inside(start, end) {
                    true => candidate.node,
                    false => NodeOrName::None,
                };
                if let Some(resolved) = self.lx.comments.get_mut(comment.id as usize) {
                    resolved.enclosing_node = node;
                    resolved.preceding_node = child_or_none(comment.preceding);
                    resolved.following_node = child_or_none(comment.following);
                }
            }

            // Earlier comments already have a following node that starts before this one.
            while let Some(comment) = index.checked_sub(1).and_then(|last| pending.get_mut(last))
                && finished.is_better_following_node_than(comment.following)
            {
                undo_log.push(*comment);
                comment.following = finished;
                index -= 1;
            }
        }
        self.update_max_relevant_node_start();
    }

    /// A node that starts after the following node of the last pending comment is not inside, before or directly after any
    /// pending comment, so [`Parser::finish_node`] can skip it.
    fn update_max_relevant_node_start(&mut self) {
        self.lx.max_relevant_node_start = match self.comments.pending.last() {
            None => 0,
            Some(comment) if comment.following.is_none() => u32::MAX,
            Some(comment) => comment.following.start,
        };
    }

    /// Call at the end of the file. The comments that are still pending are not inside any node.
    pub(crate) fn resolve_top_level_comments(&mut self) {
        if !self.options.attach_comments {
            return;
        }
        self.add_new_pending_comments();
        for comment in self.comments.pending.drain(..) {
            if let Some(resolved) = self.lx.comments.get_mut(comment.id as usize) {
                resolved.enclosing_node = NodeOrName::None;
                resolved.preceding_node = comment.preceding.node;
                resolved.following_node = comment.following.node;
            }
        }
        self.comments.undo_log.clear();
    }

    #[inline(always)]
    pub(crate) fn comment_checkpoint(&self) -> CommentCheckpoint {
        CommentCheckpoint {
            tracked_count: self.comments.tracked_count,
            undo_log_len: self.comments.undo_log.len() as u32,
            last_name: self.comments.last_name,
        }
    }

    pub(crate) fn rollback_comments(&mut self, to: &Checkpoint) {
        if !self.options.attach_comments {
            return;
        }
        let CommentTracker {
            pending,
            tracked_count,
            undo_log,
            last_name,
        } = &mut self.comments;
        while undo_log.len() > to.comments.undo_log_len as usize {
            let Some(previous) = undo_log.pop() else {
                break;
            };
            match pending.binary_search_by_key(&previous.id, |comment| comment.id) {
                Ok(index) => pending[index] = previous,
                Err(index) => pending.insert(index, previous),
            }
        }
        // Comments that were first seen after the checkpoint will be seen again.
        *tracked_count = to.comments.tracked_count;
        pending.truncate(pending.partition_point(|comment| comment.id < *tracked_count));
        *last_name = to.comments.last_name;
        self.lx.max_relevant_node_start = u32::MAX;
    }
}
