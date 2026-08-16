//! Non-blocking I/O for the credential chains. A chain is an `async fn`
//! handed an [`Io`]; each `io.http(..).await` / `io.spawn(..).await` parks
//! the chain, the request runs on Bun's HTTP thread (or a helper thread, for
//! a `credential_process`), and [`drive`] resumes the chain on the JS thread
//! when the result is back. Nothing here blocks any thread on the network.

use core::cell::RefCell;
use core::future::Future;
use core::pin::Pin;
use core::task::{Context, Poll, Waker};
use std::rc::Rc;
use std::sync::Arc;

use bun_jsc::JsResult;
use bun_jsc::job::{Completion, Job, JobContext, JsCallback, JsThread};
use bun_jsc::virtual_machine::VirtualMachine;

use crate::webcore::s3::simple_request::execute_raw_request;
pub use crate::webcore::s3::simple_request::{
    RawRequest as HttpRequest, RawResponse as HttpResponse,
};

#[derive(Debug)]
pub enum HttpError {
    Transport(bun_http::Error),
    NoResponse,
    Shutdown,
}

impl HttpError {
    /// Cut short by a VM stop phase rather than answered by the endpoint.
    pub fn is_interruption(&self) -> bool {
        matches!(
            self,
            HttpError::Shutdown
                | HttpError::Transport(
                    bun_http::Error::Aborted | bun_http::Error::AbortedBeforeConnecting
                )
        )
    }
}

impl core::fmt::Display for HttpError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            HttpError::Transport(bun_http::Error::Timeout) => f.write_str("request timed out"),
            HttpError::Transport(e) => f.write_str(e.name()),
            HttpError::NoResponse => f.write_str("connection closed without a response"),
            HttpError::Shutdown => f.write_str("the JavaScript VM is shutting down"),
        }
    }
}

pub struct SpawnRequest {
    pub argv: Vec<Box<[u8]>>,
    pub windows_verbatim_arguments: bool,
}

pub type SpawnResult = Result<bun_spawn::RunResult, SpawnError>;

pub enum SpawnError {
    /// The VM's stop phase gave up waiting for the helper.
    Interrupted,
    Failed(Box<[u8]>),
}

impl core::fmt::Display for SpawnError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            SpawnError::Interrupted => f.write_str("the JavaScript VM is shutting down"),
            SpawnError::Failed(m) => write!(f, "{}", bstr::BStr::new(m)),
        }
    }
}

type BlockingWork = Box<dyn FnOnce() -> Box<dyn core::any::Any + Send> + Send>;

enum Op {
    Http(HttpRequest),
    Spawn(SpawnRequest),
    Blocking(BlockingWork),
}

enum OpResult {
    Http(Result<HttpResponse, HttpError>),
    Spawn(SpawnResult),
    Blocking(Option<Box<dyn core::any::Any + Send>>),
}

#[derive(Default)]
struct Slot {
    op: Option<Op>,
    result: Option<OpResult>,
    /// An operation was cut short by a VM stop phase (teardown, test isolation).
    interrupted: bool,
}

/// The chain's handle for I/O. Cheap to clone; JS thread only. Its
/// operations never keep the process alive by themselves — whoever waits on
/// the chain does that (see `flight`), so a background refresh nobody is
/// waiting for cannot hold up exit.
#[derive(Clone, Default)]
pub struct Io(Rc<RefCell<Slot>>);

/// One queued operation, as a future: the first poll hands the operation to
/// the driver, the next one (after the driver stored the result) yields it.
struct Pending<'a> {
    io: &'a Io,
    op: Option<Op>,
}

impl Future for Pending<'_> {
    type Output = OpResult;
    fn poll(mut self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<OpResult> {
        let mut slot = self.io.0.borrow_mut();
        if let Some(op) = self.op.take() {
            debug_assert!(slot.op.is_none() && slot.result.is_none());
            slot.op = Some(op);
            return Poll::Pending;
        }
        match slot.result.take() {
            Some(r) => Poll::Ready(r),
            None => Poll::Pending,
        }
    }
}

impl Io {
    pub async fn http(&self, request: HttpRequest) -> Result<HttpResponse, HttpError> {
        match (Pending {
            io: self,
            op: Some(Op::Http(request)),
        })
        .await
        {
            OpResult::Http(r) => r,
            _ => unreachable!(),
        }
    }

    /// Run CPU-heavy or disk-touching `work` on the work pool. `None` if the
    /// VM went away before it ran.
    pub async fn blocking<R: Send + 'static>(
        &self,
        work: impl FnOnce() -> R + Send + 'static,
    ) -> Option<R> {
        let work: BlockingWork = Box::new(move || Box::new(work()));
        match (Pending {
            io: self,
            op: Some(Op::Blocking(work)),
        })
        .await
        {
            OpResult::Blocking(r) => r.map(|b| *b.downcast::<R>().expect("same R")),
            _ => unreachable!(),
        }
    }

    pub async fn spawn(&self, request: SpawnRequest) -> SpawnResult {
        match (Pending {
            io: self,
            op: Some(Op::Spawn(request)),
        })
        .await
        {
            OpResult::Spawn(r) => r,
            _ => unreachable!(),
        }
    }

    fn take_op(&self) -> Option<Op> {
        self.0.borrow_mut().op.take()
    }

    fn set_result(&self, result: OpResult) {
        let mut slot = self.0.borrow_mut();
        slot.interrupted |= match &result {
            OpResult::Http(Err(e)) => e.is_interruption(),
            OpResult::Spawn(Err(SpawnError::Interrupted)) => true,
            OpResult::Blocking(None) => true,
            _ => false,
        };
        slot.result = Some(result);
    }

    /// Whether any operation so far was aborted from outside rather than
    /// answered — the chain's conclusion is then not worth caching.
    pub fn interrupted(&self) -> bool {
        self.0.borrow().interrupted
    }
}

pub type ChainFuture<T> = Pin<Box<dyn Future<Output = T>>>;
pub type Done<T> = Box<dyn FnOnce(T) -> JsResult<()>>;

struct Task<T: 'static> {
    io: Io,
    future: ChainFuture<T>,
    done: Done<T>,
}

/// Run `future` (which does its I/O through `io`) to completion on this JS
/// thread, then call `done`. Returns after the first suspension; if the
/// chain needs no I/O at all, `done` has already run by then.
pub fn drive<T: 'static>(io: Io, future: ChainFuture<T>, done: Done<T>) -> JsResult<()> {
    Box::new(Task { io, future, done }).step()
}

impl<T: 'static> Task<T> {
    fn step(mut self: Box<Self>) -> JsResult<()> {
        let mut cx = Context::from_waker(Waker::noop());
        match self.future.as_mut().poll(&mut cx) {
            Poll::Ready(value) => (self.done)(value),
            Poll::Pending => match self.io.take_op() {
                Some(Op::Http(request)) => self.start_http(request),
                Some(Op::Spawn(request)) => self.start_spawn(request),
                Some(Op::Blocking(work)) => self.start_blocking(work),
                None => unreachable!("credential chain suspended without queuing I/O"),
            },
        }
    }

    fn resume(self: Box<Self>, result: OpResult) -> JsResult<()> {
        self.io.set_result(result);
        self.step()
    }

    fn start_http(self: Box<Self>, mut request: HttpRequest) -> JsResult<()> {
        if !VirtualMachine::get().script_allowed() {
            return self.resume(OpResult::Http(Err(HttpError::Shutdown)));
        }
        request.holds_event_loop = false;
        execute_raw_request(
            request,
            Box::new(move |result| {
                let result = result.map_err(|e| match e {
                    Some(e) => HttpError::Transport(e),
                    None => HttpError::NoResponse,
                });
                self.resume(OpResult::Http(result))
            }),
        );
        Ok(())
    }

    fn start_spawn(self: Box<Self>, request: SpawnRequest) -> JsResult<()> {
        let global = VirtualMachine::get().global();
        if !global.bun_vm().script_allowed() {
            return self.resume(OpResult::Spawn(Err(SpawnError::Interrupted)));
        }
        Job::<SpawnJob>::schedule(
            &global.js_thread(),
            SpawnOff {
                request,
                env: super::env::Env::new(global).to_map(),
                shared: Arc::default(),
            },
            SpawnJs(Some(JsCallback(Box::new(move |result| {
                self.resume(OpResult::Spawn(result))
            })))),
        );
        Ok(())
    }

    fn start_blocking(self: Box<Self>, work: BlockingWork) -> JsResult<()> {
        let global = VirtualMachine::get().global();
        if !global.bun_vm().script_allowed() {
            return self.resume(OpResult::Blocking(None));
        }
        Job::<BlockingJob>::schedule(
            &global.js_thread(),
            BlockingOff {
                work: Some(work),
                result: None,
            },
            BlockingJs(Some(JsCallback(Box::new(move |result| {
                self.resume(OpResult::Blocking(result))
            })))),
        );
        Ok(())
    }
}

// ── pool work ─────────────────────────────────────────────────────────────

struct BlockingOff {
    work: Option<BlockingWork>,
    result: Option<Box<dyn core::any::Any + Send>>,
}

#[derive(bun_jsc::JsAffine)]
struct BlockingJs(Option<JsCallback<Option<Box<dyn core::any::Any + Send>>>>);

impl Drop for BlockingJs {
    fn drop(&mut self) {
        if let Some(JsCallback(resume)) = self.0.take() {
            let _ = resume(None);
        }
    }
}

struct BlockingJob;

impl JobContext for BlockingJob {
    type OffThread = BlockingOff;
    type Js = BlockingJs;

    const HOLDS_EVENT_LOOP: bool = false;

    fn run(off: &mut BlockingOff, done: Completion<Self>) -> Option<Completion<Self>> {
        off.result = off.work.take().map(|w| w());
        Some(done)
    }

    fn then(off: BlockingOff, mut js: BlockingJs, _cx: &JsThread<'_>) -> JsResult<()> {
        match js.0.take() {
            Some(JsCallback(resume)) => resume(off.result),
            None => Ok(()),
        }
    }
}

// ── credential_process, off the JS thread ─────────────────────────────────

struct SpawnOff {
    request: SpawnRequest,
    env: bun_sys::EnvMap,
    shared: Arc<SpawnShared>,
}

/// What the pool worker, the helper thread and the VM's stop phase share.
#[derive(Default)]
struct SpawnShared {
    /// The job's completion while the helper runs; whoever takes it —
    /// the helper thread when the child exits, or the stop phase — finishes
    /// the job.
    done: bun_threading::Guarded<Option<Completion<SpawnJob>>>,
    result: bun_threading::Guarded<Option<SpawnResult>>,
    cancelled: core::sync::atomic::AtomicBool,
}

#[derive(bun_jsc::JsAffine)]
struct SpawnJs(Option<JsCallback<SpawnResult>>);

impl Drop for SpawnJs {
    /// Still holding the callback only when the job is released unrun at
    /// teardown: the chain must hear back exactly once.
    fn drop(&mut self) {
        if let Some(JsCallback(resume)) = self.0.take() {
            let _ = resume(Err(SpawnError::Interrupted));
        }
    }
}

struct SpawnJob;

impl JobContext for SpawnJob {
    type OffThread = SpawnOff;
    type Js = SpawnJs;

    const CANCELLABLE: bool = true;

    const HOLDS_EVENT_LOOP: bool = false;

    /// A helper blocked on a prompt must not hold up VM teardown: hand the
    /// job back now; the helper thread finds `done` gone when the child
    /// eventually exits and just drops its output.
    fn canceller(off: &SpawnOff) -> Option<bun_jsc::job::Canceller> {
        let shared = Arc::clone(&off.shared);
        Some(Box::new(move || {
            shared
                .cancelled
                .store(true, core::sync::atomic::Ordering::Relaxed);
            if let Some(done) = shared.done.lock().take() {
                *shared.result.lock() = Some(Err(SpawnError::Interrupted));
                done.finish();
            }
        }))
    }

    fn run(off: &mut SpawnOff, done: Completion<Self>) -> Option<Completion<Self>> {
        let shared = Arc::clone(&off.shared);
        if shared.cancelled.load(core::sync::atomic::Ordering::Relaxed) {
            *shared.result.lock() = Some(Err(SpawnError::Interrupted));
            return Some(done);
        }
        // A credential_process may take a while (or prompt and hang); wait
        // for it on a thread of its own rather than parking a pool worker.
        let argv = core::mem::take(&mut off.request.argv);
        let env = core::mem::take(&mut off.env);
        let verbatim = off.request.windows_verbatim_arguments;
        *shared.done.lock() = Some(done);
        if shared.cancelled.load(core::sync::atomic::Ordering::Relaxed) {
            // The stop phase may already have taken `done` and finished the job.
            let done = shared.done.lock().take()?;
            *shared.result.lock() = Some(Err(SpawnError::Interrupted));
            return Some(done);
        }
        let for_thread = Arc::clone(&shared);
        let spawned = std::thread::Builder::new()
            .name("credential_process".into())
            .spawn(move || {
                bun_core::output::Source::configure_thread();
                let shared = for_thread;
                let argv: Vec<&[u8]> = argv.iter().map(|a| &**a).collect();
                let result = bun_spawn::run(bun_spawn::RunOptions {
                    argv: &argv,
                    env_map: &env,
                    windows_verbatim_arguments: verbatim,
                })
                .map_err(|e| {
                    SpawnError::Failed(
                        format!("could not start \"{}\": {e}", bstr::BStr::new(argv[0]))
                            .into_bytes()
                            .into_boxed_slice(),
                    )
                });
                if let Some(done) = shared.done.lock().take() {
                    *shared.result.lock() = Some(result);
                    done.finish();
                }
            });
        match spawned {
            Ok(_) => None,
            Err(e) => {
                let done = shared.done.lock().take()?;
                *shared.result.lock() = Some(Err(SpawnError::Failed(
                    format!("could not start a thread: {e}")
                        .into_bytes()
                        .into_boxed_slice(),
                )));
                Some(done)
            }
        }
    }

    fn then(off: SpawnOff, mut js: SpawnJs, _cx: &JsThread<'_>) -> JsResult<()> {
        let result = off
            .shared
            .result
            .lock()
            .take()
            .unwrap_or(Err(SpawnError::Interrupted));
        match js.0.take() {
            Some(JsCallback(resume)) => resume(result),
            None => Ok(()),
        }
    }
}
