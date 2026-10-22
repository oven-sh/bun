use crate::conditions::{Condition, should_run};
use crate::kit::attributes;
use bun_lint::ast::svelte::{Role, SvelteTag};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::eslint_utils::{ReferenceKind, ReferenceTracker, TraceMap};

/// require type parameters for `createEventDispatcher`
pub struct RequireEventDispatcherTypes;

const MISSING_TYPE_PARAMETER: Message = Message::new(
    "missingTypeParameter",
    "Type parameters missing for the `createEventDispatcher` function call.",
);

const CONDITIONS: &[Condition] = &[Condition {
    svelte_versions: &["3/4"],
    svelte_file_types: &[],
    runes: &[],
    kit_file_types: &[],
    svelte_kit_versions: &[],
}];

const DISPATCHERS: TraceMap<'static, ()> = TraceMap::new(&[(
    "svelte",
    TraceMap {
        esm: true,
        ..TraceMap::new(&[("createEventDispatcher", TraceMap::EMPTY.call(()))])
    },
)]);

impl Rule for RequireEventDispatcherTypes {
    const META: Meta =
        Meta::plugin(Plugin::Svelte, "require-event-dispatcher-types", Kind::Suggestion).recommended().reports_at_the_end();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        RequireEventDispatcherTypes
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("createEventDispatcher") && should_run(file, CONDITIONS)).then_some(())
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        // Some script's `lang`, `getLangValue`: the value, if all its parts are text.
        let is_typescript = file.svelte_nodes_of(SvelteTag::ScriptElement).any(|script| {
            let Some(lang) = attributes(script, b"lang").next() else {
                return false;
            };
            let mut values = lang.nodes(Role::Value);
            let mut text = Vec::new();
            let is_static = values.all(|it| {
                text.extend_from_slice(it.text());
                it.tag() == SvelteTag::Literal
            });
            is_static && (text.eq_ignore_ascii_case(b"ts") || text.eq_ignore_ascii_case(b"typescript"))
        });
        if !is_typescript {
            return;
        }
        for found in ReferenceTracker::new(file).iterate_esm_references(&DISPATCHERS) {
            let Some(call) = found.call().filter(|_| found.kind == ReferenceKind::Call) else {
                continue;
            };
            if call.type_args().is_empty() {
                cx.report(found.node, MISSING_TYPE_PARAMETER);
            }
        }
    }
}
