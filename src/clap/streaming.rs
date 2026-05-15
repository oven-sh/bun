use core::sync::atomic::{AtomicBool, Ordering};

use bun_core::Output;

use crate as clap;
use crate::args;
use crate::args::ArgIter;

// Disabled because not all CLI arguments are parsed with Clap.
// TODO(port): Zig `pub var` — using AtomicBool for safe mutable global.
pub static WARN_ON_UNRECOGNIZED_FLAG: AtomicBool = AtomicBool::new(false);

/// The result returned from StreamingClap.next
pub struct Arg<'p, 'a, Id> {
    pub param: &'p clap::Param<Id>,
    pub value: Option<&'a [u8]>,
}

#[derive(Copy, Clone)]
pub struct Chaining<'a> {
    pub arg: &'a [u8],
    pub index: usize,
}

pub enum State<'a> {
    Normal,
    Chaining(Chaining<'a>),
    RestArePositional,
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Copy, Clone, PartialEq, Eq)]
pub enum ArgError {
    #[error("DoesntTakeValue")]
    DoesntTakeValue,
    #[error("MissingValue")]
    MissingValue,
    #[error("InvalidArgument")]
    InvalidArgument,
}

bun_core::named_error_set!(ArgError);

#[derive(Copy, Clone, PartialEq, Eq)]
enum ArgKind {
    Long,
    Short,
    Positional,
}

struct ArgInfo<'a> {
    arg: &'a [u8],
    kind: ArgKind,
}

/// A command line argument parser which, given an ArgIterator, will parse arguments according
/// to the params. StreamingClap parses in an iterating manner, so you have to use a loop together with
/// StreamingClap.next to parse all the arguments of your program.
///
/// `'p` is the borrow lifetime (params/iter/diagnostic); `'a` is the arg-data lifetime
/// yielded by `ArgIterator` (e.g. `'static` for `OsIterator`). Splitting them lets
/// callers use a locally-borrowed param table with process-lifetime argv.
pub struct StreamingClap<'p, 'a, Id, ArgIterator> {
    pub params: &'p [clap::Param<Id>],
    pub iter: &'p mut ArgIterator,
    pub state: State<'a>,
    pub positional: Option<&'p clap::Param<Id>>,
    pub diagnostic: Option<&'p mut clap::Diagnostic>,
}

// PORT NOTE: ArgIterator was a comptime duck-typed param in Zig; expressed here as
// the `args::ArgIter<'a>` trait so `next()`/`remain()` resolve.
impl<'p, 'a, Id, ArgIterator> StreamingClap<'p, 'a, Id, ArgIterator>
where
    ArgIterator: ArgIter<'a>,
{
    /// Get the next Arg that matches a Param.
    pub fn next(&mut self) -> Result<Option<Arg<'p, 'a, Id>>, ArgError> {
        match self.state {
            State::Normal => self.normal(),
            State::Chaining(state) => self.chainging(state),
            State::RestArePositional => {
                let param = self.positional_param().unwrap_or_else(|| unreachable!());
                let Some(value) = self.iter.next() else {
                    return Ok(None);
                };
                Ok(Some(Arg {
                    param,
                    value: Some(value),
                }))
            }
        }
    }

    fn normal(&mut self) -> Result<Option<Arg<'p, 'a, Id>>, ArgError> {
        let Some(arg_info) = self.parse_next_arg()? else {
            return Ok(None);
        };
        let arg = arg_info.arg;

        match arg_info.kind {
            ArgKind::Long => {
                let eql_index = arg.iter().position(|&b| b == b'=');
                let name: &[u8] = if let Some(i) = eql_index {
                    &arg[0..i]
                } else {
                    arg
                };

                let maybe_value: Option<&[u8]> = if let Some(i) = eql_index {
                    Some(&arg[i + 1..])
                } else {
                    None
                };

                // PORT NOTE: reshaped for borrowck — copy slice ref so &mut self is free inside loop.
                let params = self.params;
                for param in params {
                    if !param.names.matches_long(name) {
                        continue;
                    }

                    if param.takes_value == clap::Values::None
                        || param.takes_value == clap::Values::OneOptional
                    {
                        if param.takes_value == clap::Values::None && maybe_value.is_some() {
                            return Err(self.err(arg, None, Some(name), ArgError::DoesntTakeValue));
                        }

                        return Ok(Some(Arg {
                            param,
                            value: maybe_value,
                        }));
                    }

                    let value = 'blk: {
                        if let Some(v) = maybe_value {
                            break 'blk v;
                        }

                        break 'blk match self.iter.next() {
                            Some(v) => v,
                            None => {
                                return Err(self.err(
                                    arg,
                                    None,
                                    Some(name),
                                    ArgError::MissingValue,
                                ));
                            }
                        };
                    };

                    return Ok(Some(Arg {
                        param,
                        value: Some(value),
                    }));
                }

                // unrecognized command
                // if flag else arg
                if arg_info.kind == ArgKind::Long || arg_info.kind == ArgKind::Short {
                    if WARN_ON_UNRECOGNIZED_FLAG.load(Ordering::Relaxed) {
                        Output::warn(&format_args!(
                            "unrecognized flag: {}{}\n",
                            if arg_info.kind == ArgKind::Long {
                                "--"
                            } else {
                                "-"
                            },
                            bstr::BStr::new(name),
                        ));
                        Output::flush();
                    }

                    // continue parsing after unrecognized flag
                    return self.next();
                }

                if WARN_ON_UNRECOGNIZED_FLAG.load(Ordering::Relaxed) {
                    Output::warn(&format_args!(
                        "unrecognized argument: {}\n",
                        bstr::BStr::new(name)
                    ));
                    Output::flush();
                }
                Ok(None)
            }
            ArgKind::Short => self.chainging(Chaining { arg, index: 0 }),
            ArgKind::Positional => {
                if let Some(param) = self.positional_param() {
                    // If we find a positional with the value `--` then we
                    // interpret the rest of the arguments as positional
                    // arguments.
                    if arg == b"--" {
                        self.state = State::RestArePositional;
                        // return null to terminate arg parsing
                        let Some(value) = self.iter.next() else {
                            return Ok(None);
                        };
                        return Ok(Some(Arg {
                            param,
                            value: Some(value),
                        }));
                    }

                    Ok(Some(Arg {
                        param,
                        value: Some(arg),
                    }))
                } else {
                    Err(self.err(arg, None, None, ArgError::InvalidArgument))
                }
            }
        }
    }

    fn chainging(&mut self, state: Chaining<'a>) -> Result<Option<Arg<'p, 'a, Id>>, ArgError> {
        let arg = state.arg;
        let index = state.index;
        let next_index = index + 1;

        // PORT NOTE: reshaped for borrowck — copy slice ref so &mut self is free inside loop.
        let params = self.params;
        for param in params {
            let Some(short) = param.names.short else {
                continue;
            };
            if short != arg[index] {
                continue;
            }

            // Before we return, we have to set the new state of the clap
            // PORT NOTE: Zig `defer` hoisted — every path below returns, and nothing
            // between here and those returns reads `self.state`.
            if arg.len() <= next_index || param.takes_value != clap::Values::None {
                self.state = State::Normal;
            } else {
                self.state = State::Chaining(Chaining {
                    arg,
                    index: next_index,
                });
            }

            let next_is_eql = if next_index < arg.len() {
                arg[next_index] == b'='
            } else {
                false
            };
            if param.takes_value == clap::Values::None
                || param.takes_value == clap::Values::OneOptional
            {
                if next_is_eql && param.takes_value == clap::Values::None {
                    return Err(self.err(arg, Some(short), None, ArgError::DoesntTakeValue));
                }
                return Ok(Some(Arg { param, value: None }));
            }

            if arg.len() <= next_index {
                let value = match self.iter.next() {
                    Some(v) => v,
                    None => {
                        return Err(self.err(arg, Some(short), None, ArgError::MissingValue));
                    }
                };

                return Ok(Some(Arg {
                    param,
                    value: Some(value),
                }));
            }

            if next_is_eql {
                return Ok(Some(Arg {
                    param,
                    value: Some(&arg[next_index + 1..]),
                }));
            }

            return Ok(Some(Arg {
                param,
                value: Some(&arg[next_index..]),
            }));
        }

        Err(self.err(arg, Some(arg[index]), None, ArgError::InvalidArgument))
    }

    fn positional_param(&mut self) -> Option<&'p clap::Param<Id>> {
        if let Some(p) = self.positional {
            return Some(p);
        }

        for param in self.params {
            if param.names.long.is_some() {
                continue;
            }
            if param.names.short.is_some() {
                continue;
            }

            self.positional = Some(param);
            return Some(param);
        }

        None
    }

    fn parse_next_arg(&mut self) -> Result<Option<ArgInfo<'a>>, ArgError> {
        let Some(full_arg) = self.iter.next() else {
            return Ok(None);
        };
        if full_arg == b"--" || full_arg == b"-" {
            return Ok(Some(ArgInfo {
                arg: full_arg,
                kind: ArgKind::Positional,
            }));
        }
        if full_arg.starts_with(b"--") {
            return Ok(Some(ArgInfo {
                arg: &full_arg[2..],
                kind: ArgKind::Long,
            }));
        }
        if full_arg.starts_with(b"-") {
            return Ok(Some(ArgInfo {
                arg: &full_arg[1..],
                kind: ArgKind::Short,
            }));
        }

        Ok(Some(ArgInfo {
            arg: full_arg,
            kind: ArgKind::Positional,
        }))
    }

    fn err(&mut self, arg: &[u8], short: Option<u8>, long: Option<&[u8]>, e: ArgError) -> ArgError {
        if let Some(d) = self.diagnostic.as_deref_mut() {
            // PORT NOTE: Zig assigned borrowed `arg`/`name` slices; Rust `Diagnostic`
            // owns its bytes (error path only) — see lib.rs.
            d.arg = arg.to_vec();
            d.short = short;
            d.long = long.map(|l| l.to_vec());
        }
        e
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_no_err(
        params: &[clap::Param<u8>],
        args_strings: &[&[u8]],
        results: &[Arg<'_, '_, u8>],
    ) {
        let mut iter = args::SliceIterator {
            remain: args_strings,
        };
        let mut c = StreamingClap::<u8, args::SliceIterator> {
            params,
            iter: &mut iter,
            state: State::Normal,
            positional: None,
            diagnostic: None,
        };

        for res in results {
            let arg = c
                .next()
                .expect("unreachable")
                .unwrap_or_else(|| unreachable!());
            assert!(core::ptr::eq(res.param, arg.param));
            let Some(expected_value) = res.value else {
                assert_eq!(None::<&[u8]>, arg.value);
                continue;
            };
            let actual_value = arg.value.unwrap_or_else(|| unreachable!());
            assert_eq!(expected_value, actual_value);
        }

        if c.next().expect("unreachable").is_some() {
            unreachable!();
        }
    }

    fn test_err(params: &[clap::Param<u8>], args_strings: &[&[u8]], expected: &[u8]) {
        let mut diag = clap::Diagnostic::default();
        let mut iter = args::SliceIterator {
            remain: args_strings,
        };
        let mut c = StreamingClap::<u8, args::SliceIterator> {
            params,
            iter: &mut iter,
            state: State::Normal,
            positional: None,
            diagnostic: Some(&mut diag),
        };
        loop {
            match c.next() {
                Ok(Some(_)) => {}
                Ok(None) => break,
                Err(_err) => {
                    // TODO(port): io.fixedBufferStream + diag.report — `Diagnostic::report`
                    // currently routes through `bun_core::Output` (stderr) and ignores its
                    // writer arg, so we cannot capture output to compare against `expected`.
                    let _ = expected;
                    return;
                }
            }
        }

        assert!(false);
    }

    #[test]
    fn short_params() {
        let params: [clap::Param<u8>; 4] = [
            clap::Param {
                id: 0,
                names: clap::Names::short(b'a'),
                ..Default::default()
            },
            clap::Param {
                id: 1,
                names: clap::Names::short(b'b'),
                ..Default::default()
            },
            clap::Param {
                id: 2,
                names: clap::Names::short(b'c'),
                takes_value: clap::Values::One,
                ..Default::default()
            },
            clap::Param {
                id: 3,
                names: clap::Names::short(b'd'),
                takes_value: clap::Values::Many,
                ..Default::default()
            },
        ];

        let a = &params[0];
        let b = &params[1];
        let c = &params[2];
        let d = &params[3];

        test_no_err(
            &params,
            &[
                b"-a", b"-b", b"-ab", b"-ba", b"-c", b"0", b"-c=0", b"-ac", b"0", b"-ac=0", b"-d=0",
            ],
            &[
                Arg {
                    param: a,
                    value: None,
                },
                Arg {
                    param: b,
                    value: None,
                },
                Arg {
                    param: a,
                    value: None,
                },
                Arg {
                    param: b,
                    value: None,
                },
                Arg {
                    param: b,
                    value: None,
                },
                Arg {
                    param: a,
                    value: None,
                },
                Arg {
                    param: c,
                    value: Some(b"0"),
                },
                Arg {
                    param: c,
                    value: Some(b"0"),
                },
                Arg {
                    param: a,
                    value: None,
                },
                Arg {
                    param: c,
                    value: Some(b"0"),
                },
                Arg {
                    param: a,
                    value: None,
                },
                Arg {
                    param: c,
                    value: Some(b"0"),
                },
                Arg {
                    param: d,
                    value: Some(b"0"),
                },
            ],
        );
    }

    #[test]
    fn long_params() {
        let params: [clap::Param<u8>; 4] = [
            clap::Param {
                id: 0,
                names: clap::Names::long(b"aa"),
                ..Default::default()
            },
            clap::Param {
                id: 1,
                names: clap::Names::long(b"bb"),
                ..Default::default()
            },
            clap::Param {
                id: 2,
                names: clap::Names::long(b"cc"),
                takes_value: clap::Values::One,
                ..Default::default()
            },
            clap::Param {
                id: 3,
                names: clap::Names::long(b"dd"),
                takes_value: clap::Values::Many,
                ..Default::default()
            },
        ];

        let aa = &params[0];
        let bb = &params[1];
        let cc = &params[2];
        let dd = &params[3];

        test_no_err(
            &params,
            &[b"--aa", b"--bb", b"--cc", b"0", b"--cc=0", b"--dd=0"],
            &[
                Arg {
                    param: aa,
                    value: None,
                },
                Arg {
                    param: bb,
                    value: None,
                },
                Arg {
                    param: cc,
                    value: Some(b"0"),
                },
                Arg {
                    param: cc,
                    value: Some(b"0"),
                },
                Arg {
                    param: dd,
                    value: Some(b"0"),
                },
            ],
        );
    }

    #[test]
    fn positional_params() {
        let params: [clap::Param<u8>; 1] = [clap::Param {
            id: 0,
            takes_value: clap::Values::One,
            ..Default::default()
        }];

        test_no_err(
            &params,
            &[b"aa", b"bb"],
            &[
                Arg {
                    param: &params[0],
                    value: Some(b"aa"),
                },
                Arg {
                    param: &params[0],
                    value: Some(b"bb"),
                },
            ],
        );
    }

    #[test]
    fn all_params() {
        let params: [clap::Param<u8>; 4] = [
            clap::Param {
                id: 0,
                names: clap::Names {
                    short: Some(b'a'),
                    long: Some(b"aa"),
                    ..Default::default()
                },
                ..Default::default()
            },
            clap::Param {
                id: 1,
                names: clap::Names {
                    short: Some(b'b'),
                    long: Some(b"bb"),
                    ..Default::default()
                },
                ..Default::default()
            },
            clap::Param {
                id: 2,
                names: clap::Names {
                    short: Some(b'c'),
                    long: Some(b"cc"),
                    ..Default::default()
                },
                takes_value: clap::Values::One,
                ..Default::default()
            },
            clap::Param {
                id: 3,
                takes_value: clap::Values::One,
                ..Default::default()
            },
        ];

        let aa = &params[0];
        let bb = &params[1];
        let cc = &params[2];
        let positional = &params[3];

        test_no_err(
            &params,
            &[
                b"-a",
                b"-b",
                b"-ab",
                b"-ba",
                b"-c",
                b"0",
                b"-c=0",
                b"-ac",
                b"0",
                b"-ac=0",
                b"--aa",
                b"--bb",
                b"--cc",
                b"0",
                b"--cc=0",
                b"something",
                b"-",
                b"--",
                b"--cc=0",
                b"-a",
            ],
            &[
                Arg {
                    param: aa,
                    value: None,
                },
                Arg {
                    param: bb,
                    value: None,
                },
                Arg {
                    param: aa,
                    value: None,
                },
                Arg {
                    param: bb,
                    value: None,
                },
                Arg {
                    param: bb,
                    value: None,
                },
                Arg {
                    param: aa,
                    value: None,
                },
                Arg {
                    param: cc,
                    value: Some(b"0"),
                },
                Arg {
                    param: cc,
                    value: Some(b"0"),
                },
                Arg {
                    param: aa,
                    value: None,
                },
                Arg {
                    param: cc,
                    value: Some(b"0"),
                },
                Arg {
                    param: aa,
                    value: None,
                },
                Arg {
                    param: cc,
                    value: Some(b"0"),
                },
                Arg {
                    param: aa,
                    value: None,
                },
                Arg {
                    param: bb,
                    value: None,
                },
                Arg {
                    param: cc,
                    value: Some(b"0"),
                },
                Arg {
                    param: cc,
                    value: Some(b"0"),
                },
                Arg {
                    param: positional,
                    value: Some(b"something"),
                },
                Arg {
                    param: positional,
                    value: Some(b"-"),
                },
                Arg {
                    param: positional,
                    value: Some(b"--cc=0"),
                },
                Arg {
                    param: positional,
                    value: Some(b"-a"),
                },
            ],
        );
    }

    #[test]
    fn errors() {
        let params: [clap::Param<u8>; 2] = [
            clap::Param {
                id: 0,
                names: clap::Names {
                    short: Some(b'a'),
                    long: Some(b"aa"),
                    ..Default::default()
                },
                ..Default::default()
            },
            clap::Param {
                id: 1,
                names: clap::Names {
                    short: Some(b'c'),
                    long: Some(b"cc"),
                    ..Default::default()
                },
                takes_value: clap::Values::One,
                ..Default::default()
            },
        ];
        test_err(&params, &[b"q"], b"Invalid argument 'q'\n");
        test_err(&params, &[b"-q"], b"Invalid argument '-q'\n");
        test_err(&params, &[b"--q"], b"Invalid argument '--q'\n");
        test_err(&params, &[b"--q=1"], b"Invalid argument '--q'\n");
        test_err(
            &params,
            &[b"-a=1"],
            b"The argument '-a' does not take a value\n",
        );
        test_err(
            &params,
            &[b"--aa=1"],
            b"The argument '--aa' does not take a value\n",
        );
        test_err(
            &params,
            &[b"-c"],
            b"The argument '-c' requires a value but none was supplied\n",
        );
        test_err(
            &params,
            &[b"--cc"],
            b"The argument '--cc' requires a value but none was supplied\n",
        );
    }
}

// ported from: src/clap/streaming.zig
