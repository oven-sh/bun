//! Everything of the form `left operator right` (assignment.js).
//!
//! Prettier prints the left side, looks at the doc, picks a layout and then wraps both sides. Here the left side is
//! already in the stream by then, so the two groups that most layouts put around it are opened beforehand and the ones
//! that the layout does not want are cancelled.

use crate::arena::SUB_SHIFT;
use crate::ast::{F_CHAIN, F_EXT, F_SHORTHAND, FN_TYPE_PARAMETERS, k};
use crate::print::core::ARG_LAYOUT_SHIFT;
use crate::print::statics::{EQ, OPERATOR, SPACE};
use crate::print::util::is_literal_kind;
use crate::{Quick, R, Words};

pub(crate) const LAYOUT_BREAK_AFTER_OPERATOR: i32 = 1;
pub(crate) const LAYOUT_NEVER_BREAK_AFTER_OPERATOR: i32 = 2;
pub(crate) const LAYOUT_FLUID: i32 = 3;
pub(crate) const LAYOUT_BREAK_LHS: i32 = 4;
pub(crate) const LAYOUT_CHAIN: i32 = 5;
pub(crate) const LAYOUT_CHAIN_TAIL: i32 = 6;
pub(crate) const LAYOUT_CHAIN_TAIL_ARROW_CHAIN: i32 = 7;
pub(crate) const LAYOUT_ONLY_LEFT: i32 = 8;
impl Quick {
    pub(crate) fn is_assignment(&self, n: i32) -> bool {
        return (self.n.at(n) & 0xff) == k::AssignmentExpression;
    }

    pub(crate) fn is_assignment_or_variable_declarator(&self, n: i32) -> bool {
        let k = self.n.at(n) & 0xff;
        return k == k::AssignmentExpression || k == k::VariableDeclarator;
    }

    pub(crate) fn is_indentable_block_comment_at(&self, c: i32) -> bool {
        if !self.is_block_comment(c) {
            return false;
        }
        let start = self.comment_start(c);
        let end = self.comment_end(c);
        let mut saw_newline = false;
        let mut p = start + 2;
        while p < end - 1 {
            'c1: {
                if self.t.at(p) != 10 {
                    break 'c1;
                }
                saw_newline = true;
                let mut q = p + 1;
                while self.t.at(q) == 32 || self.t.at(q) == 9 || self.t.at(q) == 13 {
                    q += 1;
                }
                if self.t.at(q) != 42 {
                    return false;
                }
            }
            p += 1;
        }
        return saw_newline;
    }

    pub(crate) fn has_leading_indentable_block_comment(&self, n: i32) -> bool {
        let mut c = self.first_comment(n);
        while c >= 0 {
            if self.is_leading(c) && self.is_indentable_block_comment_at(c) {
                return true;
            }
            c = self.next_comment(c);
        }
        return false;
    }

    pub(crate) fn is_complex_destructuring(&self, n: i32) -> bool {
        if !self.is_assignment_or_variable_declarator(n) {
            return false;
        }
        let left = self.n.at(n + 4);
        if (self.n.at(left) & 0xff) != k::ObjectPattern {
            return false;
        }
        let list = self.n.at(left + 4);
        let count = self.n.at(list);
        if count <= 2 {
            return false;
        }
        let mut i: i32 = 1;
        while i <= count {
            let property = self.n.at(list + i);
            if (self.n.at(property) & 0xff) == k::ObjectProperty
                && ((self.n.at(property) & F_SHORTHAND) == 0
                    || (self.n.at(self.n.at(property + 5)) & 0xff) == k::AssignmentPattern)
            {
                return true;
            }
            if (self.n.at(property) & (0xff | F_SHORTHAND)) == k::Ready {
                return true;
            }
            i += 1;
        }
        return false;
    }

    /// The number of UTF-16 code units in T[start, end).
    pub(crate) fn utf16_length(&self, start: i32, end: i32) -> i32 {
        let mut length: i32 = 0;
        let mut p = start;
        while p < end {
            let c = self.t.at(p);
            if (c & 0xc0) != 0x80 {
                length += if c >= 0xf0 { 2 } else { 1 };
            }
            p += 1;
        }
        return length;
    }

    /// printString(raw).length
    pub(crate) fn printed_string_length(&self, n: i32) -> i32 {
        let start = self.n.at(n + 1);
        let end = self.n.at(n + 2);
        let mut length = self.utf16_length(start, end);
        let quote = self.preferred_quote(start + 1, end - 1, self.options.single_quote);
        if quote == self.t.at(start) {
            return length;
        }
        let other = if quote == 34 { 39 } else { 34 };
        let mut p = start + 1;
        while p < end - 1 {
            let c = self.t.at(p);
            if c == 92 {
                if self.t.at(p + 1) == other {
                    length -= 1;
                }
                p += 1;
            } else if c == quote {
                length += 1;
            }
            p += 1;
        }
        return length;
    }

    pub(crate) fn is_lone_short_argument(&self, n: i32) -> R<bool> {
        self.stack()?;
        if self.has_comment(n) {
            return Ok(false);
        }
        // (a quarter of the width)
        let threshold = self.options.print_width;
        let k = self.n.at(n) & 0xff;
        if k == k::ThisExpression {
            return Ok(true);
        }
        if k == k::Identifier {
            return Ok(self.utf16_length(self.n.at(n + 1), self.n.at(n + 2)) * 4 <= threshold);
        }
        if self.is_signed_numeric_literal(n) && !self.has_comment(self.n.at(n + 4)) {
            return Ok(true);
        }
        if k == k::RegExpLiteral {
            let mut e = self.n.at(n + 2);
            while self.t.at(e - 1) != 47 {
                e -= 1;
            }
            return Ok(self.utf16_length(self.n.at(n + 1) + 1, e - 1) * 4 <= threshold);
        }
        if k == k::StringLiteral {
            return Ok(self.printed_string_length(n) * 4 <= threshold);
        }
        if k == k::TemplateLiteral {
            if self.n.at(self.n.at(n + 5)) != 0 {
                return Ok(false);
            }
            let quasi = self.n.at(self.n.at(n + 4) + 1);
            if self.utf16_length(self.n.at(quasi + 1), self.n.at(quasi + 2)) * 4 > threshold {
                return Ok(false);
            }
            let mut p = self.n.at(quasi + 1);
            while p < self.n.at(quasi + 2) {
                if self.t.at(p) == 10 {
                    return Ok(false);
                }
                p += 1;
            }
            return Ok(true);
        }
        if k == k::UnaryExpression {
            return self.is_lone_short_argument(self.n.at(n + 4));
        }
        if k == k::CallExpression
            && (self.n.at(n) & F_CHAIN) == 0
            && self.n.at(self.n.at(n + 5)) == 0
            && (self.n.at(self.n.at(n + 4)) & 0xff) == k::Identifier
        {
            let callee = self.n.at(n + 4);
            return Ok(
                (self.utf16_length(self.n.at(callee + 1), self.n.at(callee + 2)) + 2) * 4
                    <= threshold,
            );
        }
        return Ok(is_literal_kind(k));
    }

    pub(crate) fn is_call_expression_with_complex_type_arguments(&mut self, n: i32) -> R<bool> {
        let type_arguments = self.n.at(n + 6);
        if type_arguments == 0 {
            return Ok(false);
        }
        let list = self.n.at(type_arguments + 4);
        if self.n.at(list) == 0 {
            return Ok(false);
        }
        if self.n.at(list) > 1 {
            return Ok(true);
        }
        let fk = self.n.at(self.n.at(list + 1)) & 0xff;
        if fk == k::UnionType || fk == k::IntersectionType || fk == k::TypeLiteral {
            return Ok(true);
        }
        let h = self.detach_open();
        self.print(type_arguments)?;
        let v0 = self.detach_close(h);
        return Ok(self.doc_will_break(v0));
    }

    pub(crate) fn is_poorly_breakable_member_or_call_chain(
        &mut self,
        mut n: i32,
        mut deep: bool,
    ) -> R<bool> {
        loop {
            let k = self.n.at(n) & 0xff;
            if k == k::CallExpression {
                let args = self.n.at(n + 5);
                let count = self.n.at(args);
                if !(count == 0
                    || (count == 1 && self.is_lone_short_argument(self.n.at(args + 1))?))
                {
                    return Ok(false);
                }
                if self.is_member_chain_labeled(n)? {
                    return Ok(false);
                }
                if self.is_call_expression_with_complex_type_arguments(n)? {
                    return Ok(false);
                }
                n = self.n.at(n + 4);
                deep = true;
                continue;
            }
            if k == k::MemberExpression || k == k::NonNullExpression {
                n = self.n.at(n + 4);
                deep = true;
                continue;
            }
            return Ok(deep && (k == k::Identifier || k == k::ThisExpression));
        }
    }

    pub(crate) fn should_break_after_operator(
        &mut self,
        right: i32,
        has_short_key: bool,
    ) -> R<bool> {
        if self.is_binaryish(right) && !self.should_inline_logical_expression(right) {
            return Ok(true);
        }
        's0: {
            match self.n.at(right) & 0xff {
                k::SequenceExpression => {
                    return Ok(true);
                }
                k::LiteralType => {
                    // StringLiteralTypeAnnotation
                    if self.mode.is_flow
                        && (self.n.at(self.n.at(right + 4)) & 0xff) == k::StringLiteral
                    {
                        return Ok(true);
                    }
                }
                k::ConditionalType => {
                    if !self.is_generic(self.n.at(right + 4))
                        && !self.is_generic(self.n.at(right + 5))
                    {
                        break 's0;
                    }
                    return Ok(true);
                }
                k::ConditionalExpression => {
                    let test = self.n.at(right + 4);
                    return Ok(
                        self.is_binaryish(test) && !self.should_inline_logical_expression(test)
                    );
                }
                k::ClassExpression => {
                    return Ok(self.n.at(self.n.at(right + 7)) > 0);
                }
                _ => {}
            }
        }
        if has_short_key {
            return Ok(false);
        }
        let mut node = right;
        loop {
            let k = self.n.at(node) & 0xff;
            if k == k::UnaryExpression
                || k == k::AwaitExpression
                || (k == k::YieldExpression && self.n.at(node + 4) != 0)
                || k == k::NonNullExpression
            {
                node = self.n.at(node + 4);
            } else {
                break;
            }
        }
        return Ok((self.n.at(node) & 0xff) == k::StringLiteral
            || self.is_poorly_breakable_member_or_call_chain(node, false)?);
    }

    pub(crate) fn is_generic(&self, n: i32) -> bool {
        match self.n.at(n) & 0xff {
            k::FunctionType => {
                return self.n.at(n + FN_TYPE_PARAMETERS) != 0;
            }
            k::TypeReference => {
                return self.n.at(n + 5) != 0;
            }
            _ => {}
        }
        return false;
    }

    /// The list of the type arguments of a type reference; 0 if it has none or is something else.
    pub(crate) fn type_arguments_of_reference(&self, n: i32) -> i32 {
        if (self.n.at(n) & 0xff) != k::TypeReference || self.n.at(n + 5) == 0 {
            return 0;
        }
        return self.n.at(self.n.at(n + 5) + 4);
    }

    pub(crate) fn has_complex_type_annotation(&self, n: i32) -> bool {
        if (self.n.at(n) & 0xff) != k::VariableDeclarator {
            return false;
        }
        let id = self.n.at(n + 4);
        if (self.n.at(id) & F_EXT) == 0 {
            return false;
        }
        let ik = self.n.at(id) & 0xff;
        let annotation = self.n.at(id + (if ik == k::Identifier { 4 } else { 5 }));
        if annotation == 0 {
            return false;
        }
        let list = self.type_arguments_of_reference(self.n.at(annotation + 4));
        if self.n.at(list) <= 1 {
            return false;
        }
        let mut i: i32 = 1;
        while i <= self.n.at(list) {
            let parameter = self.n.at(list + i);
            if self.n.at(self.type_arguments_of_reference(parameter)) > 0
                || (self.mode.is_type_script && (self.n.at(parameter) & 0xff) == k::ConditionalType)
            {
                return true;
            }
            i += 1;
        }
        return false;
    }

    pub(crate) fn is_complex_type_alias_params(&self, n: i32) -> bool {
        if (self.n.at(n) & 0xff) != k::TypeAlias || self.n.at(n + 5) == 0 {
            return false;
        }
        let list = self.n.at(self.n.at(n + 5) + 4);
        if self.n.at(list) <= 1 {
            return false;
        }
        let mut i: i32 = 1;
        while i <= self.n.at(list) {
            let parameter = self.n.at(list + i);
            if self.n.at(parameter + 5) != 0 || self.n.at(parameter + 6) != 0 {
                return true;
            }
            i += 1;
        }
        return false;
    }

    pub(crate) fn choose_layout(
        &mut self,
        n: i32,
        right: i32,
        left_from: i32,
        can_break_left: bool,
    ) -> R<i32> {
        if right == 0 {
            return Ok(LAYOUT_ONLY_LEFT);
        }
        let k = self.n.at(n) & 0xff;
        let rk = self.n.at(right) & 0xff;
        let is_tail = rk != k::AssignmentExpression;
        if k == k::AssignmentExpression {
            let parent = self.n.at(n + 3);
            if self.is_assignment_or_variable_declarator(parent) {
                let gk = self.n.at(self.n.at(parent + 3)) & 0xff;
                if !is_tail || (gk != k::ExpressionStatement && gk != k::VariableDeclaration) {
                    if !is_tail {
                        return Ok(LAYOUT_CHAIN);
                    }
                    return Ok(
                        if rk == k::ArrowFunctionExpression
                            && (self.n.at(self.n.at(right + 5)) & 0xff)
                                == k::ArrowFunctionExpression
                        {
                            LAYOUT_CHAIN_TAIL_ARROW_CHAIN
                        } else {
                            LAYOUT_CHAIN_TAIL
                        },
                    );
                }
            }
        }
        let is_head_of_long_chain = !is_tail && self.is_assignment(self.n.at(right + 5));
        if is_head_of_long_chain
            || (rk == k::UnionType && !self.should_hug_union_type(right))
            || self.has_leading_own_line_comment(right)
            || (self.has_comment(right) && self.has_leading_indentable_block_comment(right))
        {
            return Ok(LAYOUT_BREAK_AFTER_OPERATOR);
        }
        if k == k::ImportAttribute
            || (rk == k::CallExpression
                && (self.n.at(right) & F_CHAIN) == 0
                && self.is_identifier_named(self.n.at(right + 4), b"require"))
        {
            return Ok(LAYOUT_NEVER_BREAK_AFTER_OPERATOR);
        }
        if self.is_complex_destructuring(n)
            || ((self.mode.is_type_script || self.mode.is_flow)
                && self.has_complex_type_annotation(n))
            || (k == k::VariableDeclarator && rk == k::ArrowFunctionExpression && can_break_left)
        {
            return Ok(LAYOUT_BREAK_LHS);
        }
        let mut has_short_key = false;
        if k == k::ObjectProperty {
            let width = self.plain_text_width(left_from, self.doc.d_pos);
            has_short_key = width >= 0 && width < self.options.tab_width + 3;
        }
        if self.should_break_after_operator(right, has_short_key)? {
            return Ok(LAYOUT_BREAK_AFTER_OPERATOR);
        }
        if k == k::TypeAlias && self.is_complex_type_alias_params(n) {
            return Ok(LAYOUT_BREAK_LHS);
        }
        if !can_break_left
            && (has_short_key
                || rk == k::TemplateLiteral
                || rk == k::TaggedTemplateExpression
                || rk == k::BooleanLiteral
                || rk == k::NumericLiteral
                || rk == k::ClassExpression)
        {
            return Ok(LAYOUT_NEVER_BREAK_AFTER_OPERATOR);
        }
        return Ok(LAYOUT_FLUID);
    }

    pub(crate) fn print_left(&mut self, n: i32) -> R<()> {
        match self.n.at(n) & 0xff {
            k::ObjectProperty | k::ImportAttribute => {
                self.print_key(n)?;
                return Ok(());
            }
            k::ClassProperty => {
                self.print_class_property_left(n)?;
                return Ok(());
            }
            k::TypeAlias => {
                self.print_type_alias_left(n)?;
                return Ok(());
            }
            _ => {}
        }
        self.print(self.n.at(n + 4))?;
        Ok(())
    }

    /// `operator_a` and `operator_b` are printed one after the other; `operator_b` may be 0.
    pub(crate) fn print_assignment(
        &mut self,
        n: i32,
        right: i32,
        operator_a: i32,
        operator_b: i32,
    ) -> R<()> {
        let outer = self.group_open();
        let inner = self.group_open();
        let left_from = self.doc.d_pos;
        let lines = self.doc.line_count;
        self.print_left(n)?;
        let layout = self.choose_layout(n, right, left_from, self.doc.line_count != lines)?;
        if layout == LAYOUT_ONLY_LEFT {
            self.group_cancel(inner);
            self.group_cancel(outer);
            return Ok(());
        }
        if layout == LAYOUT_BREAK_LHS {
            self.group_cancel(inner);
        } else {
            self.group_close(inner);
        }
        let has_outer = layout < LAYOUT_CHAIN;
        if !has_outer {
            self.group_cancel(outer);
        }
        self.text(operator_a);
        if operator_b != 0 {
            self.text(operator_b);
        }
        let args = layout << ARG_LAYOUT_SHIFT;
        match layout {
            LAYOUT_BREAK_AFTER_OPERATOR => {
                let g = self.group_open();
                self.indent_line();
                self.print_node(right, args)?;
                self.indent_close();
                self.group_close(g);
            }
            LAYOUT_NEVER_BREAK_AFTER_OPERATOR => {
                self.text(SPACE);
                self.print_node(right, args)?;
            }
            LAYOUT_FLUID => {
                let id = self.new_group_id();
                let g = self.group_open();
                self.indent_line();
                self.indent_close();
                self.group_close_with(g, false, id);
                self.line_suffix_boundary();
                self.indent_if_break_open(id, false);
                self.print_node(right, args)?;
                self.indent_close();
            }
            LAYOUT_BREAK_LHS => {
                self.text(SPACE);
                let g = self.group_open();
                self.print_node(right, args)?;
                self.group_close(g);
            }
            LAYOUT_CHAIN => {
                self.line();
                self.print_node(right, args)?;
            }
            LAYOUT_CHAIN_TAIL => {
                self.indent_line();
                self.print_node(right, args)?;
                self.indent_close();
            }
            LAYOUT_CHAIN_TAIL_ARROW_CHAIN => {
                self.print_node(right, args)?;
            }
            _ => {}
        }
        if has_outer {
            self.group_close(outer);
        }
        Ok(())
    }

    pub(crate) fn print_assignment_expression(&mut self, n: i32) -> R<()> {
        self.print_assignment(
            n,
            self.n.at(n + 5),
            SPACE,
            OPERATOR.at(((self.n.at(n) as u32) >> SUB_SHIFT) as i32),
        )?;
        Ok(())
    }

    pub(crate) fn print_variable_declarator(&mut self, n: i32) -> R<()> {
        self.print_assignment(n, self.n.at(n + 5), EQ, 0)?;
        Ok(())
    }
}
