//! The way down: the children of a node, and a walk over a whole file in source order.

use super::{
    ExprKind, File, FnBody, Key, KeyKind, Modifier, Node, PatKind, StmtKind, TypeKind,
};

impl<'a> Node<'a> {
    /// Calls `visit` with each child, in source order.
    ///
    /// A [`Func`](super::Func) is the only child of the expression or the statement that owns it,
    /// and a [`Class`](super::Class) likewise. Left out are holes in arrays and array patterns, the
    /// empty `{}` of JSX, and the statements that are [wrappers](super::Stmt::is_wrapper): what they
    /// wrap takes their place. Of `with { key: "value" }` only the values are nodes.
    pub fn for_each_child(self, mut visit: impl FnMut(Node<'a>)) {
        self.children_into(&mut visit);
    }

    /// The children, in source order.
    pub fn children(self) -> Vec<Node<'a>> {
        let mut children = Vec::new();
        self.children_into(&mut |child| children.push(child));
        children
    }

    fn children_into<V: FnMut(Node<'a>)>(self, visit: &mut V) {
        macro_rules! one {
            ($it:expr) => {
                visit($it.into())
            };
        }
        macro_rules! opt {
            ($it:expr) => {
                if let Some(it) = $it {
                    visit(it.into());
                }
            };
        }
        macro_rules! all {
            ($list:expr) => {
                for it in $list {
                    visit(it.into());
                }
            };
        }
        fn computed<'a>(key: Option<Key<'a>>) -> Option<super::Expr<'a>> {
            match key?.kind() {
                KeyKind::Computed(e) => Some(e),
                _ => None,
            }
        }
        /// The strings in `with { key: "value" }`.
        fn attribute_values<'a>(
            attributes: Option<super::ImportAttributes<'a>>,
        ) -> impl Iterator<Item = super::Expr<'a>> {
            attributes.into_iter().flat_map(|it| it.entries()).filter_map(super::Prop::value)
        }
        /// What is in the head of a `for`: a `Var`, or the expression in a wrapper.
        fn head(statement: super::Stmt) -> Node {
            match statement.kind() {
                StmtKind::Expr(e) => Node::Expr(e),
                _ => Node::Stmt(statement),
            }
        }
        match self {
            Node::File(file) => all!(file.body()),
            Node::Expr(e) => match e.kind() {
                ExprKind::Missing
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
                | ExprKind::Regex(_)
                | ExprKind::ImportMeta
                | ExprKind::NewTarget => {}
                ExprKind::Template(template) => all!(template.exprs()),
                ExprKind::TaggedTemplate(call) => {
                    one!(call.callee());
                    all!(call.type_args());
                    opt!(call.template());
                }
                ExprKind::Array(elements) => all!(elements.iter().filter(|e| !e.is_missing())),
                ExprKind::Object(props) => all!(props),
                ExprKind::Fn(func) => one!(func),
                ExprKind::Class(class) => one!(class),
                ExprKind::Dot { obj, .. } => one!(obj),
                ExprKind::Index { obj, index, .. } => {
                    one!(obj);
                    one!(index);
                }
                ExprKind::Call(call) | ExprKind::New(call) => {
                    one!(call.callee());
                    all!(call.type_args());
                    all!(call.args());
                }
                ExprKind::Unary { operand, .. }
                | ExprKind::Spread(operand)
                | ExprKind::Await(operand)
                | ExprKind::AsConst(operand)
                | ExprKind::NonNull(operand) => one!(operand),
                ExprKind::Binary { left, right, .. } => {
                    one!(left);
                    one!(right);
                }
                ExprKind::Assign { target, value, .. } => {
                    one!(target);
                    one!(value);
                }
                ExprKind::Cond { test, yes, no } => {
                    one!(test);
                    one!(yes);
                    one!(no);
                }
                ExprKind::Yield { value, .. } => opt!(value),
                ExprKind::As { expr, ty } if e.is_angle_bracket_assertion() => {
                    one!(ty);
                    one!(expr);
                }
                ExprKind::As { expr, ty } | ExprKind::Satisfies { expr, ty } => {
                    one!(expr);
                    one!(ty);
                }
                ExprKind::Instantiation { expr, type_args } => {
                    one!(expr);
                    all!(type_args);
                }
                ExprKind::Jsx(jsx) => {
                    opt!(jsx.tag());
                    all!(jsx.type_args());
                    all!(jsx.attrs());
                    all!(jsx.children().iter().filter(|e| !e.is_missing()));
                    opt!(jsx.close_tag());
                }
                ExprKind::ImportCall { args } => all!(args.iter().filter(|e| !e.is_missing())),
            },
            Node::Stmt(s) => match s.kind() {
                StmtKind::Empty
                | StmtKind::Debugger
                | StmtKind::Break(_)
                | StmtKind::Continue(_)
                | StmtKind::ImportEquals(_)
                | StmtKind::ExportAsNamespace(_) => {}
                StmtKind::ExportStar { .. } => all!(attribute_values(s.import_attributes())),
                StmtKind::Expr(e)
                | StmtKind::Throw(e)
                | StmtKind::ExportDefault(e)
                | StmtKind::ExportAssign(e) => one!(e),
                StmtKind::Return(e) => opt!(e),
                StmtKind::Var(declarations) => all!(declarations),
                StmtKind::Fn(func) => one!(func),
                StmtKind::Class(class) => one!(class),
                StmtKind::Interface(interface) => {
                    all!(interface.type_params());
                    all!(interface.extends());
                    all!(interface.members());
                }
                StmtKind::TypeAlias(alias) => {
                    all!(alias.type_params());
                    one!(alias.ty());
                }
                StmtKind::Enum(it) => all!(it.members()),
                StmtKind::Module(module) => all!(module.body()),
                StmtKind::If { test, yes, no } => {
                    one!(test);
                    one!(yes);
                    opt!(no);
                }
                StmtKind::For {
                    init,
                    test,
                    update,
                    body,
                } => {
                    opt!(init.map(head));
                    opt!(test);
                    opt!(update);
                    one!(body);
                }
                StmtKind::ForIn { left, expr, body } | StmtKind::ForOf { left, expr, body, .. } => {
                    one!(head(left));
                    one!(expr);
                    one!(body);
                }
                StmtKind::While { test, body } => {
                    one!(test);
                    one!(body);
                }
                StmtKind::DoWhile { body, test } => {
                    one!(body);
                    one!(test);
                }
                StmtKind::Block(statements) => all!(statements),
                StmtKind::With { object, body } => {
                    one!(object);
                    one!(body);
                }
                StmtKind::Switch { expr, cases } => {
                    one!(expr);
                    all!(cases);
                }
                StmtKind::Try {
                    block,
                    param,
                    handler,
                    finalizer,
                } => {
                    one!(block);
                    opt!(param);
                    opt!(handler);
                    opt!(finalizer);
                }
                StmtKind::Labeled { body, .. } => one!(body),
                StmtKind::Import(import) => {
                    all!(import.named());
                    all!(attribute_values(import.attributes()));
                }
                StmtKind::ExportNamed(export) => {
                    all!(export.items());
                    all!(attribute_values(export.attributes()));
                }
            },
            Node::Func(func) => {
                all!(func.type_params());
                opt!(func.this_param());
                all!(func.params());
                opt!(func.return_type());
                match func.body() {
                    FnBody::None => {}
                    FnBody::Block(statements) => all!(statements),
                    FnBody::Expr(e) => one!(e),
                }
            }
            Node::Param(param) => {
                all!(param.modifiers().iter().filter_map(Modifier::decorator));
                one!(param.pat());
                opt!(param.ty());
                opt!(param.default());
            }
            Node::TypeParam(param) => {
                opt!(param.constraint());
                opt!(param.default());
            }
            Node::Pat(pat) => match pat.kind() {
                PatKind::Missing | PatKind::Ident(_) => {}
                PatKind::Object(props) => all!(props),
                PatKind::Array(elements) => all!(elements.iter().filter(|it| it.pat().is_some())),
            },
            Node::PatProp(prop) => {
                opt!(computed(prop.key()));
                one!(prop.value());
                opt!(prop.default());
            }
            Node::PatElem(element) => {
                opt!(element.pat());
                opt!(element.default());
            }
            Node::Class(class) => {
                all!(class.decorators());
                all!(class.type_params());
                opt!(class.extends());
                all!(class.extends_args());
                all!(class.implements());
                all!(class.members());
            }
            Node::Member(member) => {
                all!(member.decorators());
                opt!(computed(member.key()));
                opt!(member.func());
                opt!(member.ty());
                opt!(member.init());
            }
            Node::Prop(prop) => {
                opt!(computed(prop.key()));
                opt!(prop.value());
            }
            Node::VarDecl(declaration) => {
                one!(declaration.pat());
                opt!(declaration.ty());
                opt!(declaration.init());
            }
            Node::Case(case) => {
                opt!(case.test());
                all!(case.body());
            }
            Node::EnumMember(member) => {
                opt!(computed(member.key()));
                opt!(member.init());
            }
            Node::ImportSpec(_) | Node::ExportSpec(_) => {}
            Node::TupleElem(element) => one!(element.ty()),
            Node::Type(ty) => match ty.kind() {
                TypeKind::Error
                | TypeKind::Keyword(_)
                | TypeKind::StringLit(_)
                | TypeKind::NumberLit(_)
                | TypeKind::BigIntLit { .. }
                | TypeKind::BoolLit(_)
                | TypeKind::UniqueSymbol => {}
                TypeKind::Heritage { expr, args } | TypeKind::Typeof { expr, args } => {
                    one!(expr);
                    all!(args);
                }
                TypeKind::Ref { args, .. } => all!(args),
                TypeKind::Import { args, .. } => {
                    all!(attribute_values(ty.import_attributes()));
                    all!(args);
                }
                TypeKind::Template(types) | TypeKind::Union(types) | TypeKind::Intersection(types) => {
                    all!(types)
                }
                TypeKind::Array(operand) | TypeKind::Keyof(operand) | TypeKind::Readonly(operand) => {
                    one!(operand)
                }
                TypeKind::Tuple(elements) => all!(elements),
                TypeKind::Fn(func) => one!(func),
                TypeKind::Object(members) => all!(members),
                TypeKind::Cond {
                    check,
                    extends,
                    yes,
                    no,
                } => {
                    one!(check);
                    one!(extends);
                    one!(yes);
                    one!(no);
                }
                TypeKind::Infer(param) => one!(param),
                TypeKind::Mapped(mapped) => {
                    one!(mapped.param());
                    opt!(mapped.name_type());
                    opt!(mapped.ty());
                }
                TypeKind::IndexedAccess { obj, index } => {
                    one!(obj);
                    one!(index);
                }
                TypeKind::Predicate { ty, .. } => opt!(ty),
            },
        }
    }
}

/// What a walk calls.
pub trait Visitor<'a> {
    /// Before the children of `node`.
    fn enter(&mut self, node: Node<'a>);
    /// After them.
    fn exit(&mut self, node: Node<'a>);
}

/// Visits every node of `file`, in source order.
pub fn walk<'a>(file: &'a File<'a>, visitor: &mut impl Visitor<'a>) {
    walk_node(Node::File(file), visitor);
}

/// Visits `node` and everything in it, in source order. It does not recurse: how deep the syntax
/// is nested does not matter.
pub fn walk_node<'a>(node: Node<'a>, visitor: &mut impl Visitor<'a>) {
    enum Step<'a> {
        Enter(Node<'a>),
        Exit(Node<'a>),
    }
    let mut steps = vec![Step::Enter(node)];
    while let Some(step) = steps.pop() {
        match step {
            Step::Exit(node) => visitor.exit(node),
            Step::Enter(node) => {
                visitor.enter(node);
                steps.push(Step::Exit(node));
                let first = steps.len();
                node.children_into(&mut |child| steps.push(Step::Enter(child)));
                steps[first..].reverse();
            }
        }
    }
}
