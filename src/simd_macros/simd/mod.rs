//! #[simd] and #[kernel]. Nothing here is trusted: it writes safe code.
use proc_macro::{Delimiter as D, Ident, Punct, Spacing, Span, TokenStream};
use std::cell::{Cell, RefCell};
use std::hash::{BuildHasher, BuildHasherDefault, DefaultHasher};
mod closures;
mod fragments;
mod function;
mod kernel;
mod lengths;
mod only;
mod plain;
mod refused;
mod tree;
use tree::{Group, T, trees};
use {closures::*, fragments::*, function::*, only::*, refused::kernel};
pub use {only::twins, plain::derive};
type V = Vec<T>;
const KEYWORDS: &str = "fn impl mod struct enum union trait type const static use extern macro_rules";

thread_local! {
    static ROOT: Cell<Option<Span>> = Cell::default();
    static KRATE: std::cell::RefCell<V> = Default::default();
    /// Those of the module.
    static KERNELS: RefCell<String> = Default::default();
    /// In the rules or the arguments of a macro, which can end up in an impl.
    static IN_MACRO: Cell<bool> = Cell::default();
    static IN_RULES: Cell<bool> = Cell::default();
    static TEMPLATES: RefCell<std::collections::HashMap<String, std::rc::Rc<V>>> = Default::default();
}
fn root() -> Span {
    ROOT.get().unwrap()
}
/// Whether a macro has written the token. An editor makes no code.
fn written(t: &T) -> bool {
    let editor = || {
        std::env::current_exe().is_ok_and(|it| it.file_name().unwrap().to_string_lossy().starts_with("rust-analyzer"))
    };
    !format!("{:?}", t.span()).starts_with("#0 bytes(") && !editor()
}
/// The name and the path.
fn file(at: Span) -> impl Eq {
    (at.file(), at.local_file())
}
/// It stays in its file.
fn root_at(at: Span) -> Span {
    if file(at) == file(root()) { root().located_at(at) } else { root() }
}
fn first(v: &[T], f: &dyn Fn(&T) -> bool) -> Option<Span> {
    let inner = |t: &T| if let T::Group(it) = t { first(it.raw(), f) } else { None };
    v.iter().find_map(|t| if f(t) { Some(t.span()) } else { inner(t) })
}
fn error(text: &str) -> V {
    q(&format!("CRATE::__core::compile_error! {{ {text:?} }}"), &[])
}
fn error_at(at: Span, text: &str) -> V {
    placed(at, || error(text))
}
fn placed(at: Span, f: impl FnOnce() -> V) -> V {
    let before = root();
    ROOT.set(Some(root_at(at)));
    let out = f();
    ROOT.set(Some(before));
    out
}
/// Tokens don't outlive the call, also if it panics.
struct Clear;
impl Drop for Clear {
    fn drop(&mut self) {
        KRATE.take();
        KERNELS.take();
        IN_MACRO.take();
        IN_RULES.take();
        TEMPLATES.take();
    }
}
/// Checks the input, and hands it to `f`.
fn run(name: &str, args: TokenStream, input: TokenStream, f: impl FnOnce(V, &[T]) -> V) -> TokenStream {
    let _clear = Clear;
    let (untouched, [given, all]) = (input.clone(), &[args, input].map(trees));
    let plain = first(all, &|t| !written(t)).or(first(given, &|t| !written(t)));
    ROOT.set(plain.or(first(all, &|t| is(t, KEYWORDS))));
    let (args, input) = (open(given), open(all));
    // Whether the name of the attribute and the ends of the item are written in one place.
    let text = Span::call_site().source_text().unwrap_or_default();
    let text = text.split(['(', ']']).next().unwrap().split(" $").next().unwrap().trim_end();
    let named = !text.replace("$crate", "").contains('$') && text.rsplit([':', '[', ' ']).next() == Some(name);
    let ends = item(&input).map_or(vec![], |(it, _)| vec![it.rest[it.kind].clone(), input.last().unwrap().clone()]);
    let near = |t: &T| !written(t) || file(t.span()) == file(Span::call_site());
    let asked = name.is_empty() || named && !ends.is_empty() && ends.iter().all(near);
    let foreign = |t: &T| {
        written(t)
            && (is(t, "unsafe contract_requires contract_ensures") || !asked && (ends.is_empty() || text.is_empty()))
    };
    // KRATE is not set yet.
    assert!(
        first(all, &foreign).or(first(given, &|t| written(t) && is(t, "unsafe"))).is_none(),
        "this can't rewrite unsafe code of a macro, or what a macro has written that is no item, or whose file is not found: call a marked function from it"
    );
    if !name.is_empty() {
        ROOT.set(Some(root_at(Span::call_site())))
    }
    KRATE.set(krate(text, ends.first().filter(|t| written(t)).map(T::span)));
    let asked = asked && (name.is_empty() || !text.contains('$') || rooted());
    // Else rustc refuses this, unless the macro is of this crate. It fits into modules, blocks and impls.
    let nameless = item(&input).is_some_and(|(it, _)| it.is("impl use extern macro_rules") || is(&it.rest[1], "_"));
    let own = |t: &T| {
        // The same for the same text.
        let text: String = [t].into_iter().chain(given).chain(all).map(|t| format!("{t} ")).collect();
        let unique = BuildHasherDefault::<DefaultHasher>::new().hash_one((name, text));
        let text = format!("pub(in __0) const _WRITE_THE_ATTRIBUTE_IN_THE_MACRO_{unique}: () = ();");
        let text = if nameless { format!("const _: () = {{ {text} }};") } else { text };
        q(&text, &[&[Ident::new("$crate", t.span()).into()]])
    };
    let tests: V = ends.iter().filter(|t| !asked && written(t)).flat_map(own).collect();
    let out = f(args, &input);
    // The item stays next to an error.
    let seen = ["simd", "kernel", "only", "except"].contains(&name).then(|| outline(&input)).flatten();
    let same = seen.is_some() && outline(&out) == seen;
    if seen.is_none() || same && item(&out).is_some_and(|(it, _)| it.declares() && gets(&input, it.generics().1.len()))
    {
        return [tests, out].concat().into_iter().collect();
    }
    [[tests, if same { vec![] } else { out }].concat().into_iter().collect(), untouched].into_iter().collect()
}
/// The keyword and the name.
fn outline(v: &[T]) -> Option<String> {
    let mut words = v.iter().skip_while(|t| !is(t, KEYWORDS)).filter(|t| !is(t, "mut"));
    Some(format!("{} {}", words.next().filter(|t| is(t, "struct enum union static"))?, words.next()?))
}
/// Whether it can be rewritten.
fn gets(v: &[T], now: usize) -> bool {
    let Some((it, _)) = item(v) else { return false };
    assert!(
        !it.is("enum") || it.declares() || !it.generics().1.concat().iter().any(|t| p(t, '=') || p(t, '#')),
        "an enum with = or # in its parameters has to declare S: bun_simd::Isa itself, and to write S"
    );
    it.is("struct union") || it.is("enum") && !it.declares() && now == it.generics().1.len() + 1
}
/// As the attribute names it. $crate needs the hygiene of the macro that has written it.
fn krate(text: &str, its: Option<Span>) -> V {
    let mut path: Vec<_> = text.trim_start_matches(['#', '!', '[', ':', ' ']).split("::").map(str::trim).collect();
    path.pop();
    path.pop_if(|it| ["prelude", "mem"].contains(it));
    if !path.iter().all(|it| *it == "$crate" || it.chars().all(|c| c.is_alphanumeric() || "_#".contains(c))) {
        path.clear()
    }
    match (&path[..], its) {
        (["$crate", ..], Some(its)) => {
            let mut all = q(&path.join("::")[1..], &[]);
            all[0] = Ident::new("$crate", its).into();
            all
        }
        ([] | ["self" | "super" | "$crate", ..], _) => q("::bun_simd", &[]),
        (["crate", ..], _) => q(&path.join("::"), &[]),
        _ => q(&format!("::{}", path.join("::")), &[]),
    }
}
/// The template, with argument n in the place of __n.
fn q(template: &str, args: &[&[T]]) -> V {
    fn fill(from: &[T], args: &[&[T]]) -> V {
        let mut out = V::new();
        for t in from {
            match t {
                T::Ident(it) if let Some(n) = it.1.strip_prefix("__").and_then(|it| it.parse::<usize>().ok()) => {
                    out.extend_from_slice(args[n])
                }
                T::Ident(it) if &*it.1 == "CRATE" => {
                    let mut all = KRATE.with_borrow(V::clone);
                    let span = |t: &T| if is(t, "$crate") { t.span().located_at(root()) } else { root() };
                    all.iter_mut().for_each(|t| t.set_span(span(t)));
                    out.extend(all)
                }
                T::Group(it) => out.push(Group::of(it.delimiter(), root(), fill(it.raw(), args))),
                _ => {
                    out.push(t.clone());
                    out.last_mut().unwrap().set_span(root())
                }
            }
        }
        out
    }
    /// Without what rustc has to free, which it can't do after a panic.
    fn ours(v: &[T]) -> V {
        let one =
            |t: &T| if let T::Group(it) = t { Group::of(it.delimiter(), t.span(), ours(it.raw())) } else { t.clone() };
        v.iter().map(one).collect()
    }
    let read = || {
        let text = template.replace("@HERE", "CRATE::ThisFunction: CRATE::NeedsAttributeSimdOrKernel<S>,");
        // fill(..) gives spans to all tokens.
        let all = ours(&trees(text.parse().unwrap()));
        assert!(first(&all, &|t| is(t, "unsafe")).is_none());
        all.into()
    };
    fill(&TEMPLATES.with_borrow_mut(|it| it.entry(template.into()).or_insert_with(read).clone()), args)
}
fn is(t: &T, words: &str) -> bool {
    matches!(t, T::Ident(it) if words.contains(&*it.1) && words.split_whitespace().any(|w| *it.1 == *w))
}
fn p(t: &T, c: char) -> bool {
    matches!(t, T::Punct(it) if it.as_char() == c)
}
fn joint(t: &T, c: char) -> bool {
    matches!(t, T::Punct(it) if it.as_char() == c && it.spacing() == Spacing::Joint)
}
fn g(t: &T, d: D) -> bool {
    matches!(t, T::Group(it) if it.delimiter() == d)
}
fn at(v: &[T], i: usize, f: impl Fn(&T) -> bool) -> bool {
    v.get(i).is_some_and(f)
}
fn within(t: &T) -> V {
    inside(t).to_vec()
}
fn inside(t: &T) -> &[T] {
    if let T::Group(it) = t { it.opened(open) } else { &[] }
}
fn regroup(t: &T, v: V) -> T {
    let T::Group(it) = t else { panic!() };
    Group::of(it.delimiter(), t.span(), v)
}
fn names(v: &[T], word: &str) -> bool {
    let text = |i: usize| i > 1 && is(&v[i - 2], "stringify") && p(&v[i - 1], '!');
    v.iter().enumerate().any(|(i, t)| is(t, word) || !text(i) && names(inside(t), word))
}
fn angle(v: &[T], i: usize) -> i32 {
    let arrow = i > 0 && (joint(&v[i - 1], '-') || joint(&v[i - 1], '='));
    p(&v[i], '<') as i32 - (p(&v[i], '>') && !arrow) as i32
}
/// A test for places in a row, which also gets the depth in angle brackets.
fn deep(v: &[T], f: impl Fn(usize, i32) -> bool) -> impl FnMut(&usize) -> bool {
    let mut depth = 0;
    move |&k| {
        depth += angle(v, k);
        f(k, depth)
    }
}
/// The number of their tokens.
fn inner_attributes(v: &[T]) -> usize {
    3 * v.chunks(3).take_while(|it| p(&it[0], '#') && at(it, 1, |t| p(t, '!'))).count()
}
/// Whether this ends with the name of a macro, and not with the type !.
fn called(v: &[T]) -> bool {
    let named = |it: &T| matches!(it, T::Ident(_)) && !is(it, "for mut const if while match return break in else");
    matches!(v, [before @ .., it, bang] if p(bang, '!') && named(it) && !before.last().is_some_and(|t| p(t, '\'')))
}
fn invokes(v: &[T], name: &str) -> bool {
    (0..v.len())
        .any(|i| i > 1 && is(&v[i - 2], name) && !p(&v[i], '=') && called(&v[..i]) || invokes(inside(&v[i]), name))
}
/// At the commas, in types.
fn split(v: &[T]) -> Vec<&[T]> {
    let (mut depth, mut i) = (0, 0);
    let comma = |t: &T| {
        depth += angle(v, i);
        i += 1;
        depth == 0 && p(t, ',')
    };
    v.split(comma).filter(|it| !it.is_empty()).collect()
}
fn colon(v: &[T]) -> Option<usize> {
    (0..v.len()).find(|&i| {
        p(&v[i], ':') && !(joint(&v[i], ':') && at(v, i + 1, |t| p(t, ':'))) && !(i > 0 && joint(&v[i - 1], ':'))
    })
}
fn commas(all: impl IntoIterator<Item = V>) -> V {
    let comma = q(",", &[]);
    all.into_iter().flat_map(|it| it.into_iter().chain(comma.clone())).collect()
}

struct Item {
    attrs: Vec<[T; 2]>,
    vis: V,
    /// The place of the keyword.
    kind: usize,
    rest: V,
}
impl Item {
    fn find(&self, name: &str) -> Option<V> {
        let last = |v: &[T]| v.iter().position(|t| !matches!(t, T::Ident(_)) && !p(t, ':')).unwrap_or(v.len());
        let mut all = self.attrs.iter().map(|it| within(&it[1]));
        all.find(|v| is(&v[last(v).saturating_sub(1)], name)).map(|v| v.get(last(&v)).map_or(vec![], within))
    }
    fn attrs(&self, keep: impl Fn(&[T]) -> bool) -> V {
        self.attrs.iter().filter(|it| keep(inside(&it[1]))).flatten().cloned().collect()
    }
    fn lints(&self) -> V {
        let words = "allow expect warn deny forbid";
        self.attrs(|v| is(&v[0], words) || is(&v[0], "cfg_attr") && names(v, words))
    }
    fn but(&self, words: &str) -> V {
        self.attrs(|v| !attribute(v, words) && !(words.contains("inline") && maybe_never(v)))
    }
    /// See UNREAD.
    fn unread(&self) -> bool {
        let raw =
            |v: &[T]| v.iter().any(|t| matches!(t, T::Ident(it) if it.1.starts_with("r#")) || p(t, '<') || p(t, '>'));
        !self.attrs(|v| raw(v) || parts(v).iter().any(|it| raw(it) || is(&it[0], "cfg_attr"))).is_empty()
    }
    fn is(&self, words: &str) -> bool {
        is(&self.rest[self.kind], words)
    }
    /// What comes before the generic parameters, these, and what follows.
    fn generics(&self) -> (&[T], Vec<&[T]>, &[T]) {
        let (v, start) = (&self.rest, self.kind + if self.is("impl") { 1 } else { 2 });
        if !at(v, start, |t| p(t, '<')) {
            return (&v[..start], vec![], &v[start..]);
        }
        let closes = deep(v, |_, depth| depth == 0);
        let end = (start..v.len()).find(closes).unwrap();
        (&v[..start], split(&v[start + 1..end]), &v[end + 1..])
    }
    /// Whether a trait says the signatures of the members.
    fn given(&self) -> bool {
        self.is("trait") || self.generics().2.iter().any(|t| is(t, "for"))
    }
    fn declares(&self) -> bool {
        self.generics().1.iter().any(|it| is(&it[0], "S"))
    }
    /// With the parameter S, the clause that passes it on, and another body.
    fn with(&self, bound: &str, declare: bool, clause: bool, body: V) -> V {
        let (head, mut all, rest) = self.generics();
        let s = q("S: CRATE::__0", &[&q(bound, &[])]);
        // By hand.
        let bare = |it: &[T]| is(&it[0], "S") && (it.len() == 1 || it.len() == 3 && is(&it[2], "Isa"));
        if let Some(it) = all.iter_mut().find(|it| declare && !self.is("type") && bare(it)) {
            *it = &s
        }
        if declare && !self.declares() {
            // Last, but for those with a default.
            all.insert(all.iter().position(|it| has_default(it)).unwrap_or(all.len()), &s)
        }
        let mut rest = rest[..rest.len() - 1].to_vec();
        match rest.iter().position(|t| is(t, "where")) {
            Some(i) if clause => drop(rest.splice(i + 1..i + 1, q("@HERE", &[]))),
            None if clause => rest.extend(q("where @HERE", &[])),
            _ => {}
        }
        q("__0 <__1> __2 __3", &[head, &commas(all.iter().map(|it| it.to_vec())), &rest, &body])
    }
}
fn has_default(it: &[T]) -> bool {
    (0..it.len()).any(|i| p(&it[i], '=') && (0..i).map(|k| angle(it, k)).sum::<i32>() == 0)
}
/// By the end of its path.
fn attribute(v: &[T], words: &str) -> bool {
    is(&v[v.iter().take_while(|t| matches!(t, T::Ident(_)) || p(t, ':')).count().saturating_sub(1)], words)
}
/// Of a cfg_attr, after the condition.
fn parts(v: &[T]) -> Vec<&[T]> {
    split(if is(&v[0], "cfg_attr") { inside(&v[v.len() - 1]) } else { &[] }).into_iter().skip(1).collect()
}
fn maybe_never(v: &[T]) -> bool {
    matches!(parts(v)[..], [it @ [a, _]] if is(a, "inline") && names(it, "never"))
}
const UNREAD: &str =
    "write the attributes without r#, < and >, and cfg_attr(all(a, b), ..) for one cfg_attr in another";
/// The item that starts here, and where it ends.
fn item(v: &[T]) -> Option<(Item, usize)> {
    let (mut i, mut attrs) = (0, vec![]);
    while at(v, i, |t| p(t, '#')) && at(v, i + 1, |t| g(t, D::Bracket)) {
        attrs.extend(apart(&v[i], &v[i + 1]));
        i += 2
    }
    let vis = i;
    if at(v, i, |t| is(t, "pub")) {
        i += 1 + at(v, i + 1, |t| g(t, D::Parenthesis)) as usize
    }
    let start = i;
    let word = |i: usize, words: &str| at(v, i, |t| is(t, words));
    if word(i, "impl") && at(v, i + 1, |t| matches!(t, T::Group(_))) && word(i + 2, "const unsafe trait") {
        i += 2
    }
    while word(i, "const unsafe async gen extern default safe")
        && (word(i + 1, "fn unsafe async gen extern impl trait") || at(v, i + 1, |t| matches!(t, T::Literal(_))))
        || at(v, i, |t| matches!(t, T::Literal(_))) && word(i + 1, "fn")
    {
        i += 1
    }
    let named = at(v, i + 1, |t| matches!(t, T::Ident(_)) && !is(t, "as in if else") || p(t, '$'));
    let braces = word(i, "fn struct enum union trait mod") && named
        || word(i, "impl extern")
        || word(i, "macro_rules") && at(v, i + 1, |t| p(t, '!'));
    if !braces && !(word(i, "const static type use") && (named || word(i, "use"))) {
        return None;
    }
    let ends = deep(v, |k, depth| p(&v[k], ';') || braces && depth <= 0 && g(&v[k], D::Brace) && !called(&v[..k]));
    let end = (i..v.len()).find(ends)? + 1;
    Some((Item { attrs, vis: v[vis..start].to_vec(), kind: i - start, rest: v[start..end].to_vec() }, end))
}

/// One attribute for each part of a cfg_attr, and a cfg for a cfg.
fn apart(hash: &T, attr: &T) -> Vec<[T; 2]> {
    let v = within(attr);
    let all = if v.len() == 2 && is(&v[0], "cfg_attr") { within(&v[1]) } else { vec![] };
    let all = split(&all);
    if !all.iter().skip(1).any(|it| is(&it[0], "cfg inline")) || first(&v, &|t| p(t, '$')).is_some() {
        return vec![[hash.clone(), attr.clone()]];
    }
    let one = |it: &&[T]| match it {
        [a, b] if is(a, "cfg") => q("cfg(any(not(__0), __1))", &[all[0], &within(b)]),
        _ => vec![v[0].clone(), regroup(&v[1], q("__0, __1", &[all[0], it]))],
    };
    all[1..].iter().map(|it| [hash.clone(), regroup(attr, one(it))]).collect()
}
/// The parameters but self, with their patterns and types; self; the result; the clause.
struct Signature {
    patterns: Vec<V>,
    types: Vec<V>,
    args: V,
    this: V,
    result: V,
    clause: V,
}
fn signature(it: &Item) -> Signature {
    let rest = it.generics().2;
    let all = within(&rest[0]);
    let mut all = split(&all);
    let method =
        all.first().is_some_and(|it| it[..colon(it).unwrap_or(it.len())].last().is_some_and(|t| is(t, "self")));
    let this = if method { all.remove(0).to_vec() } else { vec![] };
    let capital =
        |t: &T| t.to_string().replace("r#", "").chars().find(|c| c.is_alphabetic()).is_some_and(char::is_uppercase);
    // It can be a unit struct.
    let as_type = |t: &T, v: &[T]| {
        let (name, path) =
            (t.to_string().replace("r#", ""), v[colon(v).unwrap()..].split(|t| p(t, '<')).next().unwrap());
        let last = path.iter().rposition(|t| !p(t, ':')).unwrap_or(0);
        names(&path[last..], &format!("{name} r#{name}")) && !is(t, "bool char str")
    };
    let clause = rest.iter().position(|t| is(t, "where")).unwrap_or(rest.len() - 1);
    Signature {
        patterns: all.iter().map(|it| it[..colon(it).unwrap()].to_vec()).collect(),
        types: all.iter().map(|it| it[colon(it).unwrap() + 1..].to_vec()).collect(),
        args: commas(all.iter().enumerate().map(|(i, it)| match &it[..colon(it).unwrap()] {
            [t @ T::Ident(_)] | [T::Ident(_), t @ T::Ident(_)] if !is(t, "_") && !capital(t) && !as_type(t, it) => {
                vec![t.clone()]
            }
            _ => vec![Ident::new(&format!("__a{i}"), it[0].span()).into()],
        })),
        this,
        result: rest[1..clause].to_vec(),
        clause: rest[(clause + 1).min(rest.len() - 1)..rest.len() - 1].to_vec(),
    }
}
impl Signature {
    fn typed(&self) -> V {
        commas(self.types.iter().zip(split(&self.args)).map(|(t, name)| q("__0: __1", &[name, t])))
    }
    /// The function with plain names for its parameters.
    fn renamed(&self, it: &Item) -> Item {
        let at = it.rest.len() - it.generics().2.len();
        let this = if self.this.is_empty() { vec![] } else { q("__0,", &[&self.this]) };
        let mut rest = it.rest.clone();
        rest[at] = regroup(&rest[at], [this, self.typed()].concat());
        Item { attrs: vec![], vis: vec![], kind: it.kind, rest }
    }
}
/// For a function that only calls another.
fn handing_on(it: &Item) -> Item {
    let mut s = signature(it);
    s.this.drain(..at(&s.this, 0, |t| is(t, "mut")) as usize);
    s.renamed(it)
}
/// With a parameter for each impl Trait.
fn without_impl(v: &[T], more: &mut Vec<V>) -> V {
    let Some(i) = v.iter().position(|t| is(t, "impl")) else {
        let one = |(i, t): (usize, &T)| match g(t, D::Brace) || i > 0 && p(&v[i - 1], '!') {
            false if names(inside(t), "impl") => match without_impl(inside(t), more) {
                one if one.len() == 1 && g(t, D::Parenthesis) => one[0].clone(),
                all => regroup(t, all),
            },
            _ => t.clone(),
        };
        return v.iter().enumerate().map(one).collect();
    };
    let ends = deep(v, |k, depth| depth < 0 || depth == 0 && (p(&v[k], ',') || p(&v[k], ';')));
    let end = (i..v.len()).find(ends).unwrap_or(v.len());
    let (bound, name) = (without_impl(&v[i + 1..end], more), q(&format!("__I{}", more.len()), &[]));
    more.push(q("__0: __1", &[&name, &bound]));
    [without_impl(&v[..i], more), name, without_impl(&v[end..], more)].concat()
}
fn replaced(v: &[T], word: &str, by: &[T]) -> V {
    let one = |(i, t): (usize, &T)| match t {
        T::Group(_) if names(inside(t), word) => vec![regroup(t, replaced(&written_in(v, i), word, by))],
        _ if is(t, word) => by.to_vec(),
        _ => vec![t.clone()],
    };
    v.iter().enumerate().flat_map(one).collect()
}
fn is_path(list: &[T]) -> bool {
    simple(list) && (at(list, 0, |t| is(t, "super crate self")) || list.iter().any(|t| p(t, ':')))
}
fn listed(cfg: &[T], vis: &[T], name: &[T], words: &[T]) -> V {
    let targets = match words {
        [it] if is(it, "portable") => q("CRATE::target::Targets(&[])", &[]),
        [a, b, constant @ ..] if is(a, "targets") && p(b, '=') => q("(__0)", &[constant]),
        _ => q("CRATE::resolve_targets! { {target [@all_of] []} __0 }", &[words]),
    };
    q("__3 #[doc(hidden)] __2 struct __0; __3 CRATE::list_of_targets! { __0 __1 }", &[name, &targets, vis, cfg])
}
/// What lints ask of public types.
fn derived(vis: &[T]) -> V {
    q(
        if vis.len() == 1 {
            "#[CRATE::__core::derive(CRATE::__core::Clone, CRATE::__core::Copy, CRATE::__core::Debug)]"
        } else {
            ""
        },
        &[],
    )
}
/// The parameters of a type that stands for a function.
struct Shape {
    types: Vec<V>,
    binder: V,
    inferred: V,
    used: V,
    declared: V,
    named: V,
    passed: V,
}
fn shape(it: &Item, of: Option<&Item>) -> Shape {
    let (s, mut more) = (signature(it), vec![]);
    let types: Vec<V> = s.types.iter().map(|t| without_impl(t, &mut more)).collect();
    // A constant of the target with this name is also a trait.
    let name_of = |it: &[T]| match it {
        [a, b, ..] if is(a, "const") => q("{ __0 }", &[&[b.clone()]]),
        _ => it[..1 + p(&it[0], '\'') as usize].to_vec(),
    };
    let (own, outer) = (it.generics().1, of.map_or(vec![], |it| it.generics().1));
    // Lifetimes that only the parameters name belong to the pointer.
    let bounds = [
        own.iter().filter(|it| it.len() > 2 || !p(&it[0], '\'')).copied().collect::<Vec<_>>().concat(),
        s.clause.clone(),
        more.concat(),
    ]
    .concat();
    let late = |it: &&[T]| p(&it[0], '\'') && !names(&bounds, &it[1].to_string());
    let binder = commas(own.iter().copied().filter(late).map(|it| it.to_vec()));
    let mut all: Vec<&[T]> = outer.iter().copied().chain(own.iter().copied().filter(|it| !late(it))).collect();
    all.sort_by_key(|it| !p(&it[0], '\''));
    let written = commas(all.iter().map(|it| name_of(it)));
    let inferred = [&written[..], &commas(more.iter().map(|_| q("_", &[])))].concat();
    all.extend(more.iter().map(|it| &it[..]));
    let used = |it: &&[T]| q(if p(&it[0], '\'') { "&__0 ()" } else { "*const __0" }, &[&name_of(it)]);
    let used = commas(all.iter().filter(|it| !is(&it[0], "const")).map(used));
    let (declared, named) = (commas(all.iter().map(|it| it.to_vec())), commas(all.iter().map(|it| name_of(it))));
    let passed = commas(own.iter().filter(|it| !p(&it[0], '\'')).map(|it| name_of(it)));
    Shape { types, binder, inferred, used, declared, named, passed }
}
/// The type of an impl, its clause, and the type of self with a comma.
fn around(of: &Item, s: &Signature) -> [V; 3] {
    let rest = of.generics().2;
    let end = rest.iter().position(|t| is(t, "where")).unwrap_or(rest.len() - 1);
    let receiver = match s.this.iter().position(|t| p(t, ':')) {
        _ if s.this.is_empty() => vec![],
        Some(i) => q("__0,", &[&s.this[i + 1..]]),
        None => q("__0 Self,", &[if p(&s.this[0], '&') { &s.this[..s.this.len() - 1] } else { &[] }]),
    };
    [
        rest[..end].to_vec(),
        commas(split(&rest[(end + 1).min(rest.len() - 1)..rest.len() - 1]).iter().map(|it| it.to_vec())),
        receiver,
    ]
}
/// Whether the items name an S that they don't declare.
fn free(v: &[T]) -> bool {
    item(v).is_some_and(|(it, n)| !it.declares() && it.find("simd").is_none() && names(&it.rest, "S") || free(&v[n..]))
}
/// In a function, the S of the prelude would hide the parameter.
fn without_s(v: &[T], ours: bool) -> V {
    let name = KRATE.with_borrow(|it| it.last().unwrap().to_string());
    let ours = |i: usize| ours || names(v[..i].rsplit(|t| is(t, "use") || p(t, ',')).next().unwrap(), &name);
    let one = |(i, t): (usize, &T)| match t {
        _ if g(t, D::Brace) => vec![regroup(t, without_s(inside(t), ours(i)))],
        _ if is(t, "prelude") && at(v, i + 3, |t| p(t, '*')) && ours(i) => q("__0::__inside", &[&v[i..=i]]),
        _ => vec![t.clone()],
    };
    v.iter().enumerate().flat_map(one).collect()
}
/// What is written for an item has the place of its name.
fn marked(it: &Item, itself: bool, of: Option<&Item>, list: &[T]) -> V {
    let name = &it.rest[it.kind + !it.is("impl macro_rules extern use") as usize];
    placed(name.span(), || rewritten(it, itself, of, list))
}
fn kernels(v: &[T]) -> String {
    let one = |i| item(&v[i..]).filter(|(it, _)| p(&v[i], '#') && it.is("fn") && it.find("kernel").is_some());
    (0..v.len()).filter_map(one).map(|(it, _)| it.rest[it.kind + 1].to_string() + " ").collect()
}
/// A warning where a function that has a target calls a kernel of its module by the name alone.
fn again(it: &mut Item) {
    fn uses(v: &[T], name: &str, calls: &mut Vec<Span>) -> Option<()> {
        for (i, t) in v.iter().enumerate() {
            let before = |f: &dyn Fn(&T) -> bool| i > 0 && f(&v[i - 1]);
            if is(t, name) && !before(&|t| p(t, '.')) && !(i > 1 && joint(&v[i - 2], ':')) {
                let generic = at(v, i + 1, |t| joint(t, ':'));
                if generic && at(v, i + 3, |t| p(t, '<'))
                    || at(v, i + 1, |t| g(t, D::Parenthesis)) && !before(&|t| is(t, "fn"))
                {
                    calls.push(t.span())
                } else if !generic {
                    return None; // It can be another thing here.
                }
            }
            uses(inside(t), name, calls)?
        }
        Some(())
    }
    let last = it.rest.last().unwrap().clone();
    if !it.is("fn") || it.kind > 0 || !g(&last, D::Brace) || it.find("shared test target_feature").is_some() {
        return;
    }
    let found = |name: &str| {
        let mut calls = vec![];
        uses(&it.rest[2..], name, &mut calls).map_or(vec![], |_| calls)
    };
    let calls: Vec<_> = KERNELS.with_borrow(|it| it.split_whitespace().flat_map(found).collect());
    let mut body = within(&last);
    let n = inner_attributes(&body);
    let warning = |at| placed(at, || q("let _ = CRATE::native::KernelInMarkedCode;", &[]));
    if !calls.is_empty() {
        body.splice(n..n, calls.into_iter().flat_map(warning));
        *it.rest.last_mut().unwrap() = regroup(&last, body)
    }
}
/// A name such as u8xN or f32x4.
fn vector(t: &T) -> bool {
    let lanes = "u8 u16 u32 u64 i8 i16 i32 i64 f16 bf16 f32 f64";
    let fits =
        |(a, b): (&str, &str)| lanes.split(' ').any(|it| it == a) && "N 1 2 4 8 16 32 64".split(' ').any(|it| it == b);
    matches!(t, T::Ident(_)) && t.to_string().split_once('x').is_some_and(fits)
}
/// Only for the message.
fn not_imported(v: &[T]) -> Option<Span> {
    fn find(v: &[T], f: &dyn Fn(&[T], usize) -> bool) -> Option<Span> {
        (0..v.len()).find_map(|i| if f(v, i) { Some(v[i].span()) } else { find(inside(&v[i]), f) })
    }
    let native = |t: &T| vector(t) && t.to_string().ends_with('N');
    let used = |v: &[T], i: usize| {
        let before = |k: usize, f: &dyn Fn(&T) -> bool| i >= k && f(&v[i - k]);
        at(v, i + 1, |t| joint(t, ':')) && !before(2, &|t| joint(t, ':')) || before(1, &|t| p(t, ':') || p(t, '>'))
    };
    let given = |v: &[T], i: usize| {
        is(&v[i], "use") && !at(v, i + 1, |t| is(t, "core std alloc"))
            || p(&v[i], '$')
            || called(&v[..i]) && !is(&v[i - 2], OF_EXPRESSIONS) && matches!(v[i], T::Group(_))
            || native(&v[i]) && (!used(v, i) || i > 1 && joint(&v[i - 2], ':'))
    };
    first(v, &native).filter(|_| find(v, &given).is_none())
}
/// Only for the message: has! or pick! with words and no target, and nothing that could tell it.
fn asks(it: &Item, of: Option<&Item>) -> bool {
    fn find(v: &[T]) -> bool {
        let words = |v: &[T]| {
            let end = v.windows(2).position(|w| joint(&w[0], '=') && p(&w[1], '>')).unwrap_or(v.len());
            at(v, 0, |t| !is(t, "_")) && v[..end].iter().skip(1).step_by(2).all(|t| p(t, '+') || p(t, '|'))
        };
        (0..v.len()).any(|i| match called(&v[..i]) {
            true => is(&v[i - 2], "has pick") && !at(v, i.wrapping_sub(4), |t| joint(t, ':')) && words(inside(&v[i])),
            false => find(inside(&v[i])),
        })
    }
    !IN_MACRO.get()
        && of.is_none_or(|of| of.is("impl") && !of.rest.iter().any(|t| is(t, "where")))
        && !is(&it.rest[1], "_")
        && it.but("cfg doc allow expect warn deny forbid").is_empty()
        && first(&it.rest, &|t| p(t, '#') || is(t, "where macro_rules use")).is_none()
        && find(&it.rest)
        && it.rest[3].to_string() != "()"
}
/// Whether an item starts here.
fn starts(before: &[T]) -> bool {
    match before {
        [v @ .., a, it, b] if p(a, '$') && matches!(b, T::Punct(_)) && g(it, D::Parenthesis) => {
            starts(inside(it)) && starts(v)
        }
        [.., a, b, it] if p(a, '#') && p(b, '!') => g(it, D::Bracket),
        [.., it] => p(it, ';') || g(it, D::Brace),
        [] => true,
    }
}
/// The item that starts here in a body. In the arguments of a macro, anything can be before it.
fn nested(v: &[T], i: usize) -> Option<(Item, usize)> {
    let sure = |it: &Item| !it.attrs.is_empty() || it.is("fn macro_rules") && !p(&v[i - 1], '$');
    item(&v[i..]).filter(|(it, _)| starts(&v[..i]) || sure(it))
}
const EXPORT: &str = "macro_export r#macro_export";
const EXPORTED: &str = "a macro that is exported, exports one or has an unknown attribute can't be marked: write #[shared] on it, outside of functions";
const HOME: &str = "_THIS_MACRO_IS_FOR_ITS_OWN_CRATE";
/// For the bodies in rules.
fn home() -> V {
    let text = format!("{{ struct _It; impl _It {{ pub(in __0) const {HOME}: () = (); }} }}");
    let test = || q(&text, &[&[Ident::new("$crate", root()).into()]]);
    (IN_RULES.get() && !rooted()).then(test).filter(|it| !written(&it[0])).unwrap_or_default()
}
fn rooted() -> bool {
    KRATE.with_borrow(|it| is(&it[0], "$crate"))
}
fn count(v: &[T], word: &str) -> usize {
    v.iter().map(|t| is(t, word) as usize + count(inside(t), word)).sum()
}
fn misplaced() -> V {
    error(
        "only and except are for plain functions, impls and modules. A type takes Pick! or Either!, and a value pick!",
    )
}
/// An item that has the attribute, or is in a module, an impl or a function that has it.
fn rewritten(it: &Item, itself: bool, of: Option<&Item>, list: &[T]) -> V {
    let marks = "simd shared kernel only except";
    if !it.is("mod")
        && it.find("simd").is_some_and(|it| !matches!(&it[..], [] | [_]) || !it.iter().all(|t| is(t, "by_level")))
    {
        return error("only a module has a list here: write targets!(..) among the items, or #[kernel(..)]");
    }
    let given = Item::given;
    if it.is("fn")
        && (first(&it.rest[..it.rest.len() - 1], &|t| p(t, '$')).is_some() || entered(it.rest.last().unwrap()))
        || p(&it.rest[it.kind + 1], '$') && !it.is("impl use extern")
    {
        return [&it.attrs(|_| true)[..], &it.vis, &it.rest].concat();
    }
    // rustc drops a test with all that is in it.
    if it.is("fn") && !itself && it.find("test").is_some() && it.find("kernel").is_some() && !restricted(it) {
        let attrs = it.attrs.iter().filter(|it| attribute(inside(&it[1]), marks)).cloned().collect();
        let inner = marked(&Item { attrs, vis: vec![], kind: it.kind, rest: it.rest.clone() }, true, None, list);
        let body = q("{ __0 __1(__2) }", &[&inner, &it.rest[it.kind + 1..it.kind + 2], &signature(it).args]);
        return [it.but(marks), it.vis.clone(), handing_on(it).with("Isa", false, false, body)].concat();
    }
    if (picks(it) || it.is("fn") && !quoted(it).is_empty()) && !of.is_some_and(given) {
        return ask(&[it], of, list);
    }
    if restricted(it) && !it.is("mod") && !(it.is("impl") && !given(it)) {
        return match it.is("impl")
            || it.is("fn") && !of.is_some_and(given) && !names(&it.rest[..it.kind], "const async unsafe extern")
        {
            true => ask(&[it], of, list),
            false => misplaced(),
        };
    }
    if it.find("kernel").is_some() && !(it.is("fn") && g(it.rest.last().unwrap(), D::Brace)) {
        return error("a kernel is a function with a body");
    }
    let whole = |rest: &[T]| [&it.but(marks)[..], &it.vis, rest].concat();
    let (itself, last) = (itself || it.find("simd").is_some(), it.rest.last().unwrap());
    let outer = of.is_some_and(Item::declares);
    let test = it.find("test").is_some() || it.find("cfg").is_some_and(|it| it.len() == 1 && is(&it[0], "test"));
    if it.find("shared").is_some() && outer {
        return error(
            "a method of a type that depends on the target can't be shared: it would lack the instructions of the target",
        );
    }
    if (it.find("shared").is_some() || test && !itself) && it.find("kernel").is_none() {
        return whole(&it.rest);
    }
    let items = |of: Option<&Item>, list: &[T]| {
        let (given, mut impls) = (of.is_some_and(given), vec![]);
        let (v, mut out, mut i, mut place, mut twins) = (within(last), V::new(), 0, 0, vec![]);
        let handed: Vec<_> = it.attrs.iter().filter(|it| attribute(inside(&it[1]), "only except")).cloned().collect();
        let key =
            |it: &Item| format!("{} {}", it.rest[it.kind + 1], TokenStream::from_iter(it.attrs(|v| is(&v[0], "cfg"))));
        let twin = |it: &Item| it.is("fn") && !given && !names(&it.rest[..it.kind], "const async unsafe extern");
        let heads = (0..v.len()).filter(|&i| p(&v[i], '#') && (i < 2 || !p(&v[i - 2], '#')));
        let said: Vec<_> = heads.filter_map(|i| item(&v[i..])).filter(|(it, _)| twin(it) && restricted(it)).collect();
        let (mut others, mut macros, mut later) = (vec![], Vec::<(_, V)>::new(), V::new());
        while i < v.len() {
            let call = p(&v[i], '#') && at(&v, i + 1, |t| within(t).last().is_some_and(|t| is(t, "shared")));
            let other = if call { (vec![], 2) } else { (vec![v[i].clone()], 1) };
            let whole = starts(&v[..i]);
            let one = |(mut it, n): (Item, usize)| {
                if it.is("fn impl mod") && it.find("shared").is_none() {
                    it.attrs.extend(handed.iter().cloned())
                }
                if !given || of.is_some_and(Item::declares) || names(&it.rest, "S") {
                    again(&mut it)
                }
                let joined = it.is("impl") && !it.given();
                if !whole && restricted(&it) && (joined || twin(&it)) {
                    let text = "a twin can't follow a variable of a macro: give that to a function that calls the twin";
                    return (error_at(it.rest[it.kind].span(), text), n);
                }
                if joined && restricted(&it) {
                    join(&mut impls, it);
                    return (vec![], n);
                }
                // The twin that says nothing is for all other targets. rustc reports a second one.
                let same: Vec<_> = said.iter().map(|it| &it.0).filter(|twin| key(twin) == key(&it)).collect();
                if whole && twin(&it) && unsaid(&it, &same) && others.iter().all(|other| key(other) != key(&it)) {
                    it.attrs.extend(same.into_iter().filter_map(opposite));
                    others.push(it);
                    return (vec![], n);
                }
                if twin(&it) && restricted(&it) {
                    if twins.iter().any(|twin| key(twin) == key(&it) && covers(twin, &it)) {
                        let text =
                            "this is never called, as a twin before it asks for no more: the first that fits counts";
                        let cfg = it.attrs(|v| is(&v[0], "cfg"));
                        return ([cfg, error_at(it.rest[it.kind + 1].span(), text)].concat(), n);
                    }
                    twins.push(it);
                    return (vec![], n);
                }
                if it.is("macro_rules") {
                    let (name, cfg) = (it.rest[2].to_string().replace("r#", ""), it.attrs(|v| is(&v[0], "cfg")));
                    let moved: Vec<_> = twins.iter().chain(&impls).chain(&others).collect();
                    // Where both exist.
                    let hidden = macros.iter().filter(|it| it.0 == name && !moved.is_empty()).map(|it| it.1.clone());
                    let callers = moved.iter().filter(|it| invokes(&it.rest, &format!("{name} r#{name}")));
                    let hidden = hidden.chain(callers.map(|it| it.attrs(|v| is(&v[0], "cfg"))));
                    let text =
                        "a macro between twins can't have a name that is already taken or called: give it another name";
                    later.extend(
                        hidden.flat_map(|other| [&other[..], &cfg, &error_at(it.rest[2].span(), text)].concat()),
                    );
                    macros.push((name, cfg));
                    if !whole {
                        return ([it.but("shared"), it.vis, it.rest].concat(), n);
                    }
                }
                if it.is("mod")
                    && names(&v[i..i + n], "macro_use r#macro_use macro_escape r#macro_escape")
                    && twins.len() + impls.len() + others.len() > 0
                {
                    let text = "a module with macro_use can't be between twins: write this before them";
                    later.extend([it.attrs(|v| is(&v[0], "cfg")), error_at(it.rest[it.kind].span(), text)].concat())
                }
                (marked(&it, false, of, list), n)
            };
            let (new, n) = item(&v[i..]).map_or(other, one);
            if new.is_empty() && !call {
                out.append(&mut later);
                place = out.len()
            }
            out.extend(new);
            i += n
        }
        // They take the place of the last one.
        let after = out.split_off(place);
        out.extend(impls.iter().flat_map(|it| marked(it, false, of, list)));
        twins.extend(others);
        for (k, first) in
            twins.iter().enumerate().filter(|(k, it)| twins[..*k].iter().all(|other| key(other) != key(it)))
        {
            out.extend(ask(&twins[k..].iter().filter(|it| key(it) == key(first)).collect::<Vec<_>>(), of, list))
        }
        vec![regroup(last, [out, after].concat())]
    };
    let says = itself || names(&it.rest, "S");
    if it.is("fn") && it.generics().1.iter().any(|it| is(&it[0], "S") && it.len() > 1 && !names(it, "Isa")) {
        return error("S is the target here: this parameter needs another name");
    }
    if it.is("fn") {
        let scalable =
            |t: &T| matches!(t, T::Ident(it) if it.to_string().starts_with("sv") && it.to_string().ends_with("_t"));
        if first(&it.rest[..it.rest.len() - 1], &scalable).is_some() {
            return error("a scalable vector can't be an argument or a result here");
        }
        let all = [&it.attrs.concat(), &it.rest[..]].concat();
        let wide = |t: &T| ["_mm256_", "_mm512_"].iter().any(|it| t.to_string().starts_with(it));
        if let Some(at) = first(&it.rest, &wide)
            && !names(&all, "only except shared target_feature unsafe pick cfg stringify")
        {
            return error_at(
                at,
                "an intrinsic needs a function with #[only(..)] and its feature, or an arm of pick! { avx2 => .., _ => .. }, with the use of core::arch in it. has! is not enough",
            );
        }
        if it.find("kernel").is_none() && it.attrs.iter().any(|it| names(it, "no_mangle export_name")) {
            return whole(&it.rest);
        }
        let plain = names(&it.rest[..it.kind], "const async gen extern") || it.find("target_feature").is_some();
        if let Some(message) = lengths::refused(it).filter(|_| it.find("shared").is_none()) {
            return message;
        }
        if !plain && g(last, D::Brace) && !of.is_some_and(given) && lengths::by_level(it, of) {
            return ask(&[it], of, list);
        }
        if g(last, D::Brace) && lengths::by_level(it, None) {
            ROOT.set(Some(root_at(it.rest[it.kind].span())));
            return error(
                "a length can't depend on the target here: call a plain function or method that has it, or take the length as a parameter",
            );
        }
        if let Some(words) = it.find("kernel") {
            return kernel(it, words, of, list);
        }
        let plain = names(&it.rest[..it.kind], "const async gen")
            || names(&it.rest[..it.kind], "extern") && !says
            || !g(last, D::Brace)
            || it.find("target_feature").is_some();
        let given = of.is_some_and(given);
        if (plain || given) && !says && !outer || plain && outer && !names(&it.rest[..it.kind], "async gen") {
            let hint = names(&it.rest[..it.kind], "const") && it.find("inline").is_none();
            let end = if outer { real(last) } else { last.clone() };
            let rest = [&it.rest[..it.rest.len() - 1], &[end]].concat();
            return [q(if hint { "#[inline]" } else { "" }, &[]), whole(&rest)].concat();
        }
        if names(&it.rest[..it.kind], "async gen") {
            return q(COROUTINE, &[]);
        }
        if plain {
            return whole(&it.with("Isa", true, true, vec![real(last)]));
        }
        return [
            &q("#[cfg_attr(not(clippy), inline(always))]", &[]),
            &it.but("simd inline cold")[..],
            &it.vis,
            &function(it, !outer, "inlined", list, of.is_some_and(Item::given)),
        ]
        .concat();
    }
    if it.is("struct enum union type trait") && of.is_none() && is(&it.rest[it.kind + 1], "S") {
        return error("S is the target here: this needs another name");
    }
    if it.is("impl trait") && g(last, D::Brace) {
        let header = itself && it.is("trait")
            || names(&it.rest[..it.rest.len() - 1], "S")
            || it.is("trait") && free(inside(last));
        let with = Item {
            attrs: it.attrs.clone(),
            vis: vec![],
            kind: it.kind,
            rest: it.with("Isa", header, header, vec![last.clone()]),
        };
        return whole(&it.with("Isa", header, header, items(Some(&with), list)));
    }
    if it.is("mod") && g(last, D::Brace) {
        let list = &it.find("simd").unwrap_or(list.to_vec())[..];
        let before = KERNELS.replace(kernels(inside(last)));
        let mut inner = within(&items(None, &q("__Targets", &[]))[0]);
        KERNELS.set(before);
        if let Some(at) = not_imported(inside(last)) {
            inner.extend(error_at(at, "this needs use bun_simd::prelude::*; in the module"))
        }
        let path = is_path(list);
        let vis = q(if it.vis.len() == 1 { "pub" } else { "pub(crate)" }, &[]);
        let same = |of: &str| q(&format!("#[doc(hidden)] pub(crate) type __Targets = {of};"), &[list]);
        inner.extend(match () {
            _ if !itself => same("super::__Targets"),
            // A glob of this module can be next to that of the prelude.
            _ if list.is_empty() => q(
                "#[doc(hidden)] __0 use CRATE::__Targets; const _: CRATE::__core::PhantomData<__Targets> = CRATE::__core::PhantomData;",
                &[&vis],
            ),
            _ if path => same("__0::__Targets"),
            _ => [derived(&vis), listed(&[], &vis, &q("__Targets", &[]), list)].concat(),
        });
        return whole(&[&it.rest[..it.rest.len() - 1], &[regroup(last, inner)]].concat());
    }
    if it.is("mod") && it.find("simd only except").is_some() {
        return error(
            "this can't see into another file: write pub use simd::*; #[bun_simd::simd] mod simd { .. } there",
        );
    }
    if it.is("macro_rules") && g(last, D::Brace) {
        let v = within(last);
        let one = |(i, t): (usize, &T)| {
            if i > 0 && p(&v[i - 1], '>') { regroup(t, body(inside(t), list)) } else { t.clone() }
        };
        let before = (IN_MACRO.replace(true), IN_RULES.replace(true));
        let rules = regroup(last, v.iter().enumerate().map(one).collect());
        IN_MACRO.set(before.0);
        IN_RULES.set(before.1);
        // These stay as they are written.
        let usual = "simd doc cfg allow expect warn deny forbid deprecated skip rustfmt_skip macro_use collapse_debuginfo format_args";
        let all =
            |v: &[T]| first(v, &|t| p(t, '$')).is_none() && split(v).iter().skip(1).all(|it| attribute(it, usual));
        let other = |v: &[T]| !attribute(v, usual) && !matches!(v, [a, b] if is(a, "cfg_attr") && all(inside(b)));
        if names(&whole(&it.rest), EXPORT) || !it.attrs(other).is_empty() {
            let name = KRATE.with_borrow(|it| it.last().unwrap().to_string());
            let same = [&name, marks].iter().all(|it| count(inside(&rules), it) == count(&v, it));
            let said = if same { vec![] } else { [it.attrs(|v| is(&v[0], "cfg")), error(EXPORTED)].concat() };
            return [said, whole(&it.rest)].concat();
        }
        return whole(&[&it.rest[..it.rest.len() - 1], &[rules]].concat());
    }
    // Only for the message: rustc asks for type annotations.
    let lanes = |w: &[T]| w[0].to_string().ends_with("xN") && joint(&w[1], ':') && is(&w[3], "LANES");
    let lanes = it.rest.windows(4).any(lanes);
    if it.is("const") && !says && !outer && (lanes || asks(it, of)) {
        let other = if lanes { "" } else { ". For your own has! or pick!: #[shared]" };
        let error = |text: &str| [it.attrs(|v| is(&v[0], "cfg")), error(&(text.to_owned() + other))].concat();
        if of.is_some() {
            return error("this depends on the target, and the type doesn't: take a function, or a constant outside");
        }
        let (name, here) = (&it.rest[1], if lanes { "u8xN::<S>::LANES here" } else { "#[simd] on it" });
        let text = format!("this depends on the target: write {here} and S::{name} where it is used, or take let");
        return [error(&text), constant(it)].concat();
    }
    let associated = of.is_some() && !(it.is("type") && it.find("simd").is_some());
    if !says || outer || !it.is("struct enum union type const") || associated {
        return whole(&it.rest);
    }
    if it.is("const") && lengths::by_level(it, None) {
        return error(
            "a length can't depend on the target here: make the array long enough for the widest target, or fill it in a function",
        );
    }
    if it.is("const") && matches!(&it.rest[3..], [a, b, ..] if vector(a) && (p(b, '<') || p(b, ':'))) {
        return error("a vector can't be a constant: take an array, which is an operand too, or let");
    }
    if it.is("const") {
        return constant(it);
    }
    if names(&it.rest, EXPORT) && names(&it.rest, "macro_rules") {
        return error(EXPORTED);
    }
    let mut with = lengths::arrays(&it.with("Isa", true, false, vec![last.clone()]));
    // rustc ignores it, and says so.
    let alias = it.is("type") && of.is_none() && it.rest.iter().any(|t| p(t, '='));
    if alias && !it.declares() && !it.rest.windows(2).any(|w| is(&w[0], "S") && joint(&w[1], ':')) {
        let s = with.windows(2).position(|w| is(&w[0], "S") && p(&w[1], ':')).unwrap();
        with.drain(s + 1..=s + with[s..].iter().position(|t| is(t, "Isa")).unwrap());
    }
    whole(&with)
}
/// A body that starts with the test that S stands for no other target.
fn real(body: &T) -> T {
    starting(body, q("__0 CRATE::native::real::<S>();", &[&home()]))
}
fn starting(body: &T, with: V) -> T {
    if !g(body, D::Brace) {
        return body.clone();
    }
    let mut v = within(body);
    let n = inner_attributes(&v);
    v.splice(n..n, with);
    regroup(body, v)
}
/// S::NAME, by a trait with this name. Lints on names leave an import alone.
fn constant(it: &Item) -> V {
    let (name, end) = (&it.rest[1..2], it.rest.len() - 1);
    let equals = deep(&it.rest, |i, depth| depth == 0 && p(&it.rest[i], '='));
    let unit = g(&it.rest[3], D::Parenthesis) && inside(&it.rest[3]).is_empty();
    if is(&name[0], "_") || unit && name[0].to_string().trim_start_matches("r#").starts_with('_') {
        return error(
            "a constant of the target is evaluated where it is used: write const { assert!(..) } in a function",
        );
    }
    if ["TARGET", "LISTED", "WORDS", "REGISTERS"].contains(&name[0].to_string().trim_start_matches("r#")) {
        return [it.attrs(|v| is(&v[0], "cfg")), error("S has a constant of this name: take another")].concat();
    }
    let Some(equals) = (3..end).find(equals) else {
        return error("a constant of the target needs a value. In a trait, take a function");
    };
    let of = &it.rest[3..equals];
    let kept = names(of, "fn dyn") || first(of, &|t| p(t, '$') || p(t, '!')).is_some();
    let of = if kept { of.to_vec() } else { kernel::lasting(of, &q("'static", &[])) };
    let seen = match &it.vis[..] {
        [] => "pub(super)",
        [_] => "pub",
        _ => "pub(crate)",
    };
    q(
        "__0 #[doc(hidden)] mod __1 { __2 __3 trait _IT { #[doc(hidden)] type Of; __2 const __4: Self::Of; } __3 use CRATE::native::write_S_colon_colon_before_this_constant_too::*; }
        __0 impl<S: CRATE::Isa> __1::_IT for S where @HERE { type Of = __5; __6 const __4: __5 = __7; }
        __0 __8 use __1::_IT as __4;",
        &[
            &it.attrs(|v| is(&v[0], "cfg")),
            &q(&format!("__constant_{}", name[0].to_string().replace("r#", "").to_lowercase()), &[]),
            &it.attrs(|v| is(&v[0], "doc")),
            &q(seen, &[]),
            name,
            &of,
            &it.but("simd cfg doc"),
            &it.rest[equals + 1..end],
            &it.vis,
        ],
    )
}

pub fn simd(args: TokenStream, input: TokenStream) -> TokenStream {
    run("simd", args, input, |args, v| {
        let Some((it, _)) = item(&q("#[simd(__0)] __1", &[&args, v])) else { return v.to_vec() };
        look_around(&it, if it.is("mod") { &args } else { &[] });
        marked(&it, true, None, &q("__Targets", &[]))
    })
}
pub fn alone(args: TokenStream, input: TokenStream) -> TokenStream {
    run("kernel", args, input, |args, v| {
        let Some((it, _)) = item(&q("#[kernel(__0)] __1", &[&args, v])) else { return v.to_vec() };
        look_around(&it, &args);
        marked(&it, true, None, &q("__Targets", &[]))
    })
}
pub fn only_alone(word: &str, args: TokenStream, input: TokenStream) -> TokenStream {
    run(word, args, input, |args, v| {
        if names(v, "call_best NeedsAttributeSimdOrKernel") {
            return error(
                "#[simd] or #[kernel] has not seen this: write only or except by that name, without cfg_attr",
            );
        }
        let v = q(&format!("#[{word}(__0)] __1"), &[&args, v]);
        let list = |it: &Item| it.find("simd").filter(|_| it.is("mod")).unwrap_or(q("super", &[]));
        let look = |it: &(Item, usize)| look_around(&it.0, &list(&it.0));
        item(&v).inspect(look).map_or_else(misplaced, |(it, _)| marked(&it, false, None, &q("__Targets", &[])))
    })
}
/// rustc reports it as dead code, at the place of the words.
pub fn list(input: TokenStream) -> TokenStream {
    let (_clear, all) = (Clear, trees(input));
    ROOT.set(first(&all, &|t| !written(t)).or(Some(all[0].span())));
    let name = q("ListThatNoKernelTakesByTargetsSuperOrCrate", &[]);
    let items = "#[doc(hidden)] pub(crate) struct __0; #[doc(hidden)] pub(crate) type __Targets = __0;";
    q(items, &[&name]).into_iter().collect()
}
pub fn shared(args: TokenStream, input: TokenStream) -> TokenStream {
    [run("shared", args, input.clone(), |_, _| vec![]), input].into_iter().collect()
}
