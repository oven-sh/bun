/// `An_element_access_expression_should_take_an_argument`
const AN_ELEMENT_ACCESS_EXPRESSION_SHOULD_TAKE_AN_ARGUMENT: Message = Message::new(
    1011,
    b"An element access expression should take an argument.",
);
/// `X_super_must_be_followed_by_an_argument_list_or_member_access`
const X_SUPER_MUST_BE_FOLLOWED_BY_AN_ARGUMENT_LIST_OR_MEMBER_ACCESS: Message = Message::new(
    1034,
    b"'super' must be followed by an argument list or member access.",
);
/// `Invalid_optional_chain_from_new_expression_Did_you_mean_to_call_0`
const INVALID_OPTIONAL_CHAIN_FROM_NEW_EXPRESSION_DID_YOU_MEAN_TO_CALL_0: Message = Message::new(
    1209,
    b"Invalid optional chain from new expression. Did you mean to call '{0}()'?",
);
/// `An_instantiation_expression_cannot_be_followed_by_a_property_access`
const AN_INSTANTIATION_EXPRESSION_CANNOT_BE_FOLLOWED_BY_A_PROPERTY_ACCESS: Message = Message::new(
    1477,
    b"An instantiation expression cannot be followed by a property access.",
);
/// `X_super_may_not_use_type_arguments`
const X_SUPER_MAY_NOT_USE_TYPE_ARGUMENTS: Message =
    Message::new(2754, b"'super' may not use type arguments.");
/// `An_unary_expression_with_the_0_operator_is_not_allowed_in_the_left_hand_side_of_an_exponentiation_expression_Consider_enclosing_the_expression_in_parentheses`
const AN_UNARY_EXPRESSION_WITH_THE_0_OPERATOR_IS_NOT_ALLOWED_IN_THE_LEFT_HAND_SIDE_OF_AN_EXPONENTIATION_EXPRESSION: Message = Message::new(
    17006,
    b"An unary expression with the '{0}' operator is not allowed in the left-hand side of an exponentiation expression. Consider enclosing the expression in parentheses.",
);
/// `A_type_assertion_expression_is_not_allowed_in_the_left_hand_side_of_an_exponentiation_expression_Consider_enclosing_the_expression_in_parentheses`
const A_TYPE_ASSERTION_EXPRESSION_IS_NOT_ALLOWED_IN_THE_LEFT_HAND_SIDE_OF_AN_EXPONENTIATION_EXPRESSION: Message = Message::new(
    17007,
    b"A type assertion expression is not allowed in the left-hand side of an exponentiation expression. Consider enclosing the expression in parentheses.",
);
/// `An_optional_chain_cannot_contain_private_identifiers`
const AN_OPTIONAL_CHAIN_CANNOT_CONTAIN_PRIVATE_IDENTIFIERS: Message = Message::new(
    18030,
    b"An optional chain cannot contain private identifiers.",
);

impl SyntaxErrors {
    /// Replaces the last record with `to` from `range.0` to `range.1` if it is `from` at `start`.
    fn refine_at(
        &mut self,
        start: usize,
        from: Message,
        to: Message,
        argument: &[u8],
        range: (u32, u32),
    ) {
        let Some(last) = self.recorded.last_mut() else {
            return;
        };
        if last.error.code == from.code && last.error.start as usize == start {
            last.error.code = to.code;
            last.error.text = to.format(argument);
            last.error.start = range.0;
            last.error.end = range.1;
        }
    }

    /// Where the last record starts, if it is one of an operand of "**" and is the one of the last message of `log`, which is at `at`.
    fn start_before_exponentiation(&self, log: &Log, at: usize) -> Option<u32> {
        let last = self.recorded.last()?;
        let index = log.msgs.len().checked_sub(1)?;
        let msg = log.msgs.get(index)?;
        if last.error.msg as usize != index || text_of(msg) != last.text {
            return None;
        }
        if last.error.code != 17006 && last.error.code != 17007 {
            return None;
        }
        if msg.data.location.as_ref()?.offset != at {
            return None;
        }
        Some(last.error.start)
    }

    /// Makes the last record `to` from `start` on.
    fn restart_last(&mut self, start: u32, to: Message, argument: &[u8]) {
        if let Some(last) = self.recorded.last_mut() {
            last.error.start = start;
            last.error.code = to.code;
            last.error.text = to.format(argument);
        }
    }
}

fn offset_of(at: usize) -> u32 {
    u32::try_from(at).unwrap_or(u32::MAX)
}

fn offset_at(loc: Loc) -> u32 {
    u32::try_from(loc.start).unwrap_or(0)
}

/// The offset after the private name that starts at `start`.
fn private_name_end(source: &[u8], start: u32) -> u32 {
    let mut at = start as usize + 1;
    while let Some(&byte) = source.get(at) {
        if byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$' || byte >= 0x80 {
            at += 1;
        } else if byte == b'\\' && source.get(at + 1) == Some(&b'u') {
            at += 2;
            if source.get(at) == Some(&b'{') {
                while let Some(&hex) = source.get(at) {
                    at += 1;
                    if hex == b'}' {
                        break;
                    }
                }
            } else {
                at += 4;
            }
        } else {
            break;
        }
    }
    offset_of(at.min(source.len()))
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// The offset after the token before the one at `at`.
    fn end_before(&self, at: u32) -> u32 {
        ts::full_start(self.lexer.contents, &self.lexer.all_comments, at)
    }

    /// Logs, in a lint parse only, the diagnostic `message` of the reference at `range`, past the lexer. True in a lint parse.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_error(&mut self, range: Range, message: Message, argument: &[u8]) -> bool {
        if !self.is_lint_parse() {
            return false;
        }
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

    /// `Lexer::unexpected` at "**" after the operand of the unary expression that starts at `start`: parseUnaryExpressionOrHigher reports the expression.
    #[cold]
    #[inline(never)]
    fn unexpected_exponentiation(
        &mut self,
        start: Loc,
        message: Message,
        operator: &'static [u8],
    ) -> Result<(), Error> {
        let msgs_len = self.log().msgs.len();
        self.lexer.unexpected()?;
        let from = offset_at(start);
        let end = self.end_before(offset_of(self.lexer.start)).max(from);
        self.code_syntax_error(msgs_len, message, operator, ts::range(from, end));
        Ok(())
    }

    /// `unexpected_exponentiation` after the operand of the unary operator `operator`, which is at `start`.
    #[cold]
    #[inline(never)]
    pub(crate) fn unexpected_exponentiation_after_unary(
        &mut self,
        start: Loc,
        operator: &'static [u8],
    ) -> Result<(), Error> {
        self.unexpected_exponentiation(
            start,
            AN_UNARY_EXPRESSION_WITH_THE_0_OPERATOR_IS_NOT_ALLOWED_IN_THE_LEFT_HAND_SIDE_OF_AN_EXPONENTIATION_EXPRESSION,
            operator,
        )
    }

    /// `unexpected_exponentiation` after the operand of the type assertion whose "<" is at `start`.
    #[cold]
    #[inline(never)]
    pub(crate) fn unexpected_exponentiation_after_assertion(&mut self, start: Loc) -> Result<(), Error> {
        self.unexpected_exponentiation(
            start,
            A_TYPE_ASSERTION_EXPRESSION_IS_NOT_ALLOWED_IN_THE_LEFT_HAND_SIDE_OF_AN_EXPONENTIATION_EXPRESSION,
            b"",
        )
    }

    /// The operand of the unary expression that starts at `start` failed with `err`. Where it failed at "**" after a unary expression that starts the operand, the reference reports this one: its operator ends at `operator_end`.
    #[cold]
    #[inline(never)]
    fn operand_before_exponentiation(
        &mut self,
        start: Loc,
        operator_end: u32,
        message: Message,
        operator: &'static [u8],
        err: Error,
    ) -> Error {
        if self.lexer.token != T::TAsteriskAsterisk {
            return err;
        }
        let at = self.lexer.start;
        let Some(starts) = &mut self.starts_for_parse_only else {
            return err;
        };
        let mut errors = core::mem::take(&mut starts.syntax_errors);
        if let Some(inner) = errors.start_before_exponentiation(self.log(), at)
            && self.end_before(inner) == operator_end
        {
            errors.restart_last(offset_at(start), message, operator);
        }
        if let Some(starts) = &mut self.starts_for_parse_only {
            starts.syntax_errors = errors;
        }
        err
    }

    /// `operand_before_exponentiation` for the unary operator `operator`, which is at `start`.
    #[cold]
    #[inline(never)]
    pub(crate) fn operand_of_unary_failed(
        &mut self,
        start: Loc,
        operator: &'static [u8],
        err: Error,
    ) -> Error {
        let operator_end = offset_at(start) + offset_of(operator.len());
        self.operand_before_exponentiation(
            start,
            operator_end,
            AN_UNARY_EXPRESSION_WITH_THE_0_OPERATOR_IS_NOT_ALLOWED_IN_THE_LEFT_HAND_SIDE_OF_AN_EXPONENTIATION_EXPRESSION,
            operator,
            err,
        )
    }

    /// `operand_before_exponentiation` for the type assertion whose "<" is at `start` and whose ">" is at `greater_than`.
    #[cold]
    #[inline(never)]
    pub(crate) fn operand_of_assertion_failed(
        &mut self,
        start: Loc,
        greater_than: Loc,
        err: Error,
    ) -> Error {
        self.operand_before_exponentiation(
            start,
            offset_at(greater_than) + 1,
            A_TYPE_ASSERTION_EXPRESSION_IS_NOT_ALLOWED_IN_THE_LEFT_HAND_SIDE_OF_AN_EXPONENTIATION_EXPRESSION,
            b"",
            err,
        )
    }

    /// `Lexer::unexpected` at a token that starts no expression, where `parse_prefix` was asked for one at `level`.
    #[cold]
    #[inline(never)]
    pub(crate) fn expression_expected(&mut self, level: Level) -> Result<(), Error> {
        let at = self.lexer.start;
        self.unexpected_as(EXPRESSION_EXPECTED)?;
        if let Some(starts) = &mut self.starts_for_parse_only {
            // What brackets of an element access hold is read at the lowest level, a computed name is not.
            starts.syntax_errors.lowest = if level.gt(Level::Lowest) { None } else { Some(at) };
        }
        Ok(())
    }

    /// parseElementAccessExpressionRest: the argument of an element access failed with `err`. Where "]" stands right after the "[", the reference reports the argument that is missing, after the "[".
    #[cold]
    #[inline(never)]
    pub(crate) fn element_access_argument_expected(&mut self, err: Error) -> Error {
        if self.lexer.token != T::TCloseBracket || self.byte_before_token() != Some(b'[') {
            return err;
        }
        let at = self.lexer.start;
        let after_bracket = self.end_before(offset_of(at));
        if let Some(starts) = &mut self.starts_for_parse_only
            && starts.syntax_errors.lowest == Some(at)
        {
            starts.syntax_errors.refine_at(
                at,
                EXPRESSION_EXPECTED,
                AN_ELEMENT_ACCESS_EXPRESSION_SHOULD_TAKE_AN_ARGUMENT,
                b"",
                (after_bracket, after_bracket),
            );
        }
        err
    }

    /// Where the type arguments that start at the "<" the lexer is on end, if a token that may follow them in an expression comes next: nothing is read.
    fn lint_type_arguments_end(&mut self) -> Option<u32> {
        let lexer = self.lexer.snapshot();
        let recorded = self.sidecar_mark();
        let logged = self.lint_logged();
        let end = self
            .try_build_type_script_type_arguments_with_backtracking()
            .map(|(_, end)| end);
        self.lexer.restore(&lexer);
        if let Some(mark) = recorded {
            self.rewind_sidecar(mark);
        }
        let log = self.log();
        log.msgs.truncate(logged.0);
        log.errors = logged.1;
        log.warnings = logged.2;
        end
    }

    /// parseSuperExpression: `super`, whose range is `super_range`, before a token that a parse without lint does not take after it. The lexer is on that token.
    #[cold]
    #[inline(never)]
    pub(crate) fn unexpected_super(&mut self, super_range: Range, level: Level) {
        let mut reference: Option<(Message, Range)> = None;
        if self.is_lint_parse() {
            // parsePrimaryExpression reads the target of `new` as a keyword.
            if level.gte(Level::Member) {
                return;
            }
            let after = offset_at(super_range.end());
            let type_arguments_end = if Self::IS_TYPESCRIPT_ENABLED && self.lexer.token == T::TLessThan {
                self.lint_type_arguments_end()
            } else {
                None
            };
            if let Some(end) = type_arguments_end {
                reference = Some((X_SUPER_MAY_NOT_USE_TYPE_ARGUMENTS, ts::range(after, end)));
            } else if matches!(
                self.lexer.token,
                T::TOpenParen | T::TDot | T::TOpenBracket
            ) {
                // Where `super` may stand is for the checker of the reference.
                return;
            } else {
                reference = Some((
                    X_SUPER_MUST_BE_FOLLOWED_BY_AN_ARGUMENT_LIST_OR_MEMBER_ACCESS,
                    self.lexer.range(),
                ));
            }
        }
        let msgs_len = self.log().msgs.len();
        self.log()
            .add_range_error(Some(self.source), super_range, b"Unexpected \"super\"");
        if let Some((message, range)) = reference {
            self.code_syntax_error(msgs_len, message, b"", range);
        }
    }

    /// `Lexer::expect(T::TIdentifier)` for the name after "." or "?.": parsePropertyAccessExpressionRest reads a private name there, and reports the one of an optional chain.
    #[cold]
    #[inline(never)]
    pub(crate) fn expect_member_name(&mut self, is_in_optional_chain: bool) -> Result<(), Error> {
        let msgs_len = self.log().msgs.len();
        let range = self.lexer.range();
        let is_private_name = self.lexer.token == T::TPrivateIdentifier;
        self.lexer.expect(T::TIdentifier)?;
        if is_private_name && is_in_optional_chain {
            self.code_syntax_error(
                msgs_len,
                AN_OPTIONAL_CHAIN_CANNOT_CONTAIN_PRIVATE_IDENTIFIERS,
                b"",
                range,
            );
        }
        Ok(())
    }

    /// `expect_member_name` after "?.", read at `level` after `target`.
    #[cold]
    #[inline(never)]
    pub(crate) fn expect_name_after_question_dot(
        &mut self,
        level: Level,
        target: Expr,
    ) -> Result<(), Error> {
        if level.gte(Level::Member) {
            self.lint_optional_chain_from_new(target);
        }
        self.expect_member_name(true)
    }

    /// A private name right after "?.", read at `level`: the lexer is on the name.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_private_name_after_question_dot(&mut self, level: Level) {
        // The chain of the target of `new` is reported first, where the tree is read.
        if level.gte(Level::Member) {
            return;
        }
        let range = self.lexer.range();
        self.lint_error(
            range,
            AN_OPTIONAL_CHAIN_CANNOT_CONTAIN_PRIVATE_IDENTIFIERS,
            b"",
        );
    }

    /// parseNewExpressionOrNewDotTarget: "?." after `target`, the target of `new` so far. The lexer is on the token after the "?.".
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_optional_chain_from_new(&mut self, target: Expr) {
        if !self.is_lint_parse() {
            return;
        }
        // A "?." that `target` holds comes first.
        let earlier = self
            .optional_chain_start_of_new_target(target)
            .and_then(|link| self.question_dot_of(link));
        let range = match earlier {
            Some(range) => range,
            None => {
                let end = self.end_before(offset_of(self.lexer.start));
                let Some(start) = end.checked_sub(2) else {
                    return;
                };
                ts::range(start, end)
            }
        };
        let from = self.first_token_start(target);
        let text = self.new_target_text(from, offset_at(range.loc)).to_vec();
        self.lint_error(
            range,
            INVALID_OPTIONAL_CHAIN_FROM_NEW_EXPRESSION_DID_YOU_MEAN_TO_CALL_0,
            &text,
        );
    }

    /// A template after an optional chain, read at `level` after `tag`: in the target of `new` the reference reports the "?." of the chain first.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_optional_chain_of_new_before_template(&mut self, level: Level, tag: Expr) {
        if !self.is_lint_parse() || !level.gte(Level::Member) {
            return;
        }
        let Some(link) = self.optional_chain_start_of_new_target(tag) else {
            return;
        };
        let Some(range) = self.question_dot_of(link) else {
            return;
        };
        let from = self.first_token_start(tag);
        let text = self.new_target_text(from, offset_at(range.loc)).to_vec();
        self.lint_error(
            range,
            INVALID_OPTIONAL_CHAIN_FROM_NEW_EXPRESSION_DID_YOU_MEAN_TO_CALL_0,
            &text,
        );
    }

    /// nextTokenIsBindingIdentifierOrStartOfDestructuringOnSameLine with disallowOf: in the head of a `for`, `using of` declares `of` only before "=", ";" or ":". The lexer is on the name after `using`.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_using_of_is_a_name(&mut self) -> bool {
        self.is_lint_parse()
            && self.lexer.raw() == b"of"
            && !self.next_token_matches(|p| {
                matches!(p.lexer.token, T::TEquals | T::TSemicolon | T::TColon)
            })
    }

    /// parsePropertyAccessExpressionRest: type arguments from `less_than` to `end` were read after an expression that is read at `level`. Where "." or "?." and a name follow, the reference reports them.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_instantiation_before_property_access(
        &mut self,
        less_than: Loc,
        end: u32,
        level: Level,
    ) {
        let is_optional = match self.lexer.token {
            T::TDot => false,
            // The member chain of the target of `new` ends before "?.": the type arguments are those of `new`.
            T::TQuestionDot if level.gte(Level::Member) => return,
            T::TQuestionDot => true,
            _ => return,
        };
        // A name that is missing, and a private name of an optional chain, are reported first.
        let is_name = self.next_token_matches(|p| {
            p.lexer.is_identifier_or_keyword()
                || (!is_optional && p.lexer.token == T::TPrivateIdentifier)
        });
        if !is_name {
            return;
        }
        self.lint_error(
            ts::range(offset_at(less_than), end),
            AN_INSTANTIATION_EXPRESSION_CANNOT_BE_FOLLOWED_BY_A_PROPERTY_ACCESS,
            b"",
        );
    }

    /// Whether parentheses stand around `expr`.
    fn is_parenthesized(&self, expr: &Expr) -> bool {
        let Some(starts) = &self.starts_for_parse_only else {
            return false;
        };
        starts
            .wrappers
            .records
            .iter()
            .any(|record| matches!(record.data, WrapperData::Parenthesized) && record.wraps(expr))
    }

    /// Where the first token of `expr` starts: a node starts where its first operand does, and "(" or "<T>" before an operand leaves no node.
    fn first_token_start(&self, expr: Expr) -> u32 {
        let mut start = offset_at(expr.loc);
        let mut node = expr;
        loop {
            if let Some(starts) = &self.starts_for_parse_only {
                for record in starts.wrappers.records.iter() {
                    if matches!(
                        record.data,
                        WrapperData::Parenthesized | WrapperData::TypeAssertion(_)
                    ) && record.wraps(&node)
                    {
                        start = start.min(record.op);
                    }
                }
            }
            node = match node.data {
                ExprData::EDot(dot) => dot.target,
                ExprData::EIndex(index) => index.target,
                ExprData::ECall(call) => call.target,
                ExprData::EBinary(binary) => binary.left,
                ExprData::EIf(conditional) => conditional.test,
                ExprData::ETemplate(template) => match template.tag {
                    Some(tag) => tag,
                    None => break,
                },
                ExprData::EUnary(unary) if !bun_ast::op::Code::is_prefix(unary.op) => unary.value,
                _ => break,
            };
            start = start.min(offset_at(node.loc));
        }
        start
    }

    /// The text of the target of `new` that starts at `from` and ends before the "?." at `question_dot`: type arguments before the "?." are no part of it.
    fn new_target_text(&self, from: u32, question_dot: u32) -> &[u8] {
        let mut end = self.end_before(question_dot);
        if let Some(starts) = &self.starts_for_parse_only
            && let Some(record) = starts
                .generics
                .type_arguments
                .iter()
                .rev()
                .find(|record| record.end == end)
        {
            end = self.end_before(record.lt);
        }
        self.lexer
            .contents
            .get(from as usize..end as usize)
            .unwrap_or(b"")
    }

    /// The link of the member chain of `target`, the target of `new`, that the first "?." of the chain starts: what parentheses hold is no part of the chain.
    fn optional_chain_start_of_new_target(&self, target: Expr) -> Option<Expr> {
        let mut node = target;
        let mut first = None;
        loop {
            if self.is_parenthesized(&node) {
                break;
            }
            match node.data {
                ExprData::EDot(dot) => {
                    if dot.optional_chain == Some(OptionalChain::Start) {
                        first = Some(node);
                    }
                    node = dot.target;
                }
                ExprData::EIndex(index) => {
                    if index.optional_chain == Some(OptionalChain::Start) {
                        first = Some(node);
                    }
                    node = index.target;
                }
                ExprData::ETemplate(template) => match template.tag {
                    Some(tag) => node = tag,
                    None => break,
                },
                _ => break,
            }
        }
        first
    }

    /// Where the "?." is that starts the chain link `link`.
    fn question_dot_of(&self, link: Expr) -> Option<Range> {
        let source = self.lexer.contents;
        let after = match link.data {
            ExprData::EDot(dot) => offset_at(dot.name_loc),
            ExprData::EIndex(index) => match index.index.data {
                ExprData::EPrivateIdentifier(_) => offset_at(index.index.loc),
                _ => {
                    let first = self.first_token_start(index.index);
                    let open = self.end_before(first).checked_sub(1)?;
                    if source.get(open as usize) != Some(&b'[') {
                        return None;
                    }
                    open
                }
            },
            _ => return None,
        };
        let end = self.end_before(after);
        let start = end.checked_sub(2)?;
        if source.get(start as usize..end as usize) != Some(b"?.".as_slice()) {
            return None;
        }
        Some(ts::range(start, end))
    }

    /// Where `expr` starts, if it is an update expression whose first token is the name `await`, outside parentheses.
    fn start_of_await_name(&self, expr: Expr) -> Option<u32> {
        let mut node = expr;
        loop {
            if let Some(starts) = &self.starts_for_parse_only
                && starts.wrappers.records.iter().any(|record| {
                    matches!(
                        record.data,
                        WrapperData::Parenthesized | WrapperData::TypeAssertion(_)
                    ) && record.wraps(&node)
                })
            {
                return None;
            }
            node = match node.data {
                ExprData::EDot(dot) => dot.target,
                ExprData::EIndex(index) => index.target,
                ExprData::ECall(call) => call.target,
                ExprData::ETemplate(template) => template.tag?,
                ExprData::EUnary(unary) if !bun_ast::op::Code::is_prefix(unary.op) => unary.value,
                ExprData::EIdentifier(_) => break,
                _ => return None,
            };
        }
        let start = offset_at(node.loc);
        let source = self.lexer.contents;
        let name = source.get(start as usize..start as usize + 5)?;
        let after = source.get(start as usize + 5).copied().unwrap_or(b' ');
        let is_name_part = after.is_ascii_alphanumeric() || after == b'_' || after == b'$' || after == b'\\' || after >= 0x80;
        (name == b"await" && !is_name_part).then_some(start)
    }

    /// What the tree tells of `expr` and no site of the parse pass tests: the diagnostic of the reference, where it starts and ends, and its argument.
    fn shape_error_of(&self, expr: Expr) -> Option<(Message, Range, Vec<u8>)> {
        match expr.data {
            // parseNewExpressionOrNewDotTarget: the member chain of the target has no "?."
            ExprData::ENew(new) => {
                let link = self.optional_chain_start_of_new_target(new.target)?;
                let range = self.question_dot_of(link)?;
                let from = self.first_token_start(new.target);
                let text = self.new_target_text(from, offset_at(range.loc)).to_vec();
                Some((
                    INVALID_OPTIONAL_CHAIN_FROM_NEW_EXPRESSION_DID_YOU_MEAN_TO_CALL_0,
                    range,
                    text,
                ))
            }
            // parseUnaryExpressionOrHigher: an update expression that starts with the name `await` is no left operand of "**"
            ExprData::EBinary(binary) if binary.op == bun_ast::OpCode::BinPow => {
                let start = self.start_of_await_name(binary.left)?;
                let after_operator = self.end_before(self.first_token_start(binary.right));
                let operator = after_operator.checked_sub(2)?;
                if self.lexer.contents.get(operator as usize..after_operator as usize)
                    != Some(b"**".as_slice())
                {
                    return None;
                }
                let end = self.end_before(operator);
                Some((
                    AN_UNARY_EXPRESSION_WITH_THE_0_OPERATOR_IS_NOT_ALLOWED_IN_THE_LEFT_HAND_SIDE_OF_AN_EXPONENTIATION_EXPRESSION,
                    ts::range(start, end.max(start)),
                    b"await".to_vec(),
                ))
            }
            // parsePropertyAccessExpressionRest: a private name is no part of an optional chain
            ExprData::EIndex(index)
                if index.optional_chain.is_some()
                    && matches!(index.index.data, ExprData::EPrivateIdentifier(_)) =>
            {
                let start = offset_at(index.index.loc);
                let end = private_name_end(self.lexer.contents, start);
                Some((
                    AN_OPTIONAL_CHAIN_CANNOT_CONTAIN_PRIVATE_IDENTIFIERS,
                    ts::range(start, end),
                    Vec::new(),
                ))
            }
            _ => None,
        }
    }

    /// Stand-in for the walk of the finished tree: reports the first, by where it starts, of what `shape_error_of` finds in `stmts`.
    #[cold]
    pub(crate) fn lint_check_shapes(&mut self, stmts: &[Stmt]) {
        let mut candidates: Vec<Expr> = Vec::new();
        shape_walk::stmts(stmts, &mut candidates);
        let mut first: Option<(Message, Range, Vec<u8>)> = None;
        for candidate in candidates {
            let Some(found) = self.shape_error_of(candidate) else {
                continue;
            };
            if first
                .as_ref()
                .is_none_or(|(_, range, _)| found.1.loc.start < range.loc.start)
            {
                first = Some(found);
            }
        }
        if let Some((message, range, argument)) = first {
            self.lint_error(range, message, &argument);
        }
    }
}

/// Stand-in for the walk of the finished tree: collects every `new` expression and every element access of a private name.
mod shape_walk {
    use bun_ast::b::B;
    use bun_ast::expr::Data;
    use bun_ast::stmt::Data as StmtData;
    use bun_ast::{Binding, Expr, G, Stmt, StmtOrExpr};

    pub(super) fn stmts(list: &[Stmt], out: &mut Vec<Expr>) {
        for item in list {
            stmt(item, out);
        }
    }

    fn optional(value: Option<&Expr>, out: &mut Vec<Expr>) {
        if let Some(value) = value {
            expr(value, out);
        }
    }

    fn binding(item: &Binding, out: &mut Vec<Expr>) {
        match &item.data {
            B::BIdentifier(_) | B::BMissing(_) => {}
            B::BArray(array) => {
                for element in array.items() {
                    binding(&element.binding, out);
                    optional(element.default_value.as_ref(), out);
                }
            }
            B::BObject(object) => {
                for property in object.properties() {
                    expr(&property.key, out);
                    binding(&property.value, out);
                    optional(property.default_value.as_ref(), out);
                }
            }
        }
    }

    fn args(list: &[G::Arg], out: &mut Vec<Expr>) {
        for arg in list {
            binding(&arg.binding, out);
            optional(arg.default.as_ref(), out);
        }
    }

    fn func(function: &G::Fn, out: &mut Vec<Expr>) {
        args(function.args.slice(), out);
        stmts(function.body.stmts.slice(), out);
    }

    fn class(class: &G::Class, out: &mut Vec<Expr>) {
        optional(class.extends.as_ref(), out);
        for property in class.properties.slice() {
            if let Some(block) = property.class_static_block_ref() {
                stmts(block.stmts.as_slice(), out);
                continue;
            }
            optional(property.key.as_ref(), out);
            optional(property.value.as_ref(), out);
            optional(property.initializer.as_ref(), out);
        }
    }

    fn stmt(item: &Stmt, out: &mut Vec<Expr>) {
        match &item.data {
            StmtData::SBlock(s) => stmts(s.stmts.slice(), out),
            StmtData::SExpr(s) => expr(&s.value, out),
            StmtData::SLocal(s) => {
                for decl in s.decls.iter() {
                    binding(&decl.binding, out);
                    optional(decl.value.as_ref(), out);
                }
            }
            StmtData::SReturn(s) => optional(s.value.as_ref(), out),
            StmtData::SThrow(s) => expr(&s.value, out),
            StmtData::SIf(s) => {
                expr(&s.test, out);
                stmt(&s.yes, out);
                if let Some(no) = &s.no {
                    stmt(no, out);
                }
            }
            StmtData::SFor(s) => {
                if let Some(init) = &s.init {
                    stmt(init, out);
                }
                optional(s.test.as_ref(), out);
                optional(s.update.as_ref(), out);
                stmt(&s.body, out);
            }
            StmtData::SForIn(s) => {
                stmt(&s.init, out);
                expr(&s.value, out);
                stmt(&s.body, out);
            }
            StmtData::SForOf(s) => {
                stmt(&s.init, out);
                expr(&s.value, out);
                stmt(&s.body, out);
            }
            StmtData::SWhile(s) => {
                expr(&s.test, out);
                stmt(&s.body, out);
            }
            StmtData::SDoWhile(s) => {
                stmt(&s.body, out);
                expr(&s.test, out);
            }
            StmtData::SSwitch(s) => {
                expr(&s.test, out);
                for case in s.cases.slice() {
                    optional(case.value.as_ref(), out);
                    stmts(case.body.slice(), out);
                }
            }
            StmtData::STry(s) => {
                stmts(s.body.slice(), out);
                if let Some(catch) = &s.catch {
                    if let Some(item) = &catch.binding {
                        binding(item, out);
                    }
                    stmts(catch.body.slice(), out);
                }
                if let Some(finally) = &s.finally {
                    stmts(finally.stmts.slice(), out);
                }
            }
            StmtData::SLabel(s) => stmt(&s.stmt, out),
            StmtData::SWith(s) => {
                expr(&s.value, out);
                stmt(&s.body, out);
            }
            StmtData::SFunction(s) => func(&s.func, out),
            StmtData::SClass(s) => class(&s.class, out),
            StmtData::SExportDefault(s) => match &s.value {
                StmtOrExpr::Stmt(inner) => stmt(inner, out),
                StmtOrExpr::Expr(inner) => expr(inner, out),
            },
            StmtData::SExportEquals(s) => expr(&s.value, out),
            _ => {}
        }
    }

    fn expr(item: &Expr, out: &mut Vec<Expr>) {
        match &item.data {
            Data::EBinary(e) => {
                if e.op == bun_ast::OpCode::BinPow {
                    out.push(*item);
                }
                expr(&e.left, out);
                expr(&e.right, out);
            }
            Data::EDot(e) => expr(&e.target, out),
            Data::EIndex(e) => {
                if matches!(e.index.data, Data::EPrivateIdentifier(_)) {
                    out.push(*item);
                }
                expr(&e.target, out);
                expr(&e.index, out);
            }
            Data::ECall(e) => {
                expr(&e.target, out);
                for arg in e.args.iter() {
                    expr(arg, out);
                }
            }
            Data::EUnary(e) => expr(&e.value, out),
            Data::EArrow(e) => {
                args(e.args.slice(), out);
                stmts(e.body.stmts.slice(), out);
            }
            Data::EFunction(e) => func(&e.func, out),
            Data::EClass(e) => class(e, out),
            Data::EArray(e) => {
                for element in e.items.iter() {
                    expr(element, out);
                }
            }
            Data::EObject(e) => {
                for property in e.properties.iter() {
                    optional(property.key.as_ref(), out);
                    optional(property.value.as_ref(), out);
                    optional(property.initializer.as_ref(), out);
                }
            }
            Data::ESpread(e) => expr(&e.value, out),
            Data::EIf(e) => {
                expr(&e.test, out);
                expr(&e.yes, out);
                expr(&e.no, out);
            }
            Data::ENew(e) => {
                out.push(*item);
                expr(&e.target, out);
                for arg in e.args.iter() {
                    expr(arg, out);
                }
            }
            Data::EImport(e) => {
                expr(&e.expr, out);
                expr(&e.options, out);
            }
            Data::EAwait(e) => expr(&e.value, out),
            Data::EYield(e) => optional(e.value.as_ref(), out),
            Data::ETemplate(e) => {
                optional(e.tag.as_ref(), out);
                for part in e.parts() {
                    expr(&part.value, out);
                }
            }
            _ => {}
        }
    }
}

