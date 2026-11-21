use core::cell::Cell;
#[cfg(windows)]
use core::mem::ManuallyDrop;
use core::mem::size_of;

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
    #[cfg(not(windows))]
    state: AliasableBox<State<S>>,
    /// A write in flight keeps it past the drop.
    #[cfg(windows)]
    state: ManuallyDrop<AliasableBox<State<S>>>,
}

struct State<S> {
    writer: BufferedWriter,
    /// Until `start` hands it to `writer`.
    #[cfg(not(windows))]
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

impl<S: Source> StaticPipeWriter<S> {
    /// `owner` is handed the events, to pass on to [`Self::on_io`].
    ///
    /// # Safety
    /// `owner.ptr` points to a live value of the type `__bun_run_io` casts `owner.tag` to, until the
    /// writer is dropped.
    pub unsafe fn create(owner: Owner, result: StdioResult, source: S) -> Self {
        let state = AliasableBox::new(State {
            writer: BufferedWriter::default(),
            #[cfg(not(windows))]
            file: Cell::new(result),
            source,
            written: Cell::new(0),
        });
        // SAFETY: fn contract, and the box gives out shared borrows only.
        unsafe { state.writer.set_owner(owner) };
        #[cfg(windows)]
        let state = {
            let StdioResult::Buffer(pipe) = result else {
                unreachable!("StaticPipeWriter stdin requires WindowsStdioResult::Buffer");
            };
            state.writer.set_pipe(pipe);
            ManuallyDrop::new(state)
        };
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
        #[cfg(windows)]
        {
            let _ = event_loop;
            // SAFETY: `source` is never borrowed mutably, and `Drop` leaves it to a write in flight.
            unsafe { state.writer.write_no_copy(state) };
        }
        #[cfg(not(windows))]
        {
            let file = state.file.take().unwrap();
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
        size_of::<State<S>>() + self.state.source.memory_cost() + self.state.writer.memory_cost()
    }
}

#[cfg(windows)]
impl<S: Source> Drop for StaticPipeWriter<S> {
    fn drop(&mut self) {
        /// # Safety
        /// `state` is the box of a writer that was dropped.
        unsafe fn free<S>(state: *mut ()) {
            // SAFETY: fn contract.
            unsafe { bun_core::heap::destroy(state.cast::<State<S>>()) };
        }
        let state = self.state.as_ptr().cast();
        // SAFETY: nothing else frees the box, or uses it from here on.
        unsafe {
            if !self.state.writer.close_and_detach(state, free::<S>) {
                free::<S>(state);
            }
        }
    }
}

impl<S: Source> State<S> {
    fn remaining(&self) -> &[u8] {
        let source = self.source.slice();
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

    /// `Drop` leaves the state to the write's callback.
    #[cfg(windows)]
    fn set_has_inflight_write(&self, _: bool) {}
}
