// src/lint/rules/no_dupe_keys.rs as the crate has it, against stand-ins of what it reads, over hand-made property lists.
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
    #[path = "LINT_DIR/rules/no_dupe_keys.rs"]
    pub(crate) mod no_dupe_keys;

    // `text` of src/lint/rules/mod.rs.
    pub(crate) fn text(parts: &[&[u8]]) -> Vec<u8> {
        parts.concat()
    }
}

use std::io::Write;

use G::PropertyKind::{Get, Normal, Set, Spread};
use bun_ast::flags::{Property as Flag, PropertySet};
use bun_ast::{E, Expr, ExprData, G, Loc};

// One property: its kind, its flags, its name (`None`: a key that is not static), where its key starts.
type P = (G::PropertyKind, &'static [Flag], Option<&'static str>, i32);

fn object(properties: &[P]) -> E::Object {
    E::Object {
        properties: properties
            .iter()
            .map(|(kind, flags, name, at)| {
                let mut set = PropertySet::default();
                for flag in *flags {
                    set.insert(*flag);
                }
                G::Property {
                    kind: *kind,
                    flags: set,
                    key: if *kind == Spread {
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
            .collect(),
    }
}

// What the rule reports for the literal, sorted by place.
fn run(properties: &[P]) -> Vec<(i32, Vec<u8>)> {
    let node = object(properties);
    let mut context = context::Context::new();
    rules::no_dupe_keys::e_object(&mut context, &node);
    let mut reports: Vec<(i32, Vec<u8>)> = context
        .reports
        .into_iter()
        .map(|(code, at, text)| {
            assert_eq!(code, "no-dupe-keys");
            (at, text)
        })
        .collect();
    reports.sort();
    reports
}

fn dup(at: i32, name: &str) -> (i32, Vec<u8>) {
    (at, format!("Duplicate key '{name}'.").into_bytes())
}

fn main() {
    let m: &[Flag] = &[Flag::IsMethod];
    let c: &[Flag] = &[Flag::IsComputed];
    let s: &[Flag] = &[Flag::WasShorthand];
    let st: &[Flag] = &[Flag::IsStatic, Flag::IsSpread];
    let n: &[Flag] = &[];
    let a = Some("a");
    let b = Some("b");
    let proto = Some("__proto__");
    let mut checks = 0usize;
    let mut check = |properties: &[P], expected: Vec<(i32, Vec<u8>)>| {
        assert_eq!(run(properties), expected);
        checks += 1;
    };

    check(&[], vec![]);
    check(&[(Normal, n, a, 1)], vec![]);
    check(&[(Normal, n, a, 1), (Normal, n, b, 2)], vec![]);
    check(&[(Normal, n, a, 1), (Normal, n, a, 2)], vec![dup(2, "a")]);
    check(
        &[(Normal, n, a, 1), (Normal, n, a, 2), (Normal, n, a, 3)],
        vec![dup(2, "a"), dup(3, "a")],
    );
    // Names in another order than they sort.
    check(
        &[(Normal, n, b, 1), (Normal, n, a, 2), (Normal, n, b, 3), (Normal, n, a, 4)],
        vec![dup(3, "b"), dup(4, "a")],
    );
    // A name that starts another.
    check(
        &[(Normal, n, a, 1), (Normal, n, Some("ab"), 2), (Normal, n, a, 3), (Normal, n, Some("ab"), 4)],
        vec![dup(3, "a"), dup(4, "ab")],
    );
    check(&[(Normal, n, a, 1), (Normal, n, Some("ab"), 2), (Normal, n, Some("abc"), 3)], vec![]);
    // Accessors.
    check(&[(Get, m, a, 1), (Set, m, a, 2)], vec![]);
    check(&[(Set, m, a, 1), (Get, m, a, 2)], vec![]);
    check(&[(Get, m, a, 1), (Get, m, a, 2)], vec![dup(2, "a")]);
    check(&[(Set, m, a, 1), (Set, m, a, 2)], vec![dup(2, "a")]);
    check(&[(Normal, n, a, 1), (Get, m, a, 2)], vec![dup(2, "a")]);
    check(&[(Get, m, a, 1), (Normal, n, a, 2)], vec![dup(2, "a")]);
    check(&[(Normal, n, a, 1), (Set, m, a, 2)], vec![dup(2, "a")]);
    check(&[(Set, m, a, 1), (Normal, n, a, 2)], vec![dup(2, "a")]);
    check(&[(Normal, n, a, 1), (Get, m, a, 2), (Set, m, a, 3)], vec![dup(2, "a"), dup(3, "a")]);
    check(&[(Get, m, a, 1), (Set, m, a, 2), (Normal, n, a, 3)], vec![dup(3, "a")]);
    check(
        &[(Get, m, a, 1), (Set, m, a, 2), (Get, m, a, 3), (Set, m, a, 4)],
        vec![dup(3, "a"), dup(4, "a")],
    );
    // Accessor pairs of two names, one inside the other.
    check(&[(Get, m, a, 1), (Set, m, b, 2), (Set, m, a, 3), (Get, m, b, 4)], vec![]);
    check(
        &[(Get, m, b, 1), (Normal, n, a, 2), (Set, m, b, 3), (Get, m, a, 4), (Get, m, b, 5)],
        vec![dup(4, "a"), dup(5, "b")],
    );
    // A method, a shorthand and a computed key are `init`; other flags change nothing.
    check(&[(Normal, m, a, 1), (Normal, m, a, 2)], vec![dup(2, "a")]);
    check(&[(Normal, s, a, 1), (Normal, s, a, 2)], vec![dup(2, "a")]);
    check(&[(Normal, c, a, 1), (Normal, n, a, 2)], vec![dup(2, "a")]);
    check(&[(Normal, st, a, 1), (Normal, st, a, 2)], vec![dup(2, "a")]);
    // The prototype setter.
    check(&[(Normal, n, proto, 1), (Normal, n, proto, 2)], vec![]);
    check(&[(Normal, st, proto, 1), (Normal, st, proto, 2)], vec![]);
    check(&[(Normal, n, proto, 1), (Normal, c, proto, 2)], vec![]);
    check(&[(Normal, c, proto, 1), (Normal, n, proto, 2)], vec![]);
    check(&[(Normal, c, proto, 1), (Normal, c, proto, 2)], vec![dup(2, "__proto__")]);
    check(&[(Normal, s, proto, 1), (Normal, s, proto, 2)], vec![dup(2, "__proto__")]);
    check(&[(Normal, m, proto, 1), (Normal, m, proto, 2)], vec![dup(2, "__proto__")]);
    check(&[(Normal, n, proto, 1), (Normal, s, proto, 2)], vec![]);
    check(&[(Normal, n, proto, 1), (Normal, m, proto, 2)], vec![]);
    check(&[(Normal, n, proto, 1), (Get, m, proto, 2)], vec![]);
    check(&[(Get, m, proto, 1), (Get, m, proto, 2)], vec![dup(2, "__proto__")]);
    check(&[(Get, m, proto, 1), (Set, m, proto, 2)], vec![]);
    check(
        &[(Normal, n, proto, 1), (Normal, c, proto, 2), (Normal, m, proto, 3)],
        vec![dup(3, "__proto__")],
    );
    check(&[(Normal, n, proto, 1), (Normal, n, a, 2), (Normal, n, a, 3)], vec![dup(3, "a")]);
    // Keys that are not static, and spreads.
    check(&[(Normal, c, None, 1), (Normal, c, None, 2)], vec![]);
    check(&[(Normal, n, a, 1), (Normal, c, None, 2)], vec![]);
    check(&[(Spread, n, None, 1), (Spread, n, None, 2)], vec![]);
    check(&[(Normal, n, a, 1), (Spread, n, None, 2), (Normal, n, a, 3)], vec![dup(3, "a")]);
    check(&[(Normal, n, a, 1), (Spread, n, None, 2)], vec![]);
    // The empty name.
    check(&[(Normal, n, Some(""), 1), (Normal, n, Some(""), 2)], vec![dup(2, "")]);
    check(&[(Normal, n, Some(""), 1), (Normal, n, Some(" "), 2)], vec![]);
    check(
        &[(Normal, n, a, 1), (Normal, n, Some(""), 2), (Normal, n, a, 3), (Normal, n, Some(""), 4)],
        vec![dup(3, "a"), dup(4, "")],
    );
    // Wide literals: the keys of one name keep their order through the sort.
    let names = [
        "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v",
    ];
    let mut wide: Vec<P> = Vec::with_capacity(names.len() + 3);
    wide.push((Get, m, Some("z"), 1));
    for (at, name) in (2..).zip(names) {
        wide.push((Normal, n, Some(name), at));
    }
    wide.push((Normal, n, Some("z"), 100));
    wide.push((Set, m, Some("z"), 101));
    check(&wide, vec![dup(100, "z"), dup(101, "z")]);
    // The shape of the widest case of the fixture: a value and then a getter of each name.
    let mut wide: Vec<P> = Vec::with_capacity(2 * names.len() + 2);
    let mut expected: Vec<(i32, Vec<u8>)> = Vec::with_capacity(names.len() + 1);
    wide.push((Normal, n, Some("z"), 1));
    for (at, name) in (2..).zip(names) {
        wide.push((Normal, n, Some(name), at));
        wide.push((Get, m, Some(name), 200 + at));
        expected.push(dup(200 + at, name));
    }
    wide.push((Get, m, Some("z"), 100));
    expected.push(dup(100, "z"));
    expected.sort();
    check(&wide, expected);

    let _ = writeln!(std::io::stdout(), "no_dupe_keys.rs over hand-made property lists: {checks} checks hold");
}
