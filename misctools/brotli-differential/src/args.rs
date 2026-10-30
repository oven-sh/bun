//! Command line arguments. A value that cannot be used ends the process: falling back to a default would test something
//! other than what was asked for.
use std::ops::Range;

fn refuse(what: String) -> ! {
    eprintln!("{what}");
    std::process::exit(2);
}

/// Decimal, or hexadecimal after `0x`.
pub fn parse(s: &str) -> u64 {
    let parsed = match s.strip_prefix("0x") {
        Some(hex) => u64::from_str_radix(hex, 16),
        None => s.parse(),
    };
    parsed.unwrap_or_else(|_| refuse(format!("not a number: {s}")))
}

/// Argument `i`, or `default` if there are not that many.
pub fn num(args: &[String], i: usize, default: u64) -> u64 {
    args.get(i).map_or(default, |s| parse(s))
}

/// Argument `i`, which has no default.
pub fn text(args: &[String], i: usize) -> &str {
    args.get(i).unwrap_or_else(|| refuse(format!("argument {i} is missing, see README.md")))
}

/// The arguments from `from` on.
pub fn rest(args: &[String], from: usize) -> &[String] {
    args.get(from..).unwrap_or_default()
}

/// The numbers from argument `from` on, at least one.
pub fn numbers(args: &[String], from: usize) -> Vec<usize> {
    text(args, from);
    rest(args, from).iter().map(|s| parse(s) as usize).collect()
}

/// `<parameter>=<value>`, both as the numbers of the C API.
pub fn params(args: &[String]) -> Vec<(i32, u32)> {
    args.iter()
        .map(|s| match s.split_once('=') {
            Some((k, v)) => (parse(k) as i32, parse(v) as u32),
            None => refuse(format!("not <parameter>=<value>: {s}")),
        })
        .collect()
}

/// The qualities whose bits are set in `mask`. A subcommand that is not for all of them says which it is for.
pub fn qualities(mask: u64, allowed: Range<u32>) -> Vec<u32> {
    let all: u64 = allowed.clone().map(|q| 1 << q).sum();
    if mask == 0 || mask & !all != 0 {
        refuse(format!("the mask of qualities {mask:#x} is empty or has bits outside of {all:#x} (qualities {} to {})", allowed.start, allowed.end - 1));
    }
    allowed.filter(|q| mask >> q & 1 != 0).collect()
}
