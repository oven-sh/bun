//! Where the rules of `bun lint` that are written in JavaScript run: in a VM on the thread that
//! lints the file. A thread gets its VM the first time it has a file for such a rule.
//!
//! The program is `bun_lint::js_plugin::PROGRAM`: the body of a function that is given [`request`]
//! and [`again`] to ask with, and returns the function that [`ThreadVm::call`] calls.

use core::cell::{Cell, RefCell};
use core::ptr::NonNull;

use bun_jsc::{
    self as jsc, CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult, Strong,
    virtual_machine::VirtualMachine,
};
use bun_lint_driver::js_plugin::{Engine, PROGRAM, Serve, Vm};

/// The message that the program is called with, and what answers its questions meanwhile.
struct Call<'c, 's> {
    content: &'c [u8],
    serve: &'c mut Serve<'s>,
}

/// What the VM of a thread has for `bun lint`: `RuntimeState::lint`.
pub(crate) struct LintVm {
    /// What the program returns.
    handle: Strong,
    /// Set while `handle` runs.
    call: Cell<Option<NonNull<Call<'static, 'static>>>>,
    /// The last answer.
    answer: RefCell<Vec<u8>>,
}

/// Takes the call out of the VM when it is over.
struct Lent<'v>(&'v LintVm);

impl Drop for Lent<'_> {
    fn drop(&mut self) {
        self.0.call.set(None);
    }
}

unsafe extern "C" {
    fn Bun__REPL__evaluate(
        global: *const JSGlobalObject,
        source: *const u8,
        source_len: usize,
        filename: *const u8,
        filename_len: usize,
        exception: *mut JSValue,
    ) -> JSValue;
}

fn message_of(global: &JSGlobalObject, error: JSValue) -> Vec<u8> {
    match error.to_bun_string(global) {
        Ok(text) => text.to_utf8().slice().to_vec(),
        Err(_) => {
            global.clear_exception();
            b"An exception was thrown.".to_vec()
        }
    }
}

/// Copies the last answer into the `ArrayBuffer` `into`, if it fits.
fn copy_answer(global: &JSGlobalObject, state: &LintVm, into: JSValue) -> JsResult<JSValue> {
    let Some(mut buffer) = into.as_array_buffer(global) else {
        return Err(global.throw_invalid_arguments(format_args!("Expected an ArrayBuffer")));
    };
    let answer = state.answer.borrow();
    if let Some(start) = buffer.byte_slice_mut().get_mut(..answer.len()) {
        start.copy_from_slice(&answer);
    }
    Ok(JSValue::js_number_from_uint64(answer.len() as u64))
}

/// `request(kind, details, buffer)`
#[bun_jsc::host_fn]
fn request(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [kind, details, into] = frame.arguments_as_array::<3>();
    let state = crate::jsc_hooks::lint_vm().get();
    let Some((state, mut call)) = state.and_then(|state| Some((state, state.call.get()?))) else {
        return Err(global.throw_invalid_arguments(format_args!("No file is being linted")));
    };
    let details = details.to_bun_string(global)?;
    // SAFETY: `ThreadVm::call` has set it to what is on its stack, is waiting for the function
    // that calls this one, and takes it out before it returns. Nothing else reads it: `serve` does
    // not run JavaScript.
    let call = unsafe { call.as_mut() };
    {
        let mut answer = state.answer.borrow_mut();
        answer.clear();
        match kind.to_int32() {
            0 => answer.extend_from_slice(call.content),
            kind => (call.serve)(kind as u32, details.to_utf8().slice(), &mut answer),
        }
    }
    copy_answer(global, state, into)
}

/// `again(buffer)`
#[bun_jsc::host_fn]
fn again(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    match crate::jsc_hooks::lint_vm().get() {
        Some(state) => copy_answer(global, state, frame.argument(0)),
        None => Ok(JSValue::UNDEFINED),
    }
}

/// Runs the program in the VM of this thread, which is new.
fn start_program(vm: &VirtualMachine) -> Result<LintVm, Vec<u8>> {
    let global = vm.global();
    let mut source = b"(function (request, again) {\n\
        const require = process.getBuiltinModule(\"node:module\").createRequire(process.cwd() + \"/\");\n\
        const load = specifier => import(specifier);\n"
        .to_vec();
    PROGRAM.iter().for_each(|part| source.extend_from_slice(part.1.as_bytes()));
    source.extend_from_slice(b"\n})");
    let name = b"bun-lint-plugins.js";
    let mut exception = JSValue::UNDEFINED;
    // SAFETY: `global` is that of this thread's VM, whose lock is held, and the slices and
    // `exception` outlive the call.
    let program = unsafe {
        Bun__REPL__evaluate(global, source.as_ptr(), source.len(), name.as_ptr(), name.len(), &raw mut exception)
    };
    if !exception.is_undefined() {
        return Err(message_of(global, exception));
    }
    let functions = [
        JSFunction::create(global, "request", __jsc_host_request, 3, Default::default()),
        JSFunction::create(global, "again", __jsc_host_again, 1, Default::default()),
    ];
    match program.call(global, JSValue::UNDEFINED, &functions) {
        Ok(handle) => Ok(LintVm {
            handle: Strong::create(handle, global),
            call: Cell::new(None),
            answer: RefCell::new(Vec::new()),
        }),
        Err(error) => Err(message_of(global, global.take_exception(error))),
    }
}

/// Makes a VM for this thread.
fn start_vm() -> Result<(), Vec<u8>> {
    let failed = |what: &str| [b"Could not start JavaScript for the plugins: ", what.as_bytes()].concat();
    bun_ast::initialize_store();
    let vm = VirtualMachine::init(jsc::VirtualMachineInitOptions {
        is_main_thread: false,
        ..Default::default()
    })
    .map_err(|error| failed(error.name()))?;
    debug_assert!(core::ptr::eq(vm, VirtualMachine::get_mut_ptr()));
    let vm = VirtualMachine::get().as_mut();
    // The threads that would transpile are the ones that lint, and wait for it.
    vm.transpiler_store.enabled = false;
    vm.transpiler.resolver.env_loader = NonNull::new(vm.transpiler.env);
    vm.transpiler.options.env.behavior = bun_options_types::schema::api::DotEnvBehavior::LoadAllWithoutInlining;
    vm.transpiler.configure_defines().map_err(|error| failed(error.name()))?;
    vm.load_extra_env_and_source_code_printer();
    vm.event_loop_mut().ensure_waker();
    Ok(())
}

/// The VM of this thread.
struct ThreadVm;

impl Vm for ThreadVm {
    fn call(&mut self, kind: u32, content: &[u8], serve: &mut Serve) -> Result<Vec<u8>, Vec<u8>> {
        let vm = VirtualMachine::get();
        vm.run_with_api_lock(|| {
            let global = vm.global();
            let slot = crate::jsc_hooks::lint_vm();
            let state = match slot.get() {
                Some(state) => state,
                None => {
                    let started = Box::new(start_program(vm)?);
                    slot.get_or_init(|| started)
                }
            };
            let mut call = Call { content, serve };
            state.call.set(Some(NonNull::from(&mut call).cast()));
            let _lent = Lent(state);
            let _scope = vm.enter_event_loop_scope();
            let kind = JSValue::js_number_from_int32(kind as i32);
            let mut returned = (state.handle.get().call(global, JSValue::UNDEFINED, &[kind]))
                .map_err(|error| message_of(global, global.take_exception(error)))?;
            if let Some(promise) = returned.as_any_promise() {
                if vm.as_mut().wait_for_promise(promise).is_err() {
                    return Err(b"JavaScript was stopped.".to_vec());
                }
                returned = promise.result(global.vm());
                if promise.status() == jsc::js_promise::Status::Rejected {
                    return Err(message_of(global, returned));
                }
            }
            match returned.to_bun_string(global) {
                Ok(text) => Ok(text.to_utf8().slice().to_vec()),
                Err(error) => Err(message_of(global, global.take_exception(error))),
            }
        })
    }
}

/// One VM for each thread that asks.
#[derive(Default)]
pub(crate) struct ThreadVms {
    initialize: std::sync::Once,
}

impl Engine for ThreadVms {
    fn with_vm(&self, then: &mut dyn FnMut(&mut dyn Vm)) -> Result<(), Vec<u8>> {
        if !VirtualMachine::is_loaded() {
            // Every thread is busy with its own VM: there is no core left for threads that compile
            // or collect garbage beside it.
            self.initialize.call_once(|| {
                jsc::initialize(jsc::InitializeOptions {
                    one_shot: true,
                    ..Default::default()
                });
            });
            start_vm()?;
        }
        then(&mut ThreadVm);
        Ok(())
    }
}
