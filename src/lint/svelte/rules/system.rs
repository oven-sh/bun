use bun_lint::ast::svelte::shared::{IgnoreWarning, IgnoreWarnings, Loc, Rules, Shared};
use bun_lint::ast::svelte::{Component, InComponent, Role, SvelteId, SvelteNode, SvelteTag};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::sync::Arc;

/// system rule for working this plugin
pub struct System;

const NOT_AN_ARRAY: Message =
    Message::new("", "The `settings.svelte.ignoreWarnings` must be an array.");
const NOT_A_STRING: Message = Message::new(
    "",
    "The array element in the `settings.svelte.ignoreWarnings` must be a string.",
);

pub struct Ignoring<'a> {
    shared: &'a Shared,
    /// The index in `shared`.
    at: usize,
    read: Read,
    component: &'a Component,
    /// The start and end tag of each script, in ESLint's traversal order once sorted.
    scripts: Vec<(SvelteId, Option<Span>, Option<Span>)>,
}

/// The outcome of reading `settings.svelte.ignoreWarnings`.
enum Read {
    Ok(Arc<IgnoreWarnings>),
    /// It's reported, and nothing is ignored.
    Refused(Message),
    /// `new RegExp` throws this message.
    Throws(Vec<u8>),
}

/// `settings.svelte.ignoreWarnings`, as `create` reads it.
fn read(settings: &Json) -> Read {
    let given = settings
        .get(b"svelte")
        .and_then(|it| it.get(b"ignoreWarnings"));
    let items = match given {
        Some(Json::Array(items)) => &items[..],
        Some(it) if it.is_truthy() => return Read::Refused(NOT_AN_ARRAY),
        _ => &[],
    };
    let mut warnings = Vec::with_capacity(items.len());
    for item in items {
        let Some(item) = item.as_str() else {
            return Read::Refused(NOT_A_STRING);
        };
        match IgnoreWarning::of(item) {
            Ok(warning) => warnings.push(warning),
            Err(message) => return Read::Throws(message),
        }
    }
    Read::Ok(Arc::new(IgnoreWarnings(warnings)))
}

impl Rule for System {
    const META: Meta = Meta::plugin(Plugin::Svelte, "system", Kind::Problem)
        .reports_on_creation()
        .feeds_processor();
    const ON: On = On::new().svelte_nodes(&[SvelteTag::ScriptElement]).finish();
    type State<'a> = Ignoring<'a>;

    fn new(_: &Options) -> Self {
        System
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Ignoring<'a>> {
        let (shared, component) = (file.svelte_shared()?, file.svelte()?);
        let at = shared.new_comment_directives(b"svelte/system", false);
        Some(Ignoring {
            shared,
            at,
            read: read(file.settings()),
            component,
            scripts: Vec::new(),
        })
    }

    fn svelte_node<'a>(&self, node: SvelteNode<'a>, cx: &mut Cx<'a, Self>) {
        let tag = |role| node.child(role).map(SvelteNode::span);
        let tags = (node.id(), tag(Role::StartTag), tag(Role::EndTag));
        cx.state.scripts.push(tags);
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let warnings = match &cx.state.read {
            Read::Ok(warnings) => Arc::clone(warnings),
            Read::Refused(message) => {
                cx.report(InComponent(Span::empty(0)), *message)
                    .without_end();
                return;
            }
            Read::Throws(message) => {
                cx.throw_on_creation(message.clone());
                return;
            }
        };
        let Ignoring {
            shared,
            at,
            component,
            scripts,
            ..
        } = &mut cx.state;
        let ignored = || Rules::Ignored(Arc::clone(&warnings));
        // In ESLint's traversal order.
        bun_lint::utils::sort::sort_by_key(scripts, |it| it.0);
        shared.comment_directives(*at, |directives| {
            let first = Loc { line: 1, column: 0 };
            directives.disable_block(first, ignored(), first);
            // Only the markup is covered: each script is re-enabled.
            for &(_, start_tag, end_tag) in scripts.iter() {
                let Some(start_tag) = start_tag else {
                    continue;
                };
                let after = Loc::of(component, start_tag.end);
                directives.enable_block(after, ignored(), after);
                if let Some(end_tag) = end_tag {
                    let before = Loc::of(component, end_tag.start);
                    directives.disable_block(before, ignored(), before);
                }
            }
        });
    }
}
