use crate::react::is_jsx;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::borrow::Cow;

/// Disallow duplicate properties in JSX
pub struct JsxNoDuplicateProps {
    ignore_case: bool,
}

const NO_DUPLICATE_PROPS: Message = Message::new("noDuplicateProps", "No duplicate props allowed");
const JSX_NO_DUPLICATE_PROPS: Message =
    Message::new("", "No duplicate props allowed. The prop \"{{prop_name}}\" is duplicated.");

/// With more attributes than this, the names are looked up in a table.
const FEW: usize = 8;

#[derive(Copy, Clone)]
struct Attribute<'a> {
    name: Name<'a>,
    key: Key<'a>,
    prop: Prop<'a>,
}

impl Rule for JsxNoDuplicateProps {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-no-duplicate-props", Kind::None).recommended();
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        JsxNoDuplicateProps { ignore_case: options.object(0).bool_or("ignoreCase", false) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (!file.language().is_oxlint || is_jsx(file)).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let attributes = jsx.attrs();
        let count = attributes.len();
        if count < 2 {
            return;
        }
        let is_oxlint = cx.language().is_oxlint;
        // oxlint has no such option.
        if self.ignore_case && !is_oxlint {
            let mut props: FxHashSet<Cow<'a, [u8]>> = FxHashSet::default();
            for attribute in attributes.iter().filter_map(identifier) {
                let name = text::to_lower_case(attribute.name.bytes());
                if is_own_property(&name) && !props.insert(name) {
                    cx.report(attribute.prop, NO_DUPLICATE_PROPS).listened_on(jsx.opening_span());
                }
            }
            return;
        }
        let report = |old: Attribute<'a>, new: Attribute<'a>| {
            // oxlint points at the name of the one of the same name before it.
            if is_oxlint {
                let (first, second) = (old.key.span(cx.file()), new.key.span(cx.file()));
                cx.report(first, JSX_NO_DUPLICATE_PROPS).data("prop_name", new.name).label(second, "");
            } else if is_own_property(new.name.bytes()) {
                cx.report(new.prop, NO_DUPLICATE_PROPS).listened_on(jsx.opening_span());
            }
        };
        if count <= FEW {
            let names: SmallVec<[Attribute<'a>; FEW]> = attributes.iter().filter_map(identifier).collect();
            for (i, new) in names.iter().enumerate() {
                if let Some(old) = names.iter().take(i).rev().find(|it| it.name == new.name) {
                    report(*old, *new);
                }
            }
            return;
        }
        let mut props: FxHashMap<Name<'a>, Attribute<'a>> = FxHashMap::default();
        for new in attributes.iter().filter_map(identifier) {
            if let Some(old) = props.insert(new.name, new) {
                report(old, new);
            }
        }
    }
}

/// The name of an attribute, unless it has a namespace.
fn identifier(prop: Prop<'_>) -> Option<Attribute<'_>> {
    let key = prop.key()?;
    let name = key.name()?;
    (!strings::contains_char(name.bytes(), b':')).then_some(Attribute { name, key, prop })
}

/// Upstream keeps the names as the properties of an object, where an assignment to `__proto__` makes none.
fn is_own_property(name: &[u8]) -> bool {
    name != b"__proto__"
}
