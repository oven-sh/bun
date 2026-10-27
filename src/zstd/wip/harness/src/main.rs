mod c;
mod comp;
mod data;
mod dec;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let cmd = args.get(1).map(String::as_str).unwrap_or("");
    let seed: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(1);
    let iters: u64 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(1000);
    match cmd {
        "dec" => dec::run(seed, iters),
        "dict" => comp::run_dict(seed, iters, args.get(4).and_then(|s| s.parse().ok()).unwrap_or(1 << 18)),
        "mt" => comp::run_mt(seed, iters, args.get(4).and_then(|s| s.parse().ok()).unwrap_or(8 << 20)),
        "comp" => comp::run(seed, iters, args.get(4).and_then(|s| s.parse().ok()).unwrap_or(1 << 20)),
        _ => eprintln!("usage: zstd_harness dec <seed> <iters>"),
    }
}
