//! `BUN_SIMD_TARGET=avx2 bun test --run-simd-tests`, for `test/internal/simd.test.ts`.
#![feature(stmt_expr_attributes)]
#![cfg_attr(target_arch = "aarch64", feature(aarch64_unstable_target_feature))]

mod bench;
mod check;
mod highway;
mod pairs;
mod probe;
mod room;

use bun_simd::SharedU8;
use bun_simd_kernels::Columns;
use core::mem::MaybeUninit;
use core::sync::atomic::AtomicU8;

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
    #[inline(never)]
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    #[inline(never)]
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }

    fn one_of<T: Copy>(&mut self, all: &[T]) -> T {
        all[self.below(all.len())]
    }

    /// Any bytes if `alphabet` is empty.
    #[inline(never)]
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

fn shared(bytes: &mut [u8]) -> &[SharedU8] {
    SharedU8::from_slice(AtomicU8::from_mut_slice(bytes))
}

type Uninit<'a, T> = &'a mut [MaybeUninit<T>];

fn columns<'a, P: From<Uninit<'a, [i32; 2]>>, I: From<Uninit<'a, i32>>>(
    pairs: &'a mut [Uninit<'_, [i32; 2]>; 2],
    indices: &'a mut [Uninit<'_, i32>; 2],
    has_names: bool,
) -> Columns<P, I> {
    let ([generated, original], [src_idx, name_idx]) = (pairs, indices);
    Columns {
        generated: P::from(generated),
        original: P::from(original),
        src_idx: I::from(src_idx),
        name_idx: has_names.then(|| I::from(name_idx)),
    }
}

/// `None` for invalid arguments.
fn run(arguments: &[&[u8]]) -> Option<bool> {
    let number = |text: &[u8]| str::from_utf8(text).ok()?.parse::<u64>().ok();
    let read = |path| bun_sys::File::read_from(bun_core::Fd::cwd(), path).ok();
    let (command, rest) = arguments.split_first()?;
    if *command == b"probe" {
        return Some(probe::run());
    }
    write_line(format_args!(
        "chosen: {} {}",
        simd::chosen_by_default(),
        simd::chosen_if_long_running()
    ));
    match (*command, rest) {
        (b"check", [seed, rounds]) => return Some(check::run(number(seed)?, number(rounds)?)),
        (b"bench", [js, json, map, only @ ..]) if only.len() < 2 => {
            bench::ONLY.set(only.concat()).ok()?;
            bench::against_highway(&read(js)?, &read(json)?, &read(map)?)
        }
        (b"edges", []) => bench::at_the_end_of_a_page(),
        (b"pauses", []) => bench::after_a_pause(),
        (b"clock", []) => bench::of_scalar_code_between_searches(),
        _ => return None,
    }
    Some(true)
}

pub fn run_from_command_line(arguments: &[&[u8]]) -> bool {
    run(arguments).unwrap_or(false)
}
