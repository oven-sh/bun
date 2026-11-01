//! A child process run to its end, as a future: how it exited and what it wrote.

use core::cell::Cell;
use core::ffi::CStr;
use core::future::Future;
use core::pin::Pin;
use core::ptr::NonNull;
use core::task::{Context, Poll};

use bun_async::Slot;
use bun_event_loop::EventLoopHandle;
use bun_io::BufferedReader;
use bun_ptr::JsCell;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;

#[cfg(unix)]
use crate::SpawnResultExt as _;
use crate::{ProcessHandle, SpawnEnv, SpawnOptions, Status, Stdio};

/// Resolves once the child has exited and the pipes that collect its output have reached EOF.
/// Dropping it lets go of the child without killing it.
#[must_use = "futures do nothing unless awaited"]
pub struct Capture(NonNull<Inner>);

/// Which of the child's streams to collect. `SpawnOptions` says what becomes of the others.
#[derive(Clone, Copy)]
pub struct Streams {
    pub stdout: bool,
    pub stderr: bool,
}

pub struct Captured {
    pub status: Status,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    /// The first error of either pipe. What was read before it is kept.
    pub read_error: Option<bun_sys::Error>,
}

impl Captured {
    pub fn succeeded(&self) -> bool {
        matches!(&self.status, Status::Exited(exit) if exit.code == 0) && self.read_error.is_none()
    }
}

pub enum CaptureError {
    Spawn(crate::Error),
    SpawnSys(bun_sys::Error),
    StartReading(bun_sys::Error),
}

/// On the heap because the readers are registered with the loop by address.
struct Inner {
    process: JsCell<Option<ProcessHandle>>,
    stdout: JsCell<BufferedReader>,
    stderr: JsCell<BufferedReader>,
    pipes: Pipes,
}

/// The readers' parent. Its callbacks record what happened and wake the task: nothing is freed,
/// spawned or settled beneath them.
struct Pipes {
    event_loop: EventLoopHandle,
    open: Cell<u8>,
    read_error: JsCell<Option<bun_sys::Error>>,
    all_closed: Slot<()>,
}

impl Pipes {
    fn on_closed(&self, error: Option<bun_sys::Error>) {
        debug_assert!(self.open.get() > 0);
        self.open.set(self.open.get() - 1);
        if let Some(error) = error {
            self.read_error.with_mut(|first| {
                first.get_or_insert(error);
            });
        }
        if self.open.get() == 0 {
            self.all_closed.fill(());
        }
    }
}

bun_io::impl_buffered_reader_parent! {
    Capture for Pipes;
    has_on_read_chunk = false;
    on_reader_done  = |this| (*this).on_closed(None);
    on_reader_error = |this, err| (*this).on_closed(Some(err));
    loop_           = |this| (*this).event_loop.native_loop();
    event_loop      = |this| (*this).event_loop.as_event_loop_ctx();
}

fn collected() -> Stdio {
    #[cfg(unix)]
    return Stdio::Buffer;
    // The allocation is the caller's until the spawn succeeds.
    #[cfg(windows)]
    return Stdio::Buffer(
        bun_core::heap::into_raw(Box::new(bun_core::ffi::zeroed::<uv::Pipe>()))
            as crate::windows::UvPipePtr,
    );
}

impl Capture {
    pub fn spawn(
        mut options: SpawnOptions,
        streams: Streams,
        argv: &[&CStr],
        env: SpawnEnv<'_>,
        event_loop: EventLoopHandle,
    ) -> Result<Capture, CaptureError> {
        if streams.stdout {
            options.stdout = collected();
        }
        if streams.stderr {
            options.stderr = collected();
        }
        #[cfg(windows)]
        {
            options.windows.loop_ = event_loop;
        }
        let spawned = match crate::spawn_process_cstr(&options, argv, env) {
            Ok(Ok(spawned)) => spawned,
            failed => {
                #[cfg(windows)]
                {
                    if streams.stdout {
                        options.stdout.deinit();
                    }
                    if streams.stderr {
                        options.stderr.deinit();
                    }
                }
                return Err(match failed {
                    Err(err) => CaptureError::Spawn(err),
                    Ok(Err(err)) => CaptureError::SpawnSys(err),
                    Ok(Ok(_)) => unreachable!(),
                });
            }
        };
        #[cfg(windows)]
        let mut spawned = spawned;

        let capture = Capture(bun_core::heap::into_raw_nn(Box::new(Inner {
            process: JsCell::new(None),
            stdout: JsCell::new(BufferedReader::init::<Pipes>()),
            stderr: JsCell::new(BufferedReader::init::<Pipes>()),
            pipes: Pipes {
                event_loop,
                open: Cell::new(0),
                read_error: JsCell::new(None),
                all_closed: Slot::new(),
            },
        })));
        let inner = capture.inner();
        // SAFETY: projects to a field of the live allocation.
        let parent: *mut core::ffi::c_void = unsafe { &raw mut (*capture.0.as_ptr()).pipes }.cast();

        // A reader that fails to start reports to `Pipes`, which is not the cell being borrowed.
        #[cfg(unix)]
        for (reader, fd, is_memfd) in [
            (&inner.stdout, spawned.stdout, spawned.memfds[1]),
            (&inner.stderr, spawned.stderr, spawned.memfds[2]),
        ] {
            let Some(fd) = fd else { continue };
            reader.with_mut(|reader| reader.set_parent(parent));
            if is_memfd {
                reader.with_mut(|reader| reader.start_memfd(fd));
                continue;
            }
            let _ = bun_sys::set_nonblocking(fd);
            inner.pipes.open.set(inner.pipes.open.get() + 1);
            reader
                .with_mut(|reader| {
                    use bun_io::PosixFlags;
                    reader
                        .flags
                        .insert(PosixFlags::NONBLOCKING | PosixFlags::SOCKET);
                    reader.start(fd, true)
                })
                .map_err(CaptureError::StartReading)?;
            reader.with_mut(|reader| {
                if let Some(poll) = reader.handle.get_poll() {
                    poll.set_flag(bun_io::FilePollFlag::Socket);
                }
            });
        }
        // Each pipe is taken before `spawned` drops, which would close it under its reader.
        #[cfg(windows)]
        for (reader, pipe) in [
            (&inner.stdout, spawned.stdout.take()),
            (&inner.stderr, spawned.stderr.take()),
        ] {
            let crate::SpawnedStdio::Buffer(pipe) = pipe else {
                continue;
            };
            reader.with_mut(|reader| {
                reader.set_source(bun_io::Source::Pipe(pipe));
                reader.set_parent(parent);
            });
            inner.pipes.open.set(inner.pipes.open.get() + 1);
            reader
                .with_mut(|reader| reader.start_with_current_pipe())
                .map_err(CaptureError::StartReading)?;
        }

        let process = spawned.to_process_handle(event_loop);
        process.watch();
        inner.process.set(Some(process));
        Ok(capture)
    }

    fn inner(&self) -> &Inner {
        // SAFETY: allocated by `spawn`, freed by `drop`.
        unsafe { self.0.as_ref() }
    }
}

impl Future for Capture {
    type Output = Captured;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Captured> {
        let inner = self.inner();
        let process = inner.process.get().as_ref();
        let status = core::task::ready!(process.expect("polled after it finished").poll_exit(cx));
        if inner.pipes.open.get() > 0 {
            core::task::ready!(inner.pipes.all_closed.poll_take(cx));
        }
        inner.process.set(None);
        let [stdout, stderr] = [&inner.stdout, &inner.stderr]
            .map(|reader| reader.with_mut(|reader| core::mem::take(reader.final_buffer())));
        Poll::Ready(Captured {
            status,
            stdout,
            stderr,
            read_error: inner.pipes.read_error.take(),
        })
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        // SAFETY: allocated by `spawn`. Dropping the handle stops watching the child and dropping a
        // reader closes it unreported, so nothing calls back into the `Inner` again.
        unsafe { bun_core::heap::destroy(self.0.as_ptr()) };
    }
}
