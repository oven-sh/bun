use core::ops::Range;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicUsize, Ordering};
use std::io::Write as _;
use std::rc::Rc;

use bun_collections::index_sort;
use bun_core::{ZBox, ZStr, strings};
use bun_resolver::compiled_program::compare_source_paths;
use bun_sys::{E, FdExt, O, S, dir_iterator};

use crate::shell::ExitCode;
use crate::shell::builtin::{Builtin, BuiltinIO, IoKind, Kind};
use crate::shell::interpreter::{
    EventLoopHandle, Interpreter, NodeId, ShellTask, shell_lstatat, shell_openat, shell_statat,
};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub(crate) struct Ls {
    pub(crate) opts: Opts,
    pub(crate) state: State,
}

// `Ls` is in a `Box`, and a `Box` for `ExecState` would be one more allocation for each `ls`.
#[allow(clippy::large_enum_variant)]
#[derive(Default)]
pub(crate) enum State {
    #[default]
    Idle,
    Exec(ExecState),
    WaitingWriteErr,
    Done,
}

pub(crate) struct ExecState {
    pub(crate) err: Option<bun_sys::Error>,
    /// Tasks that have a section. Slot 0 lists the one path or orders the operands.
    pub(crate) task_count: AtomicUsize,
    /// Tasks whose section is written.
    pub(crate) tasks_done: usize,
    /// Chunks queued on an `IOWriter`.
    pub(crate) output_waiting: usize,
    /// Chunks whose `on_io_writer_chunk` ran.
    pub(crate) output_done: usize,
    /// What each task that runs `stat` on a part of the operands found, until the last is done.
    parts: Vec<Option<Classified>>,
    parts_left: usize,
    /// The slot whose section is written next: depth first, a task before its subtasks.
    turn: Option<u32>,
    /// The slots after `turn`, the next one last.
    after: Vec<u32>,
    /// Results that arrived before their turn, by slot.
    parked: Vec<Option<Section>>,
    /// The section of `turn`, while a part of it is still to write.
    writing: Option<Section>,
    /// Bytes ready for the `IOWriter` of `batch_stream`. Small sections are joined in it.
    batch: Vec<u8>,
    batch_stream: IoKind,
    /// Whether stdout and stderr are two `IOWriter`s on one file. `None` until they first meet.
    one_destination: Option<bool>,
    /// The stream of the chunks that are queued and not written yet.
    in_flight: IoKind,
    /// [`Ls::drain`] is running: a chunk that completes inside it is only counted.
    draining: bool,
}

/// Sections are joined into chunks of at most one page, which a writable pipe takes at once.
const CHUNK: usize = 4096;

/// A part has at least this many operands. Below that, a pool task costs more than it saves.
const OPERANDS_PER_PART: usize = 8;

/// What one task found, as the main thread writes it.
struct Section {
    errs: Vec<bun_sys::Error>,
    output: Vec<u8>,
    /// Slots of the subtasks, in the order of their sections.
    children: Vec<u32>,
}

/// What one pass of `stat` over operands found.
struct Classified {
    /// The operands, each followed by a NUL.
    operands: Vec<u8>,
    /// The entry of each operand that is not a directory to list.
    entries: Vec<u8>,
    /// In the order of the command line.
    found: Vec<Found>,
    errs: Vec<bun_sys::Error>,
}

struct Found {
    /// In `operands`.
    name: Range<usize>,
    /// In `entries`. Empty for a directory to list.
    entry: Range<usize>,
    /// The slot of the subtask that lists it, for a directory.
    directory: Option<u32>,
    /// What `-t` or `-S` sorts by.
    key: (i64, i64),
}

impl ExecState {
    /// Moves `turn` past a written section whose subtasks are `children`.
    fn advance(&mut self, children: Vec<u32>) {
        self.after.extend(children.into_iter().rev());
        self.turn = self.after.pop();
    }
}

enum ParseFlag {
    ContinueParsing,
    Done,
    IllegalOption(Box<[u8]>),
}

impl Ls {
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        Self::next(interp, cmd)
    }

    fn next(interp: &Interpreter, cmd: NodeId) -> Yield {
        // Match on a tag, drop the borrow, then act.
        enum Tag {
            Idle,
            Exec,
            WaitingWriteErr,
            Done,
        }
        let tag = match Self::state_mut(interp, cmd).state {
            State::Idle => Tag::Idle,
            State::Exec(_) => Tag::Exec,
            State::WaitingWriteErr => Tag::WaitingWriteErr,
            State::Done => Tag::Done,
        };
        match tag {
            Tag::Idle => {
                // Parse opts; will be None if called with no args, in
                // which case we run once with ".".
                let paths_start = match Self::parse_opts(interp, cmd) {
                    Ok(p) => p,
                    Err(opt) => {
                        let buf: Vec<u8> = Builtin::fmt_error_arena(
                            interp,
                            cmd,
                            Some(Kind::Ls),
                            format_args!("illegal option -- {}\n", bstr::BStr::new(&opt[..])),
                        )
                        .to_vec();
                        Self::state_mut(interp, cmd).state = State::WaitingWriteErr;
                        return Builtin::write_failing_error(interp, cmd, &buf, 1);
                    }
                };

                let argc = Builtin::of(interp, cmd).args_slice().len();
                let operands = paths_start.unwrap_or(argc)..argc;
                // Many operands: several tasks share the `stat` calls.
                let parts = (operands.len() / OPERANDS_PER_PART)
                    .clamp(1, usize::from(bun_core::get_thread_count()));
                Self::state_mut(interp, cmd).state = State::Exec(ExecState {
                    err: None,
                    task_count: AtomicUsize::new(1),
                    tasks_done: 0,
                    output_waiting: 0,
                    output_done: 0,
                    parts: Vec::new(),
                    parts_left: 0,
                    turn: Some(0),
                    after: Vec::new(),
                    parked: Vec::new(),
                    writing: None,
                    batch: Vec::new(),
                    batch_stream: IoKind::Stdout,
                    one_destination: None,
                    in_flight: IoKind::Stdout,
                    draining: false,
                });

                // One task lists `.` or the one operand.
                if operands.len() < 2 {
                    let path = match operands.len() {
                        0 => b".",
                        _ => Builtin::of(interp, cmd).arg_bytes(operands.start),
                    };
                    Self::schedule(interp, cmd, ZBox::from_bytes(path), None);
                    return Yield::suspended();
                }
                if parts > 1 {
                    if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                        exec.parts.resize_with(parts, || None);
                        exec.parts_left = parts;
                    }
                }
                for part in 0..parts {
                    let builtin = Builtin::of(interp, cmd);
                    let first = operands.start + part * operands.len() / parts;
                    let end = operands.start + (part + 1) * operands.len() / parts;
                    let len = |operand| builtin.arg_bytes(operand).len() + 1;
                    let mut bytes = Vec::with_capacity((first..end).map(len).sum());
                    for operand in first..end {
                        bytes.extend_from_slice(builtin.arg_bytes(operand));
                        bytes.push(0);
                    }
                    let stat = Operands::Stat {
                        bytes,
                        part,
                        alone: parts == 1,
                    };
                    Self::schedule(interp, cmd, ZBox::default(), Some(Box::new(stat)));
                }
                Yield::suspended()
            }
            Tag::Exec => {
                let done = {
                    let State::Exec(exec) = &Self::state_mut(interp, cmd).state else {
                        unreachable!()
                    };
                    exec.tasks_done >= exec.task_count.load(Ordering::Relaxed)
                        && exec.output_done >= exec.output_waiting
                        && exec.batch.is_empty()
                };
                if done {
                    let exit_code: ExitCode = {
                        let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state else {
                            unreachable!()
                        };
                        let code = if exec.err.is_some() { 1 } else { 0 };
                        exec.err = None;
                        code
                    };
                    Self::state_mut(interp, cmd).state = State::Done;
                    return Builtin::done(interp, cmd, exit_code);
                }
                Yield::suspended()
            }
            Tag::WaitingWriteErr => Yield::suspended(),
            Tag::Done => Builtin::done(interp, cmd, 0),
        }
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        _: Option<bun_sys::SystemError>,
    ) -> Yield {
        match &mut Self::state_mut(interp, cmd).state {
            State::WaitingWriteErr => return Builtin::done(interp, cmd, 1),
            State::Exec(exec) => {
                exec.output_done += 1;
                if exec.draining {
                    return Yield::suspended();
                }
            }
            State::Idle | State::Done => {}
        }
        Self::drain(interp, cmd);
        Self::next(interp, cmd)
    }

    /// Creates a task on the pool: it lists `path`, or it works on operands.
    fn schedule(interp: &Interpreter, cmd: NodeId, path: ZBox, operands: Option<Box<Operands>>) {
        // Stable address: `Ls` is in a `Box`, and `Exec` is held until all tasks finish.
        let task_count: *const AtomicUsize = {
            let State::Exec(exec) = &Self::state_mut(interp, cmd).state else {
                unreachable!()
            };
            &raw const exec.task_count
        };
        let task = ShellLsTask::create(
            cmd,
            Self::state_mut(interp, cmd).opts,
            task_count,
            Builtin::cwd(interp, cmd),
            path,
            Builtin::event_loop(interp, cmd),
            interp.as_ctx_ptr(),
        );
        // SAFETY: freshly heap-allocated.
        unsafe {
            (*task).operands = operands;
            ShellTask::schedule_no_ref::<ShellLsTask>(task);
        }
    }

    /// A task that ran `stat` on one part is done. After the last, one task orders the results.
    fn on_operands_classified(
        interp: &Interpreter,
        cmd: NodeId,
        part: usize,
        classified: Classified,
    ) {
        let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state else {
            return;
        };
        exec.parts[part] = Some(classified);
        exec.parts_left -= 1;
        if exec.parts_left > 0 {
            return;
        }
        let parts = core::mem::take(&mut exec.parts)
            .into_iter()
            .flatten()
            .collect();
        let order = Operands::Order(parts);
        Self::schedule(interp, cmd, ZBox::default(), Some(Box::new(order)));
    }

    /// A task with a section is done. The section is written now if its turn has come.
    fn on_shell_ls_task_done(interp: &Interpreter, cmd: NodeId, slot: u32, section: Section) {
        let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state else {
            return;
        };
        if exec.turn != Some(slot) {
            let slot = slot as usize;
            if exec.parked.len() <= slot {
                exec.parked.resize_with(slot + 1, || None);
            }
            exec.parked[slot] = Some(section);
            return;
        }
        exec.writing = Some(section);
        Self::drain(interp, cmd);
        Self::next(interp, cmd).run(interp);
    }

    /// Writes each section whose turn it is, until one is missing or a stream has to wait.
    fn drain(interp: &Interpreter, cmd: NodeId) {
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.draining = true;
        }
        loop {
            let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state else {
                return;
            };
            let mut section = match exec.writing.take() {
                Some(section) => section,
                None => {
                    let parked = exec
                        .turn
                        .and_then(|turn| exec.parked.get_mut(turn as usize));
                    match parked.and_then(Option::take) {
                        Some(section) => section,
                        None => break,
                    }
                }
            };
            let errs_fit =
                section.errs.is_empty() || Self::make_room(interp, cmd, IoKind::Stderr, 0);
            if errs_fit && !section.errs.is_empty() {
                let mut errstr = Vec::new();
                for e in core::mem::take(&mut section.errs) {
                    errstr.extend_from_slice(Builtin::task_error_to_string(
                        interp,
                        cmd,
                        Kind::Ls,
                        &e,
                    ));
                    if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
                        if exec.err.is_none() {
                            exec.err = Some(e);
                        }
                    }
                }
                Self::emit(interp, cmd, IoKind::Stderr, errstr);
            }
            let output_fits = errs_fit
                && (section.output.is_empty()
                    || Self::make_room(interp, cmd, IoKind::Stdout, section.output.len()));
            let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state else {
                return;
            };
            if !output_fits {
                exec.writing = Some(section);
                break;
            }
            exec.tasks_done += 1;
            exec.advance(section.children);
            Self::emit(interp, cmd, IoKind::Stdout, section.output);
        }
        Self::flush(interp, cmd);
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.draining = false;
        }
    }

    fn stream(builtin: &mut Builtin, io_kind: IoKind) -> &mut BuiltinIO {
        match io_kind {
            IoKind::Stdout => &mut builtin.stdout,
            IoKind::Stderr => &mut builtin.stderr,
        }
    }

    /// Whether `len` more bytes of `stream` fit in the batch, after a flush if one is needed.
    fn make_room(interp: &Interpreter, cmd: NodeId, stream: IoKind, len: usize) -> bool {
        let needs_io = Self::stream(Builtin::of_mut(interp, cmd), stream)
            .needs_io()
            .is_some();
        let State::Exec(exec) = &Self::state_mut(interp, cmd).state else {
            return false;
        };
        if !needs_io
            || exec.batch.is_empty()
            || (exec.batch_stream == stream && exec.batch.len() + len <= CHUNK)
        {
            return true;
        }
        Self::flush(interp, cmd)
    }

    /// Takes the next bytes of `stream`: into the batch, or at once with no `IOWriter`.
    fn emit(interp: &Interpreter, cmd: NodeId, stream: IoKind, bytes: Vec<u8>) {
        if bytes.is_empty() {
            return;
        }
        if Self::stream(Builtin::of_mut(interp, cmd), stream)
            .needs_io()
            .is_none()
        {
            let _ = Builtin::write_no_io(interp, cmd, stream, &bytes);
            return;
        }
        let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state else {
            return;
        };
        if exec.batch.is_empty() {
            exec.batch = bytes;
            exec.batch_stream = stream;
        } else {
            exec.batch.extend_from_slice(&bytes);
        }
    }

    /// Queues the batch. False while chunks of the other stream wait on the same file.
    fn flush(interp: &Interpreter, cmd: NodeId) -> bool {
        let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state else {
            return false;
        };
        if exec.batch.is_empty() {
            return true;
        }
        let stream = exec.batch_stream;
        if exec.output_done < exec.output_waiting
            && exec.in_flight != stream
            && Self::one_destination(interp, cmd)
        {
            return false;
        }
        let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state else {
            return false;
        };
        let batch = core::mem::take(&mut exec.batch);
        exec.in_flight = stream;
        exec.output_waiting += 1;
        let io = Self::stream(Builtin::of_mut(interp, cmd), stream);
        let Some(safeguard) = io.needs_io() else {
            unreachable!("only a stream with an IOWriter has a batch")
        };
        io.enqueue(ChildPtr::new(cmd, WriterTag::Builtin), &batch, safeguard)
            .run(interp);
        true
    }

    /// Two pipes, or a pipe and a terminal, are two destinations: neither waits for the other.
    fn one_destination(interp: &Interpreter, cmd: NodeId) -> bool {
        let State::Exec(exec) = &Self::state_mut(interp, cmd).state else {
            return false;
        };
        if let Some(known) = exec.one_destination {
            return known;
        }
        let builtin = Builtin::of(interp, cmd);
        let one = match (&builtin.stdout, &builtin.stderr) {
            (BuiltinIO::Fd(stdout), BuiltinIO::Fd(stderr))
                if !Rc::ptr_eq(&stdout.writer, &stderr.writer) =>
            {
                match (
                    bun_sys::fstat(stdout.writer.fd()),
                    bun_sys::fstat(stderr.writer.fd()),
                ) {
                    (Ok(a), Ok(b)) => a.st_dev == b.st_dev && a.st_ino == b.st_ino,
                    // Not known: keep the order.
                    _ => true,
                }
            }
            // One writer keeps the order of its chunks, and a buffer takes its bytes at once.
            _ => false,
        };
        if let State::Exec(exec) = &mut Self::state_mut(interp, cmd).state {
            exec.one_destination = Some(one);
        }
        one
    }

    /// Returns the index of the first non-flag arg, or `None` if there are no
    /// positional args. `Err` carries the offending flag byte.
    fn parse_opts(interp: &Interpreter, cmd: NodeId) -> Result<Option<usize>, Box<[u8]>> {
        let argc = Builtin::of(interp, cmd).args_slice().len();
        if argc == 0 {
            return Ok(None);
        }
        let mut idx = 0usize;
        while idx < argc {
            let flag = Builtin::of(interp, cmd).arg_bytes(idx);
            match Self::parse_flag(&mut Self::state_mut(interp, cmd).opts, flag) {
                ParseFlag::Done => return Ok(Some(idx)),
                ParseFlag::ContinueParsing => {}
                ParseFlag::IllegalOption(s) => return Err(s),
            }
            idx += 1;
        }
        Ok(None)
    }

    fn parse_flag(opts: &mut Opts, flag: &[u8]) -> ParseFlag {
        if flag.is_empty() || flag[0] != b'-' {
            return ParseFlag::Done;
        }
        // FIXME windows
        if flag.len() == 1 {
            return ParseFlag::IllegalOption(Box::from(&b"-"[..]));
        }
        for &ch in &flag[1..] {
            match ch {
                b'a' => opts.dotfiles = DotfileMode::All,
                b'A' => opts.dotfiles = DotfileMode::AlmostAll,
                b'd' => opts.list_directories = true,
                b'l' => opts.long_listing = true,
                b'R' => opts.recursive = true,
                b'r' => opts.reverse = true,
                b'U' => opts.sort = Sort::None,
                b'f' => {
                    opts.sort = Sort::None;
                    opts.dotfiles = DotfileMode::All;
                }
                b't' => opts.sort = Sort::Time,
                b'S' => opts.sort = Sort::Size,
                // The remaining short flags are recognised but currently no-op.
                b'1' | b'b' | b'B' | b'c' | b'C' | b'D' | b'F' | b'g' | b'G' | b'h' | b'H'
                | b'i' | b'I' | b'k' | b'L' | b'm' | b'n' | b'N' | b'o' | b'p' | b'q' | b'Q'
                | b's' | b'T' | b'u' | b'v' | b'w' | b'x' | b'X' | b'Z' => {}
                _ => return ParseFlag::IllegalOption(Box::from(&flag[1..2])),
            }
        }
        ParseFlag::ContinueParsing
    }

    #[inline]
    fn state_mut(interp: &Interpreter, cmd: NodeId) -> &mut Ls {
        match &mut Builtin::of_mut(interp, cmd).impl_ {
            crate::shell::builtin::Impl::Ls(l) => &mut **l,
            _ => unreachable!(),
        }
    }
}

/// What an operand is.
enum Operand {
    /// A directory, with its `stat`.
    Directory(bun_sys::Stat),
    /// Not a directory. Its `lstat`, when `-l`, `-t` or `-S` needs it.
    Entry(Option<bun_sys::Stat>),
}

/// What a task does with two or more operands. Tasks share them: one `stat` can be slow.
enum Operands {
    /// Run `stat` on these NUL-terminated operands. `alone`: this task also orders them.
    Stat {
        bytes: Vec<u8>,
        part: usize,
        alone: bool,
    },
    /// What a `Stat` task found, for the main thread.
    Found { part: usize, classified: Classified },
    /// Put in order what all the `Stat` tasks found.
    Order(Vec<Classified>),
}

/// Opens the path, iterates its entries (or
/// prints the path itself for files / `-d`), accumulating into `output`.
/// With two or more operands, a task works on the operands instead ([`Operands`]).
pub(crate) struct ShellLsTask {
    pub cmd: NodeId,
    pub opts: Opts,
    pub print_directory: bool,
    /// Shared atomic counter (lives in `ExecState` inside `Box<Ls>`; address
    /// is stable for the lifetime of the Exec state).
    pub task_count: *const AtomicUsize,
    pub cwd: bun_sys::Fd,
    pub path: ZBox,
    /// Set when the task works on operands. `path` is then empty.
    operands: Option<Box<Operands>>,
    pub output: Vec<u8>,
    pub is_absolute: bool,
    pub errs: Vec<bun_sys::Error>,
    /// Cached current time (seconds since epoch) for formatting timestamps.
    /// Cached once per task to avoid repeated syscalls.
    now_secs: u64,
    pub event_loop: EventLoopHandle,
    /// Back-ref so a subtask can populate its
    /// `task.interp` (needed by [`ShellTask::run_from_main_thread`]).
    pub interp: *mut Interpreter,
    /// Where this task's section goes in the output (see [`ExecState::turn`]).
    slot: u32,
    /// Slots of the subtasks of this task, in the order of their sections.
    children: Vec<u32>,
    pub task: ShellTask,
}

impl ShellLsTask {
    fn create(
        cmd: NodeId,
        opts: Opts,
        task_count: *const AtomicUsize,
        cwd: bun_sys::Fd,
        path: ZBox,
        event_loop: EventLoopHandle,
        interp: *mut Interpreter,
    ) -> *mut ShellLsTask {
        let mut task = Box::new(ShellLsTask {
            cmd,
            opts,
            print_directory: false,
            task_count,
            cwd,
            path,
            operands: None,
            output: Vec::new(),
            is_absolute: false,
            errs: Vec::new(),
            now_secs: 0,
            event_loop,
            interp,
            slot: 0,
            children: Vec::new(),
            task: ShellTask::new(event_loop),
        });
        task.task.interp = interp;
        bun_core::heap::into_raw(task)
    }

    /// Schedules a subtask that lists `path` (a directory operand or a `-R` subdirectory).
    fn schedule_subtask(&mut self, path: ZBox) -> u32 {
        // Pool thread: the subtask inherits our poster rather than deriving
        // one from the VM (`ShellTask::new` is JS-thread only).
        let mut subtask = Box::new(ShellLsTask {
            cmd: self.cmd,
            opts: self.opts,
            print_directory: true,
            task_count: self.task_count,
            cwd: self.cwd,
            path,
            operands: None,
            output: Vec::new(),
            is_absolute: false,
            errs: Vec::new(),
            now_secs: 0,
            event_loop: self.event_loop,
            interp: self.interp,
            slot: 0,
            children: Vec::new(),
            task: ShellTask::new_child(&self.task),
        });
        subtask.task.interp = self.interp;
        // SAFETY: `task_count` points into the `Box<Ls>` ExecState which
        // outlives every in-flight task (see `next`). `subtask` is freshly
        // heap-allocated and scheduled via raw `WorkPool::schedule` (no
        // keep-alive ref) — it runs on a worker thread with no JS-VM
        // thread-local.
        unsafe {
            subtask.slot = (*self.task_count).fetch_add(1, Ordering::Relaxed) as u32;
            let slot = subtask.slot;
            ShellTask::schedule_no_ref::<ShellLsTask>(bun_core::heap::into_raw(subtask));
            slot
        }
    }

    fn join(&self, child: &[u8]) -> ZBox {
        if !self.is_absolute {
            // If relative paths enabled, stdlib join is preferred over
            // ResolvePath.joinBuf because it doesn't try to normalize the path.
            // On Windows both '/' and '\' count as separators here, so
            // `["foo/", "bar"]` → `foo/bar` (no extra sep).
            let parent = self.path.as_bytes();
            let mut v = Vec::with_capacity(parent.len() + 1 + child.len());
            v.extend_from_slice(parent);
            if parent.last().is_some_and(|&c| !bun_paths::is_sep_native(c)) {
                v.push(bun_paths::SEP);
            }
            v.extend_from_slice(child);
            return ZBox::from_vec(v);
        }
        let out = bun_paths::resolve_path::join::<bun_paths::platform::Auto>(&[
            self.path.as_bytes(),
            child,
        ]);
        ZBox::from_bytes(out)
    }

    fn run_from_thread_pool(this: &mut ShellLsTask) {
        // Cache current time once per task for timestamp formatting.
        if this.opts.long_listing {
            this.now_secs = bun_core::time::timestamp().max(0) as u64;
        }

        if let Some(operands) = this.operands.take() {
            match *operands {
                Operands::Stat { bytes, part, alone } => {
                    let classified = this.classify(bytes);
                    if alone {
                        this.order(vec![classified]);
                    } else {
                        this.operands = Some(Box::new(Operands::Found { part, classified }));
                    }
                }
                Operands::Order(parts) => this.order(parts),
                Operands::Found { .. } => {}
            }
            return;
        }

        let fd = match shell_openat(this.cwd, this.path.as_zstr(), O::RDONLY | O::DIRECTORY, 0) {
            Err(open_err) => {
                this.list_non_directory_operand(&open_err);
                return;
            }
            Ok(fd) => fd,
        };

        // `defer fd.close()` — emulate with a scope guard.
        struct CloseOnDrop(bun_sys::Fd);
        impl Drop for CloseOnDrop {
            fn drop(&mut self) {
                self.0.close();
            }
        }
        let _guard = CloseOnDrop(fd);

        if !this.opts.list_directories {
            if this.print_directory {
                this.output.extend_from_slice(this.path.as_bytes());
                this.output.extend_from_slice(b":\n");
            }

            let mut iterator = dir_iterator::iterate(fd);

            // If `-a` is used, "." and ".." should show up as results. However,
            // our `DirIterator` abstraction skips them, so add them now.
            this.add_dot_entries_if_needed(fd);

            loop {
                match iterator.next() {
                    Err(e) => {
                        this.errs.push(this.error_with_path(&e));
                        return;
                    }
                    Ok(None) => break,
                    Ok(Some(current)) => {
                        let name = current.name.slice_u8();
                        this.add_entry(name, fd);
                        if matches!(current.kind, bun_sys::EntryKind::Directory)
                            && this.opts.recursive
                        {
                            let slot = this.schedule_subtask(this.join(name));
                            this.children.push(slot);
                        }
                    }
                }
            }
            return;
        }

        this.output.extend_from_slice(this.path.as_bytes());
        this.output.push(b'\n');
    }

    /// Runs `stat` on each NUL-terminated operand: an entry, or a subtask for a directory.
    fn classify(&mut self, operands: Vec<u8>) -> Classified {
        let mut found = Vec::with_capacity(strings::count_char(&operands, 0));
        let mut rest = &operands[..];
        while let Some(len) = strings::index_of_char_usize(rest, 0) {
            let path = ZStr::from_buf(rest, len);
            let start = operands.len() - rest.len();
            rest = &rest[len + 1..];
            let name = path.as_bytes();
            let entry = self.output.len();
            let (directory, stat) = match self.stat_operand(path) {
                Err(e) => {
                    self.errs.push(e);
                    continue;
                }
                Ok(Operand::Entry(stat)) => {
                    self.add_operand(name, stat.as_ref());
                    (None, stat)
                }
                Ok(Operand::Directory(stat)) if !self.opts.list_directories => {
                    let slot = self.schedule_subtask(ZBox::from_bytes(name));
                    (Some(slot), Some(stat))
                }
                // `-d`: the name alone, and the directory has to open.
                Ok(Operand::Directory(stat)) => {
                    match shell_openat(self.cwd, path, O::RDONLY | O::DIRECTORY, 0) {
                        Ok(fd) => {
                            fd.close();
                            self.add_entry_short(name);
                            (None, Some(stat))
                        }
                        Err(e) => {
                            self.errs.push(e.with_path(name));
                            continue;
                        }
                    }
                }
            };
            let key = match (self.opts.sort, &stat) {
                (Sort::Time, Some(stat)) => {
                    let mtime = bun_sys::stat_mtime(stat);
                    (mtime.sec as i64, mtime.nsec as i64)
                }
                (Sort::Size, Some(stat)) => (stat.st_size as i64, 0),
                _ => (0, 0),
            };
            found.push(Found {
                name: start..start + len,
                entry: entry..self.output.len(),
                directory,
                key,
            });
        }
        Classified {
            entries: core::mem::take(&mut self.output),
            errs: core::mem::take(&mut self.errs),
            operands,
            found,
        }
    }

    /// The coreutils order: entries first, then each directory, each group sorted by the flags.
    fn order(&mut self, mut parts: Vec<Classified>) {
        struct Item<'a> {
            name: &'a [u8],
            entry: &'a [u8],
            directory: Option<u32>,
            key: (i64, i64),
        }
        let mut items: Vec<Item<'_>> =
            Vec::with_capacity(parts.iter().map(|part| part.found.len()).sum());
        for part in &parts {
            items.extend(part.found.iter().map(|found| Item {
                name: &part.operands[found.name.clone()],
                entry: &part.entries[found.entry.clone()],
                directory: found.directory,
                key: found.key,
            }));
        }

        let opts = self.opts;
        let order = |a: &Item<'_>, b: &Item<'_>| {
            let group = a.directory.is_some().cmp(&b.directory.is_some());
            if opts.sort == Sort::None {
                return group;
            }
            // The newest or the largest first, and then by name: the same on every platform.
            let by_name = || compare_source_paths(a.name, b.name).then_with(|| a.name.cmp(b.name));
            let sorted = b.key.cmp(&a.key).then_with(by_name);
            group.then(if opts.reverse {
                sorted.reverse()
            } else {
                sorted
            })
        };
        if !items.is_sorted_by(|a, b| order(a, b).is_le()) {
            index_sort::sort_slice_by(&mut items, order);
        }

        let (entries, directories) =
            items.split_at(items.partition_point(|item| item.directory.is_none()));
        self.children = directories
            .iter()
            .filter_map(|item| item.directory)
            .collect();
        // The entries of one pass that are in order already: its buffer is the output.
        let in_order = parts.len() == 1 && entries.is_sorted_by_key(|item| item.entry.as_ptr());
        if !in_order {
            self.output
                .reserve_exact(entries.iter().map(|item| item.entry.len()).sum());
            for item in entries {
                self.output.extend_from_slice(item.entry);
            }
        }
        for part in &mut parts {
            self.errs.append(&mut part.errs);
            if in_order {
                self.output = core::mem::take(&mut part.entries);
            }
        }
    }

    /// An operand that did not open as a directory.
    fn list_non_directory_operand(&mut self, open_err: &bun_sys::Error) {
        match self.stat_operand(self.path.as_zstr()) {
            Ok(Operand::Entry(stat)) => {
                let name = ZBox::from_bytes(self.path.as_bytes());
                self.add_operand(name.as_bytes(), stat.as_ref());
            }
            // A directory that would not open: report the open error.
            Ok(Operand::Directory(_)) => self.errs.push(self.error_with_path(open_err)),
            Err(e) => self.errs.push(e),
        }
    }

    /// coreutils operand rule: `stat`, and on ENOENT or ELOOP `lstat` so a symlink is itself.
    fn stat_operand(&self, path: &ZStr) -> bun_sys::Result<Operand> {
        let needs_lstat =
            self.opts.long_listing || matches!(self.opts.sort, Sort::Time | Sort::Size);
        match shell_statat(self.cwd, path) {
            Ok(stat) if S::ISDIR(stat.st_mode as _) => return Ok(Operand::Directory(stat)),
            // The name alone is printed, and the sort is by name.
            Ok(_) if !needs_lstat => return Ok(Operand::Entry(None)),
            Ok(_) => {}
            Err(e) if matches!(e.get_errno(), E::ENOENT | E::ELOOP) => {}
            Err(e) => return Err(e.with_path(path.as_bytes())),
        }
        match shell_lstatat(self.cwd, path) {
            Ok(stat) => Ok(Operand::Entry(needs_lstat.then_some(stat))),
            Err(e) => Err(e.with_path(path.as_bytes())),
        }
    }

    /// An operand is never subject to the -a/-A filter.
    fn add_operand(&mut self, name: &[u8], stat: Option<&bun_sys::Stat>) {
        match stat {
            Some(stat) if self.opts.long_listing => self.add_entry_long_from_stat(name, stat),
            _ => self.add_entry_short(name),
        }
    }

    fn should_skip_entry(&self, name: &[u8]) -> bool {
        match self.opts.dotfiles {
            DotfileMode::All => false,
            DotfileMode::AlmostAll => name == b"." || name == b"..",
            DotfileMode::Hide => name.first() == Some(&b'.'),
        }
    }

    // TODO more complex output like multi-column
    fn add_entry(&mut self, name: &[u8], dir_fd: bun_sys::Fd) {
        if self.should_skip_entry(name) {
            return;
        }
        if self.opts.long_listing {
            self.add_entry_long(name, dir_fd);
        } else {
            self.add_entry_short(name);
        }
    }

    fn add_entry_short(&mut self, name: &[u8]) {
        self.output.reserve(name.len() + 1);
        self.output.extend_from_slice(name);
        self.output.push(b'\n');
    }

    fn add_entry_long(&mut self, name: &[u8], dir_fd: bun_sys::Fd) {
        // Use lstatat to not follow symlinks (so symlinks show as 'l' type).
        let name_z = ZBox::from_bytes(name);
        match bun_sys::lstatat(dir_fd, name_z.as_zstr()) {
            Err(_) => {
                // If stat fails, just output the name with placeholders.
                self.output
                    .extend_from_slice(b"?????????? ? ? ? ?            ? ");
                self.output.extend_from_slice(name);
                self.output.push(b'\n');
            }
            Ok(stat) => self.add_entry_long_from_stat(name, &stat),
        }
    }

    fn add_entry_long_from_stat(&mut self, name: &[u8], stat: &bun_sys::Stat) {
        // File type and permissions.
        let mode: u32 = stat.st_mode as u32;
        let file_type = get_file_type_char(mode);
        let perms = format_permissions(mode);

        // Number of hard links.
        let nlink: u64 = stat.st_nlink as u64;

        // Owner and group (numeric).
        let uid: u64 = stat.st_uid as u64;
        let gid: u64 = stat.st_gid as u64;

        // File size.
        let size: i64 = stat.st_size as i64;

        // Modification time.
        let mtime = bun_sys::stat_mtime(stat);
        let time_str = format_time(mtime.sec, self.now_secs);

        self.output.push(file_type);
        self.output.extend_from_slice(&perms);
        let _ = write!(
            self.output,
            " {:>3} {:>5} {:>5} {:>8} ",
            nlink, uid, gid, size,
        );
        self.output.extend_from_slice(&time_str);
        self.output.push(b' ');
        self.output.extend_from_slice(name);
        self.output.push(b'\n');
    }

    fn add_dot_entries_if_needed(&mut self, dir_fd: bun_sys::Fd) {
        // `add_entry()` already checks if we can add "." and ".." to the result.
        self.add_entry(b".", dir_fd);
        self.add_entry(b"..", dir_fd);
    }

    fn error_with_path(&self, err: &bun_sys::Error) -> bun_sys::Error {
        err.with_path(self.path.as_bytes())
    }

    /// # Safety
    /// `this` must be a live heap allocation produced by
    /// [`ShellLsTask::create`]; ownership is reclaimed here.
    fn run_from_main_thread(this: NonNull<ShellLsTask>, interp: &Interpreter) {
        // SAFETY: precondition.
        let task = unsafe { bun_core::heap::take(this.as_ptr()) };
        let ShellLsTask {
            cmd,
            slot,
            errs,
            output,
            children,
            operands,
            ..
        } = *task;
        if let Some(operands) = operands {
            if let Operands::Found { part, classified } = *operands {
                return Ls::on_operands_classified(interp, cmd, part, classified);
            }
        }
        let section = Section {
            errs,
            output,
            children,
        };
        Ls::on_shell_ls_task_done(interp, cmd, slot, section);
    }
}

fn get_file_type_char(mode: u32) -> u8 {
    let file_type = mode & (S::IFMT as u32);
    match file_type {
        x if x == S::IFDIR as u32 => b'd',
        x if x == S::IFLNK as u32 => b'l',
        x if x == S::IFBLK as u32 => b'b',
        x if x == S::IFCHR as u32 => b'c',
        x if x == S::IFIFO as u32 => b'p',
        x if x == S::IFSOCK as u32 => b's',
        _ => b'-', // IFREG or unknown
    }
}

fn format_permissions(mode: u32) -> [u8; 9] {
    let mut perms = [b'-'; 9];
    // Owner permissions.
    perms[0] = if mode & (S::IRUSR as u32) != 0 {
        b'r'
    } else {
        b'-'
    };
    perms[1] = if mode & (S::IWUSR as u32) != 0 {
        b'w'
    } else {
        b'-'
    };
    // Owner execute with setuid handling.
    let owner_exec = mode & (S::IXUSR as u32) != 0;
    let setuid = mode & (S::ISUID as u32) != 0;
    perms[2] = if setuid {
        if owner_exec { b's' } else { b'S' }
    } else if owner_exec {
        b'x'
    } else {
        b'-'
    };

    // Group permissions.
    perms[3] = if mode & (S::IRGRP as u32) != 0 {
        b'r'
    } else {
        b'-'
    };
    perms[4] = if mode & (S::IWGRP as u32) != 0 {
        b'w'
    } else {
        b'-'
    };
    // Group execute with setgid handling.
    let group_exec = mode & (S::IXGRP as u32) != 0;
    let setgid = mode & (S::ISGID as u32) != 0;
    perms[5] = if setgid {
        if group_exec { b's' } else { b'S' }
    } else if group_exec {
        b'x'
    } else {
        b'-'
    };

    // Other permissions.
    perms[6] = if mode & (S::IROTH as u32) != 0 {
        b'r'
    } else {
        b'-'
    };
    perms[7] = if mode & (S::IWOTH as u32) != 0 {
        b'w'
    } else {
        b'-'
    };
    // Other execute with sticky bit handling.
    let other_exec = mode & (S::IXOTH as u32) != 0;
    let sticky = mode & (S::ISVTX as u32) != 0;
    perms[8] = if sticky {
        if other_exec { b't' } else { b'T' }
    } else if other_exec {
        b'x'
    } else {
        b'-'
    };

    perms
}

/// Format as `"Mon DD HH:MM"` for recent files
/// (within ~6 months) or `"Mon DD  YYYY"` for older files.
fn format_time(timestamp: i64, now_secs: u64) -> [u8; 12] {
    const MONTH_NAMES: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let mut buf = *b"??? ?? ??:??";
    let epoch_secs: u64 = if timestamp < 0 { 0 } else { timestamp as u64 };

    let secs_of_day = (epoch_secs % 86_400) as u32;
    let days = (epoch_secs / 86_400) as i64;
    let (year, month, day) = civil_from_days(days);
    let month_name = MONTH_NAMES[(month as usize).saturating_sub(1).min(11)];

    // Check if file is older than 6 months (approximately 180 days).
    const SIX_MONTHS_SECS: u64 = 180 * 24 * 60 * 60;
    let is_recent = epoch_secs > now_secs.saturating_sub(SIX_MONTHS_SECS)
        && epoch_secs <= now_secs.saturating_add(SIX_MONTHS_SECS);

    if is_recent {
        let hours = secs_of_day / 3600;
        let minutes = (secs_of_day / 60) % 60;
        let _ = bun_core::fmt::buf_print(
            &mut buf[..],
            format_args!("{} {:02} {:02}:{:02}", month_name, day, hours, minutes),
        );
    } else {
        // Show year for old files.
        let _ = bun_core::fmt::buf_print(
            &mut buf[..],
            format_args!("{} {:02}  {:4}", month_name, day, year),
        );
    }
    buf
}

/// Howard Hinnant's `civil_from_days` — converts days-since-1970-01-01 to a
/// proleptic-Gregorian (year, month[1..=12], day[1..=31]).
fn civil_from_days(z: i64) -> (i32, u8, u8) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = (z - era * 146_097) as u32; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u8; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u8; // [1, 12]
    ((y + (m <= 2) as i64) as i32, m, d)
}

impl bun_event_loop::Taskable for ShellLsTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellLsTask;
    /// A pool completion that will not run: drop the keep-alive and the box
    /// (nothing else frees an unrun one).
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract — the box the builtin scheduled.
        unsafe {
            (*this).task.unref_unrun();
            drop(bun_core::heap::take(this));
        }
    }
    /// See [`ShellTaskCtx`](crate::shell::interpreter::ShellTaskCtx): a step of a shell script always runs.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl crate::shell::interpreter::ShellTaskCtx for ShellLsTask {
    const TASK_OFFSET: usize = core::mem::offset_of!(Self, task);
    fn run_from_thread_pool(this: &mut Self) {
        Self::run_from_thread_pool(this)
    }
    fn run_from_main_thread(this: *mut Self, interp: &Interpreter) {
        // The `ShellTask` trampoline hands back the live, non-null heap
        // allocation produced by `ShellLsTask::create`.
        Self::run_from_main_thread(NonNull::new(this).unwrap(), interp)
    }
}

/// `-a` vs `-A`; the last one on the command line wins (GNU coreutils).
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum DotfileMode {
    #[default]
    Hide,
    /// `-A`, `--almost-all` — show dotfiles but skip `.` and `..`.
    AlmostAll,
    /// `-a`, `--all` — show everything including `.` and `..`.
    All,
}

/// Only the fields actually consulted are kept; the rest are recognised by
/// `parse_flag` but not stored.
#[derive(Clone, Copy, Default)]
pub(crate) struct Opts {
    pub(crate) dotfiles: DotfileMode,
    /// `-d`, `--directory` — list directories themselves, not their contents
    pub(crate) list_directories: bool,
    /// `-l` — use a long listing format
    pub(crate) long_listing: bool,
    /// `-R`, `--recursive` — list subdirectories recursively
    pub(crate) recursive: bool,
    /// `-r` — reverse the sort of the operands
    pub(crate) reverse: bool,
    pub(crate) sort: Sort,
}

/// How each group of operands is sorted. The last flag wins. A directory's entries stay unsorted.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum Sort {
    /// By name.
    #[default]
    Name,
    /// `-U`, `-f` — each group in the order of the command line.
    None,
    /// `-t` — by modification time, the newest first.
    Time,
    /// `-S` — by size, the largest first.
    Size,
}
