//! Probe: a test target without the libtest harness that links the crate, takes arguments and answers on stdout.

#[path = "../native_test_shims.rs"]
mod native_test_shims;

use std::io::{BufRead, Write};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--serve") {
        let stdin = std::io::stdin();
        let mut out = std::io::stdout().lock();
        for line in stdin.lock().lines() {
            let Ok(line) = line else { break };
            let described = tc_probe::producers::lib_files::describe(line.as_bytes(), line.len());
            let _ = writeln!(out, "{{\"echo\":{:?}}}", described);
            let _ = out.flush();
        }
        return;
    }
    let path = b"/workspace/ref/typescript-go/_submodules/TypeScript/src/lib/es5.d.ts";
    match tc_probe::producers::lib_files::read_lib_file(bun_sys::Fd::cwd(), path) {
        Ok(bytes) => println!("program: read {} bytes, arguments {:?}", bytes.len(), args),
        Err(_) => {
            println!("program: cannot read the lib file");
            std::process::exit(1);
        }
    }
}
