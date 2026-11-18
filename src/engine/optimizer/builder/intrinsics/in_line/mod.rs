//! Forms that take less work than a call.

mod dates;
mod numbers;
mod regexps;
mod strings;

use bun_engine_codegen::ir::Value as Ssa;
use bun_engine_vm::direct::Form;
use bun_engine_vm::{CellKind, Gc, GlobalObject, RealmSlot, SpeculatedType as T, Value};

use crate::builder::Builder;
use crate::graph::ExitKind;

/// A call whose operands have been checked.
#[derive(Clone, Copy)]
pub(super) struct Checked<'a> {
    pub(super) form: Form,
    pub(super) realm: Gc<GlobalObject>,
    /// For each operand of the form.
    pub(super) passed: &'a [Ssa],
    /// The results so far.
    pub(super) seen: T,
}

impl Builder<'_> {
    /// The result with its tag. Nothing has been added if there is none.
    pub(super) fn in_line(&mut self, call: Checked<'_>) -> Option<Ssa> {
        (self.string_in_line(call))
            .or_else(|| self.number_in_line(call))
            .or_else(|| self.date_in_line(call))
            .or_else(|| self.regexp_in_line(call))
    }

    /// The same, for those that are better off with the operands as they are.
    pub(super) fn convert_in_line(&mut self, form: Form, values: &[Ssa]) -> Option<Ssa> {
        let (&value, failure) = (values.first()?, ExitKind::NotANumber);
        match form {
            Form::number_itself | Form::this_number
                if self.expects(value, T::FULL_NUMBER, failure) =>
            {
                Some(self.check_type_or(value, T::BOXED_NUMBER, failure))
            }
            Form::number_itself => Some(self.quiet_to_number(value, self.likely_type(value))),
            Form::string_of_primitive => Some(self.quiet_to_string(value)),
            _ => None,
        }
    }

    /// The caller initializes the fields.
    fn new_instance_of<C: CellKind>(&mut self, realm: Gc<GlobalObject>, shape: RealmSlot) -> Ssa {
        const { assert!(!core::mem::needs_drop::<C>()) };
        let allocation = self.allocation(realm.slot(self.vm, shape).cast(), size_of::<C>());
        self.new_instance(allocation.expect("small"))
    }

    /// The int32 with its tag, or NaN if the condition holds.
    fn int32_or_nan(&mut self, is_nan: Ssa, int32: Ssa) -> Ssa {
        let (nan, boxed) = (self.value(Value::NAN), self.box_int32(int32));
        let result = self.ir().select(is_nan, nan, boxed);
        self.graph.declare(result, T::INT32 | T::PURE_NAN);
        self.graph.predict(result, T::INT32 | T::PURE_NAN);
        result
    }
}
