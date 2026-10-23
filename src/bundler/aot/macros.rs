use super::data_values::{
    DataValueBuilder, ExprBuilder, PortableValue, report_not_data, write_data_value, write_expr,
};
use super::services::BuildContext;
use crate::Transpiler;
use bun_alloc::{Arena, AstAlloc};
use bun_aot::load::source_provider::{Failed, MacroCall};
use bun_ast::{E, Expr, ExprData, ExprNodeList, Loc, Log, Range, Source};
use bun_core::{Output, zstr};
use bun_js_parser as js_parser;
use bun_sema::atom::Interner;
use bun_sema::hir_from_data::DataValue;
use bun_threading::thread_pool::POOL_THREAD_STACK_SIZE;
use bun_threading::{Condvar, Guarded};
use std::collections::VecDeque;
use std::sync::Arc;
use std::thread::JoinHandle;

pub(crate) struct MacroThread {
    shared: Arc<Shared>,
    handle: Guarded<Option<JoinHandle<()>>>,
}

impl MacroThread {
    pub(crate) fn new() -> MacroThread {
        MacroThread {
            shared: Arc::default(),
            handle: Guarded::new(None),
        }
    }

    pub(crate) fn run_macro<'s>(
        &self,
        context: &BuildContext,
        call: &MacroCall<'_, 's>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<&'s DataValue<'s>, Failed> {
        let arguments = call
            .arguments
            .iter()
            .map(|argument| {
                let mut portable = PortableValue::default();
                write_data_value(argument, atoms, &mut portable);
                portable
            })
            .collect();
        let call = PortableCall {
            importer: call.importer.to_vec(),
            macro_path: call.macro_path.to_vec(),
            export_name: call.export_name.to_vec(),
            arguments,
        };
        let portable = self.submit(context, call, log)?;
        let mut builder = DataValueBuilder::new(arena, atoms);
        portable.replay(&mut builder);
        Ok(builder.finish())
    }

    pub(crate) fn shut_down(mut self) {
        self.shared.close();
        if let Some(thread) = self.handle.get_mut().take() {
            let _ = thread.join();
        }
    }

    fn submit(
        &self,
        context: &BuildContext,
        call: PortableCall,
        log: &mut Log,
    ) -> Result<PortableValue, Failed> {
        let context = context.clone();
        self.submit_with(call, log, move |shared| thread_main(shared, context))
    }

    fn submit_with(
        &self,
        call: PortableCall,
        log: &mut Log,
        thread_body: impl FnOnce(Arc<Shared>) + Send + 'static,
    ) -> Result<PortableValue, Failed> {
        self.ensure_thread(thread_body, log)?;
        let job = Arc::new(Job {
            call,
            outcome: Guarded::new(None),
            is_done: Condvar::new(),
        });
        self.shared.push(Arc::clone(&job));
        let mut outcome = job.wait();
        outcome.log.append_to_with_recycled(log, true);
        outcome.answer
    }

    fn ensure_thread(
        &self,
        thread_body: impl FnOnce(Arc<Shared>) + Send + 'static,
        log: &mut Log,
    ) -> Result<(), Failed> {
        let mut handle = self.handle.lock();
        if handle.is_some() {
            return Ok(());
        }
        let shared = Arc::clone(&self.shared);
        let spawned = std::thread::Builder::new()
            .name("bun macros".into())
            .stack_size(POOL_THREAD_STACK_SIZE as usize)
            .spawn(move || thread_body(shared));
        match spawned {
            Ok(thread) => {
                *handle = Some(thread);
                Ok(())
            }
            Err(error) => {
                log.add_error_fmt(
                    None,
                    Loc::EMPTY,
                    format_args!("failed to start the macro thread: {error}"),
                );
                Err(Failed)
            }
        }
    }
}

#[derive(Default)]
struct Shared {
    queue: Guarded<Queue>,
    has_work: Condvar,
}

#[derive(Default)]
struct Queue {
    jobs: VecDeque<Arc<Job>>,
    is_closed: bool,
}

struct Job {
    call: PortableCall,
    outcome: Guarded<Option<Outcome>>,
    is_done: Condvar,
}

struct PortableCall {
    importer: Vec<u8>,
    macro_path: Vec<u8>,
    export_name: Vec<u8>,
    arguments: Vec<PortableValue>,
}

struct Outcome {
    log: Log,
    answer: Result<PortableValue, Failed>,
}

impl Shared {
    fn push(&self, job: Arc<Job>) {
        let mut queue = self.queue.lock();
        debug_assert!(!queue.is_closed);
        queue.jobs.push_back(job);
        self.has_work.signal();
    }

    fn next_job(&self) -> Option<Arc<Job>> {
        let mut queue = self.queue.lock();
        loop {
            if let Some(job) = queue.jobs.pop_front() {
                return Some(job);
            }
            if queue.is_closed {
                return None;
            }
            self.has_work.wait_guarded(&mut queue);
        }
    }

    fn close(&self) {
        let mut queue = self.queue.lock();
        queue.is_closed = true;
        self.has_work.broadcast();
    }
}

impl Job {
    fn wait(&self) -> Outcome {
        let mut stored = self.outcome.lock();
        loop {
            if let Some(outcome) = stored.take() {
                return outcome;
            }
            self.is_done.wait_guarded(&mut stored);
        }
    }

    fn finish(&self, outcome: Outcome) {
        let mut stored = self.outcome.lock();
        debug_assert!(stored.is_none());
        *stored = Some(outcome);
        self.is_done.broadcast();
    }
}

fn run_jobs(shared: &Shared, mut run_job: impl FnMut(&PortableCall) -> Outcome) {
    while let Some(job) = shared.next_job() {
        job.finish(run_job(&job.call));
    }
}

#[allow(clippy::needless_pass_by_value)] // the thread's own
fn thread_main(shared: Arc<Shared>, context: BuildContext) {
    Output::Source::configure_named_thread(zstr!("bun macros"));
    // The virtual machine keeps the log pointer of its first call, so every job uses one log.
    let mut log = Log::init();
    run_jobs(&shared, |call| {
        let answer =
            context.with_worker(|transpiler, arena| call_macro(transpiler, arena, call, &mut log));
        let mut owned = Log::init();
        log.append_to_with_recycled(&mut owned, true);
        log.reset();
        Outcome { log: owned, answer }
    });
    context.with_worker(|transpiler, _| {
        if let Some(macros) = transpiler.macro_context.take() {
            macros.deinit();
        }
    });
    js_parser::Macro::collect_vm_garbage();
}

fn call_macro(
    transpiler: &mut Transpiler<'static>,
    arena: &Arena,
    call: &PortableCall,
    log: &mut Log,
) -> Result<PortableValue, Failed> {
    let mut args: ExprNodeList = AstAlloc::vec();
    args.extend(call.arguments.iter().map(|argument| {
        let mut builder = ExprBuilder::new(arena);
        argument.replay(&mut builder);
        builder.finish()
    }));
    let caller = Expr::init(
        E::Call {
            target: Expr::init(E::Undefined {}, Loc::EMPTY),
            args,
            ..Default::default()
        },
        Loc::EMPTY,
    );
    let source = Source::init_path_string(call.importer.as_slice(), b"");
    let errors_before = log.errors;
    let result = transpiler
        .macro_context
        .as_mut()
        .expect("Worker::create wires it")
        .call(
            &call.macro_path,
            source.path.source_dir(),
            log,
            &source,
            Range::NONE,
            caller,
            &call.export_name,
        );
    let value = match result {
        Ok(value) if !matches!(value.data, ExprData::ECall(_)) => value,
        Ok(_) | Err(_) => {
            if log.errors == errors_before {
                log.add_error(Some(&source), Loc::EMPTY, b"macro threw exception");
            }
            return Err(Failed);
        }
    };
    let mut portable = PortableValue::default();
    match write_expr(&value, arena, &mut portable) {
        Ok(()) => Ok(portable),
        Err(error) => {
            report_not_data(log, &call.macro_path, "the macro result", error);
            Err(Failed)
        }
    }
}
