mod c;
mod data;
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
            // 0: no dictionary, 1: a prefix or none, 2: an attached CDict or none
            let modes: &[seqs::Mode] = match args.get(5).map(String::as_str) {
                Some("1") => &[seqs::Mode::NoDict, seqs::Mode::Prefix],
                Some("3") => &[seqs::Mode::CDict, seqs::Mode::Prefix, seqs::Mode::NoDict],
                Some("2") => &[seqs::Mode::CDict, seqs::Mode::CDict, seqs::Mode::CDict, seqs::Mode::NoDict],
                _ => &[seqs::Mode::NoDict],
            };
            seqs::run(seed, iters, &strategies, modes, args.get(6).is_some_and(|s| s == "x"));
        }
        _ => eprintln!("unknown command"),
    }
}
