    /// Logs, in a lint parse only, the diagnostic `message` of the reference at `range`, past the lexer. True in a lint parse.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_error(&mut self, range: Range, message: Message, argument: &[u8]) -> bool {
        if !self.is_lint_parse() {
            return false;
        }
        // As the lexer: one error for one place.
        if self.lexer.prev_error_loc.eql(range.loc) {
            return true;
        }
        let msgs_len = self.log().msgs.len();
        let text = message.format(argument);
        self.log().add_range_error_fmt(
            Some(self.source),
            range,
            format_args!("{}", bstr::BStr::new(&text)),
        );
        self.lexer.prev_error_loc = range.loc;
        self.code_syntax_error(msgs_len, message, argument, range);
        true
    }

    /// From `loc` to the end of the token before the one the lexer is on.
    fn range_before_token(&self, loc: Loc) -> Range {
        let lexer = &self.lexer;
        let start = u32::try_from(loc.start).unwrap_or(0);
        let next = u32::try_from(lexer.start).unwrap_or(u32::MAX);
        let end = ts::full_start(lexer.contents, &lexer.all_comments, next).max(start);
        ts::range(start, end)
    }

    /// `Lexer::unexpected` at a token that starts no expression, read at `level`.
    #[cold]
    #[inline(never)]
    pub(crate) fn expression_expected(&mut self, level: Level) -> Result<(), Error> {
        // parseElementAccessExpressionRest: only an element access reads an expression at the lowest level right after a "["
        if level == Level::Lowest
            && self.lexer.token == T::TCloseBracket
            && self.is_lint_parse()
            && self.byte_before_token() == Some(b'[')
        {
            let msgs_len = self.log().msgs.len();
            self.lexer.unexpected()?;
            // The reference marks the place after the "[".
            let lexer = &self.lexer;
            let next = u32::try_from(lexer.start).unwrap_or(u32::MAX);
            let at = ts::full_start(lexer.contents, &lexer.all_comments, next);
            self.code_syntax_error(
                msgs_len,
                AN_ELEMENT_ACCESS_EXPRESSION_SHOULD_TAKE_AN_ARGUMENT,
                b"",
                ts::range(at, at),
            );
            return Ok(());
        }
        self.unexpected_as(EXPRESSION_EXPECTED)
    }

    /// `Lexer::unexpected` at the `**` after the unary expression at `loc`, whose operator is `operator`: parseUnaryExpressionOrHigher reports the unary expression.
    #[cold]
    #[inline(never)]
    pub(crate) fn unary_before_exponent(
        &mut self,
        loc: Loc,
        operator: &'static [u8],
    ) -> Result<(), Error> {
        let msgs_len = self.log().msgs.len();
        self.lexer.unexpected()?;
        let range = self.range_before_token(loc);
        self.code_syntax_error(
            msgs_len,
            AN_UNARY_EXPRESSION_WITH_THE_0_OPERATOR_IS_NOT_ALLOWED_IN_THE_LEFT_HAND_SIDE_OF_AN_EXPONENTIATION_EXPRESSION,
            operator,
            range,
        );
        Ok(())
    }

    /// `Lexer::unexpected` at the `**` after the type assertion at `loc`, in a lint parse.
    #[cold]
    #[inline(never)]
    pub(crate) fn type_assertion_before_exponent(&mut self, loc: Loc) -> Result<(), Error> {
        let msgs_len = self.log().msgs.len();
        self.lexer.unexpected()?;
        let range = self.range_before_token(loc);
        self.code_syntax_error(
            msgs_len,
            A_TYPE_ASSERTION_EXPRESSION_IS_NOT_ALLOWED_IN_THE_LEFT_HAND_SIDE_OF_AN_EXPONENTIATION_EXPRESSION,
            b"",
            range,
        );
        Ok(())
    }

    /// The operand of the unary expression at `loc`, whose operator is `operator`, failed. Where the operand is a unary expression before `**`, the reference reports the outer one.
    #[cold]
    #[inline(never)]
    pub(crate) fn unary_operand_failed(
        &mut self,
        loc: Loc,
        operator: &'static [u8],
        err: Error,
    ) -> Error {
        let start = u32::try_from(loc.start).unwrap_or(0);
        let operator_end = start.saturating_add(u32::try_from(operator.len()).unwrap_or(0));
        self.widen_record_before_exponent(
            start,
            operator_end,
            AN_UNARY_EXPRESSION_WITH_THE_0_OPERATOR_IS_NOT_ALLOWED_IN_THE_LEFT_HAND_SIDE_OF_AN_EXPONENTIATION_EXPRESSION,
            operator,
        );
        err
    }

    /// The operand of the type assertion at `loc`, whose ">" is at `greater_than`, failed.
    #[cold]
    #[inline(never)]
    pub(crate) fn type_assertion_operand_failed(
        &mut self,
        loc: Loc,
        greater_than: Loc,
        err: Error,
    ) -> Error {
        let start = u32::try_from(loc.start).unwrap_or(0);
        let operator_end = u32::try_from(greater_than.start).unwrap_or(0).saturating_add(1);
        self.widen_record_before_exponent(
            start,
            operator_end,
            A_TYPE_ASSERTION_EXPRESSION_IS_NOT_ALLOWED_IN_THE_LEFT_HAND_SIDE_OF_AN_EXPONENTIATION_EXPRESSION,
            b"",
        );
        err
    }

    fn widen_record_before_exponent(
        &mut self,
        start: u32,
        operator_end: u32,
        to: Message,
        argument: &[u8],
    ) {
        let Some(starts) = &mut self.starts_for_parse_only else {
            return;
        };
        if !starts.is_lint {
            return;
        }
        let mut errors = core::mem::take(&mut starts.syntax_errors);
        errors.widen_unary_before_exponent(
            self.log(),
            self.lexer.contents,
            &self.lexer.all_comments,
            start,
            operator_end,
            to,
            argument,
        );
        if let Some(starts) = &mut self.starts_for_parse_only {
            starts.syntax_errors = errors;
        }
    }

    /// `super` at `super_range` is not followed by what the parse pass takes after it at `level`.
    #[cold]
    #[inline(never)]
    pub(crate) fn super_unexpected(&mut self, level: Level, super_range: Range) {
        let reference = self.super_diagnostic(level, super_range);
        let msgs_len = self.log().msgs.len();
        self.log()
            .add_range_error(Some(self.source), super_range, b"Unexpected \"super\"");
        if let Some((message, range)) = reference {
            self.code_syntax_error(msgs_len, message, b"", range);
        }
    }

    /// parseSuperExpression: what the reference reports for what follows the `super` at `super_range`. `None`: nothing, or no lint parse.
    fn super_diagnostic(&mut self, level: Level, super_range: Range) -> Option<(Message, Range)> {
        // parseNewExpressionOrNewDotTarget reads the `super` after `new` as a primary expression.
        if !self.is_lint_parse() || level == Level::Member {
            return None;
        }
        if Self::IS_TYPESCRIPT_ENABLED && self.lexer.token == T::TLessThan {
            // tryParseTypeArgumentsInExpression: nothing of the reading stays
            let less_than = self.lexer.snapshot();
            let logged = self.lint_logged();
            let recorded = self.sidecar_mark();
            let read = self.try_build_type_script_type_arguments_with_backtracking();
            self.lexer.restore(&less_than);
            let log = self.log();
            log.msgs.truncate(logged.0);
            log.errors = logged.1;
            log.warnings = logged.2;
            if let Some(mark) = recorded {
                self.rewind_sidecar(mark);
            }
            if let Some((_, end)) = read {
                let start = u32::try_from(super_range.end().start).unwrap_or(0);
                return Some((SUPER_MAY_NOT_USE_TYPE_ARGUMENTS, ts::range(start, end)));
            }
        }
        match self.lexer.token {
            T::TOpenParen | T::TDot | T::TOpenBracket => None,
            _ => Some((
                SUPER_MUST_BE_FOLLOWED_BY_AN_ARGUMENT_LIST_OR_MEMBER_ACCESS,
                self.lexer.range(),
            )),
        }
    }

    /// parsePropertyAccessExpressionRest: the type arguments from `less_than` to `end` were read as an instantiation expression, and the lexer is on what follows them. A name after "." or "?." is an error. `is_target_of_new`: `new` reads the expression.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_property_access_after_instantiation(
        &mut self,
        less_than: Loc,
        end: u32,
        is_target_of_new: bool,
    ) {
        let is_property_access = match self.lexer.token {
            T::TDot => self.next_token_matches(|p| {
                p.lexer.is_identifier_or_keyword() || p.lexer.token == T::TPrivateIdentifier
            }),
            // A private name after "?." is the first error of the reference there, and `new` reads no "?." at all.
            T::TQuestionDot if !is_target_of_new => {
                self.next_token_matches(|p| p.lexer.is_identifier_or_keyword())
            }
            _ => false,
        };
        if is_property_access {
            let start = u32::try_from(less_than.start).unwrap_or(0);
            self.lint_error(
                ts::range(start, end),
                AN_INSTANTIATION_EXPRESSION_CANNOT_BE_FOLLOWED_BY_A_PROPERTY_ACCESS,
                b"",
            );
        }
    }

    /// `Lexer::expect` of the name after "." or "?.", at a token that is none. `is_in_optional_chain`: the access is part of an optional chain.
    #[cold]
    #[inline(never)]
    pub(crate) fn name_after_dot_expected(
        &mut self,
        is_in_optional_chain: bool,
    ) -> Result<(), Error> {
        let msgs_len = self.log().msgs.len();
        let range = self.lexer.range();
        let is_private = self.lexer.token == T::TPrivateIdentifier;
        self.lexer.expect(T::TIdentifier)?;
        // parsePropertyAccessExpressionRest
        if is_private && is_in_optional_chain && self.log().msgs.len() == msgs_len + 1 {
            self.code_syntax_error(
                msgs_len,
                AN_OPTIONAL_CHAIN_CANNOT_CONTAIN_PRIVATE_IDENTIFIERS,
                b"",
                range,
            );
        }
        Ok(())
    }

    /// nextTokenIsBindingIdentifierOrStartOfDestructuringOnSameLine with disallowOf, at the name after `using` in the head of a `for`: `of` names a declaration only before "=", ";" or ":".
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_using_of_is_no_declaration(&mut self) -> bool {
        self.is_lint_parse()
            && self.lexer.raw() == b"of"
            && !self.next_token_matches(|p| {
                matches!(p.lexer.token, T::TEquals | T::TSemicolon | T::TColon)
            })
    }

    /// parseNewExpressionOrNewDotTarget: the "?." at `question_dot` follows the member expression `receiver` that `new` reads.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_optional_chain_from_new(&mut self, receiver: &Expr, question_dot: u32) {
        let contents = self.lexer.contents;
        let Some(starts) = &self.starts_for_parse_only else {
            return;
        };
        let comments = &self.lexer.all_comments;
        let mut end = ts::full_start(contents, comments, question_dot);
        // The type arguments that `new` takes are no part of the expression it names.
        let type_arguments = starts
            .generics
            .type_arguments
            .iter()
            .find(|record| record.end == end && record.of == TypeArgumentsOf::Expression);
        if let Some(record) = type_arguments {
            end = ts::full_start(contents, comments, record.lt);
        }
        let start = first_token(&starts.wrappers, receiver);
        let text = contents.get(start as usize..end as usize).unwrap_or(b"");
        self.lint_error(
            ts::range(question_dot, question_dot.saturating_add(2)),
            INVALID_OPTIONAL_CHAIN_FROM_NEW_EXPRESSION_DID_YOU_MEAN_TO_CALL_0,
            text,
        );
    }

    /// The lexer is on the "(" after the "?." that follows the member expression `receiver` of `new`, or after the type arguments between them.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_optional_call_from_new(&mut self, receiver: &Expr) {
        if !self.is_lint_parse() {
            return;
        }
        let lexer = &self.lexer;
        let next = u32::try_from(lexer.start).unwrap_or(u32::MAX);
        let mut before = ts::full_start(lexer.contents, &lexer.all_comments, next);
        if let Some(starts) = &self.starts_for_parse_only
            && let Some(record) = starts
                .generics
                .type_arguments
                .iter()
                .find(|record| record.end == before && record.of == TypeArgumentsOf::OptionalCall)
        {
            before = ts::full_start(lexer.contents, &lexer.all_comments, record.lt);
        }
        let Some(question_dot) = before.checked_sub(2) else {
            return;
        };
        self.lint_optional_chain_from_new(receiver, question_dot);
    }

    /// The checks of the reference on expressions that the parse pass reads without a word, after a lint parse that logged no error.
    #[cold]
    pub(crate) fn lint_check_expressions(&mut self, stmts: &[Stmt]) {
        if !self.is_lint_parse() {
            return;
        }
        let mut checks = ExpressionChecks {
            p: &*self,
            found: Vec::new(),
        };
        for stmt in stmts {
            checks.visit_stmt(stmt);
        }
        // What the side table holds of the statements and class members that leave no node is read by the reference too.
        if let Some(starts) = &self.starts_for_parse_only {
            for erased in &starts.erased.statements {
                match &erased.data {
                    ErasedData::Declaration(stmt) => checks.visit_stmt(stmt),
                    ErasedData::Module(module) => {
                        if let Some(body) = module.body {
                            for stmt in body.slice() {
                                checks.visit_stmt(stmt);
                            }
                        }
                    }
                    _ => {}
                }
            }
            for member in &starts.erased.members {
                if let ErasedMemberData::Property(property) = &member.data {
                    for decorator in property.ts_decorators.iter() {
                        checks.visit_expr(decorator);
                    }
                    let held = [&property.key, &property.value, &property.initializer];
                    for expr in held.into_iter().flatten() {
                        checks.visit_expr(expr);
                    }
                }
            }
        }
        let mut found = checks.found;
        // The first message is the first in the source.
        found.sort_by_key(Finding::start);
        for finding in found {
            match finding {
                Finding::PrivateNameInOptionalChain(range) => {
                    self.lint_error(
                        range,
                        AN_OPTIONAL_CHAIN_CANNOT_CONTAIN_PRIVATE_IDENTIFIERS,
                        b"",
                    );
                }
                Finding::OptionalChainFromNew {
                    receiver,
                    question_dot,
                } => self.lint_optional_chain_from_new(&receiver, question_dot),
            }
        }
    }
