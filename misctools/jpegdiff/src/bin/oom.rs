//! Fails the Nth allocation, for every N, in decode and encode. 
//! usage: oom FILE_OR_DIR...      every failure must come out as Error::Alloc; an allocation that cannot fail shows as a panic.
#![feature(alloc_error_hook)]
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::collections::BTreeMap;
thread_local! {
    static COUNT: Cell<u64> = const { Cell::new(0) };
    static FAIL_AT: Cell<u64> = const { Cell::new(u64::MAX) };
    static ARMED: Cell<bool> = const { Cell::new(false) };
}
struct Failing;
fn fails() -> bool {
    if !ARMED.get() {
        return false;
    }
    let n = COUNT.get();
    COUNT.set(n + 1);
    if n == FAIL_AT.get() {
        ARMED.set(false); // the panic machinery may allocate
        return true;
    }
    false
}
unsafe impl GlobalAlloc for Failing {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        if fails() { std::ptr::null_mut() } else { unsafe { System.alloc(l) } }
    }
    unsafe fn alloc_zeroed(&self, l: Layout) -> *mut u8 {
        if fails() { std::ptr::null_mut() } else { unsafe { System.alloc_zeroed(l) } }
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        if fails() { std::ptr::null_mut() } else { unsafe { System.realloc(p, l, n) } }
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        unsafe { System.dealloc(p, l) }
    }
}
#[global_allocator]
static A: Failing = Failing;

#[derive(PartialEq, Debug, Clone)]
enum Out {
    Ok(u64, usize),
    Err(String),
}
fn fnv(p: &[u8]) -> u64 {
    p.iter().fold(1469598103934665603u64, |h, &b| (h ^ b as u64).wrapping_mul(1099511628211))
}
fn decode(b: &[u8], e: u32) -> Result<Out, bun_jpeg::Error> {
    let d = bun_jpeg::Decoder::new(b)?;
    if d.width() as u64 * d.height() as u64 > 1 << 20 {
        return Ok(Out::Ok(0, 0));
    }
    let icc = d.icc_profile()?;
    let e = if d.scalable() { e } else { 8 };
    let px = d.decode(&bun_jpeg::DecodeOptions { eighths: e, max_scans: 500 })?;
    Ok(Out::Ok(fnv(&px) ^ icc.map_or(0, |i| fnv(&i)), px.len()))
}
fn encode(px: &[u8], w: u32, h: u32, progressive: bool, icc: Option<&[u8]>) -> Result<Out, bun_jpeg::Error> {
    let v = bun_jpeg::encode(px, w, h, &bun_jpeg::EncodeOptions { quality: 85, progressive, icc_profile: icc })?;
    Ok(Out::Ok(fnv(&v), v.len()))
}
/// Returns (allocations, runs).
fn sweep(name: &str, f: &dyn Fn() -> Result<Out, bun_jpeg::Error>, bad: &mut BTreeMap<String, (u64, String)>) -> (u64, u64) {
    let run = |at: u64| {
        COUNT.set(0);
        FAIL_AT.set(at);
        ARMED.set(true);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
        let fired = !ARMED.get();
        ARMED.set(false);
        (r, COUNT.get(), fired)
    };
    let (base, total, _) = run(u64::MAX);
    let base = match base {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => Out::Err(format!("{e:?}")),
        Err(_) => { bad.entry("panic without any failure".into()).or_insert((0, name.into())).0 += 1; return (0, 1) }
    };
    for at in 0..total {
        let (r, _, fired) = run(at);
        let what = match r {
            Err(_) => {
                let site = SITE.with(|s| s.borrow().clone());
                SITES.with(|s| { let mut s = s.borrow_mut(); let e = s.entry(site).or_insert((0, usize::MAX, 0)); e.0 += 1; e.1 = e.1.min(SIZE.get()); e.2 = e.2.max(SIZE.get()); });
                Some("PANIC".to_string())
            }
            Ok(Err(bun_jpeg::Error::Alloc(_))) => None,
            Ok(Err(e)) => Some(format!("other error {e:?}")),
            Ok(Ok(o)) => Some(if !fired { "count changed".into() } else if o == base { "went on and gave the same result".to_string() } else { "went on and gave ANOTHER result".to_string() }),
        };
        if let Some(w) = what {
            bad.entry(w).or_insert((0, format!("{name} allocation {at} of {total}"))).0 += 1;
        }
    }
    // and afterwards all is as before
    let (again, _, _) = run(u64::MAX);
    let again = match again { Ok(Ok(o)) => o, Ok(Err(e)) => Out::Err(format!("{e:?}")), Err(_) => Out::Err("panic".into()) };
    if again != base {
        bad.entry("a later run differs".into()).or_insert((0, name.into())).0 += 1;
    }
    (total, total + 2)
}
fn main() {
    std::alloc::set_alloc_error_hook(|l| { SIZE.set(l.size()); panic!("allocation cannot fail gracefully") });
    std::panic::set_hook(Box::new(|i| {
        // where the infallible allocation was asked for: the first frame inside the crate
        let bt = std::backtrace::Backtrace::force_capture().to_string();
        let site = bt.lines().map(str::trim).find_map(|l| l.split_once("/src/jpeg/").map(|(_, site)| site)).unwrap_or("?").to_string();
        let _ = i;
        SITE.with(|s| *s.borrow_mut() = site);
    }));
    let mut files = Vec::new();
    for a in std::env::args().skip(1) {
        let p = std::path::PathBuf::from(&a);
        if p.is_dir() { let mut v: Vec<_> = std::fs::read_dir(p).unwrap().map(|e| e.unwrap().path()).collect(); v.sort(); files.extend(v) } else { files.push(p) }
    }
    let mut bad = BTreeMap::new();
    let (mut allocs, mut runs, mut cases) = (0u64, 0u64, 0u64);
    for p in &files {
        let b = std::fs::read(p).unwrap();
        for e in [8u32, 4, 3, 1] {
            let (a, r) = sweep(&format!("{} scale {e}", p.display()), &|| decode(&b, e), &mut bad);
            allocs += a; runs += r; cases += 1;
        }
    }
    let icc: Vec<u8> = (0..200_000u32).map(|i| i as u8).collect();
    for (w, h) in [(1u32, 1u32), (8, 8), (17, 33), (64, 64), (300, 200), (1, 500), (2000, 3)] {
        let px: Vec<u8> = (0..w * h * 4).map(|i| (i.wrapping_mul(2654435761) >> 13) as u8).collect();
        for progressive in [false, true] {
            for icc in [None, Some(&icc[..100]), Some(&icc[..])] {
                let (a, r) = sweep(&format!("encode {w}x{h} progressive={progressive} icc={:?}", icc.map(|i| i.len())), &|| encode(&px, w, h, progressive, icc), &mut bad);
                allocs += a; runs += r; cases += 1;
            }
        }
    }
    println!("{cases} cases, {allocs} allocations each made to fail once, {runs} runs");
    for (k, (n, first)) in &bad {
        println!("{n:8}  {k}   first: {first}");
    }
    println!("sites of allocations that cannot fail:");
    SITES.with(|s| for (k, (n, lo, hi)) in s.borrow().iter() { println!("{n:8}  {k}  {lo}..{hi} bytes") });
}
thread_local! {
    static SITE: std::cell::RefCell<String> = const { std::cell::RefCell::new(String::new()) };
    static SIZE: Cell<usize> = const { Cell::new(0) };
    static SITES: std::cell::RefCell<BTreeMap<String, (u64, usize, usize)>> = const { std::cell::RefCell::new(BTreeMap::new()) };
}
