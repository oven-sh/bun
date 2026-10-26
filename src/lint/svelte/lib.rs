//! eslint-plugin-svelte 3.23.1's rules, on natively linted Svelte components: each reads the component as
//! svelte-eslint-parser 1.9 presents it (`bun_lint::ast::svelte`) and reports in component positions.
//!
//! Ports of the rules of https://github.com/sveltejs/eslint-plugin-svelte, Copyright (c) 2021 Yosuke Ota, under the MIT
//! License: see LICENSE.md.

#![forbid(unsafe_code)]
#![deny(clippy::iter_over_hash_type)]

mod conditions;
mod duplicates;
mod events;
mod ignores;
mod kit;
mod known_css_properties;
mod reactive;
mod stores;
mod style;
mod variables;

bun_lint::rules! {
    comment_directive::CommentDirective,
    infinite_reactive_loop::InfiniteReactiveLoop,
    no_at_debug_tags::NoAtDebugTags,
    no_at_html_tags::NoAtHtmlTags,
    no_dom_manipulating::NoDomManipulating,
    no_dupe_else_if_blocks::NoDupeElseIfBlocks,
    no_dupe_on_directives::NoDupeOnDirectives,
    no_dupe_style_properties::NoDupeStyleProperties,
    no_dupe_use_directives::NoDupeUseDirectives,
    no_export_load_in_svelte_module_in_kit_pages::NoExportLoadInSvelteModuleInKitPages,
    no_immutable_reactive_statements::NoImmutableReactiveStatements,
    no_inner_declarations::NoInnerDeclarations,
    no_inspect::NoInspect,
    no_navigation_without_resolve::NoNavigationWithoutResolve,
    no_not_function_handler::NoNotFunctionHandler,
    no_object_in_text_mustaches::NoObjectInTextMustaches,
    no_raw_special_elements::NoRawSpecialElements,
    no_reactive_functions::NoReactiveFunctions,
    no_reactive_literals::NoReactiveLiterals,
    no_reactive_reassign::NoReactiveReassign,
    no_shorthand_style_property_overrides::NoShorthandStylePropertyOverrides,
    no_store_async::NoStoreAsync,
    no_svelte_internal::NoSvelteInternal,
    no_unknown_style_directive_property::NoUnknownStyleDirectiveProperty,
    no_unnecessary_state_wrap::NoUnnecessaryStateWrap,
    no_unused_props::NoUnusedProps,
    no_unused_svelte_ignore::NoUnusedSvelteIgnore,
    no_useless_children_snippet::NoUselessChildrenSnippet,
    no_useless_mustaches::NoUselessMustaches,
    prefer_svelte_reactivity::PreferSvelteReactivity,
    prefer_writable_derived::PreferWritableDerived,
    require_each_key::RequireEachKey,
    require_event_dispatcher_types::RequireEventDispatcherTypes,
    require_store_reactive_access::RequireStoreReactiveAccess,
    system::System,
    valid_each_key::ValidEachKey,
    valid_prop_names_in_kit_pages::ValidPropNamesInKitPages,
}
