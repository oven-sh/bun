mod c;
mod data;
mod frames;
mod seqs;
mod stream;

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
        // frames <seed> <iters> <strategies> <0: no dictionary, 1: a prefix or none, 2: an attached CDict or none>
        "frames" => {
            let strategies: Vec<u32> = args[4].split(',').map(|s| s.parse().unwrap()).collect();
            let modes: &[frames::Mode] = match args.get(5).map(String::as_str) {
                Some("1") => &[frames::Mode::NoDict, frames::Mode::Prefix],
                Some("2") => &[frames::Mode::CDict, frames::Mode::CDict, frames::Mode::CDict, frames::Mode::NoDict],
                _ => &[frames::Mode::NoDict],
            };
            frames::run(seed, iters, &strategies, modes);
        }
        // bench <file> <windowLog,chainLog,hashLog,searchLog,minMatch,targetLength,strategy>
        "bench" => {
            let cp: Vec<u32> = args[3].split(',').map(|s| s.parse().unwrap()).collect();
            stream::bench(&args[2], cp.try_into().unwrap());
        }
        // stream <seed> <iters>
        "stream" => {
            let hook = std::panic::take_hook();
            std::panic::set_hook(Box::new(move |info| {
                eprintln!("stream seed {}", stream::CURRENT.load(std::sync::atomic::Ordering::Relaxed));
                hook(info);
            }));
            stream::run(seed, iters);
        }
        _ => eprintln!("unknown command"),
    }
}
