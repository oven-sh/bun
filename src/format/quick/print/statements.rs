use crate::arena::SUB_SHIFT;
use crate::ast::{
    F_AWAIT, MK_MODULE, MOD_DECLARE, V_AWAIT_USING, V_CONST, V_LET, V_MASK, V_USING, k,
};
use crate::lexer::tk;
use crate::print::comments::DANGLING_NO_MARKER;
use crate::print::statics::{
    _AWAIT, _IN_, _LBRACE, _LPAREN, _OF_, AWAIT_USING, BREAK, CASE_, CATCH_, COLON, COMMA, CONST,
    CONTINUE, DECLARE_, DEFAULT_COLON, DO, ELSE, FINALLY, FOR, FOR_EVER, FOR_LPAREN, IF_LPAREN,
    LBRACE, LET, LPAREN, RBRACE, RETURN, RPAREN, RPAREN_, SEMI, SPACE, STATIC_, SWITCH_LPAREN,
    THROW, TRY_, USING, VAR, WHILE_LPAREN, WITH_LPAREN,
};
use crate::{Quick, R, Words};

impl Quick {
    // ------------------------------------------------------------------------------------------------------- sequences
    pub(crate) fn print_statement_sequence(&mut self, list: i32) -> R<()> {
        let count = self.n.at(list);
        let mut last: i32 = 0;
        let mut i = count;
        while i >= 1 {
            if (self.n.at(self.n.at(list + i)) & 0xff) != k::EmptyStatement {
                last = self.n.at(list + i);
                break;
            }
            i -= 1;
        }
        let mut i: i32 = 1;
        while i <= count {
            'c2: {
                let statement = self.n.at(list + i);
                if (self.n.at(statement) & 0xff) == k::EmptyStatement {
                    break 'c2;
                }
                self.print_item(statement)?;
                if statement != last {
                    self.hardline();
                    if self.is_next_line_empty(statement) {
                        self.hardline();
                    }
                }
            }
            i += 1;
        }
        Ok(())
    }

    pub(crate) fn has_non_empty_statement(&self, list: i32) -> bool {
        let count = self.n.at(list);
        let mut i: i32 = 1;
        while i <= count {
            if (self.n.at(self.n.at(list + i)) & 0xff) != k::EmptyStatement {
                return true;
            }
            i += 1;
        }
        return false;
    }

    /// Returns whether anything was printed.
    pub(crate) fn block_has_content(&self, n: i32, directives: i32, body: i32) -> bool {
        return self.n.at(directives) > 0
            || self.has_non_empty_statement(body)
            || self.has_dangling_comment(n);
    }

    pub(crate) fn print_block_body(&mut self, n: i32, directives: i32, body: i32) -> R<()> {
        let has_directives = self.n.at(directives) > 0;
        let has_body = self.has_non_empty_statement(body);
        let has_dangling = self.has_dangling_comment(n);
        if has_directives {
            self.print_statement_sequence(directives)?;
            if has_body || has_dangling {
                self.hardline();
                if self.is_next_line_empty(self.n.at(directives + self.n.at(directives))) {
                    self.hardline();
                }
            }
        }
        if has_body {
            self.print_statement_sequence(body)?;
        }
        if has_dangling {
            self.print_dangling_comments(n);
        }
        Ok(())
    }

    pub(crate) fn print_block(&mut self, n: i32) -> R<()> {
        let k = self.n.at(n) & 0xff;
        let directives = if k == k::StaticBlock {
            0
        } else {
            self.n.at(n + 4)
        };
        let body = if k == k::StaticBlock {
            self.n.at(n + 4)
        } else {
            self.n.at(n + 5)
        };
        let parent = self.n.at(n + 3);
        let pk = self.n.at(parent) & 0xff;
        let has_content = self.block_has_content(n, directives, body);
        if k == k::Program && pk != k::ModuleExpression {
            if has_content {
                self.print_block_body(n, directives, body)?;
                self.hardline();
            }
            return Ok(());
        }
        if k == k::StaticBlock {
            self.text(STATIC_);
        }
        self.text(LBRACE);
        if has_content {
            self.indent_hardline();
            self.print_block_body(n, directives, body)?;
            self.dedent_hardline();
        } else {
            match pk {
                k::ArrowFunctionExpression
                | k::FunctionExpression
                | k::FunctionDeclaration
                | k::ObjectMethod
                | k::ClassMethod
                | k::ForStatement
                | k::WhileStatement
                | k::DoWhileStatement
                | k::DoExpression
                | k::ModuleExpression
                | k::ComponentDeclaration
                | k::HookDeclaration
                | k::MatchStatementCase => {}
                k::ModuleDeclaration => {
                    // DeclareNamespace is not on the list
                    if self.mode.is_flow
                        && (((self.n.at(parent) as u32) >> SUB_SHIFT) as i32 & 3) != MK_MODULE
                    {
                        self.hardline();
                    }
                }
                k::CatchClause => {
                    if self.n.at(self.n.at(parent + 3) + 6) != 0 {
                        self.hardline();
                    }
                }
                _ => {
                    if k != k::StaticBlock {
                        self.hardline();
                    }
                }
            }
        }
        self.text(RBRACE);
        Ok(())
    }

    // ------------------------------------------------------------------------------------------- expression statements
    pub(crate) fn expression_needs_asi_protection(&mut self, n: i32) -> R<bool> {
        match self.n.at(n) & 0xff {
            k::ParenthesizedExpression
            | k::TypeAssertion
            | k::TypeCastExpression
            | k::ArrayExpression
            | k::ArrayPattern
            | k::TemplateLiteral
            | k::TemplateElement
            | k::RegExpLiteral
            | k::JSXElement
            | k::JSXFragment => {
                return Ok(true);
            }
            k::ArrowFunctionExpression => {
                if self.options.arrow_parens_always || !self.can_print_params_without_parens(n) {
                    return Ok(true);
                }
            }
            k::UnaryExpression => {
                let o = ((self.n.at(n) as u32) >> SUB_SHIFT) as i32;
                if o == tk::Add || o == tk::Sub {
                    return Ok(true);
                }
            }
            k::BindExpression => {
                if self.n.at(n + 4) == 0 {
                    return Ok(true);
                }
            }
            _ => {}
        }
        if self.needs_parens(n)? {
            return Ok(true);
        }
        if !self.has_naked_left_side(n) {
            return Ok(false);
        }
        return Ok(self.expression_needs_asi_protection(self.get_left_side_child(n))?);
    }

    pub(crate) fn expression_statement_needs_leading_semicolon(&mut self, n: i32) -> R<bool> {
        if self.options.semi {
            return Ok(false);
        }
        if (self.n.at(n) & 0xff) != k::ExpressionStatement {
            return Ok(false);
        }
        match self.n.at(self.n.at(n + 3)) & 0xff {
            k::Program | k::BlockStatement | k::StaticBlock | k::SwitchCase | k::ModuleBlock => {
                return Ok(self.expression_needs_asi_protection(self.n.at(n + 4))?);
            }
            _ => {}
        }
        return Ok(false);
    }

    pub(crate) fn print_expression_statement(&mut self, n: i32) -> R<()> {
        if self.expression_statement_needs_leading_semicolon(n)? {
            if self.should_expression_statement_print_own_comments(n)? {
                let type_cast = self.last_leading_comment(n);
                self.print_leading_comments_filtered(n, type_cast, -1);
                self.text(SEMI);
                self.print_leading_comments_filtered(n, -1, type_cast);
                self.print(self.n.at(n + 4))?;
                self.print_trailing_comments(n);
                return Ok(());
            }
            self.text(SEMI);
            self.print(self.n.at(n + 4))?;
            return Ok(());
        }
        self.print(self.n.at(n + 4))?;
        if self.options.semi {
            self.text(SEMI);
        }
        Ok(())
    }

    pub(crate) fn should_ignored_node_print_semicolon(&self, mut n: i32) -> bool {
        loop {
            match self.statement_kind(n) {
                k::ExpressionStatement
                | k::Directive
                | k::ImportDeclaration
                | k::ExportDefaultDeclaration
                | k::ExportNamedDeclaration
                | k::ExportAllDeclaration
                | k::ReturnStatement
                | k::ThrowStatement
                | k::DoWhileStatement => {
                    // only if the source has the semicolon
                    return self.full_end(n) != self.n.at(n + 2);
                }
                k::BreakStatement
                | k::ContinueStatement
                | k::DebuggerStatement
                | k::VariableDeclaration => {
                    return true;
                }
                k::IfStatement => {
                    if (self.n.at(n) & 0xff) == k::ReadyWrap {
                        // it ends with a block
                        return false;
                    }
                    n = if self.n.at(n + 6) != 0 {
                        self.n.at(n + 6)
                    } else {
                        self.n.at(n + 5)
                    };
                    continue;
                }
                k::ForInStatement | k::ForOfStatement => {
                    if (self.n.at(n) & 0xff) == k::ReadyWrap {
                        return false;
                    }
                    n = self.n.at(n + 6);
                    continue;
                }
                k::ForStatement => {
                    if (self.n.at(n) & 0xff) == k::ReadyWrap {
                        return false;
                    }
                    n = self.n.at(n + 7);
                    continue;
                }
                k::LabeledStatement | k::WithStatement | k::WhileStatement => {
                    if (self.n.at(n) & 0xff) == k::ReadyWrap {
                        return false;
                    }
                    n = self.n.at(n + 5);
                    continue;
                }
                _ => {}
            }
            return false;
        }
    }

    // ---------------------------------------------------------------------------------------------------- declarations
    pub(crate) fn print_variable_declaration(&mut self, n: i32) -> R<()> {
        let list = self.n.at(n + 4);
        let count = self.n.at(list);
        let parent = self.n.at(n + 3);
        let pk = self.n.at(parent) & 0xff;
        let is_for_init =
            (pk == k::ForStatement || pk == k::ForInStatement || pk == k::ForOfStatement)
                && self.n.at(parent + 4) == n;
        let mut has_value = false;
        let mut i: i32 = 1;
        while i <= count {
            if self.n.at(self.n.at(list + i) + 5) != 0 {
                has_value = true;
            }
            i += 1;
        }
        let g = self.group_open();
        if (((self.n.at(n) as u32) >> SUB_SHIFT) as i32) >= MOD_DECLARE {
            self.text(DECLARE_);
        }
        match ((self.n.at(n) as u32) >> SUB_SHIFT) as i32 & V_MASK {
            V_LET => {
                self.text(LET);
            }
            V_CONST => {
                self.text(CONST);
            }
            V_USING => {
                self.text(USING);
            }
            V_AWAIT_USING => {
                self.text(AWAIT_USING);
            }
            _ => {
                self.text(VAR);
            }
        }
        self.text(SPACE);
        let first = self.n.at(list + 1);
        if count == 1 && !self.has_comment(first) {
            self.print(first)?;
        } else {
            self.indent_open();
            self.print(first)?;
            self.indent_close();
        }
        if count > 1 {
            self.indent_open();
            let mut i: i32 = 2;
            while i <= count {
                self.text(COMMA);
                if has_value && !is_for_init {
                    self.hardline();
                } else {
                    self.line();
                }
                self.print(self.n.at(list + i))?;
                i += 1;
            }
            self.indent_close();
        }
        if !is_for_init && self.options.semi {
            self.text(SEMI);
        }
        self.group_close(g);
        Ok(())
    }

    // --------------------------------------------------------------------------------------------------------- clauses
    pub(crate) fn should_print_leading_hardline(&self, n: i32) -> bool {
        let first = self.first_leading_comment(n);
        if first < 0 {
            return false;
        }
        let start = self.comment_start(first);
        return self.has_newline_in_range(start, self.comment_end(first))
            || self.has_newline_before(start);
    }

    pub(crate) fn print_clause(&mut self, n: i32, is_else_if: bool) -> R<()> {
        let k = self.n.at(n) & 0xff;
        if k == k::EmptyStatement {
            if self.has_leading_comment(n) {
                self.text(SPACE);
            }
            self.print(n)?;
            return Ok(());
        }
        let is_block = k == k::BlockStatement;
        if self.should_print_leading_hardline(n) {
            if is_block {
                self.hardline();
                self.print(n)?;
            } else {
                self.indent_hardline();
                self.print(n)?;
                self.indent_close();
            }
            return Ok(());
        }
        if is_block || (is_else_if && k == k::IfStatement) {
            self.text(SPACE);
            self.print(n)?;
            return Ok(());
        }
        self.indent_line();
        self.print(n)?;
        self.indent_close();
        Ok(())
    }

    pub(crate) fn is_logical_not(&self, n: i32) -> bool {
        return (self.n.at(n) & 0xff) == k::UnaryExpression
            && ((self.n.at(n) as u32) >> SUB_SHIFT) as i32 == tk::Not;
    }

    pub(crate) fn should_inline_condition(&self, n: i32) -> bool {
        if self.has_comment(n) || !self.is_logical_not(n) {
            return false;
        }
        let mut inner = self.n.at(n + 4);
        if self.is_logical_not(inner) {
            inner = self.n.at(inner + 4);
        }
        return (self.n.at(inner) & 0xff) == k::LogicalExpression;
    }

    pub(crate) fn print_condition(&mut self, test: i32) -> R<()> {
        if self.should_inline_condition(test) {
            self.print(test)?;
            return Ok(());
        }
        let g = self.group_open();
        self.indent_softline();
        self.print(test)?;
        self.dedent_softline();
        self.group_close(g);
        Ok(())
    }

    pub(crate) fn print_if_statement(&mut self, n: i32) -> R<()> {
        let consequent = self.n.at(n + 5);
        let alternate = self.n.at(n + 6);
        let g = self.group_open();
        self.text(IF_LPAREN);
        self.print_condition(self.n.at(n + 4))?;
        self.text(RPAREN);
        self.print_clause(consequent, false)?;
        self.group_close(g);
        if alternate == 0 {
            return Ok(());
        }
        let is_block = (self.n.at(consequent) & 0xff) == k::BlockStatement;
        let mut need_space = is_block;
        if !is_block {
            self.hardline();
        }
        let first = self.first_dangling_comment(n);
        if first >= 0 {
            if self.is_previous_line_empty_before(self.comment_start(first)) {
                self.hardline();
                if is_block {
                    self.hardline();
                }
            } else if self.has_newline_before(self.comment_start(first)) {
                if is_block {
                    self.hardline();
                }
            } else {
                self.text(SPACE);
            }
            self.print_dangling_comments(n);
            let last = self.last_dangling_comment(n);
            if !self.is_block_comment(last) || self.has_newline(self.comment_end(last)) {
                self.hardline();
            } else {
                self.text(SPACE);
            }
            need_space = false;
        }
        if need_space {
            self.text(SPACE);
        }
        self.text(ELSE);
        let g2 = self.group_open();
        self.print_clause(alternate, true)?;
        self.group_close(g2);
        Ok(())
    }

    pub(crate) fn print_for_statement(&mut self, n: i32) -> R<()> {
        let init = self.n.at(n + 4);
        let test = self.n.at(n + 5);
        let update = self.n.at(n + 6);
        let body = self.n.at(n + 7);
        if self.print_dangling_comments(n) {
            self.softline();
        }
        let g = self.group_open();
        if init == 0 && test == 0 && update == 0 {
            self.text(FOR_EVER);
            self.print_clause(body, false)?;
            self.group_close(g);
            return Ok(());
        }
        self.text(FOR_LPAREN);
        let g2 = self.group_open();
        self.indent_softline();
        self.print(init)?;
        self.text(SEMI);
        self.line();
        self.print(test)?;
        self.text(SEMI);
        if update != 0 {
            self.line();
            self.print(update)?;
        }
        self.dedent_softline();
        self.group_close(g2);
        self.text(RPAREN);
        self.print_clause(body, false)?;
        self.group_close(g);
        Ok(())
    }

    pub(crate) fn print_for_x_statement(&mut self, n: i32) -> R<()> {
        let is_of = (self.n.at(n) & 0xff) == k::ForOfStatement;
        let g = self.group_open();
        self.text(FOR);
        if is_of && (self.n.at(n) & F_AWAIT) != 0 {
            self.text(_AWAIT);
        }
        self.text(_LPAREN);
        self.print(self.n.at(n + 4))?;
        self.text(if is_of { _OF_ } else { _IN_ });
        self.print(self.n.at(n + 5))?;
        self.text(RPAREN);
        self.print_clause(self.n.at(n + 6), false)?;
        self.group_close(g);
        Ok(())
    }

    pub(crate) fn print_while_statement(&mut self, n: i32) -> R<()> {
        let g = self.group_open();
        self.text(if (self.n.at(n) & 0xff) == k::WithStatement {
            WITH_LPAREN
        } else {
            WHILE_LPAREN
        });
        self.print_condition(self.n.at(n + 4))?;
        self.text(RPAREN);
        self.print_clause(self.n.at(n + 5), false)?;
        self.group_close(g);
        Ok(())
    }

    pub(crate) fn print_do_while_statement(&mut self, n: i32) -> R<()> {
        let body = self.n.at(n + 4);
        let g = self.group_open();
        self.text(DO);
        self.print_clause(body, false)?;
        self.group_close(g);
        if (self.n.at(body) & 0xff) == k::BlockStatement {
            self.text(SPACE);
        } else {
            self.hardline();
        }
        self.text(WHILE_LPAREN);
        self.print_condition(self.n.at(n + 5))?;
        self.text(RPAREN);
        if self.options.semi {
            self.text(SEMI);
        }
        Ok(())
    }

    pub(crate) fn print_break_or_continue(&mut self, n: i32) -> R<()> {
        self.text(if (self.n.at(n) & 0xff) == k::BreakStatement {
            BREAK
        } else {
            CONTINUE
        });
        if self.n.at(n + 4) != 0 {
            self.text(SPACE);
            self.print(self.n.at(n + 4))?;
        }
        if self.options.semi {
            self.text(SEMI);
        }
        Ok(())
    }

    pub(crate) fn print_labeled_statement(&mut self, n: i32) -> R<()> {
        let body = self.n.at(n + 5);
        self.print(self.n.at(n + 4))?;
        self.text(COLON);
        if !((self.n.at(body) & 0xff) == k::EmptyStatement && !self.has_leading_comment(body)) {
            self.text(SPACE);
        }
        self.print(body)?;
        Ok(())
    }

    pub(crate) fn print_switch_statement(&mut self, n: i32) -> R<()> {
        let g = self.group_open();
        self.text(SWITCH_LPAREN);
        self.indent_softline();
        self.print(self.n.at(n + 4))?;
        self.dedent_softline();
        self.text(RPAREN);
        self.group_close(g);
        self.text(_LBRACE);
        let cases = self.n.at(n + 5);
        let count = self.n.at(cases);
        if count > 0 {
            self.indent_hardline();
            let mut i: i32 = 1;
            while i <= count {
                let c = self.n.at(cases + i);
                self.print(c)?;
                if i != count {
                    if self.is_next_line_empty(c) {
                        self.hardline();
                    }
                    self.hardline();
                }
                i += 1;
            }
            self.indent_close();
        } else {
            self.print_dangling_comments_filtered(n, DANGLING_NO_MARKER, true);
        }
        self.hardline();
        self.text(RBRACE);
        Ok(())
    }

    pub(crate) fn print_switch_case(&mut self, n: i32) -> R<()> {
        if self.n.at(n + 4) != 0 {
            self.text(CASE_);
            self.print(self.n.at(n + 4))?;
            self.text(COLON);
        } else {
            self.text(DEFAULT_COLON);
        }
        if self.has_dangling_comment(n) {
            self.text(SPACE);
            self.print_dangling_comments(n);
        }
        let list = self.n.at(n + 5);
        let count = self.n.at(list);
        let mut real: i32 = 0;
        let mut only: i32 = 0;
        let mut i: i32 = 1;
        while i <= count {
            if (self.n.at(self.n.at(list + i)) & 0xff) != k::EmptyStatement {
                real += 1;
                only = self.n.at(list + i);
            }
            i += 1;
        }
        if real == 0 {
            return Ok(());
        }
        if real == 1 && (self.n.at(only) & 0xff) == k::BlockStatement {
            self.text(SPACE);
            self.print_statement_sequence(list)?;
        } else {
            self.indent_hardline();
            self.print_statement_sequence(list)?;
            self.indent_close();
        }
        Ok(())
    }

    pub(crate) fn print_try_statement(&mut self, n: i32) -> R<()> {
        self.text(TRY_);
        self.print(self.n.at(n + 4))?;
        if self.n.at(n + 5) != 0 {
            self.text(SPACE);
            self.print(self.n.at(n + 5))?;
        }
        if self.n.at(n + 6) != 0 {
            self.text(FINALLY);
            self.print(self.n.at(n + 6))?;
        }
        Ok(())
    }

    pub(crate) fn print_catch_clause(&mut self, n: i32) -> R<()> {
        let param = self.n.at(n + 4);
        self.text(CATCH_);
        if param != 0 {
            let mut parameter_has_comments = false;
            let mut c = self.first_comment(param);
            while c >= 0 {
                if !self.is_block_comment(c)
                    || (self.is_leading(c) && self.has_newline(self.comment_end(c)))
                    || (self.is_trailing(c) && self.has_newline_before(self.comment_start(c)))
                {
                    parameter_has_comments = true;
                }
                c = self.next_comment(c);
            }
            self.text(LPAREN);
            if parameter_has_comments {
                self.indent_softline();
                self.print(param)?;
                self.dedent_softline();
            } else {
                self.print(param)?;
            }
            self.text(RPAREN_);
        }
        self.print(self.n.at(n + 5))?;
        Ok(())
    }

    pub(crate) fn print_return_or_throw_statement(&mut self, n: i32) -> R<()> {
        self.text(if (self.n.at(n) & 0xff) == k::ThrowStatement {
            THROW
        } else {
            RETURN
        });
        let argument = self.n.at(n + 4);
        if argument != 0 {
            self.text(SPACE);
            if self.return_argument_has_leading_comment(argument) {
                self.text(LPAREN);
                self.indent_hardline();
                self.print(argument)?;
                self.dedent_hardline();
                self.text(RPAREN);
            } else if self.is_binaryish(argument)
                || (self.options.experimental_ternaries
                    && (self.n.at(argument) & 0xff) == k::ConditionalExpression
                    && ((self.n.at(self.n.at(argument + 5)) & 0xff) == k::ConditionalExpression
                        || (self.n.at(self.n.at(argument + 6)) & 0xff) == k::ConditionalExpression))
            {
                let g = self.group_open();
                self.if_break_text(LPAREN, 0, 0);
                self.indent_softline();
                self.print(argument)?;
                self.dedent_softline();
                self.if_break_text(RPAREN, 0, 0);
                self.group_close(g);
            } else {
                self.print(argument)?;
            }
        }
        if self.options.semi {
            self.text(SEMI);
        }
        Ok(())
    }

    pub(crate) fn print_sequence_expression(&mut self, n: i32) -> R<()> {
        let list = self.n.at(n + 4);
        let count = self.n.at(list);
        let parent = self.n.at(n + 3);
        let pk = self.n.at(parent) & 0xff;
        let g = self.group_open();
        if pk == k::ExpressionStatement || pk == k::ForStatement {
            let mut i: i32 = 1;
            while i <= count {
                if i == 1 {
                    self.print(self.n.at(list + i))?;
                } else {
                    self.text(COMMA);
                    self.indent_line();
                    self.print(self.n.at(list + i))?;
                    self.indent_close();
                }
                i += 1;
            }
            self.group_close(g);
            return Ok(());
        }
        let should_indent = (self.is_return_or_throw(parent) && self.needs_parens(n)?)
            || (pk == k::ArrowFunctionExpression && self.n.at(parent + 5) == n);
        if should_indent {
            // ifBreak([indent([softline, parts]), softline], parts): the parts are written twice
            let h = self.if_break_open(0);
            self.indent_softline();
            self.print_sequence_parts(list, count)?;
            self.dedent_softline();
            self.if_break_else(h);
            self.print_sequence_parts(list, count)?;
            self.if_break_close(h);
        } else {
            self.print_sequence_parts(list, count)?;
        }
        self.group_close(g);
        Ok(())
    }

    pub(crate) fn print_sequence_parts(&mut self, list: i32, count: i32) -> R<()> {
        let mut i: i32 = 1;
        while i <= count {
            if i > 1 {
                self.text(COMMA);
                self.line();
            }
            self.reserve();
            self.print(self.n.at(list + i))?;
            i += 1;
        }
        Ok(())
    }
}
