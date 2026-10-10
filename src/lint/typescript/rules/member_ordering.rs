use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::ast_utils::get_static_string_value;
use bun_lint::utils::text::{natural_compare, to_lower_case};
use rustc_hash::FxHashSet;
use smallvec::SmallVec;
use std::borrow::Cow;
use std::cmp::Ordering;

/// Require a consistent member declaration order.
pub struct MemberOrdering {
    default: Setting,
    classes: Setting,
    class_expressions: Setting,
    interfaces: Setting,
    type_literals: Setting,
}

const INCORRECT_GROUP_ORDER: Message = Message::new(
    "incorrectGroupOrder",
    "Member {{name}} should be declared before all {{rank}} definitions.",
);
const INCORRECT_ORDER: Message = Message::new(
    "incorrectOrder",
    "Member {{member}} should be declared before member {{beforeMember}}.",
);
const INCORRECT_REQUIRED_MEMBERS_ORDER: Message = Message::new(
    "incorrectRequiredMembersOrder",
    "Member {{member}} should be declared after all {{optionalOrRequired}} members.",
);

// ───────────────────────────── options ─────────────────────────────

/// One of `classes`, `classExpressions`, `default`, `interfaces`, `typeLiterals`.
enum Setting {
    Unset,
    /// `"never"`, or a configuration that checks nothing.
    Never,
    Config(Config),
}

struct Config {
    /// `None` for `"never"`.
    member_types: Option<MemberTypes>,
    /// `None` for `"as-written"`.
    order: Option<Order>,
    optionality_order: Option<OptionalityOrder>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Order {
    Alphabetically,
    AlphabeticallyCaseInsensitive,
    Natural,
    NaturalCaseInsensitive,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum OptionalityOrder {
    OptionalFirst,
    RequiredFirst,
}

/// Upstream's `MemberKind`. In the order of `NODE_TYPES`.
#[derive(Copy, Clone, PartialEq, Eq)]
enum NodeType {
    ReadonlySignature,
    Signature,
    ReadonlyField,
    Field,
    Method,
    CallSignature,
    Constructor,
    Accessor,
    Get,
    Set,
    StaticInitialization,
}

const NODE_TYPES: [&[u8]; 11] = [
    b"readonly-signature",
    b"signature",
    b"readonly-field",
    b"field",
    b"method",
    b"call-signature",
    b"constructor",
    b"accessor",
    b"get",
    b"set",
    b"static-initialization",
];

// The first part of the name of a member group, counted from 1. 0: it has none.
const ACCESSIBILITIES: [&[u8]; 4] = [b"public", b"protected", b"private", b"#private"];
const PUBLIC: usize = 1;
const PROTECTED: usize = 2;
const PRIVATE: usize = 3;
const HASH_PRIVATE: usize = 4;

// The same for the second part.
const SCOPES: [&[u8]; 4] = [b"static", b"instance", b"abstract", b"decorated"];
const STATIC: usize = 1;
const INSTANCE: usize = 2;
const ABSTRACT: usize = 3;
const DECORATED: usize = 4;

const GROUP_COUNT: usize = 5 * 5 * NODE_TYPES.len();

/// The number of the member group `{accessibility}-{scope}-{ty}`.
fn group(accessibility: usize, scope: usize, ty: NodeType) -> usize {
    (accessibility * 5 + scope) * NODE_TYPES.len() + ty as usize
}

/// Which of `prefixes`, counted from 1, `text` starts with before a `-`, and what follows that.
fn strip_one_of<'t>(text: &'t [u8], prefixes: &[&[u8]]) -> (usize, &'t [u8]) {
    for (i, prefix) in prefixes.iter().enumerate() {
        if let Some(rest) = text.strip_prefix(*prefix).and_then(|rest| rest.strip_prefix(b"-")) {
            return (i + 1, rest);
        }
    }
    (0, text)
}

/// The number of the member group that is written `text`.
fn parse_group(text: &[u8]) -> Option<usize> {
    let node_type = |text: &[u8]| NODE_TYPES.iter().position(|it| *it == text);
    let (accessibility, rest) = strip_one_of(text, &ACCESSIBILITIES);
    // `static-initialization` starts like a scope.
    if let Some(ty) = node_type(rest) {
        return Some(accessibility * 5 * NODE_TYPES.len() + ty);
    }
    let (scope, rest) = strip_one_of(rest, &SCOPES);
    Some((accessibility * 5 + scope) * NODE_TYPES.len() + node_type(rest)?)
}

/// `memberTypes`: a list whose elements are a member group or several.
struct MemberTypes {
    /// For each member group, the index of the first element that has it. -1 if none has.
    ranks: Box<[i16]>,
    /// For each element, how a message names it.
    labels: Vec<Vec<u8>>,
}

impl MemberTypes {
    fn empty() -> MemberTypes {
        MemberTypes {
            ranks: vec![-1; GROUP_COUNT].into_boxed_slice(),
            labels: Vec::new(),
        }
    }

    fn push(&mut self, names: &[&[u8]]) {
        let rank = self.labels.len() as i16;
        let mut label = Vec::new();
        for (i, name) in names.iter().enumerate() {
            if let Some(slot) = parse_group(name).and_then(|group| self.ranks.get_mut(group))
                && *slot < 0
            {
                *slot = rank;
            }
            if i > 0 {
                label.extend_from_slice(b", ");
            }
            label.extend(name.iter().map(|&c| if c == b'-' { b' ' } else { c }));
        }
        self.labels.push(label);
    }

    fn from_json(entries: &[Json]) -> MemberTypes {
        let mut types = MemberTypes::empty();
        for entry in entries {
            match entry.as_array() {
                Some(names) => {
                    let names: Vec<&[u8]> = names.iter().filter_map(Json::as_str).collect();
                    types.push(&names);
                }
                None => types.push(&[entry.as_str().unwrap_or_default()]),
            }
        }
        types
    }

    /// Upstream's `defaultOrder`.
    fn default_order() -> MemberTypes {
        const PREFIXES: [&[u8]; 22] = [
            b"public-static-",
            b"protected-static-",
            b"private-static-",
            b"#private-static-",
            b"public-decorated-",
            b"protected-decorated-",
            b"private-decorated-",
            b"public-instance-",
            b"protected-instance-",
            b"private-instance-",
            b"#private-instance-",
            b"public-abstract-",
            b"protected-abstract-",
            b"public-",
            b"protected-",
            b"private-",
            b"#private-",
            b"static-",
            b"instance-",
            b"abstract-",
            b"decorated-",
            b"",
        ];
        let mut types = MemberTypes::empty();
        types.push(&[b"signature"]);
        types.push(&[b"call-signature"]);
        for kind in [&b"field"[..], b"accessor", b"get", b"set", b"method"] {
            for prefix in PREFIXES {
                types.push(&[[prefix, kind].concat().as_slice()]);
            }
            if kind == b"field" {
                types.push(&[b"static-initialization"]);
                types.push(&[b"public-constructor"]);
                types.push(&[b"protected-constructor"]);
                types.push(&[b"private-constructor"]);
                types.push(&[b"constructor"]);
            }
        }
        types
    }

    fn rank_of(&self, group: usize) -> Option<i32> {
        self.ranks.get(group).copied().filter(|rank| *rank >= 0).map(i32::from)
    }
}

impl Setting {
    /// `is_default`: upstream's `defaultOptions` are merged into it.
    fn parse(value: Option<&Json>, is_default: bool) -> Setting {
        let config = match value {
            None | Some(Json::Null) if !is_default => return Setting::Unset,
            None | Some(Json::Null) => Config {
                member_types: Some(MemberTypes::default_order()),
                order: None,
                optionality_order: None,
            },
            Some(Json::Array(entries)) => Config {
                member_types: Some(MemberTypes::from_json(entries)),
                order: None,
                optionality_order: None,
            },
            Some(value @ Json::Object(_)) => {
                let object = Object::of(Some(value));
                Config {
                    member_types: match object.get("memberTypes") {
                        Some(types) => types.as_array().map(MemberTypes::from_json),
                        None => is_default.then(MemberTypes::default_order),
                    },
                    order: match object.str("order") {
                        Some("alphabetically") => Some(Order::Alphabetically),
                        Some("alphabetically-case-insensitive") => {
                            Some(Order::AlphabeticallyCaseInsensitive)
                        }
                        Some("natural") => Some(Order::Natural),
                        Some("natural-case-insensitive") => Some(Order::NaturalCaseInsensitive),
                        _ => None,
                    },
                    optionality_order: match object.str("optionalityOrder") {
                        Some("optional-first") => Some(OptionalityOrder::OptionalFirst),
                        Some("required-first") => Some(OptionalityOrder::RequiredFirst),
                        _ => None,
                    },
                }
            }
            Some(_) => return Setting::Never,
        };
        if config.member_types.is_none()
            && config.order.is_none()
            && config.optionality_order.is_none()
        {
            return Setting::Never;
        }
        Setting::Config(config)
    }
}

// ───────────────────────────── members ─────────────────────────────

/// Upstream's `getNodeType`.
fn get_node_type(member: Member) -> NodeType {
    let flags = member.flags();
    let is_readonly = flags.contains(Flags::READONLY);
    match member.kind() {
        MemberKind::Method | MemberKind::Constructor if member.is_constructor() => NodeType::Constructor,
        MemberKind::Method | MemberKind::Constructor => NodeType::Method,
        MemberKind::Getter => NodeType::Get,
        MemberKind::Setter => NodeType::Set,
        MemberKind::ConstructSignature => NodeType::Constructor,
        MemberKind::CallSignature => NodeType::CallSignature,
        MemberKind::StaticBlock => NodeType::StaticInitialization,
        MemberKind::IndexSignature if is_readonly => NodeType::ReadonlySignature,
        MemberKind::IndexSignature => NodeType::Signature,
        MemberKind::Property if flags.contains(Flags::ACCESSOR) => NodeType::Accessor,
        MemberKind::Property
            if get_member_initializer(member).is_some_and(|value| value.tag() == ExprTag::Fn) =>
        {
            NodeType::Method
        }
        MemberKind::Property if is_readonly => NodeType::ReadonlyField,
        MemberKind::Property => NodeType::Field,
    }
}

/// Upstream's `getMemberRawName`.
fn get_member_raw_name<'a>(key: Key<'a>, file: &File<'a>) -> Cow<'a, [u8]> {
    match key.kind() {
        KeyKind::Ident(name)
        | KeyKind::String(name)
        | KeyKind::Number(name)
        | KeyKind::ComputedNumber(name) => Cow::Borrowed(name.bytes()),
        KeyKind::Private(name) => {
            let name = name.bytes();
            Cow::Borrowed(name.strip_prefix(b"#").unwrap_or(name))
        }
        KeyKind::ComputedString(name) => {
            // A template is not a `Literal`: its name is its source text.
            let (text, brackets) = (file.text(), key.span(file));
            let start = skip_trivia(text, brackets.start + 1);
            match text.get(start as usize) {
                Some(b'`') => {
                    let end = skip_trivia_back(text, brackets.end.saturating_sub(1));
                    Cow::Borrowed(file.slice(Span::new(start, end)))
                }
                _ => Cow::Borrowed(name.bytes()),
            }
        }
        KeyKind::Computed(e) => match e.kind() {
            ExprKind::Ident(name) => Cow::Borrowed(name.bytes()),
            ExprKind::Template(_) => Cow::Borrowed(e.text()),
            _ => get_static_string_value(e).unwrap_or_else(|| Cow::Borrowed(e.text())),
        },
    }
}

/// Upstream's `getMemberName`.
fn get_member_name<'a>(member: Member<'a>) -> Cow<'a, [u8]> {
    let name: &[u8] = match member.kind() {
        MemberKind::Property | MemberKind::Method | MemberKind::Getter | MemberKind::Setter => {
            return match member.key() {
                Some(key) => get_member_raw_name(key, member.file()),
                None => Cow::default(),
            };
        }
        MemberKind::Constructor => b"constructor",
        MemberKind::ConstructSignature => b"new",
        MemberKind::CallSignature => b"call",
        MemberKind::StaticBlock => b"static block",
        MemberKind::IndexSignature => {
            // Upstream's `getNameFromIndexSignature`: `...a` is a `RestElement`, not an `Identifier`.
            let params = member.func().map(Func::params);
            let is_identifier = |param: &Param| !param.is_rest() && param.default().is_none();
            match params.and_then(|params| params.iter().filter(is_identifier).find_map(|param| param.pat().as_ident())) {
                Some(name) => name.bytes(),
                None => b"(index signature)",
            }
        }
    };
    Cow::Borrowed(name)
}

/// Upstream's `isMemberOptional`.
fn is_member_optional(member: Member) -> bool {
    member.flags().contains(Flags::OPTIONAL)
        && matches!(
            member.kind(),
            MemberKind::Property | MemberKind::Method | MemberKind::Getter | MemberKind::Setter
        )
}

/// Upstream's `getMemberInitializer`: the `value` of a `PropertyDefinition` or an
/// `AccessorProperty`.
fn get_member_initializer(member: Member<'_>) -> Option<Expr<'_>> {
    if member.kind() != MemberKind::Property || member.flags().contains(Flags::ABSTRACT) {
        return None;
    }
    member.init()
}

/// Upstream's `collectImmediateThisPropertyNames`: the `x` of every `this.x` that is evaluated
/// with `initializer`, and not later in a function or in the body of a class.
fn collect_immediate_this_property_names(initializer: Expr<'_>) -> SmallVec<[Cow<'_, [u8]>; 4]> {
    let mut names = SmallVec::new();
    let mut stack = vec![Node::Expr(initializer)];
    while let Some(node) = stack.pop() {
        match node {
            Node::Func(func) if func.has_body() => continue,
            Node::Member(member) if !member.is_signature() => continue,
            Node::Expr(e) => match e.kind() {
                ExprKind::Dot { obj, name, .. }
                    if obj.tag() == ExprTag::This && !e.is_in_type_query() && !e.is_jsx_tag_name() =>
                {
                    let name = name.bytes();
                    names.push(Cow::Borrowed(name.strip_prefix(b"#").unwrap_or(name)));
                }
                ExprKind::Index { obj, index, .. } if obj.tag() == ExprTag::This => {
                    names.extend(get_static_string_value(index));
                }
                _ => {}
            },
            _ => {}
        }
        node.for_each_child(|child| stack.push(child));
    }
    names
}

/// The names of the members with an initializer among those that a member would have to be moved before.
#[derive(Default)]
struct EarlierMembers<'a> {
    names: FxHashSet<Cow<'a, [u8]>>,
    /// The positions of the members that `names` is about.
    range: std::ops::Range<usize>,
}

impl<'a> EarlierMembers<'a> {
    /// Upstream's `isBlockedByEarlierMemberReferences`. `earlier`: the positions in `members` of those that `member` would have
    /// to be moved before. From one call to the next, it starts where it did or where it has ended or later: a member is looked
    /// at once.
    fn block(&mut self, member: Member<'a>, members: &[Member<'a>], earlier: std::ops::Range<usize>) -> bool {
        let Some(initializer) = get_member_initializer(member) else {
            return false;
        };
        let referenced = collect_immediate_this_property_names(initializer);
        if referenced.is_empty() {
            return false;
        }
        if self.range.start != earlier.start {
            self.names.clear();
            self.range = earlier.start..earlier.start;
        }
        let added = members.get(self.range.end..earlier.end).unwrap_or_default();
        self.names.extend(added.iter().filter(|it| get_member_initializer(**it).is_some()).map(|it| get_member_name(*it)));
        self.range.end = self.range.end.max(earlier.end);
        referenced.iter().any(|it| self.names.contains(it))
    }
}

/// Upstream's `getRank`: the index in `types` of the most specific member group of `member` that
/// is listed. -1 if none is, and for an overload.
fn get_rank(member: Member, types: &MemberTypes, supports_modifiers: bool) -> i32 {
    let flags = member.flags();
    let is_abstract = flags.contains(Flags::ABSTRACT);
    if supports_modifiers
        && !is_abstract
        && matches!(
            member.kind(),
            MemberKind::Method | MemberKind::Getter | MemberKind::Setter | MemberKind::Constructor
        )
        && !member.func().is_some_and(Func::has_body)
    {
        return -1;
    }

    let ty = get_node_type(member);
    let is_readonly_field = ty == NodeType::ReadonlyField;
    let mut groups: SmallVec<[usize; 12]> = SmallVec::new();
    if supports_modifiers {
        let scope = match () {
            () if flags.contains(Flags::STATIC) => STATIC,
            () if is_abstract => ABSTRACT,
            () => INSTANCE,
        };
        let accessibility = match () {
            () if flags.contains(Flags::PUBLIC) => PUBLIC,
            () if flags.contains(Flags::PROTECTED) => PROTECTED,
            () if flags.contains(Flags::PRIVATE) => PRIVATE,
            () if member.key().is_some_and(Key::is_private) => HASH_PRIVATE,
            () => PUBLIC,
        };
        if matches!(
            ty,
            NodeType::ReadonlyField
                | NodeType::Field
                | NodeType::Method
                | NodeType::Accessor
                | NodeType::Get
                | NodeType::Set
        ) && member.decorators().next().is_some()
        {
            groups.push(group(accessibility, DECORATED, ty));
            groups.push(group(0, DECORATED, ty));
            if is_readonly_field {
                groups.push(group(accessibility, DECORATED, NodeType::Field));
                groups.push(group(0, DECORATED, NodeType::Field));
            }
        }
        if !matches!(
            ty,
            NodeType::ReadonlySignature | NodeType::Signature | NodeType::StaticInitialization
        ) {
            if ty != NodeType::Constructor {
                groups.push(group(accessibility, scope, ty));
                groups.push(group(0, scope, ty));
                if is_readonly_field {
                    groups.push(group(accessibility, scope, NodeType::Field));
                    groups.push(group(0, scope, NodeType::Field));
                }
            }
            groups.push(group(accessibility, 0, ty));
            if is_readonly_field {
                groups.push(group(accessibility, 0, NodeType::Field));
            }
        }
    }
    groups.push(group(0, 0, ty));
    match ty {
        NodeType::ReadonlySignature => groups.push(group(0, 0, NodeType::Signature)),
        NodeType::ReadonlyField => groups.push(group(0, 0, NodeType::Field)),
        _ => {}
    }
    groups.iter().find_map(|&group| types.rank_of(group)).unwrap_or(-1)
}

/// Upstream's `groupMembersByType`, with all its quirks: the last member is in no group, and a
/// member of the rank of the last group joins it from anywhere.
fn group_members_by_type<'a>(
    members: &[Member<'a>],
    types: &MemberTypes,
    supports_modifiers: bool,
) -> Vec<Vec<Member<'a>>> {
    let mut grouped: Vec<Vec<Member<'a>>> = Vec::new();
    let ranks: SmallVec<[i32; 16]> =
        members.iter().map(|&member| get_rank(member, types, supports_modifiers)).collect();
    let mut previous_rank = None;
    for ((&member, &rank), &next_rank) in members.iter().zip(&ranks).zip(ranks.iter().skip(1)) {
        if Some(rank) == previous_rank {
            if let Some(group) = grouped.last_mut() {
                group.push(member);
            }
        } else if rank == next_rank {
            grouped.push(vec![member]);
            previous_rank = Some(rank);
        }
    }
    grouped
}

/// Upstream's `getLowestRank`: how a message names the lowest of `ranks` that is above `target`.
fn get_lowest_rank<'t>(ranks: &[i32], target: i32, types: &'t MemberTypes) -> &'t [u8] {
    let mut lowest = ranks.last().copied().unwrap_or(0);
    for &rank in ranks {
        if rank > target {
            lowest = lowest.min(rank);
        }
    }
    types.labels.get(lowest as usize).map(Vec::as_slice).unwrap_or_default()
}

// ───────────────────────────── comparing names ─────────────────────────────

/// Upstream's `naturalOutOfOrder`.
fn natural_out_of_order(name: &[u8], previous_name: &[u8], order: Order) -> bool {
    if name == previous_name {
        return false;
    }
    match order {
        Order::Alphabetically => strings::order_utf16(name, previous_name) == Ordering::Less,
        Order::AlphabeticallyCaseInsensitive => {
            strings::order_utf16(&to_lower_case(name), &to_lower_case(previous_name)) == Ordering::Less
        }
        Order::Natural => natural_compare(name, previous_name) != Ordering::Greater,
        Order::NaturalCaseInsensitive => {
            natural_compare(&to_lower_case(name), &to_lower_case(previous_name)) != Ordering::Greater
        }
    }
}

// ───────────────────────────── the checks ─────────────────────────────

/// Where the optionality of the members changes for the first time.
fn find_switch_index(members: &[Member]) -> Option<usize> {
    let first = is_member_optional(*members.first()?);
    members.iter().position(|&member| is_member_optional(member) != first)
}

/// Upstream's `validateMembersOrder`, for the members of one class, interface or type literal.
struct Validation<'c, 'a> {
    cx: &'c Cx<'a, MemberOrdering>,
    config: &'c Config,
    supports_modifiers: bool,
    members: &'c [Member<'a>],
}

impl<'a> Validation<'_, 'a> {
    /// The members by group, if `wants_groups`. `None` if a group is not where it belongs.
    fn check_group_sort(
        &self,
        members: &[Member<'a>],
        types: &MemberTypes,
        wants_groups: bool,
    ) -> Option<Vec<Vec<Member<'a>>>> {
        let mut previous_ranks: SmallVec<[i32; 16]> = SmallVec::new();
        let mut member_groups: Vec<Vec<Member<'a>>> = Vec::new();
        let mut is_correctly_sorted = true;
        for &member in members {
            let rank = get_rank(member, types, self.supports_modifiers);
            if rank == -1 {
                continue;
            }
            match previous_ranks.last().copied() {
                Some(last) if rank < last => {
                    self.cx
                        .report(member, INCORRECT_GROUP_ORDER)
                        .data("name", get_member_name(member))
                        .data("rank", get_lowest_rank(&previous_ranks, rank, types).to_vec());
                    is_correctly_sorted = false;
                }
                Some(last) if rank == last => {
                    if let Some(group) = member_groups.last_mut() {
                        group.push(member);
                    }
                }
                _ => {
                    previous_ranks.push(rank);
                    if wants_groups {
                        member_groups.push(vec![member]);
                    }
                }
            }
        }
        is_correctly_sorted.then_some(member_groups)
    }

    fn check_alpha_sort(&self, members: &[Member<'a>], order: Order) {
        let mut previous_name: Cow<'a, [u8]> = Cow::default();
        let mut previous_index = 0;
        let mut earlier = EarlierMembers::default();
        for (index, &member) in members.iter().enumerate() {
            let name = get_member_name(member);
            if name.is_empty() {
                continue;
            }
            if natural_out_of_order(&name, &previous_name, order) {
                if earlier.block(member, members, previous_index..index) {
                    continue;
                }
                self.cx
                    .report(member, INCORRECT_ORDER)
                    .data("beforeMember", std::mem::take(&mut previous_name))
                    .data("member", name.clone());
            }
            previous_name = name;
            previous_index = index;
        }
    }

    /// Whether the optional members and the required ones are each together, in the right order.
    fn check_required_order(&self, switch_index: usize, order: OptionalityOrder) -> bool {
        let (Some(&first), Some(&switch)) = (self.members.first(), self.members.get(switch_index))
        else {
            return true;
        };
        let report = |member: Member<'a>| {
            self.cx
                .report(member, INCORRECT_REQUIRED_MEMBERS_ORDER)
                .data("member", get_member_name(member))
                .data(
                    "optionalOrRequired",
                    match order {
                        OptionalityOrder::RequiredFirst => "required",
                        OptionalityOrder::OptionalFirst => "optional",
                    },
                );
        };
        if is_member_optional(first) != (order == OptionalityOrder::OptionalFirst) {
            report(first);
            return false;
        }
        let is_switch_optional = is_member_optional(switch);
        let mut rest = self.members.iter().skip(switch_index + 1);
        if rest.any(|&member| is_member_optional(member) != is_switch_optional) {
            report(switch);
            return false;
        }
        true
    }

    fn check_order(&self, member_set: &[Member<'a>]) {
        let order = self.config.order;
        let Some(types) = &self.config.member_types else {
            if let Some(order) = order {
                self.check_alpha_sort(member_set, order);
            }
            return;
        };
        let grouped = self.check_group_sort(member_set, types, order.is_some());
        let Some(order) = order else {
            return;
        };
        // As upstream, all the members and not only `member_set` if the groups are out of order.
        let grouped = grouped
            .unwrap_or_else(|| group_members_by_type(self.members, types, self.supports_modifiers));
        for group in &grouped {
            self.check_alpha_sort(group, order);
        }
    }

    fn run(&self) {
        let switch_index = match self.config.optionality_order {
            Some(_) => find_switch_index(self.members),
            None => None,
        };
        let (Some(order), Some(switch_index)) = (self.config.optionality_order, switch_index) else {
            self.check_order(self.members);
            return;
        };
        if self.check_required_order(switch_index, order) {
            let (before, after) = self.members.split_at(switch_index);
            self.check_order(before);
            self.check_order(after);
        }
    }
}

impl MemberOrdering {
    /// `options[setting] ?? options.default`. `None` for `"never"`.
    fn config<'s>(&'s self, setting: &'s Setting) -> Option<&'s Config> {
        let setting = match setting {
            Setting::Unset => &self.default,
            _ => setting,
        };
        match setting {
            Setting::Config(config) => Some(config),
            _ => None,
        }
    }

    fn validate<'a>(
        &self,
        cx: &Cx<'a, Self>,
        members: List<'a, Member<'a>>,
        setting: &Setting,
        supports_modifiers: bool,
    ) {
        let Some(config) = self.config(setting) else {
            return;
        };
        // Nothing is ever reported about a single member.
        if members.len() < 2 {
            return;
        }
        let members: SmallVec<[Member<'a>; 16]> = members.iter().collect();
        Validation {
            cx,
            config,
            supports_modifiers,
            members: &members,
        }
        .run();
    }
}

impl Rule for MemberOrdering {
    const META: Meta = Meta::typescript("member-ordering", Kind::Suggestion);
    const ON: On = On::new()
        .classes()
        .stmts(&[StmtTag::Interface])
        .types(&[TypeTag::Object]);
    no_state!();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        MemberOrdering {
            default: Setting::parse(options.get("default"), true),
            classes: Setting::parse(options.get("classes"), false),
            class_expressions: Setting::parse(options.get("classExpressions"), false),
            interfaces: Setting::parse(options.get("interfaces"), false),
            type_literals: Setting::parse(options.get("typeLiterals"), false),
        }
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        if self.config(&self.classes).is_none() && self.config(&self.class_expressions).is_none() {
            return;
        }
        let setting = match class.owner() {
            Node::Expr(_) => &self.class_expressions,
            _ => &self.classes,
        };
        self.validate(cx, class.members(), setting, true);
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if self.config(&self.interfaces).is_none() {
            return;
        }
        if let StmtKind::Interface(interface) = stmt.kind() {
            self.validate(cx, interface.members(), &self.interfaces, false);
        }
    }

    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        if self.config(&self.type_literals).is_none() {
            return;
        }
        if let TypeKind::Object(members) = ty.kind() {
            self.validate(cx, members, &self.type_literals, false);
        }
    }
}
