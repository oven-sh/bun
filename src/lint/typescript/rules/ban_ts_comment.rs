use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::text::{lines, number_to_string, trim, trim_start};
use bun_lint::utils::ts_utils::get_string_length;

/// Disallow `@ts-<directive>` comments or require descriptions after directives.
pub struct BanTsComment {
    minimum_description_length: f64,
    ts_check: DirectiveConfig,
    ts_expect_error: DirectiveConfig,
    ts_ignore: DirectiveConfig,
    ts_nocheck: DirectiveConfig,
}

enum DirectiveConfig {
    /// `false`, or an object without a `descriptionFormat`
    Allowed,
    /// `true`
    Banned,
    /// `"allow-with-description"`, or with the `descriptionFormat`
    AllowedWithDescription(Option<Box<Regex>>),
}

impl DirectiveConfig {
    fn new(option: Option<&Json>, default: DirectiveConfig) -> DirectiveConfig {
        match option {
            None => default,
            Some(Json::Bool(true)) => DirectiveConfig::Banned,
            Some(Json::String(_)) => DirectiveConfig::AllowedWithDescription(None),
            Some(option) => match Object::of(Some(option)).str("descriptionFormat") {
                None | Some("") => DirectiveConfig::Allowed,
                Some(format) => DirectiveConfig::AllowedWithDescription(Regex::new(format, "").ok().map(Box::new)),
            },
        }
    }
}

const REPLACE_TS_IGNORE_WITH_TS_EXPECT_ERROR: Message = Message::new(
    "replaceTsIgnoreWithTsExpectError",
    "Replace \"@ts-ignore\" with \"@ts-expect-error\".",
);
const TS_DIRECTIVE_COMMENT: Message = Message::new(
    "tsDirectiveComment",
    "Do not use \"@ts-{{directive}}\" because it alters compilation errors.",
);
const TS_DIRECTIVE_COMMENT_DESCRIPTION_NOT_MATCH_PATTERN: Message = Message::new(
    "tsDirectiveCommentDescriptionNotMatchPattern",
    "The description for the \"@ts-{{directive}}\" directive must match the {{format}} format.",
);
const TS_DIRECTIVE_COMMENT_REQUIRES_DESCRIPTION: Message = Message::new(
    "tsDirectiveCommentRequiresDescription",
    "Include a description after the \"@ts-{{directive}}\" directive to explain why the @ts-{{directive}} is necessary. The description must be {{minimumDescriptionLength}} characters or longer.",
);
const TS_IGNORE_INSTEAD_OF_EXPECT_ERROR: Message = Message::new(
    "tsIgnoreInsteadOfExpectError",
    "Use \"@ts-expect-error\" instead of \"@ts-ignore\", as \"@ts-ignore\" will do nothing if the following line is error-free.",
);

const TS_IGNORE: &[u8] = b"@ts-ignore";

struct MatchedTsDirective<'a> {
    directive: &'static str,
    description: &'a [u8],
}

/// `/^\s*@ts-(?<directive>a|b)(?<description>.*)/` for the `directives` `a` and `b`, on text
/// without line breaks after the directive.
fn match_directive<'a>(text: &'a [u8], directives: [&'static str; 2]) -> Option<MatchedTsDirective<'a>> {
    let rest = trim_start(text).strip_prefix(b"@ts-")?;
    directives.into_iter().find_map(|directive| {
        Some(MatchedTsDirective {
            directive,
            description: rest.strip_prefix(directive.as_bytes())?,
        })
    })
}

fn find_directive_in_comment(comment: Token<'_>) -> Option<MatchedTsDirective<'_>> {
    const SUPPRESSIONS: [&str; 2] = ["expect-error", "ignore"];
    let value = comment.comment_value();
    if comment.kind() == TokenKind::Line {
        // A pragma has two or three slashes.
        let mut rest = value.strip_prefix(b"/").unwrap_or(value);
        if let Some(pragma) = match_directive(rest, ["check", "nocheck"]) {
            return Some(pragma);
        }
        while let [b'/', after @ ..] = rest {
            rest = after;
        }
        return match_directive(rest, SUPPRESSIONS);
    }
    let mut rest = trim_start(lines(value).last()?);
    while let [b'/' | b'*', after @ ..] = rest {
        rest = after;
    }
    match_directive(rest, SUPPRESSIONS)
}

impl BanTsComment {
    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        for comment in file.comments() {
            let Some(MatchedTsDirective { directive, description }) = find_directive_in_comment(comment) else {
                continue;
            };
            // oxlint does not ask where the comment is.
            if directive == "nocheck"
                && !file.language().is_oxlint
                && let Some(first_statement) = file.body().first()
            {
                let start = first_statement.export_span().unwrap_or_else(|| first_statement.span()).start;
                if file.line_of(start) <= file.line_of(comment.start()) {
                    continue;
                }
            }
            let option = match directive {
                "check" => &self.ts_check,
                "expect-error" => &self.ts_expect_error,
                "ignore" => &self.ts_ignore,
                _ => &self.ts_nocheck,
            };
            // oxlint points at what is in the comment.
            let place = match cx.language().is_oxlint {
                true => Span::new(comment.start() + 2, comment.start() + 2 + comment.comment_value().len() as u32),
                false => comment.span(),
            };
            match option {
                DirectiveConfig::Allowed => {}
                // For oxlint it is a fix, of what is in the comment, and of every `@ts-ignore` there.
                DirectiveConfig::Banned if directive == "ignore" && cx.language().is_oxlint => {
                    cx.report(place, TS_IGNORE_INSTEAD_OF_EXPECT_ERROR).fix(|fixer| {
                        let value = comment.comment_value();
                        let parts: Vec<&[u8]> = strings::split(value, TS_IGNORE).collect();
                        fixer.replace(place, parts.join(&b"@ts-expect-error"[..]))
                    });
                }
                DirectiveConfig::Banned if directive == "ignore" => {
                    cx.report(place, TS_IGNORE_INSTEAD_OF_EXPECT_ERROR).suggest(
                        REPLACE_TS_IGNORE_WITH_TS_EXPECT_ERROR,
                        |fixer| {
                            let value = comment.comment_value();
                            let at = strings::index_of(value, TS_IGNORE)?;
                            let is_line_comment = comment.kind() == TokenKind::Line;
                            let open: &[u8] = if is_line_comment { b"//" } else { b"/*" };
                            let close: &[u8] = if is_line_comment { b"" } else { b"*/" };
                            let after = &value[at + TS_IGNORE.len()..];
                            Some(fixer.replace(
                                comment,
                                [open, &value[..at], b"@ts-expect-error", after, close].concat(),
                            ))
                        },
                    );
                }
                DirectiveConfig::Banned => {
                    cx.report(place, TS_DIRECTIVE_COMMENT).data("directive", directive);
                }
                DirectiveConfig::AllowedWithDescription(format) => {
                    if (get_string_length(trim(description)) as f64) < self.minimum_description_length {
                        cx.report(place, TS_DIRECTIVE_COMMENT_REQUIRES_DESCRIPTION)
                            .data("directive", directive)
                            .data(
                                "minimumDescriptionLength",
                                number_to_string(self.minimum_description_length),
                            );
                    } else if let Some(format) = format
                        && !format.test(description)
                    {
                        cx.report(place, TS_DIRECTIVE_COMMENT_DESCRIPTION_NOT_MATCH_PATTERN)
                            .data("directive", directive)
                            .data("format", format.source().to_vec());
                    }
                }
            }
        }
    }
}

impl Rule for BanTsComment {
    const META: Meta = Meta::typescript("ban-ts-comment", Kind::Problem)
        .has_suggestions()
        .presets(Presets::RECOMMENDED)
        .presets(Presets::STRICT);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        BanTsComment {
            minimum_description_length: options.number("minimumDescriptionLength").unwrap_or(3.0),
            ts_check: DirectiveConfig::new(options.get("ts-check"), DirectiveConfig::Allowed),
            ts_expect_error: DirectiveConfig::new(
                options.get("ts-expect-error"),
                DirectiveConfig::AllowedWithDescription(None),
            ),
            ts_ignore: DirectiveConfig::new(options.get("ts-ignore"), DirectiveConfig::Banned),
            ts_nocheck: DirectiveConfig::new(options.get("ts-nocheck"), DirectiveConfig::Banned),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if file.comments().any(|it| strings::contains(it.text(), b"@ts-")) {
            on.finish(Self::check);
        }
    }
}
