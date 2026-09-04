use std::sync::atomic::{AtomicBool, Ordering};

use bun_core::{ZBox, ZStr};
use bun_paths::{PathBuffer, resolve_path};
use bun_ptr::BackRef;

use crate::shell::ExitCode;
use crate::shell::builtin::{Builtin, BuiltinState, IoKind, Kind};
use crate::shell::interpreter::{Interpreter, NodeId, ShellTask, closefd, shell_openat};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Mv {
    pub args: MvArgs,
    pub(crate) state: MvState,
}

#[derive(Default)]
pub struct MvArgs {
    /// Index into argv where source paths start.
    pub(crate) sources_start: usize,
    /// argv[sources_start..target_idx] are sources; argv[target_idx] is dest.
    pub(crate) target_idx: usize,
    pub(crate) target_fd: Option<bun_sys::Fd>,
}

#[derive(Default)]
pub enum MvState {
    #[default]
    Idle,
    CheckTarget(Box<ShellMvCheckTargetTask>),
    Executing {
        task_count: usize,
        tasks_done: usize,
        error_signal: AtomicBool,
        tasks: Vec<ShellMvBatchedTask>,
        err: Option<bun_sys::Error>,
    },
    Done,
    WaitingWriteErr {
        exit_code: ExitCode,
    },
    Err,
}

/// mv uses its own simpler parser.
enum MvParseError {
    /// The rejected option byte.
    IllegalOption(u8),
    ShowUsage,
}

impl Mv {
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        Self::next(interp, cmd)
    }

    fn write_failing_error(
        interp: &Interpreter,
        cmd: NodeId,
        buf: &[u8],
        exit_code: ExitCode,
    ) -> Yield {
        if let Some(safeguard) = Builtin::of(interp, cmd).stderr.needs_io() {
            Self::state_mut(interp, cmd).state = MvState::WaitingWriteErr { exit_code };
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::of_mut(interp, cmd)
                .stderr
                .enqueue(child, buf, safeguard);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, buf);
        Builtin::done(interp, cmd, exit_code)
    }

    fn next(interp: &Interpreter, cmd: NodeId) -> Yield {
        // Read the tag, drop the borrow, then act.
        enum Tag {
            Idle,
            CheckTarget,
            Executing,
            WaitingWriteErr,
            Done,
            Err,
        }
        let tag = match Self::state_mut(interp, cmd).state {
            MvState::Idle => Tag::Idle,
            MvState::CheckTarget(_) => Tag::CheckTarget,
            MvState::Executing { .. } => Tag::Executing,
            MvState::WaitingWriteErr { .. } => Tag::WaitingWriteErr,
            MvState::Done => Tag::Done,
            MvState::Err => Tag::Err,
        };
        match tag {
            Tag::Idle => {
                if let Err(e) = Self::parse_opts(interp, cmd) {
                    let buf: Vec<u8> = match e {
                        MvParseError::IllegalOption(ch) => Builtin::fmt_error_arena(
                            interp,
                            cmd,
                            Some(Kind::Mv),
                            format_args!("illegal option -- {}\n", bstr::BStr::new(&[ch])),
                        )
                        .to_vec(),
                        MvParseError::ShowUsage => Kind::Mv.usage_string().to_vec(),
                    };
                    return Self::write_failing_error(interp, cmd, &buf, 1);
                }
                let cwd = Builtin::cwd(interp, cmd);
                let target_idx = Self::state_mut(interp, cmd).args.target_idx;
                let target = ZBox::from_bytes(Builtin::of(interp, cmd).arg_bytes(target_idx));
                let evtloop = Builtin::event_loop(interp, cmd);
                let mut task = Box::new(ShellMvCheckTargetTask {
                    cmd,
                    cwd,
                    target,
                    result: None,
                    done: false,
                    task: ShellTask::new(evtloop),
                });
                task.task.interp = interp.as_ctx_ptr();
                // SAFETY: `task` is heap-allocated and outlives the worker
                // call (held in `MvState::CheckTarget` below).
                unsafe { ShellTask::schedule(&raw mut *task) };
                Self::state_mut(interp, cmd).state = MvState::CheckTarget(task);
                Yield::suspended()
            }
            Tag::CheckTarget => {
                let done = match &Self::state_mut(interp, cmd).state {
                    MvState::CheckTarget(t) => t.done,
                    _ => unreachable!(),
                };
                if !done {
                    return Yield::suspended();
                }
                let result = match &mut Self::state_mut(interp, cmd).state {
                    MvState::CheckTarget(t) => t.result.take(),
                    _ => unreachable!(),
                };
                debug_assert!(result.is_some());
                let maybe_fd: Option<bun_sys::Fd> = match result.unwrap() {
                    Ok(fd) => fd,
                    Err(e) => {
                        // Only ENOENT (rename to a
                        // new path) is acceptable, and only with exactly
                        // one source. Any other errno (EACCES, ELOOP, …)
                        // is reported and fails regardless of source count.
                        let target = match &Self::state_mut(interp, cmd).state {
                            MvState::CheckTarget(t) => t.target.as_bytes().to_vec(),
                            _ => unreachable!(),
                        };
                        if e.get_errno() == bun_sys::E::ENOENT {
                            let n_sources = {
                                let me = Self::state_mut(interp, cmd);
                                me.args.target_idx - me.args.sources_start
                            };
                            if n_sources == 1 {
                                None
                            } else {
                                let buf = Builtin::fmt_error_arena(
                                    interp,
                                    cmd,
                                    Some(Kind::Mv),
                                    format_args!(
                                        "{}: No such file or directory\n",
                                        bstr::BStr::new(&target)
                                    ),
                                )
                                .to_vec();
                                return Self::write_failing_error(interp, cmd, &buf, 1);
                            }
                        } else {
                            let msg = e.msg().unwrap_or(b"unknown error");
                            let buf = Builtin::fmt_error_arena(
                                interp,
                                cmd,
                                Some(Kind::Mv),
                                format_args!(
                                    "{}: {}\n",
                                    bstr::BStr::new(&target),
                                    bstr::BStr::new(msg)
                                ),
                            )
                            .to_vec();
                            return Self::write_failing_error(interp, cmd, &buf, 1);
                        }
                    }
                };

                let n_sources = {
                    let me = Self::state_mut(interp, cmd);
                    me.args.target_fd = maybe_fd;
                    me.args.target_idx - me.args.sources_start
                };
                // Trying to move multiple files into a non-directory.
                if maybe_fd.is_none() && n_sources > 1 {
                    let target = match &Self::state_mut(interp, cmd).state {
                        MvState::CheckTarget(t) => t.target.as_bytes().to_vec(),
                        _ => unreachable!(),
                    };
                    let buf = Builtin::fmt_error_arena(
                        interp,
                        cmd,
                        Some(Kind::Mv),
                        format_args!("{} is not a directory\n", bstr::BStr::new(&target)),
                    )
                    .to_vec();
                    return Self::write_failing_error(interp, cmd, &buf, 1);
                }

                const BATCH: usize = ShellMvBatchedTask::BATCH_SIZE;
                let task_count = n_sources.div_ceil(BATCH);
                let cwd = Builtin::cwd(interp, cmd);
                let evtloop = Builtin::event_loop(interp, cmd);
                let (sources_start, target_idx) = {
                    let me = Self::state_mut(interp, cmd);
                    (me.args.sources_start, me.args.target_idx)
                };
                let target = Builtin::of(interp, cmd).arg_bytes(target_idx);

                let mut tasks: Vec<ShellMvBatchedTask> = Vec::with_capacity(task_count);
                for i in 0..task_count {
                    let start = sources_start + i * BATCH;
                    let end = (start + BATCH).min(target_idx);
                    let mut srcs = Vec::with_capacity(end - start);
                    for j in start..end {
                        srcs.push(ZBox::from_bytes(Builtin::of(interp, cmd).arg_bytes(j)));
                    }
                    tasks.push(ShellMvBatchedTask {
                        cmd,
                        idx: i,
                        sources: srcs,
                        target: ZBox::from_bytes(target),
                        target_fd: maybe_fd,
                        cwd,
                        error_signal: None,
                        err: None,
                        task: ShellTask::new(evtloop),
                    });
                }

                Self::state_mut(interp, cmd).state = MvState::Executing {
                    task_count,
                    tasks_done: 0,
                    error_signal: AtomicBool::new(false),
                    tasks,
                    err: None,
                };
                // Now that the AtomicBool has its final address, point
                // every task at it and schedule.
                let interp_ptr: *mut Interpreter = interp.as_ctx_ptr();
                if let MvState::Executing {
                    error_signal,
                    tasks,
                    ..
                } = &mut Self::state_mut(interp, cmd).state
                {
                    let sig = BackRef::new(&*error_signal);
                    for t in tasks.iter_mut() {
                        t.error_signal = Some(sig);
                        t.task.interp = interp_ptr;
                        // SAFETY: `t` lives in `MvState::Executing::tasks`,
                        // which is fully populated before any task is scheduled
                        // and never grown afterward, so its address is stable
                        // for the worker call's lifetime.
                        unsafe { ShellTask::schedule(&raw mut *t) };
                    }
                }
                Yield::suspended()
            }
            Tag::Executing => {
                // Shouldn't happen — driven by batchedMoveTaskDone.
                Yield::suspended()
            }
            Tag::WaitingWriteErr => Yield::failed(),
            Tag::Done => Builtin::done(interp, cmd, 0),
            Tag::Err => Builtin::done(interp, cmd, 1),
        }
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        e: Option<bun_sys::SystemError>,
    ) -> Yield {
        match Self::state_mut(interp, cmd).state {
            MvState::WaitingWriteErr { exit_code } => {
                if let Some(_err) = e {
                    Self::state_mut(interp, cmd).state = MvState::Err;
                    return Self::next(interp, cmd);
                }
                Builtin::done(interp, cmd, exit_code)
            }
            _ => panic!("Invalid state"),
        }
    }

    fn check_target_task_done(interp: &Interpreter, cmd: NodeId) {
        if let MvState::CheckTarget(t) = &mut Self::state_mut(interp, cmd).state {
            t.done = true;
        }
        Self::next(interp, cmd).run(interp);
    }

    fn batched_move_task_done(interp: &Interpreter, cmd: NodeId, task_idx: usize) {
        let (all_done, had_err) = {
            let MvState::Executing {
                task_count,
                tasks_done,
                error_signal,
                tasks,
                err,
            } = &mut Self::state_mut(interp, cmd).state
            else {
                unreachable!()
            };
            if let Some(e) = tasks[task_idx].err.take() {
                error_signal.store(true, Ordering::SeqCst);
                if err.is_none() {
                    *err = Some(e);
                }
            }
            *tasks_done += 1;
            (*tasks_done >= *task_count, err.is_some())
        };
        if all_done {
            if had_err {
                let e = match &mut Self::state_mut(interp, cmd).state {
                    MvState::Executing { err, .. } => err.take().unwrap(),
                    _ => unreachable!(),
                };
                // The failing rename's errno becomes the shell exit code.
                let exit_code = e.errno as ExitCode;
                let buf = Builtin::task_error_to_string(interp, cmd, Kind::Mv, &e).to_vec();
                Self::write_failing_error(interp, cmd, &buf, exit_code).run(interp);
                return;
            }
            Self::state_mut(interp, cmd).state = MvState::Done;
            Self::next(interp, cmd).run(interp);
        }
    }

    fn parse_opts(interp: &Interpreter, cmd: NodeId) -> Result<(), MvParseError> {
        let argc = Builtin::of(interp, cmd).args_slice().len();
        if argc == 0 {
            return Err(MvParseError::ShowUsage);
        }
        let mut idx = 0usize;
        while idx < argc {
            let flag = Builtin::of(interp, cmd).arg_bytes(idx);
            match Self::parse_flag(flag) {
                MvFlag::Done => {
                    let filepath_args = argc - idx;
                    if filepath_args < 2 {
                        return Err(MvParseError::ShowUsage);
                    }
                    let me = Self::state_mut(interp, cmd);
                    me.args.sources_start = idx;
                    me.args.target_idx = argc - 1;
                    return Ok(());
                }
                MvFlag::ContinueParsing => {}
                MvFlag::IllegalOption(ch) => return Err(MvParseError::IllegalOption(ch)),
            }
            idx += 1;
        }
        Err(MvParseError::ShowUsage)
    }

    fn parse_flag(flag: &[u8]) -> MvFlag {
        if flag.is_empty() || flag[0] != b'-' {
            return MvFlag::Done;
        }
        for &ch in &flag[1..] {
            match ch {
                b'f' | b'h' | b'i' | b'n' | b'v' => {}
                _ => return MvFlag::IllegalOption(ch),
            }
        }
        MvFlag::ContinueParsing
    }
}

impl Drop for Mv {
    /// Close the directory fd opened by
    /// `ShellMvCheckTargetTask` (`openat(target, O_RDONLY|O_DIRECTORY)`).
    /// `bun_sys::Fd` is `Copy` with no `Drop`, so without this every
    /// `mv srcs... dir/` leaks one open fd.
    fn drop(&mut self) {
        if let Some(fd) = self.args.target_fd.take() {
            closefd(fd);
        }
    }
}

enum MvFlag {
    ContinueParsing,
    Done,
    /// The rejected option byte.
    IllegalOption(u8),
}

/// `openat(target, O_RDONLY|O_DIRECTORY)`
/// on a worker thread to learn whether the destination is a directory.
pub struct ShellMvCheckTargetTask {
    pub(crate) cmd: NodeId,
    pub(crate) cwd: bun_sys::Fd,
    pub(crate) target: ZBox,
    /// `Ok(Some(fd))` → directory; `Ok(None)` → not a directory; `Err(e)` →
    /// open error (e.g. ENOENT).
    pub(crate) result: Option<Result<Option<bun_sys::Fd>, bun_sys::Error>>,
    pub(crate) done: bool,
    pub task: ShellTask,
}

impl ShellMvCheckTargetTask {
    fn run_from_thread_pool(this: &mut ShellMvCheckTargetTask) {
        let flags = bun_sys::O::RDONLY | bun_sys::O::DIRECTORY;
        this.result = Some(match shell_openat(this.cwd, &this.target, flags, 0) {
            Ok(fd) => Ok(Some(fd)),
            Err(e) if e.get_errno() == bun_sys::E::ENOTDIR => Ok(None),
            Err(e) => Err(e),
        });
        // Bounce-back is posted by `shell_task_trampoline`.
    }
}

/// renameat() each source into the target.
pub struct ShellMvBatchedTask {
    pub(crate) cmd: NodeId,
    /// Index into `MvState::Executing::tasks` so the main-thread completion
    /// can route to `Mv::batched_move_task_done`.
    pub(crate) idx: usize,
    pub(crate) sources: Vec<ZBox>,
    pub(crate) target: ZBox,
    pub(crate) target_fd: Option<bun_sys::Fd>,
    pub(crate) cwd: bun_sys::Fd,
    /// Back-reference into `MvState::Executing::error_signal`. The owning
    /// `MvState` outlives every batched task (tasks are joined / counted in
    /// `batched_move_task_done` before the state transitions), so the
    /// `BackRef` invariant holds. `None` only between construction and
    /// scheduling — never observed by `run_from_thread_pool`.
    pub(crate) error_signal: Option<BackRef<AtomicBool>>,
    pub(crate) err: Option<bun_sys::Error>,
    pub task: ShellTask,
}

impl ShellMvBatchedTask {
    const BATCH_SIZE: usize = 5;

    fn run_from_thread_pool(this: &mut ShellMvBatchedTask) {
        // Moving multiple entries into a directory.
        if this.sources.len() > 1 {
            return this.move_multiple_into_dir();
        }
        // Moving one entry into a directory.
        if let Some(dir) = this.target_fd {
            let mut buf = PathBuffer::uninit();
            if let Err(e) = Self::move_in_dir(
                this.cwd,
                dir,
                this.target.as_bytes(),
                &this.sources[0],
                &mut buf,
            ) {
                this.err = Some(e);
            }
            return;
        }
        // Rename single entry to a new path (target was not a directory).
        if let Err(e) = Self::do_rename(this.cwd, &this.sources[0], this.cwd, &this.target) {
            this.err = Some(if e.get_errno() == bun_sys::E::ENOTDIR {
                e.with_path(this.target.as_bytes())
            } else {
                e
            });
        }
        // Bounce-back is posted by `shell_task_trampoline`.
    }

    /// `renameat()`, falling through to [`Self::move_across_devices`] on EXDEV.
    fn do_rename(
        src_dir: bun_sys::Fd,
        src: &ZStr,
        dst_dir: bun_sys::Fd,
        dst: &ZStr,
    ) -> Result<(), bun_sys::Error> {
        match bun_sys::renameat(src_dir, src, dst_dir, dst) {
            Err(e) if e.get_errno() == bun_sys::E::EXDEV => {
                Self::move_across_devices(src_dir, src, dst_dir, dst).map_err(|e| {
                    if e.path.is_empty() {
                        e.with_path(src.as_bytes())
                    } else {
                        e
                    }
                })
            }
            r => r,
        }
    }

    /// EXDEV fallback: copy `src` to `dst`, then (only on success) remove `src`.
    fn move_across_devices(
        src_dir: bun_sys::Fd,
        src: &ZStr,
        dst_dir: bun_sys::Fd,
        dst: &ZStr,
    ) -> Result<(), bun_sys::Error> {
        use bun_sys::{Dir, E, File, O, S, Tag};

        let st = bun_sys::lstatat(src_dir, src)?;
        let mode = st.st_mode as bun_core::Mode;

        // Bind mounts can alias one inode through two vfsmounts (renameat()
        // still returns EXDEV); treat same-inode as the POSIX rename() no-op.
        if let Ok(d) = bun_sys::lstatat(dst_dir, dst) {
            if st.st_dev == d.st_dev && st.st_ino == d.st_ino {
                return Ok(());
            }
        }

        if S::ISLNK(mode) {
            let mut buf = bun_paths::path_buffer_pool::get();
            let n = bun_sys::readlinkat(src_dir, src, &mut buf[..])?;
            if n >= bun_paths::MAX_PATH_BYTES {
                return Err(bun_sys::Error::from_code(E::ENAMETOOLONG, Tag::readlink));
            }
            buf[n] = 0;
            let _ = bun_sys::unlinkat(dst_dir, dst);
            bun_sys::symlinkat(ZStr::from_buf(&buf[..], n), dst_dir, dst)?;
            return bun_sys::unlinkat(src_dir, src);
        }

        // Windows `lstatat` never reports S_IFLNK; follow there so a reparse-point source fails the dev/ino compare.
        let src_nofollow = if cfg!(windows) { 0 } else { O::NOFOLLOW };

        if S::ISDIR(mode) {
            let sd = Dir::from_fd(shell_openat(
                src_dir,
                src,
                O::RDONLY | O::DIRECTORY | src_nofollow,
                0,
            )?);
            let sst = bun_sys::fstat(sd.fd())?;
            if sst.st_dev != st.st_dev || sst.st_ino != st.st_ino {
                return Err(bun_sys::Error::from_code(E::ENOENT, Tag::rename));
            }
            let st = sst;
            let mode = st.st_mode as bun_core::Mode;
            // `| 0o700` so children can be written even when the source mode is read-only; restored via `fchmod` below.
            if let Err(e) = bun_sys::mkdirat(dst_dir, dst, (mode & 0o7777) | 0o700) {
                if e.get_errno() != E::EEXIST {
                    return Err(e);
                }
                // Refuse to merge into a non-empty dest (matches same-device `ENOTEMPTY`).
                bun_sys::rmdirat(dst_dir, dst)?;
                bun_sys::mkdirat(dst_dir, dst, (mode & 0o7777) | 0o700)?;
            }
            let dd = Dir::from_fd(shell_openat(
                dst_dir,
                dst,
                O::RDONLY | O::DIRECTORY | O::NOFOLLOW,
                0,
            )?);
            // Boxed: `WrappedIterator` embeds an 8 KB inline readdir buffer.
            let mut iter = Box::new(bun_sys::dir_iterator::iterate(sd.fd()));
            let mut nbuf = bun_paths::path_buffer_pool::get();
            while let Some(entry) = iter.next()? {
                let name = entry.name.slice_u8();
                if name.len() >= bun_paths::MAX_PATH_BYTES {
                    return Err(bun_sys::Error::from_code(E::ENAMETOOLONG, Tag::rename));
                }
                nbuf[..name.len()].copy_from_slice(name);
                nbuf[name.len()] = 0;
                let name_z = ZStr::from_buf(&nbuf[..], name.len());
                Self::move_across_devices(sd.fd(), name_z, dd.fd(), name_z)?;
            }
            #[cfg(unix)]
            let _ = bun_sys::fchown(dd.fd(), st.st_uid as _, st.st_gid as _);
            let _ = bun_sys::fchmod(dd.fd(), mode & 0o7777);
            drop((sd, dd));
            return bun_sys::rmdirat(src_dir, src);
        }

        if !S::ISREG(mode) {
            // Opening a FIFO `O_RDONLY` without `O_NONBLOCK` would block forever.
            return Err(bun_sys::Error::from_code(E::ENOTSUP, Tag::rename));
        }

        let in_ = File::openat(
            src_dir,
            src.as_bytes(),
            O::RDONLY | O::CLOEXEC | src_nofollow,
            0,
        )?;
        let fst = bun_sys::fstat(in_.fd())?;
        if fst.st_dev != st.st_dev || fst.st_ino != st.st_ino {
            return Err(bun_sys::Error::from_code(E::ENOENT, Tag::rename));
        }
        let st = fst;
        let mode = st.st_mode as bun_core::Mode;
        // Unlink first so a symlink-at-dest isn't followed by `O_TRUNC`; also avoids ETXTBUSY.
        let _ = bun_sys::unlinkat(dst_dir, dst);
        let out = File::openat(
            dst_dir,
            dst.as_bytes(),
            O::WRONLY | O::CREAT | O::TRUNC | O::CLOEXEC | O::NOFOLLOW,
            mode & 0o7777,
        )?;
        let _ = bun_sys::preallocate_file(out.fd().native(), 0, st.st_size as _);
        if let Err(e) = bun_sys::copy_file(in_.fd(), out.fd()) {
            drop(out);
            let _ = bun_sys::unlinkat(dst_dir, dst);
            return Err(e);
        }
        #[cfg(unix)]
        {
            // `fchown` first: Linux clears S_ISUID/S_ISGID on chown.
            let _ = bun_sys::fchown(out.fd(), st.st_uid as _, st.st_gid as _);
            let _ = bun_sys::fchmod(out.fd(), mode & 0o7777);
        }
        drop((in_, out));
        bun_sys::unlinkat(src_dir, src)
    }

    /// `renameat(cwd, src, target_fd, basename(src))`. A free fn over the
    /// fields it touches so `src` can borrow `self.sources[_]` while `self.err`
    /// is written by the caller.
    fn move_in_dir(
        cwd: bun_sys::Fd,
        target_fd: bun_sys::Fd,
        target: &[u8],
        src: &ZStr,
        buf: &mut PathBuffer,
    ) -> Result<(), bun_sys::Error> {
        let base = resolve_path::basename(src.as_bytes());
        let len =
            resolve_path::normalize_buf::<bun_paths::platform::Auto>(base, &mut buf[..]).len();
        if len + 1 >= bun_paths::MAX_PATH_BYTES {
            return Err(bun_sys::Error::from_code(
                bun_sys::E::ENAMETOOLONG,
                bun_sys::Tag::rename,
            ));
        }
        buf[len] = 0;
        let path_in_dir = ZStr::from_buf(buf.as_slice(), len);
        Self::do_rename(cwd, src, target_fd, path_in_dir).map_err(|e| {
            // Surface `target/basename(src)` as the failing path.
            let joined = resolve_path::join_z::<bun_paths::platform::Auto>(&[target, base]);
            e.with_path(joined.as_bytes())
        })
    }

    fn move_multiple_into_dir(&mut self) {
        let mut buf = PathBuffer::uninit();
        // `target_fd` is always Some when sources.len() > 1 — `next` rejected
        // the multi-source-into-non-directory case before scheduling.
        let dir = self.target_fd.expect("target_fd set for multi-source mv");
        for i in 0..self.sources.len() {
            if self
                .error_signal
                .is_some_and(|sig| sig.load(Ordering::SeqCst))
            {
                // Another batch hit an error — abort the move loop, but still
                // post back to the main thread so `tasks_done` reaches
                // `task_count` and `mv` doesn't hang.
                return;
            }
            if let Err(e) = Self::move_in_dir(
                self.cwd,
                dir,
                self.target.as_bytes(),
                &self.sources[i],
                &mut buf,
            ) {
                self.err = Some(e);
                return;
            }
        }
    }
}

impl bun_event_loop::Taskable for ShellMvCheckTargetTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellMvCheckTargetTask;
    /// Owned by the builtin's `MvState`, which frees it with the interpreter;
    /// only the keep-alive is this hop's to drop.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract; the Mv state outlives the queue entry.
        unsafe { (*this).task.unref_unrun() }
    }
}
impl bun_event_loop::Taskable for ShellMvBatchedTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellMvBatchedTask;
    /// An element of `MvState::Executing.tasks`; as `ShellMvCheckTargetTask`.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: as above.
        unsafe { (*this).task.unref_unrun() }
    }
}

// `*mut Self` sig is forced by the `ShellTaskCtx` trait contract; the body's
// internal deref is SAFETY-commented.
impl crate::shell::interpreter::ShellTaskCtx for ShellMvCheckTargetTask {
    const TASK_OFFSET: usize = core::mem::offset_of!(Self, task);
    fn run_from_thread_pool(this: &mut Self) {
        Self::run_from_thread_pool(this)
    }
    // `*mut Self` sig forced by `ShellTaskCtx` trait contract; the body's internal deref is SAFETY-commented.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    fn run_from_main_thread(this: *mut Self, interp: &Interpreter) {
        // SAFETY: `ShellTask::run_from_main_thread` dispatch contract — `this`
        // is a live `ShellMvCheckTargetTask` held in `MvState::CheckTarget`.
        let this = unsafe { this.as_ref() }.unwrap();
        Mv::check_target_task_done(interp, this.cmd);
    }
}

impl crate::shell::interpreter::ShellTaskCtx for ShellMvBatchedTask {
    const TASK_OFFSET: usize = core::mem::offset_of!(Self, task);
    fn run_from_thread_pool(this: &mut Self) {
        Self::run_from_thread_pool(this)
    }
    // `*mut Self` sig forced by `ShellTaskCtx` trait contract; the body's internal deref is SAFETY-commented.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    fn run_from_main_thread(this: *mut Self, interp: &Interpreter) {
        // SAFETY: `ShellTask::run_from_main_thread` dispatch contract — `this`
        // is a live `ShellMvBatchedTask` held in `MvState::Executing::tasks`.
        let this = unsafe { this.as_ref() }.unwrap();
        Mv::batched_move_task_done(interp, this.cmd, this.idx);
    }
}
