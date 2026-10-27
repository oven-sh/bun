mod c;
mod data;
mod ldm;
mod seqs;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let cmd = args.get(1).map(String::as_str).unwrap_or("");
    let seed: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(1);
    let iters: u64 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(1000);
    match cmd {
        // seqs <seed> <iters> <strategies, e.g. 1,2> <dict: 0 or 1>
        "seqs" => {
            let strategies: Vec<u32> = args[4].split(',').map(|s| s.parse().unwrap()).collect();
            seqs::run(seed, iters, &strategies, args.get(5).is_some_and(|s| s == "1"));
        }
        "presplit" => ldm::presplit(seed, iters),
        "ldmparams" => ldm::params(seed, iters),
        "ldmskip" => ldm::skip(seed, iters),
        // ldm <seed> <iters> <max length>
        "ldm" => ldm::run(seed, iters, args.get(4).and_then(|s| s.parse().ok()).unwrap_or(4 << 20)),
        // ldmblocks <seed> <iters> <strategies> <max length>
        "ldmblocks" => {
            let strategies: Vec<u32> = args[4].split(',').map(|s| s.parse().unwrap()).collect();
            ldm::blocks(seed, iters, &strategies, args.get(5).and_then(|s| s.parse().ok()).unwrap_or(1 << 20));
        }
        "ldmbench" => ldm::bench(seed as usize),
        _ => eprintln!("unknown command"),
    }
}
