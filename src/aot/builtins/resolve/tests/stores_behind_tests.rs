use super::*;

const TEST_SCRIPT: Setup = Setup {
    runs_tests: true,
    ..SCRIPT
};

const HEAD: &str = "var _a, _c, f = function () { return 1; };\n";

// The twelve texts of test/aot/a-polyfill-behind-a-test-for-its-member-costs-no-second-build.test.ts. Nothing defines `undefined` here, so the twelfth compares with `void 0`.
// No holder stands behind `_c` in the second, so the last two store to the member itself: behind a variable that is filled, and behind a holder that is stored.
const BEHIND_A_TEST: &[&str] = &[
    r#"Symbol.dispose ??= Symbol.for("d");"#,
    r#"(_a = (_c = Symbol).dispose) !== null && _a !== void 0 ? _a : (_c.dispose = Symbol.for("d"));"#,
    r#"(_a = Symbol.dispose) != null ? _a : Symbol.dispose = Symbol.for("d");"#,
    r#"Symbol.dispose || (Symbol.dispose = Symbol.for("d"));"#,
    r#"Symbol.dispose ?? (Symbol.dispose = Symbol.for("d"));"#,
    r#"if (!Symbol.dispose) Symbol.dispose = Symbol.for("d");"#,
    "if (!Array.prototype.at) { _c = 1; Array.prototype.at = f; }",
    "if (Array.prototype.at) _c = 1; else Array.prototype.at = f;",
    r#"if (typeof Symbol.dispose === "undefined") Symbol.dispose = Symbol.for("d");"#,
    r#"if (Symbol.dispose == null) Symbol.dispose = Symbol.for("d");"#,
    r#""dispose" in Symbol || (Symbol.dispose = Symbol.for("d"));"#,
    r#"Symbol.dispose === void 0 && Object.defineProperty(Symbol, "dispose", { value: Symbol.for("d") });"#,
    r#"(_a = Symbol.dispose) !== null && _a !== void 0 ? _a : (Symbol.dispose = Symbol.for("d"));"#,
    r#"(_a = (_c = Symbol).dispose) !== null && _a !== void 0 ? _a : (Symbol.dispose = Symbol.for("d"));"#,
];

const NOT_BEHIND_ONE: &[&str] = &[
    "if (Array.prototype.at) Array.prototype.at = f;",
    "if (!Array.prototype.at) {} else { Array.prototype.at = f; }",
    "_a = Array.prototype.at; _a = undefined; _a !== void 0 ? _a : (Array.prototype.at = f);",
    "(!Array.prototype.at || process.argv.length) && (Array.prototype.at = f);",
    "if (!Array.prototype.at) { _c = 1; } Array.prototype.at = f;",
    "Array.prototype.at && (Array.prototype.at = f);",
    "(_a = Array.prototype.at) !== null && _a !== void 0 ? (Array.prototype.at = f) : _a;",
    "if (Array.prototype.at != null) Array.prototype.at = f;",
    "function later() { Array.prototype.at = f; } if (!Array.prototype.at) _c = 1; later();",
    "if (!Array.prototype.includes) Array.prototype.at = f;",
    r#"if (typeof Array.prototype.at === "function") Array.prototype.at = f;"#,
    r#""includes" in Array.prototype || (Array.prototype.at = f);"#,
];

fn member_of(holder: BuiltinId, name: &str) -> BuiltinId {
    let name = table::find_name(name.as_bytes()).expect("the table has the name");
    match table::member(holder, name) {
        MemberLookup::Found(member) => member,
        MemberLookup::Unknown | MemberLookup::Absent => panic!("the holder has the member"),
    }
}

#[test]
fn store_behind_a_test_that_finds_the_member_missing_replaces_nothing() {
    for &source in BEHIND_A_TEST {
        with_case(TEST_SCRIPT, &format!("{HEAD}{source}"), |case| {
            let replaced = case.resolved.replaced_members();
            assert!(replaced.is_empty(), "{source}: {replaced:?}");
        });
    }
}

#[test]
fn store_that_only_looks_as_if_it_stood_behind_such_a_test_replaces_the_member() {
    let at = member_of(BuiltinId::ArrayPrototype, "at");
    for &source in NOT_BEHIND_ONE {
        with_case(TEST_SCRIPT, &format!("{HEAD}{source}"), |case| {
            assert!(case.resolved.replaced_members().contains(&at), "{source}");
        });
    }
}

#[test]
fn accessor_that_may_answer_an_empty_text_is_replaced_behind_its_test() {
    let source = r#"if (!RegExp.prototype.flags) Object.defineProperty(RegExp.prototype, "flags", { get: f, configurable: true });"#;
    with_case(TEST_SCRIPT, &format!("{HEAD}{source}"), |case| {
        let replaced = case.resolved.replaced_members();
        assert!(replaced.contains(&BuiltinId::RegExpPrototypeFlags), "{replaced:?}");
    });
}
