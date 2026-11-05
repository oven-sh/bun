use crate::ast::{F_ASYNC, FN_PREDICATE, FN_RETURN_TYPE, FN_TYPE_PARAMETERS, k};
use crate::doc::{LABEL_EMBED, LABEL_EMBED_NO_HUG};
use crate::options::TRAILING_COMMA_ALL;
use crate::print::assignment::LAYOUT_CHAIN_TAIL_ARROW_CHAIN;
use crate::print::comments::DANGLING_BEFORE_ARROW;
use crate::print::core::{
    ARG_EXPAND_FIRST, ARG_EXPAND_LAST, ARG_LAYOUT_MASK, ARG_LAYOUT_SHIFT, ARG_SHARE,
};
use crate::print::statics::{ARROW, ASYNC_, COMMA, LPAREN, RPAREN, SPACE};
use crate::{Quick, R, Words};

impl Quick {
    /// A conditional expression that does not start with an object.
    pub(crate) fn should_add_parens_if_not_break(&self, n: i32) -> bool {
        if (self.n.at(n) & 0xff) != k::ConditionalExpression {
            return false;
        }
        // startsWithNoLookaheadToken(node, isObjectExpression)
        let mut cur = n;
        loop {
            match self.n.at(cur) & 0xff {
                k::BinaryExpression
                | k::LogicalExpression
                | k::AssignmentExpression
                | k::MemberExpression
                | k::ConditionalExpression => {
                    cur = self.n.at(cur + 4);
                    continue;
                }
                k::TaggedTemplateExpression | k::CallExpression => {
                    if (self.n.at(self.n.at(cur + 4)) & 0xff) == k::FunctionExpression {
                        return true;
                    }
                    cur = self.n.at(cur + 4);
                    continue;
                }
                k::UpdateExpression => {
                    if (self.n.at(cur) & (1 << 20)) != 0 {
                        return true;
                    }
                    cur = self.n.at(cur + 4);
                    continue;
                }
                k::BindExpression => {
                    if self.n.at(cur + 4) == 0 {
                        return true;
                    }
                    cur = self.n.at(cur + 4);
                    continue;
                }
                k::SequenceExpression => {
                    cur = self.n.at(self.n.at(cur + 4) + 1);
                    continue;
                }
                _ => {}
            }
            return (self.n.at(cur) & 0xff) != k::ObjectExpression;
        }
    }

    pub(crate) fn may_break_after_short_prefix(&mut self, body: i32) -> R<bool> {
        match self.n.at(body) & 0xff {
            k::ArrayExpression
            | k::ObjectExpression
            | k::ArrowFunctionExpression
            | k::DoExpression
            | k::BlockStatement
            | k::JSXElement
            | k::JSXFragment => {
                return Ok(true);
            }
            _ => {}
        }
        let label = self.embed_label_of(body)?;
        return Ok(label != LABEL_EMBED_NO_HUG
            && (label == LABEL_EMBED || self.is_template_on_its_own_line(body)));
    }

    pub(crate) fn print_signature(&mut self, n: i32, args: i32) -> R<()> {
        if (self.n.at(n) & F_ASYNC) != 0 {
            self.text(ASYNC_);
        }
        if !self.options.arrow_parens_always && self.can_print_params_without_parens(n) {
            self.print(self.n.at(self.n.at(n + 6) + 1))?;
        } else {
            let should_expand_parameters = (args & (ARG_EXPAND_LAST | ARG_EXPAND_FIRST)) != 0;
            let g = self.group_open();
            self.print_function_parameters(n, should_expand_parameters, true)?;
            if self.n.at(n + FN_RETURN_TYPE) != 0 || self.n.at(n + FN_PREDICATE) != 0 {
                if should_expand_parameters {
                    let breaks = self.doc.wb_count;
                    let rg = self.group_open();
                    self.remove_lines_open();
                    self.print_return_type(n)?;
                    self.remove_lines_close();
                    self.group_close(rg);
                    if self.doc.wb_count != breaks {
                        self.set_bailout(true);
                    }
                } else {
                    self.print_return_type(n)?;
                }
            }
            self.group_close(g);
        }
        if self.has_dangling_matching(n, DANGLING_BEFORE_ARROW) {
            self.text(SPACE);
            self.print_dangling_comments_filtered(n, DANGLING_BEFORE_ARROW, false);
        }
        Ok(())
    }

    pub(crate) fn print_arrow_function(&mut self, n: i32, args: i32) -> R<()> {
        let expand_last = (args & ARG_EXPAND_LAST) != 0;
        let layout = (args & ARG_LAYOUT_MASK) >> ARG_LAYOUT_SHIFT;
        let should_print_as_chain =
            !expand_last && (self.n.at(self.n.at(n + 5)) & 0xff) == k::ArrowFunctionExpression;
        // walk the chain
        let mut tail = n;
        let mut should_break_chain = false;
        if should_print_as_chain {
            loop {
                let params = self.n.at(tail + 6);
                let mut i: i32 = 1;
                while i <= self.n.at(params) {
                    if (self.n.at(self.n.at(params + i)) & 0xff) != k::Identifier {
                        should_break_chain = true;
                    }
                    i += 1;
                }
                if (self.n.at(tail + FN_RETURN_TYPE) != 0 && self.n.at(params) > 0)
                    || self.n.at(tail + FN_TYPE_PARAMETERS) != 0
                {
                    should_break_chain = true;
                }
                let body = self.n.at(tail + 5);
                if (self.n.at(body) & 0xff) != k::ArrowFunctionExpression {
                    break;
                }
                tail = body;
            }
        }
        let function_body = self.n.at(tail + 5);
        let add_parens_if_not_break = self.should_add_parens_if_not_break(function_body);
        let should_put_body_on_same_line = !self.has_leading_own_line_comment(function_body)
            && ((self.n.at(function_body) & 0xff) == k::SequenceExpression
                || self.may_break_after_short_prefix(function_body)?
                || (!should_break_chain && add_parens_if_not_break));
        let parent = self.n.at(n + 3);
        let parent_is_call_like = self.is_call_like(parent);
        let is_callee = parent_is_call_like && self.n.at(parent + 4) == n;
        let should_indent_signatures = should_print_as_chain && (is_callee || layout != 0);
        let should_break_signatures = should_indent_signatures
            && (layout == LAYOUT_CHAIN_TAIL_ARROW_CHAIN
                || (is_callee && !should_put_body_on_same_line));
        let chain_group_id = if should_print_as_chain {
            self.new_group_id()
        } else {
            0
        };
        let outer = self.group_open();
        let signatures = self.group_open();
        if should_indent_signatures {
            self.indent_open();
            // `CommentCheckFlags.Leading & CommentCheckFlags.Line` is 0, so this asks for any comment
            if !self.has_comment(n) {
                self.softline();
            }
        }
        if !should_print_as_chain {
            self.print_signature(n, args)?;
            if self.print.bailout {
                return Ok(());
            }
        } else {
            let g = self.group_open();
            let indent_rest = (parent_is_call_like && !is_callee) || self.is_binaryish(parent);
            let indent_all = !indent_rest && !(is_callee || layout != 0);
            if indent_all {
                self.indent_open();
            }
            self.print_signature(n, args)?;
            let mut cur = n;
            let mut first = true;
            while cur != tail {
                cur = self.n.at(cur + 5);
                self.text(ARROW);
                if first && indent_rest {
                    self.indent_open();
                }
                first = false;
                self.line();
                self.print_leading_comments(cur);
                self.print_signature(cur, args)?;
            }
            if indent_rest || indent_all {
                self.indent_close();
            }
            self.group_close_with(g, should_break_chain, 0);
        }
        if should_indent_signatures {
            self.indent_close();
        }
        self.group_close_with(signatures, should_break_signatures, chain_group_id);
        self.text(ARROW);
        let body_group = if should_print_as_chain {
            0
        } else {
            self.group_open()
        };
        if should_print_as_chain {
            self.indent_if_break_open(chain_group_id, false);
        }
        // the body
        let print_comma = expand_last && self.options.trailing_comma == TRAILING_COMMA_ALL;
        let trailing_softline = (expand_last
            || (self.n.at(parent) & 0xff) == k::JSXExpressionContainer)
            && !self.has_comment(n);
        if should_put_body_on_same_line && add_parens_if_not_break {
            self.text(SPACE);
            let g = self.group_open();
            self.if_break_text(0, LPAREN, 0);
            self.indent_softline();
            self.print_arrow_body(function_body, args)?;
            self.indent_close();
            self.if_break_text(0, RPAREN, 0);
            if print_comma {
                self.if_break_text(COMMA, 0, 0);
            }
            if trailing_softline {
                self.softline();
            }
            self.group_close(g);
            self.print_chain_trailing_comments(n, tail);
        } else if should_put_body_on_same_line {
            self.text(SPACE);
            self.print_arrow_body(function_body, args)?;
            self.print_chain_trailing_comments(n, tail);
        } else {
            self.indent_line();
            self.print_arrow_body(function_body, args)?;
            self.print_chain_trailing_comments(n, tail);
            self.indent_close();
            if print_comma {
                self.if_break_text(COMMA, 0, 0);
            }
            if trailing_softline {
                self.softline();
            }
        }
        if should_print_as_chain {
            self.indent_close();
            if is_callee {
                let h = self.if_break_open(chain_group_id);
                self.softline();
                self.if_break_else(h);
                self.if_break_close(h);
            }
        } else {
            self.group_close(body_group);
        }
        self.group_close(outer);
        Ok(())
    }

    /// The trailing comments of the inner arrows of a chain, the innermost first.
    pub(crate) fn print_chain_trailing_comments(&mut self, n: i32, tail: i32) {
        let mut cur = tail;
        while cur != n {
            self.print_trailing_comments(cur);
            cur = self.n.at(cur + 3);
        }
    }

    pub(crate) fn print_arrow_body(&mut self, body: i32, args: i32) -> R<()> {
        let k = self.n.at(body) & 0xff;
        // Only an arrow function and a conditional expression look at the arguments.
        if k == k::ArrowFunctionExpression
            || (k == k::ConditionalExpression && (args & ARG_LAYOUT_MASK) != 0)
        {
            self.print_node(body, args)?;
        } else if (args & ARG_SHARE) != 0 {
            self.print_shared(body)?;
        } else {
            self.print(body)?;
        }
        Ok(())
    }
}
