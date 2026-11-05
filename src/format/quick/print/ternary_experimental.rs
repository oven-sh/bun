use crate::ast::{F_COMPUTED, SHAPE, k};
use crate::print::assignment::LAYOUT_BREAK_AFTER_OPERATOR;
use crate::print::core::{ARG_LAYOUT_MASK, ARG_LAYOUT_SHIFT};
use crate::print::statics::{_EXTENDS_, _QUESTION, COLON, LPAREN, RPAREN, SPACE};
use crate::{Quick, R, Words};

pub(crate) const FILL_SPACES: i32 = 1803; // staticText(" ".repeat(32))
pub(crate) const FILL_TAB: i32 = 1835; // staticText("\t")
impl Quick {
    pub(crate) fn has_multiline_block_comment(&self, n: i32) -> bool {
        let mut c = self.first_comment(n);
        while c >= 0 {
            if self.is_block_comment(c)
                && self.has_newline_in_range(self.comment_start(c), self.comment_end(c))
            {
                return true;
            }
            c = self.next_comment(c);
        }
        return false;
    }

    /// getExpressionInnerNodeCount(): the children that are single nodes, and theirs; lists do not count.
    pub(crate) fn inner_node_count(&self, n: i32, max_count: i32) -> i32 {
        let shape = SHAPE.at(self.n.at(n) & 0xff);
        let mut count: i32 = 0;
        let mut at = n + 4;
        let mut part: i32 = 0;
        while part < 4 {
            let fields = shape.wrapping_shr((part * 4) as u32) & 15;
            if (part & 1) == 0 {
                let mut i: i32 = 0;
                while i < fields {
                    'c2: {
                        let child = self.n.at(at + i);
                        if child == 0 {
                            break 'c2;
                        }
                        count += 1;
                        count += self.inner_node_count(child, max_count - count);
                        if count > max_count {
                            return count;
                        }
                    }
                    i += 1;
                }
            }
            at += fields;
            part += 1;
        }
        return count;
    }

    pub(crate) fn is_simple_expression_by_node_count(
        &self,
        n: i32,
        max_inner_node_count: i32,
    ) -> bool {
        return self.inner_node_count(n, max_inner_node_count) <= max_inner_node_count;
    }

    pub(crate) fn wrap_in_parens_open(&mut self) {
        self.if_break_text(LPAREN, 0, 0);
        self.indent_softline();
    }

    pub(crate) fn wrap_in_parens_close(&mut self) {
        self.dedent_softline();
        self.if_break_text(RPAREN, 0, 0);
    }

    pub(crate) fn print_fill_tab(&mut self) {
        if self.options.use_tabs {
            self.slice_w(FILL_TAB, FILL_TAB + 1, 0);
        } else {
            self.slice_w(
                FILL_SPACES,
                FILL_SPACES + self.options.tab_width - 1,
                self.options.tab_width - 1,
            );
        }
    }

    pub(crate) fn print_consequent(&mut self, doc: i32, hard: bool) {
        self.indent_open();
        if hard {
            self.hardline();
        } else {
            self.line();
        }
        self.call(doc);
        self.indent_close();
    }

    pub(crate) fn print_ternary_experimental(&mut self, n: i32, args: i32) -> R<()> {
        let kind = self.n.at(n) & 0xff;
        let is_conditional_expression = kind == k::ConditionalExpression;
        let is_ts_conditional = !is_conditional_expression;
        let alternate_at = if is_conditional_expression { 6 } else { 7 };
        let test = self.n.at(n + 4);
        let consequent_node = self.n.at(n + alternate_at - 1);
        let alternate_node = self.n.at(n + alternate_at);
        let parent = self.n.at(n + 3);
        let pk = self.n.at(parent) & 0xff;
        let is_parent_ternary = pk == kind;
        let is_in_test = is_parent_ternary
            && (self.n.at(parent + 4) == n || (is_ts_conditional && self.n.at(parent + 5) == n));
        let is_in_alternate = is_parent_ternary && self.n.at(parent + alternate_at) == n;
        let is_consequent_ternary = (self.n.at(consequent_node) & 0xff) == kind;
        let is_alternate_ternary = (self.n.at(alternate_node) & 0xff) == kind;
        let is_in_chain = is_alternate_ternary || is_in_alternate;
        let is_big_tabs = self.options.tab_width > 2 || self.options.use_tabs;
        let mut previous_parent = n;
        let mut current_parent = parent;
        while current_parent != 0
            && (self.n.at(current_parent) & 0xff) == kind
            && self.n.at(current_parent + 4) != previous_parent
            && (is_conditional_expression || self.n.at(current_parent + 5) != previous_parent)
        {
            previous_parent = current_parent;
            current_parent = self.n.at(current_parent + 3);
        }
        let first_non_conditional_parent = if current_parent != 0 {
            current_parent
        } else {
            parent
        };
        let layout = (args & ARG_LAYOUT_MASK) >> ARG_LAYOUT_SHIFT;
        let is_on_same_line_as_assignment = layout != 0
            && layout != LAYOUT_BREAK_AFTER_OPERATOR
            && (pk == k::AssignmentExpression
                || pk == k::VariableDeclarator
                || pk == k::ClassProperty
                || pk == k::ObjectProperty);
        let is_on_same_line_as_return = (pk == k::ReturnStatement || pk == k::ThrowStatement)
            && !(is_consequent_ternary || is_alternate_ternary);
        let is_in_jsx = is_conditional_expression
            && (self.n.at(first_non_conditional_parent) & 0xff) == k::JSXExpressionContainer
            && (self.n.at(self.n.at(parent + 3)) & 0xff) != k::JSXAttribute;
        let extra_indent = self.should_extra_indent(n);
        let break_closing_paren = (pk == k::MemberExpression
            && (self.n.at(parent) & F_COMPUTED) == 0)
            || (pk == k::NGPipeExpression && self.n.at(parent + 4) == n);
        let break_ts_closing_paren = is_ts_conditional && self.needs_parens(n)?;
        let should_break = self.has_multiline_block_comment(test)
            || (is_ts_conditional && self.has_multiline_block_comment(self.n.at(n + 5)))
            || self.has_multiline_block_comment(consequent_node)
            || self.has_multiline_block_comment(alternate_node)
            || is_consequent_ternary
            || is_alternate_ternary;
        let try_to_parenthesize_alternate = !is_in_chain
            && !is_parent_ternary
            && !is_ts_conditional
            && (if is_in_jsx {
                (self.n.at(consequent_node) & 0xff) == k::NullLiteral
            } else {
                self.is_lone_short_argument(consequent_node)
                    && self.is_simple_expression_by_node_count(test, 3)
            });
        let should_group_test_and_consequent = is_in_chain
            || is_in_alternate
            || (is_ts_conditional && !is_parent_ternary)
            || (is_parent_ternary
                && is_conditional_expression
                && self.is_simple_expression_by_node_count(test, 1))
            || try_to_parenthesize_alternate;
        // ---- the wrappers around all parts
        let mut wrapper: i32;
        if is_on_same_line_as_assignment && !should_break {
            wrapper = 1;
        } else if is_on_same_line_as_assignment || is_on_same_line_as_return {
            wrapper = 2;
        } else if extra_indent || (is_ts_conditional && is_in_test) {
            wrapper = 3;
        } else if parent == first_non_conditional_parent {
            wrapper = 4;
        } else {
            wrapper = 0;
        }
        let outer = if wrapper != 0 { self.group_open() } else { 0 };
        let mut inner: i32 = 0;
        if wrapper == 1 {
            self.indent_softline();
            inner = self.group_open();
        } else if wrapper == 2 {
            self.indent_open();
        } else if wrapper == 3 {
            self.indent_softline();
        }
        // ---- the test and the consequent
        let test_id = self.new_group_id();
        let test_and_consequent_id = self.new_group_id();
        let both = if should_group_test_and_consequent {
            self.group_open()
        } else {
            0
        };
        let test_group = self.group_open();
        if is_conditional_expression {
            self.wrap_in_parens_open();
            self.print(test)?;
            self.wrap_in_parens_close();
            if (self.n.at(test) & 0xff) == k::ConditionalExpression {
                self.break_parent();
            }
        } else {
            self.print(test)?;
            self.text(_EXTENDS_);
            let extends_type = self.n.at(n + 5);
            let ek = self.n.at(extends_type) & 0xff;
            if ek == k::ConditionalType || ek == k::MappedType {
                self.print(extends_type)?;
            } else {
                let g = self.group_open();
                self.wrap_in_parens_open();
                self.print(extends_type)?;
                self.wrap_in_parens_close();
                self.group_close(g);
            }
        }
        self.text(_QUESTION);
        self.group_close_with(test_group, false, test_id);
        let consequent_handle = self.detach_open();
        self.print(consequent_node)?;
        let consequent_doc = self.detach_close(consequent_handle);
        let hard_before_consequent = is_consequent_ternary
            || (is_in_jsx
                && (self.is_jsx_element(consequent_node) || is_parent_ternary || is_in_chain));
        if should_group_test_and_consequent && !is_in_chain {
            // if the test breaks, the consequent breaks too
            let h = self.if_break_open(test_id);
            self.print_consequent(consequent_doc, hard_before_consequent);
            self.if_break_else(h);
            let g = self.group_open();
            self.print_consequent(consequent_doc, hard_before_consequent);
            self.group_close(g);
            self.if_break_close(h);
        } else {
            self.print_consequent(consequent_doc, hard_before_consequent);
        }
        if should_group_test_and_consequent {
            self.group_close_with(both, false, test_and_consequent_id);
        }
        // ---- what stands before the colon
        let test_has_dangling = self.has_dangling_comment(test);
        if test_has_dangling || self.has_dangling_comment(n) {
            self.indent_hardline();
            if test_has_dangling {
                self.print_dangling_comments(test);
            }
            if self.has_dangling_comment(n) {
                self.print_dangling_comments(n);
            }
            self.dedent_hardline();
        } else if is_alternate_ternary {
            self.hardline();
        } else if try_to_parenthesize_alternate {
            let h = self.if_break_open(test_and_consequent_id);
            self.line();
            self.if_break_else(h);
            self.text(SPACE);
            self.if_break_close(h);
        } else {
            self.line();
        }
        self.text(COLON);
        if is_alternate_ternary || !is_big_tabs {
            self.text(SPACE);
        } else if should_group_test_and_consequent {
            let h = self.if_break_open(test_and_consequent_id);
            self.print_fill_tab();
            self.if_break_else(h);
            let h2 = self.if_break_open(0);
            if is_in_chain || try_to_parenthesize_alternate {
                self.text(SPACE);
            } else {
                self.print_fill_tab();
            }
            self.if_break_else(h2);
            self.text(SPACE);
            self.if_break_close(h2);
            self.if_break_close(h);
        } else {
            let h = self.if_break_open(0);
            self.print_fill_tab();
            self.if_break_else(h);
            self.text(SPACE);
            self.if_break_close(h);
        }
        // ---- the alternate
        let alternate_group = if is_alternate_ternary {
            0
        } else {
            self.group_open()
        };
        if !is_alternate_ternary {
            self.indent_open();
        }
        if try_to_parenthesize_alternate {
            let alternate_handle = self.detach_open();
            self.print(alternate_node)?;
            let alternate_doc = self.detach_close(alternate_handle);
            let h = self.if_break_open(test_and_consequent_id);
            self.call(alternate_doc);
            self.if_break_else(h);
            self.dedent_open();
            self.wrap_in_parens_open();
            self.call(alternate_doc);
            self.wrap_in_parens_close();
            self.indent_close();
            self.if_break_close(h);
        } else {
            self.print(alternate_node)?;
        }
        if !is_alternate_ternary {
            self.indent_close();
            if is_in_jsx && !try_to_parenthesize_alternate {
                self.softline();
            }
            self.group_close(alternate_group);
        }
        if break_closing_paren && !extra_indent {
            self.softline();
        }
        if should_break {
            self.break_parent();
        }
        if wrapper == 1 {
            self.group_close(inner);
            self.indent_close();
        } else if wrapper == 2 {
            self.indent_close();
        } else if wrapper == 3 {
            self.indent_close();
            if break_ts_closing_paren {
                self.softline();
            }
        }
        if wrapper != 0 {
            self.group_close(outer);
        }
        Ok(())
    }
}
