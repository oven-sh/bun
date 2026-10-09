use crate::oxlint::jsdoc::{JSDoc, JSDocFinder, JSDocPluginSettings};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::text::contains_name;

/// Reports invalid block tag names.
pub struct CheckTagNames {
    defined_tags: Vec<Box<[u8]>>,
    jsx_tags: bool,
    typed: bool,
}

const CHECK_TAG_NAMES: Message = Message::new("", "Invalid tag name found.");

/// Sorted.
const VALID_BLOCK_TAGS: [&str; 74] = [
    "abstract", "access", "alias", "async", "augments", "author", "borrows", "callback", "class", "classdesc", "constant",
    "constructs", "copyright", "default", "deprecated", "description", "enum", "event", "example", "exports", "external",
    "file", "fires", "function", "generator", "global", "hideconstructor", "ignore", "implements", "import", "inheritdoc",
    "inner", "instance", "interface", "internal", "kind", "lends", "license", "listens", "member", "memberof", "memberof!",
    "mixes", "mixin", "modifies", "module", "name", "namespace", "overload", "override", "package", "param", "private",
    "property", "protected", "public", "readonly", "requires", "returns", "satisfies", "see", "since", "static", "summary",
    "template", "this", "throws", "todo", "tutorial", "type", "typedef", "variation", "version", "yields",
];

const JSX_TAGS: [&str; 4] = ["jsx", "jsxFrag", "jsxImportSource", "jsxRuntime"];

/// Sorted.
const ALWAYS_INVALID_TAGS_IF_TYPED: [&str; 13] = [
    "augments", "callback", "class", "enum", "implements", "private", "property", "protected", "public", "readonly", "this",
    "type", "typedef",
];

/// Sorted.
const OUTSIDE_AMBIENT_INVALID_TAGS_IF_TYPED: [&str; 27] = [
    "abstract", "access", "class", "constant", "constructs", "enum", "export", "exports", "function", "global", "inherits",
    "instance", "interface", "member", "memberOf", "memberof", "method", "mixes", "mixin", "module", "name", "namespace",
    "override", "property", "requires", "static", "this",
];

impl Rule for CheckTagNames {
    const META: Meta = Meta::oxlint(Plugin::Jsdoc, "check-tag-names", Kind::Problem);
    type State<'a> = JSDocFinder<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        CheckTagNames {
            defined_tags: options.strings("definedTags").iter().map(|it| it.as_bytes().into()).collect(),
            jsx_tags: options.bool_or("jsxTags", false),
            typed: options.bool_or("typed", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> JSDocFinder<'a> {
        let finder = JSDocFinder::new(file);
        if !finder.is_empty() {
            on.finish(|rule, cx| {
                let settings = JSDocPluginSettings::new(cx.file());
                let is_ambient = cx.file().path().ends_with(b".d.ts");
                for tag in cx.state.iter_checked(&settings).flat_map(JSDoc::tags) {
                    let tag_name = tag.kind.parsed();
                    let is_redundant_if_typed = || {
                        contains_name(&ALWAYS_INVALID_TAGS_IF_TYPED, tag_name)
                            || tag_name == b"template" && tag.comment().is_empty()
                            || !is_ambient && contains_name(&OUTSIDE_AMBIENT_INVALID_TAGS_IF_TYPED, tag_name)
                    };
                    let is_valid = || rule.jsx_tags && contains_name(&JSX_TAGS, tag_name) || contains_name(&VALID_BLOCK_TAGS, tag_name);
                    if !settings.is_user_defined_tag_name(tag_name)
                        && !rule.defined_tags.iter().any(|it| **it == *tag_name)
                        && (settings.is_blocked_tag_name(tag_name)
                            || settings.has_preferred_tag_name(tag_name)
                            || rule.typed && is_redundant_if_typed()
                            || !is_valid())
                    {
                        cx.report(tag.kind.span, CHECK_TAG_NAMES).help_with(|| {
                            let is_in = |tags: &[&str]| rule.typed && contains_name(tags, tag_name);
                            let what = if is_in(&ALWAYS_INVALID_TAGS_IF_TYPED) {
                                "is redundant when using a type system."
                            } else if rule.typed && tag_name == b"template" && tag.comment().is_empty() {
                                "without a name is redundant when using a type system."
                            } else if !is_ambient && is_in(&OUTSIDE_AMBIENT_INVALID_TAGS_IF_TYPED) {
                                "is redundant outside of ambient(`declare` or `.d.ts`) contexts when using a type system."
                            } else {
                                "is invalid tag name."
                            };
                            let reason = settings.reason_against_tag_name(tag_name);
                            reason.unwrap_or_else(|| format!("`@{}` {what}", bstr::BStr::new(tag_name)))
                        });
                    }
                }
            });
        }
        finder
    }
}
