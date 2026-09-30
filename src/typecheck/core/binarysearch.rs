// internal/core/binarysearch.go

// BinarySearchUniqueFunc works like Go's slices.BinarySearchFunc, but avoids extra invocations of the comparison function by assuming that only one element in the slice could match the target. Also, the comparison function is passed the current index of the element being compared, instead of the target element.
pub fn binary_search_unique_func<E: Copy>(
    x: &[E],
    mut cmp: impl FnMut(isize, E) -> isize,
) -> (isize, bool) {
    let n = x.len() as isize;
    if n == 0 {
        return (0, false);
    }
    let (mut low, mut high) = (0, n - 1);
    while low <= high {
        let middle = low + ((high - low) >> 1);
        let Some(&element) = usize::try_from(middle).ok().and_then(|i| x.get(i)) else {
            break;
        };
        let value = cmp(middle, element);
        if value < 0 {
            low = middle + 1;
        } else if value > 0 {
            high = middle - 1;
        } else {
            return (middle, true);
        }
    }
    (low, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_search_unique() {
        let x = [10, 20, 30, 40];
        let find = |target: i32| {
            let mut calls = 0;
            let found = binary_search_unique_func(&x, |_, e| {
                calls += 1;
                (e - target) as isize
            });
            (found, calls)
        };
        assert_eq!(find(10), ((0, true), 2));
        assert_eq!(find(20), ((1, true), 1));
        assert_eq!(find(40), ((3, true), 3));
        assert_eq!(find(5).0, (0, false));
        assert_eq!(find(25).0, (2, false));
        assert_eq!(find(45).0, (4, false));
        assert_eq!(
            binary_search_unique_func(&[] as &[i32], |_, _| 0),
            (0, false)
        );
        let by_index = binary_search_unique_func(&x, |i, _| i - 2);
        assert_eq!(by_index, (2, true));
    }
}
