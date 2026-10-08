//! Reads a command line as optionator, which ESLint uses, reads it. The flags are a table of
//! `bun_clap`, which also prints the help.

use bun_clap as clap;
use bun_core::strings;

pub type Param = clap::Param<clap::Help>;

/// Why the command line cannot be used: a line for the user. The exit code is 2, as ESLint's.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct UsageError(pub Vec<u8>);

pub(crate) fn error<T>(parts: &[&[u8]]) -> Result<T, UsageError> {
    Err(UsageError(parts.concat()))
}

/// A part of the command line.
pub(crate) enum Argument<'a> {
    Flag {
        /// The long name in the table.
        name: &'static [u8],
        /// `None` for a flag that takes none.
        value: Option<&'a [u8]>,
        /// It is not written `--no-..`, or `--..=false`.
        is_on: bool,
    },
    Positional(&'a [u8]),
}

/// How many single-character edits turn `a` into `b`.
fn distance(a: &[u8], b: &[u8]) -> usize {
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, x) in a.iter().enumerate() {
        let mut diagonal = row[0];
        row[0] = i + 1;
        for (j, y) in b.iter().enumerate() {
            let substituted = diagonal + usize::from(x != y);
            diagonal = row[j + 1];
            row[j + 1] = substituted.min(row[j] + 1).min(diagonal + 1);
        }
    }
    row[b.len()]
}

/// Calls `take` with each part of `args`, in order.
pub(crate) fn parse<'a>(
    params: &'static [Param],
    args: &[&'a [u8]],
    take: &mut dyn FnMut(Argument<'a>) -> Result<(), UsageError>,
) -> Result<(), UsageError> {
    let find_long = |name: &[u8]| {
        params.iter().find(|param| {
            param.names.long == Some(name) || param.names.long_aliases.contains(&name)
        })
    };
    let find_short = |name: u8| params.iter().find(|param| param.names.short == Some(name));
    let unknown = |written: &[u8], name: &[u8]| {
        let closest = (params.iter().filter_map(|param| param.names.long))
            .min_by_key(|long| distance(name, long));
        match closest {
            Some(closest) => error(&[
                b"Invalid option '",
                written,
                b"' - perhaps you meant '--",
                closest,
                b"'?",
            ]),
            None => error(&[b"Invalid option '", written, b"'."]),
        }
    };
    // The flag that the next argument is the value of.
    let mut awaited: Option<&'static Param> = None;
    let name_of = |param: &'static Param| param.names.long.unwrap_or_default();
    let is_flag = |param: &Param| param.takes_value == clap::Values::None;
    let boolean = |name: &[u8], value: &[u8]| match value {
        b"true" => Ok(true),
        b"false" => Ok(false),
        _ => error(&[
            b"Invalid value for option '",
            name,
            b"' - expected type Boolean, received value: ",
            value,
            b".",
        ]),
    };
    let flag = |param: &'static Param, value: Option<&'a [u8]>, is_on: bool| Argument::Flag {
        name: name_of(param),
        value,
        is_on,
    };
    let mut rest_is_positional = Vec::new();
    let mut args = args.iter().copied();
    while let Some(arg) = args.next() {
        if arg == b"--" {
            rest_is_positional.extend(args.by_ref());
            break;
        }
        // `/^(--?)([a-zA-Z][-a-zA-Z0-9]*)(=)?(.*)?$/`
        let dashes = arg.iter().take_while(|byte| **byte == b'-').count().min(2);
        let rest = &arg[dashes..];
        let name_len = rest
            .iter()
            .take_while(|byte| byte.is_ascii_alphanumeric() || **byte == b'-')
            .count();
        if dashes > 0 && rest.first().is_some_and(u8::is_ascii_alphabetic) {
            if let Some(param) = awaited {
                return error(&[
                    b"Value for '",
                    name_of(param),
                    b"' of type '",
                    param.id.value,
                    b"' required.",
                ]);
            }
            let (name, value) = (&rest[..name_len], rest[name_len..].strip_prefix(b"="));
            if dashes == 1 {
                for (at, short) in name.iter().enumerate() {
                    let Some(param) = find_short(*short) else {
                        return unknown(&[b'-', *short], &name[at..=at]);
                    };
                    match (at + 1 == name.len(), is_flag(param), value) {
                        (true, true, Some(value)) => {
                            take(flag(param, None, boolean(name_of(param), value)?))?
                        }
                        (true, false, Some(value)) => take(flag(param, Some(value), true))?,
                        (true, false, None) => awaited = Some(param),
                        (_, true, _) => take(flag(param, None, true))?,
                        (false, false, _) => {
                            return error(&[
                                b"Can't set argument '",
                                &name[at..=at],
                                b"' when not last flag in a group of short flags.",
                            ]);
                        }
                    }
                }
                continue;
            }
            let (positive, is_negated) = match name.strip_prefix(b"no-") {
                Some(positive) if !positive.is_empty() => (positive, true),
                _ => (name, false),
            };
            let Some(param) = find_long(positive) else {
                return unknown(&[b"--", positive].concat(), positive);
            };
            match (is_flag(param), value) {
                (true, Some(value)) => {
                    take(flag(param, None, boolean(positive, value)? != is_negated))?
                }
                (true, None) => take(flag(param, None, !is_negated))?,
                (false, _) if is_negated => {
                    return error(&[
                        b"Only use 'no-' prefix for Boolean options, not with '",
                        positive,
                        b"'.",
                    ]);
                }
                (false, Some(value)) => take(flag(param, Some(value), true))?,
                (false, None) => awaited = Some(param),
            }
        } else if let [b'-', number @ ..] = arg
            && number.first().is_some_and(u8::is_ascii_digit)
            && number.last().is_some_and(u8::is_ascii_digit)
            && number
                .iter()
                .all(|byte| byte.is_ascii_digit() || *byte == b'.')
            && strings::count_char(number, b'.') <= 1
        {
            return error(&[b"No -NUM option defined."]);
        } else if let Some(param) = awaited.take() {
            take(flag(param, Some(arg), true))?;
        } else {
            take(Argument::Positional(arg))?;
        }
    }
    if let Some(param) = awaited {
        return error(&[
            b"Value for '",
            name_of(param),
            b"' of type '",
            param.id.value,
            b"' required.",
        ]);
    }
    rest_is_positional
        .into_iter()
        .try_for_each(|arg| take(Argument::Positional(arg)))
}
