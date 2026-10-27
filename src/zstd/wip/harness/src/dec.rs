//! The decoder against the C decoder: valid frames, damaged frames, one call and streaming.
use crate::c;
use crate::data::{Rng, data};
use bun_zstd as z;

fn rs<T>(r: Result<T, z::ErrorCode>) -> Result<T, u32> { r.map_err(|e| e as u32) }

/// A frame (or several) made by the C compressor with parameters picked by `rng`. Returns (frames, content, dictionary).
pub fn make_frames(rng: &mut Rng) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    let mut out = Vec::new();
    let mut content = Vec::new();
    let dict = if rng.chance(1, 4) { let n = rng.size(200_000); data(rng, n) } else { Vec::new() };
    let nframes = if rng.chance(1, 5) { rng.range(2, 4) } else { 1 };
    for _ in 0..nframes {
        if rng.chance(1, 12) {
            // skippable frame
            let n = rng.size(300);
            out.extend_from_slice(&(0x184D2A50u32 + rng.below(16) as u32).to_le_bytes());
            out.extend_from_slice(&(n as u32).to_le_bytes());
            out.extend_from_slice(&data(rng, n));
            continue;
        }
        let max = *rng.pick(&[0usize, 10, 300, 5_000, 70_000, 300_000, 1_500_000]);
        let len = rng.size(max);
        let mut src = data(rng, len);
        if !dict.is_empty() && rng.chance(1, 2) && !src.is_empty() {
            // make the dictionary useful
            let n = rng.size(dict.len().min(src.len()));
            let at = rng.below(dict.len() - n + 1);
            let to = rng.below(src.len() - n + 1);
            src[to..to + n].copy_from_slice(&dict[at..at + n]);
        }
        let mut cctx = c::CCtx::new();
        let level = *rng.pick(&[-50, -5, -1, 1, 1, 2, 3, 3, 3, 4, 5, 6, 7, 9, 12, 13, 16, 19, 22]);
        cctx.set(100, if src.len() > 400_000 { level.min(12) } else { level }).unwrap();
        if rng.chance(1, 3) { cctx.set(201, 1).unwrap(); } // checksum
        if rng.chance(1, 4) { cctx.set(200, 0).unwrap(); } // no content size
        if rng.chance(1, 4) { cctx.set(101, rng.range(10, 22) as i32).unwrap(); } // windowLog
        if rng.chance(1, 10) { cctx.set(130, rng.range(1340, 20_000) as i32).unwrap(); } // targetCBlockSize
        if rng.chance(1, 10) { cctx.set(160, 1).unwrap(); } // LDM
        if rng.chance(1, 8) { cctx.set(105, rng.range(3, 7) as i32).unwrap(); } // minMatch
        if !dict.is_empty() { cctx.load_dict(&dict).unwrap(); }
        let mut dst = vec![0u8; unsafe { c::ZSTD_compressBound(src.len()) } + 1024];
        let n = if rng.chance(1, 2) {
            cctx.compress2(&mut dst, &src).unwrap()
        } else {
            // streaming, with flushes: several blocks, no content size
            let (mut dpos, mut spos) = (0, 0);
            loop {
                let chunk = (spos + 1 + rng.size(200_000)).min(src.len());
                let end = if chunk == src.len() { 2 } else if rng.chance(1, 3) { 1 } else { 0 };
                let (r, d, s) = cctx.stream2(&mut dst, dpos, &src[..chunk], spos, end);
                dpos = d; spos = s;
                if r.unwrap() == 0 && end == 2 { break dpos; }
            }
        };
        out.extend_from_slice(&dst[..n]);
        content.extend_from_slice(&src);
    }
    (out, content, dict)
}

fn mutate(rng: &mut Rng, frames: &mut Vec<u8>) {
    if frames.is_empty() { return; }
    for _ in 0..1 + rng.size(4) {
        if frames.is_empty() { return; }
        // damage is more interesting near the start of a frame
        let at = if rng.chance(1, 2) { rng.size(frames.len() - 1) } else { rng.below(frames.len()) };
        match rng.below(8) {
            0 => frames[at] ^= 1 << rng.below(8),
            1 => frames[at] = rng.next() as u8,
            2 => frames.truncate(at),
            3 => { frames.remove(at); }
            4 => frames.insert(at, rng.next() as u8),
            5 => { let n = rng.size(16).min(frames.len() - at); for b in &mut frames[at..at + n] { *b = rng.next() as u8 } }
            6 => { let n = rng.size(64); let extra = data(rng, n); frames.extend_from_slice(&extra) }
            _ => { let from = rng.below(frames.len()); let n = rng.size(32).min(frames.len() - from.max(at)); frames.copy_within(from..from + n, at) }
        }
    }
}

fn check_sizes(frames: &[u8]) {
    let p = frames.as_ptr().cast();
    unsafe {
        assert_eq!(c::ZSTD_findDecompressedSize(p, frames.len()), z::find_decompressed_size(frames), "findDecompressedSize");
        assert_eq!(c::ZSTD_getFrameContentSize(p, frames.len()), z::get_frame_content_size(frames), "getFrameContentSize");
        assert_eq!(c::res(c::ZSTD_findFrameCompressedSize(p, frames.len())), rs(z::decompress::find_frame_compressed_size(frames)), "findFrameCompressedSize");
    }
}

fn one_shot(frames: &[u8], dict: &[u8], cap: usize, prefix: bool) {
    let mut cd = vec![0xAAu8; cap];
    let mut rd = vec![0xAAu8; cap];
    let mut cctx = c::DCtx::new();
    let mut rctx = z::DCtx::new();
    let (cr, rr);
    if prefix {
        cctx.ref_prefix(dict).unwrap();
        cr = cctx.decompress(&mut cd, frames);
        // an empty prefix is no dictionary at all
        rr = if dict.is_empty() { rs(rctx.decompress(&mut rd, frames)) } else { rs(z::DDict::prefix(dict).and_then(|d| rctx.decompress_using_ddict(&mut rd, frames, &d))) };
    } else {
        assert_eq!(cctx.load_dict(dict).map(|_| ()), rs(rctx.load_dictionary(dict)), "loadDictionary");
        cr = cctx.decompress(&mut cd, frames);
        rr = rs(rctx.decompress(&mut rd, frames));
    }
    assert_eq!(cr, rr, "one-shot result (cap {cap})");
    if let Ok(n) = cr { assert!(cd[..n] == rd[..n], "one-shot output"); }
}

fn streaming(rng: &mut Rng, frames: &[u8], dict: &[u8], expect: Option<&[u8]>) {
    let mut cctx = c::DCtx::new();
    let mut rctx = z::DCtx::new();
    if rng.chance(1, 6) {
        let (p, v) = (*rng.pick(&[100u32, 100, 100, 0, 99, 1]), *rng.pick(&[0i32, 9, 10, 15, 20, 27, 31, 32, -1]));
        assert_eq!(cctx.set(p, v).map(|_| ()), rs(rctx.set_parameter(p as i32, v)), "setParameter {p} {v}");
    }
    assert_eq!(cctx.load_dict(dict).map(|_| ()), rs(rctx.load_dictionary(dict)), "loadDictionary");
    // tiny steps only where they do not take forever
    let small = frames.len() < 3_000;
    let in_max = *rng.pick(if small { &[1usize, 2, 3, 7, 64, 1000, 70_000, 10_000_000] } else { &[300usize, 1000, 5000, 20_000, 70_000, 200_000, 10_000_000, 10_000_000] });
    let out_max = *rng.pick(if small && expect.is_none_or(|e| e.len() < 20_000) { &[1usize, 2, 5, 100, 4096, 16_384, 140_000, 10_000_000] } else { &[1000usize, 4096, 4096, 16_384, 16_384, 140_000, 1_000_000, 10_000_000] });
    let mut total = Vec::new();
    let (mut cbuf, mut rbuf) = (Vec::new(), Vec::new());
    let mut ipos = 0usize;
    let mut stalls = 0;
    loop {
        let iend = (ipos + rng.range(if stalls > 0 { 1 } else { 0 }, in_max)).min(frames.len());
        let cap = rng.range(if stalls > 1 { 1 } else { 0 }, out_max);
        let chunk = &frames[ipos..iend];
        if cbuf.len() < cap { cbuf.resize(cap, 0x55); rbuf.resize(cap, 0x55); }
        let cd = &mut cbuf[..cap];
        let rd = &mut rbuf[..cap];
        let (cr, co, ci) = cctx.stream(cd, 0, chunk, 0);
        let mut ob = z::OutBuffer { dst: rd, pos: 0 };
        let mut ib = z::InBuffer { src: chunk, pos: 0 };
        let rr = rs(rctx.decompress_stream(&mut ob, &mut ib));
        let (ro, ri) = (ob.pos, ib.pos);
        assert_eq!((cr, co, ci), (rr, ro, ri), "stream step at {ipos} (in {} out {cap})", chunk.len());
        assert!(cbuf[..co] == rbuf[..ro], "stream output at {ipos}");
        total.extend_from_slice(&rbuf[..ro]);
        ipos += ri;
        if cr.is_err() { return; }
        if ri == 0 && ro == 0 { stalls += 1 } else { stalls = 0 }
        if ipos == frames.len() && (cr == Ok(0) || stalls > 3) { break; }
        if cr == Ok(0) && rng.chance(1, 8) {
            match rng.below(2) {
                0 => { cctx.init_stream(); rctx.init_stream(); if !dict.is_empty() { return; } }
                _ => {}
            }
        }
    }
    if let Some(expect) = expect { assert!(total == expect, "stream total"); }
}

pub fn run(seed: u64, iters: u64) {
    for i in 0..iters {
        let s = seed.wrapping_mul(1_000_003).wrapping_add(i);
        let mut rng = Rng(s);
        if i % 200 == 0 { eprintln!("dec iter {i} (seed {s})"); }
        let (mut frames, content, dict) = make_frames(&mut rng);
        // valid
        check_sizes(&frames);
        one_shot(&frames, &dict, content.len(), false);
        one_shot(&frames, &dict, content.len() + rng.size(300_000), false);
        if !content.is_empty() { let cap = rng.below(content.len()); one_shot(&frames, &dict, cap, false); }
        streaming(&mut rng, &frames, &dict, Some(&content));
        streaming(&mut rng, &frames, &dict, Some(&content));
        // wrong or missing dictionary
        if rng.chance(1, 4) { let n = rng.size(5000); let other = data(&mut rng, n); one_shot(&frames, &other, content.len(), rng.chance(1, 2)); streaming(&mut rng, &frames, &other, None); }
        // damaged
        for _ in 0..6 {
            let mut bad = frames.clone();
            mutate(&mut rng, &mut bad);
            check_sizes(&bad);
            let cap = content.len() + if rng.chance(1, 2) { rng.size(200_000) } else { 0 };
            one_shot(&bad, &dict, cap, false);
            streaming(&mut rng, &bad, &dict, None);
        }
        mutate(&mut rng, &mut frames);
    }
    println!("dec ok: {iters} iterations from seed {seed}");
}
