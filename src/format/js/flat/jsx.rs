//! JSX.
//!
//! An element is on one line if that fits and nothing forces its children to be on lines of their own: an element among
//! them, several `{..}`, several attributes. Otherwise its tags each end a line, and the printers in `print/jsx` write
//! what's between them. They ask for each child that has a line of its own, and so does a tag whose attributes are each
//! on a line.

use super::*;
use crate::js::print::jsx::{ChildOnLine, ChildrenOnLine, Parentheses, parentheses_around};

/// Writes `child` of an element, which has a line of its own: an element, or something in braces.
pub(crate) fn write_jsx_child<'a>(child: Expr<'a>, f: &mut Formatter<'a>) -> bool {
    let span = child.jsx_container_span().unwrap_or_else(|| child.span());
    // What a fill prints can be in flat mode, in which only groups break. After a line break in that mode the printer
    // measures the groups that follow until one has been measured, so a child is a group here if and only if the long
    // way writes one for it: always, but for `<a />`.
    let has_group = match child.kind() {
        ExprKind::Jsx(jsx) if child.jsx_container_span().is_none() => {
            !(jsx.is_self_closing() && jsx.attrs().is_empty())
        }
        _ => true,
    };
    let slot = f.reserve_tag();
    let is_written = f.write_line(span, (0, 0), &|line| line.jsx_child(child));
    if is_written && has_group {
        f.group_from(slot, false);
    }
    is_written
}

/// Writes `attribute` of an element whose attributes are each on a line.
pub(super) fn write_jsx_attribute<'a>(attribute: Prop<'a>, f: &mut Formatter<'a>) -> bool {
    f.write_line(attribute.span(), (0, 0), &|line| {
        line.jsx_attribute(attribute, true)
    })
}

/// What's between the tags of an element.
#[expect(
    clippy::large_enum_variant,
    reason = "it stays on the stack of who asked for it"
)]
enum Content<'a> {
    /// `<a />`, `<a></a>`
    Nothing,
    /// It's on the line of the tags if that fits.
    CanBeOnLine(ChildrenOnLine<'a>),
    /// It's on lines of its own.
    Breaks,
}

impl<'a> Line<'_, 'a> {
    fn jsx_child(&mut self, child: Expr<'a>) -> Written {
        if child.jsx_container_span().is_none() {
            return self.jsx_on_own_line(child);
        }
        self.byte(b'{')?;
        self.jsx_expression_in_braces(child, true)?;
        self.byte(b'}')
    }

    /// What's between the braces of `{e}`. If it `can_end_line`, nothing but the `}` follows.
    fn jsx_expression_in_braces(&mut self, e: Expr<'a>, can_end_line: bool) -> Written {
        match e.tag() {
            // A comment, `{...e}` as a child, and what can be in another language.
            ExprTag::Missing | ExprTag::Spread | ExprTag::Template | ExprTag::TaggedTemplate => {
                Err(Refused)
            }
            // These start right after the `{` and end right before the `}` even if they break.
            ExprTag::Fn | ExprTag::Object | ExprTag::Array | ExprTag::Call if can_end_line => {
                self.last_expr(e, Place::Other)
            }
            _ => self.expr(e, Place::Other),
        }
    }

    /// An element that's part of an expression. If it `can_end_line`, nothing but closing brackets follows.
    pub(super) fn jsx(&mut self, e: Expr<'a>, can_end_line: bool) -> Written {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return Err(Refused);
        };
        // Also where nothing else does: `a[(<b />)]`
        if needs_parentheses(e, self.f) {
            return Err(Refused);
        }
        match e.ast_parent() {
            // A conditional expression with an element in it has a layout of its own.
            AstNodes::ConditionalExpression(_) => return Err(Refused),
            // It can be all of a code block, which gets no semicolon.
            AstNodes::ExpressionStatement(_) if self.f.options().is_in_markdown => {
                return Err(Refused);
            }
            _ => {}
        }
        let parentheses = parentheses_around(e, jsx);
        let content = self.jsx_content(jsx)?;
        let breaks = matches!(parentheses, Parentheses::Always)
            || matches!(content, Content::Breaks)
            || self.has_attribute_per_line(jsx);
        if !breaks && !(self.breaks && can_end_line) {
            return self.jsx_on_one_line(jsx, &content);
        }
        if !can_end_line || matches!(parentheses, Parentheses::None) {
            return Err(Refused);
        }
        self.byte(b'(')?;
        self.check_source_up_to(e.span().start)?;
        self.break_line(1)?;
        self.jsx_on_own_line(e)?;
        self.break_line(-1)?;
        self.byte(b')')
    }

    /// `singleAttributePerLine`
    fn has_attribute_per_line(&self, jsx: Jsx<'a>) -> bool {
        jsx.attrs().len() > 1 && self.f.options().attribute_position == AttributePosition::Multiline
    }

    fn jsx_content(&self, jsx: Jsx<'a>) -> Result<Content<'a>, Refused> {
        let mut children = jsx.children_with_whitespace();
        match (children.next(), children.next()) {
            // An empty fragment has a layout of its own.
            (None, _) | (Some(JsxChild::Whitespace(_)), None) => {
                return match jsx.is_fragment() {
                    true => Err(Refused),
                    false => Ok(Content::Nothing),
                };
            }
            // A template is printed right after the tag.
            (Some(JsxChild::Expr(child)), None)
                if matches!(child.tag(), ExprTag::Template | ExprTag::TaggedTemplate) =>
            {
                return Err(Refused);
            }
            _ => {}
        }
        if jsx.attrs().len() > 1
            || (jsx.children().iter())
                .any(|it| it.tag() == ExprTag::Jsx && it.jsx_container_span().is_none())
        {
            return Ok(Content::Breaks);
        }
        Ok(match ChildrenOnLine::new(jsx, self.f) {
            Some(children) => Content::CanBeOnLine(children),
            None => Content::Breaks,
        })
    }

    /// An element that starts a line and ends one: on that line if it fits, else with its tags on lines of their own.
    fn jsx_on_own_line(&mut self, e: Expr<'a>) -> Written {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return Err(Refused);
        };
        let content = self.jsx_content(jsx)?;
        if !matches!(content, Content::Breaks) && !self.has_attribute_per_line(jsx) {
            let written = self.attempt(e.span(), |line| line.jsx_on_one_line(jsx, &content));
            if !matches!(written, Err(TooWide::Certainly)) {
                return written.map_err(|_| Refused);
            }
        }
        self.jsx_opening_tag(jsx, true)?;
        if matches!(content, Content::Nothing) {
            return self.jsx_closing_tag(jsx);
        }
        let closing = jsx.closing_span().ok_or(Refused)?;
        self.check_source_up_to(jsx.opening_span().end)?;
        self.end_text(Some(0))?;
        self.parts.push(Part::JsxChildren(jsx));
        self.checked_to = closing.start;
        self.start_line(0);
        self.jsx_closing_tag(jsx)
    }

    /// Calls `write`, which writes what's at `span` in the source on the current line and nothing after it. If that's too
    /// wide, nothing is written.
    fn attempt(
        &mut self,
        span: Span,
        write: impl FnOnce(&mut Self) -> Written,
    ) -> Result<(), TooWide> {
        let mark = self.mark();
        let breaks = std::mem::take(&mut self.breaks);
        let written = write(self);
        self.breaks = breaks;
        if written.is_ok() {
            return Ok(());
        }
        // Bytes have been counted, and the indentation can be a guess.
        if !self.is_too_wide || !self.is_certain() || self.is_careful || self.has_parts_since(mark)
        {
            return Err(TooWide::Perhaps);
        }
        if !self.f.is_plain_source(span) {
            self.is_odd = true;
            return Err(TooWide::Perhaps);
        }
        // A comment further on would have been refused.
        if self.has_comments_in(span) {
            return Err(TooWide::Perhaps);
        }
        self.is_too_wide = false;
        self.go_back_to(mark);
        Err(TooWide::Certainly)
    }

    fn jsx_on_one_line(&mut self, jsx: Jsx<'a>, content: &Content<'a>) -> Written {
        self.jsx_opening_tag(jsx, false)?;
        if let Content::CanBeOnLine(children) = content {
            for child in children.iter() {
                match child {
                    ChildOnLine::Space => self.byte(b' ')?,
                    ChildOnLine::Word(word) => self.long_bytes(word)?,
                    ChildOnLine::Node(e) if e.jsx_container_span().is_some() => {
                        self.byte(b'{')?;
                        self.jsx_expression_in_braces(e, false)?;
                        self.byte(b'}')?;
                    }
                    ChildOnLine::Node(_) => return Err(Refused),
                }
            }
        }
        self.jsx_closing_tag(jsx)
    }

    /// A name without white space in it: `a`, `a.b`, `a-b`, `a:b`.
    fn jsx_name(&mut self, span: Span) -> Written {
        let is_part = |byte: &u8| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$' | b'-' | b'.' | b':')
        };
        match self.text_of(span).iter().all(is_part) {
            true => self.source(span),
            false => Err(Refused),
        }
    }

    /// `<a b="c">`, `<a />`, `<>`. If it `ends_line`, its attributes are each on a line if it's too wide.
    fn jsx_opening_tag(&mut self, jsx: Jsx<'a>, ends_line: bool) -> Written {
        let Some(name) = jsx.tag() else {
            return self.token("<>");
        };
        if !jsx.type_args().is_empty() {
            return Err(Refused);
        }
        self.byte(b'<')?;
        self.jsx_name(name.span())?;
        let attributes = jsx.attrs();
        let end = match jsx.is_self_closing() {
            true => " />",
            false => ">",
        };
        let has_attribute_per_line = self.has_attribute_per_line(jsx);
        if !has_attribute_per_line {
            // Without attributes, or with one that's a string, there's nowhere to break.
            let only = (attributes.first()).filter(|_| attributes.len() == 1);
            if ends_line
                && (attributes.is_empty()
                    || only.is_some_and(|it| {
                        it.kind() != PropKind::Spread
                            && it.value().is_some_and(|value| {
                                value.tag() == ExprTag::String
                                    && value.jsx_container_span().is_none()
                            })
                    }))
            {
                self.limit = usize::MAX;
            }
            let on_one_line = |line: &mut Self| {
                for attribute in attributes {
                    line.byte(b' ')?;
                    line.jsx_attribute(attribute, false)?;
                }
                line.token(end)
            };
            if !ends_line {
                return on_one_line(self);
            }
            let written = self.attempt(jsx.opening_span(), on_one_line);
            if !matches!(written, Err(TooWide::Certainly)) {
                return written.map_err(|_| Refused);
            }
        } else if !ends_line {
            return Err(Refused);
        }
        // The `>` would follow the last attribute on its line.
        if !jsx.is_self_closing() && self.f.options().bracket_same_line.value() {
            return Err(Refused);
        }
        self.break_line(1)?;
        for (index, attribute) in attributes.iter().enumerate() {
            if index > 0 {
                self.break_line(0)?;
            }
            self.check_source_up_to(attribute.span().start)?;
            self.parts.push(Part::JsxAttribute(attribute));
            self.checked_to = attribute.span().end;
        }
        self.break_line(-1)?;
        self.token(end.trim_ascii_start())
    }

    fn jsx_closing_tag(&mut self, jsx: Jsx<'a>) -> Written {
        match jsx.close_tag() {
            Some(name) => {
                self.token("</")?;
                self.jsx_name(name.span())?;
                self.byte(b'>')
            }
            None if jsx.is_fragment() => self.token("</>"),
            None if jsx.is_self_closing() => Ok(()),
            None => Err(Refused),
        }
    }

    /// `a="b"`, `a={b}`, `a`, `{...a}`. If it `can_end_line`, nothing follows it on its line.
    fn jsx_attribute(&mut self, attribute: Prop<'a>, can_end_line: bool) -> Written {
        if attribute.kind() == PropKind::Spread {
            self.token("{...")?;
            self.expr(attribute.value().ok_or(Refused)?, Place::Other)?;
            return self.byte(b'}');
        }
        let name = attribute.key().ok_or(Refused)?.span(self.f.file());
        self.jsx_name(name)?;
        let Some(value) = attribute.value() else {
            return Ok(());
        };
        self.byte(b'=')?;
        if value.jsx_container_span().is_some() {
            self.byte(b'{')?;
            self.jsx_expression_in_braces(value, can_end_line)?;
            return self.byte(b'}');
        }
        match value.tag() {
            ExprTag::String => self.jsx_string(value.span()),
            _ => Err(Refused),
        }
    }

    /// The value of an attribute, in which a quote is written as an entity.
    fn jsx_string(&mut self, span: Span) -> Written {
        let text = self.text_of(span);
        let [b'"' | b'\'', content @ .., b'"' | b'\''] = text else {
            return Err(Refused);
        };
        let (mut has_quote, mut has_odd) = (false, false);
        for &byte in content {
            has_quote |= matches!(byte, b'"' | b'\'' | b'&');
            has_odd |= byte < b' ';
        }
        if has_odd {
            return Err(Refused);
        }
        if has_quote {
            let kind = StringLiteralParentKind::Expression;
            let printed = FormatLiteralStringToken::new(text, true, kind).clean_text(self.f);
            return self.long_bytes(&printed);
        }
        let quote = self.f.options().jsx_quote_style.as_byte();
        self.byte(quote)?;
        self.long_bytes(content)?;
        self.byte(quote)
    }
}

/// Why an attempt to write something on one line has failed.
enum TooWide {
    /// It's too wide, and nothing has been written.
    Certainly,
    /// Nothing is known.
    Perhaps,
}
