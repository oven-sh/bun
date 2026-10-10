use crate::jsx::{get_jsx_element_name, is_jsx_fragment};
use crate::react::is_jsx;
use crate::util_pragma::{get_fragment_from_context, get_from_context};
use crate::util_variable::{Found, find_variable_by_name};
use crate::util_version::get_react_version_from_context;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;

/// Enforce shorthand or standard form for React fragments
pub struct JsxFragments {
    /// `"element"`, not `"syntax"`
    prefers_element: bool,
}

const FRAGMENTS_NOT_SUPPORTED: Message = Message::new(
    "fragmentsNotSupported",
    "Fragments are only supported starting from React v16.2. Please disable the `react/jsx-fragments` rule in `eslint` settings or upgrade your version of React.",
);
const PREFER_PRAGMA: Message = Message::new("preferPragma", "Prefer {{react}}.{{fragment}} over fragment shorthand");
const PREFER_FRAGMENT: Message =
    Message::new("preferFragment", "Prefer fragment shorthand over {{react}}.{{fragment}}");
const OXLINT_PREFER_ELEMENT: Message = Message::new("", "Standard form for React fragments is preferred.");
const OXLINT_PREFER_SYNTAX: Message = Message::new("", "Shorthand form for React fragments is preferred.");

pub struct Names<'a> {
    react_pragma: &'a [u8],
    fragment_pragma: &'a [u8],
    /// `fragmentNames`, but for the first.
    fragment_names: SmallVec<[Name<'a>; 2]>,
    /// `testReactVersion(context, ">= 16.2.0")`
    has_fragments: bool,
    /// The file has a name that `refersToReactFragment` looks for.
    can_refer_to_react: bool,
}

impl<'a> Names<'a> {
    /// `fragmentNames.has(elName) || refersToReactFragment(node, elName)`
    fn has(&self, node: Expr<'a>, jsx: Jsx<'a>) -> bool {
        match jsx.tag().map(Expr::kind) {
            Some(ExprKind::Ident(el_name)) => {
                self.fragment_names.contains(&el_name)
                    || (self.can_refer_to_react && self.refers_to_react_fragment(node, el_name))
            }
            Some(ExprKind::Dot { .. }) => {
                let el_name = get_jsx_element_name(jsx);
                let property = el_name.strip_prefix(self.react_pragma).and_then(|it| it.strip_prefix(b"."));
                property.is_some_and(|it| it == self.fragment_pragma)
            }
            _ => false,
        }
    }

    /// `refersToReactFragment`
    fn refers_to_react_fragment(&self, node: Expr<'a>, name: Name<'a>) -> bool {
        let Some(Found::Init(variable_init)) = find_variable_by_name(Node::Expr(node), name) else {
            return false;
        };
        let is_react = |it: Expr| it.as_ident().is_some_and(|it| it == self.react_pragma);
        match variable_init.kind() {
            // `const { Fragment } = React;`
            ExprKind::Ident(_) => is_react(variable_init),
            _ if variable_init.is_chain_root() => false,
            // `const Fragment = React.Fragment;`
            ExprKind::Dot { obj, name: property, .. } => is_react(obj) && property.bytes() == self.fragment_pragma,
            ExprKind::Index { obj, index, .. } => {
                is_react(obj) && index.as_ident().is_some_and(|it| it == self.fragment_pragma)
            }
            // `const { Fragment } = require('react');`
            ExprKind::Call(call) | ExprKind::New(call) => {
                call.callee().is_ident("require")
                    && call.args().first().and_then(Expr::as_string).is_some_and(|it| it.is("react"))
            }
            _ => false,
        }
    }
}

impl Rule for JsxFragments {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-fragments", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = Names<'a>;

    /// `"element"`, or for oxlint `{ mode: "element" }`
    fn new(options: &Options) -> Self {
        JsxFragments { prefers_element: options.str(0).or_else(|| options.object(0).str("mode")) == Some("element") }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Names<'a>> {
        // oxlint reads no settings and no comment, and asks for no version.
        if file.language().is_oxlint {
            return is_jsx(file).then(|| Names {
                react_pragma: b"React",
                fragment_pragma: b"Fragment",
                fragment_names: SmallVec::new(),
                has_fragments: true,
                can_refer_to_react: false,
            });
        }
        let (react_pragma, fragment_pragma) = (get_from_context(file), get_fragment_from_context(file));
        let mut fragment_names = SmallVec::new();
        for statement in file.stmts_of_kind(StmtTag::Import) {
            if let StmtKind::Import(import) = statement.kind()
                && import.spec().is("react")
            {
                let is_fragment = |it: Ident| !it.is_string() && it.bytes() == fragment_pragma;
                let specifiers = import.named().iter().filter(|it| is_fragment(it.imported()));
                fragment_names.extend(specifiers.map(|it| it.local().name()));
            }
        }
        Some(Names {
            react_pragma,
            fragment_pragma,
            fragment_names,
            has_fragments: get_react_version_from_context(file) >= (16, 2, 0),
            can_refer_to_react: file.mentions("require")
                || std::str::from_utf8(react_pragma).is_ok_and(|it| file.mentions(it)),
        })
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let (is_oxlint, names, name) = (cx.language().is_oxlint, &cx.state, jsx.tag());
        let is_other_form =
            if name.is_none() { self.prefers_element } else { !self.prefers_element && jsx.attrs().is_empty() };
        if names.has_fragments && !is_other_form {
            return;
        }
        let (opening, closing) = (jsx.opening_span(), jsx.closing_span());
        // oxlint takes every `Fragment` for React's, and passes over `<Fragment />`.
        if name.is_some() && !(if is_oxlint { is_jsx_fragment(jsx) && closing.is_some() } else { names.has(e, jsx) }) {
            return;
        }
        let (react, fragment) = (names.react_pragma, names.fragment_pragma);
        let report = match name {
            // `reportOnReactVersion`
            _ if !names.has_fragments => cx.report(e, FRAGMENTS_NOT_SUPPORTED),
            None => {
                // oxlint points at the `<>`.
                let (at, message) =
                    if is_oxlint { (opening, OXLINT_PREFER_ELEMENT) } else { (e.span(), PREFER_PRAGMA) };
                cx.report(at, message).data("react", react).data("fragment", fragment).fix(|fixer| {
                    let open_frag_long = [&b"<"[..], react, b".", fragment, b">"].concat();
                    let close_frag_long = [&b"</"[..], react, b".", fragment, b">"].concat();
                    Some([fixer.replace(opening, open_frag_long), fixer.replace(closing?, close_frag_long)])
                })
            }
            Some(name) => {
                // oxlint points at the name.
                let (at, message) =
                    if is_oxlint { (name.span(), OXLINT_PREFER_SYNTAX) } else { (e.span(), PREFER_FRAGMENT) };
                cx.report(at, message).data("react", react).data("fragment", fragment).fix(|fixer| match closing {
                    Some(closing) => vec![fixer.replace(opening, "<>"), fixer.replace(closing, "</>")],
                    None => vec![fixer.replace(opening, "<></>")],
                })
            }
        };
        // Upstream looks at the elements when the program ends.
        if name.is_some() && !is_oxlint {
            report.at_the_end();
        }
    }
}
