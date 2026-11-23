//! The functions for 8-bit characters against the general ones.

use bun_core::strings;
use bun_node_path::*;
use core::mem::MaybeUninit;

/// All sequences of up to 6 parts.
fn paths() -> impl Iterator<Item = Vec<u8>> {
    let parts: [&[u8]; 7] = [
        b"",
        b"/",
        b".",
        b"..",
        b"a",
        b"long-enough-for-a-vector.b",
        b"\xe9",
    ];
    (0..7usize.pow(6)).map(move |code| {
        [0, 1, 2, 3, 4, 5]
            .map(|i| parts[code / 7usize.pow(i) % 7])
            .concat()
    })
}

#[test]
fn one_path() {
    let (mut a, mut b) = ([0; 300], [0; 300]);
    for path in paths() {
        let path = &path[..];
        let mut room = vec![MaybeUninit::uninit(); path.len() + 2];
        let normalized = normalize_posix_t(path, &mut a);
        assert_eq!(normalize_posix_latin1(path, &mut room), normalized);
        let has_no_dots = !matches!(strings::split(path, b"/").next(), Some(b"." | b".."));
        let is_tidy = path.is_ascii() && normalized == path && has_no_dots;
        assert_eq!(is_tidy_ascii_posix(path), is_tidy);
        if path.starts_with(b"/") {
            let resolved = resolve_posix_t(&[path], &mut a, &mut b);
            assert_eq!(
                resolve_absolute_posix_latin1(path, &mut room[1..]),
                resolved
            );
            assert_eq!(is_resolved_ascii_posix(path), is_tidy && resolved == path);
        }
        let dirname = dirname_posix_latin1(path).map_or_else(|it| it, |len| &path[..len]);
        assert_eq!(dirname, dirname_posix_t(path));
        assert_eq!(&path[extname_posix_latin1(path)], extname_posix_t(path));
        assert_eq!(
            &path[basename_posix_latin1(path)],
            basename_posix_t(path, None)
        );
        let (found, it) = (parse_posix_latin1(path), parse_posix_t(path));
        assert_eq!(
            [found.root, found.dir, found.base, found.ext, found.name].map(|it| &path[it]),
            [it.root, it.dir, it.base, it.ext, it.name]
        );
    }
}

#[test]
fn segments_that_are_dropped() {
    let segments = ["..", "a", "bc", "..."];
    let (mut a, mut b) = ([0; 40], [0; 40]);
    let mut room = [MaybeUninit::uninit(); 40];
    for code in 0..4usize.pow(7) {
        let segments = [0, 2, 4, 6, 8, 10, 12].map(|i| segments[code >> i & 3]);
        let path = segments.join("/");
        let expected = normalize_posix_latin1(path.as_bytes(), &mut room);
        assert_eq!(normalize_posix_t(path.as_bytes(), &mut a), expected);
        let wide: Vec<u16> = path.encode_utf16().collect();
        let expected = expected
            .iter()
            .map(|&it| u16::from(if it == b'/' { b'\\' } else { it }));
        assert!(expected.eq(normalize_windows_t(&wide, &mut b).iter().copied()));
    }
}

#[test]
fn relative() {
    let mut paths: Vec<_> = paths().filter(|it| is_resolved_ascii_posix(it)).collect();
    paths.sort();
    paths.dedup();
    let (mut a, mut b, mut c) = ([0; 300], [0; 300], [0; 300]);
    for from in paths.iter().step_by(9) {
        for to in &paths {
            let found = relative_posix_latin1(from, to);
            let ups = vec![".."; found.ups].join("/");
            let expected = relative_posix_t(from, to, &mut a, &mut b, &mut c);
            assert_eq!([ups.as_bytes(), &to[found.rest..]].concat(), expected);
        }
    }
}
