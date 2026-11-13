use super::evaluate::Value;
use super::folder::{Effects, Folded, Folder};
use super::inputs::{
    DefinePath, DefineRoot, DefineValue, LinkForm, PathState, RuntimeValueKind, StoredByMocks,
};
use super::run_order::RunOrder;
use super::{Constant, Decision, FoldedValue};
use crate::atom::{Atom, known};
use crate::bind::{
    Binding, BindingInitializer, BindingKind, CommonJsVariable, Decl, PatParent, ScopeKind,
    SymbolId,
};
use crate::hir::{Chain, ExprId, ExprKind, Flags, FnId, ImportId, MemberKey, NodeData, UnOp};
use crate::hir_from_data::DataValue;
use crate::import_sites::is_in_with_scope;
use crate::module_format::settled_main_module_operand;
use std::cell::Cell;

impl<'s> Folder<'_, 's> {
    pub(super) fn fold_ident(&mut self, e: ExprId, name: Atom) -> Folded {
        let binding = self.bound.binding(e);
        let is_bound_through_name_in_place = self.is_bound_through_name_in_place(binding, name);
        if is_bound_through_name_in_place
            && let Some(root) = self.inputs.root(DefineRoot::Global(name))
            && let Some(DefineValue::GlobalPath(path @ &[_, _, ..])) = self.inputs.value_of(root)
        {
            return self.decide(e, Decision::GlobalPath(path));
        }
        match binding {
            Binding::Free
            | Binding::CommonJs(
                CommonJsVariable::Require | CommonJsVariable::Filename | CommonJsVariable::Dirname,
            ) if self.is_define_root(e) && !is_bound_through_name_in_place => {
                let root = self.inputs.root(DefineRoot::Global(name));
                let root = root.filter(|_| self.may_be_replaced(e, name));
                let state = root.map(|root| PathState {
                    has_dynamic_root: !self.has_static_lookup(e),
                    ..root
                });
                match self.try_decide_define(e, state) {
                    Some(folded) => folded,
                    None => self.fold_loader_name(e),
                }
            }
            Binding::Symbol(symbol) => self.fold_symbol_read(e, symbol),
            Binding::CommonJs(_) => self.fold_loader_name(e),
            Binding::Free | Binding::Arguments(_) => Folded::UNKNOWN,
        }
    }

    fn may_be_replaced(&self, e: ExprId, name: Atom) -> bool {
        matches!(name, known::undefined | known::NaN | known::Infinity)
            || !self.hir.is_in_known_evaluation(self.hir[e].pos)
    }

    fn fold_symbol_read(&mut self, e: ExprId, symbol: SymbolId) -> Folded {
        let kind = self.bound.binding_kind(symbol);
        if kind == BindingKind::Import {
            if self.is_process_import(symbol)
                && self.is_define_root(e)
                && !self.hir.is_in_known_evaluation(self.hir[e].pos)
            {
                let root = DefineRoot::Global(self.atoms.intern(b"process"));
                let state = self.inputs.root(root).map(|root| PathState {
                    has_optional_link: true,
                    has_dynamic_root: !self.has_static_lookup(e),
                    ..root
                });
                return self.try_decide_define(e, state).unwrap_or(Folded::UNKNOWN);
            }
            if let Some(folded) = self.fold_import_read(e, symbol) {
                return folded;
            }
        }
        if kind == BindingKind::Parameter
            && self.names_of_undefined().binary_search(&symbol).is_ok()
            && self.has_static_lookup(e)
            && !self.is_assignment_target(e)
            && !self.is_delete_operand(e)
        {
            self.mark_folded_by_build_alone(e);
            return self.decide(e, Decision::Constant(Constant::Undefined));
        }
        match self.fold_enum_member_named(e, symbol) {
            Some(folded) => folded,
            None => self.fold_const_read(e, symbol, kind),
        }
    }

    /// Parameters that no argument is passed for.
    fn names_of_undefined(&self) -> &[SymbolId] {
        self.names_of_undefined.get_or_init(|| {
            let (hir, bound) = (self.hir, self.bound);
            let mut names: Vec<SymbolId> = Vec::new();
            for function in (0..hir.fns.len() as u32).map(FnId) {
                let call = bound.get_immediately_invoked_function_expression(hir, function);
                if call.is_some_and(|call| hir[call].args.len() < hir[function].params.len()) {
                    let parameters = hir[function].params.iter();
                    let symbols = parameters
                        .filter_map(|it| bound.declared_symbol(Decl::Param(hir[it].pat)).some());
                    names.extend(symbols.filter(|&it| self.is_parameter_without_argument(it)));
                }
            }
            names.sort_unstable();
            names
        })
    }

    /// The only call of the function stands where the function is written, and passes fewer arguments.
    fn is_parameter_without_argument(&self, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let &[Decl::Param(pattern)] = bound.symbol(symbol).decls else {
            return false;
        };
        let PatParent::Param(parameter) = bound.pat_parent[pattern.idx()] else {
            return false;
        };
        let function = bound.param_fn[parameter.idx()];
        let record = hir[parameter];
        if record.default.is_some()
            || record.flags.contains(Flags::REST)
            || !bound.is_called_only_where_written(hir, function)
            || !bound.is_stable_binding(symbol)
        {
            return false;
        }
        let call = bound.get_immediately_invoked_function_expression(hir, function);
        let Some(call) = call.map(|call| hir[call]) else {
            return false;
        };
        let is_spread = |argument: ExprId| matches!(hir[argument].kind, ExprKind::Spread(_));
        let Some(index) = hir[function].params.iter().position(|it| it == parameter) else {
            return false;
        };
        let mut parameters_in_front = hir[function].params.iter().take(index);
        call.chain == Chain::No
            && !hir.ids(call.args).any(is_spread)
            && call.args.len() <= index
            && parameters_in_front.all(|it| {
                let name = bound.declared_symbol(Decl::Param(hir[it].pat));
                hir[it].default.is_none() && name.some().is_some()
            })
    }

    fn is_bound_through_name_in_place(&self, binding: Binding, name: Atom) -> bool {
        let written = DefinePath {
            root: DefineRoot::Global(name),
            members: &[],
        };
        let mut names_in_place = self.inputs.names_in_place.iter();
        if !names_in_place.any(|it| it.path == written) {
            return false;
        }
        match binding {
            Binding::Free => false,
            Binding::Symbol(symbol) => self.bound.symbol(symbol).name != name,
            Binding::Arguments(_) | Binding::CommonJs(_) => true,
        }
    }

    fn is_process_import(&self, symbol: SymbolId) -> bool {
        if self.bound.binding_kind(symbol) != BindingKind::Import {
            return false;
        }
        let (hir, bound) = (self.hir, self.bound);
        let imports = self.process_imports.get_or_init(|| {
            let module = self.atoms.intern(b"node:process");
            let imports = (0..).map(ImportId).zip(hir.imports.iter());
            imports
                .filter(|(_, import)| {
                    import.spec == module && !import.type_only && import.default != Atom::NONE
                })
                .map(|(id, _)| bound.declared_symbol(Decl::ImportDefault(id)))
                .collect()
        });
        imports.contains(&symbol)
    }

    pub(super) fn fold_member(&mut self, e: ExprId, chain: Chain) -> Folded {
        let hir = self.hir;
        let Some((obj, MemberKey::Name(name))) = hir.member_key(e) else {
            return self.fold_read_out_of_literal(e, chain);
        };
        let is_in_chain = chain != Chain::No;
        let form = LinkForm {
            is_in_optional_chain: is_in_chain,
            is_index: hir.is_written_in_brackets(e) && !self.is_hot_of_import_meta(obj),
        };
        let object_state = self.path_states.get(&obj);
        let object_state =
            object_state.filter(|_| hir.is_name_resolved_by_transpiler(e, self.atoms.bytes(name)));
        let state = object_state.and_then(|&state| self.inputs.child(state, name, form));
        if state.is_some()
            && let Some(folded) = self.try_decide_define(e, state)
        {
            return folded;
        }
        if let Some(folded) = self.fold_imported_member(e, obj, name) {
            return folded;
        }
        if let Some(folded) = self.fold_enum_member_read(e) {
            return folded;
        }
        if name == known::hot
            && self.is_hot_of_import_meta(e)
            && !is_in_chain
            && !self.is_assignment_target(e)
            && !self.is_delete_operand(e)
        {
            self.mark_folded_by_build_alone(e);
            self.conditions_told_by_shape.insert(e.idx());
            return self.decide(e, Decision::Constant(Constant::Undefined));
        }
        let object_kind = hir[hir.skip_type_assertions(obj)].kind;
        let is_main_access = matches!(object_kind, ExprKind::ImportMeta) && name == known::main;
        let is_main_read = is_main_access
            && !is_in_chain
            && !self.is_assignment_target(e)
            && !self.is_delete_operand(e);
        match self.file.import_meta_main {
            Some(is_main) if is_main_read && !self.is_main_of_import_meta_written() => {
                self.mark_folded_by_build_alone(e);
                self.decide(e, Decision::Constant(Constant::Boolean(is_main)))
            }
            Some(_) | None => self.fold_read_out_of_literal(e, chain),
        }
    }

    pub(super) fn may_read_main_of_import_meta(&self, meta: ExprId) -> bool {
        let meta = self.find_outermost_cast(meta);
        let member = self
            .parent_expr(meta)
            .and_then(|parent| self.hir.member_key(parent));
        match member {
            Some((object, MemberKey::Name(name))) if object == meta => name == known::main,
            Some(_) | None => true,
        }
    }

    fn is_main_of_import_meta_written(&self) -> bool {
        *self.is_main_of_import_meta_written.get_or_init(|| {
            let mut exprs = (0..self.hir.exprs.len()).map(|index| ExprId(index as u32));
            exprs.any(|e| {
                if !matches!(self.hir[e].kind, ExprKind::ImportMeta) {
                    return false;
                }
                let meta = self.find_outermost_cast(e);
                let Some(member) = self.parent_expr(meta) else {
                    return true;
                };
                match self.hir.member_key(member) {
                    Some((object, MemberKey::Name(name)))
                        if object == meta && name != known::main =>
                    {
                        false
                    }
                    Some((object, _)) if object == meta => {
                        self.is_assignment_target(member) || self.is_delete_operand(member)
                    }
                    Some(_) | None => true,
                }
            })
        })
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
        self.mark_folded_by_build_alone(link);
        let undefined = Value::from(Constant::Undefined);
        Some(Folded::new(undefined, object_value.effects))
    }

    pub(super) fn fold_import_meta(&mut self, e: ExprId) -> Folded {
        let state = self.inputs.root(DefineRoot::ImportMeta);
        self.try_decide_define(e, state).unwrap_or(Folded::UNKNOWN)
    }

    pub(super) fn find_main_module_equality(&self, comparison: ExprId) -> Option<bool> {
        let is_main = self.file.import_meta_main?;
        settled_main_module_operand(self.hir, self.bound, comparison).map(|_| is_main)
    }

    pub(super) fn find_const_initializer(&self, ident: ExprId) -> Option<ExprId> {
        let symbol = match self.bound.binding(ident) {
            Binding::Symbol(symbol) => symbol,
            Binding::Free | Binding::Arguments(_) | Binding::CommonJs(_) => return None,
        };
        match self.bound.binding_kind(symbol) {
            kind @ BindingKind::Const => self.find_only_initializer(ident, symbol, kind),
            _ => None,
        }
    }

    fn find_only_initializer(
        &self,
        ident: ExprId,
        symbol: SymbolId,
        kind: BindingKind,
    ) -> Option<ExprId> {
        let init = self.find_initializer_of_stable_binding(symbol)?;
        if init >= ident || !self.has_static_lookup(ident) {
            return None;
        }
        let is_read_behind = kind != BindingKind::Var || self.is_read_behind(ident, init);
        let holds_initializer = is_read_behind
            && (!self.is_stored_by_mocks(symbol)
                || self.is_inlined_by_plain_bun(ident, symbol, init));
        holds_initializer.then_some(init)
    }

    fn find_initializer_of_stable_binding(&self, symbol: SymbolId) -> Option<ExprId> {
        let known = self.initializers_of_stable_bindings.get(symbol.idx());
        if let Some(found) = known.and_then(Cell::get) {
            return found;
        }
        let bound = self.bound;
        let found = match bound.is_stable_binding(symbol) {
            true => match bound.binding_initializer(self.hir, symbol) {
                BindingInitializer::Expression(init) => Some(init),
                _ => None,
            },
            false => None,
        };
        if let Some(known) = known {
            known.set(Some(found));
        }
        found
    }

    fn is_stored_by_mocks(&self, symbol: SymbolId) -> bool {
        match self.inputs.stored_by_mocks {
            _ if self.file.is_library => false,
            StoredByMocks::Nothing => false,
            StoredByMocks::Variables(variables) => variables.binary_search(&symbol).is_ok(),
            StoredByMocks::EveryExport => self.is_exported_variable(symbol),
        }
    }

    pub(super) fn is_exported_variable(&self, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let variables = self.exported_variables.get_or_init(|| {
            let exports = bound.table(bound.symbol(bound.file_symbol).exports);
            let declarations = exports.iter().flat_map(|it| bound.symbol(it.1).decls);
            let mut variables: Vec<SymbolId> = declarations
                .filter_map(|&declaration| match declaration {
                    Decl::Var(_) => Some(bound.declared_symbol(declaration)),
                    Decl::ExportSpec(spec) if !hir[hir[spec].export].has_module_specifier => {
                        match bound.exported_binding(spec) {
                            Binding::Symbol(local) => Some(local),
                            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
                        }
                    }
                    _ => None,
                })
                .collect();
            variables.sort_unstable();
            variables
        });
        variables.binary_search(&symbol).is_ok()
    }

    fn is_inlined_by_bun_run(&self, ident: ExprId, symbol: SymbolId, init: ExprId) -> bool {
        self.minifies_syntax()
            && self.bound.binding_kind(symbol) == BindingKind::Const
            && self.can_be_const_value(init)
            && self.is_folded_by_bun_run(init)
            && self.is_in_constant_prefix(init)
            && !self.is_in_enum_beside(ident, init)
    }

    fn is_inlined_by_plain_bun(&self, ident: ExprId, symbol: SymbolId, init: ExprId) -> bool {
        match self.inputs.runs_in_place {
            true => self.holds_under_minify_syntax(|folder| {
                folder.is_inlined_by_bun_run(ident, symbol, init)
            }),
            false => self.is_inlined_by_bun_run(ident, symbol, init),
        }
    }

    fn is_read_behind(&self, ident: ExprId, init: ExprId) -> bool {
        let is_known = matches!(self.folded(init).value, Value::Known(_));
        if !is_known && self.find_runtime_value_kind(init).is_none() {
            return false;
        }
        let order = self.run_order.get_or_init(|| RunOrder::new(self.hir));
        order.is_read_behind(self.hir, ident, init)
    }

    pub(super) fn is_constant_read_behind_its_declaration(&self, read: ExprId) -> bool {
        let (ExprKind::Ident(_), Binding::Symbol(symbol)) =
            (self.hir[read].kind, self.bound.binding(read))
        else {
            return false;
        };
        let kind = self.bound.binding_kind(symbol);
        let initializer = self.find_only_initializer(read, symbol, kind);
        kind == BindingKind::Const && initializer.is_some_and(|it| self.is_read_behind(read, it))
    }

    fn note_constant_read(&mut self, ident: ExprId, symbol: SymbolId) {
        let Some(init) = self.find_initializer_of_stable_binding(symbol) else {
            return;
        };
        if init >= ident
            || !self.has_static_lookup(ident)
            || self.is_assignment_target(ident)
            || (self.is_stored_by_mocks(symbol)
                && !self.is_inlined_by_plain_bun(ident, symbol, init))
        {
            return;
        }
        let FoldedValue::Constant(constant) = self.folded_value(init) else {
            return;
        };
        let order = self.run_order.get_or_init(|| RunOrder::new(self.hir));
        if order.is_initialized_at(self.hir, self.bound, ident, init) {
            self.constant_reads.push((ident, constant));
        }
    }

    fn fold_const_read(&mut self, ident: ExprId, symbol: SymbolId, kind: BindingKind) -> Folded {
        if let BindingKind::Const | BindingKind::Let | BindingKind::Var = kind {
            self.note_constant_read(ident, symbol);
        }
        let init = match kind {
            BindingKind::Const | BindingKind::Let | BindingKind::Var => {
                self.find_only_initializer(ident, symbol, kind)
            }
            _ => None,
        };
        let Some(init) = init else {
            return Folded::UNKNOWN;
        };
        if kind == BindingKind::Let
            && !self.is_assignment_target(ident)
            && let FoldedValue::Constant(constant) = self.folded_value(init)
        {
            self.constants_of_lets.push((ident, constant));
        }
        let is_const = kind == BindingKind::Const;
        let is_inlined = self.is_inlined_by_bun_run(ident, symbol, init);
        if !is_inlined {
            self.mark_folded_by_build_alone(ident);
            self.mark_folded_under_minify_syntax_if(ident, |folder| {
                folder.is_inlined_by_bun_run(ident, symbol, init)
            });
        }
        match self.folded_value(init) {
            FoldedValue::Constant(constant)
                if (is_inlined || (is_const && self.is_library_binding(symbol)))
                    && !self.is_assignment_target(ident) =>
            {
                self.decide(ident, Decision::Constant(constant))
            }
            _ => {
                self.copy_condition(ident, init);
                let effects = match is_const {
                    true if self.note_constant_of_enum_member(ident, init) => {
                        self.folded(init).effects
                    }
                    true => Effects::DeadZoneCheck,
                    false => Effects::Unknown,
                };
                Folded::new(self.folded(init).value, effects)
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
        let constant_globals = [known::undefined, known::NaN, known::Infinity];
        let is_constant_global =
            matches!(self.hir[e].kind, ExprKind::Ident(name) if constant_globals.contains(&name));
        if !is_constant_global && !self.inputs.is_user_defined(state) {
            self.mark_folded_by_build_alone(e);
        }
        Some(match value {
            DefineValue::Constant(constant) => self.decide(e, Decision::Constant(constant)),
            DefineValue::GlobalPath(path) => self.decide(e, Decision::GlobalPath(path)),
            DefineValue::Data(data) => {
                if let DataValue::Array(_) | DataValue::Object(_) = data {
                    self.conditions.insert(e, true);
                }
                self.decide(e, Decision::of_data(data))
            }
            DefineValue::RuntimeValue(_) => {
                let folded = self.note_loader_value(e);
                self.effects[e.idx()] = self.effects_of_path(e);
                folded
            }
            DefineValue::RuntimeConstant(_) if self.is_delete_operand(e) => return None,
            DefineValue::RuntimeConstant(constant) => {
                Folded::new(Value::from(constant), self.effects_of_path(e))
            }
        })
    }

    fn effects_of_path(&self, path: ExprId) -> Effects {
        match self.hir[path].kind {
            ExprKind::Ident(_) => Effects::None,
            _ => Effects::MemberRead,
        }
    }

    pub(super) fn find_runtime_value_kind(&self, e: ExprId) -> Option<RuntimeValueKind> {
        let &state = self.path_states.get(&e)?;
        match self.inputs.value_of(state)? {
            DefineValue::RuntimeValue(kind) => Some(kind),
            DefineValue::Constant(_)
            | DefineValue::GlobalPath(_)
            | DefineValue::Data(_)
            | DefineValue::RuntimeConstant(_) => None,
        }
    }

    pub(super) fn has_member_in_every_run(&self, object: ExprId, name: Atom) -> bool {
        let member = self.path_states.get(&object);
        let member = member.and_then(|&state| self.inputs.child(state, name, LinkForm::DOT));
        matches!(
            member.and_then(|member| self.inputs.value_of(member)),
            Some(DefineValue::RuntimeValue(_) | DefineValue::RuntimeConstant(_))
        )
    }

    pub(super) fn has_static_lookup(&self, ident: ExprId) -> bool {
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

    pub(super) fn is_assignment_target(&self, e: ExprId) -> bool {
        let target = self.find_outermost_cast(e);
        self.bound.get_assignment_target(self.hir, target).is_some()
    }

    pub(super) fn is_delete_operand(&self, e: ExprId) -> bool {
        let parent = self.parent_expr(self.find_outermost_cast(e));
        let parent_kind = parent.map(|parent| self.hir[parent].kind);
        matches!(
            parent_kind,
            Some(ExprKind::Unary {
                op: UnOp::Delete,
                ..
            })
        )
    }

    fn is_define_root(&self, ident: ExprId) -> bool {
        !self.inputs.is_empty()
            && self.bound.is_evaluated_ident(ident)
            && !is_in_with_scope(self.bound, ident)
            && !self.is_delete_operand(ident)
    }
}
