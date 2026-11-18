/// Repeats a block for each index of a range that is known at compile time. It ends at 8 or below, or at the limit
/// that is named first.
macro_rules! unroll {
    ($index:ident in $start:expr, $end:expr => $body:block) => {
        unroll!(@ $index, $start, $end, $body, 8: 0 1 2 3 4 5 6 7)
    };
    (10, $index:ident in $start:expr, $end:expr => $body:block) => {
        unroll!(@ $index, $start, $end, $body, 10: 0 1 2 3 4 5 6 7 8 9)
    };
    (16, $index:ident in $start:expr, $end:expr => $body:block) => {
        unroll!(@ $index, $start, $end, $body, 16: 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15)
    };
    (@ $index:ident, $start:expr, $end:expr, $body:block, $limit:literal: $($value:literal)*) => {
        debug_assert!($end < $limit + 1);
        $(
            #[allow(unused_assignments, unused_comparisons, clippy::int_plus_one)]
            if $start <= $value && $value < $end {
                let $index: usize = $value;
                $body
            }
        )*
    };
}

/// Has a copy of the first expression for each of the common lengths, in which the length is a constant.
macro_rules! for_short_length {
    ($length:expr, |$name:ident| $short:expr, _ => $long:expr) => {
        for_short_length!(@ $length, $name, $short, $long, 3 4 5 6 7 8)
    };
    (@ $length:expr, $name:ident, $short:expr, $long:expr, $($value:literal)*) => {
        match $length {
            $($value => {
                const $name: usize = $value;
                $short
            })*
            _ => $long,
        }
    };
}

pub(crate) use {for_short_length, unroll};
