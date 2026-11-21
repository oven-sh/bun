use core::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};
use std::sync::Arc;

use super::file;
use crate::owner::__bun_run_io;
use crate::pipe_reader::ReadEvent;
use crate::pipe_writer::WriteEvent;
use crate::{IoEvent, Owner};

/// Who hears of the reads and the writes of a source.
pub(super) struct Owners {
    reader: Cell<Owner>,
    writer: Cell<Owner>,
    pub(super) disk_write: Cell<Option<Arc<file::Write>>>,
    /// In `OPEN`, unless it is past the end.
    index: Cell<usize>,
}

thread_local! {
    static OPEN: RefCell<Vec<Weak<Owners>>> = const { RefCell::new(Vec::new()) };
}

impl Owners {
    pub(super) fn new() -> Rc<Owners> {
        OPEN.with_borrow_mut(|open| {
            let owners = Rc::new(Owners {
                reader: Cell::new(Owner::NULL),
                writer: Cell::new(Owner::NULL),
                disk_write: Cell::new(None),
                index: Cell::new(open.len()),
            });
            open.push(Rc::downgrade(&owners));
            owners
        })
    }

    /// SAFETY: `owner` can be passed to `__bun_run_io` until it is replaced, or `self` is dropped.
    pub(super) unsafe fn set_reader(&self, owner: Owner) {
        self.reader.set(owner);
    }

    /// SAFETY: as for `set_reader`.
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
        report(self.reader.get(), IoEvent::Read(event));
    }

    pub(super) fn report_write(self: Rc<Self>, event: WriteEvent) {
        report(self.writer.get(), IoEvent::Write(event));
    }
}

fn report(owner: Owner, event: IoEvent) {
    if !owner.ptr().is_null() {
        // SAFETY: the contract of `set_reader` and `set_writer`.
        unsafe { __bun_run_io(owner, event) };
    }
}

impl Drop for Owners {
    fn drop(&mut self) {
        let _ = OPEN.try_with(|open| {
            let mut open = open.borrow_mut();
            let index = self.index.get();
            if index < open.len() {
                open.swap_remove(index);
                if let Some(moved) = open.get(index).and_then(Weak::upgrade) {
                    moved.index.set(index);
                }
            }
        });
    }
}

/// For a thread whose loop is not going to turn again.
pub fn finish_writes_to_disk() {
    let open: Vec<_> = OPEN.with_borrow(|open| open.iter().filter_map(Weak::upgrade).collect());
    for owners in open {
        if (owners.disk_write.take()).is_some_and(|write| write.run().is_ok()) {
            owners.report_write(WriteEvent::WriteRestNow);
        }
    }
}

/// Has the readers and writers of this thread let go of what they hold until the next event.
pub fn stop_all_for_vm_teardown() {
    while let Some(owners) = OPEN.with_borrow_mut(Vec::pop) {
        let Some(owners) = owners.upgrade() else {
            continue;
        };
        owners.index.set(usize::MAX);
        Rc::clone(&owners).report_read(ReadEvent::VmTeardown);
        owners.report_write(WriteEvent::VmTeardown);
    }
}
