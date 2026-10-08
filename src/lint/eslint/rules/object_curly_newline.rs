use bun_lint::prelude::*;

/// Enforce consistent line breaks after opening and before closing braces.
pub struct ObjectCurlyNewline {
    object_expression: OptionValue,
    object_pattern: OptionValue,
    import_declaration: OptionValue,
    export_declaration: OptionValue,
}

#[derive(Copy, Clone)]
struct OptionValue {
    is_multiline: bool,
    /// `usize::MAX`: no number of properties requires line breaks.
    min_properties: usize,
    is_consistent: bool,
}

const UNEXPECTED_LINEBREAK_BEFORE_CLOSING_BRACE: Message = Message::new(
    "unexpectedLinebreakBeforeClosingBrace",
    "Unexpected line break before this closing brace.",
);
const UNEXPECTED_LINEBREAK_AFTER_OPENING_BRACE: Message = Message::new(
    "unexpectedLinebreakAfterOpeningBrace",
    "Unexpected line break after this opening brace.",
);
const EXPECTED_LINEBREAK_BEFORE_CLOSING_BRACE: Message = Message::new(
    "expectedLinebreakBeforeClosingBrace",
    "Expected a line break before this closing brace.",
);
const EXPECTED_LINEBREAK_AFTER_OPENING_BRACE: Message = Message::new(
    "expectedLinebreakAfterOpeningBrace",
    "Expected a line break after this opening brace.",
);

/// ESLint's `normalizeOptionValue`.
fn normalize_option_value(value: Option<&Json>) -> OptionValue {
    let (is_multiline, min_properties, is_consistent) = match (value, value.and_then(Json::as_str)) {
        (None, _) => (false, usize::MAX, true),
        (_, Some(b"always")) => (false, 0, false),
        (_, Some(_)) => (false, usize::MAX, false),
        (Some(_), None) => {
            let object = Object::of(value);
            (
                object.bool_or("multiline", false),
                object.usize("minProperties").filter(|&min| min != 0).unwrap_or(usize::MAX),
                object.bool_or("consistent", false),
            )
        }
    };
    OptionValue {
        is_multiline,
        min_properties,
        is_consistent,
    }
}

/// `node`: the range of ESLint's node, up to its type annotation. `count`: how many properties or
/// specifiers are in the braces. `annotation`: the range of ESLint's `node.typeAnnotation`.
fn check<'a>(
    cx: &Cx<'a, ObjectCurlyNewline>,
    options: OptionValue,
    node: Span,
    count: usize,
    annotation: Option<Span>,
) -> Option<()> {
    let file = cx.file();
    if count < options.min_properties && !text::has_line_break(file.slice(node)) {
        return None;
    }
    let open_brace = file.tokens_in(node).find(|token| token.is("{"))?;
    let close_brace = match annotation {
        Some(annotation) => file.token_before(annotation)?,
        None => file.tokens_in(node).rfind(|token| token.is("}"))?,
    };
    let first_inc_comment = file.tokens_after(open_brace).with_comments().next()?;
    let last_inc_comment = file.tokens_before(close_brace).with_comments().next()?;
    let needs_line_breaks = count >= options.min_properties
        || (options.is_multiline
            && count > 0
            && file.line_of(first_inc_comment.start()) != file.line_of(last_inc_comment.end()));
    let has_comments_first_token = first_inc_comment.is_comment();
    let has_comments_last_token = last_inc_comment.is_comment();

    let first = file.token_after(open_brace)?;
    let last = file.token_before(close_brace)?;
    let has_line_break_after_open_brace = !ast_utils::is_token_on_same_line(file, open_brace, first);
    let has_line_break_before_close_brace = !ast_utils::is_token_on_same_line(file, last, close_brace);

    if needs_line_breaks {
        if !has_line_break_after_open_brace {
            cx.report(open_brace, EXPECTED_LINEBREAK_AFTER_OPENING_BRACE)
                .fix(|fixer| (!has_comments_first_token).then(|| fixer.insert_after(open_brace, "\n")));
        }
        if !has_line_break_before_close_brace {
            cx.report(close_brace, EXPECTED_LINEBREAK_BEFORE_CLOSING_BRACE)
                .fix(|fixer| (!has_comments_last_token).then(|| fixer.insert_before(close_brace, "\n")));
        }
        return Some(());
    }
    if has_line_break_after_open_brace && !(options.is_consistent && has_line_break_before_close_brace) {
        cx.report(open_brace, UNEXPECTED_LINEBREAK_AFTER_OPENING_BRACE).fix(|fixer| {
            (!has_comments_first_token).then(|| fixer.remove(open_brace.span().between(first.span())))
        });
    }
    if has_line_break_before_close_brace && !(options.is_consistent && has_line_break_after_open_brace) {
        cx.report(close_brace, UNEXPECTED_LINEBREAK_BEFORE_CLOSING_BRACE).fix(|fixer| {
            (!has_comments_last_token).then(|| fixer.remove(last.span().between(close_brace.span())))
        });
    }
    Some(())
}

impl Rule for ObjectCurlyNewline {
    const META: Meta = Meta::eslint("object-curly-newline", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        let is_node_specific = |value: &Json| value.as_object().is_some() || value.as_str().is_some();
        if object.entries().iter().any(|entry| is_node_specific(&entry.1)) {
            return ObjectCurlyNewline {
                object_expression: normalize_option_value(object.get("ObjectExpression")),
                object_pattern: normalize_option_value(object.get("ObjectPattern")),
                import_declaration: normalize_option_value(object.get("ImportDeclaration")),
                export_declaration: normalize_option_value(object.get("ExportDeclaration")),
            };
        }
        let value = normalize_option_value(options.get(0));
        ObjectCurlyNewline {
            object_expression: value,
            object_pattern: value,
            import_declaration: value,
            export_declaration: value,
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Object], |rule, e, cx| {
            let ExprKind::Object(props) = e.kind() else {
                return;
            };
            let options = match utils::is_assignment_target(e) {
                true => rule.object_pattern,
                false => rule.object_expression,
            };
            check(cx, options, e.span(), props.len(), None);
        });
        on.pats([PatTag::Object], |rule, pat, cx| {
            let PatKind::Object(props) = pat.kind() else {
                return;
            };
            let ty = match pat.parent() {
                // That of `...{ a }: T` belongs to the `RestElement`.
                Node::Param(param) if !param.is_rest() => param.ty(),
                Node::VarDecl(declaration) => declaration.ty(),
                _ => None,
            };
            let annotation = ty.map(TypeNode::annotation_span);
            let node = Span::new(pat.span().start, annotation.map_or(pat.span().end, |it| it.start));
            check(cx, rule.object_pattern, node, props.len(), annotation);
        });
        on.stmts([StmtTag::Import, StmtTag::ExportNamed], |rule, statement, cx| {
            let (options, count) = match statement.kind() {
                StmtKind::Import(import) => (rule.import_declaration, import.named().len()),
                StmtKind::ExportNamed(export) => (rule.export_declaration, export.items().len()),
                _ => return,
            };
            if count > 0 {
                check(cx, options, statement.span(), count, None);
            }
        });
    }
}
