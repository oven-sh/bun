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

// pdqsortCmpFunc sorts at most 12 elements by insertion. The scratch stops there: the full body is zsortanyfunc.go:61-333.
pub fn sort_func<E: Copy>(data: &mut [E], mut cmp: impl FnMut(E, E) -> isize) {
    let n = data.len();
    if n <= 12 {
        insertion_sort_cmp_func(data, 0, n, &mut cmp);
        return;
    }
    sort_stable_func(data, cmp);
}
