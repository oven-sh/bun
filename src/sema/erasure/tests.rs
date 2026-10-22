use super::ErasureMismatchKind as Kind;
use super::{Erasure, ErasureMismatch, check_erasure};
use crate::atom::Atom;
use crate::hir::{
    Call, Chain, Class, ClassId, DecoratorOwner, DiagnosticKind, ExprFlags, ExprId, ExprKind,
    FileBuilder, Flags, FnId, IdList, Import, ListAt, Member, MemberId, MemberKind, NameKind,
    NodeData, PatKind, PatProp, Prop, PropKey, PropKind, ResolutionMode, Span, StmtId, StmtKind,
    TextRange, TypeNodeId, UnOp, VarDecl, VarKind,
};
use crate::session::Session;
use NameSpelling::{BigInt, Number};
use Written::{Asserted, Bare, Parenthesized, ParenthesizedAssertion};

const A: Atom = Atom(1);
const B: Atom = Atom(2);
const IDENTIFIER_B: (PropKey, NameKind) = (PropKey::Name(B), NameKind::Identifier);
const KEY_POS: u32 = 1;

#[derive(Copy, Clone, Debug)]
enum Written {
    Bare,
    Parenthesized,
    Asserted,
    ParenthesizedAssertion,
}

#[derive(Copy, Clone)]
enum NameSpelling {
    Number,
    BigInt,
}

#[derive(Default)]
struct Tree {
    file: FileBuilder,
    body: Vec<StmtId>,
}

impl Tree {
    fn expr(&mut self, kind: ExprKind) -> ExprId {
        self.file.expr(kind, 0, 0)
    }

    fn dot(&mut self, obj: ExprId, chain: Chain) -> ExprId {
        let kind = self.file.dot((obj, chain), (B, 0), 0);
        self.expr(kind)
    }

    fn write(&mut self, e: ExprId, written: Written) -> ExprId {
        match written {
            Bare => e,
            Parenthesized => {
                self.file.add_flags(e, ExprFlags::PARENTHESIZED);
                e
            }
            Asserted => self.expr(ExprKind::NonNull(e)),
            ParenthesizedAssertion => {
                let assertion = self.expr(ExprKind::NonNull(e));
                self.write(assertion, Parenthesized)
            }
        }
    }

    fn array(&mut self, elements: &[ExprId]) -> ExprId {
        let elements = self.file.list(elements);
        self.expr(ExprKind::Array(elements))
    }

    fn object(&mut self, kind: PropKind, name: (PropKey, NameKind), value: ExprId) -> ExprId {
        let props = self.file.add_props(&[Prop {
            kind,
            key: name.0,
            name_kind: name.1,
            value,
            pos: KEY_POS,
            start: 0,
            end: 0,
            postfix_token: 0,
        }]);
        self.expr(ExprKind::Object(props))
    }

    fn literal_name(&mut self, name: Atom, spelling: NameSpelling) -> (PropKey, NameKind) {
        match spelling {
            Number => (PropKey::Name(name), NameKind::NumericLiteral),
            BigInt => {
                self.file.bigint_names.push((KEY_POS, name));
                (PropKey::None, NameKind::Identifier)
            }
        }
    }

    fn written_array(&mut self, written: Written) -> ExprId {
        let name = self.expr(ExprKind::Ident(A));
        let array = self.array(&[name]);
        self.write(array, written)
    }

    fn with_stmt(mut self, kind: StmtKind) -> Tree {
        self.body.push(self.file.stmt(kind, 0));
        self
    }

    fn with_expr_stmt(mut self, kind: ExprKind) -> Tree {
        let e = self.expr(kind);
        self.with_stmt(StmtKind::Expr(e))
    }
}

fn erasure(mut typed: Tree, untyped: Tree) -> Erasure {
    let session = Session::new();
    typed.file.is_typed_version = true;
    let finish = |mut tree: Tree| {
        tree.file.body = tree.file.list(&tree.body);
        tree.file.into_arena(session.arena(), &session).0
    };
    let (typed, untyped) = (finish(typed), finish(untyped));
    check_erasure(&typed, &untyped)
}

fn mismatch(kind: Kind, typed: NodeData, untyped: NodeData) -> Erasure {
    Erasure::Mismatch(ErasureMismatch {
        kind,
        typed,
        untyped,
    })
}

fn mismatch_kind(typed: Tree, untyped: Tree) -> Option<Kind> {
    match erasure(typed, untyped) {
        Erasure::Exact => None,
        Erasure::Mismatch(mismatch) => Some(mismatch.kind),
        Erasure::Unknown => panic!("the trees have no syntax errors"),
    }
}

fn identifier(name: Atom) -> Tree {
    Tree::default().with_expr_stmt(ExprKind::Ident(name))
}

fn number(value: f64) -> Tree {
    let mut tree = Tree::default();
    let index = tree.file.number(value);
    tree.with_expr_stmt(ExprKind::Number(index))
}

fn unary(op: UnOp) -> Tree {
    let mut tree = Tree::default();
    let operand = tree.expr(ExprKind::Ident(A));
    tree.with_expr_stmt(ExprKind::Unary { op, operand })
}

fn asserted_identifier() -> Tree {
    let mut tree = Tree::default();
    let name = tree.expr(ExprKind::Ident(A));
    tree.with_expr_stmt(ExprKind::NonNull(name))
}

fn decorated_class() -> (Tree, ExprId) {
    let mut tree = Tree::default();
    let decorator = tree.expr(ExprKind::Ident(A));
    let owner = DecoratorOwner::Class(ClassId(0));
    tree.file.decorators.push((owner, decorator));
    (tree, decorator)
}

fn call(is_pure: bool) -> Tree {
    let mut tree = Tree::default();
    let callee = tree.expr(ExprKind::Ident(A));
    let call = tree.file.add_call(Call {
        callee,
        args: IdList::EMPTY,
        type_args: ListAt::EMPTY,
        close_pos: 0,
        chain: Chain::No,
        is_pure,
    });
    tree.with_expr_stmt(ExprKind::Call(call))
}

fn import_call(is_deferred: bool) -> Tree {
    let mut tree = Tree::default();
    let specifier = tree.expr(ExprKind::String(A));
    let args = tree.file.list(&[specifier]);
    if is_deferred {
        tree.file.deferred_import_calls.push((specifier, 0));
    }
    tree.with_expr_stmt(ExprKind::ImportCall { args })
}

fn import_statement(type_only: bool) -> Tree {
    let mut tree = Tree::default();
    let import = tree.file.add_import(Import {
        spec: B,
        default: A,
        default_pos: 0,
        namespace: Atom::NONE,
        namespace_pos: 0,
        clause_start: 0,
        clause_end: 0,
        namespace_start: 0,
        named: Span::EMPTY,
        has_named_imports: false,
        type_only,
        is_deferred: false,
        mode: ResolutionMode::default(),
        stmt: StmtId::NONE,
        attributes: ExprId::NONE,
    });
    tree.with_stmt(StmtKind::Import(import))
}

fn member_of_chain(is_parenthesized: bool, is_asserted: bool) -> Tree {
    let mut tree = Tree::default();
    let object = tree.expr(ExprKind::Ident(A));
    let mut link = tree.dot(object, Chain::Start);
    if is_parenthesized {
        tree.file.add_flags(link, ExprFlags::PARENTHESIZED);
    }
    if is_asserted {
        link = tree.expr(ExprKind::NonNull(link));
    }
    let member = tree.dot(link, Chain::No);
    tree.with_stmt(StmtKind::Expr(member))
}

fn default_export(mut tree: Tree) -> Tree {
    let value = tree.expr(ExprKind::Ident(A));
    tree.with_stmt(StmtKind::ExportDefault(value))
}

fn assignment(create_target: impl FnOnce(&mut Tree) -> ExprId) -> Tree {
    let mut tree = Tree::default();
    let target = create_target(&mut tree);
    let value = tree.expr(ExprKind::Ident(B));
    tree.with_expr_stmt(ExprKind::Assign {
        op: None,
        target,
        value,
    })
}

fn identifier_target(written: Written) -> Tree {
    assignment(|tree| {
        let name = tree.expr(ExprKind::Ident(A));
        tree.write(name, written)
    })
}

fn member_target(written: Written) -> Tree {
    assignment(|tree| {
        let obj = tree.expr(ExprKind::Ident(A));
        let member = tree.dot(obj, Chain::No);
        tree.write(member, written)
    })
}

fn element_target(written: Written) -> Tree {
    assignment(|tree| {
        let inner = tree.written_array(written);
        tree.array(&[inner])
    })
}

fn rest_target(written: Written) -> Tree {
    assignment(|tree| {
        let inner = tree.written_array(written);
        let rest = tree.expr(ExprKind::Spread(inner));
        tree.array(&[rest])
    })
}

fn property_target(written: Written) -> Tree {
    assignment(|tree| {
        let inner = tree.written_array(written);
        tree.object(PropKind::Init, IDENTIFIER_B, inner)
    })
}

fn loop_target(written: Written) -> Tree {
    let mut tree = Tree::default();
    let target = tree.written_array(written);
    let left = tree.file.stmt(StmtKind::Expr(target), 0);
    let expr = tree.expr(ExprKind::Ident(B));
    let body = tree.file.stmt(StmtKind::Empty, 0);
    tree.with_stmt(StmtKind::ForOf {
        left,
        expr,
        body,
        is_await: false,
    })
}

fn literal_value(written: Written) -> Tree {
    let mut tree = Tree::default();
    let element = tree.written_array(written);
    let value = tree.written_array(written);
    let object = tree.object(PropKind::Init, IDENTIFIER_B, value);
    let elements = tree.file.list(&[element, object]);
    tree.with_expr_stmt(ExprKind::Array(elements))
}

fn object_statement(kind: PropKind, name: (PropKey, NameKind)) -> Tree {
    let mut tree = Tree::default();
    let value = tree.expr(ExprKind::Ident(A));
    let object = tree.object(kind, name, value);
    tree.with_stmt(StmtKind::Expr(object))
}

fn named_property(name: Atom, spelling: NameSpelling) -> Tree {
    let mut tree = Tree::default();
    let name = tree.literal_name(name, spelling);
    let value = tree.expr(ExprKind::Ident(A));
    let object = tree.object(PropKind::Init, name, value);
    tree.with_stmt(StmtKind::Expr(object))
}

fn named_pattern_property(name: Atom, spelling: NameSpelling) -> Tree {
    let mut tree = Tree::default();
    let (key, name_kind) = tree.literal_name(name, spelling);
    let value = tree.file.pat(PatKind::Ident(A), 0, 0);
    let props = tree.file.add_pat_props(&[PatProp {
        key,
        name_kind,
        value,
        default: ExprId::NONE,
        is_rest: false,
        pos: 0,
        key_pos: KEY_POS,
        end: 0,
    }]);
    let pat = tree.file.pat(PatKind::Object(props), 0, 0);
    let init = tree.expr(ExprKind::Ident(B));
    let declarations = tree.file.add_var_decls(&[VarDecl {
        pat,
        ty: TypeNodeId::NONE,
        init,
        kind: VarKind::Const,
        flags: Flags::empty(),
        loc: TextRange::default(),
    }]);
    tree.with_stmt(StmtKind::Var(declarations))
}

fn field(key: PropKey, flags: Flags) -> Member {
    Member {
        kind: MemberKind::Property,
        key,
        flags,
        ty: TypeNodeId::NONE,
        init: ExprId::NONE,
        func: FnId::NONE,
        name_pos: KEY_POS,
        start: 0,
        loc: TextRange::default(),
        modifiers: Span::EMPTY,
    }
}

fn class_statement(mut tree: Tree, members: &[Member]) -> Tree {
    let members = tree.file.add_members(members);
    let class = tree.file.add_class(Class {
        name: A,
        name_pos: 0,
        flags: Flags::empty(),
        type_params: Span::EMPTY,
        extends: ExprId::NONE,
        extends_args: IdList::EMPTY,
        other_extends: IdList::EMPTY,
        implements: IdList::EMPTY,
        other_implements: IdList::EMPTY,
        members,
        start: 0,
        text_start: 0,
        modifiers: Span::EMPTY,
    });
    tree.with_stmt(StmtKind::Class(class))
}

fn class_with_field(flags: Flags) -> Tree {
    class_statement(Tree::default(), &[field(PropKey::Name(B), flags)])
}

fn named_field(name: Atom, spelling: NameSpelling) -> Tree {
    let mut tree = Tree::default();
    let (key, _) = tree.literal_name(name, spelling);
    class_statement(tree, &[field(key, Flags::LITERAL_NAME)])
}

fn with_statement() -> Tree {
    let mut tree = Tree::default();
    let object = tree.expr(ExprKind::Ident(A));
    let body = tree.file.stmt(StmtKind::Empty, 0);
    tree.with_stmt(StmtKind::With { object, body })
}

fn while_statement() -> Tree {
    let mut tree = Tree::default();
    let test = tree.expr(ExprKind::Ident(A));
    let body = tree.file.stmt(StmtKind::Empty, 0);
    tree.with_stmt(StmtKind::While { test, body })
}

fn block_statement() -> Tree {
    let mut tree = Tree::default();
    let object = tree.expr(ExprKind::Ident(A));
    let statements = [
        tree.file.stmt(StmtKind::Expr(object), 0),
        tree.file.stmt(StmtKind::Empty, 0),
    ];
    let statements = tree.file.list(&statements);
    tree.with_stmt(StmtKind::Block(statements))
}

fn string_statement(raw: Option<Atom>) -> Tree {
    let mut tree = Tree::default();
    let expr = tree.expr(ExprKind::String(A));
    tree.with_stmt(match raw {
        Some(raw) => StmtKind::Directive { expr, raw },
        None => StmtKind::Expr(expr),
    })
}

#[test]
fn empty_files_are_exact() {
    assert_eq!(erasure(Tree::default(), Tree::default()), Erasure::Exact);
}

#[test]
fn mismatch_kind_names_differing_part() {
    assert_eq!(mismatch_kind(identifier(A), identifier(A)), None);
    assert_eq!(mismatch_kind(identifier(A), identifier(B)), Some(Kind::Name));
    let this = Tree::default().with_expr_stmt(ExprKind::This);
    assert_eq!(mismatch_kind(identifier(A), this), Some(Kind::NodeKind));
    assert_eq!(mismatch_kind(number(0.0), number(-0.0)), Some(Kind::Literal));
    assert_eq!(mismatch_kind(number(f64::NAN), number(f64::NAN)), None);
    let kind = mismatch_kind(unary(UnOp::Plus), unary(UnOp::Minus));
    assert_eq!(kind, Some(Kind::Operator));
}

#[test]
fn mismatch_names_both_nodes() {
    let nodes = NodeData::Expr(ExprId(0));
    let expected = mismatch(Kind::Name, nodes, nodes);
    assert_eq!(erasure(identifier(A), identifier(B)), expected);
}

#[test]
fn type_assertion_is_erased_in_typed_file_only() {
    assert_eq!(mismatch_kind(asserted_identifier(), identifier(A)), None);
    let kind = mismatch_kind(asserted_identifier(), asserted_identifier());
    assert_eq!(kind, Some(Kind::NodeKind));
    let kind = mismatch_kind(identifier(A), asserted_identifier());
    assert_eq!(kind, Some(Kind::NodeKind));
}

#[test]
fn typed_decorator_emits_code() {
    let (typed, decorator) = decorated_class();
    let expected = mismatch(Kind::EmitsCode, NodeData::Expr(decorator), NodeData::File);
    assert_eq!(erasure(typed, Tree::default()), expected);
}

#[test]
fn untyped_decorator_is_mismatch() {
    let (untyped, decorator) = decorated_class();
    let expected = mismatch(Kind::ChildCount, NodeData::File, NodeData::Expr(decorator));
    assert_eq!(erasure(Tree::default(), untyped), expected);
}

#[test]
fn syntax_errors_are_unknown() {
    let marks: [fn(&mut FileBuilder); 4] = [
        |file| file.has_errors = true,
        |file| file.has_parse_diagnostics = true,
        |file| file.ran_out_of_stack = true,
        |file| file.error(DiagnosticKind::Js, 0, 0, 8010),
    ];
    for (index, mark) in marks.into_iter().enumerate() {
        let mut typed = Tree::default();
        mark(&mut typed.file);
        assert_eq!(erasure(typed, Tree::default()), Erasure::Unknown, "{index}");
        let mut untyped = Tree::default();
        mark(&mut untyped.file);
        assert_eq!(erasure(Tree::default(), untyped), Erasure::Unknown, "{index}");
    }
}

#[test]
fn other_diagnostics_are_no_syntax_errors() {
    for kind in [DiagnosticKind::Grammar, DiagnosticKind::Checker, DiagnosticKind::JsDoc] {
        let mut typed = Tree::default();
        typed.file.error(kind, 0, 0, 1);
        assert_eq!(erasure(typed, Tree::default()), Erasure::Exact, "{kind:?}");
    }
}

#[test]
fn typed_file_cannot_add_pure_annotation() {
    assert_eq!(mismatch_kind(call(true), call(false)), Some(Kind::Flags));
    assert_eq!(mismatch_kind(call(false), call(true)), None);
    assert_eq!(mismatch_kind(call(true), call(true)), None);
}

#[test]
fn deferred_import_is_compared() {
    assert_eq!(mismatch_kind(import_call(true), import_call(false)), Some(Kind::Flags));
    assert_eq!(mismatch_kind(import_call(false), import_call(true)), Some(Kind::Flags));
    assert_eq!(mismatch_kind(import_call(true), import_call(true)), None);
}

#[test]
fn parentheses_inside_assertion_end_chain() {
    let installed = || member_of_chain(true, false);
    assert_eq!(mismatch_kind(member_of_chain(true, true), installed()), None);
    assert_eq!(mismatch_kind(member_of_chain(false, true), installed()), Some(Kind::Flags));
}

#[test]
fn erased_export_cannot_select_esm() {
    let erased_export = || Tree::default().with_stmt(StmtKind::ExportAsNamespace(A));
    let expected = mismatch(Kind::EmitsCode, NodeData::Stmt(StmtId(0)), NodeData::File);
    assert_eq!(erasure(erased_export(), Tree::default()), expected);
    let (typed, untyped) = (default_export(erased_export()), default_export(Tree::default()));
    assert_eq!(mismatch_kind(typed, untyped), None);
}

#[test]
fn erased_type_import_selects_no_format() {
    assert_eq!(mismatch_kind(import_statement(true), Tree::default()), None);
    let kind = mismatch_kind(import_statement(false), Tree::default());
    assert_eq!(kind, Some(Kind::ChildCount));
    assert_eq!(mismatch_kind(import_statement(false), import_statement(false)), None);
}

#[test]
fn identifier_target_is_compared_as_written() {
    let kind = |typed, untyped| mismatch_kind(identifier_target(typed), identifier_target(untyped));
    assert_eq!(kind(Bare, Bare), None);
    assert_eq!(kind(Parenthesized, Parenthesized), None);
    assert_eq!(kind(Bare, Parenthesized), Some(Kind::Flags));
    assert_eq!(kind(Parenthesized, Bare), Some(Kind::Flags));
    assert_eq!(kind(Asserted, Bare), Some(Kind::NodeKind));
    assert_eq!(kind(Asserted, Parenthesized), Some(Kind::NodeKind));
    assert_eq!(kind(ParenthesizedAssertion, Parenthesized), None);
    assert_eq!(kind(ParenthesizedAssertion, Bare), Some(Kind::Flags));
}

#[test]
fn member_target_is_unwrapped() {
    for written in [Bare, Parenthesized, Asserted, ParenthesizedAssertion] {
        let kind = mismatch_kind(member_target(written), member_target(Bare));
        assert_eq!(kind, None, "{written:?}");
    }
}

#[test]
fn nested_pattern_is_compared_as_written() {
    let targets: [fn(Written) -> Tree; 4] =
        [element_target, rest_target, property_target, loop_target];
    for (index, target) in targets.into_iter().enumerate() {
        let kind = |typed| mismatch_kind(target(typed), target(Bare));
        assert_eq!(kind(Bare), None, "{index}");
        assert_eq!(kind(Parenthesized), Some(Kind::Flags), "{index}");
        assert_eq!(kind(Asserted), Some(Kind::NodeKind), "{index}");
        assert_eq!(kind(ParenthesizedAssertion), Some(Kind::Flags), "{index}");
    }
}

#[test]
fn literal_outside_target_is_unwrapped() {
    for written in [Bare, Parenthesized, Asserted, ParenthesizedAssertion] {
        let kind = mismatch_kind(literal_value(written), literal_value(Bare));
        assert_eq!(kind, None, "{written:?}");
    }
}

#[test]
fn key_kind_is_compared() {
    let property = |key| object_statement(PropKind::Init, (key, NameKind::Identifier));
    let kind = |untyped| mismatch_kind(property(PropKey::Name(B)), property(untyped));
    assert_eq!(kind(PropKey::Name(B)), None);
    assert_eq!(kind(PropKey::Private(B)), Some(Kind::NodeKind));
    let spread = || object_statement(PropKind::Spread, (PropKey::None, NameKind::Identifier));
    assert_eq!(mismatch_kind(spread(), spread()), None);
}

#[test]
fn bigint_name_is_compared() {
    let nodes: [fn(Atom, NameSpelling) -> Tree; 2] = [named_property, named_pattern_property];
    for (index, node) in nodes.into_iter().enumerate() {
        let kind = |untyped| mismatch_kind(node(A, BigInt), untyped);
        assert_eq!(kind(node(A, BigInt)), None, "{index}");
        assert_eq!(kind(node(B, BigInt)), Some(Kind::Name), "{index}");
        assert_eq!(kind(node(A, Number)), Some(Kind::Flags), "{index}");
    }
}

#[test]
fn bigint_field_name_is_compared() {
    let kind = |untyped| mismatch_kind(named_field(A, BigInt), untyped);
    assert_eq!(kind(named_field(A, BigInt)), None);
    assert_eq!(kind(named_field(B, BigInt)), Some(Kind::Name));
}

#[test]
fn bigint_field_name_is_no_numeric_name() {
    let kind = mismatch_kind(named_field(A, BigInt), named_field(A, Number));
    assert_eq!(kind, Some(Kind::Flags));
}

#[test]
fn declared_field_is_erased_in_typed_file_only() {
    let without_fields = || class_statement(Tree::default(), &[]);
    for flags in [Flags::AMBIENT, Flags::ABSTRACT] {
        let kind = mismatch_kind(class_with_field(flags), without_fields());
        assert_eq!(kind, None, "{flags:?}");
        let kind = mismatch_kind(without_fields(), class_with_field(flags));
        assert_eq!(kind, Some(Kind::ChildCount), "{flags:?}");
    }
    let kind = mismatch_kind(class_with_field(Flags::empty()), without_fields());
    assert_eq!(kind, Some(Kind::ChildCount));
}

#[test]
fn accessor_field_emits_code() {
    let member = NodeData::Member(MemberId(0));
    let expected = mismatch(Kind::EmitsCode, member, member);
    let found = erasure(class_with_field(Flags::ACCESSOR), class_with_field(Flags::ACCESSOR));
    assert_eq!(found, expected);
    let kind = mismatch_kind(class_with_field(Flags::empty()), class_with_field(Flags::empty()));
    assert_eq!(kind, None);
}

#[test]
fn with_is_no_block() {
    assert_eq!(mismatch_kind(with_statement(), with_statement()), None);
    assert_eq!(mismatch_kind(with_statement(), block_statement()), Some(Kind::NodeKind));
    assert_eq!(mismatch_kind(block_statement(), with_statement()), Some(Kind::NodeKind));
    assert_eq!(mismatch_kind(with_statement(), while_statement()), Some(Kind::NodeKind));
}

#[test]
fn directive_is_no_expression_statement() {
    let kind = |typed, untyped| mismatch_kind(string_statement(typed), string_statement(untyped));
    assert_eq!(kind(Some(A), Some(A)), None);
    assert_eq!(kind(None, None), None);
    assert_eq!(kind(Some(A), None), Some(Kind::NodeKind));
    assert_eq!(kind(None, Some(A)), Some(Kind::NodeKind));
    assert_eq!(kind(Some(A), Some(B)), Some(Kind::Literal));
}

#[test]
fn added_export_assignment_emits_code() {
    let mut typed = call(false);
    let value = typed.expr(ExprKind::Ident(A));
    let typed = typed.with_stmt(StmtKind::ExportAssign(value));
    let expected = mismatch(Kind::EmitsCode, NodeData::Stmt(StmtId(1)), NodeData::File);
    assert_eq!(erasure(typed, call(false)), expected);
    let typed = call(false).with_stmt(StmtKind::Empty);
    assert_eq!(mismatch_kind(typed, call(false)), Some(Kind::ChildCount));
}

#[test]
fn jsx_without_installed_operand_emits_code() {
    let mut typed = Tree::default();
    let text = typed.expr(ExprKind::JsxText(A));
    let typed = typed.with_stmt(StmtKind::Return(text));
    let untyped = Tree::default().with_stmt(StmtKind::Return(ExprId::NONE));
    let expected = mismatch(Kind::EmitsCode, NodeData::Expr(text), NodeData::Stmt(StmtId(0)));
    assert_eq!(erasure(typed, untyped), expected);
}
