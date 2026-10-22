use super::{Form, Label, Literal, MAX_NAMES, Marks, NodeShape, NodeTag, Operator, Subtree};
use crate::atom::Atom;
use crate::hir::{
    Branches, Call, CallId, Case, CaseId, Chain, Class, ClassId, Export, ExportId, ExportSpec,
    ExportSpecId, Expr, ExprFlags, ExprId, ExprKind, ExprTag, File, Flags, FnBody, FnId, Func,
    IdList, Import, ImportId, ImportSpec, ImportSpecId, Member, MemberId, Param, ParamId, Pat,
    PatElem, PatElemId, PatId, PatKind, PatProp, PatPropId, Prop, PropId, PropKey, Stmt, StmtId,
    StmtKind, VarDecl, VarDeclId, has_runtime_member,
};
use std::mem::discriminant;

const VARIABLE_FLAGS: Flags = Flags::EXPORT.union(Flags::AMBIENT);
const FUNCTION_FLAGS: Flags = Flags::ASYNC
    .union(Flags::GENERATOR)
    .union(Flags::STATIC)
    .union(Flags::EXPORT)
    .union(Flags::DEFAULT)
    .union(Flags::AMBIENT);
const CLASS_FLAGS: Flags = Flags::EXPORT.union(Flags::DEFAULT).union(Flags::AMBIENT);
const MEMBER_FLAGS: Flags = Flags::STATIC
    .union(Flags::LITERAL_NAME)
    .union(Flags::STRING_NAME)
    .union(Flags::COMPUTED_NAME)
    .union(Flags::AMBIENT)
    .union(Flags::ABSTRACT);

#[derive(Copy, Clone, PartialEq, Eq)]
enum Position {
    Value,
    AssignmentTarget,
}

impl Position {
    fn expr(self, e: ExprId) -> Subtree {
        match self {
            Position::Value => Subtree::Expr(e),
            Position::AssignmentTarget => Subtree::AssignmentTarget(e),
        }
    }

    fn prop(self, prop: PropId) -> Subtree {
        match self {
            Position::Value => Subtree::Prop(prop),
            Position::AssignmentTarget => Subtree::AssignmentProperty(prop),
        }
    }
}

struct Draft<'a, 'c> {
    label: Label<'a>,
    children: &'c mut Vec<Subtree>,
}

macro_rules! define_label_setters {
    ($($setter:ident $field:ident: $ty:ty;)*) => {$(
        fn $setter(mut self, $field: $ty) -> Self {
            self.label.$field = $field;
            self
        }
    )*};
}

impl<'a> Draft<'a, '_> {
    define_label_setters! {
        with_literal literal: Literal<'a>;
        with_operator operator: Operator;
        with_flags flags: Flags;
        with_chain chain: Chain;
        with_form form: Form;
    }

    fn with_names<const N: usize>(mut self, names: [Atom; N]) -> Self {
        self.label.names[..N].copy_from_slice(&names);
        self
    }

    fn with_mark(mut self, mark: Marks, is_set: bool) -> Self {
        self.label.marks.set(mark, is_set);
        self
    }

    fn with_key(mut self, key: PropKey) -> Self {
        self.label.key_kind = Some(discriminant(&key));
        match key {
            PropKey::None => self,
            PropKey::Name(name) | PropKey::Private(name) => self.with_names([name]),
            PropKey::Computed(e) => self.with_exprs([e]),
        }
    }

    fn with_call(self, file: &File<'_>, call: CallId) -> Self {
        let Call {
            callee,
            args,
            type_args: _,
            close_pos: _,
            chain,
            is_pure,
        } = file[call];
        let template = file.template_of(call);
        let args = if template.is_none() {
            args
        } else {
            IdList::EMPTY
        };
        self.with_chain(chain)
            .with_mark(Marks::PURE, is_pure)
            .with_exprs([callee, template])
            .with_exprs(file.ids(args))
    }

    fn with_children(self, children: impl IntoIterator<Item = Subtree>) -> Self {
        self.children.extend(children);
        self
    }

    fn with_exprs(self, exprs: impl IntoIterator<Item = ExprId>) -> Self {
        self.with_children(exprs.into_iter().map(Subtree::Expr))
    }

    fn finish(self) -> NodeShape<'a> {
        NodeShape::Comparable(self.label)
    }
}

fn stmt_kind(file: &File<'_>, stmt: StmtId) -> Option<StmtKind> {
    let Stmt {
        kind,
        start: _,
        loc: _,
    } = *file.stmts.get(stmt.idx())?;
    Some(kind)
}

fn expr_kind(file: &File<'_>, e: ExprId) -> Option<ExprKind> {
    let Expr {
        kind,
        pos: _,
        end: _,
    } = *file.exprs.get(e.idx())?;
    Some(kind)
}

fn pattern_kind(file: &File<'_>, pattern: PatId) -> Option<PatKind> {
    let Pat {
        kind,
        pos: _,
        end: _,
    } = *file.pats.get(pattern.idx())?;
    Some(kind)
}

fn is_erased_member(file: &File<'_>, member: MemberId) -> bool {
    !has_runtime_member(file, member)
}

fn loop_head(file: &File<'_>, left: StmtId) -> Subtree {
    let Some(kind) = stmt_kind(file, left) else {
        return Subtree::Stmt(left);
    };
    match kind {
        StmtKind::Expr(target) => Subtree::AssignmentTarget(target),
        StmtKind::Empty
        | StmtKind::Debugger
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
        | StmtKind::ForIn { .. }
        | StmtKind::ForOf { .. }
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
        | StmtKind::Directive { .. } => Subtree::Stmt(left),
    }
}

fn is_deferred_import(file: &File<'_>, args: IdList<ExprId>) -> bool {
    let deferred = &file.deferred_import_calls;
    !deferred.is_empty()
        && !args.is_empty()
        && deferred.iter().any(|call| call.0 == file.id_at(args, 0))
}

fn string_literal<'a>(file: &'a File<'_>, e: ExprId, text: Atom) -> Literal<'a> {
    Literal::String(text, file.template_parts(e))
}

fn template_literal<'a>(file: &'a File<'_>, e: ExprId, exprs: IdList<ExprId>) -> Literal<'a> {
    let texts = &file.ids[file.template_texts(exprs).range()];
    Literal::Template(texts, file.template_parts(e))
}

pub(super) struct Side<'a, 's> {
    pub(super) file: &'a File<'s>,
    erases_types: bool,
    pub(super) children: Vec<Subtree>,
}

impl<'a, 's> Side<'a, 's> {
    pub(super) fn new(file: &'a File<'s>, erases_types: bool) -> Side<'a, 's> {
        Side {
            file,
            erases_types,
            children: Vec::new(),
        }
    }

    fn draft(&mut self, tag: NodeTag) -> Draft<'a, '_> {
        let label = Label {
            tag,
            key_kind: None,
            names: [Atom::NONE; MAX_NAMES],
            literal: Literal::None,
            operator: Operator::None,
            flags: Flags::empty(),
            expr_flags: ExprFlags::empty(),
            chain: Chain::No,
            marks: Marks::empty(),
            form: Form::None,
        };
        Draft {
            label,
            children: &mut self.children,
        }
    }

    pub(super) fn describe(&mut self, node: Subtree) -> NodeShape<'a> {
        self.children.clear();
        match node {
            Subtree::Statements(statements) => self.describe_statements(statements),
            Subtree::Stmt(stmt) => self.describe_stmt(stmt),
            Subtree::Expr(e) => self.describe_expr(e, Position::Value),
            Subtree::AssignmentTarget(e) => self.describe_expr(e, Position::AssignmentTarget),
            Subtree::Pattern(pattern) => self.describe_pattern(pattern),
            Subtree::Function(function) => self.describe_function(function),
            Subtree::Class(class) => self.describe_class(class),
            Subtree::Prop(prop) => self.describe_prop(prop, Position::Value),
            Subtree::AssignmentProperty(prop) => {
                self.describe_prop(prop, Position::AssignmentTarget)
            }
            Subtree::PatProp(prop) => self.describe_pattern_prop(prop),
            Subtree::PatElem(element) => self.describe_pattern_element(element),
            Subtree::VarDecl(declaration) => self.describe_var_decl(declaration),
            Subtree::Case(case) => self.describe_case(case),
            Subtree::Param(param) => self.describe_param(param),
            Subtree::Member(member) => self.describe_member(member),
            Subtree::Import(import) => self.describe_import(import),
            Subtree::ImportSpec(spec) => self.describe_import_spec(spec),
            Subtree::Export(export) => self.describe_export(export),
            Subtree::ExportSpec(spec) => self.describe_export_spec(spec),
        }
    }

    fn describe_statements(&mut self, statements: IdList<StmtId>) -> NodeShape<'a> {
        let (file, erases_types) = (self.file, self.erases_types);
        let is_erased = |stmt: StmtId| erases_types && file.is_erased_statement(stmt);
        let runtime_statements = file.ids(statements).filter(|&stmt| !is_erased(stmt));
        self.draft(NodeTag::None)
            .with_children(runtime_statements.map(Subtree::Stmt))
            .finish()
    }

    fn describe_stmt(&mut self, stmt: StmtId) -> NodeShape<'a> {
        use Subtree::{Expr, Stmt, VarDecl};
        let file = self.file;
        let Some(kind) = stmt_kind(file, stmt) else {
            return NodeShape::Absent;
        };
        let draft = self.draft(NodeTag::Stmt(discriminant(&kind)));
        let draft = match kind {
            StmtKind::Empty | StmtKind::Debugger => draft,
            StmtKind::Expr(e)
            | StmtKind::Return(e)
            | StmtKind::Throw(e)
            | StmtKind::ExportDefault(e) => draft.with_exprs([e]),
            StmtKind::Var(declarations) => draft.with_children(declarations.iter().map(VarDecl)),
            StmtKind::Fn(function) => draft.with_children([Subtree::Function(function)]),
            StmtKind::Class(class) => draft.with_children([Subtree::Class(class)]),
            StmtKind::Interface(_) | StmtKind::TypeAlias(_) | StmtKind::ExportAsNamespace(_) => {
                return NodeShape::NotComparable;
            }
            StmtKind::Enum(_)
            | StmtKind::Module(_)
            | StmtKind::ImportEquals(_)
            | StmtKind::ExportAssign(_) => return NodeShape::EmitsCode,
            StmtKind::If { test, yes, no } => {
                draft.with_children([Expr(test), Stmt(yes), Stmt(no)])
            }
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => draft.with_children([Stmt(init), Expr(test), Expr(update), Stmt(body)]),
            StmtKind::ForIn { left, expr, body } => {
                draft.with_children([loop_head(file, left), Expr(expr), Stmt(body)])
            }
            StmtKind::ForOf {
                left,
                expr,
                body,
                is_await,
            } => draft
                .with_mark(Marks::FOR_AWAIT, is_await)
                .with_children([loop_head(file, left), Expr(expr), Stmt(body)]),
            StmtKind::While { test, body } | StmtKind::With { object: test, body } => {
                draft.with_children([Expr(test), Stmt(body)])
            }
            StmtKind::DoWhile { body, test } => draft.with_children([Stmt(body), Expr(test)]),
            StmtKind::Block(statements) => draft.with_children([Subtree::Statements(statements)]),
            StmtKind::Switch { expr, cases } => draft
                .with_exprs([expr])
                .with_children(cases.iter().map(Subtree::Case)),
            StmtKind::Try {
                block,
                param,
                handler,
                finalizer,
            } => draft.with_children([Stmt(block), VarDecl(param), Stmt(handler), Stmt(finalizer)]),
            StmtKind::Break(label) | StmtKind::Continue(label) => draft.with_names([label]),
            StmtKind::Labeled { label, body } => {
                draft.with_names([label]).with_children([Stmt(body)])
            }
            StmtKind::Import(import) => draft.with_children([Subtree::Import(import)]),
            StmtKind::ExportNamed(export) => draft.with_children([Subtree::Export(export)]),
            StmtKind::ExportStar {
                spec,
                alias,
                type_only,
                mode: _,
                star_pos: _,
                alias_pos: _,
            } => draft
                .with_names([spec, alias])
                .with_mark(Marks::TYPE_ONLY, type_only)
                .with_exprs([file.statement_import_attributes(stmt)]),
            StmtKind::Directive { expr, raw } => {
                draft.with_literal(Literal::Text(raw)).with_exprs([expr])
            }
        };
        draft.finish()
    }

    fn describe_expr(&mut self, written: ExprId, position: Position) -> NodeShape<'a> {
        let mut e = written;
        let mut parentheses = ExprFlags::empty();
        loop {
            parentheses |= self.file.expr_flags(e) & ExprFlags::PARENTHESIZED;
            let is_bare = e == written && parentheses.is_empty();
            let operand_position = if is_bare { position } else { Position::Value };
            let mut label = match self.describe_written_expr(e, operand_position) {
                NodeShape::TypeAssertion(operand) if self.erases_types => {
                    e = operand;
                    continue;
                }
                NodeShape::TypeAssertion(_) => return NodeShape::NotComparable,
                NodeShape::Comparable(label) => label,
                shape @ (NodeShape::Absent | NodeShape::NotComparable | NodeShape::EmitsCode) => {
                    return shape;
                }
            };
            let is_member = matches!(label.tag, NodeTag::Expr(ExprTag::Dot | ExprTag::Index));
            let is_read_as_written = position == Position::AssignmentTarget && !is_member;
            let written_flags = self.file.expr_flags(written);
            let is_parenthesized = written_flags.contains(ExprFlags::PARENTHESIZED);
            if is_read_as_written && e != written && !is_parenthesized {
                return NodeShape::NotComparable;
            }
            label.expr_flags = if is_read_as_written || label.chain != Chain::No {
                self.file.expr_flags(e) | parentheses
            } else {
                self.file.expr_flags(e) - ExprFlags::PARENTHESIZED
            };
            return NodeShape::Comparable(label);
        }
    }

    fn describe_written_expr(&mut self, e: ExprId, operand_position: Position) -> NodeShape<'a> {
        let file = self.file;
        let Some(kind) = expr_kind(file, e) else {
            return NodeShape::Absent;
        };
        let draft = self.draft(NodeTag::Expr(kind.tag()));
        let draft = match kind {
            ExprKind::Missing
            | ExprKind::This
            | ExprKind::Super
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::ImportMeta => draft,
            ExprKind::Ident(name)
            | ExprKind::PrivateIdentifier(name)
            | ExprKind::NewTarget(name) => draft.with_names([name]),
            ExprKind::Number(index) => {
                draft.with_literal(Literal::Number(file.numbers[index as usize].to_bits()))
            }
            ExprKind::String(text) => draft.with_literal(string_literal(file, e, text)),
            ExprKind::BigInt(text) => draft.with_literal(Literal::Text(text)),
            ExprKind::Regex { pattern, flags } => {
                draft.with_literal(Literal::Regex(pattern, flags))
            }
            ExprKind::Template { exprs } => draft
                .with_literal(template_literal(file, e, exprs))
                .with_exprs(file.ids(exprs)),
            ExprKind::TaggedTemplate(call) | ExprKind::Call(call) | ExprKind::New(call) => {
                draft.with_call(file, call)
            }
            ExprKind::Array(elements) => {
                draft.with_children(file.ids(elements).map(|it| operand_position.expr(it)))
            }
            ExprKind::Object(props) => {
                draft.with_children(props.iter().map(|it| operand_position.prop(it)))
            }
            ExprKind::Fn(function) => draft.with_children([Subtree::Function(function)]),
            ExprKind::Class(class) => draft.with_children([Subtree::Class(class)]),
            ExprKind::Dot {
                obj,
                name,
                chain,
                name_before_end: _,
            } => draft.with_names([name]).with_chain(chain).with_exprs([obj]),
            ExprKind::Index { obj, index, chain } => {
                draft.with_chain(chain).with_exprs([obj, index])
            }
            ExprKind::Unary { op, operand } => draft
                .with_operator(Operator::Unary(op))
                .with_exprs([operand]),
            ExprKind::Binary { op, left, right } => draft
                .with_operator(Operator::Binary(op))
                .with_exprs([left, right]),
            ExprKind::Assign { op, target, value } => draft
                .with_operator(Operator::Assign(op))
                .with_children([Subtree::AssignmentTarget(target), Subtree::Expr(value)]),
            ExprKind::Cond { test, branches } => {
                let Branches { yes, no } = file.branches(branches);
                draft.with_exprs([test, yes, no])
            }
            ExprKind::Spread(operand) => draft.with_children([operand_position.expr(operand)]),
            ExprKind::Await(operand) => draft.with_exprs([operand]),
            ExprKind::Yield { value, star } => {
                draft.with_mark(Marks::YIELD_STAR, star).with_exprs([value])
            }
            ExprKind::As { expr, ty: _ }
            | ExprKind::Satisfies { expr, ty: _ }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr)
            | ExprKind::Instantiation { expr, type_args: _ } => {
                return NodeShape::TypeAssertion(expr);
            }
            ExprKind::Jsx(_) | ExprKind::JsxText(_) => return NodeShape::EmitsCode,
            ExprKind::ImportCall { args } => draft
                .with_mark(Marks::DEFERRED, is_deferred_import(file, args))
                .with_exprs(file.ids(args)),
        };
        draft.finish()
    }

    fn describe_pattern(&mut self, pattern: PatId) -> NodeShape<'a> {
        let Some(kind) = pattern_kind(self.file, pattern) else {
            return NodeShape::Absent;
        };
        let draft = self.draft(NodeTag::Pattern(kind.tag()));
        let draft = match kind {
            PatKind::Missing => draft,
            PatKind::Ident(name) => draft.with_names([name]),
            PatKind::Object(props) => draft.with_children(props.iter().map(Subtree::PatProp)),
            PatKind::Array(elements) => draft.with_children(elements.iter().map(Subtree::PatElem)),
        };
        draft.finish()
    }

    fn describe_function(&mut self, function: FnId) -> NodeShape<'a> {
        let Some(&function) = self.file.fns.get(function.idx()) else {
            return NodeShape::Absent;
        };
        let Func {
            kind,
            flags,
            name,
            name_pos: _,
            type_params: _,
            params,
            this_param: _,
            ret: _,
            body,
            anchor: _,
            start: _,
            text_start: _,
            is_strict: _,
            is_strict_by_syntax: _,
        } = function;
        let body = match body {
            FnBody::None => None,
            FnBody::Block(statements) => Some(Subtree::Statements(statements)),
            FnBody::Expr(e) => Some(Subtree::Expr(e)),
        };
        self.draft(NodeTag::Function(kind))
            .with_flags(flags & FUNCTION_FLAGS)
            .with_names([name])
            .with_children(params.iter().map(Subtree::Param))
            .with_children(body)
            .finish()
    }

    fn describe_class(&mut self, class: ClassId) -> NodeShape<'a> {
        let (file, erases_types) = (self.file, self.erases_types);
        let Class {
            name,
            name_pos: _,
            flags,
            type_params: _,
            extends,
            extends_args: _,
            other_extends,
            implements: _,
            other_implements: _,
            members,
            start: _,
            text_start: _,
            modifiers: _,
        } = file[class];
        if !other_extends.is_empty() {
            return NodeShape::NotComparable;
        }
        let is_erased = |member: MemberId| erases_types && is_erased_member(file, member);
        let runtime_members = members.iter().filter(|&member| !is_erased(member));
        self.draft(NodeTag::None)
            .with_flags(flags & CLASS_FLAGS)
            .with_names([name])
            .with_exprs([extends])
            .with_children(runtime_members.map(Subtree::Member))
            .finish()
    }

    fn describe_member(&mut self, member: MemberId) -> NodeShape<'a> {
        let file = self.file;
        let Member {
            kind,
            key,
            flags,
            ty: _,
            init,
            func,
            name_pos: _,
            start: _,
            loc: _,
            modifiers: _,
        } = file[member];
        if flags.contains(Flags::ACCESSOR) {
            return NodeShape::EmitsCode;
        }
        self.draft(NodeTag::Member(kind))
            .with_flags(flags & MEMBER_FLAGS)
            .with_form(Form::WrittenKey(discriminant(&key)))
            .with_key(file.runtime_member_key(member))
            .with_children([Subtree::Expr(init), Subtree::Function(func)])
            .finish()
    }

    fn describe_param(&mut self, param: ParamId) -> NodeShape<'a> {
        let Param {
            pat,
            ty: _,
            default,
            flags,
            pos: _,
            loc: _,
        } = self.file[param];
        if flags.contains(Flags::PARAMETER_PROPERTY) {
            return NodeShape::EmitsCode;
        }
        self.draft(NodeTag::None)
            .with_mark(Marks::REST, flags.contains(Flags::REST))
            .with_children([Subtree::Pattern(pat), Subtree::Expr(default)])
            .finish()
    }

    fn describe_prop(&mut self, prop: PropId, position: Position) -> NodeShape<'a> {
        let file = self.file;
        let Prop {
            kind,
            key: _,
            name_kind,
            value,
            pos: _,
            start: _,
            end: _,
            postfix_token: _,
        } = file[prop];
        self.draft(NodeTag::Prop(kind))
            .with_form(Form::Name(name_kind))
            .with_key(file.runtime_property_key(prop))
            .with_children([position.expr(value)])
            .finish()
    }

    fn describe_pattern_prop(&mut self, prop: PatPropId) -> NodeShape<'a> {
        let file = self.file;
        let PatProp {
            key: _,
            name_kind,
            value,
            default,
            is_rest,
            pos: _,
            key_pos: _,
            end: _,
        } = file[prop];
        self.draft(NodeTag::None)
            .with_form(Form::Name(name_kind))
            .with_mark(Marks::REST, is_rest)
            .with_key(file.runtime_binding_key(prop))
            .with_children([Subtree::Pattern(value), Subtree::Expr(default)])
            .finish()
    }

    fn describe_pattern_element(&mut self, element: PatElemId) -> NodeShape<'a> {
        let PatElem {
            pat,
            default,
            is_rest,
            start: _,
            end: _,
        } = self.file[element];
        self.draft(NodeTag::None)
            .with_mark(Marks::REST, is_rest)
            .with_children([Subtree::Pattern(pat), Subtree::Expr(default)])
            .finish()
    }

    fn describe_var_decl(&mut self, declaration: VarDeclId) -> NodeShape<'a> {
        let Some(&declaration) = self.file.var_decls.get(declaration.idx()) else {
            return NodeShape::Absent;
        };
        let VarDecl {
            pat,
            ty: _,
            init,
            kind,
            flags,
            loc: _,
        } = declaration;
        self.draft(NodeTag::None)
            .with_form(Form::Variable(kind))
            .with_flags(flags & VARIABLE_FLAGS)
            .with_children([Subtree::Pattern(pat), Subtree::Expr(init)])
            .finish()
    }

    fn describe_case(&mut self, case: CaseId) -> NodeShape<'a> {
        let Case {
            test,
            body,
            pos: _,
            end: _,
        } = self.file[case];
        self.draft(NodeTag::None)
            .with_children([Subtree::Expr(test), Subtree::Statements(body)])
            .finish()
    }

    fn describe_import(&mut self, import: ImportId) -> NodeShape<'a> {
        let (file, erases_types) = (self.file, self.erases_types);
        let Import {
            spec,
            default,
            default_pos: _,
            namespace,
            namespace_pos: _,
            clause_start: _,
            clause_end: _,
            namespace_start: _,
            named,
            has_named_imports,
            type_only,
            is_deferred,
            mode: _,
            stmt: _,
            attributes,
        } = file[import];
        let is_erased = |item: ImportSpecId| erases_types && file[item].type_only;
        let runtime_specs = named.iter().filter(|&item| !is_erased(item));
        self.draft(NodeTag::None)
            .with_names([spec, default, namespace])
            .with_mark(Marks::TYPE_ONLY, type_only)
            .with_mark(Marks::DEFERRED, is_deferred)
            .with_mark(Marks::NAMED_IMPORTS, has_named_imports)
            .with_children(runtime_specs.map(Subtree::ImportSpec))
            .with_exprs([attributes])
            .finish()
    }

    fn describe_import_spec(&mut self, spec: ImportSpecId) -> NodeShape<'a> {
        let ImportSpec {
            start: _,
            imported,
            local,
            pos: _,
            type_only,
            imported_pos: _,
            end: _,
            import: _,
        } = self.file[spec];
        self.describe_specifier([imported, local], type_only)
    }

    fn describe_export(&mut self, export: ExportId) -> NodeShape<'a> {
        let (file, erases_types) = (self.file, self.erases_types);
        let Export {
            spec,
            has_module_specifier,
            items,
            type_only,
            mode: _,
            stmt: _,
            attributes,
        } = file[export];
        let is_erased = |item: ExportSpecId| erases_types && file[item].type_only;
        let runtime_specs = items.iter().filter(|&item| !is_erased(item));
        self.draft(NodeTag::None)
            .with_names([spec])
            .with_mark(Marks::TYPE_ONLY, type_only)
            .with_mark(Marks::MODULE_SPECIFIER, has_module_specifier)
            .with_children(runtime_specs.map(Subtree::ExportSpec))
            .with_exprs([attributes])
            .finish()
    }

    fn describe_export_spec(&mut self, spec: ExportSpecId) -> NodeShape<'a> {
        let ExportSpec {
            start: _,
            local,
            exported,
            pos: _,
            type_only,
            local_pos: _,
            end: _,
            export: _,
        } = self.file[spec];
        self.describe_specifier([local, exported], type_only)
    }

    fn describe_specifier(&mut self, names: [Atom; 2], type_only: bool) -> NodeShape<'a> {
        self.draft(NodeTag::None)
            .with_names(names)
            .with_mark(Marks::TYPE_ONLY, type_only)
            .finish()
    }
}
