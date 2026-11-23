use crate::{Options, Parsed, Scratch};
use bun_sema::atom::Interner;
use bun_sema::hir::ExprKind;
use bun_sema::session::Session;
use std::cell::Cell;
use std::fmt::Debug;

thread_local! {
    /// How many stretches have been taken.
    pub(super) static TAKEN: Cell<usize> = const { Cell::new(0) };
}

fn assert_same_lists<T: Debug>(name: &str, shared: &[T], alone: &[T]) {
    for (at, (shared, alone)) in shared.iter().zip(alone).enumerate() {
        assert_eq!(format!("{shared:?}"), format!("{alone:?}"), "{name}[{at}]");
    }
    assert_eq!(shared.len(), alone.len(), "{name}");
}

fn assert_same(shared: &Parsed, alone: &Parsed) {
    macro_rules! lists {
        ($($it:ident)*) => { $(assert_same_lists(stringify!($it), &shared.file.$it, &alone.file.$it);)* };
    }
    macro_rules! values {
        ($($it:ident)*) => { $(assert_same_lists(stringify!($it), &[&shared.file.$it], &[&alone.file.$it]);)* };
    }
    lists!(
        exprs stmts types fns members decorators diagnostics references comment_directives ignore_comments comments
        detached_semicolons body_starts modifiers_of_params modifiers_of_stmts modifiers_of_props specifier_uses
        deferred_import_calls import_call_type_args import_attributes specifier_expressions exports_from_expressions
        parens non_null_ends far_names tagged_templates ids numbers pats pat_props pat_elems params type_params classes
        interfaces aliases enums enum_members modules props var_decls calls cases imports import_specs import_equals
        exports export_specs tuple_elems mapped modifiers names keyword_identifier_positions expr_flags template_parts
        template_part_starts export_star_attributes bigint_names
    );
    values!(
        kind check_directive has_module_syntax has_errors ran_out_of_stack may_bind_a_parameter_twice rare_syntax
        has_parse_diagnostics syntax_errors error_pos source_len body is_strict is_strict_by_syntax
    );
    let rest = |parsed: &Parsed| {
        let type_arguments = parsed.file.exprs.iter().filter_map(|it| match it.kind {
            ExprKind::Instantiation { type_args, .. } => Some(parsed.file.list_at(type_args)),
            _ => None,
        });
        (
            type_arguments.collect::<Vec<_>>(),
            parsed.has_top_level_await,
            parsed.names_await_at_top_level,
            parsed.end,
        )
    };
    assert_eq!(rest(shared), rest(alone));
}

/// Returns how many stretches were taken, or `None` if the text is left to one thread.
fn compare(text: &[u8], share: usize) -> Option<usize> {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let options = Options {
        is_declaration_file: true,
        reads_jsdoc: true,
        ..Options::default()
    };
    let before = TAKEN.get();
    let shared = crate::parse_in_shares(text, options, &atoms, &mut Scratch::default(), share)?;
    let alone = crate::parse(text, options, &atoms, &mut Scratch::default());
    let alone = alone.expect("the text has no errors");
    assert_same(&shared, &alone);
    Some(TAKEN.get() - before)
}

const DECLARATIONS: &str = r#"
/** A */
interface A<T = string> extends B, C<T> {
    /** @deprecated */
    a?: T;
    readonly [key: string]: unknown;
    new <U>(it: U): A<U>;
    get b(): `x${string}`;
}
declare var A: {
    prototype: A;
    new (): A;
};
// @ts-ignore
type D<T> = T extends (infer U)[] ? { -readonly [K in keyof U]?: U[K] } : [a: 1n, b?: -2, ...c: T[]];
declare function e<const T>(this: A, { a, b: [c] }: T, ...rest: 1[]): asserts this is A;
declare namespace F.G {
interface AtTheStartOfALine {}
    const h: unique symbol;
}
declare abstract class I<in out T> extends J<T> implements A {
    #k;
    protected static l: typeof import("m", { with: { type: "json" } });
    constructor(private n: number);
}
declare enum O { P = 1, Q = P << 2, "r-s" = "t" }
/*
interface InAComment {}
*/
type U = `
interface InATemplate {}
`;
"#;

#[test]
fn shares_of_any_size_give_what_one_thread_gives() {
    let text = DECLARATIONS.repeat(8);
    for share in [1, 40, 300] {
        assert!(compare(text.as_bytes(), share) > Some(0), "{share}");
    }
}

#[test]
fn modules() {
    let text = format!(
        "import {{ a }} from \"a\";\n{}export {{ A }};\nexport default e;\nexport * as b from \"b\";\n",
        DECLARATIONS.repeat(4)
    );
    assert!(compare(text.as_bytes(), 100) > Some(0));
}

#[test]
fn any_damage_gives_the_same_or_is_left_to_one_thread() {
    let text = DECLARATIONS.repeat(2);
    for at in (0..text.len()).step_by(7) {
        for inserted in ["", "{", "}", "`", "/*", "\ninterface "] {
            let damaged = [&text[..at], inserted, &text[at + 1..]].concat();
            compare(damaged.as_bytes(), 120);
        }
    }
}
