//! The connection to a context of the library.

use core::cell::{Cell, RefCell};
use core::ptr::null_mut;
use core::sync::atomic::Ordering;

use crate::abi_webgl::{Attributes, Progress, Room, WebGl};

pub(super) struct Stream {
    next: Cell<*mut u32>,
    /// The same as `next` until the end of the task is waited for.
    end: Cell<*mut u32>,
    room: Cell<(*mut u32, usize)>,
    /// `None` once it is closed.
    context: Cell<Option<&'static Progress>>,
    library: &'static WebGl,
    /// How often.
    sent: Cell<u32>,
    pub(super) was_used: Cell<bool>,
    last_id: Cell<u32>,
    free_ids: RefCell<Vec<u32>>,
    /// Destructors can run while a command is written.
    pub(super) released: RefCell<Vec<u32>>,
}

fn length_of(words: &[u32], parts: &[&[u8]]) -> usize {
    parts
        .iter()
        .fold(words.len(), |sum, it| sum + 1 + it.len().div_ceil(4))
}

impl Stream {
    pub(super) fn open(attributes: &Attributes) -> Option<Stream> {
        let library = crate::platform::graphics()?.webgl;
        // SAFETY: what it returns is valid until it is closed.
        let context = Some(unsafe { (library.open)(attributes).as_ref()? }).into();
        let (sent, was_used, last_id, free_ids, released) = Default::default();
        Some(Stream {
            next: null_mut::<u32>().into(),
            end: null_mut::<u32>().into(),
            room: (null_mut(), 0).into(),
            context,
            library,
            sent,
            was_used,
            last_id,
            free_ids,
            released,
        })
    }

    pub(super) fn close(&self) {
        if let Some(context) = self.context.take() {
            self.enter(Room {
                start: null_mut(),
                words: 0,
            });
            // SAFETY: it was open.
            unsafe { (self.library.close)(context) };
        }
    }

    pub(super) fn library(&self) -> &'static WebGl {
        self.library
    }

    pub(super) fn with_progress<R>(&self, read: impl FnOnce(&Progress) -> R) -> Option<R> {
        self.context.get().map(read)
    }

    pub(super) fn is_broken(&self) -> bool {
        self.with_progress(|it| it.is_lost.load(Ordering::Relaxed)) == Some(true)
    }

    pub(super) fn new_id(&self) -> u32 {
        self.free_ids.borrow_mut().pop().unwrap_or_else(|| {
            self.last_id.update(|it| it + 1);
            self.last_id.get()
        })
    }

    pub(super) fn free(&self, ids: Vec<u32>) {
        self.free_ids.borrow_mut().extend(ids);
    }

    fn enter(&self, Room { start, words }: Room) {
        self.room.set((start, words));
        self.next.set(start);
        self.end.set(start.wrapping_add(words));
    }

    fn used(&self) -> usize {
        (self.next.get().addr() - self.room.get().0.addr()) / 4
    }

    fn exchange(&self, wanted: usize) {
        let Some(context) = self.context.get() else {
            return;
        };
        self.sent
            .update(|it| it.wrapping_add((self.used() > 0).into()));
        // SAFETY: so many words were written.
        self.enter(unsafe { (self.library.send)(context, self.used(), wanted) });
    }

    pub(super) fn flush(&self) {
        self.exchange(0);
    }

    /// The next command has the end of its task waited for.
    pub(super) fn rest(&self) {
        self.flush();
        self.was_used.set(false);
        self.end.set(self.next.get());
    }

    /// For `has_run`, about what was written so far.
    pub(super) fn position(&self) -> u32 {
        self.sent.get().wrapping_add((self.used() > 0).into())
    }

    pub(super) fn has_run(&self, position: u32) -> bool {
        self.with_progress(|it| it.done.load(Ordering::Relaxed).wrapping_sub(position) as i32 >= 0)
            != Some(false)
    }

    #[cold]
    #[inline(never)]
    fn make_room(&self, words: usize) -> bool {
        if self.context.get().is_some() && !self.was_used.replace(true) {
            super::context::wait_for_end_of_task();
        }
        let (start, capacity) = self.room.get();
        self.end.set(start.wrapping_add(capacity));
        if capacity - self.used() < words {
            self.exchange(words);
        }
        self.room.get().1 - self.used() >= words
    }

    #[inline(always)]
    fn reserve(&self, words: usize) -> Option<*mut u32> {
        if (self.end.get().addr() - self.next.get().addr()) / 4 < words && !self.make_room(words) {
            return None;
        }
        Some(self.next.replace(self.next.get().wrapping_add(words)))
    }

    #[inline(always)]
    pub(super) fn send<const N: usize>(&self, words: [u32; N]) {
        if let Some(to) = self.reserve(N) {
            // SAFETY: there is room for them.
            unsafe { to.cast::<[u32; N]>().write(words) };
        }
    }

    /// False if there is no memory for that.
    pub(super) fn send_with(&self, words: &[u32], parts: &[&[u8]]) -> bool {
        let total = length_of(words, parts);
        let Some(mut to) = (total < 1 << 30).then(|| self.reserve(total)).flatten() else {
            return false;
        };
        // SAFETY: there is room for all of it.
        unsafe {
            to.copy_from_nonoverlapping(words.as_ptr(), words.len());
            to = to.add(words.len());
            for part in parts {
                let words = part.len().div_ceil(4);
                to.add(words).write(0);
                to.write(part.len() as u32);
                to.add(1)
                    .cast::<u8>()
                    .copy_from_nonoverlapping(part.as_ptr(), part.len());
                to = to.add(1 + words);
            }
        }
        true
    }

    /// To what was written last. `read` does not use the stream.
    pub(super) fn answer<R>(&self, read: impl FnOnce(&[u32]) -> R) -> R {
        self.flush();
        // SAFETY: it is open, and nothing is sent meanwhile.
        read(
            self.context
                .get()
                .map_or(&[], |it| unsafe { (self.library.answer)(it).get() }),
        )
    }

    pub(super) fn ask<R>(
        &self,
        words: &[u32],
        parts: &[&[u8]],
        read: impl FnOnce(&[u32]) -> R,
    ) -> R {
        let Some(context) = self.context.get().filter(|_| self.send_with(words, parts)) else {
            return read(&[]);
        };
        let length = length_of(words, parts);
        // SAFETY: it is open, so many words were written, and nothing is sent meanwhile.
        let known =
            unsafe { (self.library.recall)(context, self.used() - length, self.used()).get() };
        if known.is_empty() {
            return self.answer(read);
        }
        self.next.update(|it| it.wrapping_sub(length));
        read(known)
    }

    pub(super) fn show(&self, canvas: u32, is_needed_now: bool) {
        self.flush();
        // SAFETY: it is open.
        self.context
            .get()
            .inspect(|it| unsafe { (self.library.show)(*it, canvas, is_needed_now) });
    }

    pub(super) fn offer(&self, image: u32, size: [u32; 2]) {
        // SAFETY: it is open.
        self.context
            .get()
            .inspect(|it| unsafe { (self.library.offer)(*it, image, &size) });
    }
}
