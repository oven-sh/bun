use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;

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

/// By a node: whether it is out of reach of `utils::get_node_by_range_index`.
type State<'a> = AncestorMemo<'a, bool>;

/// The range of a node that `utils::get_node_by_range_index` goes by.
fn searched_span(node: Node<'_>) -> Span {
    match node {
        Node::Param(_) => utils::estree_span(node),
        Node::Stmt(statement) => statement.export_span().unwrap_or_else(|| statement.span()),
        _ => node.span(),
    }
}

/// `utils::get_node_by_range_index(file, offset)` for an `offset` in `node`. It starts at `node`, not at
/// the file, from where the way is long to each of the braces that are deep in each other.
fn get_node_by_range_index_in<'a>(node: Node<'a>, offset: u32, state: &mut State<'a>) -> Node<'a> {
    // The search from the file does not enter what does not have the offset in its range, as with a
    // decorator that ESTree has outside of the range of what it belongs to.
    let is_out_of_reach = state.find(node, |child, parent| {
        (!searched_span(parent).contains_offset(child.span().start)).then_some(true)
    });
    if is_out_of_reach == Some(true) {
        return utils::get_node_by_range_index(node.file(), offset);
    }
    let mut at = node;
    loop {
        let mut inner = None;
        at.for_each_child_near(offset, |child| {
            if inner.is_none() && searched_span(child).contains_offset(offset) {
                inner = Some(child);
            }
        });
        match inner {
            Some(child) => at = child,
            None => return at,
        }
    }
}

impl ObjectCurlySpacing {
    /// ESLint's `validateBraceSpacing`. `open` and `close` are the positions of the braces in `node`, between
    /// which there is something. What is next to a brace, a token or a comment, is found by
    /// skipping whitespace.
    fn validate_brace_spacing<'a>(&self, node: Node<'a>, open: u32, close: u32, cx: &mut Cx<'a, Self>) {
        self.validate_brace_spacing_around(node, open, close, None, cx);
    }

    /// `inner_close`: a `}` that is known to end an `ObjectExpression`.
    fn validate_brace_spacing_around<'a>(
        &self,
        node: Node<'a>,
        open: u32,
        close: u32,
        inner_close: Option<u32>,
        cx: &mut Cx<'a, Self>,
    ) {
        let source = cx.file().text();
        if source.get(open as usize) != Some(&b'{') || source.get(close as usize) != Some(&b'}') {
            return;
        }

        let after = source.get(open as usize + 1..).unwrap_or_default();
        let rest = strings::trim_js_whitespace_start(after);
        let gap = Span::new(open + 1, open + 1 + (after.len() - rest.len()) as u32);
        if !strings::contains_js_line_break(cx.slice(gap)) {
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

        let penultimate_end =
            strings::trim_js_whitespace_end(source.get(..close as usize).unwrap_or_default()).len() as u32;
        let gap = Span::new(penultimate_end, close);
        if !strings::contains_js_line_break(cx.slice(gap)) {
            let penultimate = penultimate_end.saturating_sub(1);
            let mut penultimate_type =
                || utils::estree_type_name(get_node_by_range_index_in(node, penultimate, &mut cx.state));
            let is_exception = match source.get(penultimate as usize) {
                Some(b']') if self.arrays_in_objects_exception => penultimate_type() == "ArrayExpression",
                Some(b'}') if self.objects_in_objects_exception => {
                    inner_close == Some(penultimate)
                        || matches!(penultimate_type(), "ObjectExpression" | "ObjectPattern")
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
    fn check_specifiers<'a>(&self, statement: Stmt<'a>, first: Span, last: Span, cx: &mut Cx<'a, Self>) {
        let source = cx.file().text();
        let open = cx.file().end_of_token_before(first.start).saturating_sub(1);
        let mut close = skip_trivia(source, last.end);
        if source.get(close as usize) == Some(&b',') {
            close = skip_trivia(source, close + 1);
        }
        self.validate_brace_spacing(Node::Stmt(statement), open, close, cx);
    }
}

impl Rule for ObjectCurlySpacing {
    const META: Meta = Meta::eslint("object-curly-spacing", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    const ON: On = On::new()
        .exprs(&[ExprTag::Object])
        .pats(&[PatTag::Object])
        .types(&[TypeTag::Import])
        .stmts(&[StmtTag::Import, StmtTag::ExportNamed]);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let spaced = options.str(0) == Some("always");
        let is_option_set = |option| options.object(1).bool(option) == Some(!spaced);
        ObjectCurlySpacing {
            spaced,
            arrays_in_objects_exception: is_option_set("arraysInObjects"),
            objects_in_objects_exception: is_option_set("objectsInObjects"),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State<'a>> {
        Some(State::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if matches!(e.kind(), ExprKind::Object(props) if !props.is_empty()) {
            let span = e.span();
            self.validate_brace_spacing(Node::Expr(e), span.start, span.end.saturating_sub(1), cx);
        }
    }

    fn pat<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        if matches!(pat.kind(), PatKind::Object(props) if !props.is_empty()) {
            let span = pat.span();
            self.validate_brace_spacing(Node::Pat(pat), span.start, span.end.saturating_sub(1), cx);
        }
    }

    // ESLint has `{ with: { type: "json" } }` in `import("m", { with: { type: "json" } })` as two
    // object literals.
    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let Some(attributes) = ty.import_attributes() else {
            return;
        };
        let (outer, inner) = (attributes.options_span(), attributes.braces_span());
        let inner_close = inner.end.saturating_sub(1);
        if !attributes.entries().is_empty() {
            self.validate_brace_spacing(Node::Type(ty), inner.start, inner_close, cx);
        }
        let outer_close = outer.end.saturating_sub(1);
        self.validate_brace_spacing_around(Node::Type(ty), outer.start, outer_close, Some(inner_close), cx);
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let ends = match statement.kind() {
            StmtKind::Import(import) => import.named().first().zip(import.named().last()).map(|it| (it.0.span(), it.1.span())),
            StmtKind::ExportNamed(export) => export.items().first().zip(export.items().last()).map(|it| (it.0.span(), it.1.span())),
            _ => None,
        };
        if let Some((first, last)) = ends {
            self.check_specifiers(statement, first, last, cx);
        }
    }
}
