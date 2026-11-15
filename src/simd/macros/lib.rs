//! Copies source text once per target. Emits no `unsafe`, so rustc checks all of it.
#![feature(allow_internal_unstable)]
#![allow(internal_features)]
#![forbid(unsafe_code)]
#![allow(clippy::disallowed_methods)] // proc-macro: compile-time input
use bun_simd_trusted::Target;
use proc_macro::{Delimiter, Group, Ident, Span, TokenStream, TokenTree};

const LONG_RUNNING_ONLY: Target = Target::Avx512Skx;
const IS_FOR_TESTS: bool = cfg!(feature = "test_support");

fn parse(source: &str) -> TokenStream {
    source.parse().unwrap()
}

fn is(token: Option<&TokenTree>, text: &str) -> bool {
    match token {
        Some(TokenTree::Ident(ident)) => ident.to_string() == text,
        Some(TokenTree::Punct(punct)) => punct.to_string() == text,
        _ => false,
    }
}

fn is_group(token: &TokenTree, delimiter: Delimiter) -> bool {
    matches!(token, TokenTree::Group(group) if group.delimiter() == delimiter)
}

fn is_inline(attribute: &TokenTree) -> bool {
    attribute.to_string().starts_with("[inline")
}

fn with_stream(group: &Group, stream: TokenStream) -> TokenTree {
    assert!(
        group.delimiter() != Delimiter::None || group.stream().into_iter().count() <= 1,
        "`{group}` comes from a macro, and rustc would not keep its tokens together here"
    );
    let mut new = Group::new(group.delimiter(), stream);
    new.set_span(group.span());
    new.into()
}

/// `head { body }`
fn block(head: &str, body: TokenStream) -> TokenStream {
    let mut block = parse(head);
    block.extend([TokenTree::from(Group::new(Delimiter::Brace, body))]);
    block
}

/// Replaces the body of `mod name { .. }`.
fn map_module(item: TokenStream, f: fn(TokenStream) -> TokenStream) -> TokenStream {
    let mut item: Vec<TokenTree> = item.into_iter().collect();
    let is_module = is(item.iter().nth_back(2), "mod");
    let (true, Some(TokenTree::Group(body))) = (is_module, item.pop()) else {
        panic!("expected `mod name {{ .. }}`");
    };
    item.push(with_stream(&body, f(body.stream())));
    item.into_iter().collect()
}

fn replace_ident(
    stream: TokenStream,
    name: &str,
    with: &dyn Fn(Ident) -> TokenStream,
) -> TokenStream {
    let replace = |token| match token {
        TokenTree::Group(group) => {
            with_stream(&group, replace_ident(group.stream(), name, with)).into()
        }
        TokenTree::Ident(ident) if ident.to_string() == name => with(ident),
        token => token.into(),
    };
    stream.into_iter().map(replace).collect()
}

/// `before` has the tokens up to the `fn` of a function.
fn add_attributes(before: &mut Vec<TokenTree>, features: &[&str], span_of_fn: Span) {
    let start = match &before[..] {
        [.., a, b] if is(Some(a), "pub") && is_group(b, Delimiter::Parenthesis) => before.len() - 2,
        [.., a, _] if is(Some(a), "$") => before.len() - 2,
        [.., a] if is(Some(a), "pub") => before.len() - 1,
        _ => before.len(),
    };
    let inline = (1..start)
        .rev()
        .step_by(2)
        .take_while(|&at| is(before.get(at - 1), "#"))
        .find(|&at| is_inline(&before[at]));
    let replacement = match inline.map(|at| before[at].to_string()) {
        // rustc refuses `#[inline(always)]` next to `#[target_feature]`.
        Some(how) if how.contains("always") && !features.is_empty() => Some("rustc_force_inline"),
        // A portable copy is then compiled only if it is used.
        Some(how) if how.contains("never") && features.is_empty() => Some("inline"),
        _ => None,
    };
    if let Some((at, replacement)) = inline.zip(replacement) {
        before[at] = Group::new(Delimiter::Bracket, parse(replacement)).into();
    }
    let mut attributes = String::from(if inline.is_none() { "#[inline]" } else { "" });
    for feature in features {
        attributes += &format!("#[target_feature(enable = {feature:?})]");
    }
    let mut attributes: Vec<TokenTree> = parse(&attributes).into_iter().collect();
    // With a `#` from here, a macro in the module could write any attribute of `rustc_attrs`.
    for hash in attributes.iter_mut().step_by(2) {
        hash.set_span(span_of_fn);
    }
    before.splice(start..start, attributes);
}

/// On every `fn` except `const fn` and trait methods, which cannot have them.
fn enable_features(stream: TokenStream, features: &[&str]) -> TokenStream {
    let mut out: Vec<TokenTree> = Vec::new();
    let (mut is_impl, mut is_of_trait) = (false, false);
    let mut rest = stream.into_iter().peekable();
    while let Some(token) = rest.next() {
        let at = |text| is(Some(&token), text);
        let has_name = matches!(rest.peek(), Some(TokenTree::Ident(_))) || is(rest.peek(), "$");
        let is_function = at("fn") && has_name;
        is_impl = !is_function && (is_impl || at("impl"));
        is_of_trait |= at("trait") || is_impl && at("for") && !is(rest.peek(), "<");
        if is_function && !is(out.last(), "const") {
            add_attributes(&mut out, features, token.span());
        }
        let is_argument = is(rest.peek(), ">") || is(rest.peek(), ",");
        let ends_item = is_group(&token, Delimiter::Brace) && !is_argument || at(";");
        out.push(match &token {
            TokenTree::Group(group) if !is_of_trait => {
                with_stream(group, enable_features(group.stream(), features))
            }
            _ => token,
        });
        if ends_item {
            (is_impl, is_of_trait) = (false, false);
        }
    }
    out.into_iter().collect()
}

/// The arguments of `export!` that precede the signature.
fn targets_to_export(arguments: &str) -> TokenStream {
    let up_to = arguments.strip_prefix("up_to=");
    let is_top = |target: &Target| target.arch().is_some() && Some(target.name()) == up_to;
    assert!(
        matches!(arguments, "" | "long_running" | "baseline") || Target::ALL.iter().any(is_top),
        "expected `long_running`, `baseline` or `up_to = <target>`"
    );
    let [mut best, mut native, mut portable] = [const { String::new() }; 3];
    for family in Target::ALL.chunk_by(|a, b| a.arch() == b.arch()) {
        let Some(arch) = family[0].arch() else {
            continue;
        };
        let top = match arguments {
            "baseline" => family.len() - 1,
            _ => family.iter().position(is_top).unwrap_or(0),
        };
        let mut has_best = false;
        for &target in &family[top..] {
            let is_default = target != LONG_RUNNING_ONLY || arguments == "long_running";
            if is_default && !has_best {
                best += &format!("{target:?} ");
                has_best = true;
            }
            if is_default || IS_FOR_TESTS {
                let is_wanted = if is_default {
                    "is_allowed"
                } else {
                    "is_asked_for"
                };
                let (name, features) = (target.name(), target.features());
                native += &format!("{is_wanted} {arch:?} {target:?} {name} {features:?} ");
            }
        }
    }
    if IS_FOR_TESTS {
        portable += "Portable64 portable64 Portable32 portable32";
    }
    parse(&format!(
        "best[{best}] native[{native}] portable_for_tests[{portable}]"
    ))
}

fn without_inline(signature: &[TokenTree]) -> impl Iterator<Item = &TokenTree> {
    let is_inline_at = |i: usize| signature.get(i).is_some_and(is_inline);
    let kept = (0..signature.len()).filter(move |&i| !is_inline_at(i) && !is_inline_at(i + 1));
    kept.map(|i| &signature[i])
}

/// Drops `#[inline]` and the `mut` of parameters.
fn signature_to_export(signature: &[TokenTree]) -> impl Iterator<Item = TokenTree> {
    without_inline(signature).map(|token| match token {
        TokenTree::Group(group) if group.delimiter() == Delimiter::Parenthesis => {
            let list: Vec<TokenTree> = group.stream().into_iter().collect();
            let is_binding = |i: usize| i == 0 || is(list.get(i - 1), ",");
            let kept = (0..list.len()).filter(|&i| !(is(list.get(i), "mut") && is_binding(i)));
            with_stream(group, kept.map(|i| list[i].clone()).collect())
        }
        token => token.clone(),
    })
}

/// Returns the module without `#[export]`, and the functions that dispatch.
fn take_exports(module: TokenStream) -> (TokenStream, TokenStream) {
    let (mut body, mut exports) = (TokenStream::new(), TokenStream::new());
    let mut rest = module.into_iter().peekable();
    while let Some(token) = rest.next() {
        let attribute: Vec<TokenTree> = match rest.peek() {
            Some(TokenTree::Group(group)) if is(Some(&token), "#") => {
                group.stream().into_iter().collect()
            }
            _ => Vec::new(),
        };
        let arguments = match &attribute[..] {
            [name] if is(Some(name), "export") => String::new(),
            [name, TokenTree::Group(group)] if is(Some(name), "export") => {
                group.stream().to_string().replace(' ', "")
            }
            _ => {
                body.extend([token]);
                continue;
            }
        };
        rest.next();
        let signature = std::iter::from_fn(|| rest.next_if(|t| !is_group(t, Delimiter::Brace)));
        let signature: Vec<TokenTree> = signature.collect();
        body.extend(parse(match signature.iter().any(is_inline) {
            // A debug build optimizes the crate of the kernels, and not that of the caller.
            true => "#[cfg_attr(debug_assertions, inline(never))] #[cfg_attr(not(debug_assertions), inline)]",
            false => "#[inline(never)]",
        }));
        body.extend(without_inline(&signature).cloned());

        let mut export = targets_to_export(&arguments);
        export.extend(signature_to_export(&signature));
        exports.extend(block("::bun_simd::export!", export));
    }
    (body, exports)
}

/// Compiles the module once per target, with the types of that target as `isa`. See the README.
#[proc_macro_attribute]
#[allow_internal_unstable(rustc_attrs)]
pub fn foreach_target(_: TokenStream, item: TokenStream) -> TokenStream {
    map_module(item, |module| {
        let (body, exports) = take_exports(module);
        let mut out = parse("#![allow(unreachable_pub)] #[allow(unused_imports)] use super::*;");
        for target in Target::ALL {
            let name = target.name();
            if let Some(arch) = target.arch() {
                out.extend(parse(&format!("#[cfg(target_arch = {arch:?})]")));
            } else if target != Target::Portable && !IS_FOR_TESTS {
                // Elsewhere, nothing else checks that the module compiles for these widths.
                out.extend(parse("#[cfg(not(target_arch = \"x86_64\"))]"));
            }
            let mut copy = TokenStream::new();
            // Every export refers to the portable copy, so that one reports the dead code.
            if target != Target::Portable {
                copy.extend(parse("#![allow(dead_code)]"));
            }
            // The other copies need `|v| f(v)`: a function with features is no `impl Fn`.
            if target.arch().is_none() {
                copy.extend(parse("#![allow(clippy::redundant_closure)]"));
            }
            copy.extend(parse(&format!(
                "#[allow(unused_imports)] use {{super::super::*, ::bun_simd::{name} as isa}};"
            )));
            let with_name = |ident: Ident| TokenTree::from(Ident::new(name, ident.span())).into();
            let body = replace_ident(body.clone(), "this_target", &with_name);
            copy.extend(enable_features(body, target.features()));
            out.extend(block(&format!("pub mod {name}"), copy));
        }
        out.extend(exports);
        out
    })
}

/// Compiles a nested module as `full`, for whole vectors, and as `x128`, for 128 bits.
#[proc_macro_attribute]
pub fn foreach_width(_: TokenStream, item: TokenStream) -> TokenStream {
    map_module(item, |module| {
        let with_x128 =
            |isa| TokenStream::from_iter([TokenTree::from(isa).into(), parse("::x128")]);
        let x128 = replace_ident(module.clone(), "isa", &with_x128);
        let copy = |(name, body)| {
            let mut copy = parse("#[allow(unused_imports)] use super::super::*;");
            copy.extend([body]);
            block(&format!("pub mod {name}"), copy)
        };
        [("full", module), ("x128", x128)]
            .into_iter()
            .map(copy)
            .collect()
    })
}
