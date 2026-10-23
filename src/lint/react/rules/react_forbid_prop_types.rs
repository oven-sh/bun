use crate::util_ast::{find_return_statement, get_property_name};
use crate::util_is_create_element::is_member_called;
use crate::util_prop_wrapper::is_prop_wrapper_function;
use crate::util_props::{
    is_child_context_types_declaration, is_context_types_declaration, is_prop_types_declaration, is_required_prop_type,
};
use crate::util_variable::{Found, find_variable_by_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::source::mention_bit;
use rustc_hash::FxHashMap;
use std::ops::Range;

/// Disallow certain propTypes.
pub struct ForbidPropTypes {
    forbid: Vec<Box<[u8]>>,
    /// `mention_bit` of each name in `forbid`, and of the private name with the same text.
    bits_of_forbidden: Vec<u32>,
    check_context_types: bool,
    check_child_context_types: bool,
}

const FORBIDDEN_PROP_TYPE: Message = Message::new("forbiddenPropType", "Prop type \"{{target}}\" is forbidden");

/// The variables that the `ImportDeclaration` listener sets.
#[derive(Copy, Clone, Default)]
struct Packages<'a> {
    prop_types_package_name: Option<Name<'a>>,
    react_package_name: Option<Name<'a>>,
    is_foreign_prop_types_package: bool,
}

/// An import that sets one of those variables. Only recorded once a foreign package has been imported, because the
/// names don't matter before that.
struct Imported<'a> {
    start: u32,
    /// The variables' values after this import.
    packages: Packages<'a>,
}

/// The node that one of upstream's listeners is called with.
struct ListenerNode<'a> {
    span: Span,
    /// The number of `State::imports` before it.
    imports: usize,
    /// The variables' values at that point.
    packages: Packages<'a>,
}

#[derive(Copy, Clone)]
struct Forbidden<'a> {
    listener_node: Span,
    declaration: Span,
    target: &'a [u8],
}

pub struct State<'a> {
    /// In source order.
    imports: Vec<Imported<'a>>,
    /// Reported in `finish`, so that two reports about the same property come in upstream's traversal order.
    forbidden: Vec<Forbidden<'a>>,
    /// Maps (start of a variable's object literal, `ListenerNode::imports`) to the range of `forbidden` that's about
    /// it.
    known: FxHashMap<(u32, usize), Range<usize>>,
}

impl Rule for ForbidPropTypes {
    const META: Meta = Meta::plugin(Plugin::React, "forbid-prop-types", Kind::None);
    const ON: On = On::new()
        .exprs(&[ExprTag::Assign, ExprTag::Binary, ExprTag::Call])
        .stmts(&[StmtTag::ForIn, StmtTag::ForOf])
        .members()
        .props()
        .finish();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let configuration = options.object(0);
        let forbid = match configuration.has("forbid") {
            true => configuration.strings("forbid"),
            false => vec!["any", "array", "object"],
        };
        let bits_of = |it: &&str| [mention_bit(it.as_bytes()), mention_bit(format!("#{it}").as_bytes())];
        ForbidPropTypes {
            bits_of_forbidden: forbid.iter().flat_map(bits_of).collect(),
            forbid: forbid.into_iter().map(|it| it.as_bytes().into()).collect(),
            check_context_types: configuration.bool_or("checkContextTypes", false),
            check_child_context_types: configuration.bool_or("checkChildContextTypes", false),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new()
            .exprs(&[ExprTag::Assign, ExprTag::Binary])
            .stmts(&[StmtTag::ForIn, StmtTag::ForOf])
            .finish();
        if file.mentions_any(&["shape", "#shape"]) {
            on = on.exprs(&[ExprTag::Call]);
        }
        let (context, child_context) = (self.check_context_types, self.check_child_context_types);
        if file.mentions("propTypes")
            || (context && file.mentions("contextTypes"))
            || (child_context && file.mentions("childContextTypes"))
        {
            return on.members().props();
        }
        // Private names, and the fields with a type annotation that upstream treats as declarations.
        if file.mentions_any(&["#propTypes", "props", "#props"])
            || (context && file.mentions_any(&["#contextTypes", "context", "#context"]))
            || (child_context && file.mentions("#childContextTypes"))
        {
            on = on.members();
        }
        on
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        if !self.bits_of_forbidden.iter().any(|bit| file.mentions_bit(*bit)) {
            return None;
        }
        Some(State { imports: imports_of(file), forbidden: Vec::new(), known: FxHashMap::default() })
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(call) = e.as_call() {
            self.call_expression(e, call, cx);
        } else if let (Some(left), Some(right)) = (e.left(), e.right())
            && e.binary_op() != Some(BinOp::Comma)
        {
            self.member_expression(left, right, cx);
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::ForIn { left, expr: right, .. } | StmtKind::ForOf { left, expr: right, .. } = statement.kind()
            && let StmtKind::Expr(left) = left.kind()
        {
            self.member_expression(left, right, cx);
        }
    }

    /// `PropertyDefinition`, `MethodDefinition`
    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        let is_method = match member.kind() {
            MemberKind::Property => false,
            MemberKind::Method | MemberKind::Getter | MemberKind::Setter => true,
            _ => return,
        };
        if !self.is_checked_declaration(Node::Member(member)) {
            return;
        }
        let value = match is_method {
            true if member.flags().contains(Flags::ABSTRACT) => None,
            true => find_return_statement(Node::Member(member)).and_then(|it| match it.kind() {
                StmtKind::Return(argument) => argument,
                _ => None,
            }),
            false if ast_utils::is_property_definition(member) => member.init(),
            false => None,
        };
        if let Some(value) = value {
            self.check_node(value, &cx.state.listener_node(member.span()), cx);
        }
    }

    /// `ObjectExpression`, for one of its properties.
    fn prop<'a>(&self, property: Prop<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(value) = property.value()
            && let ExprKind::Object(properties) = value.kind()
            && self.is_checked_declaration(Node::Prop(property))
            && let Node::Expr(object) = property.parent()
            && !object.is_assignment_target()
        {
            self.check_properties(properties, &cx.state.listener_node(object.span()), cx);
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let mut forbidden = std::mem::take(&mut cx.state.forbidden);
        utils::sort::sort_by_key(&mut forbidden, |it| it.listener_node.sort_key(0, 0));
        for it in forbidden {
            cx.report(it.declaration, FORBIDDEN_PROP_TYPE).data("target", it.target);
        }
    }
}

/// Does what the `ImportDeclaration` listener does, for the whole file.
fn imports_of<'a>(file: &'a File<'a>) -> Vec<Imported<'a>> {
    if !file.mentions("PropTypes") {
        return Vec::new();
    }
    let mut statements: Vec<Stmt<'a>> = file.stmts_of_kind(StmtTag::Import).collect();
    utils::sort::sort_by_key(&mut statements, |it| it.span().start);
    let (mut imports, mut packages) = (Vec::new(), Packages::default());
    for statement in statements {
        let StmtKind::Import(import) = statement.kind() else {
            continue;
        };
        let named = import.named();
        let whole = import.default().into_iter().chain(import.namespace());
        let mut locals = whole.chain(named.iter().map(ImportSpec::local));
        if import.spec().is("prop-types") {
            let Some(first) = locals.next() else {
                continue;
            };
            packages.prop_types_package_name = Some(first.name());
        } else if import.spec().is("react") {
            let Some(first) = locals.next() else {
                continue;
            };
            packages.react_package_name = Some(first.name());
            let is_prop_types = |it: &ImportSpec| it.imported().name().is("PropTypes") && !it.imported().is_string();
            if let Some(prop_types_specifier) = named.iter().find(is_prop_types) {
                packages.prop_types_package_name = Some(prop_types_specifier.local().name());
            }
        } else if locals.any(|it| it.name().is("PropTypes")) {
            packages.is_foreign_prop_types_package = true;
        } else {
            continue;
        }
        if packages.is_foreign_prop_types_package {
            imports.push(Imported { start: statement.span().start, packages });
        }
    }
    imports
}

/// `node.type === "MemberExpression" ? node.property.name : node.name`. Seen from its parent, the root of an optional
/// chain is a `ChainExpression`, so it has neither.
fn name_of(node: Expr<'_>) -> Option<&[u8]> {
    match node.as_ident() {
        Some(name) => Some(name.bytes()),
        None if node.is_chain_root() => None,
        None => get_property_name(Node::Expr(node)),
    }
}

impl<'a> Packages<'a> {
    /// `isPropTypesPackage`. Seen from its parent, the root of an optional chain is a `ChainExpression`.
    fn is_prop_types_package(self, node: Expr<'a>) -> bool {
        match node.kind() {
            ExprKind::Ident(name) => {
                !self.is_foreign_prop_types_package || self.prop_types_package_name == Some(name)
            }
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if !node.is_chain_root() => {
                !self.is_foreign_prop_types_package
                    || obj.as_ident().is_some_and(|name| self.react_package_name == Some(name))
            }
            _ => false,
        }
    }
}

impl<'a> State<'a> {
    fn listener_node(&self, span: Span) -> ListenerNode<'a> {
        let imports = self.imports.partition_point(|it| it.start < span.start);
        let packages = imports.checked_sub(1).and_then(|last| self.imports.get(last)).map(|it| it.packages);
        ListenerNode { span, imports, packages: packages.unwrap_or_default() }
    }
}

impl ForbidPropTypes {
    /// The check that the listeners start with, minus `isPropTypesPackage`.
    fn is_checked_declaration(&self, node: Node<'_>) -> bool {
        is_prop_types_declaration(node)
            || (self.check_context_types && is_context_types_declaration(node))
            || (self.check_child_context_types && is_child_context_types_declaration(node))
    }

    fn report_if_forbidden<'a>(
        &self,
        target: Option<&'a [u8]>,
        declaration: Prop<'a>,
        listener_node: &ListenerNode<'a>,
        cx: &mut Cx<'a, Self>,
    ) {
        if let Some(target) = target
            && self.forbid.iter().any(|it| target == &**it)
        {
            cx.state.forbidden.push(Forbidden { listener_node: listener_node.span, declaration: declaration.span(), target });
        }
    }

    fn check_properties<'a>(
        &self,
        declarations: List<'a, Prop<'a>>,
        listener_node: &ListenerNode<'a>,
        cx: &mut Cx<'a, Self>,
    ) {
        let packages = listener_node.packages;
        for declaration in declarations {
            let Some(mut value) = declaration.value().filter(|_| declaration.kind() != PropKind::Spread) else {
                continue;
            };
            if is_required_prop_type(value)
                && let Some(object) = value.object()
            {
                value = object;
            }
            if let Some(call) = value.as_call().filter(|_| !value.is_chain_root()) {
                if !packages.is_prop_types_package(call.callee()) {
                    continue;
                }
                for arg in call.args() {
                    self.report_if_forbidden(name_of(arg), declaration, listener_node, cx);
                }
                value = call.callee();
            }
            if packages.is_prop_types_package(value) {
                self.report_if_forbidden(name_of(value), declaration, listener_node, cx);
            }
        }
    }

    /// `checkProperties` of a variable's object literal. The result is cached, so only the first call walks the
    /// properties.
    fn check_properties_of_variable<'a>(&self, init: Expr<'a>, listener_node: &ListenerNode<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Object(properties) = init.kind() else {
            return;
        };
        let key = (init.span().start, listener_node.imports);
        let Some(known) = cx.state.known.get(&key).cloned() else {
            let first = cx.state.forbidden.len();
            self.check_properties(properties, listener_node, cx);
            cx.state.known.insert(key, first..cx.state.forbidden.len());
            return;
        };
        cx.state.forbidden.extend_from_within(known.clone());
        let added = cx.state.forbidden.len() - known.len();
        for it in cx.state.forbidden.iter_mut().skip(added) {
            it.listener_node = listener_node.span;
        }
    }

    fn check_node<'a>(&self, mut node: Expr<'a>, listener_node: &ListenerNode<'a>, cx: &mut Cx<'a, Self>) {
        loop {
            match node.kind() {
                ExprKind::Object(properties) => self.check_properties(properties, listener_node, cx),
                ExprKind::Ident(name) => {
                    if let Some(Found::Init(init)) = find_variable_by_name(Node::Expr(node), name) {
                        self.check_properties_of_variable(init, listener_node, cx);
                    }
                }
                ExprKind::Call(call) if !node.is_chain_root() => {
                    if let Some(inner_node) = call.args().first()
                        && is_prop_wrapper_function(cx.file(), call.callee().text())
                    {
                        node = inner_node;
                        continue;
                    }
                }
                _ => {}
            }
            return;
        }
    }

    /// The `MemberExpression` listener, for a `node` that's its parent's `left`. If it's the `right`, upstream checks
    /// the member expression itself, which does nothing.
    fn member_expression<'a>(&self, node: Expr<'a>, right: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if !matches!(right.tag(), ExprTag::Object | ExprTag::Ident | ExprTag::Call)
            || !matches!(node.tag(), ExprTag::Dot | ExprTag::Index)
            || node.is_chain_root()
        {
            return;
        }
        let listener_node = cx.state.listener_node(node.span());
        if listener_node.packages.is_prop_types_package(node) || self.is_checked_declaration(Node::Expr(node)) {
            self.check_node(right, &listener_node, cx);
        }
    }

    /// The `CallExpression` listener.
    fn call_expression<'a>(&self, node: Expr<'a>, call: Call<'a>, cx: &mut Cx<'a, Self>) {
        let Some(ExprKind::Object(properties)) = call.args().first().map(Expr::kind) else {
            return;
        };
        let callee = call.callee();
        if !callee.is_ident("shape") && !is_member_called(callee, "shape") {
            return;
        }
        let listener_node = cx.state.listener_node(node.span());
        if callee.object().is_none_or(|object| listener_node.packages.is_prop_types_package(object)) {
            self.check_properties(properties, &listener_node, cx);
        }
    }
}
