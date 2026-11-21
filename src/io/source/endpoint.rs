use core::cell::Cell;
use std::rc::Rc;

use bun_iocp::{Hold, Port};
use bun_ptr::OptionCellExt as _;

use super::owners::Owners;
use crate::pipe_reader::ReadEvent;
use crate::pipe_writer::WriteEvent;

const IDLE_SIZE: usize = 8 * 1024;
pub(super) const BUSY_SIZE: usize = 64 * 1024;
const MAX_SIZE: usize = 256 * 1024;

/// Few sizes, so that what is freed fits the next one.
pub(super) fn room_for(available: usize) -> usize {
    available.min(MAX_SIZE).next_power_of_two()
}

/// What every kind of source keeps about its reader and its writer.
pub(super) struct Endpoint {
    pub(super) port: Rc<Port>,
    pub(super) owners: Rc<Owners>,
    hold: Hold,
    is_ref: Cell<bool>,
    is_writing: Cell<bool>,
    /// How many bytes the reader takes next. `None` while it is paused.
    wanted: Cell<Option<usize>>,
    /// Read, and not reported yet.
    held: Cell<Option<ReadEvent>>,
    spare: Cell<Vec<u8>>,
    is_busy: Cell<bool>,
}

impl Endpoint {
    pub(super) fn new(port: &Rc<Port>) -> Endpoint {
        Endpoint {
            port: Rc::clone(port),
            owners: Owners::new(),
            hold: Hold::new(port),
            is_ref: Cell::new(true),
            is_writing: Cell::new(false),
            wanted: Cell::new(None),
            held: Cell::new(None),
            spare: Cell::default(),
            is_busy: Cell::new(false),
        }
    }

    fn update_hold(&self) {
        let is_reading = self.is_ref.get() && self.wanted.get().is_some();
        self.hold.set(is_reading || self.is_writing.get());
    }

    pub(super) fn update_ref(&self, value: bool) {
        self.is_ref.set(value);
        self.update_hold();
    }

    pub(super) fn set_writing(&self, value: bool) {
        self.is_writing.set(value);
        self.update_hold();
    }

    pub(super) fn wanted(&self) -> Option<usize> {
        self.wanted.get()
    }

    pub(super) fn set_wanted(&self, max_len: Option<usize>) {
        self.wanted.set(max_len);
        self.update_hold();
    }

    pub(super) fn recycle(&self, mut buffer: Vec<u8>) {
        if (1..=BUSY_SIZE).contains(&buffer.capacity()) {
            buffer.clear();
            self.spare.set(buffer);
        }
    }

    /// An empty one to read into. It is small until much comes, because it is there for as long as nothing comes.
    pub(super) fn buffer(&self, max_len: usize) -> Vec<u8> {
        self.buffer_for(0, max_len)
    }

    pub(super) fn buffer_for(&self, available: usize, max_len: usize) -> Vec<u8> {
        let usual = if self.is_busy.get() {
            BUSY_SIZE
        } else {
            IDLE_SIZE
        };
        let size = usual.max(room_for(available)).min(max_len);
        let spare = self.spare.take();
        match spare.capacity() >= size {
            true => spare,
            false => Vec::with_capacity(size),
        }
    }

    pub(super) fn expect_much(&self) {
        self.is_busy.set(true);
    }

    pub(super) fn is_holding(&self) -> bool {
        self.held.is_some()
    }

    pub(super) fn hold(&self, event: ReadEvent) {
        if let ReadEvent::Data(data) = &event {
            self.is_busy.set(data.len() >= IDLE_SIZE);
        }
        self.held.set(Some(event));
    }

    pub(super) fn take_held(&self) -> Option<ReadEvent> {
        let max_len = self.wanted.get()?;
        let mut event = self.held.take()?;
        self.wanted.set(None);
        match &mut event {
            ReadEvent::Data(data) if data.len() > max_len => {
                self.held
                    .set(Some(ReadEvent::Data(data.split_off(max_len))));
            }
            ReadEvent::Data(_) => {}
            _ => self.update_hold(),
        }
        Some(event)
    }
}

/// The reports let go of the source first, because its owners may want it closed before they return.
pub(super) trait HasEndpoint {
    fn endpoint(&self) -> &Endpoint;

    /// What is held, unless the reader is paused. It has to ask again after that.
    fn report_read(self: Rc<Self>) {
        if let Some(event) = self.endpoint().take_held() {
            let owners = Rc::clone(&self.endpoint().owners);
            drop(self);
            owners.report_read(event);
        }
    }

    fn report_write(self: Rc<Self>, event: WriteEvent) {
        self.endpoint().set_writing(false);
        let owners = Rc::clone(&self.endpoint().owners);
        drop(self);
        owners.report_write(event);
    }
}
