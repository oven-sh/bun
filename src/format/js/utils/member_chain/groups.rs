use super::chain_member::ChainMember;
use crate::prelude::*;
use smallvec::SmallVec;
use std::cell::Cell;

#[derive(Default)]
pub(super) struct MemberChainGroupsBuilder<'a> {
    groups: SmallVec<[MemberChainGroup<'a>; 4]>,
    current_group: Option<MemberChainGroup<'a>>,
}

impl<'a> MemberChainGroupsBuilder<'a> {
    pub(super) fn start_group(&mut self, member: ChainMember<'a>) {
        debug_assert!(self.current_group.is_none());
        let mut group = MemberChainGroup::default();
        group.members.push(member);
        self.current_group = Some(group);
    }

    pub(super) fn start_or_continue_group(&mut self, member: ChainMember<'a>) {
        match &mut self.current_group {
            None => self.start_group(member),
            Some(group) => group.members.push(member),
        }
    }

    pub(super) fn close_group(&mut self) {
        if let Some(group) = self.current_group.take() {
            self.groups.push(group);
        }
    }

    pub(super) fn finish(mut self) -> TailChainGroups<'a> {
        self.close_group();
        TailChainGroups {
            groups: self.groups,
        }
    }
}

/// The groups after the head. There may be none.
pub(super) struct TailChainGroups<'a> {
    groups: SmallVec<[MemberChainGroup<'a>; 4]>,
}

impl<'a> TailChainGroups<'a> {
    pub(super) fn is_empty(&self) -> bool {
        self.groups.is_empty()
    }

    pub(super) fn len(&self) -> usize {
        self.groups.len()
    }

    pub(super) fn first(&self) -> Option<&MemberChainGroup<'a>> {
        self.groups.first()
    }

    pub(super) fn last(&self) -> Option<&MemberChainGroup<'a>> {
        self.groups.last()
    }

    pub(super) fn pop_first(&mut self) -> Option<MemberChainGroup<'a>> {
        (!self.groups.is_empty()).then(|| self.groups.remove(0))
    }

    /// The opposite of Prettier's `shouldNotWrap`/cutoff test.
    pub(super) fn is_member_call_chain(&self) -> bool {
        self.groups.len() > 1
    }

    pub(super) fn iter(&self) -> impl Iterator<Item = &MemberChainGroup<'a>> {
        self.groups.iter()
    }

    pub(super) fn any_except_last_will_break(&self, f: &Formatter<'a>) -> bool {
        let count = self.groups.len().saturating_sub(1);
        self.groups.iter().take(count).any(|group| group.will_break(f))
    }

    pub(super) fn members(&self) -> impl Iterator<Item = &ChainMember<'a>> {
        self.groups.iter().flat_map(|group| group.members().iter())
    }
}

#[derive(Default)]
pub(super) struct MemberChainGroup<'a> {
    members: SmallVec<[ChainMember<'a>; 4]>,
    /// What [`MemberChainGroup::inspect`] has formatted. `Some(None)` if that is nothing.
    formatted: Cell<Option<Option<FormatElement>>>,
    needs_empty_line: Cell<bool>,
}

impl<'a> MemberChainGroup<'a> {
    pub(super) fn into_members(self) -> SmallVec<[ChainMember<'a>; 4]> {
        self.members
    }

    pub(super) fn members(&self) -> &[ChainMember<'a>] {
        &self.members
    }

    pub(super) fn extend_members(&mut self, members: impl IntoIterator<Item = ChainMember<'a>>) {
        self.members.extend(members);
    }

    /// Formats the group, to be asked about and written later. The groups have to be inspected
    /// in order, for the sake of the comments.
    ///
    /// `index_in_tail`: `None` for the head.
    pub(super) fn inspect(&self, index_in_tail: Option<usize>, f: &mut Formatter<'a>) {
        if self.formatted.get().is_some() {
            return;
        }
        let interned = f.intern(&FormatMemberChainGroup { group: self });
        if let Some(index) = index_in_tail {
            self.needs_empty_line.set((index == 0 || self.follows_call()) && self.needs_empty_line_before(f));
        }
        self.formatted.set(Some(interned));
    }

    /// Whether the group starts with a member of what a call returns: `.b` of `a().b`.
    pub(super) fn follows_call(&self) -> bool {
        matches!(
            self.members.first().map(|member| member.expr().kind()),
            Some(ExprKind::Dot { obj, .. }) if matches!(obj.kind(), ExprKind::Call(_))
        )
    }

    /// [`MemberChainGroup::inspect`] has to be called first.
    pub(super) fn will_break(&self, f: &Formatter<'a>) -> bool {
        debug_assert!(self.formatted.get().is_some());
        self.formatted.get().flatten().is_some_and(|formatted| formatted.will_break(f))
    }

    pub(super) fn needs_empty_line(&self) -> bool {
        self.needs_empty_line.get()
    }

    /// Whether there is an empty line before the `.` that the group starts with.
    fn needs_empty_line_before(&self, f: &Formatter<'a>) -> bool {
        let Some(ChainMember::StaticMember(expression)) = self.members.first() else {
            return false;
        };
        let ExprKind::Dot { obj, name, .. } = expression.kind() else {
            return false;
        };

        // Not after a call that the chain starts with: `fn()\n\n.bar()` is `fn().bar()`.
        if let AstNodes::CallExpression(call) = obj.as_ast_nodes()
            && !call.callee().is_some_and(|callee| {
                matches!(
                    callee.as_ast_nodes(),
                    AstNodes::StaticMemberExpression(_)
                        | AstNodes::ComputedMemberExpression(_)
                        | AstNodes::PrivateFieldExpression(_)
                        | AstNodes::CallExpression(_)
                )
            })
        {
            return false;
        }

        let source = f.source_text();
        let start = obj.span().end;
        let mut end = name.start();

        // Up to the first comment between the object and the `.`.
        if let Some(printed_comment) = (f.comments().printed_comments().iter().rev())
            .take_while(|c| start <= c.span.start && c.span.end < end)
            .last()
        {
            end = printed_comment.span.start;
        } else if let Some(first_comment) = f.comments().comments_before_character(start, b'.').first() {
            end = first_comment.span.start;
        }

        (source.bytes_range(start, end).iter().enumerate())
            .any(|(index, b)| matches!(b, b'\n' | b'\r') && source.lines_after(start + index as u32) > 1)
    }
}

impl<'a> From<SmallVec<[ChainMember<'a>; 4]>> for MemberChainGroup<'a> {
    fn from(members: SmallVec<[ChainMember<'a>; 4]>) -> Self {
        Self {
            members,
            ..Self::default()
        }
    }
}

impl<'a> Format<'a> for MemberChainGroup<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        match self.formatted.get() {
            Some(Some(formatted)) => f.write_element(formatted),
            Some(None) => {}
            None => FormatMemberChainGroup { group: self }.fmt(f),
        }
    }
}

struct FormatMemberChainGroup<'a, 'b> {
    group: &'b MemberChainGroup<'a>,
}

impl<'a> Format<'a> for FormatMemberChainGroup<'a, '_> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        f.join().entries(self.group.members.iter());
    }
}
