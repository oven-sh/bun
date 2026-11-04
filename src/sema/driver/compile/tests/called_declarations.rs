use super::support::{check, with_program};
use bun_sema::check::aot::{BuiltinTypeSymbols, NamedValue, NamedValues, Queries, QueryInputs};
use bun_sema::hir::{ExprId, ExprKind};
use bun_sema::program::{FileId, FileRole};
use std::sync::Mutex;

struct NoNamedValues;

impl NamedValues for NoNamedValues {
    fn find_named_value(&self, _: FileId, _: ExprId) -> Option<NamedValue> {
        None
    }
}

fn ask<T: Send + Default>(
    name: &str,
    text: &str,
    role: FileRole,
    ask: &(dyn Fn(&mut Queries<'_, '_, '_>) -> T + Sync),
) -> T {
    with_program(&[(name, text)], &[&format!("./{name}")], 1, |program| {
        let all = program.files();
        let roles = vec![role; all.modules.len()];
        let inputs = QueryInputs {
            roles: &roles,
            checked_elsewhere: &[],
            builtin_types: &BuiltinTypeSymbols::compute(all, &[], Box::new(|| &[])),
            named_values: &NoNamedValues,
            max_inference_nodes: 4096,
            limits: Default::default(),
        };
        let main = program.file(name);
        let answer = Mutex::new(T::default());
        check(program, &|checker, file| {
            if file == main {
                *answer.lock().unwrap() =
                    checker.with_queries(file, &inputs, |queries| ask(queries));
            }
        });
        answer.into_inner().unwrap()
    })
}

/// In the order of the text.
fn find_calls(queries: &Queries<'_, '_, '_>) -> Vec<ExprId> {
    let expressions = queries.hir().exprs.iter().enumerate();
    let mut calls: Vec<(u32, ExprId)> = expressions
        .filter(|(_, expression)| matches!(expression.kind, ExprKind::Call(_)))
        .map(|(index, expression)| (expression.pos, ExprId(index as u32)))
        .collect();
    calls.sort();
    calls.into_iter().map(|call| call.1).collect()
}

const CALLS: &str = "function plain(a: number) { return a; }
function generic<T>(a: T) { return a; }
function overloaded(a: number): number;
function overloaded(a: string): string;
function overloaded(a: any) { return a; }
declare function ambient(a: number): number;
class Counter { bump(by: number) { return by; } static make() { return new Counter(); } }
const arrow = (a: number) => a;
interface Shown { show(a: number): string; pick(a: number): number; pick(a: string): string }
export function calls(
    handed: (a: number) => number,
    either: ((a: number) => number) | ((a: number) => string),
    loose: any,
    counter: Counter,
    shown: Shown,
    absent?: () => void,
) {
    plain(1);
    generic(1);
    overloaded(1);
    ambient(1);
    counter.bump(1);
    Counter.make();
    arrow(1);
    handed(1);
    either(1);
    loose(1);
    shown.show(1);
    shown.pick(1);
    absent?.();
    plain();
}
";

#[test]
fn the_only_declaration_called_is_the_one_that_the_call_resolves_to() {
    let found = ask("main.ts", CALLS, FileRole::Checked, &|queries| {
        let mut found = Vec::new();
        for call in find_calls(queries) {
            let only = queries.only_declaration_called(call);
            let resolved = queries.resolved_call(call).unwrap();
            if only.is_some() {
                assert_eq!(only, resolved.unwrap().declaration);
            }
            let start = queries.hir()[call].pos as usize;
            let callee = CALLS[start..].split(['(', '?']).next().unwrap();
            found.push((callee.to_string(), only.is_some()));
        }
        found
    });
    let found: Vec<(&str, bool)> = found.iter().map(|it| (&it.0[..], it.1)).collect();
    let expected = [
        ("plain", true),
        ("generic", true),
        ("overloaded", false),
        ("ambient", true),
        ("counter.bump", true),
        ("Counter.make", true),
        ("arrow", true),
        ("handed", true),
        ("either", false),
        ("loose", false),
        ("shown.show", true),
        ("shown.pick", false),
        ("absent", true),
        // Too few arguments: a call with one candidate resolves to it all the same.
        ("plain", true),
    ];
    assert_eq!(found, expected);
}

// As a library of tokens has it. Whoever looks at the argument of `toNumber` asks for the type of `value`, which is what the getter returns, which reads
// what the setter stores: the call itself.
const CIRCLE_THROUGH_AN_ARGUMENT: &str = "/** @returns {number} */
function toNumber(/** @type {any} */ value) { return +value; }
/** @returns {number} */
function larger(/** @type {number} */ a, /** @type {number} */ b) { return a > b ? a : b; }
export class Tokens {
    set expiresIn(value) { this.expiresAt = 1 + toNumber(value); }
    get expiresIn() { return larger(this.expiresAt - 1, 0); }
}
";

#[test]
fn a_call_with_one_candidate_that_is_not_generic_is_resolved_without_a_look_at_its_arguments() {
    let text = ask(
        "main.js",
        CIRCLE_THROUGH_AN_ARGUMENT,
        FileRole::Inferred,
        &|queries| {
            for call in find_calls(queries) {
                queries.resolved_call(call).unwrap();
            }
            let parameters = queries.hir().params.iter();
            let value = parameters.map(|parameter| parameter.pat).nth(3).unwrap();
            let ty = queries.binding_type(value).unwrap();
            String::from_utf8(queries.type_text(ty)).unwrap()
        },
    );
    assert_eq!(text, "number");
}
