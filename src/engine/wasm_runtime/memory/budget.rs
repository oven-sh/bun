//! How much address space and memory all linear memories of the process may take.

use core::sync::atomic::{AtomicU64, Ordering};
use std::sync::LazyLock;

use super::system;
use crate::resources::resources;

pub(super) struct Budget {
    used: AtomicU64,
    limit: u64,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Need {
    /// There is a way without.
    Speed,
    Function,
    /// Another budget bounds it.
    Bounded,
}

impl Budget {
    const fn new(limit: u64) -> Self {
        Self {
            used: AtomicU64::new(0),
            limit,
        }
    }

    pub(super) fn take(&self, bytes: u64, need: Need) -> bool {
        let limit = match need {
            Need::Speed => self.limit / 2,
            Need::Function => self.limit,
            Need::Bounded => u64::MAX,
        };
        let add = |used: u64| used.checked_add(bytes).filter(|&sum| sum <= limit);
        let taken = self
            .used
            .try_update(Ordering::Relaxed, Ordering::Relaxed, add);
        taken.is_ok()
    }

    pub(super) fn give_back(&self, bytes: u64) {
        self.used.fetch_sub(bytes, Ordering::Relaxed);
    }

    pub(super) fn used(&self) -> u64 {
        self.used.load(Ordering::Relaxed)
    }

    /// Whether half of what `need` can have is gone.
    pub(super) fn is_short(&self, need: Need) -> bool {
        self.used() >= self.limit / if need == Need::Speed { 4 } else { 2 }
    }
}

pub(super) static ADDRESS_SPACE: LazyLock<Budget> = LazyLock::new(|| {
    const MOST: u64 = 2 << 40;
    // These may have addresses of 39 bits. The stacks are in the upper part of what there is.
    let on_stack = 0u8;
    let whole = match cfg!(any(target_os = "linux", target_os = "android")) {
        true => ((&raw const on_stack).addr() as u64).next_power_of_two(),
        false => u64::MAX,
    };
    Budget::new((whole.min(system::address_space_limit()) / 4).min(MOST))
});

pub(super) static COMMITTED: LazyLock<Budget> =
    LazyLock::new(|| Budget::new(resources().ram_size.saturating_mul(3)));
