use crate::shell::builtin::{Builtin, IoKind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::yield_::Yield;

pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
    let mut args = Builtin::of(interp, cmd).args();
    let mut newline = true;
    let mut escape_sequences = false;
    // An argument with any other character in it is text.
    while let [arg, rest @ ..] = args
        && let [b'-', flags @ ..] = arg.get()
        && !flags.is_empty()
        && flags.iter().all(|c| matches!(c, b'n' | b'e' | b'E'))
    {
        for c in flags {
            match c {
                b'n' => newline = false,
                _ => escape_sequences = *c == b'e',
            }
        }
        args = rest;
    }

    let mut out = Vec::new();
    for (i, arg) in args.iter().enumerate() {
        if i > 0 {
            out.push(b' ');
        }
        if escape_sequences {
            if append_with_escapes(&mut out, arg) {
                newline = false;
                break;
            }
        } else if i + 1 == args.len() {
            // Collapse a trailing run of '\n'.
            newline &= !arg.ends_with(b"\n");
            out.extend_from_slice(bun_core::strings::trim_subsequent_leading_chars(arg, b'\n'));
        } else {
            out.extend_from_slice(arg);
        }
    }
    if newline {
        out.push(b'\n');
    }
    Builtin::finish(interp, cmd, IoKind::Stdout, &out, 0)
}

/// Appends `input` to `output`, interpreting backslash escape sequences.
/// Returns true if a `\c` escape was encountered (meaning stop all output).
fn append_with_escapes(output: &mut Vec<u8>, mut input: &[u8]) -> bool {
    while let [byte, rest @ ..] = input {
        input = rest;
        let (b'\\', [escape, rest @ ..]) = (byte, rest) else {
            output.push(*byte);
            continue;
        };
        input = rest;
        let byte = match escape {
            b'c' => return true,
            b'\\' => b'\\',
            b'a' => 0x07,
            b'b' => 0x08,
            b'e' | b'E' => 0x1b,
            b'f' => 0x0c,
            b'n' => b'\n',
            b'r' => b'\r',
            b't' => b'\t',
            b'v' => 0x0b,
            // \0nnn
            b'0' => {
                let digits = rest.iter().take(3).take_while(|c| matches!(c, b'0'..=b'7'));
                let (digits, rest) = rest.split_at(digits.count());
                input = rest;
                let octal = |val: u8, c| val.wrapping_mul(8).wrapping_add(c - b'0');
                digits.iter().fold(0, octal)
            }
            // \xHH
            b'x' if rest.first().is_some_and(u8::is_ascii_hexdigit) => {
                let (val, n) = bun_core::fmt::parse_hex_prefix(rest, 2);
                input = &rest[n..];
                val as u8
            }
            &other => {
                output.push(b'\\');
                other
            }
        };
        output.push(byte);
    }
    false
}
