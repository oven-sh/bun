use bun_lint::prelude::*;
use bun_lint::utils::ast_utils::get_static_key_name;
use bun_lint::utils::is_assignment_target;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;
use std::borrow::Cow;

/// Disallow duplicate keys in object literals.
pub struct NoDupeKeys;

const UNEXPECTED: Message = Message::new("unexpected", "Duplicate key '{{name}}'.");

const GET: u8 = 1 << 0;
const SET: u8 = 1 << 1;

/// Whether two of `props` may have the same name. Names that are known without looking at an expression compare as numbers.
fn may_have_same_name<'a>(props: List<'a, Prop<'a>>) -> bool {
    let mut names: SmallVec<[Name<'a>; 16]> = SmallVec::new();
    for prop in props {
        match prop.key().map(Key::kind) {
            Some(KeyKind::Computed(_)) => return true,
            Some(KeyKind::Private(_)) | None => {}
            Some(_) if names.len() == names.inline_size() => return true,
            Some(
                KeyKind::Ident(name)
                | KeyKind::String(name)
                | KeyKind::Number(name)
                | KeyKind::ComputedString(name)
                | KeyKind::ComputedNumber(name),
            ) => {
                if names.contains(&name) {
                    return true;
                }
                names.push(name);
            }
        }
    }
    false
}

impl NoDupeKeys {
    fn check<'a>(&self, object: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Object(props) = object.kind() else {
            return;
        };
        if props.len() < 2 || !may_have_same_name(props) {
            return;
        }
        cx.state.clear();
        let mut is_pattern = None;
        for prop in props {
            let defines = match prop.kind() {
                PropKind::Spread => continue,
                PropKind::Getter => GET,
                PropKind::Setter => SET,
                PropKind::Init | PropKind::Shorthand | PropKind::Method => GET | SET,
            };
            let Some(key) = prop.key() else {
                continue;
            };
            let Some(name) = get_static_key_name(key) else {
                continue;
            };
            // `__proto__: value` sets the prototype, and defines no property.
            if prop.kind() == PropKind::Init && !key.is_computed() && &*name == b"__proto__" {
                continue;
            }
            let (here, is_oxlint) = (key.inner_span(cx.file()), cx.language().is_oxlint);
            let (defined, previous) = cx.state.entry(name).or_insert((0, here));
            let is_duplicate = *defined & defines != 0;
            *defined |= defines;
            // oxlint points at the key before this one.
            let place = if is_oxlint { std::mem::replace(previous, here) } else { here };
            if !is_duplicate {
                continue;
            }
            if *is_pattern.get_or_insert_with(|| is_assignment_target(object)) {
                return;
            }
            cx.report(place, UNEXPECTED)
                .data("name", get_static_key_name(key).unwrap_or_default())
                .labels_with(|labels| labels.push(here, "and duplicated here"));
        }
    }
}

impl Rule for NoDupeKeys {
    const META: Meta = Meta::eslint("no-dupe-keys", Kind::Problem).recommended();
    const ON: On = On::new().exprs(&[ExprTag::Object]);
    /// What the properties so far of the object that is being checked define, and the last key of that name.
    type State<'a> = FxHashMap<Cow<'a, [u8]>, (u8, Span)>;

    fn new(_: &Options) -> Self {
        NoDupeKeys
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(FxHashMap::default())
    }

    fn expr<'a>(&self, object: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.check(object, cx);
    }
}
