//! What `sort-object-types` and `sort-interfaces` share: `rules/sort-object-types/sort-object-type-elements.ts` and
//! its helpers (`compute-node-name.ts`, `compute-node-parent-name.ts`, `is-member-optional.ts`,
//! `is-node-function-type.ts`, `compute-matched-context-options.ts`, `passes-declaration-*-filter.ts`).
//!
//! The members of a type literal or an interface body become one [`SortingNode`] each, except call and construct
//! signatures, which are never sorted and start a new partition on each side. The `useConfigurationIf` conditions of
//! the object rules are tested against the declarations the type is part of (`objectTypeParentTypes`): a type alias,
//! an interface, a property signature, a class property, a variable declarator.

use super::configuration_if::{ConfigurationIf, ScopedPatterns};
use super::disabled::DisabledLines;
use super::fixes::FixOptions;
use super::options::{
    Newlines, NewlinesInside, Pattern, Patterns, RuleKind, RuleOptions, SortBy, SortOptions,
    SortType,
};
use super::sort::Sorted;
use super::{Configuration, FileState, Messages, SortingNode, groups, partition, report, sort};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::selector::EsNode;
use smallvec::SmallVec;
use std::borrow::Cow;

/// Both rules parse the same options: `sort-interfaces` reuses the `defaultOptions` and `jsonSchema` of
/// `sort-object-types`. Its `allSelectors` are `index-signature`, `member`, `method` and `property`, its
/// `allModifiers` `optional`, `required` and `multiline`.
pub(crate) const RULE: RuleKind = RuleKind::ObjectTypes;

/// `addSafetySemicolonWhenInline: true` on every sorting node of both rules.
const FIX_OPTIONS: FixOptions = FixOptions {
    add_safety_semicolon_when_inline: true,
};

/// The per-file state of both rules. `pub` because it is a [`Rule::State`].
pub struct State(pub(crate) FileState);

/// The node a rule listens on: upstream's `node` of `sortObjectType` / `sortInterface`, from which its `parentNodes`
/// and its `elements` come.
#[derive(Clone, Copy)]
pub(crate) enum Listened<'a> {
    /// `TSTypeLiteral` and its `members`.
    TypeLiteral(TypeNode<'a>, List<'a, Member<'a>>),
    /// `TSInterfaceDeclaration`: the statement and its body.
    Interface(Stmt<'a>, Interface<'a>),
}

impl<'a> Listened<'a> {
    fn node(self) -> Node<'a> {
        match self {
            Listened::TypeLiteral(ty, _) => Node::Type(ty),
            Listened::Interface(stmt, _) => Node::Stmt(stmt),
        }
    }

    /// The ESTree range of the listened node, which the `matchesAstSelector` selector is tested against: the
    /// `ExportNamedDeclaration` around an exported interface is not it.
    fn estree_span(self) -> Span {
        match self {
            Listened::TypeLiteral(ty, _) => ty.span(),
            Listened::Interface(stmt, _) => stmt.span_without_export(),
        }
    }

    /// `node.members` / `node.body.body`
    fn members(self) -> List<'a, Member<'a>> {
        match self {
            Listened::TypeLiteral(_, members) => members,
            Listened::Interface(_, interface) => interface.members(),
        }
    }

    /// `computeObjectTypeParentNodes` for a type literal: every ancestor of one of `objectTypeParentTypes`, nearest
    /// first. `[node]` for an interface.
    fn parents(self) -> SmallVec<[Parent<'a>; 4]> {
        match self {
            Listened::Interface(stmt, interface) => {
                let mut parents = SmallVec::new();
                parents.push(Parent::Interface(stmt, interface));
                parents
            }
            Listened::TypeLiteral(ty, _) => {
                Node::Type(ty).ancestors().filter_map(Parent::of).collect()
            }
        }
    }
}

/// An `ObjectTypeParent`: a node of `objectTypeParentTypes`.
#[derive(Clone, Copy)]
enum Parent<'a> {
    /// `TSTypeAliasDeclaration`
    TypeAlias(Stmt<'a>, Alias<'a>),
    /// `TSInterfaceDeclaration`
    Interface(Stmt<'a>, Interface<'a>),
    /// `TSPropertySignature` or `PropertyDefinition`
    Property(Member<'a>),
    /// `VariableDeclarator`
    VariableDeclarator(VarDecl<'a>),
}

impl<'a> Parent<'a> {
    fn of(node: Node<'a>) -> Option<Parent<'a>> {
        match node {
            Node::Stmt(stmt) => match stmt.kind() {
                StmtKind::TypeAlias(alias) => Some(Parent::TypeAlias(stmt, alias)),
                StmtKind::Interface(interface) => Some(Parent::Interface(stmt, interface)),
                _ => None,
            },
            // `abstract` and `accessor` properties are other ESTree types.
            Node::Member(member)
                if member.kind() == MemberKind::Property
                    && !member.flags().intersects(Flags::ABSTRACT | Flags::ACCESSOR) =>
            {
                Some(Parent::Property(member))
            }
            // A `catch` parameter is a `VarDecl` here, but no `VariableDeclarator` in ESTree.
            Node::VarDecl(decl) if matches!(decl.parent(), Node::Stmt(stmt) if stmt.tag() == StmtTag::Var) => {
                Some(Parent::VariableDeclarator(decl))
            }
            _ => None,
        }
    }

    /// `computeNodeParentName`
    fn name(self, file: &'a File<'a>) -> &'a [u8] {
        match self {
            Parent::TypeAlias(_, alias) => alias.name().bytes(),
            Parent::Interface(_, interface) => interface.name().bytes(),
            Parent::Property(member) => match member.key() {
                Some(key) => key_name_or_text(key, file),
                None => b"",
            },
            Parent::VariableDeclarator(decl) => {
                let pat = decl.pat().span();
                match decl.ty() {
                    Some(ty) => file.slice(Span::new(pat.start, ty.annotation_span().start)),
                    None => file.slice(pat),
                }
            }
        }
    }

    /// `computeRelevantNodeForComment`: the node whose `getCommentsBefore` the declaration's comments are. The
    /// declaration nodes of ESTree start after `export`.
    fn span_for_comments(self) -> Span {
        match self {
            Parent::TypeAlias(stmt, _) | Parent::Interface(stmt, _) => stmt.span_without_export(),
            Parent::Property(member) => member.span(),
            Parent::VariableDeclarator(decl) => match decl.parent() {
                Node::Stmt(stmt) => stmt.span_without_export(),
                _ => decl.span(),
            },
        }
    }
}

/// `computePropertyName` of `compute-node-parent-name.ts`: the name of an identifier or literal key, else the key's
/// text.
fn key_name_or_text<'a>(key: Key<'a>, file: &'a File<'a>) -> &'a [u8] {
    match key.kind() {
        KeyKind::Ident(name)
        | KeyKind::String(name)
        | KeyKind::Number(name)
        | KeyKind::Private(name) => name.bytes(),
        KeyKind::ComputedString(name) | KeyKind::ComputedNumber(name)
            if !is_template_key(key, file) =>
        {
            name.bytes()
        }
        KeyKind::Computed(e) => match e.as_ident() {
            Some(name) => name.bytes(),
            None => file.slice(e.span()),
        },
        _ => file.slice(key.inner_span(file)),
    }
}

/// A `` [`a`] `` key: a `TemplateLiteral` in ESTree, where the HIR has a string.
fn is_template_key(key: Key<'_>, file: &File<'_>) -> bool {
    file.slice(key.inner_span(file)).starts_with(b"`")
}

/// `formatName`: without the `,` or `;` the text of a member ends with.
fn format_name(text: &[u8]) -> &[u8] {
    match text {
        [rest @ .., b',' | b';'] => rest,
        _ => text,
    }
}

/// `isNodeFunctionType` below a property's type annotation: a function type, or a union or intersection of them.
fn is_function_type(ty: TypeNode<'_>) -> bool {
    match ty.kind() {
        TypeKind::Fn(func) => func.kind() == FnKind::FunctionType,
        TypeKind::Union(types) | TypeKind::Intersection(types) => {
            types.iter().all(is_function_type)
        }
        _ => false,
    }
}

/// What one `TypeElement` of the listened node is, computed once for `computeMatchedContextOptions` and again for
/// the sorting nodes.
struct Element<'a> {
    member: Member<'a>,
    /// `computeNodeName`
    name: &'a [u8],
    /// The text of a property's type annotation, else empty.
    value: &'a [u8],
    /// A call or construct signature: not sorted, and a partition boundary.
    is_signature: bool,
    /// `isNumericKey`: a property signature with a number literal key.
    is_numeric_key: bool,
    /// `generatePredefinedGroups`'s `selectors`, in order.
    selectors: &'static [&'static str],
    /// Its `modifiers`, in order.
    modifiers: &'static [&'static str],
}

impl<'a> Element<'a> {
    fn new(member: Member<'a>, file: &'a File<'a>) -> Element<'a> {
        let span = member.span();
        let text = file.slice(span);
        let mut element = Element {
            member,
            name: b"",
            value: b"",
            is_signature: false,
            is_numeric_key: false,
            selectors: &["property", "member"],
            modifiers: &[],
        };
        let is_method = match member.kind() {
            MemberKind::CallSignature | MemberKind::ConstructSignature => {
                element.name = format_name(text);
                element.is_signature = true;
                return element;
            }
            MemberKind::IndexSignature => {
                let annotation = member.func().and_then(Func::return_type);
                let end = annotation.map_or(span.end, |ty| ty.annotation_span().start);
                element.name = format_name(file.slice(Span::new(span.start, end)));
                element.selectors = &["index-signature", "member"];
                false
            }
            MemberKind::Property => {
                let ty = member.ty();
                element.name = property_signature_name(member, ty, span, file);
                element.value = ty.map_or(b"", |ty| file.slice(ty.span()));
                element.is_numeric_key = member.key().is_some_and(|key| is_numeric_key(key, file));
                ty.is_some_and(is_function_type)
            }
            _ => {
                // `TSMethodSignature`: `node.key.name`, which only an identifier key has.
                element.name = match member.key().map(Key::kind) {
                    Some(KeyKind::Ident(name)) => name.bytes(),
                    Some(KeyKind::Computed(e)) => match e.as_ident() {
                        Some(name) => name.bytes(),
                        None => format_name(text),
                    },
                    _ => format_name(text),
                };
                true
            }
        };
        if is_method {
            element.selectors = &["method", "member"];
        }
        let is_multiline = strings::contains_js_line_break(text);
        let is_optional = !matches!(member.kind(), MemberKind::IndexSignature)
            && member.flags().contains(Flags::OPTIONAL);
        element.modifiers = match (is_multiline, is_optional) {
            (false, false) => &["required"],
            (false, true) => &["optional"],
            (true, false) => &["multiline", "required"],
            (true, true) => &["multiline", "optional"],
        };
        element
    }
}

/// `computePropertySignatureName`: the name of an identifier or literal key; for any other key, the text from the
/// start of the member to its type annotation, or to its end without the `?`.
fn property_signature_name<'a>(
    member: Member<'a>,
    ty: Option<TypeNode<'a>>,
    span: Span,
    file: &'a File<'a>,
) -> &'a [u8] {
    let key = member.key();
    let named = match key.map(Key::kind) {
        Some(KeyKind::Ident(name) | KeyKind::String(name) | KeyKind::Number(name)) => Some(name),
        Some(KeyKind::ComputedString(name) | KeyKind::ComputedNumber(name)) => {
            key.filter(|key| !is_template_key(*key, file)).map(|_| name)
        }
        Some(KeyKind::Computed(e)) => e.as_ident(),
        _ => None,
    };
    if let Some(name) = named {
        return name.bytes();
    }
    let end = match ty {
        Some(ty) => ty.annotation_span().start,
        None if member.flags().contains(Flags::OPTIONAL) => span.end.saturating_sub(1),
        None => span.end,
    };
    file.slice(Span::new(span.start, end.max(span.start)))
}

/// `isNumericKey`: a `Literal` key whose value is a number. A bigint literal is a `Literal` too, but not a number.
fn is_numeric_key(key: Key<'_>, file: &File<'_>) -> bool {
    matches!(key.kind(), KeyKind::Number(_) | KeyKind::ComputedNumber(_))
        && !file.slice(key.inner_span(file)).ends_with(b"n")
}

/// `matches` for a `RegexOption`, against one value. The error is `new RegExp`'s.
fn matches(patterns: &Patterns, value: &[u8]) -> Result<bool, Vec<u8>> {
    for pattern in &patterns.0 {
        match pattern {
            Pattern::Valid(regex) => {
                if regex.test(value) {
                    return Ok(true);
                }
            }
            Pattern::Invalid(message) => return Err(message.clone().into_bytes()),
        }
    }
    Ok(false)
}

/// `matchesScopedExpressions`: the shallow patterns against the nearest parent, the deep ones against every parent.
/// `values` gives what a parent is matched by: its name, or each of its comments.
fn matches_scoped<'a>(
    option: &ScopedPatterns,
    parents: &[Parent<'a>],
    values: impl Fn(Parent<'a>, &mut dyn FnMut(&[u8]) -> Result<bool, Vec<u8>>) -> Result<bool, Vec<u8>>,
) -> Result<bool, Vec<u8>> {
    if let Some(&first) = parents.first()
        && values(first, &mut |value| matches(&option.shallow, value))?
    {
        return Ok(true);
    }
    for &parent in parents {
        if values(parent, &mut |value| matches(&option.deep, value))? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// `isContextOptionMatching`
fn matches_configuration<'a>(
    conditions: &ConfigurationIf,
    elements: &[Element<'a>],
    parents: &[Parent<'a>],
    listened: Listened<'a>,
    file: &'a File<'a>,
) -> Result<bool, Vec<u8>> {
    if let Some(patterns) = &conditions.all_names_match_pattern {
        for element in elements {
            if !matches(patterns, element.name)? {
                return Ok(false);
            }
        }
    }
    if let Some(option) = &conditions.declaration_matches_pattern
        && !matches_scoped(option, parents, |parent, test| test(parent.name(file)))?
    {
        return Ok(false);
    }
    if let Some(wanted) = conditions.has_numeric_keys_only
        && elements.iter().all(|element| element.is_numeric_key) != wanted
    {
        return Ok(false);
    }
    if let Some(option) = &conditions.declaration_comment_matches_pattern
        && !matches_scoped(option, parents, |parent, test| {
            for comment in file.comments_before(parent.span_for_comments()) {
                if test(strings::trim_js_whitespace(comment.comment_value()))? {
                    return Ok(true);
                }
            }
            Ok(false)
        })?
    {
        return Ok(false);
    }
    if let Some(selector) = &conditions.matches_ast_selector {
        let (span, mut matched) = (listened.estree_span(), Ok(false));
        EsNode::for_each_at(listened.node(), |es_node| {
            if es_node.span() == span && matches!(matched, Ok(false)) {
                matched = selector
                    .test(es_node)
                    .map_err(|error| error.message().to_vec());
            }
        });
        if !matched? {
            return Ok(false);
        }
    }
    Ok(true)
}

/// `canReportErrors` for a rule without dependencies: with `type: "unsorted"`, no groups and no spacing to enforce,
/// nothing is ever reported.
fn can_report_errors(config: &Configuration) -> bool {
    let newlines_inside = match config.newlines_inside {
        NewlinesInside::Fixed(newlines) => newlines,
        NewlinesInside::FollowsNewlinesBetween => match config.newlines_between {
            Newlines::Ignore => Newlines::Ignore,
            Newlines::Count(_) => Newlines::Count(0.0),
        },
    };
    !config.groups.is_empty()
        || config.sort.type_ != SortType::Unsorted
        || newlines_inside != Newlines::Ignore
}

/// `isNodeIgnoredForGroup`: with `sortBy: "value"`, a member without a value keeps its place.
fn is_node_ignored_for_group(options: &SortOptions, node: &SortingNode<'_>) -> bool {
    options.sort_by == SortBy::Value && node.value.is_empty()
}

/// Upstream's `sortObjectTypeElements`.
pub(crate) fn sort_object_type_elements<'a, R>(
    rule: &RuleOptions,
    messages: &Messages,
    listened: Listened<'a>,
    cx: &mut Cx<'a, R>,
) where
    R: Rule<State<'a> = State>,
{
    let members = listened.members();
    // `isSortable`
    if members.len() < 2 {
        return;
    }
    let file = cx.file();
    let node = listened.node();
    let state = &cx.state.0;
    if let Some(error) = &state.settings_error {
        cx.throw(node, "Error", error.clone());
        return;
    }
    let configurations = state
        .with_settings
        .as_deref()
        .unwrap_or(&rule.configurations);

    let elements: SmallVec<[Element<'a>; 8]> = members
        .iter()
        .map(|member| Element::new(member, file))
        .collect();
    let parents = listened.parents();

    // `computeMatchedContextOptions`: the last configuration is the defaults, whose conditions are empty.
    let mut config = None;
    for candidate in configurations {
        match matches_configuration(
            &candidate.use_configuration_if,
            &elements,
            &parents,
            listened,
            file,
        ) {
            Ok(true) => {
                config = Some(candidate);
                break;
            }
            Ok(false) => {}
            Err(message) => {
                cx.throw(node, "SyntaxError", message);
                return;
            }
        }
    }
    let Some(config) = config else {
        return;
    };
    if !can_report_errors(config) {
        return;
    }

    let disabled_lines = state
        .disabled_lines
        .get_or_init(|| DisabledLines::of_rule(file, &R::META));

    let mut nodes: Vec<SortingNode<'a>> = Vec::with_capacity(elements.len());
    // Where each partition starts in `nodes`; a signature ends one.
    let mut partition_starts: SmallVec<[u32; 4]> = SmallVec::new();
    partition_starts.push(0);
    let mut partition_id = 1;
    let mut last_in_partition: Option<Span> = None;
    for element in &elements {
        if element.is_signature {
            partition_id += 1;
            partition_starts.push(nodes.len() as u32);
            last_in_partition = None;
            continue;
        }
        let span = element.member.span();
        let group = match groups::compute_group(
            config,
            element.selectors,
            element.modifiers,
            element.name,
            element.value,
        ) {
            Ok(group) => group,
            Err(message) => {
                cx.throw(node, "SyntaxError", message);
                return;
            }
        };
        match partition::should_partition(file, config, last_in_partition, span) {
            Ok(true) => {
                partition_id += 1;
                partition_starts.push(nodes.len() as u32);
            }
            Ok(false) => {}
            Err(message) => {
                cx.throw(node, "SyntaxError", message);
                return;
            }
        }
        let text = file.slice(span);
        // `rangeToDiff`
        let size = strings::wtf8_len_utf16(text) - u32::from(matches!(text, [.., b',' | b';']));
        nodes.push(SortingNode {
            span,
            outer_span: span,
            name: Cow::Borrowed(element.name),
            value: element.value,
            size,
            group,
            group_index: config
                .groups_index
                .get(group as usize)
                .copied()
                .unwrap_or(config.groups.len() as u32),
            partition_id,
            is_eslint_disabled: disabled_lines
                .lines
                .binary_search(&file.line_of(span.start))
                .is_ok(),
            dependency_names: SmallVec::new(),
            dependencies: SmallVec::new(),
        });
        last_in_partition = Some(span);
    }

    // `sortNodesExcludingEslintDisabled`: each partition on its own, then concatenated.
    let sort_all = |ignore_eslint_disabled: bool| -> Vec<u32> {
        let mut order = Vec::with_capacity(nodes.len());
        for (i, &start) in partition_starts.iter().enumerate() {
            let end = partition_starts
                .get(i + 1)
                .copied()
                .unwrap_or(nodes.len() as u32);
            let Some(slice) = nodes.get(start as usize..end as usize) else {
                continue;
            };
            let sorted = sort::sort_nodes_by_groups(
                slice,
                config,
                ignore_eslint_disabled,
                is_node_ignored_for_group,
            );
            order.extend(sorted.into_iter().map(|index| index + start));
        }
        order
    };
    let sorted = Sorted {
        all: sort_all(false),
        without_disabled: sort_all(true),
    };
    report::report_all_errors(cx, messages, &nodes, &sorted, config, FIX_OPTIONS);
}
