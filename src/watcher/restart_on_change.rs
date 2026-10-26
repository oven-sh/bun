//! Under `--watch`, a start that fails before the VM exists has no watcher: it waits here for a change to the files it looked for.

use core::time::Duration;

use bun_core::{FileKind, Timespec, ZBox};

/// The names that a start looked for, by directory. As in the resolver's directory lookup, ASCII letter case does not count.
pub struct Candidates {
    dirs: Vec<(Box<[u8]>, Vec<Box<[u8]>>)>,
}

/// A regular file with one of the names, and what a save changes.
#[derive(PartialEq, Eq)]
pub struct Found {
    dir: usize,
    name: Box<[u8]>,
    stamp: (u64, u64, Timespec),
}

impl Found {
    pub fn is(&self, dir: usize, name: &[u8]) -> bool {
        self.dir == dir && self.name.eq_ignore_ascii_case(name)
    }
}

impl Candidates {
    pub fn new(dirs: Vec<(Box<[u8]>, Vec<Box<[u8]>>)>) -> Candidates {
        Candidates { dirs }
    }

    /// `Err`: a directory is there and cannot be listed. A directory that is not there has no file.
    pub fn look(&self) -> bun_sys::Maybe<Vec<Found>> {
        let mut found = Vec::new();
        for (index, (dir, names)) in self.dirs.iter().enumerate() {
            let dir = match bun_sys::Dir::open(dir) {
                Ok(dir) => dir,
                Err(err) if matches!(err.get_errno(), bun_sys::E::ENOENT | bun_sys::E::ENOTDIR) => {
                    continue;
                }
                Err(err) => return Err(err),
            };
            let mut entries = bun_sys::iterate_dir(dir.fd());
            while let Some(entry) = entries.next()? {
                let name = entry.name.slice_u8();
                if !names.iter().any(|wanted| wanted.eq_ignore_ascii_case(name)) {
                    continue;
                }
                // This follows a link, as the resolver does to tell a file from a directory.
                let Ok(stat) = bun_sys::fstatat(&dir, ZBox::from_bytes(name).as_zstr()) else {
                    continue;
                };
                let stat = bun_sys::PosixStat::init(&stat);
                if bun_sys::kind_from_mode(stat.mode as bun_sys::Mode) != FileKind::File {
                    continue;
                }
                found.push(Found {
                    dir: index,
                    name: name.into(),
                    stamp: (stat.ino, stat.size, stat.mtim),
                });
            }
        }
        Ok(found)
    }

    /// Whether the files differ from `before`. A directory gives its entries in no fixed order.
    pub fn changed_since(&self, before: &[Found]) -> bool {
        self.look().is_ok_and(|now| {
            now.len() != before.len() || now.iter().any(|file| !before.contains(file))
        })
    }
}

// No watcher exists yet and the file may not exist, so there is nothing to give the OS watcher.
const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// Blocks until `changed` returns true, then restarts the process. Call it after the error is printed.
pub fn restart_when(
    waits_for: &[u8],
    clear_terminal: bool,
    mut changed: impl FnMut() -> bool,
) -> ! {
    bun_core::pretty_errorln!(
        "<r><d>note<r><d>:<r> Bun restarts when {} changes",
        bun_core::fmt::quote(waits_for),
    );
    bun_core::Output::flush();

    // Sleep first: no sequence of failed starts can restart faster than this.
    loop {
        std::thread::sleep(POLL_INTERVAL);
        if changed() {
            break;
        }
    }
    restart(clear_terminal)
}

/// Starts the process again with the same arguments, as a watched file change does.
pub fn restart(clear_terminal: bool) -> ! {
    #[cfg(windows)]
    if !bun_sys::windows::is_watcher_child() {
        if clear_terminal {
            bun_core::output::flush();
            bun_core::output::disable_buffering();
            bun_core::output::reset_terminal_all();
        }
        // The first start has not become the watcher manager yet: no parent would spawn the next child.
        bun_sys::windows::become_watcher_manager();
    }
    bun_core::reload_process(clear_terminal, false);
    unreachable!()
}
