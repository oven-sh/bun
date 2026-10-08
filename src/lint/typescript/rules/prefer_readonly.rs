use bun_lint::prelude::*;
use bun_lint::types::tsutils::{
    is_intersection_type, is_literal_type, is_object_flag_set, is_object_type, is_type_flag_set,
};
use bun_lint::types::utils::type_is_or_has_base_type;
use bun_lint::types::{ObjectFlags, Type, TypeFlags};
use bun_lint::utils::eslint_utils::find_variable;
use bun_lint::utils::ts_scope::is_type_definition;
use bun_lint::utils::ts_utils::{
    MemberAccessValue, get_member_head_loc, get_parameter_property_head_loc,
    get_static_member_access_value,
};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;
use std::borrow::Cow;

/// Require private members to be marked as `readonly` if they're never modified outside of the constructor.
pub struct PreferReadonly {
    only_inline_lambdas: bool,
}

const PREFER_READONLY: Message =
    Message::new("preferReadonly", "Member '{{name}}' is never reassigned; mark it as `readonly`.");

#[derive(Copy, Clone, PartialEq, Eq)]
enum TypeToClassRelation {
    ClassAndInstance,
    Class,
    Instance,
    None,
}

#[derive(Copy, Clone)]
enum ParameterOrPropertyDeclaration<'a> {
    Parameter(Param<'a>),
    Property(Member<'a>),
}

/// An entry of upstream's `privateModifiableMembers` or `privateModifiableStatics`.
struct PrivateModifiable<'a> {
    name: &'a [u8],
    node: ParameterOrPropertyDeclaration<'a>,
    is_static: bool,
    is_modified: bool,
    has_constructor_modifications: bool,
}

struct ClassScope<'a> {
    class_type: Option<Type<'a>>,
    private_modifiables: SmallVec<[PrivateModifiable<'a>; 4]>,
    /// Where each is in `private_modifiables`, by its name and whether it is static, once there are more than [`FEW`].
    positions: FxHashMap<(&'a [u8], bool), usize>,
}

/// So many members are searched one by one.
const FEW: usize = 16;

/// The classes that have a private member that is not `readonly`.
pub struct ClassScopes<'a>(FxHashMap<Class<'a>, ClassScope<'a>>);

fn get_member_name<'a>(key: Key<'a>, file: &'a File<'a>) -> Option<&'a [u8]> {
    match key.kind() {
        KeyKind::Ident(name)
        | KeyKind::Private(name)
        | KeyKind::String(name)
        | KeyKind::ComputedNumber(name) => Some(name.bytes()),
        // A `bigint` is not a `NumericLiteral`.
        KeyKind::Number(name) => (!file.slice(key.span(file)).ends_with(b"n")).then(|| name.bytes()),
        KeyKind::ComputedString(_) => None,
        KeyKind::Computed(expression) => match expression.kind() {
            ExprKind::Dot { obj, .. }
                if !expression.is_parenthesized() && !obj.is_parenthesized() && obj.is_ident("Symbol") =>
            {
                Some(expression.text())
            }
            _ => None,
        },
    }
}

fn get_type_to_class_relation<'a>(ty: Type<'a>, class_type: Type<'a>) -> TypeToClassRelation {
    if ty.is_intersection() {
        let mut result = TypeToClassRelation::None;
        for sub_type in ty.types() {
            match get_type_to_class_relation(sub_type, class_type) {
                TypeToClassRelation::Class => {
                    if result == TypeToClassRelation::Instance {
                        return TypeToClassRelation::ClassAndInstance;
                    }
                    result = TypeToClassRelation::Class;
                }
                TypeToClassRelation::Instance => {
                    if result == TypeToClassRelation::Class {
                        return TypeToClassRelation::ClassAndInstance;
                    }
                    result = TypeToClassRelation::Instance;
                }
                _ => {}
            }
        }
        return result;
    }
    if ty.is_union() {
        // A union of the class or an instance with anything else has no access to private
        // members, which is an error of its own.
        return match ty.types().first() {
            Some(first) => get_type_to_class_relation(first, class_type),
            None => TypeToClassRelation::None,
        };
    }
    if ty.get_symbol().is_none() || !type_is_or_has_base_type(ty, class_type) {
        return TypeToClassRelation::None;
    }
    match is_object_type(ty) && is_object_flag_set(ty, ObjectFlags::ANONYMOUS) {
        true => TypeToClassRelation::Class,
        false => TypeToClassRelation::Instance,
    }
}

impl<'a> ClassScope<'a> {
    fn position(&self, name: &[u8], is_static: bool) -> Option<usize> {
        match self.private_modifiables.len() <= FEW {
            true => self.private_modifiables.iter().position(|it| it.name == name && it.is_static == is_static),
            false => self.positions.get(&(name, is_static)).copied(),
        }
    }

    fn push(&mut self, member: PrivateModifiable<'a>) {
        self.private_modifiables.push(member);
        let known = match self.private_modifiables.len() {
            0..=FEW => return,
            len if len == FEW + 1 => 0,
            len => len - 1,
        };
        let added = self.private_modifiables.iter().enumerate().skip(known);
        self.positions.extend(added.map(|(i, it)| ((it.name, it.is_static), i)));
    }

    fn add_declared_variable(
        &mut self,
        node: ParameterOrPropertyDeclaration<'a>,
        only_inline_lambdas: bool,
    ) {
        let (flags, initializer, key) = match node {
            ParameterOrPropertyDeclaration::Parameter(param) => (param.flags(), param.default(), None),
            ParameterOrPropertyDeclaration::Property(member) => (member.flags(), member.init(), member.key()),
        };
        if !(flags.contains(Flags::PRIVATE) || key.is_some_and(Key::is_private))
            || flags.intersects(Flags::ACCESSOR | Flags::READONLY)
        {
            return;
        }
        if only_inline_lambdas
            && initializer.is_some_and(|it| it.is_parenthesized() || !it.as_fn().is_some_and(Func::is_arrow))
        {
            return;
        }
        let member_name = match node {
            ParameterOrPropertyDeclaration::Parameter(param) => param.pat().as_ident().map(|name| name.bytes()),
            ParameterOrPropertyDeclaration::Property(member) => key.and_then(|key| get_member_name(key, member.file())),
        };
        let Some(member_name) = member_name else {
            return;
        };
        let is_static = flags.contains(Flags::STATIC);
        let existing = self.position(member_name, is_static);
        match existing.and_then(|i| self.private_modifiables.get_mut(i)) {
            Some(existing) => existing.node = node,
            None => self.push(PrivateModifiable {
                name: member_name,
                node,
                is_static,
                is_modified: false,
                has_constructor_modifications: false,
            }),
        }
    }

    fn add_variable_modification_by_name(
        &mut self,
        class: Class<'a>,
        expression: Expr<'a>,
        member_name: &[u8],
        is_directly_inside_constructor: bool,
    ) {
        let named = [false, true].map(|is_static| self.position(member_name, is_static));
        if named == [None, None] {
            return;
        }
        let class_type = *self.class_type.get_or_insert_with(|| {
            let class_type = class.type_at_location();
            match is_intersection_type(class_type) {
                true => class_type.types().first().unwrap_or(class_type),
                false => class_type,
            }
        });
        let modifier_type = expression.ty();
        let relation = match modifier_type.is_unresolved() {
            true => TypeToClassRelation::ClassAndInstance,
            false => get_type_to_class_relation(modifier_type, class_type),
        };
        for i in named.into_iter().flatten() {
            let Some(it) = self.private_modifiables.get_mut(i) else {
                continue;
            };
            if relation == TypeToClassRelation::Instance && is_directly_inside_constructor {
                it.has_constructor_modifications = true;
                continue;
            }
            it.is_modified |= match it.is_static {
                true => matches!(relation, TypeToClassRelation::Class | TypeToClassRelation::ClassAndInstance),
                false => matches!(relation, TypeToClassRelation::Instance | TypeToClassRelation::ClassAndInstance),
            };
        }
    }
}

/// A node of TypeScript's tree, as far as it matters to `is_destructuring_assignment`.
#[derive(Copy, Clone)]
enum TsNodeLike<'a> {
    /// The expression in that many of its parentheses.
    Expr(Expr<'a>, usize),
    /// A `PropertyAssignment`, a `ShorthandPropertyAssignment` or a `SpreadAssignment`.
    Prop(Prop<'a>),
    Other,
}

/// The `{ a = 1 }` of a destructuring assignment that `e` is the `a = 1` of. TypeScript has no node
/// for the `a = 1`.
fn shorthand_with_default(e: Expr<'_>) -> Option<Prop<'_>> {
    match (e.kind(), e.parent()) {
        (ExprKind::Assign { .. }, Node::Prop(prop)) if prop.kind() == PropKind::Shorthand => Some(prop),
        _ => None,
    }
}

fn ts_parent(node: TsNodeLike<'_>) -> TsNodeLike<'_> {
    match node {
        TsNodeLike::Expr(e, parens) => {
            if e.is_parenthesized() && parens < e.parens().len() {
                return TsNodeLike::Expr(e, parens + 1);
            }
            match e.parent() {
                Node::Expr(parent) => match shorthand_with_default(parent) {
                    Some(prop) => TsNodeLike::Prop(prop),
                    None => TsNodeLike::Expr(parent, 0),
                },
                Node::Prop(prop) if prop.value() == Some(e) && !prop.is_jsx_attribute() => TsNodeLike::Prop(prop),
                _ => TsNodeLike::Other,
            }
        }
        TsNodeLike::Prop(prop) => match prop.parent() {
            Node::Expr(object) => TsNodeLike::Expr(object, 0),
            _ => TsNodeLike::Other,
        },
        TsNodeLike::Other => TsNodeLike::Other,
    }
}

fn is_destructuring_assignment(node: Expr<'_>) -> bool {
    let mut current = ts_parent(TsNodeLike::Expr(node, 0));
    loop {
        let parent = ts_parent(current);
        let is_part_of_pattern = match parent {
            TsNodeLike::Expr(parent_expr, 0) => match parent_expr.kind() {
                ExprKind::Object(_) | ExprKind::Array(_) => true,
                ExprKind::Spread(_) => {
                    matches!(ts_parent(parent), TsNodeLike::Expr(it, 0) if matches!(it.kind(), ExprKind::Array(_)))
                }
                ExprKind::Assign { op: None, target, .. } => {
                    return match current {
                        TsNodeLike::Expr(it, 0) if matches!(it.kind(), ExprKind::Dot { .. }) => false,
                        TsNodeLike::Expr(it, _) => it == target,
                        _ => false,
                    };
                }
                _ => false,
            },
            TsNodeLike::Prop(prop) => prop.kind() == PropKind::Spread,
            _ => false,
        };
        if !is_part_of_pattern {
            return false;
        }
        current = parent;
    }
}

/// Upstream's `handlePropertyAccessExpression`: whether it adds a modification.
fn is_modified_property_access(node: Expr<'_>) -> bool {
    if !node.is_parenthesized()
        && let Node::Expr(parent) = node.parent()
    {
        match parent.kind() {
            ExprKind::Assign { target, .. } if shorthand_with_default(parent).is_none() => return target == node,
            ExprKind::Binary { .. } => return false,
            ExprKind::Unary {
                op: UnOp::Delete | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                ..
            } => return true,
            _ => {}
        }
    }
    is_destructuring_assignment(node)
}

/// The innermost class around `node`, and whether `node` is in its constructor and in no other
/// function in that.
fn enclosing_class(node: Expr<'_>) -> Option<(Class<'_>, bool)> {
    let mut innermost_function = None;
    for ancestor in Node::Expr(node).ancestors() {
        match ancestor {
            Node::Func(func) if innermost_function.is_none() => innermost_function = Some(func),
            Node::Class(class) => {
                let is_directly_inside_constructor = innermost_function
                    .is_some_and(|func| matches!(func.owner(), Node::Member(member) if member.is_constructor()));
                return Some((class, is_directly_inside_constructor));
            }
            _ => {}
        }
    }
    None
}

/// The type to annotate the `PropertyDefinition` with: once it is `readonly`, the type of a literal
/// that initializes it is not widened any more.
fn get_type_annotation<'a>(member: Member<'a>, key: Key<'a>) -> Option<Vec<u8>> {
    if member.ty().is_some() || !matches!(key.kind(), KeyKind::Ident(_)) {
        return None;
    }
    let violating_type = member.type_at_location();
    let initializer_type = member.init()?.ty();
    if initializer_type == violating_type || !is_literal_type(initializer_type) {
        return None;
    }
    let annotation = violating_type.to_text();
    // The name of the enum has to mean the enum here.
    if is_type_flag_set(initializer_type, TypeFlags::ENUM_LITERAL) {
        let variable = find_variable(Node::Member(member).scope(), &annotation)?;
        let definition = variable.declarations().find(|it| is_type_definition(*it))?;
        if definition.node()?.ty() != violating_type {
            return None;
        }
    }
    Some(annotation)
}

fn report<'a>(cx: &Cx<'a, PreferReadonly>, violating: &PrivateModifiable<'a>) {
    let file = cx.file();
    let member = match violating.node {
        ParameterOrPropertyDeclaration::Parameter(param) => {
            // The `?` and the type annotation are part of the `Identifier`.
            cx.report(get_parameter_property_head_loc(param, violating.name), PREFER_READONLY)
                .data("name", file.slice(param.binding_span()))
                .fix(|fixer| fixer.insert_before(param.pat(), "readonly "));
            return;
        }
        ParameterOrPropertyDeclaration::Property(member) => member,
    };
    let Some(key) = member.key() else {
        return;
    };
    let name_node = key.inner_span(file);
    let is_property_definition = !member.flags().contains(Flags::ABSTRACT);
    let loc = match is_property_definition {
        true => get_member_head_loc(member),
        false => member.span(),
    };
    let has_constructor_modifications = violating.has_constructor_modifications;
    cx.report(loc, PREFER_READONLY).data("name", file.slice(name_node)).fix(|fixer| {
        let readonly_insertion_target = match is_property_definition && key.is_computed() {
            true => key.span(file),
            false => name_node,
        };
        let mut fixes = vec![fixer.insert_before(readonly_insertion_target, "readonly ")];
        if is_property_definition
            && has_constructor_modifications
            && let Some(type_annotation) = get_type_annotation(member, key)
        {
            fixes.push(fixer.insert_after(name_node, [&b": "[..], &type_annotation[..]].concat()));
        }
        fixes
    });
}

impl PreferReadonly {
    fn new_class_scope<'a>(&self, class: Class<'a>) -> ClassScope<'a> {
        let mut scope = ClassScope {
            class_type: None,
            private_modifiables: SmallVec::new(),
            positions: FxHashMap::default(),
        };
        for member in class.members() {
            if member.kind() == MemberKind::Property {
                scope.add_declared_variable(
                    ParameterOrPropertyDeclaration::Property(member),
                    self.only_inline_lambdas,
                );
            }
        }
        for constructor in class.members().iter().filter(|member| member.is_constructor()) {
            let parameters = constructor.func().into_iter().flat_map(Func::params);
            for parameter in parameters.filter(|it| it.flags().contains(Flags::PRIVATE)) {
                scope.add_declared_variable(
                    ParameterOrPropertyDeclaration::Parameter(parameter),
                    self.only_inline_lambdas,
                );
            }
        }
        scope
    }

    fn check_member_expression<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let is_modified = match node.kind() {
            ExprKind::Dot { .. } => is_modified_property_access(node),
            ExprKind::Index { .. } => {
                !node.is_parenthesized()
                    && matches!(
                        node.parent(),
                        Node::Expr(parent) if matches!(parent.kind(), ExprKind::Assign { target, .. } if target == node)
                    )
            }
            _ => false,
        };
        if !is_modified {
            return;
        }
        let Some((class, is_directly_inside_constructor)) = enclosing_class(node) else {
            return;
        };
        let Some(class_scope) = cx.state.0.get_mut(&class) else {
            return;
        };
        let (expression, member_name) = match node.kind() {
            ExprKind::Dot { obj, name, .. } => (obj, Cow::Borrowed(name.bytes())),
            ExprKind::Index { obj, .. } => match get_static_member_access_value(node) {
                Some(MemberAccessValue::String(member_name)) => (obj, member_name),
                _ => return,
            },
            _ => return,
        };
        class_scope.add_variable_modification_by_name(
            class,
            expression,
            &member_name,
            is_directly_inside_constructor,
        );
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        for class_scope in cx.state.0.values() {
            for violating in class_scope.private_modifiables.iter().filter(|it| !it.is_modified) {
                report(cx, violating);
            }
        }
    }
}

impl Rule for PreferReadonly {
    const META: Meta = Meta::typescript("prefer-readonly", Kind::Suggestion)
        .fixable(Fixable::Code)
        .requires_types();
    type State<'a> = ClassScopes<'a>;

    fn new(options: &Options) -> Self {
        PreferReadonly {
            only_inline_lambdas: options.object(0).bool_or("onlyInlineLambdas", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> ClassScopes<'a> {
        let mut class_scopes = FxHashMap::default();
        for class in file.classes() {
            let class_scope = self.new_class_scope(class);
            if !class_scope.private_modifiables.is_empty() {
                class_scopes.insert(class, class_scope);
            }
        }
        if !class_scopes.is_empty() {
            on.exprs([ExprTag::Dot, ExprTag::Index], Self::check_member_expression);
            on.finish(Self::finish);
        }
        ClassScopes(class_scopes)
    }
}
