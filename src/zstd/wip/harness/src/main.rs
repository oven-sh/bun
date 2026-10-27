mod c;
mod comp;
mod data;
mod dec;
mod extra;
mod sizes;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let cmd = args.get(1).map(String::as_str).unwrap_or("");
    let seed: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(1);
    let iters: u64 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(1000);
    match cmd {
        "dec" => dec::run(seed, iters),
        "sizes" => sizes::run(),
        "bench_mt_flush" => extra::bench_mt_flush(&args[2]),
        "bench_mt" => extra::bench_mt(&args[2]),
        "bench_small" => extra::bench_small(&args[2]),
        "mtx" => extra::mtx(seed, iters),
        "frames" => extra::frames(seed, iters, args[4].parse().unwrap(), args[5].parse().unwrap(), args[6] == "1"),
        "huge" => extra::huge(seed, iters as usize, args[4].parse().unwrap()),
        "bench" => extra::bench(&args[2]),
        "repro" => extra::repro(&args[2], &args[3], args[4].parse().unwrap(), args[5].parse().unwrap(), args[6].parse().unwrap(), args[7].parse().unwrap(), args[8] == "1"),
        "tdict" => extra::tdict(seed, iters, &args[4], &args[5]),
        "long" => { let ex: Vec<(i32,i32)> = args[6..].chunks(2).map(|c| (c[0].parse().unwrap(), c[1].parse().unwrap())).collect(); extra::long(seed, iters, args[4].parse().unwrap(), args[5].parse().unwrap(), &ex) }
        "dict" => comp::run_dict(seed, iters, args.get(4).and_then(|s| s.parse().ok()).unwrap_or(1 << 18)),
        "mt" => comp::run_mt(seed, iters, args.get(4).and_then(|s| s.parse().ok()).unwrap_or(8 << 20)),
        "comp" => comp::run(seed, iters, args.get(4).and_then(|s| s.parse().ok()).unwrap_or(1 << 20)),
        _ => eprintln!("usage: zstd_harness dec <seed> <iters>"),
    }
}
