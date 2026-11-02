mod support;
use support::*;

const PRIVATE_REFERENCES: &[(&str, Option<&str>)] = &[
    ("class C { #a; m(o) { o.#a; } }", Some("C")),
    ("class C { #a; m(o) { #a in o; } }", Some("C")),
    ("class C { #a; [o.#a]() {} }", Some("C")),
    ("class C { static #a; @(C.#a) m() {} }", Some("C")),
    (
        "class D { #a; m(o) { class C { n() { o.#a; } } } }",
        Some("D"),
    ),
    (
        "class D { #a; m(o) { class C { #a; n() { o.#a; } } } }",
        Some("C"),
    ),
    ("class C extends (o.#a) { #a; }", None),
    ("class C extends (#a in o ? A : B) { #a; }", None),
    (
        "class D { #a; m(o) { class C extends (o.#a) { #a; } } }",
        Some("D"),
    ),
    (
        "class D { #a; m(o) { class C extends (() => o.#a) { #a; } } }",
        Some("D"),
    ),
    (
        "class D { #a; m(o) { (class C extends (o.#a) { #a; }); } }",
        Some("D"),
    ),
    (
        "class C extends (class B { #a; m(o) { o.#a; } }) { #a; }",
        Some("B"),
    ),
    ("class C extends (class B { m(o) { o.#a; } }) { #a; }", None),
    (
        "class D { #a; m(o) { @(o.#a) class C { #a; } } }",
        Some("D"),
    ),
    (
        "class D { #a; m(o) { (@(o.#a) class C { #a; }); } }",
        Some("D"),
    ),
    (
        "class D { #a; m(o) { @(class B { n() { o.#a; } }) class C { #a; } } }",
        Some("D"),
    ),
    ("class C { #b; m(o) { o.#a; } }", None),
    ("o.#a;", None),
];

fn private_references(hir: &File<'_>) -> Vec<ExprId> {
    let candidates = find_exprs(hir, |kind| {
        matches!(kind, ExprKind::Dot { .. } | ExprKind::PrivateIdentifier(_))
    });
    let is_private = |&e: &ExprId| hir.expr_flags(e).contains(ExprFlags::PRIVATE_NAME);
    candidates.into_iter().filter(is_private).collect()
}

fn members_of(s: &Analyzed<'_>, class: &str) -> Vec<MemberId> {
    s.hir[s.class(class)].members.iter().collect()
}

fn names_of<'a>(s: &'a Analyzed<'_>, class: &str) -> Vec<(PrivateNameId, &'a PrivateName)> {
    s.bound.private_names_of_class(s.class(class)).collect()
}

fn has_decorator_scope(s: &Analyzed<'_>) -> bool {
    let mut kinds = s.bound.scopes.iter().map(|scope| scope.kind);
    kinds.any(|kind| matches!(kind, ScopeKind::ClassDecorators(_)))
}

#[test]
fn private_names_are_in_scope_in_class_body_only() {
    for &(text, expected) in PRIVATE_REFERENCES {
        analyzed("a.ts", text, |s| {
            let [reference] = private_references(&s.hir)[..] else {
                panic!("{text}");
            };
            let expected = expected.map(|name| s.class(name));
            assert_eq!(s.bound.runtime.private_class(reference), expected, "{text}");
            let name = s.bound.private_name_of_reference(reference);
            let class = name.map(|name| s.bound.private_name(name).class);
            assert_eq!(class, expected, "{text}");
        });
    }
}

#[test]
fn private_references_bound_out_of_tree_order_are_found() {
    let text = "class C { #a; m(o) { (function () { o.#a; })(o.#a, #a in o); } }";
    analyzed("a.ts", text, |s| {
        let references = private_references(&s.hir);
        assert_eq!(references.len(), 3);
        let [(name, _)] = names_of(s, "C")[..] else {
            panic!("one private name");
        };
        for reference in references {
            assert_eq!(s.bound.private_name_of_reference(reference), Some(name));
        }
    });
}

#[test]
fn same_text_in_two_classes_is_two_names() {
    let text = "class C { #a; m(o) { o.#a; } } class D { #a; m(o) { o.#a; } }";
    analyzed("a.mjs", text, |s| {
        let [first, second] = private_references(&s.hir)[..] else {
            panic!("two references");
        };
        let first = s.bound.private_name_of_reference(first).unwrap();
        let second = s.bound.private_name_of_reference(second).unwrap();
        assert_ne!(first, second);
        assert_eq!(
            s.bound.private_name(first).name,
            s.bound.private_name(second).name
        );
        assert_eq!(s.bound.private_name(first).class, s.class("C"));
        assert_eq!(s.bound.private_name(second).class, s.class("D"));
    });
}

#[test]
fn kinds_of_private_members() {
    let text = "class C { #f; static #s = 1; #m() {} get #g() {} get #p() {} set #p(v) {} \
                set #w(v) {} accessor #x; static #t() {} }";
    analyzed("a.ts", text, |s| {
        let members = members_of(s, "C");
        let names = names_of(s, "C");
        let described: Vec<(PrivateMembers, bool)> = names
            .iter()
            .map(|(_, name)| (name.members, name.is_static))
            .collect();
        let accessor = |getter, setter| PrivateMembers::Accessor { getter, setter };
        assert_eq!(
            described,
            [
                (PrivateMembers::Field(members[0]), false),
                (PrivateMembers::Field(members[1]), true),
                (PrivateMembers::Method(members[2]), false),
                (accessor(Some(members[3]), None), false),
                (accessor(Some(members[4]), Some(members[5])), false),
                (accessor(None, Some(members[6])), false),
                (PrivateMembers::AutoAccessor(members[7]), false),
                (PrivateMembers::Method(members[8]), true),
            ]
        );
        for (id, name) in names {
            assert_eq!(s.bound.private_name_of_member(name.first_member), Some(id));
        }
        let pair = s.bound.private_name_of_member(members[4]);
        assert_eq!(s.bound.private_name_of_member(members[5]), pair);
    });
}

#[test]
fn public_members_have_no_private_name() {
    analyzed(
        "a.mjs",
        "class C { a; m() {} static {} constructor() {} }",
        |s| {
            assert!(names_of(s, "C").is_empty());
            for member in members_of(s, "C") {
                assert_eq!(s.bound.private_name_of_member(member), None);
            }
            assert!(s.bound.runtime.private_names().is_empty());
        },
    );
}

#[test]
fn names_are_listed_by_class() {
    let text = "class C { #a; m() { class D { #b; #c; } } #d; } class E { #e; }";
    analyzed("a.mjs", text, |s| {
        let texts = |class: &str| -> Vec<String> {
            let names = names_of(s, class);
            let texts = names
                .iter()
                .map(|(_, name)| s.workspace.text(name.name).to_owned());
            texts.collect()
        };
        assert_eq!(texts("C"), ["#a", "#d"]);
        assert_eq!(texts("D"), ["#b", "#c"]);
        assert_eq!(texts("E"), ["#e"]);
        let all = s.bound.runtime.private_names();
        assert!(all.is_sorted_by_key(|name| (name.class, name.first_member)));
        assert_eq!(all.len(), 5);
    });
}

#[test]
fn duplicate_keeps_first_and_is_an_early_error() {
    analyzed("a.mjs", "class C { #a; #a() {} }", |s| {
        let members = members_of(s, "C");
        let [(id, name)] = names_of(s, "C")[..] else {
            panic!("one private name");
        };
        assert_eq!(name.members, PrivateMembers::Field(members[0]));
        assert_eq!(s.bound.private_name_of_member(members[1]), Some(id));
        let pair = EarlyRedeclaration {
            earlier: Decl::Member(members[0]),
            later: Decl::Member(members[1]),
        };
        assert_eq!(s.bound.runtime.early_redeclarations(), [pair]);
    });
}

#[test]
fn members_that_do_not_run_declare_nothing() {
    analyzed(
        "a.ts",
        "declare class C { #a; } class D { #m(): void; #m() {} }",
        |s| {
            assert!(names_of(s, "C").is_empty());
            let members = members_of(s, "D");
            let [(_, name)] = names_of(s, "D")[..] else {
                panic!("one private name");
            };
            assert_eq!(name.members, PrivateMembers::Method(members[1]));
            assert_eq!(s.bound.private_name_of_member(members[0]), None);
        },
    );
}

#[test]
fn only_decorated_class_expression_has_decorator_scope() {
    analyzed("a.ts", "const D = @d class C {};", |s| {
        assert!(has_decorator_scope(s))
    });
    analyzed(
        "a.ts",
        "const D = class C { @d m() {} }; @d class E {}",
        |s| {
            assert!(!has_decorator_scope(s));
        },
    );
}

#[test]
fn check_build_records_nothing() {
    with_workspace(|workspace| {
        let hir = workspace.parse(&Source::new("a.ts", "class C { #a; m(o) { o.#a; } }"));
        assert!(!workspace.bind_for_check(&hir).runtime.is_computed());
    });
}
