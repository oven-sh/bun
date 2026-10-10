use crate::util_eslint::mark_variable_as_used;
use crate::util_pragma::{get_fragment_from_context, get_from_context};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow React to be incorrectly marked as unused
pub struct JsxUsesReact;

/// Each only if the file has the name in it.
pub struct Pragmas<'a> {
    pragma: Option<Name<'a>>,
    fragment: Option<Name<'a>>,
}

impl Rule for JsxUsesReact {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-uses-react", Kind::Problem).recommended();
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = Pragmas<'a>;

    fn new(_: &Options) -> Self {
        JsxUsesReact
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Pragmas<'a>> {
        let mentioned = |name: &[u8]| {
            let name = std::str::from_utf8(name).ok()?;
            file.mentions(name).then(|| file.name_of(name))
        };
        let pragma = mentioned(get_from_context(file));
        let fragment = mentioned(get_fragment_from_context(file));
        (pragma.is_some() || fragment.is_some()).then_some(Pragmas { pragma, fragment })
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        if let Some(pragma) = cx.state.pragma {
            mark_variable_as_used(pragma, Node::Expr(e));
        }
        if jsx.is_fragment()
            && let Some(fragment) = cx.state.fragment
        {
            mark_variable_as_used(fragment, Node::Expr(e));
        }
    }
}
