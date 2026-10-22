use crate::tree_support::*;
use crate::{
    BRACKET_ACCESS, DEFAULT_PATH, NO_FLAGS, TYPEDEF_BEFORE_DIRECTIVE, only_expr, only_stmt, parsed,
    select_expr,
};

use crate::ExprSelector::Dot;
use FileRule::{
    ColumnLengthMismatch, DirectiveOutsidePrologue, FlagMismatch, IdOutOfRange, ListOutOfRange,
    OperandAfterExpression, UnsortedSideTable,
};
use std::sync::atomic::{AtomicUsize, Ordering};

const MODULE_PATH: &str = "a.mjs";
const MIN_VALID_FILE_COUNT: usize = 1_000;

const EXPORT_STAR_WITH_ATTRIBUTES: &str = r#"export * from "m" with { type: "json" };"#;

const ABSENT_OPTIONAL_NODES: &[(&str, &str)] = &[
    (DEFAULT_PATH, "function f() { return; }"),
    (DEFAULT_PATH, "for (;;) ;"),
    (DEFAULT_PATH, "try {} finally {}"),
    (DEFAULT_PATH, "function* g() { yield; }"),
    ("a.ts", "function f(x: unknown): asserts x {}"),
];

fn has_syntax_errors(hir: &File<'_>) -> bool {
    hir.has_errors || hir.has_parse_diagnostics
}

fn negation_of(operand: ExprId) -> ExprKind {
    ExprKind::Unary {
        op: UnOp::Minus,
        operand,
    }
}

fn assert_invalid_after(
    path: &str,
    text: &str,
    rule: FileRule,
    break_tree: impl for<'s> FnOnce(&Workspace<'s>, &mut File<'s>) + Send,
) {
    with_workspace(|w| {
        let mut hir = w.parse(&Source::new(path, text));
        assert_eq!(hir.validate(), Ok(()), "{text}");
        break_tree(w, &mut hir);
        let found = hir.validate().map_err(|invalid| invalid.rule);
        assert_eq!(found, Err(rule), "{text}");
    });
}

#[test]
fn every_program_is_valid() {
    let valid_file_count = AtomicUsize::new(0);
    for_each_program(&SOURCE_EXTENSIONS, |w, path, text| {
        let compiled = w.parse(&Source::from_bytes(path, text));
        let checked = w.parse_for_check(path, text);
        for (parser, hir) in [("parse_for_compile", &compiled), ("summarize", &checked)] {
            if let Err(invalid) = hir.validate() {
                panic!("{path}, parsed by {parser}: {invalid:?}");
            }
        }
        if !has_syntax_errors(&compiled) && !has_syntax_errors(&checked) {
            valid_file_count.fetch_add(1, Ordering::Relaxed);
        }
    });
    let valid_file_count = valid_file_count.into_inner();
    assert!(
        valid_file_count > MIN_VALID_FILE_COUNT,
        "only {valid_file_count} files have no syntax error"
    );
}

#[test]
fn broken_trees() {
    assert_invalid_after(DEFAULT_PATH, "-a;", IdOutOfRange, |_, hir| {
        let negation = only_expr(hir, |kind| kind.tag() == ExprTag::Unary);
        hir[negation].kind = negation_of(ExprId(hir.exprs.len() as u32));
    });
    assert_invalid_after(DEFAULT_PATH, "a + b;", IdOutOfRange, |_, hir| {
        let sum = only_expr(hir, |kind| kind.tag() == ExprTag::Binary);
        let ExprKind::Binary { left, .. } = &mut hir[sum].kind else {
            unreachable!()
        };
        *left = ExprId::NONE;
    });
    assert_invalid_after(MODULE_PATH, "export { a };", IdOutOfRange, |_, hir| {
        let export = only_stmt(hir, |kind| kind.tag() == StmtTag::ExportNamed);
        hir[export].kind = StmtKind::ExportNamed(ExportId::NONE);
    });
    assert_invalid_after(MODULE_PATH, EXPORT_STAR_WITH_ATTRIBUTES, IdOutOfRange, |_, hir| {
        hir.export_star_attributes[0].1 = ExprId(hir.exprs.len() as u32);
    });
    assert_invalid_after(DEFAULT_PATH, "(a);", IdOutOfRange, |_, hir| {
        hir.parens[0].0 = ExprId(hir.exprs.len() as u32);
    });
    assert_invalid_after(DEFAULT_PATH, "a;", ListOutOfRange, |_, hir| {
        hir.body = IdList::new(0, hir.ids.len() as u32 + 1);
    });
    assert_invalid_after(DEFAULT_PATH, "-a;", OperandAfterExpression, |w, hir| {
        let negation = only_expr(hir, |kind| kind.tag() == ExprTag::Unary);
        let operand = w.ident(hir, "a", 0);
        hir[operand].kind = negation_of(negation);
    });
    assert_invalid_after(DEFAULT_PATH, "(a); (b);", UnsortedSideTable, |_, hir| {
        hir.parens.swap(0, 1);
    });
    assert_invalid_after(DEFAULT_PATH, "({ 1n: a, 2n: b });", UnsortedSideTable, |_, hir| {
        hir.bigint_names.swap(0, 1);
    });
    assert_invalid_after(DEFAULT_PATH, "f`a`;", IdOutOfRange, |_, hir| {
        hir.tagged_templates[0].1 = ExprId(hir.exprs.len() as u32);
    });
    assert_invalid_after(DEFAULT_PATH, "a;", ColumnLengthMismatch, |_, hir| {
        hir.expr_flags = Default::default();
    });
    assert_invalid_after(DEFAULT_PATH, "a.b;", FlagMismatch, |w, hir| {
        let member = select_expr(w, hir, Dot("b"));
        hir.expr_flags[member.idx()] |= BRACKET_ACCESS;
    });
    assert_invalid_after(DEFAULT_PATH, "a[0];", FlagMismatch, |_, hir| {
        let member = only_expr(hir, |kind| kind.tag() == ExprTag::Index);
        hir.expr_flags[member.idx()] -= BRACKET_ACCESS;
    });
    assert_invalid_after(DEFAULT_PATH, "(a);", FlagMismatch, |w, hir| {
        let name = w.ident(hir, "a", 0);
        hir.expr_flags[name.idx()] = NO_FLAGS;
    });
    assert_invalid_after(DEFAULT_PATH, r#"f(); "x";"#, DirectiveOutsidePrologue, |w, hir| {
        let second = hir.id_at(hir.body, 1);
        let StmtKind::Expr(expr) = hir[second].kind else {
            panic!("{:?}", hir[second].kind);
        };
        let raw = w.atom("x");
        hir[second].kind = StmtKind::Directive { expr, raw };
    });
    assert_invalid_after(DEFAULT_PATH, r#""x"; f();"#, DirectiveOutsidePrologue, |_, hir| {
        let first = hir.id_at(hir.body, 0);
        let StmtKind::Directive { expr, .. } = hir[first].kind else {
            panic!("{:?}", hir[first].kind);
        };
        hir[first].kind = StmtKind::Expr(expr);
    });
}

#[test]
fn absent_optional_nodes() {
    for &(path, text) in ABSENT_OPTIONAL_NODES {
        parsed(path, text, |_, hir| {
            assert!(!has_syntax_errors(hir), "{text}: {:?}", hir.diagnostics);
            assert_eq!(hir.validate(), Ok(()), "{text}");
        });
    }
}

#[test]
fn reparsed_alias_before_directive() {
    parsed("a.js", TYPEDEF_BEFORE_DIRECTIVE, |_, hir| {
        let statements = hir.ids(hir.body);
        let tags: Vec<StmtTag> = statements.map(|stmt| hir[stmt].kind.tag()).collect();
        assert_eq!(tags, [StmtTag::TypeAlias, StmtTag::Expr, StmtTag::Fn]);
        let directive = hir[hir.id_at(hir.body, 1)].kind;
        assert!(matches!(directive, StmtKind::Directive { .. }), "{directive:?}");
        assert!(!has_syntax_errors(hir), "{:?}", hir.diagnostics);
        assert_eq!(hir.validate(), Ok(()));
    });
}
