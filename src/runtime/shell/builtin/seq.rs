use std::io::Write as _;

use crate::shell::builtin::{Arg, Builtin, IoKind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::yield_::Yield;

const USAGE: &[u8] = b"usage: seq [-w] [-f format] [-s string] [-t string] [first [incr]] last\n";

pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
    let fail = |message: &str| Builtin::fail(interp, cmd, format_args!("{message}\n"));
    let mut args = Builtin::of(interp, cmd).args();
    let mut separator: &[u8] = b"\n";
    let mut terminator: &[u8] = b"";
    while let [flag, rest @ ..] = args {
        args = match (flag.get(), rest) {
            (b"-s" | b"--separator", []) => return fail("option requires an argument -- s"),
            (b"-t" | b"--terminator", []) => return fail("option requires an argument -- t"),
            (b"-s" | b"--separator", [value, rest @ ..]) => {
                separator = value;
                rest
            }
            (b"-t" | b"--terminator", [value, rest @ ..]) => {
                terminator = value;
                rest
            }
            ([b'-', b's', value @ ..], _) => {
                separator = value;
                rest
            }
            ([b'-', b't', value @ ..], _) => {
                terminator = value;
                rest
            }
            (b"-w" | b"--fixed-width", _) => rest,
            _ => break,
        };
    }

    if args.is_empty() {
        return Builtin::fail_usage(interp, cmd, USAGE);
    }
    let parse = |arg: &Arg| bun_core::fmt::parse_f32(arg).filter(|n| n.is_finite());
    let mut numbers = [0.0; 3];
    for (number, arg) in numbers.iter_mut().zip(args) {
        let Some(parsed) = parse(arg) else {
            return fail("invalid argument");
        };
        *number = parsed;
    }
    let towards = |start: f32, end: f32| (start, if start > end { -1.0 } else { 1.0 }, end);
    let (start, incr, end) = match (args.len(), numbers) {
        (1, [end, ..]) => towards(1.0, end),
        (2, [start, end, _]) => towards(start, end),
        (_, [start, incr, end]) => (start, incr, end),
    };
    if incr == 0.0 {
        return fail("zero increment");
    }
    if start > end && incr > 0.0 {
        return fail("needs negative decrement");
    }
    if start < end && incr < 0.0 {
        return fail("needs positive increment");
    }

    let mut out = Vec::new();
    let mut current = start;
    while if incr > 0.0 {
        current <= end
    } else {
        current >= end
    } {
        // The shortest decimal that round-trips, with no exponent and no trailing ".0".
        let _ = write!(&mut out, "{}", current);
        out.extend_from_slice(separator);
        let next = current + incr;
        // f32 stops counting: `seq 1 99999999` saturates at 2^24.
        if next == current {
            break;
        }
        current = next;
    }
    out.extend_from_slice(terminator);
    Builtin::finish(interp, cmd, IoKind::Stdout, &out, 0)
}
