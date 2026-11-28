//! Narrow lanes in general registers, all of a register at once.
use super::{SimdElement as E, Word};

pub struct Packed<T>(T);
macro_rules! ops { ($($name:ident($($a:ident),*) $body:block)*) => { $(#[inline(always)] pub fn $name($($a: Word),*) -> Word $body)* }; }
impl<T: E> Packed<T> {
    const BITS: u32 = if T::SIZE < 4 { 8 * T::SIZE as u32 } else { 8 };
    pub const LANES: u32 = Word::BITS / Self::BITS;
    const FULL: Word = !(!0 << Self::BITS);
    const ONES: Word = !0 / Self::FULL;
    pub const TOP: Word = Self::ONES << (Self::BITS - 1);
    const REST: Word = !Self::TOP;
    /// What turns the order of the lanes into that of unsigned ones.
    const SIGN: Word = if T::SIGNED { Self::TOP } else { 0 };
    /// The lowest bit of a lane.
    pub const fn place(lane: u32) -> u32 {
        Self::BITS * if cfg!(target_endian = "big") { Self::LANES - 1 - lane } else { lane }
    }
    /// One product moves the lowest bits to the top, and each lane has its bit.
    const BY_LANE: (Word, Word) = {
        let (mut both, mut i) = ((0, 0), 0);
        while i < Self::LANES {
            both.0 |= 1 << (Word::BITS - Self::LANES + i - Self::place(i));
            both.1 |= 1 << (Self::place(i) + i);
            i += 1;
        }
        both
    };
    ops! {
        splat(lane) { (lane & Self::FULL) * Self::ONES }
        // All bits of a lane are as the highest.
        filled(a) { let top = a & Self::TOP; (top << 1).wrapping_sub(top >> (Self::BITS - 1)) }
        // The same. LLVM drops it where only the highest are used.
        negative(a) { let top = a & Self::TOP; top | (top - (top >> (Self::BITS - 1))) & Self::REST }
        sign_bits(a) {
            let (by, down) = (Self::BY_LANE.0, Self::BITS - 1);
            let all = if cfg!(target_endian = "big") { (a >> down & Self::ONES).wrapping_mul(by) } else { (a & Self::TOP).wrapping_mul(by >> down) };
            all >> (Word::BITS - Self::LANES)
        }
        of_bits(bits) { Self::negative((Self::splat(bits) & Self::BY_LANE.1) + Self::REST) }
        and(a, b) { a & b }
        or(a, b) { a | b }
        xor(a, b) { a ^ b }
        not(a) { !a }
        and_not(a, b) { !a & b }
        blend(m, yes, no) { no ^ (yes ^ no) & m }
        // After logic with masks, one of them is filled.
        select(m, yes, no) { Self::blend(Self::negative(m), yes, no) }
        add(a, b) { ((a & Self::REST) + (b & Self::REST)) ^ (a ^ b) & Self::TOP }
        sub(a, b) { ((a | Self::TOP) - (b & Self::REST)) ^ (a ^ !b) & Self::TOP }
        neg(a) { Self::sub(0, a) }
        abs(a) { (a ^ Self::filled(a)) + (a >> (Self::BITS - 1) & Self::ONES) }
        differ(a, b) { let x = a ^ b; ((x & Self::REST) + Self::REST) | x }
        ne(a, b) { Self::negative(Self::differ(a, b)) }
        eq(a, b) { Self::negative(!Self::differ(a, b)) }
        // This is short if one is a constant.
        less(a, b) { let (a, b) = (!a ^ Self::SIGN, b ^ Self::SIGN); a & b | ((a & Self::REST) + (b & Self::REST)) & (a | b) }
        lt(a, b) { Self::negative(Self::less(a, b)) }
        le(a, b) { Self::negative(!Self::less(b, a)) }
        // Where the sum of unsigned lanes is too large.
        carried(a, b) { Self::filled((a & b) + ((a ^ b) >> 1 & Self::REST)) }
        below(a, b) { Self::carried(!a ^ Self::SIGN, b ^ Self::SIGN) }
        min(a, b) { Self::blend(Self::below(a, b), a, b) }
        max(a, b) { Self::blend(Self::below(a, b), b, a) }
        abs_diff(a, b) { let turn = Self::below(a, b) ^ Self::SIGN; (a ^ turn) - (b ^ turn) }
        average(a, b) { (((a ^ Self::SIGN) | (b ^ Self::SIGN)) - ((a ^ b) >> 1 & Self::REST)) ^ Self::SIGN }
        // The limit with the sign of a, where the highest bit of over is set.
        limited(over, a, value) { Self::blend(Self::filled(over), Self::REST + (a >> (Self::BITS - 1) & Self::ONES), value) }
        saturating_add(a, b) {
            if T::SIGNED { let sum = Self::add(a, b); return Self::limited((a ^ sum) & (b ^ sum), a, sum); }
            let over = Self::carried(a, b);
            (a | over) + (b & !over)
        }
        saturating_sub(a, b) {
            if T::SIGNED { let sum = Self::sub(a, b); return Self::limited((a ^ sum) & (a ^ b), a, sum); }
            let over = Self::below(a, b);
            (a | over) - (b | over)
        }
        // The count is less than the bits of a lane.
        shl_by(a, n) { let n = n % Self::BITS as Word; a << n & Self::splat(Self::FULL << n) }
        shr_by(a, n) {
            let (n, sign) = (n % Self::BITS as Word, a & Self::SIGN);
            a >> n & Self::splat(Self::FULL >> n) | (sign << 1).wrapping_sub(sign >> n)
        }
        // These two, and the zeros, are for bytes.
        shl(a, by) { Self::steps(a, by, Self::shl_by) }
        shr(a, by) { Self::steps(a, by, Self::shr_by) }
        swap_bytes(a) { if T::SIZE == 1 { a } else { Packed::<u16>::shl_by(a, 8) | Packed::<u16>::shr_by(a, 8) } }
        reverse_bits(a) {
            if cfg!(any(target_arch = "arm", target_arch = "aarch64", target_arch = "loongarch64")) { return Self::swap_bytes(a.reverse_bits().swap_bytes()); }
            let swap = |a: Word, n, low| (a & Packed::<u8>::splat(low)) << n | a >> n & Packed::<u8>::splat(low);
            Self::swap_bytes(swap(swap(swap(a, 4, 0x0f), 2, 0x33), 1, 0x55))
        }
        count_ones(a) {
            let of = Packed::<u8>::splat;
            let a = a - (a >> 1 & of(0x55));
            let a = (a & of(0x33)) + (a >> 2 & of(0x33));
            let a = (a + (a >> 4)) & of(0x0f);
            if T::SIZE == 1 { a } else { (a + (a >> 8)) & Self::splat(0xff) }
        }
        leading_zeros(a) {
            let down = |a: Word, n| a | Packed::<T::Bits>::shr_by(a, n);
            Self::count_ones(!down(down(down(a, 1), 2), 4))
        }
        trailing_zeros(a) { Self::count_ones(!a & Self::sub(a, Self::ONES)) }
        // Of all lanes, in the lowest bits. The low bits of all fit in a lane, and the second part is gone where LLVM knows that there are no others.
        sum(a) {
            let (low, last) = (Self::splat(Self::FULL / Self::LANES as Word), Word::BITS - Self::BITS);
            let up = Self::BITS - Self::LANES.ilog2();
            ((a & low).wrapping_mul(Self::ONES) >> last) + (((a & !low) >> up).wrapping_mul(Self::ONES) >> last << up)
        }
    }
    #[inline(always)]
    fn steps(mut a: Word, by: Word, moved: impl Fn(Word, Word) -> Word) -> Word {
        macro_rules! step { ($($k:literal)*) => {$(
            a = Self::blend(Self::filled(by << (7 - $k)), moved(a, 1 << $k), a);
        )*}; }
        step!(0 1 2);
        a
    }
}

/// A word of the result of a shuffle: the lanes that come from the same word by the same shift move together.
#[derive(Copy, Clone)]
pub struct Move {
    pub from: u8,
    pub left: u8,
    pub right: u8,
    pub keep: Word,
    /// A lane that goes to several places is multiplied.
    pub times: Word,
    /// All bytes, from the last to the first.
    pub turned: bool,
}
const HALF: u32 = Word::BITS / 2;
/// The bytes of the lower half, each in 16 bits.
#[inline(always)]
pub fn apart(word: Word) -> Word {
    let word = word << HALF >> HALF;
    let word = if HALF > 16 { (word | word << 16) & (!0 / 0x10001) } else { word };
    (word | word << 8) & (!0 / 0x101)
}
/// The reverse.
#[inline(always)]
pub fn together(word: Word) -> Word {
    let word = word & (!0 / 0x101);
    let word = if HALF > 16 { (word | word >> 8) & (!0 / 0x10001) } else { word };
    (word | word >> (HALF / 2)) << HALF >> HALF
}
pub const fn plan(index: &[u8; 64], size: usize, lanes: usize) -> [[Move; 8]; 16] {
    let (mut all, mut i) = ([moves::<u8>(index, 64); 16], 0);
    while i < 16 && i < size * lanes / size_of::<Word>() {
        all[i] = if size == 1 { moves::<u8>(index, i) } else { moves::<u16>(index, i) };
        i += 1;
    }
    all
}
pub const fn count(plan: &[[Move; 8]; 16]) -> usize {
    let (mut n, mut i) = (0, 0);
    while i < 128 {
        n += (plan[i / 8][i % 8].keep != 0) as usize;
        i += 1;
    }
    n
}
const fn moves<T: E>(index: &[u8; 64], word: usize) -> [Move; 8] {
    let (per, mut i) = (Packed::<T>::LANES as usize, 0);
    let mut all = [Move { from: 0, left: 0, right: 0, keep: 0, times: 1, turned: false }; 8];
    while T::SIZE == 1
        && i < per
        && (word + 1) * per <= 64
        && index[word * per + i] == (index[word * per] | (per - 1) as u8) - i as u8
    {
        i += 1;
    }
    if i == per {
        all[0] = Move { from: index[word * per] / per as u8, keep: !0, turned: true, ..all[0] };
        return all;
    }
    i = 0;
    while i < per && (word + 1) * per <= 64 {
        let at = index[word * per + i] as usize;
        let (from, there, here) =
            ((at / per) as u8, Packed::<T>::place((at % per) as u32), Packed::<T>::place(i as u32));
        let (mut times, mut k): (Word, _) = (0, 0);
        while k < per {
            times |= ((index[word * per + k] as usize == at) as Word) << Packed::<T>::place(k as u32);
            k += 1;
        }
        let it = if times.count_ones() > 2 {
            Move { from, left: 0, right: there as u8, keep: Packed::<T>::FULL, times, turned: false }
        } else {
            let (left, right) = (here.saturating_sub(there) as u8, there.saturating_sub(here) as u8);
            Move { from, left, right, keep: Packed::<T>::FULL << here, times: 1, turned: false }
        };
        k = 0;
        while all[k].keep != 0
            && (all[k].from != from || all[k].left != it.left || all[k].right != it.right || all[k].times != it.times)
        {
            k += 1;
        }
        all[k] = Move { keep: all[k].keep | it.keep, ..it };
        i += 1;
    }
    all
}
