//! Plain versions of the kernels in src/jsc/bindings/highway_inflate.cpp.

use core::cell::Cell;
use core::mem::MaybeUninit;
use core::slice::{from_raw_parts, from_raw_parts_mut};

use bun_highway::inflate::kind::{END, LENGTH, LITERALS, MASK, STOP};
use bun_highway::inflate::{Distances, LANES, Lists, Litlens, ROWS};

const ROOT_BITS: usize = 11;
const LINKS: usize = 66 * 1024 / 2;

thread_local! {
    pub(crate) static IS_SUPPORTED: Cell<bool> = const { Cell::new(true) };
    /// How many bytes they have written.
    pub(crate) static WRITTEN: Cell<usize> = const { Cell::new(0) };
    /// About how many symbols would take as long.
    pub(crate) static WORK: Cell<usize> = const { Cell::new(0) };
}

#[unsafe(no_mangle)]
extern "C" fn highway_inflate_is_supported() -> bool {
    IS_SUPPORTED.get()
}

/// The root, and the table for what is longer.
fn tables<const N: usize>(lists: &Lists<N>, bits: usize, link: u32) -> Option<[Vec<u32>; 2]> {
    let lens = (1..16).flat_map(|len| (0..lists.counts()[len]).map(move |at| (len, at)));
    let space = |from| {
        lens.clone()
            .filter(|it| it.0 >= from)
            .map(|it| 1 << (15 - it.0))
            .sum::<usize>()
    };
    let long_bits = space(bits + 1).next_power_of_two().ilog2() as usize;
    if space(1) != 1 << 15 || long_bits > bits {
        return None;
    }
    let (mut root, mut long, mut code) = (vec![0; 1 << bits], vec![0; 1 << long_bits], 0u16);
    for (len, at) in lens {
        let (entry, index) = (
            lists.entries[len][usize::from(at)],
            usize::from(code.reverse_bits()),
        );
        code = code.wrapping_add(1 << (16 - len));
        let skipped = if len > bits { 15 - long_bits } else { 0 };
        root[index % (1 << bits)] = link + skipped as u32;
        let table = if len > bits { &mut long } else { &mut root };
        let slots = table[index >> skipped..]
            .iter_mut()
            .step_by(1 << (len - skipped));
        slots.for_each(|it| *it = entry + (len - skipped) as u32);
    }
    Some([root, long])
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_inflate_build(
    litlens: &Litlens,
    distances: &Distances,
    _: u32,
    _: u32,
    draft: &mut [u32; 4 * LANES * ROWS],
    entries: *mut u32,
) -> u32 {
    draft.fill(0xA5A5_A5A5);
    let made = crate::uncounted(|| {
        let ([single, long], [near, far]) =
            (tables(litlens, ROOT_BITS, 0)?, tables(distances, 9, STOP)?);
        let root = single.iter().enumerate().map(|(index, &first)| {
            let rest = index >> (first % 64);
            let (second, distance) = (single[rest], near[rest % near.len()]);
            let code_bits = first % 64 + distance % 64 - (distance >> 16).trailing_zeros() % 32;
            if [first, second].map(|it| it & 0xFFC0) == [1 << 8; 2]
                && first % 64 + second % 64 <= 11
            {
                first + (second >> 16 << 24) + second % (1 << 16)
            } else if first & !0xFF3F == LENGTH | 1 << 16
                && distance & MASK != STOP
                && code_bits <= 9
            {
                distance + (first & 0xFF3F)
            } else {
                first
            }
        });
        let all = [root.collect(), long, near, far];
        let start = |table: usize| ((table + 1) << ROOT_BITS) - all[table].len();
        for (table, (index, &entry)) in
            (0..4).flat_map(|it| core::iter::repeat(it).zip(all[it].iter().enumerate()))
        {
            let link = match entry & !63 {
                LITERALS => start(1),
                STOP => start(3),
                _ if entry & MASK == LENGTH => start(2),
                _ => 0,
            };
            // SAFETY: the tables are larger.
            unsafe {
                entries.add(start(table) + index).write(entry);
                entries
                    .cast::<u16>()
                    .add(LINKS + start(table) + index)
                    .write(link as u16);
            }
        }
        Some(ROOT_BITS as u32 | 80 << 8)
    });
    made.unwrap_or(0)
}

#[repr(C)]
struct Lanes {
    bits: [u64; LANES],
    indices: [u64; LANES],
    inputs: [*const u8; LANES],
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_inflate_look_up(
    entries: *const u32,
    root_bits: u32,
    lanes: &mut Lanes,
    to: *mut u32,
    rows: usize,
) {
    WORK.update(|it| it + 2 * LANES * rows);
    for lane in 0..LANES {
        let (bits, index) = (&mut lanes.bits[lane], &mut lanes.indices[lane]);
        // SAFETY: a lane may get so far.
        let mut input = unsafe { from_raw_parts(lanes.inputs[lane], 8 * rows + 8) };
        for token in 0..2 * rows {
            // SAFETY: links lead to tables, and there are so many rows.
            unsafe {
                *index = u64::from(*entries.cast::<u16>().add(LINKS + *index as usize))
                    | (*bits % (1 << root_bits));
                if token % 2 == lane % 2 {
                    let used = bits.leading_zeros();
                    input = &input[used as usize / 8..];
                    *bits =
                        (u64::from_le_bytes(*input.first_chunk().unwrap()) | 1 << 63) >> (used % 8);
                }
                let (entry, to) = (
                    *entries.add(*index as usize),
                    to.add((4 * lane + token % 2) * ROWS + token / 2),
                );
                (*to, *to.add(2 * ROWS)) = (entry, *bits as u32);
                *bits >>= entry % 64;
            }
        }
        lanes.inputs[lane] = input.as_ptr();
    }
}

#[unsafe(no_mangle)]
extern "C" fn highway_inflate_seek(
    tokens: &[[[u32; ROWS]; 4]; LANES],
    rows: usize,
    targets: &[u16; LANES],
    found: &mut [[u16; 2]; LANES],
) {
    for (lane, [count, bits]) in found.iter_mut().enumerate() {
        for token in 0..rows / 8 * 16 {
            let entry = match lane {
                0 => tokens[LANES - 1][1 - token % 2][rows - 1 - token / 2],
                _ => tokens[lane][token % 2][token / 2],
            };
            if *bits + entry as u16 % 64 > targets[lane] {
                break;
            }
            (*count, *bits) = (*count + 1, *bits + entry as u16 % 64);
        }
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_inflate_guess(
    entries: &[u32; 1 << ROOT_BITS],
    _: u32,
    usual: &[u8; 515],
    input: *const u8,
    bit: &mut usize,
    to: *mut u8,
    cost: &mut usize,
) -> *mut u8 {
    let turns = core::mem::replace(cost, 10);
    WORK.update(|it| it + 10);
    // SAFETY: there is so much of both.
    let (input, output) = unsafe {
        (
            from_raw_parts(input, *bit / 8 + 64 * turns),
            from_raw_parts_mut(to.cast::<MaybeUninit<u8>>(), 64 * turns),
        )
    };
    let &[.., len, first, last] = usual;
    assert!(usual[usize::from(last) + 1..256].iter().all(|&it| it == 0));
    let mut written = 0;
    for _ in 0..30 * turns {
        let word = u32::from_le_bytes(*input[*bit / 8..].first_chunk().unwrap()) >> (*bit % 8);
        let index = ((word as u8).reverse_bits() >> (8 - len)).wrapping_sub(first);
        let [bits, count, literals @ ..] = match index <= last {
            true => [len, 1, usual[usize::from(index)], 0],
            false => entries[word as usize % entries.len()].to_le_bytes(),
        };
        if bits >= 64 || count == 0 {
            break;
        }
        output[written..written + 2].write_copy_of_slice(&literals);
        (*bit, written) = (*bit + usize::from(bits), written + usize::from(count));
    }
    WRITTEN.update(|it| it + written);
    to.wrapping_add(written)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_inflate_literals(
    row: *const u32,
    groups: usize,
    to: &mut *mut u8,
) -> usize {
    // SAFETY: what the wrapper promises.
    let entries = (0..16 * groups).map(|token| unsafe { *row.add(token % 2 * ROWS + token / 2) });
    let write = |entry: &u32| {
        let [_, count, literals @ ..] = entry.to_le_bytes();
        // SAFETY: as above.
        unsafe { to.cast::<[u8; 2]>().write(literals) };
        *to = to.wrapping_add(count.into());
        WRITTEN.update(|it| it + usize::from(count));
    };
    entries
        .take_while(|it| it & MASK == LITERALS)
        .inspect(write)
        .count()
}

#[repr(C)]
struct Sheet {
    out: *mut u8,
    limit: i32,
    stage: i32,
    first: i32,
    max_distance: i32,
    offset: i32,
    lap: i32,
    written: i32,
    token: i32,
    row: *const u32,
    last: *const u32,
    dropped: usize,
    stops: usize,
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_inflate_write(
    segments: &[[*mut u32; 2]; LANES + 1],
    sheet: &mut Sheet,
) {
    let (mut segment, mut rest) = (0, 0);
    let [mut row, mut end] = segments[0];
    // SAFETY: what the wrapper promises.
    unsafe {
        sheet
            .out
            .add(sheet.stage as usize)
            .write_bytes(0xA5, 256 + 32);
        while row != segments[LANES][0] {
            let entry = |token: usize| row.add(token % 2 * ROWS + token / 2);
            let number = |token: usize| {
                let high = *entry(token) >> 16;
                let range = high.isolate_lowest_one().max(1);
                let extra =
                    (*entry(token).add(2 * ROWS) >> (*entry(token) % 32 - range.ilog2())) % range;
                ((high - range) / 2 + extra) as i32
            };
            for token in 0..16 {
                (sheet.row, sheet.token) = (row, token as i32);
                if *entry(token) & MASK == LENGTH && *entry(token + 1) & !63 == STOP {
                    *entry(token + 1) = *entry(token + 1) % 64 + entry(token + 2).replace(0);
                    sheet.stops += 1;
                }
                if *entry(token) & !63 == END {
                    *entry(token) -= END;
                    sheet.dropped = (token + 1..16)
                        .map(|it| entry(it).replace(0) as usize % 64)
                        .sum();
                    (sheet.last, segment, end) = (row.add(8), LANES - 1, row);
                }
                let (kind, to) = (*entry(token) & MASK, sheet.out.add(sheet.written as usize));
                let len = (*entry(token) >> 8) as i32 % 256 + core::mem::take(&mut rest);
                let last = token + usize::from(kind == LENGTH);
                if *entry(last) & MASK == STOP || sheet.written + len > sheet.limit {
                    return;
                }
                to.write_bytes(0xA5, len as usize + 63);
                if kind == LITERALS {
                    to.cast::<[u8; 2]>()
                        .write(((*entry(token) >> 16) as u16).to_le_bytes());
                } else {
                    let (distance, from) = (number(last) + 1, sheet.written - number(last) - 1);
                    if distance > sheet.max_distance || from < sheet.first {
                        return;
                    }
                    let from = sheet
                        .out
                        .offset((from + i32::from(from < -sheet.offset) * sheet.lap) as isize);
                    (0..len as usize).for_each(|at| *to.add(at) = *from.add(at));
                    rest = if kind == LENGTH { number(token) } else { 0 };
                }
                sheet.written += len;
                WRITTEN.update(|it| it + len as usize);
            }
            row = row.add(8);
            if row >= end {
                segment += 1;
                [row, end] = segments[segment];
            }
        }
    }
    sheet.row = row;
}
