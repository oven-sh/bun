use crate::util_ast::{get_component_properties, get_property_name_node, name_of_key};
use crate::util_component_util::{Pragmas, is_es5_component, is_es6_component};
use crate::util_prop_types::is_in_object_prototype;
use crate::util_version::{Version, get_react_version_from_context};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::source::mention_bit;

/// Disallow usage of deprecated methods.
pub struct NoDeprecated;

const DEPRECATED: Message =
    Message::new("deprecated", "{{oldMethod}} is deprecated since React {{version}}{{newMethod}}{{refs}}");

/// An entry of what `getDeprecated(pragma)` returns.
struct Deprecated {
    /// What is before the first `.` of the key. `None`: the pragma. Empty: the key has no `.`.
    object: Option<&'static str>,
    /// What is after it.
    property: &'static str,
    version: Version,
    /// Empty: there is none. With a `.` at its start it follows the pragma.
    new_method: &'static str,
    /// Empty: there are none. Those of a key without a `.` go on with [`CODEMOD`].
    refs: &'static str,
    /// [`mention_bit`] of the last name of the key.
    bit: u32,
}

const CODEMOD: &str =
    "Use https://github.com/reactjs/react-codemod#rename-unsafe-lifecycles to automatically update your components.";
const CREATE_ROOT: &str = "https://reactjs.org/link/switch-to-createroot";

/// In upstream's order: of two entries with one key the later one counts.
static ALL_DEPRECATED: [Deprecated; 31] = [
    Deprecated::of_pragma("renderComponent", (0, 12, 0), ".render"),
    Deprecated::of_pragma("renderComponentToString", (0, 12, 0), ".renderToString"),
    Deprecated::of_pragma("renderComponentToStaticMarkup", (0, 12, 0), ".renderToStaticMarkup"),
    Deprecated::of_pragma("isValidComponent", (0, 12, 0), ".isValidElement"),
    Deprecated::of_pragma("PropTypes.component", (0, 12, 0), ".PropTypes.element"),
    Deprecated::of_pragma("PropTypes.renderable", (0, 12, 0), ".PropTypes.node"),
    Deprecated::of_pragma("isValidClass", (0, 12, 0), ""),
    Deprecated::new("this", "transferPropsTo", (0, 12, 0), "spread operator ({...})", ""),
    Deprecated::of_pragma("addons.classSet", (0, 13, 0), "the npm module classnames"),
    Deprecated::of_pragma("addons.cloneWithProps", (0, 13, 0), ".cloneElement"),
    Deprecated::of_pragma("render", (0, 14, 0), "ReactDOM.render"),
    Deprecated::of_pragma("unmountComponentAtNode", (0, 14, 0), "ReactDOM.unmountComponentAtNode"),
    Deprecated::of_pragma("findDOMNode", (0, 14, 0), "ReactDOM.findDOMNode"),
    Deprecated::of_pragma("renderToString", (0, 14, 0), "ReactDOMServer.renderToString"),
    Deprecated::of_pragma("renderToStaticMarkup", (0, 14, 0), "ReactDOMServer.renderToStaticMarkup"),
    Deprecated::of_pragma("addons.LinkedStateMixin", (15, 0, 0), ""),
    Deprecated::new("ReactPerf", "printDOM", (15, 0, 0), "ReactPerf.printOperations", ""),
    Deprecated::new("Perf", "printDOM", (15, 0, 0), "Perf.printOperations", ""),
    Deprecated::new("ReactPerf", "getMeasurementsSummaryMap", (15, 0, 0), "ReactPerf.getWasted", ""),
    Deprecated::new("Perf", "getMeasurementsSummaryMap", (15, 0, 0), "Perf.getWasted", ""),
    Deprecated::of_pragma("createClass", (15, 5, 0), "the npm module create-react-class"),
    Deprecated::of_pragma("addons.TestUtils", (15, 5, 0), "ReactDOM.TestUtils"),
    Deprecated::of_pragma("PropTypes", (15, 5, 0), "the npm module prop-types"),
    Deprecated::of_pragma("DOM", (15, 6, 0), "the npm module react-dom-factories"),
    Deprecated::new(
        "",
        "componentWillMount",
        (16, 9, 0),
        "UNSAFE_componentWillMount",
        "https://reactjs.org/docs/react-component.html#unsafe_componentwillmount. ",
    ),
    Deprecated::new(
        "",
        "componentWillReceiveProps",
        (16, 9, 0),
        "UNSAFE_componentWillReceiveProps",
        "https://reactjs.org/docs/react-component.html#unsafe_componentwillreceiveprops. ",
    ),
    Deprecated::new(
        "",
        "componentWillUpdate",
        (16, 9, 0),
        "UNSAFE_componentWillUpdate",
        "https://reactjs.org/docs/react-component.html#unsafe_componentwillupdate. ",
    ),
    Deprecated::new("ReactDOM", "render", (18, 0, 0), "createRoot", CREATE_ROOT),
    Deprecated::new("ReactDOM", "hydrate", (18, 0, 0), "hydrateRoot", CREATE_ROOT),
    Deprecated::new("ReactDOM", "unmountComponentAtNode", (18, 0, 0), "root.unmount", CREATE_ROOT),
    Deprecated::new(
        "ReactDOMServer",
        "renderToNodeStream",
        (18, 0, 0),
        "renderToPipeableStream",
        "https://reactjs.org/docs/react-dom-server.html#rendertonodestream",
    ),
];

/// The names of methods in the table. The `name` of a `PrivateIdentifier` is without the `#`.
const LIFE_CYCLE_METHODS: [u32; 6] = [
    mention_bit(b"componentWillMount"),
    mention_bit(b"componentWillReceiveProps"),
    mention_bit(b"componentWillUpdate"),
    mention_bit(b"#componentWillMount"),
    mention_bit(b"#componentWillReceiveProps"),
    mention_bit(b"#componentWillUpdate"),
];

/// What a file with something else that is deprecated mentions, if not the pragma: an object, a module, `require`.
const ABOUT_REACT: [u32; 10] = [
    mention_bit(b"ReactPerf"),
    mention_bit(b"Perf"),
    mention_bit(b"ReactDOM"),
    mention_bit(b"ReactDOMServer"),
    mention_bit(b"transferPropsTo"),
    mention_bit(b"react"),
    mention_bit(b"react-addons-perf"),
    mention_bit(b"react-dom"),
    mention_bit(b"react-dom/server"),
    mention_bit(b"require"),
];

/// The values of `MODULES`.
const MODULE_NAMES: [&str; 5] = ["React", "ReactPerf", "Perf", "ReactDOM", "ReactDOMServer"];

pub struct State<'a> {
    pragmas: Pragmas<'a>,
    /// What the text of a deprecated `MemberExpression` starts with, if that is no `this`.
    objects: [Name<'a>; 5],
    /// The version of React, once it has been asked for.
    version: Option<Version>,
}

impl Rule for NoDeprecated {
    const META: Meta = Meta::plugin(Plugin::React, "no-deprecated", Kind::Suggestion).recommended();
    const ON: On = On::new()
        .exprs(&[ExprTag::Dot, ExprTag::Object])
        .stmts(&[StmtTag::Interface])
        .classes()
        .var_decls()
        .import_specs();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoDeprecated
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new().exprs(&[ExprTag::Dot]).var_decls().import_specs();
        if mentions_life_cycle_methods(file) {
            on = on.exprs(&[ExprTag::Object]).classes();
        }
        if !file.is_javascript() {
            on = on.stmts(&[StmtTag::Interface]).classes();
        }
        on
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        let has_methods = mentions_life_cycle_methods(file);
        if !has_methods && !ALL_DEPRECATED.iter().any(|it| file.mentions_bit(it.bit)) {
            return None;
        }
        let pragmas = Pragmas::new(file);
        // What is imported from a module that is called as something of `Object.prototype` is a member of `undefined`.
        if !has_methods
            && !ABOUT_REACT.iter().any(|&bit| file.mentions_bit(bit))
            && !file.mentions_bit(mention_bit(pragmas.pragma))
            && pragmas.pragma != b"undefined"
        {
            return None;
        }
        let mut objects = MODULE_NAMES.map(|it| file.name_of(it));
        objects[0] = file.name_of(std::str::from_utf8(pragmas.pragma).unwrap_or_default());
        Some(State { pragmas, objects, version: None })
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(object) = e.object() else {
            // `isES5Component` is for what is in a call.
            if matches!(e.parent(), Node::Expr(parent) if parent.callee().is_some()) {
                self.check_life_cycle_methods(Node::Expr(e), cx);
            }
            return;
        };
        // The keys have three names at most.
        let first = object.object().filter(|_| object.tag() == ExprTag::Dot).unwrap_or(object);
        let can_be_deprecated = match first.as_ident() {
            Some(name) => cx.state.objects.contains(&name),
            None => {
                first.tag() == ExprTag::This
                    && (e.member_name().is_some_and(|it| it.name().is("transferPropsTo"))
                        || cx.state.pragmas.pragma == b"this")
            }
        };
        if can_be_deprecated && ast_utils::is_member_expression(e) {
            self.check_member_expression(e.span(), cx);
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::Interface(interface) = statement.kind() {
            for ty in interface.extends() {
                self.check_heritage(ty, cx);
            }
        }
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        for ty in class.implements() {
            self.check_heritage(ty, cx);
        }
        if mentions_life_cycle_methods(cx.file()) {
            self.check_life_cycle_methods(Node::Class(class), cx);
        }
    }

    fn var_decl<'a>(&self, node: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        let PatKind::Object(properties) = node.pat().kind() else {
            return;
        };
        let Some(module) = node.init().and_then(|init| module_required_by(init, cx.state.pragmas.pragma)) else {
            return;
        };
        for property in properties {
            if let Some(name) = property.key().and_then(name_of_key) {
                self.check_deprecation(property.span(), module, name, cx);
            }
        }
    }

    fn import_spec<'a>(&self, specifier: ImportSpec<'a>, cx: &mut Cx<'a, Self>) {
        let (source, imported) = (specifier.import().spec().bytes(), specifier.imported());
        // `MODULES[source]` also finds what `Object.prototype` has, which has no `[0]`.
        let module = module_name(source).or_else(|| is_in_object_prototype(source).then_some("undefined"));
        if let Some(module) = module.filter(|_| !imported.is_string()) {
            self.check_deprecation(specifier.span(), module.as_bytes(), imported.bytes(), cx);
        }
    }
}

impl NoDeprecated {
    /// `checkDeprecation`, for the method `object.property`, or `property` if `object` is empty.
    fn check_deprecation(&self, at: Span, object: &[u8], property: &[u8], cx: &mut Cx<'_, Self>) {
        let (file, pragma) = (cx.file(), cx.state.pragmas.pragma);
        let Some(deprecated) = Deprecated::get(pragma, object, property) else {
            return;
        };
        if *cx.state.version.get_or_insert_with(|| get_react_version_from_context(file)) < deprecated.version {
            return;
        }
        let old_method = if object.is_empty() { property.to_vec() } else { [object, b".", property].concat() };
        let (major, minor, patch) = deprecated.version;
        let new_method = match deprecated.new_method {
            "" => Vec::new(),
            it if it.starts_with('.') => [&b", use "[..], pragma, it.as_bytes(), b" instead"].concat(),
            it => [&b", use "[..], it.as_bytes(), b" instead"].concat(),
        };
        let refs = match deprecated.refs {
            "" => Vec::new(),
            it if object.is_empty() => [&b", see "[..], it.as_bytes(), CODEMOD.as_bytes()].concat(),
            it => [&b", see "[..], it.as_bytes()].concat(),
        };
        cx.report(at, DEPRECATED)
            .data("oldMethod", old_method)
            .data("version", format!("{major}.{minor}.{patch}"))
            .data("newMethod", new_method)
            .data("refs", refs);
    }

    /// `MemberExpression(node)`
    fn check_member_expression(&self, node: Span, cx: &mut Cx<'_, Self>) {
        if let Some((object, property)) = strings::split_once_char(cx.file().slice(node), b'.') {
            self.check_deprecation(node, object, property, cx);
        }
    }

    /// `implements a.b`, and `extends a.b` of an interface: ESTree has a `MemberExpression` there.
    fn check_heritage<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let TypeKind::Ref { name, .. } = ty.kind() else {
            return;
        };
        let Some(first) = name.first() else {
            return;
        };
        for part in name.parts().skip(1) {
            self.check_member_expression(first.span().to(part.span()), cx);
        }
    }

    /// `checkLifeCycleMethods`, for a class or an object literal.
    fn check_life_cycle_methods<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let pragmas = cx.state.pragmas;
        let mut methods = get_component_properties(node);
        methods.retain(|it| it.name().is_some_and(|name| Deprecated::get(pragmas.pragma, b"", name).is_some()));
        if methods.is_empty()
            || !(is_es5_component(node, &pragmas)
                || matches!(node, Node::Class(class) if is_es6_component(class, &pragmas)))
        {
            return;
        }
        for method in methods {
            if let (Some(name), Some(at)) = (method.name(), get_property_name_node(method.node())) {
                self.check_deprecation(at, b"", name, cx);
            }
        }
    }
}

impl Deprecated {
    const fn new(
        object: &'static str,
        property: &'static str,
        version: Version,
        new_method: &'static str,
        refs: &'static str,
    ) -> Deprecated {
        let name = property.as_bytes();
        let mut start = name.len();
        while start > 0 && name[start - 1] != b'.' {
            start -= 1;
        }
        let bit = mention_bit(name.split_at(start).1);
        Deprecated { object: Some(object), property, version, new_method, refs, bit }
    }

    const fn of_pragma(property: &'static str, version: Version, new_method: &'static str) -> Deprecated {
        Deprecated { object: None, ..Deprecated::new("", property, version, new_method, "") }
    }

    /// `deprecated[method]`
    fn get(pragma: &[u8], object: &[u8], property: &[u8]) -> Option<&'static Deprecated> {
        let is_it = |it: &&Deprecated| {
            it.property.as_bytes() == property && it.object.map_or(pragma, str::as_bytes) == object
        };
        ALL_DEPRECATED.iter().rfind(is_it)
    }
}

fn mentions_life_cycle_methods(file: &File) -> bool {
    LIFE_CYCLE_METHODS.iter().any(|&bit| file.mentions_bit(bit))
}

/// `MODULES[source][0]`
fn module_name(source: &[u8]) -> Option<&'static str> {
    match source {
        b"react" => Some("React"),
        b"react-addons-perf" => Some("ReactPerf"),
        b"react-dom" => Some("ReactDOM"),
        b"react-dom/server" => Some("ReactDOMServer"),
        _ => None,
    }
}

/// `reactModuleName || pragma` for a declarator with that `init`. `None` where upstream looks no further.
fn module_required_by<'a>(init: Expr<'a>, pragma: &'a [u8]) -> Option<&'a [u8]> {
    if let Some(name) = init.as_ident() {
        return MODULE_NAMES.into_iter().find(|it| name.is(it)).map(str::as_bytes);
    }
    // A `ChainExpression` has no `arguments`.
    let (ExprKind::Call(call) | ExprKind::New(call)) = init.kind() else {
        return None;
    };
    let source = call.args().get(0).filter(|_| !init.is_chain_root())?.as_string()?.bytes();
    // `MODULES[source]` also finds what `Object.prototype` has.
    let is_react_require = || call.callee().is_ident("require") && is_in_object_prototype(source);
    module_name(source).map(str::as_bytes).or_else(|| is_react_require().then_some(pragma))
}
