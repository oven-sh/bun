//! `useConfigurationIf`: each rule's `compute-matched-context-options.ts`, `utils/context-matching/`,
//! `utils/scoped-regex/`.

use super::options::{Configuration, Pattern, Patterns};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::selector::{self, EsNode, Selector};

/// `useConfigurationIf` of one configuration. A rule only parses the keys its schema has.
#[derive(Default)]
pub(crate) struct ConfigurationIf {
    /// Every node name matches.
    pub(crate) all_names_match_pattern: Option<Patterns>,
    /// The object is, or is not, a destructuring pattern.
    pub(crate) object_type: Option<ObjectType>,
    /// Every key is a number literal (`true`), or not every key is (`false`).
    pub(crate) has_numeric_keys_only: Option<bool>,
    /// A name of the call the object is an argument of.
    pub(crate) calling_function_name_pattern: Option<ScopedPatterns>,
    /// The name of the declaration the object or type is the value of.
    pub(crate) declaration_matches_pattern: Option<ScopedPatterns>,
    /// A comment above that declaration.
    pub(crate) declaration_comment_matches_pattern: Option<ScopedPatterns>,
    /// An esquery selector the listened node itself matches.
    pub(crate) matches_ast_selector: Option<Selector>,
}

/// `objectType`
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum ObjectType {
    Destructured,
    NonDestructured,
}

/// A `ScopedRegexOption`, split as `partition-patterns-by-scope.ts` does. No scope is `"shallow"`.
#[derive(Debug)]
pub(crate) struct ScopedPatterns {
    pub(crate) shallow: Patterns,
    pub(crate) deep: Patterns,
}

/// The node a rule sorts, as the conditions see it.
#[derive(Clone, Copy)]
pub(crate) enum Subject<'a> {
    /// `sort-objects`: an `ObjectExpression`, or an `ObjectPattern` (`is_destructured`), which is a `Pat` in a
    /// declaration or a parameter and an `Expr` in an assignment target.
    Object {
        node: Node<'a>,
        is_destructured: bool,
    },
    /// `sort-object-types`: a `TSTypeLiteral`.
    TypeLiteral(TypeNode<'a>),
    /// `sort-interfaces`: a `TSInterfaceDeclaration`, which is its own only parent node.
    Interface(Stmt<'a>),
    /// `sort-union-types`: a `TSUnionType`.
    Union(TypeNode<'a>),
}

/// Why a condition could not be decided. Upstream throws from `matches()` when a pattern is not a regular expression,
/// and esquery throws when a selector is too deep for the stack.
pub(crate) enum Rejected<'c> {
    /// The `SyntaxError` message of `new RegExp(pattern)`.
    Pattern(&'c str),
    Selector(selector::Error),
}

impl Rejected<'_> {
    /// Throws it as the rule at `at`, the node the listener is at.
    pub(crate) fn throw<R: Rule>(&self, cx: &Cx<'_, R>, at: impl Spanned) {
        match self {
            Rejected::Pattern(message) => cx.throw(at, "SyntaxError", *message),
            Rejected::Selector(error) => cx.throw_for_selector(error),
        }
    }
}

/// `computeMatchedContextOptions` plus the fallback to the defaults: the last configuration has no conditions.
/// `names` feed `allNamesMatchPattern`.
pub(crate) fn matching_configuration<'c, 'n>(
    configurations: &'c [Configuration],
    subject: Subject<'_>,
    names: &(impl Iterator<Item = &'n [u8]> + Clone),
) -> Result<usize, Rejected<'c>> {
    for (i, configuration) in configurations.iter().enumerate() {
        if configuration
            .use_configuration_if
            .holds(subject, names.clone())?
        {
            return Ok(i);
        }
    }
    Ok(configurations.len().saturating_sub(1))
}

impl ConfigurationIf {
    /// Upstream's `isContextOptionMatching`, with the conditions in the order `sort-objects` tests them. The other
    /// rules test a subset in the same order.
    fn holds<'c, 'n>(
        &'c self,
        subject: Subject<'_>,
        names: impl Iterator<Item = &'n [u8]>,
    ) -> Result<bool, Rejected<'c>> {
        if let Some(patterns) = &self.all_names_match_pattern {
            for name in names {
                if !patterns_match(patterns, name)? {
                    return Ok(false);
                }
            }
        }
        if let Some(object_type) = self.object_type {
            let is_destructured = matches!(
                subject,
                Subject::Object {
                    is_destructured: true,
                    ..
                }
            );
            if (object_type == ObjectType::Destructured) != is_destructured {
                return Ok(false);
            }
        }
        if let Some(option) = &self.calling_function_name_pattern
            && !matches_scoped(option, subject, Condition::CallingFunctionName)?
        {
            return Ok(false);
        }
        if let Some(option) = &self.declaration_matches_pattern
            && !matches_scoped(option, subject, Condition::DeclarationName)?
        {
            return Ok(false);
        }
        if let Some(expected) = self.has_numeric_keys_only
            && subject.has_numeric_keys_only() != expected
        {
            return Ok(false);
        }
        if let Some(option) = &self.declaration_comment_matches_pattern
            && !matches_scoped(option, subject, Condition::DeclarationComment)?
        {
            return Ok(false);
        }
        if let Some(selector) = &self.matches_ast_selector
            && !matches_selector(selector, subject).map_err(Rejected::Selector)?
        {
            return Ok(false);
        }
        Ok(true)
    }
}

/// `passesAstSelectorFilter`: only the listened ESTree node is tested. A type predicate's `TSTypeAnnotation` has the
/// range of its type and comes before it, so the last node with that range is the one.
fn matches_selector(selector: &Selector, subject: Subject<'_>) -> Result<bool, selector::Error> {
    let span = subject.estree_span();
    let mut listened = None;
    EsNode::for_each_at(subject.node(), |es_node| {
        if es_node.span() == span {
            listened = Some(es_node);
        }
    });
    listened.map_or(Ok(false), |es_node| selector.test(es_node))
}

fn patterns_match<'c>(patterns: &'c Patterns, value: &[u8]) -> Result<bool, Rejected<'c>> {
    patterns.first_match(value).map_err(Rejected::Pattern)
}

/// Which scoped option is tested, which decides the parents it allows and the values it reads from one.
#[derive(Clone, Copy)]
enum Condition {
    /// `passesCallingFunctionNamePatternFilter`: the callee's text of a `CallExpression`.
    CallingFunctionName,
    /// `passesDeclarationMatchesPatternFilter`: the name of every parent but a call.
    DeclarationName,
    /// `passesDeclarationCommentMatchesFilter`: the comments before the statement or member of any parent.
    DeclarationComment,
}

impl Condition {
    /// `isNodeTypeAmong(parent, allowedNodeTypes)`
    fn allows(self, parent: Parent<'_>) -> bool {
        match self {
            Condition::CallingFunctionName => matches!(parent, Parent::Call(..)),
            Condition::DeclarationName => !matches!(parent, Parent::Call(..)),
            Condition::DeclarationComment => true,
        }
    }
}

/// Upstream's `matchesScopedExpressions`: the shallow patterns are tested against the nearest parent, if it is of an
/// allowed kind, then the deep ones against every parent of an allowed kind.
fn matches_scoped<'c>(
    option: &'c ScopedPatterns,
    subject: Subject<'_>,
    condition: Condition,
) -> Result<bool, Rejected<'c>> {
    if let Some(first) = subject.parents().next()
        && condition.allows(first)
        && matches_parent(subject, first, &option.shallow, condition)?
    {
        return Ok(true);
    }
    for parent in subject.parents().filter(|it| condition.allows(*it)) {
        if matches_parent(subject, parent, &option.deep, condition)? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// `matchesParentExpression`: any pattern matches any of the parent's values.
fn matches_parent<'a, 'c>(
    subject: Subject<'a>,
    parent: Parent<'a>,
    patterns: &'c Patterns,
    condition: Condition,
) -> Result<bool, Rejected<'c>> {
    let file = subject.node().file();
    let is_object_rule = matches!(subject, Subject::Object { .. });
    match condition {
        Condition::CallingFunctionName => {
            let Parent::Call(_, call) = parent else {
                return Ok(false);
            };
            patterns_match(patterns, call.callee().text())
        }
        Condition::DeclarationName => {
            patterns_match(patterns, declaration_name(file, parent, is_object_rule))
        }
        Condition::DeclarationComment => {
            let before = comment_anchor(parent, is_object_rule);
            for pattern in &patterns.0 {
                for comment in file.comments_before(before) {
                    match pattern {
                        Pattern::Valid(regex) => {
                            if regex.test(strings::trim_js_whitespace(comment.comment_value())) {
                                return Ok(true);
                            }
                        }
                        Pattern::Invalid(message) => return Err(Rejected::Pattern(message)),
                    }
                }
            }
            Ok(false)
        }
    }
}

/// An ancestor of one of the kinds in upstream's `objectParentTypes` or `objectTypeParentTypes`.
#[derive(Clone, Copy)]
enum Parent<'a> {
    /// `VariableDeclarator`
    VarDecl(VarDecl<'a>),
    /// `CallExpression`
    Call(Expr<'a>, Call<'a>),
    /// `Property` of an object literal
    Prop(Prop<'a>),
    /// `Property` of an object pattern
    PatProp(PatProp<'a>),
    /// `TSPropertySignature` or `PropertyDefinition`
    Member(Member<'a>),
    /// `TSInterfaceDeclaration` or `TSTypeAliasDeclaration`
    Declaration(Stmt<'a>),
}

/// The `e` of `catch (e)` is a `VarDecl` here and a `CatchClause`'s parameter in ESTree.
fn is_catch_parameter(decl: VarDecl<'_>) -> bool {
    matches!(decl.parent(), Node::Stmt(statement) if statement.tag() == StmtTag::Try)
}

/// `objectParentTypes` of `sort-objects`
fn object_parent(node: Node<'_>) -> Option<Parent<'_>> {
    match node {
        Node::VarDecl(decl) if !is_catch_parameter(decl) => Some(Parent::VarDecl(decl)),
        Node::Expr(e) => e.as_call().map(|call| Parent::Call(e, call)),
        Node::Prop(prop) if prop.kind() != PropKind::Spread && !prop.is_jsx_attribute() => {
            Some(Parent::Prop(prop))
        }
        Node::PatProp(prop) if !prop.is_rest() => Some(Parent::PatProp(prop)),
        _ => None,
    }
}

/// `objectTypeParentTypes` of `sort-object-types`. An `accessor` or `abstract` property is another ESTree type.
fn object_type_parent(node: Node<'_>) -> Option<Parent<'_>> {
    match node {
        Node::VarDecl(decl) if !is_catch_parameter(decl) => Some(Parent::VarDecl(decl)),
        Node::Member(member)
            if member.kind() == MemberKind::Property
                && !member.flags().intersects(Flags::ACCESSOR | Flags::ABSTRACT) =>
        {
            Some(Parent::Member(member))
        }
        Node::Stmt(statement)
            if matches!(statement.tag(), StmtTag::Interface | StmtTag::TypeAlias) =>
        {
            Some(Parent::Declaration(statement))
        }
        _ => None,
    }
}

/// Upstream's `parentNodes`: `computeParentNodesWithTypes` with `consecutiveOnly: false`, nearest first, or the
/// interface itself.
enum Parents<'a> {
    Only(Option<Parent<'a>>),
    Ancestors {
        ancestors: Ancestors<'a>,
        classify: fn(Node<'a>) -> Option<Parent<'a>>,
    },
}

impl<'a> Iterator for Parents<'a> {
    type Item = Parent<'a>;

    fn next(&mut self) -> Option<Parent<'a>> {
        match self {
            Parents::Only(parent) => parent.take(),
            Parents::Ancestors {
                ancestors,
                classify,
            } => ancestors.find_map(*classify),
        }
    }
}

impl<'a> Subject<'a> {
    fn node(self) -> Node<'a> {
        match self {
            Subject::Object { node, .. } => node,
            Subject::TypeLiteral(ty) | Subject::Union(ty) => Node::Type(ty),
            Subject::Interface(statement) => Node::Stmt(statement),
        }
    }

    /// ESTree's range of the listened node: an `ObjectPattern` that declares a variable or a parameter includes its
    /// type annotation, and an exported interface starts after the `export`.
    fn estree_span(self) -> Span {
        match self {
            Subject::Object {
                node: Node::Pat(pat),
                ..
            } => match pat.parent() {
                Node::Param(param) if !param.is_rest() => param.binding_span(),
                Node::VarDecl(decl) => decl.binding_span(),
                _ => pat.span(),
            },
            Subject::Object { node, .. } => node.span(),
            Subject::TypeLiteral(ty) | Subject::Union(ty) => ty.span(),
            Subject::Interface(statement) => statement.span_without_export(),
        }
    }

    fn parents(self) -> Parents<'a> {
        match self {
            Subject::Object { node, .. } => Parents::Ancestors {
                ancestors: node.ancestors(),
                classify: object_parent,
            },
            Subject::TypeLiteral(ty) => Parents::Ancestors {
                ancestors: Node::Type(ty).ancestors(),
                classify: object_type_parent,
            },
            Subject::Interface(statement) => Parents::Only(Some(Parent::Declaration(statement))),
            Subject::Union(_) => Parents::Only(None),
        }
    }

    /// `hasNumericKeysOnly()`: every member is a property whose key is a number literal. A pattern never qualifies.
    fn has_numeric_keys_only(self) -> bool {
        let file = self.node().file();
        let is_property_with_number_key = |member: Member<'a>| {
            member.kind() == MemberKind::Property
                && member.key().is_some_and(|key| is_number_literal(file, key))
        };
        match self {
            Subject::Object {
                node: Node::Expr(e),
                is_destructured: false,
            } => match e.kind() {
                ExprKind::Object(props) => props.iter().all(|prop| {
                    prop.kind() != PropKind::Spread
                        && prop.key().is_some_and(|key| is_number_literal(file, key))
                }),
                _ => false,
            },
            Subject::Object { .. } | Subject::Union(_) => false,
            Subject::TypeLiteral(ty) => match ty.kind() {
                TypeKind::Object(members) => members.iter().all(is_property_with_number_key),
                _ => false,
            },
            Subject::Interface(statement) => match statement.kind() {
                StmtKind::Interface(interface) => {
                    interface.members().iter().all(is_property_with_number_key)
                }
                _ => false,
            },
        }
    }
}

/// `key.type === 'Literal' && typeof key.value === 'number'`: a bigint literal is a `Literal` too, but not a number.
fn is_number_literal<'a>(file: &'a File<'a>, key: Key<'a>) -> bool {
    matches!(key.kind(), KeyKind::Number(_) | KeyKind::ComputedNumber(_))
        && !file.slice(key.inner_span(file)).ends_with(b"n")
}

/// Upstream's `computeIdentifierName` and `computePropertyName`: an identifier's name, `String(value)` of a literal,
/// otherwise the key's source text.
pub(crate) fn key_name<'a>(file: &'a File<'a>, key: Key<'a>) -> &'a [u8] {
    match key.kind() {
        KeyKind::Ident(name)
        | KeyKind::String(name)
        | KeyKind::Number(name)
        | KeyKind::Private(name)
        | KeyKind::ComputedNumber(name) => name.bytes(),
        // `` [`a`] `` is a `TemplateLiteral`, not a `Literal`.
        KeyKind::ComputedString(name) => match file.slice(key.inner_span(file)) {
            text @ [b'`', ..] => text,
            _ => name.bytes(),
        },
        KeyKind::Computed(e) => e.text(),
    }
}

/// `computePropertyOrVariableDeclaratorName` of `sort-objects` and `computeNodeParentName` of `sort-object-types`,
/// which differ on a declarator with a type annotation.
fn declaration_name<'a>(file: &'a File<'a>, parent: Parent<'a>, is_object_rule: bool) -> &'a [u8] {
    const NONE: &[u8] = b"";
    match parent {
        Parent::VarDecl(decl) => match (decl.pat().as_ident(), decl.ty()) {
            (Some(name), _) if is_object_rule => name.bytes(),
            (_, Some(ty)) if !is_object_rule => file.slice(Span::new(
                decl.pat().span().start,
                ty.annotation_span().start,
            )),
            _ => file.slice(decl.binding_span()),
        },
        Parent::Prop(prop) => prop.key().map_or(NONE, |key| key_name(file, key)),
        Parent::PatProp(prop) => prop.key().map_or(NONE, |key| key_name(file, key)),
        Parent::Member(member) => member.key().map_or(NONE, |key| key_name(file, key)),
        Parent::Declaration(statement) => match statement.kind() {
            StmtKind::Interface(interface) => interface.name().bytes(),
            StmtKind::TypeAlias(alias) => alias.name().bytes(),
            _ => NONE,
        },
        Parent::Call(..) => NONE,
    }
}

/// `computeRelevantNodeForComment`: only `sort-objects` swaps a `VariableDeclaration` for the
/// `ExportNamedDeclaration` around it.
fn comment_anchor(parent: Parent<'_>, is_object_rule: bool) -> Span {
    match parent {
        Parent::VarDecl(decl) => match decl.parent() {
            Node::Stmt(statement) if is_object_rule => statement.span(),
            Node::Stmt(statement) => statement.span_without_export(),
            other => other.span(),
        },
        Parent::Call(e, _) => e.span(),
        Parent::Prop(prop) => prop.span(),
        Parent::PatProp(prop) => prop.span(),
        Parent::Member(member) => member.span(),
        Parent::Declaration(statement) => statement.span_without_export(),
    }
}
