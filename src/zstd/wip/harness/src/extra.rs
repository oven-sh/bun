//! Extra differential checks.
use crate::c;
use crate::data::{Rng, data};
use bun_zstd as z;

fn r2(r: Result<usize, z::ErrorCode>) -> Result<usize, u32> { r.map_err(|e| e as u32) }
fn r0(r: Result<(), z::ErrorCode>) -> Result<usize, u32> { r.map(|()| 0).map_err(|e| e as u32) }
fn ed(e: u32) -> z::EndDirective { match e { 0 => z::EndDirective::Continue, 1 => z::EndDirective::Flush, _ => z::EndDirective::End } }

fn load(dir: &str) -> Vec<Vec<u8>> {
    let mut names: Vec<_> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().path()).collect();
    names.sort();
    names.iter().map(|p| std::fs::read(p).unwrap()).collect()
}

pub fn tdict(seed: u64, iters: u64, dict_dir: &str, sample_dir: &str) {
    let dicts = load(dict_dir);
    let samples = load(sample_dir);
    for it in 0..iters {
        let s = seed.wrapping_mul(1_000_003).wrapping_add(it);
        if let Ok(only) = std::env::var("ONLY") { if only.parse::<u64>().unwrap() != s { continue; } }
        let mut rng = Rng(s);
        let rng = &mut rng;
        if it % 100 == 0 { eprintln!("iter {it}"); }
        let mut dict = rng.pick(&dicts).clone();
        if rng.chance(1, 10) {
            // damage
            let at = rng.below(dict.len().min(400));
            dict[at] ^= 1 << rng.below(8);
        }
        if rng.chance(1, 15) { let n = rng.below(dict.len()); dict.truncate(n); }
        let mut a = c::CCtx::new();
        let mut b = z::CCtx::new();
        let mut log: Vec<String> = vec![format!("seed {s} dict {}", dict.len())];
        let mt = rng.chance(1, 8);
        let frames = rng.range(1, 4);
        let mut all_out: Vec<u8> = Vec::new();
        let mut all_src: Vec<u8> = Vec::new();
        let mut ok_frames = true;
        {
            let mut set = |p: i32, v: i32, log: &mut Vec<String>| {
                let ra = a.set(p as u32, v);
                let rb = r2(b.set_parameter(p, v));
                log.push(format!("set {p} {v} -> {ra:?}"));
                assert_eq!(ra, rb, "{log:?}");
            };
            set(100, *rng.pick(&[-7, -1, 1, 2, 3, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 15, 16, 17, 18, 19, 22]), &mut log);
            if rng.chance(1, 3) { set(107, rng.range(1, 9) as i32, &mut log); }
            if rng.chance(1, 4) { set(101, rng.range(10, 24) as i32, &mut log); }
            if rng.chance(1, 4) { set(201, 1, &mut log); }
            if rng.chance(1, 5) { set(202, 0, &mut log); }
            if rng.chance(1, 5) { set(200, 0, &mut log); }
            if rng.chance(1, 8) { set(160, 1, &mut log); }
            if rng.chance(1, 8) { set(130, rng.range(1340, 9000) as i32, &mut log); }
            if rng.chance(1, 8) { set(105, rng.range(3, 7) as i32, &mut log); }
            if mt { set(400, rng.range(1, 3) as i32, &mut log); }
        }
        let ra = a.load_dict(&dict);
        let rb = r0(b.load_dictionary(&dict));
        assert_eq!(ra, rb, "{log:?}");
        for _ in 0..frames {
            let mut src = Vec::new();
            let target = if mt { rng.range(600_000, 3_000_000) } else { *rng.pick(&[0usize, 50, 500, 3000, 9000, 20_000, 40_000, 200_000, 700_000]) };
            let target = if mt { target } else { rng.size(target) };
            while src.len() < target {
                if rng.chance(1, 6) { let n = rng.size(3000); src.extend_from_slice(&data(rng, n)); continue; }
                let f = rng.pick(&samples);
                let st = rng.below(f.len());
                let n = rng.size(20000).min(f.len() - st);
                src.extend_from_slice(&f[st..st + n]);
            }
            src.truncate(target);
            let len = src.len();
            if rng.chance(1, 3) {
                let ra = a.pledge(len as u64); let rb = r0(b.set_pledged_src_size(len as u64));
                assert_eq!(ra, rb); log.push(format!("pledge {len}"));
            }
            log.push(format!("frame {len}"));
            let mode = rng.below(3);
            let mut pos = 0usize;
            let mut oa_all = Vec::new();
            let mut ob_all = Vec::new();
            let mut failed = false;
            loop {
                let left = len - pos;
                let chunk = match mode { 0 => left, 1 => rng.size(100_000).min(left), _ => rng.range(0, 5000).min(left) };
                let last = pos + chunk == len;
                let end = if last { 2 } else { *rng.pick(&[0u32, 0, 0, 1]) };
                let input = &src[pos..pos + chunk];
                let cap = z::compress_bound(len.max(1 << 17)) + 1024;
                let mut buf = vec![0u8; cap];
                let (mut ea, mut eb) = (None, None);
                let mut ip = 0;
                loop {
                    let (r, op, np) = a.stream2(&mut buf, 0, input, ip, end);
                    oa_all.extend_from_slice(&buf[..op]); ip = np;
                    match r { Err(e) => { ea = Some(e); break; } Ok(l) => if (end == 0 && ip == chunk) || (end != 0 && l == 0) { break; } }
                }
                let mut ip = 0;
                loop {
                    let mut o = z::OutBuffer { dst: &mut buf, pos: 0 };
                    let mut i = z::InBuffer { src: input, pos: ip };
                    let r = r2(b.compress_stream2(&mut o, &mut i, ed(end)));
                    let op = o.pos; ip = i.pos;
                    ob_all.extend_from_slice(&buf[..op]);
                    match r { Err(e) => { eb = Some(e); break; } Ok(l) => if (end == 0 && ip == chunk) || (end != 0 && l == 0) { break; } }
                }
                assert_eq!(ea, eb, "{log:?}");
                if ea.is_some() { failed = true; let _ = a.reset(1); b.reset_session(); break; }
                pos += chunk;
                if last { break; }
            }
            if std::env::var("HASH").ok().and_then(|h| h.parse::<u64>().ok()) == Some(s) {
                let h = |d: &[u8]| d.iter().fold(0xcbf29ce484222325u64, |h, &b| (h ^ b as u64).wrapping_mul(0x100000001b3));
                eprintln!("HASH seed {s} C {:x} Rust {:x}", h(&oa_all), h(&ob_all));
            }
            if oa_all != ob_all {
                let at = oa_all.iter().zip(&ob_all).position(|(x, y)| x != y);
                if let Ok(d) = std::env::var("DUMP") {
                    std::fs::write(format!("{d}/prev.bin"), &all_src).unwrap();
                    std::fs::write(format!("{d}/src.bin"), &src).unwrap();
                    std::fs::write(format!("{d}/dict.bin"), &dict).unwrap();
                    std::fs::write(format!("{d}/c.zst"), &oa_all).unwrap();
                    std::fs::write(format!("{d}/rust.zst"), &ob_all).unwrap();
                }
                panic!("tdict: {} vs {} first diff {at:?}\n{log:?}", oa_all.len(), ob_all.len());
            }
            if failed { ok_frames = false; break; }
            all_out.extend_from_slice(&oa_all);
            all_src.extend_from_slice(&src);
        }
        // decode
        let mut frames_bytes = all_out.clone();
        for round in 0..4 {
            if round > 0 {
                if frames_bytes.is_empty() { break; }
                frames_bytes = all_out.clone();
                for _ in 0..1 + rng.below(3) {
                    let at = rng.below(frames_bytes.len());
                    frames_bytes[at] ^= 1 << rng.below(8);
                }
            }
            let cap = all_src.len() + rng.size(1000);
            let (mut cd, mut rd) = (vec![0u8; cap], vec![0u8; cap]);
            let mut ca = c::DCtx::new();
            let mut cb = z::DCtx::new();
            let la = ca.load_dict(&dict).map(|_| ());
            let lb = cb.load_dictionary(&dict).map_err(|e| e as u32);
            assert_eq!(la, lb, "dctx load {log:?}");
            let x = ca.decompress(&mut cd, &frames_bytes);
            let y = r2(cb.decompress(&mut rd, &frames_bytes));
            assert_eq!(x, y, "decode round {round} {log:?}");
            if let Ok(n) = x { assert!(cd[..n] == rd[..n]); if round == 0 && ok_frames && la.is_ok() { assert!(cd[..n] == all_src[..], "roundtrip {log:?}"); } }
            // by reference ddict
            if let Ok(dd) = z::DDict::by_reference(&dict) {
                let y2 = r2(z::DCtx::new().decompress_using_ddict(&mut rd, &frames_bytes, &dd));
                assert_eq!(x, y2, "ddict {log:?}");
            }
            // streaming
            let mut ca = c::DCtx::new();
            let mut cb = z::DCtx::new();
            let _ = ca.load_dict(&dict); let _ = cb.load_dictionary(&dict);
            let mut ipos = 0; let mut stalls = 0;
            let small = frames_bytes.len() < 4000 && all_src.len() < 30_000;
            let inmax = *rng.pick(if small { &[7usize, 300, 5000, 100_000, 10_000_000] } else { &[3000usize, 20_000, 5000, 100_000, 10_000_000] });
            let outmax = *rng.pick(if small { &[50usize, 4096, 16384, 200_000, 1_000_000] } else { &[5000usize, 4096, 16384, 200_000, 1_000_000] });
            let (mut x1f, mut x2f) = (vec![0u8; outmax], vec![0u8; outmax]);
            loop {
                let iend = (ipos + rng.range(if stalls > 0 {1} else {0}, inmax)).min(frames_bytes.len());
                let cap = rng.range(if stalls > 1 {1} else {0}, outmax);
                let chunk = &frames_bytes[ipos..iend];
                let (x1, x2) = (&mut x1f[..cap], &mut x2f[..cap]);
                let (cr, co, ci) = ca.stream(x1, 0, chunk, 0);
                let mut ob = z::OutBuffer { dst: x2, pos: 0 };
                let mut ib = z::InBuffer { src: chunk, pos: 0 };
                let rr = r2(cb.decompress_stream(&mut ob, &mut ib));
                let (ro, ri) = (ob.pos, ib.pos);
                assert_eq!((cr, co, ci), (rr, ro, ri), "stream {log:?}");
                assert!(x1[..co] == x2[..ro]);
                ipos += ri;
                if cr.is_err() { break; }
                if ri == 0 && ro == 0 { stalls += 1 } else { stalls = 0 }
                if ipos == frames_bytes.len() && (cr == Ok(0) || stalls > 3) { break; }
            }
        }
    }
    println!("tdict ok seed {seed} iters {iters}");
}

/// A very long frame, so that indices are brought down.
pub fn long(seed: u64, total: u64, level: i32, wlog: i32, extra: &[(i32, i32)]) {
    let mut rng = Rng(seed);
    let mut a = c::CCtx::new();
    let mut b = z::CCtx::new();
    a.set(100, level).unwrap(); b.set_parameter(100, level).unwrap();
    if wlog != 0 { a.set(101, wlog).unwrap(); b.set_parameter(101, wlog).unwrap(); }
    a.set(201, 1).unwrap(); b.set_parameter(201, 1).unwrap();
    for &(p, v) in extra { assert_eq!(a.set(p as u32, v), r2(b.set_parameter(p, v))); }
    let base = data(&mut rng, 8 << 20);
    let mut done = 0u64;
    let cap = z::compress_bound(4 << 20) + 1024;
    let (mut oa, mut ob) = (vec![0u8; cap], vec![0u8; cap]);
    let mut da = c::DCtx::new();
    let mut db = z::DCtx::new();
    da.set(100, 31).unwrap(); db.set_parameter(100, 31).unwrap();
    let mut dec_a = vec![0u8; 8 << 20];
    let mut dec_b = vec![0u8; 8 << 20];
    let mut hash_src = 0u64; let mut hash_dec = 0u64;
    let fnv = |h: u64, d: &[u8]| { let mut h = h; for c in d.chunks(4096) { h = (h ^ c[0] as u64 ^ ((c[c.len()-1] as u64) << 8) ^ ((c.len() as u64) << 16)).wrapping_mul(0x100000001b3); } h };
    let _ = fnv;
    let mut srcsum = 0u64; let mut decsum = 0u64;
    while done < total {
        let st = rng.below(base.len() - (1 << 20));
        let n = rng.range(1, 1 << 20);
        let mut chunk = base[st..st + n].to_vec();
        if rng.chance(1, 2) { let at = rng.below(n); chunk[at] = rng.next() as u8; }
        done += n as u64;
        let end = if done >= total { 2 } else { 0 };
        for &x in chunk.iter().step_by(97) { srcsum = srcsum.wrapping_mul(31).wrapping_add(x as u64); }
        let mut ip = 0;
        loop {
            let (ra, pa, ia) = a.stream2(&mut oa, 0, &chunk, ip, end);
            let mut o = z::OutBuffer { dst: &mut ob, pos: 0 };
            let mut i = z::InBuffer { src: &chunk, pos: ip };
            let rb = r2(b.compress_stream2(&mut o, &mut i, ed(end)));
            let (pb, ib) = (o.pos, i.pos);
            assert_eq!((ra, pa, ia), (rb, pb, ib), "long at {done}");
            assert!(oa[..pa] == ob[..pb], "long bytes at {done}");
            ip = ia;
            // decode
            let mut dp = 0;
            loop {
                let (cr, co, ci) = da.stream(&mut dec_a, 0, &oa[..pa], dp);
                let mut o2 = z::OutBuffer { dst: &mut dec_b, pos: 0 };
                let mut i2 = z::InBuffer { src: &oa[..pa], pos: dp };
                let rr = r2(db.decompress_stream(&mut o2, &mut i2));
                assert_eq!((cr, co, ci), (rr, o2.pos, i2.pos), "long dec at {done}");
                assert!(dec_a[..co] == dec_b[..co], "long dec bytes at {done}");
                cr.unwrap();
                dp = ci;
                hash_dec = hash_dec.wrapping_add(co as u64);
                let _ = &mut decsum;
                if dp == pa && co < dec_a.len() { break; }
            }
            if (end == 0 && ip == chunk.len()) || (end == 2 && ra == Ok(0)) { break; }
        }
        hash_src = hash_src.wrapping_add(n as u64);
    }
    assert_eq!(hash_src, hash_dec, "sizes");
    println!("long ok: {done} bytes level {level} wlog {wlog} {extra:?} {srcsum}");
}

/// Two frames on one context with a dictionary.
pub fn repro(dict_path: &str, sample: &str, level: i32, wlog: i32, n1: usize, n2: usize, pledge: bool) {
    let dict = std::fs::read(dict_path).unwrap();
    let f = std::fs::read(sample).unwrap();
    let mut a = c::CCtx::new();
    let mut b = z::CCtx::new();
    a.set(100, level).unwrap(); b.set_parameter(100, level).unwrap();
    if wlog != 0 { a.set(101, wlog).unwrap(); b.set_parameter(101, wlog).unwrap(); }
    a.load_dict(&dict).unwrap(); b.load_dictionary(&dict).unwrap();
    for (k, &n) in [n1, n2].iter().enumerate() {
        let src = &f[..n.min(f.len())];
        if pledge { a.pledge(src.len() as u64).unwrap(); b.set_pledged_src_size(src.len() as u64).unwrap(); }
        let cap = z::compress_bound(src.len()) + 100;
        let (mut oa, mut ob) = (vec![0u8; cap], vec![0u8; cap]);
        let (ra, pa, _) = a.stream2(&mut oa, 0, src, 0, 2);
        let mut o = z::OutBuffer { dst: &mut ob, pos: 0 };
        let mut i = z::InBuffer { src, pos: 0 };
        let rb = r2(b.compress_stream2(&mut o, &mut i, z::EndDirective::End));
        let pb = o.pos;
        let same = oa[..pa] == ob[..pb];
        let at = oa[..pa].iter().zip(&ob[..pb]).position(|(x, y)| x != y);
        println!("frame {k}: len {} C {ra:?} {pa} Rust {rb:?} {pb} same {same} first diff {at:?}", src.len());
        if !same {
            println!(" C   : {:02x?}", &oa[..40.min(pa)]);
            println!(" Rust: {:02x?}", &ob[..40.min(pb)]);
            let ndiff = oa[..pa].iter().zip(&ob[..pb]).filter(|(x, y)| x != y).count();
            println!(" bytes differing: {ndiff}");
            // does the Rust frame decode?
            let mut d = c::DCtx::new(); d.load_dict(&dict).unwrap();
            let mut out = vec![0u8; src.len()];
            let r = d.decompress(&mut out, &ob[..pb]);
            println!(" C decoder on the Rust frame: {r:?} content ok {}", out == src);
        }
    }
}

pub fn bench(path: &str) {
    use std::time::Instant;
    let src = std::fs::read(path).unwrap();
    let cap = z::compress_bound(src.len());
    let mut out_c = vec![0u8; cap];
    let mut out_r = vec![0u8; cap];
    let mut dec = vec![0u8; src.len()];
    println!("corpus {} bytes", src.len());
    for level in [1, 3, 5, 7, 9, 12, 15, 19] {
        let reps = if level >= 15 { 1 } else if level >= 9 { 2 } else { 4 };
        let mut tc = f64::MAX; let mut tr = f64::MAX; let mut nc = 0; let mut nr = 0;
        for _ in 0..reps {
            let t = Instant::now();
            nc = c::res(unsafe { c::ZSTD_compress(out_c.as_mut_ptr().cast(), cap, src.as_ptr().cast(), src.len(), level) }).unwrap();
            tc = tc.min(t.elapsed().as_secs_f64());
            let t = Instant::now();
            nr = z::compress(&mut out_r, &src, level).unwrap();
            tr = tr.min(t.elapsed().as_secs_f64());
        }
        assert!(out_c[..nc] == out_r[..nr]);
        let mut dc = f64::MAX; let mut dr = f64::MAX;
        for _ in 0..5 {
            let t = Instant::now();
            c::decompress(&mut dec, &out_c[..nc]).unwrap();
            dc = dc.min(t.elapsed().as_secs_f64());
            let t = Instant::now();
            z::decompress(&mut dec, &out_c[..nc]).unwrap();
            dr = dr.min(t.elapsed().as_secs_f64());
        }
        let mb = src.len() as f64 / 1e6;
        println!("level {level:2}: compress C {:7.1} MB/s Rust {:7.1} MB/s ({:.2}x slower) | decompress C {:7.1} MB/s Rust {:7.1} MB/s ({:.2}x slower)", mb / tc, mb / tr, tr / tc, mb / dc, mb / dr, dr / dc);
    }
}

/// Many frames on one context, so that indices get close to the limit between frames.
pub fn frames(seed: u64, total: u64, level: i32, max_frame: usize, oneshot_end: bool) {
    let mut rng = Rng(seed);
    let mut a = c::CCtx::new();
    let mut b = z::CCtx::new();
    a.set(100, level).unwrap(); b.set_parameter(100, level).unwrap();
    let base = data(&mut rng, max_frame + (1 << 20));
    let cap = z::compress_bound(max_frame) + 1024;
    let (mut oa, mut ob) = (vec![0u8; cap], vec![0u8; cap]);
    let mut done = 0u64; let mut n = 0;
    while done < total {
        let len = rng.range(max_frame / 2, max_frame);
        let st = rng.below(base.len() - len);
        let src = &base[st..st + len];
        if oneshot_end {
            let (ra, pa, ia) = a.stream2(&mut oa, 0, src, 0, 2);
            let mut o = z::OutBuffer { dst: &mut ob, pos: 0 };
            let mut i = z::InBuffer { src, pos: 0 };
            let rb = r2(b.compress_stream2(&mut o, &mut i, z::EndDirective::End));
            assert_eq!((ra, pa, ia), (rb, o.pos, i.pos), "frame {n} at {done}");
            assert!(oa[..pa] == ob[..pa], "frame {n} bytes at {done}");
        } else {
            let mut pos = 0;
            loop {
                let chunk = (1 << 20).min(len - pos);
                let end = if pos + chunk == len { 2 } else { 0 };
                let mut ip = 0;
                loop {
                    let (ra, pa, ia) = a.stream2(&mut oa, 0, &src[pos..pos + chunk], ip, end);
                    let mut o = z::OutBuffer { dst: &mut ob, pos: 0 };
                    let mut i = z::InBuffer { src: &src[pos..pos + chunk], pos: ip };
                    let rb = r2(b.compress_stream2(&mut o, &mut i, ed(end)));
                    assert_eq!((ra, pa, ia), (rb, o.pos, i.pos), "frame {n} at {done}");
                    assert!(oa[..pa] == ob[..pa], "frame {n} bytes at {done}");
                    ip = ia;
                    if (end == 0 && ip == chunk) || (end == 2 && ra == Ok(0)) { break; }
                }
                pos += chunk;
                if end == 2 { break; }
            }
        }
        done += len as u64; n += 1;
    }
    println!("frames ok: {n} frames {done} bytes level {level} oneshot {oneshot_end}");
}

/// One call on more than 4 GB.
pub fn huge(seed: u64, total: usize, level: i32) {
    let mut rng = Rng(seed);
    let base = data(&mut rng, 16 << 20);
    let mut src = Vec::with_capacity(total);
    while src.len() < total {
        let st = rng.below(base.len() - (1 << 20));
        let n = rng.range(1, 1 << 20).min(total - src.len());
        src.extend_from_slice(&base[st..st + n]);
    }
    let cap = z::compress_bound(total);
    let mut oa = vec![0u8; cap];
    let ra = c::res(unsafe { c::ZSTD_compress(oa.as_mut_ptr().cast(), cap, src.as_ptr().cast(), total, level) });
    let mut ob = vec![0u8; cap];
    let rb = r2(z::compress(&mut ob, &src, level));
    assert_eq!(ra, rb);
    let n = ra.unwrap();
    assert!(oa[..n] == ob[..n], "huge bytes");
    drop(ob);
    let mut dec = vec![0u8; total];
    let rd = r2(z::decompress(&mut dec, &oa[..n]));
    assert_eq!(rd, Ok(total));
    assert!(dec == src, "huge roundtrip");
    let v = z::decompress_alloc(&oa[..n]).unwrap();
    assert!(v == src, "huge decompress_alloc");
    println!("huge ok {total} -> {n} level {level}");
}

/// Multithreaded frames that are given up, small outputs, contexts dropped in the middle.
pub fn mtx(seed: u64, iters: u64) {
    for it in 0..iters {
        let s = seed.wrapping_mul(1_000_003).wrapping_add(it);
        let mut rng = Rng(s);
        let rng = &mut rng;
        if it % 50 == 0 { eprintln!("iter {it}"); }
        let mut a = c::CCtx::new();
        let mut b = z::CCtx::new();
        let mut log = vec![format!("seed {s}")];
        let w = rng.range(1, 6) as i32;
        for (p, v) in [(400, w), (100, *rng.pick(&[1, 1, 3, 3, 5, 7, 9, 13])), (201, rng.below(2) as i32), (401, *rng.pick(&[0, 1, 600_000, 1_000_000])), (101, *rng.pick(&[0, 0, 12, 17, 20])), (160, *rng.pick(&[0, 0, 0, 1]))] {
            assert_eq!(a.set(p as u32, v), r2(b.set_parameter(p, v)));
            log.push(format!("set {p} {v}"));
        }
        let base = data(rng, 6 << 20);
        let nframes = rng.range(1, 4);
        for f in 0..nframes {
            let len = if rng.chance(1, 5) { rng.size(600_000) } else { rng.range(600_000, base.len()) };
            let src = &base[..len];
            let give_up_at = if rng.chance(1, 3) { Some(rng.below(len + 1)) } else { None };
            let pledge = rng.chance(1, 3) && give_up_at.is_none();
            if pledge { a.pledge(len as u64).unwrap(); b.set_pledged_src_size(len as u64).unwrap(); }
            log.push(format!("frame {f} len {len} give up {give_up_at:?} pledge {pledge}"));
            let outcap = *rng.pick(&[1usize, 7, 100, 4096, 16384, 1 << 20]);
            let outcap = if len > 2_000_000 && outcap < 100 { 4096 } else { outcap };
            let inmax = *rng.pick(&[1000usize, 16384, 65536, 1 << 20, 8 << 20]);
            let run = |which: u8, a: &mut c::CCtx, b: &mut z::CCtx, seed2: u64| -> (Vec<u8>, Option<u32>) {
                let mut r = Rng(seed2);
                let mut out = Vec::new();
                let mut buf = vec![0u8; outcap];
                let mut pos = 0;
                loop {
                    let stop = give_up_at.unwrap_or(usize::MAX);
                    if pos >= stop { return (out, None); }
                    let chunk = r.range(1, inmax).min(len - pos).min(stop - pos);
                    let last = pos + chunk == len;
                    let end = if last { 2 } else { *r.pick(&[0u32, 0, 0, 0, 0, 1]) };
                    let input = &src[pos..pos + chunk];
                    let mut ip = 0;
                    loop {
                        let (res, op, np) = if which == 0 { a.stream2(&mut buf, 0, input, ip, end) } else {
                            let mut o = z::OutBuffer { dst: &mut buf, pos: 0 };
                            let mut i = z::InBuffer { src: input, pos: ip };
                            let res = r2(b.compress_stream2(&mut o, &mut i, ed(end)));
                            (res, o.pos, i.pos)
                        };
                        out.extend_from_slice(&buf[..op]); ip = np;
                        match res { Err(e) => return (out, Some(e)), Ok(l) => if (end == 0 && ip == chunk) || (end != 0 && l == 0) { break; } }
                    }
                    pos += chunk;
                    if last { return (out, None); }
                }
            };
            let seed2 = rng.next();
            let (oa, ea) = run(0, &mut a, &mut b, seed2);
            let (ob, eb) = run(1, &mut a, &mut b, seed2);
            assert_eq!(ea, eb, "{log:?}");
            if give_up_at.is_none() && ea.is_none() {
                // Flushes make sections whose cut depends on timing only when the job table is full; compare by decoding.
                let mut dec = vec![0u8; len];
                assert_eq!(c::decompress(&mut dec, &ob), Ok(len), "{log:?}");
                assert!(dec == src, "roundtrip {log:?}");
                if oa != ob { log.push(format!("(frames differ: {} vs {})", oa.len(), ob.len())); eprintln!("differs: {log:?}"); }
            } else {
                if rng.chance(1, 4) { break; } // drop both in the middle of the frame
                a.reset(1).unwrap(); b.reset_session();
            }
        }
    }
    println!("mtx ok seed {seed} iters {iters}");
}

pub fn bench_small(path: &str) {
    use std::time::Instant;
    let all = std::fs::read(path).unwrap();
    for n in [0usize, 50, 300, 1000, 4000, 16000, 64000] {
        for level in [1, 3, 9] {
            let src = &all[1000..1000 + n];
            let cap = z::compress_bound(n);
            let mut oc = vec![0u8; cap]; let mut or = vec![0u8; cap];
            let iters = 20000.min(40_000_000 / (n + 200));
            let mut nc = 0; let mut nr = 0;
            let t = Instant::now();
            for _ in 0..iters { nc = c::res(unsafe { c::ZSTD_compress(oc.as_mut_ptr().cast(), cap, src.as_ptr().cast(), n, level) }).unwrap(); }
            let tc = t.elapsed().as_secs_f64() / iters as f64;
            let t = Instant::now();
            for _ in 0..iters { nr = z::compress(&mut or, src, level).unwrap(); }
            let tr = t.elapsed().as_secs_f64() / iters as f64;
            assert!(oc[..nc] == or[..nr]);
            let mut dec = vec![0u8; n];
            let t = Instant::now();
            for _ in 0..iters { c::decompress(&mut dec, &oc[..nc]).unwrap(); }
            let dc = t.elapsed().as_secs_f64() / iters as f64;
            let t = Instant::now();
            for _ in 0..iters { z::decompress(&mut dec, &oc[..nc]).unwrap(); }
            let dr = t.elapsed().as_secs_f64() / iters as f64;
            println!("n {n:6} level {level}: compress C {:8.2} us Rust {:8.2} us ({:.2}x) | decompress C {:7.2} us Rust {:7.2} us ({:.2}x)", tc * 1e6, tr * 1e6, tr / tc, dc * 1e6, dr * 1e6, dr / dc);
        }
    }
}

pub fn bench_mt(path: &str) {
    use std::time::Instant;
    let text = std::fs::read(path).unwrap();
    let mut rng = Rng(7);
    // sections that take very different times: text, noise, zeros
    let mut src = Vec::new();
    let sec = 1 << 20;
    for k in 0..192 {
        match k % 3 { 0 => { let st = rng.below(text.len() - sec); src.extend_from_slice(&text[st..st + sec]); }
                      1 => { for _ in 0..sec / 8 { src.extend_from_slice(&rng.next().to_le_bytes()); } }
                      _ => src.resize(src.len() + sec, 0) }
    }
    let uniform: Vec<u8> = text.iter().cycle().take(src.len()).copied().collect();
    let cap = z::compress_bound(src.len());
    let mut out = vec![0u8; cap];
    for (name, data) in [("uneven", &src), ("uniform", &uniform)] {
        for level in [3, 9] {
            for w in [0, 1, 2, 4, 8] {
                let mut best = [f64::MAX; 2];
                for _ in 0..2 {
                    let mut a = c::CCtx::new();
                    a.set(100, level).unwrap(); a.set(400, w).unwrap(); a.set(401, 1 << 20).unwrap();
                    let t = Instant::now();
                    let (r, _, _) = a.stream2(&mut out, 0, data, 0, 2); assert_eq!(r, Ok(0));
                    best[0] = best[0].min(t.elapsed().as_secs_f64());
                    let mut b = z::CCtx::new();
                    b.set_parameter(100, level).unwrap(); b.set_parameter(400, w).unwrap(); b.set_parameter(401, 1 << 20).unwrap();
                    let t = Instant::now();
                    let mut o = z::OutBuffer { dst: &mut out, pos: 0 };
                    let mut i = z::InBuffer { src: data, pos: 0 };
                    assert_eq!(b.compress_stream2(&mut o, &mut i, z::EndDirective::End), Ok(0));
                    best[1] = best[1].min(t.elapsed().as_secs_f64());
                }
                println!("{name:8} level {level} workers {w}: C {:6.0} ms  Rust {:6.0} ms  ({:.2}x)", best[0] * 1e3, best[1] * 1e3, best[1] / best[0]);
            }
        }
    }
}

pub fn bench_mt_flush(path: &str) {
    use std::time::Instant;
    let text = std::fs::read(path).unwrap();
    let mut out = vec![0u8; 1 << 20];
    for (level, wlog) in [(3, 0), (19, 0), (19, 27)] {
        let n = 5000usize;
        let mut a = c::CCtx::new();
        a.set(100, level).unwrap(); a.set(400, 2).unwrap(); if wlog != 0 { a.set(101, wlog).unwrap(); }
        let t = Instant::now();
        for k in 0..n { let input = &text[k * 1000..k * 1000 + 1000]; let mut ip = 0; loop { let (r, _, np) = a.stream2(&mut out, 0, input, ip, 1); ip = np; if r.unwrap() == 0 { break; } } }
        let tc = t.elapsed().as_secs_f64();
        let mut b = z::CCtx::new();
        b.set_parameter(100, level).unwrap(); b.set_parameter(400, 2).unwrap(); if wlog != 0 { b.set_parameter(101, wlog).unwrap(); }
        let t = Instant::now();
        for k in 0..n { let input = &text[k * 1000..k * 1000 + 1000]; let mut ip = 0; loop { let mut o = z::OutBuffer { dst: &mut out, pos: 0 }; let mut i = z::InBuffer { src: input, pos: ip }; let r = b.compress_stream2(&mut o, &mut i, z::EndDirective::Flush).unwrap(); ip = i.pos; if r == 0 { break; } } }
        let tr = t.elapsed().as_secs_f64();
        println!("level {level} wlog {wlog}: {n} flushes of 1000 B with 2 workers: C {:.1} us/flush, Rust {:.1} us/flush ({:.2}x)", tc / n as f64 * 1e6, tr / n as f64 * 1e6, tr / tc);
    }
}
