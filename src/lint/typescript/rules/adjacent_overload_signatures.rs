use bun_lint::prelude::*;
use bun_lint::utils::ts_utils::{MemberName, MemberNameType, get_name_from_member};
use rustc_hash::FxHashMap;
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
    /// `None` for a call or a construct signature, which is never the same as a method.
    is_static: Option<bool>,
    is_call_signature: bool,
}

/// oxlint's `static_name` and `get_kind_from_key`: a string is like an identifier, a number and a template are of
/// another kind, and a private name and what else is computed are no names.
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
        // For oxlint an abstract method is a method like another.
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

/// The methods of a body, each with a number.
struct SeenMethods<M> {
    /// The number is the position.
    few: SmallVec<[M; 8]>,
    /// All of them, as soon as they are more than a few.
    many: FxHashMap<M, usize>,
}

impl<M: Eq + Hash> SeenMethods<M> {
    const FEW: usize = 16;

    fn len(&self) -> usize {
        self.few.len() + self.many.len()
    }

    fn position(&self, method: &M) -> Option<usize> {
        match self.many.is_empty() {
            true => self.few.iter().position(|seen| seen == method),
            false => self.many.get(method).copied(),
        }
    }

    fn push(&mut self, method: M) {
        if self.few.len() < Self::FEW && self.many.is_empty() {
            return self.few.push(method);
        }
        self.many.extend(self.few.drain(..).enumerate().map(|(at, seen)| (seen, at)));
        self.many.insert(method, self.many.len());
    }
}

/// Calls `report` with each of `members` whose method was seen before, but not just before, and with the last member
/// with that method that was not reported.
fn check_body_for_overload_methods<'a, T: Handle<'a>, M: Eq + Hash>(
    members: List<'a, T>,
    get_member_method: impl Fn(T) -> Option<M>,
    report: impl Fn(T, &M, T),
) {
    if members.len() < 3 {
        return;
    }
    let mut seen_methods = SeenMethods {
        few: SmallVec::new(),
        many: FxHashMap::default(),
    };
    // The last member with each of them that is where it should be.
    let mut last_members: SmallVec<[T; 8]> = SmallVec::new();
    // Its number in `seen_methods`.
    let mut last_method = None;
    for member in members {
        let Some(method) = get_member_method(member) else {
            last_method = None;
            continue;
        };
        let index = seen_methods.position(&method);
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

/// oxlint points at the one before, which is the name of a function.
fn place(member: Span, before: Span, cx: &Cx<'_, AdjacentOverloadSignatures>) -> Span {
    if cx.language().is_oxlint { before } else { member }
}

fn check_statements<'a>(statements: List<'a, Stmt<'a>>, cx: &Cx<'a, AdjacentOverloadSignatures>) {
    check_body_for_overload_methods(
        statements,
        |statement| match statement.kind() {
            StmtKind::Fn(func) => func.name().map(Ident::name),
            _ => None,
        },
        |statement, name, before| {
            let name_of = |it: Stmt<'a>| match it.kind() {
                StmtKind::Fn(func) => func.name().map_or_else(|| it.span(), |name| name.span()),
                _ => it.span(),
            };
            cx.report(place(statement.span(), name_of(before), cx), ADJACENT_SIGNATURE)
                .data("name", *name)
                .labels_with(|labels| labels.push(name_of(statement), ""));
        },
    );
}

/// What oxlint has for a member: its name, in a class from where the member starts; `new`; all of a call signature.
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
        cx.report(place(member.span(), oxlint_span_of(before, is_in_class), cx), ADJACENT_SIGNATURE)
            .data("name", [prefix, &method.name.name[..]].concat())
            .labels_with(|labels| labels.push(oxlint_span_of(member, is_in_class), ""));
    });
}

impl Rule for AdjacentOverloadSignatures {
    const META: Meta = Meta::typescript("adjacent-overload-signatures", Kind::Suggestion)
        .presets(Presets::STYLISTIC);
    const ON: On = On::new()
        .stmts(&[StmtTag::Block, StmtTag::Module, StmtTag::Interface])
        .types(&[TypeTag::Object])
        .funcs()
        .classes()
        .finish();
    no_state!();

    fn new(_: &Options) -> Self {
        AdjacentOverloadSignatures
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().classes().stmts(&[StmtTag::Interface]).types(&[TypeTag::Object]);
        match file.has_stmts([StmtTag::Fn]) {
            true => on.stmts(&[StmtTag::Block, StmtTag::Module]).funcs().finish(),
            false => on,
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match statement.kind() {
            StmtKind::Block(body) => check_statements(body, cx),
            StmtKind::Module(module) => check_statements(module.body(), cx),
            StmtKind::Interface(interface) => check_members(interface.members(), false, cx),
            _ => {}
        }
    }

    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        if let TypeKind::Object(members) = ty.kind() {
            check_members(members, false, cx);
        }
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if func.kind() != FnKind::StaticBlock
            && let Some(body) = func.body_statements()
        {
            check_statements(body, cx);
        }
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        check_members(class.members(), true, cx);
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        check_statements(cx.file().body(), cx);
    }
}
