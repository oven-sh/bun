use core::cell::Cell;
use core::mem::size_of;

use bun_event_loop::EventLoopHandle;
#[cfg(windows)]
use bun_io::OwnedPipe;
#[cfg(not(windows))]
use bun_io::{BufferedWriteHandler, BufferedWriter, WriteHandler, WriteStatus};
use bun_io::{IoEvent, Owner};
#[cfg(not(windows))]
use bun_ptr::AliasableBox;
#[cfg(windows)]
use bun_ptr::{CellExt as _, OptionCellExt as _};
use bun_sys;
#[cfg(windows)]
use bun_sys::windows::libuv::WriteRequest;

use crate::subprocess::StdioResult;

bun_output::declare_scope!(StaticPipeWriter, hidden);

/// What a [`StaticPipeWriter`] writes to the child.
pub trait Source: 'static {
    fn slice(&self) -> &[u8];
    fn memory_cost(&self) -> usize;
}

impl Source for Box<[u8]> {
    fn slice(&self) -> &[u8] {
        self
    }
    fn memory_cost(&self) -> usize {
        self.len()
    }
}

/// Writes its source to a pipe and closes it. Dropping it closes the pipe now.
pub struct StaticPipeWriter<S: Source> {
    #[cfg(not(windows))]
    state: AliasableBox<State<S>>,
    #[cfg(windows)]
    pipe: Cell<Option<OwnedPipe>>,
    /// Until `start` hands it to libuv.
    #[cfg(windows)]
    req: Cell<Option<Box<WriteRequest<S>>>>,
    #[cfg(windows)]
    memory_cost: usize,
}

#[cfg(not(windows))]
struct State<S> {
    writer: BufferedWriter,
    /// Until `start` hands it to `writer`.
    file: Cell<StdioResult>,
    source: S,
    written: Cell<usize>,
}

/// After `Closed` there is nothing left to do but to drop the writer.
#[must_use]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum PipeState {
    Open,
    Closed,
}

#[cfg(not(windows))]
impl<S: Source> StaticPipeWriter<S> {
    /// `owner` is handed the events, to pass on to [`Self::on_io`].
    ///
    /// # Safety
    /// `owner.ptr` points to a live value of the type `__bun_run_io` casts `owner.tag` to, until the
    /// writer is dropped.
    pub unsafe fn create(owner: Owner, result: StdioResult, source: S) -> Self {
        let state = AliasableBox::new(State {
            writer: BufferedWriter::owning_fd(),
            file: Cell::new(result),
            source,
            written: Cell::new(0),
        });
        // SAFETY: fn contract.
        unsafe { state.writer.set_owner(owner) };
        Self { state }
    }

    fn pipe_state(&self) -> PipeState {
        if self.state.writer.is_closed() {
            PipeState::Closed
        } else {
            PipeState::Open
        }
    }

    pub fn start(&self, event_loop: EventLoopHandle) -> bun_sys::Result<PipeState> {
        let state: &State<S> = &self.state;
        bun_output::scoped_log!(StaticPipeWriter, "StaticPipeWriter({:p}) start()", state);
        let file = state.file.take().unwrap();
        state
            .writer
            .start(state, event_loop.as_event_loop_ctx(), file.fd(), true)?;
        // The writer closes it from now on.
        file.into_raw();
        state.writer.set_poll_flag(bun_io::FilePollFlag::Socket);
        Ok(self.pipe_state())
    }

    pub fn on_io(&self, event: IoEvent) -> PipeState {
        let state: &State<S> = &self.state;
        state.writer.on_io(state, event);
        self.pipe_state()
    }

    pub fn watch(&self) -> PipeState {
        if !self.state.remaining().is_empty() {
            self.state.writer.register_poll(&*self.state);
        }
        self.pipe_state()
    }

    pub fn update_ref(&self, add: bool) {
        self.state.writer.update_ref(add);
    }

    pub fn memory_cost(&self) -> usize {
        size_of::<State<S>>() + self.state.source.memory_cost() + self.state.writer.memory_cost()
    }
}

#[cfg(windows)]
impl<S: Source> StaticPipeWriter<S> {
    /// # Safety
    /// As on POSIX.
    pub unsafe fn create(owner: Owner, result: StdioResult, source: S) -> Self {
        let StdioResult::Buffer(pipe) = result else {
            unreachable!("StaticPipeWriter stdin requires WindowsStdioResult::Buffer");
        };
        // SAFETY: fn contract.
        unsafe { pipe.set_owner(owner) };
        Self {
            pipe: Cell::new(Some(pipe)),
            memory_cost: size_of::<WriteRequest<S>>() + source.memory_cost(),
            req: Cell::new(Some(WriteRequest::new(source))),
        }
    }

    pub fn start(&self, _: EventLoopHandle) -> bun_sys::Result<PipeState> {
        bun_output::scoped_log!(StaticPipeWriter, "StaticPipeWriter({:p}) start()", self);
        if let Some(req) = self.req.take()
            && !req.source.slice().is_empty()
        {
            self.pipe.with_taken(|pipe| {
                pipe.take_if(|pipe| pipe.queue_write(req, S::slice).is_err());
            });
        }
        Ok(self.watch())
    }

    /// The one write has ended, or the VM has.
    pub fn on_io(&self, _: IoEvent) -> PipeState {
        self.pipe.set(None);
        PipeState::Closed
    }

    pub fn watch(&self) -> PipeState {
        if self.pipe.is_some() {
            PipeState::Open
        } else {
            PipeState::Closed
        }
    }

    pub fn update_ref(&self, add: bool) {
        self.pipe.with_taken(|pipe| match pipe {
            Some(pipe) if add => pipe.ref_(),
            Some(pipe) => pipe.unref(),
            None => {}
        });
    }

    pub fn memory_cost(&self) -> usize {
        self.memory_cost
    }
}

#[cfg(not(windows))]
impl<S: Source> State<S> {
    fn remaining(&self) -> &[u8] {
        let source = self.source.slice();
        source.get(self.written.get()..).unwrap_or_default()
    }
}

#[cfg(not(windows))]
impl<S: Source> BufferedWriteHandler for State<S> {
    fn with_buffer<R>(&self, f: impl FnOnce(&[u8]) -> R) -> R {
        f(self.remaining())
    }
}

#[cfg(not(windows))]
impl<S: Source> WriteHandler for State<S> {
    fn on_write(&self, amount: usize, status: WriteStatus) {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter({:p}) onWrite(amount={} {})",
            self,
            amount,
            // Local stringify — `WriteStatus` (upstream bun_io) has no `Debug` impl.
            match status {
                WriteStatus::EndOfFile => "end_of_file",
                WriteStatus::Drained => "drained",
                WriteStatus::Pending => "pending",
            }
        );
        self.written.update(|written| written + amount);
        // After `EndOfFile` the writer closes itself.
        if status != WriteStatus::EndOfFile && self.remaining().is_empty() {
            self.writer.close(self);
        }
    }

    fn on_error(&self, err: bun_sys::Error) {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter({:p}) onError(err={})",
            self,
            err
        );
    }

    fn on_close(&self) {
        bun_output::scoped_log!(StaticPipeWriter, "StaticPipeWriter({:p}) onClose()", self);
    }
}
