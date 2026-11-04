use super::Constant;
use super::evaluate::Value;
use super::folder::{Effects, Folded, Folder};
use crate::atom::known;
use crate::hir::{
    Chain, ExprId, ExprKind, IdList, MemberKey, NameKind, PropId, PropKey, PropKind, Span,
};
use bun_core::strings;

/// `bun run` writes the value in place of a read out of what the text spells out: `"abc".length`, `"abc"[1]`, `["a", "b"][1]`, `{ a: 1 }.a`.
/// `bun build` does under `--minify-syntax` alone.
impl Folder<'_, '_> {
    pub(super) fn fold_read_out_of_literal(&mut self, access: ExprId, chain: Chain) -> Folded {
        let hir = self.hir;
        let Some((object, key)) = hir.member_key(access) else {
            return Folded::UNKNOWN;
        };
        let written = self.find_written_in_place(object);
        let is_spelled_out = matches!(hir[written].kind, ExprKind::Array(_) | ExprKind::Object(_))
            || matches!(self.folded(object).value, Value::Known(_));
        let is_read = is_spelled_out
            && chain != Chain::Continue
            && !self.is_assignment_target(access)
            && !self.is_delete_operand(access);
        if !is_read {
            return Folded::UNKNOWN;
        }
        match hir[written].kind {
            ExprKind::Array(items) => self.fold_item_read(access, written, items, key),
            ExprKind::Object(properties) => self.fold_only_property_read(access, properties, key),
            _ => self.fold_member_of_text(access, object, key),
        }
    }

    fn find_written_in_place(&self, e: ExprId) -> ExprId {
        let e = self.hir.skip_type_assertions(e);
        self.written_in_place.get(&e).copied().unwrap_or(e)
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

    /// `[x][0]`, and `["a", "b"][1]` where nothing is lost with the rest of the list.
    fn fold_item_read(
        &mut self,
        access: ExprId,
        list: ExprId,
        items: IdList<ExprId>,
        key: MemberKey,
    ) -> Folded {
        let hir = self.hir;
        let Some((position, index)) = self.find_index(key) else {
            return Folded::UNKNOWN;
        };
        let is_spread = |item: ExprId| matches!(hir[item].kind, ExprKind::Spread(_));
        let is_replaced = position < items.len()
            && !hir.ids(items).any(is_spread)
            && (items.len() == 1 || self.is_removed_if_unused_by_bun_run(list));
        match is_replaced {
            true => self.put_in_place(access, hir.id_at(items, position), Some(index)),
            false => Folded::UNKNOWN,
        }
    }

    /// `{ a: 1 }.a`
    fn fold_only_property_read(
        &mut self,
        access: ExprId,
        properties: Span<PropId>,
        key: MemberKey,
    ) -> Folded {
        let (MemberKey::Name(name), 1) = (key, properties.len()) else {
            return Folded::UNKNOWN;
        };
        let property = self.hir[properties.at(0)];
        let is_replaced = property.kind == PropKind::Init
            && matches!(
                property.name_kind,
                NameKind::Identifier | NameKind::StringLiteral
            )
            && property.key == PropKey::Name(name)
            && name != known::__proto__;
        match is_replaced {
            true => self.put_in_place(access, property.value, None),
            false => Folded::UNKNOWN,
        }
    }

    fn put_in_place(&mut self, access: ExprId, part: ExprId, index: Option<ExprId>) -> Folded {
        let hir = self.hir;
        let folded = match hir[part].kind {
            ExprKind::Missing => Folded::constant(Constant::Undefined),
            _ => self.folded(part),
        };
        let written = self.find_written_in_place(part);
        let is_literal = matches!(hir[written].kind, ExprKind::Array(_) | ExprKind::Object(_));
        if !is_literal && matches!(folded.value, Value::Unknown) {
            return Folded::UNKNOWN;
        }
        self.written_in_place.insert(access, written);
        self.copy_condition(access, part);
        self.note_who_writes_in_place(access, part, index);
        self.note_condition_told_in_place(access, part, index);
        let effects_of_index = index.map_or(Effects::None, |index| self.folded(index).effects);
        Folded::new(folded.value, folded.effects.min(effects_of_index))
    }

    fn note_who_writes_in_place(&mut self, access: ExprId, part: ExprId, index: Option<ExprId>) {
        let is_written_in_place = |folder: &Self| {
            folder.minifies_syntax()
                && folder.is_folded_by_bun_run(part)
                && index.is_none_or(|index| folder.is_folded_by_bun_run(index))
        };
        if !is_written_in_place(&*self) {
            self.mark_folded_by_build_alone(access);
            self.mark_folded_under_minify_syntax_if(access, is_written_in_place);
        }
    }

    /// `[x || "a"][0]` is `x || "a"`, which is true whatever `x` is.
    fn note_condition_told_in_place(
        &mut self,
        access: ExprId,
        part: ExprId,
        index: Option<ExprId>,
    ) {
        let tells_condition = |folder: &Self| {
            folder.minifies_syntax()
                && !folder.is_folded_by_bun_run(part)
                && folder.is_truthy_in_bun_run(part).is_some()
                && index.is_none_or(|index| folder.is_folded_by_bun_run(index))
        };
        if tells_condition(&*self) {
            self.conditions_told_by_shape.insert(access.idx());
        } else if self.holds_under_minify_syntax(tells_condition) {
            self.conditions_told_under_minify_syntax
                .insert(access.idx());
        }
    }

    /// `"abc".length` and `"abc"[1]`. `bun run` looks for a character in the first piece of an ASCII text.
    fn fold_member_of_text(&mut self, access: ExprId, object: ExprId, key: MemberKey) -> Folded {
        let atoms = self.atoms;
        let Folded {
            value: Value::Known(value),
            effects,
        } = self.folded(object)
        else {
            return Folded::UNKNOWN;
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
        self.note_who_writes_in_place(access, object, index);
        let effects_of_index = index.map_or(Effects::None, |index| self.folded(index).effects);
        Folded::new(Value::from(member), effects.min(effects_of_index))
    }
}
