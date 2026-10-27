//! The edges of the API: values out of range, calls at the wrong time, the largest and the smallest of everything.
use crate::enc::{EncCase, Pair, run_op};
use crate::ffi::CDecoder;
use crate::r#gen;
use crate::rng::Rng;
use bun_brotli::{Decoder, DecoderParameter, Encoder, EncoderOperation, EncoderParameter, SpareCapacity};

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
    let (mut c, mut r) = (CDecoder::new(), Decoder::new());
    let (mut a, mut b) = (vec![0u8; 1 << 24], vec![0u8; 1 << 24]);
    let (mut pos, mut total) = (0usize, 0usize);
    loop {
        let (c_result, c_used, c_made) = c.stream(&stream[pos..], &mut a);
        let mut input = &stream[pos..];
        let mut output: &mut [u8] = &mut b;
        let r_result = r.decompress_stream(&mut input, &mut output) as i32;
        let (r_used, r_made) = (stream.len() - pos - input.len(), (1 << 24) - output.len());
        if (c_result, c_used, c_made) != (r_result, r_used, r_made) || a[..c_made] != b[..c_made] || a[..c_made] != data[total..total + c_made] {
            return Err(format!("{} bytes in one call, after {total} bytes of output: C {c_result} {c_used} {c_made}, Rust {r_result} {r_used} {r_made}", stream.len() - pos));
        }
        pos += c_used;
        total += c_made;
        if c_result != 3 {
            return if c_result == 1 && total == data.len() { Ok(4) } else { Err(format!("{} bytes in one call: result {c_result} after {total}", stream.len())) };
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
    Ok(n)
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
    check("one shot", one_shot(&text));
    check("parameters", parameters(&text));
    check("metadata", metadata(&text));
    check("dictionaries", dictionaries(corpus));
    check("long call", long_call(corpus));
    for it in 0..iters {
        if let Err(e) = spare_capacity(&mut Rng(seed + it), corpus) {
            panic!("seed {}: {e}", seed + it);
        }
    }
    println!("ok: {iters} iterations");
}
