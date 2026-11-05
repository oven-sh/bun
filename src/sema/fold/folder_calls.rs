use super::evaluate::{Primitive, Value};
use super::feature_flags::find_feature_flag;
use super::folder::{Effects, Folded, Folder};
use super::known_sets::{name_of_join, name_of_replace, name_of_split};
use super::{Constant, Decision, MadeByCall, slice_in};
use crate::atom::{Atom, known};
use crate::bind::Binding;
use crate::hir::{Call, Chain, ExprId, ExprKind, IdList, MemberKey};
use crate::hir_from_data::DataValue;
use crate::import_sites::{ImportSpecifier, call_site_arguments, may_construct_worker};

impl<'s> Folder<'_, 's> {
    pub(super) fn fold_call(&mut self, e: ExprId, call: Call) -> Folded {
        let callee = self.hir.skip_type_assertions(call.callee);
        if call.chain == Chain::No
            && self.is_feature_callee(callee)
            && !self.inputs.features_are_unknown()
        {
            return self.fold_feature_call(e);
        }
        let find_code = |folder: &Self| folder.find_char_code_in_written_text(call);
        let key = self.hir.member_key(callee);
        if let Some((_, MemberKey::Name(known::charCodeAt))) = key
            && let Some(code) = self.holds_under_minify_syntax(find_code)
        {
            if find_code(self).is_none() {
                self.mark_folded_under_minify_syntax_alone(e);
            }
            return self.decide(e, Decision::Constant(Constant::Number(code)));
        }
        let callee_state = self.path_states.get(&call.callee).copied();
        let is_dropped = callee_state.is_some_and(|state| state.is_dropped);
        if !(is_dropped && callee_state.is_some_and(|state| self.inputs.is_user_defined(state))) {
            self.mark_folded_by_build_alone(e);
        }
        if is_dropped {
            return self.decide(e, Decision::Constant(Constant::Undefined));
        }
        if call.chain != Chain::No
            && let Some(folded) = self.fold_short_circuit(e, call.callee, call.chain)
        {
            return folded;
        }
        if let Some(given) = call_site_arguments(self.hir, self.bound, e) {
            self.record_specifier(given);
        }
        let ExprKind::Dot {
            obj,
            name,
            chain: Chain::No,
            ..
        } = self.hir[callee].kind
        else {
            return Folded::UNKNOWN;
        };
        if call.chain != Chain::No {
            return Folded::UNKNOWN;
        }
        if call.args.len() == 1
            && let Some(pieces) = self.split_written_text(call, obj, name)
        {
            return self.decide(e, Decision::Data(pieces));
        }
        if let Some((list, MemberKey::Name(known::join))) = key
            && let Some(joined) = self.fold_join_of_constants(call, list)
        {
            return match (joined.value, joined.effects) {
                (Value::Known(text), Effects::None) => {
                    let text = self.evaluator.to_constant(text);
                    self.decide(e, Decision::Constant(text))
                }
                _ => joined,
            };
        }
        if call.args.len() != 2 {
            return Folded::UNKNOWN;
        }
        self.fold_replace_at_end_of_text(call, obj, name)
            .unwrap_or(Folded::UNKNOWN)
    }

    fn find_char_code_in_written_text(&self, call: Call) -> Option<f64> {
        let hir = self.hir;
        let ExprKind::Dot { obj, .. } = hir[hir.skip_type_assertions(call.callee)].kind else {
            return None;
        };
        let mut arguments = hir.ids(call.args);
        let (Some(index), None) = (arguments.next(), arguments.next()) else {
            return None;
        };
        let constant_of = |e: ExprId| match self.folded(e).value {
            Value::Known(value) if self.is_literal_to_bun_run(e) => {
                Some(self.evaluator.to_constant(value))
            }
            _ => None,
        };
        if self.is_enum_member_written_in_place(obj) {
            return None;
        }
        let (Constant::String(text), Constant::Number(index)) =
            (constant_of(obj)?, constant_of(index)?)
        else {
            return None;
        };
        let first_piece = match self.is_kept_in_one_piece(obj, text) {
            true => text,
            false => match hir[self.collect_addends(hir.skip_type_assertions(obj))[0]].kind {
                ExprKind::String(written) if written != known::empty => written,
                _ => return None,
            },
        };
        let bytes = self.atoms.bytes(first_piece);
        let is_inside = index % 1.0 == 0.0 && index >= 0.0 && index < bytes.len() as f64;
        (is_inside && bytes.is_ascii()).then(|| f64::from(bytes[index as usize]))
    }

    fn fold_join_of_constants(&self, call: Call, list: ExprId) -> Option<Folded> {
        let hir = self.hir;
        if name_of_join(self.inputs, self.atoms) != Some(known::join) {
            return None;
        }
        let mut arguments = hir.ids(call.args);
        let comma = Value::from(Constant::String(self.atoms.intern(b",")));
        let separator = match arguments.next().map(|written| self.folded(written)) {
            None => Folded::new(comma, Effects::None),
            Some(given) => match given.value {
                Value::Known(text) if self.evaluator.is_string(text) => given,
                Value::Known(Primitive::Constant(Constant::Undefined)) => {
                    Folded::new(comma, given.effects)
                }
                Value::Known(_) | Value::Unknown => return None,
            },
        };
        if arguments.next().is_some() {
            return None;
        }
        let (items, effects_of_list) = self.find_list_as_written(list)?;
        let mut parts = vec![Value::from(Constant::String(known::empty))];
        for (index, item) in hir.ids(items).enumerate() {
            let Value::Known(element) = self.folded(item).value else {
                return None;
            };
            if index > 0 {
                parts.push(separator.value);
            }
            if !self.evaluator.is_nullish(element) {
                parts.push(Value::Known(element));
            }
        }
        let effects = effects_of_list.min(separator.effects);
        Some(Folded::new(self.evaluator.add_all(parts), effects))
    }

    fn find_list_as_written(&self, written: ExprId) -> Option<(IdList<ExprId>, Effects)> {
        let (hir, bound) = (self.hir, self.bound);
        let effects_of_items = |items: IdList<ExprId>| {
            let effects = hir.ids(items).map(|item| self.folded(item).effects);
            effects.min().unwrap_or(Effects::None)
        };
        let effects_of_casts = self.effects_of_casts_around(written);
        let inner = hir.skip_type_assertions(written);
        if let ExprKind::Array(items) = hir[inner].kind {
            return Some((items, effects_of_casts.min(effects_of_items(items))));
        }
        let (ExprKind::Ident(_), Binding::Symbol(holder)) = (hir[inner].kind, bound.binding(inner))
        else {
            return None;
        };
        let list = hir.skip_type_assertions(self.find_const_initializer(inner)?);
        let ExprKind::Array(items) = hir[list].kind else {
            return None;
        };
        let holders = &self.list_holders;
        let join = || name_of_join(self.inputs, self.atoms);
        let stays_as_written = bound.is_evaluated_ident(inner)
            && !bound.is_store_target(inner)
            && !bound.is_visible_to_eval(holder)
            && effects_of_items(items) >= Effects::TypeTest
            && !holders.is_reached_without_mention(hir, bound, holder)
            && !holders.is_handed_on(hir, bound, join, |_| false, holder);
        stays_as_written.then_some((items, effects_of_casts.min(Effects::DeadZoneCheck)))
    }

    fn effects_of_casts_around(&self, mut written: ExprId) -> Effects {
        let mut effects = Effects::None;
        while let Some(operand) = self.hir.type_assertion_operand(written) {
            if !self.hir.is_js && matches!(self.hir[written].kind, ExprKind::As { .. }) {
                effects = Effects::TypeTest;
            }
            written = operand;
        }
        effects
    }

    fn split_written_text(&self, call: Call, obj: ExprId, name: Atom) -> Option<&'s DataValue<'s>> {
        let separator = self.hir.ids(call.args).next()?;
        let (text, separator) = (self.written_text(obj)?, self.written_text(separator)?);
        if name_of_split(self.inputs, self.atoms) != Some(name) {
            return None;
        }
        if separator.is_empty()
            || core::str::from_utf8(text).is_err()
            || core::str::from_utf8(separator).is_err()
        {
            return None;
        }
        let mut pieces = Vec::new();
        let mut rest = text;
        while let Some(found) = bun_core::strings::index_of(rest, separator) {
            pieces.push(DataValue::String(self.atoms.intern(&rest[..found])));
            rest = &rest[found + separator.len()..];
        }
        pieces.push(DataValue::String(self.atoms.intern(rest)));
        let list = DataValue::Array(slice_in(&pieces, self.arena));
        Some(self.arena.alloc(list))
    }

    fn written_text(&self, e: ExprId) -> Option<&[u8]> {
        match self.hir[self.hir.skip_type_assertions(e)].kind {
            ExprKind::String(text) => Some(self.atoms.bytes(text)),
            _ => None,
        }
    }

    fn fold_replace_at_end_of_text(&self, call: Call, obj: ExprId, name: Atom) -> Option<Folded> {
        let hir = self.hir;
        let mut arguments = hir.ids(call.args);
        let (pattern, replacement) = (arguments.next()?, arguments.next()?);
        let ExprKind::Regex { pattern, flags } = hir[pattern].kind else {
            return None;
        };
        if arguments.next().is_some() || !self.atoms.bytes(flags).is_empty() {
            return None;
        }
        let (text, replacement) = (self.folded_text(obj)?, self.folded_text(replacement)?);
        if name_of_replace(self.inputs, self.atoms) != Some(name) {
            return None;
        }
        let mut inserted = Vec::new();
        let Value::Known(primitive) = replacement else {
            return None;
        };
        self.evaluator.push_text(&mut inserted, primitive);
        if bun_core::strings::contains_char(&inserted, b'$') {
            return None;
        }
        let parts = match self.atoms.bytes(pattern) {
            b"^" => [replacement, text],
            b"$" => [text, replacement],
            _ => return None,
        };
        Some(Folded::new(self.evaluator.add_all(parts), Effects::None))
    }

    fn folded_text(&self, e: ExprId) -> Option<Value> {
        let folded = self.folded(e);
        match (folded.value, folded.effects) {
            (Value::Known(primitive), Effects::None) if self.evaluator.is_string(primitive) => {
                Some(folded.value)
            }
            (Value::Known(_) | Value::Unknown, _) => None,
        }
    }

    pub(super) fn fold_import_call(&mut self, args: IdList<ExprId>) -> Folded {
        self.record_specifier(args);
        Folded::UNKNOWN
    }

    pub(super) fn fold_construction(&mut self, e: ExprId, call: Call) -> Folded {
        let hir = self.hir;
        if (self.find_known_construction(call)).is_some_and(|known| known.is_literal()) {
            self.conditions.insert(e, true);
            self.mark_folded_under_minify_syntax_alone(e);
        }
        if let Some(argument) = hir.ids(call.args).next()
            && !matches!(hir[argument].kind, ExprKind::String(_))
            && may_construct_worker(hir, self.bound, call.callee)
            && let specifier @ ImportSpecifier::Constant(url) = self.find_specifier(argument)
            && self.atoms.bytes(url).starts_with(b"data:")
        {
            self.specifiers.push((argument, specifier));
        }
        Folded::UNKNOWN
    }

    fn is_feature_callee(&self, callee: ExprId) -> bool {
        if self.feature_symbol.is_none() {
            return false;
        }

        matches!(self.hir[callee].kind, ExprKind::Ident(_))
            && self.bound.binding(callee) == Binding::Symbol(self.feature_symbol)
    }

    fn fold_feature_call(&mut self, e: ExprId) -> Folded {
        let is_enabled = match find_feature_flag(self.hir, self.bound, self.atoms, e) {
            Ok(flag) => self.inputs.has_feature(flag),
            Err(error) => {
                self.call_errors.push((e, error));
                false
            }
        };
        self.decide(e, Decision::Constant(Constant::Boolean(is_enabled)))
    }

    fn record_specifier(&mut self, args: IdList<ExprId>) {
        let Some(argument) = self.hir.ids(args).next() else {
            return;
        };
        if matches!(self.hir[argument].kind, ExprKind::String(_)) {
            return;
        }
        self.has_followed_path_call.set(false);
        let specifier = self.find_specifier(argument);
        let made_by_call = match self.starts_with_whole_path_made_by_call(argument) {
            true => Some(MadeByCall::WholePath),
            false => (self.has_followed_path_call.get()).then_some(MadeByCall::Part),
        };
        (self.names_made_by_calls).extend(made_by_call.map(|made| (argument, made)));
        match specifier {
            ImportSpecifier::Constant(_) if self.has_followed_path_call.get() => {
                self.paths_made_by_calls.push(argument);
            }
            ImportSpecifier::Constant(_) | ImportSpecifier::Pattern { .. } => {}
            ImportSpecifier::OneOf(_) | ImportSpecifier::Unknown => return,
        }
        self.specifiers.push((argument, specifier));
        if self.starts_at_own_directory(argument) {
            self.paths_from_own_directory.push(argument);
        }
    }
}
