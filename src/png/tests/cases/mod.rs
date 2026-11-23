//! Reads the recorded cases of test/js/bun/image, for the tests of `bun_png`, `bun_jpeg` and `bun_webp`.

use bun_core::strings;
use bun_simd::target::{Target, reset_cpu, set_cpu};
use bun_zlib::inflate::{Container, Inflater, Status};
use std::collections::BTreeMap;
use std::fmt::Write;

pub(crate) fn inflate(mut bytes: &[u8], container: Container) -> Vec<u8> {
    let mut out = Vec::new();
    let status = Inflater::new(container).inflate_to_vec(&mut bytes, &mut out, usize::MAX);
    assert_eq!(status, Ok(Status::StreamEnd));
    out
}

/// An object of JSON. Strings keep their escapes.
pub(crate) struct Case<'a>(&'a [u8]);

impl<'a> Case<'a> {
    fn after(&self, key: &str) -> Option<&'a [u8]> {
        let key = format!("\"{key}\":");
        Some(&self.0[strings::index_of(self.0, key.as_bytes())? + key.len()..])
    }

    pub(crate) fn string(&self, key: &str) -> Option<&'a str> {
        let text = &self.after(key)?[1..];
        let mut end = 0;
        while text[end] != b'"' {
            end += if text[end] == b'\\' { 2 } else { 1 };
        }
        str::from_utf8(&text[..end]).ok()
    }

    pub(crate) fn number(&self, key: &str) -> Option<u64> {
        let digits = self.after(key)?.iter().take_while(|it| it.is_ascii_digit());
        Some(digits.fold(0, |number, digit| 10 * number + u64::from(digit - b'0')))
    }

    pub(crate) fn is(&self, key: &str) -> bool {
        self.after(key).is_some_and(|it| it.starts_with(b"true"))
    }

    pub(crate) fn file(&self) -> Vec<u8> {
        let (mut file, mut bits, mut count) = (Vec::new(), 0u32, 0);
        for digit in self.string("data").unwrap().bytes() {
            bits = bits << 6
                | u32::from(match digit {
                    b'A'..=b'Z' => digit - b'A',
                    b'a'..=b'z' => digit - b'a' + 26,
                    b'0'..=b'9' => digit - b'0' + 52,
                    b'+' => 62,
                    b'/' => 63,
                    _ => break,
                });
            count += 6;
            if count >= 8 {
                count -= 8;
                file.push((bits >> count) as u8);
            }
        }
        file
    }
}

/// The objects whose first key is `key`.
pub(crate) fn cases<'a>(json: &'a [u8], key: &str) -> Vec<Case<'a>> {
    let first = format!("\"{key}\":");
    let objects =
        strings::split(json, b"{\"name\":").flat_map(|it| strings::split(it, b"{\"source\":"));
    let with_key = |value: &[u8]| {
        &json[value.as_ptr().addr() - json.as_ptr().addr() - first.len()..]
            [..first.len() + value.len()]
    };
    let all = objects.skip(1).map(with_key);
    all.filter(|it| it.starts_with(first.as_bytes()))
        .map(Case)
        .collect()
}

pub(crate) fn files_by_name<'a>(cases: &[Case<'a>]) -> BTreeMap<&'a str, Vec<u8>> {
    let named = |case: &Case<'a>| (case.string("name").unwrap(), case.file());
    cases.iter().map(named).collect()
}

/// Each row behind filter type 0.
pub(crate) fn lines(rgba: &[u8], width: u32) -> Vec<u8> {
    let rows = rgba.chunks(4 * width as usize);
    rows.flat_map(|row| [&[0], row].concat()).collect()
}

/// Runs `test` with the kernels for each kind of CPU that this one can stand in for. No other test may do so meanwhile.
pub(crate) fn on_each_target(test: impl Fn()) {
    for &target in Target::ALL {
        if set_cpu(target) {
            test();
        }
    }
    reset_cpu();
}

pub(crate) fn sha256(bytes: &[u8]) -> String {
    let primes = (2u128..).filter(|&n| (2..n).all(|divisor| n % divisor != 0));
    let cube_root = |n: u128| {
        (0..36).rev().fold(0, |root: u128, bit| {
            if (root | 1 << bit).pow(3) <= n {
                root | 1 << bit
            } else {
                root
            }
        })
    };
    let constants: Vec<u32> = primes
        .clone()
        .take(64)
        .map(|p| cube_root(p << 96) as u32)
        .collect();
    let mut state: Vec<u32> = primes.take(8).map(|p| (p << 64).isqrt() as u32).collect();
    let zeros = (119 - bytes.len() % 64) % 64;
    let padded = [
        bytes,
        &[0x80],
        &[0; 64][..zeros],
        &(8 * bytes.len() as u64).to_be_bytes(),
    ]
    .concat();
    for block in padded.as_chunks::<4>().0.as_chunks::<16>().0 {
        let mut words = block.map(u32::from_be_bytes).to_vec();
        for i in 16..64 {
            let (a, b) = (words[i - 15], words[i - 2]);
            let a = a.rotate_right(7) ^ a.rotate_right(18) ^ a >> 3;
            let b = b.rotate_right(17) ^ b.rotate_right(19) ^ b >> 10;
            words.push(
                words[i - 16]
                    .wrapping_add(a)
                    .wrapping_add(words[i - 7])
                    .wrapping_add(b),
            );
        }
        let mut v: [u32; 8] = state[..].try_into().unwrap();
        for (word, &constant) in words.into_iter().zip(&constants) {
            let [a, b, c, d, e, f, g, h] = v;
            let sum = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let x = [sum, e & f ^ !e & g, constant, word]
                .into_iter()
                .fold(h, u32::wrapping_add);
            let sum = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let y = sum.wrapping_add(a & b ^ a & c ^ b & c);
            v = [x.wrapping_add(y), a, b, c, d.wrapping_add(x), e, f, g];
        }
        for (state, v) in state.iter_mut().zip(v) {
            *state = state.wrapping_add(v);
        }
    }
    let mut hex = String::new();
    state
        .iter()
        .for_each(|word| write!(hex, "{word:08x}").unwrap());
    hex
}
