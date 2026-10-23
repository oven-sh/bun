#![cfg(all(
    target_os = "linux",
    any(target_arch = "x86_64", target_arch = "aarch64")
))]

use core::ops::Range;

#[repr(C)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct Instruction {
    pub code: u16,
    pub jump_if_true: u8,
    pub jump_if_false: u8,
    pub value: u32,
}

const LOAD_WORD: u16 = 0x20;
const JUMP_ALWAYS: u16 = 0x05;
const JUMP_IF_EQUAL: u16 = 0x15;
const JUMP_IF_GREATER: u16 = 0x25;
const JUMP_IF_GREATER_OR_EQUAL: u16 = 0x35;
const JUMP_IF_ANY_BIT_SET: u16 = 0x45;
const RETURN: u16 = 0x06;

const NUMBER: u32 = 0;
const ARCHITECTURE: u32 = 4;
const INSTRUCTION_POINTER: u32 = 8;
const fn argument(index: u32) -> u32 {
    16 + 8 * index
}
const HIGH_HALF: u32 = 4;

const ALLOW: u32 = 0x7fff_0000;
const FAIL_WITH: u32 = 0x0005_0000;
const EACCES: u32 = 13;
const ENOSYS: u32 = 38;
const REFUSE: u32 = FAIL_WITH | EACCES;
const NO_SUCH_CALL: u32 = FAIL_WITH | ENOSYS;

#[cfg(target_arch = "x86_64")]
mod this_architecture {
    pub(super) const IDENTITY: u32 = 0xc000_003e;
    pub(super) const MMAP: u32 = 9;
    pub(super) const MPROTECT: u32 = 10;
    pub(super) const MREMAP: u32 = 25;
    pub(super) const SHMAT: u32 = 30;
    pub(super) const PTRACE: u32 = 101;
    pub(super) const PERSONALITY: u32 = 135;
    pub(super) const PKEY_MPROTECT: u32 = 329;
}
#[cfg(target_arch = "aarch64")]
mod this_architecture {
    pub(super) const IDENTITY: u32 = 0xc000_00b7;
    pub(super) const MMAP: u32 = 222;
    pub(super) const MPROTECT: u32 = 226;
    pub(super) const MREMAP: u32 = 216;
    pub(super) const SHMAT: u32 = 196;
    pub(super) const PTRACE: u32 = 117;
    pub(super) const PERSONALITY: u32 = 92;
    pub(super) const PKEY_MPROTECT: u32 = 288;
}
use this_architecture::{MMAP, MPROTECT, MREMAP, PERSONALITY, PKEY_MPROTECT, PTRACE, SHMAT};
const THIS_ARCHITECTURE: u32 = this_architecture::IDENTITY;

const PROT_WRITE: u32 = 2;
const PROT_EXEC: u32 = 4;
const MAP_SHARED: u32 = 1;
const MAP_ANONYMOUS: u32 = 0x20;
const SHM_EXEC: u32 = 0o100000;
const FIRST_NUMBER_OF_THE_X32_CALLS: u32 = 0x4000_0000;

const READ_IMPLIES_EXEC: u32 = 0x0040_0000;
const ASKS_FOR_THE_PERSONALITY: u32 = 0xffff_ffff;

const MOST_RANGES: usize = 24;

#[derive(Copy, Clone)]
enum Target {
    Next,
    Label(usize),
}
use Target::{Label, Next};

#[derive(Default)]
struct Assembler {
    instructions: Vec<(u16, Target, Target, u32)>,
    positions: Vec<Option<usize>>,
}

impl Assembler {
    fn label(&mut self) -> usize {
        self.positions.push(None);
        self.positions.len() - 1
    }

    fn place(&mut self, label: usize) {
        self.positions[label] = Some(self.instructions.len());
    }

    fn load(&mut self, offset: u32) {
        self.instructions.push((LOAD_WORD, Next, Next, offset));
    }

    fn jump(&mut self, test: u16, value: u32, if_true: Target, if_false: Target) {
        self.instructions.push((test, if_true, if_false, value));
    }

    fn jump_always(&mut self, to: usize) {
        self.instructions.push((JUMP_ALWAYS, Label(to), Next, 0));
    }

    fn answer(&mut self, value: u32) {
        self.instructions.push((RETURN, Next, Next, value));
    }

    fn answer_at(&mut self, label: usize, value: u32) {
        self.place(label);
        self.answer(value);
    }

    fn finish(self) -> Vec<Instruction> {
        let distance = |from: usize, target: Target| match target {
            Next => 0,
            Label(label) => self.positions[label].expect("every label is placed") - from - 1,
        };
        let short = |distance: usize| {
            u8::try_from(distance).expect("a test jumps at most 255 instructions ahead")
        };
        let instructions = self.instructions.iter().enumerate();
        instructions
            .map(|(at, &(code, if_true, if_false, value))| match code {
                JUMP_ALWAYS => Instruction {
                    code,
                    jump_if_true: 0,
                    jump_if_false: 0,
                    value: distance(at, if_true) as u32,
                },
                _ => Instruction {
                    code,
                    jump_if_true: short(distance(at, if_true)),
                    jump_if_false: short(distance(at, if_false)),
                    value,
                },
            })
            .collect()
    }

    fn jump_if_called_from(&mut self, ranges: &[Range<u64>], inside: usize, outside: usize) {
        let halves = |address: u64| ((address >> 32) as u32, address as u32);
        for range in ranges {
            let (at_or_above_start, next_range) = (self.label(), self.label());
            let ((start_high, start_low), (end_high, end_low)) =
                (halves(range.start), halves(range.end));
            self.load(INSTRUCTION_POINTER + HIGH_HALF);
            self.jump(JUMP_IF_GREATER, start_high, Label(at_or_above_start), Next);
            self.jump(JUMP_IF_EQUAL, start_high, Next, Label(next_range));
            self.load(INSTRUCTION_POINTER);
            self.jump(JUMP_IF_GREATER_OR_EQUAL, start_low, Next, Label(next_range));
            self.place(at_or_above_start);
            self.load(INSTRUCTION_POINTER + HIGH_HALF);
            self.jump(JUMP_IF_GREATER, end_high, Label(next_range), Next);
            self.jump(JUMP_IF_EQUAL, end_high, Next, Label(inside));
            self.load(INSTRUCTION_POINTER);
            self.jump(JUMP_IF_GREATER_OR_EQUAL, end_low, Next, Label(inside));
            self.place(next_range);
        }
        self.jump_always(outside);
    }
}

fn few_ranges(ranges: &[Range<u64>]) -> Vec<Range<u64>> {
    let mut sorted: Vec<Range<u64>> = ranges
        .iter()
        .filter(|range| range.start < range.end)
        .cloned()
        .collect();
    sorted.sort_by_key(|range| range.start);
    let mut merged: Vec<Range<u64>> = Vec::new();
    for range in sorted {
        match merged.last_mut() {
            Some(last) if range.start <= last.end => last.end = last.end.max(range.end),
            _ => merged.push(range),
        }
    }
    while merged.len() > MOST_RANGES {
        let gap = |at: usize| merged[at + 1].start - merged[at].end;
        let at = (0..merged.len() - 1)
            .min_by_key(|&at| gap(at))
            .expect("there are two ranges");
        let next = merged.remove(at + 1);
        merged[at].end = next.end;
    }
    merged
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Libraries {
    MayBeLoaded,
    AreNeverLoaded,
}

pub fn program(code_of_this_process: &[Range<u64>], libraries: Libraries) -> Vec<Instruction> {
    let own_code = match libraries {
        Libraries::MayBeLoaded => Vec::new(),
        Libraries::AreNeverLoaded => few_ranges(code_of_this_process),
    };
    let mut filter = Assembler::default();
    let [
        no_such_call,
        never,
        far_map,
        map,
        protect,
        remap,
        attach,
        personality,
    ] = core::array::from_fn(|_| filter.label());

    filter.load(ARCHITECTURE);
    filter.jump(JUMP_IF_EQUAL, THIS_ARCHITECTURE, Next, Label(no_such_call));
    filter.load(NUMBER);
    if cfg!(target_arch = "x86_64") {
        filter.jump(
            JUMP_IF_GREATER_OR_EQUAL,
            FIRST_NUMBER_OF_THE_X32_CALLS,
            Label(no_such_call),
            Next,
        );
    }
    filter.jump(JUMP_IF_EQUAL, MMAP, Label(far_map), Next);
    filter.jump(JUMP_IF_EQUAL, MPROTECT, Label(protect), Next);
    filter.jump(JUMP_IF_EQUAL, PKEY_MPROTECT, Label(protect), Next);
    filter.jump(JUMP_IF_EQUAL, MREMAP, Label(remap), Next);
    filter.jump(JUMP_IF_EQUAL, SHMAT, Label(attach), Next);
    filter.jump(JUMP_IF_EQUAL, PERSONALITY, Label(personality), Next);
    filter.jump(JUMP_IF_EQUAL, PTRACE, Label(never), Next);
    filter.answer(ALLOW);
    filter.answer_at(no_such_call, NO_SUCH_CALL);
    filter.answer_at(never, REFUSE);
    filter.place(far_map);
    filter.jump_always(map);

    let [allow, refuse] = core::array::from_fn(|_| filter.label());
    filter.place(protect);
    filter.load(argument(2));
    filter.jump(JUMP_IF_ANY_BIT_SET, PROT_EXEC, Label(refuse), Label(allow));
    filter.place(attach);
    filter.load(argument(2));
    filter.jump(JUMP_IF_ANY_BIT_SET, SHM_EXEC, Label(refuse), Label(allow));
    filter.place(personality);
    filter.load(argument(0));
    filter.jump(JUMP_IF_EQUAL, ASKS_FOR_THE_PERSONALITY, Label(allow), Next);
    filter.jump(
        JUMP_IF_ANY_BIT_SET,
        READ_IMPLIES_EXEC,
        Label(refuse),
        Label(allow),
    );
    filter.answer_at(allow, ALLOW);
    filter.answer_at(refuse, REFUSE);

    let [has_a_size, allow, refuse] = core::array::from_fn(|_| filter.label());
    filter.place(remap);
    filter.load(argument(1));
    filter.jump(JUMP_IF_EQUAL, 0, Next, Label(has_a_size));
    filter.load(argument(1) + HIGH_HALF);
    filter.jump(JUMP_IF_EQUAL, 0, Label(refuse), Next);
    filter.place(has_a_size);
    filter.jump_if_called_from(&own_code, refuse, allow);
    filter.answer_at(allow, ALLOW);
    filter.answer_at(refuse, REFUSE);

    let [allow, refuse] = core::array::from_fn(|_| filter.label());
    filter.place(map);
    filter.load(argument(2));
    filter.jump(JUMP_IF_ANY_BIT_SET, PROT_EXEC, Next, Label(allow));
    filter.jump(JUMP_IF_ANY_BIT_SET, PROT_WRITE, Label(refuse), Next);
    filter.load(argument(3));
    filter.jump(
        JUMP_IF_ANY_BIT_SET,
        MAP_ANONYMOUS | MAP_SHARED,
        Label(refuse),
        Next,
    );
    filter.jump_if_called_from(&own_code, refuse, allow);
    filter.answer_at(allow, ALLOW);
    filter.answer_at(refuse, REFUSE);

    filter.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Copy, Clone)]
    struct Call {
        number: u32,
        architecture: u32,
        from: u64,
        arguments: [u64; 6],
    }

    fn call(number: u32, from: u64, arguments: &[u64]) -> Call {
        let mut all = [0; 6];
        all[..arguments.len()].copy_from_slice(arguments);
        Call {
            number,
            architecture: THIS_ARCHITECTURE,
            from,
            arguments: all,
        }
    }

    fn word(call: &Call, offset: u32) -> u32 {
        let half = |value: u64, is_high: bool| {
            if is_high {
                (value >> 32) as u32
            } else {
                value as u32
            }
        };
        match offset {
            NUMBER => call.number,
            ARCHITECTURE => call.architecture,
            8 | 12 => half(call.from, offset == 12),
            _ => half(call.arguments[(offset as usize - 16) / 8], offset % 8 == 4),
        }
    }

    fn run(program: &[Instruction], call: &Call) -> u32 {
        let (mut at, mut held) = (0, 0u32);
        loop {
            let Instruction {
                code,
                jump_if_true,
                jump_if_false,
                value,
            } = program[at];
            let is_true = match code {
                LOAD_WORD => {
                    held = word(call, value);
                    at += 1;
                    continue;
                }
                RETURN => return value,
                JUMP_ALWAYS => {
                    at += 1 + value as usize;
                    continue;
                }
                JUMP_IF_EQUAL => held == value,
                JUMP_IF_GREATER => held > value,
                JUMP_IF_GREATER_OR_EQUAL => held >= value,
                JUMP_IF_ANY_BIT_SET => held & value != 0,
                _ => panic!("an instruction that the filter does not use"),
            };
            at += 1 + usize::from(if is_true { jump_if_true } else { jump_if_false });
        }
    }

    const READ: u64 = 1;
    const WRITE: u64 = PROT_WRITE as u64;
    const EXECUTE: u64 = PROT_EXEC as u64;
    const PRIVATE: u64 = 2;
    const SHARED: u64 = MAP_SHARED as u64;
    const SHARED_VALIDATE: u64 = 3;
    const ANONYMOUS: u64 = MAP_ANONYMOUS as u64;
    const FIXED: u64 = 0x10;
    const MAY_MOVE: u64 = 1;
    #[cfg(target_arch = "x86_64")]
    const READ_MUNMAP_EXECVE_CLONE_SECCOMP_PRCTL_MEMFD_CREATE: [u32; 7] =
        [0, 11, 59, 56, 317, 157, 319];
    #[cfg(target_arch = "aarch64")]
    const READ_MUNMAP_EXECVE_CLONE_SECCOMP_PRCTL_MEMFD_CREATE: [u32; 7] =
        [63, 215, 221, 220, 277, 167, 279];

    const OWN: [Range<u64>; 3] = [
        0x5555_0000_1000..0x5555_0800_0000,
        0x7ffe_ffff_f000..0x7fff_0000_2000,
        0x7fff_2000_0000..0x7fff_2000_1000,
    ];
    const INSIDE: [u64; 6] = [
        0x5555_0000_1000,
        0x5555_07ff_ffff,
        0x7ffe_ffff_f000,
        0x7fff_0000_0000,
        0x7fff_0000_1fff,
        0x7fff_2000_0fff,
    ];
    const OUTSIDE: [u64; 8] = [
        0,
        0x5555_0000_0fff,
        0x5555_0800_0000,
        0x5554_0000_2000,
        0x7ffe_ffff_efff,
        0x7fff_0000_2000,
        0x7fff_2000_1000,
        0xffff_ffff_ff60_0000,
    ];

    fn both_forms() -> [Vec<Instruction>; 2] {
        [
            program(&OWN, Libraries::MayBeLoaded),
            program(&OWN, Libraries::AreNeverLoaded),
        ]
    }

    fn everywhere() -> impl Iterator<Item = u64> {
        INSIDE.into_iter().chain(OUTSIDE)
    }

    fn assert_answer(filter: &[Instruction], answer: u32, number: u32, arguments: &[u64]) {
        for from in everywhere() {
            assert_eq!(
                run(filter, &call(number, from, arguments)),
                answer,
                "{number} {arguments:x?} from {from:#x}"
            );
        }
    }

    fn assert_refused_from_own_code_only(filter: &[Instruction], number: u32, arguments: &[u64]) {
        for from in INSIDE {
            assert_eq!(
                run(filter, &call(number, from, arguments)),
                REFUSE,
                "{number} {arguments:x?} from {from:#x}"
            );
        }
        for from in OUTSIDE {
            assert_eq!(
                run(filter, &call(number, from, arguments)),
                ALLOW,
                "{number} {arguments:x?} from {from:#x}"
            );
        }
    }

    #[test]
    fn memory_that_is_not_executable_is_nobodys_business() {
        for filter in both_forms() {
            assert_answer(
                &filter,
                ALLOW,
                MMAP,
                &[0, 4096, READ | WRITE, PRIVATE | ANONYMOUS, u64::MAX, 0],
            );
            assert_answer(&filter, ALLOW, MMAP, &[0, 4096, READ, SHARED, 3, 0]);
            assert_answer(&filter, ALLOW, MPROTECT, &[0x1000, 4096, READ]);
            assert_answer(&filter, ALLOW, MPROTECT, &[0x1000, 4096, 0]);
            assert_answer(
                &filter,
                ALLOW,
                PKEY_MPROTECT,
                &[0x1000, 4096, READ | WRITE, 1],
            );
            assert_answer(&filter, ALLOW, SHMAT, &[1, 0, 0]);
        }
    }

    #[test]
    fn other_calls_pass_and_so_do_the_two_that_add_filters() {
        for filter in both_forms() {
            for number in READ_MUNMAP_EXECVE_CLONE_SECCOMP_PRCTL_MEMFD_CREATE {
                assert_answer(
                    &filter,
                    ALLOW,
                    number,
                    &[EXECUTE, EXECUTE, EXECUTE, EXECUTE],
                );
            }
        }
    }

    #[test]
    fn no_memory_becomes_executable_here_or_in_what_is_started() {
        for filter in both_forms() {
            for access in [EXECUTE, READ | EXECUTE, READ | WRITE | EXECUTE] {
                assert_answer(&filter, REFUSE, MPROTECT, &[0x1000, 4096, access]);
                assert_answer(&filter, REFUSE, PKEY_MPROTECT, &[0x1000, 4096, access, 0]);
            }
        }
    }

    #[test]
    fn executable_memory_comes_from_no_place_that_can_be_written() {
        for filter in both_forms() {
            assert_answer(
                &filter,
                REFUSE,
                MMAP,
                &[0, 4096, READ | EXECUTE, PRIVATE | ANONYMOUS, u64::MAX, 0],
            );
            assert_answer(
                &filter,
                REFUSE,
                MMAP,
                &[0, 4096, READ | EXECUTE, SHARED | ANONYMOUS, u64::MAX, 0],
            );
            assert_answer(
                &filter,
                REFUSE,
                MMAP,
                &[0, 4096, READ | EXECUTE, SHARED, 3, 0],
            );
            assert_answer(
                &filter,
                REFUSE,
                MMAP,
                &[0, 4096, READ | EXECUTE, SHARED_VALIDATE, 3, 0],
            );
            assert_answer(
                &filter,
                REFUSE,
                MMAP,
                &[0, 4096, READ | WRITE | EXECUTE, PRIVATE, 3, 0],
            );
            assert_answer(&filter, REFUSE, SHMAT, &[1, 0, u64::from(SHM_EXEC)]);
        }
    }

    #[test]
    fn shared_memory_gets_no_second_view() {
        for filter in both_forms() {
            assert_answer(&filter, REFUSE, MREMAP, &[0x1000, 0, 4096, MAY_MOVE]);
        }
    }

    #[test]
    fn nobody_writes_into_the_code_of_another_process() {
        for filter in both_forms() {
            for request in [0, 4, 16, 0x4206] {
                assert_answer(&filter, REFUSE, PTRACE, &[request, 1234, 0x1000, 0]);
            }
        }
    }

    #[test]
    fn reading_does_not_come_to_imply_executing() {
        for filter in both_forms() {
            assert_answer(
                &filter,
                REFUSE,
                PERSONALITY,
                &[u64::from(READ_IMPLIES_EXEC)],
            );
            assert_answer(
                &filter,
                REFUSE,
                PERSONALITY,
                &[u64::from(READ_IMPLIES_EXEC) | 0x0004_0000],
            );
            assert_answer(
                &filter,
                ALLOW,
                PERSONALITY,
                &[u64::from(ASKS_FOR_THE_PERSONALITY)],
            );
            assert_answer(&filter, ALLOW, PERSONALITY, &[0x0004_0000]);
        }
    }

    #[test]
    fn the_tables_of_other_architectures_are_closed() {
        for filter in both_forms() {
            for from in everywhere() {
                let foreign = Call {
                    architecture: 0x4000_0003,
                    ..call(192, from, &[0, 4096, READ | EXECUTE, PRIVATE | ANONYMOUS])
                };
                assert_eq!(run(&filter, &foreign), NO_SUCH_CALL);
            }
            if cfg!(target_arch = "x86_64") {
                assert_answer(
                    &filter,
                    NO_SUCH_CALL,
                    MMAP + FIRST_NUMBER_OF_THE_X32_CALLS,
                    &[0, 4096, READ | EXECUTE, PRIVATE | ANONYMOUS],
                );
            }
        }
    }

    const FILE_AS_CODE: [[u64; 6]; 2] = [
        [0, 4096, READ | EXECUTE, PRIVATE, 3, 0],
        [0x1000, 4096, READ | EXECUTE, PRIVATE | FIXED | 0x800, 3, 0],
    ];
    const MOVES: [[u64; 5]; 2] = [
        [0x1000, 4096, 8192, MAY_MOVE, 0],
        [0x1000, 1 << 32, 1 << 33, MAY_MOVE | 2, 0x7000_0000],
    ];

    #[test]
    fn where_libraries_may_be_loaded_a_file_is_mapped_as_code_and_mappings_move() {
        let filter = program(&OWN, Libraries::MayBeLoaded);
        for arguments in FILE_AS_CODE {
            assert_answer(&filter, ALLOW, MMAP, &arguments);
        }
        for arguments in MOVES {
            assert_answer(&filter, ALLOW, MREMAP, &arguments);
        }
    }

    #[test]
    fn where_none_is_ever_loaded_only_the_loader_of_a_started_program_does_that() {
        let filter = program(&OWN, Libraries::AreNeverLoaded);
        for arguments in FILE_AS_CODE {
            assert_refused_from_own_code_only(&filter, MMAP, &arguments);
        }
        for arguments in MOVES {
            assert_refused_from_own_code_only(&filter, MREMAP, &arguments);
        }
    }

    #[test]
    fn ranges_are_sorted_joined_and_kept_few() {
        assert_eq!(
            few_ranges(&[30..40, 10..20, 20..25, 5..5, 12..14]),
            [10..25, 30..40]
        );
        let many: Vec<Range<u64>> = (0..100u64)
            .map(|at| at * 1000 + at * at..at * 1000 + at * at + 10)
            .collect();
        let few = few_ranges(&many);
        assert_eq!(few.len(), MOST_RANGES);
        assert!(many.iter().all(|range| {
            few.iter()
                .any(|it| it.start <= range.start && range.end <= it.end)
        }));
        let filter = program(&many, Libraries::AreNeverLoaded);
        for range in &many {
            assert_eq!(
                run(
                    &filter,
                    &call(MMAP, range.start, &[0, 4096, READ | EXECUTE, PRIVATE, 3, 0])
                ),
                REFUSE
            );
        }
        assert_eq!(
            run(
                &filter,
                &call(MMAP, 1 << 40, &[0, 4096, READ | EXECUTE, PRIVATE, 3, 0])
            ),
            ALLOW
        );
    }
}
