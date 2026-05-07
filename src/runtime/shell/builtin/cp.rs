use core::ffi::CStr;

use crate::shell::builtin::{Builtin, IoKind, Kind};
use crate::shell::interpreter::{
    parse_flags, unsupported_flag, EventLoopHandle, FlagParser, Interpreter, NodeId, OutputSrc,
    OutputTask, OutputTaskVTable, ParseError, ParseFlagResult, ShellTask,
};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;
use crate::shell::{ExitCode, ShellErr};

#[derive(Default)]
pub struct Cp {
    pub opts: Opts,
    pub state: State,
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
    /// FIFO of in-flight OutputTask pointers awaiting an IOWriter chunk
    /// completion. Stopgap until `WriterTag` can carry the `*mut OutputTask`
    /// directly — see mkdir.rs `Exec::output_queue` for rationale.
    pub output_queue: std::collections::VecDeque<*mut OutputTask<Cp>>,
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
    pub fn start(interp: &mut Interpreter, cmd: NodeId) -> Yield {
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
                    return Builtin::write_failing_error(
                        interp,
                        cmd,
                        Kind::Cp.usage_string(),
                        1,
                    );
                }
                Err(e) => return Self::fail_parse(interp, cmd, e),
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
            output_queue: std::collections::VecDeque::new(),
            #[cfg(windows)]
            ebusy: EbusyState::default(),
        });
        Self::next(interp, cmd)
    }

    fn fail_parse(interp: &mut Interpreter, cmd: NodeId, e: ParseError) -> Yield {
        let buf: Vec<u8> = match e {
            ParseError::IllegalOption(s) => Builtin::fmt_error_arena(
                interp,
                cmd,
                Some(Kind::Cp),
                // SAFETY: payload borrows argv or is 'static.
                format_args!("illegal option -- {}\n", bstr::BStr::new(unsafe { &*s })),
            )
            .to_vec(),
            ParseError::ShowUsage => Kind::Cp.usage_string().to_vec(),
            ParseError::Unsupported(s) => Builtin::fmt_error_arena(
                interp,
                cmd,
                Some(Kind::Cp),
                format_args!(
                    "unsupported option, please open a GitHub issue -- {}\n",
                    // SAFETY: see above.
                    bstr::BStr::new(unsafe { &*s })
                ),
            )
            .to_vec(),
        };
        Self::state_mut(interp, cmd).state = State::WaitingWriteErr;
        Builtin::write_failing_error(interp, cmd, &buf, 1)
    }

    pub fn next(interp: &mut Interpreter, cmd: NodeId) -> Yield {
        loop {
            #[allow(dead_code)]
            enum Action { Done(ExitCode), Schedule { start: usize, target: usize }, Ebusy }
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
                                Action::Ebusy
                            } else {
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
                    { return Self::ignore_ebusy_error_if_possible(interp, cmd); }
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
                Action::Ebusy => {
                    #[cfg(windows)]
                    {
                        let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state else {
                            unreachable!()
                        };
                        let ebusy = core::mem::take(&mut exec.ebusy);
                        Self::state_mut(interp, cmd).state = State::Ebusy(ebusy);
                        continue;
                    }
                    #[cfg(not(windows))]
                    unreachable!();
                }
                Action::Schedule { start, target } => {
                    let cwd = Builtin::shell(interp, cmd).cwd().to_vec();
                    let opts = Self::state_mut(interp, cmd).opts;
                    let evtloop = Builtin::event_loop(interp, cmd);
                    let tgt_ptr = Builtin::of(interp, cmd).args_slice()[target];
                    // SAFETY: argv entries are NUL-terminated.
                    let tgt = unsafe { CStr::from_ptr(tgt_ptr) }.to_bytes().to_vec();
                    let operands = 1 + (target - start);
                    for i in start..target {
                        let p = Builtin::of(interp, cmd).args_slice()[i];
                        // SAFETY: argv entries are NUL-terminated.
                        let src = unsafe { CStr::from_ptr(p) }.to_bytes().to_vec();
                        let task = ShellCpTask::create(
                            cmd, evtloop, opts, operands, src, tgt.clone(), cwd.clone(),
                        );
                        // SAFETY: freshly Box::into_raw'd.
                        unsafe { ShellTask::schedule(task) };
                    }
                    return Yield::suspended();
                }
            }
        }
    }

    pub fn on_io_writer_chunk(
        interp: &mut Interpreter,
        cmd: NodeId,
        written: usize,
        e: Option<bun_sys::SystemError>,
    ) -> Yield {
        if matches!(Self::state_mut(interp, cmd).state, State::WaitingWriteErr) {
            return Builtin::done(interp, cmd, 1);
        }
        let pending = if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_queue.pop_front()
        } else {
            None
        };
        if let Some(task) = pending {
            // SAFETY: `task` was Box::into_raw'd in `OutputTask::new` and
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
    fn ignore_ebusy_error_if_possible(interp: &mut Interpreter, cmd: NodeId) -> Yield {
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
                    // SAFETY: `t` is a live Box::into_raw'd task stashed in
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
                    // SAFETY: paired with `Box::into_raw` in `create()`.
                    drop(unsafe { Box::from_raw(t) });
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
    pub fn on_shell_cp_task_done(
        interp: &mut Interpreter,
        cmd: NodeId,
        task: *mut ShellCpTask,
    ) {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.tasks_count -= 1;
        }
        #[cfg(windows)]
        {
            // SAFETY: `task` is a live Box::into_raw'd task; main-thread only.
            let tref = unsafe { &mut *task };
            if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                if let Some(err) = &tref.err {
                    // Spec: cp.zig — defer the task if it errored with EBUSY
                    // on its own resolved src/tgt path.
                    let is_ebusy = matches!(err, ShellErr::Sys(sys)
                        if sys.get_errno() == bun_sys::E::EBUSY
                            && (tref.tgt_absolute.as_deref()
                                    .map_or(false, |p| sys.path.eql_utf8(p))
                                || tref.src_absolute.as_deref()
                                    .map_or(false, |p| sys.path.eql_utf8(p))));
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
    fn print_shell_cp_task(
        interp: &mut Interpreter,
        cmd: NodeId,
        task: *mut ShellCpTask,
    ) -> Yield {
        // SAFETY: task was Box::into_raw'd in create(); reclaim.
        let mut task = unsafe { Box::from_raw(task) };
        let output = core::mem::take(&mut task.verbose_output);
        let output_task = OutputTask::<Cp>::new(cmd, OutputSrc::Arrlist(output));

        if let Some(e) = task.err.take() {
            let errstr = Builtin::shell_err_to_string(interp, cmd, Kind::Cp, &e).to_vec();
            if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                exec.err = Some(e);
            }
            // Spec: else-arm `e.deinit()` — `e` drops here when not stored.
            // SAFETY: freshly allocated.
            return unsafe { OutputTask::<Cp>::start(output_task, interp, Some(&errstr)) };
        }
        // SAFETY: freshly allocated.
        unsafe { OutputTask::<Cp>::start(output_task, interp, None) }
    }

    #[inline]
    fn state_mut(interp: &mut Interpreter, cmd: NodeId) -> &mut Cp {
        match &mut Builtin::of_mut(interp, cmd).impl_ {
            crate::shell::builtin::Impl::Cp(c) => &mut **c,
            _ => unreachable!(),
        }
    }
}

pub type ShellCpOutputTask = OutputTask<Cp>;

impl OutputTaskVTable for Cp {
    fn write_err(
        interp: &mut Interpreter,
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
            if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                exec.output_queue.push_back(child);
            }
            let childptr = ChildPtr::new(cmd, WriterTag::Builtin);
            return Some(
                Builtin::of_mut(interp, cmd)
                    .stderr
                    .enqueue(childptr, errbuf, safeguard),
            );
        }
        Builtin::write_no_io(interp, cmd, IoKind::Stderr, errbuf);
        None
    }
    fn on_write_err(interp: &mut Interpreter, cmd: NodeId) {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_done += 1;
        }
    }
    fn write_out(
        interp: &mut Interpreter,
        cmd: NodeId,
        child: *mut OutputTask<Self>,
        output: &mut OutputSrc,
    ) -> Option<Yield> {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_waiting += 1;
        }
        if let Some(safeguard) = Builtin::of(interp, cmd).stdout.needs_io() {
            if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                exec.output_queue.push_back(child);
            }
            let childptr = ChildPtr::new(cmd, WriterTag::Builtin);
            let buf = output.slice().to_vec();
            return Some(
                Builtin::of_mut(interp, cmd)
                    .stdout
                    .enqueue(childptr, &buf, safeguard),
            );
        }
        let buf = output.slice().to_vec();
        Builtin::write_no_io(interp, cmd, IoKind::Stdout, &buf);
        None
    }
    fn on_write_out(interp: &mut Interpreter, cmd: NodeId) {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.output_done += 1;
        }
    }
    fn on_done(interp: &mut Interpreter, cmd: NodeId) -> Yield {
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
    /// Guards `verbose_output` — `cp_on_copy` is called from work-pool
    /// threads (concurrently per copied file) while the directory walk is
    /// still fanning out. Spec: cp.zig `verbose_output_lock`.
    pub verbose_output_lock: parking_lot::Mutex<()>,
    pub verbose_output: Vec<u8>,
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
    ) -> *mut ShellCpTask {
        Box::into_raw(Box::new(ShellCpTask {
            cmd,
            opts,
            operands,
            src,
            tgt,
            src_absolute: None,
            tgt_absolute: None,
            cwd_path,
            verbose_output_lock: parking_lot::Mutex::new(()),
            verbose_output: Vec::new(),
            err: None,
            task: ShellTask::new(evtloop),
        }))
    }

    /// Spec: cp.zig `onCopyImpl` — appends `"{src} -> {dest}\n"` to the verbose
    /// buffer (printed to stdout once the cp finishes). Called from work-pool
    /// threads; serialised via `verbose_output_lock`.
    fn on_copy_impl(&mut self, src: &[u8], dest: &[u8]) {
        let _guard = self.verbose_output_lock.lock();
        // PORT NOTE: Zig used `writer.print("{s} -> {s}\n", .{src, dest})`.
        self.verbose_output.reserve(src.len() + dest.len() + 5);
        self.verbose_output.extend_from_slice(src);
        self.verbose_output.extend_from_slice(b" -> ");
        self.verbose_output.extend_from_slice(dest);
        self.verbose_output.push(b'\n');
    }

    /// Spec: cp.zig `cpOnCopy`. Called from the node:fs `NewAsyncCpTask<true>`
    /// work-pool thread for every successfully-copied file. Records the pair
    /// for `-v`; on Windows the paths arrive as WTF-16 and are transcoded.
    pub fn cp_on_copy(&mut self, src: &[bun_paths::OSPathChar], dest: &[bun_paths::OSPathChar]) {
        if !self.opts.verbose { return; }
        #[cfg(not(windows))]
        { self.on_copy_impl(src, dest); }
        #[cfg(windows)]
        {
            let mut buf = bun_paths::PathBuffer::uninit();
            let mut buf2 = bun_paths::PathBuffer::uninit();
            let src8 = bun_string::strings::from_wpath(&mut buf, src);
            let dest8 = bun_string::strings::from_wpath(&mut buf2, dest);
            self.on_copy_impl(src8, dest8);
        }
    }

    /// Spec: cp.zig `cpOnFinish` → `onSubtaskFinish`. Called when the node:fs
    /// async cp completes (success or first error). Records the error (if any)
    /// and re-queues this `ShellCpTask` onto the JS thread so the interpreter
    /// can drain `verbose_output` / surface the error.
    ///
    /// # Safety
    /// `this` is the live `Box::into_raw`'d task originally passed to
    /// `ShellTask::schedule`; not touched again on this thread after return.
    pub unsafe fn cp_on_finish(this: *mut ShellCpTask, result: bun_sys::Maybe<()>) {
        if let Err(e) = result {
            // SAFETY: caller contract — `this` is live and exclusively owned
            // by this thread until `on_finish` enqueues it.
            unsafe { (*this).err = Some(ShellErr::new_sys(e)) };
        }
        // SAFETY: same allocation handed to `schedule`.
        unsafe { ShellTask::on_finish::<ShellCpTask>(this) };
    }

    /// Spec: cp.zig `runFromThreadPoolImpl`.
    pub fn run_from_thread_pool(this: *mut ShellCpTask) {
        // SAFETY: `this` is a live Box::into_raw'd task.
        let this = unsafe { &mut *this };
        // TODO(b2-blocked): bun_paths::join_z, bun_sys::lstat /
        // get_file_attributes, NodeFS::ShellAsyncCpTask. The full body
        // (~150 lines) classifies src/tgt as file/dir, resolves the
        // applicable POSIX synopsis, then schedules the node:fs cp.
        let _ = (&this.src, &this.tgt, &this.cwd_path, this.operands, this.opts);
        // Bounce-back is posted by `shell_task_trampoline`.
    }

    pub fn run_from_main_thread(this: *mut ShellCpTask, interp: &mut Interpreter) {
        // SAFETY: `this` is a live Box::into_raw'd task.
        let cmd = unsafe { (*this).cmd };
        Cp::on_shell_cp_task_done(interp, cmd, this);
    }
}

impl bun_event_loop::Taskable for ShellCpTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellCpTask;
}

impl crate::shell::interpreter::ShellTaskCtx for ShellCpTask {
    const TASK_OFFSET: usize = core::mem::offset_of!(Self, task);
    fn run_from_thread_pool(this: *mut Self) { Self::run_from_thread_pool(this) }
    fn run_from_main_thread(this: *mut Self, interp: &mut Interpreter) {
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
            _ => Some(ParseFlagResult::IllegalOption(&smallflags[i..] as *const [u8])),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/cp.zig (771 lines)
//   confidence: low-medium (NodeId style; thread-pool body + EBUSY stubbed)
//   blocked_on: NodeFS::ShellAsyncCpTask, bun_sys::lstat, WorkPool,
//               bun_collections::StringArrayHashMap, IOWriter::enqueue body
// ──────────────────────────────────────────────────────────────────────────
