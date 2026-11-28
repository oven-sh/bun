//! #[kernel].
use super::*;

/// More than 13 arguments are one.
fn packed(n: usize, all: &[T]) -> V {
    if n > 13 { q("(__0),", &[all]) } else { all.to_vec() }
}
/// With this lifetime where none is written.
pub(super) fn lasting(v: &[T], lifetime: &[T]) -> V {
    let one = |(i, t): (usize, &T)| match t {
        _ if p(t, '&') && !at(v, i + 1, |t| p(t, '\'')) => q("&__0", &[lifetime]),
        _ if p(t, '\'') && at(v, i + 1, |t| is(t, "_")) => lifetime.to_vec(),
        _ if is(t, "_") && i > 0 && p(&v[i - 1], '\'') => vec![],
        _ if g(t, D::Parenthesis) => vec![regroup(t, lasting(inside(t), lifetime))],
        _ if g(t, D::Bracket) => {
            let all = within(t);
            let (of, length) = all.split_at(all.iter().position(|t| p(t, ';')).unwrap_or(all.len()));
            vec![regroup(t, [&lasting(of, lifetime), length].concat())]
        }
        _ => vec![t.clone()],
    };
    v.iter().enumerate().flat_map(one).collect()
}
/// The result of a method borrows from self, which types of pointers have to say.
pub(super) fn spelled(it: &Item) -> Option<Item> {
    let (Signature { mut this, result, .. }, (head, mut all, rest)) = (signature(it), it.generics());
    let i = this.iter().position(|t| p(t, '&')).filter(|_| !names(&result, "fn Fn FnMut FnOnce"))?;
    let (new, others) = (q("'__self", &[]), within(&rest[0])[this.len()..].to_vec());
    let mut attrs = it.attrs.clone();
    if !p(&this[i + 1], '\'') {
        attrs.push(q("#[cfg_attr(clippy, allow(clippy::needless_lifetimes))]", &[]).try_into().ok().unwrap());
        this.splice(i + 1..i + 1, new.clone());
        all.insert(0, &new)
    }
    let (n, result) = (result.len(), lasting(&result, &this[i + 1..i + 3]));
    let borrows = names(&result, &this[i + 2].to_string());
    let (all, params) = (commas(all.iter().map(|it| it.to_vec())), regroup(&rest[0], [this, others].concat()));
    let rest = q("__0 <__1> __2 __3 __4", &[head, &all, &[params], &result, &rest[1 + n..]]);
    borrows.then(|| Item { attrs, vis: it.vis.clone(), kind: it.kind, rest })
}
pub(super) fn kernel(it: &Item, words: V, of: Option<&Item>, list: &[T]) -> V {
    let spelled = spelled(it);
    let it = spelled.as_ref().unwrap_or(it);
    let (s, name) = (signature(it), &it.rest[it.kind + 1..it.kind + 2]);
    let Shape { types, binder, inferred, used, declared, named, passed } = shape(it, of);
    let camel =
        |it: &str| it.chars().take(1).flat_map(char::to_uppercase).chain(it.chars().skip(1)).collect::<String>();
    let camel = name[0].to_string().replace("r#", "").split('_').map(camel).collect::<String>();
    let own_list = q(&format!("__TargetsOf{camel}"), &[]);
    let of_module = q("__0::__Targets", &[&words]);
    let only_cfg = |v: &[T]| is(&v[0], "cfg_attr") && split(inside(&v[1]))[1..].iter().all(|it| is(&it[0], "cfg"));
    let (cfg, lints) = (it.attrs(|v| is(&v[0], "cfg") && v.len() == 2 || only_cfg(v)), it.lints());
    let (list_item, list) = match () {
        _ if words.is_empty() => (vec![], list),
        _ if is_path(&words) => (vec![], &of_module[..]),
        _ => (listed(&cfg, &[], &own_list, &words), &own_list[..]),
    };
    let own = it.attrs(|v| is(&v[0], "allow"));
    let ours = ["must_use_candidate", "too_many_arguments"][..1 + (s.types.len() > 5) as usize].iter();
    let ours: String = ours.filter(|it| !names(&own, it)).map(|it| format!("clippy::{it},")).collect();
    let allowed = q(&format!("__0 #[cfg_attr(clippy, allow({ours}))]"), &[&own]);
    // As for other functions, the crates that call it compile it.
    let late = q(if it.find("inline").is_some_and(|it| !names(&it, "never")) { "#[inline]" } else { "" }, &[]);
    let never = it.find("inline").is_some_and(|it| names(&it, "never"));
    let apart = q(
        if never && it.find("cold").is_none() { "const APART: CRATE::__core::primitive::bool = true;" } else { "" },
        &[],
    );
    let define = |kernel: &[T], this: &[T], result: &[T], clause: &[T], types: &[T], of: &[T]| {
        let all = [this, types].concat();
        let n = split(&all).len();
        let args = commas((0..n).map(|i| q(&format!("__k{i}"), &[])));
        let best = commas(split(&args).iter().zip(split(&all)).map(|(it, t)| q("__0: __1", &[it, t])));
        let (all, pattern) = (packed(n, &all), packed(n, &args));
        q(
            "__0 __1 #[doc(hidden)] struct __2<__3> where __4 { _p: CRATE::__core::PhantomData<(__5)> }
            __0 __1 impl<__12 __3> CRATE::NativeKernel<(__7)> for __2<__6> where __4 {
                type Signature = fn(__7) __9;
                type List = __10; __16
                #[cfg_attr(not(clippy), inline(always))] fn best((__8): (__7)) __9 { Self::__best(__14) }
                #[cfg_attr(not(clippy), inline(always))] fn on<S: CRATE::Isa>((__8): (__7)) __9 where @HERE { __11(__14) }
            }
            __0 __1 impl<__3> __2<__6> where __4 { __15 fn __best<__12>(__13) __9 { CRATE::call_by_table::<Self, _>((__8)) } }",
            &[&cfg, &allowed, kernel, &declared, clause, &used, &named, &all, &pattern, result, list, of, &binder, &best, &args, &late, &apart],
        )
    };
    let given = |this: &[T]| packed(split(this).len() + s.types.len(), &[this, &s.args].concat());
    let head = |before: &[T], kernel: &[T], this: &[T]| {
        let call = q("{ __0 CRATE::call_best::<__1<__2>, _>((__3)) }", &[before, kernel, &inferred, &given(this)]);
        // Else the crate of the caller compiles it if there is one target.
        let inline = q(
            if never && (apart.is_empty() || it.find("unsafe no_mangle export_name").is_some()) {
                ""
            } else {
                "#[inline]"
            },
            &[],
        );
        let rest = handing_on(it).with("Isa", false, false, call);
        q("__0 __1 __2 __3", &[&it.but("simd kernel inline cold expect"), &inline, &it.vis, &rest])
    };
    let mut inner = function(it, true, "", list, false);
    let Some(of) = of else {
        let of = q(
            "__0 #[cfg_attr(not(clippy), inline(always))] __1",
            &[&lints, &replaced(&inner[..it.kind + 2], &name[0].to_string(), &q("__body", &[]))],
        );
        // It is not dead if it is called by to, here or baseline only.
        let itself = if s.types.iter().any(|t| names(t, "impl")) || it.find("deprecated").is_some() {
            vec![]
        } else {
            q("__0::<__1>", &[name, &passed])
        };
        let of = [
            &of,
            &inner[it.kind + 2..],
            &q(
                "let _ = (__1::to::<__2>, __1::here::<__2 S>, __1::baseline::<__2>, __3); __body::<__0 S>",
                &[
                    &passed,
                    name,
                    &commas(split(&named).iter().filter(|it| !p(&it[0], '\'')).map(|it| it.to_vec())),
                    &itself,
                ],
            ),
        ]
        .concat();
        let out = match &s.result[..] {
            [] => q("()", &[]),
            // Stable Rust has no other name for the type.
            [_, _, it] if p(it, '!') => q("<fn() -> ! as CRATE::Returns<()>>::It", &[]),
            all => all[2..].to_vec(),
        };
        let typed = Signature { types: types.clone(), ..signature(it) }.typed();
        // The lint on names leaves repr(C) alone, and a kernel that is dead is reported once.
        let real = q(&format!("__KernelOf{camel}"), &[]);
        let others = q(
            "__0 #[doc(hidden)] #[repr(C)] __12 __11 struct __2 {}
            __0 const _: () = { let _ = __2::targets; };
            __0 __13 impl __2 {
                /// On a target, if this CPU has it.
                #[inline] __11 fn to<__9 __1>(__target: CRATE::target::Target, __5) -> CRATE::__core::Option<__6> where __4 { CRATE::call_to::<__10<__3>, _>(__target, (__7)) }
                /// On the target of the caller, without dispatch if it is in the list.
                #[cfg_attr(not(clippy), inline(always))] __14 __11 fn here<__9 __1 S: CRATE::Isa>(__5) __15 where @HERE __4 { CRATE::call_here::<S, __10<__3>, _, false>((__7)) }
                /// On the target that the whole program is compiled for.
                #[cfg_attr(not(clippy), inline(always))] __14 __11 fn baseline<__9 __1>(__5) __15 where __4 { CRATE::call_here::<CRATE::target::Baseline, __10<__3>, _, true>((__7)) }
                /// The targets of the kernel that this CPU has.
                __11 fn targets() -> impl CRATE::__core::Iterator<Item = CRATE::target::Target> { <__8 as CRATE::Listed>::TARGETS.supported() }
            }",
            &[&cfg, &declared, name, &named, &s.clause, &typed, &out, &given(&[]), list, &binder, &real, &it.vis, &derived(&it.vis), &allowed, &it.attrs(|v| is(&v[0], "must_use")), &s.result],
        );
        return [
            list_item,
            head(&[], &real, &[]),
            define(&real, &[], &s.result, &s.clause, &commas(types), &of),
            others,
        ]
        .concat();
    };
    let ([this, clause, receiver], on) =
        (around(of, &s), Ident::new(&format!("__{}_on", name[0].to_string().replace("r#", "").to_lowercase()), root()));
    let (this, clause) = (&this[..], [clause, s.clause.clone()].concat());
    inner[it.kind + 1] = on.clone().into();
    let full = |v: &[T]| replaced(v, "Self", this);
    let pointer = q("<__0>::__1::<__2 S>", &[this, &[on.into()], &passed]);
    let kernel = q("__Kernel", &[]);
    let defined = define(&kernel, &full(&receiver), &full(&s.result), &full(&clause), &full(&commas(types)), &pointer);
    let me: V = s.this.iter().filter(|t| is(t, "self")).flat_map(|t| q("__0,", &[&[t.clone()]])).collect();
    let hidden = q("__0 __1 #[doc(hidden)] #[cfg_attr(not(clippy), inline(always))] __2", &[&cfg, &lints, &inner]);
    [head(&[list_item, defined].concat(), &kernel, &me), hidden].concat()
}
