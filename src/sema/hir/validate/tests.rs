use super::super::*;
use crate::atom::known;

fn validate(file: FileBuilder) -> Result<(), FileRule> {
    let session = Session::new();
    let (hir, _) = file.into_arena(session.arena(), &session);
    hir.validate().map_err(|invalid| invalid.rule)
}

fn validate_statement(mut file: FileBuilder, value: ExprId) -> Result<(), FileRule> {
    let statement = file.stmt(StmtKind::Expr(value), 0);
    file.body = file.list(&[statement]);
    validate(file)
}

fn add_name(file: &mut FileBuilder) -> ExprId {
    file.expr(ExprKind::Ident(known::require), 0, 0)
}

fn add_call(file: &mut FileBuilder, type_args: ListAt<TypeNodeId>) -> ExprId {
    let callee = add_name(file);
    let argument = file.expr(ExprKind::String(known::length), 0, 0);
    let args = file.list(&[argument]);
    let call = file.add_call(Call {
        callee,
        args,
        type_args,
        close_pos: 0,
        chain: Chain::No,
        is_pure: false,
    });
    file.expr(ExprKind::Call(call), 0, 0)
}

#[test]
fn only_calls_are_resolved_at_runtime() {
    let mut file = FileBuilder::default();
    let call = add_call(&mut file, ListAt::EMPTY);
    assert_eq!(validate_statement(file, call), Ok(()));

    let mut file = FileBuilder::default();
    let call = add_call(&mut file, ListAt::EMPTY);
    file.add_flags(call, ExprFlags::RESOLVED_AT_RUNTIME);
    assert_eq!(validate_statement(file, call), Ok(()));

    let mut file = FileBuilder::default();
    let name = add_name(&mut file);
    file.add_flags(name, ExprFlags::RESOLVED_AT_RUNTIME);
    assert_eq!(validate_statement(file, name), Err(FileRule::FlagMismatch));
}

#[test]
fn only_strings_are_template_literals() {
    let mut file = FileBuilder::default();
    let string = file.expr(ExprKind::String(known::length), 0, 0);
    file.add_flags(string, ExprFlags::TEMPLATE_LITERAL);
    assert_eq!(validate_statement(file, string), Ok(()));

    let mut file = FileBuilder::default();
    let text = file.expr(ExprKind::JsxText(known::length), 0, 0);
    file.add_flags(text, ExprFlags::TEMPLATE_LITERAL);
    assert_eq!(validate_statement(file, text), Err(FileRule::FlagMismatch));
}

#[test]
fn branches_are_in_range() {
    let mut file = FileBuilder::default();
    let (test, yes, no) = (add_name(&mut file), add_name(&mut file), add_name(&mut file));
    let branches = file.store_branches(Branches { yes, no });
    let conditional = file.expr(ExprKind::Cond { test, branches }, 0, 0);
    assert_eq!(validate_statement(file, conditional), Ok(()));

    let mut file = FileBuilder::default();
    let (test, yes) = (add_name(&mut file), add_name(&mut file));
    let no = ExprId(9);
    let branches = file.store_branches(Branches { yes, no });
    let conditional = file.expr(ExprKind::Cond { test, branches }, 0, 0);
    assert_eq!(validate_statement(file, conditional), Err(FileRule::IdOutOfRange));
}

#[test]
fn type_arguments_are_in_range() {
    let mut file = FileBuilder::default();
    let ty = file.ty(TypeNodeKind::Error, 0, 0);
    let list = file.list(&[ty]);
    let type_args = file.store_list(list);
    let call = add_call(&mut file, type_args);
    assert_eq!(validate_statement(file, call), Ok(()));

    let mut file = FileBuilder::default();
    let list = file.list(&[TypeNodeId(9)]);
    let type_args = file.store_list(list);
    let call = add_call(&mut file, type_args);
    assert_eq!(validate_statement(file, call), Err(FileRule::IdOutOfRange));

    let mut file = FileBuilder::default();
    let type_args = file.store_list(IdList::<TypeNodeId>::new(90, 1));
    let call = add_call(&mut file, type_args);
    assert_eq!(validate_statement(file, call), Err(FileRule::ListOutOfRange));
}

#[test]
fn bigint_names_are_sorted() {
    let mut file = FileBuilder::default();
    file.bigint_names = vec![(4, known::length), (9, known::length)];
    assert_eq!(validate(file), Ok(()));

    let mut file = FileBuilder::default();
    file.bigint_names = vec![(9, known::length), (4, known::length)];
    assert_eq!(validate(file), Err(FileRule::UnsortedSideTable));
}

#[test]
fn with_statement_is_after_its_parts() {
    let mut file = FileBuilder::default();
    let object = add_name(&mut file);
    let body = file.stmt(StmtKind::Empty, 0);
    let with = file.stmt(StmtKind::With { object, body }, 0);
    file.body = file.list(&[with]);
    assert_eq!(validate(file), Ok(()));

    let mut file = FileBuilder::default();
    let object = add_name(&mut file);
    let body = StmtId(1);
    let with = file.stmt(StmtKind::With { object, body }, 0);
    file.stmt(StmtKind::Empty, 0);
    file.body = file.list(&[with]);
    assert_eq!(validate(file), Err(FileRule::OperandAfterExpression));
}

fn put_around_name(end_of_outer: u32, wrap: impl FnOnce(ExprId, TypeNodeId) -> ExprKind) -> Result<(), FileRule> {
    let mut file = FileBuilder::default();
    let outer = file.expr(ExprKind::Ident(known::require), 0, 7);
    let name = file.expr(ExprKind::Ident(known::require), 0, 7);
    let any = file.ty(TypeNodeKind::Keyword(Keyword::Any), 0, 7);
    file[outer].kind = wrap(name, any);
    file[outer].end = end_of_outer;
    validate_statement(file, outer)
}

#[test]
fn only_a_cast_that_takes_no_room_in_the_text_stands_in_front_of_its_operand() {
    assert_eq!(put_around_name(7, |expr, ty| ExprKind::As { expr, ty }), Ok(()));
    let after = Err(FileRule::OperandAfterExpression);
    assert_eq!(put_around_name(14, |expr, ty| ExprKind::As { expr, ty }), after);
    assert_eq!(put_around_name(7, |expr, _| ExprKind::NonNull(expr)), after);
}

#[test]
fn file_with_syntax_errors_is_not_looked_at() {
    let mut file = FileBuilder::default();
    file.has_errors = true;
    file.body = IdList::new(0, 9);
    assert_eq!(validate(file), Ok(()));
}
