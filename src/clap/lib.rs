use core::fmt;

use bun_core::Output;
use bun_core::{self, err};

pub mod args;
pub use crate::comptime::ComptimeClap;
pub use crate::streaming::StreamingClap;

/// The names a `Param` can have.
#[derive(Clone, Copy)]
pub struct Names {
    /// '-' prefix
    pub short: Option<u8>,

    /// '--' prefix (primary name, used for display/help)
    pub long: Option<&'static [u8]>,

    /// Additional '--' prefixed aliases (e.g., --grep as alias for --test-name-pattern)
    pub long_aliases: &'static [&'static [u8]],
}

impl Default for Names {
    fn default() -> Self {
        Self { short: None, long: None, long_aliases: &[] }
    }
}

impl Names {
    /// Check if the given name matches the primary long name or any alias
    pub fn matches_long(&self, name: &[u8]) -> bool {
        if let Some(l) = self.long {
            if name == l {
                return true;
            }
        }
        for alias in self.long_aliases {
            if name == *alias {
                return true;
            }
        }
        false
    }
}

/// Whether a param takes no value (a flag), one value, or can be specified multiple times.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum Values {
    #[default]
    None,
    One,
    Many,
    OneOptional,
}

/// Represents a parameter for the command line.
/// Parameters come in three kinds:
///   * Short ("-a"): Should be used for the most commonly used parameters in your program.
///     * They can take a value three different ways.
///       * "-a value"
///       * "-a=value"
///       * "-avalue"
///     * They chain if they don't take values: "-abc".
///       * The last given parameter can take a value in the same way that a single parameter can:
///         * "-abc value"
///         * "-abc=value"
///         * "-abcvalue"
///   * Long ("--long-param"): Should be used for less common parameters, or when no single
///     character can describe the paramter.
///     * They can take a value two different ways.
///       * "--long-param value"
///       * "--long-param=value"
///   * Positional: Should be used as the primary parameter of the program, like a filename or
///     an expression to parse.
///     * Positional parameters have both names.long and names.short == None.
///     * Positional parameters must take a value.
#[derive(Clone, Copy)]
pub struct Param<Id> {
    pub id: Id,
    pub names: Names,
    pub takes_value: Values,
}

impl<Id: Default> Default for Param<Id> {
    fn default() -> Self {
        // SAFETY note: Zig used `std.mem.zeroes(Id)` / `std.mem.zeroes(Names)`.
        // We require `Id: Default` instead — same effect for the `Help` payload.
        Self { id: Id::default(), names: Names::default(), takes_value: Values::None }
    }
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum ParseParamError {
    #[error("NoParamFound")]
    NoParamFound,
    #[error("InvalidShortParam")]
    InvalidShortParam,
    #[error("TrailingComma")]
    TrailingComma,
}
// TODO(port): impl From<ParseParamError> for bun_core::Error

/// Takes a string and parses it to a `Param<Help>`.
/// This is the reverse of 'help' but for at single parameter only.
/// Supports multiple long name variants separated by '/' (e.g., "--test-name-pattern/--grep").
// TODO(port): Zig calls this at comptime (`@setEvalBranchQuota`); Rust evaluates at runtime.
// Phase B may want a `const fn` or build-script to regain comptime param tables.
pub fn parse_param(line: &'static [u8]) -> Result<Param<Help>, ParseParamError> {
    let mut found_comma = false;
    // TODO(port): std.mem.tokenizeAny with `.rest()` — Rust split iterators have no `.rest()`.
    // Using a hand-rolled tokenizer that tracks the remaining slice.
    let mut it = TokenizeAny::new(line, b" \t");
    let mut param_str = it.next().ok_or(ParseParamError::NoParamFound)?;

    let short_name: Option<u8> = if !param_str.starts_with(b"--") && param_str.starts_with(b"-") {
        'blk: {
            found_comma = param_str[param_str.len() - 1] == b',';
            if found_comma {
                param_str = &param_str[0..param_str.len() - 1];
            }

            if param_str.len() != 2 {
                return Err(ParseParamError::InvalidShortParam);
            }

            let short_name = param_str[1];
            if !found_comma {
                let mut res = parse_param_rest(it.rest());
                res.names.short = Some(short_name);
                return Ok(res);
            }

            param_str = it.next().ok_or(ParseParamError::NoParamFound)?;
            break 'blk Some(short_name);
        }
    } else {
        None
    };

    if param_str.starts_with(b"--") {
        if param_str[param_str.len() - 1] == b',' {
            return Err(ParseParamError::TrailingComma);
        }
    } else if found_comma {
        return Err(ParseParamError::TrailingComma);
    } else if short_name.is_none() {
        return Ok(parse_param_rest(bun_str::strings::trim_left(line, b" \t")));
    }

    let mut res = parse_param_rest(it.rest());
    res.names.short = short_name;

    // Parse long names - supports multiple variants separated by '/'
    // e.g., "--test-name-pattern/--grep" becomes primary "test-name-pattern" with alias "grep"
    let long_names = parse_long_names(param_str);
    res.names.long = long_names.long;
    res.names.long_aliases = long_names.long_aliases;
    Ok(res)
}

fn parse_long_names(param_str: &'static [u8]) -> Names {
    // TODO(port): Zig evaluates this entire body at `comptime` and materializes
    // `aliases` as a comptime-known `[N][]const u8`. Rust cannot allocate a
    // statically-sized array from a runtime count, so we leak a boxed slice for
    // the alias list. Phase B should replace this with a const-eval / build-time
    // table so no runtime allocation occurs.

    // Count how many long name variants we have (separated by '/')
    let mut alias_count: usize = 0;
    for &c in param_str {
        if c == b'/' {
            alias_count += 1;
        }
    }

    if alias_count == 0 {
        // No aliases, just the primary name
        if param_str.starts_with(b"--") {
            return Names { long: Some(&param_str[2..]), long_aliases: &[], ..Default::default() };
        }
        return Names { long: None, long_aliases: &[], ..Default::default() };
    }

    // Parse multiple long names
    // First pass: find the primary name
    let mut primary: Option<&'static [u8]> = None;
    let mut name_it = param_str.split(|&b| b == b'/');
    while let Some(name_part) = name_it.next() {
        if !name_part.starts_with(b"--") {
            continue;
        }
        primary = Some(&name_part[2..]);
        break;
    }

    // Second pass: collect aliases
    let aliases: &'static [&'static [u8]] = 'blk: {
        let mut result: Vec<&'static [u8]> = Vec::with_capacity(alias_count);
        let mut it = param_str.split(|&b| b == b'/');
        let mut is_first = true;
        while let Some(name_part) = it.next() {
            if !name_part.starts_with(b"--") {
                continue;
            }
            if is_first {
                is_first = false;
                continue; // Skip primary
            }
            result.push(&name_part[2..]);
        }
        // PERF(port): Zig built this as a comptime array (zero runtime cost).
        // Leaking here is acceptable because param tables are program-lifetime,
        // but Phase B should make this a true `&'static`.
        break 'blk Box::leak(result.into_boxed_slice());
    };

    Names { long: primary, long_aliases: aliases, ..Default::default() }
}

fn parse_param_rest(line: &'static [u8]) -> Param<Help> {
    'blk: {
        if !line.starts_with(b"<") {
            break 'blk;
        }
        let Some(len) = line.iter().position(|&b| b == b'>') else {
            break 'blk;
        };
        let takes_many = line[len + 1..].starts_with(b"...");
        let takes_one_optional = line[len + 1..].starts_with(b"?");
        let help_start =
            len + 1 + 3usize * (takes_many as usize) + 1usize * (takes_one_optional as usize);
        return Param {
            takes_value: if takes_many {
                Values::Many
            } else if takes_one_optional {
                Values::OneOptional
            } else {
                Values::One
            },
            id: Help {
                msg: bun_str::strings::trim(&line[help_start..], b" \t"),
                value: &line[1..len],
            },
            ..Default::default()
        };
    }

    Param {
        id: Help { msg: bun_str::strings::trim(line, b" \t"), ..Default::default() },
        ..Default::default()
    }
}

#[cfg(test)]
fn expect_param(expect: Param<Help>, actual: Param<Help>) {
    assert_eq!(expect.id.msg, actual.id.msg);
    assert_eq!(expect.id.value, actual.id.value);
    assert_eq!(expect.names.short, actual.names.short);
    assert_eq!(expect.takes_value, actual.takes_value);
    if let Some(long) = expect.names.long {
        assert_eq!(long, actual.names.long.unwrap());
    } else {
        assert_eq!(None::<&[u8]>, actual.names.long);
    }
}

/// Optional diagnostics used for reporting useful errors
pub struct Diagnostic {
    // TODO(port): lifetime — `arg` borrows from the arg iterator (set in streaming.zig).
    // Using `&'static [u8]` because OS args live for the program lifetime in practice.
    pub arg: &'static [u8],
    pub name: Names,
}

impl Default for Diagnostic {
    fn default() -> Self {
        Self { arg: b"", name: Names::default() }
    }
}

impl Diagnostic {
    /// Default diagnostics reporter when all you want is English with no colors.
    /// Use this as a reference for implementing your own if needed.
    pub fn report<W>(&self, _stream: W, err: bun_core::Error) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let mut name_buf = [0u8; 1024];
        let name: &[u8] = if let Some(s) = self.name.short {
            name_buf[0] = b'-';
            name_buf[1] = s;
            name_buf[2] = 0;
            &name_buf[0..2]
        } else if let Some(l) = self.name.long {
            name_buf[0] = b'-';
            name_buf[1] = b'-';
            let long = &l[0..l.len().min(name_buf.len() - 2)];
            name_buf[2..][0..long.len()].copy_from_slice(long);
            &name_buf[0..2 + long.len()]
        } else {
            self.arg
        };

        let name = bstr::BStr::new(name);
        if err == err!("DoesntTakeValue") {
            Output::pretty_errorln(format_args!(
                "<red>error<r><d>:<r> The argument '{}' does not take a value.",
                name
            ));
        } else if err == err!("MissingValue") {
            Output::pretty_errorln(format_args!(
                "<red>error<r><d>:<r> The argument '{}' requires a value but none was supplied.",
                name
            ));
        } else if err == err!("InvalidArgument") {
            Output::pretty_errorln(format_args!(
                "<red>error<r><d>:<r> Invalid Argument '{}'",
                name
            ));
        } else {
            Output::pretty_errorln(format_args!(
                "<red>error<r><d>:<r> {} while parsing argument '{}'",
                err.name(),
                name
            ));
        }
        Output::flush();
        Ok(())
    }
}

#[cfg(test)]
fn test_diag(diag: Diagnostic, err: bun_core::Error, expected: &[u8]) {
    // TODO(port): std.io.fixedBufferStream — Diagnostic.report ignores the writer
    // and goes through Output, so this helper cannot capture output the same way.
    let mut buf = [0u8; 1024];
    let _ = &mut buf;
    diag.report((), err).expect("unreachable");
    let _ = expected;
    // TODO(port): assert against captured Output
}

// TODO(port): `comptime params: []const Param(Id)` as a type parameter has no
// stable-Rust equivalent. `&'static [Param<Id>]` as a const generic requires
// `feature(adt_const_params)`. Phase B will likely turn `ComptimeClap` into a
// macro-generated type per param table; this struct mirrors the Zig shape only.
pub struct Args<Id: 'static, const PARAMS: &'static [Param<Id>]> {
    // PORT NOTE: Zig stored `arena: bun.ArenaAllocator` here and `deinit` freed it.
    // Non-AST crate → arena removed; `ComptimeClap` must own its allocations.
    // PERF(port): was arena bulk-free — profile in Phase B
    pub clap: ComptimeClap<Id, PARAMS>,
    pub exe_arg: Option<&'static [u8]>,
}

impl<Id: 'static, const PARAMS: &'static [Param<Id>]> Args<Id, PARAMS> {
    pub fn flag(&self, name: &'static [u8]) -> bool {
        self.clap.flag(name)
    }

    pub fn option(&self, name: &'static [u8]) -> Option<&[u8]> {
        self.clap.option(name)
    }

    pub fn options(&self, name: &'static [u8]) -> &[&[u8]] {
        self.clap.options(name)
    }

    pub fn positionals(&self) -> &[&[u8]] {
        self.clap.positionals()
    }

    pub fn remaining(&self) -> &[&[u8]] {
        self.clap.remaining()
    }

    pub fn has_flag(name: &'static [u8]) -> bool {
        ComptimeClap::<Id, PARAMS>::has_flag(name)
    }
}

/// Options that can be set to customize the behavior of parsing.
pub struct ParseOptions<'a> {
    // PORT NOTE: `allocator: mem.Allocator` field deleted — non-AST crate uses
    // the global mimalloc. The Zig doc-comment about `parse` vs `parseEx`
    // allocator wrapping no longer applies.
    pub diagnostic: Option<&'a mut Diagnostic>,
    pub stop_after_positional_at: usize,
}

impl<'a> Default for ParseOptions<'a> {
    fn default() -> Self {
        Self { diagnostic: None, stop_after_positional_at: 0 }
    }
}

/// Same as `parse_ex` but uses the `args::OsIterator` by default.
pub fn parse<Id: 'static, const PARAMS: &'static [Param<Id>]>(
    opt: ParseOptions<'_>,
) -> Result<Args<Id, PARAMS>, bun_core::Error> {
    // TODO(port): narrow error set
    let mut iter = args::OsIterator::init();
    let exe_arg = iter.exe_arg;

    // PORT NOTE: Zig reused `iter.arena` as the allocator for `parseEx` and
    // moved it into `res.arena`. Arena removed in port; ownership flows through
    // `ComptimeClap` directly.
    let clap = parse_ex::<Id, PARAMS, _>(
        &mut iter,
        ParseOptions {
            diagnostic: opt.diagnostic,
            stop_after_positional_at: opt.stop_after_positional_at,
        },
    )?;
    Ok(Args { clap, exe_arg })
}

/// Parses the command line arguments passed into the program based on an
/// array of `Param`s.
pub fn parse_ex<Id: 'static, const PARAMS: &'static [Param<Id>], I>(
    iter: &mut I,
    opt: ParseOptions<'_>,
) -> Result<ComptimeClap<Id, PARAMS>, bun_core::Error> {
    // TODO(port): narrow error set
    ComptimeClap::<Id, PARAMS>::parse(iter, opt)
}

/// Will print a help message in the following format:
///     -s, --long <valueText> helpText
///     -s,                    helpText
///     -s <valueText>         helpText
///         --long             helpText
///         --long <valueText> helpText
pub fn help_full<W, Id, E, C>(
    stream: &mut W,
    params: &[Param<Id>],
    context: &C,
    help_text: fn(&C, &Param<Id>) -> Result<&[u8], E>,
    value_text: fn(&C, &Param<Id>) -> Result<&[u8], E>,
) -> Result<(), bun_core::Error>
where
    W: fmt::Write,
    Id: Copy,
    E: Into<bun_core::Error>,
{
    // TODO(port): narrow error set
    let max_spacing: usize = 'blk: {
        let mut res: usize = 0;
        for param in params {
            // TODO(port): std.io.countingWriter(io.null_writer) — using a local
            // CountingWriter that discards output and counts bytes.
            let mut cs = CountingWriter::null();
            print_param(&mut cs, param, context, value_text).map_err(Into::into)?;
            if res < cs.bytes_written {
                res = cs.bytes_written;
            }
        }
        break 'blk res;
    };

    for param in params {
        if param.names.short.is_none() && param.names.long.is_none() {
            continue;
        }

        let ht = help_text(context, param).map_err(Into::into)?;
        // only print flag if description is defined
        if !ht.is_empty() {
            // TODO(port): std.io.countingWriter(stream) — wrapping `stream`
            let mut cs = CountingWriter::wrap(stream);
            write!(cs.inner(), "\t").map_err(|_| err!("WriteFailed"))?;
            print_param(&mut cs, param, context, value_text).map_err(Into::into)?;
            let written = cs.bytes_written;
            // stream.splatByteAll(' ', max_spacing - written)
            for _ in 0..(max_spacing - written) {
                stream.write_char(' ').map_err(|_| err!("WriteFailed"))?;
            }
            let ht2 = help_text(context, param).map_err(Into::into)?;
            write!(stream, "\t{}\n", bstr::BStr::new(ht2)).map_err(|_| err!("WriteFailed"))?;
        }
    }
    Ok(())
}

fn print_param<W, Id, E, C>(
    stream: &mut W,
    param: &Param<Id>,
    context: &C,
    value_text: fn(&C, &Param<Id>) -> Result<&[u8], E>,
) -> Result<(), bun_core::Error>
where
    W: fmt::Write,
    Id: Copy,
    E: Into<bun_core::Error>,
{
    if let Some(s) = param.names.short {
        write!(stream, "-{}", s as char).map_err(|_| err!("WriteFailed"))?;
    } else {
        write!(stream, "  ").map_err(|_| err!("WriteFailed"))?;
    }
    if let Some(l) = param.names.long {
        if param.names.short.is_some() {
            write!(stream, ", ").map_err(|_| err!("WriteFailed"))?;
        } else {
            write!(stream, "  ").map_err(|_| err!("WriteFailed"))?;
        }
        write!(stream, "--{}", bstr::BStr::new(l)).map_err(|_| err!("WriteFailed"))?;
    }

    match param.takes_value {
        Values::None => {}
        Values::One => {
            write!(stream, " <{}>", bstr::BStr::new(value_text(context, param).map_err(Into::into)?))
                .map_err(|_| err!("WriteFailed"))?
        }
        Values::OneOptional => {
            write!(stream, " <{}>?", bstr::BStr::new(value_text(context, param).map_err(Into::into)?))
                .map_err(|_| err!("WriteFailed"))?
        }
        Values::Many => {
            write!(stream, " <{}>...", bstr::BStr::new(value_text(context, param).map_err(Into::into)?))
                .map_err(|_| err!("WriteFailed"))?
        }
    }
    Ok(())
}

/// A wrapper around help_full for simple help_text and value_text functions that
/// cant return an error or take a context.
pub fn help_ex<W, Id>(
    stream: &mut W,
    params: &[Param<Id>],
    // TODO(port): LIFETIMES.tsv classifies these as `fn(Param<Id>) -> &'static str`;
    // using `&'static [u8]` to stay consistent with the bytes-not-str rule.
    help_text: fn(&Param<Id>) -> &'static [u8],
    value_text: fn(&Param<Id>) -> &'static [u8],
) -> Result<(), bun_core::Error>
where
    W: fmt::Write,
    Id: Copy,
{
    struct Context<Id> {
        help_text: fn(&Param<Id>) -> &'static [u8],
        value_text: fn(&Param<Id>) -> &'static [u8],
    }

    fn help<Id>(c: &Context<Id>, p: &Param<Id>) -> Result<&'static [u8], core::convert::Infallible> {
        Ok((c.help_text)(p))
    }

    fn value<Id>(c: &Context<Id>, p: &Param<Id>) -> Result<&'static [u8], core::convert::Infallible> {
        Ok((c.value_text)(p))
    }

    help_full(
        stream,
        params,
        &Context { help_text, value_text },
        help::<Id>,
        value::<Id>,
    )
}

pub fn simple_print_param(param: &Param<Help>) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    Output::pretty(format_args!("\n"));
    if let Some(s) = param.names.short {
        if param.takes_value != Values::None && param.names.long.is_none() {
            Output::pretty(format_args!("  <cyan>-{}<r><d><cyan>=\\<val\\><r>", s as char));
        } else {
            Output::pretty(format_args!("  <cyan>-{}<r>", s as char));
        }
    } else {
        Output::pretty(format_args!("    "));
    }
    if let Some(l) = param.names.long {
        if param.names.short.is_some() {
            Output::pretty(format_args!(", "));
        } else {
            Output::pretty(format_args!("  "));
        }

        if param.takes_value != Values::None {
            Output::pretty(format_args!("<cyan>--{}<r><d><cyan>=\\<val\\><r>", bstr::BStr::new(l)));
        } else {
            Output::pretty(format_args!("<cyan>--{}<r>", bstr::BStr::new(l)));
        }
    } else {
        Output::pretty(format_args!("    "));
    }
    Ok(())
}

pub fn simple_help(params: &[Param<Help>]) {
    let max_spacing: usize = 'blk: {
        let mut res: usize = 2;
        for param in params {
            let flags_len = if let Some(l) = param.names.long { l.len() } else { 0 };
            let value_len: usize = if param.takes_value != Values::None { 6 } else { 0 };
            if res < flags_len + value_len {
                res = flags_len + value_len;
            }
        }
        break 'blk res;
    };

    for param in params {
        if param.names.short.is_none() && param.names.long.is_none() {
            continue;
        }

        let desc_text = get_help_simple(param);
        if desc_text.is_empty() {
            continue;
        }

        // create a string with spaces_len spaces
        let flags_len = if let Some(l) = param.names.long { l.len() } else { 0 };
        let value_len: usize = if param.takes_value != Values::None { 6 } else { 0 };
        let total_len = flags_len + value_len;
        let num_spaces_after = max_spacing - total_len;
        let spaces_after = vec![b' '; num_spaces_after];

        simple_print_param(param).expect("unreachable");
        Output::pretty(format_args!(
            "  {}  {}",
            bstr::BStr::new(&spaces_after),
            bstr::BStr::new(desc_text)
        ));
    }
}

pub fn simple_help_bun_top_level(params: &'static [Param<Help>]) {
    // TODO(port): Zig evaluates `computed_max_spacing` at `comptime` and emits
    // `@compileError` on overflow, plus uses `inline for` + comptime string
    // concat (`space_buf[..n] ++ desc_text`). None of that is const-evaluable
    // in Rust over a slice param. Runtime equivalent below; Phase B can macro-gen.
    const MAX_SPACING: usize = 30;
    const SPACE_BUF: &[u8; MAX_SPACING] = b"                              ";

    let computed_max_spacing: usize = 'blk: {
        let mut res: usize = 2;
        for param in params {
            let flags_len = if let Some(l) = param.names.long { l.len() } else { 0 };
            let value_len: usize = if param.takes_value != Values::None { 6 } else { 0 };
            if res < flags_len + value_len {
                res = flags_len + value_len;
            }
        }
        break 'blk res;
    };

    // Zig: @compileError; here a debug-time assert.
    debug_assert!(
        computed_max_spacing <= MAX_SPACING,
        "a parameter is too long to be nicely printed in `bun --help`"
    );

    // PERF(port): was `inline for` + comptime string concat — profile in Phase B
    for param in params {
        if !(param.names.short.is_none() && param.names.long.is_none()) {
            let desc_text = get_help_simple(param);
            if !desc_text.is_empty() {
                simple_print_param(param).expect("unreachable");

                let flags_len = if let Some(l) = param.names.long { l.len() } else { 0 };
                let value_len: usize = if param.takes_value != Values::None { 6 } else { 0 };
                let total_len = flags_len + value_len;
                let num_spaces_after = MAX_SPACING - total_len;

                // Zig: Output.pretty(space_buf[0..n] ++ desc_text, .{})
                Output::pretty(format_args!(
                    "{}{}",
                    bstr::BStr::new(&SPACE_BUF[0..num_spaces_after]),
                    bstr::BStr::new(desc_text)
                ));
            }
        }
    }
}

#[derive(Clone, Copy)]
pub struct Help {
    pub msg: &'static [u8],
    pub value: &'static [u8],
}

impl Default for Help {
    fn default() -> Self {
        Self { msg: b"", value: b"" }
    }
}

/// A wrapper around help_ex that takes a `Param<Help>`.
pub fn help<W: fmt::Write>(stream: &mut W, params: &[Param<Help>]) -> Result<(), bun_core::Error> {
    help_ex(stream, params, get_help_simple, get_value_simple)
}

fn get_help_simple(param: &Param<Help>) -> &'static [u8] {
    param.id.msg
}

fn get_value_simple(param: &Param<Help>) -> &'static [u8] {
    param.id.value
}

/// Will print a usage message in the following format:
/// [-abc] [--longa] [-d <valueText>] [--longb <valueText>] <valueText>
///
/// First all none value taking parameters, which have a short name are
/// printed, then non positional parameters and finally the positinal.
pub fn usage_full<W, Id, E, C>(
    stream: &mut W,
    params: &[Param<Id>],
    context: &C,
    value_text: fn(&C, &Param<Id>) -> Result<&[u8], E>,
) -> Result<(), bun_core::Error>
where
    W: fmt::Write,
    Id: Copy,
    E: Into<bun_core::Error>,
{
    // TODO(port): narrow error set
    // TODO(port): std.io.countingWriter(stream)
    let mut cos = CountingWriter::wrap(stream);
    for param in params {
        let Some(name) = param.names.short else { continue };
        if param.takes_value != Values::None {
            continue;
        }

        if cos.bytes_written == 0 {
            // PORT NOTE: Zig wrote "[-" to `stream` (not `cs`), bypassing the
            // counter. Preserving that quirk by writing to the inner writer.
            write!(cos.inner(), "[-").map_err(|_| err!("WriteFailed"))?;
        }
        cos.write_char(name as char).map_err(|_| err!("WriteFailed"))?;
    }
    if cos.bytes_written != 0 {
        cos.write_char(']').map_err(|_| err!("WriteFailed"))?;
    }

    let mut positional: Option<Param<Id>> = None;
    for param in params {
        if param.takes_value == Values::None && param.names.short.is_some() {
            continue;
        }

        let prefix: &[u8] = if param.names.short.is_some() { b"-" } else { b"--" };

        // Zig had a workaround `@as([*]const u8, @ptrCast(s))[0..1]` for taking
        // a 1-byte slice of the short char. Rust expresses this as a 1-elem array.
        let short_buf;
        let name: &[u8] = if let Some(s) = param.names.short {
            short_buf = [s];
            &short_buf
        } else if let Some(l) = param.names.long {
            l
        } else {
            positional = Some(*param);
            continue;
        };
        if cos.bytes_written != 0 {
            cos.write_char(' ').map_err(|_| err!("WriteFailed"))?;
        }

        write!(cos, "[{}{}", bstr::BStr::new(prefix), bstr::BStr::new(name))
            .map_err(|_| err!("WriteFailed"))?;
        match param.takes_value {
            Values::None => {}
            Values::One => write!(
                cos,
                " <{}>",
                bstr::BStr::new(value_text(context, param).map_err(Into::into)?)
            )
            .map_err(|_| err!("WriteFailed"))?,
            Values::OneOptional => write!(
                cos,
                " <{}>?",
                bstr::BStr::new(value_text(context, param).map_err(Into::into)?)
            )
            .map_err(|_| err!("WriteFailed"))?,
            Values::Many => write!(
                cos,
                " <{}>...",
                bstr::BStr::new(value_text(context, param).map_err(Into::into)?)
            )
            .map_err(|_| err!("WriteFailed"))?,
        }

        cos.write_char(']').map_err(|_| err!("WriteFailed"))?;
    }

    if let Some(p) = positional {
        if cos.bytes_written != 0 {
            cos.write_char(' ').map_err(|_| err!("WriteFailed"))?;
        }
        write!(cos, "<{}>", bstr::BStr::new(value_text(context, &p).map_err(Into::into)?))
            .map_err(|_| err!("WriteFailed"))?;
    }
    Ok(())
}

/// A wrapper around usage_full for a simple value_text functions that
/// cant return an error or take a context.
pub fn usage_ex<W, Id>(
    stream: &mut W,
    params: &[Param<Id>],
    value_text: fn(&Param<Id>) -> &'static [u8],
) -> Result<(), bun_core::Error>
where
    W: fmt::Write,
    Id: Copy,
{
    struct Context<Id> {
        value_text: fn(&Param<Id>) -> &'static [u8],
    }

    fn value<Id>(c: &Context<Id>, p: &Param<Id>) -> Result<&'static [u8], core::convert::Infallible> {
        Ok((c.value_text)(p))
    }

    usage_full(stream, params, &Context { value_text }, value::<Id>)
}

/// A wrapper around usage_ex that takes a `Param<Help>`.
pub fn usage<W: fmt::Write>(stream: &mut W, params: &[Param<Help>]) -> Result<(), bun_core::Error> {
    usage_ex(stream, params, get_value_simple)
}

#[cfg(test)]
fn test_usage(expected: &[u8], params: &[Param<Help>]) -> Result<(), bun_core::Error> {
    // TODO(port): std.io.fixedBufferStream — using a Vec<u8> via fmt::Write shim
    let mut buf = Vec::<u8>::with_capacity(1024);
    struct VecW<'a>(&'a mut Vec<u8>);
    impl fmt::Write for VecW<'_> {
        fn write_str(&mut self, s: &str) -> fmt::Result {
            self.0.extend_from_slice(s.as_bytes());
            Ok(())
        }
    }
    usage(&mut VecW(&mut buf), params)?;
    assert_eq!(expected, &buf[..]);
    Ok(())
}

// ───────────── helpers (no Zig std equivalent in PORTING.md) ─────────────

// TODO(port): `std.mem.tokenizeAny` replacement that supports `.rest()`. If a
// shared helper exists in `bun_str::strings`, replace this.
struct TokenizeAny {
    buf: &'static [u8],
    delims: &'static [u8],
    index: usize,
}

impl TokenizeAny {
    fn new(buf: &'static [u8], delims: &'static [u8]) -> Self {
        Self { buf, delims, index: 0 }
    }

    fn is_delim(&self, b: u8) -> bool {
        self.delims.iter().any(|&d| d == b)
    }

    fn next(&mut self) -> Option<&'static [u8]> {
        while self.index < self.buf.len() && self.is_delim(self.buf[self.index]) {
            self.index += 1;
        }
        let start = self.index;
        if start == self.buf.len() {
            return None;
        }
        while self.index < self.buf.len() && !self.is_delim(self.buf[self.index]) {
            self.index += 1;
        }
        Some(&self.buf[start..self.index])
    }

    fn rest(&mut self) -> &'static [u8] {
        while self.index < self.buf.len() && self.is_delim(self.buf[self.index]) {
            self.index += 1;
        }
        &self.buf[self.index..]
    }
}

// TODO(port): `std.io.countingWriter` replacement. If `bun_io` grows one, swap.
struct CountingWriter<'a, W: fmt::Write> {
    inner: Option<&'a mut W>,
    bytes_written: usize,
}

impl<'a, W: fmt::Write> CountingWriter<'a, W> {
    fn wrap(w: &'a mut W) -> Self {
        Self { inner: Some(w), bytes_written: 0 }
    }
    fn inner(&mut self) -> &mut W {
        self.inner.as_mut().unwrap()
    }
}

impl CountingWriter<'static, NullWriter> {
    fn null() -> CountingWriter<'static, NullWriter> {
        // PORT NOTE: reshaped for borrowck — Zig used `io.null_writer`; here we
        // use a static-lifetime null sink so `print_param` can take `&mut W`.
        // TODO(port): clean up the Option<&mut W> dance once a real bun_io::CountingWriter exists
        static mut NULL: NullWriter = NullWriter;
        // SAFETY: NullWriter is zero-sized and has no state.
        CountingWriter { inner: Some(unsafe { &mut NULL }), bytes_written: 0 }
    }
}

impl<'a, W: fmt::Write> fmt::Write for CountingWriter<'a, W> {
    fn write_str(&mut self, s: &str) -> fmt::Result {
        self.bytes_written += s.len();
        if let Some(w) = self.inner.as_mut() {
            w.write_str(s)?;
        }
        Ok(())
    }
}

struct NullWriter;
impl fmt::Write for NullWriter {
    fn write_str(&mut self, _s: &str) -> fmt::Result {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_param_test() {
        expect_param(
            Param {
                id: Help { msg: b"Help text", value: b"value" },
                names: Names { short: Some(b's'), long: Some(b"long"), ..Default::default() },
                takes_value: Values::One,
            },
            parse_param(b"-s, --long <value> Help text").unwrap(),
        );

        expect_param(
            Param {
                id: Help { msg: b"Help text", value: b"value" },
                names: Names { short: Some(b's'), long: Some(b"long"), ..Default::default() },
                takes_value: Values::Many,
            },
            parse_param(b"-s, --long <value>... Help text").unwrap(),
        );

        expect_param(
            Param {
                id: Help { msg: b"Help text", value: b"value" },
                names: Names { long: Some(b"long"), ..Default::default() },
                takes_value: Values::One,
            },
            parse_param(b"--long <value> Help text").unwrap(),
        );

        expect_param(
            Param {
                id: Help { msg: b"Help text", value: b"value" },
                names: Names { short: Some(b's'), ..Default::default() },
                takes_value: Values::One,
            },
            parse_param(b"-s <value> Help text").unwrap(),
        );

        expect_param(
            Param {
                id: Help { msg: b"Help text", ..Default::default() },
                names: Names { short: Some(b's'), long: Some(b"long"), ..Default::default() },
                ..Default::default()
            },
            parse_param(b"-s, --long Help text").unwrap(),
        );

        expect_param(
            Param {
                id: Help { msg: b"Help text", ..Default::default() },
                names: Names { short: Some(b's'), ..Default::default() },
                ..Default::default()
            },
            parse_param(b"-s Help text").unwrap(),
        );

        expect_param(
            Param {
                id: Help { msg: b"Help text", ..Default::default() },
                names: Names { long: Some(b"long"), ..Default::default() },
                ..Default::default()
            },
            parse_param(b"--long Help text").unwrap(),
        );

        expect_param(
            Param {
                id: Help { msg: b"Help text", value: b"A | B" },
                names: Names { long: Some(b"long"), ..Default::default() },
                takes_value: Values::One,
            },
            parse_param(b"--long <A | B> Help text").unwrap(),
        );

        expect_param(
            Param {
                id: Help { msg: b"Help text", value: b"A" },
                names: Names::default(),
                takes_value: Values::One,
            },
            parse_param(b"<A> Help text").unwrap(),
        );

        expect_param(
            Param {
                id: Help { msg: b"Help text", value: b"A" },
                names: Names::default(),
                takes_value: Values::Many,
            },
            parse_param(b"<A>... Help text").unwrap(),
        );

        assert!(matches!(parse_param(b"--long, Help"), Err(ParseParamError::TrailingComma)));
        assert!(matches!(parse_param(b"-s, Help"), Err(ParseParamError::TrailingComma)));
        assert!(matches!(parse_param(b"-ss Help"), Err(ParseParamError::InvalidShortParam)));
        assert!(matches!(parse_param(b"-ss <value> Help"), Err(ParseParamError::InvalidShortParam)));
        assert!(matches!(parse_param(b"- Help"), Err(ParseParamError::InvalidShortParam)));
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/clap/clap.zig (734 lines)
//   confidence: medium
//   todos:      23
//   notes:      const-generic `&'static [Param<Id>]` (Args/ComptimeClap) needs adt_const_params or macro in Phase B; comptime parse_param/parse_long_names downgraded to runtime; std.io counting/fixed-buffer writers stubbed locally
// ──────────────────────────────────────────────────────────────────────────
