//! `useConfigurationIf`: which element of the options array applies to a node (each rule's
//! `compute-matched-context-options.ts`, `utils/context-matching/`, `utils/scoped-regex/`). The first configuration
//! whose conditions all hold is used; one without `useConfigurationIf` always matches.

use super::options::{Configuration, Pattern, Patterns};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::selector::{self, EsNode, Selector};

/// `useConfigurationIf` of one configuration. Every field is optional, and a rule only parses the keys its schema
/// has: `objectType` and `callingFunctionNamePattern` are `sort-objects`'s, `declarationMatchesPattern` and
/// `declarationCommentMatchesPattern` are the object rules', `allNamesMatchPattern`, `hasNumericKeysOnly` and
/// `matchesAstSelector` are everyone's.
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
    /// An esquery selector the listened node itself matches. Parsed in `new`; `validate` reports a bad one.
    pub(crate) matches_ast_selector: Option<Selector>,
}

/// `objectType`
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum ObjectType {
    Destructured,
    NonDestructured,
}

/// A `ScopedRegexOption`, split as `partition-patterns-by-scope.ts` does: a pattern with `scope: "deep"` is tested
/// against every allowed ancestor, the others (`"shallow"` and no scope) against the nearest one only. The option
/// matches if either side does.
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
    Object { node: Node<'a>, is_destructured: bool },
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

/// Upstream's `computeMatchedContextOptions` and the fallback to the defaults in one: the index in
/// `configurations` of the first whose `useConfigurationIf` holds for `subject`. The last configuration has no
/// conditions, so it is the answer when no other holds. `names` are the members' names as the rule names its sorting
/// nodes, for `allNamesMatchPattern`.
pub(crate) fn matching_configuration<'c, 'n>(
    configurations: &'c [Configuration],
    subject: Subject<'_>,
    names: impl Iterator<Item = &'n [u8]> + Clone,
) -> Result<usize, Rejected<'c>> {
    for (i, configuration) in configurations.iter().enumerate() {
        if configuration.use_configuration_if.holds(subject, names.clone())? {
            return Ok(i);
        }
    }
    Ok(configurations.len().saturating_sub(1))
}

impl ConfigurationIf {
    /// Parses the `useConfigurationIf` of one options object. `listened` is the ESTree type, or the types separated
    /// by commas, the rule listens on: upstream only records that a selector matched a node of one of those.
    pub(crate) fn parse(object: Object<'_>, listened: &str) -> ConfigurationIf {
        ConfigurationIf {
            all_names_match_pattern: object.get("allNamesMatchPattern").and_then(regex_option),
            object_type: match object.str("objectType") {
                Some("destructured") => Some(ObjectType::Destructured),
                Some("non-destructured") => Some(ObjectType::NonDestructured),
                _ => None,
            },
            has_numeric_keys_only: object.bool("hasNumericKeysOnly"),
            calling_function_name_pattern: object
                .get("callingFunctionNamePattern")
                .and_then(scoped_regex_option),
            declaration_matches_pattern: object
                .get("declarationMatchesPattern")
                .and_then(scoped_regex_option),
            declaration_comment_matches_pattern: object
                .get("declarationCommentMatchesPattern")
                .and_then(scoped_regex_option),
            matches_ast_selector: object
                .str("matchesAstSelector")
                .and_then(|source| restricted_selector(listened, source).ok()),
        }
    }

    /// What `validate` rejects: a `matchesAstSelector` esquery cannot parse. ESLint throws for it when it registers
    /// the rule's listeners, before it visits a node.
    pub(crate) fn validate(object: Object<'_>) -> Result<(), Vec<u8>> {
        if let Some(source) = object.str("matchesAstSelector") {
            Selector::parse(source.as_bytes()).map_err(|error| error.message().to_vec())?;
        }
        Ok(())
    }

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
            && !matches_selector(selector, subject.node()).map_err(Rejected::Selector)?
        {
            return Ok(false);
        }
        Ok(true)
    }
}

/// The selector as upstream's `buildAstListeners` applies it: its listener fires on any node, but only a node of a
/// type the rule listens on is recorded. Tested with that type restriction, it can match nothing but the listened
/// node among the ESTree nodes made from it, like the `JSXExpressionContainer` or `TSTypeAnnotation` around it.
fn restricted_selector(listened: &str, source: &str) -> Result<Selector, selector::Error> {
    let source = source.strip_suffix(":exit").unwrap_or(source);
    Selector::parse(format!(":matches({listened}):matches({source})").as_bytes())
}

/// `passesAstSelectorFilter`
fn matches_selector(selector: &Selector, node: Node<'_>) -> Result<bool, selector::Error> {
    let mut result = Ok(false);
    EsNode::for_each_at(node, |es_node| {
        if matches!(result, Ok(false)) {
            result = selector.test(es_node);
        }
    });
    result
}

/// `matches(value, regexOption)`: any of the patterns matches. A pattern that is not a regular expression throws
/// when it is reached, so the patterns before it are tested first.
fn patterns_match<'c>(patterns: &'c Patterns, value: &[u8]) -> Result<bool, Rejected<'c>> {
    for pattern in &patterns.0 {
        if pattern_matches(pattern, value)? {
            return Ok(true);
        }
    }
    Ok(false)
}

fn pattern_matches<'c>(pattern: &'c Pattern, value: &[u8]) -> Result<bool, Rejected<'c>> {
    match pattern {
        Pattern::Valid(regex) => Ok(regex.test(value)),
        Pattern::Invalid(message) => Err(Rejected::Pattern(message)),
    }
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
                    if pattern_matches(pattern, strings::trim_js_whitespace(comment.comment_value()))?
                    {
                        return Ok(true);
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
            Subject::Interface(statement) => {
                Parents::Only(Some(Parent::Declaration(statement)))
            }
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

/// `computePropertyOrVariableDeclaratorName` of `sort-objects` and `computeNodeParentName` of `sort-object-types`.
/// They differ on a declarator: the object rule takes an identifier's name and otherwise ESTree's text of the
/// binding, which includes its type annotation, while the type rule takes the text up to the annotation.
fn declaration_name<'a>(file: &'a File<'a>, parent: Parent<'a>, is_object_rule: bool) -> &'a [u8] {
    const NONE: &[u8] = b"";
    match parent {
        Parent::VarDecl(decl) => match (decl.pat().as_ident(), decl.ty()) {
            (Some(name), _) if is_object_rule => name.bytes(),
            (_, Some(ty)) if !is_object_rule => {
                file.slice(Span::new(decl.pat().span().start, ty.annotation_span().start))
            }
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

/// `computeRelevantNodeForComment`: what `getCommentsBefore` is asked about. For a declarator it is the
/// `VariableDeclaration`, which `sort-objects` swaps for the `ExportNamedDeclaration` around it and
/// `sort-object-types` does not.
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

/// A `RegexOption` (`utils/matches.ts`): a pattern, a `{ pattern, flags }`, or an array of those. `None` if it is
/// falsy, as `""` is; `[]` is on and matches nothing.
fn regex_option(json: &Json) -> Option<Patterns> {
    json.is_truthy().then(|| {
        Patterns(
            single_patterns(json)
                .map(|(pattern, flags, _)| compile(pattern, flags))
                .collect(),
        )
    })
}

/// `partitionPatternsByScope`: only an object with `scope: "deep"` is deep.
fn scoped_regex_option(json: &Json) -> Option<ScopedPatterns> {
    if !json.is_truthy() {
        return None;
    }
    let (mut shallow, mut deep) = (Vec::new(), Vec::new());
    for (pattern, flags, scope) in single_patterns(json) {
        let side = match scope {
            Some(b"deep") => &mut deep,
            _ => &mut shallow,
        };
        side.push(compile(pattern, flags));
    }
    Some(ScopedPatterns {
        shallow: Patterns(shallow),
        deep: Patterns(deep),
    })
}

/// The `(pattern, flags, scope)` of each element of a regex option.
fn single_patterns(json: &Json) -> impl Iterator<Item = (&[u8], &[u8], Option<&[u8]>)> {
    let items = match json {
        Json::Array(items) => &items[..],
        other => std::slice::from_ref(other),
    };
    items.iter().filter_map(|item| match item {
        Json::String(pattern) => Some((&pattern[..], &b""[..], None)),
        Json::Object(_) => Some((
            item.get(b"pattern")?.as_str()?,
            item.get(b"flags").and_then(Json::as_str).unwrap_or(b""),
            item.get(b"scope").and_then(Json::as_str),
        )),
        _ => None,
    })
}

/// `new RegExp(pattern, flags)`, keeping the error for the node that first tests it.
fn compile(pattern: &[u8], flags: &[u8]) -> Pattern {
    match Regex::from_bytes(pattern, flags) {
        Ok(regex) => Pattern::Valid(regex),
        Err(error) => Pattern::Invalid(error.message),
    }
}
