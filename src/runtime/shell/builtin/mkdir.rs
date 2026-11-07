use crate::node::fs::{MkdirCtx, NodeFS, args as fs_args};
use crate::node::types::PathLike;
use crate::shell::builtin::Kind;
use crate::shell::builtins::operands::{self, OperandBuiltin, OperandWalkTask, Walk};
use crate::shell::interpreter::{FlagParser, Interpreter, NodeId, ParseFlagResult};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub(crate) struct Mkdir {
    walk: Walk,
}

pub(crate) type ShellMkdirTask = OperandWalkTask<Mkdir>;

impl Mkdir {
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        operands::start::<Self>(interp, cmd)
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _written: usize,
        _e: Option<bun_sys::SystemError>,
    ) -> Yield {
        operands::on_io_writer_chunk::<Self>(interp, cmd)
    }
}

impl OperandBuiltin for Mkdir {
    const KIND: Kind = Kind::Mkdir;
    const TASK_TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellMkdirTask;
    type Opts = Opts;

    fn walk_state(&mut self) -> &mut Walk {
        &mut self.walk
    }

    fn run_operand(
        opts: Opts,
        cwd: &[u8],
        operand: &bun_core::ZStr,
        spill: &mut Vec<u8>,
        stdout: &mut Vec<u8>,
    ) -> bun_sys::Result<()> {
        use bun_paths::{Platform, platform, resolve_path};
        // We have to give an absolute path to our mkdir implementation for it
        // to work with cwd.
        let filepath: &bun_core::ZStr = if Platform::AUTO.is_absolute(operand.as_bytes()) {
            operand
        } else {
            resolve_path::join_z_spill::<platform::Auto>(spill, &[cwd, operand.as_bytes()])
        };

        // `NodeFS` expects the `Valid::path_too_long` bound its JS callers
        // enforce; past it, `PathLike::slice_z` yields "" and mkdir reports ENOENT.
        if filepath.len() >= bun_paths::MAX_PATH_BYTES {
            return Err(
                bun_sys::Error::from_code(bun_sys::E::ENAMETOOLONG, bun_sys::Tag::mkdir)
                    .with_path(filepath.as_bytes()),
            );
        }

        let mut node_fs = NodeFS::default();
        let args = fs_args::Mkdir {
            path: PathLike::borrowed(filepath.as_bytes()),
            recursive: opts.parents,
            mode: fs_args::Mkdir::DEFAULT_MODE,
            always_return_none: true,
        };

        if opts.parents {
            let mut vtable = MkdirVerboseVTable {
                inner: stdout,
                active: opts.verbose,
            };
            node_fs
                .mkdir_recursive_impl(&args, &mut vtable)
                .map_err(|e| e.with_path(filepath.as_bytes()))?;
        } else {
            node_fs
                .mkdir_non_recursive(&args)
                .map_err(|e| e.with_path(filepath.as_bytes()))?;
            if opts.verbose {
                stdout.extend_from_slice(filepath.as_bytes());
                stdout.push(b'\n');
            }
        }
        Ok(())
    }
}

/// Collects each created directory into the operand's stdout when `-v` is set.
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

impl FlagParser for Opts {
    fn parse_long<'a>(&mut self, flag: &'a [u8]) -> Option<ParseFlagResult<'a>> {
        if flag == b"--mode" {
            return Some(ParseFlagResult::Unsupported(b"--mode"));
        }
        if flag == b"--parents" {
            self.parents = true;
            return Some(ParseFlagResult::ContinueParsing);
        }
        // Note: the `--vebose` typo is intentional (kept for compatibility).
        if flag == b"--vebose" {
            self.verbose = true;
            return Some(ParseFlagResult::ContinueParsing);
        }
        None
    }

    fn parse_short<'a>(
        &mut self,
        ch: u8,
        smallflags: &'a [u8],
        i: usize,
    ) -> Option<ParseFlagResult<'a>> {
        match ch {
            b'm' => Some(ParseFlagResult::Unsupported(b"-m ")),
            b'p' => {
                self.parents = true;
                None
            }
            b'v' => {
                self.verbose = true;
                None
            }
            _ => Some(ParseFlagResult::IllegalOption(&smallflags[1 + i..])),
        }
    }
}
