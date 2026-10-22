use crate::conditions::{Condition, should_run};
use crate::variables::find_variable;
use bun_core::strings;
use bun_lint::ast::svelte::variables::DefNode;
use bun_lint::ast::svelte::{Role, SvelteKind, SvelteNode, SvelteTag};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::types::{Type, TypeFlags};
use bun_lint::utils::eslint_utils::{ReferenceKind, ReferenceTracker, TraceMap};
use smallvec::{SmallVec, smallvec};

/// disallow internal navigation (links, `goto()`, `pushState()`, `replaceState()`) without a `resolve()`
pub struct NoNavigationWithoutResolve {
    ignore_goto: bool,
    ignore_links: bool,
    ignore_push_state: bool,
    ignore_replace_state: bool,
}

const GOTO_WITHOUT_RESOLVE: Message =
    Message::new("gotoWithoutResolve", "Unexpected goto() call without resolve().");
const LINK_WITHOUT_RESOLVE: Message =
    Message::new("linkWithoutResolve", "Unexpected href link without resolve().");
const PUSH_STATE_WITHOUT_RESOLVE: Message = Message::new(
    "pushStateWithoutResolve",
    "Unexpected pushState() call without resolve().",
);
const REPLACE_STATE_WITHOUT_RESOLVE: Message = Message::new(
    "replaceStateWithoutResolve",
    "Unexpected replaceState() call without resolve().",
);

const CONDITIONS: &[Condition] = &[Condition {
    svelte_versions: &[],
    svelte_file_types: &[],
    runes: &[],
    kit_file_types: &[],
    svelte_kit_versions: &["1.0.0-next", "1", "2", "3"],
}];

const PATHS: TraceMap<'static, ()> = TraceMap::new(&[(
    "$app/paths",
    TraceMap {
        esm: true,
        ..TraceMap::new(&[
            ("asset", TraceMap::EMPTY.read(())),
            ("resolve", TraceMap::EMPTY.read(())),
        ])
    },
)]);

const NAVIGATION: TraceMap<'static, ()> = TraceMap::new(&[(
    "$app/navigation",
    TraceMap {
        esm: true,
        ..TraceMap::new(&[
            ("goto", TraceMap::EMPTY.call(())),
            ("pushState", TraceMap::EMPTY.call(())),
            ("replaceState", TraceMap::EMPTY.call(())),
        ])
    },
)]);

/// `extractResolveReferences`: the positions of the identifiers that name `$app/paths`' `resolve` or `asset`, and the
/// names `resolve` is read under from the module.
pub struct State {
    resolves: Vec<Span>,
}

/// What `isValueAllowed` allows besides values that resolve.
#[derive(Copy, Clone, Default)]
struct Allows {
    absolute: bool,
    empty: bool,
    fragment: bool,
    nullish: bool,
}

/// A link's value or a call's argument: an expression, or an attribute's decoded text (`SvelteLiteral.value`).
#[derive(Copy, Clone)]
enum Value<'a, 't> {
    Expr(Expr<'a>),
    Text(&'t [u8]),
}

/// The `value` of the `SvelteLiteral` `literal`: its text with character references decoded.
fn literal_value(literal: SvelteNode<'_>) -> std::borrow::Cow<'_, [u8]> {
    bun_lint::ast::svelte::decode_character_references(literal.text(), true)
}

/// What eslint-plugin-svelte's `findVariable` finds for an identifier, as far as this rule needs, in the context of one
/// check (`FindVariableContext`): each identifier is looked up once, and the second time there's no variable.
struct Lookups<'a> {
    seen: rustc_hash::FxHashSet<Expr<'a>>,
}

impl<'a> Lookups<'a> {
    fn new() -> Self {
        Lookups {
            seen: rustc_hash::FxHashSet::default(),
        }
    }

    /// `None` if there's no variable. `Some(None)` for one whose first identifier isn't a `VariableDeclarator`'s name.
    /// Otherwise that declarator.
    fn declarator(&mut self, e: Expr<'a>) -> Option<Option<VarDecl<'a>>> {
        if !self.seen.insert(e) {
            return None;
        }
        let file = e.file();
        if file.types().is_none() {
            let variable = find_variable(e)?;
            let first = variable.definitions().next();
            return Some(first.and_then(|it| match it.node()? {
                DefNode::Program(Node::VarDecl(declarator)) if is_named_by(declarator, it.name_span()) => {
                    Some(declarator)
                }
                _ => None,
            }));
        }
        let symbol = find_symbol(e)?;
        let first = symbol.declarations().next();
        Some(first.and_then(|it| match (it, it.node()?) {
            (Declaration::Var(pat), Node::VarDecl(declarator)) if declarator.pat() == pat => {
                let statement = declarator.parent();
                let is_written = (file.view()).is_none_or(|it| !it.hides(statement.span().start));
                is_written.then_some(declarator)
            }
            _ => None,
        }))
    }
}

/// True if `declarator` declares only a name, written at `span`.
fn is_named_by(declarator: VarDecl<'_>, span: Span) -> bool {
    let pat = declarator.pat();
    matches!(pat.kind(), PatKind::Ident(_)) && pat.span() == span
}

/// `findVariable` in the type-checked program, whose scopes match the source text: the innermost source declaration of
/// the name, or for a `$x` that resolves to nothing, of `x`.
fn find_symbol<'a>(e: Expr<'a>) -> Option<Symbol<'a>> {
    let (file, name) = (e.file(), e.as_ident()?);
    let view = file.view();
    let is_written = |symbol: &Symbol<'a>| {
        symbol.declarations().any(|it| {
            it.name_span()
                .is_some_and(|it| view.is_none_or(|view| !view.hides(it.start)))
        })
    };
    let find = |name: Name<'a>| {
        let mut scopes = Node::Expr(e).scope().chain();
        scopes.find_map(|scope| scope.get_name(name).filter(is_written))
    };
    if let Some(found) = find(name) {
        return Some(found);
    }
    let rest = std::str::from_utf8(name.bytes().strip_prefix(b"$")?).ok()?;
    find(file.name_of(rest))
}

/// `/^[+a-z]*:/i`
fn is_absolute_url(text: &[u8]) -> bool {
    let scheme = text.iter().take_while(|it| it.is_ascii_alphabetic() || **it == b'+');
    text.get(scheme.count()) == Some(&b':')
}

/// True if `word` is one of the parts `text.split(/\s+/)` returns.
fn has_word(text: &[u8], word: &[u8]) -> bool {
    let (mut at, mut start) = (0, 0);
    while at < text.len() {
        match strings::js_whitespace_len(&text[at..]) {
            0 => at += 1,
            space => {
                if &text[start..at] == word {
                    return true;
                }
                at += space;
                start = at;
            }
        }
    }
    &text[start..] == word
}

/// A string literal's value.
fn string_of(e: Expr<'_>) -> Option<&[u8]> {
    match e.kind() {
        ExprKind::String(value) => Some(value.bytes()),
        _ => None,
    }
}

impl NoNavigationWithoutResolve {
    /// `isValueAllowed`
    fn is_allowed<'a>(
        &self,
        lookups: &mut Lookups<'a>,
        value: Value<'a, '_>,
        resolves: &[Span],
        allows: Allows,
    ) -> bool {
        // The values still to allow, in the order upstream inspects them, the next one on top.
        let mut pending: SmallVec<[Value<'a, '_>; 4]> = smallvec![value];
        while let Some(value) = pending.pop() {
            if let Value::Expr(e) = value {
                if e.as_ident().is_some()
                    && let Some(Some(declarator)) = lookups.declarator(e)
                {
                    if is_allowed_type(declarator.pat().ty(), allows.nullish) {
                        continue;
                    }
                    if let Some(init) = declarator.init() {
                        pending.push(Value::Expr(init));
                        continue;
                    }
                }
                if let ExprKind::Cond { yes, no, .. } = e.kind() {
                    pending.extend([Value::Expr(no), Value::Expr(yes)]);
                    continue;
                }
            }
            let is_allowed = (allows.absolute && is_absolute(value))
                || (allows.empty && is_empty(value))
                || (allows.fragment && starts_with(lookups, value, b"#"))
                || (allows.nullish && is_nullish(value))
                || matches!(value, Value::Expr(e) if is_allowed_type(e.ty(), allows.nullish))
                || matches!(value, Value::Expr(e) if is_resolve_call(lookups, e, resolves));
            if !is_allowed {
                return false;
            }
        }
        true
    }

    /// `checkLinkAttribute`
    fn check_link<'a>(&self, attribute: SvelteNode<'a>, value: Value<'a, '_>, cx: &mut Cx<'a, Self>) {
        let Some(start_tag) = attribute.parent() else {
            return;
        };
        let is_link = start_tag.parent().is_some_and(|it| {
            it.tag() == SvelteTag::Element
                && it.kind() == SvelteKind::Html
                && it.child(Role::Name).is_some_and(|it| it.tag() == SvelteTag::Name)
                && it.name() == b"a"
        });
        let key = match attribute.tag() {
            SvelteTag::ShorthandAttribute => attribute.code(Role::Key).map_or(&b""[..], |it| it.text()),
            _ => attribute.name(),
        };
        if !is_link || key != b"href" || has_rel_external(start_tag) {
            return;
        }
        let allows = Allows {
            absolute: true,
            fragment: true,
            nullish: true,
            ..Allows::default()
        };
        if !self.is_allowed(&mut Lookups::new(), value, &cx.state.resolves, allows) {
            cx.report(attribute, LINK_WITHOUT_RESOLVE);
        }
    }
}

/// `expressionIsAllowedType`: `$app/types`' `ResolvedPathname`, by assignability in both directions, which
/// distinguishes it from types it only includes, such as `Pathname`. With `nullish`, `null` and `undefined` are allowed
/// and removed from the type.
fn is_allowed_type(mut ty: Type<'_>, nullish: bool) -> bool {
    let Some(types) = ty.file().types() else {
        return false;
    };
    if nullish {
        if ty.has_flags(TypeFlags::NULL) || ty.has_flags(TypeFlags::UNDEFINED) {
            return true;
        }
        ty = ty.get_non_nullable_type();
    }
    let Some(module) = types.get_ambient_module(b"$app/types") else {
        return false;
    };
    let exports = module.get_exports_of_module();
    let Some(resolved) = exports.iter().find(|it| it.name() == b"ResolvedPathname") else {
        return false;
    };
    let resolved = resolved.get_declared_type();
    ty.is_assignable_to(resolved) && resolved.is_assignable_to(ty)
}

/// `expressionIsResolveCall`
fn is_resolve_call<'a>(lookups: &mut Lookups<'a>, mut e: Expr<'a>, resolves: &[Span]) -> bool {
    loop {
        if let ExprKind::Call(call) = e.kind() {
            let callee = call.callee();
            let named = match callee.kind() {
                ExprKind::Ident(_) => Some(callee.span()),
                ExprKind::Dot { name, .. } => Some(name.span()),
                _ => None,
            };
            if named.is_some_and(|it| resolves.contains(&it)) {
                return true;
            }
        }
        if e.as_ident().is_none() {
            return false;
        }
        match lookups.declarator(e).flatten().and_then(|it| it.init()) {
            Some(init) => e = init,
            None => return false,
        }
    }
}

/// `expressionIsEmpty`
fn is_empty(value: Value<'_, '_>) -> bool {
    let Value::Expr(e) = value else {
        return false;
    };
    match e.kind() {
        ExprKind::String(value) => value.bytes().is_empty(),
        ExprKind::Template(template) => template.exprs().is_empty() && template.raw(0).is_empty(),
        _ => false,
    }
}

/// `expressionIsNullish`
fn is_nullish(value: Value<'_, '_>) -> bool {
    let Value::Expr(e) = value else {
        return false;
    };
    match e.kind() {
        ExprKind::Ident(name) => name.bytes() == b"undefined",
        ExprKind::Null => true,
        _ => false,
    }
}

/// `expressionIsAbsoluteUrl`
fn is_absolute(value: Value<'_, '_>) -> bool {
    let e = match value {
        Value::Text(text) => return is_absolute_url(text),
        Value::Expr(e) => e,
    };
    let mut pending: SmallVec<[Expr<'_>; 8]> = smallvec![e];
    while let Some(e) = pending.pop() {
        match e.kind() {
            ExprKind::Binary {
                op: BinOp::Add,
                left,
                right,
            } => pending.extend([right, left]),
            ExprKind::String(value) if is_absolute_url(value.bytes()) => return true,
            ExprKind::Template(template) => {
                if (0..=template.exprs().len()).any(|at| is_absolute_url(template.raw(at))) {
                    return true;
                }
                pending.extend(template.exprs().iter());
            }
            _ => {}
        }
    }
    false
}

/// `expressionStartsWith`
fn starts_with<'a>(lookups: &mut Lookups<'a>, value: Value<'a, '_>, prefix: &[u8]) -> bool {
    let mut e = match value {
        Value::Text(text) => return text.starts_with(prefix),
        Value::Expr(e) => e,
    };
    // For each template along the way, whether its text before the first substitution starts with `prefix`.
    let mut is_before_first = false;
    let starts = loop {
        match e.kind() {
            ExprKind::Binary {
                op: BinOp::Add,
                left,
                ..
            } => e = left,
            ExprKind::Ident(_) => match lookups.declarator(e).flatten().and_then(|it| it.init()) {
                Some(init) => e = init,
                None => break false,
            },
            ExprKind::String(value) => break value.bytes().starts_with(prefix),
            ExprKind::Template(template) => {
                is_before_first |= template.raw(0).starts_with(prefix);
                match template.exprs().first() {
                    Some(first) => e = first,
                    None => break false,
                }
            }
            _ => break false,
        }
    };
    starts || is_before_first
}

/// `hasRelExternal`: true if the start tag's `rel` attribute says `external`, or names a constant that does.
fn has_rel_external(start_tag: SvelteNode<'_>) -> bool {
    let is_external = |e: Expr<'_>| {
        let declarator = Lookups::new().declarator(e).flatten();
        let init = declarator.and_then(|it| it.init());
        init.and_then(string_of).is_some_and(|it| it == b"external")
    };
    start_tag.nodes(Role::Attributes).any(|attribute| match attribute.tag() {
        SvelteTag::Attribute if attribute.name() == b"rel" => {
            let Some(first) = attribute.child(Role::Value) else {
                return false;
            };
            match first.tag() {
                SvelteTag::Literal => has_word(&literal_value(first), b"external"),
                SvelteTag::MustacheTag => {
                    let e = first.code(Role::Expression).and_then(|it| it.node()?.as_expr());
                    e.is_some_and(|e| match e.kind() {
                        ExprKind::String(value) => has_word(value.bytes(), b"external"),
                        ExprKind::Ident(_) => is_external(e),
                        _ => false,
                    })
                }
                _ => false,
            }
        }
        SvelteTag::ShorthandAttribute => {
            let key = attribute.code(Role::Key);
            let value = attribute.code(Role::Value).and_then(|it| it.node()?.as_expr());
            key.is_some_and(|it| it.text() == b"rel")
                && value.is_some_and(|e| e.as_ident().is_some() && is_external(e))
        }
        _ => false,
    })
}

impl Rule for NoNavigationWithoutResolve {
    const META: Meta = Meta::plugin(Plugin::Svelte, "no-navigation-without-resolve", Kind::Suggestion)
        .recommended()
        .uses_types();
    const ON: On = On::new()
        .svelte_nodes(&[SvelteTag::Attribute, SvelteTag::ShorthandAttribute])
        .finish();
    type State<'a> = State;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let flag = |name: &str| options.bool(name).unwrap_or(false);
        NoNavigationWithoutResolve {
            ignore_goto: flag("ignoreGoto"),
            ignore_links: flag("ignoreLinks"),
            ignore_push_state: flag("ignorePushState"),
            ignore_replace_state: flag("ignoreReplaceState"),
        }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        match self.ignore_links {
            true => On::new().finish(),
            false => Self::ON,
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State> {
        if file.svelte().is_none() || !should_run(file, CONDITIONS) {
            return None;
        }
        let mut resolves = Vec::new();
        if file.mentions("$app/paths") {
            for found in ReferenceTracker::new(file).iterate_esm_references(&PATHS) {
                match found.node {
                    Node::ImportSpec(spec) => {
                        let symbol = file.top_level_scope().get_name(spec.local().name());
                        let references = symbol.into_iter().flat_map(|it| it.references());
                        resolves.extend(references.filter_map(|it| Some(it.expr()?.span())));
                    }
                    Node::Expr(e) => {
                        if let ExprKind::Dot { name, .. } = e.kind()
                            && name.bytes() == b"resolve"
                        {
                            resolves.push(name.span());
                        }
                    }
                    _ => {}
                }
            }
        }
        Some(State { resolves })
    }

    fn svelte_node<'a>(&self, node: SvelteNode<'a>, cx: &mut Cx<'a, Self>) {
        let first = node.child(Role::Value);
        let text = first.filter(|it| it.tag() != SvelteTag::MustacheTag).map(literal_value);
        let value = match node.tag() {
            SvelteTag::ShorthandAttribute => node.code(Role::Value).and_then(|it| it.node()?.as_expr()).map(Value::Expr),
            _ => match (first, &text) {
                (_, Some(text)) => Some(Value::Text(text)),
                (Some(first), None) => first.code(Role::Expression).and_then(|it| it.node()?.as_expr()).map(Value::Expr),
                (None, None) => None,
            },
        };
        if let Some(value) = value {
            self.check_link(node, value, cx);
        }
    }

    /// Upstream's `Program` listener.
    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        if !file.mentions("$app/navigation") {
            return;
        }
        let calls = ReferenceTracker::new(file).iterate_esm_references(&NAVIGATION);
        for found in calls.iter().filter(|it| it.kind == ReferenceKind::Call) {
            let (Some(call), Some(&name)) = (found.call(), found.path.last()) else {
                continue;
            };
            let (message, allows) = match name {
                "goto" if !self.ignore_goto => (GOTO_WITHOUT_RESOLVE, Allows::default()),
                "pushState" if !self.ignore_push_state => (PUSH_STATE_WITHOUT_RESOLVE, Allows {
                    empty: true,
                    ..Allows::default()
                }),
                "replaceState" if !self.ignore_replace_state => (REPLACE_STATE_WITHOUT_RESOLVE, Allows {
                    empty: true,
                    ..Allows::default()
                }),
                _ => continue,
            };
            let Some(argument) = call.args().first() else {
                continue;
            };
            let resolves = &cx.state.resolves;
            if !self.is_allowed(&mut Lookups::new(), Value::Expr(argument), resolves, allows) {
                cx.report(argument, message).listened_by(Node::File(file), false);
            }
        }
    }
}
