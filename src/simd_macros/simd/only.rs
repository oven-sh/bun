//! #[only] and #[except].
use super::*;

fn texts(t: &T) -> Vec<String> {
    assert!(inside(t).iter().all(|t| matches!(t, T::Ident(_) | T::Literal(_))));
    within(t).iter().map(T::to_string).collect()
}
/// The lists of one of the attributes, with | between the alternatives.
fn lists(it: &Item, name: &str) -> Vec<V> {
    let all = it.attrs.iter().map(|it| within(&it[1])).filter(|v| attribute(v, name) && !is(&v[v.len() - 1], name));
    let bars = |v: V| split(inside(&v[v.len() - 1])).join(&q("|", &[])[..]);
    all.map(bars).collect()
}
fn tests(it: &Item, name: &str, not: &str) -> V {
    lists(it, name).iter().flat_map(|it| q(&format!("&& {not} CRATE::has!(S: __0)"), &[it])).collect()
}
pub(super) fn restricted(it: &Item) -> bool {
    it.find("only except").is_some()
}
/// Whether it is the twin of these without saying so.
pub(super) fn unsaid(it: &Item, twins: &[&Item]) -> bool {
    let text = |it: &Item| {
        [Some(it.attrs(|v| is(&v[0], "cfg"))), it.find("kernel")]
            .map(|it| Some(TokenStream::from_iter(it?).to_string()))
    };
    let all = [&it.attrs.concat(), &it.rest[..]].concat();
    let plain = !names(&it.attrs.concat(), "only except shared")
        && it.find("test").is_none()
        && g(it.rest.last().unwrap(), D::Brace);
    plain
        && !twins.is_empty()
        && twins.iter().all(|twin| text(twin) == text(it))
        && first(&all, &|t| written(t) || p(t, '$')).is_none()
}
/// Whether the second has all conditions of the first.
pub(super) fn covers(a: &Item, b: &Item) -> bool {
    let all =
        |it: &Item| it.attrs(|v| attribute(v, "only except cfg cfg_attr")).iter().map(T::to_string).collect::<Vec<_>>();
    let (named, b) = (first(&[&a.attrs.concat(), &a.rest[..a.kind + 2]].concat(), &|t| p(t, '$')).is_none(), all(b));
    named && all(a).iter().all(|it| b.contains(it))
}
pub(super) fn opposite(it: &Item) -> Option<[T; 2]> {
    let ([list], []) = (&lists(it, "only")[..], &lists(it, "except")[..]) else { return None };
    q("#[except(__0)]", &[list]).try_into().ok()
}
/// Whether it calls what has the name of an intrinsic.
fn intrinsics(v: &[T], x86: bool) -> bool {
    let starts = "_mm_ _mm256_ _mm512_ _kand _kor _kxor _kxnor _knot _kshift _ktest _kadd _cvtmask _cvtu _pext_ _pdep_ _bzhi_ _bextr _bls _andn_ _mulx_ _tzcnt_ _lzcnt_ _popcnt _addcarryx_";
    let lane = |it: &str| it.starts_with(['u', 's', 'f', 'p']) && ["8", "16", "32", "64", "128"].contains(&&it[1..]);
    let named = |it: String| match x86 {
        true => starts.split(' ').any(|w| it.starts_with(w)),
        false => it.starts_with("__crc32") || it.starts_with('v') && it.split('_').any(lane),
    };
    let free = |i: usize| i == 0 || !p(&v[i - 1], '.') && !is(&v[i - 1], "fn");
    let called = |i| at(v, i + 1, |t| g(t, D::Parenthesis) || joint(t, ':') && at(v, i + 3, |t| p(t, '<')));
    (0..v.len()).any(|i| free(i) && called(i) && named(v[i].to_string()) || intrinsics(inside(&v[i]), x86))
}
/// The words and features of the tokens in the lists, what a list can add, all words of the architecture, and the levels.
struct Table {
    tokens: Vec<(Vec<String>, Vec<String>)>,
    more: Vec<String>,
    native: Vec<String>,
    levels: Vec<String>,
}
fn read(table: &[T]) -> Table {
    let of = |d| table.iter().filter(move |t| g(t, d));
    let more: Vec<_> = of(D::Bracket).flat_map(texts).collect();
    let mut tokens: Vec<_> = of(D::Parenthesis).map(|t| (texts(&within(t)[0]), texts(&within(t)[1]))).collect();
    let names: Vec<_> = table.iter().filter(|t| matches!(t, T::Ident(_))).map(T::to_string).collect();
    let fixed = names.iter().find(|it| it.starts_with('B')).cloned();
    for (words, features) in &mut tokens {
        let has = |word: &str| words.iter().any(|it| it == word);
        let width = if has("narrow") {
            "B32"
        } else if has("avx512") {
            "B64"
        } else if has("avx2") {
            "B32"
        } else {
            "B16"
        };
        features.extend(has("sse2").then(|| "\"sse2\"".into()));
        words.push(fixed.clone().unwrap_or(width.into()))
    }
    // Those of the lists: the smallest that has the words.
    let around = AROUND.with_borrow(Clone::clone);
    let listed = |(i, name): &(usize, String)| {
        let entry = |one: &str| {
            let one: Vec<_> = one.split('+').filter(|w| !more.iter().any(|it| it == w)).collect();
            let fits = |k: &usize| one.iter().all(|w| tokens[*k].0.iter().any(|it| it == w));
            (0..tokens.len()).filter(fits).min_by_key(|&k| (tokens[k].1.len(), tokens[k].0.len())) == Some(*i)
        };
        let has = |list: &str| around.split(',').any(|it| it == list);
        let lacks = |word: &str| !tokens[*i].0.iter().any(|it| it == word);
        let usual = has("default") || has("UptoB32") && lacks("avx512") || has("UptoB16") && lacks("avx2");
        let default = usual && names.contains(name) || has("UptoB16") && name == "sse4";
        around.is_empty() || name == "Portable" || default || around.split(',').any(entry)
    };
    let listed: Vec<_> =
        of(D::Parenthesis).map(|t| within(t)[2].to_string()).enumerate().map(|it| listed(&it)).collect();
    let native: Vec<_> = tokens.iter().flat_map(|it| it.0.clone()).collect();
    let mut listed = listed.iter();
    tokens.retain(|_| *listed.next().unwrap());
    Table { tokens, more, native, levels: of(D::Brace).flat_map(texts).collect() }
}
/// What holds for all targets of this architecture that the item is for, if there are any: features, and the name, arguments and clause of each assumption.
fn known(table: &Table, it: &Item) -> Known {
    let alternatives =
        |list: V| list.split(|t| p(t, '|')).map(|it| it.iter().step_by(2).map(T::to_string).collect()).collect();
    let [only, except]: [Vec<Vec<Vec<String>>>; 2] =
        ["only", "except"].map(|name| lists(it, name).into_iter().map(alternatives).collect());
    let named: Vec<_> = only.iter().chain(&except).flatten().flatten().cloned().collect();
    let Table { tokens, more, native, levels } = table;
    let (mut tokens, around) = (tokens.clone(), AROUND.with_borrow(Clone::clone));
    tokens.retain_mut(|(words, features)| {
        let surely = |one: &Vec<String>| one.iter().all(|w| words.contains(w) || features.contains(w));
        let maybe =
            |one: &&Vec<String>| one.iter().all(|w| words.contains(w) || features.contains(w) || more.contains(w));
        let asked = |w: &String| only.iter().any(|list| list.iter().filter(maybe).all(|one| one.contains(w)));
        let stays = only.iter().all(|list| list.iter().any(|one| maybe(&one))) && !except.iter().flatten().any(surely);
        let quoted: Vec<_> = named.iter().filter(|w| w.starts_with('"') && asked(w)).cloned().collect();
        features.extend(quoted);
        stays
    });
    // Few lists have it, and it would take the width from all functions for icelake.
    let narrow = |words: &[String]| words.iter().any(|it| it == "narrow");
    if around.is_empty()
        && !narrow(&named)
        && !named.iter().any(|it| it == "B32")
        && only.iter().flatten().flatten().any(|it| it == "icelake" || it == "avx512")
    {
        tokens.retain(|it| !narrow(&it.0))
    }
    let mut features = tokens.first()?.1.clone();
    features.retain(|it| tokens.iter().all(|t| t.1.contains(it)));
    features.retain(|it| !NO_FP16.get() || !["\"fp16\"", "\"fhm\"", "\"sve\"", "\"sve2\""].contains(&&it[..]));
    features.sort();
    features.dedup();
    let mut words: Vec<_> =
        levels.iter().cloned().chain(named).chain(["B16", "B32", "B64"].map(String::from)).collect();
    words.sort();
    words.dedup();
    let mut assumed = vec![];
    let count = |w: &str| tokens.iter().filter(|t| t.0.iter().any(|it| it == w)).count();
    let fixed = ["B16", "B32", "B64"].iter().any(|w| count(w) == tokens.len());
    for w in words.iter().filter(|w| native.contains(w)) {
        let (name, is) = match count(w) {
            0 if fixed && w.starts_with('B') => continue,
            0 => ("lacks", "False"),
            n if n == tokens.len() => ("has", "True"),
            _ => continue,
        };
        assumed.push(if w.starts_with('B') && is == "True" {
            [
                format!("is{}::<S", &w[1..]),
                format!("GivenWidth<S, CRATE::{w}>"),
                format!("S: CRATE::Isa<Native = CRATE::{w}>"),
            ]
        } else {
            let (module, of) = if w.starts_with('B') {
                ("of_width", "<S as CRATE::Isa>::Native: CRATE::only::Registers")
            } else {
                ("of_target", "S: CRATE::only::Words")
            };
            [
                format!("{module}::{w}::{name}::<S"),
                format!("{module}::{w}::Given<S, CRATE::only::{is}>"),
                format!("{of}<{w} = CRATE::only::{is}>"),
            ]
        })
    }
    Some((features, assumed))
}
thread_local! {
    /// The lists of the module, if they are known.
    static AROUND: std::cell::RefCell<String> = Default::default();
    /// Whether core::arch can have been imported.
    static ARCH: Cell<&'static str> = Cell::default();
    static NO_FP16: Cell<bool> = Cell::default();
}
pub(super) fn look_around(it: &Item, args: &[T]) {
    fn kernels(v: &[T], out: &mut V) {
        for w in v.windows(2) {
            if is(&w[0], "kernel") && g(&w[1], D::Parenthesis) {
                out.extend(q(", __0", &[&within(&w[1])]))
            }
        }
        v.iter().for_each(|t| kernels(inside(t), out))
    }
    fn imports(v: &[T], words: &str) -> bool {
        let one = |(i, t): (usize, &T)| {
            item(&v[i..]).is_some_and(|it| it.0.is("use") && names(&it.0.rest, words))
                || is(t, "mod") && at(v, i + 2, |t| imports(inside(t), words))
        };
        v.iter().enumerate().any(one)
    }
    let mut all = if args.is_empty() { q("default", &[]) } else { args.to_vec() };
    kernels(&it.rest, &mut all);
    let unknown =
        names(&all, "super crate self targets") || all.iter().any(|t| p(t, ':')) || args.is_empty() && !it.is("mod");
    AROUND.set(if unknown {
        String::new()
    } else {
        let all = TokenStream::from_iter(all).to_string().replace(char::is_whitespace, "");
        let all = all.replace("no_downclock", "icelake+fast_zmm,icelake+narrow,Upto<B32>");
        all.replace("Upto<B16>", "UptoB16").replace("Upto<B32>", "UptoB32").replace("Upto<B64>", "default")
    });
    let maybe = if imports(&it.rest, "super crate") { "maybe" } else { "false" };
    ARCH.set(if !it.is("mod") || imports(&it.rest, "arch") { "true" } else { maybe })
}
fn variables(pattern: &[T]) -> V {
    let one = |(i, t): (usize, &T)| match t {
        T::Ident(it)
            if !is(t, "mut ref box")
                && it.to_string().starts_with(char::is_lowercase)
                && !at(pattern, i + 1, |t| p(t, ':') || p(t, '!'))
                && !(i > 1 && joint(&pattern[i - 2], ':') && p(&pattern[i - 1], ':'))
                && (0..i).map(|k| angle(pattern, k)).sum::<i32>() == 0 =>
        {
            vec![t.clone()]
        }
        _ if i > 0 && p(&pattern[i - 1], '!') => vec![],
        t => variables(inside(t)),
    };
    pattern.iter().enumerate().flat_map(one).collect()
}
/// The first pick! that has no choice yet, and the body with one.
fn picked(v: &[T], arm: usize, bound: &[T]) -> Option<(Vec<V>, V)> {
    let (mut i, mut bound, mut soon) = (0, bound.to_vec(), vec![]);
    while i < v.len() {
        // The variables that only other arms use are not unused.
        if is(&v[i], "let") && (i == 0 || !is(&v[i - 1], "if while") && !p(&v[i - 1], '&')) {
            let pattern = v[i + 1..].split(|t| p(t, '=') || p(t, ';')).next().unwrap();
            soon = variables(&pattern[..colon(pattern).unwrap_or(pattern.len())])
        } else if p(&v[i], ';') {
            bound.append(&mut soon)
        }
        if let Some((_, n)) = nested(v, i) {
            i += n;
            continue;
        }
        let (mut rest, mut all) = (&within(&v[i])[..], vec![]);
        let pick = i > 1 && is(&v[i - 2], "pick") && p(&v[i - 1], '!') && !at(rest, 0, |t| p(t, '@'));
        while let Some(k) = rest.iter().position(|t| joint(t, '=')).filter(|_| pick) {
            let next = |n: usize| {
                rest[n..]
                    .iter()
                    .take_while(|t| !joint(t, '='))
                    .all(|t| !matches!(t, T::Group(_)) && !p(t, '.') && !p(t, ','))
            };
            let block = at(rest, k + 2, |t| g(t, D::Brace)) && next(k + 3);
            let end = if block { k + 3 } else { expression(rest, k + 2)? };
            all.push((rest[..k].to_vec(), rest[k + 2..end].to_vec()));
            rest = &rest[end + at(rest, end, |t| p(t, ',')) as usize..]
        }
        let part = |&k: &usize| matches!(v[k], T::Ident(_)) && joint(&v[k + 1], ':') && p(&v[k + 2], ':');
        let mut path = i.saturating_sub(2);
        while path >= 3 && part(&(path - 3)) {
            path -= 3
        }
        path -= 2 * (path >= 2 && p(&v[path - 1], ':') && joint(&v[path - 2], ':')) as usize;
        let found = match all.last() {
            Some(last)
                if rest.is_empty()
                    && is(&last.0[0], "_")
                    && (!names(inside(&v[i]), "$crate")
                        || count(inside(&v[i]), "$crate") == count(inside(&v[i]), HOME))
                    && !all.iter().any(|it| it.0.iter().any(|t| p(t, '$'))) =>
            {
                Some((all.iter().map(|it| it.0.clone()).collect(), {
                    let used = |t: &&T| {
                        all.iter().any(|it| names(&it.1, &t.to_string())) && !names(&all[arm].1, &t.to_string())
                    };
                    let used = commas(bound.iter().filter(used).map(|t| vec![t.clone()]));
                    q("@chosen (__0) __1 {}, __2", &[&used, &v[path..i], &all[arm].1])
                }))
            }
            _ if i > 1 && is(&v[i - 2], "stringify") => None,
            _ if called(&v[..i]) && !pick => picked(&given_to_macro(&v[i]), arm, &bound),
            _ => picked(inside(&v[i]), arm, &bound),
        };
        if let Some((words, new)) = found {
            if pick && at(&new, 0, |t| p(t, '@')) {
                let call = q("CRATE::pick!", &[]);
                return Some((words, [&v[..path], &call, &[regroup(&v[i], new)], &v[i + 1..]].concat()));
            }
            return Some((words, [&v[..i], &[regroup(&v[i], new)], &v[i + 1..]].concat()));
        }
        i += 1
    }
    None
}
pub(super) fn picks(it: &Item) -> bool {
    can_be_twins(it) && picked(inside(it.rest.last().unwrap()), 0, &[]).is_some()
}
fn can_be_twins(it: &Item) -> bool {
    let last = it.rest.last().unwrap();
    let plain = names(&it.rest[..it.kind], "const async unsafe extern")
        || it.find("track_caller target_feature test shared").is_some();
    it.is("fn") && !plain && g(last, D::Brace) && !names(&signature(it).result, "impl") && state(inside(last)).is_none()
}
/// Impls of one type become one, in which methods can be twins.
pub(super) fn join(impls: &mut Vec<Item>, mut it: Item) {
    let (handed, v, mut i, mut out) =
        (it.attrs(|v| attribute(v, "only except")), within(it.rest.last().unwrap()), 0, V::new());
    it.attrs.retain(|it| !attribute(inside(&it[1]), "only except"));
    while i < v.len() {
        let (function, n) = item(&v[i..]).map_or((false, 1), |(it, n)| (it.is("fn") && it.find("shared").is_none(), n));
        out.extend([if function { &handed[..] } else { &[] }, &v[i..i + n]].concat());
        i += n
    }
    let head = |it: &Item| {
        TokenStream::from_iter([&it.attrs(|_| true)[..], &it.rest[..it.rest.len() - 1]].concat()).to_string()
    };
    let inner = |it: &Item| inner_attributes(inside(it.rest.last().unwrap()));
    let at = impls.iter().position(|other| head(other) == head(&it) && inner(other) + inner(&it) == 0);
    let before = at.map_or(vec![], |at| within(impls.remove(at).rest.last().unwrap()));
    *it.rest.last_mut().unwrap() = regroup(it.rest.last().unwrap(), [before, out].concat());
    impls.push(it)
}
fn hinted(v: &[T]) -> V {
    let always = |i: usize| i > 0 && is(&v[i - 1], "inline") && names(&v[i..=i], "always");
    let one = |(i, t): (usize, &T)| match names(inside(t), "always") {
        true => regroup(t, hinted(&written_in(v, i))),
        false => t.clone(),
    };
    v.iter().enumerate().filter(|it| !always(it.0)).map(one).collect()
}
/// The items in a method have to name them.
fn named_lifetimes(mut of: Item) -> Item {
    let mut all = V::new();
    for i in 1..of.rest.len() {
        if p(&of.rest[i - 1], '\'') && is(&of.rest[i], "_") {
            let new = q(&format!("'__l{i},"), &[]);
            of.rest[i - 1..=i].clone_from_slice(&new[..2]);
            all.extend(new)
        }
    }
    of.rest.splice(of.kind + 2..of.kind + 2, all);
    of
}
fn anonymous(v: &[T]) -> V {
    let ours = |t: &T| t.to_string().strip_prefix("__l").is_some_and(|it| it.parse::<usize>().is_ok());
    v.iter().map(|t| if ours(t) { q("_", &[]).remove(0) } else { t.clone() }).collect()
}
/// For each target of a kernel with a feature in quotes, which the token lacks, a twin that is compiled with it.
pub(super) fn quoted(it: &Item) -> Vec<Item> {
    let Some(own) = it.find("kernel") else { return vec![] };
    let around = AROUND.with_borrow(Clone::clone);
    let words = around.chars().all(|c| c.is_ascii_alphanumeric() || "_\"+,.-".contains(c));
    let list = if own.is_empty() && words { q(&around, &[]) } else { own };
    let (mut before, mut out) = (V::new(), vec![]);
    for one in split(&list).into_iter().filter(|it| !names(it, "default no_downclock targets Upto UptoB16 UptoB32")) {
        let literal = |t: &T| matches!(t, T::Literal(_));
        if !one.iter().any(literal) {
            before.extend(q("#[except(__0)]", &[one]));
            continue;
        }
        let level = q(if literal(&one[0]) { "portable +" } else { "" }, &[]);
        let all = q(
            "__0 #[only(__1 __2)] __3 #[__entry] __4 __5",
            &[&it.attrs(|_| true), &level, one, &before, &it.vis, &it.rest],
        );
        out.extend(item(&all).map(|it| it.0))
    }
    out
}
type Known = Option<(Vec<String>, Vec<[String; 3]>)>;
/// A twin for each arm.
fn arms(table: &Table, it: Item, out: &mut Vec<(Known, Item)>) {
    let (known, last) = (known(table, &it), it.rest.last().unwrap());
    let Some((words, _)) = picked(inside(last), 0, &[]).filter(|_| known.is_some() && it.is("fn") && out.len() < 32)
    else {
        return out.push((known, it));
    };
    for k in 0..words.len() {
        let mut new = Item { attrs: it.attrs.clone(), vis: it.vis.clone(), kind: it.kind, rest: it.rest.clone() };
        *new.rest.last_mut().unwrap() =
            regroup(last, picked(inside(last), k, &variables(&signature(&it).patterns.concat())).unwrap().1);
        for (i, one) in words[..words.len() - 1].iter().enumerate().take(k + 1) {
            let attr = q(if i == k { "#[only(__0)]" } else { "#[except(__0)]" }, &[one]);
            new.attrs.push([attr[0].clone(), attr[1].clone()])
        }
        arms(table, new, out)
    }
}
fn assuming(it: &Item, assumed: &[[String; 3]]) -> Item {
    let mut rest = it.rest.clone();
    let (end, all) = (rest.len() - 1, commas(assumed.iter().map(|it| q(&it[2], &[]))));
    match rest.iter().position(|t| is(t, "where")) {
        Some(i) => drop(rest.splice(i + 1..i + 1, all)),
        None => drop(rest.splice(end..end, q("where __0", &[&all]))),
    }
    Item { attrs: it.attrs.clone(), vis: it.vis.clone(), kind: it.kind, rest }
}
/// The library has the table of targets.
pub(super) fn ask(all: &[&Item], of: Option<&Item>, list: &[T]) -> V {
    let of =
        of.map_or(vec![], |of| q("__0 __1 {}", &[&of.attrs(|v| is(&v[0], "simd")), &of.rest[..of.rest.len() - 1]]));
    let all: V = all.iter().flat_map(|it| [&it.attrs(|_| true)[..], &it.vis, &it.rest].concat()).collect();
    q(
        "CRATE::with_targets! { [CRATE] __3 __4 [__0] [__1] __2 }",
        &[&of, list, &all, &q(&format!("{:?}", AROUND.with_borrow(Clone::clone)), &[]), &q(ARCH.get(), &[])],
    )
}
/// Functions of one name, for different targets. Each has the features of its targets for core::arch, and assumes what these have in common.
/// Callers see the signature of the last one and need no proof: on another target, the build fails.
pub fn twins(input: TokenStream) -> TokenStream {
    let v = trees(input);
    run("", TokenStream::new(), v[1..].iter().cloned().collect(), |_, all| {
        assert!(inside(&all[0]).iter().all(|t| matches!(t, T::Ident(_)) || p(t, ':')));
        KRATE.set(within(&all[0]));
        let around = all[1].to_string().replace("\\\"", "\"");
        AROUND.set(around[1..around.len() - 1].into());
        ARCH.set(["true", "maybe"].into_iter().find(|it| is(&all[2], it)).unwrap_or("false"));
        NO_FP16.set(names(&v[..1], "no_fp16"));
        merged(&read(&within(&v[0])), &all[3..])
    })
}
/// The test that keeps the second from targets of the first, for which that has no code.
fn after(table: &Table, first: &Item, it: &Item) -> V {
    let word = |t: &T| !matches!(t, T::Ident(_)) || table.native.iter().chain(&table.more).any(|w| is(t, w));
    let text = |v: &V| v.iter().map(T::to_string).collect::<Vec<_>>();
    let open = |v: &V| {
        v.split(|t| p(t, '|')).any(|one| one.iter().all(word))
            && lists(it, "except").iter().all(|it| text(it) != text(v))
    };
    match first.find("__entry").is_none() && lists(first, "only").iter().all(open) {
        true => q("&& !(true __0 __1)", &[&tests(first, "only", ""), &tests(first, "except", "!")]),
        false => vec![],
    }
}
/// A static that may change.
fn state(v: &[T]) -> Option<Span> {
    fn numbers(v: &[T]) -> bool {
        let words = "u8 u16 u32 u64 u128 usize i8 i16 i32 i64 i128 isize f16 f32 f64 bool char str static";
        let one = |t: &T| if let T::Ident(_) = t { is(t, words) } else { numbers(inside(t)) };
        v.iter().take_while(|t| !p(t, ';') && !p(t, '=')).all(one)
    }
    let one = |i: usize| {
        let item = is(&v[i], "static") && !(i > 0 && p(&v[i - 1], '\'')) && at(v, i + 1, |t| matches!(t, T::Ident(_)));
        if item && !numbers(&v[i + 2..]) { Some(v[i].span()) } else { state(inside(&v[i])) }
    };
    (0..v.len()).find_map(one)
}
/// What one function has for all twins.
fn common(it: &Item) -> Vec<String> {
    fn text(v: &[T]) -> String {
        let one = |t: &T| match t {
            T::Group(it) => format!("{:?}({})", it.delimiter(), text(inside(t))),
            T::Punct(it) if it.spacing() == Spacing::Joint => t.to_string(),
            _ => format!("{t} "),
        };
        v.iter().map(one).collect()
    }
    let words = "doc inline cold coverage must_use allow expect warn deny forbid";
    let own = |v: &[T]| is(&v[0], words) && !at(v, 1, |t| p(t, ':')) || text(v) == "rustfmt :: skip ";
    let own = |v: &[T]| own(v) || is(&v[0], "cfg_attr") && parts(v).into_iter().all(own);
    let all = it
        .attrs
        .iter()
        .map(|it| inside(&it[1]))
        .filter(|v| !own(v) && !attribute(v, "simd only except track_caller __entry"));
    let one =
        |v: &[T]| if attribute(v, "kernel") { "kernel ".to_owned() + &text(inside(&v[v.len() - 1])) } else { text(v) };
    let mut all: Vec<_> = all.map(one).chain([text(&it.vis)]).collect();
    all.sort();
    all
}
fn merged(table: &Table, v: &[T]) -> V {
    let (of, list, mut rest, mut all) = (within(&v[0]), within(&v[1]), &v[2..], vec![]);
    let (mut chosen, mut written, mut parted) = (vec![], 0, vec![]);
    while let Some((it, n)) = item(rest) {
        let spelled = if it.is("fn") { kernel::spelled(&it) } else { None };
        let it = spelled.unwrap_or(it);
        quoted(&it).into_iter().chain([it]).for_each(|it| arms(table, it, &mut chosen));
        (rest, written) = (&rest[n..], written + 1)
    }
    let (of, as_written) = (item(&of).map(|it| named_lifetimes(it.0)), item(&of).map(|it| it.0));
    for (before, it) in chosen {
        if !it.is("fn") || !lengths::by_level(&it, of.as_ref()) {
            all.push((before, it));
            continue;
        }
        let count = all.len();
        let wide =
            before.iter().any(|it| it.1.iter().any(|it| it[1].starts_with("GivenWidth") && it[1].contains("B64")));
        for one in lengths::levels(&it).skip(wide as usize) {
            let level = |(_, assumed): (_, Vec<_>)| (vec![], assumed.into_iter().filter(lengths::is_level).collect());
            let now = known(table, &one).map(|now| if restricted(&it) { now } else { level(now) });
            all.extend(now.map(|now| (Some(now), one)))
        }
        if all.len() == count {
            all.extend(lengths::levels(&it).last().map(|it| (None, it)))
        }
        parted.push((all.len() - 1, it))
    }
    if let Some(at) = all.iter().find_map(|it| state(&it.1.rest)).filter(|_| all.len() > written) {
        ROOT.set(Some(root_at(at)));
        return error(
            "pick! and lengths that depend on the target make several functions of this one, which would not share the static: move it out",
        );
    }
    let (of, it) = (of.as_ref(), &all.iter().rfind(|it| it.0.is_some()).unwrap_or(all.last().unwrap()).1);
    ROOT.set(Some(root_at(it.rest[it.kind].span())));
    for (_, one) in &all {
        let text = match () {
            _ if one.unread() => UNREAD,
            _ if !one.attrs(|v| matches!(v, [.., it] if is(it, "only except"))).is_empty() => {
                "only and except take words"
            }
            _ if common(one) == common(it) => continue,
            _ => {
                "twins have the same visibility and attributes, but for only, except, inline, cold, lints and comments"
            }
        };
        let shared = |t: &T| all.iter().all(|it| it.1.attrs.iter().any(|it| it[1].to_string() == t.to_string()));
        let cfg = it.attrs.iter().filter(|it| is(&inside(&it[1])[0], "cfg") && shared(&it[1]));
        return cfg.flatten().cloned().chain(error_at(one.rest[one.kind].span(), text)).collect();
    }
    let words = |name| all.iter().flat_map(move |it| lists(&it.1, name)).flatten();
    let check = q("CRATE::known_words! { __0 }", &[&words("only").chain(words("except")).collect::<V>()]);
    if it.is("impl") {
        let (known, attrs) =
            (all[0].0.as_ref(), it.but("only except").chunks(2).map(|it| [it[0].clone(), it[1].clone()]).collect());
        // The bound has what the targets have in common, which can be less.
        let test = q(
            "if const { !(true __0 __1) } { CRATE::only::other::<S, (), ()>() }",
            &[&tests(it, "only", ""), &tests(it, "except", "!")],
        );
        let (mut it, mut body, mut i) = (assuming(it, &[]), within(it.rest.last().unwrap()), 0);
        while i < body.len() {
            let (method, n) = item(&body[i..]).map_or((false, 1), |(it, n)| (it.is("fn"), n));
            i += n;
            if method {
                body[i - 1] = starting(&body[i - 1], test.clone())
            }
        }
        *it.rest.last_mut().unwrap() = regroup(it.rest.last().unwrap(), body);
        let new = |known: &(_, Vec<_>)| marked(&Item { attrs, ..assuming(&it, &known.1) }, true, None, &list);
        return [check, known.map_or(vec![], new)].concat();
    }
    if all.iter().any(|it| it.1.find("track_caller").is_some()) {
        return error(
            "a function for some targets is called through a pointer, which doesn't pass the place of the call",
        );
    }
    if names(&signature(it).result, "impl") {
        return error("a function for some targets can't return impl Trait");
    }
    let outer = of.is_some_and(|it| it.declares());
    let (s, name, last) = (signature(it), &it.rest[it.kind + 1], it.rest.last().unwrap());
    let full =
        Item { attrs: vec![], vis: vec![], kind: it.kind, rest: it.with("Isa", !outer, false, vec![last.clone()]) };
    let Shape { types, binder, inferred, used, declared, named, passed } = shape(&full, of);
    let [this, clause, receiver] = of.map_or([vec![], vec![], vec![]], |of| around(of, &s));
    let result = s.result.clone();
    let real = |v: &[T]| if of.is_some() { replaced(v, "Self", &this) } else { v.to_vec() };
    let clause = real(&[clause, commas(split(&s.clause).iter().map(|it| it.to_vec()))].concat());
    let all_types = real(&[&receiver[..], &commas(types.clone())].concat());
    let typed = commas(split(&all_types).iter().enumerate().map(|(i, t)| q(&format!("__a{i}: __0"), &[t])));
    let args = commas((0..split(&all_types).len()).map(|i| q(&format!("__a{i}"), &[])));
    let pointer = real(&q("for<__0> fn(__1 __2) __3", &[&binder, &receiver, &commas(types), &result]));
    let path =
        |name: &T| q(if of.is_some() { "<__0>::__1::<__2>" } else { "__1::<__2>" }, &[&this, &[name.clone()], &passed]);
    let me: V = s.this.iter().filter(|t| is(t, "self")).flat_map(|t| q("__0,", &[&[t.clone()]])).collect();
    // The type implies what outlives its lifetimes.
    let (used, whole) = match this.iter().any(|t| p(t, '\'')) {
        true => (q("__0 CRATE::__core::PhantomData<__1>,", &[&used, &this]), clause.clone()),
        false => (used, vec![]),
    };
    let (mut items, mut choice, mut bodies, mut n) = (check, V::new(), V::new(), 0);
    let text = "impl<__0> CRATE::only::Points for __Only<__1 0> where __2 { type It = __3; }";
    if all.iter().any(|it| it.0.as_ref().is_some_and(|it| !it.1.is_empty())) {
        items.extend(q(text, &[&declared, &named, &clause, &pointer]))
    }
    let short = q("<__Only<__0 0> as CRATE::only::Points>::It", &[&named]);
    for (k, (known, it)) in all.iter().enumerate() {
        let Some((features, assumed)) = known else { continue };
        let entry = it.find("__entry").is_some();
        // Some are unstable, and callers need them all.
        let on = |word: &str| {
            ARCH.get() == "maybe" && !result.iter().any(|t| p(t, '!')) && table.native.iter().any(|it| it == word)
        };
        let arch = ARCH.get() == "true"
            || names(&it.rest, "arch")
            || (on("avx2") || on("neon82")) && intrinsics(inside(it.rest.last().unwrap()), on("avx2"));
        let features = if entry || arch { &features[..] } else { &[] };
        let mut inner = function(
            &assuming(it, assumed),
            !outer,
            if features.is_empty() { "inside" } else { "inlined" },
            &list,
            false,
        );
        inner[it.kind + 1] =
            Ident::new(&format!("__{}_{}_{k}", name.to_string().replace("r#", ""), name.span().line()), root()).into();
        // The entry lacks a feature, and calls it.
        if !features.is_empty() && !entry {
            let (body, end) = (inner.pop().unwrap(), inner.iter().rposition(|t| is(t, "where")).unwrap_or(inner.len()));
            let own = signature(it).result;
            let once = q("-> CRATE::once!(-> __0)", &[&if own.is_empty() { q("()", &[]) } else { own[2..].to_vec() }]);
            inner.splice(end - own.len()..end, once);
            let (all, n) = (within(&body), inner_attributes(inside(&body)));
            inner.push(regroup(
                &body,
                q("__0 let __once = CRATE::featured::Moved; CRATE::native::itself(#[inline(always)] move || { let __moved = __once; __1 })", &[&all[..n], &all[n..]]),
            ))
        }
        // A closure that is always inlined inherits no features.
        if features.iter().any(|it| it.starts_with("\"sve")) {
            inner = hinted(&inner)
        }
        let (path, mut clause) = (path(&inner[it.kind + 1]), clause.clone());
        let next = |i: usize, names: &[T]| match assumed.get(i) {
            Some(one) => q(&format!("CRATE::only::{}, __Only<__0 {}>>()", one[0], n + i), &[names]),
            None if features.is_empty() => {
                if i == 0 {
                    anonymous(&path)
                } else {
                    path.clone()
                }
            }
            None => q(&format!("__Only::<__0 {}>::checked", n + i), &[names]),
        };
        for (i, one) in assumed.iter().enumerate() {
            let text = format!(
                "impl<__0> CRATE::only::{} for __Only<__1 {}> where __2 {{ type Pointer = __3; #[cfg_attr(not(clippy), inline(always))] fn of() -> Self::Pointer where {} {{ __4 }} }}",
                one[1],
                n + i,
                one[2]
            );
            items.extend(q(&text, &[&declared, &named, &clause, &short, &next(i + 1, &named)]));
            clause.extend(q(&format!("{},", one[2]), &[]))
        }
        let enable: String = features.iter().map(|it| format!("#[target_feature(enable = {it})]")).collect();
        if !features.is_empty() {
            let (n, features, call) = (n + assumed.len(), features.join(" "), if entry { "" } else { "()" });
            let text = format!(
                "CRATE::featured! {{ [__0] __Only<__1 {n}> [__2] S [{features}] <__3> (__7) -> __5 }}
                impl<__0> __Only<__1 {n}> where __2 {{
                    #[inline] {enable} fn featured() -> CRATE::once!(<__3> (__7) -> __5) {{
                        let __once = CRATE::featured::Moved; #[inline(always)] move |__8| {{ let __moved = __once; __6(__8){call} }}
                    }}
                    #[cfg_attr(not(clippy), inline(always))] fn checked<__3>(__4) -> CRATE::featured::Same<__5> {{ (CRATE::featured!())(__8) }}
                }}"
            );
            let result = if result.is_empty() { q("()", &[]) } else { real(&result[2..]) };
            items.extend(q(&text, &[&declared, &named, &clause, &binder, &typed, &result, &path, &all_types, &args]))
        }
        let dropped = all[..k].iter().filter(|it| it.0.is_none()).map(|it| &it.1);
        let dropped = dropped.chain(parted.iter().filter(|it| it.0 < k).map(|it| &it.1));
        let except: V =
            tests(it, "except", "!").into_iter().chain(dropped.flat_map(|one| after(table, one, it))).collect();
        choice.extend(q(
            "if const { true __0 __1 } { __2(__3 __4) } else",
            &[&tests(it, "only", ""), &except, &next(0, &anonymous(&inferred)), &me, &s.args],
        ));
        let inline = if features.is_empty() { "#[cfg_attr(not(clippy), inline(always))]" } else { "#[inline]" };
        bodies.extend(q(
            &format!("__0 #[doc(hidden)] {inline} {enable} __1"),
            &[&[it.attrs(|v| is(&v[0], "cfg")), it.lints()].concat(), &inner],
        ));
        n += assumed.len() + 1
    }
    if choice.is_empty() {
        // It is for another architecture, and so are its callers.
        let text = "impl<__0> CRATE::only::Uses<__Only<__1 0>> for () where __2 { fn it() { let _: __3 = __4; } }";
        items.extend(q(text, &[&declared, &named, &clause, &pointer, &path(name)]))
    }
    // Only the body of the kernel calls it, or all that it calls enter by themselves.
    let apart = |it: &Item| it.find("cold").is_some() || it.find("inline").is_some_and(|it| names(&it, "never"));
    let rest = q(
        "__0 { let _ = ((), __1 __2); CRATE::only::missing(|| { let __it: CRATE::only::Missing<S> = CRATE::__core::Option::None; CRATE::only::keep(&raw const __it as _) }) }",
        &[&choice, &me, &s.args],
    );
    let enters = if it.find("kernel").is_some() || all.iter().all(|it| apart(&it.1)) {
        q("CRATE::Entering::<S>::inside0(#[inline(always)] move || __0)", &[&rest])
    } else {
        entering(
            "inlined",
            &s.args,
            &q("move", &[]),
            split(&s.args).iter().map(|it| (it.to_vec(), None)).collect(),
            &rest,
            &[],
        )
    };
    let call = q(
        "{
            struct __Only<__0 const __LEVEL: usize> where __4 { _p: CRATE::__core::PhantomData<(__1)> } __2
            CRATE::native::real::<S>();
            __3
        }",
        &[&declared, &used, &items, &enters, &whole],
    );
    let used = |it: &&[T; 2]| is(&inside(&it[1])[0], "must_use") && !at(inside(&it[1]), 1, |t| p(t, ':'));
    let used = all.iter().flat_map(|it| &it.1.attrs).find(used).filter(|_| !names(&it.attrs.concat(), "must_use"));
    let attrs = [used.map_or(&[][..], |it| it), &it.but("simd only except inline cold")].concat();
    let mut head = handing_on(it).with("Isa", !outer, !outer, call);
    if of.is_none() {
        let text = format!("__0 #[doc(hidden)] mod __twins_of_{name}_need_a_module_with_the_attribute_simd {{}} __1")
            .replace("r#", "");
        bodies = q(&text, &[&it.attrs(|v| is(&v[0], "cfg")), &bodies])
    }
    let Some(words) = it.find("kernel") else {
        return q("#[cfg_attr(not(clippy), inline(always))] __0 __1 __2 __3", &[&attrs, &it.vis, &head, &bodies]);
    };
    head[it.kind + 1] = Ident::new(&format!("__{name}_twins").replace("r#", ""), root()).into();
    let mut outer = Item { attrs: it.attrs.clone(), vis: it.vis.clone(), ..handing_on(it) };
    outer.attrs.retain(|it| !attribute(inside(&it[1]), "only except __entry"));
    outer.attrs.extend(used.cloned());
    let never = |it: &&[T; 2]| attribute(inside(&it[1]), "inline") && names(&it[1..], "never");
    outer.attrs.splice(..0, all.iter().filter(|it| it.0.is_some()).flat_map(|it| &it.1.attrs).find(never).cloned());
    *outer.rest.last_mut().unwrap() =
        q("{ __0(__1 __2) }", &[&anonymous(&path(&head[it.kind + 1])), &me, &s.args]).remove(0);
    q(
        "__0 __3 #[cfg_attr(not(clippy), inline(always))] __1 __2",
        &[&kernel(&outer, words, as_written.as_ref(), &list), &head, &bodies, &it.attrs(|v| is(&v[0], "cfg"))],
    )
}
