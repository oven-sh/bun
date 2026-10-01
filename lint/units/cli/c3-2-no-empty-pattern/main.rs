// src/lint/rules/no_empty_pattern.rs as the crate has it, against stand-ins of what it reads, over hand-made patterns.
// LINT_DIR is replaced by run.sh. The module of the rule has no `allow`: the lint levels of the command line hold for it.

mod context {
    use std::borrow::Cow;
    use std::marker::PhantomData;

    use bun_ast::Loc;

    use crate::rule::{Rule, RuleCategory};

    pub(crate) struct Context<'p, 'a> {
        pub(crate) reports: Vec<(&'static str, Loc, Vec<u8>)>,
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
            self.reports.push((rule.name, at, text.into().into_owned()));
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
    #[path = "LINT_DIR/rules/no_empty_pattern.rs"]
    pub(crate) mod no_empty_pattern;
}

use std::io::Write;

use bun_ast::{ArrayBinding, B, E, Expr, G, Loc, StoreSlice};

use context::Context;
use rules::no_empty_pattern;

type Reports = Vec<(&'static str, Loc, Vec<u8>)>;

const ARRAY: &[u8] = b"Unexpected empty array pattern.";
const OBJECT: &[u8] = b"Unexpected empty object pattern.";

// One report of the rule at `at` with `text`.
fn one(at: i32, text: &[u8]) -> Reports {
    vec![("no-empty-pattern", Loc { start: at }, text.to_vec())]
}

// A binding `[...]` with `holes` holes and then `names` names, at `at`.
fn b_array(holes: usize, names: usize, at: i32) -> Reports {
    let items: Vec<ArrayBinding> = (0..holes + names)
        .map(|index| ArrayBinding {
            is_missing: index < holes,
        })
        .collect();
    let node = B::Array {
        items: StoreSlice::new(items.leak()),
        has_spread: false,
        is_single_line: true,
    };
    let mut context = Context::new();
    no_empty_pattern::b_array(&mut context, &node, Loc { start: at });
    context.reports
}

// A binding `{...}` with `properties` properties, at `at`.
fn b_object(properties: usize, at: i32) -> Reports {
    let properties: Vec<B::Property> = (0..properties).map(|_| B::Property {}).collect();
    let node = B::Object {
        properties: StoreSlice::new(properties.leak()),
        is_single_line: true,
    };
    let mut context = Context::new();
    no_empty_pattern::b_object(&mut context, &node, Loc { start: at });
    context.reports
}

// A literal `[...]` that is the target of an assignment, with `holes` holes and then `values` values, at `at`.
fn e_array(holes: usize, values: usize, at: i32) -> Reports {
    let node = E::Array {
        items: (0..holes + values)
            .map(|index| Expr {
                is_missing: index < holes,
            })
            .collect(),
    };
    let mut context = Context::new();
    no_empty_pattern::e_array(&mut context, &node, Loc { start: at });
    context.reports
}

// A literal `{...}` that is the target of an assignment, with `properties` properties, at `at`.
fn e_object(properties: usize, at: i32) -> Reports {
    let node = E::Object {
        properties: (0..properties).map(|_| G::Property {}).collect(),
    };
    let mut context = Context::new();
    no_empty_pattern::e_object(&mut context, &node, Loc { start: at });
    context.reports
}

fn main() {
    let mut checks = 0usize;
    let mut failed = 0usize;
    let mut check = |what: &str, got: Reports, want: Reports| {
        checks += 1;
        if got != want {
            failed += 1;
            println!("FAILED {what}: got {got:?}, want {want:?}");
        }
    };

    // `var [] = a` and `var {} = a`: reported at the `[` and at the `{` that the walk hands over.
    check("b_array, empty", b_array(0, 0, 4), one(4, ARRAY));
    check("b_object, empty", b_object(0, 4), one(4, OBJECT));
    // `[] = a` and `({} = a)`.
    check("e_array, empty", e_array(0, 0, 0), one(0, ARRAY));
    check("e_object, empty", e_object(0, 1), one(1, OBJECT));
    // The place is the one that the walk hands over, whatever it is.
    for at in [0, 1, 7, 4096, i32::MAX] {
        check("b_array, place", b_array(0, 0, at), one(at, ARRAY));
        check("b_object, place", b_object(0, at), one(at, OBJECT));
        check("e_array, place", e_array(0, 0, at), one(at, ARRAY));
        check("e_object, place", e_object(0, at), one(at, OBJECT));
    }
    // `var [a] = b`, `var {a} = b`, `[a] = b`, `({a} = b)` and longer ones: not reported.
    for count in 1..=4 {
        check("b_array, names", b_array(0, count, 4), Vec::new());
        check("b_object, properties", b_object(count, 4), Vec::new());
        check("e_array, values", e_array(0, count, 0), Vec::new());
        check("e_object, properties", e_object(count, 1), Vec::new());
    }
    // `var [,] = a`, `[,] = a`, `var [,,] = a`, `[, a] = b`: a hole is an element, as the `null` of ESLint's `elements`.
    for holes in 1..=3 {
        check("b_array, holes", b_array(holes, 0, 4), Vec::new());
        check("e_array, holes", e_array(holes, 0, 0), Vec::new());
        check("b_array, holes and a name", b_array(holes, 1, 4), Vec::new());
        check("e_array, holes and a value", e_array(holes, 1, 0), Vec::new());
    }

    let mut out = std::io::stdout();
    let _ = writeln!(
        out,
        "no_empty_pattern.rs against the stand-ins: {} checks, {} failed",
        checks, failed
    );
    if failed != 0 {
        std::process::exit(1);
    }
}
