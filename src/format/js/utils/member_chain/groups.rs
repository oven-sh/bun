use super::chain_member::{CallExpressionPosition, ChainMember};
use crate::js::utils::call_expression::is_next_line_empty;
use crate::prelude::*;
use crate::write;
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
    pub(super) fn inspect(&self, f: &mut Formatter<'a>) {
        if self.formatted.get().is_none() {
            self.formatted.set(Some(f.intern(&FormatMemberChainGroup { group: self })));
        }
    }

    /// [`MemberChainGroup::inspect`] has to be called first.
    pub(super) fn will_break(&self, f: &Formatter<'a>) -> bool {
        debug_assert!(self.formatted.get().is_some());
        self.formatted.get().flatten().is_some_and(|formatted| formatted.will_break(f))
    }

    /// Whether there is an empty line before the group if the chain breaks.
    pub(super) fn needs_empty_line(&self) -> bool {
        self.needs_empty_line.get()
    }

    pub(super) fn set_needs_empty_line(&self, needs_empty_line: bool) {
        self.needs_empty_line.set(needs_empty_line);
    }
}

/// Prettier's `shouldInsertEmptyLineAfter`: whether the line after `e`, or after the `)` behind it,
/// is empty.
pub(super) fn should_insert_empty_line_after<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    let (source_text, end) = (f.source_text(), e.span().end);
    let next = bun_lint::tokens::skip_trivia(source_text.as_bytes(), end);
    match source_text.byte_at(next) {
        Some(b')') => is_next_line_empty(source_text, next + 1),
        _ => is_next_line_empty(source_text, end),
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
        let mut members = self.group.members.iter().peekable();
        while let Some(member) = members.next() {
            write!(f, member);
            // Prettier writes a line break after a call that an empty line follows, which makes an
            // empty line at the end of a group. It is there in the middle of a group as well.
            if let ChainMember::CallExpression {
                expression,
                position: CallExpressionPosition::Middle,
            } = *member
                && members.peek().is_some()
                && should_insert_empty_line_after(expression, f)
            {
                write!(f, hard_line_break());
            }
        }
    }
}
