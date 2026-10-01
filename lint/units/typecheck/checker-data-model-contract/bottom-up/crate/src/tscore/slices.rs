// Go's `slices` sorting, statement for statement, so that the sequence of comparator calls is upstream's.
pub fn binary_search_func<E: Copy, T: Copy>(
    x: &[E],
    target: T,
    mut cmp: impl FnMut(E, T) -> isize,
) -> (usize, bool) {
    let n = x.len();
    let (mut i, mut j) = (0usize, n);
    while i < j {
        let h = (i + j) >> 1;
        let Some(&probe) = x.get(h) else { break };
        if cmp(probe, target) < 0 {
            i = h + 1;
        } else {
            j = h;
        }
    }
    let found = match x.get(i) {
        Some(&probe) => cmp(probe, target) == 0,
        None => false,
    };
    (i, found)
}

fn insertion_sort_cmp_func<E: Copy>(
    data: &mut [E],
    a: usize,
    b: usize,
    cmp: &mut impl FnMut(E, E) -> isize,
) {
    let mut i = a + 1;
    while i < b {
        let mut j = i;
        while j > a {
            let (Some(&x), Some(&y)) = (data.get(j), data.get(j - 1)) else {
                break;
            };
            if !(cmp(x, y) < 0) {
                break;
            }
            data.swap(j, j - 1);
            j -= 1;
        }
        i += 1;
    }
}

fn swap_range<E: Copy>(data: &mut [E], a: usize, b: usize, n: usize) {
    for i in 0..n {
        if a + i < data.len() && b + i < data.len() {
            data.swap(a + i, b + i);
        }
    }
}

fn rotate<E: Copy>(data: &mut [E], a: usize, m: usize, b: usize) {
    let mut i = m - a;
    let mut j = b - m;
    while i != j {
        if i > j {
            swap_range(data, m - i, m, j);
            i -= j;
        } else {
            swap_range(data, m - i, m + j - i, i);
            j -= i;
        }
    }
    swap_range(data, m - i, m, i);
}

fn less<E: Copy>(data: &[E], x: usize, y: usize, cmp: &mut impl FnMut(E, E) -> isize) -> bool {
    match (data.get(x), data.get(y)) {
        (Some(&p), Some(&q)) => cmp(p, q) < 0,
        _ => false,
    }
}

fn sym_merge<E: Copy>(
    data: &mut [E],
    a: usize,
    m: usize,
    b: usize,
    cmp: &mut impl FnMut(E, E) -> isize,
) {
    if m - a == 1 {
        let (mut i, mut j) = (m, b);
        while i < j {
            let h = (i + j) >> 1;
            if less(data, h, a, cmp) {
                i = h + 1;
            } else {
                j = h;
            }
        }
        let mut k = a;
        while k + 1 < i {
            data.swap(k, k + 1);
            k += 1;
        }
        return;
    }
    if b - m == 1 {
        let (mut i, mut j) = (a, m);
        while i < j {
            let h = (i + j) >> 1;
            if !less(data, m, h, cmp) {
                i = h + 1;
            } else {
                j = h;
            }
        }
        let mut k = m;
        while k > i {
            data.swap(k, k - 1);
            k -= 1;
        }
        return;
    }
    let mid = (a + b) >> 1;
    let n = mid + m;
    let (mut start, mut r) = if m > mid { (n - b, mid) } else { (a, m) };
    let p = n - 1;
    while start < r {
        let c = (start + r) >> 1;
        if !less(data, p - c, c, cmp) {
            start = c + 1;
        } else {
            r = c;
        }
    }
    let end = n - start;
    if start < m && m < end {
        rotate(data, start, m, end);
    }
    if a < start && start < mid {
        sym_merge(data, a, start, mid, cmp);
    }
    if mid < end && end < b {
        sym_merge(data, mid, end, b, cmp);
    }
}

pub fn sort_stable_func<E: Copy>(data: &mut [E], mut cmp: impl FnMut(E, E) -> isize) {
    let n = data.len();
    let mut block_size = 20usize;
    let (mut a, mut b) = (0usize, block_size);
    while b <= n {
        insertion_sort_cmp_func(data, a, b, &mut cmp);
        a = b;
        b += block_size;
    }
    insertion_sort_cmp_func(data, a, n, &mut cmp);
    while block_size < n {
        a = 0;
        b = 2 * block_size;
        while b <= n {
            sym_merge(data, a, a + block_size, b, &mut cmp);
            a = b;
            b += 2 * block_size;
        }
        let m = a + block_size;
        if m < n {
            sym_merge(data, a, m, n, &mut cmp);
        }
        block_size *= 2;
    }
}

// slices.SortFunc: pdqsortCmpFunc of zsortanyfunc.go, statement for statement.
pub fn sort_func<E: Copy>(data: &mut [E], mut cmp: impl FnMut(E, E) -> isize) {
    let n = data.len();
    let limit = (usize::BITS - n.leading_zeros()) as usize;
    pdqsort_cmp_func(data, 0, n, limit, &mut cmp);
}

fn swap_at<E: Copy>(data: &mut [E], i: usize, j: usize) {
    if i < data.len() && j < data.len() {
        data.swap(i, j);
    }
}

fn sift_down_cmp_func<E: Copy>(
    data: &mut [E],
    lo: usize,
    hi: usize,
    first: usize,
    cmp: &mut impl FnMut(E, E) -> isize,
) {
    let mut root = lo;
    loop {
        let mut child = 2 * root + 1;
        if child >= hi {
            break;
        }
        if child + 1 < hi && less(data, first + child, first + child + 1, cmp) {
            child += 1;
        }
        if !less(data, first + root, first + child, cmp) {
            return;
        }
        swap_at(data, first + root, first + child);
        root = child;
    }
}

fn heap_sort_cmp_func<E: Copy>(
    data: &mut [E],
    a: usize,
    b: usize,
    cmp: &mut impl FnMut(E, E) -> isize,
) {
    let first = a;
    let lo = 0;
    let hi = b - a;
    let mut i = hi.saturating_sub(1) / 2 + 1;
    while i > 0 {
        i -= 1;
        sift_down_cmp_func(data, i, hi, first, cmp);
    }
    let mut i = hi;
    while i > 0 {
        i -= 1;
        swap_at(data, first, first + i);
        sift_down_cmp_func(data, lo, i, first, cmp);
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SortedHint {
    Unknown,
    Increasing,
    Decreasing,
}

fn pdqsort_cmp_func<E: Copy>(
    data: &mut [E],
    mut a: usize,
    mut b: usize,
    mut limit: usize,
    cmp: &mut impl FnMut(E, E) -> isize,
) {
    const MAX_INSERTION: usize = 12;
    let mut was_balanced = true;
    let mut was_partitioned = true;
    loop {
        let length = b - a;
        if length <= MAX_INSERTION {
            insertion_sort_cmp_func(data, a, b, cmp);
            return;
        }
        // Fall back to heapsort if too many bad choices were made.
        if limit == 0 {
            heap_sort_cmp_func(data, a, b, cmp);
            return;
        }
        // If the last partitioning was imbalanced, we need to breaking patterns.
        if !was_balanced {
            break_patterns_cmp_func(data, a, b);
            limit -= 1;
        }
        let (mut pivot, mut hint) = choose_pivot_cmp_func(data, a, b, cmp);
        if hint == SortedHint::Decreasing {
            reverse_range_cmp_func(data, a, b);
            pivot = (b - 1) - (pivot - a);
            hint = SortedHint::Increasing;
        }
        // The slice is likely already sorted.
        if was_balanced
            && was_partitioned
            && hint == SortedHint::Increasing
            && partial_insertion_sort_cmp_func(data, a, b, cmp)
        {
            return;
        }
        // Probably the slice contains many duplicate elements.
        if a > 0 && !less(data, a - 1, pivot, cmp) {
            let mid = partition_equal_cmp_func(data, a, b, pivot, cmp);
            a = mid;
            continue;
        }
        let (mid, already_partitioned) = partition_cmp_func(data, a, b, pivot, cmp);
        was_partitioned = already_partitioned;
        let (left_len, right_len) = (mid - a, b - mid);
        let balance_threshold = length / 8;
        if left_len < right_len {
            was_balanced = left_len >= balance_threshold;
            pdqsort_cmp_func(data, a, mid, limit, cmp);
            a = mid + 1;
        } else {
            was_balanced = right_len >= balance_threshold;
            pdqsort_cmp_func(data, mid + 1, b, limit, cmp);
            b = mid;
        }
    }
}

fn partition_cmp_func<E: Copy>(
    data: &mut [E],
    a: usize,
    b: usize,
    pivot: usize,
    cmp: &mut impl FnMut(E, E) -> isize,
) -> (usize, bool) {
    swap_at(data, a, pivot);
    // i and j are inclusive of the elements remaining to be partitioned
    let (mut i, mut j) = (a as isize + 1, b as isize - 1);
    while i <= j && less(data, i as usize, a, cmp) {
        i += 1;
    }
    while i <= j && !less(data, j as usize, a, cmp) {
        j -= 1;
    }
    if i > j {
        swap_at(data, j as usize, a);
        return (j as usize, true);
    }
    swap_at(data, i as usize, j as usize);
    i += 1;
    j -= 1;
    loop {
        while i <= j && less(data, i as usize, a, cmp) {
            i += 1;
        }
        while i <= j && !less(data, j as usize, a, cmp) {
            j -= 1;
        }
        if i > j {
            break;
        }
        swap_at(data, i as usize, j as usize);
        i += 1;
        j -= 1;
    }
    swap_at(data, j as usize, a);
    (j as usize, false)
}

fn partition_equal_cmp_func<E: Copy>(
    data: &mut [E],
    a: usize,
    b: usize,
    pivot: usize,
    cmp: &mut impl FnMut(E, E) -> isize,
) -> usize {
    swap_at(data, a, pivot);
    let (mut i, mut j) = (a as isize + 1, b as isize - 1);
    loop {
        while i <= j && !less(data, a, i as usize, cmp) {
            i += 1;
        }
        while i <= j && less(data, a, j as usize, cmp) {
            j -= 1;
        }
        if i > j {
            break;
        }
        swap_at(data, i as usize, j as usize);
        i += 1;
        j -= 1;
    }
    i as usize
}

fn partial_insertion_sort_cmp_func<E: Copy>(
    data: &mut [E],
    a: usize,
    b: usize,
    cmp: &mut impl FnMut(E, E) -> isize,
) -> bool {
    const MAX_STEPS: usize = 5;
    const SHORTEST_SHIFTING: usize = 50;
    let mut i = a + 1;
    for _ in 0..MAX_STEPS {
        while i < b && !less(data, i, i - 1, cmp) {
            i += 1;
        }
        if i == b {
            return true;
        }
        if b - a < SHORTEST_SHIFTING {
            return false;
        }
        swap_at(data, i, i - 1);
        // Shift the smaller one to the left.
        if i - a >= 2 {
            let mut j = i - 1;
            while j >= 1 {
                if !less(data, j, j - 1, cmp) {
                    break;
                }
                swap_at(data, j, j - 1);
                j -= 1;
            }
        }
        // Shift the greater one to the right.
        if b - i >= 2 {
            let mut j = i + 1;
            while j < b {
                if !less(data, j, j - 1, cmp) {
                    break;
                }
                swap_at(data, j, j - 1);
                j += 1;
            }
        }
    }
    false
}

fn break_patterns_cmp_func<E: Copy>(data: &mut [E], a: usize, b: usize) {
    let length = b - a;
    if length >= 8 {
        let mut random = length as u64;
        let modulus = 1usize << (usize::BITS - length.leading_zeros());
        let mut idx = a + (length / 4) * 2 - 1;
        while idx <= a + (length / 4) * 2 + 1 {
            random ^= random << 13;
            random ^= random >> 7;
            random ^= random << 17;
            let mut other = (random as usize) & (modulus - 1);
            if other >= length {
                other -= length;
            }
            swap_at(data, idx, a + other);
            idx += 1;
        }
    }
}

fn choose_pivot_cmp_func<E: Copy>(
    data: &[E],
    a: usize,
    b: usize,
    cmp: &mut impl FnMut(E, E) -> isize,
) -> (usize, SortedHint) {
    const SHORTEST_NINTHER: usize = 50;
    const MAX_SWAPS: usize = 4 * 3;
    let l = b - a;
    let mut swaps = 0usize;
    let mut i = a + l / 4;
    let mut j = a + l / 4 * 2;
    let mut k = a + l / 4 * 3;
    if l >= 8 {
        if l >= SHORTEST_NINTHER {
            // Tukey ninther method, the idea came from Rust's implementation.
            i = median_adjacent_cmp_func(data, i, &mut swaps, cmp);
            j = median_adjacent_cmp_func(data, j, &mut swaps, cmp);
            k = median_adjacent_cmp_func(data, k, &mut swaps, cmp);
        }
        // Find the median among i, j, k and stores it into j.
        j = median_cmp_func(data, i, j, k, &mut swaps, cmp);
    }
    match swaps {
        0 => (j, SortedHint::Increasing),
        MAX_SWAPS => (j, SortedHint::Decreasing),
        _ => (j, SortedHint::Unknown),
    }
}

fn order2_cmp_func<E: Copy>(
    data: &[E],
    a: usize,
    b: usize,
    swaps: &mut usize,
    cmp: &mut impl FnMut(E, E) -> isize,
) -> (usize, usize) {
    if less(data, b, a, cmp) {
        *swaps += 1;
        return (b, a);
    }
    (a, b)
}

fn median_cmp_func<E: Copy>(
    data: &[E],
    a: usize,
    b: usize,
    c: usize,
    swaps: &mut usize,
    cmp: &mut impl FnMut(E, E) -> isize,
) -> usize {
    let (a, b) = order2_cmp_func(data, a, b, swaps, cmp);
    let (b, _c) = order2_cmp_func(data, b, c, swaps, cmp);
    let (_a, b) = order2_cmp_func(data, a, b, swaps, cmp);
    b
}

fn median_adjacent_cmp_func<E: Copy>(
    data: &[E],
    a: usize,
    swaps: &mut usize,
    cmp: &mut impl FnMut(E, E) -> isize,
) -> usize {
    median_cmp_func(data, a - 1, a, a + 1, swaps, cmp)
}

fn reverse_range_cmp_func<E: Copy>(data: &mut [E], a: usize, b: usize) {
    let mut i = a;
    let mut j = b - 1;
    while i < j {
        swap_at(data, i, j);
        i += 1;
        j -= 1;
    }
}
