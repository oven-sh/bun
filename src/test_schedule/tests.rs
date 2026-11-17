use super::*;

fn schedule(files: &[(u64, u64)], queues: &[Range<usize>], steal: Steal) -> Schedule {
    const NAMES: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
    let file = |(at, &(cost, growth)): (usize, _)| TestFile {
        path: &NAMES[at..=at],
        cost,
        growth,
    };
    let files = files.iter().enumerate().map(file).collect();
    Schedule::new(files, queues.to_vec(), steal)
}

/// The name of what `slot` runs now, `.` if it waits, `-` if it shuts down.
fn assign(schedule: &mut Schedule, free: Option<Free>) -> char {
    match schedule.assign(free.expect("the slot is free"), 0) {
        Next::Run(file) => schedule.path(file)[0].into(),
        Next::Wait => '.',
        Next::ShutDown => '-',
    }
}

fn ready(schedule: &mut Schedule, slot: usize) -> char {
    let free = schedule.ready(slot);
    assign(schedule, free)
}

fn finish(schedule: &mut Schedule, slot: usize) -> char {
    let file = schedule.phase(slot).file().expect("the slot runs a file");
    let free = schedule.finish(slot, file).map(|(free, _)| free);
    assign(schedule, free)
}

fn run_out(schedule: &mut Schedule, slot: usize) -> String {
    let mut names = String::new();
    while schedule.phase(slot).file().is_some() {
        names.push(finish(schedule, slot));
    }
    names
}

#[test]
fn a_thief_takes_the_back_half_of_the_first_longest_queue() {
    let mut it = schedule(&[(1, 0); 8], &[0..1, 1..4, 4..8], Steal::BackHalf);
    assert_eq!(ready(&mut it, 0), 'a');
    assert_eq!(run_out(&mut it, 0), "ghcdfbe-");
}

#[test]
fn a_thief_takes_the_slowest_file_of_the_queue_with_the_most_time_left() {
    let files = [(40, 0), (10, 0), (30, 0), (20, 0), (45, 0)];
    let mut it = schedule(&files, &[0..2, 2..4, 4..5], Steal::Slowest);
    assert_eq!(ready(&mut it, 0), 'a');
    assert_eq!(run_out(&mut it, 0), "bced-");
}

#[test]
fn what_fits_runs_beside_a_heavy_file_and_then_the_lightest() {
    let files = [(6, 900), (5, 3000), (4, 862), (3, 400), (2, 0), (1, 5)];
    let mut it = schedule(&files, &[0..6, 0..0], Steal::Slowest);
    assert_eq!(ready(&mut it, 0), 'b');
    assert_eq!(ready(&mut it, 1), 'd');
    assert_eq!(run_out(&mut it, 1), "efca-");
}

#[test]
fn a_gigabyte_is_light_and_room_can_be_filled_to_the_last_megabyte() {
    let files = [(5, 2050), (4, 1025), (3, 1025), (2, 1025), (1, 1024)];
    let mut it = schedule(&files, &[0..5, 0..0, 0..0], Steal::Slowest);
    assert_eq!([0, 1, 2].map(|slot| ready(&mut it, slot)), ['a', 'e', '.']);
    assert_eq!(finish(&mut it, 0), 'c');
    let free = it.ask_again(2);
    assert_eq!(assign(&mut it, free), 'd');
    assert_eq!(finish(&mut it, 1), '.');
}

#[test]
fn an_average_file_fits_and_after_the_last_heavy_file_the_queue_decides() {
    let files = [(5, 1500), (4, 900), (3, 600), (2, 0), (1, 0)];
    let mut it = schedule(&files, &[0..5, 0..0], Steal::Slowest);
    assert_eq!([0, 1].map(|slot| ready(&mut it, slot)), ['a', 'c']);
    assert_eq!(finish(&mut it, 0), 'b');
}

#[test]
fn a_stolen_heavy_file_waits_for_room() {
    let files = [(1, 0), (1, 1500), (1, 1500)];
    let mut it = schedule(&files, &[0..1, 1..3], Steal::BackHalf);
    assert_eq!([0, 1].map(|slot| ready(&mut it, slot)), ['a', 'b']);
    assert_eq!(finish(&mut it, 0), '.');
}

#[test]
fn an_event_frees_a_slot_in_one_phase_only() {
    let phases = || {
        let files = [(3, 1500), (2, 1500), (1, 1500)];
        let mut it = schedule(&files, &[0..3, 0..0, 0..0, 0..0], Steal::Slowest);
        assert_eq!([1, 2].map(|slot| ready(&mut it, slot)), ['a', '.']);
        assert!(it.ready(3).is_some());
        it
    };
    let frees = |event: fn(&mut Schedule, usize) -> bool| {
        [0, 1, 2, 3].map(|slot| {
            let mut it = phases();
            let before = it.phase(slot);
            let has_freed = event(&mut it, slot);
            assert_eq!(it.phase(slot), if has_freed { Phase::Idle } else { before });
            has_freed
        })
    };
    let (yes, no) = (true, false);
    assert_eq!(
        frees(|it, slot| it.ready(slot).is_some()),
        [yes, no, no, no]
    );
    assert_eq!(
        frees(|it, slot| it.finish(slot, 0).is_some()),
        [no, yes, no, no]
    );
    assert_eq!(
        frees(|it, slot| it.finish(slot, 1).is_some()),
        [no, no, no, no]
    );
    assert_eq!(
        frees(|it, slot| it.ask_again(slot).is_some()),
        [no, no, yes, no]
    );
    for slot in 0..4 {
        let mut it = phases();
        let before = it.phase(slot);
        assert_eq!((it.vacate(slot), it.phase(slot)), (before, Phase::Starting));
    }
}

#[test]
fn every_file_ends_once_whatever_the_order_of_events() {
    let mut state = 1u64;
    let mut below = move |limit: usize| {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (state >> 33) as usize % limit
    };
    for round in 0..2000 {
        let (slots, count) = (2 + below(4), 5 + below(20));
        let files: Vec<_> = (0..count)
            .map(|_| {
                (
                    1 + below(50) as u64,
                    [0, 300, 1024, 1025, 1500, 4500][below(6)],
                )
            })
            .collect();
        let queues: Vec<_> = (0..slots)
            .map(|slot| slot * count / slots..(slot + 1) * count / slots)
            .collect();
        let steal = [Steal::BackHalf, Steal::Slowest][round % 2];
        let mut it = schedule(&files, &queues, steal);
        let mut ended = Vec::new();
        for _ in 0..100_000 {
            if ended.len() == count {
                break;
            }
            let slot = below(slots);
            let free = match below(8) {
                0 | 1 => it.ready(slot),
                2 | 3 => it.ask_again(slot),
                4 => {
                    ended.extend(it.vacate(slot).file().map(|file| it.path(file)));
                    None
                }
                any => {
                    let file = it.phase(slot).file().filter(|_| any != 5);
                    let file = file.unwrap_or_else(|| below(count));
                    let finished = it.finish(slot, file).map(|(free, _)| free);
                    finished.inspect(|_| ended.push(it.path(file)))
                }
            };
            let next = free.map(|free| it.assign(free, 0));
            let growths = it.running().map(|(file, _)| it.files[file].growth);
            let heavy: u64 = growths.filter(|&growth| is_heavy(growth)).sum();
            assert!(heavy <= it.room_for_heavy);
            assert!(next != Some(Next::Wait) || heavy > 0);
            assert!(next != Some(Next::ShutDown) || !it.has_queued());
            assert_eq!(
                ended.len() + it.running().count() + it.queued().count(),
                count
            );
        }
        ended.sort_unstable();
        ended.dedup();
        assert_eq!(ended.len(), count);
    }
}

#[test]
fn what_is_given_up_comes_in_the_order_of_the_slots() {
    let mut it = schedule(&[(1, 0); 5], &[0..2, 2..5], Steal::BackHalf);
    assert_eq!(ready(&mut it, 1), 'c');
    assert_eq!(it.queued().collect::<Vec<_>>(), [0, 1, 3, 4]);
    let given_up: Vec<_> = core::iter::from_fn(|| it.give_up_queued()).collect();
    assert_eq!(given_up, [0, 1, 3, 4]);
    assert_eq!(finish(&mut it, 1), '-');
}
