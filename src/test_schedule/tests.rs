use super::*;
use Outcome::{Runs, ShutsDown, Waits};

#[derive(Clone, Copy)]
struct File {
    name: &'static str,
    milliseconds: u64,
    megabytes: u64,
}

fn file(name: &'static str) -> File {
    File {
        name,
        milliseconds: 1,
        megabytes: 0,
    }
}

impl File {
    fn ms(mut self, milliseconds: u64) -> Self {
        self.milliseconds = milliseconds;
        self
    }

    fn mb(mut self, megabytes: u64) -> Self {
        self.megabytes = megabytes;
        self
    }
}

/// One queue per slot.
fn schedule(queues: &[&[File]], steal: Steal) -> Schedule {
    let mut end = 0;
    let range = |queue: &&[File]| {
        end += queue.len();
        end - queue.len()..end
    };
    let file = |file: File| TestFile {
        path: file.name.as_bytes(),
        growth: file.megabytes,
    };
    let files = queues.concat().into_iter().map(file).collect();
    Schedule::new(files, queues.iter().map(range).collect(), steal)
}

fn without_times(queues: &[&[File]]) -> Schedule {
    schedule(queues, Steal::BackHalf)
}

fn with_times(queues: &[&[File]]) -> Schedule {
    let costs = queues.concat().iter().map(|it| it.milliseconds).collect();
    schedule(queues, Steal::Slowest { costs })
}

#[derive(PartialEq, Debug)]
enum Outcome {
    Runs(&'static str),
    Waits,
    ShutsDown,
}

impl Schedule {
    fn name(&self, file: usize) -> &'static str {
        str::from_utf8(self.path(file)).unwrap()
    }

    fn outcome(&mut self, free: Option<Free>) -> Outcome {
        match self.assign(free.expect("the slot is free"), 0) {
            Next::Run(file) => Runs(self.name(file)),
            Next::Wait => Waits,
            Next::ShutDown => ShutsDown,
        }
    }

    fn when_ready(&mut self, slot: usize) -> Outcome {
        let free = self.ready(slot);
        self.outcome(free)
    }

    fn when_asking_again(&mut self, slot: usize) -> Outcome {
        let free = self.ask_again(slot);
        self.outcome(free)
    }

    fn after_its_file(&mut self, slot: usize) -> Outcome {
        let file = self.phase(slot).file().expect("the slot runs a file");
        let free = self.finish(slot, file).map(|(free, _)| free);
        self.outcome(free)
    }

    /// What `slot` runs from its start to its shutdown, while the others stay as they are.
    fn all_files_of(&mut self, slot: usize) -> Vec<&'static str> {
        let mut names = Vec::new();
        let mut outcome = self.when_ready(slot);
        while let Runs(name) = outcome {
            names.push(name);
            outcome = self.after_its_file(slot);
        }
        assert_eq!(outcome, ShutsDown);
        names
    }
}

#[test]
fn a_thief_takes_the_back_half_of_the_first_longest_queue() {
    let mut it = without_times(&[
        &["own"].map(file),
        &["b1", "b2", "b3"].map(file),
        &["c1", "c2", "c3", "c4"].map(file),
    ]);
    assert_eq!(
        it.all_files_of(0),
        ["own", "c3", "c4", "b2", "b3", "c2", "b1", "c1"]
    );
}

#[test]
fn a_thief_takes_the_slowest_file_of_the_queue_with_the_most_time_left() {
    let mut it = with_times(&[
        &[file("own").ms(40)],
        &[file("b30").ms(30), file("b20").ms(20)],
        &[file("c45").ms(45)],
    ]);
    assert_eq!(it.all_files_of(0), ["own", "b30", "c45", "b20"]);
}

#[test]
fn a_file_that_is_chosen_out_of_order_takes_its_time_along() {
    let mut it = with_times(&[
        &[],
        &[file("b50").ms(50), file("heavy").ms(10).mb(1500)],
        &[file("c30").ms(30)],
    ]);
    assert_eq!(it.all_files_of(0), ["heavy", "b50", "c30"]);
}

#[test]
fn what_fits_runs_beside_a_heavy_file_and_then_the_lightest() {
    let average = 861; // (900 + 3000 + 862 + 400 + 0 + 5) / 6
    let mut it = with_times(&[
        &[
            file("largest light").mb(900),
            file("heavy").mb(3000),
            file("just over average").mb(average + 1),
            file("fits 1").mb(400),
            file("fits 2").mb(0),
            file("fits 3").mb(5),
        ],
        &[],
    ]);
    assert_eq!(it.room_beside_heavy, average);
    assert_eq!(it.when_ready(0), Runs("heavy"));
    assert_eq!(
        it.all_files_of(1),
        [
            "fits 1",
            "fits 2",
            "fits 3",
            "just over average",
            "largest light"
        ]
    );
}

#[test]
fn a_gigabyte_is_light_and_room_can_be_filled_to_the_last_megabyte() {
    let mut it = with_times(&[
        &[
            file("whole room").mb(2050),
            file("half 1").mb(1025),
            file("half 2").mb(1025),
            file("half 3").mb(1025),
            file("gigabyte").mb(1024),
        ],
        &[],
        &[],
    ]);
    assert_eq!(it.when_ready(0), Runs("whole room"));
    assert_eq!(it.when_ready(1), Runs("gigabyte"));
    assert_eq!(it.when_ready(2), Waits);
    // "gigabyte" has changed places with "half 1".
    assert_eq!(it.after_its_file(0), Runs("half 2"));
    assert_eq!(it.when_asking_again(2), Runs("half 3"));
    assert_eq!(it.after_its_file(1), Waits);
}

#[test]
fn an_average_file_fits_and_after_the_last_heavy_file_the_queue_decides() {
    let mut it = with_times(&[
        &[
            file("heavy").mb(1500),
            file("over average").mb(900),
            file("average").mb(600),
            file("small 1"),
            file("small 2"),
        ],
        &[],
    ]);
    assert_eq!(it.when_ready(0), Runs("heavy"));
    assert_eq!(it.when_ready(1), Runs("average"));
    assert_eq!(it.after_its_file(0), Runs("over average"));
}

#[test]
fn a_thief_begins_its_half_at_the_front_whatever_the_growth() {
    let mut it = without_times(&[
        &[],
        &[file("b1"), file("b2"), file("b3"), file("heavy").mb(1500)],
    ]);
    assert_eq!(it.all_files_of(0), ["b3", "heavy", "b2", "b1"]);
}

#[test]
fn growth_decides_to_the_end_after_a_half_that_began_with_a_heavy_file() {
    let mut it = without_times(&[
        &[],
        &[
            file("over average").mb(900),
            file("small"),
            file("heavy").mb(1500),
            file("last"),
        ],
    ]);
    assert_eq!(it.when_ready(0), Runs("heavy"));
    assert_eq!(it.after_its_file(0), Runs("last"));
    assert_eq!(it.all_files_of(1), ["small", "over average"]);
}

#[test]
fn an_event_frees_a_slot_in_one_phase_only() {
    #[derive(Clone, Copy, PartialEq, Debug)]
    enum Event {
        Ready,
        ItsFileDone,
        AnotherFileDone,
        AskAgain,
    }
    use {Event::*, Phase::*};
    let (its_file, another_file) = (0, 1);
    let running = Running {
        file: its_file,
        since_ms: 0,
    };
    // Every other pair changes nothing.
    let frees = [
        (Starting, Ready),
        (running, ItsFileDone),
        (WaitingForRoom, AskAgain),
    ];
    for phase in [Starting, running, WaitingForRoom, Idle] {
        for event in [Ready, ItsFileDone, AnotherFileDone, AskAgain] {
            let mut it = without_times(&[&[]]);
            it.slots[0].phase = phase;
            let has_freed = match event {
                Ready => it.ready(0).is_some(),
                ItsFileDone => it.finish(0, its_file).is_some(),
                AnotherFileDone => it.finish(0, another_file).is_some(),
                AskAgain => it.ask_again(0).is_some(),
            };
            let expected = if frees.contains(&(phase, event)) {
                (true, Idle)
            } else {
                (false, phase)
            };
            assert_eq!((has_freed, it.phase(0)), expected, "{phase:?} {event:?}");
        }
    }
}

#[test]
fn what_is_given_up_comes_in_the_order_of_the_slots() {
    let mut it = without_times(&[&["a1", "a2"].map(file), &["b1", "b2", "b3"].map(file)]);
    assert_eq!(it.when_ready(1), Runs("b1"));
    let given_up: Vec<_> =
        core::iter::from_fn(|| it.give_up_queued().map(|file| it.name(file))).collect();
    assert_eq!(given_up, ["a1", "a2", "b2", "b3"]);
    assert_eq!(it.after_its_file(1), ShutsDown);
}

#[test]
fn every_file_ends_once_whatever_the_order_of_events() {
    const NAMES: &str = "abcdefghijklmnopqrstuvwxyz";
    const MEGABYTES: [u64; 6] = [0, 300, 1024, 1025, 1500, 4500];
    let mut state = 1u64;
    let mut below = move |limit: usize| {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (state >> 33) as usize % limit
    };
    for round in 0..2000 {
        let (slots, count) = (2 + below(4), 5 + below(20));
        let files: Vec<File> = (0..count)
            .map(|at| File {
                name: &NAMES[at..=at],
                milliseconds: 1 + below(50) as u64,
                megabytes: MEGABYTES[below(MEGABYTES.len())],
            })
            .collect();
        let queues: Vec<&[File]> = (0..slots)
            .map(|slot| &files[slot * count / slots..(slot + 1) * count / slots])
            .collect();
        let has_times = round % 2 == 1;
        let mut it = if has_times {
            with_times(&queues)
        } else {
            without_times(&queues)
        };
        let mut ended = Vec::new();
        for _ in 0..100_000 {
            if ended.len() == count {
                break;
            }
            let slot = below(slots);
            let (before, any_file) = (it.phase(slot), below(count));
            let free = match below(8) {
                0 | 1 => it.ready(slot),
                2 | 3 => it.ask_again(slot),
                4 => {
                    assert_eq!((it.vacate(slot), it.phase(slot)), (before, Phase::Starting));
                    None
                }
                5 => it.finish(slot, any_file).map(|(free, _)| free),
                _ => it
                    .finish(slot, before.file().unwrap_or(any_file))
                    .map(|(free, _)| free),
            };
            if it.phase(slot) != before {
                ended.extend(before.file().map(|file| it.name(file)));
            }
            let next = free.map(|free| it.assign(free, 0));

            let growth = |file: usize| it.files[file].growth;
            let running = it.running().map(|(file, _)| growth(file));
            let heavy_running: u64 = running.filter(|&growth| is_heavy(growth)).sum();
            let heavy_queued = it.queued().filter(|&file| is_heavy(growth(file))).count();
            assert!(!has_times || heavy_running <= it.room_for_heavy);
            assert!(!has_times || heavy_queued == it.heavy_files_to_choose);
            assert!(heavy_queued <= it.heavy_files_to_choose);
            assert!(next != Some(Next::Wait) || heavy_running > 0);
            assert!(next != Some(Next::ShutDown) || !it.has_queued());
            assert_eq!(
                ended.len() + it.running().count() + it.queued().count(),
                count
            );
        }
        ended.sort_unstable();
        assert_eq!(ended.concat(), NAMES[..count]);
    }
}
