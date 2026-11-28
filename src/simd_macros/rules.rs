//! For the tables of the library: what macro_rules lacks on stable Rust.
use proc_macro::{Delimiter as D, Group, Ident, Literal, Punct, Spacing, Span, TokenStream, TokenTree as T};

fn dollar(t: &T) -> bool {
    matches!(t, T::Punct(p) if p.as_char() == '$')
}
fn regroup(of: &Group, inner: impl IntoIterator<Item = T>) -> T {
    let mut new = Group::new(of.delimiter(), inner.into_iter().collect());
    new.set_span(of.span());
    new.into()
}
fn mark(name: &str, at: Span) -> T {
    assert!(name != "unsafe");
    Ident::new(name, at).into()
}
/// Marks in the place of two dollars, and of a dollar with braces. Also whether there is any, and whether an index looks for its repetition.
fn marked(from: TokenStream) -> (Vec<T>, bool, bool) {
    let v: Vec<T> = from.into_iter().collect();
    let (mut out, mut any, mut index, mut i) = (vec![], false, false, 0);
    while i < v.len() {
        let at = v[i].span();
        match (&v[i], v.get(i + 1)) {
            (a, Some(b)) if dollar(a) && dollar(b) => {
                out.push(mark("__dollar__", at));
                (any, i) = (true, i + 1)
            }
            (a, Some(T::Group(g))) if dollar(a) && g.delimiter() == D::Brace => {
                let inner: Vec<T> = g.stream().into_iter().collect();
                let [T::Ident(name), T::Group(args)] = &inner[..] else { panic!() };
                let name = name.to_string();
                out.push(mark(&format!("__{name}__"), at));
                match &*name {
                    "index" => index = true,
                    "count" => {
                        let each = [v[i].clone(), args.clone().into(), Punct::new('*', Spacing::Alone).into()];
                        out.push(regroup(args, each))
                    }
                    _ => out.push(args.clone().into()),
                }
                (any, i) = (true, i + 1)
            }
            (T::Group(g), _) => {
                let (mut inner, some, counts) = marked(g.stream());
                if counts && i > 0 && dollar(&v[i - 1]) {
                    out.insert(out.len() - 1, mark("__start__", at));
                    inner.insert(0, mark("__next__", at))
                } else {
                    index |= counts
                }
                any |= some;
                // A repetition leaves no group.
                if some && !out.last().is_some_and(dollar) {
                    out.push(mark("__enter__", at))
                }
                out.push(if some { regroup(g, inner) } else { v[i].clone() })
            }
            _ => out.push(v[i].clone()),
        }
        i += 1
    }
    (out, any, index)
}
/// On a macro_rules: each arm that has marks hands its result to join.
pub fn rules(item: TokenStream) -> TokenStream {
    let mut v: Vec<T> = item.into_iter().collect();
    let last = v.iter().rposition(|t| matches!(t, T::Group(_))).unwrap();
    let T::Group(arms) = &v[last] else { panic!() };
    let (at, mut after) = (v[last - 1].span(), false);
    let arm = |t: T| {
        let result = std::mem::replace(&mut after, matches!(&t, T::Punct(p) if p.as_char() == '>'));
        let T::Group(g) = &t else { return t };
        let (inner, any, _) = if result { marked(g.stream()) } else { return t };
        if !any {
            return t;
        }
        let punct = |c, spacing| {
            let mut it = Punct::new(c, spacing);
            it.set_span(at);
            T::from(it)
        };
        let path = ["bun_simd_macros", "join"]
            .map(|it| [punct(':', Spacing::Joint), punct(':', Spacing::Alone), mark(it, at)]);
        let mut all = Group::new(D::Brace, inner.into_iter().collect());
        all.set_span(at);
        regroup(g, path.into_iter().flatten().chain([punct('!', Spacing::Alone), all.into()]))
    };
    v[last] = regroup(arms, arms.stream().into_iter().map(arm).collect::<Vec<_>>());
    v.into_iter().collect()
}
fn text(from: TokenStream) -> String {
    let part = |t: T| match t {
        T::Group(g) => text(g.stream()),
        T::Punct(_) => String::new(),
        t => t.to_string().trim_start_matches("r#").trim_matches('"').into(),
    };
    from.into_iter().map(part).collect()
}
/// A group without marks is handed on as it is, and keeps the kinds of its fragments.
fn joined(from: TokenStream, index: &mut usize) -> Vec<T> {
    let (mut out, mut from) = (vec![], from.into_iter());
    while let Some(t) = from.next() {
        let mut args = || {
            let Some(T::Group(g)) = from.next() else { panic!() };
            g.stream()
        };
        let name = if let T::Ident(name) = &t { name.to_string() } else { String::new() };
        let new: Option<T> = match &*name {
            "__dollar__" => Some(Punct::new('$', Spacing::Alone).into()),
            "__concat__" => Some(mark(&text(args()), t.span())),
            "__count__" => Some(Literal::usize_unsuffixed(args().into_iter().count()).into()),
            "__index__" => Some(Literal::usize_unsuffixed(*index - 1).into()),
            "__ignore__" => (args(), None).1,
            "__start__" => (*index = 0, None).1,
            "__next__" => (*index += 1, None).1,
            "__enter__" => {
                let Some(T::Group(g)) = from.next() else { panic!() };
                out.push(regroup(&g, joined(g.stream(), index)));
                continue;
            }
            _ => {
                out.push(t);
                continue;
            }
        };
        out.extend(new.map(|mut it| {
            it.set_span(t.span());
            it
        }))
    }
    out
}
pub fn join(input: TokenStream) -> TokenStream {
    joined(input, &mut 0).into_iter().collect()
}
/// On a tuple struct, whose fields rustc has filtered by cfg: hands on what #[it(..)] has for those that are left.
pub fn kept(item: TokenStream) -> TokenStream {
    let groups = |from: TokenStream, of| {
        from.into_iter()
            .filter_map(move |t| if let T::Group(g) = t { (g.delimiter() == of).then(|| g.stream()) } else { None })
    };
    let fields = groups(item, D::Parenthesis).last().unwrap();
    let its = groups(fields, D::Bracket).filter(|it| it.clone().into_iter().next().unwrap().to_string() == "it");
    let all = its.flat_map(|it| groups(it, D::Parenthesis)).collect();
    forward("of_this_architecture", all, "($)".parse().unwrap())
}
/// An attribute that calls name! { [args] item }.
pub fn forward(name: &str, args: TokenStream, item: TokenStream) -> TokenStream {
    let inner = [T::from(Group::new(D::Bracket, args)).into(), item].into_iter().collect();
    let call =
        [mark(name, Span::call_site()), Punct::new('!', Spacing::Alone).into(), Group::new(D::Brace, inner).into()];
    call.into_iter().collect()
}
/// On an impl: the same for the trait of that name in crate::seals.
pub fn sealed(item: TokenStream) -> TokenStream {
    let v: Vec<T> = item.clone().into_iter().collect();
    let is = |t: &T, it: &str| !matches!(t, T::Group(_)) && t.to_string() == it;
    let mut start = v.iter().position(|t| is(t, "impl")).unwrap() + 1;
    let mut depth = 0;
    while depth > 0 || is(&v[start], "<") {
        depth += is(&v[start], "<") as i32 - (is(&v[start], ">") && !is(&v[start - 1], "-")) as i32;
        start += 1
    }
    let name = (start..).find(|&i| is(&v[i], "<") || is(&v[i], "for")).unwrap() - 1;
    let path = "crate::seals::".parse::<TokenStream>().unwrap();
    let body = T::from(Group::new(D::Brace, TokenStream::new()));
    let twin = v[..start].iter().cloned().chain(path).chain(v[name..v.len() - 1].iter().cloned()).chain([body]);
    [twin.collect(), item].into_iter().collect()
}
