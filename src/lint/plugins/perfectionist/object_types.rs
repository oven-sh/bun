//! What `sort-object-types` and `sort-interfaces` share: `rules/sort-object-types/sort-object-type-elements.ts` and
//! its helpers (`compute-node-name.ts`, `is-member-optional.ts`, `is-node-function-type.ts`).

use super::configuration_if::Subject;
use super::fixes::{self, FixOptions};
use super::options::{RuleKind, RuleOptions};
use super::sort::{IgnoredForGroup, Sorted};
use super::{FileState, Messages, SortingNode, groups, partition, report, sort};
use bun_core::strings;
use bun_lint::prelude::*;
use smallvec::SmallVec;
use std::borrow::Cow;
use std::cell::Cell;

/// `sort-interfaces` reuses the `defaultOptions` and `jsonSchema` of `sort-object-types`.
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

    /// What `useConfigurationIf` is tested against.
    fn subject(self) -> Subject<'a> {
        match self {
            Listened::TypeLiteral(ty, _) => Subject::TypeLiteral(ty),
            Listened::Interface(stmt, _) => Subject::Interface(stmt),
        }
    }

    /// `node.members` / `node.body.body`
    fn members(self) -> List<'a, Member<'a>> {
        match self {
            Listened::TypeLiteral(_, members) => members,
            Listened::Interface(_, interface) => interface.members(),
        }
    }
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

/// What one `TypeElement` of the listened node is, computed once for `computeMatchedContextOptions` and the sorting
/// nodes both.
struct Element<'a> {
    member: Member<'a>,
    /// `computeNodeName`
    name: &'a [u8],
    /// The text of a property's type annotation, else empty.
    value: &'a [u8],
    /// A call or construct signature: not sorted, and a partition boundary.
    is_signature: bool,
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
        // `` [`a`] `` is a `TemplateLiteral` in ESTree, not a `Literal`.
        Some(KeyKind::ComputedString(name) | KeyKind::ComputedNumber(name)) => key
            .filter(|key| !file.slice(key.inner_span(file)).starts_with(b"`"))
            .map(|_| name),
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

/// Upstream's `sortObjectTypeElements`.
pub(crate) fn sort_object_type_elements<'a, R>(
    rule: &RuleOptions,
    messages: &Messages,
    listened: Listened<'a>,
    cx: &Cx<'a, R>,
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

    let elements: SmallVec<[Element<'a>; 8]> = members
        .iter()
        .map(|member| Element::new(member, file))
        .collect();
    let names = elements.iter().map(|element| element.name);
    let Some((config, _)) = state.pick(rule, listened.subject(), &names, cx, node.span()) else {
        return;
    };
    if !report::can_report_errors(config, false) {
        return;
    }
    // `context.id`: the rule with its plugin prefix.
    let mut rule_id: SmallVec<[u8; 48]> = SmallVec::new();
    rule_id.extend_from_slice(R::META.plugin.prefix().as_bytes());
    rule_id.push(b'/');
    rule_id.extend_from_slice(R::META.name.as_bytes());
    let disabled_lines = state.disabled_lines(file, &rule_id);
    let for_comparison = |with_size: bool| {
        elements
            .iter()
            .filter(|element| !element.is_signature)
            .map(move |element| {
                let span = element.member.span();
                let size = if with_size {
                    fixes::range_to_diff(file, span)
                } else {
                    0
                };
                SortingNode::for_comparison(span, element.name, element.value, size)
            })
    };
    if report::is_in_order_without_groups(config, false, disabled_lines, for_comparison) {
        return;
    }

    let mut nodes: Vec<SortingNode<'a>> = Vec::with_capacity(elements.len());
    let mut partition_id = 1;
    let mut last_in_partition: Option<Span> = None;
    for element in &elements {
        if element.is_signature {
            partition_id += 1;
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
        match partition::should_partition(file, config, last_in_partition, span, None) {
            Ok(true) => partition_id += 1,
            Ok(false) => {}
            Err(message) => {
                cx.throw(node, "SyntaxError", message);
                return;
            }
        }
        nodes.push(SortingNode {
            span,
            outer_span: span,
            name: Cow::Borrowed(element.name),
            value: element.value,
            size: fixes::range_to_diff(file, span),
            group,
            group_index: groups::group_index(config, group),
            partition_id,
            is_eslint_disabled: disabled_lines.contains(file, span),
            dependency_names: SmallVec::new(),
            dependencies: SmallVec::new(),
        });
        last_in_partition = Some(span);
    }

    // `sortNodesExcludingEslintDisabled`
    let reached_invalid_locale = Cell::new(false);
    let sort_all = |ignore_eslint_disabled| {
        sort::sort_nodes_by_groups(
            &nodes,
            config,
            ignore_eslint_disabled,
            IgnoredForGroup::ValuelessWhenSortedByValue,
            &reached_invalid_locale,
        )
    };
    let sorted = Sorted {
        all: sort_all(false),
        without_disabled: sort_all(true),
    };
    if reached_invalid_locale.get()
        && let Some(message) = &config.invalid_locale
    {
        cx.throw(node, "RangeError", message.clone());
        return;
    }
    report::report_all_errors(cx, messages, &nodes, &sorted, config, FIX_OPTIONS);
}
