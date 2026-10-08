//! The one description of ESTree: for each type of node its fields, and how each is computed from
//! the syntax of [`crate::ast`].
//!
//! A row of the table is `kind Field = value;`.
//! - `node`: a field that a traversal goes into. These come first, in the order of the visitor keys
//!   of ESLint and typescript-eslint.
//! - `part`: the same, where the value can be made of the same node of [`crate::ast`] as the node
//!   itself.
//! - `data`: any other field.
//! - `ts_node`, `ts_part`, `ts_data`: the same for a field that only typescript-estree has.
//! - `es_data`: a field that only espree has.
//!
//! The value is an expression of a type that converts to a [`Value`]. `None` converts to `null`.
//! Where `?` meets a `None`, the field is `undefined`.
//!
//! After the name of a type come the kinds of nodes of [`crate::ast`] that a node of this type can
//! be made of: [`NodeType::listens_to`].

use super::value::{Nodes, Object, Value};
use super::views::*;
use super::vnode::{Leaf, Part, VNode};
use super::{Dialect, Field};
use crate::ast::{
    ExprKind, ExprTag, Flags, FnBody, MappedModifier, MemberKind, ModuleName, Node, PatKind,
    PropKind, StmtKind, StmtTag, TypeKind, TypeTag, UnOp, VarDecl, VarKind, assign_op_text,
    bin_op_text, un_op_text,
};
use crate::rule::NodeTags;

/// A field of a type of node.
pub struct FieldEntry {
    pub field: Field,
    /// It is among the visitor keys: a traversal goes into it.
    pub is_child: bool,
    /// What is in it can have the same [`VNode::base`] as the node.
    pub is_part: bool,
    /// Only typescript-estree has it.
    pub is_typescript_only: bool,
    /// Only espree has it.
    pub is_espree_only: bool,
    /// Its value in a node of that type.
    pub get: for<'a> fn(VNode<'a>) -> Value<'a>,
}

macro_rules! estree_schema {
    ($(
        $name:ident [$($tag:expr),*] ($v:ident) {
            $($row:ident $field:ident = $value:expr;)*
        }
    )*) => {
        /// The `type` of a node: typescript-eslint's `AST_NODE_TYPES`.
        #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
        #[repr(u8)]
        pub enum NodeType { $($name),* }

        impl NodeType {
            pub const ALL: &[NodeType] = &[$(NodeType::$name),*];

            pub const fn name(self) -> &'static str {
                match self { $(NodeType::$name => stringify!($name)),* }
            }

            /// Its fields, except `type`, `range`, `loc` and `parent`. First those that a traversal
            /// goes into, in that order.
            pub fn fields(self) -> &'static [FieldEntry] {
                match self {
                    $(NodeType::$name => &[$(
                        FieldEntry {
                            field: Field::$field,
                            is_child: estree_schema!(@is_child $row),
                            is_part: estree_schema!(@is_part $row),
                            is_typescript_only: estree_schema!(@is_typescript_only $row),
                            is_espree_only: estree_schema!(@is_espree_only $row),
                            get: {
                                fn get<'a>($v: VNode<'a>) -> Value<'a> {
                                    let _ = $v;
                                    (|| Some(Value::from($value)))().unwrap_or(Value::Undefined)
                                }
                                get
                            },
                        }
                    ),*]),*
                }
            }

            /// The kinds of nodes of [`crate::ast`] that a node of this type can be made of. See
            /// [`VNode::for_each_at`].
            pub fn listens_to(self) -> NodeTags {
                match self {
                    $(NodeType::$name => NodeTags::EMPTY $(| NodeTags::from($tag))*),*
                }
            }
        }
    };
    (@is_child node) => { true };
    (@is_child ts_node) => { true };
    (@is_child part) => { true };
    (@is_child ts_part) => { true };
    (@is_part part) => { true };
    (@is_part ts_part) => { true };
    (@is_part $row:ident) => { false };
    (@is_child data) => { false };
    (@is_child ts_data) => { false };
    (@is_child es_data) => { false };
    (@is_espree_only es_data) => { true };
    (@is_espree_only $row:ident) => { false };
    (@is_typescript_only es_data) => { false };
    (@is_typescript_only node) => { false };
    (@is_typescript_only data) => { false };
    (@is_typescript_only part) => { false };
    (@is_typescript_only ts_part) => { true };
    (@is_typescript_only ts_node) => { true };
    (@is_typescript_only ts_data) => { true };
}

/// What `$value` is for the statement, the expression or the type that `$v` is made of, if its kind
/// is `$kind`.
macro_rules! of {
    ($handle:ident $v:ident, $kind:pat => $value:expr) => {
        match $v.$handle()?.kind() {
            $kind => $value,
            _ => return None,
        }
    };
}

estree_schema! {
    // ───────────────────────────── statements ─────────────────────────────

    Program [NodeTags::FILE] (v) {
        node Body = Nodes::stmts(v.file().body());
        data SourceType = source_type(v.file());
    }
    ExpressionStatement [StmtTag::Expr] (v) {
        node Expression = VNode::of_expr(of!(stmt v, StmtKind::Expr(e) => e));
        data Directive = directive(v.stmt()?)?;
    }
    BlockStatement [StmtTag::Block, NodeTags::FUNC] (v) {
        node Body = Nodes::stmts(match v.base {
            Node::Func(func) => func.body_statements()?,
            _ => of!(stmt v, StmtKind::Block(statements) => statements),
        });
    }
    EmptyStatement [StmtTag::Empty] (v) {}
    DebuggerStatement [StmtTag::Debugger] (v) {}
    WithStatement [StmtTag::Block] (v) {
        node Object = VNode::of_expr(of!(stmt v, StmtKind::With { object, .. } => object));
        node Body = VNode::of_stmt(of!(stmt v, StmtKind::With { body, .. } => body));
    }
    ReturnStatement [StmtTag::Return] (v) {
        node Argument = of!(stmt v, StmtKind::Return(argument) => argument).and_then(VNode::of_expr);
    }
    LabeledStatement [StmtTag::Labeled] (v) {
        part Label = v.with(Part::Name);
        node Body = VNode::of_stmt(of!(stmt v, StmtKind::Labeled { body, .. } => body));
    }
    BreakStatement [StmtTag::Break] (v) {
        part Label = v.stmt()?.label().map(|_| v.with(Part::Name));
    }
    ContinueStatement [StmtTag::Continue] (v) {
        part Label = v.stmt()?.label().map(|_| v.with(Part::Name));
    }
    IfStatement [StmtTag::If] (v) {
        node Test = VNode::of_expr(of!(stmt v, StmtKind::If { test, .. } => test));
        node Consequent = VNode::of_stmt(of!(stmt v, StmtKind::If { yes, .. } => yes));
        node Alternate = of!(stmt v, StmtKind::If { no, .. } => no).map(VNode::of_stmt);
    }
    SwitchStatement [StmtTag::Switch] (v) {
        node Discriminant = VNode::of_expr(of!(stmt v, StmtKind::Switch { expr, .. } => expr));
        node Cases = Nodes::cases(of!(stmt v, StmtKind::Switch { cases, .. } => cases));
    }
    SwitchCase [NodeTags::CASE] (v) {
        node Test = case(v)?.test().and_then(VNode::of_expr);
        node Consequent = Nodes::stmts(case(v)?.body());
    }
    ThrowStatement [StmtTag::Throw] (v) {
        node Argument = VNode::of_expr(of!(stmt v, StmtKind::Throw(argument) => argument));
    }
    TryStatement [StmtTag::Try] (v) {
        node Block = VNode::of_stmt(of!(stmt v, StmtKind::Try { block, .. } => block));
        part Handler = of!(stmt v, StmtKind::Try { handler, .. } => handler).map(|_| v.with(Part::Catch));
        node Finalizer = of!(stmt v, StmtKind::Try { finalizer, .. } => finalizer).map(VNode::of_stmt);
    }
    CatchClause [StmtTag::Try] (v) {
        node Param = of!(stmt v, StmtKind::Try { param, .. } => param).and_then(|it| VNode::of_pat(it.pat()));
        node Body = VNode::of_stmt(of!(stmt v, StmtKind::Try { handler, .. } => handler)?);
    }
    WhileStatement [StmtTag::While] (v) {
        node Test = VNode::of_expr(of!(stmt v, StmtKind::While { test, .. } => test));
        node Body = VNode::of_stmt(of!(stmt v, StmtKind::While { body, .. } => body));
    }
    DoWhileStatement [StmtTag::DoWhile] (v) {
        node Body = VNode::of_stmt(of!(stmt v, StmtKind::DoWhile { body, .. } => body));
        node Test = VNode::of_expr(of!(stmt v, StmtKind::DoWhile { test, .. } => test));
    }
    ForStatement [StmtTag::For] (v) {
        node Init = of!(stmt v, StmtKind::For { init, .. } => init).and_then(VNode::of_for_head);
        node Test = of!(stmt v, StmtKind::For { test, .. } => test).and_then(VNode::of_expr);
        node Update = of!(stmt v, StmtKind::For { update, .. } => update).and_then(VNode::of_expr);
        node Body = VNode::of_stmt(of!(stmt v, StmtKind::For { body, .. } => body));
    }
    ForInStatement [StmtTag::ForIn] (v) {
        node Left = VNode::of_for_head(of!(stmt v, StmtKind::ForIn { left, .. } => left));
        node Right = VNode::of_expr(of!(stmt v, StmtKind::ForIn { expr, .. } => expr));
        node Body = VNode::of_stmt(of!(stmt v, StmtKind::ForIn { body, .. } => body));
    }
    ForOfStatement [StmtTag::ForOf] (v) {
        node Left = VNode::of_for_head(of!(stmt v, StmtKind::ForOf { left, .. } => left));
        node Right = VNode::of_expr(of!(stmt v, StmtKind::ForOf { expr, .. } => expr));
        node Body = VNode::of_stmt(of!(stmt v, StmtKind::ForOf { body, .. } => body));
        data Await = of!(stmt v, StmtKind::ForOf { is_await, .. } => is_await);
    }
    VariableDeclaration [StmtTag::Var] (v) {
        node Declarations = Nodes::var_decls(of!(stmt v, StmtKind::Var(declarations) => declarations));
        ts_data Declare = is_declared(v.stmt()?);
        data Kind = match of!(stmt v, StmtKind::Var(declarations) => declarations).first().map(VarDecl::var_kind) {
            Some(VarKind::Let) => b"let" as &[u8],
            Some(VarKind::Const) => b"const",
            Some(VarKind::Using) => b"using",
            Some(VarKind::AwaitUsing) => b"await using",
            Some(VarKind::Var) => b"var",
            // `for (let;;);`
            None => first_token(v),
        };
    }
    VariableDeclarator [NodeTags::VAR_DECL] (v) {
        node Id = VNode::of_pat(var_decl(v)?.pat());
        node Init = var_decl(v)?.init().and_then(VNode::of_expr);
        ts_data Definite = var_decl(v)?.is_definite();
    }

    // ───────────────────────────── functions and classes ─────────────────────────────

    FunctionDeclaration [NodeTags::FUNC] (v) {
        part Id = function_id(v);
        ts_part TypeParameters = type_parameters(v)?;
        node Params = params(v)?;
        ts_node ReturnType = return_type(v)?;
        part Body = v.with(Part::Body);
        data Async = v.func()?.is_async();
        ts_data Declare = is_declared(v.func()?.owner().as_stmt()?);
        data Expression = false;
        data Generator = v.func()?.is_generator();
    }
    TSDeclareFunction [NodeTags::FUNC] (v) {
        part Id = function_id(v);
        part TypeParameters = type_parameters(v)?;
        node Params = params(v)?;
        node ReturnType = return_type(v)?;
        node Body = Value::Undefined;
        data Async = v.func()?.is_async();
        data Declare = is_declared(v.func()?.owner().as_stmt()?);
        data Expression = false;
        data Generator = v.func()?.is_generator();
    }
    FunctionExpression [NodeTags::FUNC] (v) {
        part Id = function_id(v);
        ts_part TypeParameters = type_parameters(v)?;
        node Params = params(v)?;
        ts_node ReturnType = return_type(v)?;
        part Body = v.with(Part::Body);
        data Async = v.func()?.is_async();
        ts_data Declare = false;
        data Expression = false;
        data Generator = v.func()?.is_generator();
    }
    TSEmptyBodyFunctionExpression [NodeTags::FUNC] (v) {
        node Id = Value::Null;
        part TypeParameters = type_parameters(v)?;
        node Params = params(v)?;
        node ReturnType = return_type(v)?;
        data Async = v.func()?.is_async();
        data Body = Value::Null;
        data Declare = false;
        data Expression = false;
        data Generator = v.func()?.is_generator();
    }
    ArrowFunctionExpression [NodeTags::FUNC] (v) {
        ts_part TypeParameters = type_parameters(v)?;
        node Params = params(v)?;
        ts_node ReturnType = return_type(v)?;
        part Body = match v.func()?.body() {
            FnBody::Expr(e) => VNode::of_expr(e),
            _ => Some(v.with(Part::Body)),
        };
        data Async = v.func()?.is_async();
        data Expression = matches!(v.func()?.body(), FnBody::Expr(_));
        data Generator = false;
        data Id = Value::Null;
    }
    ClassDeclaration [NodeTags::CLASS] (v) {
        ts_part Decorators = Nodes::decorators(v.base, class(v)?.modifiers());
        part Id = class(v)?.name().map(|_| v.with(Part::Name));
        ts_part TypeParameters = class(v)?.type_params().first().map(|_| v.with(Part::TypeParams))?;
        node SuperClass = class(v)?.extends().and_then(VNode::of_expr);
        ts_part SuperTypeArguments = class(v)?.extends_args().first().map(|_| v.with(Part::TypeArgs))?;
        ts_node Implements = Nodes::heritage(class(v)?.implements());
        part Body = v.with(Part::Body);
        ts_data Abstract = keywords(class(v)?.modifiers()).contains(Flags::ABSTRACT);
        ts_data Declare = keywords(class(v)?.modifiers()).contains(Flags::AMBIENT);
    }
    ClassExpression [NodeTags::CLASS] (v) {
        ts_part Decorators = Nodes::decorators(v.base, class(v)?.modifiers());
        part Id = class(v)?.name().map(|_| v.with(Part::Name));
        ts_part TypeParameters = class(v)?.type_params().first().map(|_| v.with(Part::TypeParams))?;
        node SuperClass = class(v)?.extends().and_then(VNode::of_expr);
        ts_part SuperTypeArguments = class(v)?.extends_args().first().map(|_| v.with(Part::TypeArgs))?;
        ts_node Implements = Nodes::heritage(class(v)?.implements());
        part Body = v.with(Part::Body);
        ts_data Abstract = keywords(class(v)?.modifiers()).contains(Flags::ABSTRACT);
        ts_data Declare = keywords(class(v)?.modifiers()).contains(Flags::AMBIENT);
    }
    ClassBody [NodeTags::CLASS] (v) {
        node Body = Nodes::members(class(v)?.members());
    }
    MethodDefinition [NodeTags::MEMBER] (v) {
        ts_part Decorators = member_decorators(v)?;
        part Key = member_key(v)?;
        node Value = VNode::new(member(v)?.func()?, Part::Main);
        ts_data Accessibility = accessibility(member_keywords(v)?)?;
        data Computed = is_computed(member(v)?.key());
        data Kind = method_kind(member(v)?);
        ts_data Optional = member(v)?.kind() != MemberKind::Constructor && member(v)?.flags().contains(Flags::OPTIONAL);
        ts_data Override = member(v)?.kind() != MemberKind::Constructor && member_keywords(v)?.contains(Flags::OVERRIDE);
        data Static = member_keywords(v)?.contains(Flags::STATIC);
    }
    TSAbstractMethodDefinition [NodeTags::MEMBER] (v) {
        part Key = member_key(v)?;
        node Value = VNode::new(member(v)?.func()?, Part::Main);
        data Accessibility = accessibility(member_keywords(v)?)?;
        data Computed = is_computed(member(v)?.key());
        data Decorators = member_decorators(v)?;
        data Kind = method_kind(member(v)?);
        data Optional = member(v)?.kind() != MemberKind::Constructor && member(v)?.flags().contains(Flags::OPTIONAL);
        data Override = member(v)?.kind() != MemberKind::Constructor && member_keywords(v)?.contains(Flags::OVERRIDE);
        data Static = member_keywords(v)?.contains(Flags::STATIC);
    }
    PropertyDefinition [NodeTags::MEMBER] (v) {
        ts_part Decorators = member_decorators(v)?;
        part Key = member_key(v)?;
        ts_node TypeAnnotation = VNode::annotation(member(v)?.ty()?);
        node Value = member(v)?.init().and_then(VNode::of_expr);
        ts_data Accessibility = accessibility(member_keywords(v)?)?;
        data Computed = is_computed(member(v)?.key());
        ts_data Declare = member_keywords(v)?.contains(Flags::AMBIENT);
        ts_data Definite = member(v)?.flags().contains(Flags::DEFINITE);
        ts_data Optional = member(v)?.flags().contains(Flags::OPTIONAL);
        ts_data Override = member_keywords(v)?.contains(Flags::OVERRIDE);
        ts_data Readonly = member_keywords(v)?.contains(Flags::READONLY);
        data Static = member_keywords(v)?.contains(Flags::STATIC);
    }
    AccessorProperty [NodeTags::MEMBER] (v) {
        part Decorators = member_decorators(v)?;
        part Key = member_key(v)?;
        node TypeAnnotation = VNode::annotation(member(v)?.ty()?);
        node Value = member(v)?.init().and_then(VNode::of_expr);
        data Accessibility = accessibility(member_keywords(v)?)?;
        data Computed = is_computed(member(v)?.key());
        data Declare = member_keywords(v)?.contains(Flags::AMBIENT);
        data Definite = member(v)?.flags().contains(Flags::DEFINITE);
        data Optional = member(v)?.flags().contains(Flags::OPTIONAL);
        data Override = member_keywords(v)?.contains(Flags::OVERRIDE);
        data Readonly = member_keywords(v)?.contains(Flags::READONLY);
        data Static = member_keywords(v)?.contains(Flags::STATIC);
    }
    TSAbstractPropertyDefinition [NodeTags::MEMBER] (v) {
        part Decorators = member_decorators(v)?;
        part Key = member_key(v)?;
        node TypeAnnotation = VNode::annotation(member(v)?.ty()?);
        data Accessibility = accessibility(member_keywords(v)?)?;
        data Computed = is_computed(member(v)?.key());
        data Declare = member_keywords(v)?.contains(Flags::AMBIENT);
        data Definite = member(v)?.flags().contains(Flags::DEFINITE);
        data Optional = member(v)?.flags().contains(Flags::OPTIONAL);
        data Override = member_keywords(v)?.contains(Flags::OVERRIDE);
        data Readonly = member_keywords(v)?.contains(Flags::READONLY);
        data Static = member_keywords(v)?.contains(Flags::STATIC);
        data Value = Value::Null;
    }
    TSAbstractAccessorProperty [NodeTags::MEMBER] (v) {
        part Decorators = member_decorators(v)?;
        part Key = member_key(v)?;
        node TypeAnnotation = VNode::annotation(member(v)?.ty()?);
        data Accessibility = accessibility(member_keywords(v)?)?;
        data Computed = is_computed(member(v)?.key());
        data Declare = member_keywords(v)?.contains(Flags::AMBIENT);
        data Definite = member(v)?.flags().contains(Flags::DEFINITE);
        data Optional = member(v)?.flags().contains(Flags::OPTIONAL);
        data Override = member_keywords(v)?.contains(Flags::OVERRIDE);
        data Readonly = member_keywords(v)?.contains(Flags::READONLY);
        data Static = member_keywords(v)?.contains(Flags::STATIC);
        data Value = Value::Null;
    }
    StaticBlock [NodeTags::MEMBER] (v) {
        node Body = Nodes::stmts(member(v)?.func()?.body_statements()?);
    }
    Decorator [NodeTags::CLASS, NodeTags::MEMBER, NodeTags::PARAM] (v) {
        node Expression = VNode::of_expr(v.modifier()?.decorator()?);
    }

    // ───────────────────────────── patterns ─────────────────────────────

    Identifier [names()] (v) {
        ts_node Decorators = binding(v).decorators;
        ts_node TypeAnnotation = VNode::annotation(binding(v).ty?);
        data Name = match v.base {
            Node::Pat(pat) => pat.as_ident()?.bytes(),
            _ => match v.leaf()?.0 {
                Leaf::Identifier(name) => name,
                _ => return None,
            },
        };
        ts_data Optional = binding(v).is_optional;
    }
    ObjectPattern [NodeTags::PAT, ExprTag::Object] (v) {
        ts_node Decorators = binding(v).decorators;
        node Properties = match v.base {
            Node::Pat(pat) => match pat.kind() {
                PatKind::Object(properties) => Nodes::pat_props(properties),
                _ => return None,
            },
            _ => Nodes::props(of!(expr v, ExprKind::Object(properties) => properties)),
        };
        ts_node TypeAnnotation = VNode::annotation(binding(v).ty?);
        ts_data Optional = binding(v).is_optional;
    }
    ArrayPattern [NodeTags::PAT, ExprTag::Array] (v) {
        ts_node Decorators = binding(v).decorators;
        node Elements = match v.base {
            Node::Pat(pat) => match pat.kind() {
                PatKind::Array(elements) => Nodes::pat_elems(elements),
                _ => return None,
            },
            _ => Nodes::exprs(of!(expr v, ExprKind::Array(elements) => elements)),
        };
        ts_node TypeAnnotation = VNode::annotation(binding(v).ty?);
        ts_data Optional = binding(v).is_optional;
    }
    RestElement [NodeTags::PARAM, NodeTags::PAT_ELEM, NodeTags::PAT_PROP, NodeTags::PROP, ExprTag::Spread] (v) {
        ts_part Decorators = binding(v).decorators;
        node Argument = match v.base {
            Node::Param(param) => VNode::of_pat(param.pat()),
            Node::PatElem(element) => VNode::of_pat(element.pat()?),
            Node::PatProp(prop) => VNode::of_pat(prop.value()),
            Node::Prop(prop) => VNode::of_expr(prop.value()?),
            _ => VNode::of_expr(of!(expr v, ExprKind::Spread(argument) => argument)),
        };
        ts_node TypeAnnotation = VNode::annotation(binding(v).ty?);
        ts_data Optional = binding(v).is_optional;
    }
    AssignmentPattern [NodeTags::PARAM, NodeTags::PAT_ELEM, NodeTags::PAT_PROP, ExprTag::Assign] (v) {
        ts_part Decorators = binding(v).decorators;
        node Left = match v.base {
            Node::Param(param) => VNode::of_pat(param.pat()),
            Node::PatElem(element) => VNode::of_pat(element.pat()?),
            Node::PatProp(prop) => VNode::of_pat(prop.value()),
            _ => VNode::of_expr(of!(expr v, ExprKind::Assign { target, .. } => target)),
        };
        node Right = VNode::of_expr(match v.base {
            Node::Param(param) => param.default()?,
            Node::PatElem(element) => element.default()?,
            Node::PatProp(prop) => prop.default()?,
            _ => of!(expr v, ExprKind::Assign { value, .. } => value),
        });
        ts_node TypeAnnotation = Value::Undefined;
        ts_data Optional = false;
    }
    TSParameterProperty [NodeTags::PARAM] (v) {
        part Decorators = Nodes::decorators(v.base, param(v)?.modifiers());
        part Parameter = VNode::inner_of_param(param(v)?);
        data Accessibility = accessibility(keywords(param(v)?.modifiers()))?;
        data Override = keywords(param(v)?.modifiers()).contains(Flags::OVERRIDE);
        data Readonly = keywords(param(v)?.modifiers()).contains(Flags::READONLY);
        data Static = keywords(param(v)?.modifiers()).contains(Flags::STATIC);
    }

    // ───────────────────────────── expressions ─────────────────────────────

    Literal [literals()] (v) {
        data Raw = v.file().slice(v.span());
        data Value = match v.leaf()?.0 {
            Leaf::String(value) => Value::Str(value),
            Leaf::Number(value) => Value::Number(value),
            Leaf::Bool(value) => Value::Bool(value),
            Leaf::BigInt(digits) => Value::BigInt(digits),
            Leaf::Regex { pattern, flags } => Value::Regex { pattern, flags },
            _ => Value::Null,
        };
        data Regex = match v.leaf()?.0 {
            Leaf::Regex { pattern, flags } => Value::Object(Object::Regex { pattern, flags }),
            _ => return None,
        };
        data Bigint = match v.leaf()?.0 {
            Leaf::BigInt(digits) => digits,
            _ => return None,
        };
    }
    PrivateIdentifier [ExprTag::PrivateIdentifier, ExprTag::Dot, NodeTags::MEMBER, NodeTags::PROP, NodeTags::PAT_PROP] (v) {
        data Name = match v.leaf()?.0 {
            Leaf::Private(name) => name.strip_prefix(b"#").unwrap_or(name),
            _ => return None,
        };
    }
    ThisExpression [ExprTag::This] (v) {}
    Super [ExprTag::Super] (v) {}
    TemplateLiteral [ExprTag::Template, keys(), TypeTag::StringLit] (v) {
        part Quasis = match v.base {
            Node::Expr(e) if v.part == Part::Main => {
                Nodes::quasis(e, of!(expr v, ExprKind::Template(template) => template).quasi_count())
            }
            Node::Type(ty) => Nodes::quasis(ty, 1),
            _ => Nodes::one(v.with(Part::KeyQuasi)),
        };
        node Expressions = match v.base {
            Node::Expr(_) if v.part == Part::Main => {
                Nodes::exprs(of!(expr v, ExprKind::Template(template) => template).exprs())
            }
            _ => Nodes::EMPTY,
        };
    }
    TemplateElement [ExprTag::Template, keys(), TypeTag::StringLit, TypeTag::Template] (v) {
        data Tail = quasi(v)?.is_tail;
        data Value = Value::Object(Object::Template { cooked: quasi(v)?.cooked, raw: quasi(v)?.raw });
    }
    TaggedTemplateExpression [ExprTag::TaggedTemplate] (v) {
        node Tag = VNode::of_expr(call(v)?.callee());
        ts_part TypeArguments = type_arguments(v)?;
        node Quasi = VNode::of_expr(call(v)?.template()?);
    }
    ArrayExpression [ExprTag::Array] (v) {
        node Elements = Nodes::exprs(of!(expr v, ExprKind::Array(elements) => elements));
    }
    ObjectExpression [ExprTag::Object, TypeTag::Import] (v) {
        part Properties = match (v.base, v.part) {
            (Node::Type(_), Part::Options) => Nodes::one(v.with(Part::OptionsProperty)),
            (Node::Type(ty), _) => Nodes::attributes(ty, ty.import_attributes()?.entries()),
            _ => Nodes::props(of!(expr v, ExprKind::Object(properties) => properties)),
        };
    }
    Property [NodeTags::PROP, NodeTags::PAT_PROP, TypeTag::Import] (v) {
        part Key = match (v.base, v.part) {
            (Node::Prop(prop), _) => VNode::of_key(prop, prop.key()?),
            (Node::PatProp(prop), _) => VNode::of_key(prop, prop.key()?),
            (_, Part::Attribute(id)) => Some(v.with(Part::AttributeKey(id))),
            _ => Some(v.with(Part::OptionsKey)),
        };
        part Value = match (v.base, v.part) {
            (Node::Prop(prop), _) => VNode::of_expr(prop.value()?),
            (Node::PatProp(prop), _) if prop.default().is_some() => Some(v.with(Part::Value)),
            (Node::PatProp(prop), _) => VNode::of_pat(prop.value()),
            (_, Part::Attribute(_)) => VNode::of_expr(v.attribute()?.value()?),
            _ => Some(v.with(Part::OptionsValue)),
        };
        data Computed = match v.base {
            Node::Prop(prop) => is_computed(prop.key()),
            Node::PatProp(prop) => is_computed(prop.key()),
            _ => false,
        };
        data Kind = match v.base {
            Node::Prop(prop) if prop.kind() == PropKind::Getter => "get",
            Node::Prop(prop) if prop.kind() == PropKind::Setter => "set",
            _ => "init",
        };
        data Method = matches!(v.base, Node::Prop(prop) if prop.kind() == PropKind::Method);
        ts_data Optional = matches!(v.base, Node::Prop(prop) if prop.func().is_some() && prop.is_optional());
        data Shorthand = match v.base {
            Node::Prop(prop) => prop.kind() == PropKind::Shorthand,
            Node::PatProp(prop) => prop.is_shorthand(),
            _ => false,
        };
    }
    SpreadElement [ExprTag::Spread, NodeTags::PROP] (v) {
        node Argument = match v.base {
            Node::Prop(prop) => VNode::of_expr(prop.value()?),
            _ => VNode::of_expr(of!(expr v, ExprKind::Spread(argument) => argument)),
        };
    }
    MemberExpression [ExprTag::Dot, ExprTag::Index, TypeTag::Ref] (v) {
        part Object = match v.part {
            Part::MemberName(i) => VNode::of_entity_name(v.base, i as usize, true),
            _ => VNode::of_expr(of!(expr v, ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj)),
        };
        part Property = match v.part {
            Part::MemberName(i) => Some(v.with(Part::NamePart(i))),
            _ => match v.expr()?.kind() {
                ExprKind::Index { index, .. } => VNode::of_expr(index),
                _ => Some(v.with(Part::Property)),
            },
        };
        data Computed = v.expr().is_some_and(|e| e.tag() == ExprTag::Index);
        data Optional = v.expr().is_some_and(|e| e.is_optional());
    }
    ChainExpression [ExprTag::Dot, ExprTag::Index, ExprTag::Call, ExprTag::NonNull] (v) {
        part Expression = v.with(Part::Main);
    }
    CallExpression [ExprTag::Call] (v) {
        node Callee = VNode::of_expr(call(v)?.callee());
        ts_part TypeArguments = type_arguments(v)?;
        node Arguments = Nodes::exprs(call(v)?.args());
        data Optional = call(v)?.is_optional();
    }
    NewExpression [ExprTag::New] (v) {
        node Callee = VNode::of_expr(call(v)?.callee());
        ts_part TypeArguments = type_arguments(v)?;
        node Arguments = Nodes::exprs(call(v)?.args());
    }
    ImportExpression [ExprTag::ImportCall] (v) {
        node Source = of!(expr v, ExprKind::ImportCall { args } => args).get(0).and_then(VNode::of_expr);
        node Options = of!(expr v, ExprKind::ImportCall { args } => args).get(1).and_then(VNode::of_expr);
        ts_data Phase = v.expr()?.is_deferred_import_call().then_some("defer");
    }
    MetaProperty [ExprTag::ImportMeta, ExprTag::NewTarget] (v) {
        part Meta = v.with(Part::Meta);
        part Property = v.with(Part::Property);
    }
    UnaryExpression [ExprTag::Unary, TypeTag::NumberLit, TypeTag::BigIntLit] (v) {
        part Argument = match v.base {
            Node::Type(_) => Some(v.with(Part::LiteralArgument)),
            _ => VNode::of_expr(of!(expr v, ExprKind::Unary { operand, .. } => operand)),
        };
        data Operator = match v.base {
            Node::Type(_) => "-",
            _ => un_op_text(of!(expr v, ExprKind::Unary { op, .. } => op)),
        };
        data Prefix = true;
    }
    UpdateExpression [ExprTag::Unary] (v) {
        node Argument = VNode::of_expr(of!(expr v, ExprKind::Unary { operand, .. } => operand));
        data Operator = un_op_text(of!(expr v, ExprKind::Unary { op, .. } => op));
        data Prefix = !matches!(of!(expr v, ExprKind::Unary { op, .. } => op), UnOp::PostInc | UnOp::PostDec);
    }
    BinaryExpression [ExprTag::Binary] (v) {
        node Left = VNode::of_expr(of!(expr v, ExprKind::Binary { left, .. } => left));
        node Right = VNode::of_expr(of!(expr v, ExprKind::Binary { right, .. } => right));
        data Operator = bin_op_text(of!(expr v, ExprKind::Binary { op, .. } => op));
    }
    LogicalExpression [ExprTag::Binary] (v) {
        node Left = VNode::of_expr(of!(expr v, ExprKind::Binary { left, .. } => left));
        node Right = VNode::of_expr(of!(expr v, ExprKind::Binary { right, .. } => right));
        data Operator = bin_op_text(of!(expr v, ExprKind::Binary { op, .. } => op));
    }
    SequenceExpression [ExprTag::Binary] (v) {
        node Expressions = Nodes::sequence(v.expr()?);
    }
    AssignmentExpression [ExprTag::Assign] (v) {
        node Left = VNode::of_expr(of!(expr v, ExprKind::Assign { target, .. } => target));
        node Right = VNode::of_expr(of!(expr v, ExprKind::Assign { value, .. } => value));
        data Operator = assign_op_text(of!(expr v, ExprKind::Assign { op, .. } => op));
    }
    ConditionalExpression [ExprTag::Cond] (v) {
        node Test = VNode::of_expr(of!(expr v, ExprKind::Cond { test, .. } => test));
        node Consequent = VNode::of_expr(of!(expr v, ExprKind::Cond { yes, .. } => yes));
        node Alternate = VNode::of_expr(of!(expr v, ExprKind::Cond { no, .. } => no));
    }
    AwaitExpression [ExprTag::Await] (v) {
        node Argument = VNode::of_expr(of!(expr v, ExprKind::Await(argument) => argument));
    }
    YieldExpression [ExprTag::Yield] (v) {
        node Argument = of!(expr v, ExprKind::Yield { value, .. } => value).and_then(VNode::of_expr);
        data Delegate = of!(expr v, ExprKind::Yield { star, .. } => star);
    }
    TSAsExpression [ExprTag::As, ExprTag::AsConst] (v) {
        node Expression = VNode::of_expr(asserted(v)?);
        part TypeAnnotation = assertion_type(v)?;
    }
    TSTypeAssertion [ExprTag::As, ExprTag::AsConst] (v) {
        part TypeAnnotation = assertion_type(v)?;
        node Expression = VNode::of_expr(asserted(v)?);
    }
    TSSatisfiesExpression [ExprTag::Satisfies] (v) {
        node Expression = VNode::of_expr(asserted(v)?);
        node TypeAnnotation = assertion_type(v)?;
    }
    TSNonNullExpression [ExprTag::NonNull] (v) {
        node Expression = VNode::of_expr(of!(expr v, ExprKind::NonNull(e) => e));
    }
    TSInstantiationExpression [ExprTag::Instantiation] (v) {
        node Expression = VNode::of_expr(of!(expr v, ExprKind::Instantiation { expr, .. } => expr));
        part TypeArguments = type_arguments(v)?;
    }

    // ───────────────────────────── imports and exports ─────────────────────────────

    ImportDeclaration [StmtTag::Import] (v) {
        part Specifiers = Nodes::import_specifiers(v.stmt()?, of!(stmt v, StmtKind::Import(import) => import).named());
        part Source = source(v);
        part Attributes = attributes(v)?;
        ts_data ImportKind = if of!(stmt v, StmtKind::Import(import) => import).is_type_only() { "type" } else { "value" };
        ts_data Phase = of!(stmt v, StmtKind::Import(import) => import).is_deferred().then_some("defer");
    }
    ImportDefaultSpecifier [StmtTag::Import] (v) {
        part Local = v.with(Part::DefaultLocal);
    }
    ImportNamespaceSpecifier [StmtTag::Import] (v) {
        part Local = v.with(Part::NamespaceLocal);
    }
    ImportSpecifier [NodeTags::IMPORT_SPEC] (v) {
        part Imported = v.with(Part::Imported);
        part Local = match v.base {
            // espree has one object for both.
            Node::ImportSpec(it) if !it.is_renamed() && v.dialect() == Dialect::Espree => v.with(Part::Imported),
            _ => v.with(Part::Local),
        };
        ts_data ImportKind = match v.base {
            Node::ImportSpec(it) if it.is_type_only() => "type",
            _ => "value",
        };
    }
    ImportAttribute [StmtTag::Import, StmtTag::ExportNamed, StmtTag::ExportStar] (v) {
        part Key = match v.part {
            Part::Attribute(id) => v.with(Part::AttributeKey(id)),
            _ => return None,
        };
        node Value = VNode::of_expr(v.attribute()?.value()?);
    }
    ExportNamedDeclaration [exportable(), StmtTag::ExportNamed] (v) {
        part Declaration = match v.part {
            Part::Export => Some(VNode::main_of_stmt(v.stmt()?)),
            _ => None,
        };
        node Specifiers = match v.part {
            Part::Export => Nodes::EMPTY,
            _ => Nodes::export_specs(of!(stmt v, StmtKind::ExportNamed(export) => export).items()),
        };
        part Source = match v.part {
            Part::Export => None,
            _ => source(v),
        };
        part Attributes = match v.part {
            Part::Export => Nodes::EMPTY,
            _ => attributes(v)?,
        };
        ts_data ExportKind = match (v.part, v.stmt()?.kind()) {
            (Part::Export, StmtKind::Interface(_) | StmtKind::TypeAlias(_)) => "type",
            (Part::Export, StmtKind::ImportEquals(_)) => "value",
            (Part::Export, _) if is_declared(v.stmt()?) => "type",
            (_, StmtKind::ExportNamed(export)) if export.is_type_only() => "type",
            _ => "value",
        };
    }
    ExportDefaultDeclaration [exportable(), StmtTag::ExportDefault] (v) {
        part Declaration = match v.part {
            Part::Export => Some(VNode::main_of_stmt(v.stmt()?)),
            _ => VNode::of_expr(of!(stmt v, StmtKind::ExportDefault(e) => e)),
        };
        ts_data ExportKind = "value";
    }
    ExportAllDeclaration [StmtTag::ExportStar] (v) {
        part Exported = of!(stmt v, StmtKind::ExportStar { alias, .. } => alias).map(|_| v.with(Part::Name));
        part Source = source(v);
        part Attributes = attributes(v)?;
        ts_data ExportKind = if of!(stmt v, StmtKind::ExportStar { type_only, .. } => type_only) { "type" } else { "value" };
    }
    ExportSpecifier [NodeTags::EXPORT_SPEC] (v) {
        part Local = v.with(Part::Local);
        part Exported = match v.base {
            // espree has one object for both.
            Node::ExportSpec(it) if !it.is_renamed() && v.dialect() == Dialect::Espree => v.with(Part::Local),
            _ => v.with(Part::Exported),
        };
        ts_data ExportKind = match v.base {
            Node::ExportSpec(it) if it.is_type_only() => "type",
            _ => "value",
        };
    }
    TSExportAssignment [StmtTag::ExportAssign] (v) {
        node Expression = VNode::of_expr(of!(stmt v, StmtKind::ExportAssign(e) => e));
    }
    TSNamespaceExportDeclaration [StmtTag::ExportAsNamespace] (v) {
        part Id = v.with(Part::Name);
    }
    TSImportEqualsDeclaration [StmtTag::ImportEquals] (v) {
        part Id = v.with(Part::Name);
        part ModuleReference = match v.entity_name() {
            Some(name) => VNode::of_entity_name(v.base, name.len(), false),
            None => Some(v.with(Part::Reference)),
        };
        data ImportKind = match of!(stmt v, StmtKind::ImportEquals(import) => import).flags().contains(Flags::TYPE_ONLY) {
            true => "type",
            false => "value",
        };
    }
    TSExternalModuleReference [StmtTag::ImportEquals] (v) {
        part Expression = source(v);
    }

    // ───────────────────────────── declarations of TypeScript ─────────────────────────────

    TSInterfaceDeclaration [StmtTag::Interface] (v) {
        part Id = v.with(Part::Name);
        part TypeParameters = of!(stmt v, StmtKind::Interface(it) => it).type_params().first().map(|_| v.with(Part::TypeParams))?;
        node Extends = Nodes::heritage(of!(stmt v, StmtKind::Interface(it) => it).extends());
        part Body = v.with(Part::Body);
        data Declare = is_declared(v.stmt()?);
    }
    TSInterfaceBody [StmtTag::Interface] (v) {
        node Body = Nodes::members(of!(stmt v, StmtKind::Interface(it) => it).members());
    }
    TSInterfaceHeritage [TypeTag::Ref, TypeTag::Heritage] (v) {
        part Expression = heritage_expression(v)?;
        part TypeArguments = type_arguments(v)?;
    }
    TSClassImplements [TypeTag::Ref, TypeTag::Heritage] (v) {
        part Expression = heritage_expression(v)?;
        part TypeArguments = type_arguments(v)?;
    }
    TSTypeAliasDeclaration [StmtTag::TypeAlias] (v) {
        part Id = v.with(Part::Name);
        part TypeParameters = of!(stmt v, StmtKind::TypeAlias(it) => it).type_params().first().map(|_| v.with(Part::TypeParams))?;
        node TypeAnnotation = VNode::of_type(of!(stmt v, StmtKind::TypeAlias(it) => it).ty());
        data Declare = is_declared(v.stmt()?);
    }
    TSEnumDeclaration [StmtTag::Enum] (v) {
        part Id = v.with(Part::Name);
        part Body = v.with(Part::Body);
        data Const = of!(stmt v, StmtKind::Enum(it) => it).flags().contains(Flags::CONST);
        data Declare = is_declared(v.stmt()?);
    }
    TSEnumBody [StmtTag::Enum] (v) {
        node Members = Nodes::enum_members(of!(stmt v, StmtKind::Enum(it) => it).members());
    }
    TSEnumMember [NodeTags::ENUM_MEMBER] (v) {
        part Id = match v.base {
            Node::EnumMember(member) => VNode::of_key(member, member.key()?),
            _ => return None,
        };
        node Initializer = match v.base {
            Node::EnumMember(member) => VNode::of_expr(member.init()?)?,
            _ => return None,
        };
    }
    TSModuleDeclaration [StmtTag::Module] (v) {
        part Id = VNode::of_entity_name(v.base, module_depth(of!(stmt v, StmtKind::Module(it) => it)), false);
        part Body = of!(stmt v, StmtKind::Module(it) => it).innermost().body_span().map(|_| v.with(Part::Body))?;
        data Declare = is_declared(v.stmt()?);
        data Global = matches!(of!(stmt v, StmtKind::Module(it) => it).name(), ModuleName::Global);
        data Kind = match of!(stmt v, StmtKind::Module(it) => it) {
            it if matches!(it.name(), ModuleName::Global) => "global",
            it if matches!(it.name(), ModuleName::String(_)) || it.uses_module_keyword() => "module",
            _ => "namespace",
        };
    }
    TSModuleBlock [StmtTag::Module] (v) {
        node Body = Nodes::stmts(of!(stmt v, StmtKind::Module(it) => it).innermost().body());
    }

    // ───────────────────────────── members of interfaces and type literals ─────────────────────────────

    TSPropertySignature [NodeTags::MEMBER] (v) {
        part Key = member_key(v)?;
        node TypeAnnotation = VNode::annotation(member(v)?.ty()?);
        data Accessibility = accessibility(member_keywords(v)?)?;
        data Computed = is_computed(member(v)?.key());
        data Optional = member(v)?.flags().contains(Flags::OPTIONAL);
        data Readonly = member_keywords(v)?.contains(Flags::READONLY);
        data Static = member_keywords(v)?.contains(Flags::STATIC);
    }
    TSMethodSignature [NodeTags::MEMBER] (v) {
        part Key = member_key(v)?;
        node TypeParameters = type_parameters(v)?;
        node Params = params(v)?;
        node ReturnType = return_type(v)?;
        data Accessibility = accessibility(member_keywords(v)?)?;
        data Computed = is_computed(member(v)?.key());
        data Kind = match member(v)?.kind() {
            MemberKind::Getter => "get",
            MemberKind::Setter => "set",
            _ => "method",
        };
        data Optional = member(v)?.flags().contains(Flags::OPTIONAL);
        data Readonly = member_keywords(v)?.contains(Flags::READONLY);
        data Static = member_keywords(v)?.contains(Flags::STATIC);
    }
    TSCallSignatureDeclaration [NodeTags::MEMBER] (v) {
        node TypeParameters = type_parameters(v)?;
        node Params = params(v)?;
        node ReturnType = return_type(v)?;
    }
    TSConstructSignatureDeclaration [NodeTags::MEMBER] (v) {
        node TypeParameters = type_parameters(v)?;
        node Params = params(v)?;
        node ReturnType = return_type(v)?;
    }
    TSIndexSignature [NodeTags::MEMBER] (v) {
        node Parameters = Nodes::params(None, func_of(v)?.params());
        node TypeAnnotation = return_type(v)?;
        data Accessibility = accessibility(member_keywords(v)?)?;
        data Readonly = member_keywords(v)?.contains(Flags::READONLY);
        data Static = member_keywords(v)?.contains(Flags::STATIC);
    }

    // ───────────────────────────── types ─────────────────────────────

    TSTypeAnnotation [all_types()] (v) {
        part TypeAnnotation = v.with(Part::Main);
    }
    TSTypeParameterDeclaration [NodeTags::FUNC, NodeTags::CLASS, StmtTag::Interface, StmtTag::TypeAlias] (v) {
        node Params = Nodes::type_params(match v.base {
            Node::Func(func) => func.type_params(),
            Node::Class(class) => class.type_params(),
            _ => match v.stmt()?.kind() {
                StmtKind::Interface(it) => it.type_params(),
                StmtKind::TypeAlias(it) => it.type_params(),
                _ => return None,
            },
        });
    }
    TSTypeParameterInstantiation [
        NodeTags::CLASS, ExprTag::Call, ExprTag::New, ExprTag::TaggedTemplate, ExprTag::Instantiation, ExprTag::Jsx,
        TypeTag::Ref, TypeTag::Heritage, TypeTag::Typeof, TypeTag::Import
    ] (v) {
        node Params = Nodes::types(type_argument_list(v)?);
    }
    TSTypeParameter [NodeTags::TYPE_PARAM] (v) {
        part Name = v.with(Part::Name);
        node Constraint = VNode::of_type(type_param(v)?.constraint()?);
        node Default = VNode::of_type(type_param(v)?.default()?);
        data Const = type_param(v)?.flags().contains(Flags::CONST);
        data In = type_param(v)?.flags().contains(Flags::IN);
        data Out = type_param(v)?.flags().contains(Flags::OUT);
    }
    TSAnyKeyword [TypeTag::Keyword, TypeTag::Error, TypeTag::Unique, TypeTag::JSDoc, TypeTag::Heritage] (v) {}
    TSUnknownKeyword [TypeTag::Keyword] (v) {}
    TSNeverKeyword [TypeTag::Keyword] (v) {}
    TSVoidKeyword [TypeTag::Keyword] (v) {}
    TSUndefinedKeyword [TypeTag::Keyword] (v) {}
    TSNullKeyword [TypeTag::Keyword] (v) {}
    TSStringKeyword [TypeTag::Keyword] (v) {}
    TSNumberKeyword [TypeTag::Keyword] (v) {}
    TSBooleanKeyword [TypeTag::Keyword] (v) {}
    TSBigIntKeyword [TypeTag::Keyword] (v) {}
    TSSymbolKeyword [TypeTag::Keyword, TypeTag::UniqueSymbol] (v) {}
    TSObjectKeyword [TypeTag::Keyword] (v) {}
    TSIntrinsicKeyword [TypeTag::Keyword] (v) {}
    TSThisType [TypeTag::Keyword, TypeTag::Predicate] (v) {}
    TSTypeReference [TypeTag::Ref, ExprTag::AsConst] (v) {
        part TypeName = match v.base {
            Node::Expr(_) => Some(v.with(Part::ConstName)),
            _ => VNode::of_entity_name(v.base, v.entity_name()?.len(), false),
        };
        part TypeArguments = match v.base {
            Node::Expr(_) => return None,
            _ => type_arguments(v)?,
        };
    }
    TSQualifiedName [TypeTag::Ref, TypeTag::Import, StmtTag::Module, StmtTag::ImportEquals, ExprTag::Dot] (v) {
        part Left = match v.part {
            Part::Qualified(i) => VNode::of_entity_name(v.base, i as usize, false),
            _ => VNode::of_expr(of!(expr v, ExprKind::Dot { obj, .. } => obj)),
        };
        part Right = match v.part {
            Part::Qualified(i) => v.with(Part::NamePart(i)),
            _ => v.with(Part::Property),
        };
    }
    TSLiteralType [TypeTag::StringLit, TypeTag::NumberLit, TypeTag::BigIntLit, TypeTag::BoolLit] (v) {
        part Literal = v.with(Part::Literal);
    }
    TSTemplateLiteralType [TypeTag::Template] (v) {
        part Quasis = Nodes::quasis(v.base, v.ty()?.as_template()?.quasi_count());
        node Types = Nodes::types(v.ty()?.as_template()?.types());
    }
    TSArrayType [TypeTag::Array] (v) {
        node ElementType = VNode::of_type(of!(ty v, TypeKind::Array(element) => element));
    }
    TSTupleType [TypeTag::Tuple] (v) {
        node ElementTypes = Nodes::tuple_elems(of!(ty v, TypeKind::Tuple(elements) => elements));
    }
    TSNamedTupleMember [NodeTags::TUPLE_ELEM] (v) {
        part Label = v.with(Part::Name);
        node ElementType = VNode::of_type(tuple_elem(v)?.ty());
        data Optional = tuple_elem(v)?.is_optional();
    }
    TSOptionalType [NodeTags::TUPLE_ELEM] (v) {
        node TypeAnnotation = VNode::of_type(tuple_elem(v)?.ty());
    }
    TSRestType [NodeTags::TUPLE_ELEM] (v) {
        part TypeAnnotation = VNode::in_rest(tuple_elem(v)?);
    }
    TSUnionType [TypeTag::Union] (v) {
        node Types = Nodes::types(of!(ty v, TypeKind::Union(types) => types));
    }
    TSIntersectionType [TypeTag::Intersection] (v) {
        node Types = Nodes::types(of!(ty v, TypeKind::Intersection(types) => types));
    }
    TSFunctionType [TypeTag::Fn] (v) {
        node TypeParameters = type_parameters(v)?;
        node Params = params(v)?;
        node ReturnType = return_type(v)?;
    }
    TSConstructorType [TypeTag::Fn] (v) {
        node TypeParameters = type_parameters(v)?;
        node Params = params(v)?;
        node ReturnType = return_type(v)?;
        data Abstract = func_of(v)?.flags().contains(Flags::ABSTRACT);
    }
    TSTypeLiteral [TypeTag::Object] (v) {
        node Members = Nodes::members(of!(ty v, TypeKind::Object(members) => members));
    }
    TSConditionalType [TypeTag::Cond] (v) {
        node CheckType = VNode::of_type(of!(ty v, TypeKind::Cond { check, .. } => check));
        node ExtendsType = VNode::of_type(of!(ty v, TypeKind::Cond { extends, .. } => extends));
        node TrueType = VNode::of_type(of!(ty v, TypeKind::Cond { yes, .. } => yes));
        node FalseType = VNode::of_type(of!(ty v, TypeKind::Cond { no, .. } => no));
    }
    TSInferType [TypeTag::Infer] (v) {
        node TypeParameter = VNode::new(of!(ty v, TypeKind::Infer(parameter) => parameter), Part::Main);
    }
    TSMappedType [TypeTag::Mapped] (v) {
        node Key = VNode::new(of!(ty v, TypeKind::Mapped(mapped) => mapped).param(), Part::Name);
        node Constraint = of!(ty v, TypeKind::Mapped(mapped) => mapped).param().constraint().map(VNode::of_type);
        node NameType = of!(ty v, TypeKind::Mapped(mapped) => mapped).name_type().map(VNode::of_type);
        node TypeAnnotation = VNode::of_type(of!(ty v, TypeKind::Mapped(mapped) => mapped).ty()?);
        data Optional = match of!(ty v, TypeKind::Mapped(mapped) => mapped) {
            it if it.optional() == MappedModifier::None => Value::Bool(false),
            it if it.optional() == MappedModifier::Remove => Value::Str(b"-"),
            it if it.is_optional_with_plus() => Value::Str(b"+"),
            _ => Value::Bool(true),
        };
        data Readonly = match of!(ty v, TypeKind::Mapped(mapped) => mapped) {
            it if it.readonly() == MappedModifier::None => return None,
            it if it.readonly() == MappedModifier::Remove => Value::Str(b"-"),
            it if it.is_readonly_with_plus() => Value::Str(b"+"),
            _ => Value::Bool(true),
        };
    }
    TSIndexedAccessType [TypeTag::IndexedAccess] (v) {
        node ObjectType = VNode::of_type(of!(ty v, TypeKind::IndexedAccess { obj, .. } => obj));
        node IndexType = VNode::of_type(of!(ty v, TypeKind::IndexedAccess { index, .. } => index));
    }
    TSTypeOperator [TypeTag::Keyof, TypeTag::Readonly, TypeTag::UniqueSymbol] (v) {
        part TypeAnnotation = match v.ty()?.kind() {
            TypeKind::Keyof(operand) | TypeKind::Readonly(operand) => VNode::of_type(operand),
            _ => v.with(Part::Operand),
        };
        data Operator = match v.ty()?.kind() {
            TypeKind::Keyof(_) => "keyof",
            TypeKind::Readonly(_) => "readonly",
            _ => "unique",
        };
    }
    TSTypeQuery [TypeTag::Typeof, TypeTag::Import] (v) {
        part ExprName = match v.ty()?.kind() {
            TypeKind::Typeof { expr, .. } => VNode::of_expr(expr),
            _ => Some(v.with(Part::ImportType)),
        };
        part TypeArguments = match v.ty()?.kind() {
            TypeKind::Typeof { .. } => type_arguments(v)?,
            _ => return None,
        };
    }
    TSImportType [TypeTag::Import] (v) {
        part Source = source(v);
        part Options = v.ty()?.import_attributes().map(|_| v.with(Part::Options));
        part Qualifier = VNode::of_entity_name(v.base, v.entity_name()?.len(), false);
        part TypeArguments = type_arguments(v);
    }
    TSTypePredicate [TypeTag::Predicate] (v) {
        part ParameterName = v.with(Part::Name);
        node TypeAnnotation = of!(ty v, TypeKind::Predicate { ty, .. } => ty).map(VNode::annotation);
        data Asserts = of!(ty v, TypeKind::Predicate { asserts, .. } => asserts);
    }

    // ───────────────────────────── JSX ─────────────────────────────

    JSXElement [ExprTag::Jsx] (v) {
        part OpeningElement = v.with(Part::Opening);
        part Children = Nodes::jsx_children(v.expr()?, jsx(v)?.children_with_whitespace());
        part ClosingElement = jsx(v)?.closing_span().map(|_| v.with(Part::Closing));
    }
    JSXFragment [ExprTag::Jsx] (v) {
        part OpeningFragment = v.with(Part::Opening);
        part Children = Nodes::jsx_children(v.expr()?, jsx(v)?.children_with_whitespace());
        part ClosingFragment = v.with(Part::Closing);
    }
    JSXOpeningElement [ExprTag::Jsx] (v) {
        node Name = VNode::of_expr(jsx(v)?.tag()?);
        ts_part TypeArguments = type_arguments(v)?;
        node Attributes = Nodes::props(jsx(v)?.attrs());
        data SelfClosing = jsx(v)?.is_self_closing();
    }
    JSXClosingElement [ExprTag::Jsx] (v) {
        node Name = VNode::of_expr(jsx(v)?.close_tag()?);
    }
    JSXOpeningFragment [ExprTag::Jsx] (v) {
        es_data Attributes = Nodes::EMPTY;
        es_data SelfClosing = false;
    }
    JSXClosingFragment [ExprTag::Jsx] (v) {}
    JSXIdentifier [ExprTag::Ident, ExprTag::This, ExprTag::String, ExprTag::Dot, NodeTags::PROP] (v) {
        data Name = v.file().slice(v.span());
    }
    JSXMemberExpression [ExprTag::Dot] (v) {
        node Object = VNode::of_expr(of!(expr v, ExprKind::Dot { obj, .. } => obj));
        part Property = v.with(Part::Property);
    }
    JSXNamespacedName [ExprTag::String, NodeTags::PROP] (v) {
        part Namespace = match v.base {
            Node::Prop(_) => v.with(Part::KeyNamespace),
            _ => v.with(Part::Meta),
        };
        part Name = match v.base {
            Node::Prop(_) => v.with(Part::KeyName),
            _ => v.with(Part::Property),
        };
    }
    JSXAttribute [NodeTags::PROP] (v) {
        part Name = v.with(Part::Key);
        node Value = prop(v)?.value().and_then(VNode::of_expr);
    }
    JSXSpreadAttribute [NodeTags::PROP] (v) {
        node Argument = VNode::of_expr(prop(v)?.value()?);
    }
    JSXExpressionContainer [all_exprs()] (v) {
        part Expression = match v.expr()? {
            e if e.is_missing() => Some(v.with(Part::Main)),
            e => VNode::in_container(e),
        };
    }
    JSXSpreadChild [ExprTag::Spread] (v) {
        node Expression = VNode::of_expr(of!(expr v, ExprKind::Spread(argument) => argument));
    }
    JSXEmptyExpression [ExprTag::Missing, ExprTag::Jsx] (v) {}
    JSXText [ExprTag::String, ExprTag::Jsx] (v) {
        data Raw = v.file().slice(v.span());
        data Value = match v.part {
            Part::Whitespace(_) => v.file().slice(v.span()),
            _ => jsx_text_value(v.expr()?)?,
        };
    }

    // ───────────────────────────── types of nodes that no syntax is converted to ─────────────────────────────

    TSAbstractKeyword [] (v) {}
    TSAsyncKeyword [] (v) {}
    TSDeclareKeyword [] (v) {}
    TSExportKeyword [] (v) {}
    TSPrivateKeyword [] (v) {}
    TSProtectedKeyword [] (v) {}
    TSPublicKeyword [] (v) {}
    TSReadonlyKeyword [] (v) {}
    TSStaticKeyword [] (v) {}
}
