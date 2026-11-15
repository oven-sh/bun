use bun_sema::atom::known;
use bun_sema::bind::{Binding, Decl, Parent, SymbolId};
use bun_sema::check::aot::{
    ClassDeclaration, ClassParent, FunctionRef, SuperCall, SuperCallForm, find_super_call,
    function_of_this, may_be_constructor_function, text_of_function,
};
use bun_sema::hir::{
    BinOp, Call, ExprId, ExprKind, ExprTag, FnBody, FnId, PatKind, StmtId, StmtKind,
};
use smallvec::SmallVec;

use super::call::emit_call;
use super::known_call::resolve_input;
use super::member::PropertyName;
use super::{FileLowering, FunctionLowering};
use crate::builtins::id::BuiltinId;
use crate::ir::{BlockId, FunctionKey, TypeTable, ValueId, WellKnownSymbol};
use crate::known_helpers::{Helper, KnownCallee, Shape, resolve_callee};

enum Holder {
    Variable(SymbolId),
    Nothing,
}

impl FileLowering<'_, '_, '_, '_> {
    fn find_holder_of_super_call(&self, call: ExprId, constructor: FnId) -> Option<Holder> {
        let (hir, bound) = (self.hir, self.bound);
        let mut holder = None;
        let mut value = call;
        let statement: StmtId = loop {
            match bound.parent_of_expr(value) {
                Parent::Expr(user) => match hir[user].kind {
                    ExprKind::Assign {
                        op: None,
                        target,
                        value: assigned,
                    } if assigned == value && holder.is_none() && value == call => {
                        let Binding::Symbol(symbol) = bound.binding(target) else {
                            return None;
                        };
                        if !matches!(hir[target].kind, ExprKind::Ident(_)) {
                            return None;
                        }
                        let stores = bound.stores_to(symbol);
                        if stores.len() != 1 || bound.is_visible_to_eval(symbol) {
                            return None;
                        }
                        holder = Some(symbol);
                        value = user;
                    }
                    ExprKind::Binary {
                        op: BinOp::Comma, ..
                    } if holder.is_some() => value = user,
                    _ => return None,
                },
                Parent::VarInit(declaration) if value == call => {
                    let pattern = hir[declaration].pat;
                    if !matches!(hir[pattern].kind, PatKind::Ident(_)) {
                        return None;
                    }
                    let symbol = bound.declared_symbol(Decl::Var(pattern)).some()?;
                    if !bound.stores_to(symbol).is_empty() || bound.is_visible_to_eval(symbol) {
                        return None;
                    }
                    holder = Some(symbol);
                    break bound.statement_of_expr(call)?;
                }
                Parent::Stmt(statement) => break statement,
                _ => return None,
            }
        };
        if bound.parent_of_stmt(statement) != Parent::FnBody(constructor) {
            return None;
        }
        match (hir[statement].kind, holder) {
            (StmtKind::Return(returned), None) if returned == call => {}
            (StmtKind::Expr(_) | StmtKind::Var(_), Some(_)) => {}
            _ => return None,
        }
        let start = hir[statement].start;
        let mut returns = bound.ids(bound.fns[constructor.idx()].returns);
        if returns.any(|other| hir[other].start < start) {
            return None;
        }
        Some(match holder {
            Some(symbol) => Holder::Variable(symbol),
            None => Holder::Nothing,
        })
    }

    fn calls_helper(&self, call: ExprId, helper: Helper) -> bool {
        let ExprKind::Call(site) = self.hir[call].kind else {
            return false;
        };
        let input = resolve_input(self);
        let callee = resolve_callee(&input, self.file, self.hir[site].callee);
        callee.and_then(|callee| callee.helper(self.inputs.known_helpers)) == Some(helper)
    }

    fn returns_answer_of_super_call(
        &self,
        call: ExprId,
        constructor: FnId,
        holder: &Holder,
    ) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let FnBody::Block(statements) = hir[constructor].body else {
            return false;
        };
        let names_holder = |value: ExprId| match *holder {
            Holder::Variable(symbol) => {
                matches!(hir[value].kind, ExprKind::Ident(_))
                    && bound.binding(value) == Binding::Symbol(symbol)
            }
            Holder::Nothing => value == call,
        };
        let is_answer = |statement: StmtId| {
            let StmtKind::Return(value) = hir[statement].kind else {
                return false;
            };
            if value.is_none() {
                return false;
            }
            let value = hir.skip_type_assertions(value);
            if names_holder(value) {
                return true;
            }
            let ExprKind::Call(site) = hir[value].kind else {
                return false;
            };
            hir[site].args.len() == 2
                && names_holder(hir.skip_type_assertions(hir.id_at(hir[site].args, 0)))
                && self.calls_helper(value, Helper::PossibleConstructorReturn)
        };
        let mut returns = bound.ids(bound.fns[constructor.idx()].returns);
        hir.ids(statements).last().is_some_and(is_answer) && returns.all(is_answer)
    }

    fn is_check_of_class(&self, check: ExprId, this: ExprId, written: &SuperCall) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let ExprKind::Call(site) = hir[check].kind else {
            return false;
        };
        let site = hir[site];
        let Parent::Stmt(statement) = bound.parent_of_expr(check) else {
            return false;
        };
        if site.args.len() != 2
            || hir.id_at(site.args, 0) != this
            || !matches!(hir[statement].kind, StmtKind::Expr(_))
            || bound.parent_of_stmt(statement) != Parent::FnBody(written.constructor)
            || hir[statement].start > hir[written.this].pos
        {
            return false;
        }
        let class = hir.skip_type_assertions(hir.id_at(site.args, 1));
        bound.binding(class) == Binding::Symbol(written.name)
            && matches!(hir[class].kind, ExprKind::Ident(_))
            && self.calls_helper(check, Helper::ClassCallCheck)
    }

    fn find_only_check_of_this(&mut self, written: &SuperCall) -> Option<Option<ExprId>> {
        let (hir, bound) = (self.hir, self.bound);
        let text = text_of_function(hir, bound, written.constructor);
        let mut of_kind = |kind| self.queries.expressions_of_kind_in(self.file, kind, &text);
        let (objects, calls) = (of_kind(ExprTag::This), of_kind(ExprTag::Call));
        if calls.into_iter().any(|call| self.evaluates_text(call)) {
            return None;
        }
        let mut check = None;
        for object in objects {
            if object == written.this || function_of_this(hir, object) != Some(written.constructor)
            {
                continue;
            }
            let Parent::Expr(user) = bound.parent_of_expr(object) else {
                return None;
            };
            if check.is_some() || !self.is_check_of_class(user, object, written) {
                return None;
            }
            check = Some(user);
        }
        Some(check)
    }

    fn evaluates_text(&self, call: ExprId) -> bool {
        self.bound.eval_scope(call).is_some()
            || matches!(self.hir[call].kind, ExprKind::Call(id) if self.hir.is_settled_eval(id))
    }

    fn is_plain_parent(&mut self, parent: FunctionRef) -> bool {
        let files = self.queries.files();
        let (hir, bound) = (files.hir(parent.file), files.bound(parent.file));
        if !may_be_constructor_function(hir, parent.function)
            || !matches!(hir[parent.function].body, FnBody::Block(_))
        {
            return false;
        }
        let text = text_of_function(hir, bound, parent.function);
        let mut of_kind = |kind| {
            self.queries
                .expressions_of_kind_in(parent.file, kind, &text)
        };
        let asks = of_kind(ExprTag::NewTarget);
        let calls = of_kind(ExprTag::Call);
        asks.is_empty()
            && calls.into_iter().all(|call| {
                bound.eval_scope(call).is_none() && find_super_call(hir, bound, call).is_none()
            })
    }

    fn find_plain_super_parent(
        &mut self,
        source: FunctionRef,
        call: ExprId,
        written: &SuperCall,
    ) -> Option<(FunctionRef, Option<ExprId>)> {
        if source.function != written.constructor || source.file != self.file {
            return None;
        }
        self.queries.constructor_function_shape(source)?;
        let holder = self.find_holder_of_super_call(call, written.constructor)?;
        if !self.returns_answer_of_super_call(call, written.constructor, &holder) {
            return None;
        }
        let check = self.find_only_check_of_this(written)?;
        match self.queries.constructor_function_parent(source)? {
            ClassParent::Declared(ClassDeclaration::Function(parent))
                if self.is_plain_parent(parent) =>
            {
                Some((parent, check))
            }
            _ => None,
        }
    }
}

#[derive(Copy, Clone)]
pub(in crate::lower) struct CheckOfClass {
    call: ExprId,
    above: ValueId,
}

enum ArgumentsOfParent {
    Values(SmallVec<[ValueId; 4]>),
    List(ValueId),
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn lower_call_super(
        &mut self,
        call: ExprId,
        site: Call,
        callee: &KnownCallee,
    ) -> Option<ValueId> {
        let (hir, bound) = (self.file.hir, self.file.bound);
        let FunctionKey::Source(source) = self.key else {
            return None;
        };
        let written = find_super_call(hir, bound, call)?;
        let SuperCallForm::List(list) = written.form else {
            return None;
        };
        if self.shape_of_one_published_helper(callee)? != Shape::CallSuperConstructsParent {
            return None;
        }
        let (parent, check) = self.file.find_plain_super_parent(source, call, &written)?;
        let check = self.find_answer_of_check(check)?;
        let elements: Option<SmallVec<[ExprId; 4]>> = match list.map(|list| (list, hir[list].kind))
        {
            None => Some(SmallVec::new()),
            Some((_, ExprKind::Array(elements))) => {
                let elements: SmallVec<[ExprId; 4]> = hir.ids(elements).collect();
                let is_plain = elements.iter().all(|&element| {
                    !matches!(hir[element].kind, ExprKind::Spread(_) | ExprKind::Missing)
                });
                is_plain.then_some(elements).map(Some)?
            }
            Some((list, ExprKind::Ident(_)))
                if matches!(bound.binding(list), Binding::Arguments(_)) =>
            {
                None
            }
            Some(_) => return None,
        };

        let this = self.lower_expression(hir.id_at(site.args, 0));
        let own = self.lower_expression(hir.id_at(site.args, 1));
        let arguments = match elements {
            Some(elements) => {
                let mut values = SmallVec::new();
                for element in elements {
                    values.push(self.lower_expression(element));
                }
                ArgumentsOfParent::Values(values)
            }
            None => ArgumentsOfParent::List(self.lower_expression(hir.id_at(site.args, 2))),
        };
        self.set_position(hir[call].pos);
        self.file.known_helpers_lowered.calls += 1;
        let unexpected = self.create_block();
        let made =
            self.emit_construction_by_parent(this, own, &arguments, parent, check, unexpected);
        let join = self.create_block();
        let result = self.builder.add_parameter(join, None);
        self.jump_with(join, &[made]);

        self.continue_in(unexpected);
        let called = match site.args.len() {
            2 => self.emit_call_of_helper(call, site, &[this, own]),
            _ => {
                let list = self.emit_list_for_parent(&arguments);
                self.emit_call_of_helper(call, site, &[this, own, list])
            }
        };
        let expected = self.file.function_positions(written.constructor).this.ty;
        let called = self.expect_type(called, expected);
        self.jump_with(join, &[called]);
        self.continue_in(join);
        Some(result)
    }

    fn emit_list_for_parent(&mut self, arguments: &ArgumentsOfParent) -> ValueId {
        match arguments {
            ArgumentsOfParent::Values(values) => {
                self.builder.new_array(TypeTable::ANYTHING, &[], values)
            }
            ArgumentsOfParent::List(list) => *list,
        }
    }

    pub(super) fn lower_call_of_created_super(
        &mut self,
        call: ExprId,
        site: Call,
    ) -> Option<ValueId> {
        let (hir, bound) = (self.file.hir, self.file.bound);
        let FunctionKey::Source(source) = self.key else {
            return None;
        };
        let written = find_super_call(hir, bound, call)?;
        let (created, list) = match written.form {
            SuperCallForm::List(_) => return None,
            SuperCallForm::Call { created } => (created, None),
            SuperCallForm::Apply { created, list } => (created, Some(list)),
        };
        if list.is_some_and(|list| !matches!(bound.binding(list), Binding::Arguments(_))) {
            return None;
        }
        let ExprKind::Call(creation) = hir[created].kind else {
            return None;
        };
        let input = resolve_input(self.file);
        let maker = resolve_callee(&input, self.file.file, hir[creation].callee)?;
        if self.shape_of_one_published_helper(&maker)? != Shape::CreateSuperConstructsParent {
            return None;
        }
        let known = self.file.inputs.known_helpers;
        let known = known.function(maker.file, maker.functions[0].definition)?;
        let [_, made] = known.functions[..] else {
            return None;
        };
        let (parent, check) = self.file.find_plain_super_parent(source, call, &written)?;
        let check = self.find_answer_of_check(check)?;

        let lowered = self.lower_call_operands(call, site);
        let function = lowered.callee.function;
        let builtin = match list {
            None => BuiltinId::FunctionPrototypeCall,
            Some(_) => BuiltinId::FunctionPrototypeApply,
        };
        self.guard_builtin(function, builtin, lowered.slow_path);
        let super_function = lowered
            .callee
            .this
            .expect("a call of a member has a receiver");
        self.guard_closure(super_function, maker.file, made, lowered.slow_path);
        let this = lowered.arguments[0];
        let arguments = match list {
            None => ArgumentsOfParent::Values(SmallVec::from_slice(&lowered.arguments[1..])),
            Some(_) => ArgumentsOfParent::List(lowered.arguments[1]),
        };
        let name = self.file.bound.symbol(written.name).name;
        let own = self.get_binding(Binding::Symbol(written.name), name);
        let unexpected = lowered.slow_path;
        let result =
            self.emit_construction_by_parent(this, own, &arguments, parent, check, unexpected);
        Some(self.finish_with_slow_path(lowered, result))
    }

    fn find_answer_of_check(&self, check: Option<ExprId>) -> Option<Option<ValueId>> {
        let Some(check) = check else {
            return Some(None);
        };
        let known = self.check_of_class.filter(|known| known.call == check)?;
        Some(Some(known.above))
    }

    pub(super) fn note_check_of_class(&mut self, check: ExprId) {
        let (hir, bound) = (self.file.hir, self.file.bound);
        let FunctionKey::Source(source) = self.key else {
            return;
        };
        if source.file != self.file.file {
            return;
        }
        let text = text_of_function(hir, bound, source.function);
        let calls = self
            .file
            .queries
            .expressions_of_kind_in(self.file.file, ExprTag::Call, &text);
        let found = calls.into_iter().find_map(|call| {
            let written = find_super_call(hir, bound, call)?;
            (written.constructor == source.function).then_some((call, written))
        });
        let Some((call, written)) = found else {
            return;
        };
        let plain = self.file.find_plain_super_parent(source, call, &written);
        let Some((parent, Some(only))) = plain else {
            return;
        };
        if only != check {
            return;
        }

        let name = bound.symbol(written.name).name;
        let own = self.get_binding(Binding::Symbol(written.name), name);
        let answer = self.builder.create_variable(None);
        let undefined = self.builder.undefined();
        self.builder.write_variable(answer, undefined);
        let done = self.create_block();
        let get_prototype = self.emit_builtin_itself(BuiltinId::ObjectGetPrototypeOf);
        let above = emit_call(self, get_prototype, None, &[own]);
        self.guard_closure(above, parent.file, parent.function, done);
        let base = emit_call(self, get_prototype, None, &[above]);
        self.guard_builtin(base, BuiltinId::FunctionPrototype, done);
        let has_instance =
            PropertyName::Constant(self.file.symbol_key(WellKnownSymbol::HasInstance));
        let has_instance = self.emit_name_value(has_instance);
        let has_own = self.emit_locked_builtin(BuiltinId::ObjectPrototypeHasOwnProperty);
        for class in [own, above] {
            let is_own = emit_call(self, has_own, Some(class), &[has_instance]);
            self.go_on_if(is_own, false, done);
        }
        self.builder.write_variable(answer, above);
        self.jump(done);
        self.continue_in(done);
        let above = self.builder.read_variable(answer);
        self.check_of_class = Some(CheckOfClass { call: check, above });
    }

    fn emit_construction_by_parent(
        &mut self,
        this: ValueId,
        own: ValueId,
        arguments: &ArgumentsOfParent,
        parent: FunctionRef,
        check: Option<ValueId>,
        unexpected: BlockId,
    ) -> ValueId {
        let get_prototype = self.emit_builtin_itself(BuiltinId::ObjectGetPrototypeOf);
        let above = emit_call(self, get_prototype, None, &[own]);
        let new_target = self.get_new_target();
        let on_undefined = self.split_on_type(new_target, TypeTable::UNDEFINED);
        self.builder.switch_to(on_undefined.taken);
        self.jump(unexpected);
        self.continue_in(on_undefined.not_taken);
        let new_target = on_undefined.not_taken_value;
        if let Some(checked) = check {
            let is_checked = self.builder.strict_eq(above, checked);
            self.emit_guard(is_checked, unexpected);
        }
        self.guard_closure(above, parent.file, parent.function, unexpected);

        let prototype = emit_call(self, get_prototype, None, &[this]);
        let name = PropertyName::Constant(self.file.name_key(known::constructor));
        let constructor = self.emit_get(prototype, name);
        let otherwise = self.create_block();
        let join = self.create_block();
        let result = self.builder.add_parameter(join, None);
        let is_constructed = self.builder.strict_eq(constructor, new_target);
        self.emit_guard(is_constructed, otherwise);
        let name = PropertyName::Constant(self.file.name_key(known::prototype));
        let prototype_of_made = self.emit_get(new_target, name);
        let is_same = self.builder.strict_eq(prototype_of_made, prototype);
        self.emit_guard(is_same, otherwise);
        let answered = match arguments {
            ArgumentsOfParent::Values(values) => emit_call(self, above, Some(this), values),
            ArgumentsOfParent::List(list) => {
                let apply = self.emit_builtin_itself(BuiltinId::FunctionPrototypeApply);
                emit_call(self, apply, Some(above), &[this, *list])
            }
        };
        let on_object = self.split_on_type(answered, TypeTable::OBJECT);
        self.continue_in(on_object.taken);
        self.jump_with(join, &[on_object.taken_value]);
        self.continue_in(on_object.not_taken);
        self.jump_with(join, &[this]);

        self.continue_in(otherwise);
        let list = self.emit_list_for_parent(arguments);
        let made = self.emit_builtin_call(BuiltinId::ReflectConstruct, &[above, list, constructor]);
        self.jump_with(join, &[made]);
        self.continue_in(join);
        result
    }
}
