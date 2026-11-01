use super::Constant;
use super::evaluate::Value;
use super::folder::{Effects, Folded, Folder};
use super::known_to_bun_run::{NullishByShape, nullish_by_shape};
use crate::atom::{Atom, known};
use crate::hir::{
    BinOp, Chain, ExprId, ExprKind, File, IdList, MemberKey, NameKind, PropId, PropKey, PropKind,
    Span, UnOp,
};
use smallvec::SmallVec;

/// A text as `bun run` holds it. `"ab" + "cd"` is kept in two pieces, and an index reads the first alone.
#[derive(Copy, Clone)]
struct Text {
    value: Atom,
    joined: Option<ExprId>,
}

#[derive(Copy, Clone)]
enum Literal {
    Array(ExprId, IdList<ExprId>),
    Object(Span<PropId>),
    Text(Text),
}

#[derive(Copy, Clone)]
enum Key {
    Name(Atom),
    Index(usize),
}

#[derive(Copy, Clone)]
enum HeldItem {
    Item(ExprId),
    Hole,
    Spread,
}

/// What `bun run` has in place of a member read of a literal.
#[derive(Copy, Clone)]
enum Read {
    /// `{ a: v }.a`, `[v][0]` and `[a, v][1]`: the `v`.
    Item(ExprId),
    /// `[, a][0]`, `"ab"[1]` and `"ab".length`.
    Constant(Constant),
}

/// `to_null_or_undefined` of what the parser has read in front of a `?.`, where nothing is folded yet.
fn is_never_nullish_as_written(hir: &File<'_>, e: ExprId) -> bool {
    let mut e = e;
    loop {
        e = hir.skip_type_assertions(e);
        match nullish_by_shape(hir[e].kind) {
            NullishByShape::Known(is_nullish) => return !is_nullish,
            NullishByShape::SameAs(operand) => e = operand,
            NullishByShape::Unknown => return false,
        }
    }
}

/// `number.value() >= 0.0 && number.value() < (usize::MAX as f64) && number.value() % 1.0 == 0.0`
fn to_index(number: f64) -> Option<usize> {
    let is_index = number >= 0.0 && number < usize::MAX as f64 && number % 1.0 == 0.0;
    is_index.then_some(number as usize)
}

impl Folder<'_, '_> {
    /// `maybe_rewrite_property_access` and `e_index`: `bun run` has the member in place of `{ a: v }.a`, `[a, v][1]`, `"ab"[1]` and `"ab".length`, behind its visit of the literal.
    #[inline(always)]
    pub(super) fn fold_read_of_literal(
        &mut self,
        e: ExprId,
        object: ExprId,
        key: MemberKey,
    ) -> Folded {
        match self.may_read_literal(object, key) {
            true => self.fold_read_of_held_literal(e, object, key),
            false => Folded::UNKNOWN,
        }
    }

    /// Nearly every member read is `a.b` or `a[i]`: of a name that holds no literal, or at an index that nobody knows. This answers for those without a call.
    #[inline(always)]
    fn may_read_literal(&self, object: ExprId, key: MemberKey) -> bool {
        let is_known = |e: ExprId| matches!(self.values[e.idx()], Value::Known(_));
        let reads_object_alone = match key {
            MemberKey::Name(name) => name != known::length,
            MemberKey::Computed(index) if is_known(index) => false,
            MemberKey::Computed(_) | MemberKey::PrivateName(_) => return false,
        };
        let object = self.hir.skip_type_assertions(object);
        match self.hir[object].kind {
            ExprKind::Object(_) | ExprKind::Cond { .. } | ExprKind::Binary { .. } => true,
            ExprKind::Array(_) => matches!(key, MemberKey::Computed(_)),
            ExprKind::String(_) => !reads_object_alone,
            ExprKind::Dot { .. } | ExprKind::Index { .. } if !self.replaced_by.is_empty() => true,
            _ => !reads_object_alone && is_known(object),
        }
    }

    #[inline(never)]
    fn fold_read_of_held_literal(&mut self, e: ExprId, object: ExprId, key: MemberKey) -> Folded {
        let value = match self.find_read_of_literal(e, object, key) {
            Some(Read::Item(item)) => {
                self.replaced_by.insert(e, item);
                self.copy_condition(e, item);
                self.folded(item).value
            }
            Some(Read::Constant(constant)) => Value::from(constant),
            None => return Folded::UNKNOWN,
        };
        // A build evaluates the read as it is written, and removes the code that `bun run` removes by it.
        self.folded_by_bun_run_alone.insert(e);
        Folded::new(value, Effects::Unknown)
    }

    fn find_read_of_literal(&self, e: ExprId, object: ExprId, key: MemberKey) -> Option<Read> {
        let hir = self.hir;
        let held = self.held_by_bun_run(object);
        let literal = match hir[held].kind {
            ExprKind::Array(items) => Literal::Array(held, items),
            ExprKind::Object(props) => Literal::Object(props),
            _ => Literal::Text(self.find_text_held_by_bun_run(held)?),
        };
        let key = self.find_key_read_by_bun_run(e, key)?;
        // `maybe_rewrite_property_access` is asked outside an optional chain alone. The index of `e_index` is read in one too.
        let is_plain_link = || !self.is_in_optional_chain_of_bun_run(e);
        let read = match (literal, key) {
            (Literal::Object(props), Key::Name(name)) => {
                let value = self.find_only_property(props, name)?;
                let is_inlined = is_plain_link()
                    && !self.is_callee(e)
                    && !self.is_in_optional_chain_of_bun_run(self.held_by_bun_run(value));
                is_inlined.then_some(Read::Item(value))
            }
            (Literal::Array(array, items), Key::Index(index)) => {
                self.find_item_read(array, items, index)
            }
            (Literal::Text(text), Key::Name(name)) if name == known::length => {
                let length = bun_core::strings::wtf8_len_utf16(self.atoms.bytes(text.value));
                is_plain_link().then_some(Read::Constant(Constant::Number(length as f64)))
            }
            (Literal::Text(text), Key::Index(index)) => {
                let bytes = self.atoms.bytes(text.value);
                // `!str_.is_utf16`: a text with a character outside ASCII is held in 16 bits.
                if !bytes.is_ascii() {
                    return None;
                }
                let first_piece_len = match text.joined {
                    Some(sum) => self.find_first_piece_len(sum),
                    None => bytes.len(),
                };
                let unit = bytes.get(index).filter(|_| index < first_piece_len)?;
                let unit = self.atoms.intern(std::slice::from_ref(unit));
                Some(Read::Constant(Constant::String(unit)))
            }
            (Literal::Object(_) | Literal::Array(..) | Literal::Text(_), _) => None,
        };
        read.filter(|_| !self.is_assignment_target(e) && !self.is_delete_operand(e))
    }

    /// The `EObject` arm of `maybe_rewrite_property_access`: one property, with a name or an ASCII text for its key, that is no method, accessor, shorthand or `__proto__`.
    fn find_only_property(&self, props: Span<PropId>, name: Atom) -> Option<ExprId> {
        let hir = self.hir;
        if props.len() != 1 {
            return None;
        }
        let property = hir[props.at(0)];
        let is_text_key = match property.name_kind {
            NameKind::Identifier => true,
            NameKind::StringLiteral => self.atoms.bytes(name).is_ascii(),
            NameKind::NumericLiteral
            | NameKind::ComputedString
            | NameKind::ComputedNumber
            | NameKind::Jsx => false,
        };
        let is_read = property.kind == PropKind::Init
            && is_text_key
            && property.key == PropKey::Name(name)
            && name != known::__proto__;
        is_read
            .then_some(property.value)
            .filter(|value| value.is_some())
    }

    /// The number index of `e_index` on an array literal: the only item, or one of several that `expr_can_be_removed_if_unused` lets go. A hole is `undefined`.
    fn find_item_read(&self, array: ExprId, items: IdList<ExprId>, index: usize) -> Option<Read> {
        let mut held: SmallVec<[HeldItem; 8]> = SmallVec::new();
        self.push_items_held_by_bun_run(items, &mut held);
        let item = *held.get(index)?;
        if held.len() != 1 && !self.is_removed_if_unused_by_bun_run(array) {
            return None;
        }
        match item {
            HeldItem::Hole => Some(Read::Constant(Constant::Undefined)),
            HeldItem::Spread => None,
            HeldItem::Item(item) => {
                let is_inlined = !self.is_in_optional_chain_of_bun_run(self.held_by_bun_run(item));
                is_inlined.then_some(Read::Item(item))
            }
        }
    }

    /// `inline_spread_of_array_literals`: the items with those of `...[a, b]` in its place.
    fn push_items_held_by_bun_run(
        &self,
        items: IdList<ExprId>,
        held: &mut SmallVec<[HeldItem; 8]>,
    ) {
        let hir = self.hir;
        let mut lists: SmallVec<[(IdList<ExprId>, usize, bool); 4]> = SmallVec::new();
        lists.push((items, 0, self.inlines_spread_arrays(items)));
        while let Some(list) = lists.last_mut() {
            let (items, next, inlines) = *list;
            if next == items.len() {
                lists.pop();
                continue;
            }
            list.1 += 1;
            let item = hir.id_at(items, next);
            match (hir[item].kind, self.find_spread_array(item)) {
                (ExprKind::Missing, _) => held.push(HeldItem::Hole),
                (_, Some(spread)) if inlines => {
                    lists.push((spread.items, 0, self.inlines_spread_arrays(spread.items)));
                }
                (ExprKind::Spread(_), _) => held.push(HeldItem::Spread),
                _ => held.push(HeldItem::Item(item)),
            }
        }
    }

    /// `e_index` has `a["b"]` as `a.b` before its visit. A key that it computes to a name becomes `a.b` behind the rewrite: `{ ab: 0 }["a" + "b"]` stays.
    fn find_key_read_by_bun_run(&self, e: ExprId, key: MemberKey) -> Option<Key> {
        let (hir, atoms) = (self.hir, self.atoms);
        let index = match key {
            MemberKey::Name(name) => {
                let is_resolved = hir.is_name_resolved_by_transpiler(e, atoms.bytes(name));
                return is_resolved.then_some(Key::Name(name));
            }
            MemberKey::PrivateName(_) => return None,
            MemberKey::Computed(index) => index,
        };
        let written = hir.skip_type_assertions(index);
        if let MemberKey::Name(name) = hir.index_member_key(written) {
            return (atoms.bytes(name).is_ascii()).then_some(Key::Name(name));
        }
        let Value::Known(value) = self.folded(written).value else {
            return None;
        };
        if !self.is_folded_by_bun_run(written) {
            return None;
        }
        match self.evaluator.to_constant(value) {
            Constant::Number(number) => to_index(number).map(Key::Index),
            Constant::String(text) => {
                let is_rewritten = !bun_core::lexer::is_identifier(atoms.bytes(text));
                is_rewritten.then_some(Key::Name(text))
            }
            Constant::Undefined | Constant::Null | Constant::Boolean(_) | Constant::BigInt(_) => {
                None
            }
        }
    }

    /// A text literal, the text that `bun run` computes there, or the one that the name of a constant stands for.
    fn find_text_held_by_bun_run(&self, held: ExprId) -> Option<Text> {
        let hir = self.hir;
        let mut held = held;
        loop {
            let kind = hir[held].kind;
            if let ExprKind::String(value) = kind {
                return Some(Text {
                    value,
                    joined: None,
                });
            }
            let Value::Known(value) = self.folded(held).value else {
                return None;
            };
            if !self.is_folded_by_bun_run(held) {
                return None;
            }
            let Constant::String(value) = self.evaluator.to_constant(value) else {
                return None;
            };
            let joined = match kind {
                ExprKind::Ident(_) => {
                    held = self.held_by_bun_run(self.find_const_initializer(held)?);
                    continue;
                }
                ExprKind::Unary {
                    op: UnOp::Typeof, ..
                } => None,
                // `"abc"[1]`
                ExprKind::Dot { .. } | ExprKind::Index { .. }
                    if self.is_folded_by_bun_run_alone(held) =>
                {
                    None
                }
                // `bun run` joins what is held in 8 bits.
                ExprKind::Template { .. } if self.atoms.bytes(value).is_ascii() => None,
                ExprKind::Binary { op: BinOp::Add, .. } if self.atoms.bytes(value).is_ascii() => {
                    Some(held)
                }
                _ => return None,
            };
            return Some(Text { value, joined });
        }
    }

    /// The length of the first piece of `a + b + c`: the text of `a`, or of the sum of the numbers in front of the first text.
    fn find_first_piece_len(&self, sum: ExprId) -> usize {
        let hir = self.hir;
        let mut sum = sum;
        loop {
            let addends = self.collect_addends(sum);
            let first = self.held_by_bun_run(addends[0]);
            if let ExprKind::Binary { op: BinOp::Add, .. } = hir[first].kind {
                sum = first;
                continue;
            }
            let mut values = addends.iter().map(|&addend| self.folded(addend).value);
            let mut piece = values.next().unwrap_or(Value::Unknown);
            for value in values {
                let (Value::Known(left), Value::Known(right)) = (piece, value) else {
                    return 0;
                };
                if self.evaluator.is_string(left) || self.evaluator.is_string(right) {
                    break;
                }
                piece = self.evaluator.add_all([piece, value]);
            }
            let Value::Known(piece) = piece else {
                return 0;
            };
            let mut text = Vec::new();
            self.evaluator.push_text(&mut text, piece);
            return text.len();
        }
    }

    /// `sfx_t_question_dot`: the parser of `bun run` starts no optional chain behind what is never null or undefined as it is written.
    fn is_in_optional_chain_of_bun_run(&self, link: ExprId) -> bool {
        let hir = self.hir;
        let mut link = link;
        let mut is_first = true;
        loop {
            let (object, chain) = match hir[link].kind {
                ExprKind::Dot { obj, chain, .. } | ExprKind::Index { obj, chain, .. } => {
                    (obj, chain)
                }
                ExprKind::Call(call) => (hir[call].callee, hir[call].chain),
                _ => return !is_first,
            };
            match chain {
                Chain::No => return false,
                Chain::Start => return !is_never_nullish_as_written(hir, object),
                Chain::Continue => link = hir.skip_type_assertions(object),
            }
            is_first = false;
        }
    }

    /// `e_if` and `visit_right_and_finish`: the operand that `bun run` has in place of `a ? b : c`, `a && b`, `a || b`, `a ?? b` and `(a, b)`, and the member in place of a read of a literal.
    #[inline]
    pub(super) fn held_by_bun_run(&self, e: ExprId) -> ExprId {
        let e = self.hir.skip_type_assertions(e);
        match self.hir[e].kind {
            ExprKind::Dot { .. }
            | ExprKind::Index { .. }
            | ExprKind::Cond { .. }
            | ExprKind::Binary { .. } => self.find_held_by_bun_run(e),
            _ => e,
        }
    }

    #[inline(never)]
    fn find_held_by_bun_run(&self, e: ExprId) -> ExprId {
        let mut held = e;
        while let Some(next) = self.find_operand_in_place(held) {
            held = self.hir.skip_type_assertions(next);
        }
        held
    }

    /// One step of `held_by_bun_run`. It has nothing for what `bun run` keeps as it is written: `(a(), 0)`, `[] && 1`.
    pub(super) fn find_operand_in_place(&self, e: ExprId) -> Option<ExprId> {
        let hir = self.hir;
        match hir[e].kind {
            ExprKind::Dot { .. } | ExprKind::Index { .. } => self.find_item_in_place(e),
            ExprKind::Cond { test, branches } => {
                let branches = hir.branches(branches);
                let selected = self.is_truthy_as_test_in_bun_run(test).map(|is_truthy| {
                    if is_truthy { branches.yes } else { branches.no }
                });
                selected.filter(|_| self.is_dropped_where_unused_by_bun_run(test))
            }
            ExprKind::Binary {
                op: BinOp::Comma,
                left,
                right,
            } => (self.is_dropped_where_unused_by_bun_run(left)).then_some(right),
            ExprKind::Binary {
                op: op @ (BinOp::And | BinOp::Or | BinOp::Nullish),
                left,
                right,
            } => self.find_operand_in_place_of_logical(op, left, right),
            _ => None,
        }
    }

    /// The item that `bun run` has in place of the member read.
    #[inline]
    pub(super) fn find_item_in_place(&self, read: ExprId) -> Option<ExprId> {
        if self.replaced_by.is_empty() {
            return None;
        }
        self.replaced_by.get(&read).copied()
    }

    /// The member that `bun run` has in place of a member read of a literal, or the expression itself.
    #[inline]
    pub(super) fn skip_to_item_in_place(&self, e: ExprId) -> ExprId {
        let mut e = e;
        while let Some(item) = self.find_item_in_place(e) {
            e = self.hir.skip_type_assertions(item);
        }
        e
    }
}
