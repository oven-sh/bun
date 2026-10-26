use bun_lint::prelude::*;
use bun_lint::utils::ts_utils::{MemberName, MemberNameType, get_name_from_member};
use rustc_hash::FxHashSet;
use smallvec::SmallVec;
use std::borrow::Cow;
use std::hash::Hash;

/// Require that function overload signatures be consecutive.
pub struct AdjacentOverloadSignatures;

const ADJACENT_SIGNATURE: Message = Message::new(
    "adjacentSignature",
    "All {{name}} signatures should be adjacent.",
);

#[derive(PartialEq, Eq, Hash)]
struct Method<'a> {
    name: MemberName<'a>,
    /// `None` for a call or construct signature, which never equals a method.
    is_static: Option<bool>,
    is_call_signature: bool,
}

/// oxlint's `static_name` and `get_kind_from_key`: a string is treated like an identifier, a number and a template are
/// a different kind, and a private name or any other computed key has no name.
fn oxlint_name_of(member: Member<'_>) -> Option<MemberName<'_>> {
    let Some(key) = member.key() else {
        return Some(get_name_from_member(member));
    };
    let is_template = || member.file().slice(key.inner_span(member.file())).starts_with(b"`");
    let (name, kind) = match key.kind() {
        KeyKind::ComputedString(name) if is_template() => (name, MemberNameType::Quoted),
        KeyKind::Ident(name) | KeyKind::String(name) | KeyKind::ComputedString(name) => (name, MemberNameType::Normal),
        KeyKind::Number(name) | KeyKind::ComputedNumber(name) => (name, MemberNameType::Quoted),
        KeyKind::Private(_) | KeyKind::Computed(_) => return None,
    };
    Some(MemberName { name: Cow::Borrowed(name.bytes()), kind })
}

fn get_member_method(member: Member<'_>) -> Option<Method<'_>> {
    let is_oxlint = member.file().language().is_oxlint;
    let signature = |name: &'static [u8], is_call_signature| Method {
        name: MemberName {
            name: Cow::Borrowed(name),
            kind: MemberNameType::Normal,
        },
        is_static: None,
        is_call_signature,
    };
    match member.kind() {
        // oxlint treats an abstract method like any other method.
        MemberKind::Method | MemberKind::Getter | MemberKind::Setter | MemberKind::Constructor
            if is_oxlint || !member.flags().contains(Flags::ABSTRACT) =>
        {
            Some(Method {
                name: if is_oxlint { oxlint_name_of(member)? } else { get_name_from_member(member) },
                is_static: Some(member.is_static()),
                is_call_signature: false,
            })
        }
        MemberKind::CallSignature => Some(signature(b"call", true)),
        MemberKind::ConstructSignature => Some(signature(b"new", false)),
        _ => None,
    }
}

/// Calls `report` for each of `members` whose method was seen earlier but not immediately before. It also passes the
/// last unreported member with that method.
fn check_body_for_overload_methods<'a, T: Handle<'a>, M: Eq + Hash>(
    members: List<'a, T>,
    get_member_method: impl Fn(T) -> Option<M>,
    report: impl Fn(T, &M, T),
) {
    if members.len() < 3 {
        return;
    }
    let mut seen_methods: SmallVec<[M; 8]> = SmallVec::new();
    // For each seen method, the last member that's in the right position.
    let mut last_members: SmallVec<[T; 8]> = SmallVec::new();
    // The previous member's index in `seen_methods`.
    let mut last_method = None;
    for member in members {
        let Some(method) = get_member_method(member) else {
            last_method = None;
            continue;
        };
        let index = seen_methods.iter().position(|seen| *seen == method);
        match index.and_then(|it| last_members.get_mut(it)) {
            Some(before) if index != last_method => report(member, &method, *before),
            Some(before) => *before = member,
            None => {
                seen_methods.push(method);
                last_members.push(member);
            }
        }
        last_method = index.or_else(|| seen_methods.len().checked_sub(1));
    }
}

/// oxlint points at the earlier one. For a function that's its name.
fn report_span(member: Span, before: Span, cx: &Cx<'_, AdjacentOverloadSignatures>) -> Span {
    if cx.language().is_oxlint { before } else { member }
}

fn check_statements<'a>(statements: List<'a, Stmt<'a>>, cx: &Cx<'a, AdjacentOverloadSignatures>) {
    check_body_for_overload_methods(
        statements,
        |statement| statement.as_fn()?.name().map(Ident::name),
        |statement, name, before| {
            let name_of = |it: Stmt<'a>| match it.kind() {
                StmtKind::Fn(func) => func.name().map_or_else(|| it.span(), |name| name.span()),
                _ => it.span(),
            };
            cx.report(report_span(statement.span(), name_of(before), cx), ADJACENT_SIGNATURE)
                .data("name", *name)
                .labels_with(|labels| labels.push(name_of(statement), ""));
        },
    );
}

/// oxlint's span for a member: its name (in a class, starting where the member starts), the `new`, or a whole call
/// signature.
fn oxlint_span_of(member: Member, is_in_class: bool) -> Span {
    let span = member.span();
    let name = match (member.kind(), member.key(), member.constructor_keyword()) {
        (MemberKind::ConstructSignature, ..) => return Span::new(span.start, span.start + 3),
        (_, Some(key), _) => key.inner_span(member.file()),
        (_, None, Some(keyword)) => keyword.span(),
        (_, None, None) => return span,
    };
    Span::new(if is_in_class { span.start } else { name.start }, name.end)
}

fn check_members<'a>(members: List<'a, Member<'a>>, is_in_class: bool, cx: &Cx<'a, AdjacentOverloadSignatures>) {
    check_body_for_overload_methods(members, get_member_method, |member, method, before| {
        let prefix: &[u8] = if method.is_static == Some(true) { b"static " } else { b"" };
        cx.report(report_span(member.span(), oxlint_span_of(before, is_in_class), cx), ADJACENT_SIGNATURE)
            .data("name", [prefix, &method.name.name[..]].concat())
            .labels_with(|labels| labels.push(oxlint_span_of(member, is_in_class), ""));
    });
}

impl Rule for AdjacentOverloadSignatures {
    const META: Meta = Meta::typescript("adjacent-overload-signatures", Kind::Suggestion)
        .presets(Presets::STYLISTIC);
    const ON: On = On::new()
        .stmts(&[StmtTag::Interface])
        .types(&[TypeTag::Object])
        .classes()
        .finish();
    no_state!();

    fn new(_: &Options) -> Self {
        AdjacentOverloadSignatures
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().classes().stmts(&[StmtTag::Interface]).types(&[TypeTag::Object]);
        match file.has_stmts([StmtTag::Fn]) {
            true => on.finish(),
            false => on,
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(interface) = statement.as_interface() {
            check_members(interface.members(), false, cx);
        }
    }

    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        if let TypeKind::Object(members) = ty.kind() {
            check_members(members, false, cx);
        }
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        check_members(class.members(), true, cx);
    }

    /// Checks the statement lists of the file, blocks, functions and namespaces that have at least two function
    /// declarations.
    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let (mut with_one, mut with_two) = (FxHashSet::default(), FxHashSet::default());
        for function in cx.file().stmts_of_kind(StmtTag::Fn) {
            let parent = function.parent();
            if with_one.insert(parent) || !with_two.insert(parent) {
                continue;
            }
            let statements = match parent {
                Node::File(file) => Some(file.body()),
                Node::Func(func) if func.kind() != FnKind::StaticBlock => func.body_statements(),
                Node::Stmt(statement) => statement.as_block().or_else(|| Some(statement.as_module()?.innermost().body())),
                _ => None,
            };
            if let Some(statements) = statements {
                check_statements(statements, cx);
            }
        }
    }
}
