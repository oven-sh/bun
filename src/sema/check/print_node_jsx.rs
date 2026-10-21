//! printer.go: JSX, for `NodePrinter`.

use super::print::OperatorPrecedence as P;
use super::print_node::{Child, Emitted, NodePrinter, Stop, lf};
use super::spans::{
    get_leading_comment_ranges, get_trailing_comment_ranges, identifier_end, jsx_identifier_end,
};
use super::*;
use bun_core::lexer;
use bun_core::strings;

/// The tokens of a tag name or of an attribute name: an identifier, which can have a `-`, or a `JsxNamespacedName`.
struct JsxName {
    /// `End()` of the identifier, or of the `Namespace`. `Pos()` of the name: it is missing.
    namespace_end: usize,
    /// `Pos()` and `End()` of `Name()` of a `JsxNamespacedName`: after the `:`. Both are the same for a missing name.
    local: Option<(usize, usize)>,
    /// `End()` of the name.
    end: usize,
}

impl NodePrinter<'_, '_, '_> {
    /// `emitJsxElement`, `emitJsxSelfClosingElement`, `emitJsxFragment` for the expression `e`. `pos`: `Pos()` of `e`.
    #[optimize(size)]
    pub(super) fn emit_jsx(&mut self, e: ExprId, jsx: JsxId, pos: usize) -> Emitted {
        if self.c.is_stack_low_for_printing() {
            return Err(Stop::OutOfStack);
        }
        let hir = self.hir;
        let jsx = hir[jsx];
        let node = (pos, hir[e].end as usize);
        let state = self.enter_node(node.0, node.1);
        if jsx.tag.is_some() && jsx.close_pos == u32::MAX {
            // `emitJsxSelfClosingElement`
            self.write(b"<");
            let attributes_pos = self.emit_jsx_tag_name_and_type_arguments(&jsx, node)?;
            self.write_space();
            self.emit_jsx_attributes(&jsx, attributes_pos, true)?;
            self.write(b"/>");
        } else {
            // `emitJsxOpeningElement`, `emitJsxOpeningFragment`
            let opening = (pos, jsx.opening_end as usize);
            let opening_state = self.enter_node(opening.0, opening.1);
            self.write(b"<");
            if jsx.tag.is_some() {
                let attributes_pos = self.emit_jsx_tag_name_and_type_arguments(&jsx, opening)?;
                if !jsx.attrs.is_empty() {
                    self.write_space();
                }
                self.emit_jsx_attributes(&jsx, attributes_pos, false)?;
            }
            self.write(b">");
            self.exit_node(opening_state);
            self.emit_jsx_children(&jsx, node)?;
            // `emitJsxClosingElement`, `emitJsxClosingFragment`. A missing tag is where the children end, with no text.
            let closing_state = self.enter_node(jsx.close_pos as usize, node.1);
            self.write(b"</");
            if jsx.close_tag.is_some() {
                self.emit_jsx_tag_name(jsx.close_tag)?;
            }
            self.write(b">");
            self.exit_node(closing_state);
        }
        self.exit_node(state);
        Ok(())
    }

    /// `emitJsxTagName(node.TagName)`, `emitTypeArguments(node, node.TypeArguments)`. Returns the attributes' `Pos()`.
    #[optimize(size)]
    fn emit_jsx_tag_name_and_type_arguments(
        &mut self,
        jsx: &Jsx,
        node: (usize, usize),
    ) -> Result<usize, Stop> {
        let tag_end = self.emit_jsx_tag_name(jsx.tag)?;
        let type_arguments_end = self.emit_type_arguments(node, jsx.type_args, tag_end)?;
        if !jsx.type_args.is_empty() {
            return Ok(type_arguments_end);
        }
        // The HIR has no node for a list without a type, which the printer does not write: `<>`, or a `<` alone.
        let open = self.skip_trivia(type_arguments_end);
        let is_less_than = self.byte(open) == b'<'
            && !matches!(self.byte(open + 1), b'<' | b'=')
            && !(self.byte(open + 1) == b'/' && self.byte(open + 2) != b'*');
        if !is_less_than || open >= jsx.opening_end as usize {
            return Ok(type_arguments_end);
        }
        let close = self.skip_trivia(open + 1);
        Ok(
            match self.byte(close) == b'>' && close < jsx.opening_end as usize {
                true => close + 1,
                false => open + 1,
            },
        )
    }

    /// `emitJsxTagName`. Returns `End()` of the name.
    #[optimize(size)]
    fn emit_jsx_tag_name(&mut self, tag: ExprId) -> Result<usize, Stop> {
        let hir = self.hir;
        match hir[tag].kind {
            // An identifier with a `-`, or a `JsxNamespacedName`.
            ExprKind::String(_) => Ok(self.emit_jsx_name(self.pos_before(hir[tag].pos as usize))),
            // `emitIdentifierReference`, `emitKeywordExpression`, `emitPropertyAccessExpression`
            _ => {
                self.emit_expression(tag, P::Comma)?;
                Ok(self.end_of(tag))
            }
        }
    }

    /// `ScanJsxIdentifier`: the end of the identifier at `start`. It makes an identifier of a private identifier.
    #[optimize(size)]
    fn jsx_identifier_end(&self, start: usize) -> usize {
        let is_identifier = match self.byte(start) {
            b'#' => return jsx_identifier_end(self.text, start + 1),
            b'a'..=b'z' | b'A'..=b'Z' | b'_' | b'$' => true,
            b'\\' | 0x80.. => identifier_end(self.text, start) > start,
            _ => false,
        };
        match is_identifier {
            true => jsx_identifier_end(self.text, start),
            false => start,
        }
    }

    /// `parseJsxTagName`, `parseJsxAttributeName`: the name whose `Pos()` is `pos`.
    #[optimize(size)]
    fn jsx_name(&self, pos: usize) -> JsxName {
        let start = self.skip_trivia(pos);
        let namespace_end = match self.jsx_identifier_end(start) {
            // An identifier that is missing is where the token before it ends.
            end if end == start => pos,
            end => end,
        };
        let colon = self.skip_trivia(namespace_end);
        if self.byte(colon) != b':' {
            return JsxName {
                namespace_end,
                local: None,
                end: namespace_end,
            };
        }
        let local_pos = colon + 1;
        let local_start = self.skip_trivia(local_pos);
        let local_end = match self.jsx_identifier_end(local_start) {
            end if end == local_start => local_pos,
            end => end,
        };
        JsxName {
            namespace_end,
            local: Some((local_pos, local_end)),
            end: local_end,
        }
    }

    /// `emitJsxTagName`, `emitJsxAttributeName`, `emitJsxNamespacedName`. `pos`: `Pos()`. Returns `End()` of the name.
    #[optimize(size)]
    fn emit_jsx_name(&mut self, pos: usize) -> usize {
        let name = self.jsx_name(pos);
        let Some((local_pos, local_end)) = name.local else {
            if name.namespace_end != pos {
                self.emit_source(pos, name.namespace_end);
            }
            return name.end;
        };
        let state = self.enter_node(pos, name.end);
        if name.namespace_end != pos {
            self.emit_source(pos, name.namespace_end);
        }
        self.write(b":");
        if local_end != local_pos {
            self.emit_source(local_pos, local_end);
        }
        self.exit_node(state);
        name.end
    }

    /// Where the `=` of an attribute ends, if it follows the name that ends at `name_end`.
    #[optimize(size)]
    fn jsx_equals_end(&self, name_end: usize) -> Option<usize> {
        let equals = self.skip_trivia(name_end);
        (self.byte(equals) == b'=' && !matches!(self.byte(equals + 1), b'=' | b'>'))
            .then_some(equals + 1)
    }

    /// The end of the blanks at `pos`: `IsWhiteSpaceLike`.
    #[optimize(size)]
    fn skip_white_space_like(&self, pos: usize) -> usize {
        let pos = pos.min(self.text.len());
        lexer::end_of_run(self.text, pos, lexer::is_white_space_like)
    }

    /// `Pos()` and `End()` of `p`. `previous_end`: `End()` of the attribute before it, or `Pos()` of the attributes.
    #[optimize(size)]
    fn jsx_attribute_range(&self, p: PropId, previous_end: usize) -> Child {
        let attribute = &self.hir[p];
        // The node before it can end after the blanks that follow its `=`.
        let pos = self.pos_before(attribute.start as usize).max(previous_end);
        let mut end = attribute.end as usize;
        // A `=` without a value: the attribute ends where the scanner stopped.
        if attribute.kind != PropKind::Spread
            && attribute.value.is_none()
            && let Some(equals_end) = self.jsx_equals_end(self.jsx_name(pos).end)
        {
            end = self.skip_white_space_like(equals_end);
        }
        Child { pos, end }
    }

    /// `End()` of the attributes: where the token after them starts, with trivia, after the tokens the parser skipped.
    #[optimize(size)]
    fn end_of_jsx_attributes(
        &self,
        opening_end: usize,
        last_end: usize,
        is_self_closing: bool,
    ) -> usize {
        if opening_end <= last_end {
            return last_end;
        }
        let before = |token: usize| self.pos_before(token).max(last_end);
        let last = opening_end - 1;
        match self.byte(last) {
            b'>' if !is_self_closing => before(last),
            // `/` and `>`. A `>` that does not follow a `/` is the one of a `=>` that the parser skipped.
            b'>' => match self.pos_before(last).checked_sub(1) {
                Some(slash) if slash >= last_end && self.byte(slash) == b'/' => before(slash),
                _ => opening_end,
            },
            // A `/` without its `>`. The one of a `</` is a token that the parser skipped.
            b'/' if is_self_closing && !(last > last_end && self.byte(last - 1) == b'<') => {
                before(last)
            }
            _ => opening_end,
        }
    }

    /// `emitJsxAttributes` for `jsx`. `pos`: `Pos()`, where the tag name or the type arguments end.
    #[optimize(size)]
    fn emit_jsx_attributes(&mut self, jsx: &Jsx, pos: usize, is_self_closing: bool) -> Emitted {
        let attributes = jsx.attrs;
        let mut children: Vec<Child> = Vec::with_capacity(attributes.len());
        let mut last_end = pos;
        for p in attributes.iter() {
            let range = self.jsx_attribute_range(p, last_end);
            last_end = range.end;
            children.push(range);
        }
        let end = self.end_of_jsx_attributes(jsx.opening_end as usize, last_end, is_self_closing);
        let node = (pos, end);
        let state = self.enter_node(pos, end);
        let format = lf::JSX_ELEMENT_ATTRIBUTES;
        self.emit_list(node, Some(node), &children, format, |printer, index| {
            printer.emit_jsx_attribute_like(attributes.at(index), children[index])
        })?;
        self.exit_node(state);
        Ok(())
    }

    /// `emitJsxAttributeLike`: `emitJsxAttribute`, `emitJsxSpreadAttribute`
    #[optimize(size)]
    fn emit_jsx_attribute_like(&mut self, p: PropId, range: Child) -> Emitted {
        let attribute = &self.hir[p];
        let state = self.enter_node(range.pos, range.end);
        if attribute.kind == PropKind::Spread {
            self.write(b"{...");
            if attribute.value.is_some() {
                self.emit_expression(attribute.value, P::Comma)?;
            }
            self.write(b"}");
        } else {
            let name_end = self.emit_jsx_name(range.pos);
            // A `=` without a value is an attribute without an initializer.
            if attribute.value.is_some() {
                self.write(b"=");
                let equals_end = self.jsx_equals_end(name_end).unwrap_or(name_end);
                self.emit_jsx_attribute_value(attribute.value, equals_end)?;
            }
        }
        self.exit_node(state);
        Ok(())
    }

    /// `emitJsxAttributeValue`. `ScanJsxAttributeValue` passes the blanks after the `=` before it reads `value`.
    #[optimize(size)]
    fn emit_jsx_attribute_value(&mut self, value: ExprId, equals_end: usize) -> Emitted {
        let hir = self.hir;
        let pos = self.skip_white_space_like(equals_end);
        if let Some((open, end)) = jsx_expression_around(hir, value) {
            return self.emit_jsx_expression(value, pos, open as usize, end as usize);
        }
        match hir[value].kind {
            // `emitStringLiteral`: the text of the source.
            ExprKind::String(_) => {
                let (start, end) = (hir[value].pos as usize, hir[value].end as usize);
                // After a comment it is a string that `Scan` reads.
                let pos = if start == pos { equals_end } else { pos };
                let state = self.enter_node(pos, end);
                self.write_source_text(start, end);
                self.exit_node(state);
                Ok(())
            }
            ExprKind::Jsx(jsx) => self.emit_jsx(value, jsx, pos),
            // The elements of `a=<b /><c />` are the operands of a comma.
            _ => self.emit_expression(value, P::Comma),
        }
    }

    /// `emitJsxExpression` for the braces from `open` to `end` around `inner`. `pos`: `Pos()`.
    #[optimize(size)]
    fn emit_jsx_expression(
        &mut self,
        inner: ExprId,
        pos: usize,
        open: usize,
        end: usize,
    ) -> Emitted {
        let hir = self.hir;
        let node = (pos, end);
        let state = self.enter_node(pos, end);
        // `node.Expression` and `node.DotDotDotToken`. For `{}` the HIR has a placeholder expression at the brace.
        let (expression, has_dots) = match hir[inner].kind {
            ExprKind::Missing if hir[inner].pos as usize == open => (ExprId::NONE, false),
            ExprKind::Spread(operand) => (operand, true),
            _ => (inner, false),
        };
        // "preserve empty expressions if they contain comments!"
        if expression.is_some() || !self.comments_disabled && self.has_comments_at_position(pos) {
            let is_indented = !self.on_same_line(pos, end);
            self.increase_indent_if(is_indented);
            let mut at = self.emit_jsx_expression_token(b"{", pos, node);
            if has_dots {
                let dots_end = self.token_after(b"...", at).unwrap_or(at);
                self.emit_token_node(b"...", at, dots_end);
                at = dots_end;
            }
            if expression.is_some() {
                self.emit_expression(expression, P::Yield)?;
                at = at.max(self.end_of(expression));
            }
            self.emit_jsx_expression_token(b"}", at, node);
            self.decrease_indent_if(is_indented);
        }
        self.exit_node(state);
        Ok(())
    }

    /// `hasCommentsAtPosition`
    #[optimize(size)]
    fn has_comments_at_position(&self, pos: usize) -> bool {
        !get_trailing_comment_ranges(self.text, pos + 1).is_empty()
            || !get_leading_comment_ranges(self.text, pos + 1).is_empty()
    }

    /// `emitToken` for a `JsxExpression`: `emitCommentsAfterToken` writes the trailing comments without a space.
    #[optimize(size)]
    fn emit_jsx_expression_token(
        &mut self,
        token: &[u8],
        pos: usize,
        node: (usize, usize),
    ) -> usize {
        let start = self.skip_trivia(pos);
        if node.0 != pos {
            self.emit_leading_comments(pos);
        }
        self.write(token);
        let end = start + token.len();
        if node.1 != end {
            self.emit_trailing_comments_without_separator(end);
        }
        end
    }

    /// `emitTrailingComments(pos, commentSeparatorNone)` after a token of a node that does not end at `pos`.
    #[optimize(size)]
    fn emit_trailing_comments_without_separator(&mut self, pos: usize) {
        if self.comments_disabled || pos > self.text.len() || self.writer.is_at_start_of_line {
            return;
        }
        let written = self.writer.text.len();
        self.writer.emit_trailing_comments(pos);
        // The writer puts a space before each comment, and a comment ends with its `*/`.
        let mut at = written;
        while self.writer.text.get(at) == Some(&b' ') {
            self.writer.text.remove(at);
            match strings::index_of(&self.writer.text[at..], b"*/") {
                Some(close) => at += close + 2,
                None => break,
            }
        }
    }

    /// `emitList(emitJsxChild, node, node.Children, LFJsxElementOrFragmentChildren)`. `node`: `Pos()` and `End()`.
    #[optimize(size)]
    fn emit_jsx_children(&mut self, jsx: &Jsx, node: (usize, usize)) -> Emitted {
        let hir = self.hir;
        let list = (jsx.opening_end as usize, jsx.close_pos as usize);
        // A child starts where the one before it ends. The HIR has no child for a `JsxTextAllWhiteSpaces`.
        let mut children: Vec<Child> = Vec::with_capacity(jsx.children.len());
        let mut expressions: Vec<ExprId> = Vec::with_capacity(jsx.children.len());
        let mut at = list.0;
        let mut add = |child: ExprId, pos: usize, end: usize| {
            if pos > at && self.is_blank_jsx_text(at, pos) {
                children.push(Child { pos: at, end: pos });
                expressions.push(ExprId::NONE);
            }
            if child.is_some() {
                children.push(Child { pos, end });
                expressions.push(child);
            }
            at = end.max(at);
        };
        for child in hir.ids(jsx.children) {
            let child: ExprId = child;
            let braces = jsx_expression_around(hir, child);
            let range = braces.or_else(|| hir.exprs.get(child.idx()).map(|it| (it.pos, it.end)));
            if let Some((pos, end)) = range {
                add(child, pos as usize, end as usize);
            }
        }
        add(ExprId::NONE, list.1, list.1);
        let format = lf::JSX_ELEMENT_OR_FRAGMENT_CHILDREN;
        self.emit_list(node, Some(list), &children, format, |printer, index| {
            printer.emit_jsx_child(expressions[index], children[index])
        })
    }

    /// Whether the text from `pos` to `end` is only blanks and line breaks that the scanner of the HIR passes.
    #[optimize(size)]
    fn is_blank_jsx_text(&self, pos: usize, end: usize) -> bool {
        end <= self.text.len() && self.skip_white_space_like(pos) >= end
    }

    /// `emitJsxChild`. `range`: `Pos()` and `End()`. `child`: none for the text that the HIR has no child for.
    #[optimize(size)]
    fn emit_jsx_child(&mut self, child: ExprId, range: Child) -> Emitted {
        let hir = self.hir;
        if child.is_some() && jsx_expression_around(hir, child).is_some() {
            return self.emit_jsx_expression(child, range.pos, range.pos, range.end);
        }
        match hir.exprs.get(child.idx()).map(|child| child.kind) {
            Some(ExprKind::Jsx(jsx)) => self.emit_jsx(child, jsx, range.pos),
            // `emitJsxText`: `emitLeadingCommentsOfNode` and `emitTrailingCommentsOfNode` leave out a `JsxText`.
            Some(ExprKind::String(_)) | None => {
                self.write_source_text(range.pos, range.end);
                Ok(())
            }
            Some(_) => Ok(()),
        }
    }

    /// `writeLiteral` for the text of the source from `start` to `end`.
    #[optimize(size)]
    fn write_source_text(&mut self, start: usize, end: usize) {
        self.write(self.source(start, end));
    }
}
