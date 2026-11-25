//! Some additional behaviour beyond basic `cd <dir>`:
//! - `cd` by itself or `cd ~` will always put the user in their home directory.
//! - `cd -` will put the user in the previous directory

use bstr::BStr;
use bun_sys::E;

use crate::shell::builtin::Builtin;
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::yield_::Yield;

pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
    let args = Builtin::of(interp, cmd).args();
    let shell = &mut interp.as_cmd_mut(cmd).shell;
    let home;
    let (result, dir) = match args {
        [] => {
            home = shell.get_homedir().to_vec();
            if home.is_empty() {
                return Builtin::fail(interp, cmd, format_args!("HOME not set\n"));
            }
            (shell.change_cwd(&home), &home[..])
        }
        // Still the one that was tried if this fails.
        [dir] if dir.get() == b"-" => (shell.change_prev_cwd(), shell.prev_cwd()),
        [dir] => (shell.change_cwd(dir), dir.get()),
        _ => return Builtin::fail(interp, cmd, format_args!("too many arguments\n")),
    };
    let Err(err) = result else {
        return Builtin::done(interp, cmd, 0);
    };
    let dir = BStr::new(dir);
    match err.get_errno() {
        E::ENOTDIR | E::ENOENT => {
            Builtin::fail(interp, cmd, format_args!("not a directory: {dir}\n"))
        }
        E::ENAMETOOLONG => Builtin::fail(interp, cmd, format_args!("file name too long\n")),
        _ => {
            let words = BStr::new(err.msg().unwrap_or_else(|| err.name()));
            Builtin::fail(interp, cmd, format_args!("{words}: {dir}\n"))
        }
    }
}
