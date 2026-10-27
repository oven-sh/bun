//! The compressor against the C one: same calls, same results, same bytes, same positions.
use crate::c;
use crate::data::{Rng, data};
use bun_zstd as z;

fn r2(r: Result<usize, z::ErrorCode>) -> Result<usize, u32> { r.map_err(|e| e as u32) }
fn r0(r: Result<(), z::ErrorCode>) -> Result<usize, u32> { r.map(|()| 0).map_err(|e| e as u32) }

/// A dictionary: raw content, or in zstd's format (made from a real one by the C trainer is not available, so entropy
/// tables are taken from a frame... here: raw, or magic + garbage to exercise the error path).
fn dictionary(rng: &mut Rng, base: &[u8]) -> Vec<u8> {
    let len = rng.size(1 << 17);
    let mut d = if rng.chance(1, 2) && !base.is_empty() {
        let start = rng.below(base.len());
        let end = (start + len).min(base.len());
        base[start..end].to_vec()
    } else {
        data(rng, len)
    };
    if rng.chance(1, 12) && d.len() >= 8 {
        d[..4].copy_from_slice(&0xEC30A437u32.to_le_bytes());
    }
    d
}

fn level(rng: &mut Rng) -> i32 {
    match rng.below(10) {
        0 => -(rng.range(1, 50) as i32),
        1 => rng.range(0, 30) as i32 - 4,
        2 => -(rng.size(200000) as i32),
        _ => rng.range(1, 22) as i32,
    }
}

pub fn one_shot(rng: &mut Rng, max: usize) {
    let len = rng.size(max);
    let src = data(rng, len);
    let lvl = level(rng);
    let bound = unsafe { c::ZSTD_compressBound(len) };
    assert_eq!(bound, z::compress_bound(len));
    let cap = match rng.below(8) { 0 => rng.below(bound + 1), 1 => bound.saturating_sub(rng.below(20)), _ => bound + rng.below(50) };
    let mut a = vec![0u8; cap];
    let mut b = vec![0u8; cap];
    let ra = c::res(unsafe { c::ZSTD_compress(a.as_mut_ptr().cast(), cap, src.as_ptr().cast(), len, lvl) });
    let rb = r2(z::compress(&mut b, &src, lvl));
    assert_eq!(ra, rb, "one shot: len {len} level {lvl} cap {cap}");
    if let Ok(n) = ra {
        if a[..n] != b[..n] {
            let at = a[..n].iter().zip(&b[..n]).position(|(x, y)| x != y);
            panic!("one shot bytes differ at {at:?}/{n}: len {len} level {lvl}");
        }
    }
}

const PARAMS: &[(i32, i32, i32)] = &[
    (10, 0, 1), (100, -50, 22), (101, 10, 27), (102, 6, 26), (103, 6, 26), (104, 1, 12), (105, 3, 7), (106, 0, 4096),
    (107, 1, 9), (130, 0, 20000), (160, 0, 2), (161, 6, 24), (162, 4, 4096), (163, 1, 8), (164, 0, 12),
    (200, 0, 1), (201, 0, 1), (202, 0, 1),
];

fn set_params(rng: &mut Rng, a: &mut c::CCtx, b: &mut z::CCtx, log: &mut Vec<String>, mt: bool) {
    let n = match rng.below(4) { 0 => 0, 1 => 1, 2 => rng.below(4), _ => rng.below(9) };
    for _ in 0..n {
        let (p, v) = if rng.chance(1, 25) {
            (rng.below(403) as i32, rng.range(0, 40) as i32 - 5)
        } else {
            let &(p, lo, hi) = rng.pick(PARAMS);
            let v = if rng.chance(1, 20) { rng.range(0, 3000000) as i32 - 200000 } else { lo + rng.below((hi - lo + 1) as usize) as i32 };
            (p, v)
        };
        if !mt && (400..=402).contains(&p) { continue; }
        let ra = a.set(p as u32, v);
        let rb = r2(b.set_parameter(p, v));
        log.push(format!("set {p} {v} -> {ra:?}"));
        assert_eq!(ra, rb, "{log:?}");
    }
}

/// One context, several frames, random calls.
pub fn stream(rng: &mut Rng, max: usize) {
    let mut a = c::CCtx::new();
    let mut b = z::CCtx::new();
    let mut log: Vec<String> = Vec::new();
    let frames = if rng.chance(1, 3) { rng.range(2, 5) } else { 1 };
    for _ in 0..frames {
        if rng.chance(1, 6) {
            let r = *rng.pick(&[1u32, 2, 3]);
            let ra = a.reset(r);
            let rb = r0(b.reset(match r { 1 => z::ResetDirective::SessionOnly, 2 => z::ResetDirective::Parameters, _ => z::ResetDirective::SessionAndParameters }));
            log.push(format!("reset {r} -> {ra:?}"));
            assert_eq!(ra, rb, "{log:?}");
        }
        set_params(rng, &mut a, &mut b, &mut log, false);
        let len = rng.size(max);
        let src = data(rng, len);
        if rng.chance(1, 4) && std::env::var_os("NODICT").is_none() {
            let d = if rng.chance(1, 10) { Vec::new() } else { dictionary(rng, &src) };
            let ra = a.load_dict(&d);
            let rb = r0(b.load_dictionary(&d));
            log.push(format!("dict {} -> {ra:?}", d.len()));
            assert_eq!(ra, rb, "{log:?}");
        }
        if rng.chance(1, 4) {
            let n = if rng.chance(1, 8) { rng.size(max) as u64 } else { len as u64 };
            let ra = a.pledge(n);
            let rb = r0(b.set_pledged_src_size(n));
            log.push(format!("pledge {n} (len {len}) -> {ra:?}"));
            assert_eq!(ra, rb, "{log:?}");
        }
        log.push(format!("frame len {len}"));
        // how the input and the output are cut
        let in_mode = rng.below(4);
        let out_mode = rng.below(4);
        let small = len < 5000;
        let mut spos_total = 0usize;
        let mut calls = 0usize;
        let mut failed = false;
        loop {
            calls += 1;
            let left = len - spos_total;
            let chunk = match in_mode {
                0 => left,
                1 => rng.range(0, if small { 64 } else { 100_000 }).min(left),
                2 => rng.size(1 << 19).min(left),
                _ => if rng.chance(1, 2) { left } else { rng.below(left + 1) },
            };
            let cap = match out_mode {
                0 => z::compress_bound(chunk) + rng.below(100),
                1 => rng.range(0, if small { 40 } else { 50_000 }),
                2 => rng.size(1 << 18),
                _ => 1 << 17,
            };
            let last = spos_total + chunk == len;
            let end = if last && rng.chance(3, 4) { 2 } else { *rng.pick(&[0u32, 0, 0, 1, 1, 2]) };
            let end = if calls > 4000 { 2 } else { end };
            let input = &src[spos_total..spos_total + chunk];
            let mut oa = vec![0u8; cap];
            let mut ob = vec![0u8; cap];
            let (ra, opa, ipa) = a.stream2(&mut oa, 0, input, 0, end);
            let (rb, opb, ipb) = {
                let mut o = z::OutBuffer { dst: &mut ob, pos: 0 };
                let mut i = z::InBuffer { src: input, pos: 0 };
                let r = r2(b.compress_stream2(&mut o, &mut i, match end { 0 => z::EndDirective::Continue, 1 => z::EndDirective::Flush, _ => z::EndDirective::End }));
                (r, o.pos, i.pos)
            };
            if (ra, opa, ipa) != (rb, opb, ipb) || oa[..opa] != ob[..opb] {
                let at = oa.iter().zip(&ob).position(|(x, y)| x != y);
                panic!("stream: call {calls} chunk {chunk} cap {cap} end {end}: C {:?} Rust {:?} first diff {at:?}\n{log:?}", (ra, opa, ipa), (rb, opb, ipb));
            }
            spos_total += ipa;
            if ra.is_err() { failed = true; break; }
            if end == 2 && ra == Ok(0) {
                if spos_total == len { break; }
                log.push(format!("frame ended at {spos_total}"));
            }
            if calls > 6000 { panic!("no end {log:?}"); }
        }
        if failed {
            log.push("failed".into());
            let ra = a.reset(1);
            let rb = r0(b.reset(z::ResetDirective::SessionOnly));
            assert_eq!(ra, rb);
        }
    }
}

pub fn run(seed: u64, iters: u64, max: usize) {
    for i in 0..iters {
        let s = seed.wrapping_mul(1_000_003).wrapping_add(i);
        let mut rng = Rng(s);
        if std::env::var_os("TRACE").is_some() { eprintln!("iter {i} seed {s}"); }
        if rng.chance(1, 3) { one_shot(&mut rng, max) } else { stream(&mut rng, max) }
    }
    println!("comp ok: seed {seed}, {iters} iterations");
}

/// Multithreaded: when output comes out depends on timing, so only the whole output is compared.
pub fn mt(rng: &mut Rng, max: usize) {
    let mut a = c::CCtx::new();
    let mut b = z::CCtx::new();
    let mut log: Vec<String> = Vec::new();
    let frames = if rng.chance(1, 3) { rng.range(2, 3) } else { 1 };
    for _ in 0..frames {
        let mut set = |p: i32, v: i32, log: &mut Vec<String>| {
            let ra = a.set(p as u32, v);
            let rb = r2(b.set_parameter(p, v));
            log.push(format!("set {p} {v} -> {ra:?}"));
            assert_eq!(ra, rb, "{log:?}");
        };
        set(400, rng.range(1, 4) as i32, &mut log);
        if rng.chance(1, 2) { set(401, rng.range(0, 3 << 20) as i32, &mut log); }
        if rng.chance(1, 2) { set(402, rng.range(0, 9) as i32, &mut log); }
        set(100, if rng.chance(1, 6) { rng.range(13, 19) as i32 } else { rng.range(1, 12) as i32 - 3 }, &mut log);
        if rng.chance(1, 2) { set(101, rng.range(10, 22) as i32, &mut log); }
        if rng.chance(1, 3) { set(160, 1, &mut log); if rng.chance(1, 2) { set(162, rng.range(4, 200) as i32, &mut log); } if rng.chance(1,2) { set(161, rng.range(6, 20) as i32, &mut log); } }
        if rng.chance(1, 2) { set(201, 1, &mut log); }
        if rng.chance(1, 8) { set(130, rng.range(1340, 60000) as i32, &mut log); }
        let len = if rng.chance(1, 4) { rng.size(max) } else { rng.range(max / 4, max) };
        let src = data(rng, len);
        if rng.chance(1, 5) {
            let d = dictionary(rng, &src);
            let ra = a.load_dict(&d);
            let rb = r0(b.load_dictionary(&d));
            log.push(format!("dict {} -> {ra:?}", d.len()));
            assert_eq!(ra, rb, "{log:?}");
        }
        if rng.chance(1, 4) {
            let ra = a.pledge(len as u64);
            let rb = r0(b.set_pledged_src_size(len as u64));
            log.push(format!("pledge {len}"));
            assert_eq!(ra, rb, "{log:?}");
        }
        log.push(format!("frame len {len}"));
        let mut out_a: Vec<u8> = Vec::new();
        let mut out_b: Vec<u8> = Vec::new();
        let mut pos = 0usize;
        let in_mode = rng.below(3);
        loop {
            let left = len - pos;
            let chunk = match in_mode { 0 => left, 1 => rng.size(1 << 21).min(left), _ => rng.range(0, 300_000).min(left) };
            let last = pos + chunk == len;
            let end = if last { 2u32 } else { *rng.pick(&[0u32, 0, 0, 0, 1]) };
            let input = &src[pos..pos + chunk];
            let cap = z::compress_bound(len.max(1 << 20)) + 1024;
            let mut buf = vec![0u8; cap];
            let mut err_a = None;
            let mut err_b = None;
            let mut ip = 0usize;
            loop {
                let (r, op, np) = a.stream2(&mut buf, 0, input, ip, end);
                out_a.extend_from_slice(&buf[..op]);
                ip = np;
                match r { Err(e) => { err_a = Some(e); break; } Ok(left) => if (end == 0 && ip == chunk) || (end != 0 && left == 0) { break; } }
            }
            let mut ip = 0usize;
            loop {
                let mut o = z::OutBuffer { dst: &mut buf, pos: 0 };
                let mut i = z::InBuffer { src: input, pos: ip };
                let r = r2(b.compress_stream2(&mut o, &mut i, match end { 0 => z::EndDirective::Continue, 1 => z::EndDirective::Flush, _ => z::EndDirective::End }));
                let op = o.pos;
                ip = i.pos;
                out_b.extend_from_slice(&buf[..op]);
                match r { Err(e) => { err_b = Some(e); break; } Ok(left) => if (end == 0 && ip == chunk) || (end != 0 && left == 0) { break; } }
            }
            assert_eq!(err_a, err_b, "{log:?}");
            log.push(format!("chunk {chunk} end {end}"));
            if err_a.is_some() { let _ = a.reset(1); let _ = b.reset(z::ResetDirective::SessionOnly); break; }
            pos += chunk;
            if last { break; }
        }
        if out_a != out_b {
            let at = out_a.iter().zip(&out_b).position(|(x, y)| x != y);
            panic!("mt: {} vs {} bytes, first diff {at:?}\n{log:?}", out_a.len(), out_b.len());
        }
    }
}

pub fn run_mt(seed: u64, iters: u64, max: usize) {
    for i in 0..iters {
        let s = seed.wrapping_mul(1_000_003).wrapping_add(i);
        let mut rng = Rng(s);
        if std::env::var_os("TRACE").is_some() { eprintln!("iter {i} seed {s}"); }
        mt(&mut rng, max);
    }
    println!("mt ok: seed {seed}, {iters} iterations");
}

/// Dictionaries, by strategy.
pub fn run_dict(seed: u64, iters: u64, max: usize) {
    let mut fails = std::collections::BTreeMap::new();
    for i in 0..iters {
        let mut rng = Rng(seed.wrapping_mul(1_000_003).wrapping_add(i));
        let strat = rng.range(1, 9) as i32;
        let len = rng.size(max);
        let src = data(&mut rng, len);
        let d = dictionary(&mut rng, &src);
        let pledge = rng.chance(1, 2);
        let mut a = c::CCtx::new();
        let mut b = z::CCtx::new();
        a.set(107, strat).unwrap(); b.set_parameter(107, strat).unwrap();
        a.load_dict(&d).unwrap(); b.load_dictionary(&d).unwrap();
        let cap = z::compress_bound(len) + 64;
        let (mut oa, mut ob) = (vec![0u8; cap], vec![0u8; cap]);
        let end = if pledge { 2 } else { 1 };
        let (ra, pa, _) = a.stream2(&mut oa, 0, &src, 0, end);
        let mut o = z::OutBuffer { dst: &mut ob, pos: 0 };
        let mut inp = z::InBuffer { src: &src, pos: 0 };
        let rb = r2(b.compress_stream2(&mut o, &mut inp, if pledge { z::EndDirective::End } else { z::EndDirective::Flush }));
        let pb = o.pos;
        let ok = ra == rb && pa == pb && oa[..pa] == ob[..pb];
        let e = fails.entry((strat, pledge)).or_insert((0u32, 0u32));
        e.0 += 1;
        if !ok { e.1 += 1; if e.1 == 1 { eprintln!("first fail strat {strat} pledge {pledge} len {len} dict {} iter {i}: {ra:?} {rb:?} {pa} {pb}", d.len()); } }
    }
    for (k, v) in fails { println!("{k:?}: {} of {} differ", v.1, v.0); }
}
