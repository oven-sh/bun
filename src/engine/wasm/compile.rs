//! `compile`, `instantiate` and `validate` of the namespace.

use bun_engine_vm::{
    Attributes, GcFree, JsCell, JsPromise, ModuleLoader, Thrown, Ticket, WeakTicket, WorkKind,
};
use bun_engine_wasm_runtime::{CompileError, Compiled};

use crate::compile_options::CompileOptions;
use crate::engine::engine;
use crate::instance_cell::WasmInstance;
use crate::module::{self, WasmModule, optional_object};
use crate::namespace::{Namespace, Slot};
use crate::prelude::*;
use crate::{instance, module_record, source};

/// What a promise waits for.
#[derive(Clone, Copy)]
pub(crate) enum Goal {
    Module,
    ModuleAndInstance {
        imports: Option<Gc<JsObject>>,
        /// Whether what follows the reading of the imports is a task of its own.
        runs_later: bool,
    },
    Record {
        loader: Gc<ModuleLoader>,
        key: Gc<JsCell>,
    },
}

/// The same without the cells, which the ticket has.
#[derive(Clone, Copy)]
enum GoalKind {
    Module,
    ModuleAndInstance { has_imports: bool, runs_later: bool },
    Record,
}

/// A promise that is settled once some thread has compiled a module.
pub(crate) struct Pending {
    ticket: WeakTicket,
    options: CompileOptions,
    goal: GoalKind,
    keeps_waiting: CancelOnDrop,
}

#[derive(Default)]
struct CancelOnDrop(WeakTicket);

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

struct Outcome(Compiled);

// SAFETY: it comes from a thread that has no heap.
unsafe impl GcFree for Outcome {}

impl Outcome {
    fn into_inner(self) -> Compiled {
        self.0
    }
}

impl Pending {
    pub(crate) fn new(
        cx: &Cx,
        kind: WorkKind,
        promise: Gc<JsPromise>,
        options: CompileOptions,
        goal: Goal,
    ) -> Pending {
        let ticket = |cells: &[Gc<JsCell>]| cx.add_pending_work(kind, promise.upcast(), cells);
        let (goal, ticket) = match goal {
            Goal::Module => (GoalKind::Module, ticket(&[])),
            Goal::ModuleAndInstance {
                imports,
                runs_later,
            } => {
                let has_imports = imports.is_some();
                let goal = GoalKind::ModuleAndInstance {
                    has_imports,
                    runs_later,
                };
                (goal, ticket(imports.map(Gc::cell).as_slice()))
            }
            Goal::Record { loader, key } => (GoalKind::Record, ticket(&[loader.cell(), key])),
        };
        Pending {
            ticket,
            options,
            goal,
            keeps_waiting: CancelOnDrop::default(),
        }
    }

    fn promise(&self, cx: &Cx) -> Option<Gc<JsPromise>> {
        Some(self.ticket.upgrade()?.target(cx)?.cast())
    }

    /// For one that was not worth waiting for so far.
    pub(crate) fn is_imminent_now(&mut self, cx: &Cx) {
        if let Some(promise) = self.promise(cx) {
            let kind = WorkKind::ImminentlyScheduled;
            self.keeps_waiting = CancelOnDrop(cx.add_pending_work(kind, promise.upcast(), &[]));
        }
    }

    pub(crate) fn reject(self, cx: &Cx, reason: Value) {
        if let Some(promise) = self.promise(cx) {
            self.cancel();
            promise.reject(cx, reason);
        }
    }

    /// The promise is never settled.
    pub(crate) fn cancel(self) {
        self.ticket.cancel();
    }

    /// On any thread.
    pub(crate) fn complete(self, compiled: Compiled) {
        let (options, goal, outcome) = (self.options, self.goal, Outcome(compiled));
        let keeps_waiting = self.keeps_waiting;
        self.ticket.schedule(move |cx, ticket| {
            let _until_the_end = keeps_waiting;
            let (Some(promise), Some(goal)) = (ticket.target(cx), goal.with_cells(cx, ticket))
            else {
                return Ok(());
            };
            let promise = promise.cast::<JsPromise>();
            let shape = Namespace::of(cx).shape(cx, Slot::ModuleShape);
            module::finish(cx, shape, outcome.into_inner(), &options)
                .and_then(|module| goal.pursue(cx, promise, module))
                .or_else(|thrown| promise.reject_with_caught(cx, thrown))
        });
    }
}

impl GoalKind {
    /// `None` if the ticket is cancelled.
    fn with_cells(self, cx: &Cx, ticket: &Ticket) -> Option<Goal> {
        Some(match self {
            GoalKind::Module => Goal::Module,
            GoalKind::ModuleAndInstance {
                has_imports,
                runs_later,
            } => Goal::ModuleAndInstance {
                imports: match has_imports {
                    true => Some(ticket.dependency(cx, 0)?.cast()),
                    false => None,
                },
                runs_later,
            },
            GoalKind::Record => Goal::Record {
                loader: ticket.dependency(cx, 0)?.cast(),
                key: ticket.dependency(cx, 1)?,
            },
        })
    }
}

impl Goal {
    fn pursue(self, cx: &mut Cx, promise: Gc<JsPromise>, module: Gc<WasmModule>) -> JsResult<()> {
        let result = match self {
            Goal::Module => module.into(),
            Goal::Record { loader, key } => module_record::create(cx, loader, key.into(), module)?,
            Goal::ModuleAndInstance {
                imports,
                runs_later,
            } => {
                let instance = link(cx, module, imports)?;
                if runs_later {
                    run_later(cx, promise, instance, with_module);
                    return Ok(());
                }
                instance::run(cx, instance)?;
                with_module(cx, instance)
            }
        };
        promise.resolve(cx, result)
    }
}

fn link(
    cx: &mut Cx,
    module: Gc<WasmModule>,
    imports: Option<Gc<JsObject>>,
) -> JsResult<Gc<WasmInstance>> {
    let shape = Namespace::of(cx).shape(cx, Slot::InstanceShape);
    instance::create_and_link(cx, shape, module, imports)
}

/// `WebAssemblyInstantiatedSource`
fn with_module(cx: &Cx, instance: Gc<WasmInstance>) -> Value {
    let (result, attributes) = (cx.new_object(), Attributes::NONE);
    result.put_direct(cx, names::module, instance.module().into(), attributes);
    result.put_direct(cx, names::instance, instance.into(), attributes);
    result.into()
}

fn run_later(
    cx: &Cx,
    promise: Gc<JsPromise>,
    instance: Gc<WasmInstance>,
    result: fn(&Cx, Gc<WasmInstance>) -> Value,
) {
    let (kind, dependencies) = (WorkKind::ImminentlyScheduled, [promise.cell()]);
    let ticket = cx.add_pending_work(kind, instance.upcast(), &dependencies);
    ticket.schedule(move |cx, ticket| {
        let (Some(instance), Some(promise)) = (ticket.target(cx), ticket.dependency(cx, 0)) else {
            return Ok(());
        };
        let (instance, promise) = (instance.cast(), Gc::<JsCell>::cast::<JsPromise>(promise));
        match instance::run(cx, instance) {
            Ok(()) => {
                let result = result(cx, instance);
                promise.resolve(cx, result)
            }
            Err(thrown) => promise.reject_with_caught(cx, thrown),
        }
    });
}

pub(crate) fn settle_later(
    cx: &Cx,
    promise: Gc<JsPromise>,
    bytes: Vec<u8>,
    options: CompileOptions,
    goal: Goal,
) {
    let pending = Pending::new(cx, WorkKind::ImminentlyScheduled, promise, options, goal);
    let Some(engine) = engine() else {
        return pending.complete(Err(CompileError::OutOfMemory));
    };
    let ticket = pending.ticket.clone();
    let is_wanted = move || ticket.is_active();
    engine.compile_in_background(bytes, is_wanted, |it| pending.complete(it));
}

/// Operations that return a promise reject it instead of throwing.
pub(crate) fn promise_for(cx: &Cx, promise: Result<Gc<JsPromise>, Thrown>) -> JsResult<Value> {
    let promise = promise.or_else(|thrown| JsPromise::rejected_with_caught(cx, thrown));
    promise.map(Into::into)
}

#[native_abi]
pub(crate) fn compile(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let promise = start_to_compile(cx, frame);
    promise_for(cx, promise)
}

fn start_to_compile(cx: &mut Cx, frame: &CallFrame) -> JsResult<Gc<JsPromise>> {
    module::check_is_enabled(cx)?;
    let bytes = source::copy_bytes(cx, frame.argument(0))?;
    let options = optional_object(cx, frame.argument(1), "second", "compile")?;
    let options = CompileOptions::read(cx, options)?;
    let promise = JsPromise::new(cx);
    settle_later(cx, promise, bytes, options, Goal::Module);
    Ok(promise)
}

#[native_abi]
pub(crate) fn instantiate(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let promise = start_to_instantiate(cx, frame);
    promise_for(cx, promise)
}

fn start_to_instantiate(cx: &mut Cx, frame: &CallFrame) -> JsResult<Gc<JsPromise>> {
    module::check_is_enabled(cx)?;
    let imports = optional_object(cx, frame.argument(1), "second", "instantiate")?;
    let options = optional_object(cx, frame.argument(2), "third", "instantiate")?;
    if let Some(module) = frame.argument(0).downcast::<WasmModule>() {
        let instance = link(cx, module, imports)?;
        let promise = JsPromise::new(cx);
        run_later(cx, promise, instance, |_, instance| instance.into());
        return Ok(promise);
    }
    let options = CompileOptions::read(cx, options)?;
    let bytes = source::copy_bytes(cx, frame.argument(0))?;
    let goal = Goal::ModuleAndInstance {
        imports,
        runs_later: false,
    };
    let promise = JsPromise::new(cx);
    settle_later(cx, promise, bytes, options, goal);
    Ok(promise)
}

#[native_abi]
pub(crate) fn validate(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let bytes = source::copy_bytes(cx, frame.argument(0))?;
    let options = optional_object(cx, frame.argument(1), "second", "validate")?;
    let outcome = match module::compile_now(bytes) {
        Ok(module) => CompileOptions::read(cx, options)?.apply_to(&module),
        Err(error) => Err(error),
    };
    match outcome {
        Ok(()) => Ok(Value::TRUE),
        Err(CompileError::Invalid(_)) => Ok(Value::FALSE),
        Err(CompileError::OutOfMemory) => Err(cx.throw_out_of_memory()),
    }
}
