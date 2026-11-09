use super::Constant;
use super::evaluate::Value;
use super::folder::{Effects, Folded, Folder};
use super::known_constructors::KnownConstruction;
use crate::atom::{Atom, known};
use crate::hir::{
    BinOp, CallId, Chain, ExprId, ExprKind, IdList, MemberKey, NameKind, PropId, PropKey, PropKind,
    Span, UnOp,
};
use bun_core::identifier::is_identifier;
use bun_core::strings;
use smallvec::SmallVec;

/// A read out of a literal: the parser of `bun run` has the member where it is written.
#[derive(Copy, Clone)]
struct Read {
    access: ExprId,
    object: ExprId,
    literal: ExprId,
    /// The index or the key where a fold yields it.
    index: Option<ExprId>,
    has_other_items: bool,
    /// `new Array(..)` where the parser makes the list of its arguments.
    list_made_of: Option<CallId>,
    /// The items of a list in which the items of spread lists stand.
    items_with_spreads: Option<IdList<ExprId>>,
    /// What the object arm of the parser asks and its array arm does not: it puts nothing in place of a callee or behind a `?.`.
    is_kept_by_its_form: bool,
}

impl Folder<'_, '_> {
    pub(super) fn fold_read_out_of_literal(&mut self, access: ExprId, chain: Chain) -> Folded {
        let hir = self.hir;
        let Some((object, key)) = hir.member_key(access) else {
            return Folded::UNKNOWN;
        };
        let literal = self.find_in_place(object);
        if self.is_assignment_target(access) || self.is_delete_operand(access) {
            return Folded::UNKNOWN;
        }
        let read = Read {
            access,
            object,
            literal,
            index: None,
            has_other_items: false,
            list_made_of: None,
            items_with_spreads: None,
            is_kept_by_its_form: false,
        };
        match hir[literal].kind {
            ExprKind::Array(items) => self.fold_item_read(read, items, key),
            ExprKind::Object(properties) => self.fold_only_property_read(read, properties, key),
            ExprKind::New(call) if self.makes_list_under_minify_syntax(call) => {
                let read = Read {
                    list_made_of: Some(call),
                    ..read
                };
                self.fold_item_read(read, hir[call].args, key)
            }
            _ if chain != Chain::Continue => self.fold_member_of_text(access, object, key),
            _ => Folded::UNKNOWN,
        }
    }

    fn find_text(&self, e: ExprId) -> Option<Atom> {
        let Value::Known(value) = self.folded(e).value else {
            return None;
        };
        match self.evaluator.to_constant(value) {
            Constant::String(text) => Some(text),
            _ => None,
        }
    }

    fn makes_list(&self, call: CallId) -> bool {
        let known = self.find_known_construction(self.hir[call]);
        known == Some(KnownConstruction::ArrayOfArguments)
    }

    fn makes_list_under_minify_syntax(&self, call: CallId) -> bool {
        self.holds_under_minify_syntax(|folder| folder.makes_list(call))
    }

    fn find_index(&self, key: MemberKey) -> Option<(usize, ExprId)> {
        let MemberKey::Computed(index) = key else {
            return None;
        };
        let Value::Known(value) = self.folded(index).value else {
            return None;
        };
        match self.evaluator.to_constant(value) {
            Constant::Number(number) if number >= 0.0 && number.fract() == 0.0 => {
                Some((number as usize, index))
            }
            _ => None,
        }
    }

    /// The item at `position` and the number of items as the parser has them: the items of spread lists stand in the list.
    fn find_item(&self, items: IdList<ExprId>, position: usize) -> Option<(ExprId, usize, bool)> {
        let hir = self.hir;
        let has_items = |item: ExprId| {
            let spread = self.find_items_of_spread(item);
            spread.is_some_and(|list| !list.is_empty())
        };
        if !hir.ids(items).any(has_items) {
            let item = (position < items.len()).then(|| hir.id_at(items, position))?;
            return Some((item, items.len(), false));
        }
        let mut inlined: SmallVec<[ExprId; 8]> = SmallVec::new();
        self.push_items_of_parser(items, &mut inlined);
        let item = *inlined.get(position)?;
        Some((item, inlined.len(), true))
    }

    fn find_items_of_spread(&self, item: ExprId) -> Option<IdList<ExprId>> {
        let hir = self.hir;
        let ExprKind::Spread(list) = hir[item].kind else {
            return None;
        };
        match hir[self.find_in_place(list)].kind {
            ExprKind::Array(items) => Some(items),
            _ => None,
        }
    }

    /// Whether `bun run` has the lists that are spread in `items` where the build has them.
    fn sees_spread_lists(&self, items: IdList<ExprId>) -> bool {
        let hir = self.hir;
        hir.ids(items).all(|item| {
            let ExprKind::Spread(list) = hir[item].kind else {
                return true;
            };
            let in_place = self.find_in_place(list);
            match hir[in_place].kind {
                ExprKind::Array(inner) => {
                    self.seen_by_bun_run(list) == in_place && self.sees_spread_lists(inner)
                }
                _ => true,
            }
        })
    }

    fn push_items_of_parser(&self, items: IdList<ExprId>, inlined: &mut SmallVec<[ExprId; 8]>) {
        let hir = self.hir;
        let spreads = hir
            .ids(items)
            .filter_map(|item| self.find_items_of_spread(item));
        let inlines_lists = spreads.map(|list| list.len()).sum::<usize>() > 0;
        for item in hir.ids(items) {
            match self.find_items_of_spread(item).filter(|_| inlines_lists) {
                Some(list) => self.push_items_of_parser(list, inlined),
                None => inlined.push(item),
            }
        }
    }

    fn fold_item_read(&mut self, read: Read, items: IdList<ExprId>, key: MemberKey) -> Folded {
        let Some((position, index)) = self.find_index(key) else {
            return Folded::UNKNOWN;
        };
        let Some((item, count, has_spread_lists)) = self.find_item(items, position) else {
            return Folded::UNKNOWN;
        };
        let has_other_items = count > 1;
        let list = read.literal;
        let is_left_out = |folder: &Self| folder.is_removed_if_unused_by_bun_run(list);
        if has_other_items && !self.holds_under_minify_syntax(is_left_out) {
            return Folded::UNKNOWN;
        }
        let read = Read {
            index: Some(index),
            has_other_items,
            items_with_spreads: has_spread_lists.then_some(items),
            ..read
        };
        self.put_in_place(read, item)
    }

    fn fold_only_property_read(
        &mut self,
        read: Read,
        properties: Span<PropId>,
        key: MemberKey,
    ) -> Folded {
        let hir = self.hir;
        let (name, index) = match key {
            MemberKey::Name(name) => (name, None),
            MemberKey::Computed(index) => match self.find_text(index) {
                Some(name) => (name, Some(index)),
                None => return Folded::UNKNOWN,
            },
            MemberKey::PrivateName(_) => return Folded::UNKNOWN,
        };
        if properties.len() != 1 {
            return Folded::UNKNOWN;
        }
        let property = hir[properties.at(0)];
        let text = self.atoms.bytes(name);
        let is_replaced = property.kind == PropKind::Init
            && matches!(
                property.name_kind,
                NameKind::Identifier | NameKind::StringLiteral
            )
            && property.key == PropKey::Name(name)
            && name != known::__proto__;
        let is_key_written = index.is_none_or(|index| {
            let written = hir.index_member_key(self.as_written(index));
            matches!(written, MemberKey::Name(_))
        });
        let is_key_same_to_parser = match is_key_written {
            true => hir.is_name_resolved_by_transpiler(read.access, text),
            false => text.is_ascii() && !is_identifier(text),
        };
        let is_same_to_parser = is_key_same_to_parser
            && (property.name_kind == NameKind::Identifier || text.is_ascii());
        let read = Read {
            index,
            is_kept_by_its_form: !is_same_to_parser
                || self.is_callee(read.access)
                || self.is_link_of_kept_chain(read.access),
            ..read
        };
        match is_replaced {
            true => self.put_in_place(read, property.value),
            false => Folded::UNKNOWN,
        }
    }

    pub(super) fn is_callee(&self, e: ExprId) -> bool {
        let callee = self.find_outermost_cast(e);
        let parent = self.parent_expr(callee).map(|parent| self.hir[parent].kind);
        matches!(parent, Some(ExprKind::Call(call)) if self.hir[call].callee == callee)
    }

    /// The parser starts no `?.` chain behind what is never null or undefined by the way it is written.
    fn is_link_of_kept_chain(&self, e: ExprId) -> bool {
        let hir = self.hir;
        let mut link = e;
        loop {
            let (object, chain) = match hir[link].kind {
                ExprKind::Dot { obj, chain, .. } | ExprKind::Index { obj, chain, .. } => {
                    (obj, chain)
                }
                ExprKind::Call(call) => (hir[call].callee, hir[call].chain),
                _ => return false,
            };
            match chain {
                Chain::No => return false,
                Chain::Start => return !self.is_never_nullish_as_written(object),
                Chain::Continue => link = self.as_written(object),
            }
        }
    }

    fn is_never_nullish_as_written(&self, e: ExprId) -> bool {
        let hir = self.hir;
        let mut e = e;
        loop {
            e = self.as_written(e);
            return match hir[e].kind {
                ExprKind::True
                | ExprKind::False
                | ExprKind::Number(_)
                | ExprKind::String(_)
                | ExprKind::BigInt(_)
                | ExprKind::Regex { .. }
                | ExprKind::Fn(_)
                | ExprKind::Class(_)
                | ExprKind::Object(_)
                | ExprKind::Array(_) => true,
                ExprKind::Unary { op, .. } => op != UnOp::Void,
                ExprKind::Binary {
                    op: BinOp::Comma,
                    right,
                    ..
                } => {
                    e = right;
                    continue;
                }
                ExprKind::Binary { op, .. } => {
                    !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish)
                }
                _ => false,
            };
        }
    }

    fn put_in_place(&mut self, read: Read, member: ExprId) -> Folded {
        let hir = self.hir;
        let Read { access, index, .. } = read;
        if let ExprKind::Spread(_) = hir[member].kind {
            return Folded::UNKNOWN;
        }
        let is_put_by_parser =
            |folder: &Self| !folder.is_link_of_kept_chain(folder.seen_by_bun_run(member));
        let is_in_place = |folder: &Self| {
            is_put_by_parser(folder)
                && !read.is_kept_by_its_form
                && folder.minifies_syntax()
                && index.is_none_or(|index| folder.is_folded_by_bun_run(index))
                && folder.seen_by_bun_run(read.object) == read.literal
                && read.list_made_of.is_none_or(|call| folder.makes_list(call))
                && (read.items_with_spreads).is_none_or(|items| folder.sees_spread_lists(items))
                && (!read.has_other_items || folder.is_removed_if_unused_by_bun_run(read.literal))
        };
        let folded = match hir[member].kind {
            ExprKind::Missing => Folded::constant(Constant::Undefined),
            _ => {
                self.note_member_in_place(access, member, is_in_place);
                self.folded(member)
            }
        };
        if matches!(folded.value, Value::Unknown) && self.conditions.get(&member).is_none() {
            return Folded::UNKNOWN;
        }
        self.copy_condition(access, member);
        self.note_who_writes_in_place(access, member, is_in_place);
        self.note_condition_told_in_place(access, member, is_in_place);
        let effects_of_index = index.map_or(Effects::None, |index| self.folded(index).effects);
        Folded::new(folded.value, folded.effects.min(effects_of_index))
    }

    fn note_who_writes_in_place(
        &mut self,
        access: ExprId,
        member: ExprId,
        is_in_place: impl Fn(&Self) -> bool,
    ) {
        let is_written_in_place =
            |folder: &Self| is_in_place(folder) && folder.is_folded_by_bun_run(member);
        if !is_written_in_place(&*self) {
            self.mark_folded_by_build_alone(access);
            self.mark_folded_under_minify_syntax_if(access, is_written_in_place);
        }
    }

    fn note_condition_told_in_place(
        &mut self,
        access: ExprId,
        member: ExprId,
        is_in_place: impl Fn(&Self) -> bool,
    ) {
        let tells_condition = |folder: &Self| {
            is_in_place(folder)
                && !folder.is_folded_by_bun_run(member)
                && folder.is_truthy_in_bun_run(member).is_some()
        };
        if tells_condition(&*self) {
            self.conditions_told_by_shape.insert(access.idx());
        } else if self.holds_under_minify_syntax(tells_condition) {
            self.conditions_told_under_minify_syntax
                .insert(access.idx());
        }
    }

    fn fold_member_of_text(&mut self, access: ExprId, object: ExprId, key: MemberKey) -> Folded {
        let atoms = self.atoms;
        let Folded {
            value: Value::Known(value),
            effects,
        } = self.folded(object)
        else {
            return Folded::UNKNOWN;
        };
        let effects = match effects {
            Effects::DeadZoneCheck if self.is_constant_read_behind_its_declaration(object) => {
                Effects::None
            }
            effects => effects,
        };
        let Constant::String(text) = self.evaluator.to_constant(value) else {
            return Folded::UNKNOWN;
        };
        let bytes = atoms.bytes(text);
        let is_ascii = bytes.is_ascii();
        let is_in_one_piece = self.is_kept_in_one_piece(object, text);
        let (member, index) = match key {
            MemberKey::Name(name) if name == known::length && (is_ascii || is_in_one_piece) => {
                let length = f64::from(strings::wtf8_len_utf16(bytes));
                (Constant::Number(length), None)
            }
            MemberKey::Computed(_) if is_ascii && is_in_one_piece => {
                let found = self.find_index(key).and_then(|(position, index)| {
                    let character = bytes.get(position..position.checked_add(1)?)?;
                    Some((Constant::String(atoms.intern(character)), Some(index)))
                });
                match found {
                    Some(found) => found,
                    None => return Folded::UNKNOWN,
                }
            }
            _ => return Folded::UNKNOWN,
        };
        let is_kept_by_its_form = index.is_none() && self.is_link_of_kept_chain(access);
        self.note_who_writes_in_place(access, object, |folder| {
            !is_kept_by_its_form
                && folder.minifies_syntax()
                && index.is_none_or(|index| folder.is_folded_by_bun_run(index))
        });
        let effects_of_index = index.map_or(Effects::None, |index| self.folded(index).effects);
        Folded::new(Value::from(member), effects.min(effects_of_index))
    }
}
