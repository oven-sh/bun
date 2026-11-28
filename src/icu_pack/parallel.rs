use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};
use std::thread;

/// `items.iter().map(f).collect()` on all processors.
pub(crate) fn map<T: Sync, R: Send>(items: &[T], f: impl Fn(&T) -> R + Sync) -> Vec<R> {
    let next = AtomicUsize::new(0);
    let work = || {
        let indexes = std::iter::repeat_with(|| next.fetch_add(1, Relaxed));
        let results = indexes.map_while(|i| Some((i, f(items.get(i)?))));
        results.collect::<Vec<_>>()
    };
    let mut results: Vec<_> = thread::scope(|scope| {
        let mut threads = Vec::new();
        let count = thread::available_parallelism().map_or(1, usize::from);
        threads.resize_with(count, || scope.spawn(work));
        let results = threads.into_iter().map(|it| it.join().expect("no panic"));
        results.flatten().collect()
    });
    results.sort_by_key(|result| result.0);
    results.into_iter().map(|result| result.1).collect()
}
