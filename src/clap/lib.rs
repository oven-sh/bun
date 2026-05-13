#![allow(unused, non_snake_case, non_camel_case_types, clippy::all)]
#![warn(unused_must_use)]
#![warn(unreachable_pub)]
use core::fmt;
use core::fmt::Write as _;

use bun_core::fmt::CountingWriter;
use bun_core::{self, Output};

pub mod args;
pub mod comptime;
pub mod streaming;

pub use comptime::{ComptimeClap, ConvertedTable};
pub use streaming::StreamingClap;

// Proc-macro backend — do not call these directly; use `parse_param!` / `param!` /
// `parse_params!` below, which inject `$crate` so the expansion resolves `Param`/
// `Help`/`Names`/`Values` regardless of how `bun_clap` is aliased at the call site.
#[doc(hidden)]
pub use bun_clap_macros::{__parse_param_impl, __parse_params_impl};

/// Parse a single param spec string (e.g. `"-h, --help  Display this help"`)
/// into a const `Param<Help>` literal at compile time. This is the Rust
/// equivalent of Zig's comptime `clap.parseParam(...) catch unreachable`.
///
/// The argument **must** be a string literal; parse errors surface as compile
/// errors at the call site.
#[macro_export]
macro_rules! parse_param {
    ($lit:literal $(,)?) => {
        $crate::__parse_param_impl!($crate, $lit)
    };
}

/// Alias for [`parse_param!`] matching the Zig call-site spelling
/// (`clap.parseParam` → `clap::param!`).
#[macro_export]
macro_rules! param {
    ($lit:literal $(,)?) => {
        $crate::__parse_param_impl!($crate, $lit)
    };
}

/// Const-time `Param<Help>` slice concatenation — the Rust analogue of Zig's
/// comptime `a ++ b ++ c` over param tables. Produces a `&'static [Param<Help>]`
/// baked into rodata; no `LazyLock`, no heap, no init closure in `.text`.
///
/// Every `$part` must be a `const`-evaluable `&[Param<Help>]` (a `const` item or
/// `&[literal, …]`); referencing a `static` is rejected by const-eval (E0013).
#[macro_export]
macro_rules! concat_params {
    ($($part:expr),* $(,)?) => {{
        const __PARTS: &[&[$crate::Param<$crate::Help>]] = &[$($part),*];
        const __ARR: [$crate::Param<$crate::Help>; $crate::__param_slices_len(__PARTS)] =
            $crate::__param_slices_concat::<{ $crate::__param_slices_len(__PARTS) }>(__PARTS);
        &__ARR
    }};
}

/// Build a `&'static ConvertedTable` from a const-evaluable
/// `&[Param<Help>]` at compile time — the Rust analogue of Zig's
/// `ComptimeClap(Id, params)` type-generator. The converted `[Param<usize>; N]`
/// array, the three category counts, the short-name index, *and* the sorted
/// long-name hash index all land in rodata, so [`parse_with_table`] does no
/// heap allocation, no sorting, no locking, and `args.flag(b"--foo")`
/// resolves via O(log n) binary search at runtime (or O(1) when paired with
/// [`comptime::find_param_index`] inside `const { }`).
///
/// ```ignore
/// pub const AUTO_PARAMS: &[Param<Help>] = concat_params!(...);
/// pub static AUTO_TABLE: &ConvertedTable = comptime_table!(AUTO_PARAMS);
/// ```
///
/// Pass `, cold` for every table off the trivial-script / `bun --version`
/// cold-start path (`bun run` / `bun build` / `bun test` / `bun install` /
/// `bun pm` / `bun x` / …) so it stays in plain `.rodata` instead of padding
/// the contiguous `.rodata.startup` run (see the per-arm notes below):
///
/// ```ignore
/// pub static RUN_TABLE: &ConvertedTable = comptime_table!(RUN_PARAMS, cold);
/// ```
#[macro_export]
macro_rules! comptime_table {
    // Hot table — the default-command param table that `bun <file>` and
    // `bun --version` dereference on cold start. Cluster every nested `__CONV` /
    // `__LONG` / `__TABLE` static into `.rodata.startup`: with
    // `-Zfunction-sections` each `static` otherwise lands in its own
    // `.rodata.<sym>` input section that fat-LTO emits in crate-alphabetical
    // order — one minor fault per scattered table on first touch. Pinning them
    // adjacent lets the trivial-script cold path fault the converted arrays,
    // long-name index, and `ConvertedTable` header in with one shared
    // fault-around window. Non-PIE `bun` has zero runtime relocations, so these
    // stay in plain rodata even with the `&'static [u8]` help strings they point
    // at. Linux-only: the section-name syntax is ELF-specific (mirrors
    // `bun_core::err!`'s `.bun_err` clustering). Use sparingly — only
    // `AUTO_TABLE` should take this arm; everything else passes `, cold`.
    ($params:expr) => {
        $crate::comptime_table!(
            @build
            { #[cfg_attr(target_os = "linux", unsafe(link_section = ".rodata.startup"))] }
            $params
        )
    };
    // Cold tables — `bun run` / `bun build` / `bun test` / `bun install` /
    // `bun pm` / `bun x` and friends. `.rodata.startup` is deliberately one
    // contiguous block faulted in with a single read-around on every cold start
    // (including `bun --version`); padding it with param tables those paths
    // never touch only grows that run. Leave these in plain `.rodata` —
    // `src/startup.order` still clusters the ones a sampled cold path hits.
    ($params:expr, cold) => {
        $crate::comptime_table!(@build { } $params)
    };
    (@build { $(#[$attr:meta])* } $params:expr) => {{
        const __P: &[$crate::Param<$crate::Help>] = $params;
        const __N: usize = __P.len();
        $(#[$attr])*
        static __CONV: [$crate::Param<usize>; __N] =
            $crate::comptime::convert_params_array::<$crate::Help, __N>(__P);
        const __M: usize = $crate::comptime::count_long_entries(__P);
        $(#[$attr])*
        static __LONG: [$crate::comptime::LongEntry; __M] =
            $crate::comptime::build_long_index::<$crate::Help, __M>(__P);
        $(#[$attr])*
        static __TABLE: $crate::ConvertedTable = $crate::ConvertedTable::from_const(
            &__CONV,
            $crate::comptime::count_flags(__P),
            $crate::comptime::count_single(__P),
            $crate::comptime::count_multi(__P),
            &__LONG,
        );
        &__TABLE
    }};
}

#[doc(hidden)]
pub const fn __param_slices_len(parts: &[&[Param<Help>]]) -> usize {
    let mut n = 0;
    let mut i = 0;
    while i < parts.len() {
        n += parts[i].len();
        i += 1;
    }
    n
}

#[doc(hidden)]
pub const fn __param_slices_concat<const N: usize>(parts: &[&[Param<Help>]]) -> [Param<Help>; N] {
    // Placeholder element for the pre-fill; every slot is overwritten below.
    const DUMMY: Param<Help> = Param {
        id: Help {
            msg: b"",
            msg_plain: b"",
            value: b"",
        },
        names: Names {
            short: None,
            long: None,
            long_aliases: &[],
        },
        takes_value: Values::None,
    };
    let mut out = [DUMMY; N];
    let mut idx = 0;
    let mut i = 0;
    while i < parts.len() {
        let part = parts[i];
        let mut j = 0;
        while j < part.len() {
            out[idx] = part[j];
            idx += 1;
            j += 1;
        }
        i += 1;
    }
    // Const-eval panic (build error) if the caller's `N` undercounts.
    assert!(idx == N);
    out
}

/// Parse a `;`-separated list of param spec strings into a
/// `&'static [Param<Help>]` at compile time.
///
/// ```ignore
/// static PARAMS: &[Param<Help>] = parse_params! {
///     "-h, --help          Display this help";
///     "-v, --version       Print the version";
/// };
/// ```
#[macro_export]
macro_rules! parse_params {
    ($($lit:literal);* $(;)?) => {
        $crate::__parse_params_impl!($crate, $($lit);*)
    };
}

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
        Self {
            short: None,
            long: None,
            long_aliases: &[],
        }
    }
}

impl Names {
    /// `.{ .short = c }`
    #[inline]
    pub const fn short(c: u8) -> Self {
        Self {
            short: Some(c),
            long: None,
            long_aliases: &[],
        }
    }

    /// `.{ .long = name }`
    #[inline]
    pub const fn long(name: &'static [u8]) -> Self {
        Self {
            short: None,
            long: Some(name),
            long_aliases: &[],
        }
    }

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

    /// Check whether `name` (with leading `-`/`--`) matches this param's short,
    /// long, or any long alias. Shared predicate for `has_flag`/`find_param`.
    pub fn matches(&self, name: &[u8]) -> bool {
        if let Some(s) = self.short {
            // Zig: mem.eql(u8, name, "-" ++ [_]u8{s})
            if name.len() == 2 && name[0] == b'-' && name[1] == s {
                return true;
            }
        }
        if name.len() >= 2 && &name[..2] == b"--" {
            return self.matches_long(&name[2..]);
        }
        false
    }
}

/// Whether a param takes no value (a flag), one value, or can be specified multiple times.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
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
        Self {
            id: Id::default(),
            names: Names::default(),
            takes_value: Values::None,
        }
    }
}

// NOTE: the runtime spec parser (`fn parse_param` / `parse_long_names` /
// `parse_param_rest` / `ParseParamError` / `TokenizeAny`) was removed — the
// canonical implementation lives in `bun_clap_macros` and runs at compile time
// via `parse_param!` / `param!` / `parse_params!` above. All param specs are
// string literals, so there is no runtime caller.

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
// PORT NOTE: Zig `Diagnostic` borrows `arg`/`name.long` from the arg iterator. Rust
// can't tie that lifetime through `&mut Diagnostic` without invariance headaches, and
// this is an error-path-only struct, so it owns its bytes instead. The `name: Names`
// field is flattened to `short`/`long` because `Names.long` is `&'static`.
#[derive(Default)]
pub struct Diagnostic {
    pub arg: Vec<u8>,
    pub short: Option<u8>,
    pub long: Option<Vec<u8>>,
}

impl Diagnostic {
    /// Default diagnostics reporter when all you want is English with no colors.
    /// Use this as a reference for implementing your own if needed.
    ///
    /// Error path only — never reached on the trivial-script / `bun -p` cold
    /// start. `#[cold]` + `#[inline(never)]` so the formatting machinery lands
    /// in `.text.unlikely`, away from the cold-start working set.
    #[cold]
    #[inline(never)]
    pub fn report<W>(&self, _stream: W, err: bun_core::Error) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let mut name_buf = [0u8; 1024];
        let name: &[u8] = if let Some(s) = self.short {
            name_buf[0] = b'-';
            name_buf[1] = s;
            name_buf[2] = 0;
            &name_buf[0..2]
        } else if let Some(l) = self.long.as_deref() {
            name_buf[0] = b'-';
            name_buf[1] = b'-';
            let long = &l[0..l.len().min(name_buf.len() - 2)];
            name_buf[2..][0..long.len()].copy_from_slice(long);
            &name_buf[0..2 + long.len()]
        } else {
            &self.arg
        };

        let name = bstr::BStr::new(name);
        // TODO(b2-blocked): bun_core::err! — `from_name` is a tier-0 stub returning a
        // sentinel, so these equality checks all collapse. Restore once the interning
        // table lands; meanwhile the `else` arm covers all cases.
        if err == bun_core::err!("DoesntTakeValue") {
            bun_core::pretty_errorln!(
                "<red>error<r><d>:<r> The argument '{}' does not take a value.",
                name
            );
        } else if err == bun_core::err!("MissingValue") {
            bun_core::pretty_errorln!(
                "<red>error<r><d>:<r> The argument '{}' requires a value but none was supplied.",
                name
            );
        } else if err == bun_core::err!("InvalidArgument") {
            bun_core::pretty_errorln!("<red>error<r><d>:<r> Invalid Argument '{}'", name);
        } else {
            bun_core::pretty_errorln!(
                "<red>error<r><d>:<r> {} while parsing argument '{}'",
                bstr::BStr::new(err.name()),
                name
            );
        }
        bun_core::Output::flush();
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

#[derive(Clone, Copy)]
pub struct Help {
    /// The description text exactly as written in the param spec — may still
    /// contain `<tag>` colour markup. Used by [`help`]/[`help_ex`], which (like
    /// Zig's `clap.help`) emit it verbatim, and as the source for the ANSI form
    /// built lazily by [`pretty_help_desc`] on the `bun --help` colour path.
    pub msg: &'static [u8],
    /// `msg` with `<tag>` colour markup stripped — the non-TTY / piped help form.
    /// Precomputed at compile time by `parse_param!` (the strip is the only
    /// transform that needs to be ready without a TTY); the ANSI-coloured form is
    /// derived from `msg` on demand instead of being baked into rodata.
    pub msg_plain: &'static [u8],
    pub value: &'static [u8],
}

impl Default for Help {
    fn default() -> Self {
        Self {
            msg: b"",
            msg_plain: b"",
            value: b"",
        }
    }
}

/// Options that can be set to customize the behavior of parsing.
pub struct ParseOptions<'a> {
    // PORT NOTE: `mem.Allocator param` field deleted — non-AST crate uses
    // the global mimalloc.
    pub diagnostic: Option<&'a mut Diagnostic>,
    pub stop_after_positional_at: usize,
}

impl<'a> Default for ParseOptions<'a> {
    fn default() -> Self {
        Self {
            diagnostic: None,
            stop_after_positional_at: 0,
        }
    }
}

// Help/usage/error rendering — none of this is on the cold-start hot chain
// (`bun -p '1+1'` / `bun --version` / plain `bun <file>` never call into the
// help or diagnostics path). Mark every entry point `#[cold]` + `#[inline(never)]`
// so rustc emits them in `.text.unlikely.*` sections that the linker clusters
// together, keeping them out of the pages faulted in on a normal invocation.
#[cold]
#[inline(never)]
fn get_help_simple(param: &Param<Help>) -> &'static [u8] {
    param.id.msg
}

/// The param description with `<tag>` colour markup resolved — ANSI escapes when
/// stdout is a colour-capable TTY, stripped otherwise.
///
/// The tag-stripped form ([`Help::msg_plain`]) is precomputed in rodata; the
/// ANSI form is *not* — it is rewritten from [`Help::msg`] here, only when colour
/// output is actually requested. That `<tag>`→ANSI rewrite only ever runs on
/// `bun --help` / `bun run --help`; `--print` and ordinary runs never reach this
/// path, so they pay neither the per-invocation reparse nor the extra rodata a
/// baked-in `msg_ansi` array would cost on every flag and subcommand. (Zig did
/// the rewrite at `comptime` via `Output.prettyFmt` inside
/// `clap.simpleHelpBunTopLevel`; the colour case is rare enough that doing it
/// lazily at runtime is the better trade for binary size.)
#[cold]
#[inline(never)]
fn pretty_help_desc(param: &Param<Help>) -> std::borrow::Cow<'static, [u8]> {
    if Output::enable_ansi_colors_stdout() {
        std::borrow::Cow::Owned(bun_core::output::pretty_fmt_runtime(param.id.msg, true))
    } else {
        std::borrow::Cow::Borrowed(param.id.msg_plain)
    }
}

#[cold]
#[inline(never)]
fn get_value_simple(param: &Param<Help>) -> &'static [u8] {
    param.id.value
}

// TODO(port): `comptime params: []const Param(Id)` as a type parameter has no
// stable-Rust equivalent. B-2 carries `params` at runtime; a Phase-B proc-macro
// can restore the per-table monomorphization.
pub struct Args<Id: 'static> {
    // PORT NOTE: Zig stored `arena: bun.ArenaAllocator` here and `deinit` freed it.
    // Non-AST crate → arena removed; `ComptimeClap` owns its allocations.
    // PERF(port): was arena bulk-free — profile in Phase B
    pub clap: ComptimeClap<Id>,
    pub exe_arg: Option<&'static [u8]>,
}

impl<Id: 'static> Args<Id> {
    pub fn flag(&self, name: &'static [u8]) -> bool {
        self.clap.flag(name)
    }

    pub fn option(&self, name: &'static [u8]) -> Option<&'static [u8]> {
        self.clap.option(name)
    }

    pub fn options(&self, name: &'static [u8]) -> &[&'static [u8]] {
        self.clap.options(name)
    }

    pub fn positionals(&self) -> &[&'static [u8]] {
        self.clap.positionals()
    }

    pub fn remaining(&self) -> &[&'static [u8]] {
        self.clap.remaining()
    }

    pub fn has_flag(params: &[Param<Id>], name: &'static [u8]) -> bool {
        ComptimeClap::<Id>::has_flag(params, name)
    }
}

/// Same as `parse_ex` but uses the `args::OsIterator` by default.
///
/// **Cold path** — the startup hot set uses [`parse_with_table`] against a
/// rodata [`comptime_table!`]. This entry point performs a runtime conversion
/// (`ConvertedTable::for_params`) and is only used by non-startup commands
/// (`bun install`, `bun create`), so it's `#[cold]` + `#[inline(never)]`.
#[cold]
#[inline(never)]
pub fn parse<Id: 'static>(
    params: &'static [Param<Id>],
    opt: ParseOptions<'_>,
) -> Result<Args<Id>, bun_core::Error> {
    // TODO(port): narrow error set
    let mut iter = args::OsIterator::init();
    let exe_arg = iter.exe_arg;

    // PORT NOTE: Zig reused `iter.arena` as the allocator for `parseEx` and
    // moved it into `res.arena`. Arena removed in port; ownership flows through
    // `ComptimeClap` directly.
    let clap = parse_ex::<Id, _>(
        params,
        &mut iter,
        ParseOptions {
            diagnostic: opt.diagnostic,
            stop_after_positional_at: opt.stop_after_positional_at,
        },
    )?;
    Ok(Args { clap, exe_arg })
}

/// Same as [`parse`] but takes a pre-converted rodata [`ConvertedTable`]
/// (built via [`comptime_table!`]). This is the zero-runtime-conversion entry
/// point — no Vec/sort/lock on the startup path.
pub fn parse_with_table<Id: 'static>(
    table: &'static ConvertedTable,
    opt: ParseOptions<'_>,
) -> Result<Args<Id>, bun_core::Error> {
    let mut iter = args::OsIterator::init();
    let exe_arg = iter.exe_arg;
    let clap = ComptimeClap::<Id>::parse_with_table(
        table,
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
///
/// **Cold path** — see [`parse`]; the startup hot path is [`parse_with_table`].
#[cold]
#[inline(never)]
pub fn parse_ex<Id: 'static, I>(
    params: &'static [Param<Id>],
    iter: &mut I,
    opt: ParseOptions<'_>,
) -> Result<ComptimeClap<Id>, bun_core::Error>
where
    I: args::ArgIter<'static>,
{
    // TODO(port): narrow error set
    ComptimeClap::<Id>::parse(params, iter, opt)
}

/// Will print a help message in the following format:
///     -s, --long <valueText> helpText
///     -s,                    helpText
///     -s <valueText>         helpText
///         --long             helpText
///         --long <valueText> helpText
#[cold]
#[inline(never)]
pub fn help_full<W, Id, E, C>(
    stream: &mut W,
    params: &[Param<Id>],
    context: &C,
    help_text: fn(&C, &Param<Id>) -> Result<&'static [u8], E>,
    value_text: fn(&C, &Param<Id>) -> Result<&'static [u8], E>,
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
            print_param(&mut cs, param, context, value_text)?;
            if res < cs.count {
                res = cs.count;
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
            write!(cs.inner(), "\t")?;
            print_param(&mut cs, param, context, value_text)?;
            let written = cs.count;
            // stream.splatByteAll(' ', max_spacing - written)
            for _ in 0..(max_spacing - written) {
                stream.write_char(' ')?;
            }
            let ht2 = help_text(context, param).map_err(Into::into)?;
            write!(stream, "\t{}\n", bstr::BStr::new(ht2))?;
        }
    }
    Ok(())
}

#[cold]
#[inline(never)]
fn print_param<W, Id, E, C>(
    stream: &mut W,
    param: &Param<Id>,
    context: &C,
    value_text: fn(&C, &Param<Id>) -> Result<&'static [u8], E>,
) -> Result<(), bun_core::Error>
where
    W: fmt::Write,
    Id: Copy,
    E: Into<bun_core::Error>,
{
    if let Some(s) = param.names.short {
        write!(stream, "-{}", s as char)?;
    } else {
        write!(stream, "  ")?;
    }
    if let Some(l) = param.names.long {
        if param.names.short.is_some() {
            write!(stream, ", ")?;
        } else {
            write!(stream, "  ")?;
        }
        write!(stream, "--{}", bstr::BStr::new(l))?;
    }

    write_takes_value_suffix(stream, param, context, value_text)?;
    Ok(())
}

/// Shared by `print_param` and `usage_full`: emit the ` <val>` / ` <val>?` /
/// ` <val>...` suffix for a param's `takes_value`. Mirrors clap.zig:459/672.
#[cold]
#[inline(never)]
fn write_takes_value_suffix<W, Id, E, C>(
    w: &mut W,
    param: &Param<Id>,
    context: &C,
    value_text: fn(&C, &Param<Id>) -> Result<&'static [u8], E>,
) -> Result<(), bun_core::Error>
where
    W: fmt::Write,
    Id: Copy,
    E: Into<bun_core::Error>,
{
    match param.takes_value {
        Values::None => {}
        Values::One => {
            write!(
                w,
                " <{}>",
                bstr::BStr::new(value_text(context, param).map_err(Into::into)?)
            )?;
        }
        Values::OneOptional => {
            write!(
                w,
                " <{}>?",
                bstr::BStr::new(value_text(context, param).map_err(Into::into)?)
            )?;
        }
        Values::Many => {
            write!(
                w,
                " <{}>...",
                bstr::BStr::new(value_text(context, param).map_err(Into::into)?)
            )?;
        }
    }
    Ok(())
}

/// A wrapper around help_full for simple help_text and value_text functions that
/// cant return an error or take a context.
#[cold]
#[inline(never)]
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

    fn help<Id>(c: &Context<Id>, p: &Param<Id>) -> Result<&'static [u8], bun_core::Error> {
        Ok((c.help_text)(p))
    }

    fn value<Id>(c: &Context<Id>, p: &Param<Id>) -> Result<&'static [u8], bun_core::Error> {
        Ok((c.value_text)(p))
    }

    help_full(
        stream,
        params,
        &Context {
            help_text,
            value_text,
        },
        help::<Id>,
        value::<Id>,
    )
}

#[cold]
#[inline(never)]
pub fn simple_print_param(param: &Param<Help>) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    Output::pretty(format_args!("\n"));
    if let Some(s) = param.names.short {
        if param.takes_value != Values::None && param.names.long.is_none() {
            bun_core::pretty!("  <cyan>-{}<r><d><cyan>=\\<val\\><r>", s as char);
        } else {
            bun_core::pretty!("  <cyan>-{}<r>", s as char);
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
            bun_core::pretty!("<cyan>--{}<r><d><cyan>=\\<val\\><r>", bstr::BStr::new(l));
        } else {
            bun_core::pretty!("<cyan>--{}<r>", bstr::BStr::new(l));
        }
    } else {
        Output::pretty(format_args!("    "));
    }
    Ok(())
}

/// Display width of a single param's flag column: `--long` plus the literal
/// `=<val>` suffix (6 bytes) when it takes a value. Kept in lockstep with
/// `simple_print_param`'s `"=<val>"` literal — change both together.
#[cold]
#[inline(never)]
fn param_display_width(param: &Param<Help>) -> usize {
    let flags_len = param.names.long.map_or(0, |l| l.len());
    let value_len: usize = if param.takes_value != Values::None {
        6
    } else {
        0
    };
    flags_len + value_len
}

#[cold]
#[inline(never)]
fn compute_max_help_spacing(params: &[Param<Help>]) -> usize {
    let mut res: usize = 2;
    for param in params {
        res = res.max(param_display_width(param));
    }
    res
}

#[cold]
#[inline(never)]
pub fn simple_help(params: &[Param<Help>]) {
    let max_spacing: usize = compute_max_help_spacing(params);

    for param in params {
        if param.names.short.is_none() && param.names.long.is_none() {
            continue;
        }

        let desc_text = get_help_simple(param);
        if desc_text.is_empty() {
            continue;
        }

        // create a string with spaces_len spaces
        let total_len = param_display_width(param);
        let num_spaces_after = max_spacing - total_len;
        let spaces_after = vec![b' '; num_spaces_after];

        simple_print_param(param).expect("unreachable");
        // Zig's `Output.pretty("  {s}  {s}", …)` (clap.zig:567) only runs prettyFmt
        // over the comptime template, so `<tag>` markers inside `desc_text` leak
        // through verbatim there. That is observably wrong (`bun run --help` prints
        // literal `<d>$cwd<r>`); `pretty_help_desc` resolves the `<tag>` markup
        // (ANSI on a colour TTY, stripped otherwise) so `--help` output is
        // tag-clean regardless of which helper a command uses.
        let desc = pretty_help_desc(param);
        Output::pretty(format_args!(
            "  {}  {}",
            bstr::BStr::new(&spaces_after),
            bstr::BStr::new(desc.as_ref()),
        ));
    }
}

#[cold]
#[inline(never)]
pub fn simple_help_bun_top_level(params: &[Param<Help>]) {
    // TODO(port): Zig evaluates `computed_max_spacing` at `comptime` and emits
    // `@compileError` on overflow, plus uses `inline for` + comptime string
    // concat (`space_buf[..n] ++ desc_text`). None of that is const-evaluable
    // in Rust over a slice param. Runtime equivalent below; Phase B can macro-gen.
    const MAX_SPACING: usize = 30;
    const SPACE_BUF: &[u8; MAX_SPACING] = b"                              ";

    let computed_max_spacing: usize = compute_max_help_spacing(params);

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

                let total_len = param_display_width(param);
                let num_spaces_after = MAX_SPACING - total_len;

                // Zig: Output.pretty(space_buf[0..n] ++ desc_text, .{}) — the concat
                // is the *format string*, so `<tag>` markers inside `desc_text` are
                // rewritten at `comptime`. Mirror that via `pretty_help_desc`, which
                // resolves the markup (ANSI on a colour TTY, stripped otherwise).
                let desc = pretty_help_desc(param);
                Output::pretty(format_args!(
                    "{}{}",
                    bstr::BStr::new(&SPACE_BUF[0..num_spaces_after]),
                    bstr::BStr::new(desc.as_ref()),
                ));
            }
        }
    }
}

/// A wrapper around help_ex that takes a `Param<Help>`.
#[cold]
#[inline(never)]
pub fn help<W: fmt::Write>(stream: &mut W, params: &[Param<Help>]) -> Result<(), bun_core::Error> {
    help_ex(stream, params, get_help_simple, get_value_simple)
}

/// Will print a usage message in the following format:
/// [-abc] [--longa] [-d <valueText>] [--longb <valueText>] <valueText>
///
/// First all none value taking parameters, which have a short name are
/// printed, then non positional parameters and finally the positinal.
#[cold]
#[inline(never)]
pub fn usage_full<W, Id, E, C>(
    stream: &mut W,
    params: &[Param<Id>],
    context: &C,
    value_text: fn(&C, &Param<Id>) -> Result<&'static [u8], E>,
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
        let Some(name) = param.names.short else {
            continue;
        };
        if param.takes_value != Values::None {
            continue;
        }

        if cos.count == 0 {
            // PORT NOTE: Zig wrote "[-" to `stream` (not `cs`), bypassing the
            // counter. Preserving that quirk by writing to the inner writer.
            write!(cos.inner(), "[-")?;
        }
        cos.write_char(name as char)?;
    }
    if cos.count != 0 {
        cos.write_char(']')?;
    }

    let mut positional: Option<Param<Id>> = None;
    for param in params {
        if param.takes_value == Values::None && param.names.short.is_some() {
            continue;
        }

        let prefix: &[u8] = if param.names.short.is_some() {
            b"-"
        } else {
            b"--"
        };

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
        if cos.count != 0 {
            cos.write_char(' ')?;
        }

        write!(cos, "[{}{}", bstr::BStr::new(prefix), bstr::BStr::new(name))?;
        write_takes_value_suffix(&mut cos, param, context, value_text)?;

        cos.write_char(']')?;
    }

    if let Some(p) = positional {
        if cos.count != 0 {
            cos.write_char(' ')?;
        }
        write!(
            cos,
            "<{}>",
            bstr::BStr::new(value_text(context, &p).map_err(Into::into)?)
        )?;
    }
    Ok(())
}

/// A wrapper around usage_full for a simple value_text functions that
/// cant return an error or take a context.
#[cold]
#[inline(never)]
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

    fn value<Id>(c: &Context<Id>, p: &Param<Id>) -> Result<&'static [u8], bun_core::Error> {
        Ok((c.value_text)(p))
    }

    usage_full(stream, params, &Context { value_text }, value::<Id>)
}

/// A wrapper around usage_ex that takes a `Param<Help>`.
#[cold]
#[inline(never)]
pub fn usage<W: fmt::Write>(stream: &mut W, params: &[Param<Help>]) -> Result<(), bun_core::Error> {
    usage_ex(stream, params, get_value_simple)
}

#[cfg(test)]
fn test_usage(expected: &[u8], params: &[Param<Help>]) -> Result<(), bun_core::Error> {
    let mut buf = Vec::<u8>::with_capacity(1024);
    usage(&mut bun_core::fmt::VecWriter(&mut buf), params)?;
    assert_eq!(expected, &buf[..]);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_param_test() {
        expect_param(
            Param {
                id: Help {
                    msg: b"Help text",
                    value: b"value",
                    ..Default::default()
                },
                names: Names {
                    short: Some(b's'),
                    long: Some(b"long"),
                    ..Default::default()
                },
                takes_value: Values::One,
            },
            parse_param!("-s, --long <value> Help text"),
        );

        expect_param(
            Param {
                id: Help {
                    msg: b"Help text",
                    value: b"value",
                    ..Default::default()
                },
                names: Names {
                    short: Some(b's'),
                    long: Some(b"long"),
                    ..Default::default()
                },
                takes_value: Values::Many,
            },
            parse_param!("-s, --long <value>... Help text"),
        );

        expect_param(
            Param {
                id: Help {
                    msg: b"Help text",
                    value: b"value",
                    ..Default::default()
                },
                names: Names {
                    long: Some(b"long"),
                    ..Default::default()
                },
                takes_value: Values::One,
            },
            parse_param!("--long <value> Help text"),
        );

        expect_param(
            Param {
                id: Help {
                    msg: b"Help text",
                    value: b"value",
                    ..Default::default()
                },
                names: Names {
                    short: Some(b's'),
                    ..Default::default()
                },
                takes_value: Values::One,
            },
            parse_param!("-s <value> Help text"),
        );

        expect_param(
            Param {
                id: Help {
                    msg: b"Help text",
                    ..Default::default()
                },
                names: Names {
                    short: Some(b's'),
                    long: Some(b"long"),
                    ..Default::default()
                },
                ..Default::default()
            },
            parse_param!("-s, --long Help text"),
        );

        expect_param(
            Param {
                id: Help {
                    msg: b"Help text",
                    ..Default::default()
                },
                names: Names {
                    short: Some(b's'),
                    ..Default::default()
                },
                ..Default::default()
            },
            parse_param!("-s Help text"),
        );

        expect_param(
            Param {
                id: Help {
                    msg: b"Help text",
                    ..Default::default()
                },
                names: Names {
                    long: Some(b"long"),
                    ..Default::default()
                },
                ..Default::default()
            },
            parse_param!("--long Help text"),
        );

        expect_param(
            Param {
                id: Help {
                    msg: b"Help text",
                    value: b"A | B",
                    ..Default::default()
                },
                names: Names {
                    long: Some(b"long"),
                    ..Default::default()
                },
                takes_value: Values::One,
            },
            parse_param!("--long <A | B> Help text"),
        );

        expect_param(
            Param {
                id: Help {
                    msg: b"Help text",
                    value: b"A",
                    ..Default::default()
                },
                names: Names::default(),
                takes_value: Values::One,
            },
            parse_param!("<A> Help text"),
        );

        expect_param(
            Param {
                id: Help {
                    msg: b"Help text",
                    value: b"A",
                    ..Default::default()
                },
                names: Names::default(),
                takes_value: Values::Many,
            },
            parse_param!("<A>... Help text"),
        );

        // Error-case specs ("--long,", "-ss", "-", trailing comma) are now
        // compile errors via the proc-macro and are not assertable at runtime.
    }

    // Compile-time check: the macro output is const-evaluable in a `static`.
    static MACRO_PARAMS: &[Param<Help>] = &[
        parse_param!("-s, --long <value> Help text"),
        parse_param!("-c, --config <STR>?  Specify path to config"),
        parse_param!("--test-name-pattern/--grep <STR>...  Filter tests"),
        parse_param!("<POS> ...  positional"),
        param!("-h, --help  Display this help"),
    ];

    static MACRO_PARAMS_SLICE: &[Param<Help>] = parse_params! {
        "-h, --help          Display this help";
        "-v, --version       Print the version";
        "<POS> ...           ";
    };

    #[test]
    fn parse_param_macro_static_tables() {
        // Static-table sanity.
        assert_eq!(MACRO_PARAMS[0].names.short, Some(b's'));
        assert_eq!(MACRO_PARAMS[0].names.long, Some(b"long" as &[u8]));
        assert_eq!(MACRO_PARAMS[0].id.value, b"value");
        assert_eq!(MACRO_PARAMS[0].takes_value, Values::One);

        assert_eq!(MACRO_PARAMS[1].takes_value, Values::OneOptional);
        assert_eq!(MACRO_PARAMS[1].id.value, b"STR");

        // Aliases — proc-macro restores the comptime alias array the runtime parser drops.
        assert_eq!(
            MACRO_PARAMS[2].names.long,
            Some(b"test-name-pattern" as &[u8])
        );
        assert_eq!(MACRO_PARAMS[2].names.long_aliases, &[b"grep" as &[u8]]);
        assert_eq!(MACRO_PARAMS[2].takes_value, Values::Many);

        // Positional.
        assert_eq!(MACRO_PARAMS[3].names.short, None);
        assert_eq!(MACRO_PARAMS[3].names.long, None);
        assert_eq!(MACRO_PARAMS[3].id.value, b"POS");

        // parse_params! slice form.
        assert_eq!(MACRO_PARAMS_SLICE.len(), 3);
        assert_eq!(MACRO_PARAMS_SLICE[0].names.short, Some(b'h'));
        assert_eq!(MACRO_PARAMS_SLICE[0].names.long, Some(b"help" as &[u8]));
        assert_eq!(MACRO_PARAMS_SLICE[1].names.long, Some(b"version" as &[u8]));
        assert_eq!(MACRO_PARAMS_SLICE[2].takes_value, Values::One);
    }

    // Compile-time check: comptime_table!/find_param_index are const-evaluable.
    const CT_PARAMS: &[Param<Help>] = concat_params!(
        &[parse_param!("-h, --help          Display this help")],
        &[parse_param!("-c, --config <STR>  Config")],
        &[parse_param!("--define <K=V>...   Define")],
    );
    static CT_TABLE: &ConvertedTable = comptime_table!(CT_PARAMS);
    const CT_HELP_IDX: usize = comptime::find_param_index(CT_TABLE.converted, b"--help");
    const CT_CONFIG_IDX: usize = comptime::find_param_index(CT_TABLE.converted, b"-c");

    #[test]
    fn comptime_table_const_eval() {
        assert_eq!(CT_TABLE.n_flags, 1);
        assert_eq!(CT_TABLE.n_single, 1);
        assert_eq!(CT_TABLE.n_multi, 1);
        assert_eq!(CT_TABLE.converted[CT_HELP_IDX].id, 0);
        assert_eq!(CT_TABLE.converted[CT_CONFIG_IDX].id, 0);
        assert_eq!(CT_TABLE.converted[CT_CONFIG_IDX].takes_value, Values::One);
    }
}

// ported from: src/clap/clap.zig
