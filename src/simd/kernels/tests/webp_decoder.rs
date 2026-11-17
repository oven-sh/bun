//! The kernels of the WebP decoder on every target, against RFC 6386 and RFC 9649.
#![forbid(unsafe_code)]
mod common;
use bun_simd_kernels::webp::{self, FilterStrength, Plane, ROW_STEP};
use common::{check, check_against_portable, random, sample, targets};
use core::array::from_fn;

type Rgba = [u8; 4];

/// Noise, extremes, or what a filter takes to be smooth.
fn samples(below: &mut impl FnMut(usize) -> usize, len: usize) -> Vec<u8> {
    let (kind, base) = (below(4), below(256));
    let mut next = || match kind {
        0 => below(256),
        1 => [0, 127, 128, 255][below(4)],
        2 => (base + below(6)) % 256,
        _ => (base + below(40)) % 256,
    };
    (0..len).map(|_| next() as u8).collect()
}

fn clamped(value: i32) -> u8 {
    value.clamp(0, 255) as u8
}

fn inverse_dct_pass([v0, v1, v2, v3]: [i16; 4]) -> [i16; 4] {
    let times = |x: i16, factor: i64| (i64::from(x) * factor) >> 16;
    let (a, b) = (i64::from(v0) + i64::from(v2), i64::from(v0) - i64::from(v2));
    let c = times(v1, 35468) - times(v3, 85627);
    let d = times(v1, 85627) + times(v3, 35468);
    [a + d, b + c, b - c, a - d].map(|it| it as i16)
}

#[test]
fn inverse_dct() {
    let mut below = random();
    for round in sample(0..3000, 500) {
        let non_zero = (below(1 << 24) & below(1 << 24)) as u32;
        let has_bit = |y: usize, x: usize| non_zero >> (4 * y + x) & 1 != 0;
        let given: [[i16; 64]; 6] = from_fn(|y| {
            let stays = (0..4).all(|x| !has_bit(y, x));
            from_fn(|i| match stays || has_bit(y, i % 16 / 4) {
                true => below(1 << 16) as i16 >> (round % 15),
                false => 0,
            })
        });
        let mut want = given;
        for (y, x) in (0..24).map(|i| (i / 4, i % 4)) {
            if !has_bit(y, x) {
                continue;
            }
            let at = |row, column| 16 * row + 4 * x + column;
            let columns: [_; 4] =
                from_fn(|column| inverse_dct_pass(from_fn(|row| given[y][at(row, column)])));
            for row in 0..4 {
                let [first, b, c, d] = columns.map(|it| it[row]);
                let result = inverse_dct_pass([first.wrapping_add(4), b, c, d]);
                want[y][at(row, 0)..][..4].copy_from_slice(&result.map(|it| it >> 3));
            }
        }
        check(want, || {
            let mut got = given;
            webp::inverse_dct(&mut got, non_zero);
            got
        });
    }
}

#[test]
fn inverse_dct_wraps_when_it_rounds() {
    for (first, want) in [(32763, 4095), (32764, -4096), (32767, -4096)] {
        check([[want; 64]; 6], || {
            let mut got = [from_fn(|i| if i < 16 && i % 4 == 0 { first } else { 0 }); 6];
            webp::inverse_dct(&mut got, u32::MAX);
            got
        });
    }
}

/// `edge` goes up the column to the left, through the corner and along the row above.
fn predicted(mode: u8, edge: [i32; 13], y: usize, x: usize) -> i32 {
    let two = |a: usize, b: usize| (edge[a] + edge[b] + 1) >> 1;
    let three = |a: usize, b: usize, c: usize| (edge[a] + 2 * edge[b] + edge[c] + 2) >> 2;
    let (two_from, three_from) = (|i| two(i, i + 1), |i| three(i, i + 1, (i + 2).min(12)));
    let left = |i: usize| 3usize.saturating_sub(i);
    match mode {
        0 => (edge[..4].iter().chain(&edge[5..9]).sum::<i32>() + 4) >> 3,
        1 => (edge[left(y)] + edge[5 + x] - edge[4]).clamp(0, 255),
        2 => three_from(4 + x),
        3 => three(4 - y, left(y), left(y + 1)),
        4 => three_from(3 + x - y),
        5 if y > 2 * x + 1 => three_from(4 - y),
        5 if y % 2 == 0 => two_from(4 + x - y / 2),
        5 => three_from(3 + x - y / 2),
        6 => three_from(5 + x + y),
        7 if x == 3 && y >= 2 => three_from(7 + y),
        7 if y % 2 == 0 => two_from(5 + x + y / 2),
        7 => three_from(5 + x + y / 2),
        8 if x > 2 * y + 1 => three_from(2 + x),
        8 if x % 2 == 0 => two_from(3 + x / 2 - y),
        8 => three_from(3 + x / 2 - y),
        _ if x % 2 == 0 => two(left(y + x / 2), left(y + x / 2 + 1)),
        _ => three(left(y + x / 2), left(y + x / 2 + 1), left(y + x / 2 + 2)),
    }
}

#[test]
fn reconstruct_subblocks() {
    let mut below = random();
    for round in sample(0..3000, 1501) {
        let edges = samples(&mut below, 40);
        let (above, rest) = edges.split_first_chunk().unwrap();
        let (above_right, left) = rest.split_first_chunk().unwrap();
        let left = left.first_chunk().unwrap();
        let modes = from_fn(|_| from_fn(|_| below(12) as u8));
        let residuals = from_fn(|_| from_fn(|_| below(1 << 16) as i16 >> (round % 16)));
        // With the row above and the column to the left.
        let mut all = [[0; 17]; 17];
        all[0][1..].copy_from_slice(above);
        (0..17).for_each(|y| all[y][0] = left[y]);
        for (top, start) in (0..16).map(|i| (i / 4 * 4, i % 4 * 4)) {
            let edge = from_fn(|i| match i {
                ..4 => all[top + 4 - i][start].into(),
                9.. if start == 12 => above_right[i - 9].into(),
                _ => all[top][start + i - 4].into(),
            });
            for (y, x) in (0..16).map(|i| (i / 4, i % 4)) {
                let predicted = predicted(modes[top / 4][start / 4], edge, y, x) as i16;
                let sum = predicted.wrapping_add(residuals[top / 4][16 * y + start + x]);
                all[top + 1 + y][start + 1 + x] = clamped(sum.into());
            }
        }
        check(from_fn(|y| *all[1 + y].last_chunk().unwrap()), || {
            let mut got = [[7; 16]; 16];
            webp::reconstruct_subblocks(above, *above_right, left, &modes, &residuals, &mut got);
            got
        });
    }
}

/// `v` has p3 p2 p1 p0 q0 q1 q2 q3.
fn filter_across(v: &mut [i32; 8], is_simple: bool, is_inner: bool, strength: FilterStrength) {
    let c = |it: i32| it.clamp(-128, 127);
    let step = |i: usize| (v[i] - v[i + 1]).abs();
    let limit = (i32::from(strength.edge_limit) + if is_inner { 0 } else { 4 }) % 256;
    let is_inside = [0, 1, 2, 4, 5, 6].map(|i| step(i) <= strength.interior_limit.into());
    let is_steep = (2 * step(3) + (v[2] - v[5]).abs() / 2).min(255) > limit;
    if is_steep || !is_simple && is_inside != [true; 6] {
        return;
    }
    let is_high = is_simple || step(2).max(step(4)) > strength.high_variance_threshold.into();
    let outer = if is_high || !is_inner {
        c(v[2] - v[5])
    } else {
        0
    };
    let w = c(outer + 3 * (v[4] - v[3]));
    let (to_p, from_q) = (c(w + 3) >> 3, c(w + 4) >> 3);
    let changes = match (is_high, is_inner) {
        (true, _) => [(to_p, from_q), (0, 0), (0, 0)],
        (false, true) => [
            (to_p, from_q),
            ((from_q + 1) >> 1, (from_q + 1) >> 1),
            (0, 0),
        ],
        (false, false) => [27, 18, 9].map(|by| ((by * w + 63) >> 7, (by * w + 63) >> 7)),
    };
    for (i, (to_p, from_q)) in changes.into_iter().enumerate() {
        v[3 - i] = clamped(v[3 - i] + to_p).into();
        v[4 + i] = clamped(v[4 + i] - from_q).into();
    }
}

fn filter(plane: Plane, size: usize, is_simple: bool, all: &[FilterStrength], has_above: bool) {
    let read = if is_simple { 2 } else { 4 };
    for (x, &strength) in all.iter().enumerate().filter(|it| it.1.edge_limit != 0) {
        for (across, along, has) in [(1, plane.stride, x != 0), (plane.stride, 1, has_above)] {
            let edges = (0..size).step_by(4);
            let edges = edges.filter(|&it| [strength.filters_inner_edges, has][(it == 0) as usize]);
            for (edge, i) in edges.flat_map(|edge| (0..size).map(move |i| (edge, i))) {
                let q0 = plane.start + size * x + edge * across + i * along;
                let (mut v, at) = ([0; 8], |i| q0 + i * across - 4 * across);
                (4 - read..4 + read).for_each(|i| v[i] = plane.samples[at(i)].into());
                filter_across(&mut v, is_simple, edge != 0, strength);
                (4 - read..4 + read).for_each(|i| plane.samples[at(i)] = v[i] as u8);
            }
        }
    }
}

fn plane(samples: &mut [u8], stride: usize, start: usize) -> Plane<'_> {
    Plane {
        samples,
        stride,
        start,
    }
}

#[test]
fn filters() {
    let mut below = random();
    for round in sample(0..1500, 501) {
        let (count, has_above, range) = (below(5), below(4) != 0, 256 >> (round % 6));
        // The widest picture has so many.
        let count = if round % 500 == 499 { 1024 } else { count };
        let strength = |_| FilterStrength {
            edge_limit: below(251.min(2 * range)) as u8,
            interior_limit: below(range) as u8,
            high_variance_threshold: below(range / 4) as u8,
            filters_inner_edges: below(3) != 0,
        };
        let strengths: Vec<_> = (0..count).map(strength).collect();
        let sizes = [16, 8, 8].map(|size| (size, size * count + 8 + below(9)));

        let given = sizes.map(|(size, stride)| samples(&mut below, (size + 4) * stride));
        let mut want = given.clone();
        for (samples, (size, stride)) in want.iter_mut().zip(sizes) {
            let plane = plane(samples, stride, 4 * stride + 4);
            filter(plane, size, false, &strengths, has_above);
        }
        check(Some(want), || {
            let (mut got, mut strides) = (given.clone(), sizes.iter().map(|it| it.1));
            let planes = got.each_mut().map(|samples| {
                let stride = strides.next().unwrap();
                plane(samples, stride, 4 * stride + 4)
            });
            webp::filter_normally(planes, &strengths, has_above).map(|()| got)
        });

        let stride = sizes[0].1;
        let (given, start) = (&given[0][2 * stride..], 2 * stride + 4);
        let mut want = given.to_vec();
        filter(
            plane(&mut want, stride, start),
            16,
            true,
            &strengths,
            has_above,
        );
        check(Some(want), || {
            let mut got = given.to_vec();
            webp::filter_simply(plane(&mut got, stride, start), &strengths, has_above).map(|()| got)
        });
    }
}

#[test]
fn limits_that_no_file_has() {
    let mut below = random();
    for edge_limit in sample(251..=255, 5) {
        let strength = FilterStrength {
            edge_limit,
            interior_limit: 255,
            high_variance_threshold: 128,
            filters_inner_edges: true,
        };
        let given: Vec<_> = (0..20 * 40).map(|_| below(256) as u8).collect();
        let mut want = [(); 4].map(|()| given.clone());
        for (it, (size, is_simple)) in
            want.iter_mut()
                .zip([(16, false), (8, false), (8, false), (16, true)])
        {
            filter(
                plane(it, 40, 4 * 40 + 4),
                size,
                is_simple,
                &[strength; 2],
                true,
            );
        }
        check(Some(want), || {
            let mut got = [(); 4].map(|()| given.clone());
            let [y, u, v, alone] = got.each_mut().map(|it| plane(it, 40, 4 * 40 + 4));
            webp::filter_normally([y, u, v], &[strength; 2], true)?;
            webp::filter_simply(alone, &[strength; 2], true).map(|()| got)
        });
    }
}

#[test]
fn upsample() {
    let mut below = random();
    for count in sample((0..3000).map(|it| it % 100), 333) {
        let padded = usize::next_multiple_of(count, ROW_STEP);
        let (distance, half) = (below(2) * below(2 * padded + 2), 2 * padded + below(20));
        let (from, odd) = (samples(&mut below, distance + padded + 1), below(2));
        let want = [0, 1].map(|y| {
            let at = |y: usize, x: usize| u32::from(from[y * distance + x]);
            let pixel = |i: usize| {
                let (near, far) = (i / 2 + i % 2, i / 2 + 1 - i % 2);
                let sum = 9 * at(y, near) + 3 * at(y, far) + 3 * at(1 - y, near) + at(1 - y, far);
                ((sum + 8) / 16) as u8
            };
            (0..2 * count).map(pixel).collect::<Vec<_>>()
        });
        check(Some(want), || {
            let mut got = vec![7; 2 * half + odd];
            webp::upsample(&from, distance, &mut got, count)?;
            Some([0, half].map(|start| got[start..][..2 * count].to_vec()))
        });
    }
}

fn to_rgba([y, u, v, alpha]: [u8; 4]) -> Rgba {
    let times = |sample: u8, factor: i32| (i32::from(sample) * factor) >> 8;
    let luma = times(y, 19077);
    [
        clamped((luma + times(v, 26149) - 14234) >> 6),
        clamped((luma - times(u, 6419) - times(v, 13320) + 8708) >> 6),
        clamped((luma + times(u, 33050) - 17685) >> 6),
        alpha,
    ]
}

#[test]
fn yuv_to_rgba_of_many_colors() {
    let luma: [u8; 256] = from_fn(|i| i as u8);
    for [u, v] in sample((0..=u16::MAX).step_by(5).map(u16::to_le_bytes), 9999) {
        check(Some(luma.map(|y| to_rgba([y, u, v, !y])).to_vec()), || {
            let (yuva, mut got) = ([luma, [u; 256], [v; 256], luma.map(|y| !y)], Vec::new());
            got.reserve(256);
            webp::yuv_to_rgba(yuva.each_ref().map(|it| &it[..]), &mut got, 0, 256).map(|()| got)
        });
    }
}

#[test]
fn yuv_to_rgba_over_pixels_and_behind_them() {
    let mut below = random();
    for width in sample((0..700).map(|it| it % 70), 101) {
        let yuva = [(); 4].map(|()| samples(&mut below, usize::next_multiple_of(width, ROW_STEP)));
        let (start, more, spare) = (below(5), below(2 * width + 1), below(40));
        let mut want = vec![[7; 4]; start + width.max(more)];
        (0..width).for_each(|x| want[start + x] = to_rgba(from_fn(|i| yuva[i][x])));
        check(Some(want), || {
            let mut got = Vec::with_capacity(start + width.max(more) + spare);
            got.resize(start + more, [7; 4]);
            webp::yuv_to_rgba(yuva.each_ref().map(Vec::as_slice), &mut got, start, width)?;
            Some(got)
        });
    }
}

fn prediction(mode: u8, [l, tl, t, tr]: [Rgba; 4]) -> Rgba {
    let average = |a: Rgba, b: Rgba| from_fn(|i| a[i].midpoint(b[i]));
    let distance = |a: Rgba, b: Rgba| (0..4).map(|i| u32::from(a[i].abs_diff(b[i]))).sum::<u32>();
    let [wide_l, wide_tl, wide_t, middle] = [l, tl, t, average(l, t)].map(|it| it.map(i32::from));
    match mode {
        1 => l,
        2 => t,
        3 => tr,
        4 => tl,
        5 => average(average(l, tr), t),
        6 => average(l, tl),
        7 => average(l, t),
        8 => average(tl, t),
        9 => average(t, tr),
        10 => average(average(l, tl), average(t, tr)),
        11 if distance(t, tl) < distance(l, tl) => l,
        11 => t,
        12 => from_fn(|i| clamped(wide_l[i] + wide_t[i] - wide_tl[i])),
        13 => from_fn(|i| clamped(middle[i] + (middle[i] - wide_tl[i]) / 2)),
        _ => [0, 0, 0, 255],
    }
}

#[test]
fn lossless_transforms() {
    let mut below = random();
    for round in sample(0..6000, 1501) {
        let (width, bits) = (1 + below(80), round % 7);
        let [given, mut above] = [(); 2].map(|()| samples(&mut below, 4 * width));
        let (given, above) = (given.as_chunks().0, above.as_chunks_mut().0);
        for x in (1..width).filter(|x| x / 9 % 2 < round / 7 % 2) {
            above[x] = above[x - 1];
        }
        let tiles = 0..width.div_ceil(1 << bits);
        let tiles: Vec<Rgba> = tiles.map(|_| from_fn(|_| below(256) as u8)).collect();

        let mut want = given.to_vec();
        for x in 0..width {
            let predicted = match x.checked_sub(1) {
                None => above[0],
                Some(left) => {
                    let tr = *above.get(x + 1).unwrap_or(&want[0]);
                    let around = [want[left], above[left], above[x], tr];
                    prediction(tiles[x >> bits][1] & 15, around)
                }
            };
            want[x] = from_fn(|i| given[x][i].wrapping_add(predicted[i]));
        }
        check(Some(want), || {
            let mut got = given.to_vec();
            webp::undo_prediction(&mut got, above, &tiles, bits as u32).map(|()| got)
        });

        let delta = |by: u8, color: u8| ((i32::from(by as i8) * i32::from(color as i8)) >> 5) as u8;
        let undone = |(x, &[r, g, b, alpha]): (usize, &Rgba)| {
            let [red_to_blue, green_to_blue, green_to_red, _] = tiles[x >> bits];
            let r = r.wrapping_add(delta(green_to_red, g));
            let b = b.wrapping_add(delta(green_to_blue, g));
            [r, g, b.wrapping_add(delta(red_to_blue, r)), alpha]
        };
        check(Some(given.iter().enumerate().map(undone).collect()), || {
            let mut got = given.to_vec();
            webp::undo_cross_color(&mut got, &tiles, bits as u32).map(|()| got)
        });
    }
}

/// `call` gets through with `enough`, and not with one less of any of them.
fn needs<const N: usize>(enough: [usize; N], call: impl Fn([usize; N]) -> Option<()>) {
    for target in targets() {
        assert_eq!(call(enough), Some(()), "{target:?}");
        for i in 0..N {
            let mut fewer = enough;
            fewer[i] -= 1;
            assert_eq!(call(fewer), None, "{target:?} {fewer:?}");
        }
    }
}

#[test]
fn the_filters_get_whole_macroblocks_and_what_is_around_them() {
    let strengths = [FilterStrength::default(); 2];
    let simply = |[stride, start, len]: [usize; 3]| {
        webp::filter_simply(plane(&mut vec![0; len], stride, start), &strengths, true)
    };
    needs([40, 2 * 40 + 4, 18 * 40], simply);
    for absurd in [
        [40, 9999, 720],
        [usize::MAX, 84, 720],
        [usize::MAX / 2, 84, 720],
    ] {
        check(None, || simply(absurd));
    }
    let [y, u, v] = [(16, 40), (8, 24), (8, 24)]
        .map(|(size, stride)| [stride, 4 * stride + 4, (size + 4) * stride]);
    let normally = |planes: [[usize; 3]; 3]| {
        let mut planes = planes.map(|[stride, start, len]| (vec![0; len], stride, start));
        let planes = planes.each_mut().map(|it| plane(&mut it.0, it.1, it.2));
        webp::filter_normally(planes, &strengths, true)
    };
    needs(y, |y| normally([y, u, v]));
    needs(u, |u| normally([y, u, v]));
    needs(v, |v| normally([y, u, v]));
}

#[test]
fn rows_are_padded_to_whole_steps() {
    needs([7 + 65, 256], |[from, to]| {
        webp::upsample(&vec![0; from], 7, &mut vec![0; to], 33)
    });
    needs([33, 128], |[from, to]| {
        webp::upsample(&vec![0; from], 0, &mut vec![0; to], 1)
    });
    for [distance, count] in [[0, usize::MAX], [0, usize::MAX - 32], [usize::MAX, 0]] {
        check(None, || webp::upsample(&[0], distance, &mut [], count));
    }
    let convert = |yuva: [usize; 4], len, room: usize| {
        let (yuva, mut rgba) = (yuva.map(|len| vec![0; len]), Vec::with_capacity(5 + room));
        rgba.resize(len, [1; 4]);
        webp::yuv_to_rgba(yuva.each_ref().map(Vec::as_slice), &mut rgba, 5, 33)
    };
    needs([64, 64, 64, 64, 5, 33], |[yuva @ .., len, room]| {
        convert(yuva, len, room)
    });
    needs([64; 4], |yuva| convert(yuva, 5 + 33, 33));
    check(None, || {
        webp::yuv_to_rgba([&[0; 32]; 4], &mut Vec::new(), 0, usize::MAX)
    });
}

#[test]
fn every_pixel_has_a_tile() {
    for width in [1, 2, 5, 6, 9] {
        needs([width, width, usize::div_ceil(width, 4)], |lens| {
            let [mut row, above, tiles] = lens.map(|len| vec![[0; 4]; len]);
            webp::undo_prediction(&mut row, &above, &tiles, 2)
        });
        needs([usize::div_ceil(width, 4)], |[tiles]| {
            webp::undo_cross_color(&mut vec![[0; 4]; width], &vec![[0; 4]; tiles], 2)
        });
    }
    let one = &[[0; 4]];
    needs([1, 1], |[len, spare]| {
        let bits = usize::BITS - spare as u32;
        webp::undo_prediction(&mut vec![[0; 4]; len], one, one, bits)
    });
    needs([1], |[spare]| {
        webp::undo_cross_color(&mut [[0; 4]], one, usize::BITS - spare as u32)
    });
    check(Some(()), || webp::undo_cross_color(&mut [], &[], 2));
}

#[test]
fn any_arguments_are_taken_or_refused() {
    let lens = [0, 1, 4, 16, 24, 31, 32, 33, 52, 64, 68, 100, 192, 432, 480];
    let absurd = [
        1 << 16,
        usize::MAX / 20,
        usize::MAX / 2,
        usize::MAX - 31,
        usize::MAX,
    ];
    let (any, mut below) = ([&lens[..], &absurd].concat(), random());
    let strength = FilterStrength {
        edge_limit: 99,
        interior_limit: 30,
        high_variance_threshold: 2,
        filters_inner_edges: true,
    };
    for _ in sample(0..30_000, 10_000) {
        let [a, b, c, d] = from_fn(|_| any[below(any.len())]);
        let given: [_; 3] = from_fn(|_| {
            let len = lens[below(lens.len())];
            samples(&mut below, len)
        });
        let ([x, y, z], strengths) = (given.each_ref(), &[strength][..below(2)]);
        check_against_portable(|| {
            let [mut p, mut q, mut r] = given.clone();
            let mut rgba = Vec::with_capacity(z.len());
            rgba.extend_from_slice(z.as_chunks().0);
            let results = [
                webp::filter_simply(plane(&mut p, a, b), strengths, true),
                webp::filter_normally(
                    [
                        plane(&mut p, a, b),
                        plane(&mut q, c, d),
                        plane(&mut r, c, d),
                    ],
                    strengths,
                    true,
                ),
                webp::undo_prediction(p.as_chunks_mut().0, y.as_chunks().0, &rgba, c as u32),
                webp::undo_cross_color(q.as_chunks_mut().0, &rgba, d as u32),
                webp::yuv_to_rgba([x, y, x, y], &mut rgba, a, b),
                webp::upsample(x, d, &mut z.clone(), c),
            ];
            (results, [p, q, r], rgba)
        });
    }
}
