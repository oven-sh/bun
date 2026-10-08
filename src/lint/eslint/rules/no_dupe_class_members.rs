use bun_lint::prelude::*;
use rustc_hash::FxHashMap;
use std::borrow::Cow;

/// Disallow duplicate class members.
pub struct NoDupeClassMembers;

const UNEXPECTED: Message = Message::new("unexpected", "Duplicate name '{{name}}'.");

const INIT: u8 = 1 << 0;
const GET: u8 = 1 << 1;
const SET: u8 = 1 << 2;
/// How far the three are shifted for a static member.
const STATIC: u8 = 3;

/// The names that the members of one class have defined so far, each with how. It is kept between
/// classes only for its allocation.
pub type Seen<'a> = Vec<(Cow<'a, [u8]>, u8)>;

/// With more names than this, they are looked up in a map.
const SEARCHED: usize = 16;

/// The range of ESLint's `key`.
fn key_span(member: Member<'_>) -> Option<Span> {
    match member.constructor_keyword() {
        Some(keyword) => Some(keyword.span()),
        None => Some(member.key()?.inner_span(member.file())),
    }
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
    seen.clear();
    // Where each name is in `seen`.
    let mut index_of: FxHashMap<Cow<'a, [u8]>, usize> = FxHashMap::default();
    for member in members {
        // Neither a `MethodDefinition` nor a `PropertyDefinition`, or an overload.
        if member.flags().intersects(Flags::ABSTRACT | Flags::ACCESSOR)
            || member.func().is_some_and(|func| !func.has_body())
        {
            continue;
        }
        let name = match member.kind() {
            MemberKind::Constructor if member.is_static() => Cow::Borrowed(&b"constructor"[..]),
            MemberKind::Property | MemberKind::Method | MemberKind::Getter | MemberKind::Setter => {
                let Some(key) = member.key() else {
                    continue;
                };
                if ignores_computed && key.is_computed() {
                    continue;
                }
                let Some(name) = ast_utils::get_static_key_name(key) else {
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
        let found = match seen.len() > SEARCHED {
            false => seen.iter().position(|it| *it.0 == *name),
            true => {
                if index_of.is_empty() {
                    index_of.extend(seen.iter().enumerate().map(|(index, it)| (it.0.clone(), index)));
                }
                index_of.get(&name).copied()
            }
        };
        let index = match found {
            Some(index) => index,
            None => {
                if !index_of.is_empty() {
                    index_of.insert(name.clone(), seen.len());
                }
                seen.push((name, 0));
                seen.len() - 1
            }
        };
        let Some((name, state)) = seen.get_mut(index) else {
            continue;
        };
        let is_duplicate = *state & (conflicting << shift) != 0;
        *state |= own << shift;
        if is_duplicate && let Some(key) = key_span(member) {
            cx.report(key, UNEXPECTED).data("name", name.clone());
        }
    }
}

impl Rule for NoDupeClassMembers {
    const META: Meta = Meta::eslint("no-dupe-class-members", Kind::Problem).recommended();
    type State<'a> = Seen<'a>;

    fn new(_: &Options) -> Self {
        NoDupeClassMembers
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Seen<'a> {
        on.classes(|_, class, cx| {
            let mut seen = std::mem::take(&mut cx.state);
            check(class, false, &mut seen, cx);
            cx.state = seen;
        });
        Vec::new()
    }
}
