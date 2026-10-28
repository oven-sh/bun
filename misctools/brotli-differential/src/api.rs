//! The edges of the API: values out of range, calls at the wrong time, the largest and the smallest of everything.
use crate::enc::{EncCase, Pair, run_op};
use crate::ffi::CDecoder;
use crate::r#gen;
use crate::grammar;
use crate::rng::Rng;
use bun_brotli::{Decoder, DecoderParameter, Encoder, EncoderMode, EncoderOperation, EncoderParameter, PreparedDictionary, SpareCapacity};

const VALUES: &[u32] = &[
    0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 15, 16, 17, 18, 23, 24, 25, 26, 29, 30, 31, 32, 33, 63, 64, 120, 121, 127, 128, 255, 256, 1 << 16, 1 << 20, 1 << 24,
    (1 << 30) - 1, 1 << 30, (1 << 30) + 1, (1 << 31) - 1, 1 << 31, (1 << 31) + 1, u32::MAX - 1, u32::MAX,
];

fn pair(params: &[(i32, u32)], dicts: &[Vec<u8>]) -> Result<Pair, String> {
    Pair::new(&EncCase { data: Vec::new(), params: params.to_vec(), dicts: dicts.to_vec(), schedule: 0, misuse: false })
}

fn finish(p: &mut Pair, rng: &mut Rng, data: &[u8], big: bool) -> Result<(), String> {
    run_op(p, rng, 2, data, big).map(|_| ())
}

/// Every parameter with every value of the list: what setting it returns, before and after the first call, and what
/// comes out.
fn parameters(text: &[u8]) -> Result<usize, String> {
    let mut n = 0;
    for quality in [0u32, 1, 2, 4, 5, 9, 10, 11] {
        for k in -1..13 {
            for &v in VALUES {
                let at = |e: String| format!("quality {quality}, parameter {k} = {v}: {e}");
                for large in [false, true] {
                    // A window of 2^30 takes a hasher with 2^31 entries at qualities 10 and 11.
                    if k == 2 && large && quality >= 10 && (27..=63).contains(&v) {
                        continue;
                    }
                    let mut p = pair(&[(1, quality), (6, u32::from(large))], &[]).map_err(at)?;
                    p.set(k, v).map_err(at)?;
                    let mut rng = Rng(u64::from(v) ^ (k as u64) << 32);
                    run_op(&mut p, &mut rng, 0, &text[..700], true).map_err(at)?;
                    // Too late.
                    p.set(k, v).map_err(at)?;
                    p.set(1, 3).map_err(at)?;
                    finish(&mut p, &mut rng, &text[700..], large).map_err(at)?;
                    n += 1;
                }
            }
        }
    }
    Ok(n)
}

fn metadata(text: &[u8]) -> Result<usize, String> {
    let mut n = 0;
    let body: Vec<u8> = (0..(1usize << 24) + 1).map(|i| (i * 7 + (i >> 11)) as u8).collect();
    for quality in [0u32, 1, 2, 5, 11] {
        for size in [0usize, 1, 2, 13, 14, 15, 16, 17, 18, 255, 256, 257, 258, 65535, 65536, 65537, (1 << 24) - 1, 1 << 24, (1 << 24) + 1] {
            for style in 0..4u64 {
                let at = |e: String| format!("quality {quality}, {size} bytes of metadata, style {style}: {e}");
                let mut p = pair(&[(1, quality)], &[]).map_err(at)?;
                let mut rng = Rng(size as u64 * 31 + style);
                if style & 1 != 0 {
                    // With input that was not flushed.
                    run_op(&mut p, &mut rng, 0, &text[..1000], true).map_err(at)?;
                }
                let ok = run_op(&mut p, &mut rng, 3, &body[..size], style & 2 == 0 || size > 70000).map_err(at)?;
                if ok {
                    run_op(&mut p, &mut rng, 1, &text[1000..1500], true).map_err(at)?;
                    run_op(&mut p, &mut rng, 3, &body[..size.min(20)], false).map_err(at)?;
                }
                finish(&mut p, &mut rng, &text[1500..2000], true).map_err(at)?;
                n += 1;
            }
        }
    }
    Ok(n)
}

fn dictionaries(corpus: &r#gen::Corpus) -> Result<usize, String> {
    let mut n = 0;
    let mut rng = Rng(7);
    let big = r#gen::data(&mut rng, corpus, (32 << 20) + 16);
    let sizes = [0usize, 1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 100, 65535, 65536, (2 << 20) - 1, 2 << 20, (2 << 20) + 1, (4 << 20) + 1, (8 << 20) + 1, (16 << 20) + 1, (32 << 20) + 1];
    for quality in [0u32, 1, 2, 3, 4, 5, 7, 9, 10, 11] {
        for &size in &sizes {
            if quality >= 10 && size > 5 << 20 {
                continue;
            }
            let at = |e: String| format!("quality {quality}, a dictionary of {size} bytes: {e}");
            let dict = big[5..5 + size].to_vec();
            // Data that is found in the dictionary, at its start, its end and in between.
            let mut data = Vec::new();
            for part in [0, size / 2, size.saturating_sub(3000)] {
                data.extend_from_slice(&dict[part..(part + 3000).min(size)]);
                data.extend_from_slice(b"something else");
            }
            let mut p = pair(&[(1, quality), (2, 22)], &[dict.clone()]).map_err(at)?;
            finish(&mut p, &mut rng, &data, true).map_err(at)?;
            crate::enc::round_trip(&p.out, &data, &[dict.clone()], false, size as u64).map_err(at)?;
            // Attached in the middle of the stream. The decoder cannot follow, so only the encoders are compared.
            for flush in [false, true] {
                let mut p = pair(&[(1, quality), (2, 22)], &[]).map_err(at)?;
                run_op(&mut p, &mut rng, i32::from(flush), &data[..data.len() / 3], true).map_err(at)?;
                p.attach(&dict).map_err(at)?;
                finish(&mut p, &mut rng, &data[data.len() / 3..], true).map_err(at)?;
            }
            n += 3;
        }
        // One more than there is room for.
        let at = |e: String| format!("quality {quality}, 17 dictionaries: {e}");
        let mut p = pair(&[(1, quality)], &[]).map_err(at)?;
        let mut attached = Vec::new();
        for i in 0..17usize {
            let d = big[i * 100..i * 100 + 40 + i].to_vec();
            if p.attach(&d).map_err(at)? {
                attached.push(d);
            }
        }
        let data = big[..3000].to_vec();
        finish(&mut p, &mut rng, &data, true).map_err(at)?;
        crate::enc::round_trip(&p.out, &data, &attached, false, 3).map_err(at)?;
        n += 1;
    }
    Ok(n)
}

/// `compress` with arguments out of range and every kind of output size.
fn one_shot(text: &[u8]) -> Result<usize, String> {
    let mut n = 0;
    let random: Vec<u8> = { let mut rng = Rng(5); (0..3000).map(|_| rng.next() as u8).collect() };
    for quality in [i32::MIN, -2, -1, 0, 1, 2, 4, 5, 9, 10, 11, 12, 13, 100, i32::MAX] {
        for lgwin in [i32::MIN, -1, 0, 1, 9, 10, 11, 16, 17, 18, 24, 25, 26, 30, 31, 32, 64, 1000, i32::MAX] {
            // A window of 2^30 takes a hasher with 2^31 entries at qualities 10 and up.
            if quality >= 10 && (27..=1000).contains(&lgwin) {
                continue;
            }
            for mode in 0..3 {
                for data in [&text[..0], &text[..1], &text[..2], &text[..100], text, &random[..]] {
                    let bound = bun_brotli::max_compressed_size(data.len()).unwrap();
                    for cap in [0, 1, 2, 3, data.len() / 3, bound.saturating_sub(1), bound, bound + 1, bound + 1000] {
                        crate::enc::compare_one_shot(quality, lgwin, mode, data, cap)?;
                        n += 1;
                    }
                }
            }
        }
    }
    for size in [0usize, 1, (1 << 14) - 1, 1 << 14, 1 << 24, u32::MAX as usize, 1 << 40, usize::MAX - (1 << 50), usize::MAX >> 1, usize::MAX - 7, usize::MAX - 6, usize::MAX] {
        let (a, b) = (unsafe { crate::ffi::BrotliEncoderMaxCompressedSize(size) }, bun_brotli::max_compressed_size(size).unwrap_or(0));
        if a != b {
            return Err(format!("max_compressed_size({size}): C {a} Rust {b}"));
        }
    }
    Ok(n)
}

/// Every way to begin a stream.
fn first_calls(text: &[u8]) -> Result<usize, String> {
    // (operation, bytes of input)
    const CALLS: [(i32, usize); 7] = [(0, 0), (1, 0), (3, 0), (3, 5), (0, 1), (1, 1), (1, 300)];
    let mut n = 0;
    for quality in 0..12u32 {
        for code in 0..7usize.pow(3) {
            for style in 0..3u64 {
                let calls = [CALLS[code % 7], CALLS[code / 7 % 7], CALLS[code / 49]];
                let at = |e: String| format!("quality {quality}, first calls {calls:?}, style {style}: {e}");
                let offset = style == 2 && code % 2 == 0;
                let mut p = pair(&[(1, quality), (9, u32::from(offset) * 77)], &[]).map_err(at)?;
                let mut rng = Rng(code as u64 * 3 + style);
                let mut data = Vec::new();
                let mut rest = text;
                for (op, len) in calls {
                    if op != 3 {
                        data.extend_from_slice(&rest[..len]);
                    }
                    run_op(&mut p, &mut rng, op, &rest[..len], style == 0).map_err(at)?;
                    rest = &rest[len..];
                }
                let last = if code % 3 == 0 { 0 } else { 900 };
                data.extend_from_slice(&rest[..last]);
                finish(&mut p, &mut rng, &rest[..last], style == 0).map_err(at)?;
                if !offset {
                    crate::enc::round_trip(&p.out, &data, &[], false, style).map_err(at)?;
                }
                n += 1;
            }
        }
    }
    Ok(n)
}

/// With a stream offset, the first two bytes get a block of their own. However little room that finds, no call after it
/// is refused. Blocks of 64 KiB, so that input is left after the first call at every quality.
fn flint(text: &[u8]) -> Result<usize, String> {
    let data = text.repeat(20);
    let mut n = 0;
    for quality in 0..12u32 {
        // What the offset stands for, from another encoder.
        let mut first = pair(&[(1, quality), (3, 16)], &[])?;
        run_op(&mut first, &mut Rng(1), 1, &data[..1], true)?;
        for room in 0..7usize {
            for length in [2, 10, 70_000] {
                for op in 0..4 {
                    for big in [false, true] {
                        let at = |e: String| format!("quality {quality}, {length} bytes with room for {room}, then operation {op}, big {big}: {e}");
                        let mut p = pair(&[(1, quality), (3, 16), (9, 1)], &[]).map_err(at)?;
                        let mut rng = Rng((room * 8 + op as usize) as u64);
                        let (ok, used) = p.step(0, &data[1..1 + length], room).map_err(at)?;
                        let mut rest = &data[1 + used..1 + length];
                        let next = if op == 3 { &b"metadata"[..] } else { std::mem::take(&mut rest) };
                        if !ok || !run_op(&mut p, &mut rng, op, next, big).map_err(at)? || !run_op(&mut p, &mut rng, 2, rest, big).map_err(at)? {
                            return Err(at("refused".into()));
                        }
                        let stream = [&first.out[..], &p.out].concat();
                        crate::enc::round_trip(&stream, &data[..1 + length], &[], false, room as u64).map_err(at)?;
                        n += 1;
                    }
                }
            }
        }
    }
    Ok(n)
}

/// More than 1 GiB in one call.
fn long_call(corpus: &r#gen::Corpus) -> Result<usize, String> {
    let mut rng = Rng(11);
    let block = r#gen::data(&mut rng, corpus, 1 << 22);
    let mut data = Vec::with_capacity((1 << 30) + (1 << 22));
    while data.len() < (1 << 30) + 12345 {
        data.extend_from_slice(&block);
        let at = data.len() - 1 - rng.below(1 << 22);
        data[at] ^= 1;
    }
    for quality in [0u32, 2, 4] {
        let at = |e: String| format!("quality {quality}, {} bytes in one call: {e}", data.len());
        let mut p = pair(&[(1, quality)], &[]).map_err(at)?;
        let mut input: &[u8] = &data;
        loop {
            let (ok, used) = p.step(2, input, 1 << 24).map_err(at)?;
            if !ok {
                return Err(at("failed".into()));
            }
            input = &input[used..];
            p.out.clear();
            if p.is_finished() {
                break;
            }
        }
    }
    // The same for the decoders.
    let stream = crate::oom::uncompressed_stream(&data);
    decode_long(&stream, data.len(), Some(&data))?;
    drop((data, stream));
    // More than 2 GiB, which is negative as a 32-bit number (CVE-2020-8927): what is left of the input counts while an
    // uncompressed block is copied and while a metadata block is skipped, so they take turns.
    const BLOCK: usize = 1 << 24;
    let mut stream = vec![0u8; 2 + 2 * 72 * (4 + BLOCK) + 1];
    stream[..2].copy_from_slice(&[0x21, 0x03]);
    for (i, block) in stream[2..].chunks_exact_mut(4 + BLOCK).enumerate() {
        let header: u32 = if i % 2 == 0 { (2 << 1) | ((BLOCK as u32 - 1) << 3) | (1 << 27) } else { (3 << 1) | (3 << 4) | ((BLOCK as u32 - 1) << 6) };
        block[..4].copy_from_slice(&header.to_le_bytes());
    }
    *stream.last_mut().unwrap() = 3;
    decode_long(&stream, 72 * BLOCK, None)?;
    Ok(5)
}

/// Gives both decoders all that is left of `stream` in every call. It decodes to `length` bytes: `data`, if given.
fn decode_long(stream: &[u8], length: usize, data: Option<&[u8]>) -> Result<(), String> {
    const ROOM: usize = 1 << 24;
    let (mut c, mut r) = (CDecoder::new(), Decoder::new());
    let (mut a, mut b) = (vec![0u8; ROOM], vec![0u8; ROOM]);
    let (mut pos, mut total) = (0usize, 0usize);
    loop {
        let (c_result, c_used, c_made) = c.stream(&stream[pos..], &mut a);
        let mut input = &stream[pos..];
        let mut output: &mut [u8] = &mut b;
        let r_result = r.decompress_stream(&mut input, &mut output) as i32;
        let (r_used, r_made) = (stream.len() - pos - input.len(), ROOM - output.len());
        if (c_result, c_used, c_made) != (r_result, r_used, r_made) || a[..c_made] != b[..c_made] || data.is_some_and(|data| a[..c_made] != data[total..total + c_made]) {
            return Err(format!("{} bytes in one call, after {total} bytes of output: C {c_result} {c_used} {c_made}, Rust {r_result} {r_used} {r_made}", stream.len() - pos));
        }
        pos += c_used;
        total += c_made;
        if c_result != 3 {
            return if c_result == 1 && total == length { Ok(()) } else { Err(format!("{} bytes in one call: result {c_result} after {total}", stream.len())) };
        }
    }
}

const ERROR_CODES: &[bun_brotli::DecoderErrorCode] = {
    use bun_brotli::DecoderErrorCode::*;
    &[
        NoError, Success, NeedsMoreInput, NeedsMoreOutput, FormatExuberantNibble, FormatReserved, FormatExuberantMetaNibble,
        FormatSimpleHuffmanAlphabet, FormatSimpleHuffmanSame, FormatClSpace, FormatHuffmanSpace, FormatContextMapRepeat, FormatBlockLength1,
        FormatBlockLength2, FormatTransform, FormatDictionary, FormatWindowBits, FormatPadding1, FormatPadding2, FormatDistance, FormatBlockSwitch,
        CompoundDictionary, DictionaryNotSet, InvalidArguments, AllocContextModes, AllocTreeGroups, AllocContextMap, AllocRingBuffer1,
        AllocRingBuffer2, AllocBlockTypeTrees, Unreachable,
    ]
};

/// The names of the error codes, which JavaScript gets to see.
fn error_names() -> Result<usize, String> {
    let name_in_c = |code: i32| unsafe { std::ffi::CStr::from_ptr(crate::ffi::BrotliDecoderErrorString(code)) }.to_str().unwrap().to_string();
    let invalid = name_in_c(1000);
    let mut n = 0;
    for code in -40..10 {
        let c = name_in_c(code);
        match ERROR_CODES.iter().find(|&&e| e as i32 == code) {
            Some(e) => {
                if e.name() != c || e.node_code().to_str().unwrap() != format!("ERR_{c}") {
                    return Err(format!("error {code}: C {c:?}, Rust {:?} and {:?}", e.name(), e.node_code()));
                }
                if e.is_error() != (code < 0) || e.is_alloc_failure() != (-30..=-21).contains(&code) {
                    return Err(format!("error {code}: is_error {} is_alloc_failure {}", e.is_error(), e.is_alloc_failure()));
                }
                n += 1;
            }
            None if c != invalid => return Err(format!("error {code} is {c:?} in C and does not exist in Rust")),
            None => {}
        }
    }
    Ok(n)
}

fn decoder(text: &[u8]) -> Result<usize, String> {
    let stream = crate::ffi::c_compress(text, &crate::ffi::EncParams { params: vec![(1, 5)], dict: None });
    let mut n = 0;
    // How much is fed before the setters are called.
    for first in [0usize, 1, 2, 3, 10, stream.len()] {
        for k in 0..4i32 {
            for v in [0u32, 1, 2, u32::MAX] {
                let mut c = CDecoder::new();
                let mut r = Decoder::new();
                let both = |c: &mut CDecoder, r: &mut Decoder, input: &[u8]| -> Result<usize, String> {
                    let (mut a, mut b) = (vec![0u8; 1 << 16], vec![0u8; 1 << 16]);
                    let (cr, used, made) = c.stream(input, &mut a);
                    let mut rin = input;
                    let mut rout: &mut [u8] = &mut b;
                    let rr = r.decompress_stream(&mut rin, &mut rout) as i32;
                    if cr != rr || used != input.len() - rin.len() || made != (1 << 16) - rout.len() || a[..made] != b[..made] || c.error_code() != r.error_code() as i32 {
                        return Err(format!("decoder: first {first}, parameter {k} = {v}: result {cr}/{rr}"));
                    }
                    Ok(used)
                };
                let used = both(&mut c, &mut r, &stream[..first])?;
                let a = c.set(k, v);
                let b = DecoderParameter::from_raw(k as u32).is_some_and(|p| r.set_parameter(p, v));
                if a != b {
                    return Err(format!("decoder: set_parameter({k}, {v}) after {first} bytes: C {a}, Rust {b}"));
                }
                let a = c.attach(b"abcdef".to_vec());
                let b = r.attach_dictionary(b"abcdef"[..].into());
                if a != b {
                    return Err(format!("decoder: attach_dictionary after {first} bytes: C {a}, Rust {b}"));
                }
                both(&mut c, &mut r, &stream[used..])?;
                n += 1;
            }
        }
    }
    // More dictionaries than there is room for. Those that are refused leave no trace: a stream that uses the others decodes.
    let (mut c, mut r) = (CDecoder::new(), Decoder::new());
    let mut attached = Vec::new();
    let mut rng = Rng(3);
    for i in 0..17usize {
        let dictionary: Vec<u8> = (0..60 + i).map(|_| rng.next() as u8).collect();
        let (a, b) = (c.attach(dictionary.clone()), r.attach_dictionary(dictionary.clone().into()));
        if a != b {
            return Err(format!("decoder: dictionary number {}: C {a}, Rust {b}", i + 1));
        }
        if a {
            attached.push(dictionary);
        }
        n += 1;
    }
    let data: Vec<u8> = attached.iter().rev().flat_map(|d| [&d[..], b"!"].concat()).collect();
    let mut p = pair(&[(1, 9)], &attached)?;
    finish(&mut p, &mut rng, &data, true)?;
    assert!(p.out.len() < data.len() / 4);
    let (mut a, mut b) = (vec![0u8; 1 << 16], vec![0u8; 1 << 16]);
    let (cr, _, made) = c.stream(&p.out, &mut a);
    let mut rout: &mut [u8] = &mut b;
    let rr = r.decompress_stream(&mut &p.out[..], &mut rout) as i32;
    let made_by_rust = (1 << 16) - rout.len();
    if cr != 1 || rr != 1 || a[..made] != data[..] || b[..made_by_rust] != data[..] {
        return Err(format!("decoder: after 17 dictionaries: result {cr}/{rr}, error {} / {:?}", c.error_code(), r.error_code()));
    }
    // What `node:zlib` takes for a valid flush value or parameter. The numbers are those of the reference.
    for raw in (0..300).chain([u32::MAX]) {
        let numbers = [
            ("EncoderOperation", EncoderOperation::from_raw(raw).map(|v| v as u32), 4),
            ("EncoderMode", EncoderMode::from_raw(raw).map(|v| v as u32), 3),
            ("EncoderParameter", EncoderParameter::from_raw(raw).map(|v| v as u32), 10),
            ("DecoderParameter", DecoderParameter::from_raw(raw).map(|v| v as u32), 2),
        ];
        for (name, number, count) in numbers {
            if number != (raw < count).then_some(raw) {
                return Err(format!("{name}::from_raw({raw})"));
            }
        }
    }
    Ok(n)
}

/// Dictionaries of 2 GiB in all. Rust only: the reference adds their sizes up, the decoder in an `int`, and does not look at
/// the result. They are zeros that nothing writes to, so they take next to no memory.
fn huge_dictionaries() -> Result<usize, String> {
    const MOST: usize = i32::MAX as usize;
    let zeros = |n: usize| vec![0u8; n].into_boxed_slice();
    if PreparedDictionary::new(zeros(MOST + 1)).is_some() {
        return Err("encoder: a dictionary of 2 GiB was accepted".into());
    }
    // Distances into dictionaries count from their end, so the stream only depends on their last bytes: 16 zeros and this.
    let mut rng = Rng(4);
    let last: Vec<u8> = (0..1000).map(|_| rng.next() as u8).collect();
    let data = [&last[500..900], b"!", &[0; 12], &last[..400], b"!", &last[980..]].concat();
    let mut p = pair(&[(1, 9)], &[[&[0; 16], &last[..]].concat()])?;
    finish(&mut p, &mut rng, &data, true)?;
    assert!(p.out.len() < data.len() / 4);
    let mut n = 1;
    // The sizes of the dictionaries before the last one, whether each is accepted, and whether the last one is.
    let cases: [(&[(usize, bool)], bool); 7] = [
        (&[(MOST + 1, false), (16, true)], true),
        (&[(1 << 30, true), (1 << 30, false)], true),
        (&[(1 << 30, true), ((1 << 30) - 1001, true)], true),
        (&[(1 << 30, true), ((1 << 30) - 1001, true), (1, true)], false),
        (&[(MOST - 1000, true)], true),
        (&[(MOST - 999, true)], false),
        (&[(MOST, true), (1, false)], false),
    ];
    for (before, fits) in cases {
        let at = |e: &str| format!("decoder: dictionaries of {before:?} and 1000 bytes: {e}");
        let mut r = Decoder::new();
        for &(size, accepted) in before {
            if r.attach_dictionary(zeros(size)) != accepted {
                return Err(at(&format!("{size} bytes {}", if accepted { "refused" } else { "accepted" })));
            }
        }
        if r.attach_dictionary(last.clone().into()) != fits {
            return Err(at(if fits { "the last one refused" } else { "the last one accepted" }));
        }
        if fits {
            let mut out = vec![0u8; 1 << 16];
            let mut room: &mut [u8] = &mut out;
            let result = r.decompress_stream(&mut &p.out[..], &mut room) as i32;
            let made = (1 << 16) - room.len();
            if result != 1 || out[..made] != data[..] {
                return Err(at(&format!("result {result}, error {:?}, {made} bytes", r.error_code())));
            }
        }
        n += 1;
    }
    // A copy that starts near the end of the dictionaries and is longer than what is left of them. In the reference, where it
    // starts and its length add up to more than an `int` holds, and it goes on.
    assert_eq!(grammar::one_long_copy(1), [0xF2, 0xFF, 0xFF, 0x1F, 0x00, 0x04, 0x40, 0x1C, 0x16, 0xD0, 0xFF, 0xFF, 0x3F]);
    for sizes in [&[MOST + 1 - (1 << 23)][..], &[MOST], &[1 << 30, (1 << 30) - 1]] {
        for distance in [1, 2, 1000, 16_779_332] {
            let mut r = Decoder::new();
            assert!(sizes.iter().all(|&size| r.attach_dictionary(zeros(size))));
            let mut out = vec![0u8; 1 << 16];
            let mut room: &mut [u8] = &mut out;
            let result = r.decompress_stream(&mut &grammar::one_long_copy(distance)[..], &mut room) as i32;
            if result != 0 || r.error_code() as i32 != -18 || room.len() != 1 << 16 {
                return Err(format!("decoder: dictionaries of {sizes:?}, a long copy from {distance} before their end: result {result}, error {:?}", r.error_code()));
            }
            n += 1;
        }
    }
    // The encoder reads a dictionary to index it, and takes 4 bytes for each of its bytes while it does. So there are many.
    const PART: usize = 170_000_000;
    const ROOM: usize = MOST - 12 * PART;
    let mut e = Encoder::new();
    assert!(e.set_parameter(EncoderParameter::Quality, 9));
    let long = [&last[..], b"!"].concat();
    let sizes = [(PART, true); 12].into_iter().chain([(ROOM + 1, false), (ROOM - 1000, true)]);
    let dictionaries = sizes.map(|(size, accepted)| (zeros(size), accepted)).chain([
        (long.into(), false),
        (last.clone().into(), true),
        (zeros(1), false),
        (zeros(0), true),
        (zeros(0), false),
    ]);
    for (dictionary, accepted) in dictionaries {
        let size = dictionary.len();
        let prepared = PreparedDictionary::new(dictionary).ok_or("encoder: no memory for a dictionary")?;
        if e.attach_prepared_dictionary(prepared) != accepted {
            return Err(format!("encoder: dictionary {n} of {size} bytes {}", if accepted { "refused" } else { "accepted" }));
        }
        n += 1;
    }
    let mut stream = Vec::with_capacity(1 << 16);
    let result = e.compress_stream(EncoderOperation::Finish, &mut &data[..], &mut SpareCapacity::new(&mut stream, 1 << 16));
    if result.is_err() || !e.is_finished() {
        return Err(format!("encoder: with 2 GiB - 1 of dictionaries: {result:?}, finished: {}", e.is_finished()));
    }
    let mut r = Decoder::new();
    assert!(r.attach_dictionary(zeros(MOST - 1000)) && r.attach_dictionary(last.into()));
    let mut out = vec![0u8; 1 << 16];
    let mut room: &mut [u8] = &mut out;
    let result = r.decompress_stream(&mut &stream[..], &mut room) as i32;
    let made = (1 << 16) - room.len();
    if result != 1 || out[..made] != data[..] || stream.len() >= data.len() / 4 {
        return Err(format!("encoder: with 2 GiB - 1 of dictionaries: {} bytes, result {result}, error {:?}, {made} bytes", stream.len(), r.error_code()));
    }
    Ok(n + 1)
}

/// The spare capacity of a `Vec` as the output of the encoder has to act like a slice of that size.
fn spare_capacity(rng: &mut Rng, corpus: &r#gen::Corpus) -> Result<(), String> {
    let len = r#gen::length(rng, 1 << 18);
    let data = r#gen::data(rng, corpus, len);
    let quality = rng.below(12) as u32;
    let (mut a, mut b) = (Encoder::new(), Encoder::new());
    assert!(a.set_parameter(EncoderParameter::Quality, quality));
    assert!(b.set_parameter(EncoderParameter::Quality, quality));
    let mut rest: &[u8] = &data;
    let (mut out_a, mut out_b) = (Vec::new(), Vec::<u8>::new());
    loop {
        let most = 1 << rng.range(0, 17);
        let n = rng.range(0, most).min(rest.len());
        let op = if n == rest.len() { EncoderOperation::Finish } else if rng.chance(1, 8) { EncoderOperation::Flush } else { EncoderOperation::Process };
        let most = 1 << rng.range(0, 16);
        let room = rng.below(most);
        let mut buf = vec![0u8; room];
        let (mut in_a, mut in_b) = (&rest[..n], &rest[..n]);
        let mut slice: &mut [u8] = &mut buf;
        let ok_a = a.compress_stream(op, &mut in_a, &mut slice);
        let made = room - slice.len();
        out_a.extend_from_slice(&buf[..made]);
        // Either the capacity or the limit is what ends it.
        let limit = if rng.chance(1, 2) {
            out_b.reserve(room + rng.below(100));
            out_b.len() + room
        } else {
            out_b.shrink_to_fit();
            out_b.reserve_exact(room);
            if out_b.capacity() != out_b.len() + room { out_b.len() + room } else { usize::MAX }
        };
        let ok_b = b.compress_stream(op, &mut in_b, &mut SpareCapacity::new(&mut out_b, limit));
        if ok_a != ok_b || in_a.len() != in_b.len() || out_a != out_b || a.has_more_output() != b.has_more_output() || a.is_finished() != b.is_finished() {
            return Err(format!("SpareCapacity: quality {quality} len {len}: ok {ok_a:?}/{ok_b:?} left {}/{} out {}/{}", in_a.len(), in_b.len(), out_a.len(), out_b.len()));
        }
        rest = &rest[n - in_a.len()..];
        if a.is_finished() {
            return Ok(());
        }
    }
}

pub fn run(seed: u64, iters: u64, corpus: &r#gen::Corpus) {
    let text: Vec<u8> = corpus.files.iter().find(|f| f.len() > 5000 && f.is_ascii()).unwrap()[..4000].to_vec();
    let check = |name: &str, r: Result<usize, String>| match r {
        Ok(n) => println!("{name}: {n} cases ok"),
        Err(e) => panic!("seed 0 {name}: {e}"),
    };
    check("decoder setters", decoder(&text));
    check("error names", error_names());
    check("first calls", first_calls(&text));
    check("flint", flint(&text));
    check("one shot", one_shot(&text));
    check("parameters", parameters(&text));
    check("metadata", metadata(&text));
    check("dictionaries", dictionaries(corpus));
    check("huge dictionaries", huge_dictionaries());
    check("long call", long_call(corpus));
    for it in 0..iters {
        if let Err(e) = spare_capacity(&mut Rng(seed + it), corpus) {
            panic!("seed {}: {e}", seed + it);
        }
    }
    println!("ok: {iters} iterations");
}
