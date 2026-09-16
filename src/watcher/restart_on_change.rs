//! Under `--watch`, a start that fails before the VM exists has no watcher: it waits here for its input.

use core::time::Duration;

use bun_core::{Timespec, ZBox, ZStr};

/// Kind, inode, size and mtime of a path. `None` if `stat` fails, so a file that appears or goes away differs.
#[derive(Clone, Copy, PartialEq, Eq)]
struct Stamp(Option<(bool, u64, u64, Timespec)>);

impl Stamp {
    fn of(path: &ZStr) -> Stamp {
        Stamp(bun_sys::stat(path).ok().map(|stat| {
            let stat = bun_sys::PosixStat::init(&stat);
            let is_dir =
                bun_sys::kind_from_mode(stat.mode as bun_sys::Mode) == bun_sys::FileKind::Directory;
            (is_dir, stat.ino, stat.size, stat.mtim)
        }))
    }
}

/// A file the start depends on, stamped before the start looks at it so that no save is missed.
pub struct Input {
    path: ZBox,
    seen: Stamp,
}

impl Input {
    pub fn new(path: &[u8]) -> Input {
        let path = ZBox::from_bytes(path);
        Input {
            seen: Stamp::of(path.as_zstr()),
            path,
        }
    }

    /// A directory runs through its package.json, so no change of the directory itself shows a fix.
    pub fn is_dir(&self) -> bool {
        self.seen.0.is_some_and(|(is_dir, ..)| is_dir)
    }
}

// No watcher exists yet and the file may not exist, so there is nothing to give the OS watcher.
const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// Blocks until `input` changes, then restarts the process. Call it after the error is printed.
pub fn restart_after_change(input: &Input) -> ! {
    bun_core::pretty_errorln!(
        "<r><d>note<r><d>:<r> --watch restarts when {} changes",
        bun_core::fmt::quote(input.path.as_bytes()),
    );
    bun_core::Output::flush();

    // Sleep first: no sequence of failed starts can restart faster than this.
    loop {
        std::thread::sleep(POLL_INTERVAL);
        if Stamp::of(input.path.as_zstr()) != input.seen {
            break;
        }
    }

    #[cfg(windows)]
    if !bun_sys::windows::is_watcher_child() {
        // The first start has not become the watcher manager yet: no parent would spawn the next child.
        bun_sys::windows::become_watcher_manager();
    }
    bun_core::reload_process(false, false);
    unreachable!()
}
