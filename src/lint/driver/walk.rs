//! Visits a tree of directories on all threads. A thread goes on with a deeper directory while others are busy with
//! higher ones, and only waits for them before a step whose order shows. A thread that has no directory to visit
//! starts on the files.

use crate::run::{Fatal, Pool};
use bun_threading::{Condvar, Guarded};

struct Level<T> {
    waiting: Vec<T>,
    /// Those that wait and those that are being visited.
    unfinished: usize,
}

struct State<T, F> {
    /// By depth.
    levels: Vec<Level<T>>,
    /// No level above it has a directory that waits.
    first_waiting: usize,
    /// All levels above it are finished.
    first_unfinished: usize,
    waiting: usize,
    /// The highest, with its depth. Nothing below it is visited.
    failure: Option<(usize, Fatal)>,
    /// By the number of bits in their size, in short lists, none empty. A long one would be half unused, and stay that long.
    files: [Vec<Vec<F>>; 64],
    /// One bit for each of `files` that isn't empty.
    sizes: u64,
    /// Of all files that were found.
    total_size: u64,
    /// The number of threads that have started on files.
    workers: usize,
}

impl<T, F> State<T, F> {
    fn add_file(&mut self, file: F, size: u64) {
        let bit = size.max(1).ilog2();
        let lists = &mut self.files[bit as usize];
        match lists.last_mut().filter(|it| it.len() < 256) {
            Some(last) => last.push(file),
            None => lists.push(vec![file]),
        }
        self.sizes |= 1 << bit;
        self.total_size += size;
    }

    /// One of the largest, so no thread starts a big file when the others are nearly done.
    fn take_file(&mut self) -> Option<F> {
        let bit = self.sizes.checked_ilog2()?;
        let lists = &mut self.files[bit as usize];
        let file = lists.last_mut()?.pop();
        lists.pop_if(|it| it.is_empty());
        if lists.is_empty() {
            self.sizes &= !(1 << bit);
        }
        file
    }

    fn add(&mut self, depth: usize, mut found: Vec<T>) {
        if found.is_empty() || self.has_failed_above(depth) {
            return;
        }
        if depth == self.levels.len() {
            self.levels.push(Level {
                waiting: Vec::new(),
                unfinished: 0,
            });
        }
        self.waiting += found.len();
        self.first_waiting = self.first_waiting.min(depth);
        self.levels[depth].unfinished += found.len();
        self.levels[depth].waiting.append(&mut found);
    }

    /// One of the highest that wait.
    fn take(&mut self) -> Option<(usize, T)> {
        loop {
            let level = self.levels.get_mut(self.first_waiting)?;
            if let Some(next) = level.waiting.pop() {
                self.waiting -= 1;
                return Some((self.first_waiting, next));
            }
            self.first_waiting += 1;
        }
    }

    /// Returns whether that was the last of the highest unfinished level.
    fn finish(&mut self, depth: usize) -> bool {
        self.levels[depth].unfinished -= 1;
        let before = self.first_unfinished;
        while (self.levels.get(self.first_unfinished)).is_some_and(|it| it.unfinished == 0) {
            self.first_unfinished += 1;
        }
        self.first_unfinished > before
    }

    fn has_failed_above(&self, depth: usize) -> bool {
        self.failure.as_ref().is_some_and(|it| it.0 < depth)
    }

    fn is_over(&self) -> bool {
        self.first_unfinished == self.levels.len()
    }
}

struct Walk<T, F> {
    state: Guarded<State<T, F>>,
    has_waiting: Condvar,
    has_finished_level: Condvar,
}

/// Waits until all higher directories have been visited. False if one of them has failed, so this one doesn't count.
pub(crate) type AwaitTurn<'a> = &'a dyn Fn() -> bool;

/// The directories in a directory, and the files to work on with their sizes.
pub(crate) type Found<T, F> = (Vec<T>, Vec<(F, u64)>);

type Visit<'a, T, R> = &'a (dyn Fn(&T, AwaitTurn<'_>) -> Result<R, Fatal> + Sync);

/// Works on the files that one thread takes. It's told whether all directories have been visited, and none has failed.
pub(crate) type Worker<'a, F> = Box<dyn FnMut(F, bool) + 'a>;

impl<T, F> Walk<T, F> {
    fn await_turn(&self, depth: usize) -> bool {
        let mut state = self.state.lock();
        while state.first_unfinished < depth {
            self.has_finished_level.wait_guarded(&mut state);
        }
        !state.has_failed_above(depth)
    }

    /// Returns when nothing is left, or more than `most` directories wait.
    fn work<'w>(
        &self,
        pool: &Pool,
        visit: Visit<'_, T, Found<T, F>>,
        start_worker: Option<&dyn Fn() -> Worker<'w, F>>,
        most: usize,
    ) {
        let mut worker = None;
        let mut state = self.state.lock();
        while state.waiting <= most {
            let Some((depth, directory)) = state.take() else {
                if let Some(start_worker) = start_worker
                    && state.failure.is_none()
                    && (worker.is_some() || state.workers < pool.threads_for(state.total_size))
                    && let Some(file) = state.take_file()
                {
                    state.workers += usize::from(worker.is_none());
                    let is_over = state.is_over();
                    drop(state);
                    worker.get_or_insert_with(start_worker)(file, is_over);
                    state = self.state.lock();
                } else if state.is_over() {
                    break;
                } else {
                    self.has_waiting.wait_guarded(&mut state);
                }
                continue;
            };
            if !state.has_failed_above(depth) {
                drop(state);
                let found = visit(&directory, &|| self.await_turn(depth));
                drop(directory);
                state = self.state.lock();
                match found {
                    Ok((directories, files)) => {
                        // This thread takes one.
                        let count = directories.len() + files.len();
                        self.has_waiting.notify_many(count.saturating_sub(1));
                        state.add(depth + 1, directories);
                        (files.into_iter()).for_each(|(file, size)| state.add_file(file, size));
                        pool.expect_files(state.total_size);
                    }
                    Err(_) if state.has_failed_above(depth + 1) => {}
                    Err(error) => state.failure = Some((depth, error)),
                }
            }
            if state.finish(depth) {
                self.has_finished_level.notify_all();
                if state.is_over() {
                    self.has_waiting.notify_all();
                }
            }
        }
    }
}

/// Calls `visit` with `root` and with all that it returns. `Err` is that of one of the highest directories that fail.
pub(crate) fn walk<T: Send>(
    pool: &Pool,
    root: T,
    visit: Visit<'_, T, Vec<T>>,
) -> Result<(), Fatal> {
    let visit = |it: &T, await_turn: AwaitTurn<'_>| Ok((visit(it, await_turn)?, Vec::new()));
    walk_and_work(pool, root, &visit, &|| Box::new(|(), _| {})).map(drop)
}

/// Like [`walk`]. Returns the files that weren't given to a worker.
pub(crate) fn walk_and_work<'w, T: Send, F: Send>(
    pool: &Pool,
    root: T,
    visit: Visit<'_, T, Found<T, F>>,
    start_worker: &(dyn Fn() -> Worker<'w, F> + Sync),
) -> Result<Vec<F>, Fatal> {
    /// So few are listed in the time it takes to start threads.
    const FEW: usize = 8;
    let mut walk = Walk {
        state: Guarded::new(State {
            levels: Vec::new(),
            first_waiting: 0,
            first_unfinished: 0,
            waiting: 0,
            failure: None,
            files: [const { Vec::new() }; 64],
            sizes: 0,
            total_size: 0,
            workers: 0,
        }),
        has_waiting: Condvar::new(),
        has_finished_level: Condvar::new(),
    };
    walk.state.get_mut().add(0, vec![root]);
    walk.work(pool, visit, None, FEW);
    if !walk.state.get_mut().is_over() {
        pool.for_each(pool.threads(), 1, &|_| {
            walk.work(pool, visit, Some(start_worker), usize::MAX);
        });
    }
    let state = walk.state.get_mut();
    match state.failure.take() {
        Some((_, error)) => Err(error),
        None => Ok(state
            .files
            .iter_mut()
            .flat_map(std::mem::take)
            .flatten()
            .collect()),
    }
}
