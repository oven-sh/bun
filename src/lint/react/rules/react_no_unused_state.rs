use crate::util_ast::{get_property_name, name_of_key, unwrap_ts_as_expression};
use crate::util_component_util::{Pragmas, is_es5_component, is_es6_component};
use crate::util_pragma::{get_create_class_from_context, mentions_create_class};
use bun_core::strings;
use bun_lint::ast::walk::{Visitor, walk_node};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::estree_compat::{Target, TargetKind, estree_parent, estree_type_name};
use bun_lint::utils::sort;
use rustc_hash::FxHashSet;
use std::borrow::Cow;
use std::iter::successors;

/// Disallow definitions of unused state
pub struct NoUnusedState;

const UNUSED_STATE_FIELD: Message = Message::new("unusedStateField", "Unused state field: '{{name}}'");

/// `quasis[0].value.raw`, of what is written between the backticks: espree has a `\n` for each line break in it.
fn raw_of<'a>(file: &File<'a>, written: &'a [u8]) -> Cow<'a, [u8]> {
    match file.uses_typescript_parser() {
        true => Cow::Borrowed(written),
        false => strings::crlf_as_lf(written),
    }
}

/// `getName`
fn get_name(node: Expr<'_>) -> Option<Cow<'_, [u8]>> {
    match node.kind() {
        ExprKind::Ident(name) => Some(Cow::Borrowed(name.bytes())),
        ExprKind::Template(template) => template.exprs().is_empty().then(|| raw_of(node.file(), template.raw(0))),
        _ => ast_utils::get_static_string_value(node),
    }
}

/// `getName(node.key)`
fn get_name_of_key<'a>(file: &'a File<'a>, key: Key<'a>) -> Option<Cow<'a, [u8]>> {
    match key.kind() {
        KeyKind::Ident(name) | KeyKind::String(name) | KeyKind::Number(name) | KeyKind::ComputedNumber(name) => {
            Some(Cow::Borrowed(name.bytes()))
        }
        // Of a template it is the text as it is written.
        KeyKind::ComputedString(name) => Some(match file.slice(key.inner_span(file)) {
            [b'`', written @ .., b'`'] => raw_of(file, written),
            _ => Cow::Borrowed(name.bytes()),
        }),
        KeyKind::Private(_) => None,
        KeyKind::Computed(e) => get_name(e),
    }
}

/// `getName(node.property)`
fn get_name_of_property(node: Expr<'_>) -> Option<Cow<'_, [u8]>> {
    match node.kind() {
        ExprKind::Dot { name, .. } if !node.is_private_member() => Some(Cow::Borrowed(name.bytes())),
        ExprKind::Index { index, .. } => get_name(index),
        _ => None,
    }
}

/// `isThisExpression`
fn is_this_expression(node: Expr<'_>) -> bool {
    unwrap_ts_as_expression(node).tag() == ExprTag::This
}

/// Whether `node`, reached from above, is a `MemberExpression` of `this` whose property has the `getName` `name`.
fn is_member_of_this(node: Expr<'_>, name: &[u8]) -> bool {
    ast_utils::is_member_expression(node)
        && !node.is_chain_root()
        && node.object().is_some_and(is_this_expression)
        && get_name_of_property(node).is_some_and(|it| *it == *name)
}

/// `isDirectStateReference`: also `this[state]` and `this.#state`, not `this["state"]`.
fn is_direct_state_reference(node: Expr<'_>) -> bool {
    get_property_name(Node::Expr(node)).is_some_and(|it| it == b"state")
        && node.object().is_some_and(is_this_expression)
}

/// Whether ESTree has a node that is none here, and no `ChainExpression`, between `e` and `parent`, its parent here.
fn is_wrapped<'a>(e: Expr<'a>, parent: Node<'a>) -> bool {
    let is_in_braces = e.jsx_container_span().is_some() && e.tag() != ExprTag::Spread;
    is_in_braces
        || match parent {
            // Each `!` is a `TSNonNullExpression`.
            Node::Expr(above) => above.non_null_count() > 1,
            // A `Decorator`.
            Node::Class(class) => class.extends() != Some(e),
            _ => false,
        }
}

/// `param.name`
fn name_of_param(param: Param<'_>) -> Option<Name<'_>> {
    param.pat().as_ident().filter(|_| estree_type_name(Node::Param(param)) == "Identifier")
}

/// The `name` of the second parameter, if `function` has one and is a method that `isStateParameterReference` knows.
fn state_parameter(function: Func<'_>) -> Option<Option<Name<'_>>> {
    let Node::Member(parent) = function.owner() else {
        return None;
    };
    if !function.has_body() || estree_type_name(Node::Member(parent)) != "MethodDefinition" {
        return None;
    }
    let gets_the_state = match name_of_key(parent.key()?)? {
        b"getDerivedStateFromProps" => parent.is_static(),
        b"shouldComponentUpdate"
        | b"componentWillUpdate"
        | b"UNSAFE_componentWillUpdate"
        | b"getSnapshotBeforeUpdate"
        | b"componentDidUpdate" => true,
        _ => false,
    };
    function.params_with_this().nth(1).filter(|_| gets_the_state).map(name_of_param)
}

/// `classInfo`
#[derive(Default)]
struct ClassInfo<'a> {
    /// Each with the `getName` of its key.
    state_fields: Vec<(Prop<'a>, Cow<'a, [u8]>)>,
    used_state_fields: FxHashSet<Cow<'a, [u8]>>,
    aliases: Option<FxHashSet<Name<'a>>>,
}

/// Upstream's listeners. It has one `classInfo` and no stack: what is in a component can replace it or end it.
struct Walk<'a> {
    file: &'a File<'a>,
    pragmas: Pragmas<'a>,
    class_info: Option<ClassInfo<'a>>,
    /// [`state_parameter`] of the functions around the node.
    state_parameters: Vec<Option<Name<'a>>>,
    /// The innermost function around a node.
    enclosing_functions: AncestorMemo<'a, Func<'a>>,
    /// What is reported.
    unused: Vec<(Prop<'a>, Cow<'a, [u8]>)>,
}

impl<'a> Walk<'a> {
    /// The functions around `node`, the innermost first.
    fn functions_around(&mut self, node: Node<'a>) -> impl Iterator<Item = Func<'a>> + use<'a> {
        successors(self.enclosing_functions.find(node, |_, parent| parent.as_func()), |it| it.enclosing())
    }

    /// `isES5Component`, of an `ObjectExpression`.
    fn is_es5_component(&self, node: Expr<'a>) -> bool {
        matches!(node.parent(), Node::Expr(parent) if parent.callee().is_some())
            && is_es5_component(Node::Expr(node), &self.pragmas)
    }

    /// `isES5Component(node.parent.parent)`, of the `FunctionExpression` that `function` is.
    fn is_in_es5_component(&self, function: Expr<'a>) -> bool {
        let parent = estree_parent(Node::Expr(function));
        if is_wrapped(function, parent) {
            let is_deeper = matches!(parent, Node::Expr(above) if above.non_null_count() > 2);
            return !is_deeper && is_es5_component(parent, &self.pragmas);
        }
        let above = estree_parent(parent);
        let grandparent = match parent.as_written() {
            Node::Prop(property) if property.is_jsx_attribute() => return false,
            Node::Prop(_) | Node::Param(_) => above,
            // A `ChainExpression`: the callee of the call that it is in gets the same answer.
            Node::Expr(e) if e.is_chain_root() => match above.as_expr().and_then(Expr::callee) {
                Some(callee) if e.jsx_container_span().is_none() => Node::Expr(callee),
                _ => return false,
            },
            Node::Expr(e) if !is_wrapped(e, above) => above,
            _ => return false,
        };
        is_es5_component(grandparent, &self.pragmas)
    }

    /// `isAliasedStateReference || isStateParameterReference(node)`, of a node with this `name`. What has none is taken
    /// for a parameter without one.
    fn is_name_of_state(&self, name: Option<Name<'a>>) -> bool {
        let aliases = self.class_info.as_ref().and_then(|it| it.aliases.as_ref());
        name.is_some_and(|name| aliases.is_some_and(|it| it.contains(&name))) || self.state_parameters.contains(&name)
    }

    /// `isStateReference`, of a `node` reached from above.
    fn is_state_reference(&self, node: Expr<'a>) -> bool {
        (is_direct_state_reference(node) && !node.is_chain_root()) || self.is_name_of_state(node.as_ident())
    }

    fn has_aliases(&self) -> bool {
        self.class_info.as_ref().is_some_and(|it| it.aliases.is_some())
    }

    fn set_aliases(&mut self, aliases: Option<FxHashSet<Name<'a>>>) {
        if let Some(class_info) = &mut self.class_info {
            class_info.aliases = aliases;
        }
    }

    /// `classInfo.aliases.add(name)`, if there are aliases.
    fn add_alias(&mut self, name: Name<'a>) {
        if let Some(aliases) = self.class_info.as_mut().and_then(|it| it.aliases.as_mut()) {
            aliases.insert(name);
        }
    }

    /// `addStateFields`. Nothing for what is no `ObjectExpression`.
    fn add_state_fields(&mut self, node: Expr<'a>) {
        let (Some(class_info), ExprKind::Object(properties)) = (&mut self.class_info, node.kind()) else {
            return;
        };
        let is_identifier = |key: &Key<'a>| matches!(key.kind(), KeyKind::Computed(e) if e.tag() == ExprTag::Ident);
        for property in properties.iter() {
            let name = property.key().filter(|it| !is_identifier(it)).and_then(|key| get_name_of_key(self.file, key));
            class_info.state_fields.extend(name.map(|name| (property, name)));
        }
    }

    /// `addUsedStateField`, with the `getName` of the node.
    fn add_used_state_field(&mut self, name: Option<Cow<'a, [u8]>>) {
        if let (Some(class_info), Some(name)) = (&mut self.class_info, name)
            && !name.is_empty()
        {
            class_info.used_state_fields.insert(name);
        }
    }

    /// `handleStateDestructuring`
    fn handle_state_destructuring(&mut self, node: Target<'a>) {
        for property in node.elements() {
            match (property.key, property.target.map(Target::kind)) {
                (Some(key), _) => self.add_used_state_field(get_name_of_key(self.file, key)),
                (None, Some(TargetKind::Ident(name))) => self.add_alias(name),
                _ => {}
            }
        }
    }

    /// `handleAssignment`
    fn handle_assignment(&mut self, left: Target<'a>, right: Expr<'a>) {
        let unwrapped_right = unwrap_ts_as_expression(right);
        match left.kind() {
            TargetKind::Ident(name) => {
                if self.is_state_reference(unwrapped_right) {
                    self.add_alias(name);
                }
            }
            TargetKind::Object if self.is_state_reference(unwrapped_right) => self.handle_state_destructuring(left),
            TargetKind::Object if is_this_expression(unwrapped_right) && self.has_aliases() => {
                for property in left.elements() {
                    let name = property.key.and_then(|key| get_name_of_key(self.file, key));
                    // With a default the value is an `AssignmentPattern`.
                    if !name.is_some_and(|it| *it == *b"state") || property.default.is_some() {
                        continue;
                    }
                    match property.target.map(|value| (value, value.kind())) {
                        Some((_, TargetKind::Ident(name))) => self.add_alias(name),
                        Some((value, TargetKind::Object)) => self.handle_state_destructuring(value),
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }

    /// `reportUnusedFields`, and the end of the `classInfo`.
    fn report_unused_fields(&mut self) {
        if let Some(ClassInfo { state_fields, used_state_fields, .. }) = self.class_info.take() {
            self.unused.extend(state_fields.into_iter().filter(|(_, name)| !used_state_fields.contains(name)));
        }
    }

    /// `CallExpression`
    fn call_expression(&mut self, node: Expr<'a>) {
        let Some(call) = node.as_call() else {
            return;
        };
        // `isSetStateCall`
        if !is_member_of_this(unwrap_ts_as_expression(call.callee()), b"setState") {
            return;
        }
        let Some(argument) = call.args().first().map(unwrap_ts_as_expression) else {
            return;
        };
        let Some(function) = argument.as_fn().filter(|it| it.is_arrow()) else {
            self.add_state_fields(argument);
            return;
        };
        if let FnBody::Expr(body) = function.body() {
            self.add_state_fields(unwrap_ts_as_expression(body));
        }
        let Some(first_param) = function.params().first().filter(|_| self.has_aliases()) else {
            return;
        };
        if estree_type_name(Node::Param(first_param)) == "ObjectPattern" {
            self.handle_state_destructuring(Target::Pat(first_param.pat()));
        } else if let Some(name) = name_of_param(first_param) {
            self.add_alias(name);
        }
    }

    /// `ClassProperty, PropertyDefinition` and `PropertyDefinition, ClassProperty`
    fn property_definition(&mut self, node: Member<'a>) {
        let Some(value) = node.init() else {
            return;
        };
        let name = node.key().and_then(|key| get_name_of_key(self.file, key));
        let name = name.as_deref();
        let unwrapped_value = unwrap_ts_as_expression(value);
        match unwrapped_value.kind() {
            _ if node.is_static() => {
                if name.is_some_and(|it| it == b"getDerivedStateFromProps")
                    && let Some(function) = value.as_fn()
                {
                    self.get_derived_state_from_props(function);
                }
            }
            ExprKind::Object(_) if name.is_some_and(|it| it == b"state") => self.add_state_fields(unwrapped_value),
            ExprKind::Fn(function) if function.is_arrow() => self.set_aliases(Some(FxHashSet::default())),
            _ => {}
        }
    }

    /// What the second of these does if `isGDSFP(node)`: `function` is `node.value`.
    fn get_derived_state_from_props(&mut self, function: Func<'a>) {
        // The scope that upstream finds for a function with a name has that name and nothing else.
        if function.name().is_some() {
            return;
        }
        let state_arg = function.params_with_this().nth(1).filter(|it| name_of_param(*it).is_some());
        let Some(arg_var) = state_arg.and_then(|it| it.pat().symbol()) else {
            return;
        };
        for identifier in arg_var.references().filter_map(Reference::expr) {
            if let Node::Expr(parent) = identifier.parent()
                && ast_utils::is_member_expression(parent)
            {
                self.add_used_state_field(get_name_of_property(parent));
            }
        }
    }

    /// `FunctionExpression`
    fn function_expression(&mut self, node: Func<'a>) {
        // The parent of a method of a class is in a `ClassBody`.
        let Node::Expr(function) = node.owner() else {
            return;
        };
        if estree_type_name(Node::Func(node)) != "FunctionExpression" || !self.is_in_es5_component(function) {
            return;
        }
        let key = match function.parent() {
            Node::Prop(property) => property.key(),
            _ => None,
        };
        if key.and_then(name_of_key).is_some_and(|it| it == b"getInitialState") {
            if let Some(last_body_node) = node.body_statements().and_then(|it| it.last())
                && let StmtKind::Return(Some(argument)) = last_body_node.kind()
            {
                self.add_state_fields(argument);
            }
        } else {
            self.set_aliases(Some(FxHashSet::default()));
        }
    }

    /// `AssignmentExpression`
    fn assignment_expression(&mut self, node: Expr<'a>) {
        let ExprKind::Assign { target, value, .. } = node.kind() else {
            return;
        };
        if estree_type_name(Node::Expr(node)) != "AssignmentExpression" {
            return;
        }
        let unwrapped_left = unwrap_ts_as_expression(target);
        let unwrapped_right = unwrap_ts_as_expression(value);
        if unwrapped_right.tag() == ExprTag::Object && is_member_of_this(unwrapped_left, b"state") {
            let mut functions = self.functions_around(Node::Expr(node));
            let function = functions.find(|it| estree_type_name(Node::Func(*it)) == "FunctionExpression");
            if function.is_some_and(|it| matches!(it.owner(), Node::Member(parent) if parent.is_constructor())) {
                self.add_state_fields(unwrapped_right);
            }
        // What is under an `as` is no pattern.
        } else if unwrapped_left == target || unwrapped_left.tag() != ExprTag::Object {
            self.handle_assignment(Target::Expr(unwrapped_left), unwrapped_right);
        }
    }

    /// `MemberExpression, OptionalMemberExpression`
    fn member_expression(&mut self, node: Expr<'a>) {
        let Some(object) = node.object().filter(|_| ast_utils::is_member_expression(node)) else {
            return;
        };
        if self.is_state_reference(unwrap_ts_as_expression(object)) {
            if node.index().is_some_and(|it| !ast_utils::is_literal(it)) {
                self.class_info = None;
            } else {
                self.add_used_state_field(get_name_of_property(node));
            }
        } else if (is_direct_state_reference(node) || self.is_name_of_state(None))
            && !node.is_chain_root()
            && matches!(node.parent(), Node::Expr(parent) if parent.tag() == ExprTag::Call)
        {
            self.class_info = None;
        }
    }

    /// The same for the `a.b.c` after `implements` or after the `extends` of an interface, which is no expression here.
    fn qualified_name(&mut self, name: EntityName<'a>) {
        for (index, property) in name.parts().enumerate().skip(1) {
            let object = name.first().filter(|_| index == 1);
            if self.is_name_of_state(object.map(Ident::name)) {
                self.add_used_state_field(Some(Cow::Borrowed(property.bytes())));
            }
        }
    }

    /// `JSXSpreadAttribute` and `ExperimentalSpreadProperty, SpreadElement`
    fn spread(&mut self, node: Node<'a>, argument: Option<Expr<'a>>) {
        if matches!(estree_type_name(node), "JSXSpreadAttribute" | "SpreadElement")
            && argument.is_some_and(|it| self.is_state_reference(it))
        {
            self.class_info = None;
        }
    }
}

impl<'a> Visitor<'a> for Walk<'a> {
    fn enter(&mut self, node: Node<'a>) {
        match node {
            Node::Class(class) => {
                if is_es6_component(class, &self.pragmas) {
                    self.class_info = Some(ClassInfo::default());
                }
            }
            Node::Func(function) => {
                self.state_parameters.extend(state_parameter(function));
                if self.class_info.is_some() {
                    self.function_expression(function);
                }
            }
            Node::Expr(e) if e.tag() == ExprTag::Object => {
                if self.is_es5_component(e) {
                    self.class_info = Some(ClassInfo::default());
                }
            }
            _ if self.class_info.is_none() => {}
            Node::Expr(e) => match e.tag() {
                ExprTag::Call => self.call_expression(e),
                ExprTag::Assign => self.assignment_expression(e),
                ExprTag::Dot | ExprTag::Index => self.member_expression(e),
                ExprTag::Spread => self.spread(node, e.operand()),
                _ => {}
            },
            Node::Member(member) if ast_utils::is_property_definition(member) => self.property_definition(member),
            Node::Member(_) => {
                if estree_type_name(node) == "MethodDefinition" {
                    self.set_aliases(Some(FxHashSet::default()));
                }
            }
            Node::VarDecl(declarator) => {
                if let Some(init) = declarator.init() {
                    self.handle_assignment(Target::Pat(declarator.pat()), init);
                }
            }
            Node::Prop(property) if property.kind() == PropKind::Spread => self.spread(node, property.value()),
            Node::Type(ty) => {
                if let TypeKind::Ref { name, .. } = ty.kind()
                    && name.len() > 1
                    && matches!(estree_type_name(node), "TSClassImplements" | "TSInterfaceHeritage")
                {
                    self.qualified_name(name);
                }
            }
            _ => {}
        }
    }

    fn exit(&mut self, node: Node<'a>) {
        match node {
            Node::Class(_) => self.report_unused_fields(),
            Node::Func(function) => {
                if state_parameter(function).is_some() {
                    self.state_parameters.pop();
                }
            }
            Node::Expr(e) if e.tag() == ExprTag::Object => {
                if self.class_info.is_some() && self.is_es5_component(e) {
                    self.report_unused_fields();
                }
            }
            Node::Member(member) => {
                let is_arrow_function = || member.init().and_then(Expr::as_fn).is_some_and(Func::is_arrow);
                let forgets_the_aliases = match ast_utils::is_property_definition(member) {
                    true => !member.is_static() && is_arrow_function(),
                    false => estree_type_name(node) == "MethodDefinition",
                };
                if forgets_the_aliases {
                    self.set_aliases(None);
                }
            }
            _ => {}
        }
    }
}

impl Rule for NoUnusedState {
    const META: Meta = Meta::plugin(Plugin::React, "no-unused-state", Kind::Suggestion).reports_on_exit();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnusedState
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions_any(&["state", "setState", "getInitialState", "#getInitialState"])
            && (file.has_classes() || mentions_create_class(file, get_create_class_from_context(file))))
        .then_some(())
    }

    /// Outside of a component no listener of upstream does anything: each component is walked, with all that is in it.
    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let pragmas = Pragmas::new(file);
        let mut components: Vec<_> =
            file.classes().filter(|it| is_es6_component(*it, &pragmas)).map(Node::Class).collect();
        if mentions_create_class(file, pragmas.create_class) {
            let objects = file.exprs_of_kind(ExprTag::Object).map(Node::Expr);
            components.extend(objects.filter(|it| is_es5_component(*it, &pragmas)));
        }
        sort::sort_unstable_by_key(&mut components, |it| it.span().start);
        let mut walk = Walk {
            file,
            pragmas,
            class_info: None,
            state_parameters: Vec::new(),
            enclosing_functions: AncestorMemo::default(),
            unused: Vec::new(),
        };
        let mut walked_to = 0;
        for component in components {
            if component.span().start < walked_to {
                continue;
            }
            walked_to = component.span().end;
            walk.state_parameters = walk.functions_around(component).filter_map(state_parameter).collect();
            walk_node(component, &mut walk);
        }
        for (node, name) in walk.unused {
            cx.report(node, UNUSED_STATE_FIELD).data("name", name);
        }
    }
}
