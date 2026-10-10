use crate::util_ast::{Property, get_property_name};
use crate::util_components::Components;
use crate::util_components_list::{At, ComponentId};
use crate::util_prop_wrapper::is_prop_wrapper_function;
use crate::util_props::is_prop_types_declaration;
use bun_lint::context::interpolate_text;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::{estree_parent, sort};
use rustc_hash::FxHashMap;
use smallvec::{SmallVec, smallvec};
use std::cell::OnceCell;

/// Enforces consistent naming for boolean props.
pub struct BooleanPropNaming {
    /// `config.rule`
    pattern: String,
    /// `None` without options: nothing is checked then.
    rule: Option<Regex>,
    prop_type_names: Vec<Box<[u8]>>,
    message: Option<String>,
    validate_nested: bool,
}

const PATTERN_MISMATCH: Message =
    Message::new("patternMismatch", "Prop name `{{propName}}` doesn’t match rule `{{pattern}}`");
/// `config.message`
const CONFIGURED: Message = Message::new("", "{{message}}");

/// What a name that is `undefined` is tested and shown as.
const UNDEFINED: &[u8] = b"undefined";

/// `config.rule`, with the default of the schema. `None`: there are no options.
fn rule_of<'o>(options: &Options<'o>) -> Option<&'o str> {
    options.get(0).map(|_| options.object(0).str("rule").unwrap_or("^(is|has)[A-Z]([A-Za-z0-9]?)+"))
}

impl Rule for BooleanPropNaming {
    const META: Meta = Meta::plugin(Plugin::React, "boolean-prop-naming", Kind::Suggestion).reports_at_the_end();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let pattern = rule_of(options);
        let config = options.object(0);
        let prop_type_names = if config.has("propTypeNames") { config.strings("propTypeNames") } else { vec!["bool"] };
        BooleanPropNaming {
            pattern: pattern.unwrap_or_default().to_owned(),
            rule: pattern.and_then(|it| Regex::new(it, "").ok()),
            prop_type_names: prop_type_names.into_iter().map(|it| it.as_bytes().into()).collect(),
            message: config.str("message").map(str::to_owned),
            validate_nested: config.bool_or("validateNested", false),
        }
    }

    fn validate(options: &Options) -> Result<(), Vec<u8>> {
        match rule_of(options).map(|it| Regex::new(it, "")) {
            Some(Err(error)) => Err(error.message.into_bytes()),
            _ => Ok(()),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        // The `name` of a `PrivateIdentifier` is without the `#`.
        let names = ["propTypes", "#propTypes", "boolean"];
        (self.rule.is_some() && file.mentions_any(&names) && Components::may_have_any(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let Some(rule) = &self.rule else {
            return;
        };
        let file = cx.file();
        let mut walk = Walk {
            config: self,
            rule,
            file,
            components: Components::new(file),
            invalid_props: FxHashMap::default(),
            object_type_annotations: OnceCell::new(),
        };
        for node in listened(file) {
            walk.components.advance(At::enter(node));
            match node {
                Node::Member(member) => walk.property_definition(member),
                Node::Expr(e) => match e.kind() {
                    ExprKind::Object(properties) => walk.object_expression(e, properties),
                    _ => walk.member_expression(e),
                },
                _ => {}
            }
        }

        walk.components.finish();
        for id in walk.components.list() {
            let node = walk.components.component(id).node;
            let prop_type = get_component_type_annotation(node).map(|it| walk.prop_type(it));
            for members in prop_type.unwrap_or_default() {
                walk.validate_prop_naming(node, PropTypes::Members(members));
            }
            for prop_node in walk.invalid_props.get(&id).into_iter().flatten() {
                self.report_invalid_naming(*prop_node, cx);
            }
        }
    }
}

impl BooleanPropNaming {
    /// `reportInvalidNaming`, for one of the `invalidProps`.
    fn report_invalid_naming<'a>(&self, prop_node: Property<'a>, cx: &Cx<'a, Self>) {
        let prop_name = prop_node.name().unwrap_or(UNDEFINED);
        let Some(message) = &self.message else {
            cx.report(prop_node.node(), PATTERN_MISMATCH)
                .data("component", prop_name)
                .data("propName", prop_name)
                .data("pattern", self.pattern.clone());
            return;
        };
        let message = interpolate_text(message, |name| match name {
            "component" | "propName" => Some(prop_name),
            "pattern" => Some(self.pattern.as_bytes()),
            _ => None,
        });
        cx.report(prop_node.node(), CONFIGURED).data("message", message);
    }
}

/// The nodes at which a listener of upstream does something before the program ends, as ESLint gets to them.
fn listened<'a>(file: &'a File<'a>) -> Vec<Node<'a>> {
    // A field `props` with a type does nothing but forget what a `propTypes` has brought.
    if !file.mentions_any(&["propTypes", "#propTypes"]) {
        return Vec::new();
    }
    let fields = file.classes().flat_map(Class::members).filter(|it| ast_utils::is_property_definition(*it));
    let members = [ExprTag::Dot, ExprTag::Index].map(|tag| file.exprs_of_kind(tag));
    let declarations = fields.map(Node::Member).chain(members.into_iter().flatten().map(Node::Expr));
    let has_declaration = |it: &Expr<'a>| {
        matches!(it.kind(), ExprKind::Object(properties)
            if properties.iter().any(|it| is_prop_types_declaration(Node::Prop(it))))
            && !it.is_assignment_target()
    };
    let objects = file.exprs_of_kind(ExprTag::Object).filter(has_declaration).map(Node::Expr);
    let mut nodes: Vec<Node<'a>> = declarations.filter(|it| is_prop_types_declaration(*it)).chain(objects).collect();
    sort::sort_by_key(&mut nodes, |it| At::enter(*it));
    nodes
}

/// `nestedPropTypes`: the call that is `prop.value`.
fn nested_prop_types(prop: Prop<'_>) -> Option<Call<'_>> {
    prop.value().filter(|it| prop.kind() != PropKind::Spread && !it.is_chain_root())?.as_call()
}

/// `node.property.name`. The outer `None`: `node` has no `property`.
fn name_of_property(node: Expr<'_>) -> Option<Option<&[u8]>> {
    match node.kind() {
        ExprKind::Dot { .. } | ExprKind::Index { .. } if !node.is_chain_root() => {
            Some(get_property_name(Node::Expr(node)))
        }
        // A `MetaProperty` has one too.
        ExprKind::ImportMeta => Some(Some(&b"meta"[..])),
        ExprKind::NewTarget => Some(Some(&b"target"[..])),
        _ => None,
    }
}

/// `getPropKey`
fn get_prop_key(node: Prop<'_>) -> Option<&[u8]> {
    let value = node.value().filter(|_| node.kind() != PropKind::Spread)?;
    match name_of_property(value) {
        Some(Some(b"isRequired")) => name_of_property(value.object()?)?,
        Some(name) => name,
        None => value.as_ident().map(Name::bytes),
    }
}

/// The call that `node` is, if that is one of a prop wrapper function.
fn as_call_of_prop_wrapper(node: Expr<'_>) -> Option<Call<'_>> {
    let call = node.as_call().filter(|_| !node.is_chain_root())?;
    is_prop_wrapper_function(node.file(), call.callee().text()).then_some(call)
}

/// `node.parent.right`
fn right_of_parent(node: Expr<'_>) -> Option<Expr<'_>> {
    // A `ChainExpression`, a `JSXExpressionContainer`.
    if node.is_chain_root() || node.jsx_container_span().is_some() {
        return None;
    }
    match estree_parent(Node::Expr(node)) {
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Binary { op, right, .. } if op != BinOp::Comma => Some(right),
            ExprKind::Assign { value, .. } => Some(value),
            _ => None,
        },
        Node::Stmt(parent) => match parent.kind() {
            StmtKind::ForIn { expr, .. } | StmtKind::ForOf { expr, .. } => Some(expr),
            _ => None,
        },
        // An `AssignmentPattern`, if `node` is the default.
        Node::Param(param) => param.default().filter(|it| *it == node),
        Node::PatProp(prop) => prop.default().filter(|it| *it == node),
        Node::PatElem(element) => element.default().filter(|it| *it == node),
        _ => None,
    }
}

/// `getComponentTypeAnnotation`
fn get_component_type_annotation(node: Node<'_>) -> Option<TypeNode<'_>> {
    // If this is a functional component that uses a global type, check it
    if let Node::Func(func) = node
        && matches!(func.kind(), FnKind::Decl | FnKind::Arrow)
        // With a default it is an `AssignmentPattern`, which has no annotation.
        && let Some(param) = func.params_with_this().next().filter(|it| it.default().is_none())
        && let Some(annotation) = param.ty()
    {
        return Some(annotation);
    }
    let written = node.as_written().as_expr().filter(|it| !it.is_chain_root())?;
    let Node::VarDecl(declarator) = estree_parent(Node::Expr(written)) else {
        return None;
    };
    let annotation = declarator.ty().filter(|_| declarator.pat().as_ident().is_some())?;
    match annotation.kind() {
        TypeKind::Ref { args, .. }
        | TypeKind::Typeof { args, .. }
        | TypeKind::Import { args, is_typeof: false, .. } => args.iter().find(|it| it.tag() == TypeTag::Ref),
        _ => None,
    }
}

/// The `members` of some `TSTypeLiteral`s, the `body` of some `TSInterfaceBody`s.
type ObjectTypes<'a> = SmallVec<[List<'a, Member<'a>>; 2]>;

/// `findAllTypeAnnotations`
fn find_all_type_annotations<'a>(node: TypeNode<'a>, found: &mut ObjectTypes<'a>) {
    let mut worklist: SmallVec<[TypeNode<'a>; 8]> = smallvec![node];
    while let Some(node) = worklist.pop() {
        match node.kind() {
            TypeKind::Object(members) => found.push(members),
            TypeKind::Union(types) | TypeKind::Intersection(types) => worklist.extend(types.iter().rev()),
            _ => {}
        }
    }
}

/// `objectTypeAnnotations`, as it is when the program ends.
fn object_type_annotations<'a>(file: &'a File<'a>) -> FxHashMap<Name<'a>, ObjectTypes<'a>> {
    let declarations = [StmtTag::TypeAlias, StmtTag::Interface].map(|tag| file.stmts_of_kind(tag));
    let mut declarations: Vec<Stmt<'a>> = declarations.into_iter().flatten().collect();
    sort::sort_by_key(&mut declarations, |it| it.span().start);
    let mut all: FxHashMap<Name<'a>, ObjectTypes<'a>> = FxHashMap::default();
    for declaration in declarations {
        match declaration.kind() {
            StmtKind::TypeAlias(alias) => {
                find_all_type_annotations(alias.ty(), all.entry(alias.name().name()).or_default());
            }
            StmtKind::Interface(interface) => all.entry(interface.name().name()).or_default().push(interface.members()),
            _ => {}
        }
    }
    all
}

/// The `proptypes` of `validatePropNaming`.
#[derive(Copy, Clone)]
enum PropTypes<'a> {
    Undefined,
    Properties(List<'a, Prop<'a>>),
    Members(List<'a, Member<'a>>),
}

impl<'a> PropTypes<'a> {
    /// `node.properties`
    fn properties_of(node: Expr<'a>) -> PropTypes<'a> {
        match node.kind() {
            ExprKind::Object(properties) => PropTypes::Properties(properties),
            _ => PropTypes::Undefined,
        }
    }
}

/// What upstream's `create` keeps.
struct Walk<'r, 'a> {
    config: &'r BooleanPropNaming,
    rule: &'r Regex,
    file: &'a File<'a>,
    components: Components<'a>,
    /// `component.invalidProps`
    invalid_props: FxHashMap<ComponentId, Vec<Property<'a>>>,
    object_type_annotations: OnceCell<FxHashMap<Name<'a>, ObjectTypes<'a>>>,
}

impl<'a> Walk<'_, 'a> {
    /// `rule.test(getPropName(prop)) === false`
    fn is_named_otherwise(&self, prop: Property<'a>) -> bool {
        !self.rule.test(prop.name().unwrap_or(UNDEFINED))
    }

    /// `regularCheck`
    fn regular_check(&self, prop: Prop<'a>) -> bool {
        get_prop_key(prop).is_some_and(|prop_key| self.config.prop_type_names.iter().any(|it| prop_key == &**it))
            && self.is_named_otherwise(Property::Prop(prop))
    }

    /// `tsCheck`, for a member of an interface or a type literal.
    fn ts_check(&self, prop: Member<'a>) -> bool {
        prop.kind() == MemberKind::Property
            && prop.ty().is_some_and(|it| it.is_keyword(Keyword::Boolean))
            && self.is_named_otherwise(Property::Member(prop))
    }

    /// `runCheck`
    fn run_check(&self, proptypes: PropTypes<'a>, invalid_props: &mut Vec<Property<'a>>) {
        let properties = match proptypes {
            PropTypes::Undefined => return,
            PropTypes::Members(members) => {
                invalid_props.extend(members.iter().filter(|it| self.ts_check(*it)).map(Property::Member));
                return;
            }
            PropTypes::Properties(properties) => properties,
        };
        let mut worklist: SmallVec<[Prop<'a>; 8]> = properties.iter().rev().collect();
        while let Some(prop) = worklist.pop() {
            if self.config.validate_nested
                && let Some(call) = nested_prop_types(prop)
            {
                // Without an argument upstream throws.
                if let Some(ExprKind::Object(nested)) = call.args().first().map(Expr::kind) {
                    worklist.extend(nested.iter().rev());
                }
            } else if self.regular_check(prop) {
                invalid_props.push(Property::Prop(prop));
            }
        }
    }

    /// `validatePropNaming`
    fn validate_prop_naming(&mut self, node: Node<'a>, proptypes: PropTypes<'a>) {
        let component = self.components.get(node);
        let mut invalid_props = component.and_then(|it| self.invalid_props.remove(&it)).unwrap_or_default();
        self.run_check(proptypes, &mut invalid_props);
        // The component around a `node` that is none loses what it had.
        if let Some(component) = self.components.set(node) {
            self.invalid_props.insert(component, invalid_props);
        }
    }

    /// `checkPropWrapperArguments`
    fn check_prop_wrapper_arguments(&mut self, node: Node<'a>, args: List<'a, Expr<'a>>) {
        for object in args {
            if let properties @ PropTypes::Properties(_) = PropTypes::properties_of(object) {
                self.validate_prop_naming(node, properties);
            }
        }
    }

    /// `"ClassProperty, PropertyDefinition"`
    fn property_definition(&mut self, member: Member<'a>) {
        let node = Node::Member(member);
        if let Some(value) = member.init() {
            if let Some(call) = as_call_of_prop_wrapper(value) {
                self.check_prop_wrapper_arguments(node, call.args());
            }
            if let properties @ PropTypes::Properties(_) = PropTypes::properties_of(value) {
                self.validate_prop_naming(node, properties);
            }
        }
        // No type of TypeScript has `properties`.
        if member.ty().is_some() {
            self.validate_prop_naming(node, PropTypes::Undefined);
        }
    }

    /// `MemberExpression`
    fn member_expression(&mut self, node: Expr<'a>) {
        let Some(component) = self.components.get_related_component(node) else {
            return;
        };
        let Some(right) = right_of_parent(node) else {
            return;
        };
        let component = self.components.component(component).node;
        match as_call_of_prop_wrapper(right) {
            Some(call) => self.check_prop_wrapper_arguments(component, call.args()),
            None => self.validate_prop_naming(component, PropTypes::properties_of(right)),
        }
    }

    /// `ObjectExpression`
    fn object_expression(&mut self, node: Expr<'a>, properties: List<'a, Prop<'a>>) {
        for property in properties {
            if is_prop_types_declaration(Node::Prop(property)) {
                let proptypes = property.value().map_or(PropTypes::Undefined, PropTypes::properties_of);
                self.validate_prop_naming(Node::Expr(node), proptypes);
            }
        }
    }

    /// The `propType` of `Program:exit`, without what has no members.
    fn prop_type(&self, annotation: TypeNode<'a>) -> ObjectTypes<'a> {
        let types: SmallVec<[TypeNode<'a>; 4]> = match annotation.kind() {
            TypeKind::Intersection(types) => types.iter().collect(),
            _ => smallvec![annotation],
        };
        let mut prop_type = ObjectTypes::new();
        for ty in types {
            match ty.kind() {
                TypeKind::Object(members) => prop_type.push(members),
                TypeKind::Ref { name, .. } => {
                    let all = self.object_type_annotations.get_or_init(|| object_type_annotations(self.file));
                    prop_type.extend(name.as_ident().and_then(|it| all.get(&it.name())).into_iter().flatten().copied());
                }
                _ => {}
            }
        }
        prop_type
    }
}
