use crate::conditions::{Condition, should_run};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::eslint_utils::{ReferenceTracker, TraceMap};

/// Disallow unnecessary $state wrapping of reactive classes
pub struct NoUnnecessaryStateWrap {
    additional_reactive_classes: Vec<Box<[u8]>>,
    allows_reassign: bool,
}

const UNNECESSARY_STATE_WRAP: Message = Message::new(
    "unnecessaryStateWrap",
    "{{className}} is already reactive, $state wrapping is unnecessary.",
);
const SUGGEST_REMOVE_STATE_WRAP: Message =
    Message::new("suggestRemoveStateWrap", "Remove unnecessary $state wrapping");

const CONDITIONS: &[Condition] = &[Condition {
    svelte_versions: &["5"],
    svelte_file_types: &[],
    runes: &[true],
    kit_file_types: &[],
    svelte_kit_versions: &[],
}];

const CLASS: TraceMap<'static, ()> = TraceMap::EMPTY.call(()).construct(());

const REACTIVE_CLASSES: TraceMap<'static, ()> = TraceMap::new(&[(
    "svelte/reactivity",
    TraceMap {
        esm: true,
        ..TraceMap::new(&[
            ("SvelteSet", CLASS),
            ("SvelteMap", CLASS),
            ("SvelteURL", CLASS),
            ("SvelteURLSearchParams", CLASS),
            ("SvelteDate", CLASS),
            ("MediaQuery", CLASS),
        ])
    },
)]);

/// `$state(..)`: a call to the rune.
fn is_state_call(e: Expr<'_>) -> bool {
    e.as_call().is_some_and(|call| call.callee().is_ident("$state"))
}

impl NoUnnecessaryStateWrap {
    /// `reportUnnecessaryStateWrap` for `target`, an argument of `state`, the `$state` call that initializes a
    /// variable. `at_the_end` is true when called from the `Program:exit` listener.
    fn report<'a>(&self, (state, target): (Expr<'a>, Expr<'a>), class: &'a [u8], at_the_end: bool, cx: &mut Cx<'a, Self>) {
        let Node::VarDecl(declarator) = state.parent() else {
            return;
        };
        let id = declarator.pat();
        if id.as_ident().is_none() {
            return;
        }
        let file = cx.file();
        // `isReassigned`: a write through another identifier, including a prop's, whose identifier is a copy.
        if self.allows_reassign
            && let Some(variable) = id.symbol().and_then(|it| file.svelte_variable_of(it))
            && variable.references().any(|it| it.is_write() && it.reference().is_none_or(|it| it.node() != Node::Pat(id)))
        {
            return;
        }
        let report = cx.report(target, UNNECESSARY_STATE_WRAP);
        let report = if at_the_end { report.at_the_end() } else { report };
        report
            .data("className", class)
            .suggest(SUGGEST_REMOVE_STATE_WRAP, |fixer| fixer.replace(state, file.slice(target.span())));
    }
}

impl Rule for NoUnnecessaryStateWrap {
    const META: Meta = Meta::plugin(Plugin::Svelte, "no-unnecessary-state-wrap", Kind::Suggestion).recommended().has_suggestions();
    const ON: On = On::new().function_calls(&["$state"]).finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        NoUnnecessaryStateWrap {
            additional_reactive_classes: (object.strings("additionalReactiveClasses").iter())
                .map(|it| it.as_bytes().into())
                .collect(),
            allows_reassign: object.bool_or("allowReassign", false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("$state") && should_run(file, CONDITIONS)).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if self.additional_reactive_classes.is_empty() || !is_state_call(e) {
            return;
        }
        let Some(call) = e.as_call() else {
            return;
        };
        for argument in call.args().iter() {
            let Some(name) = argument.as_call_or_new().and_then(|it| it.callee().as_ident()) else {
                continue;
            };
            if self.additional_reactive_classes.iter().any(|it| **it == *name.bytes()) {
                self.report((e, argument), name.bytes(), false, cx);
            }
        }
    }

    /// Upstream's `Program:exit` listener.
    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        if !file.mentions("svelte/reactivity") {
            return;
        }
        for found in ReferenceTracker::new(file).iterate_esm_references(&REACTIVE_CLASSES) {
            let (Some(target), Some(&name)) = (found.expr(), found.path.last()) else {
                continue;
            };
            let Node::Expr(state) = target.parent() else {
                continue;
            };
            let is_argument = state.as_call().is_some_and(|it| it.args().iter().any(|it| it == target));
            if is_argument && is_state_call(state) {
                self.report((state, target), name.as_bytes(), true, cx);
            }
        }
    }
}
