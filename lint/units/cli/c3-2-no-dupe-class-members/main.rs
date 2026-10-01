// src/lint/rules/no_dupe_class_members.rs as the crate has it, against stand-ins of what it reads, over hand-made member lists.
// LINT_DIR is replaced by run.sh. The module of the rule has no `allow`: the lint levels of the command line hold for it.

mod ast_utils {
    use bun_ast::{Expr, ExprData};

    pub(crate) enum Name<'a> {
        Borrowed(&'a [u8]),
        #[allow(dead_code)]
        Owned(Vec<u8>),
    }

    impl Name<'_> {
        pub(crate) fn bytes(&self) -> &[u8] {
            match self {
                Name::Borrowed(bytes) => bytes,
                Name::Owned(bytes) => bytes,
            }
        }
    }

    // The signature of `get_static_string_value` of src/lint/ast_utils.rs.
    pub(crate) fn get_static_string_value(key: &Expr) -> Option<Name<'_>> {
        match &key.data {
            ExprData::EString(string) => Some(Name::Borrowed(string)),
            ExprData::EIdentifier => None,
        }
    }
}

mod context {
    use std::borrow::Cow;
    use std::marker::PhantomData;

    use bun_ast::Loc;

    use crate::rule::{Rule, RuleCategory};

    pub(crate) struct Context<'p, 'a> {
        pub(crate) reports: Vec<(&'static str, i32, Vec<u8>)>,
        marker: PhantomData<(&'p (), &'a ())>,
    }

    impl Context<'_, '_> {
        pub(crate) fn new() -> Self {
            Context {
                reports: Vec::new(),
                marker: PhantomData,
            }
        }

        // The signature of `Context::report` of src/lint/context.rs.
        pub(crate) fn report(
            &mut self,
            rule: &'static Rule,
            at: Loc,
            text: impl Into<Cow<'static, [u8]>>,
        ) {
            let RuleCategory::Correctness = rule.category;
            self.reports
                .push((rule.name, at.start, text.into().into_owned()));
        }
    }
}

mod rule {
    pub(crate) struct Rule {
        pub(crate) name: &'static str,
        pub(crate) category: RuleCategory,
    }

    #[derive(Clone, Copy)]
    pub(crate) enum RuleCategory {
        Correctness,
    }
}

mod rules {
    #[path = "LINT_DIR/rules/no_dupe_class_members.rs"]
    pub(crate) mod no_dupe_class_members;

    // `text` of src/lint/rules/mod.rs.
    pub(crate) fn text(parts: &[&[u8]]) -> Vec<u8> {
        parts.concat()
    }
}

use std::io::Write;

use G::PropertyKind::{Abstract, AutoAccessor, ClassStaticBlock, Declare, Get, Normal, Set, Spread};
use bun_ast::flags::{Property as Flag, PropertySet};
use bun_ast::{Expr, ExprData, G, Loc, StoreSlice};

// One member: its kind, its flags, its name (`None`: a key that is not static), where its key starts.
type P = (G::PropertyKind, &'static [Flag], Option<&'static str>, i32);

fn members(list: &[P]) -> Vec<G::Property> {
    list.iter()
        .map(|(kind, flags, name, at)| {
            let mut set = PropertySet::default();
            for flag in *flags {
                set.insert(*flag);
            }
            G::Property {
                kind: *kind,
                flags: set,
                // A static block has no key.
                key: if *kind == ClassStaticBlock {
                    None
                } else {
                    Some(Expr {
                        loc: Loc { start: *at },
                        data: match name {
                            Some(name) => ExprData::EString(name.as_bytes().to_vec()),
                            None => ExprData::EIdentifier,
                        },
                    })
                },
            }
        })
        .collect()
}

// What the rule reports for the class, sorted by place.
fn run(list: &[P]) -> Vec<(i32, Vec<u8>)> {
    let properties = members(list);
    let class = G::Class {
        properties: StoreSlice::new(&properties),
    };
    let mut context = context::Context::new();
    rules::no_dupe_class_members::class(&mut context, &class);
    let mut reports: Vec<(i32, Vec<u8>)> = context
        .reports
        .into_iter()
        .map(|(code, at, text)| {
            assert_eq!(code, "no-dupe-class-members");
            (at, text)
        })
        .collect();
    reports.sort();
    reports
}

fn dup(at: i32, name: &str) -> (i32, Vec<u8>) {
    (at, format!("Duplicate name '{name}'.").into_bytes())
}

fn main() {
    // A method, a field, and the same with `static` or with a computed key.
    let m: &[Flag] = &[Flag::IsMethod];
    let f: &[Flag] = &[];
    let sm: &[Flag] = &[Flag::IsMethod, Flag::IsStatic];
    let sf: &[Flag] = &[Flag::IsStatic];
    let cm: &[Flag] = &[Flag::IsMethod, Flag::IsComputed];
    let cf: &[Flag] = &[Flag::IsComputed];
    let scm: &[Flag] = &[Flag::IsMethod, Flag::IsStatic, Flag::IsComputed];
    let scf: &[Flag] = &[Flag::IsStatic, Flag::IsComputed];
    let a = Some("a");
    let b = Some("b");
    let ctor = Some("constructor");
    let mut checks = 0usize;
    let mut check = |list: &[P], expected: Vec<(i32, Vec<u8>)>| {
        assert_eq!(run(list), expected, "{list:?}", list = list.iter().map(|p| (p.2, p.3)).collect::<Vec<_>>());
        checks += 1;
    };

    check(&[], vec![]);
    check(&[(Normal, m, a, 1)], vec![]);
    check(&[(Normal, m, a, 1), (Normal, m, b, 2)], vec![]);
    check(&[(Normal, m, a, 1), (Normal, m, a, 2)], vec![dup(2, "a")]);
    check(
        &[(Normal, m, a, 1), (Normal, m, a, 2), (Normal, m, a, 3)],
        vec![dup(2, "a"), dup(3, "a")],
    );
    // Names in another order than they sort.
    check(
        &[(Normal, m, b, 1), (Normal, m, a, 2), (Normal, m, b, 3), (Normal, m, a, 4)],
        vec![dup(3, "b"), dup(4, "a")],
    );
    // A name that starts another.
    check(
        &[(Normal, m, a, 1), (Normal, m, Some("ab"), 2), (Normal, m, a, 3), (Normal, m, Some("ab"), 4)],
        vec![dup(3, "a"), dup(4, "ab")],
    );
    check(&[(Normal, m, a, 1), (Normal, m, Some("ab"), 2), (Normal, m, Some("abc"), 3)], vec![]);
    // The empty name.
    check(&[(Normal, m, Some(""), 1), (Normal, m, Some(""), 2)], vec![dup(2, "")]);
    check(&[(Normal, m, Some(""), 1), (Normal, m, Some(" "), 2)], vec![]);

    // What a getter, a setter, a method and a field are to each other: the three branches of ESLint's handler.
    check(&[(Get, m, a, 1), (Set, m, a, 2)], vec![]);
    check(&[(Set, m, a, 1), (Get, m, a, 2)], vec![]);
    check(&[(Get, m, a, 1), (Get, m, a, 2)], vec![dup(2, "a")]);
    check(&[(Set, m, a, 1), (Set, m, a, 2)], vec![dup(2, "a")]);
    check(&[(Normal, m, a, 1), (Get, m, a, 2)], vec![dup(2, "a")]);
    check(&[(Get, m, a, 1), (Normal, m, a, 2)], vec![dup(2, "a")]);
    check(&[(Normal, m, a, 1), (Set, m, a, 2)], vec![dup(2, "a")]);
    check(&[(Set, m, a, 1), (Normal, m, a, 2)], vec![dup(2, "a")]);
    check(&[(Normal, f, a, 1), (Get, m, a, 2)], vec![dup(2, "a")]);
    check(&[(Get, m, a, 1), (Normal, f, a, 2)], vec![dup(2, "a")]);
    check(&[(Normal, f, a, 1), (Set, m, a, 2)], vec![dup(2, "a")]);
    check(&[(Set, m, a, 1), (Normal, f, a, 2)], vec![dup(2, "a")]);
    check(&[(Normal, f, a, 1), (Normal, f, a, 2)], vec![dup(2, "a")]);
    check(&[(Normal, f, a, 1), (Normal, m, a, 2)], vec![dup(2, "a")]);
    check(&[(Normal, m, a, 1), (Normal, f, a, 2)], vec![dup(2, "a")]);
    check(&[(Normal, m, a, 1), (Get, m, a, 2), (Set, m, a, 3)], vec![dup(2, "a"), dup(3, "a")]);
    check(&[(Get, m, a, 1), (Set, m, a, 2), (Normal, m, a, 3)], vec![dup(3, "a")]);
    check(&[(Get, m, a, 1), (Set, m, a, 2), (Normal, f, a, 3)], vec![dup(3, "a")]);
    check(
        &[(Get, m, a, 1), (Set, m, a, 2), (Get, m, a, 3), (Set, m, a, 4)],
        vec![dup(3, "a"), dup(4, "a")],
    );
    check(
        &[(Set, m, a, 1), (Get, m, a, 2), (Set, m, a, 3), (Get, m, a, 4), (Normal, f, a, 5)],
        vec![dup(3, "a"), dup(4, "a"), dup(5, "a")],
    );
    // Accessor pairs of two names, one inside the other.
    check(&[(Get, m, a, 1), (Set, m, b, 2), (Set, m, a, 3), (Get, m, b, 4)], vec![]);
    check(
        &[(Get, m, b, 1), (Normal, f, a, 2), (Set, m, b, 3), (Get, m, a, 4), (Get, m, b, 5)],
        vec![dup(4, "a"), dup(5, "b")],
    );

    // One state for a name of the static members, another for that name of the others.
    check(&[(Normal, sm, a, 1), (Normal, m, a, 2)], vec![]);
    check(&[(Normal, m, a, 1), (Normal, sm, a, 2)], vec![]);
    check(&[(Normal, f, a, 1), (Normal, sf, a, 2)], vec![]);
    check(&[(Normal, sm, a, 1), (Normal, sm, a, 2)], vec![dup(2, "a")]);
    check(&[(Normal, sf, a, 1), (Normal, sf, a, 2)], vec![dup(2, "a")]);
    check(
        &[(Normal, sm, a, 1), (Normal, m, a, 2), (Normal, sm, a, 3), (Normal, m, a, 4)],
        vec![dup(3, "a"), dup(4, "a")],
    );
    check(&[(Get, m, a, 1), (Set, sm, a, 2), (Get, m, a, 3)], vec![dup(3, "a")]);
    check(&[(Get, sm, a, 1), (Set, m, a, 2)], vec![]);
    check(&[(Get, sm, a, 1), (Get, m, a, 2)], vec![]);
    check(&[(Get, sm, a, 1), (Normal, sm, a, 2), (Set, sm, a, 3)], vec![dup(2, "a"), dup(3, "a")]);
    check(
        &[(Normal, f, a, 1), (Normal, sf, a, 2), (Normal, m, a, 3), (Normal, sm, a, 4)],
        vec![dup(3, "a"), dup(4, "a")],
    );
    check(
        &[(Get, m, a, 1), (Set, m, a, 2), (Get, sm, a, 3), (Set, sm, a, 4)],
        vec![],
    );

    // The constructor is not counted; a member that only has its name is.
    check(&[(Normal, m, ctor, 1), (Normal, m, ctor, 2)], vec![]);
    check(&[(Normal, m, ctor, 1), (Normal, m, a, 2), (Normal, m, a, 3)], vec![dup(3, "a")]);
    check(&[(Normal, sm, ctor, 1), (Normal, sm, ctor, 2)], vec![dup(2, "constructor")]);
    check(&[(Normal, m, ctor, 1), (Normal, sm, ctor, 2)], vec![]);
    check(
        &[(Normal, sm, ctor, 1), (Normal, m, ctor, 2), (Normal, sm, ctor, 3)],
        vec![dup(3, "constructor")],
    );
    check(&[(Normal, cm, ctor, 1), (Normal, cm, ctor, 2)], vec![dup(2, "constructor")]);
    check(&[(Normal, cm, ctor, 1), (Normal, m, ctor, 2)], vec![]);
    check(&[(Normal, m, ctor, 1), (Normal, cm, ctor, 2)], vec![]);
    check(
        &[(Normal, m, ctor, 1), (Normal, cm, ctor, 2), (Normal, cm, ctor, 3)],
        vec![dup(3, "constructor")],
    );
    check(&[(Normal, cf, ctor, 1), (Normal, cf, ctor, 2)], vec![dup(2, "constructor")]);
    check(&[(Normal, cf, ctor, 1), (Normal, m, ctor, 2)], vec![]);
    check(&[(Normal, cf, ctor, 1), (Normal, cm, ctor, 2)], vec![dup(2, "constructor")]);
    check(&[(Normal, scf, ctor, 1), (Normal, sm, ctor, 2)], vec![dup(2, "constructor")]);
    check(&[(Normal, scm, ctor, 1), (Normal, cm, ctor, 2), (Normal, m, ctor, 3)], vec![]);
    check(&[(Get, cm, ctor, 1), (Get, cm, ctor, 2)], vec![dup(2, "constructor")]);
    check(&[(Normal, m, ctor, 1), (Get, cm, ctor, 2), (Set, cm, ctor, 3)], vec![]);
    check(&[(Get, sm, ctor, 1), (Get, sm, ctor, 2)], vec![dup(2, "constructor")]);
    check(&[(Get, sm, ctor, 1), (Set, sm, ctor, 2)], vec![]);
    check(&[(Normal, m, ctor, 1), (Get, sm, ctor, 2)], vec![]);
    check(
        &[(Normal, m, Some("constructor2"), 1), (Normal, m, Some("constructor2"), 2)],
        vec![dup(2, "constructor2")],
    );
    check(
        &[(Normal, m, Some("Constructor"), 1), (Normal, m, Some("Constructor"), 2)],
        vec![dup(2, "Constructor")],
    );

    // A static block, an auto-accessor and the kinds that no class of JavaScript has are neither checked nor counted.
    check(&[(ClassStaticBlock, f, None, 1), (ClassStaticBlock, f, None, 2)], vec![]);
    check(
        &[(ClassStaticBlock, f, None, 1), (Normal, m, a, 2), (ClassStaticBlock, f, None, 3), (Normal, m, a, 4)],
        vec![dup(4, "a")],
    );
    check(&[(AutoAccessor, f, a, 1), (AutoAccessor, f, a, 2)], vec![]);
    check(&[(AutoAccessor, f, a, 1), (Normal, f, a, 2)], vec![]);
    check(&[(Normal, f, a, 1), (AutoAccessor, f, a, 2), (Normal, f, a, 3)], vec![dup(3, "a")]);
    check(&[(AutoAccessor, sf, a, 1), (Normal, sf, a, 2)], vec![]);
    check(&[(Declare, f, a, 1), (Normal, f, a, 2)], vec![]);
    check(&[(Abstract, f, a, 1), (Normal, f, a, 2)], vec![]);
    check(&[(Spread, f, a, 1), (Normal, f, a, 2)], vec![]);

    // A key that is not static has no name.
    check(&[(Normal, cm, None, 1), (Normal, cm, None, 2)], vec![]);
    check(&[(Normal, m, a, 1), (Normal, cm, None, 2)], vec![]);
    check(&[(Normal, m, a, 1), (Normal, cm, None, 2), (Normal, m, a, 3)], vec![dup(3, "a")]);
    check(&[(Normal, f, None, 1), (Normal, f, None, 2)], vec![]);
    // A computed key that is static has its name.
    check(&[(Normal, cm, a, 1), (Normal, m, a, 2)], vec![dup(2, "a")]);
    check(&[(Normal, scm, a, 1), (Normal, sm, a, 2)], vec![dup(2, "a")]);
    check(&[(Normal, scm, a, 1), (Normal, cm, a, 2)], vec![]);

    // Wide classes: the members of one name keep their order through the sort.
    let fillers = [
        "f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12", "f13", "f14", "f15", "f16",
        "f17", "f18", "f19", "f20", "f21", "f22", "f23", "f24", "f25", "f26", "f27", "f28", "f29", "f30", "f31",
        "f32", "f33", "f34", "f35", "f36", "f37", "f38", "f39",
    ];
    let x = Some("x");
    let y = Some("y");
    let mut wide: Vec<P> = Vec::with_capacity(fillers.len() + 10);
    let mut at = 0;
    let mut next = || {
        at += 1;
        at
    };
    let named: [(G::PropertyKind, &'static [Flag], Option<&'static str>); 5] =
        [(Get, m, x), (Get, m, y), (Set, m, x), (Normal, m, y), (Normal, m, x)];
    for (chunk, (kind, flags, name)) in fillers.chunks(8).zip(named) {
        wide.push((kind, flags, name, next()));
        for filler in chunk {
            wide.push((Normal, m, Some(filler), next()));
        }
    }
    wide.push((Set, m, y, next()));
    wide.push((Normal, sm, x, next()));
    wide.push((Get, sm, y, next()));
    wide.push((Set, sm, y, next()));
    wide.push((Normal, m, Some("f7"), next()));
    assert_eq!(wide.len(), 50);
    check(&wide, vec![dup(28, "y"), dup(37, "x"), dup(46, "y"), dup(50, "f7")]);
    // Thirty accessors of one name, a getter and a setter in turn: every one after the first two is a duplicate.
    let mut wide: Vec<P> = Vec::with_capacity(30);
    let mut expected: Vec<(i32, Vec<u8>)> = Vec::with_capacity(28);
    for at in 1..=30 {
        wide.push((if at % 2 == 1 { Get } else { Set }, m, Some("z"), at));
        if at > 2 {
            expected.push(dup(at, "z"));
        }
    }
    check(&wide, expected);

    let _ = writeln!(
        std::io::stdout(),
        "no_dupe_class_members.rs over hand-made member lists: {checks} checks hold"
    );
}
