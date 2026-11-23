//! How a part of a shuffle of more than 64 lanes is put together.

use crate::many::pick;
use crate::pattern::*;

#[test]
fn parts() {
    macro_rules! check { ($($op:ident $k:literal: $(($n:literal $m:literal $($at:literal)*))*;)*) => {$($({
        let (a, b): ([u16; $n], [u16; $n]) = (core::array::from_fn(|i| i as u16 + 1), core::array::from_fn(|i| i as u16 + 1001));
        let both = [a, b].concat();
        $(assert!(pick::<u16, $op, $k, $n, $m, $at>(&a, &b).to_array().into_iter().eq((0..64).map(|i| both[wrapped($op, $k, (64 * $at + i) % $m, $n, $m, 2)])), "{} {} {}", stringify!($op $k), $n, $at);)*
    })*)*}; }
    check! {
        PART 0: (128 64 0) (128 256 0 1 2 3) (256 8 0);
        PART 3: (128 64 0) (256 128 0 1);
        REVERSE 0: (128 128 0 1) (256 256 0 3);
        SLIDE_DOWN 63: (128 128 0 1);
        SLIDE_UP 1: (128 128 0 1) (256 256 0 2);
        ODD_EVEN 0: (128 128 0 1);
        SORT3_WHOLE 1: (128 128 0 1) (256 256 0 1 2 3);
        UNSORT3_WHOLE 2: (256 256 0 1 2 3);
        QUARTERS 2: (128 128 0 1) (256 256 0 3);
        TRANSPOSE_BLOCKS 0: (128 128 0 1) (256 256 0 3) (256 512 4) (512 512 0 7);
        PREPEND 63: (128 128 0);
        BROADCAST_LAST 0: (256 256 1);
    }
}
