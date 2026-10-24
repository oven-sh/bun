use super::evaluate::Value;
use super::feature_flags::find_feature_flag;
use super::folder::{Effects, Folded, Folder};
use super::{Constant, Decision};
use crate::bind::Binding;
use crate::hir::{Call, Chain, ExprId, ExprKind, IdList};
use crate::import_sites::{ImportSpecifier, call_site_arguments};

impl<'s> Folder<'_, 's> {
    pub(super) fn fold_call(&mut self, e: ExprId, call: Call) -> Folded {
        let callee_state = self.path_states.get(&call.callee);
        if callee_state.is_some_and(|state| state.is_dropped) {
            return self.decide(e, Decision::Constant(Constant::Undefined));
        }
        if let Some(folded) = self.fold_short_circuit(e, call.callee, call.chain) {
            return folded;
        }
        if call.chain == Chain::No && self.is_feature_callee(call.callee) {
            return self.fold_feature_call(e);
        }
        if let Some(given) = call_site_arguments(self.hir, self.bound, e) {
            self.record_specifier(given);
        }
        self.fold_replace_at_end_of_text(call)
            .unwrap_or(Folded::UNKNOWN)
    }

    fn fold_replace_at_end_of_text(&self, call: Call) -> Option<Folded> {
        let hir = self.hir;
        let callee = hir.skip_type_assertions(call.callee);
        let ExprKind::Dot {
            obj,
            name,
            chain: Chain::No,
            ..
        } = hir[callee].kind
        else {
            return None;
        };
        if call.chain != Chain::No || self.atoms.bytes(name) != b"replace" {
            return None;
        }
        let mut arguments = hir.ids(call.args);
        let (pattern, replacement) = (arguments.next()?, arguments.next()?);
        let ExprKind::Regex { pattern, flags } = hir[pattern].kind else {
            return None;
        };
        if arguments.next().is_some() || !self.atoms.bytes(flags).is_empty() {
            return None;
        }
        let (text, replacement) = (self.folded_text(obj)?, self.folded_text(replacement)?);
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

    fn is_feature_callee(&self, callee: ExprId) -> bool {
        if self.feature_symbol.is_none() {
            return false;
        }
        let callee = self.hir.skip_type_assertions(callee);
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
        match self.find_specifier(argument) {
            specifier @ ImportSpecifier::Constant(_) => {
                self.specifiers.push((argument, specifier));
                if self.has_followed_path_call.get() {
                    self.paths_made_by_calls.push(argument);
                }
            }
            specifier @ ImportSpecifier::Pattern { .. } => {
                self.specifiers.push((argument, specifier));
                if self.starts_at_own_directory(argument) {
                    self.paths_from_own_directory.push(argument);
                }
            }
            ImportSpecifier::Unknown => {}
        }
    }
}
