//! Threads that help with pixels. They stay for as long as they are in demand.

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use crate::sync::{Condvar, Mutex};

/// Fewer are not worth waking a thread.
pub const MANY_PIXELS: i64 = 1 << 19;
const PATIENCE: Duration = Duration::from_millis(250);

type Work<'a> = &'a (dyn Fn() + Sync);

struct Crew {
    work: Option<Work<'static>>,
    wanted: usize,
    busy: usize,
    size: usize,
    has_failed: bool,
}

static CREW: Mutex<Crew> = Mutex::new(Crew {
    work: None,
    wanted: 0,
    busy: 0,
    size: 0,
    has_failed: false,
});
static IS_WANTED: Condvar = Condvar::new();
static IS_DONE: Condvar = Condvar::new();

/// With this one.
pub fn threads() -> usize {
    static COUNT: LazyLock<usize> = LazyLock::new(|| {
        std::thread::available_parallelism()
            .map_or(1, usize::from)
            .min(4)
    });
    *COUNT
}

fn help() {
    crate::host::thread::is_needed_for_frames();
    let mut crew = CREW.lock();
    loop {
        if let Some(work) = crew.work.filter(|_| crew.wanted > 0) {
            (crew.wanted, crew.busy) = (crew.wanted - 1, crew.busy + 1);
            drop(crew);
            let has_failed = catch_unwind(AssertUnwindSafe(work)).is_err();
            crew = CREW.lock();
            (crew.busy, crew.has_failed) = (crew.busy - 1, crew.has_failed || has_failed);
            IS_DONE.notify_all();
        } else if IS_WANTED
            .wait_until(&mut crew, Instant::now() + PATIENCE)
            .timed_out()
            && crew.wanted == 0
        {
            crew.size -= 1;
            return;
        }
    }
}

struct Dismissal<'a> {
    has_failed: &'a mut bool,
}

impl Drop for Dismissal<'_> {
    fn drop(&mut self) {
        let mut crew = CREW.lock();
        crew.wanted = 0;
        while crew.busy > 0 {
            IS_DONE.wait(&mut crew);
        }
        (crew.work, *self.has_failed) = (None, std::mem::take(&mut crew.has_failed));
    }
}

fn share(helpers: usize, work: Work) {
    let mut crew = CREW.lock();
    if crew.work.is_some() {
        drop(crew);
        return work();
    }
    // SAFETY: `Dismissal` takes it back before this returns or unwinds.
    (crew.work, crew.wanted) = (
        Some(unsafe { std::mem::transmute::<Work, Work<'static>>(work) }),
        helpers,
    );
    while crew.size < helpers
        && std::thread::Builder::new()
            .name("pixels".into())
            .stack_size(8 << 20)
            .spawn(help)
            .is_ok()
    {
        crew.size += 1;
    }
    drop(crew);
    let mut has_failed = false;
    let dismissal = Dismissal {
        has_failed: &mut has_failed,
    };
    IS_WANTED.notify_all();
    work();
    drop(dismissal);
    assert!(!has_failed, "a helper panicked");
}

/// In any order.
pub fn for_each<I: ExactSizeIterator + Send>(items: I, work: impl Fn(I::Item) + Sync) {
    let helpers = items.len().min(threads()).saturating_sub(1);
    if helpers == 0 {
        return items.for_each(work);
    }
    let items = Mutex::new(items);
    share(helpers, &|| {
        std::iter::from_fn(|| items.lock().next()).for_each(&work)
    });
}

/// `work` gets whole rows, and the number of the first.
pub fn in_bands<T: Send>(
    rows: &mut [T],
    width: usize,
    pixels: i64,
    work: impl Fn(usize, &mut [T]) + Sync,
) {
    if pixels < MANY_PIXELS {
        return work(0, rows);
    }
    let height = (rows.len() / width).div_ceil(threads() * 2);
    for_each(
        rows.chunks_mut(height * width).enumerate(),
        |(index, band)| work(index * height, band),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_row_is_visited_once() {
        let mut rows = vec![0u32; 7 * 1001];
        for _ in 0..200 {
            in_bands(&mut rows, 7, MANY_PIXELS, |first, band| {
                for (index, row) in (first..).zip(band.chunks_mut(7)) {
                    in_bands(row, 1, MANY_PIXELS, |_, part| {
                        part.iter_mut().for_each(|it| *it += index as u32)
                    });
                }
            });
        }
        assert!(
            (0..)
                .zip(rows.chunks(7))
                .all(|(index, row)| row == [index * 200; 7])
        );
    }
}
