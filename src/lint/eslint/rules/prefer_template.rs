use bun_lint::prelude::*;
use smallvec::SmallVec;
use std::borrow::Cow;

/// Require template literals instead of string concatenation.
pub struct PreferTemplate;

const UNEXPECTED_STRING_CONCATENATION: Message = Message::new(
    "unexpectedStringConcatenation",
    "Unexpected string concatenation.",
);

#[derive(Copy, Clone)]
struct Operands<'a> {
    left: Expr<'a>,
    right: Expr<'a>,
}

/// ESLint's `isConcatenation`: the operands of a `+`.
fn as_concatenation(e: Expr<'_>) -> Option<Operands<'_>> {
    match e.kind() {
        ExprKind::Binary {
            op: BinOp::Add,
            left,
            right,
        } => Some(Operands { left, right }),
        _ => None,
    }
}

/// Whether `test` holds for one of the things that `e` concatenates.
fn any_operand<'a>(e: Expr<'a>, test: fn(Expr<'a>) -> bool) -> bool {
    // The left operands of the concatenations that are a right operand.
    let mut pending: SmallVec<[Expr<'a>; 8]> = SmallVec::new();
    let mut at = e;
    loop {
        if let Some(Operands { left, right }) = as_concatenation(at) {
            pending.push(left);
            at = right;
        } else if test(at) {
            return true;
        } else if let Some(next) = pending.pop() {
            at = next;
        } else {
            return false;
        }
    }
}

fn has_string_literal(e: Expr<'_>) -> bool {
    any_operand(e, ast_utils::is_string_literal)
}

fn has_non_string_literal(e: Expr<'_>) -> bool {
    any_operand(e, |it| !ast_utils::is_string_literal(it))
}

fn has_octal_or_non_octal_decimal_escape_sequence(e: Expr<'_>) -> bool {
    any_operand(e, |it| {
        it.as_string().is_some() && ast_utils::has_octal_or_non_octal_decimal_escape_sequence(it.text())
    })
}

/// The operands of ESLint's `BinaryExpression`.
fn as_binary_expression(e: Expr<'_>) -> Option<Operands<'_>> {
    match e.kind() {
        ExprKind::Binary { op, left, right }
            if !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma) =>
        {
            Some(Operands { left, right })
        }
        _ => None,
    }
}

/// Whether `e` starts with `${` once it is a template. Upstream asks of a template whether the range
/// of its first `TemplateElement` is empty, which it never is: it includes the delimiters.
fn starts_with_template_curly(mut e: Expr<'_>) -> bool {
    while let Some(Operands { left, .. }) = as_binary_expression(e) {
        e = left;
    }
    !ast_utils::is_string_literal(e)
}

fn ends_with_template_curly(e: Expr<'_>) -> bool {
    match as_binary_expression(e) {
        Some(Operands { right, .. }) => starts_with_template_curly(right),
        None => !ast_utils::is_string_literal(e),
    }
}

/// ESLint remembers which concatenations it has checked by where they start, and comes to the
/// literals in source order. So in `'a' + b - c + 'd'` the inner one hides the outer one.
fn starts_with_checked_concatenation(top: Expr<'_>) -> bool {
    let start = top.span().start;
    let mut at = top;
    loop {
        let first = match at.kind() {
            ExprKind::Binary { left, .. } => left,
            ExprKind::Cond { test, .. } => test,
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr) => expr,
            _ => return false,
        };
        if first.span().start != start {
            return false;
        }
        if as_concatenation(at).is_none() && as_concatenation(first).is_some() && has_string_literal(first) {
            return true;
        }
        at = first;
    }
}

/// The text between `a` and `b` that is not in a token: whitespace and comments.
fn get_text_between<'a>(file: &'a File<'a>, a: Span, b: Span) -> Cow<'a, [u8]> {
    let mut tokens = file.tokens_between(a, b);
    let Some(first) = tokens.next() else {
        return Cow::Borrowed(file.slice(a.between(b)));
    };
    let mut text = file.slice(Span::after(a, first.start())).to_vec();
    let mut at = first.end();
    for token in tokens {
        text.extend_from_slice(file.slice(Span::new(at, token.start())));
        at = token.end();
    }
    text.extend_from_slice(file.slice(Span::before(at, b)));
    Cow::Owned(text)
}

/// The string literal `raw` as a template.
fn string_literal_to_template(raw: &[u8]) -> Vec<u8> {
    let [quote, content @ .., _] = raw else {
        return raw.to_vec();
    };
    // A `${` or a backtick needs a backslash, unless it is escaped for some reason.
    let mut escaped = Vec::with_capacity(content.len() + 2);
    let mut backslashes = 0;
    for (i, &byte) in content.iter().enumerate() {
        let opens = byte == b'`' || (byte == b'$' && content.get(i + 1) == Some(&b'{'));
        if opens && backslashes % 2 == 0 {
            escaped.push(b'\\');
        }
        backslashes = if byte == b'\\' { backslashes + 1 } else { 0 };
        escaped.push(byte);
    }
    // The quotes no longer need one.
    let mut template = Vec::with_capacity(escaped.len() + 2);
    template.push(b'`');
    let mut at = 0;
    while let Some(&byte) = escaped.get(at) {
        if byte == b'\\' && escaped.get(at + 1) == Some(quote) {
            at += 1;
        } else {
            template.push(byte);
            at += 1;
        }
    }
    template.push(b'`');
    template
}

/// How the operands of a concatenation become one text.
enum Join {
    /// `foo${bar}` /* comment */ + 'baz' --> `foo${bar /* comment */  }${baz}`
    AfterLeft,
    /// 'foo' /* comment */ + `${bar}baz` --> `foo${ /* comment */  bar}baz`
    BeforeRight,
    /// There is nowhere to put the text between them.
    Sum,
}

/// A concatenation that has a string literal.
struct Concatenation<'a> {
    right: Expr<'a>,
    join: Join,
    text_before_plus: Cow<'a, [u8]>,
    text_after_plus: Cow<'a, [u8]>,
}

impl Concatenation<'_> {
    fn text_around_plus(&self) -> Vec<u8> {
        [&self.text_before_plus[..], &self.text_after_plus[..]].concat()
    }

    /// What goes into the braces at the end of the left operand.
    fn text_after_left(&self) -> Vec<u8> {
        match self.join {
            Join::AfterLeft => self.text_around_plus(),
            Join::BeforeRight | Join::Sum => Vec::new(),
        }
    }
}

/// ESLint's `getTemplateLiteral`, in time proportional to the text.
struct TemplateWriter<'a> {
    file: &'a File<'a>,
    /// Where the string literals start that the reported expression concatenates, in ascending order.
    string_literals: Vec<u32>,
    stack: bun_core::StackCheck,
    text: Vec<u8>,
}

impl<'a> TemplateWriter<'a> {
    fn new(file: &'a File<'a>, top: Expr<'a>) -> Self {
        let mut string_literals = Vec::new();
        let mut pending = vec![top];
        while let Some(e) = pending.pop() {
            if let Some(Operands { left, right }) = as_concatenation(e) {
                pending.extend([left, right]);
            } else if ast_utils::is_string_literal(e) {
                string_literals.push(e.span().start);
            }
        }
        string_literals.sort_unstable();
        TemplateWriter {
            file,
            string_literals,
            stack: bun_core::StackCheck::init(),
            text: Vec::new(),
        }
    }

    /// `has_string_literal(e)` for a part of the reported expression.
    fn has_string_literal(&self, e: Expr<'a>) -> bool {
        let span = e.span();
        let first = self.string_literals.partition_point(|&start| start < span.start);
        self.string_literals.get(first).is_some_and(|&start| start < span.end)
    }

    fn as_concatenation(&self, e: Expr<'a>) -> Option<(Expr<'a>, Concatenation<'a>)> {
        let Operands { left, right } = as_concatenation(e)?;
        if !self.has_string_literal(e) {
            return None;
        }
        let plus = e.operator_span()?;
        let join = if ends_with_template_curly(left) {
            Join::AfterLeft
        } else if starts_with_template_curly(right) {
            Join::BeforeRight
        } else {
            Join::Sum
        };
        let concatenation = Concatenation {
            right,
            join,
            text_before_plus: get_text_between(self.file, left.span(), plus),
            text_after_plus: get_text_between(self.file, plus, right.span()),
        };
        Some((left, concatenation))
    }

    /// Appends `e` as a template, or as a sum of templates. `text_before` and `text_after` go into
    /// the braces with it. The template is left without its first backtick if it `continues` one.
    /// `None`: the parentheses nest too deep.
    fn write(&mut self, e: Expr<'a>, text_before: &[u8], text_after: &[u8], continues: bool) -> Option<()> {
        if !self.stack.is_safe_to_recurse() {
            return None;
        }
        // From `e` along the left operands.
        let mut concatenations = Vec::new();
        let mut first = e;
        while let Some((left, concatenation)) = self.as_concatenation(first) {
            concatenations.push(concatenation);
            first = left;
        }

        let start = self.text.len();
        match first.kind() {
            ExprKind::String(_) => self.text.extend(string_literal_to_template(first.text())),
            ExprKind::Template(_) => self.text.extend_from_slice(first.text()),
            _ => {
                let text_after_left = concatenations.last().map(Concatenation::text_after_left);
                self.text.extend_from_slice(b"`${");
                self.text.extend_from_slice(text_before);
                self.text.extend_from_slice(first.text());
                self.text.extend_from_slice(text_after_left.as_deref().unwrap_or(text_after));
                self.text.extend_from_slice(b"}`");
            }
        }
        if continues && self.text.get(start) == Some(&b'`') {
            self.text.remove(start);
        }

        while let Some(concatenation) = concatenations.pop() {
            let text_after_left = concatenations.last().map(Concatenation::text_after_left);
            let text_after = text_after_left.as_deref().unwrap_or(text_after);
            let right = concatenation.right;
            match concatenation.join {
                Join::AfterLeft => {
                    self.text.pop_if(|last| *last == b'`');
                    self.write(right, b"", text_after, true)?;
                }
                Join::BeforeRight => {
                    self.text.pop_if(|last| *last == b'`');
                    self.write(right, &concatenation.text_around_plus(), text_after, true)?;
                }
                Join::Sum => {
                    self.text.extend_from_slice(&concatenation.text_before_plus);
                    self.text.push(b'+');
                    self.text.extend_from_slice(&concatenation.text_after_plus);
                    // As upstream: what is to follow the sum is put before its right operand.
                    let text_before_right = text_after;
                    self.write(right, text_before_right, b"", false)?;
                }
            }
        }
        Some(())
    }
}

impl PreferTemplate {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if as_concatenation(e).is_none()
            || matches!(e.parent(), Node::Expr(parent) if as_concatenation(parent).is_some())
            || !has_string_literal(e)
            || !has_non_string_literal(e)
            || starts_with_checked_concatenation(e)
        {
            return;
        }
        cx.report(e, UNEXPECTED_STRING_CONCATENATION).fix(|fixer| {
            if has_octal_or_non_octal_decimal_escape_sequence(e) {
                return None;
            }
            let needs_semicolon =
                ast_utils::is_start_of_expression_statement(e) && ast_utils::needs_preceding_semicolon(e);
            let mut writer = TemplateWriter::new(fixer.file(), e);
            if needs_semicolon {
                writer.text.push(b';');
            }
            writer.write(e, b"", b"", false)?;
            Some(fixer.replace(e, writer.text))
        });
    }
}

impl Rule for PreferTemplate {
    const META: Meta = Meta::eslint("prefer-template", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferTemplate
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Binary], Self::check);
    }
}
