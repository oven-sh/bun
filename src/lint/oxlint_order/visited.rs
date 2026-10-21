//! Finds the node that oxlint calls a rule with when the rule reports a diagnostic.
//!
//! Nothing records that node while our rules run, so a file without diagnostics pays nothing for it. Instead the node
//! is reconstructed from the diagnostic and from the node kinds oxlint calls the rule with. Most rules report the node
//! they're called with, or something inside it. A rule that does neither states the node with `Report::called_with`.
//!
//! All the searches in a file together take time proportional to the number of nodes plus the number of diagnostics,
//! whatever the tree's shape. A diagnostic keeps the node it was given, so most searches start there. A search for a
//! token or a name starts where the previous one ended (see [`NodeFinder::innermost_enclosing`]). The walk up is either
//! short or memoized with [`AncestorMemo`].

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

/// A kind that no rule is called with.
const NONE: u8 = u8::MAX;
/// The tag isn't enough to determine the kind.
const ASK: u8 = u8::MAX - 1;

/// The kinds that this file refers to by name, as indices in `KINDS`.
struct Known {
    /// The kind for each tag.
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
    // Kinds that have no node in our tree.
    chain_expression: u8,
    ts_type_annotation: u8,
    export_default_declaration: u8,
    export_declaration: u8,
    function_body: u8,
    class_body: u8,
    jsx_opening_element: u8,
    ts_interface_body: u8,
    ts_enum_body: u8,
    /// Kinds that declare a variable.
    declarations: Kinds,
    /// Kinds that have no child nodes.
    leaves: Kinds,
    /// Kinds that have no node in our tree but are part of one that does: a body, an opening tag.
    parts: Kinds,
    /// One bit per `ExprTag`, and one per `StmtTag`, that's one of `leaves`.
    leaf_exprs: u64,
    leaf_stmts: u64,
    method_definition: u8,
    property_definition: u8,
    accessor_property: u8,
}

/// One bit per index in `table` whose entry is one of `kinds`.
fn bits(table: &[u8], kinds: &Kinds) -> u64 {
    let matching = table.iter().zip(0u32..).filter(|it| kinds.has(*it.0));
    matching.fold(0, |all, it| all | (1 << it.1))
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
        needs_part_lookup: kinds.has_any_of(&known.parts),
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

/// oxc's name for `node`, derived from its [`estree_type_name`]. Covers the nodes that [`Known::kind_of`] doesn't
/// handle itself. Empty if oxc has a node kind for it that no rule is called with.
fn oxc_kind_name(node: Node) -> &'static str {
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
    /// The kind of the oxc node that corresponds to `node`.
    fn kind_of(&self, node: Node) -> u8 {
        let by_name = || kind_named(oxc_kind_name(node)).unwrap_or(NONE);
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
                // A `with` statement has a block's tag.
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

    /// Of the oxc nodes that `node` represents, the innermost one whose kind is in `kinds` and whose span satisfies
    /// `accepts`.
    fn innermost_match<'a>(
        &self,
        node: Node<'a>,
        kinds: &Kinds,
        accepts: &dyn Fn(Span) -> bool,
    ) -> Option<Found<'a>> {
        let found = |span: Span, level: u8, is_leaf: bool| {
            accepts(span).then_some(Found {
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
        // The `: T` of a variable, a parameter, a property or a function's return type.
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
        let statement = node.owner_or_self().as_stmt()?;
        let kind = match statement.is_default_export() {
            true => self.export_default_declaration,
            false => self.export_declaration,
        };
        let whole = statement.export_span().filter(|_| kinds.has(kind))?;
        found(whole, EXPORT, false)
    }
}

// Levels: the oxc nodes that one of our nodes can represent, from the outside in.
const EXPORT: u8 = 0;
/// A `ChainExpression`, or the annotation around a type.
const CHAIN: u8 = 1;
const ITSELF: u8 = 2;
/// A body, or the opening tag.
const PART: u8 = 3;
const LEVELS: u32 = 4;

/// An oxc node.
#[derive(Copy, Clone)]
struct Found<'a> {
    span: Span,
    /// The node that represents it in our tree.
    node: Node<'a>,
    level: u8,
    /// True if it has no child nodes.
    is_leaf: bool,
}

/// An oxc node's span. `node` is the node that represents it in our tree, and its level. `node` is `None` for a leaf,
/// since nothing with the same span can be deeper, and for a node that wasn't found, where the diagnostic's span
/// replaces it.
#[derive(Copy, Clone)]
pub(super) struct CalledNode {
    pub(super) span: Span,
    pub(super) node: Option<(Packed, u8)>,
}

/// How many oxc nodes enclose the one identified by `node` and `level` and have the same `span`. A pre-order walk
/// enters those first.
pub(super) fn depth<'a>(file: &'a File<'a>, (node, level): (Packed, u8), span: Span) -> u32 {
    let mut at = node.unpack(file);
    let mut enclosing = u32::from(level == PART && estree_span(at) == span);
    while !matches!(at, Node::File(_)) {
        at = estree_parent(at);
        if estree_span(at) != span {
            break;
        }
        enclosing += 1;
    }
    enclosing * LEVELS + u32::from(level)
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

/// The value of a node that has a name or key and a value.
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

/// Finds the nodes for a file's diagnostics.
pub(super) struct NodeFinder<'a> {
    file: &'a File<'a>,
    known: &'static Known,
    has_no_jsx: bool,
    /// The node where the last search ended, and the start of the span it searched for.
    last: Node<'a>,
    last_start: u32,
    /// Memoized results for each rule that had to walk far up the tree.
    far: FxHashMap<u16, AncestorMemo<'a, Found<'a>>>,
}

impl<'a> NodeFinder<'a> {
    pub(super) fn new(file: &'a File<'a>) -> Self {
        NodeFinder {
            file,
            known: &KNOWN,
            has_no_jsx: file.hir.jsx.is_empty(),
            last: Node::File(file),
            last_start: 0,
            far: FxHashMap::default(),
        }
    }

    /// The fast path of [`NodeFinder::of`], which covers most diagnostics: `node`, the node of `it`, is an expression
    /// or statement that oxlint calls the rule with. `None` if it isn't, or if a bit test can't tell.
    #[inline]
    pub(super) fn by_bit_test(
        &self,
        called: &Called,
        node: Packed,
        it: &Diagnostic,
    ) -> Option<CalledNode> {
        if called.needs_part_lookup {
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
                        // Functions and classes are separate nodes.
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
                let span = if it.has_explicit_node {
                    e.span()
                } else {
                    it.span
                };
                let is_leaf = level == ITSELF && (known.leaf_exprs >> tag as u32) & 1 != 0;
                (node, level, is_leaf, span)
            }
            Node::Stmt(statement) => {
                let tag = statement.tag();
                // An exported statement is inside another oxc node, which starts at the `export`.
                if (called.stmts >> tag as u32) & 1 == 0
                    || statement.is_exported()
                    || statement.is_with()
                {
                    return None;
                }
                let span = if it.has_explicit_node {
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
        Some(CalledNode {
            span,
            node: (!is_leaf).then_some((node, level)),
        })
    }

    /// The innermost node around `label`.
    ///
    /// It walks up from `last`, then down. `last` is where the previous search ended, or a node that starts after the
    /// previous search's span and no later than `label`. Searches come sorted by start, longer first, which is
    /// pre-order. So a node that has been left is never visited again, and all the searches together traverse each edge
    /// of the tree once up and once down.
    fn innermost_enclosing(&self, label: Span) -> Node<'a> {
        let encloses = |it: Node| {
            let span = it.span();
            span.contains_offset(label.start) && label.end <= span.end
        };
        let mut at = self.last;
        while !matches!(at, Node::File(_)) && !encloses(at) {
            at = at.parent();
        }
        loop {
            let mut inner = None;
            at.for_each_child_near(label.start, |child| {
                if inner.is_none() && encloses(child) {
                    inner = Some(child);
                }
            });
            match inner {
                Some(child) => at = child,
                None => return at,
            }
        }
    }

    /// `from` is the innermost node around `label`, or without a `label`, the reported node.
    fn find(
        &mut self,
        rule: u16,
        kinds: &Kinds,
        from: Node<'a>,
        label: Option<Span>,
    ) -> CalledNode {
        let known = self.known;
        // Normalize to a single node where oxc has a single node.
        let from = match from {
            Node::Expr(e) if !matches!(e.tag(), ExprTag::Fn | ExprTag::Class) => from,
            Node::Stmt(it) if !matches!(it.tag(), StmtTag::Fn | StmtTag::Class) => from,
            _ => normalize(from),
        };
        let called_node_of = |found: Found<'a>| CalledNode {
            span: found.span,
            node: (!found.is_leaf).then(|| (found.node.packed(), found.level)),
        };
        // Most rules report the node they're called with.
        let kind = known.kind_of(from);
        let own = estree_span(from);
        if label.is_none() && kinds.has(kind) && !kinds.has_any_of(&known.parts) {
            return called_node_of(Found {
                span: own,
                node: from,
                level: ITSELF,
                is_leaf: known.leaves.has(kind),
            });
        }
        // Or they're called with a part of it: an element's opening tag, a function's body.
        if label.is_none()
            && let Some(found) = known.innermost_match(from, kinds, &|_| true)
        {
            return called_node_of(found);
        }
        let label = label.unwrap_or(own);
        let not_found = CalledNode {
            span: label,
            node: None,
        };
        let (contains_label, follows_label) = (
            |it: Span| it.contains(label),
            |it: Span| it.start >= label.end,
        );
        if let Some(found) = known.innermost_match(from, kinds, &contains_label) {
            return called_node_of(found);
        }
        if kinds.is_subset_of(&known.leaves) {
            return not_found;
        }
        // The rule may report a name or a key but be called with the value, like a method's function.
        let value = |node: Node<'a>| known.innermost_match(value_of(node)?, kinds, &follows_label);
        let parent = estree_parent(from);
        let found = value(from)
            .or_else(|| known.innermost_match(parent, kinds, &contains_label))
            .or_else(|| value(parent))
            .or_else(|| {
                let far = self.far.entry(rule).or_default();
                far.find_with(parent, estree_parent, |child, node| {
                    known.innermost_match(node, kinds, &|it| it.contains(estree_span(child)))
                })
            });
        found.map_or(not_found, called_node_of)
    }

    /// The node that oxlint calls the rule with index `rule` with when it reports `label`. `kinds` are the kinds it
    /// calls the rule with. `node` is the reported node, if a node was reported, or the node the rule stated. Returns
    /// `None` if [`NodeFinder::search`] is needed.
    pub(super) fn of(
        &mut self,
        rule: u16,
        kinds: &Kinds,
        label: Span,
        node: Option<Packed>,
    ) -> Option<CalledNode> {
        // A rule that's only called with declarations but reports a name elsewhere is reporting a use of that variable.
        if kinds.is_subset_of(&self.known.declarations)
            && !kinds.is_empty()
            && let Some(pat) = declaration_of(self.file, label)
        {
            return Some(self.find(rule, kinds, Node::Pat(pat), None));
        }
        let node = node?.unpack(self.file);
        Some(self.find(rule, kinds, node, None))
    }

    /// [`NodeFinder::of`] for a token, a name or a span. Calls must come sorted by start, longer first. `near` is a
    /// node that starts no later than `label`, with its start.
    pub(super) fn search(
        &mut self,
        rule: u16,
        kinds: &Kinds,
        label: Span,
        near: Option<(u32, Packed)>,
    ) -> CalledNode {
        if let Some((start, node)) = near
            && start > self.last_start
        {
            self.last = node.unpack(self.file);
        }
        let from = self.innermost_enclosing(label);
        (self.last, self.last_start) = (from, label.start);
        self.find(rule, kinds, from, Some(label))
    }
}
