//! The shuffles of one architecture or of wide vectors, by what they are for, and what is known about them at compile time.

use crate::pattern::*;

fn shuffle(op: u8, k: usize, a: &[usize], b: &[usize], lane: usize) -> Vec<usize> {
    let both = [a, b].concat();
    (0..a.len()).map(|i| both[wrapped(op, k, i, a.len(), a.len(), lane)]).collect()
}
fn shapes() -> impl Iterator<Item = (usize, usize)> {
    [1, 2, 4, 8].into_iter().flat_map(|lane| [16, 32, 64, 128, 256, 512].map(|bytes| (lane, bytes / lane)))
}
fn operand(i: usize, n: usize) -> Vec<usize> {
    (1000 * i + 1..).take(n).collect()
}

#[test]
fn blocks_and_halves() {
    for (lane, n) in shapes() {
        let (block, a, b, zero) = (16 / lane, operand(0, n), operand(1, n), vec![0; n]);
        if n > block {
            let upper = a[n / 2..].chunks(block).zip(b[n / 2..].chunks(block));
            assert_eq!(
                shuffle(ZIP_UPPER_BLOCKS, 0, &a, &b, lane),
                upper.flat_map(|(a, b)| [a, b].concat()).collect::<Vec<_>>()
            );
        }
        for k in 0..n / block {
            assert_eq!(shuffle(SLIDE_DOWN_BLOCKS, k, &a, &zero, lane), [&a[k * block..], &zero[..k * block]].concat());
            assert_eq!(
                shuffle(SLIDE_UP_BLOCKS, k, &a, &zero, lane),
                [&zero[..k * block], &a[..n - k * block]].concat()
            );
        }
    }
}

#[test]
fn strides_and_blends() {
    let by = |v: &[usize], k: usize, step| v[k..].iter().copied().step_by(step).collect::<Vec<_>>();
    for (lane, n) in shapes() {
        let (block, a, b) = (16 / lane, operand(0, n), operand(1, n));
        for (op, step) in [(EVEN_ODD_IN_BLOCK, 2), (GROUP4_IN_BLOCK, 4)].into_iter().filter(|it| it.1 <= block) {
            let want = a.chunks(block).flat_map(|it| (0..step).flat_map(move |k| by(it, k, step)));
            assert!(want.eq(shuffle(op, 0, &a, &a, lane)));
        }
        for k in [0, 2].into_iter().filter(|_| n > block) {
            let [w, x, y, z] = [by(&a, k, 4), by(&a, k + 1, 4), by(&b, k, 4), by(&b, k + 1, 4)];
            let want = if n == 2 * block { [w, x, y, z] } else { [w, y, x, z] };
            assert_eq!(shuffle(QUARTERS, k, &a, &b, lane), want.concat());
        }
        for k in 0..n / block {
            let last = a.chunks(block).flat_map(|it| vec![it[block - 1]; block]);
            let want = b[..k * block].iter().copied().chain(last).take(n);
            assert!(want.eq(shuffle(LAST_OF_BLOCK_BEFORE, k, &a, &b, lane)));
        }
        for (row, group) in (0..3).flat_map(|row| (0..3).map(move |group| (row, group))) {
            let groups: Vec<_> = (0..3).cycle().skip(row * block).take(block).collect();
            let want = (0..n).map(|i| if groups[i % block] == group { b[i] } else { a[i] });
            assert!(want.eq(shuffle(PICK3, 3 * row + group, &a, &b, lane)));
        }
    }
}

#[test]
fn what_stays_and_what_moves_blocks() {
    for op in 0..=ZIP_UPPER_BLOCKS {
        for (lane, n) in shapes().filter(|(lane, n)| lane * n > 64) {
            let (k, a, b) =
                (if matches!(op, STRIDE_IN_BLOCK | BROADCAST) { 1 } else { 2 }, operand(0, n), operand(1, n));
            if stays(op) && !(op == SHUFFLE4 && lane == 8) {
                let half = |at: usize| shuffle(op, k, &a[at..][..n / 2], &b[at..][..n / 2], lane);
                assert_eq!(shuffle(op, k, &a, &b, lane), [half(0), half(n / 2)].concat(), "{op}");
            }
            if moves_blocks(op) {
                let (wide, block) = (n * lane / 8, 16 / lane);
                assert!(
                    (0..n).all(|i| wrapped(op, k, i, n, n, lane)
                        == wrapped(op, k, i / block * 2, wide, wide, 8) / 2 * block + i % block),
                    "{op}"
                );
            }
        }
    }
}
