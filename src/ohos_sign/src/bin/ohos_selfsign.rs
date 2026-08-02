use std::path::Path;
use std::process::ExitCode;

fn usage(prog: &str) -> ! {
    eprintln!(
        "Usage:\n  {prog} sign  <input> [--output <out>] [--force]\n  {prog} check <input>\n  {prog} strip <input> [--output <out>]"
    );
    std::process::exit(1);
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let prog = args.first().map(|s| s.as_str()).unwrap_or("ohos-selfsign");
    if args.len() < 3 {
        usage(prog);
    }
    match args[1].as_str() {
        "sign" => cmd_sign(&args[2..], prog),
        "check" => cmd_check(&args[2..]),
        "strip" => cmd_strip(&args[2..], prog),
        _ => usage(prog),
    }
}

fn cmd_sign(args: &[String], prog: &str) -> ExitCode {
    if args.is_empty() {
        usage(prog);
    }
    let input = Path::new(&args[0]);
    let mut output: Option<&Path> = None;
    let mut force = false;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--output" | "-o" => {
                i += 1;
                output = args.get(i).map(|s| Path::new(s.as_str()));
            }
            "--force" | "-f" => force = true,
            _ => {}
        }
        i += 1;
    }
    let out = output.unwrap_or(input);
    let bytes = match std::fs::read(input) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("ohos-selfsign: read {}: {e}", input.display());
            return ExitCode::FAILURE;
        }
    };
    let signed = if force {
        ohos_sign::sign_selfsign_with_strip(&bytes)
    } else {
        ohos_sign::sign_selfsign(&bytes)
    };
    match signed {
        Ok(data) => {
            if let Err(e) = std::fs::write(out, &data) {
                eprintln!("ohos-selfsign: write {}: {e}", out.display());
                return ExitCode::FAILURE;
            }
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("ohos-selfsign: sign {}: {e}", input.display());
            ExitCode::FAILURE
        }
    }
}

fn cmd_check(args: &[String]) -> ExitCode {
    let Some(input) = args.first() else {
        eprintln!("ohos-selfsign: check requires <input>");
        return ExitCode::FAILURE;
    };
    let bytes = match std::fs::read(input) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("ohos-selfsign: read {input}: {e}");
            return ExitCode::FAILURE;
        }
    };
    if ohos_sign::has_codesign(&bytes) {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

fn cmd_strip(args: &[String], prog: &str) -> ExitCode {
    if args.is_empty() {
        usage(prog);
    }
    let input = Path::new(&args[0]);
    let output = args.get(2).map(|s| Path::new(s.as_str())).unwrap_or(input);
    let mut bytes = match std::fs::read(input) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("ohos-selfsign: read {}: {e}", input.display());
            return ExitCode::FAILURE;
        }
    };
    match ohos_sign::strip_codesign(&mut bytes) {
        Ok(_) => {
            if let Err(e) = std::fs::write(output, &bytes) {
                eprintln!("ohos-selfsign: write {}: {e}", output.display());
                return ExitCode::FAILURE;
            }
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("ohos-selfsign: strip {}: {e}", input.display());
            ExitCode::FAILURE
        }
    }
}
