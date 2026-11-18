//! Locks that stay usable after a panic.

use std::ops::{Deref, DerefMut};
use std::sync::{self, PoisonError, TryLockError};
use std::time::Instant;

#[derive(Default)]
pub struct Mutex<T>(sync::Mutex<T>);

/// Only empty while a `Condvar` waits.
pub struct MutexGuard<'a, T>(Option<sync::MutexGuard<'a, T>>);

impl<T> Mutex<T> {
    pub const fn new(value: T) -> Mutex<T> {
        Mutex(sync::Mutex::new(value))
    }

    pub fn lock(&self) -> MutexGuard<'_, T> {
        MutexGuard(Some(self.0.lock().unwrap_or_else(PoisonError::into_inner)))
    }

    pub fn get_mut(&mut self) -> &mut T {
        self.0.get_mut().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn try_lock(&self) -> Option<MutexGuard<'_, T>> {
        match self.0.try_lock() {
            Ok(guard) => Some(MutexGuard(Some(guard))),
            Err(TryLockError::Poisoned(error)) => Some(MutexGuard(Some(error.into_inner()))),
            Err(TryLockError::WouldBlock) => None,
        }
    }
}

impl<T> Deref for MutexGuard<'_, T> {
    type Target = T;

    fn deref(&self) -> &T {
        self.0.as_deref().expect("it is locked")
    }
}

impl<T> DerefMut for MutexGuard<'_, T> {
    fn deref_mut(&mut self) -> &mut T {
        self.0.as_deref_mut().expect("it is locked")
    }
}

#[derive(Default)]
pub struct Condvar(sync::Condvar);

impl Condvar {
    pub const fn new() -> Condvar {
        Condvar(sync::Condvar::new())
    }

    pub fn wait<T>(&self, guard: &mut MutexGuard<T>) {
        guard.0 = guard
            .0
            .take()
            .map(|it| self.0.wait(it).unwrap_or_else(PoisonError::into_inner));
    }

    pub fn wait_while<T>(&self, guard: &mut MutexGuard<T>, mut waits: impl FnMut(&mut T) -> bool) {
        while waits(guard) {
            self.wait(guard);
        }
    }

    pub fn wait_until<T>(
        &self,
        guard: &mut MutexGuard<T>,
        deadline: Instant,
    ) -> sync::WaitTimeoutResult {
        let (held, left) = (
            guard.0.take().expect("it is locked"),
            deadline.saturating_duration_since(Instant::now()),
        );
        let (held, result) = self
            .0
            .wait_timeout(held, left)
            .unwrap_or_else(PoisonError::into_inner);
        guard.0 = Some(held);
        result
    }

    pub fn notify_one(&self) {
        self.0.notify_one();
    }

    pub fn notify_all(&self) {
        self.0.notify_all();
    }
}

pub struct RwLock<T>(sync::RwLock<T>);

impl<T> RwLock<T> {
    pub const fn new(value: T) -> RwLock<T> {
        RwLock(sync::RwLock::new(value))
    }

    pub fn read(&self) -> sync::RwLockReadGuard<'_, T> {
        self.0.read().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn write(&self) -> sync::RwLockWriteGuard<'_, T> {
        self.0.write().unwrap_or_else(PoisonError::into_inner)
    }
}
