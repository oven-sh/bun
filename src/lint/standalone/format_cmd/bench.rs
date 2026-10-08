//! `bun-lint format bench`.

use super::{Args, collect_files};
use bun_format::Scratch;
use bun_lint::language::LanguageOptions;

/// `--check` does what `prettier --check` does: it reads each file, formats it and compares. Otherwise the files are read once,
/// and parsed and formatted `--iterations` times. With `--only=parse` nothing is formatted: the difference between two runs
/// under `perf stat` is what formatting costs, which the clocks here cannot tell on a machine that is busy.
pub(super) fn bench(args: &Args) {
    use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
    thread_local! {
        static BUFFERS: std::cell::RefCell<(Scratch, Vec<u8>)> = std::cell::RefCell::default();
    }
    let is_check = args.flag("check").is_some();
    let is_only_parsing = args.flag("only") == Some("parse");
    let iterations: usize = (args.flag("iterations").and_then(|it| it.parse().ok())).unwrap_or(if is_check { 1 } else { 10 });
    let threads: usize = args.flag("threads").and_then(|it| it.parse().ok()).unwrap_or(1);
    let paths: Vec<String> = collect_files(&args.positional).iter().map(|it| it.to_string_lossy().into_owned()).collect();
    let in_memory: Vec<Vec<u8>> = match is_check {
        true => Vec::new(),
        false => paths.iter().map(|path| std::fs::read(path).unwrap_or_default()).collect(),
    };
    let language = LanguageOptions::default();
    let (parsing, formatting, bytes) = (AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0));
    let (changed, failed) = (AtomicU64::new(0), AtomicU64::new(0));
    let started = std::time::Instant::now();
    for _ in 0..iterations {
        bun_sema_standalone::for_each_parallel(threads, paths.len(), |i| {
            let start = std::time::Instant::now();
            let read = if is_check { std::fs::read(&paths[i]).unwrap_or_default() } else { Vec::new() };
            let code = if is_check { &read } else { &in_memory[i] };
            bytes.fetch_add(code.len() as u64, Relaxed);
            crate::with_file(&paths[i], code, &language, |file| {
                parsing.fetch_add(start.elapsed().as_nanos() as u64, Relaxed);
                if is_only_parsing {
                    return;
                }
                let start = std::time::Instant::now();
                BUFFERS.with_borrow_mut(|(scratch, out)| {
                    out.clear();
                    match bun_format::format(file, &args.options, scratch, out) {
                        Ok(()) => changed.fetch_add(u64::from(out != code), Relaxed),
                        Err(_) => failed.fetch_add(1, Relaxed),
                    };
                });
                formatting.fetch_add(start.elapsed().as_nanos() as u64, Relaxed);
            });
        });
    }
    let wall = started.elapsed().as_secs_f64();
    let megabytes = bytes.load(Relaxed) as f64 / 1e6;
    let per_pass = |count: &AtomicU64| count.load(Relaxed) / iterations.max(1) as u64;
    let seconds = |nanos: &AtomicU64| nanos.load(Relaxed) as f64 / 1e9;
    println!(
        "{} files, {:.2} MB, {iterations} iterations, {threads} threads: {} would change, {} not formatted",
        paths.len(),
        megabytes / iterations.max(1) as f64,
        per_pass(&changed),
        per_pass(&failed),
    );
    println!("format:         {:8.1} MB/s per thread", megabytes / seconds(&formatting));
    println!("parse + bind:   {:8.1} MB/s per thread", megabytes / seconds(&parsing));
    println!("all:            {:8.1} MB/s per thread", megabytes / (seconds(&parsing) + seconds(&formatting)));
    println!("wall:           {:8.1} MB/s, {:.3} s a pass", megabytes / wall, wall / iterations.max(1) as f64);
}
