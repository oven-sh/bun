use crate::conditions::{Condition, should_run};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::eslint_utils::{ReferenceKind, ReferenceTracker, SharedStack, TraceMap};

/// disallow using mutable instances of built-in classes where a reactive alternative is provided by svelte/reactivity
pub struct PreferSvelteReactivity;

const MUTABLE_DATE_USED: Message =
    Message::new("mutableDateUsed", "Found a mutable instance of the built-in Date class. Use SvelteDate instead.");
const MUTABLE_MAP_USED: Message =
    Message::new("mutableMapUsed", "Found a mutable instance of the built-in Map class. Use SvelteMap instead.");
const MUTABLE_SET_USED: Message =
    Message::new("mutableSetUsed", "Found a mutable instance of the built-in Set class. Use SvelteSet instead.");
const MUTABLE_URL_USED: Message =
    Message::new("mutableURLUsed", "Found a mutable instance of the built-in URL class. Use SvelteURL instead.");
const MUTABLE_URL_SEARCH_PARAMS_USED: Message = Message::new(
    "mutableURLSearchParamsUsed",
    "Found a mutable instance of the built-in URLSearchParams class. Use SvelteURLSearchParams instead.",
);

const CONDITIONS: &[Condition] = &[Condition {
    svelte_versions: &["5"],
    svelte_file_types: &[".svelte", ".svelte.[js|ts]"],
    runes: &[],
    kit_file_types: &[],
    svelte_kit_versions: &[],
}];

const NEW: TraceMap<'static, ()> = TraceMap::EMPTY.construct(());
const CLASSES: TraceMap<'static, ()> = TraceMap::new(&[
    ("Date", NEW),
    ("Map", NEW),
    ("Set", NEW),
    ("URL", NEW),
    ("URLSearchParams", NEW),
]);

const CALL: TraceMap<'static, ()> = TraceMap::EMPTY.call(());
const DATE_SETTERS: TraceMap<'static, ()> = TraceMap::new(&[
    ("setDate", CALL),
    ("setFullYear", CALL),
    ("setHours", CALL),
    ("setMilliseconds", CALL),
    ("setMinutes", CALL),
    ("setMonth", CALL),
    ("setSeconds", CALL),
    ("setTime", CALL),
    ("setUTCDate", CALL),
    ("setUTCFullYear", CALL),
    ("setUTCHours", CALL),
    ("setUTCMilliseconds", CALL),
    ("setUTCMinutes", CALL),
    ("setUTCMonth", CALL),
    ("setUTCSeconds", CALL),
    ("setYear", CALL),
]);
const MAP_SETTERS: TraceMap<'static, ()> = TraceMap::new(&[("clear", CALL), ("delete", CALL), ("set", CALL)]);
const SET_SETTERS: TraceMap<'static, ()> = TraceMap::new(&[("add", CALL), ("clear", CALL), ("delete", CALL)]);
const READ: TraceMap<'static, ()> = TraceMap::EMPTY.read(());
const URL_PARTS: TraceMap<'static, ()> = TraceMap::new(&[
    ("hash", READ),
    ("host", READ),
    ("hostname", READ),
    ("href", READ),
    ("password", READ),
    ("pathname", READ),
    ("port", READ),
    ("protocol", READ),
    ("search", READ),
    ("username", READ),
]);
const URL_SEARCH_PARAMS_SETTERS: TraceMap<'static, ()> =
    TraceMap::new(&[("append", CALL), ("delete", CALL), ("set", CALL), ("sort", CALL)]);

impl Rule for PreferSvelteReactivity {
    const META: Meta = Meta::plugin(Plugin::Svelte, "prefer-svelte-reactivity", Kind::Problem).recommended().reports_at_the_end();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferSvelteReactivity
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        let mentions = file.mentions_any(&["Date", "Map", "Set", "URL", "URLSearchParams"]);
        (mentions && should_run(file, CONDITIONS)).then_some(())
    }

    /// Upstream's `Program:exit` listener.
    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let exported = exported(file);
        let tracker = ReferenceTracker::new(file);
        // Upstream queries the file's single tracker, whose stack its generators share. Once an instance is found to be
        // mutable, the variables leading to the call stay on the stack and aren't followed until a global's walk pops
        // them, so a second `new Map()` assigned to the same variable isn't mutable.
        tracker.for_each_global_reference(&CLASSES, &mut |found, stack| {
            let (Some(e), Some(&class)) = (found.expr(), found.path.first()) else {
                return;
            };
            let has_any = |map, stack: &mut _| tracker.first_property_reference(e, map, stack).is_some();
            let (message, is_mutable) = match class {
                "Date" => (MUTABLE_DATE_USED, has_any(&DATE_SETTERS, stack)),
                "Map" => (MUTABLE_MAP_USED, has_any(&MAP_SETTERS, stack)),
                "Set" => (MUTABLE_SET_USED, has_any(&SET_SETTERS, stack)),
                "URL" => (MUTABLE_URL_USED, is_url_mutable(&tracker, e, stack)),
                _ => (MUTABLE_URL_SEARCH_PARAMS_USED, has_any(&URL_SEARCH_PARAMS_SETTERS, stack)),
            };
            for _ in exported.iter().filter(|it| it.contains(e.span())) {
                cx.report(e, message);
            }
            if is_mutable {
                cx.report(e, message);
            }
        });
    }
}

/// `isURLMutable`: true if a part of it is assigned. It goes through everything it finds, and leaves no variable on the
/// stack.
fn is_url_mutable<'a>(tracker: &ReferenceTracker<'a>, e: Expr<'a>, stack: &SharedStack<'a>) -> bool {
    let found = tracker.iterate_property_references_on(e, &URL_PARTS, stack);
    found.iter().filter(|it| it.kind == ReferenceKind::Read).any(|it| {
        let Some(member) = it.expr() else {
            return false;
        };
        matches!(member.parent(), Node::Expr(parent) if parent.as_assign().is_some_and(|(_, target, _)| target == member))
    })
}

/// Where a `.svelte.js` or `.svelte.ts` file's `ExportNamedDeclaration` and `ExportDefaultDeclaration` find the
/// exported value: the declaration, or the definition nodes of a variable exported by name.
fn exported<'a>(file: &'a File<'a>) -> Vec<Span> {
    let path = file.path();
    if !(path.ends_with(b".svelte.js") || path.ends_with(b".svelte.ts")) {
        return Vec::new();
    }
    let scope = file.top_level_scope();
    let definitions_of = |name: Name<'a>, out: &mut Vec<Span>| {
        let variable = scope.find_variable(name);
        let nodes = variable.into_iter().flat_map(|it| it.declarations().filter_map(|it| it.node()));
        out.extend(nodes.map(|it| it.span()));
    };
    let mut out = Vec::new();
    for statement in file.body() {
        match statement.kind() {
            StmtKind::ExportNamed(export) => {
                for item in export.items().iter() {
                    let local = item.local();
                    let is_string = file.slice(local.span()).first().is_some_and(|it| matches!(it, b'"' | b'\''));
                    if !is_string {
                        definitions_of(local.name(), &mut out);
                    }
                }
            }
            StmtKind::ExportDefault(e) => match e.as_ident() {
                Some(name) => definitions_of(name, &mut out),
                None => out.push(e.span()),
            },
            _ if statement.is_exported() => out.push(statement.span_without_export()),
            _ => {}
        }
    }
    out
}
