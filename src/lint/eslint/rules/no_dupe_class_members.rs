use bun_lint::prelude::*;
use rustc_hash::{FxHashMap, FxHashSet};
use std::borrow::Cow;

/// Disallow duplicate class members.
pub struct NoDupeClassMembers;

const UNEXPECTED: Message = Message::new("unexpected", "Duplicate name '{{name}}'.");

const INIT: u8 = 1 << 0;
const GET: u8 = 1 << 1;
const SET: u8 = 1 << 2;
/// How far the three are shifted for a static member.
const STATIC: u8 = 3;

/// It is kept between classes only for its allocations.
#[derive(Default)]
pub struct Seen<'a> {
    /// The names of the members of one class so far, as their keys have them.
    names: FxHashSet<Name<'a>>,
    /// The names that the members of one class have defined so far, each with how, and with a configuration of oxlint
    /// with the last member that has the name.
    defined: FxHashMap<Cow<'a, [u8]>, (u8, Option<Member<'a>>)>,
}

/// The range of ESLint's `key`.
fn key_span(member: Member<'_>) -> Option<Span> {
    match member.constructor_keyword() {
        Some(keyword) => Some(keyword.span()),
        None => Some(member.key()?.inner_span(member.file())),
    }
}

/// oxlint compares a member with the last before it that has the name, whatever that one is. Two of a private name are
/// an error.
fn oxlint_redeclares(member: Member<'_>, before: Member<'_>) -> bool {
    let is_private = |it: Member<'_>| it.key().is_some_and(Key::is_private);
    let is_accessor = |it: Member<'_>| matches!(it.kind(), MemberKind::Getter | MemberKind::Setter);
    member.is_static() == before.is_static()
        && !is_private(member)
        && !is_private(before)
        && (member.kind() == before.kind() || !(is_accessor(member) && is_accessor(before)))
}

/// `ignores_computed`: whether a member with a name in brackets is left out.
pub fn check<'a, R: Rule>(
    class: Class<'a>,
    ignores_computed: bool,
    seen: &mut Seen<'a>,
    cx: &Cx<'a, R>,
) {
    let members = class.members();
    if members.len() < 2 {
        return;
    }
    // Few classes have two members with one name. Only `static constructor` and `[("a")]` have a name that is no `Name`.
    seen.names.clear();
    seen.names.reserve(members.len());
    let may_have_duplicates = members.iter().any(|member| match member.kind() {
        MemberKind::Constructor => member.is_static(),
        _ => {
            member.computed_key().is_some()
                || member.key().and_then(Key::name).is_some_and(|name| !seen.names.insert(name))
        }
    });
    if !may_have_duplicates {
        return;
    }
    let seen = &mut seen.defined;
    seen.clear();
    seen.reserve(members.len());
    let is_oxlint = cx.language().is_oxlint;
    for member in members {
        // Neither a `MethodDefinition` nor a `PropertyDefinition`, which oxlint does not ask, or an overload.
        if !is_oxlint && member.flags().intersects(Flags::ABSTRACT | Flags::ACCESSOR)
            || member.func().is_some_and(|func| !func.has_body())
        {
            continue;
        }
        let mut has_key = true;
        let name = match member.kind() {
            MemberKind::Constructor if member.is_static() => {
                has_key = member.constructor_keyword().is_some();
                Cow::Borrowed(&b"constructor"[..])
            }
            MemberKind::Method if member.is_constructor() => continue,
            MemberKind::Property | MemberKind::Method | MemberKind::Getter | MemberKind::Setter => {
                let Some(key) = member.key() else {
                    continue;
                };
                if ignores_computed && key.is_computed() {
                    continue;
                }
                let name = match is_oxlint {
                    true => utils::oxlint::property_key_name(key).map(Cow::Borrowed),
                    false => ast_utils::get_static_key_name(key),
                };
                let Some(name) = name else {
                    continue;
                };
                name
            }
            _ => continue,
        };
        let (own, conflicting) = match member.kind() {
            MemberKind::Getter => (GET, INIT | GET),
            MemberKind::Setter => (SET, INIT | SET),
            _ => (INIT, INIT | GET | SET),
        };
        let shift = if member.is_static() { STATIC } else { 0 };
        let (state, last) = seen.entry(name.clone()).or_insert((0, None));
        let is_defined = *state & (conflicting << shift) != 0;
        *state |= own << shift;
        if !has_key {
            continue;
        }
        let before = if is_oxlint { last.replace(member) } else { None };
        let is_duplicate = match is_oxlint {
            true => before.is_some_and(|before| oxlint_redeclares(member, before)),
            false => is_defined,
        };
        if is_duplicate && let Some(key) = key_span(member) {
            // oxlint points at the member before.
            let place = if is_oxlint { before.and_then(key_span).unwrap_or_default() } else { key };
            cx.report(place, UNEXPECTED)
                .hint("Only the last one counts.")
                .labels_with(|labels| {
                    labels.push(key, format!("\"{}\" is re-declared here", bstr::BStr::new(&name[..])));
                })
                .data("name", name);
        }
    }
}

impl Rule for NoDupeClassMembers {
    const META: Meta = Meta::eslint("no-dupe-class-members", Kind::Problem).recommended().hints();
    const ON: On = On::new().classes();
    type State<'a> = Seen<'a>;

    fn new(_: &Options) -> Self {
        NoDupeClassMembers
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Seen<'a>> {
        Some(Seen::default())
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        let mut seen = std::mem::take(&mut cx.state);
        check(class, false, &mut seen, cx);
        cx.state = seen;
    }
}
