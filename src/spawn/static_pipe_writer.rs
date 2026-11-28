use core::cell::Cell;
use core::mem::size_of;
#[cfg(windows)]
use std::rc::Rc;

use bun_event_loop::EventLoopHandle;
use bun_io::{BufferedWriteHandler, BufferedWriter, IoEvent, Owner, WriteHandler, WriteStatus};
use bun_ptr::AliasableBox;
use bun_sys;

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
    state: AliasableBox<State<S>>,
}

/// An in-flight write keeps the source alive after the writer is dropped.
#[cfg(windows)]
struct SharedSource<S>(S);

#[cfg(windows)]
impl<S: Source> AsRef<[u8]> for SharedSource<S> {
    fn as_ref(&self) -> &[u8] {
        self.0.slice()
    }
}

struct State<S> {
    writer: BufferedWriter,
    /// Until `start` hands it to `writer`.
    file: Cell<StdioResult>,
    #[cfg(not(windows))]
    source: S,
    #[cfg(windows)]
    source: Rc<SharedSource<S>>,
    written: Cell<usize>,
}

/// After `Closed` there is nothing left to do but to drop the writer.
#[must_use]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum PipeState {
    Open,
    Closed,
}

impl<S: Source> StaticPipeWriter<S> {
    /// `owner` is handed the events, to pass on to [`Self::on_io`].
    ///
    /// # Safety
    /// `owner.ptr` points to a live value of the type `__bun_run_io` casts `owner.tag` to, until the
    /// writer is dropped.
    pub unsafe fn create(owner: Owner, result: StdioResult, source: S) -> Self {
        let state = AliasableBox::new(State {
            writer: BufferedWriter::default(),
            file: Cell::new(result),
            #[cfg(not(windows))]
            source,
            #[cfg(windows)]
            source: Rc::new(SharedSource(source)),
            written: Cell::new(0),
        });
        // SAFETY: fn contract, and the box gives out shared borrows only.
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
        #[cfg(windows)]
        {
            let writer = &state.writer;
            let source = Rc::<SharedSource<S>>::clone(&state.source);
            writer.set_pipe(bun_io::Pipe::new_exclusive(event_loop.loop_().port(), file));
            writer.write_shared(state, source);
        }
        #[cfg(not(windows))]
        {
            state
                .writer
                .start(state, event_loop.as_event_loop_ctx(), file.into(), true)?;
            state.writer.set_poll_flag(bun_io::FilePollFlag::Socket);
        }
        Ok(self.pipe_state())
    }

    pub fn on_io(&self, event: IoEvent) -> PipeState {
        let state: &State<S> = &self.state;
        state.writer.on_io(state, event);
        self.pipe_state()
    }

    pub fn watch(&self) -> PipeState {
        #[cfg(not(windows))]
        if !self.state.remaining().is_empty() {
            self.state.writer.register_poll(&*self.state);
        }
        self.pipe_state()
    }

    pub fn update_ref(&self, add: bool) {
        self.state.writer.update_ref(add);
    }

    pub fn memory_cost(&self) -> usize {
        size_of::<State<S>>() + self.state.source().memory_cost() + self.state.writer.memory_cost()
    }
}

impl<S: Source> State<S> {
    fn source(&self) -> &S {
        #[cfg(windows)]
        return &self.source.0;
        #[cfg(not(windows))]
        return &self.source;
    }

    fn remaining(&self) -> &[u8] {
        let source = self.source().slice();
        source.get(self.written.get()..).unwrap_or_default()
    }
}

impl<S: Source> BufferedWriteHandler for State<S> {
    fn with_buffer<R>(&self, f: impl FnOnce(&[u8]) -> R) -> R {
        f(self.remaining())
    }
}

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
