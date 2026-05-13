//! Proc-macro backend for `bun_clap::parse_param!` / `bun_clap::parse_params!`.
//!
//! This is a 1:1 port of the comptime `parseParam` from `src/clap/clap.zig`, lifted into
//! a proc-macro so the resulting `Param<Help>` values are fully const and usable in
//! `static` tables (the Zig original ran at comptime via `@setEvalBranchQuota`).
//!
//! Do **not** call these proc-macros directly — they take a leading crate-path argument
//! (`$crate`) injected by the `macro_rules!` wrappers in `bun_clap`. Use
//! `bun_clap::parse_param!` / `bun_clap::param!` / `bun_clap::parse_params!` instead.

use proc_macro::TokenStream;
use proc_macro2::{Span, TokenStream as TokenStream2};
use quote::quote;
use syn::parse::{Parse, ParseStream};
use syn::punctuated::Punctuated;
use syn::{LitByteStr, LitStr, Path, Token, parse_macro_input};

// ─────────────────────────────────────────────────────────────────────────────
// Parsed representation — build-time IR; the public `Param<Help>` / `Names` /
// `Values` / `Help` shapes live in `bun_clap` (this proc-macro crate cannot
// depend on it without a cycle, and the public types borrow `&'static` data
// that does not exist at macro-expansion time).
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
enum Values {
    None,
    One,
    Many,
    OneOptional,
}

#[derive(Default)]
struct Names {
    short: Option<u8>,
    long: Option<String>,
    long_aliases: Vec<String>,
}

#[derive(Default)]
struct Help {
    msg: String,
    value: String,
}

struct Param {
    id: Help,
    names: Names,
    takes_value: Values,
}

impl Default for Param {
    fn default() -> Self {
        Self {
            id: Help::default(),
            names: Names::default(),
            takes_value: Values::None,
        }
    }
}

enum ParseParamError {
    NoParamFound,
    InvalidShortParam,
    TrailingComma,
}

impl ParseParamError {
    fn msg(&self) -> &'static str {
        match self {
            Self::NoParamFound => "no parameter found",
            Self::InvalidShortParam => "invalid short parameter (must be exactly `-x`)",
            Self::TrailingComma => "trailing comma after parameter name",
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser — direct port of clap.zig `parseParam` / `parseParamRest` / `parseLongNames`
// ─────────────────────────────────────────────────────────────────────────────

/// `std.mem.tokenizeAny` with a `.rest()` that skips leading delimiters.
struct TokenizeAny<'a> {
    buf: &'a [u8],
    index: usize,
}

impl<'a> TokenizeAny<'a> {
    fn new(buf: &'a [u8]) -> Self {
        Self { buf, index: 0 }
    }
    fn is_delim(b: u8) -> bool {
        b == b' ' || b == b'\t'
    }
    fn next(&mut self) -> Option<&'a [u8]> {
        while self.index < self.buf.len() && Self::is_delim(self.buf[self.index]) {
            self.index += 1;
        }
        let start = self.index;
        if start == self.buf.len() {
            return None;
        }
        while self.index < self.buf.len() && !Self::is_delim(self.buf[self.index]) {
            self.index += 1;
        }
        Some(&self.buf[start..self.index])
    }
    fn rest(&mut self) -> &'a [u8] {
        while self.index < self.buf.len() && Self::is_delim(self.buf[self.index]) {
            self.index += 1;
        }
        &self.buf[self.index..]
    }
}

// local copy: proc-macro crate compiles for the HOST and cannot depend on
// bun_string/bun_alloc (would drag mimalloc-sys into the proc-macro build for
// a 6-line helper) — KEEP trim_left/trim bodies as-is.
fn trim_left(s: &[u8]) -> &[u8] {
    let mut i = 0;
    while i < s.len() && (s[i] == b' ' || s[i] == b'\t') {
        i += 1;
    }
    &s[i..]
}

fn trim(s: &[u8]) -> &[u8] {
    let s = trim_left(s);
    let mut e = s.len();
    while e > 0 && (s[e - 1] == b' ' || s[e - 1] == b'\t') {
        e -= 1;
    }
    &s[..e]
}

fn to_string(s: &[u8]) -> String {
    String::from_utf8(s.to_vec()).expect("param strings must be UTF-8")
}

fn parse_param(line: &[u8]) -> Result<Param, ParseParamError> {
    let mut found_comma = false;
    let mut it = TokenizeAny::new(line);
    let mut param_str = it.next().ok_or(ParseParamError::NoParamFound)?;

    let short_name: Option<u8> = if !param_str.starts_with(b"--") && param_str.starts_with(b"-") {
        found_comma = param_str[param_str.len() - 1] == b',';
        if found_comma {
            param_str = &param_str[..param_str.len() - 1];
        }
        if param_str.len() != 2 {
            return Err(ParseParamError::InvalidShortParam);
        }
        let short = param_str[1];
        if !found_comma {
            let mut res = parse_param_rest(it.rest());
            res.names.short = Some(short);
            return Ok(res);
        }
        param_str = it.next().ok_or(ParseParamError::NoParamFound)?;
        Some(short)
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
        return Ok(parse_param_rest(trim_left(line)));
    }

    let mut res = parse_param_rest(it.rest());
    res.names.short = short_name;

    // Supports multiple variants separated by '/' (e.g. "--test-name-pattern/--grep").
    let long_names = parse_long_names(param_str);
    res.names.long = long_names.long;
    res.names.long_aliases = long_names.long_aliases;
    Ok(res)
}

fn parse_long_names(param_str: &[u8]) -> Names {
    let alias_count = param_str.iter().filter(|&&c| c == b'/').count();

    if alias_count == 0 {
        if param_str.starts_with(b"--") {
            return Names {
                long: Some(to_string(&param_str[2..])),
                ..Default::default()
            };
        }
        return Names::default();
    }

    let mut primary: Option<String> = None;
    let mut aliases: Vec<String> = Vec::with_capacity(alias_count);
    for name_part in param_str.split(|&b| b == b'/') {
        if !name_part.starts_with(b"--") {
            continue;
        }
        if primary.is_none() {
            primary = Some(to_string(&name_part[2..]));
        } else {
            aliases.push(to_string(&name_part[2..]));
        }
    }

    Names {
        long: primary,
        long_aliases: aliases,
        ..Default::default()
    }
}

fn parse_param_rest(line: &[u8]) -> Param {
    'blk: {
        if !line.starts_with(b"<") {
            break 'blk;
        }
        let Some(len) = line.iter().position(|&b| b == b'>') else {
            break 'blk;
        };
        let after = &line[len + 1..];
        let takes_many = after.starts_with(b"...");
        let takes_one_optional = after.starts_with(b"?");
        let help_start = len + 1 + 3 * (takes_many as usize) + (takes_one_optional as usize);
        return Param {
            takes_value: if takes_many {
                Values::Many
            } else if takes_one_optional {
                Values::OneOptional
            } else {
                Values::One
            },
            id: Help {
                msg: to_string(trim(&line[help_start..])),
                value: to_string(&line[1..len]),
            },
            ..Default::default()
        };
    }

    Param {
        id: Help {
            msg: to_string(trim(line)),
            ..Default::default()
        },
        ..Default::default()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Code generation
// ─────────────────────────────────────────────────────────────────────────────

fn byte_str(s: &str) -> LitByteStr {
    LitByteStr::new(s.as_bytes(), Span::call_site())
}

fn byte_str_b(s: &[u8]) -> LitByteStr {
    LitByteStr::new(s, Span::call_site())
}

/// 1:1 port of `bun_core::output::pretty_fmt_runtime` — rewrites Bun's `<tag>`
/// colour markup to ANSI escape sequences when `is_enabled`, or strips it when
/// not. Run here at macro-expansion time with `is_enabled = false` so each param
/// description's tag-stripped form (`Help::msg_plain`) is a `const` byte literal
/// in rodata. The ANSI form is *not* baked in — it is rare (only `bun --help` on
/// a colour TTY) and would otherwise roughly triple the help-string rodata, so
/// `bun_clap::pretty_help_desc` derives it from `Help::msg` on demand instead.
/// (Zig did the equivalent rewrite at `comptime` via `Output.prettyFmt` inside
/// `clap.simpleHelpBunTopLevel`.)
fn pretty_rewrite(fmt: &[u8], is_enabled: bool) -> Vec<u8> {
    use bun_output_tags::{RESET, color_for_bytes};
    let mut out: Vec<u8> = Vec::with_capacity(fmt.len() * 2);
    let mut i = 0usize;
    while i < fmt.len() {
        match fmt[i] {
            b'\\' => {
                i += 1;
                if i < fmt.len() {
                    match fmt[i] {
                        b'<' | b'>' => {
                            out.push(fmt[i]);
                            i += 1;
                        }
                        _ => {
                            out.push(b'\\');
                            out.push(fmt[i]);
                            i += 1;
                        }
                    }
                }
            }
            b'>' => {
                i += 1;
            }
            b'{' => {
                while i < fmt.len() && fmt[i] != b'}' {
                    out.push(fmt[i]);
                    i += 1;
                }
            }
            b'<' => {
                i += 1;
                let mut is_reset = i < fmt.len() && fmt[i] == b'/';
                if is_reset {
                    i += 1;
                }
                let start = i;
                while i < fmt.len() && fmt[i] != b'>' {
                    i += 1;
                }
                let name = &fmt[start..i];
                let seq: &str = if let Some(c) = color_for_bytes(name) {
                    c
                } else if name == b"r" {
                    is_reset = true;
                    ""
                } else {
                    // Unknown tag: Zig's comptime `prettyFmt` would `@compileError`
                    // here, but `pretty_fmt_runtime` (the path this replaces) drops
                    // it silently and so does Zig's actual `clap.simpleHelp`. Match
                    // the lenient runtime behaviour — a compile error would be
                    // stricter than what shipped, and param specs don't carry
                    // unknown tags anyway.
                    ""
                };
                if is_enabled {
                    out.extend_from_slice(if is_reset {
                        RESET.as_bytes()
                    } else {
                        seq.as_bytes()
                    });
                }
            }
            _ => {
                out.push(fmt[i]);
                i += 1;
            }
        }
    }
    out
}

fn emit_param(krate: &Path, p: &Param) -> TokenStream2 {
    let msg = byte_str(&p.id.msg);
    // Precompute only the tag-stripped form (the non-TTY help path needs it ready
    // without a TTY check); the ANSI form is derived lazily from `msg` by
    // `bun_clap::pretty_help_desc`, so it stays out of rodata.
    let msg_plain = byte_str_b(&pretty_rewrite(p.id.msg.as_bytes(), false));
    let value = byte_str(&p.id.value);

    let short = match p.names.short {
        Some(c) => {
            let c = proc_macro2::Literal::u8_suffixed(c);
            quote! { ::core::option::Option::Some(#c) }
        }
        None => quote! { ::core::option::Option::None },
    };

    let long = match &p.names.long {
        Some(l) => {
            let l = byte_str(l);
            quote! { ::core::option::Option::Some(#l as &'static [u8]) }
        }
        None => quote! { ::core::option::Option::None },
    };

    let aliases = if p.names.long_aliases.is_empty() {
        quote! { &[] }
    } else {
        let items = p.names.long_aliases.iter().map(|a| {
            let a = byte_str(a);
            quote! { #a as &'static [u8] }
        });
        quote! { &[ #(#items),* ] }
    };

    let takes_value = match p.takes_value {
        Values::None => quote! { #krate::Values::None },
        Values::One => quote! { #krate::Values::One },
        Values::Many => quote! { #krate::Values::Many },
        Values::OneOptional => quote! { #krate::Values::OneOptional },
    };

    quote! {
        #krate::Param::<#krate::Help> {
            id: #krate::Help {
                msg: #msg,
                msg_plain: #msg_plain,
                value: #value,
            },
            names: #krate::Names {
                short: #short,
                long: #long,
                long_aliases: #aliases,
            },
            takes_value: #takes_value,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Macro entry points
// ─────────────────────────────────────────────────────────────────────────────

struct ParseParamInput {
    krate: Path,
    lit: LitStr,
}

impl Parse for ParseParamInput {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        let krate: Path = input.parse()?;
        input.parse::<Token![,]>()?;
        let lit: LitStr = input.parse()?;
        // allow optional trailing comma
        let _ = input.parse::<Token![,]>();
        Ok(Self { krate, lit })
    }
}

/// `__parse_param_impl!($crate, "…")` → const `Param<Help>` literal.
#[proc_macro]
pub fn __parse_param_impl(input: TokenStream) -> TokenStream {
    let ParseParamInput { krate, lit } = parse_macro_input!(input as ParseParamInput);
    let line = lit.value();
    match parse_param(line.as_bytes()) {
        Ok(p) => emit_param(&krate, &p).into(),
        Err(e) => syn::Error::new(lit.span(), format!("parse_param!: {}", e.msg()))
            .to_compile_error()
            .into(),
    }
}

struct ParseParamsInput {
    krate: Path,
    lits: Punctuated<LitStr, Token![;]>,
}

impl Parse for ParseParamsInput {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        let krate: Path = input.parse()?;
        input.parse::<Token![,]>()?;
        let lits = Punctuated::parse_terminated(input)?;
        Ok(Self { krate, lits })
    }
}

/// `__parse_params_impl!($crate, "…"; "…"; …)` → `&'static [Param<Help>]`.
#[proc_macro]
pub fn __parse_params_impl(input: TokenStream) -> TokenStream {
    let ParseParamsInput { krate, lits } = parse_macro_input!(input as ParseParamsInput);

    let mut items = Vec::with_capacity(lits.len());
    for lit in &lits {
        let line = lit.value();
        match parse_param(line.as_bytes()) {
            Ok(p) => items.push(emit_param(&krate, &p)),
            Err(e) => {
                return syn::Error::new(lit.span(), format!("parse_params!: {}", e.msg()))
                    .to_compile_error()
                    .into();
            }
        }
    }

    quote! {
        {
            const __PARAMS: &[#krate::Param<#krate::Help>] = &[ #(#items),* ];
            __PARAMS
        }
    }
    .into()
}
