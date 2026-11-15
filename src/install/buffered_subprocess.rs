//! A child process whose output is collected on the install thread's event loop.

use core::cell::Cell;

use bun_event_loop::EventLoopHandle;
#[cfg(unix)]
use bun_io::PosixFlags;
use bun_io::max_buf::Kind;
use bun_io::{BufferedReader, IoEvent, Owner, PollTag, ReadResult};
use bun_ptr::{AliasableBox, CellExt as _};
#[cfg(unix)]
use bun_spawn::SpawnResultExt as _;
use bun_spawn::{ProcessHandle, Rusage, SpawnProcessResult, Status};

/// Has no callbacks: the owner calls `finished_status` after each tick of the event loop.
pub(crate) struct BufferedSubprocess {
    process: ProcessHandle,
    readers: AliasableBox<OutputReaders>,
}

/// The `Owner` of both readers.
pub struct OutputReaders {
    event_loop: EventLoopHandle,
    remaining_fds: Cell<u8>,
    read_errors: Cell<Vec<bun_sys::Error>>,
    stdout: BufferedReader,
    stderr: BufferedReader,
}

impl OutputReaders {
    pub fn on_io(&self, kind: Kind, event: IoEvent) {
        let event_loop = self.event_loop.as_event_loop_ctx();
        self.note_read_result(self.reader(kind).read(event_loop, Some(event)));
    }

    fn reader(&self, kind: Kind) -> &BufferedReader {
        match kind {
            Kind::Stdout => &self.stdout,
            Kind::Stderr => &self.stderr,
        }
    }

    fn note_read_result(&self, result: ReadResult) {
        match result {
            ReadResult::Pending => return,
            ReadResult::Done => {}
            ReadResult::Err(err) => self.read_errors.with_taken(|errors| errors.push(err)),
        }
        self.remaining_fds.update(|fds| fds - 1);
    }
}

impl BufferedSubprocess {
    pub(crate) fn watch(
        mut spawned: SpawnProcessResult,
        event_loop: EventLoopHandle,
    ) -> bun_sys::Result<BufferedSubprocess> {
        let readers = AliasableBox::new(OutputReaders {
            event_loop,
            remaining_fds: Cell::new(0),
            read_errors: Cell::default(),
            stdout: BufferedReader::init(),
            stderr: BufferedReader::init(),
        });

        for (kind, stdio) in [
            (Kind::Stdout, spawned.stdout.take()),
            (Kind::Stderr, spawned.stderr.take()),
        ] {
            let reader = readers.reader(kind);
            let owner = Owner::with_kind(PollTag::InstallSubprocess, kind, readers.as_ptr().cast());
            // SAFETY: `owner` points to the heap allocation that holds this reader.
            unsafe { reader.set_owner(owner) };
            #[cfg(unix)]
            if let Some(fd) = stdio.map(bun_sys::File::into_raw) {
                if spawned.memfds[kind as usize + 1] {
                    reader.start_memfd(fd);
                    continue;
                }
                let _ = bun_sys::set_nonblocking(fd);
                readers.remaining_fds.update(|fds| fds + 1);
                reader.update_flags(|f| f.insert(PosixFlags::NONBLOCKING | PosixFlags::SOCKET));
                readers.note_read_result(reader.start(event_loop.as_event_loop_ctx(), fd, true)?);
            }
            #[cfg(windows)]
            if let bun_spawn::SpawnedStdio::Buffer(pipe) = stdio {
                readers.remaining_fds.update(|fds| fds + 1);
                reader.start_with_pipe(pipe)?;
            }
        }

        let process = spawned.to_process_handle(event_loop);
        if let Err(err) = process.watch_or_reap()
            && !process.has_exited()
        {
            process.on_exit(Status::Err(err), &bun_core::ffi::zeroed::<Rusage>());
        }
        let child = BufferedSubprocess { process, readers };
        if child.finished_status().is_some() {
            // No event is left that would end the next tick.
            event_loop.loop_().wakeup();
        }
        Ok(child)
    }

    /// `Some` once the process has exited and both readers are done.
    pub(crate) fn finished_status(&self) -> Option<&Status> {
        self.process
            .status()
            .filter(|_| self.readers.remaining_fds.get() == 0)
    }

    pub(crate) fn take_read_errors(&self) -> Vec<bun_sys::Error> {
        self.readers.read_errors.take()
    }

    /// `[stdout, stderr]`
    pub(crate) fn into_output(self) -> [Vec<u8>; 2] {
        [&self.readers.stdout, &self.readers.stderr].map(BufferedReader::take_final_buffer)
    }
}
