use bun_sema::hir::{ExprId, ExprKind};

use super::{DescribedPart, WrittenDescriptor};
use crate::modules::testing::{file_named, with_graph};

fn describe_flag(name: char, flag: Option<bool>) -> String {
    match flag {
        None => String::new(),
        Some(true) => format!(" +{name}"),
        Some(false) => format!(" -{name}"),
    }
}

fn describe(written: WrittenDescriptor) -> String {
    let has = |part: Option<ExprId>, name: &'static str| part.map_or("", |_| name);
    let part = match written.part {
        DescribedPart::Data { value, is_writable } => {
            format!(
                "data{}{}",
                has(value, " value"),
                describe_flag('w', is_writable)
            )
        }
        DescribedPart::Accessor { getter, setter } => {
            format!("accessor{}{}", has(getter, " get"), has(setter, " set"))
        }
    };
    let is_enumerable = describe_flag('e', written.is_enumerable);
    let is_configurable = describe_flag('c', written.is_configurable);
    format!("{part}{is_enumerable}{is_configurable}")
}

fn read(descriptor: &str) -> Option<String> {
    let source = format!(
        "const f = () => 1, yes = true, get = f, value = 1, more = {{}}; let no = false; no = true;\n\
         Object.defineProperty(exports, 'a', {descriptor});"
    );
    with_graph(&[("main.cjs", source.as_str())], |_, input| {
        let files = input.files;
        let file = file_named(input, "main.cjs");
        let hir = files.hir(file);
        let compiled = files.compiled(file).expect("the file is compiled");
        let mut expressions = (0..hir.exprs.len() as u32).map(ExprId);
        let arguments = expressions.find_map(|expression| match hir[expression].kind {
            ExprKind::Call(call) if hir[call].args.len() == 3 => Some(hir[call].args),
            _ => None,
        });
        let descriptor = hir.id_at(arguments.expect("the definition"), 2);
        let decisions = &compiled.analysis.decisions;
        WrittenDescriptor::read(&files.atoms, hir, decisions, descriptor).map(describe)
    })
}

#[test]
fn a_literal_says_what_it_names() {
    let rows = [
        ("{}", "data"),
        ("{ value: 1 }", "data value"),
        ("{ value }", "data value"),
        ("{ value() {} }", "data value"),
        ("{ value: undefined }", "data value"),
        ("{ writable: true }", "data +w"),
        ("{ writable: false }", "data -w"),
        (
            "{ value: 1, writable: true, enumerable: true, configurable: true }",
            "data value +w +e +c",
        ),
        (
            "{ value: 1, writable: undefined, enumerable: null, configurable: void 0 }",
            "data value -w -e -c",
        ),
        ("{ enumerable: !0, configurable: !1 }", "data +e -c"),
        ("{ enumerable: true, enumerable: false }", "data -e"),
        (
            "{ enumerable: false, value: 1, enumerable: true }",
            "data value +e",
        ),
        ("{ get: f }", "accessor get"),
        ("{ get }", "accessor get"),
        ("{ get() { return 1; } }", "accessor get"),
        ("{ get: undefined }", "accessor get"),
        ("{ set: undefined }", "accessor set"),
        (
            "{ set(v) {}, get: f, enumerable: true }",
            "accessor get set +e",
        ),
    ];
    for (descriptor, expected) in rows {
        assert_eq!(read(descriptor).as_deref(), Some(expected), "{descriptor}");
    }
}

#[test]
fn a_value_or_writable_beside_a_function_is_refused() {
    for descriptor in [
        "{ get: f, value: 1 }",
        "{ set: f, value: undefined }",
        "{ get: undefined, value: 1 }",
        "{ get: f, writable: true }",
        "{ get: f, writable: false }",
        "{ get: f, writable: undefined }",
        "{ writable: false, set: f }",
    ] {
        assert_eq!(read(descriptor), None, "{descriptor}");
    }
}

#[test]
fn a_literal_that_does_not_say_it_all_is_not_read() {
    for descriptor in [
        "more",
        "{ ...more }",
        "{ value: 1, ...more }",
        "{ [f()]: 1 }",
        "{ __proto__: more, value: 1 }",
        "{ __proto__: null, value: 1 }",
        "{ get value() { return 1; } }",
        "{ set enumerable(v) {}, value: 1 }",
        "{ enumerable: yes, value: 1 }",
        "{ enumerable: no, value: 1 }",
        "{ enumerable: f(), value: 1 }",
        "{ enumerable: 1, value: 1 }",
        "{ enumerable: '', value: 1 }",
        "{ enumerable: 0n, value: 1 }",
        "{ enumerable() {}, value: 1 }",
        "{ value: 1, value: 2 }",
        "{ get: f, get: undefined }",
        "{ value: 1, other: f() }",
    ] {
        assert_eq!(read(descriptor), None, "{descriptor}");
    }
}
