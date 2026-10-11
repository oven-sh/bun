use crate::oxlint::jsdoc::{JSDoc, JSDocFinder, JSDocPluginSettings, JSDocTag, is_function_declaration_or_expression};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// One of the rules that require a part in each tag of one kind: [`RULES`].
pub struct RequireTagPart<const RULE: usize = 0>;

struct Required {
    rule: &'static str,
    kind: Kind,
    message: Message,
    /// One name is what `settings.jsdoc.tagNamePreference` makes of it. Two are as they are.
    tags: &'static [&'static str],
    /// Only the comments of functions are looked at.
    of_functions: bool,
    is_missing: fn(JSDocTag) -> bool,
}

const fn required(
    rule: &'static str,
    kind: Kind,
    message: Message,
    (tags, of_functions): (&'static [&'static str], bool),
    is_missing: fn(JSDocTag) -> bool,
) -> Required {
    Required { rule, kind, message, tags, of_functions, is_missing }
}

const PARAM: (&[&str], bool) = (&["param"], true);
const PROPERTY: (&[&str], bool) = (&["property"], false);
const RETURNS: (&[&str], bool) = (&["returns"], true);
const THROWS: (&[&str], bool) = (&["throws", "exception"], false);
const YIELDS: (&[&str], bool) = (&["yield", "yields"], false);

const RULES: [Required; 10] = [
    required("require-param-name", Kind::Suggestion, Message::new("", "Missing JSDoc `@param` name."), PARAM, has_no_name),
    required(
        "require-property-description",
        Kind::Problem,
        Message::new("", "Missing description in `@property` tag."),
        PROPERTY,
        |tag| tag.type_name_comment().2.is_empty(),
    ),
    required("require-property-name", Kind::Problem, Message::new("", "Missing name in `@property` tag."), PROPERTY, has_no_name),
    required("require-property-type", Kind::Problem, Message::new("", "Missing type in `@property` tag."), PROPERTY, has_no_type),
    required(
        "require-returns-description",
        Kind::Suggestion,
        Message::new("", "Missing JSDoc `@returns` description."),
        RETURNS,
        |tag| {
            let returns_nothing = |it: &[u8]| matches!(it, b"void" | b"undefined" | b"Promise<void>" | b"Promise<undefined>");
            !tag.type_comment().0.is_some_and(|it| returns_nothing(it.parsed())) && has_no_description(tag)
        },
    ),
    required("require-returns-type", Kind::Suggestion, Message::new("", "Missing JSDoc `@returns` type."), RETURNS, has_no_type),
    required(
        "require-throws-description",
        Kind::Suggestion,
        Message::new("", "Missing JSDoc `@throws` description."),
        THROWS,
        has_no_description,
    ),
    required("require-throws-type", Kind::Suggestion, Message::new("", "Missing JSDoc `@throws` type."), THROWS, has_no_type),
    required(
        "require-yields-description",
        Kind::Suggestion,
        Message::new("", "Missing JSDoc `@yields` description."),
        YIELDS,
        has_no_description,
    ),
    required("require-yields-type", Kind::Suggestion, Message::new("", "Missing JSDoc `@yields` type."), YIELDS, has_no_type),
];

fn has_no_type(tag: JSDocTag) -> bool {
    tag.type_comment().0.is_none()
}

fn has_no_name(tag: JSDocTag) -> bool {
    tag.type_name_comment().1.is_none()
}

fn has_no_description(tag: JSDocTag) -> bool {
    tag.type_comment().1.is_empty()
}

impl<const RULE: usize> Rule for RequireTagPart<RULE> {
    const META: Meta = Meta::oxlint(Plugin::Jsdoc, RULES[RULE].rule, RULES[RULE].kind);
    const ON: On = if RULES[RULE].of_functions { On::new().funcs() } else { On::new().finish() };
    type State<'a> = JSDocFinder<'a>;

    fn new(_: &Options) -> Self {
        Self
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<JSDocFinder<'a>> {
        let finder = JSDocFinder::new(file);
        (!finder.is_empty()).then_some(finder)
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if !is_function_declaration_or_expression(func) {
            return;
        }
        let Some(node) = cx.state.get_function_nearest_jsdoc_node(func) else {
            return;
        };
        let settings = JSDocPluginSettings::new(cx.file());
        check(&RULES[RULE], cx.state.get_checked_by_node(node, &settings), &settings, cx);
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let settings = JSDocPluginSettings::new(cx.file());
        check(&RULES[RULE], cx.state.iter_checked(&settings), &settings, cx);
    }
}

fn check<'a, R: Rule>(
    required: &Required,
    jsdocs: impl Iterator<Item = JSDoc<'a>>,
    settings: &JSDocPluginSettings,
    cx: &Cx<'a, R>,
) {
    let preferred = match required.tags {
        [tag] => Some(settings.resolve_tag_name(tag)),
        _ => None,
    };
    for tag in jsdocs.flat_map(JSDoc::tags) {
        let name = tag.kind.parsed();
        let is_meant = preferred.map_or_else(|| required.tags.iter().any(|it| it.as_bytes() == name), |it| it == name);
        if is_meant && (required.is_missing)(tag) {
            cx.report(tag.kind.span, required.message);
        }
    }
}
