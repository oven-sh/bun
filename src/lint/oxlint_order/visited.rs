//! With which node oxlint calls a rule for what the rule reports.
//!
//! Nothing records that while the rules here run: a file about which nothing is reported is not to pay for it. So the node is
//! found again, from what is reported and from the kinds of node that oxlint calls the rule with. Most rules report the node
//! that they are called with, or something in it. A rule that does neither says which node it is: `Report::listened_on`.
//!
//! All the searches of a file together take time in proportion to the number of its nodes and of what is reported, whatever its
//! shape. A report keeps the node that it was given, so most searches start there. One for a token or a name starts where the
//! last ended: see [`Places::innermost_around`]. The way up is short, or it is remembered: [`AncestorMemo`].

use super::{Kinds, kind_named};
use crate::ast::{
    BinOp, ExprKind, ExprTag, File, FnKind, Node, Packed, Pat, PatKind, PropKind, StmtKind,
    StmtTag, UnOp,
};
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
    export_default_declaration: u8,
    export_declaration: u8,
    function_body: u8,
    class_body: u8,
    jsx_opening_element: u8,
    ts_interface_body: u8,
    ts_enum_body: u8,
    /// What declares a variable.
    declarations: Kinds,
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
        export_default_declaration: kind("ExportDefaultDeclaration"),
        export_declaration: kind("ExportDeclaration"),
        function_body: kind("FunctionBody"),
        class_body: kind("ClassBody"),
        jsx_opening_element: kind("JSXOpeningElement"),
        ts_interface_body: kind("TSInterfaceBody"),
        ts_enum_body: kind("TSEnumBody"),
        declarations,
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
            Node::Expr(e) => match self.exprs.get(e.tag() as usize) {
                Some(&ASK) => match e.kind() {
                    ExprKind::Ident(_) if !e.is_jsx_tag_name() => self.identifier_reference,
                    ExprKind::String(_) if e.file().hir.jsx.is_empty() => self.string_literal,
                    ExprKind::Dot { .. } if !e.is_jsx_tag_name() && !e.is_in_type_query() => {
                        match e.is_private_member() {
                            true => self.private_field_expression,
                            false => self.static_member_expression,
                        }
                    }
                    ExprKind::Unary { op, .. } => match op {
                        UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => {
                            self.update_expression
                        }
                        _ => self.unary_expression,
                    },
                    ExprKind::Binary { op, .. } => match op {
                        BinOp::And | BinOp::Or | BinOp::Nullish => self.logical_expression,
                        BinOp::Comma => self.sequence_expression,
                        _ => self.binary_expression,
                    },
                    _ => by_name(),
                },
                Some(kind) => *kind,
                None => NONE,
            },
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
        fits: impl Fn(Span) -> bool,
    ) -> Option<Found<'a>> {
        let found = |span: Span, level: u8| fits(span).then_some(Found { span, node, level });
        let within = match node {
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
        if let Some(found) = within.and_then(|it| found(it, WITHIN)) {
            return Some(found);
        }
        if kinds.has(self.kind_of(node))
            && let Some(found) = found(estree_span(node), ITSELF)
        {
            return Some(found);
        }
        if kinds.has(self.chain_expression)
            && matches!(node, Node::Expr(e) if is_chain_root(e))
            && let Some(found) = found(estree_span(node), CHAIN)
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
        found(statement.export_span().filter(|_| kinds.has(kind))?, EXPORT)
    }
}

// Which of the nodes of oxc that a node here stands for, from the outside in.
const EXPORT: u8 = 0;
const CHAIN: u8 = 1;
const ITSELF: u8 = 2;
/// A body, or the opening tag.
const WITHIN: u8 = 3;
const LEVELS: u32 = 4;

/// A node of oxc.
#[derive(Copy, Clone)]
struct Found<'a> {
    span: Span,
    /// What stands for it here.
    node: Node<'a>,
    level: u8,
}

/// Where a node of oxc is written. `node`: what stands for it here, and which of its nodes it is. `None`: it is not found, and what
/// is reported stands in for it.
pub(super) struct Place {
    pub(super) span: Span,
    pub(super) node: Option<(Packed, u8)>,
}

/// How many nodes of oxc are around the one that `node` and `level` are and are written at `span` as it is: a walk enters them
/// before it.
pub(super) fn depth<'a>(file: &'a File<'a>, (node, level): (Packed, u8), span: Span) -> u32 {
    let mut at = node.unpack(file);
    let mut around = u32::from(level == WITHIN && estree_span(at) == span);
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
    /// Where the last search ended.
    last: Node<'a>,
    /// For each rule that has gone far up: what it has found there.
    far: FxHashMap<u16, AncestorMemo<'a, Found<'a>>>,
}

impl<'a> Places<'a> {
    pub(super) fn new(file: &'a File<'a>) -> Self {
        Places {
            file,
            known: &KNOWN,
            last: Node::File(file),
            far: FxHashMap::default(),
        }
    }

    /// The innermost node around `label`.
    ///
    /// It goes up from where the last search ended, and then down. What is asked for comes by where it starts, the longer first,
    /// which is the order in which a walk enters the nodes. So a node that is left is not come back to, and all the searches
    /// together go along each edge of the tree once up and once down.
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

    /// `from`: the innermost node around `label`.
    fn find(&mut self, rule: u16, kinds: &Kinds, from: Node<'a>, label: Span) -> Option<Found<'a>> {
        let known = self.known;
        let parent = estree_parent(from);
        for node in [from, parent] {
            if let Some(found) = known.one_of(node, kinds, |it| it.contains(label)) {
                return Some(found);
            }
            // What is reported is a name or a key, and the rule is called with the value: the function of a method.
            if let Some(value) = value_of(node)
                && let Some(found) = known.one_of(value, kinds, |it| it.start >= label.end)
            {
                return Some(found);
            }
        }
        let far = self.far.entry(rule).or_default();
        far.find_with(parent, estree_parent, |child, node| {
            known.one_of(node, kinds, |it| it.contains(estree_span(child)))
        })
    }

    /// The node that oxlint calls the rule with index `rule` with when it reports `label`. `kinds`: those that it calls the rule
    /// with. `node`: what `label` is, if it is a node.
    pub(super) fn of(
        &mut self,
        rule: u16,
        kinds: &Kinds,
        label: Span,
        node: Option<Packed>,
    ) -> Place {
        if kinds.is_empty() {
            return Place {
                span: label,
                node: None,
            };
        }
        // A rule that is called with declarations alone and reports a name elsewhere reports how the variable is used.
        let declaration = match kinds.are_among(&self.known.declarations) {
            true => declaration_of(self.file, label),
            false => None,
        };
        let (from, label) = match (declaration, node) {
            (Some(pat), _) => (Node::Pat(pat), pat.span()),
            (None, Some(node)) => (node.unpack(self.file), label),
            (None, None) => (self.innermost_around(label), label),
        };
        if declaration.is_none() {
            self.last = from;
        }
        match self.find(rule, kinds, normalize(from), label) {
            Some(found) => Place {
                span: found.span,
                node: Some((found.node.packed(), found.level)),
            },
            None => Place {
                span: label,
                node: None,
            },
        }
    }
}
