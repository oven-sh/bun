use super::accessor_pairs::{MAX_KEYS_TO_COMPARE_IN_PAIRS, key_groups};
use bun_lint::prelude::*;
use smallvec::SmallVec;

/// Require grouped accessor pairs in object literals and classes.
pub struct GroupedAccessorPairs {
    order: Order,
    enforce_for_ts_types: bool,
}

#[derive(PartialEq, Eq)]
enum Order {
    Any,
    GetBeforeSet,
    SetBeforeGet,
}

const NOT_GROUPED: Message = Message::new(
    "notGrouped",
    "Accessor pair {{ formerName }} and {{ latterName }} should be grouped.",
);
const INVALID_ORDER: Message = Message::new(
    "invalidOrder",
    "Expected {{ latterName }} to be before {{ formerName }}.",
);

/// A getter or a setter.
#[derive(Copy, Clone)]
struct Accessor<'a> {
    /// Among all that is in the object literal, the class or the type.
    index: usize,
    is_getter: bool,
    key: Key<'a>,
    func: Func<'a>,
}

impl<'a> Accessor<'a> {
    fn of_member(index: usize, member: Member<'a>) -> Option<Self> {
        let is_getter = match member.kind() {
            MemberKind::Getter => true,
            MemberKind::Setter => false,
            _ => return None,
        };
        Some(Accessor {
            index,
            is_getter,
            key: member.key()?,
            func: member.func()?,
        })
    }

    fn of_prop(index: usize, prop: Prop<'a>) -> Option<Self> {
        let is_getter = match prop.kind() {
            PropKind::Getter => true,
            PropKind::Setter => false,
            _ => return None,
        };
        Some(Accessor {
            index,
            is_getter,
            key: prop.key()?,
            func: prop.func()?,
        })
    }
}

/// ESLint's `areEqualKeys`: the same name if both are known without evaluating anything, the same
/// tokens if neither is.
fn are_equal_keys<'a>(file: &'a File<'a>, left: Key<'a>, right: Key<'a>) -> bool {
    match (left.kind(), right.kind()) {
        (KeyKind::Private(left), KeyKind::Private(right)) => return left == right,
        (KeyKind::Private(_), _) | (_, KeyKind::Private(_)) => return false,
        _ => {}
    }
    match (ast_utils::get_static_key_name(left), ast_utils::get_static_key_name(right)) {
        (Some(left), Some(right)) => left == right,
        (None, None) => ast_utils::equal_tokens(file, left.inner_span(file), right.inner_span(file)),
        _ => false,
    }
}

impl GroupedAccessorPairs {
    /// ESLint's `checkList`.
    fn check_list<'a>(&self, accessors: &(impl Iterator<Item = Accessor<'a>> + Clone), cx: &Cx<'a, Self>) {
        let few: SmallVec<[Accessor<'a>; MAX_KEYS_TO_COMPARE_IN_PAIRS + 1]> =
            accessors.clone().take(MAX_KEYS_TO_COMPARE_IN_PAIRS + 1).collect();
        // Nothing is reported for a name that has several getters or several setters.
        if few.len() <= MAX_KEYS_TO_COMPARE_IN_PAIRS {
            for getter in few.iter().filter(|it| it.is_getter) {
                let mut others =
                    few.iter().filter(|it| it.index != getter.index && are_equal_keys(cx.file(), getter.key, it.key));
                if let (Some(setter), None) = (others.next(), others.next()) {
                    self.check_pair(*getter, *setter, cx);
                }
            }
            return;
        }
        let groups = key_groups(cx.file(), accessors.clone().map(|it| it.key));
        // The first two of each group, and how many there are.
        let mut members = vec![(None, None, 0usize); groups.len()];
        for (accessor, &group) in accessors.clone().zip(&groups) {
            if let Some((first, second, count)) = members.get_mut(group as usize) {
                let slot = if first.is_none() { first } else { second };
                slot.get_or_insert(accessor);
                *count += 1;
            }
        }
        for pair in members {
            match pair {
                (Some(getter), Some(setter), 2) if getter.is_getter => self.check_pair(getter, setter, cx),
                (Some(setter), Some(getter), 2) => self.check_pair(getter, setter, cx),
                _ => {}
            }
        }
    }

    /// `getter`, and the only other accessor of that name.
    fn check_pair<'a>(&self, getter: Accessor<'a>, setter: Accessor<'a>, cx: &Cx<'a, Self>) {
        if setter.is_getter || !getter.is_getter {
            return;
        }
        let is_getter_first = getter.index < setter.index;
        let (former, latter) = if is_getter_first { (getter, setter) } else { (setter, getter) };
        let message = if getter.index.abs_diff(setter.index) > 1 {
            NOT_GROUPED
        } else if self.order == Order::GetBeforeSet && !is_getter_first
            || self.order == Order::SetBeforeGet && is_getter_first
        {
            INVALID_ORDER
        } else {
            return;
        };
        cx.report(ast_utils::get_function_head_loc(latter.func), message)
            .data("formerName", ast_utils::get_function_name_with_kind(former.func))
            .data("latterName", ast_utils::get_function_name_with_kind(latter.func));
    }

    /// `TSMethodSignature`s
    fn check_signatures<'a>(&self, members: List<'a, Member<'a>>, cx: &Cx<'a, Self>) {
        self.check_list(
            &members.iter().enumerate().filter_map(|(index, member)| Accessor::of_member(index, member)),
            cx,
        );
    }
}

impl Rule for GroupedAccessorPairs {
    const META: Meta = Meta::eslint("grouped-accessor-pairs", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        GroupedAccessorPairs {
            order: match options.str(0) {
                Some("getBeforeSet") => Order::GetBeforeSet,
                Some("setBeforeGet") => Order::SetBeforeGet,
                _ => Order::Any,
            },
            enforce_for_ts_types: options.object(1).bool_or("enforceForTSTypes", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Object], |rule, e, cx| {
            if let ExprKind::Object(props) = e.kind() {
                rule.check_list(
                    &props.iter().enumerate().filter_map(|(index, prop)| Accessor::of_prop(index, prop)),
                    cx,
                );
            }
        });
        on.classes(|rule, class, cx| {
            for is_static in [false, true] {
                // An abstract accessor is not a `MethodDefinition`.
                let accessors = class.members().iter().enumerate().filter_map(move |(index, member)| {
                    let flags = member.flags();
                    (flags.contains(Flags::STATIC) == is_static && !flags.contains(Flags::ABSTRACT))
                        .then(|| Accessor::of_member(index, member))
                        .flatten()
                });
                rule.check_list(&accessors, cx);
            }
        });
        if self.enforce_for_ts_types {
            on.types([TypeTag::Object], |rule, ty, cx| {
                if let TypeKind::Object(members) = ty.kind() {
                    rule.check_signatures(members, cx);
                }
            });
            on.stmts([StmtTag::Interface], |rule, statement, cx| {
                if let StmtKind::Interface(interface) = statement.kind() {
                    rule.check_signatures(interface.members(), cx);
                }
            });
        }
    }
}
