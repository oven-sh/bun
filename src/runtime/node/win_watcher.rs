//! Windows backend of `fs.watch()`.

#![cfg(windows)]

use core::cell::Cell;
use core::ffi::c_void;
use std::rc::Rc;

use bun_core::{WStr, ZStr};
use bun_iocp::{Completion, OverlappedFile, Request};
use bun_jsc as jsc;
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
    /// The `FSWatcher`, which owns the only [`Handle`].
    owner: *mut c_void,
    target: Target,
    recursive: bool,
    /// Owns the only directory handle, which blocks renaming its parents while it is open.
    pending_read: Cell<Option<Request>>,
    spare_buffer: Cell<Vec<u8>>,
}

enum Target {
    /// The path with 8.3 names expanded.
    Directory(Vec<u16>),
    /// Watched through its parent directory.
    File {
        name: Vec<u16>,
        short_name: Vec<u16>,
    },
}

impl Target {
    fn open(path: &WStr) -> Result<(Target, std::os::windows::io::OwnedHandle), Win32Error> {
        let (target, mut directory) =
            if w::GetFileAttributesW(path)? & w::FILE_ATTRIBUTE_DIRECTORY != 0 {
                let long_path = w::get_long_path_name(path).unwrap_or_else(|_| path.to_vec());
                (Target::Directory(long_path), path.to_vec())
            } else {
                let name = bun_paths::basename(path);
                let short_path = w::get_short_path_name(path).unwrap_or_default();
                let target = Target::File {
                    name: name.to_vec(),
                    short_name: bun_paths::basename(&short_path).to_vec(),
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

    /// `None` for a sibling of the watched file.
    fn resolve_filename(&self, Change { name, action }: Change) -> Option<Vec<u16>> {
        match self {
            // The record spells the name as the writer opened it, which can be in 8.3 form.
            Target::Directory(directory)
                if !matches!(
                    action,
                    w::FILE_ACTION_REMOVED | w::FILE_ACTION_RENAMED_OLD_NAME
                ) =>
            {
                Some(expand_short_names(directory, &name).unwrap_or(name))
            }
            Target::Directory(_) => Some(name),
            Target::File {
                name: long_name,
                short_name,
            } => [long_name, short_name]
                .iter()
                .any(|candidate| w::eq_ignore_case(candidate, &name))
                .then(|| long_name.clone()),
        }
    }
}

fn expand_short_names(directory: &[u16], name: &[u16]) -> Option<Vec<u16>> {
    let path = [directory, bun_core::w!("\\"), name, &[0]].concat();
    let long_path = w::get_long_path_name(WStr::from_slice_with_nul(&path)).ok()?;
    let is_separator = |&unit: &u16| bun_paths::is_sep(unit);
    let depth = name.split(is_separator).count();
    let parent = long_path.rsplitn(depth + 1, is_separator).nth(depth)?;
    Some(long_path[parent.len() + 1..].to_vec())
}

impl PathWatcher {
    fn read_changes(self: &Rc<Self>, file: &Rc<OverlappedFile>) -> Result<(), NTSTATUS> {
        const FILTER: u32 = w::FileNotifyChangeFilter::all().bits();
        // Bounds the names that one completion looks up on the JS thread.
        const BUFFER_SIZE: usize = 4096;
        let mut buffer = self.spare_buffer.take();
        buffer.clear();
        buffer.reserve_exact(BUFFER_SIZE);
        let this = Rc::downgrade(self);
        let owned_file = Rc::clone(file);
        let on_complete = move |completion| {
            if let Some(this) = this.upgrade() {
                this.on_changes(&owned_file, completion);
            }
        };
        let request = file
            .read_changes(buffer, BUFFER_SIZE, FILTER, self.recursive, on_complete)
            .map_err(|completion| completion.status)?;
        self.pending_read.set(Some(request));
        Ok(())
    }

    fn on_changes(self: &Rc<Self>, file: &Rc<OverlappedFile>, completion: Completion) {
        let Completion { status, buffer, .. } = completion;
        if !NT_SUCCESS(status) {
            return self.emit_error(file, status);
        }
        let records = match status {
            NTSTATUS::SUCCESS => &buffer[..],
            _ => &[],
        };
        let mut changes: Vec<_> = directory_changes::parse(records).collect();
        changes.dedup();
        self.spare_buffer.set(buffer);
        let next_read = self.read_changes(file);
        // Not kept across reads: the listener may have run before the changes that the next one reports.
        let mut last_event = None;
        for change in changes {
            let Ok(change) = change else {
                // Changes were lost. Forward `(event, null)` like node, unsuppressed.
                self.enqueue_event(Event::NoFilename(WatchEventKind::Change), false);
                continue;
            };
            let event_type = match change.action {
                w::FILE_ACTION_MODIFIED => WatchEventKind::Change,
                w::FILE_ACTION_ADDED..=w::FILE_ACTION_RENAMED_NEW_NAME => WatchEventKind::Rename,
                _ => continue,
            };
            let Some(name) = self.target.resolve_filename(change) else {
                continue;
            };
            let event = (event_type, name);
            if last_event.as_ref() != Some(&event) {
                self.emit(&event.1, event_type);
                last_event = Some(event);
            }
        }
        if let Err(status) = next_read {
            self.emit_error(file, status);
        }
    }

    fn emit_error(&self, file: &OverlappedFile, status: NTSTATUS) {
        let error = Win32Error::from_ntstatus(status);
        if error == Win32Error::ACCESS_DENIED
            && let Target::Directory(path) = &self.target
        {
            let was_deleted = matches!(status, NTSTATUS::DELETE_PENDING | NTSTATUS::FILE_DELETED);
            if w::is_delete_pending(file.handle().raw()).unwrap_or(was_deleted) {
                self.emit(path, WatchEventKind::Rename);
                return self.enqueue_event(Event::Deleted(sys::E::ENOENT), false);
            }
            // The pending delete was cancelled, but the watch does not resume.
            if was_deleted {
                return self.enqueue_event(Event::Deleted(sys::E::EPERM), false);
            }
        }
        let err = sys::Error::from_code(error.to_node_errno(), sys::Tag::watch);
        self.enqueue_event(Event::Error { err, close: true }, false);
    }

    /// One task per event, so that microtasks run between events.
    fn enqueue_event(&self, event: Event, is_file: bool) {
        FSWatcher::on_path_update(Some(self.owner), event, is_file);
        FSWatcher::on_update_end(Some(self.owner));
    }

    fn emit(&self, name: &[u16], event_type: WatchEventKind) {
        let path = bun_core::strings::wtf16_to_wtf8(name);
        let is_file = matches!(self.target, Target::File { .. });
        bun_output::scoped_log!(
            fs_watch,
            "emit({}, {}, {})",
            bstr::BStr::new(&path),
            if is_file { "file" } else { "dir" },
            <&'static str>::from(event_type),
        );
        self.enqueue_event(event_type.to_event(path.into()), is_file);
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

    let to_watch_error =
        |err: Win32Error| sys::Error::from_code(err.to_node_errno(), sys::Tag::watch);
    let mut wide_buf = bun_paths::w_path_buffer_pool::get();
    let wide_path = sys::windows_format::wtf16::encode(event_path, &mut wide_buf[..])
        .map_err(|err| to_watch_error(err.into()))?;
    let (target, handle) = Target::open(wide_path).map_err(to_watch_error)?;
    let this = Rc::new(PathWatcher {
        owner,
        recursive: recursive && matches!(target, Target::Directory(_)),
        target,
        pending_read: Cell::new(None),
        spare_buffer: Cell::default(),
    });
    let handle = bun_iocp::Handle::from_owned(handle);
    let file = OverlappedFile::new_exclusive(vm.uws_loop().port(), handle);
    this.read_changes(&Rc::new(file))
        .map_err(|status| to_watch_error(Win32Error::from_ntstatus(status)))?;

    sys::Result::Ok(this)
}
