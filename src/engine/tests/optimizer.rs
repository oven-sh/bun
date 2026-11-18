//! Each script throws unless optimized code does what the lower tiers do.

#![feature(negative_impls)]
#![allow(improper_ctypes_definitions)]

#[path = "optimizer/host.rs"]
mod host;

use bun_engine_standalone as _;
use bun_engine_text::{Identifier, StringRef, Text};
use bun_engine_vm::heap::HeapKind;
use bun_engine_vm::*;

static HOOKS: RealmHooks = RealmHooks {
    modules: ModuleHooks::DEFAULT,
    promise_rejection_tracker: |_, _, _| {},
    report_uncaught_exception: |_, _| {},
    current_script_execution_owner: |cx| cx.global().upcast(),
    script_execution_status: |_, _| ScriptExecutionStatus::Running,
    default_language: StringRef::empty,
    derive_shadow_realm: |cx| Ok(cx.global()),
    compile_wasm_streaming: None,
    instantiate_wasm_streaming: None,
};

fn run(text: &str) {
    let mut options = Options::default();
    (options.use_quick_optimizer, options.use_full_optimizer) = (true, true);
    options.force_eager_compilation = true;
    options.use_eager_regexp_jit = true;
    options.collect_every_n_allocations = 200;
    if env!("CARGO_CRATE_NAME") == "optimizer_probed" {
        options.checks_per_forced_exit = 20;
        options.learn_from_forced_exits = true;
        options.calls_per_forced_jettison = 200;
        options.exits_allowed = 5;
        options.randomize_profiles = true;
        options.clobber_what_is_dead = true;
        options.collect_every_n_safepoints = 50;
        options.collect_every_n_allocations = 1000;
        (options.validate_proofs, options.validate_effects) = (true, true);
    }
    set_options(options);
    let vm = bun_engine::create_vm(HeapKind::Small);
    // SAFETY: nothing else uses the `Vm`.
    let cx = unsafe { Cx::from_global(GlobalObject::create(vm.get(), &HOOKS)) };
    assert!(cx.set_time_zone(Text::from_ascii("Asia/Kolkata")));
    let (name, other) = (
        Identifier::from_literal("other"),
        GlobalObject::create(cx, &HOOKS).global_this(),
    );
    (cx.global()).put_direct(cx, name.name(), other.into(), Attributes::NONE);
    host::define(cx);
    let text = [include_str!("optimizer/harness.js"), text].concat();
    for text in [&*text, "finish()"] {
        let text = StringRef::from_str(text);
        let provider = SourceProvider::build(text, None, SourceType::Program).finish();
        if evaluate_script(cx, &SourceCode::whole(provider), Value::UNDEFINED).is_err() {
            let thrown = cx.clear_exception().unwrap().value();
            panic!("{}", thrown.to_string_view(cx).unwrap().text());
        }
        cx.drain_microtasks().unwrap();
    }
}

macro_rules! scripts {
    ($($name:ident)*) => {$(
        #[test]
        fn $name() {
            run(include_str!(concat!("optimizer/", stringify!($name), ".js")));
        }
    )*};
}

scripts! {
    array_methods
    arrays
    caches
    calls
    checks
    collections
    control
    conversions
    dates
    elements
    enumeration
    escapes
    exceptions
    globals
    host
    iteration
    library
    loops
    modules
    numbers
    objects
    operators
    queries
    regexps
    rest
    states
    strings
    suspension
    typed_arrays
    views
}
