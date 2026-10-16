use bun_lint::prelude::*;
use bun_lint::types::Type;
use bun_lint::utils::ts_utils::get_name_from_member;
use rustc_hash::FxHashMap;
use std::borrow::Cow;

/// Enforce that `get()` types should be assignable to their equivalent `set()` type.
pub struct RelatedGetterSetterPairs;

const MISMATCH: Message = Message::new(
    "mismatch",
    "`get()` type should be assignable to its equivalent `set()` type.",
);

/// The function of a `MethodDefinition` or a `TSMethodSignature` of this `kind`. An abstract
/// accessor is a `TSAbstractMethodDefinition`, which upstream does not look at and tsgolint does.
fn accessor(member: Member<'_>, kind: MemberKind) -> Option<Func<'_>> {
    let is_abstract = || member.flags().contains(Flags::ABSTRACT);
    (member.kind() == kind && (!is_abstract() || member.file().language().is_oxlint))
        .then(|| member.func())?
}

/// The return type of a getter that has one.
fn getter_type(member: Member<'_>) -> Option<TypeNode<'_>> {
    accessor(member, MemberKind::Getter)?.return_type()
}

/// The parameter of a setter that has exactly one.
fn setter_param(member: Member<'_>) -> Option<Param<'_>> {
    let mut params = accessor(member, MemberKind::Setter)?.params_with_this();
    let only = params.next()?;
    params.next().is_none().then_some(only)
}

/// `services.getTypeAtLocation(params[0])`
fn type_of_param(param: Param<'_>) -> Type<'_> {
    match param.default().is_some() || param.is_rest() {
        true => param.type_at_location(),
        false => param.pat().ty(),
    }
}

/// tsgolint's `GetNameFromMember`: a string, a number, a `bigint`, a regular expression or a
/// template without substitutions in brackets is named by its value, in double quotes unless that
/// is an identifier. Any other name that is not an identifier is its text, with its quotes or
/// brackets.
fn tsgolint_name_of(member: Member<'_>) -> Option<Cow<'_, [u8]>> {
    let (key, file) = (member.key()?, member.file());
    let quoted = |text: &[u8], suffix: &[u8]| [b"\"".as_slice(), text, suffix, b"\""].concat();
    Some(match key.kind() {
        KeyKind::Ident(name) | KeyKind::Private(name) => Cow::Borrowed(name.bytes()),
        KeyKind::ComputedString(name) | KeyKind::ComputedNumber(name) => {
            match bun_core::lexer::is_identifier(name.bytes()) {
                true => Cow::Borrowed(name.bytes()),
                false => Cow::Owned(quoted(name.bytes(), b"")),
            }
        }
        KeyKind::Computed(e) if !e.is_parenthesized() => match e.kind() {
            ExprKind::BigInt(value) => Cow::Owned(quoted(value.bytes(), b"n")),
            ExprKind::Regex(_) => Cow::Owned(quoted(e.text(), b"")),
            _ => Cow::Borrowed(file.slice(key.span(file))),
        },
        KeyKind::String(_) | KeyKind::Number(_) | KeyKind::Computed(_) => {
            Cow::Borrowed(file.slice(key.span(file)))
        }
    })
}

#[derive(Clone, Copy)]
enum Accessor<'a> {
    Getter(Member<'a>),
    Setter(Param<'a>),
}

impl RelatedGetterSetterPairs {
    fn check_accessors_pair<'a>(getter: Member<'a>, param: Param<'a>, cx: &Cx<'a, Self>) {
        let (get_type, set_type) = (getter.type_at_location(), type_of_param(param));
        if get_type.is_unresolved() || set_type.is_unresolved() {
            return;
        }
        if !get_type.is_assignable_to(set_type)
            && let Some(return_type) = getter_type(getter)
        {
            cx.report(return_type, MISMATCH);
        }
    }

    /// tsgolint's `checkMembers`: an accessor is checked against the one of the other kind that is
    /// kept under its name, and is kept itself only when there is none.
    fn check_members<'a>(members: List<'a, Member<'a>>, cx: &Cx<'a, Self>) {
        let mut accessors = FxHashMap::<Cow<'a, [u8]>, Accessor<'a>>::default();
        for member in members {
            let accessor = if getter_type(member).is_some() {
                Accessor::Getter(member)
            } else if let Some(param) = setter_param(member) {
                Accessor::Setter(param)
            } else {
                continue;
            };
            let Some(name) = tsgolint_name_of(member) else {
                continue;
            };
            match (accessors.get(&name).copied(), accessor) {
                (Some(Accessor::Setter(param)), Accessor::Getter(getter))
                | (Some(Accessor::Getter(getter)), Accessor::Setter(param)) => {
                    Self::check_accessors_pair(getter, param, cx);
                }
                _ => {
                    accessors.insert(name, accessor);
                }
            }
        }
    }

    fn check<'a>(members: List<'a, Member<'a>>, cx: &Cx<'a, Self>) {
        if !members.iter().any(|it| getter_type(it).is_some())
            || !members.iter().any(|it| setter_param(it).is_some())
        {
            return;
        }
        if cx.language().is_oxlint {
            return Self::check_members(members, cx);
        }
        // The last getter and the last setter of a name are the pair.
        let mut pairs =
            FxHashMap::<Cow<'a, [u8]>, (Option<Member<'a>>, Option<Param<'a>>)>::default();
        for member in members {
            if getter_type(member).is_some() {
                pairs
                    .entry(get_name_from_member(member).name)
                    .or_default()
                    .0 = Some(member);
            } else if let Some(param) = setter_param(member) {
                pairs
                    .entry(get_name_from_member(member).name)
                    .or_default()
                    .1 = Some(param);
            }
        }
        let place = |it: &(Option<Member<'a>>, Option<Param<'a>>)| {
            (
                it.0.map(|it| it.span().start),
                it.1.map(|it| it.span().start),
            )
        };
        for pair in utils::sort::in_order_of(pairs.into_values(), place) {
            if let (Some(getter), Some(param)) = pair {
                Self::check_accessors_pair(getter, param, cx);
            }
        }
    }
}

impl Rule for RelatedGetterSetterPairs {
    const META: Meta = Meta::typescript("related-getter-setter-pairs", Kind::Problem)
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types()
        .reports_on_exit();
    const ON: On = On::new()
        .classes()
        .stmts(&[StmtTag::Interface])
        .types(&[TypeTag::Object]);
    no_state!();

    fn new(_: &Options) -> Self {
        RelatedGetterSetterPairs
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        Self::check(class.members(), cx);
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::Interface(interface) = stmt.kind() {
            Self::check(interface.members(), cx);
        }
    }

    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        if let TypeKind::Object(members) = ty.kind() {
            Self::check(members, cx);
        }
    }
}
