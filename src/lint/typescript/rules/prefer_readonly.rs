use bun_lint::prelude::*;
use bun_lint::types::tsutils::{
    is_intersection_type, is_object_flag_set, is_object_type, is_type_flag_set, union_constituents,
};
use bun_lint::types::utils::{get_type_flags, type_is_or_has_base_type};
use bun_lint::types::{
    IdMap, IdSet, ObjectFlags, SymbolFlags, SyntaxKind, TsNode, Type, TypeFlags,
};
use bun_lint::utils::ts_utils::{
    MemberAccessValue, get_member_head_loc, get_parameter_property_head_loc,
    get_static_member_access_value,
};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;
use std::borrow::Cow;
use std::cell::OnceCell;

/// Require private members to be marked as `readonly` if they're never modified outside of the constructor.
pub struct PreferReadonly {
    only_inline_lambdas: bool,
}

const PREFER_READONLY: Message = Message::new(
    "preferReadonly",
    "Member '{{name}}' is never reassigned; mark it as `readonly`.",
);

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
    class: Class<'a>,
    class_type: Option<Type<'a>>,
    private_modifiables: SmallVec<[PrivateModifiable<'a>; 4]>,
    /// Maps a name and whether it's static to its index in `private_modifiables`.
    positions: FxHashMap<(&'a [u8], bool), usize>,
}

/// The classes that have a private member that isn't `readonly`.
pub struct ClassScopes<'a> {
    scopes: Vec<ClassScope<'a>>,
    /// Maps each class to its scope's index in `scopes`.
    positions: IdMap<Class<'a>, usize>,
}

fn get_member_name<'a>(key: Key<'a>, file: &'a File<'a>) -> Option<&'a [u8]> {
    match key.kind() {
        KeyKind::Ident(name)
        | KeyKind::Private(name)
        | KeyKind::String(name)
        | KeyKind::ComputedNumber(name) => Some(name.bytes()),
        // A `bigint` isn't a `NumericLiteral`. tsgolint uses its source text as the name.
        KeyKind::Number(name) => {
            let text = file.slice(key.span(file));
            match text.ends_with(b"n") {
                true => file.language().is_oxlint.then_some(text),
                false => Some(name.bytes()),
            }
        }
        KeyKind::ComputedString(_) => None,
        KeyKind::Computed(expression) => match expression.kind() {
            ExprKind::Dot { obj, .. }
                if !expression.is_parenthesized()
                    && !obj.is_parenthesized()
                    && obj.is_ident("Symbol") =>
            {
                Some(expression.text())
            }
            _ => None,
        },
    }
}

/// tsgolint's `typeIsOrHasBaseType`: true if the type or any of its base types, at any depth, has `base_type`'s symbol.
fn tsgolint_type_is_or_has_base_type<'a>(ty: Type<'a>, base_type: Type<'a>) -> bool {
    let Some(base_symbol) = base_type.get_symbol() else {
        return false;
    };
    let mut queue: SmallVec<[Type<'a>; 4]> = SmallVec::new();
    let mut seen: IdSet<Type<'a>> = IdSet::new();
    queue.push(ty);
    while let Some(current) = queue.pop() {
        if !seen.insert(current) {
            continue;
        }
        if current.get_symbol() == Some(base_symbol) {
            return true;
        }
        if is_object_type(current)
            && is_object_flag_set(current, ObjectFlags::CLASS | ObjectFlags::INTERFACE)
        {
            queue.extend(current.get_base_types());
        }
    }
    false
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
        // A union of the class or an instance with anything else can't access private members. That's a separate error.
        return match ty.types().first() {
            Some(first) => get_type_to_class_relation(first, class_type),
            None => TypeToClassRelation::None,
        };
    }
    if ty.get_symbol().is_none() {
        return TypeToClassRelation::None;
    }
    let is_or_has_base_type = match class_type.file().language().is_oxlint {
        true => tsgolint_type_is_or_has_base_type(ty, class_type),
        false => type_is_or_has_base_type(ty, class_type),
    };
    if !is_or_has_base_type {
        return TypeToClassRelation::None;
    }
    match is_object_type(ty) && is_object_flag_set(ty, ObjectFlags::ANONYMOUS) {
        true => TypeToClassRelation::Class,
        false => TypeToClassRelation::Instance,
    }
}

impl<'a> ClassScope<'a> {
    fn position(&self, name: &[u8], is_static: bool) -> Option<usize> {
        self.positions.get(&(name, is_static)).copied()
    }

    fn push(&mut self, member: PrivateModifiable<'a>) {
        self.positions.insert(
            (member.name, member.is_static),
            self.private_modifiables.len(),
        );
        self.private_modifiables.push(member);
    }

    fn add_declared_variable(
        &mut self,
        node: ParameterOrPropertyDeclaration<'a>,
        only_inline_lambdas: bool,
    ) {
        let (flags, initializer, key) = match node {
            ParameterOrPropertyDeclaration::Parameter(param) => {
                (param.flags(), param.default(), None)
            }
            ParameterOrPropertyDeclaration::Property(member) => {
                (member.flags(), member.init(), member.key())
            }
        };
        if !(flags.contains(Flags::PRIVATE) || key.is_some_and(Key::is_private))
            || flags.intersects(Flags::ACCESSOR | Flags::READONLY)
        {
            return;
        }
        let is_oxlint = match node {
            ParameterOrPropertyDeclaration::Parameter(param) => param.file().language().is_oxlint,
            ParameterOrPropertyDeclaration::Property(member) => member.file().language().is_oxlint,
        };
        // tsgolint doesn't count a member without an initializer as a lambda either.
        if only_inline_lambdas
            && initializer.map_or(is_oxlint, |it| {
                it.is_parenthesized() || !it.as_fn().is_some_and(Func::is_arrow)
            })
        {
            return;
        }
        // tsgolint 7.0 skips `private [a] = 1`.
        if is_oxlint && key.is_some_and(Key::is_computed) {
            return;
        }
        let member_name = match node {
            ParameterOrPropertyDeclaration::Parameter(param) => {
                param.pat().as_ident().map(|name| name.bytes())
            }
            ParameterOrPropertyDeclaration::Property(member) => {
                key.and_then(|key| get_member_name(key, member.file()))
            }
        };
        let Some(member_name) = member_name else {
            return;
        };
        // tsgolint skips `private "" = 1`.
        if is_oxlint && member_name.is_empty() {
            return;
        }
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
        expression: Expr<'a>,
        member_name: &[u8],
        is_directly_inside_constructor: bool,
    ) {
        let named = [false, true].map(|is_static| self.position(member_name, is_static));
        if named == [None, None] {
            return;
        }
        let class = self.class;
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
                true => matches!(
                    relation,
                    TypeToClassRelation::Class | TypeToClassRelation::ClassAndInstance
                ),
                false => matches!(
                    relation,
                    TypeToClassRelation::Instance | TypeToClassRelation::ClassAndInstance
                ),
            };
        }
    }
}

/// A node of TypeScript's AST, as far as `is_destructuring_assignment` needs it.
#[derive(Copy, Clone)]
enum TsNodeLike<'a> {
    /// The expression wrapped in that many of its parentheses.
    Expr(Expr<'a>, usize),
    /// A `PropertyAssignment`, a `ShorthandPropertyAssignment` or a `SpreadAssignment`.
    Prop(Prop<'a>),
    Other,
}

/// If `e` is the `a = 1` in the `{ a = 1 }` of a destructuring assignment, returns that property. TypeScript has no
/// node for the `a = 1`.
fn shorthand_with_default(e: Expr<'_>) -> Option<Prop<'_>> {
    match (e.kind(), e.parent()) {
        (ExprKind::Assign { .. }, Node::Prop(prop)) if prop.kind() == PropKind::Shorthand => {
            Some(prop)
        }
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
                // `a!!` is two nodes in TypeScript, and the outer one is the inner one's parent.
                Node::Expr(parent) if parent.non_null_count() > 1 => TsNodeLike::Other,
                Node::Expr(parent) => match shorthand_with_default(parent) {
                    Some(prop) => TsNodeLike::Prop(prop),
                    None => TsNodeLike::Expr(parent, 0),
                },
                Node::Prop(prop) if prop.value() == Some(e) && !prop.is_jsx_attribute() => {
                    TsNodeLike::Prop(prop)
                }
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
                ExprKind::Assign {
                    op: None, target, ..
                } => {
                    return match current {
                        TsNodeLike::Expr(it, 0) if matches!(it.kind(), ExprKind::Dot { .. }) => {
                            false
                        }
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

/// Upstream's `handlePropertyAccessExpression`. Returns true if it adds a modification.
fn is_modified_property_access(node: Expr<'_>) -> bool {
    if !node.is_parenthesized()
        && let Node::Expr(parent) = node.parent()
    {
        match parent.kind() {
            ExprKind::Assign { target, .. } if shorthand_with_default(parent).is_none() => {
                return target == node;
            }
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

/// Whether the `Dot` or the `Index` is written to.
fn is_modification(node: Expr<'_>) -> bool {
    match node.kind() {
        ExprKind::Dot { .. } => is_modified_property_access(node),
        // tsgolint ignores writes through brackets.
        ExprKind::Index { .. } => {
            !node.file().language().is_oxlint
                && !node.is_parenthesized()
                && matches!(
                    node.parent(),
                    Node::Expr(parent) if matches!(parent.kind(), ExprKind::Assign { target, .. } if target == node)
                )
        }
        _ => false,
    }
}

/// The object of the `Dot` or the `Index`, and the name of the member that it accesses.
fn accessed_member<'a>(node: Expr<'a>) -> Option<(Expr<'a>, Cow<'a, [u8]>)> {
    match node.kind() {
        ExprKind::Dot { obj, name, .. } => Some((obj, Cow::Borrowed(name.bytes()))),
        ExprKind::Index { obj, .. } => match get_static_member_access_value(node) {
            Some(MemberAccessValue::String(member_name)) => Some((obj, member_name)),
            _ => None,
        },
        _ => None,
    }
}

/// tsgolint uses the TypeScript parser's idea of a constructor: `static constructor() {}` is one,
/// `"constructor"<T>() {}` and `*"constructor"() {}` are methods.
fn is_constructor(member: Member<'_>) -> bool {
    match member.file().language().is_oxlint {
        true => member.kind() == MemberKind::Constructor,
        false => member.is_constructor(),
    }
}

/// Returns the innermost class around `node`, and whether `node` is directly in its constructor, not in a function
/// nested in it.
fn enclosing_class(node: Expr<'_>) -> Option<(Class<'_>, bool)> {
    let mut innermost_function = None;
    for ancestor in Node::Expr(node).ancestors() {
        match ancestor {
            Node::Func(func) if innermost_function.is_none() => innermost_function = Some(func),
            Node::Class(class) => {
                let is_directly_inside_constructor = innermost_function.is_some_and(
                    |func| matches!(func.owner(), Node::Member(member) if is_constructor(member)),
                );
                return Some((class, is_directly_inside_constructor));
            }
            _ => {}
        }
    }
    None
}

/// What the fix does about the type of a member, which `readonly` would narrow to the type of its initializer.
enum Annotation<'a> {
    /// `readonly` leaves the type of the member as it is.
    NotNeeded,
    /// The type that the member has now, to write.
    Write(Vec<u8>),
    /// Nothing is written, and `readonly` narrows the member to this, the type of its initializer.
    Narrows(Type<'a>),
}

/// Whether `name`, written as a type where the member is, is `ty`.
fn names<'a>(member: Member<'a>, name: &[u8], ty: Type<'a>) -> bool {
    let types = member.file().type_checker();
    let Some(named) = types.resolve_name(member, name, SymbolFlags::TYPE, false) else {
        return false;
    };
    let named = named.skip_alias();
    // `type Color<T> = Enum` is the enum as well, and no type without an argument.
    let takes_arguments = |declaration: TsNode<'a>| {
        let mut children = declaration.children();
        children.any(|it| it.kind() == SyntaxKind::TypeParameter && it.default_type().is_none())
    };
    named.get_declared_type() == ty && !named.declarations().any(takes_arguments)
}

fn get_type_annotation<'a>(member: Member<'a>, key: Key<'a>) -> Annotation<'a> {
    let (None, Some(initializer)) = (member.ty(), member.init()) else {
        return Annotation::NotNeeded;
    };
    let (violating_type, initializer_type) = (member.type_at_location(), initializer.ty());
    // Both tools leave out an enum member whose value isn't known, like the `E.A` of `declare enum E { A, B }`.
    let widened = TypeFlags::LITERAL | TypeFlags::ENUM_LIKE;
    if initializer_type == violating_type || !get_type_flags(initializer_type).intersects(widened) {
        return Annotation::NotNeeded;
    }
    // typescript-eslint and tsgolint don't annotate `#a = 0`, so the constructor can't assign other numbers anymore.
    let is_named = matches!(key.kind(), KeyKind::Ident(_) | KeyKind::Private(_));
    if !is_named || initializer_type.is_union() {
        return Annotation::Narrows(initializer_type);
    }
    let annotation = violating_type.to_text();
    // The enum's name has to resolve to the enum here.
    let is_enum = is_type_flag_set(initializer_type, TypeFlags::ENUM_LIKE);
    match is_enum && !names(member, &annotation, violating_type) {
        true => Annotation::Narrows(initializer_type),
        false => Annotation::Write(annotation),
    }
}

/// Whether the `Assign` can be the default of a pattern, as in `[this.a = 1] = b`, which writes another value.
fn may_be_default_in_pattern(assign: Expr<'_>) -> bool {
    match assign.parent() {
        Node::Prop(_) => true,
        Node::Expr(parent) => matches!(parent.kind(), ExprKind::Array(_)),
        _ => false,
    }
}

/// Whether all that the constructor writes to `member` still type checks once `readonly` narrows it to `narrowed`.
fn constructor_writes_fit<'a>(
    class_scope: &ClassScope<'a>,
    member: Member<'a>,
    name: &[u8],
    narrowed: Type<'a>,
) -> bool {
    // What the constructor writes through an instance isn't the static member of that name.
    if member.is_static() {
        return true;
    }
    let (class, Some(class_type)) = (class_scope.class, class_scope.class_type) else {
        return false;
    };
    let is_of_instance = |object: Expr<'a>| {
        let object_type = object.ty();
        !object_type.is_unresolved()
            && get_type_to_class_relation(object_type, class_type) == TypeToClassRelation::Instance
    };
    let is_write = |node: &Expr<'a>| {
        is_modification(*node)
            && accessed_member(*node).is_some_and(|(object, member_name)| {
                *member_name == *name
                    && enclosing_class(*node) == Some((class, true))
                    && is_of_instance(object)
            })
    };
    // What is read from the member, as in `this.a = other.a`, is narrowed with it.
    let is_same_member = |value: Expr<'a>| {
        accessed_member(value)
            .is_some_and(|(object, member_name)| *member_name == *name && is_of_instance(object))
    };
    // An optional member still takes `undefined`.
    let is_optional = member.flags().contains(Flags::OPTIONAL);
    let takes = |ty: Type<'a>| {
        ty.is_assignable_to(narrowed) || (is_optional && is_type_flag_set(ty, TypeFlags::UNDEFINED))
    };
    let has_value_that_fits = |assign: Expr<'a>, node: Expr<'a>| match assign.kind() {
        ExprKind::Assign {
            op: None,
            target,
            value,
        } => {
            target == node
                && (is_same_member(value) || union_constituents(value.ty()).iter().all(&takes))
        }
        _ => false,
    };
    let fits = |node: Expr<'a>| {
        !node.is_parenthesized()
            && matches!(
                node.parent(),
                Node::Expr(assign) if !may_be_default_in_pattern(assign) && has_value_that_fits(assign, node)
            )
    };
    let file = class.file();
    let mut writes = [ExprTag::Dot, ExprTag::Index]
        .into_iter()
        .flat_map(|tag| file.exprs_of_kind(tag))
        .filter(is_write);
    writes.all(fits)
}

fn report<'a>(
    cx: &Cx<'a, PreferReadonly>,
    class_scope: &ClassScope<'a>,
    violating: &PrivateModifiable<'a>,
) {
    let file = cx.file();
    let member = match violating.node {
        ParameterOrPropertyDeclaration::Parameter(param) => {
            // The `?` and the type annotation are part of the `Identifier`.
            let mut loc = get_parameter_property_head_loc(param, violating.name);
            if cx.language().is_oxlint {
                loc.start = param.span().start;
            }
            // tsgolint's message has only the name.
            let name = if cx.language().is_oxlint {
                param.pat().span()
            } else {
                param.binding_span()
            };
            cx.report(loc, PREFER_READONLY)
                .data("name", file.slice(name))
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
    let is_oxlint = cx.language().is_oxlint;
    let loc = match (is_oxlint, is_property_definition) {
        // tsgolint reports every property from its decorators to the end of its name.
        (true, _) => Span::new(member.span().start, key.span(file).end),
        (false, true) => get_member_head_loc(member),
        (false, false) => member.span(),
    };
    let has_constructor_modifications = violating.has_constructor_modifications;
    // Both closures ask, and only when the fix is read.
    let annotation = OnceCell::new();
    let annotation = || {
        annotation.get_or_init(|| {
            // tsgolint also annotates an abstract property.
            match (is_property_definition || is_oxlint) && has_constructor_modifications {
                true => get_type_annotation(member, key),
                false => Annotation::NotNeeded,
            }
        })
    };
    cx.report(loc, PREFER_READONLY)
        .data("name", file.slice(name_node))
        .fix_where_safe(
            || match annotation() {
                Annotation::Narrows(narrowed) => {
                    constructor_writes_fit(class_scope, member, violating.name, *narrowed)
                }
                Annotation::NotNeeded | Annotation::Write(_) => true,
            },
            |fixer| {
                let readonly_insertion_target = match is_property_definition && key.is_computed() {
                    true => key.span(file),
                    false => name_node,
                };
                let mut fixes = vec![fixer.insert_before(readonly_insertion_target, "readonly ")];
                if let Annotation::Write(type_annotation) = annotation() {
                    // Both tools write the type before the `?` of `x? = 1`, which doesn't parse.
                    let question_or_exclamation = Some(skip_trivia(file.text(), name_node.end))
                        .filter(|&at| matches!(file.text().get(at as usize), Some(b'?' | b'!')));
                    let annotated = match question_or_exclamation {
                        Some(at) => Span::new(at, at + 1),
                        None => name_node,
                    };
                    fixes.push(
                        fixer.insert_after(annotated, [&b": "[..], &type_annotation[..]].concat()),
                    );
                }
                fixes
            },
        );
}

impl PreferReadonly {
    fn new_class_scope<'a>(&self, class: Class<'a>) -> ClassScope<'a> {
        let mut scope = ClassScope {
            class,
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
        for constructor in class
            .members()
            .iter()
            .filter(|member| is_constructor(*member))
        {
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
}

impl Rule for PreferReadonly {
    const META: Meta = Meta::typescript("prefer-readonly", Kind::Suggestion)
        .fixable(Fixable::Code)
        .requires_types()
        .reports_on_exit();
    const ON: On = On::new().exprs(&[ExprTag::Dot, ExprTag::Index]).finish();
    type State<'a> = ClassScopes<'a>;

    fn new(options: &Options) -> Self {
        PreferReadonly {
            only_inline_lambdas: options.object(0).bool_or("onlyInlineLambdas", false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<ClassScopes<'a>> {
        let mut class_scopes = ClassScopes {
            scopes: Vec::new(),
            positions: IdMap::new(),
        };
        for class in file.classes() {
            let class_scope = self.new_class_scope(class);
            if !class_scope.private_modifiables.is_empty() {
                class_scopes.positions.insert(class, class_scopes.scopes.len());
                class_scopes.scopes.push(class_scope);
            }
        }
        (!class_scopes.scopes.is_empty()).then_some(class_scopes)
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if !is_modification(node) {
            return;
        }
        let Some((class, is_directly_inside_constructor)) = enclosing_class(node) else {
            return;
        };
        let Some(&position) = cx.state.positions.get(class) else {
            return;
        };
        let Some(class_scope) = cx.state.scopes.get_mut(position) else {
            return;
        };
        let Some((expression, member_name)) = accessed_member(node) else {
            return;
        };
        class_scope.add_variable_modification_by_name(
            expression,
            &member_name,
            is_directly_inside_constructor,
        );
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        // tsgolint reports a class's statics after its other members.
        let passes: &[Option<bool>] = match cx.language().is_oxlint {
            true => &[Some(false), Some(true)],
            false => &[None],
        };
        for class_scope in utils::sort::collect_sorted_by_key(&cx.state.scopes, |it| it.class.span().start) {
            for &statics in passes {
                for violating in class_scope.private_modifiables.iter().filter(|it| {
                    !it.is_modified && statics.is_none_or(|statics| it.is_static == statics)
                }) {
                    report(cx, class_scope, violating);
                }
            }
        }
    }
}
