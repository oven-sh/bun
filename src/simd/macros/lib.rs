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

/// For tokens that a macro of the caller can get: what it makes of them is linted as the caller's code.
fn parse_at(source: &str, span: Span) -> TokenStream {
    fn with_span(stream: TokenStream, span: Span) -> TokenStream {
        let set_span = |mut token| {
            if let TokenTree::Group(group) = token {
                token = Group::new(group.delimiter(), with_span(group.stream(), span)).into();
            }
            token.set_span(span);
            token
        };
        stream.into_iter().map(set_span).collect()
    }
    with_span(parse(source), span)
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

fn is_cfg_or_doc(attribute: &TokenTree) -> bool {
    let TokenTree::Group(group) = attribute else {
        return false;
    };
    let name = group.stream().into_iter().next();
    is(name.as_ref(), "cfg") || is(name.as_ref(), "doc")
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
fn map_module(item: TokenStream, f: &dyn Fn(TokenStream) -> TokenStream) -> TokenStream {
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
fn add_attributes(before: &mut Vec<TokenTree>, features: &[&str], span: Span) {
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
    let how = inline.map_or(String::new(), |at| before[at].to_string().replace(' ', ""));
    let (replacement, addition) = match (&how[..], features) {
        ("", _) => (None, "#[inline]"),
        // A portable copy is then compiled only if it is used.
        ("[inline(never)]" | "[inline(exported)]", []) => (Some("inline"), ""),
        // LLVM makes better code of what rustc has inlined already.
        ("[inline(always)]", [_, ..]) => (Some("::bun_simd::force_inline"), ""),
        // A debug build optimizes the crate of the kernels, and not that of the caller.
        ("[inline(exported)]", _) => (
            Some("cfg_attr(not(debug_assertions), inline)"),
            "#[cfg_attr(debug_assertions, inline(never))]",
        ),
        _ => (None, ""),
    };
    if let Some((at, replacement)) = inline.zip(replacement) {
        before.splice(at..=at, parse_at(&format!("[{replacement}]"), span));
    }
    let mut attributes = String::from(addition);
    for feature in features {
        attributes += &format!("#[target_feature(enable = {feature:?})]");
    }
    before.splice(start..start, parse_at(&attributes, span));
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

/// A target, and the features that this copy needs beyond it.
struct Version<'a>(Target, Vec<&'a str>);

impl<'a> Version<'a> {
    /// From `target + "feature" + .., ..`, where `portable` stands for all its widths.
    fn all_in(list: &'a str) -> Vec<Self> {
        if list.is_empty() {
            return Target::ALL.map(|it| Self(it, Vec::new())).into();
        }
        let mut all = Vec::new();
        for (name, more) in list
            .split_terminator(',')
            .map(|it| it.split_once('+').unwrap_or((it, "")))
        {
            let has_name = |it: &Target| it.arch().map_or("portable", |_| it.name()) == name;
            assert!(Target::ALL.iter().any(has_name), "`{name}` is no target");
            let more = more.split_terminator('+').map(|it| it.trim_matches('"'));
            let targets = Target::ALL.into_iter().filter(has_name);
            all.extend(targets.map(|it| Self(it, more.clone().collect())));
        }
        let needs_more = |a: &Self, b: &Self| a.1.iter().any(|it| !b.1.contains(it));
        let is_better =
            |a: &Self, b: &Self| (a.0 as u8) < b.0 as u8 || a.0 == b.0 && needs_more(a, b);
        assert!(all.is_sorted_by(is_better), "expected the best copy first");
        all
    }

    fn module(&self) -> String {
        [&[self.0.name()], &self.1[..]]
            .concat()
            .join("_")
            .replace(['.', '-'], "_")
    }

    fn features(&self) -> Vec<&'a str> {
        [self.0.features(), &self.1].concat()
    }
}

/// The arguments of `export!` that precede the signature.
fn targets_to_export(arguments: &str, versions: &[Version<'_>]) -> String {
    let (arguments, otherwise) = arguments.split_once("or=").unwrap_or((arguments, ""));
    let arguments = arguments.trim_end_matches(',');
    let has = |argument: &str| arguments.split(',').any(|it| it == argument);
    let top_of = |argument: &str| {
        let name = argument.strip_prefix("up_to=");
        Target::ALL.into_iter().find(|it| Some(it.name()) == name)
    };
    let arch_of = |argument: &str| match argument {
        "long_running" => LONG_RUNNING_ONLY.arch(),
        _ => top_of(argument)?.arch(),
    };
    let is_valid = match arguments.split_once(',') {
        Some((a, b)) => arch_of(a).zip(arch_of(b)).is_some_and(|(a, b)| a != b),
        None => matches!(arguments, "" | "baseline") || arch_of(arguments).is_some(),
    };
    assert!(
        is_valid,
        "expected `baseline`, or for each architecture `long_running` or `up_to = <target>`, then `or = <function>`"
    );
    let is_above =
        |it: &Version<'_>, top: Target| it.0.arch() == top.arch() && (it.0 as u8) < top as u8;
    let is_cut = |it| {
        arguments
            .split(',')
            .filter_map(top_of)
            .any(|top| is_above(it, top))
    };
    let [mut native, mut portable] = [const { String::new() }; 2];
    for family in versions.chunk_by(|a, b| a.0.arch() == b.0.arch()) {
        if family[0].0.arch().is_none() {
            if IS_FOR_TESTS {
                portable += "Portable64 portable64 Portable32 portable32";
            }
            continue;
        }
        let top = match has("baseline") {
            true => family.len() - 1,
            false => family.iter().take_while(|&it| is_cut(it)).count(),
        };
        for version in &family[top..] {
            let target = version.0;
            let is_wanted = match target != LONG_RUNNING_ONLY || has("long_running") {
                true => "is_allowed",
                false if IS_FOR_TESTS => "is_asked_for",
                false => continue,
            };
            let (cfg, name, features) = (target.cfg(), version.module(), version.features());
            native += &format!("{is_wanted} ({cfg}) {target:?} {name} {features:?} ");
        }
    }
    format!("native[{native}] portable_for_tests[{portable}] or[{otherwise}]")
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
fn take_exports(module: TokenStream, versions: &[Version<'_>]) -> (TokenStream, TokenStream) {
    let (mut body, mut exports) = (Vec::new(), TokenStream::new());
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
                body.push(token);
                continue;
            }
        };
        rest.next();
        let count = body.rchunks(2).take_while(|it| is(it.first(), "#")).count();
        let earlier = body[body.len() - 2 * count..].chunks(2);
        let mut export = parse_at(&targets_to_export(&arguments, versions), token.span());
        export.extend(
            earlier
                .filter(|it| is_cfg_or_doc(&it[1]))
                .flatten()
                .cloned(),
        );

        let signature = std::iter::from_fn(|| rest.next_if(|t| !is_group(t, Delimiter::Brace)));
        let signature: Vec<TokenTree> = signature.collect();
        let inline = signature.iter().find(|it| is_inline(it));
        let inline = match inline.map(|it| it.to_string()).as_deref() {
            None => "#[inline(never)]",
            Some("[inline]") => "#[inline(exported)]",
            Some(other) => panic!("expected `#[inline]` on an export, not `#{other}`"),
        };
        body.extend(parse_at(inline, token.span()));
        body.extend(without_inline(&signature).cloned());
        export.extend(signature_to_export(&signature));
        exports.extend(block("::bun_simd::export!", export));
    }
    (body.into_iter().collect(), exports)
}

/// On its own, so that no other token of a macro may name an attribute of `rustc_attrs`.
#[proc_macro_attribute]
#[allow_internal_unstable(rustc_attrs)]
pub fn force_inline(_: TokenStream, item: TokenStream) -> TokenStream {
    TokenStream::from_iter([parse("#[rustc_force_inline]"), item])
}

/// Compiles the module once per target, with the types of that target as `isa`. See the README.
#[proc_macro_attribute]
pub fn foreach_target(list: TokenStream, item: TokenStream) -> TokenStream {
    let list = list.to_string().replace([' ', '\n'], "");
    let versions = Version::all_in(&list);
    map_module(item, &|module| {
        let (body, exports) = take_exports(module, &versions);
        let mut out = parse("#![allow(unreachable_pub)] #[allow(unused_imports)] use super::*;");
        for (i, version) in versions.iter().enumerate() {
            let (target, name) = (version.0, version.0.name());
            let mut copy = TokenStream::new();
            // The dead code is reported by copies that all exports refer to.
            let reports = match list.is_empty() {
                true => target == Target::Portable,
                false => {
                    target.arch().is_some()
                        && target.arch() != versions.get(i + 1).and_then(|it| it.0.arch())
                }
            };
            if !reports {
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
            copy.extend(enable_features(body, &version.features()));
            let cfg = match target {
                // Elsewhere, nothing else checks that the module compiles for these widths.
                Target::Portable64 | Target::Portable32 if !IS_FOR_TESTS => {
                    "not(target_arch = \"x86_64\")"
                }
                _ => target.cfg(),
            };
            let head = format!("#[cfg({cfg})] pub mod {}", version.module());
            out.extend(block(&head, copy));
        }
        out.extend(exports);
        out
    })
}

/// Compiles a nested module as `full` and `x128`, or for the widths in the arguments.
#[proc_macro_attribute]
pub fn foreach_width(widths: TokenStream, item: TokenStream) -> TokenStream {
    let widths: &[&str] = match &widths.to_string().replace(' ', "")[..] {
        "" => &["full", "x128"],
        "x128,x256" => &["x128", "x256"],
        "full,x128,x256" => &["full", "x128", "x256"],
        _ => panic!("expected nothing, `x128, x256` or `full, x128, x256`"),
    };
    map_module(item, &|module| {
        let copy = |&name| {
            let mut copy = parse("#[allow(unused_imports)] use super::super::*;");
            let longer = |isa: Ident| parse_at(&format!("isa::{name}"), isa.span());
            copy.extend(match name {
                "full" => module.clone(),
                _ => replace_ident(module.clone(), "isa", &longer),
            });
            block(&format!("pub mod {name}"), copy)
        };
        widths.iter().map(copy).collect()
    })
}
