//! One script after another, each on a new `Vm`, for a program at the other end of a pipe.

use std::fs::{File, OpenOptions};
use std::io::{BufRead, Read, Seek, Write};

use crate::command_line::{CommandLine, Script};
use crate::{edge_counters, run};

/// Its length in decimal digits, a line feed, and that many bytes.
fn read_script() -> Option<Vec<u8>> {
    let mut input = std::io::stdin().lock();
    let mut line = String::new();
    input.read_line(&mut line).ok()?;
    let mut bytes = vec![0; line.trim().parse().ok()?];
    input.read_exact(&mut bytes).ok()?;
    Some(bytes)
}

fn open(path: &str, options: &OpenOptions) -> File {
    options.open(path).unwrap_or_else(|_| {
        eprintln!("Could not open file: {path}");
        run::exit(1)
    })
}

/// Until the input ends.
pub(crate) fn serve(command_line: &CommandLine, exit_codes: &str) {
    let mut exit_codes = open(exit_codes, File::options().append(true));
    let mut counters = (command_line.edge_counters_path.as_deref())
        .map(|path| open(path, File::options().write(true)));
    while let Some(bytes) = read_script() {
        let mut command_line = command_line.clone();
        command_line.destroys_vm = true;
        for script in &mut command_line.scripts {
            if let Script::Piped(text) = script {
                text.clone_from(&bytes);
            }
        }
        let code = run::run(&command_line, |cx| run::run_scripts(cx, &command_line));
        let _ = std::io::stdout().flush();
        if let Some(file) = &mut counters {
            let _ = file.rewind();
            let _ = file.write_all(&edge_counters::take());
        }
        let _ = exit_codes.write_all(format!("{code}\n").as_bytes());
    }
}
