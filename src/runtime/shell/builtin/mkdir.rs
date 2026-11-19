use crate::node::fs::{MkdirCtx, NodeFS, args as fs_args};
use crate::node::types::PathLike;
use crate::shell::builtin::{BadFlag, Builtin, Kind};
use crate::shell::builtins::batch::Batch;
use crate::shell::interpreter::{Interpreter, NodeId, PoolTask, ShellTask, ShellWork};
use crate::shell::yield_::Yield;

const USAGE: &[u8] = b"usage: mkdir [-pv] [-m mode] directory_name ...\n";

pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
    let (flags, dirs) = Builtin::of(interp, cmd).split_flags();
    let mut opts = Opts::default();
    if let Err(flag) = flags.iter().try_for_each(|flag| opts.parse(flag)) {
        return Builtin::fail_flag(interp, cmd, flag);
    }
    if dirs.is_empty() {
        return Builtin::fail_usage(interp, cmd, USAGE);
    }
    Batch::start(interp, cmd, dirs.len());
    for dir in dirs {
        let task = ShellMkdirTask {
            cmd,
            opts,
            filepath: dir.to_vec(),
            cwd_path: Builtin::shell(interp, cmd).cwd().to_vec(),
            created_directories: Vec::new(),
            err: None,
        };
        PoolTask::schedule(interp, task);
    }
    Yield::suspended()
}

/// Runs `mkdir`/`mkdir -p` on a worker
/// thread, then bounces back to the main thread.
pub(crate) struct ShellMkdirTask {
    /// Owning Cmd node (the mkdir builtin's id).
    pub cmd: NodeId,
    pub opts: Opts,
    /// Owned copy of the target path (owned to avoid threading a lifetime
    /// through the WorkPool).
    pub filepath: Vec<u8>,
    pub cwd_path: Vec<u8>,
    pub created_directories: Vec<u8>,
    pub err: Option<bun_sys::Error>,
}

impl ShellWork for ShellMkdirTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellMkdirTask;

    fn run_from_thread_pool(&mut self, _: &ShellTask) {
        use bun_paths::{Platform, platform, resolve_path};
        // We have to give an absolute path to our mkdir implementation for it
        // to work with cwd.
        let mut spill = Vec::new();
        let filepath: &bun_core::ZStr = if Platform::AUTO.is_absolute(&self.filepath) {
            // Owned `Vec<u8>`; ensure NUL-terminated.
            if self.filepath.last() != Some(&0) {
                self.filepath.push(0);
            }
            bun_core::ZStr::from_slice_with_nul(&self.filepath)
        } else {
            resolve_path::join_z_spill::<platform::Auto>(
                &mut spill,
                &[&self.cwd_path, &self.filepath],
            )
        };

        // `NodeFS` expects the `Valid::path_too_long` bound its JS callers
        // enforce; past it, `PathLike::slice_z` yields "" and mkdir reports ENOENT.
        if filepath.len() >= bun_paths::MAX_PATH_BYTES {
            self.err = Some(
                bun_sys::Error::from_code(bun_sys::E::ENAMETOOLONG, bun_sys::Tag::mkdir)
                    .with_path(filepath.as_bytes()),
            );
            return;
        }

        let mut node_fs = NodeFS::default();
        let args = fs_args::Mkdir {
            path: PathLike::borrowed(filepath.as_bytes()),
            recursive: self.opts.parents,
            mode: fs_args::Mkdir::DEFAULT_MODE,
            always_return_none: true,
        };

        if self.opts.parents {
            let mut vtable = MkdirVerboseVTable {
                inner: &mut self.created_directories,
                active: self.opts.verbose,
            };
            if let Err(e) = node_fs.mkdir_recursive_impl(&args, &mut vtable) {
                self.err = Some(e.with_path(filepath.as_bytes()));
                core::hint::black_box(&node_fs);
            }
        } else {
            match node_fs.mkdir_non_recursive(&args) {
                Ok(_) => {
                    if self.opts.verbose {
                        self.created_directories
                            .extend_from_slice(filepath.as_bytes());
                        self.created_directories.push(b'\n');
                    }
                }
                Err(e) => {
                    self.err = Some(e.with_path(filepath.as_bytes()));
                    core::hint::black_box(&node_fs);
                }
            }
        }
    }

    fn run_from_main_thread(&mut self, interp: &Interpreter) -> Yield {
        let err = self.err.as_ref().map(|e| Kind::Mkdir.task_error(e));
        let out = core::mem::take(&mut self.created_directories);
        Batch::report(interp, self.cmd, err, out)
    }
}

/// Collects each created directory into
/// `created_directories` (newline-separated) when `-v` is set.
struct MkdirVerboseVTable<'a> {
    inner: &'a mut Vec<u8>,
    active: bool,
}

impl MkdirCtx for MkdirVerboseVTable<'_> {
    fn on_create_dir(&mut self, dirpath: &bun_paths::OSPathSliceZ) {
        if !self.active {
            return;
        }
        let out = &mut *self.inner;
        #[cfg(windows)]
        {
            let mut buf = bun_paths::path_buffer_pool::get();
            let str = bun_paths::strings::from_wpath(buf.as_mut(), dirpath.as_slice());
            out.extend_from_slice(str.as_bytes());
            out.push(b'\n');
        }
        #[cfg(not(windows))]
        {
            out.extend_from_slice(dirpath.as_bytes());
            out.push(b'\n');
        }
    }
}

#[derive(Default, Clone, Copy)]
pub(crate) struct Opts {
    /// `-p`, `--parents` — no error if existing, make parent directories as
    /// needed, with their file modes unaffected by any -m option.
    pub(crate) parents: bool,
    /// `-v`, `--verbose` — print a message for each created directory
    pub(crate) verbose: bool,
}

impl Opts {
    fn parse<'a>(&mut self, flag: &'a [u8]) -> Result<(), BadFlag<'a>> {
        match flag {
            b"-" => return Err(BadFlag::Illegal(flag)),
            b"--mode" => return Err(BadFlag::Unsupported(flag)),
            b"--parents" => self.parents = true,
            // The typo is kept for compatibility.
            b"--vebose" => self.verbose = true,
            _ => {
                for (i, ch) in flag.iter().enumerate().skip(1) {
                    match ch {
                        b'm' => return Err(BadFlag::Unsupported(b"-m ")),
                        b'p' => self.parents = true,
                        b'v' => self.verbose = true,
                        _ => return Err(BadFlag::Illegal(&flag[i + 1..])),
                    }
                }
            }
        }
        Ok(())
    }
}
