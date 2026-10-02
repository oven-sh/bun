# Writes /tmp/diagnostic-slices-test.rs: the `mod slices` block of ast/diagnostic.rs of the tree as a crate of its own, with tests against Go's answers.
# usage: python3 diagnostic-slices-test.py && rustc --edition 2024 --test -C overflow-checks=on -o /tmp/diagnostic-slices-test /tmp/diagnostic-slices-test.rs && /tmp/diagnostic-slices-test
src = open('/workspace/wt/typecheck/src/typecheck/ast/diagnostic.rs').read()
start = src.index('mod slices {\n')
block = src[start:]
assert block.endswith('}\n')
block = block.replace('pub(super) fn ', 'pub(crate) fn ')
assert block.count('pub(crate) fn ') == 3
tests = r'''
#[cfg(test)]
mod tests {
    use super::slices::{binary_search_func, sort_func, sort_stable_func};

    fn cmp_keys(a: (u64, u64), b: (u64, u64)) -> isize {
        if a.0 < b.0 {
            return -1;
        }
        if a.0 > b.0 {
            return 1;
        }
        0
    }

    // The vectors of importer/javascript/testdata/go_sort_func.txt: a digest of the order that Go's slices.SortFunc leaves.
    #[test]
    fn sort_func_leaves_the_order_of_go() {
        let mut state: u64 = 12345;
        let mut next = || {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            state >> 33
        };
        let vectors = include_bytes!(
            "/workspace/wt/typecheck/src/typecheck/importer/javascript/testdata/go_sort_func.txt"
        );
        let mut lines = 0;
        for line in vectors.split(|byte| *byte == b'\n') {
            let mut fields = line.split(|byte| *byte == b' ').map(|field| {
                field
                    .iter()
                    .fold(0u64, |value, digit| value * 10 + u64::from(digit - b'0'))
            });
            let (Some(n), Some(keys), Some(shape), Some(digest)) =
                (fields.next(), fields.next(), fields.next(), fields.next())
            else {
                continue;
            };
            lines += 1;
            let mut data: Vec<(u64, u64)> = Vec::new();
            for i in 0..n {
                let mut key = next() % keys;
                if shape == 1 {
                    key = i * keys / (n + 1);
                } else if shape == 2 {
                    key = (n - i) * keys / (n + 1);
                }
                data.push((key, i));
            }
            sort_func(&mut data, cmp_keys);
            let mut sum: u64 = 1469598103934665603;
            for element in &data {
                sum = (sum ^ element.1).wrapping_mul(1099511628211);
            }
            assert_eq!(sum, digest, "n={n} keys={keys} shape={shape}");
        }
        assert_eq!(lines, 210);
    }

    // A stable sort has one answer: the one of the standard library.
    #[test]
    fn sort_stable_func_is_stable() {
        let mut state: u64 = 99;
        let mut next = || {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            state >> 33
        };
        for n in 0..300u64 {
            for keys in [1u64, 2, 3, 7, 50, 1000] {
                let mut data: Vec<(u64, u64)> = (0..n).map(|i| (next() % keys, i)).collect();
                let mut expected = data.clone();
                expected.sort_by_key(|element| element.0);
                sort_stable_func(&mut data, cmp_keys);
                assert_eq!(data, expected, "n={n} keys={keys}");
                // slices.BinarySearchFunc: the first position that is not less than the target.
                for target in 0..keys.min(60) {
                    let (i, found) = binary_search_func(&data, target, |element: (u64, u64), t| {
                        cmp_keys(element, (t, 0))
                    });
                    let first = data.partition_point(|element| element.0 < target);
                    assert_eq!(i, first);
                    assert_eq!(found, data.get(first).is_some_and(|e| e.0 == target));
                }
            }
        }
    }
}
'''
fuzz = r'''
#[cfg(test)]
mod fuzz {
    use super::slices::{binary_search_func, sort_func, sort_stable_func};

    // A comparator that answers at random: the sorts end, keep every element and stay inside the slice.
    #[test]
    fn an_inconsistent_comparator_cannot_leave_the_slice() {
        let mut state: u64 = 7;
        let mut next = move || {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            state >> 33
        };
        for round in 0..4000u64 {
            let n = (next() % 400) as usize + (round % 7) as usize * 100;
            let data: Vec<u64> = (0..n as u64).collect();
            let mut a = data.clone();
            sort_func(&mut a, |_, _| (next() % 3) as isize - 1);
            let mut b = data.clone();
            sort_stable_func(&mut b, |_, _| (next() % 3) as isize - 1);
            let _ = binary_search_func(&a, 0u64, |_, _| (next() % 3) as isize - 1);
            a.sort_unstable();
            b.sort_unstable();
            assert_eq!(a, data);
            assert_eq!(b, data);
        }
    }
}
'''
open('/tmp/diagnostic-slices-test.rs', 'w').write('#![allow(dead_code)]\n' + block + tests + fuzz)
