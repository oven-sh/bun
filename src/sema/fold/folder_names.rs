use super::evaluate::Value;
use super::folder::{Effects, Folded, Folder};
use super::inputs::{DefineRoot, DefineValue, PathState, RuntimeValueKind};
use super::{Constant, Decision, FoldedValue};
use crate::atom::{Atom, known};
use crate::bind::{
    Binding, BindingInitializer, BindingKind, CommonJsVariable, ScopeKind, SymbolId,
};
use crate::hir::{Chain, ExprId, ExprKind, MemberKey, NodeData, UnOp};
use crate::import_sites::is_in_with_scope;
use crate::module_format::main_module_operand;

impl<'s> Folder<'_, 's> {
    pub(super) fn fold_ident(&mut self, e: ExprId, name: Atom) -> Folded {
        match self.bound.binding(e) {
            Binding::Free
            | Binding::CommonJs(
                CommonJsVariable::Require | CommonJsVariable::Filename | CommonJsVariable::Dirname,
            ) if self.is_define_root(e) => {
                let root = self.inputs.root(DefineRoot::Global(name));
                let state = root.map(|root| PathState {
                    has_dynamic_root: !self.has_static_lookup(e),
                    ..root
                });
                match self.try_decide_define(e, state) {
                    Some(folded) => folded,
                    None => self.fold_loader_name(e),
                }
            }
            Binding::Symbol(symbol) => self.fold_const_read(e, symbol),
            Binding::CommonJs(_) => self.fold_loader_name(e),
            Binding::Free | Binding::Arguments(_) => Folded::UNKNOWN,
        }
    }

    pub(super) fn fold_member(&mut self, e: ExprId, chain: Chain) -> Folded {
        let hir = self.hir;
        let Some((obj, MemberKey::Name(name))) = hir.member_key(e) else {
            return Folded::UNKNOWN;
        };
        let is_in_chain = chain != Chain::No;
        let object_state = self.path_states.get(&obj);
        let state = object_state.and_then(|&state| self.inputs.child(state, name, is_in_chain));
        if let Some(folded) = self.try_decide_define(e, state) {
            return folded;
        }
        let object_kind = hir[hir.skip_type_assertions(obj)].kind;
        let is_main_access = matches!(object_kind, ExprKind::ImportMeta) && name == known::main;
        let is_main_read = is_main_access
            && !is_in_chain
            && !self.is_assignment_target(e)
            && !self.is_delete_operand(e);
        match self.file.import_meta_main {
            Some(is_main) if is_main_read => {
                self.decide(e, Decision::Constant(Constant::Boolean(is_main)))
            }
            Some(_) | None => Folded::UNKNOWN,
        }
    }

    pub(super) fn fold_short_circuit(
        &mut self,
        link: ExprId,
        object: ExprId,
        chain: Chain,
    ) -> Option<Folded> {
        let object_value = self.folded(object);
        let is_short_circuited = match (chain, object_value.value) {
            (Chain::Start, Value::Known(object)) => self.evaluator.is_nullish(object),
            (Chain::Continue, _) => self.short_circuited_links.contains(object.idx()),
            (Chain::Start, Value::Unknown) | (Chain::No, _) => false,
        };
        if !is_short_circuited {
            return None;
        }
        self.short_circuited_links.insert(link.idx());
        let undefined = Value::from(Constant::Undefined);
        Some(Folded::new(undefined, object_value.effects))
    }

    pub(super) fn fold_import_meta(&mut self, e: ExprId) -> Folded {
        let state = self.inputs.root(DefineRoot::ImportMeta);
        self.try_decide_define(e, state).unwrap_or(Folded::UNKNOWN)
    }

    pub(super) fn find_main_module_equality(&self, comparison: ExprId) -> Option<bool> {
        let is_main = self.file.import_meta_main?;
        main_module_operand(self.hir, self.bound, comparison).map(|_| is_main)
    }

    pub(super) fn find_const_initializer(&self, ident: ExprId) -> Option<ExprId> {
        let bound = self.bound;
        let symbol = match bound.binding(ident) {
            Binding::Symbol(symbol) => symbol,
            Binding::Free | Binding::Arguments(_) | Binding::CommonJs(_) => return None,
        };
        let is_stable_const = bound.binding_kind(symbol) == BindingKind::Const
            && bound.is_stable_binding(symbol)
            && self.has_static_lookup(ident);
        if !is_stable_const {
            return None;
        }
        match bound.binding_initializer(self.hir, symbol) {
            BindingInitializer::Expression(init) if init < ident => Some(init),
            BindingInitializer::Expression(_)
            | BindingInitializer::Class(_)
            | BindingInitializer::Function(_)
            | BindingInitializer::Namespace(_)
            | BindingInitializer::Enum(_)
            | BindingInitializer::PatternProperty { .. }
            | BindingInitializer::EntityName(_)
            | BindingInitializer::Import
            | BindingInitializer::Opaque => None,
        }
    }

    fn fold_const_read(&mut self, ident: ExprId, symbol: SymbolId) -> Folded {
        let Some(init) = self.find_const_initializer(ident) else {
            return Folded::UNKNOWN;
        };
        match self.folded_value(init) {
            FoldedValue::Constant(constant) if self.is_library_binding(symbol) => {
                self.decide(ident, Decision::Constant(constant))
            }
            FoldedValue::Constant(_)
            | FoldedValue::ConstantOutsideDeadZone(_)
            | FoldedValue::Unknown => {
                self.copy_condition(ident, init);
                Folded::new(self.folded(init).value, Effects::DeadZoneCheck)
            }
        }
    }

    fn is_library_binding(&self, symbol: SymbolId) -> bool {
        let scope = self.bound.scopes.get(self.bound.symbol_scope(symbol).idx());
        self.file.is_library && scope.is_some_and(|scope| matches!(scope.kind, ScopeKind::File))
    }

    fn try_decide_define(&mut self, e: ExprId, state: Option<PathState>) -> Option<Folded> {
        let state = state?;
        self.path_states.insert(e, state);
        let value = self.inputs.value_of(state)?;
        let is_renamed_identifier = matches!(self.hir[e].kind, ExprKind::Ident(_))
            && matches!(value, DefineValue::GlobalPath(_));
        if !is_renamed_identifier && self.is_assignment_target(e) {
            return None;
        }
        Some(match value {
            DefineValue::Constant(constant) => self.decide(e, Decision::Constant(constant)),
            DefineValue::GlobalPath(path) => self.decide(e, Decision::GlobalPath(path)),
            DefineValue::Data(data) => self.decide(e, Decision::of_data(data)),
            DefineValue::RuntimeValue(_) => {
                self.conditions.insert(e, true);
                Folded::UNKNOWN
            }
        })
    }

    pub(super) fn find_runtime_value_kind(&self, e: ExprId) -> Option<RuntimeValueKind> {
        let &state = self.path_states.get(&e)?;
        match self.inputs.value_of(state)? {
            DefineValue::RuntimeValue(kind) => Some(kind),
            DefineValue::Constant(_) | DefineValue::GlobalPath(_) | DefineValue::Data(_) => None,
        }
    }

    fn has_static_lookup(&self, ident: ExprId) -> bool {
        let scope = self.bound.dynamic_lookup_scope(NodeData::Expr(ident));
        scope.is_none()
    }

    fn find_outermost_cast(&self, e: ExprId) -> ExprId {
        let mut outermost = e;
        while let Some(parent) = self.parent_expr(outermost)
            && self.hir.type_assertion_operand(parent).is_some()
        {
            outermost = parent;
        }
        outermost
    }

    fn is_assignment_target(&self, e: ExprId) -> bool {
        let target = self.find_outermost_cast(e);
        self.bound.get_assignment_target(self.hir, target).is_some()
    }

    fn is_delete_operand(&self, e: ExprId) -> bool {
        let parent = self.parent_expr(self.find_outermost_cast(e));
        let parent_kind = parent.map(|parent| self.hir[parent].kind);
        matches!(parent_kind, Some(ExprKind::Unary { op: UnOp::Delete, .. }))
    }

    fn is_define_root(&self, ident: ExprId) -> bool {
        !self.inputs.is_empty()
            && self.bound.is_evaluated_ident(ident)
            && !is_in_with_scope(self.bound, ident)
            && !self.is_delete_operand(ident)
    }
}
