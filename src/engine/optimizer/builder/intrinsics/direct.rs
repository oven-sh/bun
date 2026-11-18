//! Calls of the typed forms of built-ins.

use bun_engine_codegen::ir::Value as Ssa;
use bun_engine_vm::direct::{
    Context, Form, Gives, Kind as Wanted, Operand, State, Throws, forms_for,
};
use bun_engine_vm::{
    Gc, GlobalObject, InternalFunction, Intrinsic, JsFunction, RegExp, SpeculatedType as T, Value,
    ValueVec,
};
use smallvec::SmallVec;

use super::in_line::Checked;
use crate::builder::Builder;
use crate::builder::calls::CallSite;
use crate::graph::{CallKind, ExitKind, Fibers, FormCall, Kind, NOT_NAN};
use crate::runtime::cells::realm_while_building;

/// What is passed, also for the operands that are only checked.
pub(super) type Passed = SmallVec<[Ssa; 8]>;

impl Builder<'_> {
    pub(super) fn realm_of_callee(&self, callee: Ssa) -> Option<Gc<GlobalObject>> {
        match self.constant_cell::<JsFunction>(callee) {
            Some(function) => Some(function.function_realm()),
            None => Some(self.constant_cell::<InternalFunction>(callee)?.global()),
        }
    }

    pub(super) fn call_form(&mut self, which: Intrinsic, site: &CallSite<'_>) -> Option<Ssa> {
        let realm = self.realm_of_callee(site.callee)?;
        let (&first, arguments) = site.arguments.split_first()?;
        let seen = self.results_at(site);
        if site.kind == CallKind::Construct
            && self.graph.root(first) != self.graph.root(site.callee)
            || seen.is_empty()
        {
            return None;
        }
        let forms = || forms_for(which, site.kind.specialization(), arguments.len());
        let takes_plain =
            |form: Form| (form.operands.iter()).any(|it| it.kind == Wanted::PlainRegExp);
        let may_guess_pattern = !forms().any(takes_plain);
        let operands_of = |form: Form| &site.arguments[usize::from(!form.takes_this)..];
        let form = forms().find(|&form| {
            let (kinds, values) = (form.operands.iter().map(|it| it.kind), operands_of(form));
            (form.throws == Throws::Never || !self.has_exited(ExitKind::Threw))
                && (!form.gives.needs_call() || Kind::calling(form).is_some())
                && kinds.enumerate().all(|(position, kind)| {
                    self.suits(
                        kind,
                        values.get(position).copied(),
                        realm,
                        may_guess_pattern,
                    )
                })
                && form.prepare(self.vm, &realm)
        })?;
        if let Some(result) = self.evaluate(form, realm, site.arguments) {
            return Some(result);
        }
        for &which in form.needs {
            self.watch(realm.watchpoints(self.vm, which));
        }
        if let Some(result) = self.convert_in_line(form, operands_of(form)) {
            return Some(result);
        }
        let pass = |(position, operand): (usize, &Operand)| {
            self.pass(
                operand.kind,
                operands_of(form).get(position).copied(),
                realm,
            )
        };
        let passed: Passed = form.operands.iter().enumerate().map(pass).collect();
        let call = Checked {
            form,
            realm,
            passed: &passed,
            seen,
        };
        if let Some(result) = self.in_line(call) {
            return Some(result);
        }
        let result = self.result_of_form(call);
        if let Gives::Value { .. } = form.gives {
            self.note_result_of(site, result);
        }
        Some(result)
    }

    /// Empty if the call has never returned.
    pub(in crate::builder) fn results_at(&self, site: &CallSite<'_>) -> T {
        let seen = (self.returns_to(site))
            .map(|(frame, metadata)| self.frames[frame].code_block.prediction(metadata).get());
        match seen {
            Some(seen) if !seen.is_empty() => seen,
            _ if site.kind == CallKind::TailCall => T::HEAP_TOP,
            _ if self.has_exited(ExitKind::NeverExecuted) => T::HEAP_TOP,
            _ => T::empty(),
        }
    }

    fn evaluate(&mut self, form: Form, realm: Gc<GlobalObject>, all: &[Ssa]) -> Option<Ssa> {
        if !form.is_pure() {
            return None;
        }
        let this = match form.takes_this {
            true => self.constant_value(all[0])?,
            false => Value::UNDEFINED,
        };
        let mut arguments = ValueVec::new();
        for &argument in all[1..].iter().take(form.arguments().len()) {
            arguments.push(self.constant_value(argument)?);
        }
        let result = form.evaluate(realm_while_building(realm), this, &arguments)?;
        if let Some(string) = result.as_string() {
            string.try_resolve(self.vm).ok()?;
        }
        (result.as_cell()).inspect(|&cell| self.dependencies.keep(cell));
        let result = result.as_double().map_or(result, Value::number);
        Some(self.value(result))
    }

    fn describe_call(&mut self, form: Form, realm: Gc<GlobalObject>, passed: &[Ssa]) -> FormCall {
        const MOST_GROUPS: usize = 32;
        let (mut subject, mut pattern) = (None, None);
        for (operand, &value) in form.operands.iter().zip(passed) {
            match operand.kind {
                Wanted::Characters | Wanted::Value(T::STRING) => subject = subject.or(Some(value)),
                Wanted::PlainRegExp => pattern = self.known_pattern(value, realm),
                Wanted::Pattern(_) => pattern = self.constant_cell::<RegExp>(value),
                _ => {}
            }
        }
        let mut fibers = Fibers::empty();
        if let Some(string) = subject {
            fibers.set(Fibers::IS_FLAT, self.is(string, T::FLAT_STRING));
            let may_be_rope = self.expected(string).intersects(T::ROPE_STRING);
            fibers.set(Fibers::MAY_WELL_BE_ROPE, may_be_rope);
        }
        let groups = pattern.and_then(|it| it.known_group_count());
        FormCall {
            form,
            subject: fibers,
            uses_last_index: pattern.is_some_and(|it| it.uses_last_index()),
            groups: (groups.filter(|&it| it <= MOST_GROUPS && form.is_distinct)).map(|it| it as u8),
        }
    }

    /// In the representation that the form gives it in.
    pub(super) fn node_for_form(
        &mut self,
        form: Form,
        realm: Gc<GlobalObject>,
        passed: &[Ssa],
    ) -> Ssa {
        let mut operands = Passed::new();
        if form.context == Context::Realm {
            operands.push(self.cell(realm.cell()));
        }
        let pairs = form.operands.iter().zip(passed);
        operands.extend(pairs.filter(|it| it.0.is_passed).map(|it| *it.1));
        if let Form::slice | Form::substring | Form::substr = form {
            self.prepare_for_ropes();
        }
        let kind = Kind::calling(form).expect("or it would not have been picked");
        let data = self.describe_call(form, realm, passed).to_data();
        let result = self.node(kind, &operands, data);
        if form.writes.contains(State::LAST_INDEX) {
            self.node(Kind::MayHaveSetLastIndex, &[], 0);
        }
        if form.writes.contains(State::TRANSITIONS) {
            self.node(Kind::MayHaveFired, &[], 0);
        }
        result
    }

    fn result_of_form(&mut self, call: Checked<'_>) -> Ssa {
        let (form, realm, passed, seen) = (call.form, call.realm, call.passed, call.seen);
        match form.gives {
            Gives::Constant(bits) => self.graph.function.const64(bits as i64),
            Gives::Operand(position) => {
                let operand = passed[usize::from(position)];
                match form.operands[usize::from(position)].kind {
                    Wanted::Integer { .. } => self.box_int32(operand),
                    kind if kind.is_double() => self.box_result(operand, T::FULL_DOUBLE, seen),
                    _ => operand,
                }
            }
            Gives::Int32 { min, max } => {
                let mut result = self.node_for_form(form, realm, passed);
                if min >= 0 {
                    result = self.at_most(result, max as u32);
                }
                self.box_int32(result)
            }
            Gives::Boolean => {
                let result = self.node_for_form(form, realm, passed);
                let result = self.at_most(result, 1);
                self.box_boolean(result)
            }
            Gives::Double(types) => {
                let result = self.node_for_form(form, realm, passed);
                self.box_result(result, types, seen)
            }
            Gives::Value {
                mut types,
                or_first_operand,
                ..
            } => {
                if or_first_operand && !self.is(passed[0], T::FLAT_STRING) {
                    types = form.result_types();
                }
                let result = self.node_for_form(form, realm, passed);
                self.graph.declare(result, types);
                let likely = Some(seen & types).filter(|it| !it.is_empty());
                self.graph.predict(result, likely.unwrap_or(types));
                result
            }
        }
    }

    /// As an int32, if that is what the lower tiers have made of it.
    pub(super) fn box_result(&mut self, double: Ssa, types: T, seen: T) -> Ssa {
        if T::INT32.contains(seen) && !self.has_had_effect && !self.has_exited(ExitKind::Overflow) {
            let int32 = self.node(Kind::DoubleAsInt32, &[double], ExitKind::Overflow as u32);
            return self.box_int32(int32);
        }
        let data = if T::REAL_DOUBLE.contains(types) {
            NOT_NAN
        } else {
            0
        };
        self.profiled_node(Kind::BoxDouble, &[double], data, types & T::BOXED_DOUBLE)
    }
}
