use crate::atom::known;
use crate::bind::parents::fill_in;
use crate::bind::{BoundBuilder, Parent, kind_counts};
use crate::hir::*;

struct WithProgram {
    file: FileBuilder,
    directive: StmtId,
    directive_text: ExprId,
    with: StmtId,
    object: ExprId,
    body: StmtId,
}

fn with_program() -> WithProgram {
    const SOURCE: &[u8] = br#"""; with (window) alert;"#;
    let mut file = FileBuilder {
        text: SOURCE.into(),
        source_len: SOURCE.len() as u32,
        ..Default::default()
    };
    let directive_text = file.expr(ExprKind::String(known::empty), 0, 2);
    let directive_kind = StmtKind::Directive {
        expr: directive_text,
        raw: known::empty,
    };
    let directive = file.stmt(directive_kind, 0);
    let object = file.expr(ExprKind::Ident(known::window), 10, 16);
    let body_expression = file.expr(ExprKind::Ident(known::alert), 18, 23);
    let body = file.stmt(StmtKind::Expr(body_expression), 18);
    let with = file.stmt(StmtKind::With { object, body }, 4);
    file.body = file.list(&[directive, with]);
    WithProgram {
        file,
        directive,
        directive_text,
        with,
        object,
        body,
    }
}

#[test]
fn with_and_directive_parents() {
    let program = with_program();
    let mut bound = BoundBuilder::default();
    assert!(fill_in::<Growable, true>(&program.file, &mut bound));
    assert_eq!(
        bound.parent_of_expr(program.directive_text),
        Parent::Stmt(program.directive)
    );
    assert_eq!(
        bound.parent_of_expr(program.object),
        Parent::Stmt(program.with)
    );
    assert_eq!(
        bound.parent_of_stmt(program.body),
        Parent::Stmt(program.with)
    );
    assert_eq!(bound.parent_of_stmt(program.with), Parent::File);
    let count = |tag: StmtTag| bound.kind_counts[kind_counts::STMTS + tag as usize];
    assert_eq!(count(StmtTag::Block), 1);
    assert_eq!(count(StmtTag::Expr), 2);
}

#[test]
fn unreferenced_expression_has_no_parent() {
    let mut program = with_program();
    let unreferenced = program.file.expr(ExprKind::Ident(known::window), 10, 16);
    let mut bound = BoundBuilder::default();
    assert!(!fill_in::<Growable, true>(&program.file, &mut bound));
    assert_eq!(bound.parent_of_expr(unreferenced), Parent::None);
    assert_eq!(
        bound.parent_of_expr(program.object),
        Parent::Stmt(program.with)
    );
}

#[test]
fn jsx_text_and_regex_are_leaves() {
    const SOURCE: &[u8] = b"<>value</>; /value/;";
    let mut file = FileBuilder {
        text: SOURCE.into(),
        source_len: SOURCE.len() as u32,
        ..Default::default()
    };
    let text = file.expr(ExprKind::JsxText(known::value), 2, 7);
    let children = file.list(&[text]);
    let jsx = file.add_jsx(Jsx {
        tag: ExprId::NONE,
        close_tag: ExprId::NONE,
        attrs: Span::EMPTY,
        children,
        type_args: IdList::EMPTY,
        opening_end: 2,
        close_pos: 7,
        end: 10,
    });
    let fragment = file.expr(ExprKind::Jsx(jsx), 0, 10);
    let regex_kind = ExprKind::Regex {
        pattern: known::value,
        flags: known::empty,
    };
    let regex = file.expr(regex_kind, 12, 19);
    let statements = [
        file.stmt(StmtKind::Expr(fragment), 0),
        file.stmt(StmtKind::Expr(regex), 12),
    ];
    file.body = file.list(&statements);

    let mut bound = BoundBuilder::default();
    assert!(fill_in::<Growable, true>(&file, &mut bound));
    assert_eq!(bound.parent_of_expr(text), Parent::Expr(fragment));
    assert_eq!(bound.expr_kinds[text.idx()], 2 * ExprTag::String as u8);
    let count = |tag: ExprTag| bound.expr_kind_counts[2 * tag as usize];
    assert_eq!(count(ExprTag::String), 1);
    assert_eq!(count(ExprTag::Regex), 1);
}
