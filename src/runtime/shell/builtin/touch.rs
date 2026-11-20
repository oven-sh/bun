use crate::shell::builtin::{BadFlag, Builtin, Kind};
use crate::shell::builtins::batch::Batch;
use crate::shell::interpreter::{Interpreter, NodeId, PoolTask, ShellTask, ShellWork};
use crate::shell::yield_::Yield;

const USAGE: &[u8] = b"usage: touch [-A [-][[hh]mm]SS] [-achm] [-r file] [-t [[CC]YY]MMDDhhmm[.SS]]\n       [-d YYYY-MM-DDThh:mm:SS[.frac][tz]] file ...\n";

pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
    let (flags, files) = Builtin::of(interp, cmd).split_flags();
    if let [flag, ..] = flags {
        return Builtin::fail_flag(interp, cmd, reject(flag));
    }
    if files.is_empty() {
        return Builtin::fail_usage(interp, cmd, USAGE);
    }
    Batch::start(interp, cmd, files.len());
    for file in files {
        let task = ShellTouchTask {
            cmd,
            filepath: file.to_vec(),
            cwd_path: Builtin::shell(interp, cmd).cwd().to_vec(),
            err: None,
        };
        PoolTask::schedule(interp, task);
    }
    Yield::suspended()
}

fn reject(flag: &[u8]) -> BadFlag<'_> {
    match flag {
        [] | [_] => BadFlag::Illegal(flag),
        b"--no-create" | b"--date" => BadFlag::Unsupported(flag),
        b"--reference" | b"--time" => BadFlag::Unsupported(b"--reference=FILE"),
        [_, b'a' | b'c' | b'd' | b'h' | b'm' | b'r' | b't', ..] => BadFlag::Unsupported(&flag[..2]),
        [_, _, rest @ ..] => BadFlag::Illegal(rest),
    }
}

/// utimes() the path (creating it on ENOENT) on a worker thread.
pub(crate) struct ShellTouchTask {
    pub(crate) cmd: NodeId,
    pub(crate) filepath: Vec<u8>,
    pub(crate) cwd_path: Vec<u8>,
    pub(crate) err: Option<bun_sys::Error>,
}

impl ShellWork for ShellTouchTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellTouchTask;

    /// utimes() the path; on ENOENT
    /// fall back to `open(O_CREAT|O_WRONLY, 0o664)`.
    fn run_from_thread_pool(&mut self, _: &ShellTask) {
        use bun_paths::resolve_path::{self, Platform, platform};
        // We have to give an absolute path. An operand that does not fit the
        // path buffer is still passed on whole, so the OS reports ENAMETOOLONG
        // for it like for any other operand.
        let mut spill = Vec::new();
        let filepath: &bun_core::ZStr = if Platform::AUTO.is_absolute(&self.filepath) {
            // Re-terminate (`filepath` is the bare argv bytes without the
            // trailing NUL).
            resolve_path::join_z_spill::<platform::Auto>(&mut spill, &[&self.filepath])
        } else {
            resolve_path::join_z_spill::<platform::Auto>(
                &mut spill,
                &[&self.cwd_path, &self.filepath],
            )
        };

        // Call the bun_sys layer directly (uv_fs_utime on Windows) to avoid
        // the heavyweight NodeFS state.
        let milliseconds = bun_core::time::milli_timestamp();
        let atime = bun_sys::TimeLike {
            sec: milliseconds.div_euclid(1_000),
            nsec: milliseconds.rem_euclid(1_000) * 1_000_000,
        };
        let mtime = atime;
        if let Err(err) = bun_sys::utimens(filepath, atime, mtime) {
            'out: {
                // The executable holds it: it is there.
                if err.get_errno() == bun_sys::E::ENOENT
                    && crate::node::fs::is_embedded_source_file(filepath.as_bytes())
                {
                    break 'out;
                }
                if err.get_errno() == bun_sys::E::ENOENT {
                    const PERM: bun_sys::Mode = 0o664;
                    let flags = bun_sys::O::CREAT | bun_sys::O::WRONLY;
                    match bun_sys::File::open(filepath, flags, PERM) {
                        Ok(_) => break 'out,
                        Err(e) => {
                            self.err = Some(e.with_path(filepath.as_bytes()));
                            break 'out;
                        }
                    }
                }
                self.err = Some(err.with_path(filepath.as_bytes()));
            }
        }
    }

    fn run_from_main_thread(&mut self, interp: &Interpreter) -> Yield {
        let err = self.err.as_ref().map(|e| Kind::Touch.task_error(e));
        Batch::report(interp, self.cmd, err, Vec::new())
    }
}
