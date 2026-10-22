mod describe;
#[cfg(all(test, not(miri)))]
mod tests;
mod type_ranges;
mod walk;

pub use type_ranges::{TypeRanges, find_type_ranges};

use crate::atom::Atom;
use crate::hir::{
    BinOp, CaseId, Chain, ClassId, DiagnosticKind, ExportId, ExportSpecId, ExprFlags, ExprId,
    ExprTag, File, Flags, FnId, FnKind, IdList, ImportId, ImportSpecId, MemberId, MemberKind,
    NameKind, NodeData, ParamId, PatElemId, PatId, PatPropId, PatTag, PropId, PropKey, PropKind,
    StmtId, StmtKind, TemplatePart, UnOp, VarDeclId, VarKind,
};
use std::mem::Discriminant;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ErasureMismatchKind {
    NodeKind,
    Name,
    Literal,
    Operator,
    Flags,
    ChildCount,
    EmitsCode,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ErasureMismatch {
    pub kind: ErasureMismatchKind,
    pub typed: NodeData,
    pub untyped: NodeData,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Erasure {
    Exact,
    Mismatch(ErasureMismatch),
    Unknown,
}

#[derive(Default, PartialEq, Eq, Debug)]
pub struct UntypedTextRanges {
    pub functions: Vec<(u32, u32)>,
    pub classes: Vec<(u32, u32)>,
    pub token_offsets: Vec<(u32, u32)>,
}

pub fn check_erasure(typed: &File<'_>, untyped: &File<'_>) -> Erasure {
    check_erasure_with_ranges(typed, untyped).0
}

pub fn check_erasure_with_ranges(
    typed: &File<'_>,
    untyped: &File<'_>,
) -> (Erasure, UntypedTextRanges) {
    if has_syntax_errors(typed) || has_syntax_errors(untyped) {
        return (Erasure::Unknown, UntypedTextRanges::default());
    }
    let (result, ranges) = walk::run(typed, untyped);
    match result {
        Ok(()) => (Erasure::Exact, ranges),
        Err(mismatch) => (Erasure::Mismatch(mismatch), ranges),
    }
}

fn has_syntax_errors(file: &File<'_>) -> bool {
    file.has_errors
        || file.has_parse_diagnostics
        || file.ran_out_of_stack
        || (file.diagnostics.iter()).any(|it| it.kind == DiagnosticKind::Js)
}

const MAX_NAMES: usize = 3;

#[derive(Copy, Clone)]
enum Subtree {
    Statements(IdList<StmtId>),
    Stmt(StmtId),
    Expr(ExprId),
    AssignmentTarget(ExprId),
    Pattern(PatId),
    Function(FnId),
    Class(ClassId),
    Prop(PropId),
    AssignmentProperty(PropId),
    PatProp(PatPropId),
    PatElem(PatElemId),
    VarDecl(VarDeclId),
    Case(CaseId),
    Param(ParamId),
    Member(MemberId),
    Import(ImportId),
    ImportSpec(ImportSpecId),
    Export(ExportId),
    ExportSpec(ExportSpecId),
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum NodeTag {
    None,
    Stmt(Discriminant<StmtKind>),
    Expr(ExprTag),
    Pattern(PatTag),
    Function(FnKind),
    Prop(PropKind),
    Member(MemberKind),
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Literal<'a> {
    None,
    Number(u64),
    Text(Atom),
    Regex(Atom, Atom),
    String(Atom, &'a [TemplatePart]),
    Template(&'a [u32], &'a [TemplatePart]),
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Operator {
    None,
    Unary(UnOp),
    Binary(BinOp),
    Assign(Option<BinOp>),
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Form {
    None,
    Name(NameKind),
    WrittenKey(Discriminant<PropKey>),
    Variable(VarKind),
}

bitflags::bitflags! {
    #[derive(Copy, Clone, PartialEq, Eq)]
    struct Marks: u8 {
        const YIELD_STAR = 1 << 0;
        const FOR_AWAIT = 1 << 1;
        const DEFERRED = 1 << 2;
        const TYPE_ONLY = 1 << 3;
        const REST = 1 << 4;
        const NAMED_IMPORTS = 1 << 5;
        const MODULE_SPECIFIER = 1 << 6;
        const PURE = 1 << 7;
    }
}

struct Label<'a> {
    tag: NodeTag,
    key_kind: Option<Discriminant<PropKey>>,
    names: [Atom; MAX_NAMES],
    literal: Literal<'a>,
    operator: Operator,
    flags: Flags,
    expr_flags: ExprFlags,
    chain: Chain,
    marks: Marks,
    form: Form,
}

enum NodeShape<'a> {
    Absent,
    NotComparable,
    TypeAssertion(ExprId),
    EmitsCode,
    Comparable(Label<'a>),
}
