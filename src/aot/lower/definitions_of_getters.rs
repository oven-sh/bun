use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, BindingInitializer, FnOwner, Parent, SymbolId};
use bun_sema::check::aot::ObjectMemberKind;
use bun_sema::hir::{
    self, Chain, ExprId, ExprKind, Flags, FnBody, PropKey, PropKind, StmtId, StmtKind,
};
use rustc_hash::FxHashSet;

use super::member::PropertyName;
use super::{FileLowering, FunctionLowering};
use crate::builtins::id::BuiltinId;
use crate::ir::ValueId;
use crate::known_helpers::{Helper, Shape};

impl FileLowering<'_, '_, '_, '_> {
    fn find_shape_of_helper_called(&self, callee: ExprId) -> Option<Shape> {
        let files = self.queries.files();
        let helpers = self.inputs.known_helpers;
        if let Some(known) = helpers.certain_callee(files, self.file, callee) {
            return Some(known.shape);
        }
        let wrapped = self.inputs.modules.wrapped();
        let known = wrapped.helper_of_member(files, self.file, callee)?;
        Some(known.shape)
    }

    fn find_plain_call(&self, expression: ExprId) -> Option<hir::Call> {
        let ExprKind::Call(call) = self.hir[self.skip_type_syntax(expression)].kind else {
            return None;
        };
        let call = self.hir[call];
        let is_spread = |argument: ExprId| matches!(self.hir[argument].kind, ExprKind::Spread(_));
        let is_plain = call.chain == Chain::No && !self.hir.ids(call.args).any(is_spread);
        is_plain.then_some(call)
    }

    fn named_symbol(&self, expression: ExprId) -> Option<SymbolId> {
        let expression = self.skip_type_syntax(expression);
        match (self.hir[expression].kind, self.bound.binding(expression)) {
            (ExprKind::Ident(_), Binding::Symbol(symbol)) => Some(symbol),
            _ => None,
        }
    }

    fn list_getters_of_literal(&mut self, literal: ExprId) -> Option<Vec<(Atom, ExprId)>> {
        let hir = self.hir;
        let ExprKind::Object(properties) = hir[self.skip_type_syntax(literal)].kind else {
            return None;
        };
        let mut getters = Vec::with_capacity(properties.len());
        let mut names = FxHashSet::default();
        for id in properties.iter() {
            let property = hir[id];
            let PropKey::Name(name) = hir.runtime_property_key(id) else {
                return None;
            };
            let is_function = matches!(
                hir[self.skip_type_syntax(property.value)].kind,
                ExprKind::Fn(_)
            );
            let key = self.name_key(name);
            if property.kind != PropKind::Init
                || !is_function
                || hir::is_proto_setter(&property)
                || self.find_element_index(key).is_some()
                || !names.insert(name)
            {
                return None;
            }
            getters.push((name, property.value));
        }
        Some(getters)
    }

    fn find_statement_of(&self, expression: ExprId) -> Option<StmtId> {
        let mut expression = expression;
        loop {
            match self.bound.parent_of_expr(expression) {
                Parent::Expr(outer) if outer.is_some() => {
                    if self.hir.type_assertion_operand(outer) != Some(expression) {
                        return None;
                    }
                    expression = outer;
                }
                Parent::Stmt(statement) => return Some(statement),
                _ => return None,
            }
        }
    }

    fn leaves_names_alone(&self, statement: StmtId, target: SymbolId) -> bool {
        let hir = self.hir;
        match hir[statement].kind {
            StmtKind::Directive { .. } | StmtKind::Empty | StmtKind::Fn(_) => true,
            StmtKind::Var(declarations) => {
                let mut values = declarations.iter().map(|declaration| hir[declaration].init);
                values.all(|value| {
                    value.is_none()
                        || matches!(hir[value].kind, ExprKind::Object(properties) if properties.is_empty())
                        || matches!(hir[value].kind, ExprKind::Fn(_))
                })
            }
            StmtKind::Expr(expression) => {
                let Some(call) = self.find_plain_call(expression) else {
                    return false;
                };
                let Some(object) = hir.ids(call.args).next() else {
                    return false;
                };
                let Some(object) = self.named_symbol(object) else {
                    return false;
                };
                let shape = self.find_shape_of_helper_called(call.callee);
                match shape.map(Shape::helper) {
                    Some(Helper::MarkAsModule) => true,
                    Some(Helper::Export) => object != target,
                    _ => false,
                }
            }
            _ => false,
        }
    }

    fn list_statements_of(&self, parent: Parent) -> Option<hir::IdList<StmtId>> {
        match parent {
            Parent::File => Some(self.hir.body),
            Parent::FnBody(function) => match self.hir[function].body {
                FnBody::Block(statements) => Some(statements),
                FnBody::Expr(_) | FnBody::None => None,
            },
            Parent::Stmt(block) => match self.hir[block].kind {
                StmtKind::Block(statements) => Some(statements),
                _ => None,
            },
            _ => None,
        }
    }

    fn is_target_fresh(&self, target: SymbolId, call: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let BindingInitializer::Expression(value) = bound.binding_initializer(hir, target) else {
            return false;
        };
        let is_empty =
            matches!(hir[value].kind, ExprKind::Object(properties) if properties.is_empty());
        let Parent::VarInit(declaration) = bound.parent_of_expr(value) else {
            return false;
        };
        if !is_empty || !bound.is_stable_binding(target) || bound.is_visible_to_eval(target) {
            return false;
        }
        let declared = bound.var_stmt[declaration.idx()];
        if !self.leaves_names_alone(declared, target) {
            return false;
        }
        let home = bound.parent_of_stmt(declared);
        let mut used = self.find_statement_of(call);
        loop {
            let Some(statement) = used else {
                return false;
            };
            let parent = bound.parent_of_stmt(statement);
            let Some(statements) = self.list_statements_of(parent) else {
                return false;
            };
            let is_home = parent == home;
            let ahead = hir
                .ids(statements)
                .take_while(|&it: &StmtId| it != statement);
            let mut ahead = ahead.skip_while(|&it| is_home && it != declared);
            if is_home && ahead.next() != Some(declared) {
                return false;
            }
            if !ahead.all(|it| self.leaves_names_alone(it, target)) {
                return false;
            }
            if is_home {
                return true;
            }
            let Parent::FnBody(function) = parent else {
                return false;
            };
            let FnOwner::Expr(written) = bound.fns[function.idx()].owner else {
                return false;
            };
            let is_plain = !hir[function]
                .flags
                .intersects(Flags::ASYNC | Flags::GENERATOR);
            if !is_plain || !bound.is_called_only_where_written(hir, function) {
                return false;
            }
            let mut callee = written;
            let around = loop {
                let Parent::Expr(outer) = bound.parent_of_expr(callee) else {
                    return false;
                };
                if outer.is_none() {
                    return false;
                }
                if hir.type_assertion_operand(outer) != Some(callee) {
                    break outer;
                }
                callee = outer;
            };
            let is_call = self.find_plain_call(around);
            if !is_call.is_some_and(|it| it.callee == callee && it.args.is_empty()) {
                return false;
            }
            used = self.find_statement_of(around);
        }
    }

    fn find_getters_to_define(&mut self, call: ExprId) -> Option<(ExprId, Vec<(Atom, ExprId)>)> {
        let hir = self.hir;
        let site = self.find_plain_call(call).filter(|it| it.args.len() == 2)?;
        let (object, literal) = (hir.id_at(site.args, 0), hir.id_at(site.args, 1));
        if !matches!(
            hir[self.skip_type_syntax(literal)].kind,
            ExprKind::Object(_)
        ) {
            return None;
        }
        let target = self.named_symbol(object)?;
        let shape = self.find_shape_of_helper_called(site.callee)?;
        let lists_lacking = match shape {
            Shape::ExportDefinesGetters => false,
            Shape::ExportGettersIfMissing => true,
            _ => return None,
        };
        let added = self.inputs.names_added_to_builtins;
        if self.inputs.options.counts_executions
            || added
                .iter()
                .any(|added| added.0 == BuiltinId::ObjectPrototype)
            || (lists_lacking && !self.is_target_fresh(target, call))
        {
            return None;
        }
        let getters = self.list_getters_of_literal(literal)?;
        let mut names = getters.iter();
        let names_mark = names.any(|getter| getter.0 == known::__esModule);
        (!names_mark).then_some((object, getters))
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn try_lower_definition_of_getters(
        &mut self,
        call: ExprId,
    ) -> Option<ValueId> {
        let (object, getters) = self.file.find_getters_to_define(call)?;
        let target = self.lower_expression(object);
        let [enumerable, get] = [&b"enumerable"[..], b"get"].map(|name| {
            let text = self.file.intern_bytes(name);
            self.file.text_key(text)
        });
        let members = [enumerable, get].map(|key| (key, ObjectMemberKind::Field));
        let layout = self.file.untyped_layout(&members);
        let define = self.emit_builtin_itself(BuiltinId::ObjectDefineProperty);
        let holder = self.emit_builtin_itself(BuiltinId::Object);
        for (name, getter) in getters {
            let key = PropertyName::Constant(self.file.name_key(name));
            let function = self.lower_named_evaluation(getter, key);
            self.set_position(self.file.hir[call].pos);
            let mut descriptor = self.begin_object(layout);
            let yes = self.builder.boolean(true);
            self.add_property(
                &mut descriptor,
                PropertyName::Constant(enumerable),
                yes,
                None,
            );
            self.add_property(&mut descriptor, PropertyName::Constant(get), function, None);
            let descriptor = super::object::finish_object(self, descriptor);
            let written = self.builder.string(self.file.intern_atom(name));
            super::call::emit_call(self, define, Some(holder), &[target, written, descriptor]);
        }
        self.file.known_helpers_lowered.calls += 1;
        Some(self.builder.undefined())
    }
}
