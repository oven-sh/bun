use bun_lint::prelude::*;

/// Enforce a maximum number of classes per file.
pub struct MaxClassesPerFile {
    ignores_expressions: bool,
    max: usize,
}

const MAXIMUM_EXCEEDED: Message = Message::new(
    "maximumExceeded",
    "File has too many classes ({{ classCount }}). Maximum allowed is {{ max }}.",
);

impl Rule for MaxClassesPerFile {
    const META: Meta = Meta::eslint("max-classes-per-file", Kind::Suggestion);
    /// The number of classes that count.
    type State<'a> = usize;

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        MaxClassesPerFile {
            ignores_expressions: object.bool_or("ignoreExpressions", false),
            max: (options.number(0).map(|max| max as usize))
                .or_else(|| object.usize("max").filter(|max| *max != 0))
                .unwrap_or(1),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> usize {
        on.classes(|rule, class, cx| {
            if !rule.ignores_expressions || matches!(class.owner(), Node::Stmt(_)) {
                cx.state += 1;
            }
        });
        on.finish(|rule, cx| {
            let body = cx.file().body();
            if cx.state > rule.max
                && let (Some(first), Some(last)) = (body.first(), body.last())
            {
                let start = first.export_span().unwrap_or_else(|| first.span()).start;
                // oxlint points at the first byte.
                let end = if cx.language().is_oxlint { start + 1 } else { last.span().end };
                cx.report(Span::new(start, end), MAXIMUM_EXCEEDED)
                    .data("classCount", cx.state)
                    .data("max", rule.max);
            }
        });
        0
    }
}
