use crate::arena::SUB_SHIFT;
use crate::ast::{F_CHAIN, F_COMPUTED, k};
use crate::lang::lang;
use crate::lexer::tk;
use crate::print::statics::{COLON_SPACE, OPERATOR, SPACE};
use crate::print::util::should_flatten;
use crate::{Quick, R, Words};

pub(crate) struct PrintBinaryish {
    /// A node whose leading comments its parent has printed already.
    pub(crate) skip_leading_comments_of: i32,
}
impl PrintBinaryish {
    pub(crate) fn new() -> Self {
        Self {
            skip_leading_comments_of: 0,
        }
    }
}

impl Quick {
    pub(crate) fn should_inline_logical_expression(&self, n: i32) -> bool {
        if (self.n.at(n) & 0xff) != k::LogicalExpression {
            return false;
        }
        let right = self.n.at(n + 5);
        let k = self.n.at(right) & 0xff;
        if k == k::ObjectExpression || k == k::ArrayExpression {
            return self.n.at(self.n.at(right + 4)) > 0;
        }
        return k == k::JSXElement || k == k::JSXFragment;
    }

    pub(crate) fn is_boolean_type_coercion(&self, n: i32) -> bool {
        return (self.n.at(n) & (0xff | F_CHAIN)) == k::CallExpression
            && self.n.at(self.n.at(n + 5)) == 1
            && self.is_identifier_named(self.n.at(n + 4), b"Boolean");
    }

    pub(crate) fn has_leading_type_cast_comment(&self, n: i32) -> bool {
        let mut c = self.first_comment(n);
        while c >= 0 {
            if self.is_leading(c) && self.is_type_cast_comment_at(c) {
                return true;
            }
            c = self.next_comment(c);
        }
        return false;
    }

    pub(crate) fn clear_skip_leading_comments(&mut self) {
        self.print_binaryish.skip_leading_comments_of = 0;
    }

    pub(crate) fn line_before_operator(&self, n: i32) -> bool {
        return (((self.n.at(n) as u32) >> SUB_SHIFT) as i32 == tk::Pipeline
            || (self.n.at(n) & 0xff) == k::NGPipeExpression)
            && !self.has_leading_own_line_comment(self.n.at(n + 5));
    }

    /// `: a : b` behind the name of a pipe
    pub(crate) fn print_pipe_arguments(&mut self, n: i32) -> R<()> {
        let list = self.n.at(n + 6);
        let count = self.n.at(list);
        if count == 0 {
            return Ok(());
        }
        let g = self.group_open();
        self.indent_softline();
        self.text(COLON_SPACE);
        let mut i: i32 = 1;
        while i <= count {
            if i > 1 {
                self.line();
                self.text(COLON_SPACE);
            }
            self.align_open(2);
            let inner = self.group_open();
            self.print(self.n.at(list + i))?;
            self.group_close(inner);
            self.indent_close();
            i += 1;
        }
        self.indent_close();
        self.group_close(g);
        Ok(())
    }

    pub(crate) fn comment_before_operator(&self, right: i32) -> bool {
        return self.has_comment(right)
            && !self.has_leading_type_cast_comment(right)
            && self.has_leading_own_line_comment(right);
    }

    /// What stands between the parts so far and the operator with its right operand.
    pub(crate) fn print_separator(&mut self, n: i32) {
        if self.options.operator_position_start {
            if self.should_inline_logical_expression(n)
                || self.comment_before_operator(self.n.at(n + 5))
            {
                self.text(SPACE);
            }
        } else if !self.line_before_operator(n) {
            self.text(SPACE);
        }
    }

    /// The operator and the right operand.
    pub(crate) fn print_right(&mut self, n: i32, is_inside_parenthesis: bool) -> R<()> {
        let k = self.n.at(n) & 0xff;
        let left = self.n.at(n + 4);
        let right = self.n.at(n + 5);
        let operator = OPERATOR.at(((self.n.at(n) as u32) >> SUB_SHIFT) as i32);
        let should_break = self.has_trailing_line_comment(left);
        let should_group = should_break
            || (!(is_inside_parenthesis && k == k::LogicalExpression)
                && (self.n.at(self.n.at(n + 3)) & 0xff) != k
                && (self.n.at(left) & 0xff) != k
                && (self.n.at(right) & 0xff) != k);
        let g = if should_group { self.group_open() } else { 0 };
        if self.should_inline_logical_expression(n) {
            self.text(operator);
            if self.has_leading_own_line_comment(right) {
                self.indent_line();
                self.print(right)?;
                self.indent_close();
            } else {
                self.text(SPACE);
                self.print(right)?;
            }
        } else if self.options.operator_position_start {
            self.line();
            if self.comment_before_operator(right) {
                self.print_leading_comments(right);
                self.print_binaryish.skip_leading_comments_of = right;
            }
            self.text(operator);
            self.text(SPACE);
            self.print(right)?;
        } else if self.line_before_operator(n) {
            self.line();
            self.text(operator);
            self.text(SPACE);
            if self.parse_pipeline.uses_hack_pipeline
                && ((self.n.at(n) as u32) >> SUB_SHIFT) as i32 == tk::Pipeline
            {
                self.print_nested_parts(right, is_inside_parenthesis)?;
            } else {
                self.print(right)?;
            }
            if k == k::NGPipeExpression {
                self.print_pipe_arguments(n)?;
            }
        } else {
            self.text(operator);
            self.line();
            self.print(right)?;
            if k == k::NGPipeExpression {
                self.print_pipe_arguments(n)?;
            }
        }
        if should_group {
            self.group_close_with(g, should_break, 0);
        }
        Ok(())
    }

    /// The parts up to, but not including, the last operator of `n`.
    pub(crate) fn print_left_parts(
        &mut self,
        n: i32,
        is_inside_parenthesis: bool,
        indent_after_head: bool,
    ) -> R<()> {
        let left = self.n.at(n + 4);
        if self.is_binaryish(left)
            && should_flatten(
                ((self.n.at(n) as u32) >> SUB_SHIFT) as i32,
                ((self.n.at(left) as u32) >> SUB_SHIFT) as i32,
            )
        {
            let comments = self.has_comment(left);
            if comments {
                self.print_leading_comments(left);
            }
            self.print_left_parts(left, is_inside_parenthesis, indent_after_head)?;
            self.print_separator(left);
            self.print_right(left, is_inside_parenthesis)?;
            if comments {
                self.print_trailing_comments(left);
            }
            return Ok(());
        }
        let g = self.group_open();
        self.print(left)?;
        self.group_close(g);
        if indent_after_head {
            self.indent_open();
        }
        Ok(())
    }

    /// printBinaryishExpressions() with isNested, for the right side of a hack pipeline, where the pipelines that follow it are.
    pub(crate) fn print_nested_parts(&mut self, n: i32, is_inside_parenthesis: bool) -> R<()> {
        if !self.is_binaryish(n) {
            let g = self.group_open();
            self.print(n)?;
            self.group_close(g);
            return Ok(());
        }
        let comments = self.has_comment(n);
        if comments {
            self.print_leading_comments(n);
        }
        self.print_parts(n, is_inside_parenthesis)?;
        if comments {
            self.print_trailing_comments(n);
        }
        Ok(())
    }

    pub(crate) fn print_parts(&mut self, n: i32, is_inside_parenthesis: bool) -> R<()> {
        self.print_left_parts(n, is_inside_parenthesis, false)?;
        self.print_separator(n);
        self.print_right(n, is_inside_parenthesis)?;
        Ok(())
    }

    pub(crate) fn print_binaryish_expression(&mut self, n: i32) -> R<()> {
        let parent = self.n.at(n + 3);
        let ph = self.n.at(parent);
        let pk = ph & 0xff;
        if pk == k::IfStatement
            || pk == k::WhileStatement
            || pk == k::SwitchStatement
            || pk == k::DoWhileStatement
        {
            self.print_parts(n, true)?;
            return Ok(());
        }
        if self.parse_pipeline.uses_hack_pipeline
            && ((self.n.at(n) as u32) >> SUB_SHIFT) as i32 == tk::Pipeline
        {
            let g = self.group_open();
            self.print_parts(n, false)?;
            self.group_close(g);
            return Ok(());
        }
        if (self.is_call_or_new(parent) && self.n.at(parent + 4) == n)
            || (pk == k::UnaryExpression && !self.has_comment(n))
            || (pk == k::MemberExpression && (ph & F_COMPUTED) == 0)
        {
            let g = self.group_open();
            self.indent_softline();
            self.print_parts(n, false)?;
            self.dedent_softline();
            self.group_close(g);
            return Ok(());
        }
        let grandparent = self.n.at(parent + 3);
        let should_not_indent = pk == k::ReturnStatement
            || pk == k::ThrowStatement
            || (pk == k::JSXExpressionContainer
                && (self.n.at(grandparent) & 0xff) == k::JSXAttribute)
            || (pk == k::JsExpressionRoot
                && ((self.n.at(n) as u32) >> SUB_SHIFT) as i32 != tk::BitOr)
            || ((self.n.at(n) & 0xff) != k::NGPipeExpression
                && ((pk == k::NGRoot && self.lang.lang == lang::NgBinding)
                    || (pk == k::NGMicrosyntaxExpression
                        && (self.n.at(grandparent) & 0xff) == k::NGMicrosyntax
                        && self.n.at(self.n.at(grandparent + 4)) == 1)))
            || (pk == k::ArrowFunctionExpression && self.n.at(parent + 5) == n)
            || pk == k::ForStatement
            || (pk == k::ConditionalExpression
                && !self.is_return_or_throw(grandparent)
                && !self.is_call_or_new(grandparent))
            || pk == k::TemplateLiteral
            || pk == k::UnaryExpression
            || (pk == k::CallExpression
                && self.n.at(parent + 4) != n
                && self.is_boolean_type_coercion(parent));
        let should_indent_if_inlining = pk == k::AssignmentExpression
            || pk == k::VariableDeclarator
            || pk == k::ClassProperty
            || pk == k::ObjectProperty;
        let left = self.n.at(n + 4);
        let same_precedence_sub_expression = self.is_binaryish(left)
            && should_flatten(
                ((self.n.at(n) as u32) >> SUB_SHIFT) as i32,
                ((self.n.at(left) as u32) >> SUB_SHIFT) as i32,
            );
        let inline = self.should_inline_logical_expression(n);
        if should_not_indent
            || (inline && !same_precedence_sub_expression)
            || (!inline && should_indent_if_inlining)
        {
            let g = self.group_open();
            self.print_parts(n, false)?;
            self.group_close(g);
            return Ok(());
        }
        if !self.is_jsx_element(self.n.at(n + 5)) {
            let g = self.group_open();
            self.print_left_parts(n, false, true)?;
            self.print_separator(n);
            self.print_right(n, false)?;
            self.indent_close();
            self.group_close(g);
            return Ok(());
        }
        let id = self.new_group_id();
        let outer = self.group_open();
        let chain = self.group_open();
        self.print_left_parts(n, false, true)?;
        self.print_separator(n);
        self.indent_close();
        self.group_close_with(chain, false, id);
        self.indent_if_break_open(id, false);
        self.print_right(n, false)?;
        self.indent_close();
        self.group_close(outer);
        Ok(())
    }
}
