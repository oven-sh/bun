use bun_lint::prelude::*;

/// Enforce consistent spacing inside braces.
pub struct ObjectCurlySpacing {
    spaced: bool,
    arrays_in_objects_exception: bool,
    objects_in_objects_exception: bool,
}

const REQUIRE_SPACE_BEFORE: Message =
    Message::new("requireSpaceBefore", "A space is required before '{{token}}'.");
const REQUIRE_SPACE_AFTER: Message =
    Message::new("requireSpaceAfter", "A space is required after '{{token}}'.");
const UNEXPECTED_SPACE_BEFORE: Message =
    Message::new("unexpectedSpaceBefore", "There should be no space before '{{token}}'.");
const UNEXPECTED_SPACE_AFTER: Message =
    Message::new("unexpectedSpaceAfter", "There should be no space after '{{token}}'.");

impl ObjectCurlySpacing {
    /// ESLint's `validateBraceSpacing`. `open` and `close` are the positions of the braces, between
    /// which there is something. What is next to a brace, a token or a comment, is found by
    /// skipping whitespace.
    fn validate_brace_spacing(&self, open: u32, close: u32, cx: &Cx<'_, Self>) {
        let source = cx.text();
        if source.get(open as usize) != Some(&b'{') || source.get(close as usize) != Some(&b'}') {
            return;
        }

        let after = source.get(open as usize + 1..).unwrap_or_default();
        let rest = text::trim_start(after);
        let gap = Span::new(open + 1, open + 1 + (after.len() - rest.len()) as u32);
        if !text::has_line_break(cx.slice(gap)) {
            if self.spaced && gap.is_empty() {
                let brace = Span::new(open, open + 1);
                cx.report(brace, REQUIRE_SPACE_AFTER)
                    .data("token", "{")
                    .fix(|fixer| fixer.insert_after(brace, " "));
            }
            let is_line_comment = rest.starts_with(b"//") || rest.starts_with(b"<!--");
            if !self.spaced && !gap.is_empty() && !is_line_comment {
                cx.report(gap, UNEXPECTED_SPACE_AFTER).data("token", "{").fix(|fixer| fixer.remove(gap));
            }
        }

        let penultimate_end = text::trim_end(source.get(..close as usize).unwrap_or_default()).len() as u32;
        let gap = Span::new(penultimate_end, close);
        if !text::has_line_break(cx.slice(gap)) {
            let penultimate = penultimate_end.saturating_sub(1);
            let penultimate_type = || utils::estree_type_name(utils::get_node_by_range_index(cx.file(), penultimate));
            let is_exception = match source.get(penultimate as usize) {
                Some(b']') if self.arrays_in_objects_exception => penultimate_type() == "ArrayExpression",
                Some(b'}') if self.objects_in_objects_exception => {
                    matches!(penultimate_type(), "ObjectExpression" | "ObjectPattern")
                }
                _ => false,
            };
            let must_be_spaced = self.spaced != is_exception;
            if must_be_spaced && gap.is_empty() {
                let brace = Span::new(close, close + 1);
                cx.report(brace, REQUIRE_SPACE_BEFORE)
                    .data("token", "}")
                    .fix(|fixer| fixer.insert_before(brace, " "));
            }
            if !must_be_spaced && !gap.is_empty() {
                cx.report(gap, UNEXPECTED_SPACE_BEFORE).data("token", "}").fix(|fixer| fixer.remove(gap));
            }
        }
    }

    /// The braces around the specifiers of an import or an export, of which `first` and `last` are
    /// the ranges.
    fn check_specifiers(&self, first: Span, last: Span, cx: &Cx<'_, Self>) {
        let source = cx.text();
        let open = skip_trivia_back(source, first.start).saturating_sub(1);
        let mut close = skip_trivia(source, last.end);
        if source.get(close as usize) == Some(&b',') {
            close = skip_trivia(source, close + 1);
        }
        self.validate_brace_spacing(open, close, cx);
    }
}

impl Rule for ObjectCurlySpacing {
    const META: Meta = Meta::eslint("object-curly-spacing", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let spaced = options.str(0) == Some("always");
        let is_option_set = |option| options.object(1).bool(option) == Some(!spaced);
        ObjectCurlySpacing {
            spaced,
            arrays_in_objects_exception: is_option_set("arraysInObjects"),
            objects_in_objects_exception: is_option_set("objectsInObjects"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Object], |rule, e, cx| {
            if matches!(e.kind(), ExprKind::Object(props) if !props.is_empty()) {
                let span = e.span();
                rule.validate_brace_spacing(span.start, span.end.saturating_sub(1), cx);
            }
        });
        on.pats([PatTag::Object], |rule, pat, cx| {
            if matches!(pat.kind(), PatKind::Object(props) if !props.is_empty()) {
                let span = pat.span();
                rule.validate_brace_spacing(span.start, span.end.saturating_sub(1), cx);
            }
        });
        on.stmts([StmtTag::Import, StmtTag::ExportNamed], |rule, statement, cx| {
            let ends = match statement.kind() {
                StmtKind::Import(import) => import.named().first().zip(import.named().last()).map(|it| (it.0.span(), it.1.span())),
                StmtKind::ExportNamed(export) => export.items().first().zip(export.items().last()).map(|it| (it.0.span(), it.1.span())),
                _ => None,
            };
            if let Some((first, last)) = ends {
                rule.check_specifiers(first, last, cx);
            }
        });
    }
}
