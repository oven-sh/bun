//! The backend of `fs.watch()` on Windows.

#![cfg(windows)]

use core::cell::Cell;
use core::ffi::c_void;
use std::rc::Rc;

use bun_core::strings::basename_windows;
use bun_core::{Timespec, TimespecMockMode, WStr, ZStr};
use bun_iocp::{AsyncFile, Completion, Request};
use bun_jsc as jsc;
use bun_ptr::CellExt as _;
use bun_sys as sys;
use bun_sys::Win32ErrorExt as _;
use bun_sys::windows::{self as w, NT_SUCCESS, NTSTATUS, Win32Error};
use bun_sys::windows_format::directory_changes::{self, Change};

use super::node_fs_watcher::WatchEventKind;
use crate::node::node_fs_watcher::{Event, FSWatcher};

// Rust identifiers cannot contain '.', so
// the static is declared by hand (instead of via `declare_scope!`) with the
// tag string, keeping `BUN_DEBUG_fs.watch` env matching and the
// `[fs.watch]` log prefix.
#[allow(non_upper_case_globals)]
pub(crate) static fs_watch: bun_output::ScopedLogger =
    bun_output::ScopedLogger::new("fs.watch", bun_output::Visibility::Visible);

// ──────────────────────────────────────────────────────────────────────────

pub(crate) type Handle = Rc<PathWatcher>;

pub(crate) struct PathWatcher {
    /// The `FSWatcher`, which has the only [`Handle`].
    owner: *mut c_void,
    last_event: Cell<ChangeEvent>,
    target: Target,
    recursive: bool,
    /// Has the only handle to the directory, which keeps its parents from being renamed.
    read: Cell<Option<Request>>,
    spare: Cell<Vec<u8>>,
    /// Whether the last read ended with `BUFFER_OVERFLOW`.
    was_cut: Cell<bool>,
}

enum Target {
    /// Without short names.
    Directory(Vec<u16>),
    /// Its directory is what is watched.
    File {
        name: Vec<u16>,
        short_name: Vec<u16>,
    },
}

impl Target {
    fn open(path: &WStr) -> Result<(Target, std::os::windows::io::OwnedHandle), Win32Error> {
        let (target, mut directory) =
            if w::GetFileAttributesW(path)? & w::FILE_ATTRIBUTE_DIRECTORY != 0 {
                let long = w::long_path(path).unwrap_or_else(|_| path.to_vec());
                (Target::Directory(long), path.to_vec())
            } else {
                let name = basename_windows(path);
                let short = w::short_path(path).unwrap_or_default();
                let target = Target::File {
                    name: name.to_vec(),
                    short_name: basename_windows(&short).to_vec(),
                };
                match &path[..path.len() - name.len()] {
                    [] => (target, bun_core::w!(".").to_vec()),
                    parent => (target, parent.to_vec()),
                }
            };
        directory.push(0);
        let handle = w::CreateFileW(
            WStr::from_slice_with_nul(&directory),
            w::FILE_LIST_DIRECTORY,
            w::FILE_SHARE_READ | w::FILE_SHARE_WRITE | w::FILE_SHARE_DELETE,
            w::OPEN_EXISTING,
            w::FILE_FLAG_BACKUP_SEMANTICS | w::FILE_FLAG_OVERLAPPED,
        )?;
        Ok((target, handle))
    }

    /// `None` for a neighbour of the file.
    fn name_to_report(&self, Change { name, action }: Change) -> Option<Vec<u16>> {
        match self {
            // It is spelled as whoever made the change has opened it.
            Target::Directory(directory)
                if has_short_name(&name)
                    && !matches!(
                        action,
                        w::FILE_ACTION_REMOVED | w::FILE_ACTION_RENAMED_OLD_NAME
                    ) =>
            {
                Some(long_name(directory, &name).unwrap_or(name))
            }
            Target::Directory(_) => Some(name),
            Target::File {
                name: long,
                short_name,
            } => [long, short_name]
                .iter()
                .any(|it| w::eq_ignore_case(it, &name))
                .then(|| long.clone()),
        }
    }
}

fn has_short_name(path: &[u16]) -> bool {
    (path.split(|&unit| bun_paths::is_sep_any_t(unit)))
        .any(|name| name.len() <= "12345678.123".len() && name.contains(&u16::from(b'~')))
}

fn long_name(directory: &[u16], name: &[u16]) -> Option<Vec<u16>> {
    let path = [directory, bun_core::w!("\\"), name, &[0]].concat();
    let long = w::long_path(WStr::from_slice_with_nul(&path)).ok()?;
    let is_separator = |&unit: &u16| bun_paths::is_sep_any_t(unit);
    let depth = name.split(is_separator).count();
    let parent = long.rsplitn(depth + 1, is_separator).nth(depth)?;
    Some(long[parent.len() + 1..].to_vec())
}

#[derive(Clone, Copy)]
struct ChangeEvent {
    hash: bun_watcher::HashType,
    event_type: WatchEventKind,
    timestamp: u64,
}

impl Default for ChangeEvent {
    fn default() -> Self {
        Self {
            hash: 0,
            event_type: WatchEventKind::Change,
            timestamp: 0,
        }
    }
}

impl ChangeEvent {
    fn emit(
        &mut self,
        hash: bun_watcher::HashType,
        timestamp: u64,
        event_type: WatchEventKind,
    ) -> bool {
        let time_diff = timestamp.saturating_sub(self.timestamp);
        // skip consecutive exact duplicates (same path and event type) only
        if self.timestamp == 0
            || time_diff > 1
            || self.event_type != event_type
            || self.hash != hash
        {
            self.timestamp = timestamp;
            self.event_type = event_type;
            self.hash = hash;
            return true;
        }
        false
    }
}

impl PathWatcher {
    fn read_changes(self: &Rc<Self>, file: &Rc<AsyncFile>) -> Result<(), NTSTATUS> {
        const FILTER: u32 = w::FileNotifyChangeFilter::all().bits();
        // The system holds as much as the first read had room for, and a share takes no more than 64 KiB.
        let size = if self.recursive { 64 * 1024 } else { 4096 };
        let mut buffer = self.spare.take();
        buffer.clear();
        buffer.reserve_exact(size);
        let (this, next) = (Rc::downgrade(self), Rc::clone(file));
        let done = move |completion| {
            if let Some(this) = this.upgrade() {
                this.on_changes(&next, completion);
            }
        };
        let read = file.read_changes(buffer, size, FILTER, self.recursive, done);
        self.read.set(Some(read.map_err(|refused| refused.status)?));
        Ok(())
    }

    fn on_changes(self: &Rc<Self>, file: &Rc<AsyncFile>, completion: Completion) {
        let Completion { status, buffer, .. } = completion;
        let timestamp = Timespec::now(TimespecMockMode::ForceRealTime).ms_unsigned();
        // One is how a share can say that there were too many.
        let is_cut = status == NTSTATUS::BUFFER_OVERFLOW;
        let was_cut = self.was_cut.replace(is_cut);
        if !NT_SUCCESS(status) && (was_cut || !is_cut) {
            return self.fail(file, status, timestamp);
        }
        let records = match status {
            NTSTATUS::SUCCESS => &buffer[..],
            _ => &[],
        };
        let changes: Vec<_> = directory_changes::parse(records).collect();
        self.spare.set(buffer);
        let next = self.read_changes(file);
        for change in changes {
            let Ok(change) = change else {
                // There were too many. Forward `(event, null)` like node, unsuppressed.
                self.send(Event::NoFilename(WatchEventKind::Change), false);
                continue;
            };
            let event_type = match change.action {
                w::FILE_ACTION_MODIFIED => WatchEventKind::Change,
                w::FILE_ACTION_ADDED..=w::FILE_ACTION_RENAMED_NEW_NAME => WatchEventKind::Rename,
                _ => continue,
            };
            if let Some(name) = self.target.name_to_report(change) {
                self.emit(&name, timestamp, event_type);
            }
        }
        if let Err(status) = next {
            self.fail(file, status, timestamp);
        }
    }

    fn fail(&self, file: &AsyncFile, status: NTSTATUS, timestamp: u64) {
        let error = Win32Error::from_ntstatus(status);
        if let (Win32Error::ACCESS_DENIED, Target::Directory(path)) = (error, &self.target) {
            let was_deleted = matches!(status, NTSTATUS::DELETE_PENDING | NTSTATUS::FILE_DELETED);
            if w::is_delete_pending(file.handle().raw()).unwrap_or(was_deleted) {
                self.emit(path, timestamp, WatchEventKind::Rename);
                return self.send(Event::Deleted(sys::E::ENOENT), false);
            }
            // That was withdrawn, which does not bring the watch back.
            if was_deleted {
                return self.send(Event::Deleted(sys::E::EPERM), false);
            }
        }
        let err = sys::Error::from_code(error.to_node_e(), sys::Tag::watch);
        self.send(Event::Error { err, close: true }, false);
    }

    /// In a task of its own, so that microtasks run between two events.
    fn send(&self, event: Event, is_file: bool) {
        FSWatcher::on_path_update(Some(self.owner), event, is_file);
        FSWatcher::on_update_end(Some(self.owner));
    }

    fn emit(&self, name: &[u16], timestamp: u64, event_type: WatchEventKind) {
        let path = bun_core::strings::wtf16_to_wtf8(name);
        let hash = bun_wyhash::hash(&path) as bun_watcher::HashType;
        let is_file = matches!(self.target, Target::File { .. });
        bun_output::scoped_log!(
            fs_watch,
            "emit({}, {}, {}, at {})",
            bstr::BStr::new(&path),
            if is_file { "file" } else { "dir" },
            <&'static str>::from(event_type),
            timestamp,
        );

        if !(self.last_event).with_taken(|last| last.emit(hash, timestamp, event_type)) {
            return;
        }
        self.send(event_type.to_event(path.into()), is_file);
    }

    /// JS-thread entry point from `FSWatcher.detach()`.
    pub(crate) fn detach(this: Handle, _owner: *mut c_void) {
        drop(this);
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub(crate) fn watch(
    vm: &jsc::VirtualMachineRef,
    path: &ZStr,
    recursive: bool,
    owner: *mut c_void,
) -> sys::Result<Handle> {
    let mut outbuf = bun_paths::path_buffer_pool::get();
    let event_path: &[u8] = match sys::readlink(path, &mut outbuf) {
        sys::Result::Err(err) if err.get_errno() == sys::E::ENOENT => {
            return sys::Result::Err(sys::Error::from_code(sys::E::ENOENT, sys::Tag::open));
        }
        sys::Result::Err(_) => path.as_bytes(),
        sys::Result::Ok(_) => match sys::realpath(path, &mut outbuf) {
            sys::Result::Err(err) if err.get_errno() == sys::E::ENOENT => {
                return sys::Result::Err(sys::Error::from_code(sys::E::ENOENT, sys::Tag::open));
            }
            result => result.unwrap_or(path.as_bytes()),
        },
    };

    let error = |err: Win32Error| sys::Error::from_code(err.to_node_e(), sys::Tag::watch);
    let mut wide = bun_paths::w_path_buffer_pool::get();
    let wide = sys::windows_format::wide::encode(event_path, &mut wide[..]);
    let wide = wide.map_err(|err| error(err.into()))?;
    let (target, handle) = Target::open(wide).map_err(error)?;
    let this = Rc::new(PathWatcher {
        owner,
        last_event: Cell::default(),
        recursive: recursive && matches!(target, Target::Directory(_)),
        target,
        read: Cell::new(None),
        spare: Cell::default(),
        was_cut: Cell::new(false),
    });
    let handle = bun_iocp::Handle::from_owned(handle);
    let file = AsyncFile::exclusive(vm.uws_loop().port(), handle);
    (this.read_changes(&Rc::new(file)))
        .map_err(|status| error(Win32Error::from_ntstatus(status)))?;

    sys::Result::Ok(this)
}
