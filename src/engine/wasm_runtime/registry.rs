//! Words in instances that mirror the state of something else.

use core::cell::RefCell;

#[derive(Clone, Copy)]
pub(crate) struct Registration(u32);

/// A list in which entries keep their places.
pub(crate) struct Slots<T> {
    entries: Vec<Option<T>>,
    free: Vec<u32>,
}

impl<T> Default for Slots<T> {
    fn default() -> Self {
        Self {
            entries: Vec::new(),
            free: Vec::new(),
        }
    }
}

impl<T: Copy> Slots<T> {
    pub(crate) fn add(&mut self, entry: T) -> Registration {
        if let Some(index) = self.free.pop() {
            self.entries[index as usize] = Some(entry);
            return Registration(index);
        }
        self.entries.push(Some(entry));
        Registration(self.entries.len() as u32 - 1)
    }

    pub(crate) fn remove(&mut self, registration: Registration) {
        self.entries[registration.0 as usize] = None;
        self.free.push(registration.0);
        if self.free.len() == self.entries.len() {
            self.free.clear();
            self.entries.clear();
        }
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = T> {
        self.entries.iter().copied().flatten()
    }
}

pub(crate) struct Registry<T>(RefCell<Slots<*mut T>>);

impl<T> Default for Registry<T> {
    fn default() -> Self {
        Self(RefCell::default())
    }
}

impl<T> Registry<T> {
    /// # Safety
    /// `entry` is valid for writes on this thread until it is removed.
    pub(crate) unsafe fn add(&self, entry: *mut T) -> Registration {
        self.0.borrow_mut().add(entry)
    }

    pub(crate) fn remove(&self, registration: Registration) {
        self.0.borrow_mut().remove(registration);
    }

    pub(crate) fn write_all(&self, value: impl Fn() -> T) {
        for entry in self.0.borrow().iter() {
            // SAFETY: it was added and not removed.
            unsafe { entry.write(value()) };
        }
    }
}
