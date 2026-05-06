//! Proc-macros for `bun_core`.
//!
//! `pretty_fmt!(FMT, true|false)` is the compile-time port of Zig's
//! `Output.prettyFmt` (`src/bun_core/output.zig`). It rewrites Bun's `<tag>`
//! color markup into ANSI escape sequences (or strips them when the second
//! argument is `false`) and emits a string *literal* so the result is usable as
//! a `format_args!` / `concat!` template.
//!
//! The first argument may be a string literal, or a `concat!(..)` /
//! `stringify!(..)` tree built from string literals — those are evaluated here
//! so wrapper macros (`scoped_log!`, `note!`, …) can compose the template at
//! the call site.

use proc_macro::TokenStream;
use proc_macro2::Span;
use quote::quote;
use syn::{
    parse::{Parse, ParseStream, Parser},
    parse_macro_input, Expr, ExprLit, ExprMacro, Lit, LitBool, LitStr, Token,
};

struct PrettyFmtInput {
    fmt: Expr,
    enabled: bool,
}

impl Parse for PrettyFmtInput {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        let fmt: Expr = input.parse()?;
        input.parse::<Token![,]>()?;
        let enabled: LitBool = input.parse()?;
        // tolerate trailing comma
        if input.peek(Token![,]) {
            input.parse::<Token![,]>()?;
        }
        Ok(PrettyFmtInput { fmt, enabled: enabled.value })
    }
}

/// Recursively flatten a string-literal / `concat!` / `stringify!` expression
/// into a single owned `String`. Anything else is a compile error.
fn eval_literal(expr: &Expr, out: &mut String) -> Result<(), syn::Error> {
    match expr {
        Expr::Lit(ExprLit { lit: Lit::Str(s), .. }) => {
            out.push_str(&s.value());
            Ok(())
        }
        Expr::Group(g) => eval_literal(&g.expr, out),
        Expr::Paren(p) => eval_literal(&p.expr, out),
        Expr::Macro(ExprMacro { mac, .. }) => {
            if mac.path.is_ident("concat") {
                let parser = syn::punctuated::Punctuated::<Expr, Token![,]>::parse_terminated;
                let parts = parser.parse2(mac.tokens.clone())?;
                for part in parts {
                    eval_literal(&part, out)?;
                }
                Ok(())
            } else if mac.path.is_ident("stringify") {
                out.push_str(&mac.tokens.to_string());
                Ok(())
            } else {
                Err(syn::Error::new_spanned(
                    expr,
                    "pretty_fmt!: format argument must be a string literal, concat!(), or stringify!()",
                ))
            }
        }
        _ => Err(syn::Error::new_spanned(
            expr,
            "pretty_fmt!: format argument must be a string literal, concat!(), or stringify!()",
        )),
    }
}

/// ANSI escape for a `<tag>` body. `None` → unknown tag (compile error).
fn color_for(name: &str) -> Option<&'static str> {
    // Keep in sync with `COLOR_MAP` in src/bun_core/output.rs and
    // `color_map` in src/bun_core/output.zig.
    Some(match name {
        "b" => "\x1b[1m",
        "d" => "\x1b[2m",
        "i" => "\x1b[3m",
        "u" => "\x1b[4m",
        "black" => "\x1b[30m",
        "red" => "\x1b[31m",
        "green" => "\x1b[32m",
        "yellow" => "\x1b[33m",
        "blue" => "\x1b[34m",
        "magenta" => "\x1b[35m",
        "cyan" => "\x1b[36m",
        "white" => "\x1b[37m",
        "bgred" => "\x1b[41m",
        "bggreen" => "\x1b[42m",
        _ => return None,
    })
}

const RESET: &str = "\x1b[0m";

/// 1:1 port of `prettyFmt` from output.zig, plus Zig→Rust format-spec rewrites
/// (`{s}`/`{d}` → `{}`, `{any}`/`{?}` → `{:?}`).
fn rewrite(fmt: &str, is_enabled: bool) -> Result<String, String> {
    let bytes = fmt.as_bytes();
    let mut out = String::with_capacity(bytes.len() * 2);
    let mut i = 0usize;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => {
                i += 1;
                if i < bytes.len() {
                    match bytes[i] {
                        b'<' | b'>' => {
                            out.push(bytes[i] as char);
                            i += 1;
                        }
                        _ => {
                            out.push('\\');
                            out.push(bytes[i] as char);
                            i += 1;
                        }
                    }
                }
            }
            b'>' => {
                // stray closer — Zig drops it
                i += 1;
            }
            b'{' => {
                // copy `{ ... }` verbatim, optionally rewriting Zig-style specs
                let start = i;
                while i < bytes.len() && bytes[i] != b'}' {
                    i += 1;
                }
                // bytes[start..i] is `{spec`, bytes[i] is `}` (or EOF)
                let spec = &fmt[start..i];
                match spec {
                    "{s" | "{d" | "{f" => out.push('{'),
                    "{any" | "{?" => out.push_str("{:?"),
                    _ => out.push_str(spec),
                }
                // `}` (if present) falls through to the `else` arm next iteration
            }
            b'<' => {
                i += 1;
                let mut is_reset = i < bytes.len() && bytes[i] == b'/';
                if is_reset {
                    i += 1;
                }
                let start = i;
                while i < bytes.len() && bytes[i] != b'>' {
                    i += 1;
                }
                let name = &fmt[start..i];
                let seq: &str = if let Some(c) = color_for(name) {
                    c
                } else if name == "r" {
                    is_reset = true;
                    ""
                } else {
                    return Err(format!("invalid color name passed to pretty_fmt!: <{name}>"));
                };
                if is_enabled {
                    out.push_str(if is_reset { RESET } else { seq });
                }
                // trailing `>` consumed by the `'>'` arm next iteration
            }
            _ => {
                // Preserve full UTF-8: push the char at this byte position.
                let ch = fmt[i..].chars().next().unwrap();
                out.push(ch);
                i += ch.len_utf8();
                continue;
            }
        }
    }
    Ok(out)
}

/// `pretty_fmt!("<red>hi {s}<r>", true)` → `"\u{1b}[31mhi {}\u{1b}[0m"`
/// `pretty_fmt!("<red>hi {s}<r>", false)` → `"hi {}"`
///
/// Expands to a string literal — valid in `format_args!` / `concat!` position.
#[proc_macro]
pub fn pretty_fmt(input: TokenStream) -> TokenStream {
    let PrettyFmtInput { fmt, enabled } = parse_macro_input!(input as PrettyFmtInput);

    let mut template = String::new();
    if let Err(e) = eval_literal(&fmt, &mut template) {
        return e.to_compile_error().into();
    }

    match rewrite(&template, enabled) {
        Ok(s) => {
            let lit = LitStr::new(&s, Span::call_site());
            quote!(#lit).into()
        }
        Err(msg) => syn::Error::new_spanned(&fmt, msg).to_compile_error().into(),
    }
}
