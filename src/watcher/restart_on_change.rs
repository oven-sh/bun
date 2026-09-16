//! Under `--watch`, a start that fails before the VM exists has no watcher: it waits here for its input.

use core::time::Duration;

use bun_core::{FileKind, Timespec, ZBox, ZStr};

pub fn kind_of(path: &ZStr) -> Option<FileKind> {
    let stat = bun_sys::PosixStat::init(&bun_sys::stat(path).ok()?);
    Some(bun_sys::kind_from_mode(stat.mode as bun_sys::Mode))
}

/// A file whose content the start could not use, stamped before the start read it so that no save is missed.
pub struct Input {
    path: ZBox,
    seen: Option<(u64, u64, Timespec)>,
}

impl Input {
    pub fn new(path: &ZStr) -> Input {
        Input {
            seen: Self::stamp(path),
            path: ZBox::from_bytes(path.as_bytes()),
        }
    }

    fn stamp(path: &ZStr) -> Option<(u64, u64, Timespec)> {
        let stat = bun_sys::PosixStat::init(&bun_sys::stat(path).ok()?);
        Some((stat.ino, stat.size, stat.mtim))
    }

    pub fn path(&self) -> &[u8] {
        self.path.as_bytes()
    }

    pub fn changed(&self) -> bool {
        Self::stamp(self.path.as_zstr()) != self.seen
    }
}

// No watcher exists yet and the file may not exist, so there is nothing to give the OS watcher.
const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// Blocks until `ready` returns true, then restarts the process. Call it after the error is printed.
pub fn restart_when(waits_for: &[u8], mut ready: impl FnMut() -> bool) -> ! {
    bun_core::pretty_errorln!(
        "<r><d>note<r><d>:<r> --watch restarts when {} changes",
        bun_core::fmt::quote(waits_for),
    );
    bun_core::Output::flush();

    // Sleep first: no sequence of failed starts can restart faster than this.
    loop {
        std::thread::sleep(POLL_INTERVAL);
        if ready() {
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
