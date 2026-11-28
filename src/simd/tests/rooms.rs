//! The limits of pushes, rooms and matches.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::generic::*;

#[kernel(targets = Targets::ALL)]
fn extend(out: &mut Output<'_, u8>, reserved: usize, distance: usize, n: usize) -> [Option<()>; 2] {
    let len = out.len();
    let plain = out.extend_from_back(distance, n);
    out.truncate(len);
    [plain, out.room_for(reserved).unwrap().extend_from_back(distance, n)]
}

#[test]
fn matches_stay_inside() {
    for target in extend::targets() {
        let all = (0..42).flat_map(|d| (0..70).flat_map(move |n| [0, 31, 32].map(|more| (d, n, more))));
        for (distance, n, more) in all.step_by(if cfg!(miri) { 97 } else { 1 }) {
            let mut all = [7; 40 + 70 + 32 + 64];
            let mut out = Output::overwrite(&mut all[..40 + n + more]);
            out.push(&[1; 40]);
            let want = (1..=40).contains(&distance).then_some(());
            assert_eq!(extend::to(target, &mut out, n + more, distance, n), Some([want; 2]));
            assert_eq!(out.len(), 40 + want.map_or(0, |()| n));
            assert!(all[40 + n + more..].iter().all(|&it| it == 7), "{target:?} {distance} {n} {more}");
        }
    }
}

#[test]
fn a_match_takes_all_that_is_left() {
    let mut all = Box::new_uninit_slice(1 + 1 + 32);
    let mut out = Output::new(&mut all);
    out.push(1);
    assert_eq!(extend(&mut out, 33, 1, 1), [Some(()); 2]);
}

#[kernel]
fn parts() {
    let (v, mut all) = (u32x4::from([1, 0x0504_0302, 6, 0x0a09_0807]), Vec::new());
    Output::append(&mut all, 16).push((v.low_bytes(v.simd_gt(255)), v.first_n(3).low_bytes(v.simd_gt(255))));
    assert_eq!(all, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1, 2, 3, 4, 5, 6]);
    let (v, mut all) = (Simd::<u16, B128, S>::splat(0x101), Vec::new());
    Output::append(&mut all, 65 + 63).push((v.low_bytes(1 << 63), v.first_n(63).low_bytes(1 << 63)));
    Output::append(&mut all, 511).push([u8x16::splat(1); 32].first_n(511));
    let half = u8x32::splat(1).first_n(2);
    Output::append(&mut all, 5).push((half, half, 1));
    assert_eq!(all, [1; 65 + 63 + 511 + 5]);
    assert_eq!(Output::append(&mut String::new(), 16).try_push(u8x16::zero().ascii()), Some(()));
}

#[test]
fn parts_at_the_limits() {
    parts::targets().for_each(|it| parts::to(it).unwrap());
}

#[test]
fn all_kinds() {
    let (mut all, mut text, a) = (Vec::new(), String::new(), Ascii::from_u8(b'a').unwrap());
    let mut out = Output::append(&mut all, 40);
    out.push((1u8, 2, 3, 4));
    out.push((5, 6, 7, 8, 9));
    out.push((10, 11, 12, [13, 0].first_n(1)));
    out.push((14, 15, 16, 17, [18, 0].first_n(1)));
    out.push((19, 20, 21, 22, 23, [24, 0].first_n(1)));
    out.push(&&[25][..]);
    out.push(&&mut [26][..]);
    out.push(&Box::<[u8]>::from([27]));
    out.push(((&&[28, 0][..]).first_n(1), (&&mut [29, 0][..]).first_n(1)));
    out.limit(5).push((30, 31, 32, 33, [34, 0].first_n(1)));
    assert_eq!(out.try_push((0, 0, 0, 0, 0, [0, 0].first_n(2))), None);
    assert_eq!(out.try_push(&Box::<[u8]>::from([0; 7])), None);
    out.push((35, 36, 37, 38, 39, [40, 0].first_n(1)));
    assert!(out.filled().iter().copied().eq(1..41));
    Output::append(&mut text, 4).push((a, [a; 2], a.first_n(0), a.first_n(1)));
    assert_eq!(text, "aaaa");
}

fn nothing<const N: usize>() {
    for (room, want) in [(N - 1, None), (N, Some(()))] {
        let mut all = Vec::new();
        let mut out = Output::append(&mut all, room);
        assert_eq!(out.try_push(&[(); N]), want);
        out.clear();
        assert_eq!(out.room_for(room).unwrap().try_push(&[(); N]), want);
        assert_eq!(out.len(), want.map_or(0, |()| N));
        if room == N {
            out.clear();
            out.room_for(room).unwrap().push(&[(); N]);
            assert_eq!(out.len(), N);
        }
    }
}

#[test]
fn long_pieces() {
    nothing::<0xffff>();
    nothing::<0x1_0000>();
    nothing::<0x1_0001>();
    nothing::<0x8000_0000>();
    nothing::<{ usize::MAX / 2 }>();
    nothing::<{ usize::MAX / 2 + 1 }>();
}

#[kernel]
fn slack(room: usize) -> Vec<u8> {
    let mut all = Vec::new();
    Output::append(&mut all, 2).push_with_slack((1, [2, 3][..].first_n(1)));
    Output::append(&mut all, room).push_with_slack(u8x16::splat(4).first_n(1));
    all
}

#[test]
fn slack_for_all_lanes() {
    assert_eq!(slack(16), [1, 2, 4]);
}

#[test]
#[should_panic = "is too small"]
fn slack_for_one_less() {
    slack(15);
}
