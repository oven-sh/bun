use crate::react::is_jsx;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

/// This rule prevents duplicate props in JSX elements.
pub struct JsxNoDuplicateProps;

const JSX_NO_DUPLICATE_PROPS: Message =
    Message::new("", "No duplicate props allowed. The prop \"{{prop_name}}\" is duplicated.");

/// With more attributes than this, the names are looked up in a table.
const FEW: usize = 8;

impl Rule for JsxNoDuplicateProps {
    const META: Meta = Meta::oxlint(Plugin::React, "jsx-no-duplicate-props", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        JsxNoDuplicateProps
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        is_jsx(file).then_some(())
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
        // Each is reported with the one of the same name before it.
        let report = |name: Name<'a>, old: Key<'a>, new: Key<'a>| {
            let (old, new) = (old.span(cx.file()), new.span(cx.file()));
            cx.report(old, JSX_NO_DUPLICATE_PROPS).data("prop_name", name).label(new, "");
        };
        if count <= FEW {
            let names: SmallVec<[(Name<'a>, Key<'a>); FEW]> = attributes.iter().filter_map(identifier).collect();
            for (i, (name, key)) in names.iter().enumerate() {
                if let Some((_, old)) = names.iter().take(i).rev().find(|it| it.0 == *name) {
                    report(*name, *old, *key);
                }
            }
            return;
        }
        let mut props: FxHashMap<Name<'a>, Key<'a>> = FxHashMap::default();
        for (name, key) in attributes.iter().filter_map(identifier) {
            if let Some(old) = props.insert(name, key) {
                report(name, old, key);
            }
        }
    }
}

/// The name of an attribute, unless it has a namespace.
fn identifier(attribute: Prop<'_>) -> Option<(Name<'_>, Key<'_>)> {
    let key = attribute.key()?;
    let name = key.name()?;
    (!strings::contains_char(name.bytes(), b':')).then_some((name, key))
}
