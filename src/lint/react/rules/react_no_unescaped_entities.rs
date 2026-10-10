use crate::react::is_jsx;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule prevents characters that you may have meant as JSX escape characters from being accidentally injected as a
/// text node in JSX statements.
pub struct NoUnescapedEntities;

const NO_UNESCAPED_ENTITIES: Message = Message::new("", "`{{unescaped}}` can be escaped with {{escaped}}");
const REPLACE: Message = Message::new("", "Replace with `{{alt}}`");

impl Rule for NoUnescapedEntities {
    const META: Meta = Meta::oxlint(Plugin::React, "no-unescaped-entities", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnescapedEntities
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        is_jsx(file).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        for jsx_text in
            jsx.children().iter().filter(|it| it.tag() == ExprTag::String && it.jsx_container_span().is_none())
        {
            let (source, mut at) = (jsx_text.text(), 0);
            while let Some(found) = source.get(at..).and_then(|rest| strings::index_of_any(rest, b"'\"")) {
                at += found + 1;
                let end = jsx_text.span().start + at as u32;
                let span = Span::new(end - 1, end);
                let (unescaped, escaped, alternatives) = match source.get(at - 1) {
                    Some(b'"') => {
                        ("\"", "&quot; or &ldquo; or &#34; or &rdquo;", ["&quot;", "&ldquo;", "&#34;", "&rdquo;"])
                    }
                    _ => ("'", "&apos; or &lsquo; or &#39; or &rsquo;", ["&apos;", "&lsquo;", "&#39;", "&rsquo;"]),
                };
                let report =
                    cx.report(span, NO_UNESCAPED_ENTITIES).data("unescaped", unescaped).data("escaped", escaped);
                drop(alternatives.into_iter().fold(report, |report, alt| {
                    report.suggest_with(REPLACE, &[("alt", alt.as_bytes())], |fixer| fixer.replace(span, alt))
                }));
            }
        }
    }
}
