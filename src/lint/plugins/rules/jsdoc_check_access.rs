use crate::oxlint::jsdoc::{JSDocFinder, JSDocPluginSettings, should_ignore_as_internal};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Checks that `@access` tags use one of the allowed values.
pub struct CheckAccess;

const INVALID_ACCESS_LEVEL: Message = Message::new("", "Invalid access level is specified or missing.");
const REDUNDANT_ACCESS_TAGS: Message =
    Message::new("", "Mixing of `@access` with `@public`, `@private`, `@protected`, or `@package` on the same doc block.");

const ACCESS_LEVELS: [&str; 4] = ["package", "private", "protected", "public"];

impl Rule for CheckAccess {
    const META: Meta = Meta::oxlint(Plugin::Jsdoc, "check-access", Kind::Suggestion);
    type State<'a> = JSDocFinder<'a>;

    fn new(_: &Options) -> Self {
        CheckAccess
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> JSDocFinder<'a> {
        let finder = JSDocFinder::new(file);
        if !finder.is_empty() {
            on.finish(|_, cx| {
                let settings = JSDocPluginSettings::new(cx.file());
                let resolved_access_tag_name = settings.resolve_tag_name("access");
                let resolved_access_levels = ACCESS_LEVELS.map(|level| settings.resolve_tag_name(level));
                for jsdoc in cx.state.iter_all().filter(|it| !should_ignore_as_internal(*it, &settings)) {
                    let mut access_related_tags_count = 0;
                    for tag in jsdoc.tags() {
                        let tag_name = tag.kind.parsed();
                        if tag_name == resolved_access_tag_name || resolved_access_levels.contains(&tag_name) {
                            access_related_tags_count += 1;
                        }
                        let comment = tag.comment();
                        if tag_name == resolved_access_tag_name
                            && !comment.single_line().is_some_and(|it| ACCESS_LEVELS.iter().any(|level| level.as_bytes() == it))
                        {
                            cx.report(comment.span_trimmed_first_line(), INVALID_ACCESS_LEVEL);
                        }
                        if access_related_tags_count > 1 {
                            cx.report(tag.kind.span, REDUNDANT_ACCESS_TAGS);
                        }
                    }
                }
            });
        }
        finder
    }
}
