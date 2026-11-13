use super::super::EvaluatedTextForm;
use super::*;

type FoundText = (String, EvaluatedTextForm, Vec<String>);

struct Expected {
    source: &'static str,
    call: &'static str,
    form: EvaluatedTextForm,
    texts: &'static [&'static str],
}

const FOUND: &[Expected] = &[
    Expected {
        source: "Function(\"return this\")();",
        call: "Function(\"return this\")",
        form: EvaluatedTextForm::FunctionBody,
        texts: &["return this"],
    },
    Expected {
        source: "new Function(\"a\", \"b\", \"return a + b\");",
        call: "new Function(\"a\", \"b\", \"return a + b\")",
        form: EvaluatedTextForm::FunctionBody,
        texts: &["a", "b", "return a + b"],
    },
    Expected {
        source: "Function();",
        call: "Function()",
        form: EvaluatedTextForm::FunctionBody,
        texts: &[],
    },
    Expected {
        source: "(0, eval)(\"this\");",
        call: "(0, eval)(\"this\")",
        form: EvaluatedTextForm::Script,
        texts: &["this"],
    },
    Expected {
        source: "globalThis.eval(\"1\");",
        call: "globalThis.eval(\"1\")",
        form: EvaluatedTextForm::Script,
        texts: &["1"],
    },
    Expected {
        source: "const e = eval; e(\"1\");",
        call: "e(\"1\")",
        form: EvaluatedTextForm::Script,
        texts: &["1"],
    },
    Expected {
        source: "const body = \"return 1\"; Function(body);",
        call: "Function(body)",
        form: EvaluatedTextForm::FunctionBody,
        texts: &["return 1"],
    },
    Expected {
        source: "Function(`return 1`);",
        call: "Function(`return 1`)",
        form: EvaluatedTextForm::FunctionBody,
        texts: &["return 1"],
    },
    Expected {
        source: "Function(\"return \" + \"1\");",
        call: "Function(\"return \" + \"1\")",
        form: EvaluatedTextForm::FunctionBody,
        texts: &["return 1"],
    },
    Expected {
        source: "(0, eval)(\"1\", x);",
        call: "(0, eval)(\"1\", x)",
        form: EvaluatedTextForm::Script,
        texts: &["1"],
    },
];

const NOT_FOUND: &[(Setup, &str)] = &[
    (PROGRAM, "eval(\"this\");"),
    (PROGRAM, "Function(s);"),
    (PROGRAM, "Function(\"a\", s);"),
    (PROGRAM, "Function(...parts);"),
    (PROGRAM, "Function(1);"),
    (PROGRAM, "new (0, eval)(\"1\");"),
    (PROGRAM, "(0, eval)();"),
    (PROGRAM, "(0, eval)(1);"),
    (PROGRAM, "(0, eval)(s, \"1\");"),
    (PROGRAM, "function f(Function) { Function(\"x\"); }"),
    (PROGRAM, "if (false) Function(\"x\");"),
    (PROGRAM, "setTimeout(\"x\");"),
    (PROGRAM, "Function.call(\"x\");"),
    (SCRIPT, "with (o) { Function(\"x\"); }"),
];

fn to_text(bytes: &[u8]) -> String {
    std::str::from_utf8(bytes).unwrap().to_owned()
}

fn texts(case: &Case<'_, '_>) -> Vec<FoundText> {
    let found = case.resolved.evaluated_texts().iter();
    found
        .map(|text| {
            let parts = text
                .texts
                .iter()
                .map(|&part| to_text(case.atoms.bytes(part)));
            (
                case.text_of(text.call).to_owned(),
                text.form,
                parts.collect(),
            )
        })
        .collect()
}

#[test]
fn constant_text_is_found() {
    for expected in FOUND {
        with_case(PROGRAM, expected.source, |case| {
            let parts = expected.texts.iter().map(|&part| part.to_owned());
            let found: FoundText = (expected.call.to_owned(), expected.form, parts.collect());
            assert_eq!(texts(case), [found], "{}", expected.source);
        });
    }
}

#[test]
fn other_calls_are_not_found() {
    for &(setup, source) in NOT_FOUND {
        with_case(setup, source, |case| {
            let found = texts(case);
            assert!(found.is_empty(), "{source}: {found:?}");
        });
    }
}

#[test]
fn texts_are_sorted_by_call() {
    let source = "Function(\"a\"); (0, eval)(\"b\"); new Function(\"c\"); f(\"d\");";
    with_case(PROGRAM, source, |case| {
        let found = case.resolved.evaluated_texts();
        assert_eq!(found.len(), 3);
        assert!(found.is_sorted_by(|left, right| left.call < right.call));
        for text in found {
            assert_eq!(case.resolved.evaluated_text(text.call), Some(text));
        }
        for other in ["f(\"d\")", "\"a\"", "Function", "0, eval"] {
            assert_eq!(
                case.resolved.evaluated_text(case.expr(other)),
                None,
                "{other}"
            );
        }
    });
}

#[test]
fn callee_is_predicted() {
    with_case(PROGRAM, "Function(\"x\"); (0, eval)(\"y\");", |case| {
        let callees: Vec<BuiltinPath> = case
            .resolved
            .evaluated_texts()
            .iter()
            .map(|text| text.callee)
            .collect();
        let predicted = |id| BuiltinPath {
            id,
            mutability: Mutability::ConstantUnlessWritten,
        };
        assert_eq!(
            callees,
            [predicted(BuiltinId::Function), predicted(BuiltinId::Eval)]
        );
    });
}
