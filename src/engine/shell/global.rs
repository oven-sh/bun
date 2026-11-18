//! The global object of the shell.

use bun_engine_macros::{cell, object_ops};
use bun_engine_number::Random;
use bun_engine_text::symbols;
use bun_engine_vm::{
    DontEnumMode, Field, GlobalObject, Inherited, PromiseRejectionOperation, PropertyNameList,
    RealmHooks, ScriptExecutionStatus, Shape, ShapeSpec, Strong, Vm,
};

use crate::prelude::*;
use crate::{functions, modules, run};

#[cell(name = "global", ops)]
pub(crate) struct ShellGlobal {
    base: GlobalObject,
    pub(crate) unhandled_rejection_callback: Field<Option<Gc<JsObject>>>,
}

#[object_ops]
impl ShellGlobal {
    fn own_property_names(
        &self,
        cx: &mut Cx,
        list: &mut PropertyNameList,
        mode: DontEnumMode,
    ) -> JsResult<()> {
        let mut all = PropertyNameList::new(list.mode());
        self.base_own_property_names(cx, &mut all, mode)?;
        let state = State::of(cx);
        let hidden = state.hidden_globals.borrow();
        for name in all.iter().filter(|name| !hidden.contains(*name)) {
            list.add(name.name());
        }
        Ok(())
    }
}

static HOOKS: RealmHooks = RealmHooks {
    modules: modules::HOOKS,
    promise_rejection_tracker: |cx, promise, operation| {
        if operation == PromiseRejectionOperation::Reject {
            let state = State::of(cx);
            let mut rejected = state.rejected_promises.borrow_mut();
            rejected.push(Strong::new(cx, promise));
        }
    },
    report_uncaught_exception: |cx, exception| {
        run::dump_exception(cx, exception.value());
        if !State::of(cx).command_line().is_inspected {
            run::exit(run::EXIT_EXCEPTION)
        }
    },
    current_script_execution_owner: |cx| cx.global().upcast(),
    script_execution_status: |_, _| ScriptExecutionStatus::Running,
    default_language: StringRef::empty,
    derive_shadow_realm: |cx| {
        let realm = GlobalObject::create_for_shadow_realm(cx, &HOOKS);
        fix_time_and_chance(cx, realm);
        Ok(realm)
    },
    compile_wasm_streaming: None,
    instantiate_wasm_streaming: None,
};

/// 2035-06-17T12:34:56.789Z
pub(crate) const FIXED_TIME: f64 = 2_065_696_496_789.0;

fn fix_time_and_chance(vm: &Vm, realm: Gc<GlobalObject>) {
    if State::of(vm).command_line().is_deterministic {
        realm.overridden_date_now().set(FIXED_TIME);
        realm.random_state().set(Random::new(1));
    }
}

pub(crate) fn create(vm: &Vm) -> Gc<GlobalObject> {
    let shape = Shape::create(vm, None, Value::NULL, ShapeSpec::of::<ShellGlobal>());
    let global = vm.allocate::<ShellGlobal>(ShellGlobalInit {
        base: GlobalObject::init(vm, shape, &HOOKS, core::ptr::null()),
        unhandled_rejection_callback: None,
    });
    let global: Gc<GlobalObject> = global.upcast();
    global.finish_creation(vm);
    fix_time_and_chance(vm, global);
    // SAFETY: a shared borrow, as that of the `Vm` is.
    let cx: &Cx = unsafe { Cx::from_global(global) };
    let tag = JsString::from_literal(vm, "global").into();
    let attributes = Attributes::DONT_ENUM | Attributes::READ_ONLY;
    global.put_direct(vm, symbols::toStringTag, tag, attributes);
    let mut hidden = State::of(vm).hidden_globals.take();
    hidden.insert(symbols::toStringTag.to_identifier());
    State::of(vm).hidden_globals.replace(hidden);
    functions::define_globals(cx);
    global
}

pub(crate) fn define_hidden(cx: &Cx, name: &'static str, value: Value) {
    let name = Identifier::from_literal(name);
    (cx.global()).put_direct(cx, name.name(), value, Attributes::DONT_ENUM);
    State::of(cx).hidden_globals.borrow_mut().insert(name);
}
