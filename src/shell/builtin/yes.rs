use core::ffi::{c_char, CStr};
use core::mem::offset_of;

use bun_jsc::{EventLoopHandle, EventLoopTask, SystemError};
use bun_shell::interpreter::{Builtin, BuiltinImpl};
use bun_shell::{AllocScope, ExitCode, Yield};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum State {
    Idle,
    WaitingWriteErr,
    WaitingIo,
    Err,
    Done,
}

pub struct Yes {
    pub state: State,
    pub expletive: &'static [u8],
    pub task: YesTask,
    // TODO(port): in Zig this is allocated via `alloc_scope.allocator()`; using Box<[u8]>
    // here assumes global mimalloc. Revisit if AllocScope must own the bytes.
    pub buffer: Box<[u8]>,
    pub buffer_used: usize,
    pub alloc_scope: AllocScope,
}

impl Yes {
    pub fn start(&mut self) -> Yield {
        let args = self.bltn().args_slice();

        // count
        let mut bufalloc: usize = 0;
        if args.is_empty() {
            bufalloc = 2; // "y\n"
        } else {
            // Sum all args + spaces between + newline
            for (i, arg) in args.iter().enumerate() {
                // SAFETY: args entries are NUL-terminated C strings produced by the shell parser
                let arg_slice = unsafe { CStr::from_ptr(*arg as *const c_char) }.to_bytes();
                bufalloc += arg_slice.len();
                if i < args.len() - 1 {
                    bufalloc += 1; // space
                }
            }
            bufalloc += 1; // newline
        }

        // Use at least BUFSIZ (8192) for better performance
        const BUFSIZ: usize = 8192;
        if bufalloc <= BUFSIZ / 2 {
            bufalloc = BUFSIZ;
        }

        self.buffer = vec![0u8; bufalloc].into_boxed_slice();

        // Fill buffer with one copy of the output
        self.buffer_used = 0;
        if args.is_empty() {
            self.buffer[0..1].copy_from_slice(b"y");
            self.buffer[1] = b'\n';
            self.buffer_used = 2;
        } else {
            for (i, arg) in args.iter().enumerate() {
                // SAFETY: args entries are NUL-terminated C strings produced by the shell parser
                let arg_slice = unsafe { CStr::from_ptr(*arg as *const c_char) }.to_bytes();
                let used = self.buffer_used;
                self.buffer[used..used + arg_slice.len()].copy_from_slice(arg_slice);
                self.buffer_used += arg_slice.len();
                if i < args.len() - 1 {
                    let used = self.buffer_used;
                    self.buffer[used] = b' ';
                    self.buffer_used += 1;
                }
            }
            let used = self.buffer_used;
            self.buffer[used] = b'\n';
            self.buffer_used += 1;
        }

        // Fill larger buffer by repeating the pattern
        let copysize = self.buffer_used;
        let mut copies = bufalloc / copysize;
        let mut filled = self.buffer_used;
        while copies > 1 {
            let remaining = bufalloc - filled;
            let to_copy = copysize.min(remaining);
            // PORT NOTE: reshaped for borrowck — Zig's @memcpy on disjoint subslices of the
            // same buffer becomes copy_within (src [0..to_copy] and dst [filled..] never overlap).
            self.buffer.copy_within(0..to_copy, filled);
            filled += to_copy;
            copies -= 1;
        }
        self.buffer_used = filled;

        if let Some(safeguard) = self.bltn().stdout.needs_io() {
            let evtloop = self.bltn().event_loop();
            self.task = YesTask {
                evtloop,
                concurrent_task: EventLoopTask::from_event_loop(evtloop),
            };
            self.state = State::WaitingIo;
            // TODO(port): borrowck — bltn() yields an intrusive &mut Builtin that overlaps
            // &self.buffer (and the `self` ctx arg). Phase B must reshape the API (e.g.
            // bltn() -> *mut Builtin, or move `buffer` off `Yes`). Do NOT paper over with
            // from_raw_parts — guide forbids raw pointers as a borrowck escape hatch.
            return self
                .bltn()
                .stdout
                .enqueue(self, &self.buffer[..self.buffer_used], safeguard);
        }

        let evtloop = self.bltn().event_loop();
        self.task = YesTask {
            evtloop,
            concurrent_task: EventLoopTask::from_event_loop(evtloop),
        };
        self.write_no_io()
    }

    /// We write 4 8kb chunks and then suspend execution to the task.
    /// This is to avoid blocking the main thread forever.
    fn write_no_io(&mut self) -> Yield {
        // PORT NOTE: reshaped for borrowck — buffer slice rebuilt each call instead of
        // borrowing self.buffer across the &mut self method call.
        if let Some(y) = self.write_once_no_io() {
            return y;
        }
        if let Some(y) = self.write_once_no_io() {
            return y;
        }
        if let Some(y) = self.write_once_no_io() {
            return y;
        }
        if let Some(y) = self.write_once_no_io() {
            return y;
        }
        self.task.enqueue();
        Yield::Suspended
    }

    fn write_once_no_io(&mut self) -> Option<Yield> {
        // PORT NOTE: Zig passed `buf: []const u8` separately, but every callsite passes
        // self.buffer[0..self.buffer_used], so derive it here.
        // TODO(port): borrowck — bltn() aliases &self.buffer; see start() for details.
        match self
            .bltn()
            .write_no_io(BuiltinFd::Stdout, &self.buffer[..self.buffer_used])
        {
            Ok(_) => {}
            Err(e) => {
                self.state = State::WaitingWriteErr;
                let errbuf = self
                    .bltn()
                    .fmt_error_arena(BuiltinKind::Yes, format_args!("{}\n", e.name()));
                return Some(self.write_failing_error(errbuf, 1));
            }
        }
        None
    }

    pub fn write_failing_error(&mut self, buf: &[u8], exit_code: ExitCode) -> Yield {
        if let Some(safeguard) = self.bltn().stderr.needs_io() {
            self.state = State::WaitingWriteErr;
            return self.bltn().stderr.enqueue(self, buf, safeguard);
        }

        let _ = self.bltn().write_no_io(BuiltinFd::Stderr, buf);
        self.bltn().done(exit_code)
    }

    pub fn on_io_writer_chunk(&mut self, _: usize, maybe_e: Option<SystemError>) -> Yield {
        if let Some(_e) = maybe_e {
            // Zig `defer e.deref()` → SystemError's Drop derefs at scope exit (after return).
            self.state = State::Err;
            return self.bltn().done(1);
        }
        if self.state == State::WaitingWriteErr {
            return self.bltn().done(1);
        }
        debug_assert!(self.bltn().stdout.needs_io().is_some());
        // TODO(port): borrowck — bltn() aliases &self.buffer; see start() for details.
        self.bltn().stdout.enqueue(
            self,
            &self.buffer[..self.buffer_used],
            OutputNeedsIo::OutputNeedsIo,
        )
    }

    #[inline]
    pub fn bltn(&mut self) -> &mut Builtin {
        // SAFETY: `self` is always the `yes` field of `Builtin::Impl`, which is always
        // the `impl_` field of `Builtin`. This mirrors the Zig double @fieldParentPtr.
        unsafe {
            let impl_ptr = (self as *mut Self as *mut u8)
                .sub(offset_of!(BuiltinImpl, yes))
                .cast::<BuiltinImpl>();
            &mut *(impl_ptr as *mut u8)
                .sub(offset_of!(Builtin, impl_))
                .cast::<Builtin>()
        }
    }
}

impl Drop for Yes {
    fn drop(&mut self) {
        // Zig freed `self.buffer` via alloc_scope.allocator(); Box<[u8]> drops automatically.
        self.alloc_scope.end_scope();
    }
}

/// This task is used when we write `yes` output to stdout and stdout does not
/// require IO. After writing a bit, we suspend execution to this task so we
/// don't just block the main thread forever.
pub struct YesTask {
    pub evtloop: EventLoopHandle,
    pub concurrent_task: EventLoopTask,
}

impl YesTask {
    pub fn enqueue(&mut self) {
        // TODO(port): EventLoopHandle/EventLoopTask are tagged unions in Zig
        // (`.js` vs `.mini`). Exact Rust shape pending bun_jsc port.
        match &mut self.evtloop {
            EventLoopHandle::Js(js) => {
                js.tick();
                js.enqueue_task_concurrent(
                    self.concurrent_task
                        .js_mut()
                        .from(self, ConcurrentTaskDeinit::ManualDeinit),
                );
            }
            EventLoopHandle::Mini(mini) => {
                mini.loop_.tick();
                mini.enqueue_task_concurrent(
                    self.concurrent_task
                        .mini_mut()
                        .from(self, "runFromMainThreadMini"),
                );
            }
        }
    }

    pub fn run_from_main_thread(&mut self) {
        // SAFETY: `self` is always the `task` field of `Yes`.
        let yes: &mut Yes = unsafe {
            &mut *(self as *mut Self as *mut u8)
                .sub(offset_of!(Yes, task))
                .cast::<Yes>()
        };
        yes.write_no_io().run();
    }

    pub fn run_from_main_thread_mini(&mut self, _: &mut ()) {
        self.run_from_main_thread();
    }
}

// TODO(port): these enum/tag types live in bun_shell::interpreter; placeholder imports
// until Phase B wires the real paths.
use bun_shell::interpreter::{BuiltinFd, BuiltinKind, ConcurrentTaskDeinit, OutputNeedsIo};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/yes.zig (181 lines)
//   confidence: medium
//   todos:      6
//   notes:      bltn()/self.buffer aliasing left as natural slices + TODO (raw-ptr workaround removed per guide); AllocScope ownership and EventLoopHandle/Task variant shapes need Phase B confirmation
// ──────────────────────────────────────────────────────────────────────────
