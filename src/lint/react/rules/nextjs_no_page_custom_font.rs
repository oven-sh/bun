use crate::jsx::{as_jsx_element, get_jsx_attribute_name, get_string_literal_prop_value};
use bun_lint_oxlint::text::file_name;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::FxHashSet;

/// Prevent page-only custom fonts.
pub struct NoPageCustomFont;

const NOT_ADDED_IN_DOCUMENT: Message = Message::new(
    "",
    "Custom fonts not added in `pages/_document.js` will only load for a single page. This is discouraged.",
);
const LINK_OUTSIDE_OF_HEAD: Message = Message::new(
    "",
    "Using `<link />` outside of `<Head>` will disable automatic font optimization. This is discouraged.",
);

#[derive(Default)]
pub struct State<'a> {
    /// The `name` of each `export default name;`.
    default_exports: Option<FxHashSet<Name<'a>>>,
    /// That something is in what is exported by default.
    in_export_default: AncestorMemo<'a, ()>,
}

impl Rule for NoPageCustomFont {
    const META: Meta = Meta::oxlint(Plugin::Nextjs, "no-page-custom-font", Kind::Problem);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoPageCustomFont
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        if !file.mentions("link") {
            return State::default();
        }
        on.exprs([ExprTag::Jsx], |_, e, cx| {
            let Some(jsx) = as_jsx_element(e).filter(|it| it.tag().is_some_and(|name| name.is_ident("link"))) else {
                return;
            };
            let is_custom_font = jsx.attrs().iter().any(|it| {
                get_jsx_attribute_name(it).is_some_and(|name| name == b"href")
                    && get_string_literal_prop_value(it).is_some_and(|href| href.starts_with(b"https://fonts.googleapis.com/css"))
            });
            if !is_custom_font {
                return;
            }
            if !file_name(cx.path()).starts_with(b"_document.") {
                cx.report(e, NOT_ADDED_IN_DOCUMENT);
            } else if !is_inside_export_default(e, &mut cx.state) {
                cx.report(e, LINK_OUTSIDE_OF_HEAD);
            }
        });
        State::default()
    }
}

/// The `a` of the `const a = ..` whose whole initializer `e` is.
fn name_of_declarator(e: Expr<'_>) -> Option<Name<'_>> {
    match e.parent() {
        Node::VarDecl(declarator) if !e.is_parenthesized() => declarator.pat().as_ident(),
        _ => None,
    }
}

/// The `name` of each `export default name;`.
fn default_exports<'a>(file: &'a File<'a>) -> FxHashSet<Name<'a>> {
    let exported = file.body().iter().filter_map(|stmt| match stmt.kind() {
        StmtKind::ExportDefault(id) if !id.is_parenthesized() => id.as_ident(),
        _ => None,
    });
    exported.collect()
}

fn is_inside_export_default<'a>(e: Expr<'a>, state: &mut State<'a>) -> bool {
    let default_exports = state.default_exports.get_or_insert_with(|| default_exports(e.file()));
    let is_default_export = |name: Name<'a>| default_exports.contains(&name);
    let is_export_default = |ancestor: Node<'a>| match ancestor {
        Node::Stmt(stmt) => stmt.tag() == StmtTag::ExportDefault || stmt.is_default_export(),
        Node::Func(func) => {
            let own = func.name().map(Ident::name);
            own.or_else(|| func.owner().as_expr().and_then(name_of_declarator)).is_some_and(is_default_export)
        }
        Node::Class(class) => {
            let own = class.name().map(Ident::name);
            own.or_else(|| class.owner().as_expr().and_then(name_of_declarator)).is_some_and(is_default_export)
        }
        _ => false,
    };
    state.in_export_default.find(Node::Expr(e), |_, parent| is_export_default(parent).then_some(())).is_some()
}
