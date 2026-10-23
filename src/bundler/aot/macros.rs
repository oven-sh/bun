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

#[cfg(test)]
mod tests {
    use super::super::data_values::ValueSink;
    use super::*;
    use bun_sema::session::Session;

    type RunOrder = Arc<Guarded<Vec<Vec<u8>>>>;

    fn work_with_contents(contents: Vec<u8>) -> PortableCall {
        PortableCall {
            importer: Vec::new(),
            macro_path: Vec::new(),
            export_name: contents,
            arguments: Vec::new(),
        }
    }

    fn contents_of(call: &PortableCall) -> &[u8] {
        &call.export_name
    }

    fn echo_contents(call: &PortableCall, run_order: &RunOrder) -> Outcome {
        let contents = contents_of(call);
        run_order.lock().push(contents.to_vec());
        let mut answer = PortableValue::default();
        answer.string(contents);
        Outcome {
            log: Log::init(),
            answer: Ok(answer),
        }
    }

    fn string_of(answer: &PortableValue) -> Vec<u8> {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let mut builder = DataValueBuilder::new(session.arena(), &atoms);
        answer.replay(&mut builder);
        let DataValue::String(text) = builder.finish() else {
            panic!("the job answers with a string");
        };
        atoms.bytes(*text).to_vec()
    }

    fn wait_for_queued_jobs(shared: &Shared, job_count: usize) -> Vec<Vec<u8>> {
        loop {
            let queue = shared.queue.lock();
            if queue.jobs.len() >= job_count {
                return queue
                    .jobs
                    .iter()
                    .map(|job| contents_of(&job.call).to_vec())
                    .collect();
            }
            drop(queue);
            std::thread::yield_now();
        }
    }

    fn run_jobs_holding_first(
        shared: &Shared,
        queued_job_count: usize,
        queue_order: &RunOrder,
        run_order: &RunOrder,
    ) {
        let mut is_first_job = true;
        run_jobs(shared, |call| {
            if std::mem::take(&mut is_first_job) {
                *queue_order.lock() = wait_for_queued_jobs(shared, queued_job_count);
            }
            echo_contents(call, run_order)
        });
    }

    fn submit_echo(macros: &MacroThread, run_order: &RunOrder, contents: Vec<u8>) -> Vec<u8> {
        let run_order = Arc::clone(run_order);
        let mut log = Log::init();
        let answer = macros.submit_with(work_with_contents(contents), &mut log, move |shared| {
            run_jobs(&shared, |call| echo_contents(call, &run_order));
        });
        assert!(log.msgs.is_empty());
        match answer {
            Ok(answer) => string_of(&answer),
            Err(Failed) => panic!("the job answers with a string"),
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn each_job_gets_own_answer() {
        const JOB_COUNT: u8 = 100;
        const THREAD_COUNT: u8 = 8;
        let macros = MacroThread::new();
        let run_order = RunOrder::default();
        std::thread::scope(|scope| {
            for first in 0..THREAD_COUNT {
                let (macros, run_order) = (&macros, &run_order);
                scope.spawn(move || {
                    for number in (first..JOB_COUNT).step_by(usize::from(THREAD_COUNT)) {
                        assert_eq!(submit_echo(macros, run_order, vec![number]), [number]);
                    }
                });
            }
        });
        macros.shut_down();
        assert_eq!(run_order.lock().len(), usize::from(JOB_COUNT));
    }

    #[test]
    fn jobs_run_in_queue_order() {
        const CALLER_COUNT: u8 = 8;
        const QUEUED_JOB_COUNT: usize = CALLER_COUNT as usize - 1;
        let macros = MacroThread::new();
        let run_order = RunOrder::default();
        let queue_order = RunOrder::default();
        std::thread::scope(|scope| {
            for caller in 0..CALLER_COUNT {
                let macros = &macros;
                let (run_order, queue_order) = (Arc::clone(&run_order), Arc::clone(&queue_order));
                scope.spawn(move || {
                    let call = work_with_contents(vec![caller]);
                    let answer = macros.submit_with(call, &mut Log::init(), move |shared| {
                        run_jobs_holding_first(&shared, QUEUED_JOB_COUNT, &queue_order, &run_order);
                    });
                    assert!(answer.is_ok());
                });
            }
        });
        macros.shut_down();
        assert_eq!(run_order.lock()[1..], queue_order.lock()[..]);
    }

    #[test]
    fn shut_down_without_jobs_starts_no_thread() {
        let macros = MacroThread::new();
        assert!(macros.handle.lock().is_none());
        macros.shut_down();
    }
}
