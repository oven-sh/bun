use core::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};
use std::sync::Arc;

use super::file::WriteJob;
use crate::owner::__bun_run_io;
use crate::pipe_reader::ReadEvent;
use crate::pipe_writer::WriteEvent;
use crate::{IoEvent, Owner};

/// The receivers of a source's read and write events.
pub(super) struct Owners {
    reader: Cell<Owner>,
    writer: Cell<Owner>,
    pub(super) disk_write: Cell<Option<Arc<WriteJob>>>,
    /// Position in `OPEN_SOURCES`, or `usize::MAX` once removed from it.
    index: Cell<usize>,
}

thread_local! {
    static OPEN_SOURCES: RefCell<Vec<Weak<Owners>>> = const { RefCell::new(Vec::new()) };
}

impl Owners {
    pub(super) fn new() -> Rc<Owners> {
        OPEN_SOURCES.with_borrow_mut(|sources| {
            let owners = Rc::new(Owners {
                reader: Cell::new(Owner::NULL),
                writer: Cell::new(Owner::NULL),
                disk_write: Cell::new(None),
                index: Cell::new(sources.len()),
            });
            sources.push(Rc::downgrade(&owners));
            owners
        })
    }

    /// SAFETY: `owner` stays valid for `__bun_run_io` until it is replaced or `self` is dropped.
    pub(super) unsafe fn set_reader(&self, owner: Owner) {
        self.reader.set(owner);
    }

    /// SAFETY: see `set_reader`.
    pub(super) unsafe fn set_writer(&self, owner: Owner) {
        self.writer.set(owner);
    }

    pub(super) fn clear_reader(&self) {
        self.reader.set(Owner::NULL);
    }

    pub(super) fn clear_writer(&self) {
        self.writer.set(Owner::NULL);
    }

    pub(super) fn report_read(self: Rc<Self>, event: ReadEvent) {
        report_event(self.reader.get(), IoEvent::Read(event));
    }

    pub(super) fn report_write(self: Rc<Self>, event: WriteEvent) {
        report_event(self.writer.get(), IoEvent::Write(event));
    }
}

fn report_event(owner: Owner, event: IoEvent) {
    if !owner.ptr().is_null() {
        // SAFETY: a non-null owner was stored by `set_reader` or `set_writer`, whose callers keep it valid.
        unsafe { __bun_run_io(owner, event) };
    }
}

impl Drop for Owners {
    fn drop(&mut self) {
        let _ = OPEN_SOURCES.try_with(|sources| {
            let mut sources = sources.borrow_mut();
            let index = self.index.get();
            if index < sources.len() {
                sources.swap_remove(index);
                if let Some(moved) = sources.get(index).and_then(Weak::upgrade) {
                    moved.index.set(index);
                }
            }
        });
    }
}

/// For a thread whose event loop will not run again.
pub fn finish_all_disk_writes() {
    let sources: Vec<_> =
        OPEN_SOURCES.with_borrow(|sources| sources.iter().filter_map(Weak::upgrade).collect());
    for owners in sources {
        if owners
            .disk_write
            .take()
            .is_some_and(|job| job.run().is_ok())
        {
            owners.report_write(WriteEvent::FlushSync);
        }
    }
}

/// Makes this thread's readers and writers release whatever they keep alive while waiting for an event.
pub fn stop_all_for_vm_teardown() {
    while let Some(owners) = OPEN_SOURCES.with_borrow_mut(Vec::pop) {
        let Some(owners) = owners.upgrade() else {
            continue;
        };
        owners.index.set(usize::MAX);
        Rc::clone(&owners).report_read(ReadEvent::VmTeardown);
        owners.report_write(WriteEvent::VmTeardown);
    }
}
