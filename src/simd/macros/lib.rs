//! Copies source text once per target. Emits no `unsafe`, so rustc checks all of it.
#![forbid(unsafe_code)]
#![allow(clippy::disallowed_methods)] // proc-macro: compile-time input
use bun_simd_trusted::gate::TARGETS;
use proc_macro::{Delimiter, Group, Ident, TokenStream, TokenTree as T};

const LONG_RUNNING_ONLY: &str = "avx512_skx";
const FOR_TESTS: [&str; 2] = ["portable64", "portable32"];

fn features_of(target: &str) -> String {
    match TARGETS.iter().find(|(name, ..)| *name == target) {
        Some((_, _, features)) => features.join(","),
        None if target == "portable" => String::new(),
        None => panic!("no such target: {target}"),
    }
}

fn tokens(source: &str) -> TokenStream {
    source.parse().unwrap()
}

fn is(token: Option<&T>, text: &str) -> bool {
    match token {
        Some(T::Ident(i)) => i.to_string() == text,
        Some(T::Punct(p)) => p.to_string() == text,
        _ => false,
    }
}

fn is_group(token: &T, delimiter: Delimiter) -> bool {
    matches!(token, T::Group(g) if g.delimiter() == delimiter)
}

fn is_inline(attribute: &T) -> bool {
    attribute.to_string().starts_with("[inline")
}

fn regroup(group: &Group, stream: TokenStream) -> T {
    let mut new = Group::new(group.delimiter(), stream);
    new.set_span(group.span());
    T::Group(new)
}

fn braces(stream: TokenStream) -> T {
    T::Group(Group::new(Delimiter::Brace, stream))
}

/// `mod name`, and what is between the braces.
fn split_module(item: TokenStream) -> (Vec<T>, Group) {
    let mut item: Vec<T> = item.into_iter().collect();
    match item.pop() {
        Some(T::Group(body)) => (item, body),
        _ => panic!("expected `mod name {{ .. }}`"),
    }
}

/// Where the item starts whose `fn` is about to follow `before`: in front of its visibility.
fn item_start(before: &[T]) -> usize {
    match before {
        [.., a, b] if is(Some(a), "pub") && is_group(b, Delimiter::Parenthesis) => before.len() - 2,
        [.., a, b] if is(Some(a), "$") && is(Some(b), "vis") => before.len() - 2,
        [.., a] if is(Some(a), "pub") => before.len() - 1,
        _ => before.len(),
    }
}

fn has_inline(before: &[T]) -> bool {
    before
        .rchunks(2)
        .take_while(|pair| is(pair.first(), "#"))
        .any(|pair| is_inline(&pair[1]))
}

/// Gives the features to every `fn` but `const fn`, in the bodies of `macro_rules!` too.
fn with_features(
    stream: TokenStream,
    features: &str,
    rename: &dyn Fn(&str) -> Option<String>,
) -> TokenStream {
    let input: Vec<T> = stream.into_iter().collect();
    let mut out: Vec<T> = Vec::new();
    for (i, token) in input.iter().enumerate() {
        match token {
            T::Group(g) => out.push(regroup(g, with_features(g.stream(), features, rename))),
            T::Ident(ident) => {
                let next = input.get(i + 1);
                let has_name = matches!(next, Some(T::Ident(_))) || is(next, "$");
                if is(Some(token), "fn") && has_name && !is(out.last(), "const") {
                    let start = item_start(&out);
                    let mut attributes = TokenStream::new();
                    if !has_inline(&out[..start]) {
                        attributes.extend(tokens("#[inline]"));
                    }
                    if !features.is_empty() {
                        let enable = format!("#[target_feature(enable = {features:?})]");
                        attributes.extend(tokens(&enable));
                    }
                    out.splice(start..start, attributes);
                }
                out.push(match rename(&ident.to_string()) {
                    Some(name) => T::Ident(Ident::new(&name, ident.span())),
                    None => token.clone(),
                });
            }
            _ => out.push(token.clone()),
        }
    }
    out.into_iter().collect()
}

/// By how much `token` changes the depth of angle brackets. The `>` of `->` is none.
fn angle(token: &T, before: Option<&T>) -> i32 {
    i32::from(is(Some(token), "<")) - i32::from(is(Some(token), ">") && !is(before, "-"))
}

/// `a: A, b: B` becomes `A, B`.
fn types_of(parameters: TokenStream) -> TokenStream {
    let (mut types, mut in_type, mut depth) = (Vec::new(), false, 0);
    for token in parameters {
        depth += angle(&token, types.last());
        let starts = !in_type && is(Some(&token), ":");
        let ends = depth == 0 && is(Some(&token), ",");
        if in_type {
            types.push(token);
        }
        in_type = (in_type || starts) && !ends;
    }
    types.into_iter().collect()
}

/// `#[inline(always)] fn f(a: A) -> R` becomes `fn f() -> impl FnOnce(A) -> R`.
fn always_inline(stream: TokenStream, names: &mut Vec<String>) -> TokenStream {
    let input: Vec<T> = stream.into_iter().collect();
    let mut out: Vec<T> = Vec::new();
    let mut i = 0;
    while let Some(token) = input.get(i) {
        let is_always =
            is(Some(token), "#") && input[i + 1].to_string().replace(' ', "") == "[inline(always)]";
        if !is_always {
            out.push(match token {
                T::Group(g) => regroup(g, always_inline(g.stream(), names)),
                _ => token.clone(),
            });
            i += 1;
            continue;
        }
        let name = 1 + (i..).find(|&at| is(Some(&input[at]), "fn")).unwrap();
        let mut depth = 0;
        let mut after_generics = |from: usize, delimiter| {
            let found = (from..).find(|&at| {
                depth += angle(&input[at], input.get(at - 1));
                depth == 0 && is_group(&input[at], delimiter)
            });
            found.unwrap()
        };
        let parameters_at = after_generics(name, Delimiter::Parenthesis);
        let body = after_generics(parameters_at, Delimiter::Brace);
        let T::Group(parameters) = &input[parameters_at] else {
            unreachable!()
        };
        let returns = &input[parameters_at + 1..body];

        // rustc refuses it next to `#[target_feature]`, but takes it on a closure in there.
        let mut closure = tokens("#[inline(always)] move |");
        closure.extend(parameters.stream());
        closure.extend(tokens("|"));
        closure.extend(returns.iter().cloned());
        closure.extend([input[body].clone()]);

        names.push(input[name].to_string());
        out.extend(input[i + 2..parameters_at].iter().cloned());
        out.extend(tokens("() -> impl FnOnce"));
        out.push(regroup(parameters, types_of(parameters.stream())));
        out.extend(returns.iter().cloned());
        out.push(braces(closure));
        i = body + 1;
    }
    out.into_iter().collect()
}

/// `f(..)` becomes `f()(..)`.
fn call_through(stream: TokenStream, names: &[String]) -> TokenStream {
    let mut out: Vec<T> = Vec::new();
    for token in stream {
        let T::Group(g) = &token else {
            out.push(token);
            continue;
        };
        let before = out.len().checked_sub(2).map(|at| &out[at]);
        let is_call = g.delimiter() == Delimiter::Parenthesis
            && names.iter().any(|name| is(out.last(), name));
        if is_call && !is(before, "fn") && !is(before, ".") {
            out.extend(tokens("()"));
        }
        out.push(regroup(g, call_through(g.stream(), names)));
    }
    out.into_iter().collect()
}

/// `#[ops(avx2)]` gives an item the features. `#[ops(avx2, 256)]` makes `_mm256_` of `_mm_` too.
#[proc_macro_attribute]
pub fn ops(arguments: TokenStream, item: TokenStream) -> TokenStream {
    let mut arguments = arguments.into_iter().step_by(2).map(|t| t.to_string());
    let (target, bits) = (arguments.next().unwrap(), arguments.next());
    let rename = |name: &str| {
        let (bits, op) = (bits.as_deref()?, name.strip_prefix("_mm_")?);
        let op = op.replace("si128", &format!("si{bits}"));
        (bits != "128").then(|| format!("_mm{bits}_{op}"))
    };
    with_features(item, &features_of(&target), &rename)
}

/// The arguments of `export!` in front of the signature.
fn targets_to_export(arguments: &str) -> TokenStream {
    let up_to = arguments.strip_prefix("up_to=");
    assert!(
        matches!(arguments, "" | "long_running" | "baseline")
            || TARGETS.iter().any(|(name, ..)| Some(*name) == up_to),
        "expected `long_running`, `baseline` or `up_to = <target>`"
    );
    let (mut best, mut all, mut on_request) = (String::new(), String::new(), String::new());
    for of_arch in TARGETS.chunk_by(|a, b| a.1 == b.1) {
        let from = match arguments {
            "baseline" => of_arch.len() - 1,
            _ => (of_arch.iter().position(|(name, ..)| Some(*name) == up_to)).unwrap_or(0),
        };
        let mut has_best = false;
        for (name, arch, _) in &of_arch[from..] {
            if *name == LONG_RUNNING_ONLY && arguments != "long_running" {
                on_request += &format!("{arch:?} {name} ");
                continue;
            }
            all += &format!("{arch:?} {name} ");
            if !std::mem::replace(&mut has_best, true) {
                best += &format!("{name} ");
            }
        }
    }
    tokens(&format!("best[{best}] all[{all}] on_request[{on_request}]"))
}

/// The signature of the function that dispatches, which changes no argument and is always inlined.
fn signature_to_export(signature: &[T]) -> impl Iterator<Item = T> {
    let is_inline_at = |i: usize| signature.get(i).is_some_and(is_inline);
    let kept = (0..signature.len()).filter(move |&i| !is_inline_at(i) && !is_inline_at(i + 1));
    kept.map(|i| match &signature[i] {
        T::Group(g) if g.delimiter() == Delimiter::Parenthesis => {
            let list: Vec<T> = g.stream().into_iter().collect();
            let is_binding = |i: usize| i == 0 || is(list.get(i - 1), ",");
            let kept = (0..list.len()).filter(|&i| !(is(list.get(i), "mut") && is_binding(i)));
            regroup(g, kept.map(|i| list[i].clone()).collect())
        }
        token => token.clone(),
    })
}

/// Compiles the module once per target, with the ops of that target as `isa`. See the README.
#[proc_macro_attribute]
pub fn foreach_target(_: TokenStream, item: TokenStream) -> TokenStream {
    let (mut item, module) = split_module(item);

    let mut body: Vec<T> = Vec::new();
    let mut exports = TokenStream::new();
    let mut rest = module.stream().into_iter().peekable();
    while let Some(token) = rest.next() {
        let attribute: Vec<T> = match rest.peek() {
            Some(T::Group(g)) if is(Some(&token), "#") => g.stream().into_iter().collect(),
            _ => Vec::new(),
        };
        let arguments = match &attribute[..] {
            [name] if is(Some(name), "export") => String::new(),
            [name, T::Group(g)] if is(Some(name), "export") => {
                g.stream().to_string().replace(' ', "")
            }
            _ => {
                body.push(token);
                continue;
            }
        };
        rest.next();
        let mut signature: Vec<T> = Vec::new();
        while let Some(token) = rest.next_if(|t| !is_group(t, Delimiter::Brace)) {
            signature.push(token);
        }
        if !signature.iter().any(is_inline) {
            body.extend(tokens("#[inline(never)]"));
        }
        body.extend(signature.iter().cloned());

        let mut call = targets_to_export(&arguments);
        call.extend(signature_to_export(&signature));
        exports.extend(tokens("::bun_simd::export!"));
        exports.extend([braces(call)]);
    }

    let mut names = Vec::new();
    let body = always_inline(body.into_iter().collect(), &mut names);
    let body = call_through(body, &names);

    // Every export names the portable copy, so it speaks for all about what is dead.
    let copy = |target: &str, features: &str| {
        let allowed = if target == "portable" {
            ""
        } else {
            "dead_code"
        };
        let mut copy = tokens(&format!(
            "#![allow({allowed})]
            #[allow(unused_imports)] use {{super::super::*, ::bun_simd::{target} as isa}};"
        ));
        let rename = |name: &str| (name == "this_target").then(|| target.to_owned());
        copy.extend(with_features(body.clone(), features, &rename));
        let mut module = tokens(&format!("pub mod {target}"));
        module.extend([braces(copy)]);
        module
    };
    let mut out = tokens("#![allow(unreachable_pub)] #[allow(unused_imports)] use super::*;");
    for (target, arch, features) in TARGETS {
        out.extend(tokens(&format!("#[cfg(target_arch = {arch:?})]")));
        out.extend(copy(target, &features.join(",")));
    }
    out.extend(copy("portable", ""));
    for target in FOR_TESTS {
        out.extend(tokens("::bun_simd::for_tests!"));
        out.extend([braces(copy(target, ""))]);
    }
    out.extend(exports);
    item.push(regroup(&module, out));
    item.into_iter().collect()
}

fn for_128_bits(stream: TokenStream) -> TokenStream {
    let replace = |token| match token {
        T::Group(g) => regroup(&g, for_128_bits(g.stream())).into(),
        token if is(Some(&token), "isa") => {
            TokenStream::from_iter([token.into(), tokens("::x128")])
        }
        token => token.into(),
    };
    stream.into_iter().map(replace).collect()
}

/// Compiles a module in there as `full`, for whole vectors, and as `x128`, for 128 bits.
#[proc_macro_attribute]
pub fn foreach_width(_: TokenStream, item: TokenStream) -> TokenStream {
    let (mut item, module) = split_module(item);
    let mut out = TokenStream::new();
    for (name, body) in [
        ("full", module.stream()),
        ("x128", for_128_bits(module.stream())),
    ] {
        let mut copy = tokens("#[allow(unused_imports)] use super::super::*;");
        copy.extend(body);
        out.extend(tokens(&format!("pub mod {name}")));
        out.extend([braces(copy)]);
    }
    item.push(regroup(&module, out));
    item.into_iter().collect()
}
