use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, BindingInitializer, CommonJsVariable, FnOwner, Parent, SymbolId};
use bun_sema::check::aot::{FunctionRef, ObjectMemberKind};
use bun_sema::hir::{
    self, BinOp, Chain, ExprId, ExprKind, Flags, FnBody, FnId, FnKind, PropKey, PropKind, StmtId,
    StmtKind,
};
use rustc_hash::FxHashSet;

use super::function::{EntryArguments, create_header_of_copy};
use super::member::PropertyName;
use super::{FileLowering, FunctionLowering};
use crate::builtins::id::BuiltinId;
use crate::ir::{FunctionId, FunctionKey, PropertyKeyId, ValueId};
use crate::known_helpers::{Helper, KnownReference, Shape};

impl FileLowering<'_, '_, '_, '_> {
    fn find_shape_of_helper_called(&self, callee: ExprId) -> Option<Shape> {
        let files = self.queries.files();
        let helpers = self.inputs.known_helpers;
        let known = helpers
            .certain_callee(files, self.file, callee)
            .or_else(|| helpers.callee_defined_ahead(files, self.file, callee));
        if let Some(known) = known {
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

    fn names_exports(&self, expression: ExprId) -> bool {
        let expression = self.skip_type_syntax(expression);
        matches!(self.hir[expression].kind, ExprKind::Ident(_))
            && self.bound.binding(expression) == Binding::CommonJs(CommonJsVariable::Exports)
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

    fn find_statement_in_order(&self, expression: ExprId, target: SymbolId) -> Option<StmtId> {
        let hir = self.hir;
        let mut expression = expression;
        loop {
            match self.bound.parent_of_expr(expression) {
                Parent::Expr(outer) if outer.is_some() => {
                    let is_in_order = match hir[outer].kind {
                        ExprKind::Binary {
                            op: BinOp::Comma,
                            left,
                            ..
                        } => left == expression || self.calls_helpers_alone(left, target),
                        _ => hir.type_assertion_operand(outer) == Some(expression),
                    };
                    if !is_in_order {
                        return None;
                    }
                    expression = outer;
                }
                Parent::Stmt(statement) => {
                    let runs_once =
                        matches!(hir[statement].kind, StmtKind::Expr(_) | StmtKind::Return(_));
                    return runs_once.then_some(statement);
                }
                _ => return None,
            }
        }
    }

    fn calls_helpers_alone(&self, expression: ExprId, target: SymbolId) -> bool {
        let hir = self.hir;
        let expression = self.skip_type_syntax(expression);
        if let ExprKind::Binary {
            op: BinOp::Comma,
            left,
            right,
        } = hir[expression].kind
        {
            return self.calls_helpers_alone(left, target)
                && self.calls_helpers_alone(right, target);
        }
        let Some(call) = self.find_plain_call(expression) else {
            return false;
        };
        let Some(object) = hir.ids(call.args).next() else {
            return false;
        };
        let Some(object) = self.named_symbol(object) else {
            return false;
        };
        match self
            .find_shape_of_helper_called(call.callee)
            .map(Shape::helper)
        {
            Some(Helper::MarkAsModule) => true,
            Some(Helper::Export) => object != target,
            _ => false,
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
            StmtKind::Expr(expression) => self.calls_helpers_alone(expression, target),
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
        let mut used = self.find_statement_in_order(call, target);
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
            used = self.find_statement_in_order(around, target);
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
        let shape = self.find_shape_of_helper_called(site.callee)?;
        let lists_lacking = match shape {
            Shape::ExportDefinesGetters => false,
            Shape::ExportGettersIfMissing => true,
            _ => return None,
        };
        let target = self.named_symbol(object);
        if target.is_none() && !self.names_exports(object) {
            return None;
        }
        let added = self.inputs.names_added_to_builtins;
        if self.inputs.options.counts_executions
            || added
                .iter()
                .any(|added| added.0 == BuiltinId::ObjectPrototype)
            || (lists_lacking && !target.is_some_and(|target| self.is_target_fresh(target, call)))
        {
            return None;
        }
        let getters = self.list_getters_of_literal(literal)?;
        let mut names = getters.iter();
        let names_mark = names.any(|getter| getter.0 == known::__esModule);
        (!names_mark).then_some((object, getters))
    }

    fn find_getter_of_copies(&self, callee: ExprId) -> Option<FnId> {
        let helpers = self.inputs.known_helpers;
        let known = helpers.certain_callee(self.queries.files(), self.file, callee)?;
        if known.shape != Shape::ToCommonJsCopiesOntoNewMarkedObject {
            return None;
        }
        let mut copies = known.references.iter().filter_map(|reference| {
            let KnownReference::Helper { symbol, .. } = *reference else {
                return None;
            };
            let [held] = helpers.binding(self.file, symbol)?.functions[..] else {
                return None;
            };
            helpers.function(self.file, held.definition)
        });
        let copy = copies.next()?;
        let [_, getter] = copy.functions[..] else {
            return None;
        };
        let is_read = self.hir[getter].kind == FnKind::Arrow
            && self.hir[getter].params.is_empty()
            && matches!(self.hir[getter].body, FnBody::Expr(_));
        let shape = Shape::CopyPropertiesDefinesGettersForOwnNamesTheTargetLacks;
        (is_read && copy.shape == shape && copies.next().is_none()).then_some(getter)
    }

    fn find_plain_arrow(&self, getter: ExprId) -> Option<FnId> {
        let ExprKind::Fn(function) = self.hir[self.skip_type_syntax(getter)].kind else {
            return None;
        };
        let source = FunctionRef {
            file: self.file,
            function,
        };
        let is_plain = self.hir[function].kind == FnKind::Arrow
            && !self.hir[function]
                .flags
                .intersects(Flags::ASYNC | Flags::GENERATOR)
            && self.scopes.captures(FunctionKey::Source(source)).is_empty();
        is_plain.then_some(function)
    }

    fn runs_helpers_alone(&self, target: SymbolId, declared: StmtId, copied_by: StmtId) -> bool {
        let hir = self.hir;
        let mut between = hir
            .ids(hir.body)
            .skip_while(|&it: &StmtId| it != declared)
            .take_while(|&it| it != copied_by);
        between.all(|statement| {
            if self.leaves_names_alone(statement, target) {
                return true;
            }
            let StmtKind::Expr(expression) = hir[statement].kind else {
                return false;
            };
            let Some(call) = self.find_plain_call(expression) else {
                return false;
            };
            let object = hir.ids(call.args).next();
            object.and_then(|object| self.named_symbol(object)) == Some(target)
                && self.find_shape_of_helper_called(call.callee)
                    == Some(Shape::ExportDefinesGetters)
        })
    }

    fn find_getters_to_copy(&mut self, call: ExprId) -> Option<(FnId, Vec<(Atom, FnId)>)> {
        let (hir, bound) = (self.hir, self.bound);
        let site = self.find_plain_call(call).filter(|it| it.args.len() == 1)?;
        let helper = self.find_getter_of_copies(site.callee)?;
        let added = self.inputs.names_added_to_builtins;
        if self.inputs.options.counts_executions
            || added
                .iter()
                .any(|added| added.0 == BuiltinId::ObjectPrototype)
        {
            return None;
        }
        let target = self.named_symbol(hir.id_at(site.args, 0))?;
        let BindingInitializer::Expression(value) = bound.binding_initializer(hir, target) else {
            return None;
        };
        let Parent::VarInit(declaration) = bound.parent_of_expr(value) else {
            return None;
        };
        let copied_by = bound.statement_of_expr(call)?;
        let analysis = &self.compiled.analysis;
        let is_new = matches!(hir[value].kind, ExprKind::Object(properties) if properties.is_empty())
            && bound.is_stable_binding(target)
            && !bound.is_visible_to_eval(target)
            && bound.parent_of_stmt(bound.var_stmt[declaration.idx()]) == Parent::File
            && bound.parent_of_stmt(copied_by) == Parent::File
            && hir[value].end <= hir[copied_by].start
            && !analysis
                .bindings_read_without_expression(hir, bound)
                .any(|binding| binding == Binding::Symbol(target));
        if !is_new {
            return None;
        }
        let declared = bound.var_stmt[declaration.idx()];
        let runs_helpers_alone = self.runs_helpers_alone(target, declared, copied_by);
        let mut literals: Vec<(u32, ExprId)> = Vec::new();
        for mention in (0..hir.exprs.len() as u32).map(ExprId) {
            if !bound.is_evaluated_ident(mention)
                || bound.binding(mention) != Binding::Symbol(target)
                || self.decisions().is_dead_expr(mention)
                || (runs_helpers_alone && hir[mention].pos >= hir[copied_by].loc.end)
            {
                continue;
            }
            let argument = bound.outermost_type_assertion(hir, mention);
            let Parent::Expr(user) = bound.parent_of_expr(argument) else {
                return None;
            };
            if user == call {
                continue;
            }
            let site = self.find_plain_call(user)?;
            let arguments: Vec<ExprId> = hir.ids(site.args).collect();
            let statement = self.find_statement_of(user)?;
            if arguments.first() != Some(&argument)
                || !matches!(hir[statement].kind, StmtKind::Expr(_))
                || bound.parent_of_stmt(statement) != Parent::File
                || hir[user].pos < hir[value].end
            {
                return None;
            }
            let shape = self.find_shape_of_helper_called(site.callee)?;
            match (shape, &arguments[..]) {
                (Shape::ExportDefinesGetters, &[_, literal])
                    if hir[user].end <= hir[copied_by].start =>
                {
                    literals.push((hir[user].pos, literal));
                }
                (Shape::ReExportCopiesAllButDefault, _)
                    if hir[user].pos >= hir[copied_by].loc.end => {}
                _ => return None,
            }
        }
        literals.sort_unstable();
        let mut getters = Vec::new();
        let mut names = FxHashSet::default();
        names.insert(known::__esModule);
        for (_, literal) in literals {
            for (name, getter) in self.list_getters_of_literal(literal)? {
                if !names.insert(name) {
                    return None;
                }
                getters.push((name, self.find_plain_arrow(getter)?));
            }
        }
        Some((helper, getters))
    }

    pub(in crate::lower) fn lower_copied_getter(
        &mut self,
        function: FunctionId,
        helper: FnId,
        getter: FnId,
    ) {
        let entered = self.reference_function(FunctionKey::Source(FunctionRef {
            file: self.file,
            function: getter,
        }));
        let mut lowering = FunctionLowering::begin(self, function);
        if let FnBody::Expr(read) = lowering.file.hir[helper].body {
            lowering.set_position(lowering.file.hir[read].pos);
        }
        let result = lowering.emit_direct_call(entered, EntryArguments::default());
        lowering.emit_return(result, None);
        lowering.finish();
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

    fn emit_definition(
        &mut self,
        target: ValueId,
        name: Atom,
        members: &[(PropertyKeyId, ValueId)],
    ) {
        let kinds: Vec<_> = members
            .iter()
            .map(|&(key, _)| (key, ObjectMemberKind::Field))
            .collect();
        let layout = self.file.untyped_layout(&kinds);
        let define = self.emit_builtin_itself(BuiltinId::ObjectDefineProperty);
        let holder = self.emit_builtin_itself(BuiltinId::Object);
        let mut descriptor = self.begin_object(layout);
        for &(key, value) in members {
            self.add_property(&mut descriptor, PropertyName::Constant(key), value, None);
        }
        let descriptor = super::object::finish_object(self, descriptor);
        let written = self.builder.string(self.file.intern_atom(name));
        super::call::emit_call(self, define, Some(holder), &[target, written, descriptor]);
    }

    pub(in crate::lower) fn try_lower_copy_of_getters(&mut self, call: ExprId) -> Option<ValueId> {
        let (helper, getters) = self.file.find_getters_to_copy(call)?;
        let file = self.file.file;
        let [enumerable, get, value] = [&b"enumerable"[..], b"get", b"value"].map(|name| {
            let text = self.file.intern_bytes(name);
            self.file.text_key(text)
        });
        self.set_position(self.file.hir[call].pos);
        let layout = self.file.untyped_layout_made_at(&[], Some(call));
        let copy = self.begin_object(layout);
        let copy = super::object::finish_object(self, copy);
        let yes = self.builder.boolean(true);
        self.emit_definition(copy, known::__esModule, &[(value, yes)]);
        for (name, getter) in getters {
            let key = FunctionKey::CopiedGetter {
                file,
                helper,
                getter,
            };
            let declared = self.file.declare_function(key, |file| {
                let name = file.intern_bytes(b"get");
                create_header_of_copy(file, key, helper, name)
            });
            let function = self.builder.new_closure(declared, &[]);
            self.emit_definition(copy, name, &[(get, function), (enumerable, yes)]);
        }
        self.file.known_helpers_lowered.calls += 1;
        Some(copy)
    }
}
