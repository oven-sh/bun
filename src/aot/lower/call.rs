mod array_makers;
mod assignment_to_new_object;
mod callee;
mod evaluated_text;
mod intrinsic;
mod intrinsic_call;
mod intrinsic_operation;
mod written_operands;

use bun_sema::fold::Constant;
use bun_sema::hir::{Call, ExprId, ExprKind, FnId, IdList};
use smallvec::SmallVec;

use super::expression::{self, Evaluation, Tail, TailCast};
use super::function::{self, EntryArguments};
use super::{FileLowering, FunctionLowering, scope};
use crate::builtins::id::BuiltinId;
use crate::builtins::{Resolved, builtin_value_of, table};
use crate::ir::{
    DeclaredType, Edge, ExpectedResultId, PositionFlags, PropertyKey, PropertyKeyId, StringId,
    TypeTable, ValueId,
};
use crate::load::SourceKind;

use crate::modules::ModuleRef;

pub(in crate::lower) use self::intrinsic::lower_intrinsic_expression;

#[derive(Clone)]
pub(crate) enum Arguments {
    Values(SmallVec<[ValueId; 4]>),
    List(ValueId),
}

#[derive(Copy, Clone, Debug)]
pub(in crate::lower) struct Callee {
    pub(in crate::lower) function: ValueId,
    pub(in crate::lower) this: Option<ValueId>,
    pub(in crate::lower) key: Option<PropertyKeyId>,
    pub(in crate::lower) name: Option<StringId>,
}

impl Callee {
    pub(in crate::lower) fn without_key(
        function: ValueId,
        this: Option<ValueId>,
        name: Option<StringId>,
    ) -> Callee {
        Callee {
            function,
            this,
            key: None,
            name,
        }
    }
}

#[derive(Copy, Clone)]
pub(in crate::lower) struct CallOptions<'t> {
    pub(in crate::lower) tail: Tail<'t>,
    pub(in crate::lower) is_never_inlined: bool,
    pub(in crate::lower) is_done_in_place: bool,
    pub(in crate::lower) call_number: Option<u32>,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_arguments(&mut self, arguments: IdList<ExprId>) -> Arguments {
        let hir = self.file.hir;
        let mut has_spread = false;
        for argument in hir.ids(arguments) {
            has_spread |= matches!(hir[argument].kind, ExprKind::Spread(_));
        }
        if has_spread {
            let arguments: SmallVec<[ExprId; 4]> = hir.ids(arguments).collect();
            return self.lower_argument_slice(&arguments);
        }
        let mut values: SmallVec<[ValueId; 4]> = SmallVec::new();
        for argument in hir.ids(arguments) {
            values.push(self.lower_expression(argument));
        }
        Arguments::Values(values)
    }

    pub(crate) fn emit_construct(
        &mut self,
        callee: ValueId,
        arguments: Arguments,
        name: Option<StringId>,
    ) -> ValueId {
        let builder = &mut self.builder;
        match arguments {
            Arguments::Values(values) => builder.construct(callee, None, &values, name),
            Arguments::List(list) => builder.construct_list(callee, None, list, name),
        }
    }

    pub(crate) fn emit_builtin_call(
        &mut self,
        builtin: BuiltinId,
        arguments: &[ValueId],
    ) -> ValueId {
        let callee = self.emit_builtin_itself(builtin);
        emit_call(self, callee, None, arguments)
    }

    pub(in crate::lower) fn lower_call(
        &mut self,
        call: ExprId,
        evaluation: Evaluation<'_>,
    ) -> ValueId {
        let (hir, bound, builtins) = (self.file.hir, self.file.bound, self.file.builtins);
        let site = call_site(self.file, call);
        let exit = evaluation.chain_exit;
        let inner = self.file.skip_type_syntax(site.callee);
        if bound.eval_scope(call).is_some() {
            return scope::lower_direct_eval(self, call);
        }
        if matches!(hir[site.callee].kind, ExprKind::Super) {
            return self.lower_super_call(call);
        }
        let is_in_tail_position = matches!(evaluation.tail, Tail::Yes { .. });
        let outer = std::mem::replace(&mut self.is_call_in_tail_position, is_in_tail_position);
        let loaded = self.try_lower_module_call(call, exit);
        self.is_call_in_tail_position = outer;
        if let Some(value) = loaded {
            return value;
        }
        if let Some(function) = self.file.scopes.function_called_by_name(call) {
            return self.lower_call_of_declaration(call, site, function, evaluation.tail);
        }
        if let Some(value) = self.try_lower_export_definition(call) {
            return value;
        }
        if let Some(value) = self.try_lower_known_call(call) {
            return value;
        }
        let (is_resolved, named) = match builtins.of_expr(inner) {
            Some(Resolved::Intrinsic(intrinsic)) => {
                return intrinsic::lower_intrinsic_call(self, call, intrinsic, evaluation);
            }
            Some(Resolved::Builtin(path)) => (true, Some(path.id)),
            Some(Resolved::DynamicGlobal(_)) => (true, None),
            None => (false, None),
        };
        if let Some(text) = builtins.evaluated_text(call) {
            return self.lower_evaluated_text_call(call, text, exit, evaluation.tail);
        }
        if let Some(value) = self.try_lower_builtin_call_in_place(call, site, evaluation.tail) {
            return value;
        }

        let expected = match is_resolved {
            true => None,
            false => self.file.find_callee_by_signature(call),
        };
        let mut callee = self.lower_callee(site.callee, exit, expected);
        callee.function = self.leave_chain_if_nullish(site, callee.function, exit);
        let arguments = self.lower_arguments(site.args);
        self.emit_call_of_named(call, site, named, callee, arguments, evaluation.tail)
    }

    fn lower_call_of_declaration(
        &mut self,
        call: ExprId,
        site: Call,
        function: FnId,
        tail: Tail<'_>,
    ) -> ValueId {
        let Arguments::Values(mut values) = self.lower_arguments(site.args) else {
            unreachable!("a call with a spread argument reads its callee");
        };
        self.convert_arguments(call, &mut values);
        let id = function::declare_source_function(self.file, function, None);
        self.set_position(self.file.call_position(site));
        self.quote_if_next_fails(call);
        let arguments = EntryArguments {
            this: None,
            new_target: None,
            parameters: &values,
        };
        let value = self.emit_direct_call(id, arguments);
        match tail {
            Tail::No => {
                self.set_position(self.file.hir[call].pos);
                self.claim_call_result(call, value)
            }
            Tail::Yes { casts } => {
                let position = self.file.find_position_of_returned_call(call);
                let cast = TailCast {
                    positions: std::slice::from_ref(&position),
                    outer: casts,
                    breaks_no_int32_promise: self.enters_int32_promise_behind_return(casts)
                        && self.file.breaks_no_int32_promise(call),
                };
                self.return_call_in_tail_position(value, Tail::Yes { casts: Some(&cast) })
            }
        }
    }

    fn hand_global_object_to_stub(&mut self, arguments: Arguments) -> Arguments {
        let mut values: SmallVec<[ValueId; 4]> = match arguments {
            Arguments::Values(values) => values,
            Arguments::List(list) => (0..2)
                .map(|index| {
                    let index = self.builder.integer(index);
                    self.builder.elem_get(list, index)
                })
                .collect(),
        };
        while values.len() < 2 {
            values.push(self.builder.undefined());
        }
        values.truncate(2);
        values.push(self.builder.builtin(BuiltinId::GlobalThis, false));
        Arguments::Values(values)
    }

    pub(in crate::lower) fn lower_new(&mut self, expression: ExprId, tail: Tail<'_>) -> ValueId {
        let builtins = self.file.builtins;
        if let Some(text) = builtins.evaluated_text(expression) {
            return self.lower_evaluated_text_call(expression, text, None, tail);
        }
        let site = call_site(self.file, expression);
        if let Some(value) = self.try_lower_builtin_construct_in_place(expression, site) {
            return value;
        }
        let function = self.lower_expression(site.callee);
        let callee = Callee::without_key(function, None, self.file.find_callee_name(site.callee));
        let hir = self.file.hir;
        let mut handed = hir
            .ids(site.args)
            .map(|argument| hir.skip_type_assertions(argument));
        let only = handed.next().filter(|_| handed.next().is_none());
        let around = std::mem::replace(&mut self.only_argument_of_construction, only);
        let arguments = self.lower_arguments_of_construction(site);
        self.only_argument_of_construction = around;
        let value = self.emit_new_expression(expression, callee, arguments);
        self.record_state_creation(expression, function, value);
        value
    }

    fn lower_arguments_of_construction(&mut self, site: Call) -> Arguments {
        let file = &*self.file;
        let arguments: SmallVec<[ExprId; 4]> = file.hir.ids(site.args).collect();
        let is_worker = || {
            let constructor = table::find_name(b"Worker").and_then(table::global);
            match file.builtins.of_expr(file.skip_type_syntax(site.callee)) {
                Some(Resolved::Builtin(callee)) => {
                    Some(table::canonical_id(callee.id)) == constructor.map(table::canonical_id)
                }
                _ => false,
            }
        };
        let text = match arguments.first() {
            Some(&name) if matches!(file.hir[name].kind, ExprKind::String(_)) => None,
            Some(&name) if !intrinsic::has_spread(file.hir, &arguments) => file
                .find_text_made_of_own_path(name)
                .filter(|_| is_worker()),
            _ => None,
        };
        let Some(text) = text else {
            return self.lower_argument_slice(&arguments);
        };
        let mut values: SmallVec<[ValueId; 4]> = SmallVec::new();
        values.push(self.emit_text(&text));
        for &argument in &arguments[1..] {
            values.push(self.lower_expression(argument));
        }
        Arguments::Values(values)
    }

    pub(in crate::lower) fn lower_argument_slice(&mut self, arguments: &[ExprId]) -> Arguments {
        if intrinsic::has_spread(self.file.hir, arguments) {
            let position = self.file.hir[arguments[0]].pos;
            return Arguments::List(self.lower_argument_list(&[], arguments, position));
        }
        let values = arguments
            .iter()
            .map(|&argument| self.lower_expression(argument));
        Arguments::Values(values.collect())
    }

    pub(in crate::lower) fn emit_call_at(
        &mut self,
        callee: Callee,
        arguments: Arguments,
        options: CallOptions<'_>,
    ) -> ValueId {
        self.emit_call_with_expected_result(callee, arguments, options, None)
    }

    fn emit_call_with_expected_result(
        &mut self,
        callee: Callee,
        arguments: Arguments,
        options: CallOptions<'_>,
        expected_result: Option<ExpectedResultId>,
    ) -> ValueId {
        let on_answer = match self.callees_read_on_answers.is_empty() {
            true => None,
            false => self.callees_read_on_answers.remove(&callee.function),
        };
        let Some(on_answer) = on_answer else {
            return self.emit_call_of_one_callee(callee, arguments, options, expected_result);
        };
        let split = self.split_on_type(on_answer, TypeTable::ABSENT);
        let result = self.builder.create_variable(None);
        let join = self.create_block();
        for (block, function) in [
            (split.taken, callee.function),
            (split.not_taken, split.not_taken_value),
        ] {
            self.builder.switch_to(block);
            let arguments = arguments.clone();
            let callee = Callee { function, ..callee };
            let value = self.emit_call_of_one_callee(callee, arguments, options, expected_result);
            self.builder.write_variable(result, value);
            self.jump(join);
        }
        self.continue_in(join);
        self.builder.read_variable(result)
    }

    fn emit_call_of_one_callee(
        &mut self,
        callee: Callee,
        arguments: Arguments,
        options: CallOptions<'_>,
        expected_result: Option<ExpectedResultId>,
    ) -> ValueId {
        let called_builtin = None;
        let value = match arguments {
            Arguments::Values(values) => self.builder.call(
                callee.function,
                callee.this,
                &values,
                callee.key,
                callee.name,
                expected_result,
                called_builtin,
                options.call_number,
                options.is_never_inlined,
                options.is_done_in_place,
            ),
            Arguments::List(list) => self.builder.call_list(
                callee.function,
                callee.this,
                list,
                callee.key,
                callee.name,
                expected_result,
            ),
        };
        self.return_call_in_tail_position(value, options.tail)
    }

    pub(in crate::lower) fn return_call_in_tail_position(
        &mut self,
        call: ValueId,
        tail: Tail<'_>,
    ) -> ValueId {
        match tail {
            Tail::No => call,
            Tail::Yes { casts } => {
                let mut cast_positions: SmallVec<[DeclaredType; 4]> = SmallVec::new();
                let mut next = casts;
                while let Some(cast) = next {
                    cast_positions.extend_from_slice(cast.positions);
                    next = cast.outer;
                }
                let owes_no_proof = casts.is_some_and(|cast| cast.breaks_no_int32_promise);
                self.emit_return_call(call, &cast_positions, owes_no_proof);
                self.builder.undefined()
            }
        }
    }

    fn enters_int32_promise_behind_return(&self, casts: Option<&TailCast<'_>>) -> bool {
        let is_promise =
            |position: &DeclaredType| position.flags.contains(PositionFlags::IS_INT32_PROMISE);
        let mut next = casts;
        while let Some(cast) = next {
            if cast.positions.iter().any(is_promise) {
                return true;
            }
            next = cast.outer;
        }
        is_promise(&self.returned)
    }

    pub(in crate::lower) fn emit_call_expression(
        &mut self,
        call: ExprId,
        callee: Callee,
        arguments: Arguments,
        tail: Tail<'_>,
    ) -> ValueId {
        let site = call_site(self.file, call);
        let named = self.file.skip_type_syntax(site.callee);
        let named = self.file.builtins.builtin_of_expression(named);
        self.emit_call_of_named(call, site, named, callee, arguments, tail)
    }

    fn emit_call_of_named(
        &mut self,
        call: ExprId,
        site: Call,
        named: Option<BuiltinId>,
        mut callee: Callee,
        mut arguments: Arguments,
        tail: Tail<'_>,
    ) -> ValueId {
        let hir = self.file.hir;
        self.convert_argument_values(call, &mut arguments);
        let is_of_program = self.file.inputs.sources.kind(self.file.file) == SourceKind::Program;
        if named == Some(BuiltinId::NodeModuleCreateRequire) && is_of_program {
            callee.this = Some(self.emit_this_by_which_the_program_vouches(&callee));
        }
        if matches!(hir[call].kind, ExprKind::Call(_)) && named.is_some_and(table::stubs_global) {
            arguments = self.hand_global_object_to_stub(arguments);
        }
        self.file.intern_key_written_at_definition(site, named);
        let options = CallOptions {
            tail: Tail::No,
            is_never_inlined: false,
            is_done_in_place: false,
            call_number: self.file.number_symbol_call(call, named),
        };
        let expected = self.find_expected_result(call);
        self.set_position(self.file.call_position(site));
        self.quote_if_next_fails(call);
        match tail {
            Tail::No => {
                let value =
                    self.emit_call_with_expected_result(callee, arguments, options, expected);
                self.set_position(hir[call].pos);
                self.claim_call_result(call, value)
            }
            Tail::Yes { casts } => {
                let position = self.file.find_position_of_returned_call(call);
                let cast = TailCast {
                    positions: std::slice::from_ref(&position),
                    outer: casts,
                    breaks_no_int32_promise: self.enters_int32_promise_behind_return(casts)
                        && self.file.breaks_no_int32_promise(call),
                };
                let tail = Tail::Yes { casts: Some(&cast) };
                let options = CallOptions { tail, ..options };
                self.emit_call_with_expected_result(callee, arguments, options, expected)
            }
        }
    }

    fn emit_this_by_which_the_program_vouches(&mut self, callee: &Callee) -> ValueId {
        let this = self.builder.create_variable(None);
        let written = callee.this.unwrap_or_else(|| self.builder.undefined());
        self.builder.write_variable(this, written);
        let real = self.emit_builtin_itself(BuiltinId::NodeModuleCreateRequire);
        let is_real = self.builder.strict_eq(callee.function, real);
        let by_real = self.create_block();
        let done = self.create_block();
        self.builder
            .branch(is_real, Edge::to(by_real), Edge::to(done));

        self.continue_in(by_real);
        let word = self.emit_builtin_itself(BuiltinId::PrivateGlobalsCreateCommonJSModule);
        self.builder.write_variable(this, word);
        self.jump(done);

        self.continue_in(done);
        self.builder.read_variable(this)
    }

    fn emit_new_expression(
        &mut self,
        expression: ExprId,
        callee: Callee,
        mut arguments: Arguments,
    ) -> ValueId {
        self.convert_argument_values(expression, &mut arguments);
        self.set_position(self.file.construct_position(expression));
        self.quote_if_next_fails(expression);
        let value = self.emit_construct(callee.function, arguments, callee.name);
        self.set_position(self.file.hir[expression].pos);
        self.claim_call_result(expression, value)
    }

    fn convert_argument_values(&mut self, call: ExprId, arguments: &mut Arguments) {
        match arguments {
            Arguments::Values(values) => self.convert_arguments(call, values),
            Arguments::List(list) => self.convert_argument_list(call, *list),
        }
    }
}

pub(crate) fn emit_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    function: ValueId,
    this: Option<ValueId>,
    arguments: &[ValueId],
) -> ValueId {
    let callee = Callee::without_key(function, this, None);
    let arguments = Arguments::Values(SmallVec::from_slice(arguments));
    emit_call_of(lowering, callee, arguments)
}

pub(in crate::lower) fn emit_call_of(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    callee: Callee,
    arguments: Arguments,
) -> ValueId {
    let options = CallOptions {
        tail: Tail::No,
        is_never_inlined: false,
        is_done_in_place: false,
        call_number: None,
    };
    lowering.emit_call_at(callee, arguments, options)
}

impl FileLowering<'_, '_, '_, '_> {
    fn find_number_of_symbol_call(&self, call: ExprId) -> Option<u32> {
        let ExprKind::Call(number) = self.hir[call].kind else {
            return None;
        };
        let callee = self.skip_type_syntax(self.hir[number].callee);
        let calls_symbol = self.builtins.builtin_of_expression(callee) == Some(BuiltinId::Symbol);
        calls_symbol.then_some(u32::from(number))
    }

    #[inline]
    fn number_symbol_call(&mut self, call: ExprId, named: Option<BuiltinId>) -> Option<u32> {
        match named {
            Some(BuiltinId::Symbol | BuiltinId::SymbolFor) => self.number_symbol_made_by(call),
            _ => None,
        }
    }

    fn number_symbol_made_by(&mut self, call: ExprId) -> Option<u32> {
        self.intern_key_of_registered_symbol(call);
        let number = self.find_number_of_symbol_call(call)?;
        let description = match self.hir.ids(call_site(self, call).args).next() {
            Some(written) => match expression::find_constant(self, written) {
                Some(Constant::String(text)) => Some(Some(self.intern_atom(text))),
                _ => None,
            },
            None => Some(None),
        };
        if let Some(description) = description {
            let module = self.fragment.declare_module(ModuleRef::File(self.file));
            let key = PropertyKey::from_created_symbol(module, number, description);
            self.fragment.property_keys.intern(key);
        }
        Some(number)
    }

    fn intern_key_written_at_definition(&mut self, site: Call, named: Option<BuiltinId>) {
        let place = match named {
            Some(BuiltinId::ObjectDefineProperty | BuiltinId::ReflectDefineProperty) => 1,
            Some(
                BuiltinId::ObjectPrototype__defineGetter__
                | BuiltinId::ObjectPrototype__defineSetter__,
            ) => 0,
            _ => return,
        };
        if let Some(written) = self.hir.ids(site.args).nth(place) {
            self.find_constant_key(written);
        }
    }

    fn intern_key_of_registered_symbol(&mut self, call: ExprId) {
        let ExprKind::Call(site) = self.hir[call].kind else {
            return;
        };
        let callee = self.skip_type_syntax(self.hir[site].callee);
        if self.builtins.builtin_of_expression(callee) != Some(BuiltinId::SymbolFor) {
            return;
        }
        let Some(written) = self.hir.ids(self.hir[site].args).next() else {
            return;
        };
        if let Some(Constant::String(text)) = expression::find_constant(self, written) {
            let text = self.intern_atom(text);
            let key = PropertyKey::from_registered_symbol(text);
            self.fragment.property_keys.intern(key);
        }
    }

    fn find_callee_by_signature(&mut self, call: ExprId) -> Option<BuiltinId> {
        let declaration = match self.queries.only_declaration_called(call) {
            Some(function) => function,
            None => self.queries.resolved_call(call).ok()??.declaration?,
        };
        let types = self.inputs.builtin_types;
        let index = types.value_of_call_signature(self.queries.files(), declaration)?;
        builtin_value_of(index)
    }
}

#[inline]
fn call_site(file: &FileLowering<'_, '_, '_, '_>, call: ExprId) -> Call {
    let hir = file.hir;
    let (ExprKind::Call(site) | ExprKind::New(site) | ExprKind::TaggedTemplate(site)) =
        hir[call].kind
    else {
        unreachable!("call_site takes a Call, a New or a TaggedTemplate expression");
    };
    hir[site]
}
