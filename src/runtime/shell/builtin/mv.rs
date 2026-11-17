use std::sync::atomic::{AtomicBool, Ordering};

use bstr::BStr;
use bun_core::{ZBox, ZStr, strings};
use bun_paths::{PathBuffer, resolve_path};
use bun_ptr::BackRef;

use crate::node::fs::{is_on_disk_at, note_moved_shell_operand, refuse_move};
use crate::shell::ExitCode;
use crate::shell::builtin::{BadFlag, Builtin, IoKind, Kind, State};
use crate::shell::interpreter::{
    Interpreter, NodeId, OwnedFd, PoolTask, ShellTask, ShellWork, shell_lstatat, shell_openat,
    shell_statat,
};
use crate::shell::yield_::Yield;

const USAGE: &[u8] = b"usage: mv [-f | -i | -n] [-hv] source target\n       mv [-f | -i | -n] [-v] source ... directory\n";

/// While [`ShellMvBatchedTask`]s are out.
pub(crate) struct Mv {
    /// Open for the tasks.
    _target_fd: Option<OwnedFd>,
    running: usize,
    /// The first one reported.
    err: Option<bun_sys::Error>,
}

pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
    let (flags, operands) = Builtin::of(interp, cmd).split_flags();
    let mut no_clobber = false;
    for ch in flags.iter().flat_map(|flag| flag.iter().skip(1)) {
        match ch {
            // The last of `-f` and `-n` wins.
            b'n' => no_clobber = true,
            b'f' => no_clobber = false,
            b'h' | b'i' | b'v' => {}
            _ => return Builtin::fail_flag(interp, cmd, BadFlag::Illegal(b"-")),
        }
    }
    let [_, .., target] = operands else {
        return Builtin::fail_usage(interp, cmd, USAGE);
    };
    let task = ShellMvCheckTargetTask {
        cmd,
        cwd: Builtin::cwd(interp, cmd),
        target: ZBox::from_bytes(target.get()),
        no_clobber,
        result: Ok(None),
    };
    PoolTask::schedule(interp, task);
    Yield::suspended()
}

/// `openat(target, O_RDONLY|O_DIRECTORY)`
/// on a worker thread to learn whether the destination is a directory.
pub(crate) struct ShellMvCheckTargetTask {
    pub(crate) cmd: NodeId,
    pub(crate) cwd: bun_sys::Fd,
    pub(crate) target: ZBox,
    /// `-n` — do not overwrite an existing file
    no_clobber: bool,
    /// `Ok(Some(fd))` → directory; `Ok(None)` → not a directory; `Err(e)` →
    /// open error (e.g. ENOENT).
    pub(crate) result: Result<Option<OwnedFd>, bun_sys::Error>,
}

impl ShellWork for ShellMvCheckTargetTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellMvCheckTargetTask;
    fn run_from_thread_pool(&mut self, _: &ShellTask) {
        let flags = bun_sys::O::RDONLY | bun_sys::O::DIRECTORY;
        self.result = match shell_openat(self.cwd, &self.target, flags, 0) {
            Ok(fd) => Ok(Some(OwnedFd(fd))),
            Err(e) if e.get_errno() == bun_sys::E::ENOTDIR => Ok(None),
            Err(e) => Err(e),
        };
    }
    fn run_from_main_thread(&mut self, interp: &Interpreter) -> Yield {
        let cmd = self.cmd;
        let [sources @ .., _] = Builtin::of(interp, cmd).split_flags().1 else {
            return Builtin::fail_usage(interp, cmd, USAGE);
        };
        let target = BStr::new(self.target.as_bytes());
        let target_fd = match core::mem::replace(&mut self.result, Ok(None)) {
            Ok(None) if sources.len() > 1 => {
                return Builtin::fail(interp, cmd, format_args!("{target} is not a directory\n"));
            }
            Ok(fd) => fd,
            Err(e) if e.get_errno() != bun_sys::E::ENOENT => {
                let words = BStr::new(e.msg().unwrap_or(b"unknown error"));
                return Builtin::fail(interp, cmd, format_args!("{target}: {words}\n"));
            }
            Err(_) if sources.len() > 1 => {
                let words = "No such file or directory";
                return Builtin::fail(interp, cmd, format_args!("{target}: {words}\n"));
            }
            Err(_) => None,
        };

        let batches = sources.chunks(ShellMvBatchedTask::BATCH_SIZE);
        let cwd = Builtin::cwd(interp, cmd);
        let fd = target_fd.as_ref().map(OwnedFd::fd);
        Builtin::of_mut(interp, cmd).state = State::Mv(Mv {
            _target_fd: target_fd,
            running: batches.len(),
            err: None,
        });
        let error_signal = BackRef::new(&Builtin::of(interp, cmd).stop);
        // `was_on_disk` is read before anything moves.
        let mut tasks = Vec::with_capacity(batches.len());
        for batch in batches {
            tasks.push(ShellMvBatchedTask {
                cmd,
                sources: batch.iter().map(|it| ZBox::from_bytes(it.get())).collect(),
                was_on_disk: batch.iter().map(|it| is_on_disk_at(cwd, it)).collect(),
                target: self.target.clone(),
                target_fd: fd,
                no_clobber: self.no_clobber,
                cwd,
                error_signal,
                err: None,
            });
        }
        for task in tasks {
            PoolTask::schedule(interp, task);
        }
        Yield::suspended()
    }
}

/// renameat() each source into the target.
pub(crate) struct ShellMvBatchedTask {
    pub(crate) cmd: NodeId,
    pub(crate) sources: Vec<ZBox>,
    /// Which of them the disk has had.
    was_on_disk: Vec<bool>,
    pub(crate) target: ZBox,
    pub(crate) target_fd: Option<bun_sys::Fd>,
    pub(crate) no_clobber: bool,
    pub(crate) cwd: bun_sys::Fd,
    /// [`Builtin::stop`]
    pub(crate) error_signal: BackRef<AtomicBool>,
    pub(crate) err: Option<bun_sys::Error>,
}

impl ShellWork for ShellMvBatchedTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellMvBatchedTask;

    fn run_from_thread_pool(&mut self, _: &ShellTask) {
        // Moving multiple entries into a directory.
        if self.sources.len() > 1 {
            return self.move_multiple_into_dir();
        }
        // Moving one entry into a directory.
        if let Some(dir) = self.target_fd {
            let mut buf = bun_paths::path_buffer_pool::get();
            if let Err(e) = Self::move_in_dir(
                self.cwd,
                dir,
                self.target.as_bytes(),
                &self.sources[0],
                self.no_clobber,
                &mut buf,
            ) {
                self.err = Some(e);
            }
            return;
        }
        // Rename single entry to a new path (target was not a directory).
        if let Err(e) = Self::do_rename(
            self.cwd,
            &self.sources[0],
            self.cwd,
            &self.target,
            self.no_clobber,
        ) {
            self.err = Some(if e.get_errno() == bun_sys::E::ENOTDIR {
                e.with_path(self.target.as_bytes())
            } else {
                e
            });
        }
    }

    fn run_from_main_thread(&mut self, interp: &Interpreter) -> Yield {
        let cmd = self.cmd;
        let bltn = Builtin::of_mut(interp, cmd);
        let State::Mv(mv) = &mut bltn.state else {
            return Yield::suspended();
        };
        mv.running = mv.running.saturating_sub(1);
        if let Some(e) = self.err.take() {
            bltn.stop.store(true, Ordering::SeqCst);
            mv.err.get_or_insert(e);
        }
        self.note_moved(Builtin::shell(interp, cmd).cwd());
        if mv.running > 0 {
            return Yield::suspended();
        }
        let Some(e) = mv.err.take() else {
            return Builtin::done(interp, cmd, 0);
        };
        let message = Kind::Mv.task_error(&e);
        Builtin::finish(interp, cmd, IoKind::Stderr, &message, e.errno as ExitCode)
    }
}

impl ShellMvBatchedTask {
    const BATCH_SIZE: usize = 5;

    /// A task that fails has moved those in front, and `-n` leaves some where they are.
    fn note_moved(&self, cwd: &[u8]) {
        let sources = self.sources.iter().zip(&self.was_on_disk);
        for (source, _) in sources.filter(|&(_, &was_on_disk)| was_on_disk) {
            let (source, target) = (source.as_bytes(), self.target.as_bytes());
            let name = bun_paths::basename(strings::without_trailing_slash(source));
            match self.target_fd {
                Some(_) => note_moved_shell_operand(cwd, source, &[target, b"/", name].concat()),
                None => note_moved_shell_operand(cwd, source, target),
            }
        }
    }

    /// `renameat()`, falling through to [`Self::move_across_devices`] on EXDEV.
    fn do_rename(
        src_dir: bun_sys::Fd,
        src: &ZStr,
        dst_dir: bun_sys::Fd,
        dst: &ZStr,
        no_clobber: bool,
    ) -> Result<(), bun_sys::Error> {
        use bun_sys::E;

        if let Some(error) = refuse_move((src_dir, src.as_bytes()), (dst_dir, dst.as_bytes())) {
            return Err(error);
        }
        if no_clobber {
            if shell_lstatat(dst_dir, dst).is_ok() {
                // `dst` stays. A missing `src` is still an error.
                return shell_lstatat(src_dir, src)
                    .map(drop)
                    .map_err(|e| e.with_path(src.as_bytes()));
            }
            // Where the kernel and the filesystem can, also refuse a `dst` created since the check.
            #[cfg(unix)]
            {
                // EXDEV is handled below.
                const UNSUPPORTED: [E; 5] =
                    [E::ENOSYS, E::EINVAL, E::ENOTSUP, E::EOPNOTSUPP, E::EXDEV];
                let mode = bun_sys::RenameMode::NoReplace;
                match bun_sys::renameat2(src_dir, src, dst_dir, dst, mode) {
                    Err(e) if e.get_errno() == E::EEXIST => return Ok(()),
                    Err(e) if UNSUPPORTED.contains(&e.get_errno()) => {}
                    result => return result,
                }
            }
        }
        match bun_sys::renameat(src_dir, src, dst_dir, dst) {
            Err(e) if e.get_errno() == E::EXDEV => {
                Self::move_across_devices(src_dir, src, dst_dir, dst, None).map_err(|e| {
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
    ///
    /// `output` is `None` for `mv`'s operand. Below the operand, it's the `(st_dev, st_ino)` of the
    /// directory being copied into. The walk must not enter it, or it would copy its own output.
    fn move_across_devices(
        src_dir: bun_sys::Fd,
        src: &ZStr,
        dst_dir: bun_sys::Fd,
        dst: &ZStr,
        output: Option<(u64, u64)>,
    ) -> Result<(), bun_sys::Error> {
        use bun_sys::{Dir, E, File, O, S, Tag};

        let st = bun_sys::lstatat(src_dir, src)?;
        let mode = st.st_mode as bun_core::Mode;

        if let Some((dev, ino)) = output {
            // A filesystem without inode numbers reports `st_ino == 0`.
            if S::ISDIR(mode)
                && st.st_ino != 0
                && st.st_dev as u64 == dev
                && st.st_ino as u64 == ino
            {
                // `rename(2)` fails with EINVAL when a directory is moved into itself on the same mount.
                return Err(bun_sys::Error::from_code(E::EINVAL, Tag::rename));
            }
        }

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
            let target = ZStr::nul_terminate(&mut buf, n);
            let _ = bun_sys::unlinkat(dst_dir, dst);
            bun_sys::symlinkat(target, dst_dir, dst)?;
            return bun_sys::unlinkat(src_dir, src);
        }

        // Windows `lstatat` never reports S_IFLNK; follow there so a reparse-point source fails the dev/ino compare.
        let src_nofollow = if cfg!(windows) { 0 } else { O::NOFOLLOW };

        if S::ISDIR(mode) {
            // This function recurses once per directory level.
            if !bun_core::StackCheck::init().is_safe_to_recurse() {
                return Err(bun_sys::Error::from_code(E::ENAMETOOLONG, Tag::rename));
            }
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
            let output = match output {
                Some(id) => id,
                None => Self::output_directory(dst_dir, dst, &st)?,
            };
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
            while let Some(entry) = iter.next()? {
                let name = entry.name.as_zstr();
                Self::move_across_devices(sd.fd(), name, dd.fd(), name, Some(output))?;
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

    /// Returns the `(st_dev, st_ino)` of the directory `dst` is created in. Fails with `EINVAL`,
    /// like `rename(2)` on the same mount, if that directory is `src` or is inside `src`.
    fn output_directory(
        dst_dir: bun_sys::Fd,
        dst: &ZStr,
        src: &bun_sys::Stat,
    ) -> Result<(u64, u64), bun_sys::Error> {
        use bun_sys::{E, Tag};

        let is_src = |dir: &bun_sys::Stat| {
            src.st_ino != 0 && dir.st_dev == src.st_dev && dir.st_ino == src.st_ino
        };

        let mut path = bun_paths::path_buffer_pool::get();
        let mut len = 0;
        let made_in = match bun_paths::dirname(dst.as_bytes()) {
            None => bun_sys::fstat(dst_dir)?,
            Some(dir) => {
                if dir.len() >= bun_paths::MAX_PATH_BYTES {
                    return Err(bun_sys::Error::from_code(E::ENAMETOOLONG, Tag::rename));
                }
                path[..dir.len()].copy_from_slice(dir);
                len = dir.len();
                shell_statat(dst_dir, ZStr::nul_terminate(&mut path, len))?
            }
        };
        if is_src(&made_in) {
            return Err(bun_sys::Error::from_code(E::EINVAL, Tag::rename));
        }

        // Check each parent by appending `..` until the root, where `..` resolves to itself.
        let mut below = (made_in.st_dev, made_in.st_ino);
        loop {
            let up: &[u8] = if len == 0 { b".." } else { b"/.." };
            if len + up.len() >= bun_paths::MAX_PATH_BYTES {
                break;
            }
            path[len..len + up.len()].copy_from_slice(up);
            len += up.len();
            // Stop at a parent we can't stat. `move_across_devices` still checks every directory it enters.
            let Ok(parent) = shell_statat(dst_dir, ZStr::nul_terminate(&mut path, len)) else {
                break;
            };
            if (parent.st_dev, parent.st_ino) == below {
                break;
            }
            if is_src(&parent) {
                return Err(bun_sys::Error::from_code(E::EINVAL, Tag::rename));
            }
            below = (parent.st_dev, parent.st_ino);
        }
        Ok((made_in.st_dev as u64, made_in.st_ino as u64))
    }

    /// `renameat(cwd, src, target_fd, basename(src))`. A free fn over the
    /// fields it touches so `src` can borrow `self.sources[_]` while `self.err`
    /// is written by the caller.
    fn move_in_dir(
        cwd: bun_sys::Fd,
        target_fd: bun_sys::Fd,
        target: &[u8],
        src: &ZStr,
        no_clobber: bool,
        buf: &mut PathBuffer,
    ) -> Result<(), bun_sys::Error> {
        let base = resolve_path::basename(src.as_bytes());
        // `normalize_buf_z` doesn't bounds-check `buf`. It can add one byte
        // (`""` becomes `"."`), and the NUL needs one more.
        let result = if base.len() + 1 >= bun_paths::MAX_PATH_BYTES {
            Err(bun_sys::Error::from_code(
                bun_sys::E::ENAMETOOLONG,
                bun_sys::Tag::rename,
            ))
        } else {
            let path_in_dir =
                resolve_path::normalize_buf_z::<bun_paths::platform::Auto>(base, &mut buf[..]);
            Self::do_rename(cwd, src, target_fd, path_in_dir, no_clobber)
        };
        result.map_err(|e| {
            // Surface `target/basename(src)` as the failing path.
            let mut spill = Vec::new();
            let joined =
                resolve_path::join_spill::<bun_paths::platform::Auto>(&mut spill, &[target, base]);
            e.with_path(joined)
        })
    }

    fn move_multiple_into_dir(&mut self) {
        let mut buf = bun_paths::path_buffer_pool::get();
        // More than one source is only scheduled into a directory.
        let dir = self.target_fd.expect("target_fd set for multi-source mv");
        for i in 0..self.sources.len() {
            // Another batch has failed.
            if self.error_signal.load(Ordering::SeqCst) {
                return;
            }
            if let Err(e) = Self::move_in_dir(
                self.cwd,
                dir,
                self.target.as_bytes(),
                &self.sources[i],
                self.no_clobber,
                &mut buf,
            ) {
                self.err = Some(e);
                return;
            }
        }
    }
}
