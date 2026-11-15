//! `bun test --run-simd-tests`, in debug and canary builds, for `test/internal/simd.test.ts`.
#![cfg_attr(target_arch = "aarch64", feature(aarch64_unstable_target_feature))]

mod bench;
mod check;
mod highway;
mod probe;
mod room;

use bun_simd::Target;
use bun_simd_kernels::Columns;
use core::mem::MaybeUninit;

fn write_line(line: core::fmt::Arguments<'_>) {
    let stdout = bun_core::Fd::stdout();
    let _ = bun_sys::File::borrow(&stdout).write_all(format!("{line}\n").as_bytes());
}

#[bun_simd::foreach_target]
mod simd {
    #[export]
    pub fn chosen_by_default() -> &'static str {
        stringify!(this_target)
    }

    #[export(long_running)]
    pub fn chosen_if_long_running() -> &'static str {
        stringify!(this_target)
    }

    #[export(long_running)]
    pub fn search_on_any_target(text: &[u8]) -> Option<usize> {
        isa::U8::position(text, |v| v.simd_eq(0))
    }
}

struct Random(u64);

impl Random {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }

    fn one_of<T: Copy>(&mut self, all: &[T]) -> T {
        all[self.below(all.len())]
    }

    /// Any bytes if `alphabet` is empty.
    fn bytes(&mut self, len: usize, alphabet: &[u8]) -> Vec<u8> {
        let byte = |_| match alphabet {
            [] => self.next() as u8,
            _ => self.one_of(alphabet),
        };
        (0..len).map(byte).collect()
    }

    fn words_of_all_sizes(&mut self, groups: usize) -> Vec<[u32; 4]> {
        let mut word = |_| (self.next() as i32 >> self.below(32)) as u32;
        (0..groups)
            .map(|_| core::array::from_fn(&mut word))
            .collect()
    }
}

fn zeroed<T: Copy + Default>(len: usize) -> Vec<MaybeUninit<T>> {
    vec![MaybeUninit::new(T::default()); len]
}

/// The numbers per row in each of the `Columns`.
const PER_ROW: [usize; 4] = [2, 2, 1, 1];

fn columns<'a>(of: &'a mut [&mut [MaybeUninit<i32>]; 4], has_names: bool) -> Columns<'a> {
    let [generated, original, src_idx, name_idx] = of;
    Columns {
        generated: generated.as_chunks_mut().0,
        original: original.as_chunks_mut().0,
        src_idx,
        name_idx: has_names.then_some(name_idx),
    }
}

/// `None` for invalid arguments.
fn run(arguments: &[&[u8]]) -> Option<bool> {
    let number = |text: &[u8]| str::from_utf8(text).ok()?.parse::<u64>().ok();
    let read = |path| bun_sys::File::read_from(bun_core::Fd::cwd(), path).ok();
    let [command, target, rest @ ..] = arguments else {
        return (arguments == [b"probe"]).then(probe::run);
    };
    let is_named = |it: &&Target| it.name().as_bytes() == *target;
    bun_simd::limit_to(*Target::ALL.iter().find(is_named)?);
    write_line(format_args!(
        "chosen: {} {}",
        simd::chosen_by_default(),
        simd::chosen_if_long_running()
    ));
    match (*command, rest) {
        (b"check", [seed, rounds]) => return Some(check::run(number(seed)?, number(rounds)?)),
        (b"bench", [js, json, map]) => {
            bench::against_highway(&read(js)?, &read(json)?, &read(map)?)
        }
        (b"edges", []) => bench::at_the_end_of_a_page(),
        (b"clock", []) => bench::of_scalar_code_between_searches(),
        _ => return None,
    }
    Some(true)
}

pub fn run_from_command_line(arguments: &[&[u8]]) -> bool {
    run(arguments).unwrap_or(false)
}
