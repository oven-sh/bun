#![allow(dead_code)] // until every rule of the plugin is written
//! `lib/util/propTypes.js` of eslint-plugin-react: `propTypesInstructions`, the visitor that stores
//! in each component which props it declares. What reads a declaration is in
//! `util_prop_types_declaration`.
//!
//! | upstream | here |
//! |---|---|
//! | `propTypesInstructions(context, components, utils)` | [`declared`] |
//! | `component.declaredPropTypes` | `Component::declared_prop_types` |
//! | `component.ignorePropsValidation` | `Component::ignore_props_validation` |
//! | `isFunctionType(node)`, `astUtil.isFunction(node)` | `func.kind()` |
//! | `iterateProperties(context, properties, fn)` | a loop with `get_key_value` |
//! | `resolveTypeAnnotation(node)` | `.ty()`: a `TSTypeAnnotation` is no node |
//! | `stack`, `typeScope`, `getInTypeScope`, `setInTypeScope` | nothing: only Flow fills it |
//!
//! What only the nodes of Flow get to is left out. Where upstream throws a `TypeError`, which ends
//! the run of ESLint, nothing is declared.

use crate::util_annotations::{is_annotated_function_props_declaration, is_props};
use crate::util_ast::{get_key_value, get_property_name};
use crate::util_components::{Components, Instructions, Visit};
use crate::util_components_list::{Children, DeclaredPropType, DeclaredPropTypes};
use crate::util_is_create_element::is_member_called;
use crate::util_is_first_letter_capitalized::is_first_letter_capitalized;
use crate::util_jsx::Branches;
use crate::util_prop_types_declaration::{
    RangeError, ReactTypeImports, UNDEFINED, build_react_declaration_types,
    declare_prop_types_for_ts_type_annotation, is_used_up, is_valid_react_generic_type_annotation,
    key_in_full_name,
};
use crate::util_prop_wrapper::is_prop_wrapper_function;
use crate::util_props::{is_prop_types_declaration, is_required_prop_type};
use crate::util_variable::{get_latest_variable_definition, get_variable_from_context};
use crate::util_version::{Version, get_flow_version_from_context};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::estree_parent;
use std::borrow::Cow;
use std::cell::Cell;

/// Through how many variables and calls of wrapper functions a declaration is followed. Upstream
/// throws a `RangeError` where that has no end: `const a = a`.
const MAX_DEPTH: u32 = 100;

/// `name in Object.prototype`, which is `name in {}` for what is no property of its own.
pub(crate) fn is_in_object_prototype(name: &[u8]) -> bool {
    matches!(
        name,
        b"__defineGetter__"
            | b"__defineSetter__"
            | b"__lookupGetter__"
            | b"__lookupSetter__"
            | b"__proto__"
            | b"constructor"
            | b"hasOwnProperty"
            | b"isPrototypeOf"
            | b"propertyIsEnumerable"
            | b"toLocaleString"
            | b"toString"
            | b"valueOf"
    )
}

/// `isSuperTypeParameterPropsDeclaration`
fn is_super_type_parameter_props_declaration(node: Class<'_>) -> bool {
    !node.extends_args().is_empty()
}

/// `startWithCapitalizedLetter`, which says the opposite. `parent` is `node.parent`.
fn start_with_capitalized_letter(parent: Node<'_>) -> bool {
    matches!(parent, Node::VarDecl(it)
        if !is_first_letter_capitalized(it.pat().as_ident().map(Name::bytes)))
}

/// `parent`, if it has a `callee` and type arguments.
fn call_with_type_arguments(parent: Node<'_>) -> Option<Call<'_>> {
    match parent.as_expr()?.kind() {
        ExprKind::Call(call) | ExprKind::New(call) if !call.type_args().is_empty() => Some(call),
        _ => None,
    }
}

/// Whether `callee` is `forwardRef` or `React.forwardRef`.
fn is_forward_ref(callee: Expr<'_>) -> bool {
    callee.is_ident("forwardRef")
        || (is_member_called(callee, "forwardRef")
            && callee.object().is_some_and(|it| it.is_ident("React")))
}

/// `parent.id.typeAnnotation.typeAnnotation`
fn sibling_type_annotation(parent: Node<'_>) -> Option<TypeNode<'_>> {
    match parent {
        Node::VarDecl(it) => it.ty(),
        _ => None,
    }
}

/// `propsUtil.getTypeArguments(annotation) != null`, for what is no `TSTypeReference`.
fn has_type_arguments(annotation: TypeNode<'_>) -> bool {
    match annotation.kind() {
        TypeKind::Typeof { args, .. }
        | TypeKind::Import {
            args,
            is_typeof: false,
            ..
        } => !args.is_empty(),
        // It has no `typeArguments`, so that its `typeParameters` are taken.
        TypeKind::Fn(func) => !func.type_params().is_empty(),
        _ => false,
    }
}

/// `text.replace(/^.*\.propTypes\./, "")`
fn without_prop_types(text: &[u8]) -> &[u8] {
    const PROP_TYPES: &[u8] = b".propTypes.";
    let first_line = strings::find_js_line_break(text).and_then(|(end, _)| text.get(..end));
    strings::last_index_of(first_line.unwrap_or(text), PROP_TYPES)
        .and_then(|at| text.get(at + PROP_TYPES.len()..))
        .unwrap_or(text)
}

/// `node.parent` of a `MemberExpression`, as far as `markPropTypesAsDeclared` asks for its `type`.
#[derive(Copy, Clone)]
enum Parent<'a> {
    AssignmentExpression(Expr<'a>),
    MemberExpression(Expr<'a>),
    Other,
}

impl<'a> Parent<'a> {
    fn of(node: Expr<'a>) -> Parent<'a> {
        // A `ChainExpression`, a `JSXExpressionContainer`.
        if node.is_chain_root() || node.jsx_container_span().is_some() {
            return Parent::Other;
        }
        match estree_parent(Node::Expr(node)) {
            Node::Expr(parent) => match parent.tag() {
                // A default is in an `AssignmentPattern`.
                ExprTag::Assign if !parent.is_assignment_target() => {
                    Parent::AssignmentExpression(parent)
                }
                ExprTag::Dot | ExprTag::Index => Parent::MemberExpression(parent),
                _ => Parent::Other,
            },
            _ => Parent::Other,
        }
    }
}

/// The `propTypes` of `markPropTypesAsDeclared`.
#[derive(Copy, Clone)]
enum PropTypes<'a> {
    /// `null`
    Null,
    /// Not the `ChainExpression` around it.
    Expr(Expr<'a>),
    /// A `TSTypeReference`, or the type in a `TSTypeAnnotation`.
    Type(TypeNode<'a>),
    /// `undefined`, or any other node.
    Other,
}

impl<'a> PropTypes<'a> {
    /// What a node has as its `value`, `init`, `argument` or `right`, or among its `arguments`.
    fn from_above(e: Option<Expr<'a>>) -> PropTypes<'a> {
        match e {
            None => PropTypes::Null,
            Some(e) if e.is_chain_root() => PropTypes::Other,
            Some(e) => PropTypes::Expr(e),
        }
    }

    /// `node.parent.right || node.parent`
    fn right_or_parent(node: Expr<'a>) -> PropTypes<'a> {
        // A `ChainExpression`, a `JSXExpressionContainer`.
        if node.is_chain_root() || node.jsx_container_span().is_some() {
            return PropTypes::Other;
        }
        // The `right` of an `AssignmentPattern`.
        let default = match estree_parent(Node::Expr(node)) {
            Node::Expr(parent) => {
                return match parent.kind() {
                    // A `SequenceExpression` has `expressions`.
                    ExprKind::Binary {
                        op: BinOp::Comma, ..
                    } => PropTypes::Other,
                    ExprKind::Binary { right, .. } | ExprKind::Assign { value: right, .. } => {
                        PropTypes::from_above(Some(right))
                    }
                    _ => PropTypes::Expr(parent),
                };
            }
            Node::Stmt(parent) => {
                return match parent.kind() {
                    StmtKind::ForIn { expr, .. } | StmtKind::ForOf { expr, .. } => {
                        PropTypes::from_above(Some(expr))
                    }
                    _ => PropTypes::Other,
                };
            }
            Node::PatProp(parent) => parent.default(),
            Node::PatElem(parent) => parent.default(),
            Node::Param(parent) => parent.default(),
            _ => None,
        };
        match default == Some(node) {
            true => PropTypes::Expr(node),
            false => PropTypes::Other,
        }
    }
}

/// What `propTypesInstructions` closes over.
#[derive(Default)]
struct PropTypesInstructions<'a> {
    class_expressions: Vec<Class<'a>>,
    custom_validators: Vec<Box<[u8]>>,
    imports: ReactTypeImports<'a>,
    /// `getFlowVersionFromContext(context)`, once it is asked for.
    flow_version: Option<Option<Version>>,
    /// Whether a node has a `ClassBody` around it.
    class_bodies: AncestorMemo<'a, ()>,
    /// Whether a node is in a declaration of prop types.
    declarations: AncestorMemo<'a, ()>,
    /// How many parts of declarations have been looked at.
    steps: Cell<u32>,
}

impl<'a> PropTypesInstructions<'a> {
    /// `isInsideClassBody`
    fn is_inside_class_body(&mut self, node: Node<'a>) -> bool {
        let class_body = self.class_bodies.find(node, |_, parent| {
            matches!(parent, Node::Member(it) if !it.is_signature()).then_some(())
        });
        class_body.is_some()
    }

    /// `isUsedInPropTypes`, where `n` starts as `node.parent`.
    fn is_used_in_prop_types(&mut self, node: Expr<'a>) -> bool {
        let node = Node::Expr(node);
        let declaration = self.declarations.find_with(node, estree_parent, |_, n| {
            let is_declaration = match n {
                Node::Expr(e) => {
                    e.tag() == ExprTag::Assign
                        && !e.is_assignment_target()
                        && (e.left()).is_some_and(|it| is_prop_types_declaration(Node::Expr(it)))
                }
                Node::Member(it) => {
                    ast_utils::is_property_definition(it) && is_prop_types_declaration(n)
                }
                Node::Prop(_) | Node::PatProp(_) => is_prop_types_declaration(n),
                _ => false,
            };
            is_declaration.then_some(())
        });
        declaration.is_some()
    }

    /// The `case "MemberExpression"` of `markPropTypesAsDeclared`: what `ignorePropsValidation` is
    /// after it.
    fn declare_prop_types_for_member_expression(
        &mut self,
        mut prop_types: Expr<'a>,
        declared_prop_types: &mut DeclaredPropTypes<'a>,
        ignore_props_validation: bool,
        root_node: Option<Node<'a>>,
    ) -> Result<bool, RangeError> {
        // `None`: `undefined`, or the array of a union, which is taken to have no name.
        let mut cur_declared_prop_types = Some(declared_prop_types);
        // Walk the list of properties, until we reach the assignment
        // ie: ClassX.propTypes.a.b.c = ...
        let assignment = loop {
            let parent = Parent::of(prop_types);
            if let Parent::AssignmentExpression(assignment) = parent {
                break assignment;
            }
            let Some(cur) = cur_declared_prop_types.take() else {
                return Ok(true);
            };
            let prop_name = get_property_name(Node::Expr(prop_types)).unwrap_or(UNDEFINED);
            cur_declared_prop_types = match cur.get_mut(prop_name) {
                Some(DeclaredPropType {
                    children: Children::Named(children),
                    ..
                }) => Some(children),
                Some(_) => None,
                None if is_in_object_prototype(prop_name) => None,
                // This will crash at runtime because we haven't seen this key before
                // stop this and do not declare it
                None => return Ok(true),
            };
            let Parent::MemberExpression(parent) = parent else {
                // Found a propType used inside of another propType. This is not considered usage,
                // we'll still validate this component.
                return Ok(ignore_props_validation || !self.is_used_in_prop_types(prop_types));
            };
            prop_types = parent;
        };
        let (Some(object), right) = (prop_types.object(), assignment.right()) else {
            return Ok(true);
        };
        if assignment.left() != Some(prop_types) {
            return Ok(true);
        }
        let parent_prop = without_prop_types(object.text());
        let built = build_react_declaration_types(
            right,
            parent_prop,
            root_node,
            &self.custom_validators,
            &self.steps,
        )?;
        let name = get_property_name(Node::Expr(prop_types));
        let types = DeclaredPropType {
            full_name: Some(Cow::Owned(
                [parent_prop, b".", name.unwrap_or_default()].concat(),
            )),
            name: name.map(Cow::Borrowed),
            node: Some(Node::Expr(assignment)),
            is_required: Some(right.is_some_and(is_required_prop_type)),
            ..built
        };
        if let Some(cur) = cur_declared_prop_types {
            cur.insert(Cow::Borrowed(name.unwrap_or(UNDEFINED)), types);
        }
        Ok(ignore_props_validation)
    }

    /// The `switch` of `markPropTypesAsDeclared`: what `ignorePropsValidation` is after it.
    fn declare_prop_types(
        &mut self,
        node: Node<'a>,
        mut prop_types: PropTypes<'a>,
        declared_prop_types: &mut DeclaredPropTypes<'a>,
        mut ignore_props_validation: bool,
        root_node: Option<Node<'a>>,
    ) -> Result<bool, RangeError> {
        for _ in 0..MAX_DEPTH {
            let e = match prop_types {
                PropTypes::Null => return Ok(ignore_props_validation),
                PropTypes::Expr(e) => e,
                PropTypes::Type(ty) => {
                    let ts_type_annotation = declare_prop_types_for_ts_type_annotation(
                        Some(ty),
                        std::mem::take(declared_prop_types),
                        root_node,
                        &self.imports,
                        &self.custom_validators,
                        &self.steps,
                    );
                    *declared_prop_types = ts_type_annotation.declared_prop_types;
                    return Ok(ts_type_annotation.should_ignore_prop_types);
                }
                PropTypes::Other => return Ok(true),
            };
            prop_types = match e.kind() {
                ExprKind::Object(properties) => {
                    for prop_node in properties {
                        // A `SpreadElement` has no `value`.
                        let is_spread = prop_node.kind() == PropKind::Spread;
                        let Some(value) = prop_node.value().filter(|_| !is_spread) else {
                            ignore_props_validation = true;
                            continue;
                        };
                        let key = get_key_value(Node::Prop(prop_node));
                        let built = build_react_declaration_types(
                            Some(value),
                            key_in_full_name(prop_node, key.as_deref()),
                            root_node,
                            &self.custom_validators,
                            &self.steps,
                        )?;
                        let types = DeclaredPropType {
                            full_name: key.clone(),
                            name: key.clone(),
                            node: Some(Node::Prop(prop_node)),
                            is_required: Some(is_required_prop_type(value)),
                            ..built
                        };
                        declared_prop_types.insert(key.unwrap_or(Cow::Borrowed(UNDEFINED)), types);
                    }
                    return Ok(ignore_props_validation);
                }
                ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                    return self.declare_prop_types_for_member_expression(
                        e,
                        declared_prop_types,
                        ignore_props_validation,
                        root_node,
                    );
                }
                ExprKind::Ident(name) => {
                    let Some(first_matching_variable) = get_variable_from_context(node, name)
                    else {
                        return Ok(true);
                    };
                    let def_in_scope = get_latest_variable_definition(first_matching_variable)
                        // The `node` of the parameter of a `catch` is the `CatchClause`.
                        .filter(|it| it.kind() == Some(DeclarationKind::Variable));
                    match def_in_scope.and_then(Declaration::node) {
                        Some(Node::VarDecl(it)) => PropTypes::from_above(it.init()),
                        _ => PropTypes::Other,
                    }
                }
                ExprKind::Call(call) => match call.args().first() {
                    Some(argument) if is_prop_wrapper_function(e.file(), call.callee().text()) => {
                        PropTypes::from_above(Some(argument))
                    }
                    _ => return Ok(ignore_props_validation),
                },
                _ => return Ok(true),
            };
        }
        Err(RangeError)
    }

    /// `markPropTypesAsDeclared`. A `RangeError` ends it as it ends upstream's, whose listener for
    /// a `MemberExpression` catches it.
    fn mark_prop_types_as_declared(
        &mut self,
        components: &mut Components<'a>,
        node: Node<'a>,
        prop_types: PropTypes<'a>,
        root_node: Option<Node<'a>>,
    ) {
        // The component that upstream's loop finds. Without one it declares for nobody.
        let Some(id) = components.set(node) else {
            return;
        };
        if is_used_up(&self.steps) {
            components.leave_out(node);
        }
        let component = components.component_mut(id);
        let known = component.declared_prop_types.take();
        let ignore_props_validation = component.ignore_props_validation;
        let is_known = known.is_some();
        let mut declared_prop_types = known.unwrap_or_default();
        let declared = self.declare_prop_types(
            node,
            prop_types,
            &mut declared_prop_types,
            ignore_props_validation,
            root_node,
        );
        let component = components.component_mut(id);
        match declared {
            Ok(ignore_props_validation) => {
                component.declared_prop_types = Some(declared_prop_types);
                component.ignore_props_validation = ignore_props_validation;
            }
            // What is declared by then stays in the object that the component has.
            Err(RangeError) => {
                component.declared_prop_types = is_known.then_some(declared_prop_types)
            }
        }
    }

    /// `markAnnotatedFunctionArgumentsAsDeclared`
    fn mark_annotated_function_arguments_as_declared(
        &mut self,
        components: &mut Components<'a>,
        func: Func<'a>,
        root_node: Option<Node<'a>>,
    ) {
        let node = Node::Func(func);
        let Some(param) = func.params_with_this().next() else {
            return;
        };
        let parent = estree_parent(node);

        if let Some(call) = call_with_type_arguments(parent)
            && is_forward_ref(call.callee())
        {
            let obj = declare_prop_types_for_ts_type_annotation(
                call.type_args().get(1),
                DeclaredPropTypes::default(),
                root_node,
                &self.imports,
                &self.custom_validators,
                &self.steps,
            );
            if let Some(id) = components.set(node) {
                let component = components.component_mut(id);
                component.declared_prop_types = Some(obj.declared_prop_types);
                component.ignore_props_validation = obj.should_ignore_prop_types;
            }
            return;
        }

        let sibling_annotation = sibling_type_annotation(parent);
        let is_node_annotated = is_annotated_function_props_declaration(func);
        if !is_node_annotated && sibling_annotation.is_none() {
            return;
        }

        if func.is_arrow() && self.is_inside_class_body(node) {
            return;
        }

        // Should ignore function that not return JSXElement
        if !components.is_returning_jsx_or_null(node, Branches::Any)
            || start_with_capitalized_letter(parent)
        {
            return;
        }

        let annotation = match is_node_annotated {
            true => param.ty(),
            false => sibling_annotation.filter(|&annotation| {
                (annotation.tag() == TypeTag::Ref || has_type_arguments(annotation))
                    && is_valid_react_generic_type_annotation(annotation, &self.imports)
            }),
        };
        if let Some(annotation) = annotation {
            let prop_types = PropTypes::Type(annotation);
            self.mark_prop_types_as_declared(components, node, prop_types, root_node);
        }
    }

    /// `resolveSuperParameterPropsType`
    fn resolve_super_parameter_props_type(&mut self, node: Class<'a>) -> PropTypes<'a> {
        let parameters = node.extends_args();
        let flow_version = *self
            .flow_version
            .get_or_insert_with(|| get_flow_version_from_context(node.file()));
        let props_parameter_position = match flow_version {
            // Flow <=0.52 had 3 required TypedParameters of which the second one is the Props.
            // Flow >=0.53 has 2 optional TypedParameters of which the first one is the Props.
            Some(flow_version) => usize::from(flow_version < (0, 53, 0)),
            // In case there is no flow version defined, we can safely assume that when there are
            // 3 Props we are dealing with version <= 0.52
            None => usize::from(parameters.len() > 2),
        };
        match parameters.get(props_parameter_position) {
            Some(annotation) if annotation.tag() == TypeTag::Ref => PropTypes::Type(annotation),
            _ => PropTypes::Other,
        }
    }

    /// `ClassDeclaration(node)`, and what `Program:exit` does with a `ClassExpression`.
    fn class(&mut self, components: &mut Components<'a>, class: Class<'a>) {
        let node = Node::Class(class);
        let prop_types = self.resolve_super_parameter_props_type(class);
        self.mark_prop_types_as_declared(components, node, prop_types, Some(node));
    }

    /// `"ClassProperty, PropertyDefinition"(node)`
    fn property_definition(&mut self, components: &mut Components<'a>, member: Member<'a>) {
        let node = Node::Member(member);
        // `isAnnotatedClassPropsDeclaration`
        let annotation = member.ty();
        let prop_types = match annotation.filter(|_| is_props(member.file(), member.span().start)) {
            Some(annotation) => PropTypes::Type(annotation),
            None if is_prop_types_declaration(node) => PropTypes::from_above(member.init()),
            None => return,
        };
        self.mark_prop_types_as_declared(components, node, prop_types, Some(node));
    }

    /// `MethodDefinition(node)`
    fn method_definition(&mut self, components: &mut Components<'a>, member: Member<'a>) {
        let node = Node::Member(member);
        if !member.is_static()
            || member.kind() != MemberKind::Getter
            || !is_prop_types_declaration(node)
        {
            return;
        }
        let body = member.func().and_then(Func::body_statements);
        let returned = (body.into_iter().flatten().rev()).find_map(|it| match it.kind() {
            StmtKind::Return(argument) => Some(argument),
            _ => None,
        });
        if let Some(argument) = returned {
            let prop_types = PropTypes::from_above(argument);
            self.mark_prop_types_as_declared(components, node, prop_types, Some(node));
        }
    }

    /// `ObjectExpression(node)`
    fn object_expression(
        &mut self,
        components: &mut Components<'a>,
        node: Node<'a>,
        properties: List<'a, Prop<'a>>,
    ) {
        // Search for the proptypes declaration
        for property in properties {
            if is_prop_types_declaration(Node::Prop(property)) {
                let prop_types = PropTypes::from_above(property.value());
                self.mark_prop_types_as_declared(components, node, prop_types, Some(node));
            }
        }
    }

    /// `MemberExpression(node)`
    fn member_expression(&mut self, components: &mut Components<'a>, e: Expr<'a>) {
        let Some(component) = components.get_related_component(e) else {
            return;
        };
        let component_node = components.component(component).node;
        let prop_types = PropTypes::right_or_parent(e);
        self.mark_prop_types_as_declared(
            components,
            component_node,
            prop_types,
            Some(Node::Expr(e)),
        );
    }
}

impl<'a> Instructions<'a> for PropTypesInstructions<'a> {
    fn nodes(&self, file: &'a File<'a>, add: &mut dyn FnMut(Node<'a>, Visit)) {
        let mut add = |node| add(node, Visit::Enter);
        // The `name` of a `PrivateIdentifier` is without the `#`.
        let mentions_prop_types = file.mentions_any(&["propTypes", "#propTypes"]);
        let mentions_props = file.mentions_any(&["props", "#props"]);
        for class in file.classes() {
            if is_super_type_parameter_props_declaration(class) {
                add(Node::Class(class));
            }
            for member in class.members() {
                let node = Node::Member(member);
                if (mentions_props && member.ty().is_some())
                    || (mentions_prop_types && is_prop_types_declaration(node))
                {
                    add(node);
                }
            }
        }
        if mentions_prop_types {
            for e in file.exprs_of_kind(ExprTag::Object) {
                if let ExprKind::Object(properties) = e.kind()
                    && (properties.iter()).any(|it| is_prop_types_declaration(Node::Prop(it)))
                    && !e.is_assignment_target()
                {
                    add(Node::Expr(e));
                }
            }
            let members = [ExprTag::Dot, ExprTag::Index].map(|tag| file.exprs_of_kind(tag));
            for node in members.into_iter().flatten().map(Node::Expr) {
                if is_prop_types_declaration(node) {
                    add(node);
                }
            }
        }
        for func in file.funcs() {
            // The parent of the function of a method of a class is a `MethodDefinition`.
            if !ast_utils::is_function_with_body(func) || matches!(func.owner(), Node::Member(_)) {
                continue;
            }
            let (node, param) = (Node::Func(func), func.params_with_this().next());
            if param.is_some_and(|param| {
                let parent = estree_parent(node);
                param.ty().is_some()
                    || sibling_type_annotation(parent).is_some()
                    || call_with_type_arguments(parent).is_some()
            }) {
                add(node);
            }
        }
        if file.mentions("react") {
            for statement in file.stmts_of_kind(StmtTag::Import) {
                add(Node::Stmt(statement));
            }
        }
    }

    fn enter(&mut self, node: Node<'a>, components: &mut Components<'a>) {
        match node {
            // TypeParameterDeclaration need to be added to typeScope in order to handle
            // ClassExpressions: processing them is postponed until when the program exists.
            Node::Class(class) if matches!(class.owner(), Node::Expr(_)) => {
                self.class_expressions.push(class);
            }
            Node::Class(class) => self.class(components, class),
            Node::Member(member) if ast_utils::is_property_definition(member) => {
                self.property_definition(components, member);
            }
            Node::Member(member) => self.method_definition(components, member),
            Node::Func(func) => {
                // The listeners for the two other kinds are called with the node alone.
                let root_node =
                    (!matches!(func.kind(), FnKind::Decl | FnKind::Arrow)).then_some(node);
                self.mark_annotated_function_arguments_as_declared(components, func, root_node);
            }
            Node::Stmt(statement) => {
                if let StmtKind::Import(import) = statement.kind() {
                    self.imports.add(import);
                }
            }
            Node::Expr(e) => match e.kind() {
                ExprKind::Object(properties) => {
                    self.object_expression(components, node, properties)
                }
                _ => self.member_expression(components, e),
            },
            _ => {}
        }
    }

    fn program_exit(&mut self, components: &mut Components<'a>) {
        for class in std::mem::take(&mut self.class_expressions) {
            self.class(components, class);
        }
    }
}

/// `propTypesInstructions`. `custom_validators`: `context.options[0].customValidators`.
pub(crate) fn declared<'a>(custom_validators: &[Box<[u8]>]) -> Box<dyn Instructions<'a> + 'a> {
    Box::new(PropTypesInstructions {
        custom_validators: custom_validators.to_vec(),
        ..PropTypesInstructions::default()
    })
}
