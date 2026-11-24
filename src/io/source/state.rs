use core::cell::Cell;
use std::rc::Rc;

use bun_iocp::{LoopRef, Port};
use bun_ptr::OptionCellExt as _;

use super::owners::Owners;
use crate::pipe_reader::ReadEvent;
use crate::pipe_writer::WriteEvent;

const SMALL_READ_SIZE: usize = 8 * 1024;
pub(super) const LARGE_READ_SIZE: usize = 64 * 1024;
const MAX_BUFFER_SIZE: usize = 256 * 1024;

/// Powers of two, so that a freed buffer fits a later allocation.
pub(super) fn compute_buffer_size(available: usize) -> usize {
    available.min(MAX_BUFFER_SIZE).next_power_of_two()
}

/// Reader and writer state common to every kind of source.
pub(super) struct SourceState {
    pub(super) port: Rc<Port>,
    pub(super) owners: Rc<Owners>,
    loop_ref: LoopRef,
    has_ref: Cell<bool>,
    is_writing: Cell<bool>,
    /// Maximum length of the next `ReadEvent::Data`. `None` while no read is requested.
    read_limit: Cell<Option<usize>>,
    buffered_event: Cell<Option<ReadEvent>>,
    spare_buffer: Cell<Vec<u8>>,
    should_use_large_buffer: Cell<bool>,
}

impl SourceState {
    pub(super) fn new(port: &Rc<Port>) -> SourceState {
        SourceState {
            port: Rc::clone(port),
            owners: Owners::new(),
            loop_ref: LoopRef::new(port),
            has_ref: Cell::new(true),
            is_writing: Cell::new(false),
            read_limit: Cell::new(None),
            buffered_event: Cell::new(None),
            spare_buffer: Cell::default(),
            should_use_large_buffer: Cell::new(false),
        }
    }

    fn update_loop_ref(&self) {
        let has_referenced_read = self.has_ref.get() && self.read_limit.get().is_some();
        self.loop_ref
            .set(has_referenced_read || self.is_writing.get());
    }

    pub(super) fn update_ref(&self, value: bool) {
        self.has_ref.set(value);
        self.update_loop_ref();
    }

    pub(super) fn set_writing(&self, value: bool) {
        self.is_writing.set(value);
        self.update_loop_ref();
    }

    pub(super) fn read_limit(&self) -> Option<usize> {
        self.read_limit.get()
    }

    pub(super) fn set_read_limit(&self, max_len: Option<usize>) {
        self.read_limit.set(max_len);
        self.update_loop_ref();
    }

    pub(super) fn reuse_buffer(&self, mut buffer: Vec<u8>) {
        if (1..=LARGE_READ_SIZE).contains(&buffer.capacity()) {
            buffer.clear();
            self.spare_buffer.set(buffer);
        }
    }

    /// Starts small, because a pending read holds its buffer for as long as the source is idle.
    pub(super) fn acquire_buffer(&self, max_len: usize) -> Vec<u8> {
        self.acquire_buffer_with_hint(0, max_len)
    }

    pub(super) fn acquire_buffer_with_hint(&self, size_hint: usize, max_len: usize) -> Vec<u8> {
        let default_size = if self.should_use_large_buffer.get() {
            LARGE_READ_SIZE
        } else {
            SMALL_READ_SIZE
        };
        let size = default_size
            .max(compute_buffer_size(size_hint))
            .min(max_len);
        let spare_buffer = self.spare_buffer.take();
        if spare_buffer.capacity() >= size {
            spare_buffer
        } else {
            Vec::with_capacity(size)
        }
    }

    pub(super) fn use_large_buffer(&self) {
        self.should_use_large_buffer.set(true);
    }

    pub(super) fn has_buffered_event(&self) -> bool {
        self.buffered_event.is_some()
    }

    pub(super) fn buffer_event(&self, event: ReadEvent) {
        if let ReadEvent::Data(data) = &event {
            self.should_use_large_buffer
                .set(data.len() >= SMALL_READ_SIZE);
        }
        self.buffered_event.set(Some(event));
    }

    pub(super) fn take_buffered_event(&self) -> Option<ReadEvent> {
        let max_len = self.read_limit.get()?;
        let mut event = self.buffered_event.take()?;
        self.read_limit.set(None);
        self.update_loop_ref();
        if let ReadEvent::Data(data) = &mut event
            && data.len() > max_len
        {
            self.buffered_event
                .set(Some(ReadEvent::Data(data.split_off(max_len))));
        }
        Some(event)
    }
}

/// The `report_*` methods release the source before dispatching, so an owner that drops it in the callback closes it immediately.
pub(super) trait HasSourceState {
    fn state(&self) -> &SourceState;

    /// Reports the buffered event if a read is requested. The reader has to request the next one.
    fn report_read(self: Rc<Self>) {
        if let Some(event) = self.state().take_buffered_event() {
            let owners = Rc::clone(&self.state().owners);
            drop(self);
            owners.report_read(event);
        }
    }

    fn report_write(self: Rc<Self>, event: WriteEvent) {
        self.state().set_writing(false);
        let owners = Rc::clone(&self.state().owners);
        drop(self);
        owners.report_write(event);
    }
}
