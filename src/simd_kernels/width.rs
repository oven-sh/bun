//! What a terminal shows of a text, and in how many columns.

use bun_simd::prelude::*;
use core::mem::MaybeUninit;

#[simd]
#[inline(always)]
fn visible<W: Width>(v: Simd<u8, W, S>) -> MaskOf<u8, W, S> {
    // 0 to 0x1f and 0x7f to 0x9f become 0 to 0x20.
    (v.saturating_add(1) & 0x7f).cast_signed().simd_gt(0x20) & v.simd_ne(0xad)
}

#[kernel]
pub(crate) fn visible_latin1_width(text: &[u8]) -> usize {
    match over(text).position(|v| !v.within(0x20..=0x7e)) {
        Some(plain) => plain + over(&text[plain..]).count(visible),
        None => text.len(),
    }
}

/// In groups of three. stringWidth.test.ts has these too.
const RANGES: [[(u16, u16); 3]; 5] = [
    [(0x20, 0x7e), (0xa0, 0xa8), (0xaa, 0xac)],
    [(0xaf, 0x2ff), (0x370, 0x482), (0x48a, 0x52f)],
    [(0x2010, 0x2027), (0x2500, 0x257f), (0x2580, 0x25a9)],
    [(WIDE, 0x3029), (0x3041, 0x3096), (0x309b, 0x30ff)],
    [(0x3300, 0x9fff), (0xac00, 0xd7a3), (0xff01, 0xff60)],
];
/// From here on they take two columns.
const WIDE: u16 = 0x3000;

/// A bit for each unit.
static IS_KNOWN: [u64; 1024] = {
    let (mut bits, mut rest) = ([0; 1024], RANGES.as_flattened());
    while let [(first, last), others @ ..] = rest {
        let (mut word, end) = (*first / 64, *last / 64);
        let before = bits[word as usize] | !0 << (*first % 64);
        while word <= end {
            bits[word as usize] = !0;
            word += 1;
        }
        bits[*first as usize / 64] = before;
        bits[end as usize] &= !0 >> (63 - *last % 64);
        rest = others;
    }
    bits
};

/// The starts of the first, second and third ranges, and their lengths as `kinds` compares them.
const BY_GROUP: [[[u16; 8]; 2]; 3] = {
    let (mut all, mut i) = ([[[0; 8]; 2]; 3], 0);
    while i < 15 {
        let (first, last) = RANGES[i / 3][i % 3];
        all[i % 3][0][i / 3] = first;
        all[i % 3][1][i / 3] = (last - first + 1) ^ 0x8000;
        i += 1;
    }
    all
};

/// What is in a range, and what is wide if it is.
#[simd]
fn kinds(v: u16xN<S>) -> (MaskN<u16, S>, MaskN<u16, S>) {
    // x64 compares with signs.
    let is_below = |a: u16xN<S>, b: u16xN<S>| a.cast_signed().simd_lt(b.cast_signed());
    let signed = v ^ 0x8000;
    let from = |group: usize| is_below(u16xN::splat((RANGES[group][0].0 - 1) ^ 0x8000), signed);
    let bytes = if has!(avx512) {
        let add = |bytes: u16xN<S>, group| from(group).select(bytes + 0x202, bytes);
        add(add(add(add(u16xN::splat(0x100), 1), 2), 3), 4).bitcast::<u8>()
    } else {
        let minus_one = |group| from(group).to_simd::<u16>().bitcast::<u8>();
        let minus_group = minus_one(1) + minus_one(2) + (minus_one(3) + minus_one(4));
        u8xN::repeat(&[0, 1]) - (minus_group + minus_group)
    };
    let by_group = |table| u16xN::repeat(table).in_blocks().lookup_bytes_relaxed(bytes);
    let within = |i: usize| {
        is_below(
            signed - by_group(&BY_GROUP[i][0]),
            by_group(&BY_GROUP[i][1]),
        )
    };
    (within(0) | within(1) | within(2), from(3))
}

fn is_known(c: u16) -> bool {
    IS_KNOWN[usize::from(c / 64)] >> (c % 64) & 1 != 0
}

/// The number of leading units that are clusters of their own, and their width.
pub(crate) fn visible_utf16_width(text: &[u16]) -> (usize, usize) {
    // The caller tries again after each unit that is not in a run, so many runs end at once.
    let Some((&first, rest)) = text.split_first().filter(|it| is_known(*it.0)) else {
        return (0, 0);
    };
    if text.len() > 8 && is_known(text[1]) && is_known(text[2]) {
        return long_utf16_width(text);
    }
    let mut wide = usize::from(first >= WIDE);
    for (i, &c) in rest.iter().enumerate() {
        if !is_known(c) {
            return (i + 1, i + 1 + wide);
        }
        wide += usize::from(c >= WIDE);
    }
    (text.len(), text.len() + wide)
}

#[kernel]
fn long_utf16_width(text: &[u16]) -> (usize, usize) {
    // Zero is in no range, so the padding of the last vector ends the run.
    let partial = |(known, wide): (MaskN<u16, S>, MaskN<u16, S>)| {
        let n = (!known).count_before_first();
        (n, n + (wide & MaskN::<u16, S>::first_n(n)).count())
    };
    let mut units = 0;
    for v in over(text).exact().0 {
        if let Some(at) = (!v.within(0x20..=0x7e)).first_set() {
            if !is_known(text[units + at]) {
                return (units + at, units + at);
            }
            break;
        }
        units += u16xN::LANES;
    }
    let ((chunks, rest), mut width) = (over(&text[units..]).exact(), units);
    for v in chunks {
        let (known, wide) = kinds(v);
        if !known.all() {
            let (n, w) = partial((known, wide));
            return (units + n, width + w);
        }
        units += u16xN::LANES;
        width += u16xN::LANES + wide.count();
    }
    if rest.is_empty() {
        return (units, width);
    }
    if text.len() >= u16xN::LANES {
        // The lanes that overlap are known to be in the run.
        let ((known, wide), seen) = (kinds(u16xN::load_last(text)), u16xN::LANES - rest.len());
        let wide = !MaskN::<u16, S>::first_n(seen) & wide;
        // After a branch, the caller doesn't wait for the number of units.
        if known.all() {
            return (text.len(), width + rest.len() + wide.count());
        }
        let (n, w) = partial((known, wide));
        return (units + n - seen, width + w - seen);
    }
    let v = u16xN::load_or_default(text);
    let plain = (!v.within(0x20..=0x7e)).count_before_first();
    if text.get(plain).is_none_or(|&c| !is_known(c)) {
        return (plain, plain);
    }
    let (known, wide) = kinds(v);
    if (!known & MaskN::<u16, S>::first_n(text.len())).none() {
        return (text.len(), text.len() + wide.count());
    }
    partial((known, wide))
}

/// Bits, for the sums of [`up_to`]. One at most is set.
#[derive(Copy, Clone, PartialEq)]
struct State(u32); // For speed: a byte is widened in each round.

impl State {
    const NONE: Self = Self(0);
    const CSI: Self = Self(1);
    const OSC: Self = Self(2);
}

/// What ends any sequence.
const ENDS: ByteSet = ByteSet::new(&[0x18..=0x18, 0x1a..=0x1b, 0x9c..=0x9c]);
const OSC_ENDS: ByteSet = ByteSet::new(&[7..=7, 0x18..=0x18, 0x1a..=0x1b, 0x9c..=0x9c]);

fn payload_end<const BEL_ENDS: bool>(text: &[u8], mut from: usize) -> usize {
    let ends = const { if BEL_ENDS { OSC_ENDS } else { ENDS } };
    while let Some(v) = text.get(from..from + 16).map(u8x16::<Baseline>::load)
        && ((v & 0x60).simd_eq(0).none() || ends.contains(v).none())
    {
        from += 16;
    }
    for k in from..text.len() {
        match text[k] {
            c if c & 0x78 != 0x18 && !(c == 7 && BEL_ENDS) => {}
            0x9c | 0x18 | 0x1a => return k + 1,
            0x07 if BEL_ENDS => return k + 1,
            0x1b => {
                return if text.get(k + 1) == Some(&b'\\') {
                    k + 2
                } else {
                    k
                };
            }
            _ => {}
        }
    }
    text.len()
}

fn csi_end(text: &[u8], from: usize) -> usize {
    for k in from..text.len() {
        match text[k] {
            0x1b => return k,
            0x40..=0x7e | 0x18 | 0x1a | 0x9c => return k + 1,
            _ => {}
        }
    }
    text.len()
}

#[inline(always)]
fn sequence_end(text: &[u8], at: usize) -> usize {
    match (text[at], text.get(at + 1)) {
        (0x9b, _) => csi_end(text, at + 1),
        (0x9d, _) => payload_end::<true>(text, at + 1),
        (0x90 | 0x98 | 0x9e | 0x9f, _) => payload_end::<false>(text, at + 1),
        (0x1b, Some(b'[')) => csi_end(text, at + 2),
        (0x1b, Some(b']')) => payload_end::<true>(text, at + 2),
        (0x1b, Some(b'P' | b'X' | b'^' | b'_')) => payload_end::<false>(text, at + 2),
        (0x1b, Some(0x20..=0x2f)) if text.get(at + 2) != Some(&0x1b) => text.len().min(at + 3),
        (0x1b, Some(0x18 | 0x1a | 0x9c | 0x20..=0x7e)) => at + 2,
        _ => at + 1,
    }
}

/// None if a sequence starts with it.
static IS_VISIBLE: [Option<bool>; 256] = {
    let (mut all, mut c) = ([None; 256], 0);
    while c < 256 {
        if !matches!(c, 0x1b | 0x90 | 0x98 | 0x9b | 0x9d..=0x9f) {
            all[c] = Some(matches!(c, 0x20..=0x7e | 0xa0..=0xac | 0xae..));
        }
        c += 1;
    }
    all
};

/// The width, and where it stops: at `until`, or behind a sequence that starts before it.
#[inline(never)]
fn scalar_width(text: &[u8], until: usize) -> (usize, usize) {
    let (mut count, mut at) = (0, 0);
    while let Some(&c) = text[..until.min(text.len())].get(at) {
        match IS_VISIBLE[usize::from(c)] {
            Some(is_visible) => (count, at) = (count + usize::from(is_visible), at + 1),
            None => at = sequence_end(text, at),
        }
    }
    (count, at)
}

#[simd]
fn below(k: usize) -> u64 {
    if k >= 64 { !0 } else { (1 << k) - 1 }
}

/// Where a CSI starts, where any sequence can start, and what ends a CSI.
#[derive(Copy, Clone)]
struct Marks {
    csi: u64,
    intro: u64,
    fin: u64,
}

#[simd]
fn marks<W: Width>(v: Simd<u8, W, S>, next: Simd<u8, W, S>, bracket: u64) -> Marks {
    let esc = v.simd_eq(0x1b);
    Marks {
        csi: (esc & next.simd_eq(0x5b)).to_bitmask(),
        intro: (esc | v.within(0x90..=0x9f)).to_bitmask(),
        fin: (v.within(0x40..=0x7e) | ENDS.contains(v)).to_bitmask() & !bracket,
    }
}

/// The bits from each start through the next end, and whether the last end is missing. Later starts can lack a bit.
#[simd]
fn up_to(n: usize, starts: u64, ends: u64, has_started: u64) -> (u64, bool) {
    // A carry runs from each start up to the next end.
    let all = below(n);
    let inside = (!ends | starts) & all;
    let (sum, carry) = inside.overflowing_add(starts | has_started);
    (sum ^ inside, carry || sum > all)
}

/// What belongs to a CSI, but for some ESCs, and the state after the vector. `state` is not `OSC`.
#[simd]
fn in_csi(n: usize, csi: u64, fin: u64, state: State) -> (u64, State) {
    let (hidden, is_csi) = up_to(n, csi, fin & !(csi << 1), u64::from(state.0));
    (hidden, State(is_csi.into()))
}

/// Masks of two vectors of 16 become bits sooner together.
#[simd]
type Step = Pick![S: B64 => B64, _ => B32];

/// ESC and 0x80 to 0x9F.
#[simd]
fn can_start<W: Width>(v: Simd<u8, W, S>) -> MaskOf<u8, W, S> {
    v.simd_eq(0x1b) | v.bitcast::<i8>().simd_lt(-0x60)
}

#[simd]
fn plain<W: Width>(v: Simd<u8, W, S>) -> bool {
    can_start(v).none()
}

/// As [`in_csi`], with OSCs and STs, and where another kind of sequence can start. Only what is before the first of these counts.
#[simd]
fn with_osc<W: Width>(
    v: Simd<u8, W, S>,
    next: Simd<u8, W, S>,
    &Marks { csi, intro, fin }: &Marks,
    printable: u64,
    state: State,
) -> (u64, State, u64) {
    let (esc, short_st) = (v.simd_eq(0x1b), v.simd_eq(0x9c));
    if state != State::OSC && (esc & next.simd_eq(b']')).none() {
        let (mut hidden, state) = in_csi(W::BYTES, csi, fin, state);
        let mut others = intro ^ csi;
        // After an ESC, a byte below P (which starts a payload) is not shown, nor the one after 0x20 to 0x2F.
        if others & fin != 0 {
            let low = (esc & next.simd_lt(0x50) | v.within(0x20..=0x2f)).to_bitmask();
            let short = low & intro & below(W::BYTES - 2);
            hidden |= short << 1 | (short << 1 & low) << 1;
            others ^= short;
        }
        return (hidden, state, others & (!hidden | fin));
    }
    let osc_or_bel = (esc & next.simd_eq(b']') | v.simd_eq(0x07) | short_st).to_bitmask();
    let any_st = (esc & next.simd_eq(b'\\') | short_st).to_bitmask();
    let (osc, st) = (osc_or_bel & intro & !any_st, any_st & !osc_or_bel);
    // An ESC ends both a CSI and an OSC, and an ST is like a CSI that ends at once.
    let (a, is_csi) = up_to(
        W::BYTES,
        csi | st,
        fin & !(csi << 1),
        u64::from(state.0) & 1,
    );
    let ends = fin & !printable | osc_or_bel;
    let (b, is_osc) = up_to(W::BYTES, osc, ends, u64::from(state.0) >> 1);
    let others = (intro ^ (csi | any_st | osc)) & (!(a | b) | fin);
    let state = State(u32::from(is_csi) | u32::from(is_osc) << 1);
    (a | b, state, others)
}

#[kernel]
pub(crate) fn visible_latin1_width_exclude_ansi(text: &[u8]) -> usize {
    // Words need no wider registers, which slow some CPUs down after a pause.
    if text.len() <= 16 {
        let v = u8x16::load_or_default(text);
        if plain(v) {
            return visible(v).count();
        }
        if text.len() < 8 {
            return scalar_width(text, 8).0;
        }
        return short_latin1_width::here(text);
    } else if text.len() <= 128 && text[0] != 0x1b && !over(text).any(can_start) {
        return over(text).count(visible);
    }
    long_latin1_width::here(text)
}

/// Apart, because it has many registers to save.
#[kernel]
#[inline(never)]
fn long_latin1_width(text: &[u8]) -> usize {
    let n = Step::<S>::BYTES;
    // `bracket` is 1 if a chunk starts with the `[` of a CSI. To skip it would make each load wait for the chunk before.
    let (mut count, mut chunk, mut state, mut bracket) = (0, text, State::NONE, 0);
    let load = |from| Simd::<u8, Step<S>, S>::load(from);
    let width = |v: Simd<u8, Step<S>, S>| visible(v).count();

    // One byte more than a vector, to see what follows an ESC.
    'all: while chunk.len() > n {
        let mut v = load(chunk);
        // The state is hard to predict, so it is tested last.
        if plain(v) && state == State::NONE {
            (count, chunk) = (count + width(v), &chunk[n..]);
            // After one plain vector come more, often of printable ASCII alone.
            while chunk.len() >= 64 && u8x64::load(chunk).within(0x20..=0x7e).all() {
                (count, chunk) = (count + 64, &chunk[64..]);
            }
            while n < 64 && chunk.len() >= 64 && plain(u8x64::load(chunk)) {
                (count, chunk) = (count + visible(u8x64::load(chunk)).count(), &chunk[64..]);
            }
            loop {
                if chunk.len() <= n {
                    break 'all;
                }
                v = load(chunk);
                if !plain(v) {
                    break;
                }
                (count, chunk) = (count + width(v), &chunk[n..]);
            }
        }
        let next = load(&chunk[1..]);
        let all @ Marks { csi, intro, fin } = marks(v, next, bracket);
        let printable = visible(v).to_bitmask();
        if intro == csi && state != State::OSC {
            let hidden;
            (hidden, state) = in_csi(n, csi, fin, state);
            count += (printable & !hidden).count_ones() as usize;
            (bracket, chunk) = (csi >> (n - 1), &chunk[n..]);
            continue;
        }
        let (hidden, others);
        (hidden, state, others) = with_osc(v, next, &all, printable, state);
        let shown = printable & !hidden;
        if others != 0 {
            core::hint::cold_path();
            let other = others.trailing_zeros() as usize;
            count += (shown & below(other)).count_ones() as usize;
            (state, bracket, chunk) = (State::NONE, 0, &chunk[other..]);
            let are_many = intro.count_ones() as usize > n / 16;
            let (after, end) = scalar_width(chunk, if are_many { 128 } else { 16 });
            (count, chunk) = (count + after, &chunk[end..]);
            continue;
        }
        count += shown.count_ones() as usize;
        (bracket, chunk) = (csi >> (n - 1), &chunk[n..]);
        if state == State::OSC {
            while chunk.len() > n && (load(chunk) & 0x60).simd_eq(0).none() {
                chunk = &chunk[n..];
            }
            // Slower, so only after a vector without ESC or ST: this payload has control characters.
            let ends = |v: Simd<u8, Step<S>, S>| ENDS.contains(v) | v.simd_eq(0x07);
            while intro & fin == 0 && chunk.len() > n && ends(load(chunk)).none() {
                chunk = &chunk[n..];
            }
        }
    }
    // Some CPUs don't fetch ahead for masked loads.
    if has!(masked) {
        prefetch(chunk, chunk.len().wrapping_sub(1));
    }
    let v = Simd::<u8, Step<S>, S>::load_or_default(chunk);
    if state == State::NONE && plain(v) {
        return count + visible(v).count();
    }
    count + last_width(v, chunk, state, bracket)
}

/// Apart, so that words without sequences save no registers.
#[kernel]
#[inline(never)]
fn short_latin1_width(text: &[u8]) -> usize {
    last_width(u8x16::load_or_default(text), text, State::NONE, 0)
}

/// The width of `chunk`, which is in `v` with zeros behind it.
#[simd]
fn last_width<W: Width>(v: Simd<u8, W, S>, chunk: &[u8], state: State, bracket: u64) -> usize {
    let next = v.shift_elements_left::<1>(0);
    let all @ Marks { csi, intro, fin } = marks(v, next, bracket);
    let printable = visible(v).to_bitmask();
    if intro == csi && state != State::OSC {
        let (hidden, _) = in_csi(W::BYTES, csi, fin, state);
        return (printable & !hidden).count_ones() as usize;
    }
    let (hidden, _, others) = with_osc(v, next, &all, printable, state);
    if others == 0 {
        return (printable & !hidden).count_ones() as usize;
    }
    let other = others.trailing_zeros() as usize;
    (printable & !hidden & below(other)).count_ones() as usize
        + scalar_width(&chunk[other..], W::BYTES).0
}

const CSI: [u16; 2] = [0x1b, 0x5b];

/// The length of a run that has up to 8 units, all in ASCII.
#[inline(always)]
fn short_run(text: &[u16; 9]) -> Option<usize> {
    let plain = u16x8::<Baseline>::load(text).within(0x20..=0x7e);
    let units = (!plain).count_before_first();
    (!is_known(text[units])).then_some(units)
}

/// As [`visible_utf16_width`], but it skips a CSI if such a unit follows, and can stop early.
/// If it sets `done`, only CSIs are between the last unit and there.
pub(crate) fn visible_utf16_width_exclude_ansi(text: &[u16], done: &mut usize) -> (usize, usize) {
    // What is shorter is likely to end with the only sequences.
    if text.len() < 20 || !is_known(text[0]) || !is_known(text[1]) && text[1..3] != CSI {
        return visible_utf16_width(text);
    }
    match text.first_chunk().and_then(short_run) {
        Some(units) if text[units..units + 2] != CSI => (units, units),
        _ => utf16_width_after_csi(text, done),
    }
}

/// After so many units without a CSI, what doesn't look for them is faster.
const NEAR: usize = 192;
/// The same for units in CSIs, and what only looks for their ends.
const HIDDEN: usize = 48;

#[kernel]
fn utf16_width_after_csi(text: &[u16], done: &mut usize) -> (usize, usize) {
    let n = u8xN::LANES;
    let (mut units, mut width, mut state, mut bracket, mut last_csi) = (0, 0, State::NONE, 0, 0);
    for (i, chunk) in text.chunks(n).enumerate() {
        let [a, b] = Simd::<u16, Twice<Native<S>>, S>::load_or_default(chunk).split();
        let v: u8xN<S> = a.saturating_narrow::<u8>(b).resize();
        if state == State::NONE && i * n - last_csi > NEAR {
            return (units, width);
        }
        if state == State::NONE && v.within(0x20..=0x7e).all() {
            (units, width) = ((i + 1) * n, width + n);
            continue;
        }
        if state == State::NONE && v.simd_eq(0x1b).none() {
            let (more, wider) = long_utf16_width::here(&text[i * n..]);
            *done = i * n + more;
            return (if more > 0 { *done } else { units }, width + wider);
        }
        let is_ascii = v.cast_signed().is_negative().none();
        let (known, wide) = if is_ascii {
            (v.within(0x20..=0x7e).to_bitmask(), 0)
        } else {
            let (a, b) = (kinds(a.resize()), kinds(b.resize()));
            (a.0.narrow(b.0).to_bitmask(), a.1.narrow(b.1).to_bitmask())
        };
        let after = text.get((i + 1) * n).map_or(0, |&c| c.min(255) as u8);
        let Marks { csi, intro, fin } = marks(v, v.shift_elements_left::<1>(after), bracket);
        let hidden;
        ((hidden, state), bracket) = (in_csi(n, csi, fin, state), csi >> (n - 1));
        let stops = !(known | hidden | csi) & below(n) | intro ^ csi;
        let visible = known & !hidden & below(stops.trailing_zeros() as usize);
        if csi != 0 {
            last_csi = i * n;
        }
        if visible != 0 {
            units = i * n + visible.ilog2() as usize + 1;
        }
        width += (visible.count_ones() + (visible & wide).count_ones()) as usize;
        if stops != 0 {
            if hidden >> stops.trailing_zeros() & 1 == 0 {
                *done = i * n + stops.trailing_zeros() as usize;
            }
            return (units, width);
        }
        if i * n > units + HIDDEN || visible == 0 && !is_ascii {
            if csi != 0 {
                *done = i * n + csi.ilog2() as usize;
            }
            return (units, width);
        }
    }
    *done = text.len();
    (units, width)
}

/// Copies what is not a part of a CSI to `to`, which is as long. It stops before another kind of sequence can start, or if
/// no CSI is near or one is long, and not in a CSI. Returns how many units are done, and how many are written.
#[kernel]
pub(crate) fn strip_csi<T: Unsigned>(text: &[T], to: &mut [MaybeUninit<T>]) -> (usize, usize) {
    let (n, out) = (Step::<S>::BYTES, &mut Output::new(to));
    let (mut end, mut state, mut bracket, mut last_csi) = (0, State::NONE, 0, 0);
    for (i, chunk) in text.chunks(n).enumerate() {
        let units = Simd::<T, Scaled<u8, T, Step<S>>, S>::load_padded(chunk, T::ZERO);
        let v: Simd<u8, Step<S>, S> = units.saturating_cast::<u8>().resize();
        if state == State::NONE && chunk.len() == n && (v & 0x70).simd_eq(0x10).none() {
            out.push(units);
            end = (i + 1) * n;
            if end - last_csi > 32 + 2 * n {
                return (end, out.len());
            }
            continue;
        }
        last_csi = i * n;
        let after = text
            .get((i + 1) * n)
            .map_or(0, |c| c.to_u64().min(255) as u8);
        let Marks { csi, intro, fin } = marks(v, v.shift_elements_left::<1>(after), bracket);
        let (stops, hidden);
        ((hidden, state), stops, bracket) =
            (in_csi(n, csi, fin, state), intro ^ csi, csi >> (n - 1));
        let kept = !(hidden | csi) & below(chunk.len().min(stops.trailing_zeros() as usize));
        if kept != 0 {
            end = i * n + kept.ilog2() as usize + 1;
        }
        // For speed: `push(units.selected(kept))`, with the bound of the push above.
        if n <= out.capacity() && out.len() <= out.capacity() - n {
            out.push_with_slack(units.selected(kept));
        } else {
            let count = kept.count_ones() as usize;
            assert!(count <= out.room());
            let mut rest = out.limit(out.room());
            units.compress_relaxed(kept).store_partial_at(&mut rest, 0);
            rest.truncate(count);
        }
        if stops != 0 {
            if hidden >> stops.trailing_zeros() & 1 == 0 {
                end = i * n + stops.trailing_zeros() as usize;
            }
            return (end, out.len());
        }
        if kept | csi == 0 && state == State::CSI {
            return (end, out.len());
        }
    }
    (text.len(), out.len())
}
