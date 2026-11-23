//! The indices of JSON and XML and the source maps against plain loops, on each target that the CPU has.

use bun_simd::target::{Target, reset_cpu, set_cpu};
use bun_simd_kernels::{json, sourcemap, xml};
use core::mem::MaybeUninit;

const ROUNDS: usize = if cfg!(miri) { 2 } else { 2000 };

struct Random(u64);

impl Random {
    fn below(&mut self, limit: usize) -> usize {
        self.0 = self.0.wrapping_mul(0x5851_f42d_4c95_7f2d).wrapping_add(1);
        (self.0 >> 33) as usize % limit
    }

    /// Letters, with `words` here and there.
    fn text<T: Copy + From<u8>>(&mut self, words: &[&[T]]) -> Vec<T> {
        let (len, every) = (self.below(400), 1 << self.below(8));
        let mut text = Vec::new();
        while text.len() < len {
            match self.below(every) {
                0 => text.extend_from_slice(words[self.below(words.len())]),
                _ => text.push(b'a'.into()),
            }
        }
        text
    }
}

fn json_text(random: &mut Random) -> Vec<u8> {
    let mut text = random.text::<u8>(&[
        b"\"", b"\"", b"\\", b"\\\\", b"\\\"", b"{", b"}", b"[", b"]", b":", b",", b" ", b"\t",
        b"\n", b"\r", b"\0", b"\x1f", b"\xff", b"\"/'\"",
    ]);
    if random.below(4) == 0 {
        text.push(b'/');
    }
    text
}

fn check_json(text: &[u8]) {
    let (mut expected, mut expected_flags) = (vec![7], Some(0));
    let mut expected_dirty = vec![0u64; text.len().div_ceil(4096)];
    let (mut escaped, mut in_string, mut in_scalar) = (false, false, false);
    for (at, &byte) in text.iter().enumerate() {
        let is_quote = byte == b'"' && !escaped;
        escaped = byte == b'\\' && !escaped;
        in_string ^= is_quote;
        let class = json::BYTE_CLASS[byte as usize];
        let was_in_scalar = in_scalar;
        in_scalar = !in_string && !is_quote && class & (json::STRUCTURAL | json::WHITESPACE) == 0;
        if is_quote || !in_string && class & json::STRUCTURAL != 0 || in_scalar && !was_in_scalar {
            expected.push(at as u32);
        }
        let flag = match byte {
            b'/' | b'\'' if !in_string => {
                expected_flags = None;
                break;
            }
            b'\\' if in_string => json::HAS_BACKSLASH_IN_STRING,
            ..0x20 if in_string => json::HAS_CONTROL_IN_STRING,
            _ => continue,
        };
        expected_flags = expected_flags.map(|flags| flags | flag);
        expected_dirty[at / 4096] |= 1 << (at / 64 % 64);
    }

    let (mut whole, mut dirty) = (vec![7], vec![!0; expected_dirty.len()]);
    let flags = json::index_chunk(text, 0, &mut whole, &mut dirty, &mut Default::default());
    assert_eq!(flags, expected_flags, "{text:?}");
    if flags.is_some() {
        assert_eq!((&whole, &dirty), (&expected, &expected_dirty), "{text:?}");
    }

    let (mut found, mut flags) = (vec![7], Some(0));
    dirty.fill(0);
    let mut state = json::State::default();
    for (i, chunk) in text.chunks(128).enumerate() {
        let (before, mut word) = ((found.len(), state), [!0]);
        let base = 128 * i as u32;
        let Some(more) = json::index_chunk(chunk, base, &mut found, &mut word, &mut state) else {
            assert_eq!((found.len(), state), before);
            flags = None;
            break;
        };
        flags = flags.map(|flags| flags | more);
        dirty[i / 32] |= word[0] << (2 * i % 64);
    }
    assert_eq!(flags, expected_flags, "{text:?}");
    if flags.is_some() {
        assert_eq!((found, dirty), (expected, expected_dirty), "{text:?}");
    }
}

fn check_xml<T: Copy + Into<u32> + core::fmt::Debug>(
    text: &[T],
    index_chunk: impl Fn(&[T], u32, &mut Vec<u32>, &mut xml::State),
) {
    let unit = |at: usize| text.get(at).map_or(0, |&unit| unit.into());
    let (mut expected, mut in_tag) = (vec![7], false);
    for at in 0..text.len() {
        let is_entry = match unit(at) {
            0x3c | 0x3e => {
                in_tag = unit(at) == 0x3c;
                true
            }
            0x09 | 0x0a | 0x22 | 0x27 | 0x3d => in_tag,
            ..0x20 | 0x26 | 0xfffe.. => true,
            0xbe | 0xbf if size_of::<T>() == 1 => {
                at >= 2 && unit(at - 1) == 0xbf && unit(at - 2) == 0xef
            }
            0xd800..0xdc00 => unit(at + 1) & 0xfc00 != 0xdc00,
            0xdc00..0xe000 => at == 0 || unit(at - 1) & 0xfc00 != 0xd800,
            _ => false,
        };
        if is_entry {
            expected.push(at as u32);
        }
    }

    let (mut found, mut state) = (vec![7], xml::State::default());
    for (i, chunk) in text.chunks(128).enumerate() {
        index_chunk(chunk, 128 * i as u32, &mut found, &mut state);
    }
    if state.lead {
        found.push(text.len() as u32 - 1);
    }
    assert_eq!(found, expected, "{text:x?}");
}

const DIGITS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn check_source_map(random: &mut Random) {
    let (mut text, mut rows) = (Vec::new(), Vec::new());
    // What has to come out if the kernel stops at the start of each segment.
    let mut stops = Vec::new();
    let mut now = sourcemap::Parsed::default();
    let (len, bits, odd) = (random.below(600), random.below(32), 1 << random.below(8));
    let mut empty_lines = 0usize;
    while text.len() < len {
        if random.below(16 * odd) == 0 {
            empty_lines = random.below(200);
        }
        empty_lines = empty_lines.saturating_sub(1);
        // After twelve short segments these are exactly the second block.
        if text.len() == 60 && len % 2 == 0 {
            empty_lines = 64;
        }
        stops.push(sourcemap::Parsed {
            rows: rows.len(),
            resume_at: text.len(),
            ..now
        });
        if empty_lines > 0 || random.below(odd) == 0 {
            text.push(b';');
            (now.generated_line, now.generated_column) = (now.generated_line + 1, 0);
            continue;
        }
        let fields = if random.below(odd) == 0 {
            [1, 5, 5][random.below(3)]
        } else {
            4
        };
        let column = now.generated_column;
        let values = [
            &mut now.generated_column,
            &mut now.source,
            &mut now.original_line,
            &mut now.original_column,
            &mut now.name,
        ];
        for value in values.into_iter().take(fields) {
            let bits = if random.below(odd) == 0 { bits } else { 3 };
            let delta = random.below(1 << bits) as i32;
            let down = delta <= *value && random.below(2) == 0 || delta > i32::MAX - 1 - *value;
            let delta = if down { delta.min(*value) } else { delta };
            *value += if down { -delta } else { delta };
            let mut all = (delta as u32) << 1 | u32::from(down);
            let padded = text.len() + random.below(8 * odd * odd).min(6).abs_diff(6);
            while all >= 32 || text.len() < padded {
                text.push(DIGITS[(all & 31 | 32) as usize]);
                all >>= 5;
            }
            text.push(DIGITS[all as usize]);
        }
        now.needs_sort |= now.generated_column < column;
        now.has_names |= fields == 5;
        if fields > 1 {
            rows.push((
                [now.generated_line, now.generated_column],
                [now.original_line, now.original_column],
                now.source,
                if now.has_names { now.name } else { -1 },
            ));
        }
        if random.below(odd) == 0 {
            stops.push(sourcemap::Parsed {
                rows: rows.len(),
                resume_at: text.len(),
                ..now
            });
            text.push(b';');
            (now.generated_line, now.generated_column) = (now.generated_line + 1, 0);
        } else {
            text.push(b',');
        }
    }
    let valid = text.len();
    stops.push(sourcemap::Parsed {
        rows: rows.len(),
        resume_at: valid,
        ..now
    });
    let (in_range, out_of_range): (&[&[u8]], &[&[u8]]) = (
        &[
            b"",
            b"AAAA",
            b",",
            b"AA,",
            b"AAA,",
            b"AAAAAA,",
            b"AAAg,",
            b"AAAAg,",
            b"g;",
            b"AA\0A,",
            b"AA\xc1A,",
            b"gggggggA,",
            b"AAAAgggggggA,",
            b"gBgBgBgBg,",
        ],
        &[
            b"//////D,C,",
            b"A//////DAA,",
            b"A+/////DAA,",
            b"AA//////DA,",
        ],
    );
    let last = random.below(in_range.len() + out_of_range.len());
    text.extend_from_slice([in_range, out_of_range].concat()[last]);
    if last >= 2 {
        text.extend_from_slice(&b"AAAA,".repeat(random.below(30)));
    }
    let delimiters = text.iter().filter(|&&it| it == b',' || it == b';');
    assert_eq!(sourcemap::count_delimiters(&text), delimiters.count());

    let is_short = random.below(4) == 0;
    let room = if is_short {
        random.below(rows.len() + 1)
    } else {
        rows.len() + 12
    };
    let mut generated = vec![MaybeUninit::uninit(); room];
    let mut original = vec![MaybeUninit::uninit(); room];
    let mut source = vec![MaybeUninit::uninit(); room];
    let mut name = vec![MaybeUninit::uninit(); room];
    let with_names = random.below(2) == 0;
    let columns = sourcemap::Columns {
        generated: &mut generated,
        original: &mut original,
        source: &mut source,
        name: with_names.then_some(&mut name),
    };
    let parsed = sourcemap::parse_mappings(&text, columns, i32::MAX);
    let text = text.escape_ascii();
    assert!(stops.contains(&parsed), "{parsed:?} {text}");
    if !is_short {
        let before = if last < in_range.len() { 0 } else { 63 };
        assert!(parsed.resume_at + before >= valid, "{parsed:?} {text}");
    }
    for (i, &expected) in rows[..parsed.rows].iter().enumerate() {
        // SAFETY: the kernel initialized these rows.
        let found = unsafe {
            (
                generated[i].assume_init(),
                original[i].assume_init(),
                source[i].assume_init(),
                if with_names {
                    name[i].assume_init()
                } else {
                    expected.3
                },
            )
        };
        assert_eq!(found, expected, "row {i} of {text}");
    }
}

/// The numbers of a segment, if it has 1, 4 or 5 of up to 7 digits.
fn numbers(segment: &[u8]) -> Option<Vec<i32>> {
    let (mut numbers, mut all, mut shift) = (Vec::new(), 0u64, 0);
    for byte in segment {
        let digit = DIGITS.iter().position(|it| it == byte)? as u64;
        all |= (digit & 31) << shift;
        shift += 5;
        if digit < 32 {
            let size = (all as u32 >> 1) as i32;
            numbers.push(if all & 1 == 0 { size } else { -size });
            (all, shift) = (0, 0);
        } else if shift == 35 {
            return None;
        }
    }
    (shift == 0 && matches!(numbers.len(), 1 | 4 | 5)).then_some(numbers)
}

/// It stops at the first segment that is unusual or has no end, or in the block before one that is out of range.
fn check_any_mappings(text: &[u8], sources: i32) {
    let (mut now, mut stops, mut rows) = (sourcemap::Parsed::default(), vec![], vec![]);
    let before = loop {
        stops.push(now);
        let rest = &text[now.resume_at..];
        let Some(len) = (0..rest.len()).find(|&it| matches!(rest[it], b',' | b';')) else {
            break 0;
        };
        if rest[0] == b';' {
            (now.generated_line, now.generated_column) = (now.generated_line + 1, 0);
            now.resume_at += 1;
            continue;
        }
        let Some(deltas) = numbers(&rest[..len]) else {
            break 0;
        };
        let mut values = [
            now.generated_column,
            now.source,
            now.original_line,
            now.original_column,
            now.name,
        ];
        for (value, &delta) in values.iter_mut().zip(&deltas) {
            *value = value.wrapping_add(delta);
        }
        if values[..4].iter().any(|&it| it < 0) || deltas.len() > 1 && values[1] >= sources {
            break 63;
        }
        [
            now.generated_column,
            now.source,
            now.original_line,
            now.original_column,
            now.name,
        ] = values;
        now.needs_sort |= deltas[0] < 0;
        now.has_names |= deltas.len() == 5;
        now.resume_at += len + usize::from(rest[len] == b',');
        if deltas.len() > 1 {
            let name = if now.has_names { now.name } else { -1 };
            let [column, source, original @ .., _] = values;
            rows.push(([now.generated_line, column], original, source, name));
            now.rows += 1;
        }
    };

    let room = rows.len() + 12;
    let mut pairs = vec![MaybeUninit::new([7; 2]); 2 * room];
    let mut singles = vec![MaybeUninit::new(7); 2 * room];
    let ((generated, original), (source, name)) =
        (pairs.split_at_mut(room), singles.split_at_mut(room));
    let columns = sourcemap::Columns {
        generated,
        original,
        source,
        name: Some(name),
    };
    let parsed = sourcemap::parse_mappings(text, columns, sources);
    let text = text.escape_ascii();
    assert!(stops.contains(&parsed), "{parsed:?} {text}");
    assert!(parsed.resume_at + before >= now.resume_at, "{text}");
    // SAFETY: all were initialized, and the kernel writes numbers.
    let (pairs, singles) = unsafe { (pairs.assume_init_ref(), singles.assume_init_ref()) };
    let found = |i| (pairs[i], pairs[room + i], singles[i], singles[room + i]);
    let expected = rows.into_iter().take(parsed.rows);
    assert!((0..parsed.rows).map(found).eq(expected), "{text}");
}

fn check_edges() {
    let flags = [json::HAS_BACKSLASH_IN_STRING, json::HAS_CONTROL_IN_STRING];
    assert!(flags[0] != flags[1] && flags.iter().all(|it| it.is_power_of_two()));
    for (byte, class) in (0..=255).zip(xml::BYTE_CLASS) {
        let is_indexed = matches!(byte, ..0x20 | b'"' | b'&' | b'\'' | b'<'..=b'>');
        assert_eq!(class != 0, is_indexed);
    }
    let words: [&[u8]; 12] = [
        b"A",
        b"C",
        b"D",
        b"g",
        b",",
        b";",
        b"AAA",
        b"iB",
        b"+/////D",
        b"=",
        b"AAAA,",
        &[b';'; 64],
    ];
    for code in 0..12usize.pow(4) {
        let middle = [0, 1, 2, 3].map(|i| words[code / 12usize.pow(i) % 12]);
        let around = b"CACC,".repeat([0, 11, 12][code / 5 % 3]);
        let text = [&around[..], &middle.concat(), b",", &around].concat();
        check_any_mappings(&text, [2, 2, 1, 0, -1][code / 7 % 5]);
    }
    for segment in [&b"CACC,"[..], b"CACC;", b"iBAiBiBiB,", b"CACCiggB;"] {
        for byte in 0..=255 {
            for at in 0..66 {
                let mut text = segment.repeat(15);
                text[at] = byte;
                check_any_mappings(&text, 3);
            }
        }
    }
    // Up to six numbers of many lengths. The last may have no end.
    let numbers: [&[u8]; 7] = [b"", b"e", b"+V", b"r1P", b"+q/e", b"21q/B", b"h"];
    for code in 0..7usize.pow(5) {
        let middle = [0, 1, 2, 3, 4].map(|i| numbers[code / 7usize.pow(i) % 7]);
        let before = b"gggBgggBgggBgggB,C,C;gggB,".repeat(1 + code % 3);
        let text = [&before, numbers[code % 6], &middle.concat(), b",CACC,"].concat();
        check_any_mappings(&text, i32::MAX);
    }
    for len in 0..70 {
        check_any_mappings(&[&[b'A'; 70][..len], b",AAAA,AAAA,"].concat(), 1);
    }
    // The index of the name wraps around.
    for last in [&b"C,"[..], b"igB,", b"igggB,"] {
        check_any_mappings(&[b"AAAA+/////D,AAAA", last].concat(), 1);
        check_any_mappings(&[b"AAAA+/////D,ggBAAA", last].concat(), 1);
    }

    // All units are entries, and so is one before them.
    for len in 120..270 {
        check_json(&vec![b','; len]);
        check_xml(&vec![b'<'; len], xml::index_chunk);
        check_xml(&vec![0xd800; len], xml::index16_chunk);
    }
    // Every other byte of whole blocks is 0xEF.
    for len in 120..200 {
        let text = [&b"\xefa".repeat(100)[200 - len..], b"\xef\xbf\xbe"].concat();
        check_xml(&text, xml::index_chunk);
    }
    let (base, mut found) = (u32::MAX - 63, [vec![], vec![], vec![]]);
    let [a, b, c] = &mut found;
    json::index_chunk(&[b','; 130], base, a, &mut [0], &mut Default::default());
    xml::index_chunk(&[b'<'; 130], base, b, &mut Default::default());
    xml::index16_chunk(&[0xd800; 130], base, c, &mut Default::default());
    let expected: Vec<u32> = (0..130).map(|at| base.wrapping_add(at)).collect();
    assert!(found.iter().all(|it| *it == expected));

    for len in [4095, 4096, 4097, 8192, 8193] {
        for special in *b"\\\n" {
            let mut text = vec![b'a'; len];
            (text[0], text[len - 65], text[len - 1]) = (b'"', special, special);
            check_json(&text);
        }
    }
}

#[test]
fn all_targets_agree_with_plain_loops() {
    for &target in Target::ALL {
        if !set_cpu(target) {
            continue;
        }
        if !cfg!(miri) {
            check_edges();
        }
        let mut random = Random(1);
        for _ in 0..ROUNDS {
            check_json(&json_text(&mut random));
            let bytes = random.text::<u8>(&[
                b"<",
                b">",
                b"&",
                b"=",
                b"\"",
                b"'",
                b"\t",
                b"\n",
                b"\r",
                b"\0",
                b"\x1f",
                b"\xef",
                b"\xbf",
                b"\xef\xbf\xbe",
                b"\xef\xbf\xbf",
                b"\xef\xbf\xbd",
                b"\xff",
            ]);
            check_xml(&bytes, xml::index_chunk);
            let units = random.text::<u16>(&[
                &[0x3c],
                &[0x3e],
                &[0x26, 0x3d, 0x22, 0x27],
                &[0, 9, 10, 13],
                &[0x13c, 0x3e00, 0x803c, 0xff, 0xd7ff],
                &[0xd800],
                &[0xdfff],
                &[0xdbff, 0xdc00],
                &[0xe000, 0xfffd, 0xfeff],
                &[0xfffe],
                &[0xffff],
            ]);
            check_xml(&units, xml::index16_chunk);
            check_source_map(&mut random);
        }
    }
    reset_cpu();
}
