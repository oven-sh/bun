use crate::shell::builtin::Kind;
use crate::shell::builtins::operands::{self, OperandBuiltin, OperandWalkTask, Walk};
use crate::shell::interpreter::{FlagParser, Interpreter, NodeId, ParseFlagResult};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub(crate) struct Touch {
    walk: Walk,
}

pub(crate) type ShellTouchTask = OperandWalkTask<Touch>;

impl Touch {
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

impl OperandBuiltin for Touch {
    const KIND: Kind = Kind::Touch;
    const TASK_TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellTouchTask;
    type Opts = Opts;

    fn walk_state(&mut self) -> &mut Walk {
        &mut self.walk
    }

    /// utimes() the path; on ENOENT
    /// fall back to `open(O_CREAT|O_WRONLY, 0o664)`.
    fn run_operand(
        _: Opts,
        cwd: &[u8],
        operand: &bun_core::ZStr,
        spill: &mut Vec<u8>,
        _: &mut Vec<u8>,
    ) -> bun_sys::Result<()> {
        use bun_paths::resolve_path::{self, Platform, platform};
        use bun_sys::FdExt as _;
        // We have to give an absolute path. An operand that does not fit the
        // path buffer is still passed on whole, so the OS reports ENAMETOOLONG
        // for it like for any other operand.
        let filepath: &bun_core::ZStr = if Platform::AUTO.is_absolute(operand.as_bytes()) {
            resolve_path::join_z_spill::<platform::Auto>(spill, &[operand.as_bytes()])
        } else {
            resolve_path::join_z_spill::<platform::Auto>(spill, &[cwd, operand.as_bytes()])
        };

        // Call the bun_sys layer directly (uv_fs_utime on Windows) to avoid
        // the heavyweight NodeFS state.
        let milliseconds = bun_core::time::milli_timestamp();
        let atime = bun_sys::TimeLike {
            sec: milliseconds.div_euclid(1_000),
            nsec: milliseconds.rem_euclid(1_000) * 1_000_000,
        };
        let mtime = atime;
        let Err(err) = bun_sys::utimens(filepath, atime, mtime) else {
            return Ok(());
        };
        if err.get_errno() != bun_sys::E::ENOENT {
            return Err(err.with_path(filepath.as_bytes()));
        }
        const PERM: bun_sys::Mode = 0o664;
        let fd = bun_sys::open(filepath, bun_sys::O::CREAT | bun_sys::O::WRONLY, PERM)
            .map_err(|e| e.with_path(filepath.as_bytes()))?;
        fd.close();
        Ok(())
    }
}

#[derive(Clone, Copy, Default)]
pub(crate) struct Opts {}

impl FlagParser for Opts {
    fn parse_long<'a>(&mut self, flag: &'a [u8]) -> Option<ParseFlagResult<'a>> {
        match flag {
            b"--no-create" => Some(ParseFlagResult::Unsupported(b"--no-create")),
            b"--date" => Some(ParseFlagResult::Unsupported(b"--date")),
            b"--reference" => Some(ParseFlagResult::Unsupported(b"--reference=FILE")),
            b"--time" => Some(ParseFlagResult::Unsupported(b"--reference=FILE")),
            _ => None,
        }
    }

    fn parse_short<'a>(
        &mut self,
        ch: u8,
        smallflags: &'a [u8],
        i: usize,
    ) -> Option<ParseFlagResult<'a>> {
        match ch {
            b'a' => Some(ParseFlagResult::Unsupported(b"-a")),
            b'c' => Some(ParseFlagResult::Unsupported(b"-c")),
            b'd' => Some(ParseFlagResult::Unsupported(b"-d")),
            b'h' => Some(ParseFlagResult::Unsupported(b"-h")),
            b'm' => Some(ParseFlagResult::Unsupported(b"-m")),
            b'r' => Some(ParseFlagResult::Unsupported(b"-r")),
            b't' => Some(ParseFlagResult::Unsupported(b"-t")),
            _ => Some(ParseFlagResult::IllegalOption(&smallflags[1 + i..])),
        }
    }
}
