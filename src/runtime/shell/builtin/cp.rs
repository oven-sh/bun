use core::ffi::CStr;

use bun_paths::resolve_path;

use crate::shell::builtin::{Builtin, BuiltinState, IoKind, Kind};
use crate::shell::interpreter::{
    EventLoopHandle, FlagParser, Interpreter, NodeId, OutputSrc, OutputTask, OutputTaskVTable,
    ParseFlagResult, ShellTask, parse_flags, unsupported_flag,
};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;
use crate::shell::{ExitCode, ShellErr};

#[derive(Default)]
pub struct Cp {
    pub opts: Opts,
    pub state: State,
    /// FIFO of in-flight OutputTask pointers awaiting an IOWriter chunk
    /// completion. Stopgap until `WriterTag` can carry the `*mut OutputTask`
    /// directly (see mkdir.rs `Exec::output_queue`). Lives on `Cp` (not
    /// `ExecState`) because `print_shell_cp_task` is also driven from
    /// [`State::Ebusy`] on Windows; both states must be able to stash/pop.
    pub output_queue: std::collections::VecDeque<*mut OutputTask<Cp>>,
}

#[derive(Default)]
pub enum State {
    #[default]
    Idle,
    Exec(ExecState),
    /// Windows-only post-processing of EBUSY collisions.
    Ebusy(EbusyState),
    WaitingWriteErr,
    Done,
}

pub struct ExecState {
    /// Index into argv where source paths start.
    pub sources_start: usize,
    /// argv[sources_start..target_idx] are sources; argv[target_idx] is the
    /// destination.
    pub target_idx: usize,
    pub started: bool,
    pub tasks_count: u32,
    pub output_waiting: u32,
    pub output_done: u32,
    pub err: Option<ShellErr>,
    #[cfg(windows)]
    pub ebusy: EbusyState,
}

/// On Windows it is possible to get an EBUSY error very simply by running
/// `cp myfile.txt myfile.txt mydir/` — two tasks race for the same dest. Bun
/// ignores the EBUSY if at least one task succeeded for that dest. Spec:
/// cp.zig `EbusyState`.
#[derive(Default)]
pub struct EbusyState {
    pub tasks: Vec<*mut ShellCpTask>,
    pub idx: usize,
    pub main_exit_code: ExitCode,
    /// Absolute target paths that some task copied successfully — used to
    /// suppress a sibling task's EBUSY on the same target. Spec: cp.zig
    /// `EbusyState.absolute_targets` (`StringArrayHashMapUnmanaged(void)`).
    pub absolute_targets: std::collections::HashSet<Vec<u8>>,
    pub absolute_srcs: std::collections::HashSet<Vec<u8>>,
}

impl Cp {
    pub fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        let mut opts = Opts::default();
        let (sources_start, target_idx) = {
            let args = Builtin::of(interp, cmd).args_slice();
            match parse_flags(&mut opts, args) {
                Ok(Some(rest)) if rest.len() > 1 => {
                    let start = args.len() - rest.len();
                    (start, args.len() - 1)
                }
                Ok(_) => {
                    Self::state_mut(interp, cmd).state = State::WaitingWriteErr;
                    return Builtin::write_failing_error(interp, cmd, Kind::Cp.usage_string(), 1);
                }
                Err(e) => {
                    return Builtin::fail_parse(interp, cmd, Kind::Cp, e, || {
                        Self::state_mut(interp, cmd).state = State::WaitingWriteErr
                    });
                }
            }
        };
        Self::state_mut(interp, cmd).opts = opts;
        Self::state_mut(interp, cmd).state = State::Exec(ExecState {
            sources_start,
            target_idx,
            started: false,
            tasks_count: 0,
            output_waiting: 0,
            output_done: 0,
            err: None,
            #[cfg(windows)]
            ebusy: EbusyState::default(),
        });
        Self::next(interp, cmd)
    }

    pub fn next(interp: &Interpreter, cmd: NodeId) -> Yield {
        loop {
            #[allow(dead_code)]
            enum Action {
                Done(ExitCode),
                Schedule { start: usize, target: usize },
                Ebusy(ExitCode),
            }
            let action = match &mut Self::state_mut(interp, cmd).state {
                State::Idle => panic!(
                    "Invalid state for \"Cp\": idle, this indicates a bug in Bun. Please file a GitHub issue"
                ),
                State::Exec(exec) => {
                    if exec.started {
                        if exec.tasks_count == 0 && exec.output_done >= exec.output_waiting {
                            let exit_code: ExitCode = if exec.err.is_some() { 1 } else { 0 };
                            exec.err = None;
                            #[cfg(windows)]
                            let act = if !exec.ebusy.tasks.is_empty() {
                                Action::Ebusy(exit_code)
                            } else {
                                // Spec: `exec.ebusy.deinit()` — Drop handles it.
                                Action::Done(exit_code)
                            };
                            #[cfg(not(windows))]
                            let act = Action::Done(exit_code);
                            act
                        } else {
                            return Yield::suspended();
                        }
                    } else {
                        exec.started = true;
                        let n = (exec.target_idx - exec.sources_start) as u32;
                        exec.tasks_count = n;
                        Action::Schedule {
                            start: exec.sources_start,
                            target: exec.target_idx,
                        }
                    }
                }
                State::Ebusy(_) => {
                    #[cfg(windows)]
                    {
                        return Self::ignore_ebusy_error_if_possible(interp, cmd);
                    }
                    #[cfg(not(windows))]
                    panic!("Should only be called on Windows");
                }
                State::WaitingWriteErr => return Yield::failed(),
                State::Done => return Builtin::done(interp, cmd, 0),
            };
            match action {
                Action::Done(code) => {
                    Self::state_mut(interp, cmd).state = State::Done;
                    return Builtin::done(interp, cmd, code);
                }
                Action::Ebusy(exit_code) => {
                    #[cfg(windows)]
                    {
                        let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state else {
                            unreachable!()
                        };
                        let mut ebusy = core::mem::take(&mut exec.ebusy);
                        ebusy.idx = 0;
                        ebusy.main_exit_code = exit_code;
                        Self::state_mut(interp, cmd).state = State::Ebusy(ebusy);
                        continue;
                    }
                    #[cfg(not(windows))]
                    {
                        let _ = exit_code;
                        unreachable!();
                    }
                }
                Action::Schedule { start, target } => {
                    let cwd = Builtin::shell(interp, cmd).cwd().to_vec();
                    let opts = Self::state_mut(interp, cmd).opts;
                    let evtloop = Builtin::event_loop(interp, cmd);
                    let tgt = Builtin::of(interp, cmd).arg_bytes(target).to_vec();
                    let operands = 1 + (target - start);
                    let interp_ptr = interp.as_ctx_ptr();
                    for i in start..target {
                        let src = Builtin::of(interp, cmd).arg_bytes(i).to_vec();
                        let task = ShellCpTask::create(
                            cmd,
                            evtloop,
                            opts,
                            operands,
                            src,
                            tgt.clone(),
                            cwd.clone(),
                            interp_ptr,
                        );
                        // SAFETY: freshly heap-allocated.
                        unsafe { ShellCpTask::schedule(task) };
                    }
                    return Yield::suspended();
                }
            }
        }
    }

    pub fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        written: usize,
        e: Option<bun_sys::SystemError>,
    ) -> Yield {
        if matches!(Self::state_mut(interp, cmd).state, State::WaitingWriteErr) {
            return Builtin::done(interp, cmd, 1);
        }
        if let Some(task) = Self::state_mut(interp, cmd).output_queue.pop_front() {
            // SAFETY: `task` was heap-allocated in `OutputTask::new` and
            // pushed by `write_err`/`write_out`; not yet freed.
            return unsafe { OutputTask::<Cp>::on_io_writer_chunk(task, interp, written, e) };
        }
        Self::next(interp, cmd)
    }

    /// Spec: cp.zig `ignoreEbusyErrorIfPossible`. Windows-only post-processing
    /// of tasks that failed with EBUSY: if some other task already succeeded
    /// for the same absolute src/tgt, the EBUSY is benign and the task is
    /// dropped; otherwise its error is surfaced via `print_shell_cp_task`.
    #[cfg(windows)]
    fn ignore_ebusy_error_if_possible(interp: &Interpreter, cmd: NodeId) -> Yield {
        loop {
            // PORT NOTE: reshaped for borrowck — pop tasks one at a time
            // (Zig iterated `tasks.items[idx..]` and bumped `idx` on the
            // first non-ignorable hit so a re-entry resumes there).
            let next = {
                let State::Ebusy(eb) = &mut Self::state_mut(interp, cmd).state else {
                    unreachable!()
                };
                if eb.idx < eb.tasks.len() {
                    let t = eb.tasks[eb.idx];
                    eb.idx += 1;
                    // SAFETY: `t` is a live heap-allocated task stashed in
                    // `on_shell_cp_task_done`; not yet freed.
                    let tref = unsafe { &*t };
                    let ignorable = tref
                        .tgt_absolute
                        .as_ref()
                        .map_or(false, |p| eb.absolute_targets.contains(p))
                        || tref
                            .src_absolute
                            .as_ref()
                            .map_or(false, |p| eb.absolute_srcs.contains(p));
                    Some((t, ignorable))
                } else {
                    None
                }
            };
            match next {
                Some((t, true)) => {
                    // SAFETY: paired with `heap::alloc` in `create()`.
                    drop(unsafe { bun_core::heap::take(t) });
                }
                Some((t, false)) => return Self::print_shell_cp_task(interp, cmd, t),
                None => break,
            }
        }
        let State::Ebusy(eb) = &mut Self::state_mut(interp, cmd).state else {
            unreachable!()
        };
        let exit_code = eb.main_exit_code;
        // Spec: `state.ebusy.state.deinit()` — Drop handles the sets/vec.
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(interp, cmd, exit_code)
    }

    /// Spec: cp.zig `onShellCpTaskDone`.
    pub fn on_shell_cp_task_done(interp: &Interpreter, cmd: NodeId, task: *mut ShellCpTask) {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.tasks_count -= 1;
        }
        #[cfg(windows)]
        {
            // SAFETY: `task` is a live heap-allocated task; main-thread only.
            let tref = unsafe { &mut *task };
            if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                if let Some(err) = &tref.err {
                    // Spec: cp.zig — defer the task to the ebusy phase.
                    // PORT NOTE: cp.zig L215-221 reads
                    //   `err.* == .sys and err.sys.getErrno() == .BUSY and (tgt_match) or (src_match)`
                    // Zig `and` binds tighter than `or`, so this parses as
                    //   `(is_sys && errno==BUSY && tgt_match) || src_match`
                    // i.e. ANY sys error whose `path` equals `src_absolute` is
                    // deferred regardless of errno. We mirror that precedence
                    // exactly here for spec parity (even though it is almost
                    // certainly a latent precedence bug upstream).
                    let is_ebusy = matches!(err, ShellErr::Sys(sys)
                        if (sys.get_errno() == bun_sys::E::EBUSY
                                && tref.tgt_absolute.as_deref()
                                    .map_or(false, |p| sys.path.eql_utf8(p)))
                            || tref.src_absolute.as_deref()
                                    .map_or(false, |p| sys.path.eql_utf8(p)));
                    if is_ebusy {
                        exec.ebusy.tasks.push(task);
                        return Self::next(interp, cmd).run(interp);
                    }
                } else {
                    // Record successful absolute paths so a deferred EBUSY
                    // sibling can be suppressed.
                    if let Some(tgt) = tref.tgt_absolute.take() {
                        exec.ebusy.absolute_targets.insert(tgt);
                    }
                    if let Some(src) = tref.src_absolute.take() {
                        exec.ebusy.absolute_srcs.insert(src);
                    }
                }
            }
        }
        Self::print_shell_cp_task(interp, cmd, task).run(interp);
    }

    /// Spec: cp.zig `printShellCpTask`.
    fn print_shell_cp_task(interp: &Interpreter, cmd: NodeId, task: *mut ShellCpTask) -> Yield {
        // SAFETY: task was heap-allocated in create(); reclaim.
        let mut task = unsafe { bun_core::heap::take(task) };
        // Spec: cp.zig `task.takeOutput()`. The lock is uncontended here (all
        // work-pool subtasks have finished) but the data lives inside it.
        let output = core::mem::take(&mut *task.verbose_output.lock());
        let output_task = OutputTask::<Cp>::new(cmd, OutputSrc::Arrlist(output));

        let errstr: Option<Vec<u8>> = task.err.take().map(|e| {
            let s = Builtin::shell_err_to_string(interp, cmd, Kind::Cp, &e).to_vec();
            if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                exec.err = Some(e);
            }
            // Spec: else-arm `e.deinit()` — `e` drops here when not stored.
            s
        });
        OutputTask::<Cp>::start(output_task, interp, errstr.as_deref())
    }
}

pub type ShellCpOutputTask = OutputTask<Cp>;

impl OutputTaskVTable for Cp {
    fn write_err(
        interp: &Interpreter,
        cmd: NodeId,
        child: *mut OutputTask<Self>,
        errbuf: &[u8],
    ) -> Option<Yield> {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_waiting += 1;
        }
        if let Some(safeguard) = Builtin::of(interp, cmd).stderr.needs_io() {
            // Stash so on_io_writer_chunk can route to the OutputTask state
            // machine and reclaim the box (stopgap for missing WriterTag).
            Self::state_mut(interp, cmd).output_queue.push_back(child);
            let childptr = ChildPtr::new(cmd, WriterTag::Builtin);
            return Some(
                Builtin::of_mut(interp, cmd)
                    .stderr
                    .enqueue(childptr, errbuf, safeguard),
            );
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, errbuf);
        None
    }
    fn on_write_err(interp: &Interpreter, cmd: NodeId) {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_done += 1;
        }
    }
    fn write_out(
        interp: &Interpreter,
        cmd: NodeId,
        child: *mut OutputTask<Self>,
        output: &mut OutputSrc,
    ) -> Option<Yield> {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_waiting += 1;
        }
        if let Some(safeguard) = Builtin::of(interp, cmd).stdout.needs_io() {
            Self::state_mut(interp, cmd).output_queue.push_back(child);
            let childptr = ChildPtr::new(cmd, WriterTag::Builtin);
            let buf = output.slice().to_vec();
            return Some(
                Builtin::of_mut(interp, cmd)
                    .stdout
                    .enqueue(childptr, &buf, safeguard),
            );
        }
        let buf = output.slice().to_vec();
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &buf);
        None
    }
    fn on_write_out(interp: &Interpreter, cmd: NodeId) {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_done += 1;
        }
    }
    fn on_done(interp: &Interpreter, cmd: NodeId) -> Yield {
        Self::next(interp, cmd)
    }
}

/// Spec: cp.zig `ShellCpTask`. Resolves src/tgt to absolute paths, decides
/// which POSIX `cp` synopsis applies, then hands off to the node:fs async cp
/// implementation.
pub struct ShellCpTask {
    pub cmd: NodeId,
    pub opts: Opts,
    pub operands: usize,
    pub src: Vec<u8>,
    pub tgt: Vec<u8>,
    pub src_absolute: Option<Vec<u8>>,
    pub tgt_absolute: Option<Vec<u8>>,
    pub cwd_path: Vec<u8>,
    /// Spec: cp.zig `verbose_output_lock` + `verbose_output`. `cp_on_copy` is
    /// invoked from work-pool threads (concurrently per copied file) while the
    /// directory walk is still fanning out, so the buffer must live inside the
    /// mutex — Zig's split lock-then-mutate pattern would alias `&mut self` in
    /// Rust.
    pub verbose_output: bun_threading::Guarded<Vec<u8>>,
    pub err: Option<ShellErr>,
    pub task: ShellTask,
}

impl ShellCpTask {
    pub fn create(
        cmd: NodeId,
        evtloop: EventLoopHandle,
        opts: Opts,
        operands: usize,
        src: Vec<u8>,
        tgt: Vec<u8>,
        cwd_path: Vec<u8>,
        interp: *mut Interpreter,
    ) -> *mut ShellCpTask {
        let mut task = Box::new(ShellCpTask {
            cmd,
            opts,
            operands,
            src,
            tgt,
            src_absolute: None,
            tgt_absolute: None,
            cwd_path,
            verbose_output: bun_threading::Guarded::new(Vec::new()),
            err: None,
            task: ShellTask::new(evtloop),
        });
        // Back-ref so `ShellTask::run_from_main_thread::<ShellCpTask>` (the
        // dispatch.rs bounce-back) can recover `&Interpreter`.
        task.task.interp = interp;
        bun_core::heap::into_raw(task)
    }

    /// Spec: cp.zig `onCopyImpl` — appends `"{src} -> {dest}\n"` to the verbose
    /// buffer (printed to stdout once the cp finishes). Called from work-pool
    /// threads; serialised via `verbose_output`'s mutex.
    fn on_copy_impl(&self, src: &[u8], dest: &[u8]) {
        let mut out = self.verbose_output.lock();
        // PORT NOTE: Zig used `writer.print("{s} -> {s}\n", .{src, dest})`.
        out.reserve(src.len() + dest.len() + 5);
        out.extend_from_slice(src);
        out.extend_from_slice(b" -> ");
        out.extend_from_slice(dest);
        out.push(b'\n');
    }

    /// Spec: cp.zig `cpOnCopy`. Called from the node:fs `NewAsyncCpTask<true>`
    /// work-pool thread for every successfully-copied file. Records the pair
    /// for `-v`; on Windows the paths arrive as WTF-16 and are transcoded.
    /// Takes `&self` because subtasks fan out concurrently — the only mutated
    /// state is the locked `verbose_output` buffer.
    pub fn cp_on_copy(&self, src: &[bun_paths::OSPathChar], dest: &[bun_paths::OSPathChar]) {
        if !self.opts.verbose {
            return;
        }
        #[cfg(not(windows))]
        {
            self.on_copy_impl(src, dest);
        }
        #[cfg(windows)]
        {
            let mut buf = bun_paths::PathBuffer::uninit();
            let mut buf2 = bun_paths::PathBuffer::uninit();
            let src8 = bun_paths::strings::from_wpath(&mut buf, src);
            let dest8 = bun_paths::strings::from_wpath(&mut buf2, dest);
            self.on_copy_impl(src8, dest8);
        }
    }

    /// Spec: cp.zig `cpOnFinish` → `onSubtaskFinish`. Called when the node:fs
    /// async cp completes (success or first error). Records the error (if any)
    /// and re-queues this `ShellCpTask` onto the JS thread so the interpreter
    /// can drain `verbose_output` / surface the error.
    ///
    /// # Safety
    /// `this` is the live `heap::alloc`'d task originally passed to
    /// [`schedule`](Self::schedule); not touched again on this thread after
    /// return.
    pub unsafe fn cp_on_finish(this: *mut ShellCpTask, result: bun_sys::Maybe<()>) {
        // SAFETY: caller contract — `this` is live and exclusively owned by
        // this thread until `enqueue_to_event_loop` hands it off.
        unsafe {
            if let Err(e) = result {
                (*this).err = Some(ShellErr::new_sys(e));
            }
            Self::enqueue_to_event_loop(this);
        }
    }

    /// Spec: cp.zig `schedule` — `WorkPool.schedule(&this.task)`. Unlike most
    /// shell builtins this does NOT use the generic [`ShellTask::schedule`]
    /// trampoline (which auto-enqueues back to main on return): on the
    /// success path the [`ShellAsyncCpTask`](crate::node::fs::ShellAsyncCpTask)
    /// owns the bounce-back via `cp_on_finish`, so an unconditional post would
    /// double-enqueue. The embedded [`ShellTask`] is reused for its
    /// `WorkPoolTask` / `concurrent_task` / `keep_alive` storage.
    ///
    /// # Safety
    /// `this` must be a fresh `heap::alloc`'d task (see [`create`]).
    pub unsafe fn schedule(this: *mut ShellCpTask) {
        use bun_threading::work_pool::WorkPool;
        // SAFETY: `this` is live; `task` is the embedded `ShellTask`. Stay on
        // raw pointers — once `WorkPool::schedule` returns the worker thread
        // may already be running.
        unsafe {
            let st = &raw mut (*this).task;
            (*st).task.callback = Self::work_pool_callback;
            (*st).keep_alive.ref_((*st).event_loop.as_event_loop_ctx());
            WorkPool::schedule(&raw mut (*st).task);
        }
    }

    /// Spec: cp.zig `runFromThreadPool` — recover `*ShellCpTask` from the
    /// intrusive `*WorkPoolTask`, run the impl, and on error post back
    /// immediately (success path defers the post to `cp_on_finish`).
    unsafe fn work_pool_callback(task: *mut crate::shell::interpreter::WorkPoolTask) {
        // SAFETY: `task` is the first `#[repr(C)]` field of `ShellTask`, which
        // is embedded in `ShellCpTask` at `TASK_OFFSET`. `this` is a live
        // heap-allocated task; the worker thread has exclusive access until
        // the bounce-back is posted.
        unsafe {
            let this = bun_ptr::container_of::<ShellCpTask, _>(
                task,
                <Self as crate::shell::interpreter::ShellTaskCtx>::TASK_OFFSET,
            );
            if let Some(e) = (*this).run_from_thread_pool_impl() {
                (*this).err = Some(e);
                Self::enqueue_to_event_loop(this);
            }
        }
    }

    /// Spec: cp.zig `enqueueToEventLoop`. Post this task to the main-thread
    /// concurrent queue; routed by `dispatch.rs` → [`run_from_main_thread`].
    ///
    /// # Safety
    /// `this` is the live `heap::alloc`'d task; not touched again on this
    /// thread after return.
    unsafe fn enqueue_to_event_loop(this: *mut ShellCpTask) {
        // Reuse the generic `ShellTask` post-back (identical to Zig's manual
        // `concurrent_task.{js,mini}.from(...)` + enqueue).
        // SAFETY: caller contract.
        unsafe { ShellTask::on_finish::<ShellCpTask>(this) };
    }

    /// Spec: cp.zig `hasTrailingSep`.
    fn has_trailing_sep(path: &[u8]) -> bool {
        path.last()
            .map_or(false, |&c| resolve_path::Platform::AUTO.is_separator(c))
    }

    /// Spec: cp.zig `isDir`.
    fn is_dir(path: &bun_core::ZStr) -> bun_sys::Maybe<bool> {
        #[cfg(windows)]
        {
            match bun_sys::get_file_attributes(path) {
                Some(attrs) => Ok(attrs.is_directory),
                None => Err(
                    bun_sys::Error::from_code(bun_sys::E::ENOENT, bun_sys::Tag::copyfile)
                        .with_path(path.as_bytes()),
                ),
            }
        }
        #[cfg(not(windows))]
        {
            let st = bun_sys::lstat(path)?;
            Ok(bun_sys::S::ISDIR(st.st_mode as _))
        }
    }

    /// Spec: cp.zig `runFromThreadPoolImpl`. Resolves src/tgt to absolute
    /// paths, classifies them per the three POSIX `cp` synopses
    /// (<https://man7.org/linux/man-pages/man1/cp.1p.html>), then hands off to
    /// the node:fs async cp implementation.
    fn run_from_thread_pool_impl(&mut self) -> Option<ShellErr> {
        use resolve_path::{Platform, platform};

        let mut buf2 = bun_paths::PathBuffer::uninit();
        let mut buf3 = bun_paths::PathBuffer::uninit();
        // We have to give an absolute path to our cp implementation for it to
        // work with cwd.
        let src: &bun_core::ZStr = if Platform::AUTO.is_absolute(&self.src) {
            // PORT NOTE: `self.src` is the bare argv bytes (no NUL); the Zig
            // path is `[:0]const u8` so `break :brk this.src` was already
            // NUL-terminated. Re-terminate via the thread-local join buffer.
            resolve_path::join_z::<platform::Auto>(&[&self.src])
        } else {
            resolve_path::join_z::<platform::Auto>(&[&self.cwd_path, &self.src])
        };
        let mut tgt: &bun_core::ZStr = if Platform::AUTO.is_absolute(&self.tgt) {
            resolve_path::join_z_buf::<platform::Auto>(buf2.as_mut_slice(), &[&self.tgt])
        } else {
            resolve_path::join_z_buf::<platform::Auto>(
                buf2.as_mut_slice(),
                &[&self.cwd_path, &self.tgt],
            )
        };

        // Cases:
        //   SRC       DEST
        //   ----------------
        //   file   -> file
        //   file   -> folder
        //   folder -> folder
        // We need to check dest to see what it is; if it doesn't exist we
        // need to create it.
        let src_is_dir = match Self::is_dir(src) {
            Ok(x) => x,
            Err(e) => return Some(ShellErr::new_sys(e)),
        };

        // Any source directory without -R is an error.
        if src_is_dir && !self.opts.recursive {
            return Some(ShellErr::Custom(
                format!("{} is a directory (not copied)", bstr::BStr::new(&self.src))
                    .into_bytes()
                    .into_boxed_slice(),
            ));
        }

        if !src_is_dir && src.as_bytes() == tgt.as_bytes() {
            return Some(ShellErr::Custom(
                format!(
                    "{0} and {0} are identical (not copied)",
                    bstr::BStr::new(&self.src)
                )
                .into_bytes()
                .into_boxed_slice(),
            ));
        }

        let (tgt_is_dir, tgt_exists) = match Self::is_dir(tgt) {
            Ok(is_dir) => (is_dir, true),
            Err(e) if e.get_errno() == bun_sys::E::ENOENT => {
                // If it has a trailing directory separator, it's a directory.
                (Self::has_trailing_sep(tgt.as_bytes()), false)
            }
            Err(e) => return Some(ShellErr::new_sys(e)),
        };

        let mut _copying_many = false;

        // The following logic is based on the POSIX spec.
        if !src_is_dir && !tgt_is_dir && self.operands == 2 {
            // 1st synopsis: source_file -> target_file. Nothing to adjust.
        } else if self.opts.recursive {
            // 2nd synopsis: -R source_files... -> target.
            if tgt_exists {
                let basename = resolve_path::basename(src.as_bytes());
                tgt = resolve_path::join_z_buf::<platform::Auto>(
                    buf3.as_mut_slice(),
                    &[tgt.as_bytes(), basename],
                );
            } else if self.operands == 2 {
                // source_dir -> new_target_dir.
            } else {
                return Some(ShellErr::Custom(
                    format!("directory {} does not exist", bstr::BStr::new(&self.tgt))
                        .into_bytes()
                        .into_boxed_slice(),
                ));
            }
            _copying_many = true;
        } else {
            // 3rd synopsis: source_files... -> target.
            if src_is_dir {
                return Some(ShellErr::Custom(
                    format!("{} is a directory (not copied)", bstr::BStr::new(&self.src))
                        .into_bytes()
                        .into_boxed_slice(),
                ));
            }
            if !tgt_exists || !tgt_is_dir {
                return Some(ShellErr::Custom(
                    format!("{} is not a directory", bstr::BStr::new(&self.tgt))
                        .into_bytes()
                        .into_boxed_slice(),
                ));
            }
            let basename = resolve_path::basename(src.as_bytes());
            tgt = resolve_path::join_z_buf::<platform::Auto>(
                buf3.as_mut_slice(),
                &[tgt.as_bytes(), basename],
            );
            _copying_many = true;
        }

        self.src_absolute = Some(src.as_bytes().to_vec());
        self.tgt_absolute = Some(tgt.as_bytes().to_vec());

        let args = crate::node::fs::args::Cp {
            src: bun_jsc::node::PathLike::String(bun_core::PathString::init(
                self.src_absolute.as_deref().unwrap(),
            )),
            dest: bun_jsc::node::PathLike::String(bun_core::PathString::init(
                self.tgt_absolute.as_deref().unwrap(),
            )),
            flags: crate::node::fs::args::CpFlags {
                mode: crate::node::fs::constants::Copyfile::from_raw(0),
                recursive: self.opts.recursive,
                force: true,
                error_on_exist: false,
                deinit_paths: false,
            },
        };

        // PORT NOTE: Zig passed an `ArenaAllocator` for the async-cp
        // bookkeeping; the Rust `NewAsyncCpTask` owns its allocations.
        match self.task.event_loop {
            EventLoopHandle::Js { .. } => {
                let vm_ptr = self
                    .task
                    .event_loop
                    .bun_vm()
                    .cast::<bun_jsc::virtual_machine::VirtualMachine>();
                // SAFETY: `Js` arm always has a live VM (set at interpreter
                // construction); accessed read-only here for the
                // global-object handle and event-loop pointer — same as Zig's
                // `event_loop.js.getVmImpl()` from the work-pool thread.
                // PORT NOTE: reshaped for borrowck — read the raw `global`
                // field instead of `vm.global()` so the `&mut VirtualMachine`
                // passed below doesn't overlap a `&JSGlobalObject` borrow.
                let (global, vm) = unsafe { (&*(*vm_ptr).global, &mut *vm_ptr) };
                let _ = crate::node::fs::ShellAsyncCpTask::create_with_shell_task(
                    global,
                    args,
                    vm,
                    std::ptr::from_mut::<ShellCpTask>(self),
                    false,
                );
            }
            EventLoopHandle::Mini(mini) => {
                let _ = crate::node::fs::ShellAsyncCpTask::create_mini(
                    args,
                    mini.as_ptr(),
                    std::ptr::from_mut::<ShellCpTask>(self),
                );
            }
        }

        None
    }

    pub fn run_from_main_thread(this: *mut ShellCpTask, interp: &Interpreter) {
        // SAFETY: `this` is a live heap-allocated task.
        let cmd = unsafe { (*this).cmd };
        Cp::on_shell_cp_task_done(interp, cmd, this);
    }
}

impl bun_event_loop::Taskable for ShellCpTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellCpTask;
}

impl crate::shell::interpreter::ShellTaskCtx for ShellCpTask {
    const TASK_OFFSET: usize = core::mem::offset_of!(Self, task);
    fn run_from_thread_pool(_this: &mut Self) {
        // Not reached: `ShellCpTask::schedule` installs `work_pool_callback`
        // directly (cp.zig does NOT use `InnerShellTask` — the generic
        // trampoline auto-posts back, which would double-enqueue when the
        // `ShellAsyncCpTask` later calls `cp_on_finish`).
        debug_assert!(
            false,
            "ShellCpTask scheduled via ShellTask::schedule; use ShellCpTask::schedule"
        );
    }
    fn run_from_main_thread(this: *mut Self, interp: &Interpreter) {
        Self::run_from_main_thread(this, interp)
    }
}

#[derive(Clone, Copy)]
pub struct Opts {
    /// `-f` — if the destination cannot be opened, remove and recreate it
    pub remove_and_create_new_file_if_not_found: bool,
    /// `-H` — dereference symlinks named on the command line
    pub dereference_command_line_symlinks: bool,
    /// `-i` — prompt before overwriting
    pub interactive: bool,
    /// `-L` — dereference all symlinks
    pub dereference_all_symlinks: bool,
    /// `-P` — preserve symlinks
    pub preserve_symlinks: bool,
    /// `-p` — preserve mtimes/uid/gid/mode
    pub preserve_file_attributes: bool,
    /// `-R` — copy file hierarchies
    pub recursive: bool,
    /// `-v` — verbose
    pub verbose: bool,
    /// `-n` — do not overwrite an existing file
    pub overwrite_existing_file: bool,
}

impl Default for Opts {
    fn default() -> Self {
        Self {
            remove_and_create_new_file_if_not_found: false,
            dereference_command_line_symlinks: false,
            interactive: false,
            dereference_all_symlinks: false,
            preserve_symlinks: false,
            preserve_file_attributes: false,
            recursive: false,
            verbose: false,
            overwrite_existing_file: true,
        }
    }
}

impl FlagParser for Opts {
    fn parse_long(&mut self, _flag: &[u8]) -> Option<ParseFlagResult> {
        None
    }

    fn parse_short(&mut self, ch: u8, smallflags: &[u8], i: usize) -> Option<ParseFlagResult> {
        match ch {
            b'f' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-f"))),
            b'H' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-H"))),
            b'i' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-i"))),
            b'L' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-L"))),
            b'P' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-P"))),
            b'p' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-P"))),
            b'R' => {
                self.recursive = true;
                Some(ParseFlagResult::ContinueParsing)
            }
            b'v' => {
                self.verbose = true;
                Some(ParseFlagResult::ContinueParsing)
            }
            b'n' => {
                self.overwrite_existing_file = true;
                self.remove_and_create_new_file_if_not_found = false;
                Some(ParseFlagResult::ContinueParsing)
            }
            _ => Some(ParseFlagResult::IllegalOption(&raw const smallflags[i..])),
        }
    }
}

// ported from: src/shell/builtin/cp.zig
