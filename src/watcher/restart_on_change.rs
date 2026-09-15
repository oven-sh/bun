//! A `--watch` process builds its watch list from the files it loads. A start
//! that fails before the VM exists (bunfig.toml does not parse, the entry file
//! is missing) has no watcher at all, so nothing could restart it. It waits
//! here for the file it could not use.

use core::time::Duration;

use bun_core::{Timespec, ZBox, ZStr};

/// What `stat` reports for a path: inode, size and mtime. `None` when the path
/// cannot be read, so a file that appears or goes away counts as changed.
#[derive(Clone, Copy, PartialEq, Eq)]
struct Stamp(Option<(u64, u64, Timespec)>);

impl Stamp {
    fn of(path: &ZStr) -> Stamp {
        Stamp(bun_sys::stat(path).ok().map(|stat| {
            let stat = bun_sys::PosixStat::init(&stat);
            (stat.ino, stat.size, stat.mtim)
        }))
    }
}

/// A path the start depends on, stamped before the start looks at it. A stamp
/// taken after the failure would miss a save that lands between the two.
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

    /// `path` and its directory. The name may resolve to another file in that
    /// directory (`./entry` to `./entry.ts`), which shows only as a change of
    /// the directory.
    pub fn with_dir(path: &[u8]) -> Vec<Input> {
        let mut inputs = vec![Input::new(path)];
        if let Some(dir) = bun_paths::dirname(path) {
            inputs.push(Input::new(dir));
        }
        inputs
    }

    fn changed(&self) -> bool {
        Stamp::of(self.path.as_zstr()) != self.seen
    }
}

// No watcher exists yet, and the file may not exist either, so there is
// nothing to hand to inotify / kqueue / ReadDirectoryChangesW. `stat` covers
// every platform and every way an editor saves a file.
const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// Blocks until one of `inputs` no longer looks like its stamp, then restarts
/// the process. Call it after the error is printed.
pub fn restart_after_change(inputs: &[Input]) -> ! {
    if let Some(first) = inputs.first() {
        bun_core::pretty_errorln!(
            "<r><d>note<r><d>:<r> --watch restarts when {} changes",
            bun_core::fmt::quote(first.path.as_bytes()),
        );
    }
    bun_core::Output::flush();

    // Sleep first: no sequence of failed starts can restart faster than this.
    loop {
        std::thread::sleep(POLL_INTERVAL);
        if inputs.iter().any(Input::changed) {
            break;
        }
    }

    #[cfg(windows)]
    if !bun_sys::windows::is_watcher_child() {
        // The first start parses its arguments before it turns into the watcher
        // manager, so no parent exists yet to spawn the next child.
        bun_sys::windows::become_watcher_manager();
    }
    bun_core::reload_process(false, false);
    unreachable!()
}
