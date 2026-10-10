use crate::util_ast::{get_property_name_node, is_assignment_lhs};
use crate::util_component_util::{Pragmas, is_es5_component, is_es6_component};
use crate::util_pragma::get_create_class_from_context;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::estree_compat::estree_type_name;
use bun_lint::utils::sort;
use rustc_hash::FxHashSet;
use std::borrow::Cow;
use std::cmp::Reverse;

/// Disallow declaring unused methods of component class
pub struct NoUnusedClassComponentMethods;

const UNUSED: Message = Message::new("unused", "Unused method or property \"{{name}}\"");
const UNUSED_WITH_CLASS: Message =
    Message::new("unusedWithClass", "Unused method or property \"{{name}}\" of class \"{{className}}\"");

/// `LIFECYCLE_METHODS`, with `ES6_LIFECYCLE` or `ES5_LIFECYCLE`.
fn is_lifecycle(name: &[u8], is_class: bool) -> bool {
    match name {
        b"constructor"
        | b"componentDidCatch"
        | b"componentDidMount"
        | b"componentDidUpdate"
        | b"componentWillMount"
        | b"componentWillReceiveProps"
        | b"componentWillUnmount"
        | b"componentWillUpdate"
        | b"getChildContext"
        | b"getSnapshotBeforeUpdate"
        | b"render"
        | b"shouldComponentUpdate"
        | b"UNSAFE_componentWillMount"
        | b"UNSAFE_componentWillReceiveProps"
        | b"UNSAFE_componentWillUpdate" => true,
        b"state" => is_class,
        b"getInitialState" | b"getDefaultProps" | b"mixins" => !is_class,
        _ => false,
    }
}

/// `getName` of a `Literal` and of a `TemplateLiteral` without expressions. `None` for anything else.
fn get_name(node: Expr<'_>) -> Option<Cow<'_, [u8]>> {
    match node.kind() {
        ExprKind::Template(template) => template.exprs().is_empty().then(|| strings::crlf_as_lf(template.raw(0))),
        _ => ast_utils::get_static_string_value(node),
    }
}

/// `getName(key)`, if `isKeyLiteralLike(node, key)`.
fn get_name_of_key<'a>(file: &'a File<'a>, key: Key<'a>) -> Option<Cow<'a, [u8]>> {
    match key.kind() {
        KeyKind::Ident(name) | KeyKind::String(name) | KeyKind::Number(name) | KeyKind::ComputedNumber(name) => {
            Some(Cow::Borrowed(name.bytes()))
        }
        // Of a template it is the text as it is written.
        KeyKind::ComputedString(name) => Some(match file.slice(key.inner_span(file)) {
            [b'`', raw @ .., b'`'] => strings::crlf_as_lf(raw),
            _ => Cow::Borrowed(name.bytes()),
        }),
        KeyKind::Private(_) => None,
        KeyKind::Computed(e) => get_name(e),
    }
}

fn mentions(file: &File<'_>, create_class: &[u8]) -> bool {
    std::str::from_utf8(create_class).is_ok_and(|it| file.mentions(it))
}

/// A listener of upstream, with the node that it is called with.
#[derive(Copy, Clone)]
enum Listener<'a> {
    /// `ClassDeclaration`, for a component.
    Class(Class<'a>),
    /// `ClassDeclaration:exit`
    ClassExit,
    /// `ObjectExpression`, for a component.
    Object(Expr<'a>),
    /// `ObjectExpression:exit`, for a component.
    ObjectExit(Expr<'a>),
    /// `Property`, of a component.
    Property(Prop<'a>),
    /// `ClassProperty, MethodDefinition, PropertyDefinition`
    Member(Member<'a>),
    /// `exitMethod`
    MemberExit,
    /// `MemberExpression`, of `this`.
    MemberExpression(Expr<'a>),
    /// `VariableDeclarator`, of an `ObjectPattern` and `this`.
    VariableDeclarator(VarDecl<'a>),
}

/// When a listener is called: these are in the order of ESLint's traversal.
type Time = (u32, bool, Reverse<u32>);

fn entering(node: Span) -> Time {
    (node.start, true, Reverse(node.end))
}

fn leaving(node: Span) -> Time {
    (node.end, false, Reverse(node.start))
}

/// `classInfo`
#[derive(Default)]
struct ClassInfo<'a> {
    /// `classNode`, unless `isClass`.
    object: Option<Expr<'a>>,
    /// `classNode.id`
    id: Option<Ident<'a>>,
    /// Each with its `getName`.
    properties: Vec<(Span, Cow<'a, [u8]>)>,
    used_properties: FxHashSet<Cow<'a, [u8]>>,
    in_static: bool,
}

impl<'a> ClassInfo<'a> {
    /// `addProperty(key)`, if `isKeyLiteralLike(node, key)`. A constructor has no key here, and is never reported.
    fn add_key(&mut self, file: &'a File<'a>, key: Option<Key<'a>>) {
        self.properties.extend(key.and_then(|key| Some((key.inner_span(file), get_name_of_key(file, key)?))));
    }

    /// `addUsedProperty`
    fn add_used_property(&mut self, name: Cow<'a, [u8]>) {
        if !name.is_empty() {
            self.used_properties.insert(name);
        }
    }

    /// What the listeners that neither make nor end a `classInfo` do.
    fn call(&mut self, listener: Listener<'a>, file: &'a File<'a>) {
        match listener {
            Listener::Property(node) => {
                if matches!(node.parent(), Node::Expr(parent) if Some(parent) == self.object) {
                    self.add_key(file, node.key());
                }
            }
            Listener::Member(node) if node.is_static() => self.in_static = true,
            Listener::Member(node) => self.add_key(file, node.key()),
            Listener::MemberExit => self.in_static = false,
            _ if self.in_static => {}
            Listener::MemberExpression(node) => {
                let name = match node.kind() {
                    ExprKind::Dot { name, .. } if !node.is_private_member() => Some(Cow::Borrowed(name.bytes())),
                    ExprKind::Index { index, .. } => get_name(index),
                    _ => None,
                };
                let Some(name) = name else {
                    return;
                };
                if is_assignment_lhs(node) {
                    self.properties.extend(get_property_name_node(Node::Expr(node)).map(|property| (property, name)));
                } else {
                    self.add_used_property(name);
                }
            }
            Listener::VariableDeclarator(node) => {
                if let PatKind::Object(properties) = node.pat().kind() {
                    for name in properties.iter().filter_map(|it| get_name_of_key(file, it.key()?)) {
                        self.add_used_property(name);
                    }
                }
            }
            _ => {}
        }
    }

    /// `reportUnusedProperties`
    fn report_unused_properties(self, cx: &Cx<'a, NoUnusedClassComponentMethods>) {
        for (node, name) in self.properties {
            if self.used_properties.contains(&name) || is_lifecycle(&name, self.object.is_none()) {
                continue;
            }
            match self.id {
                Some(id) => cx.report(node, UNUSED_WITH_CLASS).data("name", name).data("className", id),
                None => cx.report(node, UNUSED).data("name", name).data("className", ""),
            };
        }
    }
}

impl Rule for NoUnusedClassComponentMethods {
    const META: Meta =
        Meta::plugin(Plugin::React, "no-unused-class-component-methods", Kind::Suggestion).reports_on_exit();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnusedClassComponentMethods
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.has_stmts([StmtTag::Class]) || mentions(file, get_create_class_from_context(file))).then_some(())
    }

    /// Upstream has one `classInfo` and no stack: what is in a component can replace it or end it. So the listeners are
    /// called in the order in which ESLint calls them.
    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let pragmas = Pragmas::new(file);
        let is_declaration = |class: &Class<'_>| matches!(class.owner(), Node::Stmt(_));
        let mut calls = Vec::new();
        for class in file.classes().filter(|it| is_declaration(it) && is_es6_component(*it, &pragmas)) {
            calls.push((entering(class.span()), Listener::Class(class)));
        }
        if mentions(file, pragmas.create_class) {
            for object in file.exprs_of_kind(ExprTag::Object) {
                if let ExprKind::Object(properties) = object.kind()
                    && is_es5_component(Node::Expr(object), &pragmas)
                {
                    calls.push((entering(object.span()), Listener::Object(object)));
                    calls.extend(properties.iter().map(|it| (entering(it.span()), Listener::Property(it))));
                    calls.push((leaving(object.span()), Listener::ObjectExit(object)));
                }
            }
        }
        if calls.is_empty() {
            return;
        }
        for class in file.classes() {
            if is_declaration(&class) {
                calls.push((leaving(class.span()), Listener::ClassExit));
            }
            for member in class.members().iter() {
                if matches!(estree_type_name(Node::Member(member)), "MethodDefinition" | "PropertyDefinition") {
                    calls.push((entering(member.span()), Listener::Member(member)));
                    calls.push((leaving(member.span()), Listener::MemberExit));
                }
            }
        }
        for this in file.exprs_of_kind(ExprTag::This) {
            // `uncast`
            let mut node = this;
            while let Node::Expr(cast) = node.parent()
                && cast.is_flow_type_cast()
            {
                node = cast;
            }
            match node.parent() {
                Node::Expr(member) if member.object() == Some(node) && ast_utils::is_member_expression(member) => {
                    calls.push((entering(member.span()), Listener::MemberExpression(member)));
                }
                Node::VarDecl(declarator) if declarator.init() == Some(node) => {
                    calls.push((entering(declarator.span()), Listener::VariableDeclarator(declarator)));
                }
                _ => {}
            }
        }
        sort::sort_by_key(&mut calls, |it| it.0);
        let mut class_info = None;
        for (_, listener) in calls {
            match listener {
                Listener::Class(node) => class_info = Some(ClassInfo { id: node.name(), ..ClassInfo::default() }),
                Listener::Object(node) => class_info = Some(ClassInfo { object: Some(node), ..ClassInfo::default() }),
                Listener::ClassExit => {
                    if let Some(ended) = class_info.take() {
                        ended.report_unused_properties(cx);
                    }
                }
                Listener::ObjectExit(node) => {
                    if let Some(ended) = class_info.take_if(|it| it.object == Some(node)) {
                        ended.report_unused_properties(cx);
                    }
                }
                _ => {
                    if let Some(class_info) = &mut class_info {
                        class_info.call(listener, file);
                    }
                }
            }
        }
    }
}
