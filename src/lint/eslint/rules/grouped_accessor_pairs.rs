use super::accessor_pairs;
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
    /// ESLint's `checkList`, for the one setter `func` of the list.
    fn check_list<'a>(&self, func: Func<'a>, accessors: &mut dyn Iterator<Item = Accessor<'a>>, cx: &Cx<'a, Self>) {
        let all: SmallVec<[Accessor<'a>; 8]> = accessors.collect();
        let Some(setter) = all.iter().find(|it| it.func == func) else {
            return;
        };
        // Nothing is reported for a name that has several getters or several setters.
        let mut others =
            all.iter().filter(|it| it.index != setter.index && are_equal_keys(cx.file(), setter.key, it.key));
        if let (Some(getter), None) = (others.next(), others.next()) {
            self.check_pair(*getter, *setter, cx);
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
    fn check_signatures<'a>(&self, func: Func<'a>, members: List<'a, Member<'a>>, cx: &Cx<'a, Self>) {
        self.check_list(
            func,
            &mut members.iter().enumerate().filter_map(|(index, member)| Accessor::of_member(index, member)),
            cx,
        );
    }
}

impl Rule for GroupedAccessorPairs {
    const META: Meta = Meta::eslint("grouped-accessor-pairs", Kind::Suggestion);
    const ON: On = On::new().funcs();
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

    /// A pair has one setter.
    #[inline]
    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if func.kind() == FnKind::Setter {
            self.check_setter(func, cx);
        }
    }
}

impl GroupedAccessorPairs {
    #[inline(never)]
    fn check_setter<'a>(&self, func: Func<'a>, cx: &Cx<'a, Self>) {
        match func.owner() {
            Node::Expr(e) => {
                if let Node::Prop(prop) = e.parent()
                    && let Node::Expr(object) = prop.parent()
                    && let Some(props) = object.as_object()
                {
                    self.check_list(
                        func,
                        &mut props.iter().enumerate().filter_map(|(index, prop)| Accessor::of_prop(index, prop)),
                        cx,
                    );
                }
            }
            Node::Member(member) => match member.parent() {
                Node::Class(class) => {
                    let is_static = member.is_static();
                    // An abstract accessor is not a `MethodDefinition`.
                    let mut accessors = class.members().iter().enumerate().filter_map(move |(index, member)| {
                        let flags = member.flags();
                        (flags.contains(Flags::STATIC) == is_static && !flags.contains(Flags::ABSTRACT))
                            .then(|| Accessor::of_member(index, member))
                            .flatten()
                    });
                    self.check_list(func, &mut accessors, cx);
                }
                Node::Type(ty) if self.enforce_for_ts_types => {
                    if let TypeKind::Object(members) = ty.kind() {
                        self.check_signatures(func, members, cx);
                    }
                }
                Node::Stmt(statement) if self.enforce_for_ts_types => {
                    if let Some(interface) = statement.as_interface() {
                        self.check_signatures(func, interface.members(), cx);
                    }
                }
                _ => {}
            },
            _ => {}
        }
    }
}
