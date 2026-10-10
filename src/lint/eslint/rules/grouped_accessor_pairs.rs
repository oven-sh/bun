use super::accessor_pairs::{self, MAX_KEYS_TO_COMPARE_IN_PAIRS, key_groups};
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
    fn at(index: usize, accessor: accessor_pairs::Accessor<'a>) -> Self {
        Accessor {
            index,
            is_getter: accessor.is_getter,
            key: accessor.key,
            func: accessor.func,
        }
    }

    fn of_member(index: usize, member: Member<'a>) -> Option<Self> {
        accessor_pairs::Accessor::of_member(member).map(|it| Accessor::at(index, it))
    }

    fn of_prop(index: usize, prop: Prop<'a>) -> Option<Self> {
        accessor_pairs::Accessor::of_prop(prop).map(|it| Accessor::at(index, it))
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
    /// It is compiled once, not for each kind of list.
    #[inline(never)]
    fn check_list<'a>(&self, accessors: &mut dyn Iterator<Item = Accessor<'a>>, cx: &Cx<'a, Self>) {
        let all: SmallVec<[Accessor<'a>; MAX_KEYS_TO_COMPARE_IN_PAIRS + 1]> = accessors.collect();
        // Nothing is reported for a name that has several getters or several setters.
        if all.len() <= MAX_KEYS_TO_COMPARE_IN_PAIRS {
            for getter in all.iter().filter(|it| it.is_getter) {
                let mut others =
                    all.iter().filter(|it| it.index != getter.index && are_equal_keys(cx.file(), getter.key, it.key));
                if let (Some(setter), None) = (others.next(), others.next()) {
                    self.check_pair(*getter, *setter, cx);
                }
            }
            return;
        }
        let groups = key_groups(cx.file(), all.iter().map(|it| it.key));
        // The first two of each group, and how many there are.
        let mut members = vec![(None, None, 0usize); groups.len()];
        for (&accessor, &group) in all.iter().zip(&groups) {
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
        let is_oxlint = cx.language().is_oxlint;
        let is_grouped = getter.index.abs_diff(setter.index) <= 1;
        let is_in_order = match self.order {
            Order::GetBeforeSet => is_getter_first,
            Order::SetBeforeGet => !is_getter_first,
            Order::Any => true,
        };
        // oxlint points at the getter.
        let at = if is_oxlint { getter.func } else { latter.func };
        let head = ast_utils::get_function_head_loc(at);
        // For oxlint it ends with the key: before the `]`.
        let end = if is_oxlint { getter.key.inner_span(cx.file()).end } else { head.end };
        // oxlint says both of a pair that is neither grouped nor in order.
        let says_order = !is_in_order && (is_grouped || is_oxlint);
        for (is_said, message) in [(!is_grouped, NOT_GROUPED), (says_order, INVALID_ORDER)] {
            // Of a pair that is not grouped oxlint names the getter first.
            let (first, second) = match is_oxlint && message.id == NOT_GROUPED.id {
                true => (getter, setter),
                false => (former, latter),
            };
            if is_said {
                cx.report(Span::new(head.start, end), message)
                    .data("formerName", ast_utils::get_function_name_with_kind(first.func))
                    .data("latterName", ast_utils::get_function_name_with_kind(second.func))
                    .labels_with(|labels| {
                        let is_here = |it: Accessor<'a>| {
                            let name = ast_utils::get_function_name_with_kind(it.func);
                            format!("{} is here", bstr::BStr::new(&name))
                        };
                        let start = ast_utils::get_function_head_loc(setter.func).start;
                        labels.first(is_here(getter));
                        labels.push(Span::new(start, setter.key.inner_span(cx.file()).end), is_here(setter));
                    });
            }
        }
    }

    /// `TSMethodSignature`s
    fn check_signatures<'a>(&self, members: List<'a, Member<'a>>, cx: &Cx<'a, Self>) {
        self.check_list(
            &mut members.iter().enumerate().filter_map(|(index, member)| Accessor::of_member(index, member)),
            cx,
        );
    }
}

impl Rule for GroupedAccessorPairs {
    const META: Meta = Meta::eslint("grouped-accessor-pairs", Kind::Suggestion);
    const ON: On = On::new()
        .exprs(&[ExprTag::Object])
        .classes()
        .types(&[TypeTag::Object])
        .stmts(&[StmtTag::Interface]);
    no_state!();

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

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::Object(props) = e.kind() {
            self.check_list(
                &mut props.iter().enumerate().filter_map(|(index, prop)| Accessor::of_prop(index, prop)),
                cx,
            );
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if !self.enforce_for_ts_types {
            return;
        }
        if let StmtKind::Interface(interface) = statement.kind() {
            self.check_signatures(interface.members(), cx);
        }
    }

    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        if !self.enforce_for_ts_types {
            return;
        }
        if let TypeKind::Object(members) = ty.kind() {
            self.check_signatures(members, cx);
        }
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        for is_static in [false, true] {
            // An abstract accessor is not a `MethodDefinition`.
            let mut accessors = class.members().iter().enumerate().filter_map(move |(index, member)| {
                let flags = member.flags();
                (flags.contains(Flags::STATIC) == is_static && !flags.contains(Flags::ABSTRACT))
                    .then(|| Accessor::of_member(index, member))
                    .flatten()
            });
            self.check_list(&mut accessors, cx);
        }
    }
}
