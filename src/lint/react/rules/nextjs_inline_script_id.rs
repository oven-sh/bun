use crate::nextjs::elements_named;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces that all `next/script` components with inline content or `dangerouslySetInnerHTML` must have an `id` prop.
pub struct InlineScriptId;

const INLINE_SCRIPT_ID: Message =
    Message::new("", "`next/script` components with inline content must specify an `id` attribute.");

impl Rule for InlineScriptId {
    const META: Meta = Meta::oxlint(Plugin::Nextjs, "inline-script-id", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        InlineScriptId
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("next/script") || !file.has_exprs([ExprTag::Jsx]) {
            return;
        }
        on.stmts([StmtTag::Import], |_, stmt, cx| {
            let StmtKind::Import(import) = stmt.kind() else {
                return;
            };
            let Some(local) = import.default().filter(|_| import.spec().is("next/script")) else {
                return;
            };
            for (name, jsx) in elements_named(import, local) {
                if let Some(props) = prop_names(jsx)
                    && !props.has_id
                    && (props.has_dangerously_set_inner_html || jsx.children_with_whitespace().next().is_some())
                {
                    cx.report(name, INLINE_SCRIPT_ID);
                }
            }
        });
    }
}

#[derive(Default)]
struct PropNames {
    has_id: bool,
    has_dangerously_set_inner_html: bool,
}

impl PropNames {
    fn insert(&mut self, key: Option<Key>) {
        if let Some(KeyKind::Ident(name)) = key.map(Key::kind) {
            self.has_id |= name.is("id");
            self.has_dangerously_set_inner_html |= name.is("dangerouslySetInnerHTML");
        }
    }
}

/// `None` if something other than an object literal is spread.
fn prop_names(jsx: Jsx) -> Option<PropNames> {
    let mut names = PropNames::default();
    for attribute in jsx.attrs() {
        if attribute.kind() != PropKind::Spread {
            names.insert(attribute.key());
            continue;
        }
        let ExprKind::Object(properties) = attribute.value()?.kind() else {
            return None;
        };
        properties.iter().for_each(|it| names.insert(it.key()));
    }
    Some(names)
}
