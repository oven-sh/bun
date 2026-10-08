use bun_lint::prelude::*;
use bun_lint::types::Type;
use bun_lint::utils::ts_utils::get_name_from_member;

/// Enforce that `get()` types should be assignable to their equivalent `set()` type.
pub struct RelatedGetterSetterPairs;

const MISMATCH: Message =
    Message::new("mismatch", "`get()` type should be assignable to its equivalent `set()` type.");

/// The function of a `MethodDefinition` or a `TSMethodSignature` of this `kind`. An abstract
/// accessor is a `TSAbstractMethodDefinition`, which upstream does not look at.
fn accessor(member: Member<'_>, kind: MemberKind) -> Option<Func<'_>> {
    (member.kind() == kind && !member.flags().contains(Flags::ABSTRACT)).then(|| member.func())?
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

impl RelatedGetterSetterPairs {
    fn check<'a>(members: List<'a, Member<'a>>, cx: &Cx<'a, Self>) {
        for (i, getter) in members.iter().enumerate() {
            let Some(return_type) = getter_type(getter) else {
                continue;
            };
            let name = get_name_from_member(getter).name;
            let has_name = |other: Member<'a>| get_name_from_member(other).name == name;
            // The last getter and the last setter of a name are the pair.
            if members.iter().skip(i + 1).any(|other| getter_type(other).is_some() && has_name(other)) {
                continue;
            }
            let Some(param) = members.iter().rev().find_map(|other| setter_param(other).filter(|_| has_name(other)))
            else {
                continue;
            };
            let (get_type, set_type) = (getter.type_at_location(), type_of_param(param));
            if get_type.is_unresolved() || set_type.is_unresolved() {
                continue;
            }
            if !get_type.is_assignable_to(set_type) {
                cx.report(return_type, MISMATCH);
            }
        }
    }
}

impl Rule for RelatedGetterSetterPairs {
    const META: Meta = Meta::typescript("related-getter-setter-pairs", Kind::Problem)
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        RelatedGetterSetterPairs
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.classes(|_, class, cx| Self::check(class.members(), cx));
        on.stmts([StmtTag::Interface], |_, stmt, cx| {
            if let StmtKind::Interface(interface) = stmt.kind() {
                Self::check(interface.members(), cx);
            }
        });
        on.types([TypeTag::Object], |_, ty, cx| {
            if let TypeKind::Object(members) = ty.kind() {
                Self::check(members, cx);
            }
        });
    }
}
