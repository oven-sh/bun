use bun_lint::prelude::*;
use bun_lint::types::Type;
use bun_lint::utils::ts_utils::get_name_from_member;
use rustc_hash::FxHashMap;
use std::borrow::Cow;

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
        if !members.iter().any(|it| getter_type(it).is_some())
            || !members.iter().any(|it| setter_param(it).is_some())
        {
            return;
        }
        // The last getter and the last setter of a name are the pair.
        let mut pairs = FxHashMap::<Cow<'a, [u8]>, (Option<Member<'a>>, Option<Param<'a>>)>::default();
        for member in members {
            if getter_type(member).is_some() {
                pairs.entry(get_name_from_member(member).name).or_default().0 = Some(member);
            } else if let Some(param) = setter_param(member) {
                pairs.entry(get_name_from_member(member).name).or_default().1 = Some(param);
            }
        }
        for pair in pairs.into_values() {
            let (Some(getter), Some(param)) = pair else {
                continue;
            };
            let (get_type, set_type) = (getter.type_at_location(), type_of_param(param));
            if get_type.is_unresolved() || set_type.is_unresolved() {
                continue;
            }
            if !get_type.is_assignable_to(set_type)
                && let Some(return_type) = getter_type(getter)
            {
                cx.report(return_type, MISMATCH);
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
