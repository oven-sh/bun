//! With which node oxlint calls a rule for what the rule reports.
//!
//! Nothing records that while the rules here run: a file about which nothing is reported is not to pay for it. So the node is
//! found again, from what is reported and from the kinds of node that oxlint calls the rule with. Most rules report the node
//! that they are called with, or something in it. A rule that does neither says which node it is: `Report::called_with`.
//!
//! All the searches of a file together take time in proportion to the number of its nodes and of what is reported, whatever its
//! shape. A report keeps the node that it was given, so most start there. One for a token or a name starts where the last
//! ended: see [`Places::innermost_around`]. The way up is short, or it is remembered: [`AncestorMemo`].

use super::{Called, Kinds, kind_named};
use crate::ast::{
    BinOp, ExprKind, ExprTag, File, Flags, FnKind, MemberKind, Node, Packed, Pat, PatKind,
    PropKind, StmtKind, StmtTag, UnOp,
};
use crate::context::Diagnostic;
use crate::semantic::Declaration;
use crate::span::Span;
use crate::utils::ancestor_memo::AncestorMemo;
use crate::utils::estree_compat::{
    estree_parent, estree_span, estree_type_name, is_assignment_target, is_chain_root, normalize,
};
use rustc_hash::FxHashMap;
use std::sync::LazyLock;

/// No rule is called with it.
const NONE: u8 = u8::MAX;
/// More than the tag decides.
const ASK: u8 = u8::MAX - 1;

/// The kinds that are asked for by name, as places in `KINDS`.
struct Known {
    /// For each tag.
    exprs: [u8; ExprTag::COUNT],
    stmts: [u8; StmtTag::COUNT],
    program: u8,
    identifier_reference: u8,
    string_literal: u8,
    static_member_expression: u8,
    private_field_expression: u8,
    unary_expression: u8,
    update_expression: u8,
    binary_expression: u8,
    logical_expression: u8,
    sequence_expression: u8,
    function: u8,
    arrow_function_expression: u8,
    class: u8,
    formal_parameter: u8,
    catch_parameter: u8,
    variable_declarator: u8,
    binding_identifier: u8,
    object_pattern: u8,
    array_pattern: u8,
    switch_case: u8,
    // What has no node here.
    chain_expression: u8,
    ts_type_annotation: u8,
    export_default_declaration: u8,
    export_declaration: u8,
    function_body: u8,
    class_body: u8,
    jsx_opening_element: u8,
    ts_interface_body: u8,
    ts_enum_body: u8,
    /// What declares a variable.
    declarations: Kinds,
    /// What has no node in it.
    leaves: Kinds,
    /// What has no node here and is in one that has: a body, an opening tag.
    parts: Kinds,
    /// A bit for each `ExprTag` and for each `StmtTag` that is one of `leaves`.
    leaf_exprs: u64,
    leaf_stmts: u64,
    method_definition: u8,
    property_definition: u8,
    accessor_property: u8,
}

/// A bit for each place in `table` that has one of `kinds`.
fn bits(table: &[u8], kinds: &Kinds) -> u64 {
    let places = table.iter().zip(0u32..).filter(|it| kinds.has(*it.0));
    places.fold(0, |all, it| all | (1 << it.1))
}

pub(super) fn called(kinds: Kinds) -> Called {
    let known = &*KNOWN;
    let bit = |kind: u8, at: u32| u64::from(kinds.has(kind)) << at;
    // All the bits from `first` up to `last`, if the rule is called with `kind`.
    let range = |kind: u8, first: u32, last: u32| match kinds.has(kind) {
        true => ((1u32 << (last + 1)) - 1) & !((1 << first) - 1),
        false => 0,
    };
    Called {
        kinds,
        exprs: bits(&known.exprs, &kinds),
        exprs_without_jsx: bit(known.identifier_reference, ExprTag::Ident as u32)
            | bit(known.string_literal, ExprTag::String as u32),
        stmts: bits(&known.stmts, &kinds),
        binaries: range(known.binary_expression, 0, BinOp::Instanceof as u32)
            | range(
                known.logical_expression,
                BinOp::And as u32,
                BinOp::Nullish as u32,
            )
            | range(
                known.sequence_expression,
                BinOp::Comma as u32,
                BinOp::Comma as u32,
            ),
        unaries: range(known.unary_expression, 0, UnOp::Delete as u32)
            | range(
                known.update_expression,
                UnOp::PreInc as u32,
                UnOp::PostDec as u32,
            ),
        is_odd: kinds.has_any_of(&known.parts),
    }
}

static KNOWN: LazyLock<Known> = LazyLock::new(|| {
    let kind = |name: &str| kind_named(name).unwrap_or(NONE);
    let (mut exprs, mut stmts) = ([ASK; _], [ASK; _]);
    for (tag, name) in [
        (ExprTag::Missing, "JSXEmptyExpression"),
        (ExprTag::PrivateIdentifier, "PrivateIdentifier"),
        (ExprTag::Super, "Super"),
        (ExprTag::Null, "NullLiteral"),
        (ExprTag::True, "BooleanLiteral"),
        (ExprTag::False, "BooleanLiteral"),
        (ExprTag::Number, "NumericLiteral"),
        (ExprTag::BigInt, "BigIntLiteral"),
        (ExprTag::Regex, "RegExpLiteral"),
        (ExprTag::Template, "TemplateLiteral"),
        (ExprTag::TaggedTemplate, "TaggedTemplateExpression"),
        (ExprTag::Index, "ComputedMemberExpression"),
        (ExprTag::Call, "CallExpression"),
        (ExprTag::New, "NewExpression"),
        (ExprTag::Cond, "ConditionalExpression"),
        (ExprTag::Await, "AwaitExpression"),
        (ExprTag::Yield, "YieldExpression"),
        (ExprTag::Satisfies, "TSSatisfiesExpression"),
        (ExprTag::NonNull, "TSNonNullExpression"),
        (ExprTag::Instantiation, "TSInstantiationExpression"),
        (ExprTag::ImportCall, "ImportExpression"),
        (ExprTag::ImportMeta, "ImportMeta"),
        (ExprTag::NewTarget, "NewTarget"),
    ] {
        exprs[tag as usize] = kind(name);
    }
    for (tag, name) in [
        (StmtTag::Empty, "EmptyStatement"),
        (StmtTag::Debugger, "DebuggerStatement"),
        (StmtTag::Var, "VariableDeclaration"),
        (StmtTag::Interface, "TSInterfaceDeclaration"),
        (StmtTag::TypeAlias, "TSTypeAliasDeclaration"),
        (StmtTag::Enum, "TSEnumDeclaration"),
        (StmtTag::Module, "TSNamespaceDeclaration"),
        (StmtTag::Return, "ReturnStatement"),
        (StmtTag::If, "IfStatement"),
        (StmtTag::For, "ForStatement"),
        (StmtTag::ForIn, "ForInStatement"),
        (StmtTag::ForOf, "ForOfStatement"),
        (StmtTag::While, "WhileStatement"),
        (StmtTag::DoWhile, "DoWhileStatement"),
        (StmtTag::Block, "BlockStatement"),
        (StmtTag::Switch, "SwitchStatement"),
        (StmtTag::Try, "TryStatement"),
        (StmtTag::Throw, "ThrowStatement"),
        (StmtTag::Break, "BreakStatement"),
        (StmtTag::Continue, "ContinueStatement"),
        (StmtTag::Labeled, "LabeledStatement"),
        (StmtTag::Import, "ImportDeclaration"),
        (StmtTag::ImportEquals, "TSImportEqualsDeclaration"),
        (StmtTag::ExportStar, "ExportAllDeclaration"),
        (StmtTag::ExportDefault, "ExportDefaultDeclaration"),
        (StmtTag::ExportAssign, "TSExportAssignment"),
        (StmtTag::ExportAsNamespace, "TSNamespaceExportDeclaration"),
    ] {
        stmts[tag as usize] = kind(name);
    }
    let mut declarations = Kinds::default();
    for name in [
        "VariableDeclaration",
        "VariableDeclarator",
        "FormalParameter",
        "CatchParameter",
    ] {
        declarations.insert(kind(name));
    }
    let mut leaves = Kinds::default();
    for name in [
        "IdentifierReference",
        "BindingIdentifier",
        "IdentifierName",
        "PrivateIdentifier",
        "LabelIdentifier",
        "StringLiteral",
        "NumericLiteral",
        "BigIntLiteral",
        "NullLiteral",
        "RegExpLiteral",
        "ThisExpression",
        "ImportMeta",
        "JSXText",
        "DebuggerStatement",
        "BreakStatement",
        "ContinueStatement",
    ] {
        leaves.insert(kind(name));
    }
    let mut parts = Kinds::default();
    for name in [
        "FunctionBody",
        "ClassBody",
        "JSXOpeningElement",
        "TSInterfaceBody",
        "TSEnumBody",
    ] {
        parts.insert(kind(name));
    }
    Known {
        exprs,
        stmts,
        program: kind("Program"),
        identifier_reference: kind("IdentifierReference"),
        string_literal: kind("StringLiteral"),
        static_member_expression: kind("StaticMemberExpression"),
        private_field_expression: kind("PrivateFieldExpression"),
        unary_expression: kind("UnaryExpression"),
        update_expression: kind("UpdateExpression"),
        binary_expression: kind("BinaryExpression"),
        logical_expression: kind("LogicalExpression"),
        sequence_expression: kind("SequenceExpression"),
        function: kind("Function"),
        arrow_function_expression: kind("ArrowFunctionExpression"),
        class: kind("Class"),
        formal_parameter: kind("FormalParameter"),
        catch_parameter: kind("CatchParameter"),
        variable_declarator: kind("VariableDeclarator"),
        binding_identifier: kind("BindingIdentifier"),
        object_pattern: kind("ObjectPattern"),
        array_pattern: kind("ArrayPattern"),
        switch_case: kind("SwitchCase"),
        chain_expression: kind("ChainExpression"),
        ts_type_annotation: kind("TSTypeAnnotation"),
        export_default_declaration: kind("ExportDefaultDeclaration"),
        export_declaration: kind("ExportDeclaration"),
        function_body: kind("FunctionBody"),
        class_body: kind("ClassBody"),
        jsx_opening_element: kind("JSXOpeningElement"),
        ts_interface_body: kind("TSInterfaceBody"),
        ts_enum_body: kind("TSEnumBody"),
        leaf_exprs: bits(&exprs, &leaves)
            | (1 << ExprTag::Ident as u32)
            | (1 << ExprTag::String as u32),
        leaf_stmts: bits(&stmts, &leaves),
        method_definition: kind("MethodDefinition"),
        property_definition: kind("PropertyDefinition"),
        accessor_property: kind("AccessorProperty"),
        declarations,
        leaves,
        parts,
    }
});

/// What oxc calls the node that [`estree_type_name`] names, for what [`Known::kind_of`] leaves. Empty: it has a kind of node for it
/// that no rule is called with.
fn name_in_oxc(node: Node) -> &'static str {
    match (estree_type_name(node), node) {
        ("Identifier", Node::Expr(_)) => "IdentifierReference",
        ("Identifier", _) => "BindingIdentifier",
        ("Literal", _) => "StringLiteral",
        (
            "FunctionDeclaration"
            | "FunctionExpression"
            | "TSDeclareFunction"
            | "TSEmptyBodyFunctionExpression",
            _,
        ) => "Function",
        ("ClassDeclaration" | "ClassExpression", _) => "Class",
        ("Property", Node::PatProp(_)) => "BindingProperty",
        ("Property", Node::Prop(prop)) => match prop.parent() {
            Node::Expr(owner) if is_assignment_target(owner) => match prop.kind() {
                PropKind::Shorthand => "AssignmentTargetPropertyIdentifier",
                _ => "AssignmentTargetPropertyProperty",
            },
            _ => "ObjectProperty",
        },
        ("ObjectPattern", Node::Expr(_)) => "ObjectAssignmentTarget",
        ("ArrayPattern", Node::Expr(_)) => "ArrayAssignmentTarget",
        ("RestElement" | "AssignmentPattern", Node::Expr(_) | Node::Prop(_)) => "",
        ("RestElement", _) => "BindingRestElement",
        ("ExportNamedDeclaration", Node::Stmt(it)) => match it.kind() {
            StmtKind::ExportNamed(export) if export.has_from() => "ExportFromDeclaration",
            _ => "ExportNamedDeclaration",
        },
        ("TSAbstractMethodDefinition", _) => "MethodDefinition",
        ("TSAbstractPropertyDefinition", _) => "PropertyDefinition",
        ("TSAbstractAccessorProperty", _) => "AccessorProperty",
        ("ExpressionStatement", Node::Stmt(it)) if it.directive().is_some() => "Directive",
        (name, _) => name,
    }
}

impl Known {
    /// The kind of the node of oxc that `node` is.
    fn kind_of(&self, node: Node) -> u8 {
        let by_name = || kind_named(name_in_oxc(node)).unwrap_or(NONE);
        match node {
            Node::Expr(e) => {
                let tag = e.tag();
                match (self.exprs.get(tag as usize), tag) {
                    (Some(&ASK), ExprTag::Ident) if !e.is_jsx_tag_name() => {
                        self.identifier_reference
                    }
                    (Some(&ASK), ExprTag::String) if e.file().hir.jsx.is_empty() => {
                        self.string_literal
                    }
                    (Some(&ASK), ExprTag::Dot) if !e.is_jsx_tag_name() && !e.is_in_type_query() => {
                        match e.is_private_member() {
                            true => self.private_field_expression,
                            false => self.static_member_expression,
                        }
                    }
                    (Some(&ASK), ExprTag::Unary) => match e.unary_op() {
                        Some(UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec) => {
                            self.update_expression
                        }
                        _ => self.unary_expression,
                    },
                    (Some(&ASK), ExprTag::Binary) => match e.binary_op() {
                        Some(BinOp::And | BinOp::Or | BinOp::Nullish) => self.logical_expression,
                        Some(BinOp::Comma) => self.sequence_expression,
                        _ => self.binary_expression,
                    },
                    (Some(&ASK), _) => by_name(),
                    (Some(kind), _) => *kind,
                    (None, _) => NONE,
                }
            }
            Node::Stmt(it) => match self.stmts.get(it.tag() as usize) {
                Some(&ASK) => by_name(),
                // It has the tag of a block.
                Some(_) if it.is_with() => by_name(),
                Some(kind) => *kind,
                None => NONE,
            },
            Node::Func(it) => match it.kind() {
                FnKind::Arrow => self.arrow_function_expression,
                FnKind::Decl | FnKind::Expr => self.function,
                FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor => {
                    match it.owner() {
                        // A signature.
                        Node::Member(owner) if !matches!(owner.parent(), Node::Class(_)) => {
                            by_name()
                        }
                        _ => self.function,
                    }
                }
                _ => by_name(),
            },
            Node::Member(it) if matches!(it.parent(), Node::Class(_)) => match it.kind() {
                MemberKind::Property if it.flags().contains(Flags::ACCESSOR) => {
                    self.accessor_property
                }
                MemberKind::Property => self.property_definition,
                MemberKind::Method
                | MemberKind::Getter
                | MemberKind::Setter
                | MemberKind::Constructor => self.method_definition,
                _ => by_name(),
            },
            Node::Class(_) => self.class,
            Node::Param(_) => self.formal_parameter,
            Node::VarDecl(it) => match it.parent() {
                Node::Stmt(owner) if owner.tag() == StmtTag::Try => self.catch_parameter,
                _ => self.variable_declarator,
            },
            Node::Pat(it) => match it.kind() {
                PatKind::Ident(_) | PatKind::Missing => self.binding_identifier,
                PatKind::Object(_) => self.object_pattern,
                PatKind::Array(_) => self.array_pattern,
            },
            Node::Case(_) => self.switch_case,
            Node::File(_) => self.program,
            _ => by_name(),
        }
    }

    /// The innermost of the nodes of oxc that `node` stands for that is of one of `kinds` and that `fits`.
    fn one_of<'a>(
        &self,
        node: Node<'a>,
        kinds: &Kinds,
        fits: &dyn Fn(Span) -> bool,
    ) -> Option<Found<'a>> {
        let found = |span: Span, level: u8, is_leaf: bool| {
            fits(span).then_some(Found {
                span,
                node,
                level,
                is_leaf,
            })
        };
        let part = match node {
            _ if !kinds.has_any_of(&self.parts) => None,
            Node::Func(it) if kinds.has(self.function_body) => it.body_span(),
            Node::Class(it) if kinds.has(self.class_body) => Some(it.body_span()),
            Node::Stmt(it) => match it.kind() {
                StmtKind::Interface(it) if kinds.has(self.ts_interface_body) => {
                    Some(it.body_span())
                }
                StmtKind::Enum(it) if kinds.has(self.ts_enum_body) => Some(it.body_span()),
                _ => None,
            },
            Node::Expr(e) if kinds.has(self.jsx_opening_element) => match e.kind() {
                ExprKind::Jsx(jsx) if !jsx.is_fragment() => Some(jsx.opening_span()),
                _ => None,
            },
            _ => None,
        };
        if let Some(found) = part.and_then(|it| found(it, PART, false)) {
            return Some(found);
        }
        let kind = self.kind_of(node);
        if kinds.has(kind)
            && let Some(found) = found(estree_span(node), ITSELF, self.leaves.has(kind))
        {
            return Some(found);
        }
        if kinds.has(self.chain_expression)
            && matches!(node, Node::Expr(e) if is_chain_root(e))
            && let Some(found) = found(estree_span(node), CHAIN, false)
        {
            return Some(found);
        }
        // The `: T` of a variable, a parameter or a property, or of what a function returns.
        if kinds.has(self.ts_type_annotation)
            && let Node::Type(ty) = node
            && matches!(
                ty.parent(),
                Node::Param(_) | Node::VarDecl(_) | Node::Pat(_) | Node::Member(_) | Node::Func(_)
            )
            && let Some(found) = found(ty.annotation_span(), CHAIN, false)
        {
            return Some(found);
        }
        if !kinds.has(self.export_declaration) && !kinds.has(self.export_default_declaration) {
            return None;
        }
        let statement = node.as_written().as_stmt()?;
        let kind = match statement.is_default_export() {
            true => self.export_default_declaration,
            false => self.export_declaration,
        };
        let whole = statement.export_span().filter(|_| kinds.has(kind))?;
        found(whole, EXPORT, false)
    }
}

// Which of the nodes of oxc that a node here stands for, from the outside in.
const EXPORT: u8 = 0;
/// A `ChainExpression`, or the annotation that a type is in.
const CHAIN: u8 = 1;
const ITSELF: u8 = 2;
/// A body, or the opening tag.
const PART: u8 = 3;
const LEVELS: u32 = 4;

/// A node of oxc.
#[derive(Copy, Clone)]
struct Found<'a> {
    span: Span,
    /// What stands for it here.
    node: Node<'a>,
    level: u8,
    /// It has no node in it.
    is_leaf: bool,
}

/// Where a node of oxc is written. `node`: what stands for it here, and which of its nodes it is. `None`: it has no node in it, so
/// that nothing with its span is deeper, or it is not found, and what is reported stands in for it.
#[derive(Copy, Clone)]
pub(super) struct Place {
    pub(super) span: Span,
    pub(super) node: Option<(Packed, u8)>,
}

/// How many nodes of oxc are around the one that `node` and `level` are and are written at `span` as it is: a walk enters them
/// before it.
pub(super) fn depth<'a>(file: &'a File<'a>, (node, level): (Packed, u8), span: Span) -> u32 {
    let mut at = node.unpack(file);
    let mut around = u32::from(level == PART && estree_span(at) == span);
    while !matches!(at, Node::File(_)) {
        at = estree_parent(at);
        if estree_span(at) != span {
            break;
        }
        around += 1;
    }
    around * LEVELS + u32::from(level)
}

/// The pattern that declares the variable that the name at `label` refers to, if it is a variable or a parameter.
fn declaration_of<'a>(file: &'a File<'a>, label: Span) -> Option<Pat<'a>> {
    let reference = file.reference_at(label.start);
    let reference = reference.filter(|it| it.span() == label)?;
    match reference.symbol()?.declarations().next()? {
        Declaration::Var(pat) | Declaration::Param(pat) => {
            Some(pat).filter(|it| it.span() != label)
        }
        _ => None,
    }
}

/// The value of what has a name or a key beside it.
fn value_of(node: Node) -> Option<Node> {
    let value = match node {
        Node::Member(it) => match it.func() {
            Some(func) => return Some(Node::Func(func)),
            None => it.init(),
        },
        Node::Prop(it) => it.value(),
        Node::VarDecl(it) => it.init(),
        _ => None,
    };
    Some(normalize(Node::Expr(value?)))
}

/// Finds the nodes for what is reported about a file.
pub(super) struct Places<'a> {
    file: &'a File<'a>,
    known: &'static Known,
    has_no_jsx: bool,
    /// Where the last search ended, and where what it was for starts.
    last: Node<'a>,
    last_start: u32,
    /// For each rule that has gone far up: what it has found there.
    far: FxHashMap<u16, AncestorMemo<'a, Found<'a>>>,
}

impl<'a> Places<'a> {
    pub(super) fn new(file: &'a File<'a>) -> Self {
        Places {
            file,
            known: &KNOWN,
            has_no_jsx: file.hir.jsx.is_empty(),
            last: Node::File(file),
            last_start: 0,
            far: FxHashMap::default(),
        }
    }

    /// [`Places::of`] for most of what is reported: `node`, which `it` has, is an expression or a statement that oxlint calls the
    /// rule with. `None`: it is not, or it takes more than a look to tell.
    #[inline]
    pub(super) fn at_a_look(
        &self,
        called: &Called,
        node: Packed,
        it: &Diagnostic,
    ) -> Option<Place> {
        if called.is_odd {
            return None;
        }
        let known = self.known;
        let (node, level, is_leaf, span) = match node.unpack(self.file) {
            Node::Expr(e) => {
                let tag = e.tag();
                let tags = called.exprs
                    | if self.has_no_jsx {
                        called.exprs_without_jsx
                    } else {
                        0
                    };
                let is_called_with = (tags >> tag as u32) & 1 != 0
                    || match tag {
                        ExprTag::Binary => (called.binaries >> e.binary_op()? as u32) & 1 != 0,
                        ExprTag::Unary => (called.unaries >> e.unary_op()? as u32) & 1 != 0,
                        // They are other nodes.
                        ExprTag::Fn | ExprTag::Class => return None,
                        _ => {
                            known.exprs.get(tag as usize) == Some(&ASK)
                                && called.kinds.has(known.kind_of(Node::Expr(e)))
                        }
                    };
                let level = match is_called_with {
                    true => ITSELF,
                    false if called.kinds.has(known.chain_expression) && is_chain_root(e) => CHAIN,
                    false => return None,
                };
                let span = if it.states_node { e.span() } else { it.span };
                let is_leaf = level == ITSELF && (known.leaf_exprs >> tag as u32) & 1 != 0;
                (node, level, is_leaf, span)
            }
            Node::Stmt(statement) => {
                let tag = statement.tag();
                // With an `export` before it, it is in another node, which starts there.
                if (called.stmts >> tag as u32) & 1 == 0
                    || statement.is_exported()
                    || statement.is_with()
                {
                    return None;
                }
                let span = if it.states_node {
                    statement.span()
                } else {
                    it.span
                };
                (
                    node,
                    ITSELF,
                    (known.leaf_stmts >> tag as u32) & 1 != 0,
                    span,
                )
            }
            other => {
                let other = normalize(other);
                let kind = known.kind_of(other);
                if !called.kinds.has(kind) {
                    return None;
                }
                (
                    other.packed(),
                    ITSELF,
                    known.leaves.has(kind),
                    estree_span(other),
                )
            }
        };
        Some(Place {
            span,
            node: (!is_leaf).then_some((node, level)),
        })
    }

    /// The innermost node around `label`.
    ///
    /// It goes up from `last`, and then down. That is where the last search ended, or a node that starts after what that was for and
    /// no later than `label`. What is asked for comes by where it starts, the longer first, which is the order in which a walk
    /// enters the nodes. So a node that is left is not come back to, and all the searches together go along each edge of the
    /// tree once up and once down.
    fn innermost_around(&self, label: Span) -> Node<'a> {
        let is_around = |it: Node| {
            let span = it.span();
            span.contains_offset(label.start) && label.end <= span.end
        };
        let mut at = self.last;
        while !matches!(at, Node::File(_)) && !is_around(at) {
            at = at.parent();
        }
        loop {
            let mut inner = None;
            at.for_each_child_near(label.start, |child| {
                if inner.is_none() && is_around(child) {
                    inner = Some(child);
                }
            });
            match inner {
                Some(child) => at = child,
                None => return at,
            }
        }
    }

    /// `from`: the innermost node around `label`. Without a `label` it is what is reported.
    fn find(&mut self, rule: u16, kinds: &Kinds, from: Node<'a>, label: Option<Span>) -> Place {
        let known = self.known;
        // One node for what oxc has one node for.
        let from = match from {
            Node::Expr(e) if !matches!(e.tag(), ExprTag::Fn | ExprTag::Class) => from,
            Node::Stmt(it) if !matches!(it.tag(), StmtTag::Fn | StmtTag::Class) => from,
            _ => normalize(from),
        };
        let place_of = |found: Found<'a>| Place {
            span: found.span,
            node: (!found.is_leaf).then(|| (found.node.packed(), found.level)),
        };
        // Most rules report the node that they are called with.
        let kind = known.kind_of(from);
        let own = estree_span(from);
        if label.is_none() && kinds.has(kind) && !kinds.has_any_of(&known.parts) {
            return place_of(Found {
                span: own,
                node: from,
                level: ITSELF,
                is_leaf: known.leaves.has(kind),
            });
        }
        // Or they are called with a part of it: the opening tag of the element, the body of the function.
        if label.is_none()
            && let Some(found) = known.one_of(from, kinds, &|_| true)
        {
            return place_of(found);
        }
        let label = label.unwrap_or(own);
        let nowhere = Place {
            span: label,
            node: None,
        };
        let (around, beside) = (
            |it: Span| it.contains(label),
            |it: Span| it.start >= label.end,
        );
        if let Some(found) = known.one_of(from, kinds, &around) {
            return place_of(found);
        }
        if kinds.are_among(&known.leaves) {
            return nowhere;
        }
        // What is reported can be a name or a key, and the rule called with the value: the function of a method.
        let value = |node: Node<'a>| known.one_of(value_of(node)?, kinds, &beside);
        let parent = estree_parent(from);
        let found = value(from)
            .or_else(|| known.one_of(parent, kinds, &around))
            .or_else(|| value(parent))
            .or_else(|| {
                let far = self.far.entry(rule).or_default();
                far.find_with(parent, estree_parent, |child, node| {
                    known.one_of(node, kinds, &|it| it.contains(estree_span(child)))
                })
            });
        found.map_or(nowhere, place_of)
    }

    /// The node that oxlint calls the rule with index `rule` with when it reports `label`. `kinds`: those that it calls the rule
    /// with. `node`: what is reported, if it is a node, or what the rule says. `None`: it takes [`Places::search`].
    pub(super) fn of(
        &mut self,
        rule: u16,
        kinds: &Kinds,
        label: Span,
        node: Option<Packed>,
    ) -> Option<Place> {
        // A rule that is called with declarations alone and reports a name elsewhere reports how the variable is used.
        if kinds.are_among(&self.known.declarations)
            && !kinds.is_empty()
            && let Some(pat) = declaration_of(self.file, label)
        {
            return Some(self.find(rule, kinds, Node::Pat(pat), None));
        }
        let node = node?.unpack(self.file);
        Some(self.find(rule, kinds, node, None))
    }

    /// [`Places::of`] for a token, a name or a span. To be asked by where they start, the longer first. `near`: a node that starts
    /// no later, and where.
    pub(super) fn search(
        &mut self,
        rule: u16,
        kinds: &Kinds,
        label: Span,
        near: Option<(u32, Packed)>,
    ) -> Place {
        if let Some((start, node)) = near
            && start > self.last_start
        {
            self.last = node.unpack(self.file);
        }
        let from = self.innermost_around(label);
        (self.last, self.last_start) = (from, label.start);
        self.find(rule, kinds, from, Some(label))
    }
}
