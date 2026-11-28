#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::unroll;

fn generic<const N: usize>() -> [usize; N] {
    let mut all = [0; N];
    unroll!(for i in 0..N {
        all[i] = i + 1
    });
    all
}

fn first<const N: usize>(x: [u8; 3]) -> u8 {
    let mut sum = 0;
    unroll!(for i in 0..N {
        sum += x[i] << (2 - i)
    });
    sum
}

#[test]
fn a_generic_end_below_a_fixed_length() {
    assert_eq!((first::<0>([1, 2, 3]), first::<2>([1, 2, 3]), first::<3>([1, 2, 3])), (0, 8, 11));
    assert!(cfg!(panic = "abort") || std::panic::catch_unwind(|| first::<4>([1, 2, 3])).is_err());
}

#[test]
fn indices() {
    let mut seen = vec![];
    unroll!(for i in 0..1 {
        seen.push(i)
    });
    unroll!(for i in 0..2 {
        unroll!(for j in 0..3 {
            seen.push([0u8; i * 3 + j].len())
        })
    });
    unroll!(for i in 0..64 {
        seen.push(i)
    });
    assert!(seen.into_iter().eq((0..1).chain(0..6).chain(0..64)));
    const THREE: usize = 3;
    let mut array = [0; THREE];
    unroll!(for i in 0..THREE {
        array[i] = i
    });
    assert_eq!((array, generic::<0>(), generic::<2>(), generic::<16>()[15]), ([0, 1, 2], [], [1, 2], 16));
}

#[test]
fn from_a_start() {
    let mut all = vec![];
    bun_simd::unroll!(for i in 1..4 {
        all.push([0; i - 1].len())
    });
    bun_simd::unroll!(for i in 62..64 {
        all.push(i)
    });
    bun_simd::unroll!(for i in 64..64 {
        all.push(i)
    });
    assert_eq!(all, [0, 1, 2, 62, 63]);
}

fn between<const A: usize, const B: usize>(x: [usize; 4]) -> [Vec<usize>; 3] {
    let mut all = [vec![], vec![], vec![]];
    unroll!(for i in 1..B {
        all[0].push(x[i] + [0; i - 1].len())
    });
    unroll!(for i in A..B {
        all[1].push(x[i - 1])
    });
    unroll!(for i in A..4 {
        all[2].push(x[i - 1])
    });
    all
}

#[test]
fn constants_at_both_ends() {
    let x = [10, 20, 30, 40];
    assert_eq!(between::<2, 4>(x), [vec![20, 31, 42], vec![20, 30], vec![20, 30]]);
    assert_eq!(between::<3, 1>(x), [vec![], vec![], vec![30]]);
    assert_eq!(between::<5, 0>(x), [vec![], vec![], vec![]]);
    assert!(cfg!(panic = "abort") || std::panic::catch_unwind(|| between::<0, 0>(x)).is_err());
    let mut pairs = vec![];
    unroll!(for i in 0..3 {
        unroll!(for j in { i + 1 }..3 {
            pairs.push((i, j))
        })
    });
    assert_eq!(pairs, [(0, 1), (0, 2), (1, 2)]);
}

#[test]
fn the_name_of_the_index_in_the_range() {
    let mut all = [vec![], vec![], vec![]];
    unroll!(for i in 0..3 {
        unroll!(for i in i..3 {
            all[0].push(i)
        });
        unroll!(for i in 0..i {
            all[1].push(i)
        });
        unroll!(for i in i..{ i + 1 } {
            all[2].push(i)
        })
    });
    assert_eq!(all, [vec![0, 1, 2, 1, 2, 2], vec![0, 0, 1], vec![0, 1, 2]]);
}

struct Some;
impl Some {
    const THREE: usize = 3;
}
fn longer<const N: usize>() -> [Vec<usize>; 5] {
    let mut all = [vec![], vec![], vec![], vec![], vec![]];
    unroll!(for i in 1..N - 1 {
        all[0].push([0; i - 1].len())
    });
    unroll!(for i in N / 2..N {
        all[1].push(i)
    });
    unroll!(for i in 0..=N {
        all[2].push(i)
    });
    unroll!(for i in N - 1..=N + 1 {
        all[3].push(i)
    });
    unroll!(for i in size_of::<[u8; N]>()..Some::THREE {
        all[4].push(i)
    });
    all
}

#[test]
fn expressions_as_ends() {
    assert_eq!(longer::<4>(), [vec![0, 1], vec![2, 3], vec![0, 1, 2, 3, 4], vec![3, 4, 5], vec![]]);
    assert_eq!(longer::<1>(), [vec![], vec![0], vec![0, 1], vec![0, 1, 2], vec![1, 2]]);
    let mut all = vec![];
    unroll!(for i in 0..3 {
        unroll!(for j in i + 1..3 {
            all.push(3 * i + j)
        })
    });
    unroll!(for i in 0..=0 {
        all.push(i)
    });
    unroll!(for i in 62..=63 {
        all.push([0; i - 62].len())
    });
    unroll!(for i in Some::THREE + 59..=63 {
        all.push(i)
    });
    assert_eq!(all, [1, 2, 5, 0, 0, 1, 62, 63]);
}

#[test]
fn no_index() {
    let mut n = 0;
    unroll!(for _ in 0..3 {
        unroll!(for _ in 1..=2 {
            n += 1
        })
    });
    unroll!(for _ in 1..Some::THREE {
        n += 10
    });
    assert_eq!(n, 26);
}
