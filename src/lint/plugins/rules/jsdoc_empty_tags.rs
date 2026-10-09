use crate::oxlint::jsdoc::{JSDoc, JSDocFinder};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::text::contains_name;

/// Expects various JSDoc tags to be empty of content.
pub struct EmptyTags {
    tags: Vec<Box<[u8]>>,
}

const EMPTY_TAGS_MESSAGE: Message = Message::new("", "Expects the void tags to be empty of any content.");

/// Sorted.
const EMPTY_TAGS: [&str; 18] = [
    "abstract", "async", "generator", "global", "hideconstructor", "ignore", "inheritDoc", "inner", "instance", "internal",
    "overload", "override", "package", "private", "protected", "public", "readonly", "static",
];

impl Rule for EmptyTags {
    const META: Meta = Meta::oxlint(Plugin::Jsdoc, "empty-tags", Kind::Suggestion);
    type State<'a> = JSDocFinder<'a>;

    fn new(options: &Options) -> Self {
        EmptyTags { tags: options.object(0).strings("tags").iter().map(|it| it.as_bytes().into()).collect() }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> JSDocFinder<'a> {
        let finder = JSDocFinder::new(file);
        if !finder.is_empty() {
            on.finish(|rule, cx| {
                for tag in cx.state.iter_all().flat_map(JSDoc::tags) {
                    let tag_name = tag.kind.parsed();
                    let comment = tag.comment();
                    if (contains_name(&EMPTY_TAGS, tag_name)
                        || rule.tags.iter().any(|it| **it == *tag_name))
                        && !comment.is_empty()
                    {
                        cx.report(comment.span_trimmed_first_line(), EMPTY_TAGS_MESSAGE);
                    }
                }
            });
        }
        finder
    }
}
