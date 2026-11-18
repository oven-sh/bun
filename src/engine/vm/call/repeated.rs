use bun_engine_bytecode::Specialization;

use super::{CallTarget, stubs};
use crate::heap::stack::stack_pointer;
use crate::{CellType, Cx, Forbidden, Gc, JsCell, JsFunction, JsResult, Value};

/// For a loop that calls the same function on each turn. It is used from about as deep in the stack as it was made.
#[derive(Clone, Copy)]
pub struct RepeatedCall {
    callee: Value,
    /// The same, if nothing has to be looked at before it is entered.
    function: Option<Gc<JsCell>>,
}

impl RepeatedCall {
    #[inline]
    pub fn new(cx: &Cx, callee: Value) -> RepeatedCall {
        let function = callee.as_cell().filter(|cell| {
            CellType::FUNCTIONS.contains(cell.cell_type())
                && cx.is_entered()
                && stack_pointer() >= cx.soft_stack_limit()
        });
        RepeatedCall { callee, function }
    }

    #[inline(always)]
    pub fn callee(&self) -> Value {
        self.callee
    }

    /// Call(F, V, argumentsList)
    #[inline(always)]
    pub fn call<const COUNT: usize>(
        &self,
        cx: &mut Cx,
        this: Value,
        arguments: [Value; COUNT],
    ) -> JsResult<Value> {
        const { assert!(COUNT <= 4) };
        let Some(function) = self.function.filter(|_| !cx.traps().need_handling()) else {
            return cx.call(self.callee, this, &arguments);
        };
        debug_assert!(!cx.has_exception() && cx.is_entered());
        #[cfg(debug_assertions)]
        crate::direct::will_run_script();
        cx.assert_is_allowed(Forbidden::SCRIPTS);
        let argument = |index: usize| arguments.get(index).copied().unwrap_or_default();
        // SAFETY: both kinds of function have an executable, and the entry goes with it.
        unsafe {
            let executable = JsFunction::executable_or_rare_data(function);
            let target = CallTarget::of(&executable, Specialization::Call);
            if COUNT > 2 {
                return stubs::enter_with_four(
                    target.entry,
                    cx,
                    target.code_block,
                    self.callee.to_bits(),
                    COUNT as u64 + 1,
                    this.to_bits(),
                    argument(0).to_bits(),
                    target.executable,
                    argument(1).to_bits(),
                    argument(2).to_bits(),
                    argument(3).to_bits(),
                );
            }
            stubs::enter_short(
                target.entry,
                cx,
                target.code_block,
                self.callee.to_bits(),
                COUNT as u64 + 1,
                this.to_bits(),
                0,
                target.executable,
                argument(0).to_bits(),
                argument(1).to_bits(),
            )
        }
    }
}
