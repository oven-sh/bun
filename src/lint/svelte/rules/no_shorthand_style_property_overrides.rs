use crate::style::declaration_sets;
use bun_lint::ast::svelte::{InComponent, SvelteNode, SvelteTag};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashSet;

/// disallow shorthand style properties that override related longhand properties
pub struct NoShorthandStylePropertyOverrides;

const UNEXPECTED: Message = Message::new(
    "unexpected",
    "Unexpected shorthand '{{shorthand}}' after '{{original}}'.",
);

impl Rule for NoShorthandStylePropertyOverrides {
    const META: Meta = Meta::plugin(
        Plugin::Svelte,
        "no-shorthand-style-property-overrides",
        Kind::Problem,
    ).recommended();
    const ON: On = On::new().svelte_nodes(&[SvelteTag::StartTag]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoShorthandStylePropertyOverrides
    }

    /// Reports a shorthand whose longhand, with the same vendor prefix, is in an earlier set of declarations. An inline
    /// style's declarations form one set.
    fn svelte_node<'a>(&self, node: SvelteNode<'a>, cx: &mut Cx<'a, Self>) {
        let mut before: FxHashSet<&[u8]> = FxHashSet::default();
        for set in declaration_sets(node) {
            for declaration in &set {
                let prefix = vendor_prefix(declaration.prop);
                let normalized = declaration.prop.get(prefix.len()..).unwrap_or_default();
                let Some(&(_, longhands)) = SHORTHAND_PROPERTIES.iter().find(|it| it.0 == normalized)
                else {
                    continue;
                };
                for longhand in longhands {
                    let original = [prefix, longhand.as_bytes()].concat();
                    if !before.contains(&original[..]) {
                        continue;
                    }
                    cx.report(InComponent(declaration.span), UNEXPECTED)
                        .data("shorthand", declaration.prop)
                        .data("original", original)
                        .listened_on(node);
                }
            }
            before.extend(set.iter().map(|it| it.prop));
        }
    }
}

/// `getVendorPrefix`: what `/^-\w+-/u` matches.
fn vendor_prefix(prop: &[u8]) -> &[u8] {
    let Some(rest) = prop.strip_prefix(b"-") else {
        return b"";
    };
    let word = rest.iter().take_while(|it| it.is_ascii_alphanumeric() || **it == b'_').count();
    match rest.get(word) {
        Some(b'-') if word > 0 => prop.get(..word + 2).unwrap_or_default(),
        _ => b"",
    }
}

/// eslint-plugin-svelte's `SHORTHAND_PROPERTIES` (`utils/css-utils/resource.js`).
const SHORTHAND_PROPERTIES: &[(&[u8], &[&str])] = &[
    (b"margin", &["margin-top", "margin-bottom", "margin-left", "margin-right"]),
    (b"padding", &["padding-top", "padding-bottom", "padding-left", "padding-right"]),
    (
        b"background",
        &[
            "background-image",
            "background-size",
            "background-position",
            "background-repeat",
            "background-origin",
            "background-clip",
            "background-attachment",
            "background-color",
        ],
    ),
    (
        b"font",
        &[
            "font-style",
            "font-variant",
            "font-weight",
            "font-stretch",
            "font-size",
            "font-family",
            "line-height",
        ],
    ),
    (
        b"border",
        &[
            "border-top-width",
            "border-bottom-width",
            "border-left-width",
            "border-right-width",
            "border-top-style",
            "border-bottom-style",
            "border-left-style",
            "border-right-style",
            "border-top-color",
            "border-bottom-color",
            "border-left-color",
            "border-right-color",
        ],
    ),
    (b"border-top", &["border-top-width", "border-top-style", "border-top-color"]),
    (b"border-bottom", &["border-bottom-width", "border-bottom-style", "border-bottom-color"]),
    (b"border-left", &["border-left-width", "border-left-style", "border-left-color"]),
    (b"border-right", &["border-right-width", "border-right-style", "border-right-color"]),
    (
        b"border-width",
        &["border-top-width", "border-bottom-width", "border-left-width", "border-right-width"],
    ),
    (
        b"border-style",
        &["border-top-style", "border-bottom-style", "border-left-style", "border-right-style"],
    ),
    (
        b"border-color",
        &["border-top-color", "border-bottom-color", "border-left-color", "border-right-color"],
    ),
    (b"list-style", &["list-style-type", "list-style-position", "list-style-image"]),
    (
        b"border-radius",
        &[
            "border-top-right-radius",
            "border-top-left-radius",
            "border-bottom-right-radius",
            "border-bottom-left-radius",
        ],
    ),
    (
        b"transition",
        &["transition-delay", "transition-duration", "transition-property", "transition-timing-function"],
    ),
    (
        b"animation",
        &[
            "animation-name",
            "animation-duration",
            "animation-timing-function",
            "animation-delay",
            "animation-iteration-count",
            "animation-direction",
            "animation-fill-mode",
            "animation-play-state",
        ],
    ),
    (
        b"border-block-end",
        &["border-block-end-width", "border-block-end-style", "border-block-end-color"],
    ),
    (
        b"border-block-start",
        &["border-block-start-width", "border-block-start-style", "border-block-start-color"],
    ),
    (
        b"border-image",
        &[
            "border-image-source",
            "border-image-slice",
            "border-image-width",
            "border-image-outset",
            "border-image-repeat",
        ],
    ),
    (
        b"border-inline-end",
        &["border-inline-end-width", "border-inline-end-style", "border-inline-end-color"],
    ),
    (
        b"border-inline-start",
        &["border-inline-start-width", "border-inline-start-style", "border-inline-start-color"],
    ),
    (b"column-rule", &["column-rule-width", "column-rule-style", "column-rule-color"]),
    (b"columns", &["column-width", "column-count"]),
    (b"flex", &["flex-grow", "flex-shrink", "flex-basis"]),
    (b"flex-flow", &["flex-direction", "flex-wrap"]),
    (
        b"grid",
        &[
            "grid-template-rows",
            "grid-template-columns",
            "grid-template-areas",
            "grid-auto-rows",
            "grid-auto-columns",
            "grid-auto-flow",
            "grid-column-gap",
            "grid-row-gap",
        ],
    ),
    (b"grid-area", &["grid-row-start", "grid-column-start", "grid-row-end", "grid-column-end"]),
    (b"grid-column", &["grid-column-start", "grid-column-end"]),
    (b"grid-gap", &["grid-row-gap", "grid-column-gap"]),
    (b"grid-row", &["grid-row-start", "grid-row-end"]),
    (b"grid-template", &["grid-template-columns", "grid-template-rows", "grid-template-areas"]),
    (b"outline", &["outline-color", "outline-style", "outline-width"]),
    (b"text-decoration", &["text-decoration-color", "text-decoration-style", "text-decoration-line"]),
    (b"text-emphasis", &["text-emphasis-style", "text-emphasis-color"]),
    (
        b"mask",
        &[
            "mask-image",
            "mask-mode",
            "mask-position",
            "mask-size",
            "mask-repeat",
            "mask-origin",
            "mask-clip",
            "mask-composite",
        ],
    ),
];
