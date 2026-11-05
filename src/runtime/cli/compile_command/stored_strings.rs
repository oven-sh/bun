use bun_aot::engine::{has_compiler, read_stored_strings};
use bun_core::{Global, Output};
use bun_sys::Fd;

use super::print_error_and_notes;

const CANNOT_BE_READ: u32 = 2;

/// `bun build --aot-stored-strings <executable>` builds nothing. It prints the strings that the compiled images of a finished
/// executable store: to standard output each string as UTF-8 with a zero byte behind it, to standard error one line for
/// each section that holds characters. A script reads those lines.
#[cold]
#[inline(never)]
pub(crate) fn print_stored_strings_and_exit(executable: &[u8]) -> ! {
    // `bun build`, then the flag and its value as two words or as one.
    let words = bun_core::argv().len();
    let is_alone = words == 4 || (words == 3 && !executable.is_empty());
    if !is_alone {
        refuse(b"--aot-stored-strings takes a finished executable and nothing else: no entry point and no other flag");
    }
    if !has_compiler() {
        refuse(b"--aot-stored-strings needs the compiler, which this Bun does not have");
    }
    let Ok(file) = bun_sys::File::read_from(Fd::cwd(), executable) else {
        refuse(b"--aot-stored-strings: the file can't be read");
    };
    let stored = read_stored_strings(&file);
    let _ = Output::writer().write_all(&stored.strings);
    let _ = Output::error_writer().write_all(&stored.report);
    Output::flush();
    Global::exit(stored.verdict)
}

fn refuse(message: &[u8]) -> ! {
    print_error_and_notes(message);
    Global::exit(CANNOT_BE_READ)
}
