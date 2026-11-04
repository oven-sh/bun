use bun_threading::Guarded;
use core::mem::MaybeUninit;

pub type InParallel<'a> = &'a (dyn Fn(usize, &(dyn Fn(usize) + Sync)) + Sync);

pub fn run_serially(count: usize, work: &(dyn Fn(usize) + Sync)) {
    for index in 0..count {
        work(index);
    }
}

pub fn for_each_mut<T: Send>(
    items: &mut [T],
    in_parallel: InParallel<'_>,
    work: &(dyn Fn(&mut T) + Sync),
) {
    let items: Vec<Guarded<&mut T>> = items.iter_mut().map(Guarded::new).collect();
    in_parallel(items.len(), &|index| work(&mut **items[index].lock()));
}

pub fn map_each<T: Send, R: Send>(
    items: Vec<T>,
    in_parallel: InParallel<'_>,
    work: &(dyn Fn(T) -> R + Sync),
) -> Vec<R> {
    let items = items.into_iter().map(|item| (Some(item), None));
    let mut slots: Vec<(Option<T>, Option<R>)> = items.collect();
    for_each_mut(&mut slots, in_parallel, &|(item, result)| {
        *result = item.take().map(work);
    });
    let take = |(_, result): (Option<T>, Option<R>)| result.expect("every task ran");
    slots.into_iter().map(take).collect()
}

/// Moves what the boxes hold to the end of `list`, on all threads. For records that are large enough for the copy to count.
pub fn extend_from_boxes<T: Send>(
    list: &mut Vec<T>,
    boxes: Vec<Box<T>>,
    in_parallel: InParallel<'_>,
) {
    let count = boxes.len();
    list.reserve(count);
    let slots = list.spare_capacity_mut()[..count].iter_mut();
    let mut moves: Vec<(&mut MaybeUninit<T>, Option<Box<T>>)> =
        slots.zip(boxes.into_iter().map(Some)).collect();
    for_each_mut(&mut moves, in_parallel, &|(slot, item)| {
        slot.write(*item.take().expect("each is moved once"));
    });
    drop(moves);
    // SAFETY: `for_each_mut` has visited each of the `count` slots, which wrote it.
    unsafe { list.set_len(list.len() + count) };
}

/// Appends what `make` gives for each item of the lists, in their order.
pub fn extend_from_each<S: Sync, T: Send>(
    list: &mut Vec<T>,
    lists: &[Vec<S>],
    in_parallel: InParallel<'_>,
    make: &(dyn Fn(&S) -> T + Sync),
) {
    let count: usize = lists.iter().map(Vec::len).sum();
    list.reserve(count);
    let mut free = &mut list.spare_capacity_mut()[..count];
    let mut tasks: Vec<(&mut [MaybeUninit<T>], &[S])> = Vec::with_capacity(lists.len());
    for items in lists {
        let (slots, rest) = core::mem::take(&mut free).split_at_mut(items.len());
        free = rest;
        tasks.push((slots, items));
    }
    for_each_mut(&mut tasks, in_parallel, &|(slots, items)| {
        for (slot, item) in slots.iter_mut().zip(items.iter()) {
            slot.write(make(item));
        }
    });
    drop(tasks);
    // SAFETY: the tasks share out the first `count` slots, a task has a slot for each of its items, and `for_each_mut` has visited each task, which wrote its slots.
    unsafe { list.set_len(list.len() + count) };
}

/// Moves what the lists hold to the end of `list`, one list behind the other, on all threads: where each list goes follows from the lengths of those before it.
pub fn extend_from_lists<T: Send>(
    list: &mut Vec<T>,
    lists: Vec<Vec<T>>,
    in_parallel: InParallel<'_>,
) {
    let count: usize = lists.iter().map(Vec::len).sum();
    list.reserve(count);
    let mut free = &mut list.spare_capacity_mut()[..count];
    let mut moves: Vec<(&mut [MaybeUninit<T>], Vec<T>)> = Vec::with_capacity(lists.len());
    for items in lists {
        let (slots, rest) = core::mem::take(&mut free).split_at_mut(items.len());
        free = rest;
        moves.push((slots, items));
    }
    for_each_mut(&mut moves, in_parallel, &|(slots, items)| {
        for (slot, item) in slots.iter_mut().zip(core::mem::take(items)) {
            slot.write(item);
        }
    });
    drop(moves);
    // SAFETY: the moves share out the first `count` slots, a move has a slot for each of its items, and `for_each_mut` has visited each move, which wrote its slots.
    unsafe { list.set_len(list.len() + count) };
}

/// Frees what the items own on all threads.
pub fn drop_each<T: Send>(items: Vec<T>, in_parallel: InParallel<'_>) {
    let items = items.into_iter().map(|item| Guarded::new(Some(item)));
    let items: Vec<Guarded<Option<T>>> = items.collect();
    in_parallel(items.len(), &|index| drop(items[index].lock().take()));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn drop_each_drops_each_item_once() {
        struct Counted<'a>(&'a AtomicUsize);
        impl Drop for Counted<'_> {
            fn drop(&mut self) {
                self.0.fetch_add(1, Ordering::Relaxed);
            }
        }
        let dropped = AtomicUsize::new(0);
        let items = (0..3).map(|_| Counted(&dropped)).collect();
        drop_each(items, &|count, work| {
            run_serially(count, work);
            assert_eq!(dropped.load(Ordering::Relaxed), 3);
        });
        assert_eq!(dropped.load(Ordering::Relaxed), 3);
    }

    #[test]
    fn extend_from_boxes_keeps_the_order() {
        let mut list = vec![1, 2];
        let boxes = vec![Box::new(3), Box::new(4), Box::new(5)];
        extend_from_boxes(&mut list, boxes, &run_serially);
        assert_eq!(list, [1, 2, 3, 4, 5]);
    }

    #[test]
    fn extend_from_each_keeps_the_order_whatever_the_order_of_the_tasks() {
        let in_reverse = |count: usize, work: &(dyn Fn(usize) + Sync)| {
            (0..count).rev().for_each(work);
        };
        let ways: [InParallel<'_>; 2] = [&run_serially, &in_reverse];
        for in_parallel in ways {
            let mut list = vec![String::from("0")];
            let lists: Vec<Vec<u32>> = vec![vec![1, 2], Vec::new(), vec![3]];
            extend_from_each(&mut list, &lists, in_parallel, &|number| number.to_string());
            assert_eq!(list, ["0", "1", "2", "3"]);
            extend_from_each(&mut list, &[], in_parallel, &|number: &u32| number.to_string());
            assert_eq!(list.len(), 4);
        }
    }

    #[test]
    fn extend_from_lists_keeps_the_order_whatever_the_order_of_the_tasks() {
        let in_reverse = |count: usize, work: &(dyn Fn(usize) + Sync)| {
            (0..count).rev().for_each(work);
        };
        let ways: [InParallel<'_>; 2] = [&run_serially, &in_reverse];
        for in_parallel in ways {
            let mut list = vec![String::from("a")];
            let lists: [&[&str]; 3] = [&["b", "c"], &[], &["d"]];
            let lists: Vec<Vec<String>> = lists
                .iter()
                .map(|list| list.iter().copied().map(String::from).collect())
                .collect();
            extend_from_lists(&mut list, lists, in_parallel);
            assert_eq!(list, ["a", "b", "c", "d"]);
            extend_from_lists(&mut list, Vec::new(), in_parallel);
            assert_eq!(list.len(), 4);
        }
    }

    #[test]
    fn for_each_mut_visits_each_item_once() {
        let mut items = [1, 2, 3];
        for_each_mut(&mut items, &run_serially, &|item| *item *= 10);
        assert_eq!(items, [10, 20, 30]);
    }

    #[test]
    fn for_each_mut_accepts_any_order() {
        let in_reverse = |count: usize, work: &(dyn Fn(usize) + Sync)| {
            for index in (0..count).rev() {
                work(index);
            }
        };
        let mut items = [1, 2, 3];
        for_each_mut(&mut items, &in_reverse, &|item| *item += 1);
        assert_eq!(items, [2, 3, 4]);
    }
}
