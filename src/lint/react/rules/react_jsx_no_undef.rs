use bun_lint_oxlint::ast_util::is_enabled_global;
use crate::react::is_jsx;
use crate::util_steps::Way;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow undeclared variables in JSX
pub struct JsxNoUndef {
    allow_globals: bool,
}

const UNDEFINED: Message = Message::new("undefined", "'{{identifier}}' is not defined.");
const JSX_NO_UNDEF: Message = Message::new("", "'{{ident_name}}' is not defined.");

impl Rule for JsxNoUndef {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-no-undef", Kind::None).recommended();
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        JsxNoUndef { allow_globals: options.object(0).bool_or("allowGlobals", false) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (!file.language().is_oxlint || is_jsx(file)).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        let Some(ident) = jsx.tag().and_then(|name| get_resolvable_ident(name, is_oxlint)) else {
            return;
        };
        let (ExprKind::Ident(name) | ExprKind::String(name)) = ident.kind() else {
            return;
        };
        // oxlint asks what the name refers to, and knows no option.
        if is_oxlint {
            if ident.symbol().is_none() && !is_enabled_global(cx.file(), name.bytes()) {
                cx.report(ident, JSX_NO_UNDEF).data("ident_name", name);
            }
        } else if !self.is_name_of_variable(ident, name) {
            cx.report(ident, UNDEFINED).data("identifier", name);
        }
    }
}

impl JsxNoUndef {
    /// The search in `checkIdentifierInJSX`: by the name alone, up to the module or the global scope, and then in the
    /// first scope in that one and in the first scope in that.
    fn is_name_of_variable<'a>(&self, node: Expr<'a>, name: Name<'a>) -> bool {
        let is_in = |scope: Scope<'a>| scope.get_name(name).is_some();
        let (mut scope, way) = (Node::Expr(node).scope(), Way::new(node.file()));
        loop {
            // Without steps nothing is said.
            if is_in(scope) || !way.take(1) {
                return true;
            }
            let is_upper_bound = !self.allow_globals && scope.kind() == ScopeKind::Module;
            match scope.parent() {
                Some(upper) if !is_upper_bound => scope = upper,
                _ => break,
            }
        }
        if scope.parent().is_none() && node.file().global_named(name).is_some() {
            return true;
        }
        scope.children().next().is_some_and(|child| is_in(child) || child.children().next().is_some_and(is_in))
    }
}

/// The variable that the name of an element refers to: the `A` of `<A>` and the `a` of `<a.b.c>`. `<a>` is the name of
/// an element of HTML.
fn get_resolvable_ident(name: Expr<'_>, is_oxlint: bool) -> Option<Expr<'_>> {
    let is_dom_component = |ident: Name| ident.bytes().first().is_some_and(u8::is_ascii_lowercase);
    match name.kind() {
        ExprKind::Ident(ident) => (!is_dom_component(ident)).then_some(name),
        // For oxlint `<A-b>` names no variable.
        ExprKind::String(ident) if !is_oxlint => {
            (!is_dom_component(ident) && !strings::contains_char(ident.bytes(), b':')).then_some(name)
        }
        ExprKind::Dot { .. } => {
            let mut at = name;
            while let Some(object) = at.object() {
                at = object;
            }
            (at.tag() == ExprTag::Ident).then_some(at)
        }
        _ => None,
    }
}
