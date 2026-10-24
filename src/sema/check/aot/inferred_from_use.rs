use super::answers::{CheckedType, MemberLookup};
use super::prototype_links::{NamedValue, PrototypeOperation};
use super::queries::Queries;
use crate::atom::{Atom, known};
use crate::bind::{Binding, Bound, Decl, FnOwner, Parent, PatParent, StoreKind, SymbolId};
use crate::check::root_declaration;
use crate::hir::{
    self, BinOp, CallId, Chain, ExprFlags, ExprId, ExprKind, ExprTag, Flags, FnBody, FnId, FnKind,
    MemberKey, ParamId, PatId, PatKind, PropId, PropKey, PropKind, StmtId, StmtKind, UnOp,
};
use crate::program::{FileId, FileRole};
use crate::session::vec_from_iter_in;
use crate::types::{
    MapperId, Prop, PropFlags, PropSource, Shape, SigId, SigParam, TypeData, TypeId,
};
use smallvec::SmallVec;
use std::rc::Rc;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub(super) enum Subject {
    Binding(SymbolId),
    Pattern(PatId),
    This(FnId),
    Result(FnId),
    Expression(ExprId),
    Number(SymbolId),
}

pub(super) enum UsageState {
    InProgress(usize),
    Known(Rc<Usage>),
}

#[derive(Copy, Clone)]
pub(super) enum TypeState {
    InProgress(usize),
    Known(TypeId),
}

#[derive(Default)]
struct SubjectStack {
    depth: usize,
    outermost_revisited: Option<usize>,
}

struct EnteredSubject {
    depth: usize,
    revisited_earlier: Option<usize>,
}

impl SubjectStack {
    fn enter(&mut self) -> EnteredSubject {
        let entered = EnteredSubject {
            depth: self.depth,
            revisited_earlier: self.outermost_revisited.take(),
        };
        self.depth += 1;
        entered
    }

    fn revisit(&mut self, depth: usize) {
        let outermost = self
            .outermost_revisited
            .map_or(depth, |other| other.min(depth));
        self.outermost_revisited = Some(outermost);
    }

    #[allow(clippy::needless_pass_by_value)] // what `enter` gave is used up
    fn leave(&mut self, entered: EnteredSubject) -> bool {
        self.depth = entered.depth;
        let outer = self
            .outermost_revisited
            .filter(|&depth| depth < entered.depth);
        self.outermost_revisited = entered.revisited_earlier;
        if let Some(depth) = outer {
            self.revisit(depth);
        }
        outer.is_some()
    }
}

#[derive(Default)]
pub(super) struct TypesInProgress {
    subjects: SubjectStack,
    remaining_types: u64,
}

#[derive(Copy, Clone)]
pub(super) struct ReferenceIndex<'c> {
    to_bindings: &'c [(SymbolId, ExprId)],
    to_this: &'c [(FnId, ExprId)],
}

fn references_to<K: Copy + Ord>(references: &[(K, ExprId)], subject: K) -> &[(K, ExprId)] {
    let start = references.partition_point(|reference| reference.0 < subject);
    let len = references[start..].partition_point(|reference| reference.0 == subject);
    &references[start..start + len]
}

bitflags::bitflags! {
    #[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
    struct Facts: u16 {
        const NUMBER = 1 << 0;
        const INT32 = 1 << 1;
        const KEY = 1 << 2;
        const STRING = 1 << 3;
        const FUNCTION = 1 << 4;
        const OBJECT = 1 << 5;
        const STORED = 1 << 6;
        const REQUIRED = 1 << 7;
        const INCOMPLETE = 1 << 8;
        const NUMBER_AT_EVERY_VALUE = 1 << 9 | Self::NUMBER.bits();
    }
}

fn required_if(is_required: bool) -> Facts {
    match is_required {
        true => Facts::REQUIRED,
        false => Facts::empty(),
    }
}

struct Member {
    name: Atom,
    usage: Usage,
}

impl Member {
    fn is_called(&self) -> bool {
        self.usage.facts.contains(Facts::FUNCTION)
    }
}

#[derive(Default)]
pub(super) struct Usage {
    facts: Facts,
    arms: SmallVec<[TypeId; 2]>,
    members: Vec<Member>,
    elements: Option<Box<Usage>>,
}

impl Usage {
    fn member_mut(&mut self, name: Atom) -> &mut Usage {
        let found = self.members.iter().position(|member| member.name == name);
        let index = found.unwrap_or_else(|| {
            self.members.push(Member {
                name,
                usage: Usage::default(),
            });
            self.members.len() - 1
        });
        &mut self.members[index].usage
    }

    fn elements_mut(&mut self) -> &mut Usage {
        self.elements.get_or_insert_default()
    }

    fn add_arm(&mut self, arm: TypeId) {
        if !self.arms.contains(&arm) {
            self.arms.push(arm);
        }
    }

    fn merge(&mut self, walk: &mut Walk, other: &Usage) {
        if !walk.enter_node() {
            return;
        }
        self.facts |= other.facts;
        for &arm in &other.arms {
            self.add_arm(arm);
        }
        for member in &other.members {
            self.member_mut(member.name).merge(walk, &member.usage);
        }
        if let Some(elements) = &other.elements {
            self.elements_mut().merge(walk, elements);
        }
    }

    fn is_number(&self) -> bool {
        self.facts.contains(Facts::NUMBER) || self.arms.contains(&TypeId::NUMBER)
    }

    fn has_stored_part(&self) -> bool {
        let is_stored = |part: &Usage| part.facts.contains(Facts::STORED);
        self.elements.as_deref().is_some_and(is_stored)
            || self.members.iter().any(|member| is_stored(&member.usage))
    }
}

struct Walk {
    remaining_nodes: u64,
    subjects: SubjectStack,
}

impl Walk {
    fn new(max_nodes: u64) -> Walk {
        Walk {
            remaining_nodes: max_nodes,
            subjects: SubjectStack::default(),
        }
    }

    fn enter_node(&mut self) -> bool {
        let has_budget = self.remaining_nodes > 0;
        self.remaining_nodes = self.remaining_nodes.saturating_sub(1);
        has_budget
    }

    fn is_out_of_budget(&self) -> bool {
        self.remaining_nodes == 0
    }
}

#[derive(Copy, Clone)]
enum Use {
    Nothing,
    PassedOn(ExprId),
    Initializes(PatId),
    Destructured(ExprId),
    Member {
        access: ExprId,
        name: Atom,
        is_optional: bool,
    },
    Keyed {
        access: ExprId,
        key: ExprId,
        is_optional: bool,
    },
    Key {
        object: ExprId,
    },
    Called {
        is_optional: bool,
    },
    Argument {
        call: ExprId,
        index: usize,
    },
    Iterated(Option<PatId>),
    Object {
        is_required: bool,
    },
    Number,
    Int32,
    Updated,
    AddedTo(ExprId),
    ComparedWith(ExprId),
    Stored {
        op: Option<BinOp>,
        value: ExprId,
    },
}

fn find_use(hir: &hir::File<'_>, bound: &Bound<'_>, value: ExprId) -> Use {
    match bound.parent_of_expr(value) {
        Parent::Expr(parent) => match parent.some() {
            Some(parent) => find_use_in_expression(hir, bound, parent, value),
            None => Use::Nothing,
        },
        Parent::Stmt(statement) => match statement.some() {
            Some(statement) => find_use_in_statement(hir, statement),
            None => Use::Nothing,
        },
        Parent::VarInit(declaration) => Use::Initializes(hir[declaration].pat),
        Parent::Prop(property) => find_use_in_property(hir, bound, property, value),
        Parent::None
        | Parent::File
        | Parent::ParamDefault(_)
        | Parent::PatPropDefault(_)
        | Parent::PatElemDefault(_)
        | Parent::PropKey(_)
        | Parent::PatKey(_)
        | Parent::MemberKey(_)
        | Parent::MethodKey(_)
        | Parent::MemberInit(_)
        | Parent::FnBody(_)
        | Parent::EnumInit(_)
        | Parent::Case(_)
        | Parent::ClassExtends(_)
        | Parent::ClassDecorator(_)
        | Parent::MemberDecorator(_)
        | Parent::ParamDecorator(_)
        | Parent::Module(_) => Use::Nothing,
    }
}

fn find_use_in_expression(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    parent: ExprId,
    value: ExprId,
) -> Use {
    match hir[parent].kind {
        ExprKind::Dot { .. } | ExprKind::Index { .. } => find_use_in_access(hir, parent, value),
        ExprKind::Call(site) | ExprKind::New(site) => find_use_in_call(hir, parent, site, value),
        ExprKind::TaggedTemplate(site) if hir[site].callee == value => {
            Use::Called { is_optional: false }
        }
        ExprKind::Spread(_) if bound.get_assignment_target(hir, value).is_none() => {
            Use::Iterated(None)
        }
        ExprKind::Unary { op, .. } => find_use_as_unary_operand(op),
        ExprKind::Binary { op, left, right } => match left == value {
            true => find_use_as_binary_operand(op, parent, Side::Left, right),
            false => find_use_as_binary_operand(op, parent, Side::Right, left),
        },
        ExprKind::Assign {
            op,
            target,
            value: stored,
        } if target == value => Use::Stored { op, value: stored },
        ExprKind::Assign {
            op: None, target, ..
        } if matches!(hir[target].kind, ExprKind::Array(_)) => Use::Iterated(None),
        ExprKind::Assign {
            op: None, target, ..
        } if matches!(hir[target].kind, ExprKind::Object(_)) => Use::Destructured(target),
        ExprKind::Cond { test, .. } if test != value => Use::PassedOn(parent),
        ExprKind::As { .. }
        | ExprKind::Satisfies { .. }
        | ExprKind::AsConst(_)
        | ExprKind::NonNull(_)
        | ExprKind::Instantiation { .. } => Use::PassedOn(parent),
        ExprKind::TaggedTemplate(_)
        | ExprKind::Spread(_)
        | ExprKind::Assign { .. }
        | ExprKind::Cond { .. }
        | ExprKind::Missing
        | ExprKind::Ident(_)
        | ExprKind::PrivateIdentifier(_)
        | ExprKind::This
        | ExprKind::Super
        | ExprKind::Null
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Number(_)
        | ExprKind::String(_)
        | ExprKind::BigInt(_)
        | ExprKind::Regex { .. }
        | ExprKind::Template { .. }
        | ExprKind::Array(_)
        | ExprKind::Object(_)
        | ExprKind::Fn(_)
        | ExprKind::Class(_)
        | ExprKind::Await(_)
        | ExprKind::Yield { .. }
        | ExprKind::Jsx(_)
        | ExprKind::ImportCall { .. }
        | ExprKind::ImportMeta
        | ExprKind::NewTarget(_)
        | ExprKind::JsxText(_) => Use::Nothing,
    }
}

fn find_use_in_access(hir: &hir::File<'_>, access: ExprId, value: ExprId) -> Use {
    let Some((object, key)) = hir.member_key(access) else {
        return Use::Nothing;
    };
    if object != value {
        return Use::Key { object };
    }
    let is_optional = hir
        .expr_flags(access)
        .contains(ExprFlags::OPTIONAL_CHAIN_LINK);
    match key {
        MemberKey::Name(name) => Use::Member {
            access,
            name,
            is_optional,
        },
        MemberKey::PrivateName(_) => Use::Object {
            is_required: !is_optional,
        },
        MemberKey::Computed(key) => Use::Keyed {
            access,
            key,
            is_optional,
        },
    }
}

fn find_use_in_call(hir: &hir::File<'_>, call: ExprId, site: CallId, value: ExprId) -> Use {
    let node = hir[site];
    if node.callee == value {
        return Use::Called {
            is_optional: node.chain == Chain::Start,
        };
    }
    for (index, argument) in hir.ids(node.args).enumerate() {
        if argument == value {
            return Use::Argument { call, index };
        }
        if matches!(hir[argument].kind, ExprKind::Spread(_)) {
            break;
        }
    }
    Use::Nothing
}

fn find_use_as_unary_operand(op: UnOp) -> Use {
    match op {
        UnOp::Plus | UnOp::Minus => Use::Number,
        UnOp::BitNot => Use::Int32,
        UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => Use::Updated,
        UnOp::Not | UnOp::Typeof | UnOp::Void | UnOp::Delete => Use::Nothing,
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Side {
    Left,
    Right,
}

fn find_use_as_binary_operand(op: BinOp, whole: ExprId, side: Side, other: ExprId) -> Use {
    match op {
        BinOp::Add => Use::AddedTo(other),
        BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Rem | BinOp::Pow => Use::Number,
        BinOp::Shl | BinOp::Shr | BinOp::UShr | BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor => {
            Use::Int32
        }
        BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => Use::ComparedWith(other),
        BinOp::And | BinOp::Or | BinOp::Nullish => Use::PassedOn(whole),
        BinOp::Comma if side == Side::Right => Use::PassedOn(whole),
        BinOp::In if side == Side::Right => Use::Object { is_required: true },
        BinOp::Comma
        | BinOp::In
        | BinOp::EqEq
        | BinOp::NotEq
        | BinOp::EqEqEq
        | BinOp::NotEqEq
        | BinOp::Instanceof => Use::Nothing,
    }
}

fn find_use_in_property(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    property: PropId,
    value: ExprId,
) -> Use {
    match hir[property].kind {
        PropKind::Spread if bound.get_assignment_target(hir, value).is_none() => {
            Use::Object { is_required: false }
        }
        PropKind::Spread
        | PropKind::Init
        | PropKind::Shorthand
        | PropKind::Method
        | PropKind::Getter
        | PropKind::Setter => Use::Nothing,
    }
}

fn find_use_in_statement(hir: &hir::File<'_>, statement: StmtId) -> Use {
    match hir[statement].kind {
        StmtKind::ForOf {
            left,
            is_await: false,
            ..
        } => Use::Iterated(find_declared_pattern(hir, left)),
        StmtKind::ForIn { .. } => Use::Object { is_required: false },
        StmtKind::ForOf { is_await: true, .. }
        | StmtKind::Empty
        | StmtKind::Debugger
        | StmtKind::Expr(_)
        | StmtKind::Var(_)
        | StmtKind::Fn(_)
        | StmtKind::Class(_)
        | StmtKind::Interface(_)
        | StmtKind::TypeAlias(_)
        | StmtKind::Enum(_)
        | StmtKind::Module(_)
        | StmtKind::Return(_)
        | StmtKind::If { .. }
        | StmtKind::For { .. }
        | StmtKind::While { .. }
        | StmtKind::DoWhile { .. }
        | StmtKind::Block(_)
        | StmtKind::Switch { .. }
        | StmtKind::Try { .. }
        | StmtKind::Throw(_)
        | StmtKind::Break(_)
        | StmtKind::Continue(_)
        | StmtKind::Labeled { .. }
        | StmtKind::Import(_)
        | StmtKind::ImportEquals(_)
        | StmtKind::ExportNamed(_)
        | StmtKind::ExportStar { .. }
        | StmtKind::ExportDefault(_)
        | StmtKind::ExportAssign(_)
        | StmtKind::ExportAsNamespace(_)
        | StmtKind::With { .. }
        | StmtKind::Directive { .. } => Use::Nothing,
    }
}

fn find_declared_pattern(hir: &hir::File<'_>, loop_head: StmtId) -> Option<PatId> {
    let StmtKind::Var(declarations) = hir[loop_head].kind else {
        return None;
    };
    let declaration = declarations.iter().next()?;
    Some(hir[declaration].pat)
}

fn find_initialized_symbol(bound: &Bound<'_>, name: PatId) -> Option<SymbolId> {
    match bound.initialized_binding(name) {
        Binding::Symbol(symbol) => Some(symbol),
        Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
    }
}

fn has_written_type(hir: &hir::File<'_>, bound: &Bound<'_>, name: PatId) -> bool {
    root_declaration(bound, name).has_type_annotation(hir)
}

fn is_untyped_variable(hir: &hir::File<'_>, bound: &Bound<'_>, symbol: SymbolId) -> bool {
    let declarations = bound.symbol(symbol).decls;
    !declarations.is_empty()
        && declarations.iter().all(|&declaration| match declaration {
            Decl::Var(name) | Decl::Param(name) => !has_written_type(hir, bound, name),
            Decl::Fn(_)
            | Decl::Class(_)
            | Decl::Interface(_)
            | Decl::Alias(_)
            | Decl::Enum(_)
            | Decl::EnumMember(_)
            | Decl::Module(_)
            | Decl::TypeParam(_)
            | Decl::ImportDefault(_)
            | Decl::ImportNamespace(_)
            | Decl::ImportSpec(_)
            | Decl::ImportEquals(_)
            | Decl::ExportSpec(_)
            | Decl::ExportStarAs(_)
            | Decl::ExportExpr(_)
            | Decl::UmdGlobal(_)
            | Decl::File
            | Decl::Require(_)
            | Decl::ModuleExports(_)
            | Decl::ExportsProperty(_)
            | Decl::Expando(_)
            | Decl::ObjectLiteral(_)
            | Decl::CommonJsVariable
            | Decl::Member(_)
            | Decl::ParameterProperty(_)
            | Decl::ThisProperty(_)
            | Decl::Property(_)
            | Decl::TypeLiteral(_) => false,
        })
}

fn find_alternatives(hir: &hir::File<'_>, expression: ExprId) -> SmallVec<[ExprId; 2]> {
    let mut alternatives = SmallVec::new();
    if let ExprKind::Cond { branches, .. } = hir[expression].kind {
        let branches = hir.branches(branches);
        alternatives.extend([branches.yes, branches.no]);
    } else if let ExprKind::Binary { op, left, right } = hir[expression].kind {
        for (side, operand, other) in [(Side::Left, left, right), (Side::Right, right, left)] {
            if let Use::PassedOn(_) = find_use_as_binary_operand(op, expression, side, other) {
                alternatives.push(operand);
            }
        }
    }
    alternatives
}

fn is_evaluated_for_some_values_only(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    expression: ExprId,
) -> bool {
    let mut inner = expression;
    while let Parent::Expr(parent) = bound.parent_of_expr(inner) {
        let Some(parent) = parent.some() else {
            return false;
        };
        match hir[parent].kind {
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                right,
                ..
            } if right == inner => return true,
            ExprKind::Cond { test, .. } if test != inner => return true,
            _ => inner = parent,
        }
    }
    false
}

fn is_int32_value(value: f64) -> bool {
    let is_negative_zero = value == 0.0 && value.is_sign_negative();
    value.fract() == 0.0
        && value >= f64::from(i32::MIN)
        && value <= f64::from(i32::MAX)
        && !is_negative_zero
}

fn yields_int32(op: BinOp) -> bool {
    match op {
        BinOp::Shl | BinOp::Shr | BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor => true,
        BinOp::UShr
        | BinOp::Add
        | BinOp::Sub
        | BinOp::Mul
        | BinOp::Div
        | BinOp::Rem
        | BinOp::Pow
        | BinOp::Lt
        | BinOp::Le
        | BinOp::Gt
        | BinOp::Ge
        | BinOp::EqEq
        | BinOp::NotEq
        | BinOp::EqEqEq
        | BinOp::NotEqEq
        | BinOp::And
        | BinOp::Or
        | BinOp::Nullish
        | BinOp::In
        | BinOp::Instanceof
        | BinOp::Comma => false,
    }
}

fn find_enclosing_sum(hir: &hir::File<'_>, bound: &Bound<'_>, operand: ExprId) -> Option<ExprId> {
    let Parent::Expr(parent) = bound.parent_of_expr(operand) else {
        return None;
    };
    let parent = parent.some()?;
    let is_sum = matches!(
        hir[parent].kind,
        ExprKind::Binary {
            op: BinOp::Add | BinOp::Sub,
            ..
        }
    );
    is_sum.then_some(parent)
}

fn is_used_as_int32(hir: &hir::File<'_>, bound: &Bound<'_>, number: ExprId) -> bool {
    let mut value = number;
    loop {
        match find_use(hir, bound, value) {
            Use::Int32 | Use::Key { .. } => return true,
            Use::Stored { op: Some(op), .. } => return yields_int32(op) || op == BinOp::UShr,
            Use::AddedTo(_) | Use::Number => match find_enclosing_sum(hir, bound, value) {
                Some(sum) => value = sum,
                None => return false,
            },
            Use::Nothing
            | Use::PassedOn(_)
            | Use::Initializes(_)
            | Use::Destructured(_)
            | Use::Member { .. }
            | Use::Keyed { .. }
            | Use::Called { .. }
            | Use::Argument { .. }
            | Use::Iterated(_)
            | Use::Object { .. }
            | Use::Updated
            | Use::ComparedWith(_)
            | Use::Stored { op: None, .. } => return false,
        }
    }
}

const MAX_CALLS_READ: usize = 16;

fn find_name_of_function(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    function: FnId,
) -> Option<SymbolId> {
    match bound.fns[function.idx()].owner {
        FnOwner::Stmt(_) => bound.fn_symbol[function.idx()].some(),
        FnOwner::Expr(expression) => match bound.parent_of_expr(expression) {
            Parent::VarInit(declaration) => find_initialized_symbol(bound, hir[declaration].pat),
            _ => None,
        },
        FnOwner::None | FnOwner::Member(_) | FnOwner::Type(_) => None,
    }
}

fn find_argument_of_call(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    callee: ExprId,
    index: usize,
) -> Option<ExprId> {
    let Parent::Expr(call) = bound.parent_of_expr(callee) else {
        return None;
    };
    let ExprKind::Call(site) = hir[call.some()?].kind else {
        return None;
    };
    let node = hir[site];
    if node.callee != callee {
        return None;
    }
    let mut arguments = hir.ids(node.args).take(index + 1);
    if arguments
        .clone()
        .any(|it| matches!(hir[it].kind, ExprKind::Spread(_)))
    {
        return None;
    }
    Some(arguments.nth(index).unwrap_or(ExprId::NONE))
}

fn find_parameter(parameters: &[SigParam], index: usize) -> Option<SigParam> {
    parameters
        .get(index)
        .copied()
        .filter(|parameter| !parameter.rest)
}

#[derive(Copy, Clone)]
struct CallWithReceiver {
    signature: SigId,
    takes_argument_list: bool,
}

type TypeParts = SmallVec<[TypeId; 4]>;

impl<'c, 'p, 's> Queries<'c, 'p, 's> {
    fn are_positions_only_expected(&self, of: FileId) -> bool {
        match self.role(of) {
            FileRole::Inferred => true,
            FileRole::Checked | FileRole::TypesOnly => false,
        }
    }

    pub(super) fn infer_parameter_type(
        &mut self,
        of: FileId,
        parameter: ParamId,
        checked: TypeId,
    ) -> TypeId {
        match self.find_parameter_subject(of, parameter, checked) {
            Some(subject) if self.are_positions_only_expected(of) => {
                self.inferred_argument_type_or(subject, checked)
            }
            Some(_) | None => checked,
        }
    }

    pub(super) fn infer_binding_type(&mut self, pattern: PatId, checked: TypeId) -> TypeId {
        let (hir, bound) = (self.hir(), self.bound());
        let is_untyped_name = matches!(hir[pattern].kind, PatKind::Ident(_))
            && !has_written_type(hir, bound, pattern)
            && self.are_positions_only_expected(self.file);
        let Some(symbol) = find_initialized_symbol(bound, pattern).filter(|_| is_untyped_name)
        else {
            return checked;
        };
        if checked == TypeId::NUMBER {
            return self.inferred_type_or(Subject::Number(symbol), checked);
        }
        if !self.c.is_any(checked) {
            return checked;
        }
        match bound.pat_parent[pattern.idx()] {
            PatParent::Param(_) => {
                self.inferred_argument_type_or(Subject::Binding(symbol), checked)
            }
            PatParent::None | PatParent::Var(_) | PatParent::Prop(..) | PatParent::Elem(..) => {
                self.inferred_type_or(Subject::Binding(symbol), checked)
            }
        }
    }

    pub(super) fn infer_this_type(&mut self, of: FileId, function: FnId) -> TypeId {
        match self.find_this_subject(of, function) {
            Some(subject) => self.inferred_type(subject),
            None => TypeId::ANY,
        }
    }

    pub(super) fn infer_result_type(
        &mut self,
        of: FileId,
        function: FnId,
        checked: TypeId,
    ) -> TypeId {
        let is_untyped = self.c.is_any(checked) && self.are_positions_only_expected(of);
        match self.find_result_subject(of, function) {
            Some(subject) if is_untyped => self.inferred_type_or(subject, checked),
            Some(_) | None => checked,
        }
    }

    pub(super) fn infer_expression_type(&mut self, expression: ExprId, checked: TypeId) -> TypeId {
        if self.c.is_any(checked) {
            return self.inferred_type_or(Subject::Expression(expression), checked);
        }
        match self.find_number_subject(expression, checked) {
            Some(subject) => self.inferred_type_or(subject, checked),
            None => checked,
        }
    }

    fn inferred_argument_type_or(&mut self, subject: Subject, checked: TypeId) -> TypeId {
        match self.inferred_type_or(subject, checked) {
            TypeId::NUMBER => checked,
            inferred => inferred,
        }
    }

    fn inferred_type_or(&mut self, subject: Subject, checked: TypeId) -> TypeId {
        let inferred = self.inferred_type(subject);
        match self.c.is_any(inferred) {
            true => checked,
            false => inferred,
        }
    }

    fn find_parameter_subject(
        &self,
        of: FileId,
        parameter: ParamId,
        checked: TypeId,
    ) -> Option<Subject> {
        if of != self.file {
            return None;
        }
        let (hir, bound) = (self.hir(), self.bound());
        let node = hir[parameter];
        if node.ty.is_some() {
            return None;
        }
        match hir[node.pat].kind {
            PatKind::Ident(_) if self.c.is_any(checked) => {
                find_initialized_symbol(bound, node.pat).map(Subject::Binding)
            }
            PatKind::Object(_) if self.is_implied_by_pattern(checked, node.pat) => {
                Some(Subject::Pattern(node.pat))
            }
            PatKind::Ident(_) | PatKind::Object(_) | PatKind::Array(_) | PatKind::Missing => None,
        }
    }

    fn is_implied_by_pattern(&self, ty: TypeId, pattern: PatId) -> bool {
        let position = (self.file, self.hir()[pattern].pos);
        matches!(self.c.data(ty), TypeData::Synth(shape) if shape.pattern_at == Some(position))
    }

    fn find_this_subject(&self, of: FileId, function: FnId) -> Option<Subject> {
        if of != self.file {
            return None;
        }
        let node = self.hir()[function];
        let has_own_this = match node.kind {
            FnKind::Decl | FnKind::Expr | FnKind::Method | FnKind::Getter | FnKind::Setter => true,
            FnKind::Arrow
            | FnKind::Constructor
            | FnKind::StaticBlock
            | FnKind::CallSignature
            | FnKind::ConstructSignature
            | FnKind::FunctionType
            | FnKind::ConstructorType
            | FnKind::IndexSignature => false,
        };
        let is_untyped =
            node.this_param.is_none() && self.c.class_of_member_fn(of, function).is_none();
        (has_own_this && is_untyped).then_some(Subject::This(function))
    }

    fn find_result_subject(&self, of: FileId, function: FnId) -> Option<Subject> {
        if of != self.file {
            return None;
        }
        let node = self.hir()[function];
        let returns_a_value = match node.kind {
            FnKind::Decl | FnKind::Expr | FnKind::Arrow | FnKind::Method | FnKind::Getter => true,
            FnKind::Setter
            | FnKind::Constructor
            | FnKind::StaticBlock
            | FnKind::CallSignature
            | FnKind::ConstructSignature
            | FnKind::FunctionType
            | FnKind::ConstructorType
            | FnKind::IndexSignature => false,
        };
        let wraps_the_value = node.flags.intersects(Flags::ASYNC | Flags::GENERATOR);
        (returns_a_value && !wraps_the_value && node.ret.is_none())
            .then_some(Subject::Result(function))
    }

    fn find_result_subject_of_call(&mut self, call: ExprId) -> Option<Subject> {
        if !matches!(self.hir()[call].kind, ExprKind::Call(_)) {
            return None;
        }
        let declaration = self.resolved_call(call).ok()??.declaration?;
        self.find_result_subject(declaration.file, declaration.function)
    }

    fn find_referenced_subject(&self, expression: ExprId) -> Option<Subject> {
        let (hir, bound) = (self.hir(), self.bound());
        if matches!(hir[expression].kind, ExprKind::This) {
            return match self.c.this_container(self.file, expression) {
                Some(Ok(function)) => self.find_this_subject(self.file, function),
                Some(Err(_)) | None => None,
            };
        }
        if !matches!(hir[expression].kind, ExprKind::Ident(_)) {
            return None;
        }
        match bound.binding(expression) {
            Binding::Symbol(symbol) if is_untyped_variable(hir, bound, symbol) => {
                Some(Subject::Binding(symbol))
            }
            Binding::Symbol(_) | Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => {
                None
            }
        }
    }

    fn find_number_subject(&self, expression: ExprId, checked: TypeId) -> Option<Subject> {
        if checked != TypeId::NUMBER {
            return None;
        }
        match self.find_referenced_subject(expression) {
            Some(Subject::Binding(symbol)) => Some(Subject::Number(symbol)),
            Some(
                Subject::Pattern(_)
                | Subject::This(_)
                | Subject::Result(_)
                | Subject::Expression(_)
                | Subject::Number(_),
            )
            | None => None,
        }
    }

    fn inferred_type(&mut self, subject: Subject) -> TypeId {
        if self.infers_nothing_from_use {
            return TypeId::ANY;
        }
        match self.memo.inferred_types.get(&subject) {
            Some(&TypeState::Known(known)) => return known,
            Some(&TypeState::InProgress(depth)) => {
                self.memo.types_in_progress.subjects.revisit(depth);
                return TypeId::ANY;
            }
            None => {}
        }
        let max_types = self.inputs.max_inference_nodes;
        let in_progress = &mut self.memo.types_in_progress;
        if in_progress.subjects.depth == 0 {
            in_progress.remaining_types = max_types;
        }
        if in_progress.remaining_types == 0 {
            in_progress.subjects.revisit(0);
            return TypeId::ANY;
        }
        in_progress.remaining_types -= 1;
        let entered = in_progress.subjects.enter();
        let state = TypeState::InProgress(entered.depth);
        self.memo.inferred_types.insert(subject, state);
        let unstable_answers = self.count_unstable_answers();
        let inferred = self.ask(|queries| {
            Ok(match subject {
                Subject::Expression(expression) => queries.compute_expression_type(expression),
                Subject::Result(function) => queries.compute_result_type(function),
                Subject::Number(symbol) => queries.compute_number_type(symbol),
                Subject::Binding(symbol) => queries.compute_binding_type(symbol),
                Subject::Pattern(_) | Subject::This(_) => queries.compute_type_from_uses(subject),
            })
        });
        let inferred = inferred.unwrap_or(TypeId::ANY);
        let ran_into_outer_subject = self.memo.types_in_progress.subjects.leave(entered);
        if !ran_into_outer_subject && self.count_unstable_answers() == unstable_answers {
            let known = TypeState::Known(inferred);
            self.memo.inferred_types.insert(subject, known);
        } else {
            self.memo.inferred_types.remove(&subject);
        }
        inferred
    }

    fn compute_binding_type(&mut self, symbol: SymbolId) -> TypeId {
        let &[Decl::Param(name)] = self.bound().symbol(symbol).decls else {
            return self.compute_type_from_uses(Subject::Binding(symbol));
        };
        let declared = self.find_declared_parameter_type(name);
        if !self.c.is_any(declared) {
            return declared;
        }
        let used_as = self.compute_type_from_uses(Subject::Binding(symbol));
        match self.c.is_any(used_as) {
            true => self.compute_type_from_arguments(name),
            false => used_as,
        }
    }

    fn compute_type_from_arguments(&mut self, name: PatId) -> TypeId {
        let (hir, bound) = (self.hir(), self.bound());
        let PatParent::Param(parameter) = bound.pat_parent[name.idx()] else {
            return TypeId::ANY;
        };
        let function = bound.param_fn[parameter.idx()];
        if function == FnId::NONE || hir[parameter].flags.contains(Flags::REST) {
            return TypeId::ANY;
        }
        let mut parameters = hir[function].params.iter();
        let Some(index) = parameters.position(|other| other == parameter) else {
            return TypeId::ANY;
        };
        let Some(callee) = find_name_of_function(hir, bound, function) else {
            return TypeId::ANY;
        };
        let references = references_to(self.reference_index().to_bindings, callee);
        if references.len() > MAX_CALLS_READ || self.is_exported(callee) {
            return TypeId::ANY;
        }
        let mut parts = TypeParts::new();
        for &(_, reference) in references {
            let Some(argument) = find_argument_of_call(hir, bound, reference, index) else {
                return TypeId::ANY;
            };
            let given = match argument.some() {
                Some(argument) => self.predicted_expression_type(argument),
                None => Ok(TypeId::UNDEFINED),
            };
            match given {
                Ok(given) if !self.c.is_any(given) => parts.push(self.c.base_of_literal(given)),
                Ok(_) | Err(_) => return TypeId::ANY,
            }
        }
        match parts[..] {
            [] | [TypeId::UNDEFINED] => TypeId::ANY,
            _ => self.c.union(&parts),
        }
    }

    fn is_exported(&self, symbol: SymbolId) -> bool {
        let files = self.files();
        let symbol = files.sym(self.file, symbol);
        let exports = files.exports_of_module(files.file_symbol(self.file));
        exports
            .iter()
            .any(|&(_, export)| files.resolve_alias_if_needed(export) == Some(symbol))
    }

    fn compute_result_type(&mut self, function: FnId) -> TypeId {
        let (hir, bound) = (self.hir(), self.bound());
        let mut result = Usage::default();
        match hir[function].body {
            FnBody::None => {}
            FnBody::Expr(returned) => self.add_returned_type(returned, &mut result),
            FnBody::Block(_) => {
                for statement in bound.ids(bound.fns[function.idx()].returns) {
                    if let StmtKind::Return(returned) = hir[statement].kind
                        && returned.is_some()
                    {
                        self.add_returned_type(returned, &mut result);
                    }
                }
            }
        }
        self.type_of_usage(&result)
    }

    fn add_returned_type(&mut self, returned: ExprId, result: &mut Usage) {
        if self.c.is_stack_low() {
            return;
        }
        let Ok(checked) = self.expression_type(returned) else {
            return;
        };
        let alternatives = find_alternatives(self.hir(), returned);
        if self.c.is_any(checked) && !alternatives.is_empty() {
            for alternative in alternatives {
                self.add_returned_type(alternative, result);
            }
            return;
        }
        let expected = self.infer_expression_type(returned, checked);
        let expected = self.c.widened(expected);
        self.add_arm(result, expected);
    }

    fn compute_number_type(&mut self, symbol: SymbolId) -> TypeId {
        let Some(int32) = self.c.p.aot_symbols().int32_alias() else {
            return TypeId::ANY;
        };
        let (hir, bound) = (self.hir(), self.bound());
        let references = self.reference_index().to_bindings;
        let has_int32_use = references_to(references, symbol)
            .iter()
            .any(|&(_, reference)| is_used_as_int32(hir, bound, reference));
        let mut walk = Walk::new(self.inputs.max_inference_nodes);
        let holds_integers = has_int32_use
            && self.starts_as_integer(&mut walk, symbol)
            && self.gets_only_integers(&mut walk, symbol);
        match holds_integers {
            true => self.c.declared_type(int32),
            false => TypeId::ANY,
        }
    }

    fn starts_as_integer(&mut self, walk: &mut Walk, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.hir(), self.bound());
        let mut has_initializer = false;
        for &declaration in bound.symbol(symbol).decls {
            let Decl::Var(name) = declaration else {
                return false;
            };
            let PatParent::Var(variable) = bound.pat_parent[name.idx()] else {
                return false;
            };
            if let Some(initializer) = hir[variable].init.some() {
                if !self.is_integer(walk, initializer) {
                    return false;
                }
                has_initializer = true;
            }
        }
        has_initializer
    }

    fn gets_only_integers(&mut self, walk: &mut Walk, symbol: SymbolId) -> bool {
        let (hir, bound) = (self.hir(), self.bound());
        bound
            .stores_to(symbol)
            .iter()
            .all(|store| match store.kind {
                StoreKind::Update(_) => true,
                StoreKind::Assign | StoreKind::CompoundAssign(_) => {
                    match find_use(hir, bound, store.target) {
                        Use::Stored { op, value } => self.stores_integer(walk, op, value),
                        Use::Nothing
                        | Use::PassedOn(_)
                        | Use::Initializes(_)
                        | Use::Destructured(_)
                        | Use::Member { .. }
                        | Use::Keyed { .. }
                        | Use::Key { .. }
                        | Use::Called { .. }
                        | Use::Argument { .. }
                        | Use::Iterated(_)
                        | Use::Object { .. }
                        | Use::Number
                        | Use::Int32
                        | Use::Updated
                        | Use::AddedTo(_)
                        | Use::ComparedWith(_) => false,
                    }
                }
                StoreKind::Destructure | StoreKind::ForIn | StoreKind::ForOf => false,
            })
    }

    fn stores_integer(&mut self, walk: &mut Walk, op: Option<BinOp>, value: ExprId) -> bool {
        match op {
            None | Some(BinOp::Add | BinOp::Sub | BinOp::And | BinOp::Or | BinOp::Nullish) => {
                let checked = self.expression_type(value);
                let is_unknown = checked.is_ok_and(|checked| self.c.is_any(checked));
                is_unknown || self.is_integer(walk, value)
            }
            Some(op) => yields_int32(op),
        }
    }

    fn is_integer(&mut self, walk: &mut Walk, expression: ExprId) -> bool {
        if self.c.is_stack_low() || !walk.enter_node() {
            return false;
        }
        let Ok(checked) = self.expression_type(expression) else {
            return false;
        };
        if self.is_int32_type(checked) {
            return true;
        }
        if let Some(subject) = self.find_number_subject(expression, checked) {
            return self.is_expected_int32(subject);
        }
        let hir = self.hir();
        if let Some((object, MemberKey::Name(name))) = hir.member_key(expression) {
            return name == known::length && self.is_list(object);
        }
        if let ExprKind::Unary { op, .. } = hir[expression].kind {
            return op == UnOp::BitNot;
        }
        let ExprKind::Binary { op, left, right } = hir[expression].kind else {
            return false;
        };
        let is_sum = matches!(op, BinOp::Add | BinOp::Sub);
        yields_int32(op) || is_sum && self.is_integer(walk, left) && self.is_integer(walk, right)
    }

    fn is_int32_type(&mut self, ty: TypeId) -> bool {
        let int32 = self.c.p.aot_symbols().int32_alias();
        let int32 = int32.map(|alias| self.c.declared_type(alias));
        self.c.every_type(ty, |c, part| {
            let is_int32_literal = matches!(
                c.data(part),
                TypeData::NumberLit { bits, .. } if is_int32_value(f64::from_bits(*bits))
            );
            is_int32_literal || Some(part) == int32
        })
    }

    fn is_expected_int32(&mut self, number: Subject) -> bool {
        if let Some(&TypeState::InProgress(depth)) = self.memo.inferred_types.get(&number) {
            self.memo.types_in_progress.subjects.revisit(depth);
            return true;
        }
        let inferred = self.inferred_type(number);
        !self.c.is_any(inferred)
    }

    fn compute_expression_type(&mut self, expression: ExprId) -> TypeId {
        if self.c.is_stack_low() {
            return TypeId::ANY;
        }
        if let Some(subject) = self.find_referenced_subject(expression) {
            return self.inferred_type(subject);
        }
        if let Some(found) = self.find_type_in_inferred_receiver(expression)
            && !self.c.is_any(found)
        {
            return found;
        }
        if let Some(result) = self.find_result_of_inferred_method(expression) {
            return result;
        }
        if let Some(subject) = self.find_result_subject_of_call(expression) {
            let result = self.inferred_type(subject);
            if !self.c.is_any(result) {
                return result;
            }
        }
        self.compute_type_from_uses(Subject::Expression(expression))
    }

    fn find_type_in_inferred_receiver(&mut self, access: ExprId) -> Option<TypeId> {
        let (object, key) = self.hir().member_key(access)?;
        let checked = self.expression_type(object).ok()?;
        if !self.c.is_any(checked) {
            return None;
        }
        let receiver = self.inferred_type(Subject::Expression(object));
        if self.c.is_any(receiver) {
            return None;
        }
        let name = match key {
            MemberKey::Name(name) => name,
            MemberKey::PrivateName(_) => return None,
            MemberKey::Computed(key) => {
                let key_type = self.expression_type(key).ok()?;
                if self.is_number_type(key_type) {
                    return self.find_element_type(receiver);
                }
                self.c.property_name_of_type(key_type)?
            }
        };
        match self.find_member(receiver, name).ok()? {
            MemberLookup::Member(member) => member.types.checked.ok(),
            MemberLookup::Index(signature) => signature.types.checked.ok(),
            MemberLookup::Absent => None,
        }
    }

    fn find_result_of_inferred_method(&mut self, call: ExprId) -> Option<TypeId> {
        let hir = self.hir();
        let ExprKind::Call(site) = hir[call].kind else {
            return None;
        };
        let callee = hir[site].callee;
        hir.member_key(callee)?;
        let method = self.find_type_in_inferred_receiver(callee)?;
        let signatures = self.c.signatures(method, false);
        let (&first, others) = signatures.split_first()?;
        let result = self.c.sig_return(first);
        let is_one_result = others
            .iter()
            .all(|&other| self.c.sig_return(other) == result);
        let says_something = !self.c.is_any(result) && !self.c.has_type_variables(result);
        (is_one_result && says_something).then_some(result)
    }

    fn find_element_type(&mut self, list: TypeId) -> Option<TypeId> {
        let mut elements = TypeParts::new();
        for &part in self.c.parts(list) {
            if self.c.is_string_like(part) {
                elements.push(TypeId::STRING);
            } else {
                elements.push(self.c.array_element(part)?);
            }
        }
        Some(self.c.union(&elements))
    }

    fn compute_type_from_uses(&mut self, subject: Subject) -> TypeId {
        let mut walk = Walk::new(self.inputs.max_inference_nodes);
        match self.usage_of(&mut walk, subject) {
            Some(usage) => self.type_of_usage(&usage),
            None => TypeId::ANY,
        }
    }

    fn reference_index(&mut self) -> ReferenceIndex<'c> {
        if let Some(index) = self.memo.reference_index {
            return index;
        }
        let index = self.compute_reference_index();
        self.memo.reference_index = Some(index);
        index
    }

    fn compute_reference_index(&mut self) -> ReferenceIndex<'c> {
        let (file, hir, bound) = (self.file, self.hir(), self.bound());
        let expressions = self.c.exprs_by_kind(file);
        let mut to_bindings = Vec::new();
        for &reference in expressions.of(ExprTag::Ident) {
            let is_evaluated = bound.is_evaluated_ident(reference)
                && self.require_live_expression(reference).is_ok();
            match bound.binding(reference) {
                Binding::Symbol(symbol) if is_evaluated => to_bindings.push((symbol, reference)),
                Binding::Symbol(_)
                | Binding::Arguments(_)
                | Binding::CommonJs(_)
                | Binding::Free => {}
            }
        }
        let mut to_this = Vec::new();
        for &reference in expressions.of(ExprTag::This) {
            let is_evaluated = self.require_live_expression(reference).is_ok();
            match self.c.this_container(file, reference) {
                Some(Ok(function)) if is_evaluated => to_this.push((function, reference)),
                Some(Ok(_) | Err(_)) | None => {}
            }
        }
        to_bindings
            .sort_unstable_by_key(|&(symbol, reference)| (symbol, hir[reference].pos, reference));
        to_this.sort_unstable_by_key(|&(function, reference)| {
            (function, hir[reference].pos, reference)
        });
        ReferenceIndex {
            to_bindings: self.list(&to_bindings),
            to_this: self.list(&to_this),
        }
    }

    fn usage_of(&mut self, walk: &mut Walk, subject: Subject) -> Option<Rc<Usage>> {
        match self.memo.usages.get(&subject) {
            Some(UsageState::Known(usage)) => return Some(Rc::clone(usage)),
            Some(&UsageState::InProgress(depth)) => {
                walk.subjects.revisit(depth);
                return None;
            }
            None => {}
        }
        let entered = walk.subjects.enter();
        let is_outermost = entered.depth == 0;
        let state = UsageState::InProgress(entered.depth);
        self.memo.usages.insert(subject, state);
        let unstable_answers = self.count_unstable_answers();
        let computed = self.ask(|queries| Ok(queries.compute_usage(walk, subject)));
        let ran_into_outer_subject = walk.subjects.leave(entered);
        let had_full_budget = is_outermost || !walk.is_out_of_budget();
        let can_be_merged = match subject {
            Subject::Binding(_) | Subject::Pattern(_) | Subject::This(_) => true,
            Subject::Result(_) | Subject::Expression(_) | Subject::Number(_) => false,
        };
        let is_final = can_be_merged
            && !ran_into_outer_subject
            && had_full_budget
            && self.count_unstable_answers() == unstable_answers;
        let usage = computed.ok().map(Rc::new);
        match &usage {
            Some(usage) if is_final => {
                let known = UsageState::Known(Rc::clone(usage));
                self.memo.usages.insert(subject, known);
            }
            Some(_) | None => {
                self.memo.usages.remove(&subject);
            }
        }
        usage
    }

    fn compute_usage(&mut self, walk: &mut Walk, subject: Subject) -> Usage {
        let mut usage = Usage::default();
        match subject {
            Subject::Binding(symbol) => {
                let references = self.reference_index().to_bindings;
                for &(_, reference) in references_to(references, symbol) {
                    self.add_evidence(walk, reference, &mut usage);
                }
            }
            Subject::This(function) => {
                let references = self.reference_index().to_this;
                for &(_, reference) in references_to(references, function) {
                    let checked = self.expression_type(reference);
                    if checked.is_ok_and(|checked| self.c.is_any(checked)) {
                        self.add_evidence(walk, reference, &mut usage);
                    }
                }
            }
            Subject::Pattern(pattern) => self.add_uses_of_pattern(walk, pattern, &mut usage),
            Subject::Expression(expression) => self.add_evidence(walk, expression, &mut usage),
            Subject::Result(_) | Subject::Number(_) => {
                debug_assert!(
                    false,
                    "what is returned types a result and what is stored a number, not their uses"
                );
            }
        }
        if walk.is_out_of_budget() {
            usage.facts |= Facts::INCOMPLETE;
        }
        usage
    }

    fn add_uses_of_subject(&mut self, walk: &mut Walk, subject: Subject, usage: &mut Usage) {
        let Some(found) = self.usage_of(walk, subject) else {
            return;
        };
        let is_stored = usage.facts & Facts::STORED;
        usage.merge(walk, &found);
        usage.facts = (usage.facts - Facts::STORED) | is_stored;
    }

    fn calls_its_object(&self, access: ExprId) -> bool {
        let named = self.inputs.named_values.find_named_value(self.file, access);
        matches!(
            named,
            Some(NamedValue::PrototypeOperation(
                PrototypeOperation::CallFunction { .. }
            ))
        )
    }

    fn add_evidence(&mut self, walk: &mut Walk, value: ExprId, usage: &mut Usage) {
        if self.c.is_stack_low() || !walk.enter_node() {
            return;
        }
        let Ok(checked) = self.expression_type(value) else {
            return;
        };
        if !self.c.is_any(checked) {
            self.add_arm(usage, checked);
            return;
        }
        match find_use(self.hir(), self.bound(), value) {
            Use::Nothing => {}
            Use::PassedOn(outer) => self.add_evidence(walk, outer, usage),
            Use::Initializes(pattern) => self.add_uses_of_pattern(walk, pattern, usage),
            Use::Destructured(pattern) => self.add_members_of_assignment_pattern(pattern, usage),
            Use::Member {
                access,
                name,
                is_optional,
            } => {
                usage.facts |= required_if(!is_optional);
                match self.calls_its_object(access) {
                    true => usage.facts |= Facts::FUNCTION,
                    false => self.add_evidence(walk, access, usage.member_mut(name)),
                }
            }
            Use::Keyed {
                access,
                key,
                is_optional,
            } => {
                usage.facts |= required_if(!is_optional);
                self.add_keyed_access(walk, access, key, usage);
            }
            Use::Key { object } => {
                usage.facts |= match self.is_list(object) {
                    true => Facts::NUMBER_AT_EVERY_VALUE | Facts::INT32,
                    false => Facts::KEY,
                };
            }
            Use::Called { is_optional } => {
                usage.facts |= Facts::FUNCTION;
                usage.facts |= required_if(!is_optional);
            }
            Use::Argument { call, index } => self.add_uses_of_argument(walk, call, index, usage),
            Use::Iterated(pattern) => {
                usage.facts |= Facts::REQUIRED;
                let elements = usage.elements_mut();
                if let Some(pattern) = pattern {
                    self.add_uses_of_pattern(walk, pattern, elements);
                }
            }
            Use::Object { is_required } => {
                usage.facts |= Facts::OBJECT;
                usage.facts |= required_if(is_required);
            }
            Use::Number => usage.facts |= self.number_fact_of_operand(value),
            Use::Int32 => usage.facts |= self.number_fact_of_operand(value) | Facts::INT32,
            Use::Updated => usage.facts |= Facts::NUMBER_AT_EVERY_VALUE | Facts::STORED,
            Use::AddedTo(other) => self.add_addition(other, usage),
            Use::ComparedWith(other) => self.add_comparison(other, usage),
            Use::Stored { op, value } => self.add_store(op, value, usage),
        }
    }

    fn number_fact_of_operand(&self, operand: ExprId) -> Facts {
        match is_evaluated_for_some_values_only(self.hir(), self.bound(), operand) {
            true => Facts::NUMBER,
            false => Facts::NUMBER_AT_EVERY_VALUE,
        }
    }

    fn add_arm(&mut self, usage: &mut Usage, ty: TypeId) {
        if let Ok(ty) = self.without_nullish(ty) {
            let holds_nothing = self.c.array_element(ty).is_some_and(TypeId::is_never);
            let ty = match holds_nothing {
                true => self.c.array_of(TypeId::ANY),
                false => ty,
            };
            let says_nothing = self.c.is_any(ty)
                || ty == TypeId::UNKNOWN
                || ty.is_never()
                || ty != TypeId::OBJECT && self.c.is_empty_object_type(ty);
            if !says_nothing {
                usage.add_arm(ty);
            }
        }
    }

    fn is_number_type(&self, ty: TypeId) -> bool {
        self.c.every_type(ty, |c, part| c.is_number_like(part))
    }

    fn is_string_type(&self, ty: TypeId) -> bool {
        self.c.every_type(ty, |c, part| c.is_string_like(part))
    }

    fn is_list(&mut self, object: ExprId) -> bool {
        let Ok(ty) = self.expression_type(object) else {
            return false;
        };
        self.c.every_type(ty, |c, part| {
            c.is_array_or_tuple(part) || c.is_string_like(part)
        })
    }

    fn add_addition(&mut self, other: ExprId, usage: &mut Usage) {
        if let Ok(ty) = self.expression_type(other)
            && self.is_number_type(ty)
        {
            usage.facts |= Facts::NUMBER_AT_EVERY_VALUE;
        }
    }

    fn add_comparison(&mut self, other: ExprId, usage: &mut Usage) {
        let Ok(ty) = self.expression_type(other) else {
            return;
        };
        if self.is_number_type(ty) {
            usage.facts |= Facts::NUMBER_AT_EVERY_VALUE;
        } else if self.is_string_type(ty) {
            usage.facts |= Facts::STRING;
        }
    }

    fn add_store(&mut self, op: Option<BinOp>, value: ExprId, usage: &mut Usage) {
        usage.facts |= Facts::STORED;
        match op {
            None | Some(BinOp::And | BinOp::Or | BinOp::Nullish) => {
                if let Ok(ty) = self.expression_type(value) {
                    let ty = self.c.widened(ty);
                    self.add_arm(usage, ty);
                }
            }
            Some(BinOp::Add) => self.add_addition(value, usage),
            Some(BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Rem | BinOp::Pow) => {
                usage.facts |= Facts::NUMBER_AT_EVERY_VALUE;
            }
            Some(
                BinOp::Shl
                | BinOp::Shr
                | BinOp::UShr
                | BinOp::BitAnd
                | BinOp::BitOr
                | BinOp::BitXor,
            ) => usage.facts |= Facts::NUMBER_AT_EVERY_VALUE | Facts::INT32,
            Some(
                BinOp::Lt
                | BinOp::Le
                | BinOp::Gt
                | BinOp::Ge
                | BinOp::EqEq
                | BinOp::NotEq
                | BinOp::EqEqEq
                | BinOp::NotEqEq
                | BinOp::In
                | BinOp::Instanceof
                | BinOp::Comma,
            ) => {}
        }
    }

    fn add_keyed_access(
        &mut self,
        walk: &mut Walk,
        access: ExprId,
        key: ExprId,
        usage: &mut Usage,
    ) {
        let Ok(key_type) = self.expression_type(key) else {
            return;
        };
        let is_index = self.is_number_type(key_type)
            || self.c.is_any(key_type) && self.is_used_as_number(walk, key);
        if is_index {
            self.add_evidence(walk, access, usage.elements_mut());
        } else if let Some(name) = self.c.property_name_of_type(key_type) {
            self.add_evidence(walk, access, usage.member_mut(name));
        } else {
            usage.facts |= Facts::OBJECT;
        }
    }

    fn is_used_as_number(&mut self, walk: &mut Walk, expression: ExprId) -> bool {
        let Some(subject) = self.find_referenced_subject(expression) else {
            return false;
        };
        let usage = self.usage_of(walk, subject);
        usage.is_some_and(|usage| usage.is_number())
    }

    fn add_uses_of_pattern(&mut self, walk: &mut Walk, pattern: PatId, usage: &mut Usage) {
        if self.c.is_stack_low() || !walk.enter_node() {
            return;
        }
        let hir = self.hir();
        match hir[pattern].kind {
            PatKind::Missing => {}
            PatKind::Ident(_) => self.add_uses_of_name(walk, pattern, usage),
            PatKind::Object(properties) => {
                usage.facts |= Facts::REQUIRED;
                for property in properties.iter().filter(|&property| !hir[property].is_rest) {
                    match hir.runtime_binding_key(property) {
                        PropKey::Name(name) => {
                            let member = usage.member_mut(name);
                            self.add_uses_of_pattern(walk, hir[property].value, member);
                        }
                        PropKey::Computed(_) => usage.facts |= Facts::OBJECT,
                        PropKey::None | PropKey::Private(_) => {}
                    }
                }
            }
            PatKind::Array(elements) => {
                usage.facts |= Facts::REQUIRED;
                let contents = usage.elements_mut();
                for element in elements.iter().filter(|&element| !hir[element].is_rest) {
                    self.add_uses_of_pattern(walk, hir[element].pat, contents);
                }
            }
        }
    }

    fn add_uses_of_name(&mut self, walk: &mut Walk, name: PatId, usage: &mut Usage) {
        let Ok(checked) = self.checked_binding_type(name) else {
            return;
        };
        if !self.c.is_any(checked) {
            self.add_arm(usage, checked);
            return;
        }
        let bound = self.bound();
        let Some(symbol) = find_initialized_symbol(bound, name) else {
            return;
        };
        if bound.stores_to(symbol).is_empty() && bound.symbol(symbol).decls.len() == 1 {
            self.add_uses_of_subject(walk, Subject::Binding(symbol), usage);
        }
    }

    fn checked_binding_type(&mut self, pattern: PatId) -> CheckedType {
        self.ask(|queries| {
            let ty = queries.c.type_of_pat(queries.file, pattern);
            queries.resolved(ty)
        })
    }

    fn add_members_of_assignment_pattern(&self, pattern: ExprId, usage: &mut Usage) {
        let hir = self.hir();
        let ExprKind::Object(properties) = hir[pattern].kind else {
            return;
        };
        usage.facts |= Facts::REQUIRED;
        for property in properties.iter() {
            match hir.runtime_property_key(property) {
                PropKey::Name(name) => {
                    usage.member_mut(name);
                }
                PropKey::Computed(_) => usage.facts |= Facts::OBJECT,
                PropKey::None | PropKey::Private(_) => {}
            }
        }
    }

    fn add_uses_of_argument(
        &mut self,
        walk: &mut Walk,
        call: ExprId,
        index: usize,
        usage: &mut Usage,
    ) {
        let (signature, index) = match self.find_call_with_receiver(call) {
            Some(indirect) if index == 0 => {
                self.add_uses_of_receiver(walk, indirect.signature, usage);
                return;
            }
            Some(indirect) if indirect.takes_argument_list => return,
            Some(indirect) => (indirect.signature, index - 1),
            None => match self.resolved_call(call) {
                Ok(Some(target)) => (target.signature, index),
                Ok(None) | Err(_) => return,
            },
        };
        let parameters = self.c.sig_params(signature);
        let Some(parameter) = find_parameter(&parameters, index) else {
            return;
        };
        let subject = parameter
            .declaration
            .and_then(|(of, declared)| self.find_parameter_subject(of, declared, parameter.ty));
        let Some(subject) = subject else {
            self.add_arm(usage, parameter.ty);
            return;
        };
        let number_facts = Facts::NUMBER | Facts::INT32;
        let known_here = usage.facts & number_facts;
        self.add_uses_of_subject(walk, subject, usage);
        if !usage.facts.contains(Facts::NUMBER_AT_EVERY_VALUE) {
            usage.facts = (usage.facts - number_facts) | known_here;
        }
    }

    fn add_uses_of_receiver(&mut self, walk: &mut Walk, signature: SigId, usage: &mut Usage) {
        let declaration = self.c.sig_decl(signature);
        let subject =
            declaration.and_then(|(of, function, _)| self.find_this_subject(of, function));
        if let Some(subject) = subject {
            self.add_uses_of_subject(walk, subject, usage);
        }
    }

    fn find_call_with_receiver(&mut self, call: ExprId) -> Option<CallWithReceiver> {
        let hir = self.hir();
        let ExprKind::Call(site) = hir[call].kind else {
            return None;
        };
        let (function, MemberKey::Name(name)) = hir.member_key(hir[site].callee)? else {
            return None;
        };
        let function_type = self.expression_type(function).ok()?;
        let &[signature] = &self.c.signatures(function_type, false)[..] else {
            return None;
        };
        let (method, _) = self.c.get_property_of_type(function_type, name)?;
        let forms = [(known::call, false), (known::apply, true)];
        let (_, takes_argument_list) = forms
            .into_iter()
            .find(|&(form, _)| self.is_function_method(method, form))?;
        Some(CallWithReceiver {
            signature,
            takes_argument_list,
        })
    }

    fn is_function_method(&mut self, method: &'p Prop<'p>, name: Atom) -> bool {
        [known::CallableFunction, known::Function]
            .into_iter()
            .any(|interface| {
                let functions = self.c.global_ref(interface, &[]);
                let declared = self.c.get_property_of_type(functions, name);
                declared.is_some_and(|(declared, _)| declared.source == method.source)
            })
    }

    fn type_of_usage(&mut self, usage: &Usage) -> TypeId {
        if self.c.is_stack_low() {
            return TypeId::ANY;
        }
        let mut parts = TypeParts::from_slice(&usage.arms);
        if usage.facts.contains(Facts::NUMBER) {
            parts.push(self.number_type(usage.facts));
        }
        if usage.facts.contains(Facts::STRING) {
            parts.push(TypeId::STRING);
        }
        if usage.facts.contains(Facts::FUNCTION) {
            parts.push(self.c.global_ref(known::Function, &[]));
        } else if !usage.facts.contains(Facts::INCOMPLETE) {
            self.add_object_parts(usage, &mut parts);
        }
        match parts[..] {
            [] => TypeId::ANY,
            [only] => only,
            _ => self.c.union(&parts),
        }
    }

    fn number_type(&mut self, facts: Facts) -> TypeId {
        let int32 = self.c.p.aot_symbols().int32_alias();
        match int32 {
            Some(int32) if facts.intersects(Facts::INT32 | Facts::KEY) => {
                self.c.declared_type(int32)
            }
            Some(_) | None => TypeId::NUMBER,
        }
    }

    fn add_object_parts(&mut self, usage: &Usage, parts: &mut TypeParts) {
        let elements = usage.elements.as_deref();
        if usage.facts.contains(Facts::OBJECT) && elements.is_none() {
            parts.push(TypeId::OBJECT);
            return;
        }
        if usage.members.is_empty() && elements.is_none() {
            return;
        }
        let element_type = match elements {
            Some(elements) => self.type_of_usage(elements),
            None => TypeId::ANY,
        };
        let array = self.c.array_of(element_type);
        let can_be_array = self.has_every_member(array, &usage.members);
        let can_be_string = !usage.has_stored_part()
            && (element_type == TypeId::ANY || element_type == TypeId::STRING)
            && self.has_every_member(TypeId::STRING, &usage.members);
        let any_array = self.c.array_of(TypeId::ANY);
        if can_be_array && let Some(at) = parts.iter().position(|&part| part == any_array) {
            parts[at] = array;
            return;
        }
        let mut fitting = TypeParts::new();
        for (fits, candidate) in [(can_be_array, array), (can_be_string, TypeId::STRING)] {
            if fits && elements.is_some() {
                fitting.push(candidate);
            }
        }
        let is_decided = parts
            .iter()
            .any(|&part| fitting.contains(&part) || self.c.is_array(part));
        let function = self.c.global_ref(known::Function, &[]);
        let can_be_function = usage.members.iter().any(Member::is_called)
            && self.has_every_member(function, &usage.members);
        let can_be_builtin = can_be_array || can_be_string || can_be_function;
        match fitting[..] {
            [] if can_be_builtin => {}
            [] => {
                let known_parts = parts.clone();
                let mut known_parts = known_parts.into_iter();
                if !known_parts.any(|part| self.has_every_member(part, &usage.members)) {
                    parts.push(self.object_type_of(&usage.members));
                }
            }
            [only] => parts.push(only),
            _ if is_decided => {}
            _ => parts.extend_from_slice(&fitting),
        }
    }

    fn has_every_member(&mut self, receiver: TypeId, members: &[Member]) -> bool {
        members.iter().all(|member| {
            let found = self.c.get_property_of_type(receiver, member.name);
            found.is_some_and(|(property, _)| {
                property.flags.contains(PropFlags::METHOD) == member.is_called()
            })
        })
    }

    fn object_type_of(&mut self, members: &[Member]) -> TypeId {
        let mut props = Vec::with_capacity(members.len());
        for member in members {
            let mut flags = match member.usage.facts.contains(Facts::REQUIRED) {
                true => PropFlags::empty(),
                false => PropFlags::OPTIONAL,
            };
            if member.is_called() {
                flags |= PropFlags::METHOD;
            }
            props.push(Prop {
                name: member.name,
                flags,
                source: PropSource::Type(self.type_of_usage(&member.usage)),
                mapper: MapperId::IDENTITY,
                name_type: TypeId::UNRESOLVED,
            });
        }
        let atoms = self.c.atoms();
        props.sort_unstable_by(|a, b| atoms.bytes(a.name).cmp(atoms.bytes(b.name)));
        let arena = self.c.arena;
        self.c.synth(Shape {
            props: vec_from_iter_in(props, arena),
            ..Shape::new_in(arena)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(usage: &Usage) -> Vec<Atom> {
        usage.members.iter().map(|member| member.name).collect()
    }

    #[test]
    fn references_to_one_subject_are_found_together() {
        let references = [
            (SymbolId(1), ExprId(4)),
            (SymbolId(3), ExprId(2)),
            (SymbolId(3), ExprId(9)),
            (SymbolId(7), ExprId(1)),
        ];
        assert_eq!(references_to(&references, SymbolId(3)), &references[1..3]);
        assert!(references_to(&references, SymbolId(2)).is_empty());
        assert!(references_to(&references, SymbolId(8)).is_empty());
    }

    #[test]
    fn only_a_subject_that_started_earlier_taints() {
        let mut subjects = SubjectStack::default();
        let outer = subjects.enter();
        let inner = subjects.enter();
        subjects.revisit(inner.depth);
        assert!(!subjects.leave(inner));
        let inner = subjects.enter();
        let innermost = subjects.enter();
        subjects.revisit(outer.depth);
        assert!(subjects.leave(innermost));
        assert!(subjects.leave(inner));
        assert!(!subjects.leave(outer));
        assert_eq!(subjects.depth, 0);
    }

    #[test]
    fn a_later_subject_does_not_inherit_an_earlier_revisit() {
        let mut subjects = SubjectStack::default();
        let outer = subjects.enter();
        let middle = subjects.enter();
        subjects.revisit(outer.depth);
        let clean = subjects.enter();
        assert!(!subjects.leave(clean));
        assert!(subjects.leave(middle));
        assert!(!subjects.leave(outer));
    }

    #[test]
    fn walk_ends_with_its_budget() {
        let mut walk = Walk::new(2);
        assert!(walk.enter_node());
        assert!(!walk.is_out_of_budget());
        assert!(walk.enter_node());
        assert!(walk.is_out_of_budget());
        assert!(!walk.enter_node());
    }

    #[test]
    fn merge_keeps_the_order_of_first_use() {
        let mut usage = Usage::default();
        usage.member_mut(known::length).facts |= Facts::NUMBER;
        let mut other = Usage::default();
        other.member_mut(known::call).facts |= Facts::FUNCTION;
        other.member_mut(known::length).facts |= Facts::REQUIRED;
        other.elements_mut().add_arm(TypeId::STRING);
        usage.merge(&mut Walk::new(16), &other);
        assert_eq!(names(&usage), [known::length, known::call]);
        assert_eq!(
            usage.members[0].usage.facts,
            Facts::NUMBER | Facts::REQUIRED
        );
        assert_eq!(usage.elements_mut().arms[..], [TypeId::STRING]);
    }

    #[test]
    fn merge_stops_without_budget() {
        let mut other = Usage::default();
        other.member_mut(known::length);
        other.member_mut(known::call);
        let mut usage = Usage::default();
        usage.merge(&mut Walk::new(2), &other);
        assert_eq!(names(&usage), [known::length, known::call]);
        assert!(usage.members[1].usage.facts.is_empty());
        let mut walk = Walk::new(0);
        let mut untouched = Usage::default();
        untouched.merge(&mut walk, &other);
        assert!(untouched.members.is_empty());
    }

    #[test]
    fn only_the_right_side_of_in_and_of_a_comma_says_something() {
        let (whole, other) = (ExprId(1), ExprId(2));
        let find = |op, side| find_use_as_binary_operand(op, whole, side, other);
        assert!(matches!(find(BinOp::In, Side::Left), Use::Nothing));
        assert!(matches!(
            find(BinOp::In, Side::Right),
            Use::Object { is_required: true }
        ));
        assert!(matches!(find(BinOp::Comma, Side::Left), Use::Nothing));
        assert!(matches!(
            find(BinOp::Comma, Side::Right),
            Use::PassedOn(ExprId(1))
        ));
    }

    #[test]
    fn int32_values_are_whole_and_in_range() {
        for value in [0.0, -1.0, 7.0, 2147483647.0, -2147483648.0] {
            assert!(is_int32_value(value), "{value}");
        }
        for value in [
            0.5,
            -0.0,
            2147483648.0,
            -2147483649.0,
            f64::NAN,
            f64::INFINITY,
        ] {
            assert!(!is_int32_value(value), "{value}");
        }
    }

    #[test]
    fn an_unsigned_shift_and_a_sum_may_leave_int32() {
        for op in [
            BinOp::Shl,
            BinOp::Shr,
            BinOp::BitAnd,
            BinOp::BitOr,
            BinOp::BitXor,
        ] {
            assert!(yields_int32(op), "{op:?}");
        }
        for op in [BinOp::UShr, BinOp::Add, BinOp::Sub, BinOp::Mul, BinOp::Rem] {
            assert!(!yields_int32(op), "{op:?}");
        }
    }

    #[test]
    fn a_stored_part_is_an_element_or_a_member() {
        let mut usage = Usage::default();
        usage.member_mut(known::length);
        assert!(!usage.has_stored_part());
        usage.facts |= Facts::STORED;
        assert!(!usage.has_stored_part());
        usage.elements_mut().facts |= Facts::STORED;
        assert!(usage.has_stored_part());
    }
}
