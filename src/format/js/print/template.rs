//! Template literals. Prettier's `printTemplateLiteral`.
//!
//! The text is printed as is. The content of `${}` is formatted, but kept on one line unless it has a line break in the
//! source.

use super::type_parameters::type_arguments;
use crate::css::embed;
use crate::cursor::with_node_marks_at;
use crate::ir::width::string_width_as;
use crate::js::utils::call_expression::is_test_each_pattern;
use crate::js::utils::tailwindcss::{
    InTailwindContext, context_of_function, has_white_space, sorted_template_text,
};
use crate::js::utils::typecast::has_comments;
use crate::prelude::*;
use crate::{format_args, write};

/// True if Prettier's `embed` could apply to the template `e`. For most templates it can't.
fn may_have_embedded_language<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    match e.ast_parent() {
        AstNodes::TaggedTemplateExpression(_)
        | AstNodes::JSXExpressionContainer(_)
        | AstNodes::ObjectProperty(_)
        | AstNodes::ArrayExpression(_) => true,
        AstNodes::CallExpression(call)
            if call
                .callee()
                .is_some_and(|callee| callee.text() == b"graphql") =>
        {
            true
        }
        _ => crate::graphql::embed::may_have_language_comment(e, f),
    }
}

/// Prettier's `isJestEachTemplateLiteral`, plus `printJestEachTemplateLiteral`'s check that the table has a header.
fn is_jest_each_template_literal<'a>(e: Expr<'a>, template: Template<'a>) -> bool {
    matches!(e.parent(), Node::Expr(parent)
        if matches!(parent.kind(), ExprKind::TaggedTemplate(call)
            if call.template() == Some(e) && is_test_each_pattern(call.callee())))
        && !template.raw(0).trim_ascii().is_empty()
}

/// `` `a${b}c` ``
#[inline(never)]
pub(crate) fn write_template_literal<'a>(
    e: Expr<'a>,
    template: Template<'a>,
    f: &mut Formatter<'a>,
) {
    if is_jest_each_template_literal(e, template) {
        return EachTemplateTable::from_template(template, f).fmt(f);
    }
    let context = f.context().tailwind_context();
    let content = format_with(|f| {
        if !may_have_embedded_language(e, f)
            || (!embed::write_template(e, template, f)
                && !crate::graphql::embed::write_template(e, template, f)
                && !crate::html::in_js::write_template(e, template, f)
                && !crate::markdown::embed::write_template(e, template, f))
        {
            TemplateLike::TemplateLiteral(template).fmt(f);
        }
    });
    InTailwindContext(context.map(|it| it.in_template(e, f)), content).fmt(f);
}

/// `${e}` at `i` in a template that's printed as its embedded language. Prettier's `printEmbeddedTemplateExpressions`.
pub(crate) fn write_embedded_template_expression<'a>(
    template: Template<'a>,
    i: usize,
    f: &mut Formatter<'a>,
) {
    let template = TemplateLike::TemplateLiteral(template);
    if let Some(expression) = template.expression(i) {
        let expression = FormatTemplateExpression {
            expression,
            interpolation: template.interpolation_span(i),
            line_position: LinePosition::Unknown,
        };
        expression.fmt(f);
    }
}

/// `` tag`a${b}c` ``. Prettier's `printTaggedTemplateExpression`.
#[inline(never)]
pub(crate) fn write_tagged_template_expression<'a>(
    e: Expr<'a>,
    call: Call<'a>,
    f: &mut Formatter<'a>,
) {
    write!(
        f,
        [
            call.callee(),
            type_arguments(call.type_args(), Node::Expr(e))
        ]
    );
    let Some(quasi) = call.template() else {
        return;
    };
    if !f.is_quiet()
        && let Some(comment) = f.comments().of_node(quasi.as_ast_nodes()).leading.first()
    {
        let tag_end = (call.type_args().angle_brackets_span())
            .map_or_else(|| call.callee().span().end, |it| it.end);
        match (f.source_text()).contains_newline(Span::before(tag_end, comment.span())) {
            true => write!(f, soft_line_break()),
            false => write!(f, space()),
        }
    }
    let context = context_of_function(call.callee(), f);
    write!(
        f,
        [line_suffix_boundary(), InTailwindContext(context, quasi)]
    );
}

/// `` `a${B}c` `` in a type
pub(crate) fn write_ts_template_literal_type<'a>(ty: TypeNode<'a>, f: &mut Formatter<'a>) {
    if let Some(template) = ty.as_template() {
        TemplateLike::TSTemplateLiteralType(template).fmt(f);
    }
}

#[derive(Debug, Clone, Copy)]
enum TemplateElementLayout {
    /// On one line, however long it is.
    SingleLine,
    /// Breaks where it has to.
    Fit,
}

/// How many columns the line of a `${` is indented by.
#[derive(Debug, Copy, Clone, Default)]
struct TemplateElementIndention(u32);

impl TemplateElementIndention {
    fn level(self, indent_width: IndentWidth) -> u32 {
        self.0 / indent_width.value().max(1)
    }

    fn align(self, indent_width: IndentWidth) -> u32 {
        self.0 % indent_width.value().max(1)
    }

    /// The indentation of `text`'s last line, or `previous_indention` if `text` is all on one line.
    fn after_last_new_line(text: &[u8], tab_width: u32, previous_indention: Self) -> Self {
        use bun_core::strings::last_index_of_char;
        let Some(new_line) = last_index_of_char(text, b'\n').max(last_index_of_char(text, b'\r'))
        else {
            return previous_indention;
        };
        let mut size: u32 = 0;
        for byte in text.get(new_line + 1..).unwrap_or_default() {
            match byte {
                b'\t' => size = size + tab_width - (size % tab_width.max(1)),
                b' ' => size += 1,
                _ => break,
            }
        }
        Self(size)
    }
}

#[derive(Copy, Clone)]
enum TemplateLike<'a> {
    TemplateLiteral(Template<'a>),
    TSTemplateLiteralType(TypeTemplate<'a>),
}

impl<'a> TemplateLike<'a> {
    fn quasi_count(self) -> usize {
        match self {
            Self::TemplateLiteral(t) => t.quasi_count(),
            Self::TSTemplateLiteralType(t) => t.quasi_count(),
        }
    }

    fn raw(self, i: usize) -> &'a [u8] {
        match self {
            Self::TemplateLiteral(t) => t.raw(i),
            Self::TSTemplateLiteralType(t) => t.raw(i),
        }
    }

    /// The span of the text at `i`, without its delimiters: the range of ESTree's `TemplateElement`.
    fn content_span(self, i: usize) -> Span {
        let span = match self {
            Self::TemplateLiteral(t) => t.quasi_span(i),
            Self::TSTemplateLiteralType(t) => t.quasi_span(i),
        };
        span.shrink(1, if i + 1 == self.quasi_count() { 1 } else { 2 })
    }

    fn expression(self, i: usize) -> Option<TemplateExpression<'a>> {
        match self {
            Self::TemplateLiteral(t) => t.exprs().get(i).map(TemplateExpression::Expression),
            Self::TSTemplateLiteralType(t) => t.types().get(i).map(TemplateExpression::TSType),
        }
    }

    /// The span between the `${` and the `}` of the substitution at `i`.
    fn interpolation_span(self, i: usize) -> Span {
        match self {
            Self::TemplateLiteral(t) => t.quasi_span(i).between(t.quasi_span(i + 1)),
            Self::TSTemplateLiteralType(t) => t.quasi_span(i).between(t.quasi_span(i + 1)),
        }
    }

    /// The substitutions. `is_in_jest_each` means they're the cells of a table, which is indented.
    fn expressions(
        self,
        is_in_jest_each: bool,
        f: &Formatter<'a>,
    ) -> impl Iterator<Item = FormatTemplateExpression<'a>> + use<'a> {
        let tab_width = f.options().indent_width.value();
        let mut indention = TemplateElementIndention::default();
        (0..self.quasi_count()).map_while(move |i| {
            let quasi_text = self.raw(i);
            indention =
                TemplateElementIndention::after_last_new_line(quasi_text, tab_width, indention);
            let indention = match is_in_jest_each {
                true => TemplateElementIndention(indention.0.max(tab_width)),
                false => indention,
            };
            Some(FormatTemplateExpression {
                expression: self.expression(i)?,
                interpolation: self.interpolation_span(i),
                line_position: match indention.0 == 0
                    && matches!(quasi_text.last(), Some(b'\n' | b'\r'))
                {
                    true => LinePosition::StartOfLine,
                    false => LinePosition::After(indention),
                },
            })
        })
    }
}

impl<'a> Format<'a> for TemplateLike<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        write!(f, [line_suffix_boundary(), "`"]);
        let context = f.context().tailwind_context();
        // The line breaks between classes are removed, so they can't tell where a `${` ends up.
        let collapses_line_breaks = context.is_some_and(|it| it.collapses_line_breaks());
        let mut expressions = self
            .expressions(false, f)
            .map(|it| match collapses_line_breaks {
                true => FormatTemplateExpression {
                    line_position: LinePosition::After(TemplateElementIndention::default()),
                    ..it
                },
                false => it,
            });
        let count = self.quasi_count();
        for i in 0..count {
            let source = self.raw(i);
            let sorted = context
                .filter(|_| has_white_space(source))
                .and_then(|context| {
                    let tailwind = f.options().tailwind.as_deref()?;
                    let first_and_last = (i == 0, i + 1 == count);
                    sorted_template_text(source, first_and_last, context, tailwind)
                });
            let raw = sorted.as_deref().unwrap_or(source);
            with_node_marks_at(
                || self.content_span(i),
                f,
                |f| match bun_core::strings::contains_char(raw, b'\r') {
                    true => f.write_built_text(|out| bun_core::strings::push_crlf_as_lf(out, raw)),
                    false => write!(f, text(raw)),
                },
            );
            let inner = (context.filter(|_| i + 1 < count))
                .map(|it| it.in_template_expression(source, self.raw(i + 1)));
            write!(f, InTailwindContext(inner, expressions.next()));
        }
        write!(f, "`");
    }
}

#[derive(Copy, Clone)]
enum TemplateExpression<'a> {
    Expression(Expr<'a>),
    TSType(TypeNode<'a>),
}

impl Spanned for TemplateExpression<'_> {
    fn span(&self) -> Span {
        match self {
            Self::Expression(e) => e.span(),
            Self::TSType(t) => t.span(),
        }
    }
}

/// `${e}`
struct FormatTemplateExpression<'a> {
    expression: TemplateExpression<'a>,
    /// The span between the `${` and the `}`.
    interpolation: Span,
    line_position: LinePosition,
}

/// Where a `${` is on its line.
#[derive(Clone, Copy)]
enum LinePosition {
    /// How the text before it will be printed isn't known.
    Unknown,
    /// It's the first thing on its line.
    StartOfLine,
    /// On a line with this indentation.
    After(TemplateElementIndention),
}

/// Prettier's `hasComment(node)`. oxfmt only looks at comments on expressions.
fn type_has_comment<'a>(ty: TypeNode<'a>, f: &Formatter<'a>) -> bool {
    !f.is_quiet() && !f.options().flavor.is_oxfmt() && f.comments().has_comments(ty.as_ast_nodes())
}

impl<'a> Format<'a> for FormatTemplateExpression<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let (has_comment, interned_expression) = match self.expression {
            TemplateExpression::Expression(e) => {
                (!f.is_quiet() && has_comments(e, f), f.intern(&e))
            }
            TemplateExpression::TSType(t) => (type_has_comment(t, f), f.intern(&t)),
        };
        let Some(element) = interned_expression else {
            return write!(f, "${}");
        };

        let interpolation = f.source_text().text_for(&self.interpolation);
        let has_line_break = bun_core::strings::index_of_any(interpolation, b"\r\n").is_some();
        let layout = match has_line_break || element.will_break(f) {
            true => TemplateElementLayout::Fit,
            false => TemplateElementLayout::SingleLine,
        };
        let content = format_with(|f| f.write_element(element));

        let format_inner = format_with(|f| match layout {
            // One string, as in Prettier. A placeholder inside it later becomes a document, and that document isn't
            // nested in any of these elements.
            TemplateElementLayout::SingleLine if f.options().html_template_depth > 0 => {
                let printed =
                    f.print_to_text(&format_with(|f| f.write_without_soft_lines(&content)));
                f.write_text(&printed, None);
            }
            TemplateElementLayout::SingleLine => f.write_without_soft_lines(&content),
            TemplateElementLayout::Fit => {
                let indent = has_comment
                    || matches!(self.expression, TemplateExpression::Expression(e) if {
                        // Prettier's `stripChainElementWrappers`
                        let mut stripped = e;
                        while let ExprKind::NonNull(inner) = stripped.kind() {
                            stripped = inner;
                        }
                        matches!(stripped.kind(), ExprKind::Dot { .. } | ExprKind::Index { .. })
                            || matches!(
                                e.as_ast_nodes(),
                                AstNodes::ConditionalExpression(_)
                                    | AstNodes::SequenceExpression(_)
                                    | AstNodes::TSAsExpression(_)
                                    | AstNodes::TSSatisfiesExpression(_)
                                    | AstNodes::BinaryExpression(_)
                                    | AstNodes::LogicalExpression(_)
                                    | AstNodes::PrivateInExpression(_)
                                    | AstNodes::IdentifierReference(_)
                            )
                    });
                match indent {
                    true => write!(f, soft_block_indent(&content)),
                    false => write!(f, content),
                }
            }
        });

        let format_indented = format_with(|f| match self.line_position {
            LinePosition::Unknown => write!(f, format_inner),
            LinePosition::StartOfLine => write!(f, dedent_to_root(&format_inner)),
            LinePosition::After(indention) => {
                write_with_indention(&format_inner, indention, f.options().indent_width, f)
            }
        });

        write!(
            f,
            group(&format_args!(
                "${",
                format_indented,
                line_suffix_boundary(),
                "}"
            ))
        );
    }
}

/// Prints `content` indented like the template line it starts on, regardless of the template's own indentation.
fn write_with_indention<'a>(
    content: &impl Format<'a>,
    indention: TemplateElementIndention,
    indent_width: IndentWidth,
    f: &mut Formatter<'a>,
) {
    let level = indention.level(indent_width);
    let spaces = indention.align(indent_width);
    if level == 0 && spaces == 0 {
        return write!(f, content);
    }

    let format_indented = format_with(|f| {
        for _ in 0..level {
            f.write_element(FormatElement::Tag(Tag::StartIndent));
        }
        write!(f, content);
        for _ in 0..level {
            f.write_element(FormatElement::Tag(Tag::EndIndent));
        }
    });
    let format_aligned = format_with(|f| match spaces {
        0 => write!(f, format_indented),
        _ => write!(f, align(spaces, &format_indented)),
    });
    write!(f, dedent_to_root(&format_aligned));
}

/// A cell or the end of a row in the table of `` describe.each`..` ``.
enum EachTemplateElement {
    Column(EachTemplateColumn),
    LineBreak,
}

struct EachTemplateColumn {
    text: Vec<u8>,
    width: usize,
    /// Spans more than one line.
    will_break: bool,
}

impl EachTemplateColumn {
    fn new(text: Vec<u8>, will_break: bool, flavor: Flavor) -> Self {
        let width = string_width_as(&text, flavor) as usize;
        Self {
            text,
            width,
            will_break,
        }
    }
}

/// Prettier's `printJestEachTemplateLiteral`: the columns are aligned.
///
/// ```js
/// describe.each`
///   a    | b    | expected
///   ${1} | ${1} | ${2}
///   ${11} | ${1} | ${12}
/// `
/// ```
#[derive(Default)]
struct EachTemplateTable {
    /// For each row, true if it has a cell that spans more than one line. Such a row isn't aligned.
    rows: Vec<bool>,
    columns_width: Vec<usize>,
    elements: Vec<EachTemplateElement>,
    current_row_widths: Vec<usize>,
    current_row_has_line_break_column: bool,
}

impl EachTemplateTable {
    fn entry(&mut self, element: EachTemplateElement) {
        match &element {
            EachTemplateElement::Column(column) => {
                self.current_row_has_line_break_column |= column.will_break;
                if !self.current_row_has_line_break_column {
                    self.current_row_widths.push(column.width);
                }
            }
            EachTemplateElement::LineBreak => self.next_row(),
        }
        self.elements.push(element);
    }

    fn next_row(&mut self) {
        if !self.current_row_has_line_break_column {
            for (index, width) in self.current_row_widths.iter().enumerate() {
                match self.columns_width.get_mut(index) {
                    Some(column_width) => *column_width = (*column_width).max(*width),
                    None => self.columns_width.push(*width),
                }
            }
        }
        self.rows.push(self.current_row_has_line_break_column);
        self.current_row_widths.clear();
        self.current_row_has_line_break_column = false;
    }

    fn from_template<'a>(template: Template<'a>, f: &mut Formatter<'a>) -> Self {
        let mut table = EachTemplateTable::default();

        let header = template.raw(0);
        let header = header.strip_suffix(b"|").unwrap_or(header);
        for column in bun_core::strings::split(header, b"|") {
            table.entry(EachTemplateElement::Column(EachTemplateColumn::new(
                column.trim_ascii().to_vec(),
                false,
                f.options().flavor,
            )));
        }
        table.entry(EachTemplateElement::LineBreak);

        let expressions = TemplateLike::TemplateLiteral(template).expressions(true, f);
        for (index, format_expression) in expressions.enumerate() {
            let text = f.print_to_text(&format_with(|f| {
                f.write_without_soft_lines(&format_expression)
            }));
            let will_break = bun_core::strings::contains_char(&text, b'\n');
            table.entry(EachTemplateElement::Column(EachTemplateColumn::new(
                text,
                will_break,
                f.options().flavor,
            )));

            if index + 1 < template.quasi_count()
                && bun_core::strings::index_of_any(template.raw(index + 1), b"\r\n").is_some()
            {
                table.entry(EachTemplateElement::LineBreak);
            }
        }
        table.next_row();
        table
    }
}

impl<'a> Format<'a> for EachTemplateTable {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let table_content = format_with(|f| {
            let (mut current_column, mut current_row) = (0usize, 0usize);
            let mut iter = self.elements.iter().peekable();
            write!(f, hard_line_break());

            while let Some(element) = iter.next() {
                let is_last = iter.peek().is_none();
                let is_last_in_row =
                    is_last || matches!(iter.peek(), Some(EachTemplateElement::LineBreak));
                match element {
                    EachTemplateElement::Column(column) => {
                        let is_aligned =
                            !is_last_in_row && self.rows.get(current_row) == Some(&false);
                        let column_width = self
                            .columns_width
                            .get(current_column)
                            .copied()
                            .unwrap_or_default();
                        f.write_built_text(|out| {
                            if current_column != 0 && (!is_last_in_row || !column.text.is_empty()) {
                                out.push(b' ');
                            }
                            out.extend_from_slice(&column.text);
                            if is_aligned {
                                out.extend(std::iter::repeat_n(
                                    b' ',
                                    column_width.saturating_sub(column.width),
                                ));
                            }
                            if !is_last_in_row {
                                out.push(b' ');
                            }
                        });
                        if !is_last_in_row {
                            write!(f, "|");
                        }
                        current_column += 1;
                    }
                    EachTemplateElement::LineBreak => {
                        current_column = 0;
                        current_row += 1;
                        if !is_last {
                            write!(f, hard_line_break());
                        }
                    }
                }
            }
        });
        write!(
            f,
            [
                line_suffix_boundary(),
                "`",
                indent(&table_content),
                hard_line_break(),
                "`"
            ]
        );
    }
}
