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

/// The names that the members of one class have defined so far, each with how, and with a configuration of oxlint with
/// the key of the last member that has the name. It is kept between classes only for its allocation.
pub type Seen<'a> = Vec<(Cow<'a, [u8]>, u8, Span)>;

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
    let is_oxlint = cx.language().is_oxlint;
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
            MemberKind::Method if member.is_constructor() => continue,
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
                seen.push((name, 0, Span::empty(0)));
                seen.len() - 1
            }
        };
        let Some((name, state, last_key)) = seen.get_mut(index) else {
            continue;
        };
        let is_duplicate = *state & (conflicting << shift) != 0;
        *state |= own << shift;
        if (is_duplicate || is_oxlint)
            && let Some(key) = key_span(member)
        {
            // oxlint points at the member before.
            let before = std::mem::replace(last_key, key);
            if is_duplicate {
                cx.report(if is_oxlint { before } else { key }, UNEXPECTED)
                    .labels_with(|labels| {
                        labels.push(key, format!("\"{}\" is re-declared here", bstr::BStr::new(&name[..])));
                    })
                    .data("name", name.clone());
            }
        }
    }
}

impl Rule for NoDupeClassMembers {
    const META: Meta = Meta::eslint("no-dupe-class-members", Kind::Problem).recommended();
    const ON: On = On::new().classes();
    type State<'a> = Seen<'a>;

    fn new(_: &Options) -> Self {
        NoDupeClassMembers
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Seen<'a>> {
        Some(Vec::new())
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        let mut seen = std::mem::take(&mut cx.state);
        check(class, false, &mut seen, cx);
        cx.state = seen;
    }
}
