//! Template literals. Prettier's `printTemplateLiteral`.
//!
//! The text is written as it is. What is in `${}` is formatted, but kept on one line unless it has
//! a line break in the source.

use super::type_parameters::type_arguments;
use crate::css::embed;
use crate::ir::width::string_width;
use crate::js::utils::call_expression::is_test_each_pattern;
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::string::push_with_normalized_newlines;
use crate::cursor::around_node_at;
use crate::prelude::*;
use crate::{format_args, write};

/// `` `a${b}c` ``
pub(crate) fn write_template_literal<'a>(e: Expr<'a>, template: Template<'a>, f: &mut Formatter<'a>) {
    if !embed::write_template(e, template, f)
        && !crate::graphql::embed::write_template(e, template, f)
        && !crate::markdown::embed::write_template(e, template, f)
    {
        TemplateLike::TemplateLiteral(template).fmt(f);
    }
}

/// `${e}` at `i` in a template that is written as the language in it. Prettier's
/// `printEmbeddedTemplateExpressions`.
pub(crate) fn write_embedded_template_expression<'a>(template: Template<'a>, i: usize, f: &mut Formatter<'a>) {
    let template = TemplateLike::TemplateLiteral(template);
    if let Some(expression) = template.expression(i) {
        let expression = FormatTemplateExpression {
            expression,
            interpolation: template.interpolation_span(i),
            indention: None,
            after_new_line: false,
        };
        expression.fmt(f);
    }
}

/// `` tag`a${b}c` ``
pub(crate) fn write_tagged_template_expression<'a>(e: Expr<'a>, call: Call<'a>, f: &mut Formatter<'a>) {
    write!(f, [call.callee(), type_arguments(call.type_args(), Node::Expr(e))]);
    let Some(quasi) = call.template() else {
        return;
    };

    let comments = f.comments().comments_before(quasi.span().start);
    if let Some(first) = comments.first() {
        let tag_end = call.type_args().angle_brackets_span().map_or_else(|| call.callee().span().end, |it| it.end);
        match f.source_text().contains_newline_between(tag_end, first.span.start) {
            true => write!(f, soft_line_break()),
            false => write!(f, space()),
        }
    }
    write!(f, [line_suffix_boundary(), FormatLeadingComments::Comments(comments)]);

    let ExprKind::Template(template) = quasi.kind() else {
        return;
    };
    match is_test_each_pattern(call.callee()) {
        true => EachTemplateTable::from_template(template, f).fmt(f),
        false => write_template_literal(quasi, template, f),
    }
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
    /// It breaks where it has to.
    Fit,
}

/// The number of columns that the line of a `${` is indented by.
#[derive(Debug, Copy, Clone, Default)]
struct TemplateElementIndention(u32);

impl TemplateElementIndention {
    fn level(self, indent_width: IndentWidth) -> u32 {
        self.0 / u32::from(indent_width.value()).max(1)
    }

    fn align(self, indent_width: IndentWidth) -> u8 {
        (self.0 % u32::from(indent_width.value()).max(1)).try_into().unwrap_or(u8::MAX)
    }

    /// That of the last line of `text`. If it is all on one line, `previous_indention`.
    fn after_last_new_line(text: &[u8], tab_width: u32, previous_indention: Self) -> Self {
        use bun_core::strings::last_index_of_char;
        let Some(new_line) = last_index_of_char(text, b'\n').max(last_index_of_char(text, b'\r')) else {
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

    /// Where the text at `i` is, without its delimiters: the range of ESTree's `TemplateElement`.
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

    /// What is between the `${` and the `}` of the substitution at `i`.
    fn interpolation_span(self, i: usize) -> Span {
        match self {
            Self::TemplateLiteral(t) => Span::new(t.quasi_span(i).end, t.quasi_span(i + 1).start),
            Self::TSTemplateLiteralType(t) => Span::new(t.quasi_span(i).end, t.quasi_span(i + 1).start),
        }
    }

    /// The substitutions. `is_in_jest_each`: they are the cells of a table, which is indented.
    fn expressions(
        self,
        is_in_jest_each: bool,
        f: &Formatter<'a>,
    ) -> impl Iterator<Item = FormatTemplateExpression<'a>> + use<'a> {
        let tab_width = u32::from(f.options().indent_width.value());
        let mut indention = TemplateElementIndention::default();
        (0..self.quasi_count()).map_while(move |i| {
            let quasi_text = self.raw(i);
            indention = TemplateElementIndention::after_last_new_line(quasi_text, tab_width, indention);
            let indention = match is_in_jest_each {
                true => TemplateElementIndention(indention.0.max(tab_width)),
                false => indention,
            };
            Some(FormatTemplateExpression {
                expression: self.expression(i)?,
                interpolation: self.interpolation_span(i),
                indention: Some(indention),
                after_new_line: indention.0 == 0 && matches!(quasi_text.last(), Some(b'\n' | b'\r')),
            })
        })
    }
}

impl<'a> Format<'a> for TemplateLike<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        write!(f, [line_suffix_boundary(), "`"]);
        let mut expressions = self.expressions(false, f);
        for i in 0..self.quasi_count() {
            let raw = self.raw(i);
            around_node_at(|| self.content_span(i), f, |f| match bun_core::strings::contains_char(raw, b'\r') {
                true => f.write_built_text(|out| push_with_normalized_newlines(out, raw)),
                false => write!(f, text(raw)),
            });
            write!(f, expressions.next());
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
    /// What is between the `${` and the `}`.
    interpolation: Span,
    /// `None`: there is no telling how the text before it is written.
    indention: Option<TemplateElementIndention>,
    /// The `${` is the first thing on its line.
    after_new_line: bool,
}

impl<'a> Format<'a> for FormatTemplateExpression<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let mut has_comment_in_expression = false;

        let interned_expression = match self.expression {
            TemplateExpression::Expression(e) => {
                has_comment_in_expression = !f.is_quiet()
                    && (f.comments().has_comment_before(e.span().start)
                        || f.comments().has_comment_in_range(e.span().end, self.interpolation.end));
                f.intern(&format_with(|f| {
                    match e.kind() {
                        ExprKind::Jsx(_) => e.fmt(f),
                        _ => FormatNodeWithoutTrailingComments(&e).fmt(f),
                    }
                    if !f.is_quiet() {
                        let trailing_comments = f.comments().comments_before(self.interpolation.end);
                        FormatTrailingComments::Comments(trailing_comments).fmt(f);
                    }
                }))
            }
            TemplateExpression::TSType(t) => f.intern(&t),
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
            TemplateElementLayout::SingleLine => f.write_without_soft_lines(&content),
            TemplateElementLayout::Fit => {
                let indent = matches!(self.expression, TemplateExpression::Expression(e) if {
                    // Prettier's `stripChainElementWrappers`
                    let mut stripped = e;
                    while let ExprKind::NonNull(inner) = stripped.kind() {
                        stripped = inner;
                    }
                    has_comment_in_expression
                        || matches!(stripped.kind(), ExprKind::Dot { .. } | ExprKind::Index { .. })
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

        let format_indented = format_with(|f| match self.indention {
            None => write!(f, format_inner),
            Some(_) if self.after_new_line => write!(f, dedent_to_root(&format_inner)),
            Some(indention) => write_with_indention(&format_inner, indention, f.options().indent_width, f),
        });

        write!(f, group(&format_args!("${", format_indented, line_suffix_boundary(), "}")));
    }
}

/// Writes `content` indented like the line of the template that it starts on, whatever the
/// template itself is indented by.
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

/// A cell or the end of a row of the table of `` describe.each`..` ``.
enum EachTemplateElement {
    Column(EachTemplateColumn),
    LineBreak,
}

struct EachTemplateColumn {
    text: Vec<u8>,
    width: usize,
    /// It takes more than one line.
    will_break: bool,
}

impl EachTemplateColumn {
    fn new(text: Vec<u8>, will_break: bool) -> Self {
        let width = string_width(&text) as usize;
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
    /// For each row, whether it has a cell that takes more than one line. It is not aligned then.
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
            table.entry(EachTemplateElement::Column(EachTemplateColumn::new(column.trim_ascii().to_vec(), false)));
        }
        table.entry(EachTemplateElement::LineBreak);

        let expressions = TemplateLike::TemplateLiteral(template).expressions(true, f);
        for (index, format_expression) in expressions.enumerate() {
            let text = f.print_to_text(&format_with(|f| f.write_without_soft_lines(&format_expression)));
            let will_break = bun_core::strings::contains_char(&text, b'\n');
            table.entry(EachTemplateElement::Column(EachTemplateColumn::new(text, will_break)));

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
                let is_last_in_row = is_last || matches!(iter.peek(), Some(EachTemplateElement::LineBreak));
                match element {
                    EachTemplateElement::Column(column) => {
                        let is_aligned = !is_last_in_row && self.rows.get(current_row) == Some(&false);
                        let column_width = self.columns_width.get(current_column).copied().unwrap_or_default();
                        f.write_built_text(|out| {
                            if current_column != 0 && (!is_last_in_row || !column.text.is_empty()) {
                                out.push(b' ');
                            }
                            out.extend_from_slice(&column.text);
                            if is_aligned {
                                out.extend(std::iter::repeat_n(b' ', column_width.saturating_sub(column.width)));
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
        write!(f, [line_suffix_boundary(), "`", indent(&table_content), hard_line_break(), "`"]);
    }
}
